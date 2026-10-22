"""
Training and evaluation: 2-hour-ahead glucose spike prediction (>180 mg/dL) and 2-hour glucose forecast.

Evaluation protocol (no leakage)
- Patient-level split: 70% train / 30% held-out test patients (stratified by condition).
- Temporal split inside every patient: days 1-7 calibrate the twin + learn habits, days 8-14
  generate decision points. Test patients' days 8-14 are never seen during training.
- Prediction population: decision points where current CGM < 180 (we predict *onset* of a spike).
"""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
import lightgbm as lgb
from sklearn.metrics import roc_auc_score, average_precision_score, mean_absolute_error

from .features import EHR_FEATURES, WEAR_FEATURES, TWIN_FEATURES, SPIKE

LGB_CLS = dict(objective="binary", learning_rate=0.04, num_leaves=31, min_data_in_leaf=60,
               feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1, lambda_l2=2.0, verbose=-1, seed=7)
LGB_REG = dict(LGB_CLS, objective="regression_l1")

FEATURE_SETS = {
    "EHR only (static)": EHR_FEATURES + ["tod_sin", "tod_cos"],
    "Wearables only (dynamic)": WEAR_FEATURES,
    "Fusion: EHR + wearables": EHR_FEATURES + WEAR_FEATURES,
    "Chaya: fusion + digital twin": EHR_FEATURES + WEAR_FEATURES + TWIN_FEATURES,
}
FULL = "Chaya: fusion + digital twin"


def split_patients(ehr: pd.DataFrame, seed=7, test_frac=0.3):
    rng = np.random.default_rng(seed)
    test = []
    for _, g in ehr.groupby("condition"):
        ids = g.pid.to_numpy().copy(); rng.shuffle(ids)
        test += list(ids[: int(round(len(ids) * test_frac))])
    return sorted(set(ehr.pid) - set(test)), sorted(test)


def eligible(df):
    return df[(df.cgm_now < SPIKE) & df.y_spike.notna() & df.observed]


def train_classifier(tr, cols, rounds=500):
    return lgb.train(LGB_CLS, lgb.Dataset(tr[cols], tr.y_spike), rounds)


def pick_threshold(tr, cols, target_sens=0.80, folds=5, seed=7):
    """Alert threshold from patient-grouped out-of-fold predictions on TRAINING patients only."""
    pids = np.array(tr.pid.unique(), dtype=object); np.random.default_rng(seed).shuffle(pids)
    oof = np.zeros(len(tr))
    for f in range(folds):
        hold = tr.pid.isin(pids[f::folds]).to_numpy()
        m = train_classifier(tr[~hold], cols, 300)
        oof[hold] = m.predict(tr.loc[hold, cols])
    pos = np.sort(oof[tr.y_spike.to_numpy() == 1])
    return float(pos[int((1 - target_sens) * len(pos))])


def alert_episodes(df, alert):
    """Count alert episodes (consecutive 15-min alerts collapse into one notification)."""
    n = 0
    for _, g in df.assign(a=alert).sort_values(["pid", "k"]).groupby("pid"):
        a = g.a.to_numpy(); k = g.k.to_numpy()
        starts = a & ~np.r_[False, a[:-1] & (np.diff(k) <= 3)]
        n += int(starts.sum())
    return n


def lead_times(df, prob, thr):
    """For each spike onset in the test data, earliest alert within the preceding 2 h.
    `df` must contain ALL observed decision points (including those already >180)."""
    out = []
    for pid, g in df.assign(prob=prob).groupby("pid"):
        g = g.sort_values("k")
        k = g.k.to_numpy(); c = g.cgm_now.to_numpy(); pr = g.prob.to_numpy(); ymax = g.y_max_2h.to_numpy()
        # onsets: decision points where cgm crosses up through 180 (every 15 min grid)
        for i in range(2, len(g)):
            if c[i] >= SPIKE and c[i - 1] < SPIKE and c[i - 2] < SPIKE:
                win = (k < k[i]) & (k >= k[i] - 24)
                cand = np.where(win & (pr >= thr) & (c < SPIKE))[0]
                lead = (k[i] - k[cand].min()) * 5 if len(cand) else 0
                out.append(dict(pid=pid, k=int(k[i]), detected=len(cand) > 0 and lead >= 15, detected60=lead >= 60, lead_min=lead))
    return pd.DataFrame(out)


