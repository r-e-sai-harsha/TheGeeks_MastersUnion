"""
Data fusion: turn (static EHR) + (dynamic wearable streams) + (twin state & forecasts) into one
feature vector per decision point (every 15 minutes).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import twin as tw
from .cohort import START_DATE, N_DAYS

HORIZON = 120          # minutes
SPIKE = 180.0          # mg/dL
EVAL_FROM_DAY = tw.CAL_DAYS

EHR_FEATURES = ["age", "sex_m", "bmi", "waist_cm", "hba1c_pct", "fasting_glucose_mgdl", "diabetes_years",
                "tcf7l2_risk_alleles", "family_history_t2d", "on_metformin", "on_sulfonylurea", "on_dpp4",
                "on_sglt2", "on_basal_insulin", "nafld", "hypertension", "egfr", "triglycerides_mgdl"]
WEAR_FEATURES = ["cgm_now", "d15", "d30", "d60", "cgm_mean_2h", "cgm_sd_2h", "cgm_mean_24h", "tod_sin", "tod_cos",
                 "weekend", "min_since_logged_meal", "carbs_logged_2h", "carbs_logged_30m", "gi_last_meal",
                 "steps_30m", "steps_60m", "hr_now", "hr_mean_60m", "sleep_h_last", "deep_pct_last",
                 "hrv_last", "hrv_z", "metformin_missed_today", "p_meal_2h", "exp_carbs_2h"]
TWIN_FEATURES = ["twin_max_nomeal", "twin_end_nomeal", "twin_max_routine", "twin_end_routine",
                 "twin_inferred_carbs_2h", "twin_insulin_action", "twin_gut_glucose", "twin_SI", "twin_gamma",
                 "twin_Gb", "twin_fit_rmse"]


def patient_features(pid, ehr_row, stream, meals, meds, nights):
    """Calibrate the twin for one patient and build decision-point features for days 7-13."""
    stream = stream.reset_index(drop=True)
    cgm = stream["cgm_mgdl"].to_numpy(float)
    inp = tw.build_inputs(pid, N_DAYS, ehr_row, stream, meals, meds, nights, START_DATE)
    prior = tw.ehr_prior(ehr_row)
    params, fit_rmse = tw.calibrate(prior, inp, cgm)
    states, inferred = tw.observe(params, inp, cgm)
    habit = tw.habit_model(meals, START_DATE)
    sprof = tw.steps_profile(stream)

    cgm_ff = pd.Series(cgm).ffill().bfill().to_numpy()
    steps = stream["steps"].to_numpy(float)
    hr = stream["heart_rate"].to_numpy(float)
    meal_idx = ((meals.ts - START_DATE).dt.total_seconds() // 300).astype(int).to_numpy()
    meal_carbs = meals.carbs_g.to_numpy(float); meal_gi = meals.gi.to_numpy(float)
    nights = nights.set_index("day")
    hrv_base = nights.loc[: tw.CAL_DAYS - 1, "hrv_rmssd"].mean()
    hrv_sd = max(nights.loc[: tw.CAL_DAYS - 1, "hrv_rmssd"].std(), 2.0)
    met_taken = {}
    if ehr_row["on_metformin"]:
        mt = meds[meds.drug.str.startswith("Metformin")]
        for t in mt.ts:
            met_taken.setdefault((t - START_DATE).days, []).append(int((t - START_DATE).total_seconds() // 300))

    rows = []
    n5 = len(cgm)
    H = HORIZON // 5
    for k in range(EVAL_FROM_DAY * 288, n5 - H, 3):
        day = k // 288
        mod = (k % 288) * 5
        now = cgm[k]
        observed = now == now
        fut = cgm[k + 1: k + H + 1]
        valid_f = ~np.isnan(fut)
        past_meals = meal_idx <= k
        last_meal = np.where(past_meals)[0]
        lm = last_meal[np.argmax(meal_idx[last_meal])] if len(last_meal) else None
        recent2h = past_meals & (meal_idx > k - 24)
        recent30 = past_meals & (meal_idx > k - 6)
        # routine & twin forecasts
        s_min, meal_r, kab_r = tw.routine_inputs(habit, sprof, mod + 5, HORIZON, True)
        z = np.zeros(HORIZON)
        si_now = inp["si_mult"][min(k * 5, len(inp["si_mult"]) - 1)]
        gbs = inp["gb_shift"][k * 5]
        su_lvl = inp["su"][k * 5]
        st = states[k].copy()
        f_nomeal = tw.forecast(params, st, mod + 5, HORIZON, s_min, z, kab_r, si_now, gbs, su_lvl)
        f_rout = tw.forecast(params, st, mod + 5, HORIZON, s_min, meal_r, kab_r, si_now, gbs, su_lvl)
        bins = ((mod + 5 + np.arange(0, HORIZON, 5)) % 1440) // 5
        last_night = nights.loc[day] if day in nights.index else None
        missed = 0
        if ehr_row["on_metformin"]:
            taken = [x for x in met_taken.get(day, []) if x <= k]
            missed = max(0, (1 if mod > 11 * 60 else 0) - len(taken))
        rows.append(dict(
            pid=pid, k=k, ts=START_DATE + pd.Timedelta(minutes=5 * k), day=day, observed=observed,
            cgm_now=cgm_ff[k], d15=cgm_ff[k] - cgm_ff[k - 3], d30=cgm_ff[k] - cgm_ff[k - 6],
            d60=cgm_ff[k] - cgm_ff[k - 12], cgm_mean_2h=np.nanmean(cgm[k - 23:k + 1]),
            cgm_sd_2h=np.nanstd(cgm[k - 23:k + 1]), cgm_mean_24h=np.nanmean(cgm[k - 287:k + 1]),
            tod_sin=np.sin(2 * np.pi * mod / 1440), tod_cos=np.cos(2 * np.pi * mod / 1440),
            weekend=int((START_DATE + pd.Timedelta(days=day)).dayofweek >= 5),
            min_since_logged_meal=(k - meal_idx[lm]) * 5 if lm is not None else 1440,
            carbs_logged_2h=meal_carbs[recent2h].sum(), carbs_logged_30m=meal_carbs[recent30].sum(),
            gi_last_meal=meal_gi[lm] if lm is not None else 0,
            steps_30m=steps[k - 5:k + 1].sum(), steps_60m=steps[k - 11:k + 1].sum(),
            hr_now=hr[k], hr_mean_60m=hr[k - 11:k + 1].mean(),
            sleep_h_last=last_night.sleep_hours if last_night is not None else 7,
            deep_pct_last=last_night.deep_pct if last_night is not None else 15,
            hrv_last=last_night.hrv_rmssd if last_night is not None else hrv_base,
            hrv_z=((last_night.hrv_rmssd if last_night is not None else hrv_base) - hrv_base) / hrv_sd,
            metformin_missed_today=missed,
            p_meal_2h=float(min(habit["rate"][bins].sum(), 1.5)), exp_carbs_2h=float(habit["carbs"][bins].sum()),
            twin_max_nomeal=f_nomeal.max(), twin_end_nomeal=f_nomeal[-1],
            twin_max_routine=f_rout.max(), twin_end_routine=f_rout[-1],
            twin_inferred_carbs_2h=inferred[k - 23:k + 1].sum(), twin_insulin_action=st[1] * 1000,
            twin_gut_glucose=st[3] + st[4],
            twin_SI=params[2] * 1e4, twin_gamma=params[3] * 1e3, twin_Gb=params[0], twin_fit_rmse=fit_rmse,
            # targets
            y_max_2h=np.nanmax(fut) if valid_f.mean() > 0.5 else np.nan,
            y_cgm_2h=cgm[k + H],
        ))
    df = pd.DataFrame(rows)
    df["y_spike"] = (df["y_max_2h"] > SPIKE).astype(float)
    df.loc[df["y_max_2h"].isna(), "y_spike"] = np.nan
    # static EHR features
    df["age"] = ehr_row["age"]; df["sex_m"] = int(ehr_row["sex"] == "M")
    for c in ["bmi", "waist_cm", "hba1c_pct", "fasting_glucose_mgdl", "diabetes_years", "egfr", "triglycerides_mgdl"]:
        df[c] = ehr_row[c]
    for c in ["family_history_t2d", "on_metformin", "on_sulfonylurea", "on_dpp4", "on_sglt2", "on_basal_insulin",
              "nafld", "hypertension"]:
        df[c] = int(bool(ehr_row[c]))
    df["tcf7l2_risk_alleles"] = ehr_row["tcf7l2_rs7903146"].count("T")
    twin_art = dict(params=params, prior=prior, fit_rmse=fit_rmse, states=states, inferred=inferred,
                    habit=habit, steps_profile=sprof, inputs=inp)
    return df, twin_art
