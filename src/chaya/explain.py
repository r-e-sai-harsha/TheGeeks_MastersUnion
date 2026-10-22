"""Clinician-readable explanations from LightGBM SHAP contributions (pred_contrib)."""
from __future__ import annotations

import numpy as np

GROUPS = {
    "Glucose trend": ["cgm_now", "d15", "d30", "d60", "cgm_mean_2h", "cgm_sd_2h"],
    "Recent meal": ["min_since_logged_meal", "carbs_logged_2h", "carbs_logged_30m", "gi_last_meal"],
    "Usual meal coming up": ["p_meal_2h", "exp_carbs_2h", "tod_sin", "tod_cos", "weekend"],
    "Twin forecast": ["twin_max_routine", "twin_max_nomeal", "twin_end_routine", "twin_end_nomeal",
                      "twin_gut_glucose", "twin_insulin_action"],
    "Unlogged meal detected": ["twin_inferred_carbs_2h"],
    "Sleep & recovery": ["sleep_h_last", "deep_pct_last", "hrv_last", "hrv_z"],
    "Activity": ["steps_30m", "steps_60m", "hr_now", "hr_mean_60m"],
    "Medication": ["metformin_missed_today", "on_metformin", "on_sulfonylurea", "on_dpp4", "on_sglt2",
                   "on_basal_insulin"],
    "Patient physiology": ["twin_SI", "twin_gamma", "twin_Gb", "twin_fit_rmse", "hba1c_pct",
                           "fasting_glucose_mgdl", "bmi", "waist_cm", "diabetes_years", "tcf7l2_risk_alleles",
                           "age", "sex_m", "nafld", "hypertension", "egfr", "triglycerides_mgdl",
                           "family_history_t2d", "cgm_mean_24h"],
}


def _sentence(group, r):
    if group == "Glucose trend":
        return f"Glucose {r['cgm_now']:.0f} mg/dL, {r['d30']:+.0f} in last 30 min"
    if group == "Recent meal":
        if r["carbs_logged_2h"] > 0:
            return f"{r['carbs_logged_2h']:.0f} g carbs logged {r['min_since_logged_meal']:.0f} min ago (GI {r['gi_last_meal']:.0f})"
        return f"No meal logged in last 2 h"
    if group == "Usual meal coming up":
        return f"Routine: usually eats ~{r['exp_carbs_2h']:.0f} g carbs in the next 2 h"
    if group == "Twin forecast":
        return f"Twin projects a peak of {r['twin_max_routine']:.0f} mg/dL"
    if group == "Unlogged meal detected":
        return f"Twin detected ~{r['twin_inferred_carbs_2h']:.0f} g of unlogged carbs"
    if group == "Sleep & recovery":
        return f"Slept {r['sleep_h_last']:.1f} h; HRV {r['hrv_z']:+.1f} SD vs baseline"
    if group == "Activity":
        return f"{r['steps_60m']:.0f} steps in the last hour"
    if group == "Medication":
        return "Missed metformin dose today" if r["metformin_missed_today"] > 0 else "Medication profile"
    if group == "Patient physiology":
        return f"Insulin sensitivity {r['twin_SI']:.1f} (twin) · HbA1c {r['hba1c_pct']:.1f}%"
    return group


def explain(model, X, cols, top=3):
    """Return per-row list of (group, contribution in log-odds, sentence) sorted by impact."""
    contrib = model.predict(X[cols], pred_contrib=True)[:, :-1]
    idx = {c: i for i, c in enumerate(cols)}
    out = []
    for row_i in range(len(X)):
        r = X.iloc[row_i]
        g = []
        for name, feats in GROUPS.items():
            v = sum(contrib[row_i, idx[f]] for f in feats if f in idx)
            g.append((name, float(v)))
        g.sort(key=lambda t: -t[1])
        out.append([dict(group=n, logodds=round(v, 3), text=_sentence(n, r)) for n, v in g[:top] if v > 0.05])
    return out


def global_importance(model, X, cols):
    contrib = np.abs(model.predict(X[cols], pred_contrib=True)[:, :-1]).mean(0)
    idx = {c: i for i, c in enumerate(cols)}
    res = {n: float(sum(contrib[idx[f]] for f in feats if f in idx)) for n, feats in GROUPS.items()}
    tot = sum(res.values())
    return {k: v / tot for k, v in sorted(res.items(), key=lambda t: -t[1])}