def clarke_zone(ref, pred):
    """Clarke error grid zone for each pair (A..E)."""
    z = []
    for r, p in zip(ref, pred):
        if (r <= 70 and p <= 70) or (0.8 * r <= p <= 1.2 * r):
            z.append("A")
        elif (r >= 180 and p <= 70) or (r <= 70 and p >= 180):
            z.append("E")
        elif ((70 <= r <= 290) and p >= r + 110) or ((130 <= r <= 180) and p <= (7 / 5) * r - 182):
            z.append("C")
        elif (r >= 240 and 70 <= p <= 180) or (r <= 175 / 3 and 70 <= p <= 180) or ((175 / 3 <= r <= 70) and p >= (6 / 5) * r):
            z.append("D")
        else:
            z.append("B")
    return np.array(z)


def evaluate(train_df, test_df, out_dir):
    tr, te = eligible(train_df), eligible(test_df)
    results, models = {}, {}
    # --- baselines -----------------------------------------------------------------
    trend = te.cgm_now + 4 * te.d30.clip(lower=0)
    results["Trend extrapolation (CGM only)"] = dict(auroc=roc_auc_score(te.y_spike, trend),
                                                    auprc=average_precision_score(te.y_spike, trend))
    results["Twin physics only (no ML)"] = dict(auroc=roc_auc_score(te.y_spike, te.twin_max_routine),
                                               auprc=average_precision_score(te.y_spike, te.twin_max_routine))
    # --- learned models ------------------------------------------------------------
    te_all = test_df[test_df.observed]
    for name, cols in FEATURE_SETS.items():
        m = train_classifier(tr, cols)
        p = m.predict(te[cols])
        thr = pick_threshold(tr, cols)
        lt = lead_times(te_all, m.predict(te_all[cols]), thr)
        alert = p >= thr
        results[name] = dict(
            auroc=roc_auc_score(te.y_spike, p), auprc=average_precision_score(te.y_spike, p),
            threshold=thr, sensitivity=float(alert[te.y_spike == 1].mean()),
            precision=float(te.y_spike[alert].mean()) if alert.any() else 0.0,
            specificity=float((~alert[te.y_spike == 0]).mean()),
            event_detection=float(lt.detected.mean()) if len(lt) else np.nan,
            event_detection_60min=float(lt.detected60.mean()) if len(lt) else np.nan,
            median_lead_min=float(lt[lt.detected].lead_min.median()) if len(lt) else np.nan,
            n_onsets=int(len(lt)),
            alerts_per_patient_day=float(alert_episodes(te, alert) / (te.pid.nunique() * 7)))
        models[name] = (m, cols, thr)
    # --- 2 h glucose forecast (regression) -----------------------------------------
    trr = train_df[train_df.y_cgm_2h.notna() & train_df.observed]
    ter = test_df[test_df.y_cgm_2h.notna() & test_df.observed]
    cols = FEATURE_SETS[FULL]
    reg = lgb.train(LGB_REG, lgb.Dataset(trr[cols], trr.y_cgm_2h), 600)
    c_nt = FEATURE_SETS["Fusion: EHR + wearables"]
    reg_nt = lgb.train(LGB_REG, lgb.Dataset(trr[c_nt], trr.y_cgm_2h), 600)
    preds = {"Persistence (last CGM)": ter.cgm_now.to_numpy(),
             "Twin physics only": ter.twin_end_routine.to_numpy(),
             "ML fusion, no twin": reg_nt.predict(ter[c_nt]),
             "Chaya hybrid": reg.predict(ter[cols])}
    y = ter.y_cgm_2h.to_numpy()
    reg_res = {}
    for n, pr in preds.items():
        z = clarke_zone(y, pr)
        reg_res[n] = dict(rmse=float(np.sqrt(np.mean((y - pr) ** 2))), mae=float(mean_absolute_error(y, pr)),
                          mard_pct=float(np.mean(np.abs(y - pr) / y) * 100),
                          clarke_A_pct=float((z == "A").mean() * 100), clarke_AB_pct=float(np.isin(z, ["A", "B"]).mean() * 100))
    summary = dict(classification=results, regression=reg_res,
                   n_train_patients=int(train_df.pid.nunique()), n_test_patients=int(test_df.pid.nunique()),
                   n_train_points=int(len(tr)), n_test_points=int(len(te)),
                   test_spike_prevalence=float(te.y_spike.mean()))
    (out_dir / "metrics.json").write_text(json.dumps(summary, indent=2, default=float))
    return summary, models, reg, ter.assign(pred_2h=preds["Chaya hybrid"])
