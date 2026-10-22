"""Step 4: export held-out test patients (twin state + predictions) for the database seed and the offline web demo.

Writes web/data/demo.json (all 45 held-out patients) and web/data/home-case.json (the home-page case).
"""
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from chaya.cohort import START_DATE, MEALS  # noqa: E402
from chaya.model import split_patients  # noqa: E402

D, M, R = ROOT / "data", ROOT / "models", ROOT / "reports"
from chaya.explain import GROUPS  # noqa: E402
GIDX = {g: i for i, g in enumerate(GROUPS)}
W0 = 7 * 288
HOME_PID = "GT-1102"  # the case used on the home page and in the guided walkthrough  # first 5-min index of the evaluation week
STAGE = {"": 0, "Awake": 1, "Light": 2, "Deep": 3, "REM": 4}

ehr = pd.read_csv(D / "ehr/patients.csv")
w = pd.read_parquet(D / "wearables/stream_5min.parquet")
meals = pd.read_csv(D / "wearables/meal_log.csv", parse_dates=["ts"])
meds = pd.read_csv(D / "wearables/medication_log.csv", parse_dates=["ts"])
nights = pd.read_csv(D / "wearables/sleep_nightly.csv")
preds = pd.read_parquet(R / "test_predictions.parquet")
twins = pickle.load(open(M / "_cache/twins_full.pkl", "rb"))
metrics = json.load(open(R / "metrics.json"))
cfg = json.load(open(M / "model_config.json"))
_, test_p = split_patients(ehr)

# population reference for twin parameters (percentiles shown to the doctor)
allp = np.array([twins[p]["params"] for p in ehr.pid])


def rnd(a, d=1):
    return [None if (x is None or (isinstance(x, float) and np.isnan(x))) else round(float(x), d) for x in a]


