"""Step 3: train the hybrid model, run ablations + learning curve, save models, metrics and figures."""
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import lightgbm as lgb
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import roc_auc_score, roc_curve

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from chaya.model import (split_patients, evaluate, eligible, train_classifier, FEATURE_SETS, FULL,  # noqa
                             LGB_REG)
from chaya.explain import explain, global_importance  # noqa

D, M, R = ROOT / "data", ROOT / "models", ROOT / "reports"
FIG = R / "figures"
FIG.mkdir(parents=True, exist_ok=True)
INK, MUTED, ACCENT, ACCENT2, GRID = "#18225a", "#8d93ad", "#6a44c9", "#276f45", "#e3e8de"
plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False, "axes.spines.right": False,
                     "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED, "ytick.color": MUTED,
                     "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.8})

feats = pd.read_parquet(D / "features.parquet")
ehr = pd.read_csv(D / "ehr/patients.csv")
train_p, test_p = split_patients(ehr)
tr_df, te_df = feats[feats.pid.isin(train_p)], feats[feats.pid.isin(test_p)]
summary, models, reg, ter = evaluate(tr_df, te_df, R)

# ---- learning curve: how much does the twin help when training data is scarce? --------------
rng = np.random.default_rng(11)
tr_el, te_el = eligible(tr_df), eligible(te_df)
lc = []
for n in [5, 10, 20, 40, 70, 105]:
    for rep in range(3 if n < 105 else 1):
        sel = rng.choice(train_p, n, replace=False)
        sub = tr_el[tr_el.pid.isin(sel)]
        for name in ["Fusion: EHR + wearables", FULL]:
            cols = FEATURE_SETS[name]
            m = train_classifier(sub, cols, 300)
            lc.append(dict(n_patients=n, rep=rep, model=name, auroc=roc_auc_score(te_el.y_spike, m.predict(te_el[cols]))))
lc = pd.DataFrame(lc).groupby(["n_patients", "model"]).auroc.mean().unstack()
summary["learning_curve_auroc"] = {int(k): v for k, v in lc.to_dict("index").items()}
summary["twin_only_auroc_zero_training"] = summary["classification"]["Twin physics only (no ML)"]["auroc"]

# ---- twin calibration validity vs hidden ground truth --------------------------------------------
twins = pickle.load(open(M / "_cache/twins_full.pkl", "rb"))
truth = pd.read_csv(D / "_ground_truth/latent_physiology.csv").set_index("pid")
cal = pd.DataFrame([dict(pid=p, Gb=a["params"][0], SI=a["params"][2], gamma=a["params"][3],
                         prior_Gb=a["prior"][0], prior_SI=a["prior"][2], prior_gamma=a["prior"][3], fit_rmse=a["fit_rmse"])
                    for p, a in twins.items()]).set_index("pid").join(truth)
summary["twin_calibration"] = {
    k: dict(r_calibrated=float(np.corrcoef(cal[k], cal[t])[0, 1]), r_ehr_prior=float(np.corrcoef(cal["prior_" + k], cal[t])[0, 1]))
    for k, t in [("Gb", "true_Gb"), ("SI", "true_SI"), ("gamma", "true_gamma")]}
summary["twin_calibration"]["median_fit_rmse_mgdl"] = float(cal.fit_rmse.median())

# ---- explanations + importance -------------------------------------------------------------------
m_full, cols_full, thr = models[FULL]
summary["driver_importance"] = global_importance(m_full, te_el.sample(4000, random_state=1), cols_full)
(R / "metrics.json").write_text(json.dumps(summary, indent=2, default=float))
m_full.save_model(str(M / "spike_classifier.txt"))
reg.save_model(str(M / "glucose_2h_regressor.txt"))
json.dump(dict(features=cols_full, threshold=thr), open(M / "model_config.json", "w"), indent=2)

te_obs = te_df[te_df.observed].copy()
te_obs["prob"] = m_full.predict(te_obs[cols_full])
te_obs["pred_2h"] = reg.predict(te_obs[cols_full])
te_obs["alert"] = (te_obs.prob >= thr) & (te_obs.cgm_now < 180)
ex = explain(m_full, te_obs, cols_full)
te_obs["why"] = [json.dumps(e) for e in ex]
te_obs[["pid", "k", "ts", "cgm_now", "prob", "pred_2h", "alert", "why", "y_spike", "y_cgm_2h"]].to_parquet(
    R / "test_predictions.parquet", index=False)

# ---- figures --------------------------------------------------------------------------------------
cls = summary["classification"]
names = ["Trend extrapolation (CGM only)", "EHR only (static)", "Twin physics only (no ML)",
         "Wearables only (dynamic)", "Fusion: EHR + wearables", FULL]
