"""Load web/data/demo.json into the Chaya database (idempotent)."""
import json
import time
from pathlib import Path

from . import db

ROOT = Path(__file__).resolve().parents[2]


def seed(reset: bool = False) -> None:
    if reset:
        db.Base.metadata.drop_all(db.engine)
    db.init_db()
    with db.SessionLocal() as s:
        if db.is_seeded(s):
            print(f"[seed] {db.backend_name()} already seeded; nothing to do")
            return
    t0 = time.time()
    d = json.loads((ROOT / "web/data/demo.json").read_text())
    with db.SessionLocal.begin() as s:
        for key in ("start", "threshold", "metrics", "groups", "meal_catalog", "population"):
            s.add(db.Meta(key=key, value={"v": d[key]}))
        for c in d["cohort"]:
            p = d["patients"][c["pid"]]
            s.add(db.Patient(pid=p["pid"], name=p["name"], age=p["age"], sex=p["sex"], city=p["city"],
                             condition=p["condition"], hba1c=c["hba1c"], tir=c["tir"], tar=c["tar"],
                             alerts=c["alerts"], ehr=p["ehr"], kpi=p["kpi"]))
        s.flush()
        for pid, p in d["patients"].items():
            s.bulk_insert_mappings(db.Reading, [
                dict(pid=pid, k=k, cgm=p["cgm"][k], steps=p["steps"][k], hr=p["hr"][k], sleep=int(p["sleep"][k]))
                for k in range(len(p["cgm"]))])
            s.bulk_insert_mappings(db.Meal, [dict(pid=pid, **m) for m in p["meals"]])
            s.bulk_insert_mappings(db.Medication, [dict(pid=pid, **m) for m in p["meds"]])
            s.bulk_insert_mappings(db.Night, [dict(pid=pid, day=n["day"], date=n["date"], sleep_hours=n["sleep_hours"],
                                                   deep_pct=n["deep_pct"], bedtime=n["bedtime"], hrv_rmssd=n["hrv_rmssd"],
                                                   post_dinner_walk=bool(n["post_dinner_walk"])) for n in p["nights"]])
            pr, tw = p["pred"], p["twin"]
            s.bulk_insert_mappings(db.Prediction, [
                dict(pid=pid, k=k, prob=pr["prob"][i], p2h=pr["p2h"][i], alert=bool(pr["alert"][i]),
                     episode_start=bool(pr["start"][i]), reasons=pr["why"].get(str(k)),
                     state=tw["states"][i], su=tw["su"][i]) for i, k in enumerate(pr["k"])])
            s.add(db.Twin(pid=pid, params=tw["params"], prior=tw["prior"], fit_rmse=tw["fit_rmse"], pct=tw["pct"],
                          si_mult=tw["si_mult"], gb_shift=tw["gb_shift"], habit_carbs=tw["habit_carbs"],
                          habit_gi=tw["habit_gi"], habit_rate=tw["habit_rate"], steps_prof=tw["steps_prof"],
                          inferred=tw["inferred"]))
    print(f"[seed] loaded {len(d['patients'])} patients into {db.backend_name()} in {time.time() - t0:.1f}s")

