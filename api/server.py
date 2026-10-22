"""
Chaya API: serves the web app and the clinic data from the database.

    uvicorn api.server:app --reload           (local, SQLite)
    DATABASE_URL=postgres://...  uvicorn ...  (Railway Postgres)

Clinic (database-backed)
  GET  /api/health                         service + database status
  GET  /api/meta                           week start, alert threshold, model metrics, meal catalogue
  GET  /api/patients                       the register (held-out synthetic patients)
  GET  /api/patients/{pid}                 full case bundle for the replay week
  POST /api/patients/{pid}/simulate        run the patient's twin forward under advice (meal, walk, sleep, metformin)
  GET  /api/patients/{pid}/notes           saved Rx advice
  POST /api/patients/{pid}/notes           save Rx advice with its projection
  POST /api/patients/{pid}/alerts/{k}/review   mark an alert reviewed
Pipeline (raw data -> twin -> model, no database)
  GET  /api/pipeline/{pid}/risk?at=ISO     ingest FHIR + wearables, calibrate the twin, score the spike risk
"""
from __future__ import annotations

import json
import sys
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from chaya import db  # noqa: E402
from chaya import twin as tw  # noqa: E402
from chaya.physiology import GI_TO_KABS  # noqa: E402

app = FastAPI(title="Chaya API", version="2.0",
              description="Digital-twin glucose forecasting for Type 2 Diabetes. All patient data is synthetic.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
W0_DAY = 7  # the replay week is days 8-14 of the synthetic cohort


@app.on_event("startup")
def _startup():
    db.init_db()
    with db.SessionLocal() as s:
        if not db.is_seeded(s):
            from chaya.seed import seed
            seed()


def get_db():
    with db.SessionLocal() as s:
        yield s


def _patient_or_404(s: Session, pid: str) -> db.Patient:
    p = s.get(db.Patient, pid)
    if not p:
        raise HTTPException(404, f"No patient with ID {pid}. Check the register for valid IDs.")
    return p


# ------------------------------------------------------------------------------------------------ clinic
@app.get("/api/health")
def health(s: Session = Depends(get_db)):
    n = s.scalar(select(db.func.count()).select_from(db.Patient))
    return {"status": "ok", "database": db.backend_name(), "patients": n, "synthetic": True}


@app.get("/api/meta")
def meta(s: Session = Depends(get_db)):
    out = {m.key: m.value["v"] for m in s.scalars(select(db.Meta))}
    out["database"] = db.backend_name()
    return out


@app.get("/api/patients")
def register(s: Session = Depends(get_db)):
    return [dict(pid=p.pid, name=p.name, age=p.age, sex=p.sex, city=p.city, condition=p.condition, hba1c=p.hba1c,
                 tir=round(p.tir), tar=round(p.tar), alerts=p.alerts)
            for p in s.scalars(select(db.Patient).order_by(db.Patient.alerts.desc()))]


@app.get("/api/patients/{pid}")
def case_bundle(pid: str, s: Session = Depends(get_db)):
    p = _patient_or_404(s, pid)
    rd = s.scalars(select(db.Reading).where(db.Reading.pid == pid).order_by(db.Reading.k)).all()
    pr = s.scalars(select(db.Prediction).where(db.Prediction.pid == pid).order_by(db.Prediction.k)).all()
    t = s.get(db.Twin, pid)
    reviewed = [r.k for r in s.scalars(select(db.AlertReview).where(db.AlertReview.pid == pid))]
    return dict(
        pid=p.pid, name=p.name, age=p.age, sex=p.sex, city=p.city, condition=p.condition, ehr=p.ehr, kpi=p.kpi,
        cgm=[r.cgm for r in rd], steps=[r.steps for r in rd], hr=[r.hr for r in rd],
        sleep="".join(str(r.sleep) for r in rd),
        meals=[dict(k=m.k, meal=m.meal, carbs=m.carbs, gi=m.gi, slot=m.slot)
               for m in s.scalars(select(db.Meal).where(db.Meal.pid == pid).order_by(db.Meal.k))],
        meds=[dict(k=m.k, drug=m.drug) for m in s.scalars(select(db.Medication).where(db.Medication.pid == pid))],
        nights=[dict(day=n.day, date=n.date, sleep_hours=n.sleep_hours, deep_pct=n.deep_pct, bedtime=n.bedtime,
                     hrv_rmssd=n.hrv_rmssd, post_dinner_walk=n.post_dinner_walk)
                for n in s.scalars(select(db.Night).where(db.Night.pid == pid).order_by(db.Night.day))],
        pred=dict(k=[x.k for x in pr], prob=[x.prob for x in pr], p2h=[x.p2h for x in pr],
                  alert=[int(x.alert) for x in pr], start=[int(x.episode_start) for x in pr],
                  why={str(x.k): x.reasons for x in pr if x.reasons}),
        twin=dict(params=t.params, prior=t.prior, fit_rmse=t.fit_rmse, pct=t.pct, states=[x.state for x in pr],
                  su=[x.su for x in pr], si_mult=t.si_mult, gb_shift=t.gb_shift, habit_carbs=t.habit_carbs,
                  habit_gi=t.habit_gi, habit_rate=t.habit_rate, steps_prof=t.steps_prof, inferred=t.inferred),
        reviewed=reviewed,
    )


class Advice(BaseModel):
    k: int = Field(..., description="5-minute index within the replay week (0 = Mon 00:00)")
    meal_name: str | None = None
    carbs_g: float = Field(0, ge=0, le=250)
    gi: float = Field(65, ge=20, le=110)
    eat_in_min: int = Field(15, ge=0, le=120)
    walk_min: int = Field(0, ge=0, le=60)
    sleep_hours: float | None = Field(None, ge=3, le=10)
    metformin_taken: bool | None = None
    horizon_min: int = Field(240, ge=60, le=360)


def _simulate(s: Session, pid: str, a: Advice):
    t = s.get(db.Twin, pid)
    pr = s.scalars(select(db.Prediction).where(db.Prediction.pid == pid, db.Prediction.k <= a.k)
                   .order_by(db.Prediction.k.desc()).limit(1)).first()
    if not t or not pr:
        raise HTTPException(400, "No twin state at that time. Pick a time when the sensor was reading.")
    params = np.array(t.params, float)
    state = np.array(pr.state, float)
    mod = (pr.k % 288) * 5 + 5
    day = pr.k // 288 + W0_DAY
    H = a.horizon_min
    habit = dict(carbs=np.array(t.habit_carbs, float), gi=np.array(t.habit_gi, float))
    steps, _, kab = tw.routine_inputs(habit, np.array(t.steps_prof, float), mod, H, expected=False)
    steps, kab = np.array(steps, float), np.array(kab, float)
    carried = np.zeros(H)
    for m in s.scalars(select(db.Meal).where(db.Meal.pid == pid, db.Meal.k <= pr.k, db.Meal.k > pr.k - 3)):
        left = 15 - (pr.k * 5 + 5 - m.k * 5)   # a meal still being eaten
        if left > 0:
            carried[:left] += m.carbs * 1000 / 15
            kab[:] = GI_TO_KABS(m.gi)
    si = t.si_mult[day]
    if a.sleep_hours is not None:
        si = max(0.6, 1 - tw.SLEEP_SI_COEF * max(0.0, 7 - a.sleep_hours))
    gb = t.gb_shift[day]
    if a.metformin_taken is not None:
        gb = 0.0 if a.metformin_taken else 2 * tw.MISSED_MET_SHIFT
    base = tw.forecast(params, state, mod, H, steps, carried, kab, si, gb, pr.su)
    meal = carried.copy(); kab2 = kab.copy(); st2 = steps.copy()
    if a.carbs_g > 0:
        meal[a.eat_in_min:a.eat_in_min + 15] = a.carbs_g * 1000 / 15
        kab2[a.eat_in_min:] = GI_TO_KABS(a.gi)
    st2[a.eat_in_min + 20:a.eat_in_min + 20 + a.walk_min] += 100
    scen = tw.forecast(params, state, mod, H, st2, meal, kab2, si, gb, pr.su)
    return base, scen


@app.post("/api/patients/{pid}/simulate")
def simulate(pid: str, a: Advice, s: Session = Depends(get_db)):
    _patient_or_404(s, pid)
    base, scen = _simulate(s, pid, a)
    return dict(minutes=list(range(5, a.horizon_min + 1, 5)), no_meal=np.round(base).tolist(),
                with_advice=np.round(scen).tolist(), peak=round(float(scen.max())),
                minutes_above_180=int((scen > 180).sum() * 5))


class NoteIn(Advice):
    summary: str = Field(..., min_length=3, max_length=500)
    baseline_peak: float
    author: str = Field("Demo clinician", max_length=64)


@app.get("/api/patients/{pid}/notes")
def notes(pid: str, s: Session = Depends(get_db)):
    _patient_or_404(s, pid)
    rows = s.scalars(select(db.CaseNote).where(db.CaseNote.pid == pid).order_by(db.CaseNote.created_at.desc()))
    return [dict(id=n.id, created_at=n.created_at.isoformat() if n.created_at else None, at_k=n.at_k, advice=n.advice,
                 summary=n.summary, projected_peak=n.projected_peak,
                 projected_minutes_above=n.projected_minutes_above, baseline_peak=n.baseline_peak, author=n.author)
            for n in rows]


@app.post("/api/patients/{pid}/notes", status_code=201)
def add_note(pid: str, n: NoteIn, s: Session = Depends(get_db)):
    _patient_or_404(s, pid)
    _, scen = _simulate(s, pid, n)
    row = db.CaseNote(pid=pid, at_k=n.k, advice=n.model_dump(exclude={"summary", "baseline_peak", "author"}),
                      summary=n.summary, projected_peak=round(float(scen.max())),
                      projected_minutes_above=int((scen > 180).sum() * 5), baseline_peak=n.baseline_peak,
                      author=n.author)
    s.add(row); s.commit(); s.refresh(row)
    return dict(id=row.id, projected_peak=row.projected_peak, projected_minutes_above=row.projected_minutes_above)


@app.delete("/api/patients/{pid}/notes/{note_id}", status_code=204)
def delete_note(pid: str, note_id: int, s: Session = Depends(get_db)):
    row = s.get(db.CaseNote, note_id)
    if not row or row.pid != pid:
        raise HTTPException(404, "That note no longer exists.")
    s.delete(row); s.commit()


@app.post("/api/patients/{pid}/alerts/{k}/review")
def review_alert(pid: str, k: int, s: Session = Depends(get_db)):
    _patient_or_404(s, pid)
    if not s.get(db.AlertReview, (pid, k)):
        s.add(db.AlertReview(pid=pid, k=k)); s.commit()
    return {"pid": pid, "k": k, "reviewed": True}


# ------------------------------------------------------------------------------------------------ pipeline
@lru_cache(maxsize=16)
def _pipeline(pid: str):
    import lightgbm as lgb
    from chaya.ingest import load_patient
    from chaya.features import patient_features
    try:
        ehr, w, meals, meds, nights = load_patient(pid, ROOT / "data")
    except KeyError:
        raise HTTPException(404, f"No raw records for {pid}.")
    feats, art = patient_features(pid, ehr, w, meals, meds, nights)
    cfg = json.loads((ROOT / "models/model_config.json").read_text())
    cls = lgb.Booster(model_file=str(ROOT / "models/spike_classifier.txt"))
    reg = lgb.Booster(model_file=str(ROOT / "models/glucose_2h_regressor.txt"))
    return feats, art, cfg, cls, reg


@app.get("/api/pipeline/{pid}/risk")
def pipeline_risk(pid: str, at: str = "2026-09-20T12:45"):
    """End-to-end: FHIR bundle + wearable streams -> calibrated twin -> fused features -> LightGBM."""
    from chaya.explain import explain
    feats, art, cfg, cls, reg = _pipeline(pid)
    row = feats[feats.ts <= pd.Timestamp(at)].tail(1)
    if row.empty:
        raise HTTPException(400, "Forecasts start on day 8, after 7 days of twin calibration.")
    cols = cfg["features"]
    p = float(cls.predict(row[cols])[0])
    return dict(pid=pid, at=str(row.ts.iloc[0]), cgm_now=float(row.cgm_now.iloc[0]), spike_probability=round(p, 3),
                alert=bool(p >= cfg["threshold"] and row.cgm_now.iloc[0] < 180),
                glucose_in_2h=round(float(reg.predict(row[cols])[0])),
                twin_peak_2h=round(float(row.twin_max_routine.iloc[0])), reasons=explain(cls, row, cols)[0],
                twin=dict(insulin_sensitivity=art["params"][2], beta_cell_response=art["params"][3],
                          basal_glucose=art["params"][0], fit_rmse=art["fit_rmse"]))


# ------------------------------------------------------------------------------------------------ web app
WEB = ROOT / "web"
app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")
app.mount("/data", StaticFiles(directory=WEB / "data"), name="data")


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    f = WEB / path
    if path and f.is_file() and WEB in f.resolve().parents:
        return FileResponse(f)
    return FileResponse(WEB / "index.html")