fig, ax = plt.subplots(figsize=(8, 4.2))
vals = [cls[n]["auroc"] for n in names]
cols_ = [MUTED] * 5 + [ACCENT]
ax.barh(range(len(names)), vals, color=cols_, height=0.6)
for i, v in enumerate(vals):
    ax.text(v + 0.005, i, f"{v:.3f}", va="center", color=INK, fontsize=11, fontweight="bold" if i == 5 else None)
ax.set_yticks(range(len(names)), [n.replace("Chaya: ", "Chaya:\n") for n in names], fontsize=10)
ax.set_xlim(0.5, 1.0); ax.set_xlabel("AUROC — 2-hour spike (>180 mg/dL) prediction, held-out patients")
ax.grid(axis="y", visible=False)
plt.tight_layout(); plt.savefig(FIG / "ablation_auroc.png", dpi=200); plt.close()

fig, ax = plt.subplots(figsize=(6, 4))
for name, col, lab in [("Fusion: EHR + wearables", MUTED, "ML fusion without twin"), (FULL, ACCENT, "Chaya (with twin)")]:
    ax.plot(lc.index, lc[name], "o-", color=col, lw=2.5, label=lab)
ax.axhline(summary["twin_only_auroc_zero_training"], ls="--", color=ACCENT2, lw=1.5)
ax.text(lc.index.min(), summary["twin_only_auroc_zero_training"] + 0.004, "twin physics alone — zero training data", ha="left", color=ACCENT2, fontsize=9)
ax.set_xscale("log"); ax.set_xticks(lc.index, [str(i) for i in lc.index])
ax.set_xlabel("Training patients"); ax.set_ylabel("AUROC (held-out)"); ax.legend(frameon=False, loc="center right")
plt.tight_layout(); plt.savefig(FIG / "learning_curve.png", dpi=200); plt.close()

fig, axs = plt.subplots(1, 3, figsize=(11, 3.6))
for ax, (k, t, lab, sc) in zip(axs, [("Gb", "true_Gb", "Basal glucose (mg/dL)", 1), ("SI", "true_SI", "Insulin sensitivity (×10⁻⁴)", 1e4),
                                    ("gamma", "true_gamma", "β-cell response (×10⁻³)", 1e3)]):
    ax.scatter(cal[t] * sc, cal["prior_" + k] * sc, s=14, color=MUTED, alpha=0.6, label=f"EHR prior r={summary['twin_calibration'][k]['r_ehr_prior']:.2f}")
    ax.scatter(cal[t] * sc, cal[k] * sc, s=14, color=ACCENT, alpha=0.8, label=f"Calibrated twin r={summary['twin_calibration'][k]['r_calibrated']:.2f}")
    lo, hi = (cal[t] * sc).min(), (cal[t] * sc).max()
    ax.plot([lo, hi], [lo, hi], color=INK, lw=0.8)
    ax.set_title(lab, fontsize=10, color=INK); ax.set_xlabel("true (hidden)"); ax.legend(frameon=False, fontsize=8)
axs[0].set_ylabel("estimated")
plt.tight_layout(); plt.savefig(FIG / "twin_calibration.png", dpi=200); plt.close()

imp = summary["driver_importance"]
fig, ax = plt.subplots(figsize=(6.5, 4))
ks = list(imp)[::-1]
ax.barh(ks, [imp[k] * 100 for k in ks], color=[ACCENT if "Twin" in k or "Unlogged" in k else INK for k in ks], height=0.6)
ax.set_xlabel("Share of prediction impact (mean |SHAP|, %)"); ax.grid(axis="y", visible=False)
plt.tight_layout(); plt.savefig(FIG / "driver_importance.png", dpi=200); plt.close()

fig, ax = plt.subplots(figsize=(5, 4.4))
y = te_el.y_spike
for name, col in [("Trend extrapolation (CGM only)", MUTED), ("Fusion: EHR + wearables", INK), (FULL, ACCENT)]:
    if name.startswith("Trend"):
        s = te_el.cgm_now + 4 * te_el.d30.clip(lower=0)
    else:
        s = models[name][0].predict(te_el[models[name][1]])
    fpr, tpr, _ = roc_curve(y, s)
    ax.plot(fpr, tpr, color=col, lw=2.2, label=f"{name.split(':')[0]} ({roc_auc_score(y, s):.3f})")
ax.plot([0, 1], [0, 1], color=GRID, lw=1)
ax.set_xlabel("False-positive rate"); ax.set_ylabel("Sensitivity"); ax.legend(frameon=False, fontsize=8, loc="lower right")
plt.tight_layout(); plt.savefig(FIG / "roc.png", dpi=200); plt.close()

print(json.dumps({k: summary[k] for k in ["classification", "regression", "learning_curve_auroc", "twin_calibration"]}, indent=1, default=float))
