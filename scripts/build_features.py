"""Step 2: calibrate one digital twin per patient and build fused decision-point features."""
import pickle
import sys
from multiprocessing import Pool
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from chaya.features import patient_features  # noqa: E402

D = ROOT / "data"


def _load():
    ehr = pd.read_csv(D / "ehr/patients.csv").set_index("pid")
    w = pd.read_parquet(D / "wearables/stream_5min.parquet")
    meals = pd.read_csv(D / "wearables/meal_log.csv", parse_dates=["ts"])
    meds = pd.read_csv(D / "wearables/medication_log.csv", parse_dates=["ts"])
    nights = pd.read_csv(D / "wearables/sleep_nightly.csv")
    return ehr, w, meals, meds, nights


def _one(pid):
    ehr, w, meals, meds, nights = DATA
    return pid, patient_features(pid, ehr.loc[pid], w[w.pid == pid], meals[meals.pid == pid],
                                 meds[meds.pid == pid], nights[nights.pid == pid])


DATA = _load()

if __name__ == "__main__":
    pids = list(DATA[0].index)
    with Pool() as pool:
        res = pool.map(_one, pids)
    feats = pd.concat([r[1][0] for r in res], ignore_index=True)
    twins = {pid: art for pid, (_, art) in res}
    (ROOT / "models").mkdir(exist_ok=True)
    feats.to_parquet(D / "features.parquet", index=False)
    (ROOT / "models/_cache").mkdir(parents=True, exist_ok=True)
    with open(ROOT / "models/_cache/twins_full.pkl", "wb") as f:   # large (state trajectories); not committed
        pickle.dump(twins, f)
    names = ["Gb", "Sg", "SI", "gamma", "Ib", "Vg", "f", "dawn", "kEx"]
    pd.DataFrame([dict(pid=p, fit_rmse=a["fit_rmse"], **{f"twin_{n}": v for n, v in zip(names, a["params"])},
                       **{f"prior_{n}": v for n, v in zip(names, a["prior"])}) for p, a in twins.items()]
                 ).to_csv(ROOT / "models/twin_parameters.csv", index=False)
    print(f"features: {feats.shape}  twins: {len(twins)}")