patients, cohort = {}, []
for pid in test_p:
    row = ehr.set_index("pid").loc[pid]
    st = w[w.pid == pid].reset_index(drop=True)
    wk = st.iloc[W0:]
    art = twins[pid]
    cg = wk.cgm_mgdl.to_numpy()
    v = cg[~np.isnan(cg)]
    pr = preds[preds.pid == pid].sort_values("k")
    # alert episodes
    a = pr.alert.to_numpy(); kk = pr.k.to_numpy()
    starts = a & ~np.r_[False, a[:-1] & (np.diff(kk) <= 3)]
    pm = meals[(meals.pid == pid) & (meals.ts >= START_DATE + pd.Timedelta(days=7))]
    md = meds[(meds.pid == pid) & (meds.ts >= START_DATE + pd.Timedelta(days=7))]
    inp = art["inputs"]
    pct = lambda j: float((allp[:, j] < art["params"][j]).mean() * 100)
    p = dict(
        pid=pid, name=row["name"], age=int(row.age), sex=row.sex, city=row.city, condition=row.condition,
        ehr={k: (row[k].item() if hasattr(row[k], "item") else row[k]) for k in [
            "height_cm", "weight_kg", "bmi", "waist_cm", "diabetes_years", "family_history_t2d", "tcf7l2_rs7903146",
            "hypertension", "dyslipidemia", "nafld", "smoker", "vegetarian", "on_metformin", "on_sulfonylurea",
            "on_dpp4", "on_sglt2", "on_basal_insulin", "hba1c_pct", "fasting_glucose_mgdl", "triglycerides_mgdl",
            "hdl_mgdl", "ldl_mgdl", "egfr", "alt_u_l", "systolic_bp", "diastolic_bp"]},
        cgm=rnd(cg, 0), steps=wk.steps.astype(int).tolist(), hr=wk.heart_rate.astype(int).tolist(),
        sleep="".join(str(STAGE[s]) for s in wk.sleep_stage),
        meals=[dict(k=int((r.ts - START_DATE).total_seconds() // 300) - W0, meal=r.meal, carbs=int(r.carbs_g), gi=int(r.gi), slot=r.slot)
               for r in pm.itertuples()],
        meds=[dict(k=int((r.ts - START_DATE).total_seconds() // 300) - W0, drug=r.drug) for r in md.itertuples()],
        nights=nights[nights.pid == pid].drop(columns="pid").to_dict("records"),
        pred=dict(k=(kk - W0).tolist(), prob=rnd(pr.prob, 3), p2h=rnd(pr.pred_2h, 0), alert=a.astype(int).tolist(),
                  start=starts.astype(int).tolist(),
                  why={int(k - W0): [[GIDX[e["group"]], e["text"]] for e in json.loads(wy)]
                       for k, wy, pb in zip(kk, pr.why, pr.prob) if pb >= 0.3}),
        twin=dict(params=[float(x) for x in art["params"]], prior=[float(x) for x in art["prior"]],
                  fit_rmse=round(art["fit_rmse"], 1),
                  pct=dict(SI=pct(2), gamma=pct(3), Gb=pct(0)),
                  states=[[float(f"{x:.4g}") for x in art["states"][k]] for k in kk],
                  inferred={int(i): round(float(x)) for i, x in enumerate(art["inferred"][W0:]) if x >= 1},
                  si_mult=[round(float(inp["si_mult"][d * 1440 + 12 * 60]), 3) for d in range(14)],
                  gb_shift=[round(float(inp["gb_shift"][d * 1440 + 12 * 60]), 1) for d in range(14)],
                  su=[round(float(inp["su"][k * 5]), 3) for k in kk],
                  habit_carbs=rnd(art["habit"]["carbs"], 2), habit_gi=rnd(art["habit"]["gi"], 0),
                  habit_rate=rnd(art["habit"]["rate"], 3), steps_prof=rnd(art["steps_profile"], 1)),
        kpi=dict(tir=float(((v >= 70) & (v <= 180)).mean() * 100), tar=float((v > 180).mean() * 100),
                 tar250=float((v > 250).mean() * 100), tbr=float((v < 70).mean() * 100), mean=float(v.mean()),
                 gmi=float(3.31 + 0.02392 * v.mean()), cv=float(v.std() / v.mean() * 100),
                 alerts=int(starts.sum())),
    )
    patients[pid] = p
    cohort.append(dict(pid=pid, name=p["name"], age=p["age"], sex=p["sex"], city=p["city"], condition=p["condition"],
                       hba1c=row.hba1c_pct, tir=round(p["kpi"]["tir"]), tar=round(p["kpi"]["tar"]),
                       alerts=p["kpi"]["alerts"]))

meal_catalog = sorted({(n, c, g) for slot in MEALS.values() for (n, c, g, *_rest) in slot}, key=lambda t: t[0])
out = dict(start=str(START_DATE + pd.Timedelta(days=7)), threshold=cfg["threshold"],
           metrics=dict(classification=metrics["classification"], regression=metrics["regression"],
                        n_test=metrics["n_test_patients"], n_train=metrics["n_train_patients"],
                        twin_calibration=metrics["twin_calibration"],
                        learning_curve_auroc=metrics["learning_curve_auroc"]),
           population=dict(Gb=[round(float(x), 1) for x in allp[:, 0]], SI=[float(f"{x:.4g}") for x in allp[:, 2]],
                           gamma=[float(f"{x:.4g}") for x in allp[:, 3]]),
           groups=list(GROUPS), cohort=cohort, patients=patients,
           meal_catalog=[dict(meal=n, carbs=c, gi=g) for n, c, g in meal_catalog])
W = ROOT / "web/data"
W.mkdir(parents=True, exist_ok=True)
js = json.dumps(out, separators=(",", ":"), default=float)
(W / "demo.json").write_text(js)
home = dict(out, cohort=[c for c in cohort if c["pid"] == HOME_PID], patients={HOME_PID: patients[HOME_PID]})
(W / "home-case.json").write_text(json.dumps(home, separators=(",", ":"), default=float))
print(f"web/data/demo.json  {len(js) / 1e6:.1f} MB  patients={len(patients)}")
