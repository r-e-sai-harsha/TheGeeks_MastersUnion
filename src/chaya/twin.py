"""
The Digital Twin: a per-patient calibrated physiological model.

1. Prior     – EHR (BMI, waist, HbA1c, fasting glucose, diabetes duration, TCF7L2, meds) gives a
               population-informed starting point for each patient's physiology.
2. Calibrate – the model is fitted to the patient's first 7 days of CGM + logged meals + steps
               + sleep + medication logs (MAP estimation, robust loss).
3. Observe   – during deployment the twin runs alongside live CGM, correcting its state and
               detecting unlogged meals.
4. Forecast  – from the current state it simulates the next 2 h under the patient's learned
               routine (habit model) — and under any "what-if" scenario a clinician enters.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from numba import njit
from scipy.optimize import minimize

from .physiology import (N_PARAMS, P_GB, P_SG, P_SI, P_GAMMA, P_IB, P_VG, P_F, P_DAWN, P_KEX,
                         simulate, simulate_observer, GI_TO_KABS, P2, N_CLEAR, TAU_E, K_E, _dawn)

CAL_DAYS = 7
SLEEP_SI_COEF = 0.07   # literature prior: ~20% lower insulin sensitivity after one ~4 h night
MISSED_MET_SHIFT = 7.0
FIT_KEYS = [P_GB, P_SI, P_GAMMA, P_F, P_DAWN]


# ----------------------------------------------------------------------------- inputs
def build_inputs(pid, n_days, ehr_row, stream, meals, meds, nights, start):
    """Minute-level model inputs from what the twin can actually observe."""
    T = n_days * 1440
    meal_mg = np.zeros(T); kabs = np.full(T, 0.03)
    for r in meals.itertuples():
        m = int((r.ts - start).total_seconds() // 60)
        if 0 <= m < T:
            meal_mg[m:m + 15] += r.carbs_g * 1000 / 15
            kabs[m:m + 300] = GI_TO_KABS(r.gi)
    steps = np.repeat(stream["steps"].to_numpy(float) / 5.0, 5)[:T]
    si_mult = np.ones(T); gb_shift = np.zeros(T); su = np.zeros(T)
    sl = nights.set_index("day")["sleep_hours"].to_dict()
    for d in range(n_days):
        debt = max(0.0, 7.0 - sl.get(d, 7.0)) + 0.5 * max(0.0, 7.0 - sl.get(d - 1, 7.0))
        si_mult[d * 1440 + 6 * 60: (d + 1) * 1440 + 6 * 60] = max(0.6, 1 - SLEEP_SI_COEF * debt)
    if ehr_row["on_metformin"]:
        for d in range(n_days):
            day_start = start + pd.Timedelta(days=d)
            n_taken = ((meds.drug.str.startswith("Metformin")) & (meds.ts >= day_start) &
                       (meds.ts < day_start + pd.Timedelta(days=1))).sum()
            gb_shift[d * 1440:(d + 1) * 1440] = MISSED_MET_SHIFT * max(0, 2 - n_taken)
    prof = 1.6 * np.exp(-np.arange(1440) / 600.0) * (1 - np.exp(-np.arange(1440) / 60.0))
    for r in meds[meds.drug.str.startswith("Glimepiride")].itertuples():
        m = int((r.ts - start).total_seconds() // 60)
        if 0 <= m < T:
            su[m:m + 1440] += prof[: min(1440, T - m)]
    return dict(meal_mg=meal_mg, kabs=kabs, steps=steps, si_mult=si_mult, gb_shift=gb_shift, su=su)


def ehr_prior(row) -> np.ndarray:
    """Population-informed prior physiology from static EHR."""
    p = np.zeros(N_PARAMS)
    years = row["diabetes_years"]
    p[P_GB] = np.clip(0.75 * row["fasting_glucose_mgdl"] + 8, 90, 230)
    si = 4.2e-4 * np.exp(-0.055 * (row["bmi"] - 22)) * np.exp(-0.012 * (row["waist_cm"] - 85))
    si *= np.exp(-0.18 * (row["hba1c_pct"] - 6.5)) * (0.85 if row["nafld"] else 1.0)
    p[P_SI] = np.clip(si, 0.6e-4, 8e-4)
    g = 0.0085 * np.exp(-0.08 * years) * {"TT": 0.8, "CT": 0.9}.get(row["tcf7l2_rs7903146"], 1.0)
    if row["condition"] == "T2D": g *= 0.8
    if row["on_dpp4"]: g *= 1.25
    p[P_GAMMA] = np.clip(g, 0.0008, 0.014)
    p[P_SG] = 0.012
    p[P_IB] = np.clip(9 + 0.4 * (row["bmi"] - 22), 5, 22)
    p[P_VG] = 1.7 * row["weight_kg"]
    p[P_F] = 0.33
    p[P_DAWN] = 0.14 if row["condition"] == "T2D" else 0.08
    p[P_KEX] = 2.0e-5
    return p


PRIOR_SD = {P_GB: 0.12, P_SI: 0.45, P_GAMMA: 0.45, P_F: 0.2, P_DAWN: 0.6}


def calibrate(prior: np.ndarray, inp: dict, cgm5: np.ndarray, n_days: int = CAL_DAYS):
    """MAP fit of FIT_KEYS on the first n_days of data. Returns calibrated params and fit RMSE."""
    T = n_days * 1440
    sl = {k: v[:T].copy() for k, v in inp.items()}
    y = cgm5[: T // 5]
    mask = ~np.isnan(y)
    # skip first 6 h (initial transient)
    mask[:72] = False
    x0 = np.log(np.maximum([prior[k] for k in FIT_KEYS], 1e-6))

    def unpack(z):
        p = prior.copy()
        for k, v in zip(FIT_KEYS, z):
            p[k] = np.exp(v)
        return p

    def loss(z):
        p = unpack(z)
        out = simulate(p, sl["meal_mg"], sl["kabs"], sl["steps"], sl["si_mult"], sl["gb_shift"], sl["su"],
                       0, np.array([-1.0, 0, 0, 0, 0, 0]), 5)
        r = y[mask] - out[mask, 0]
        # robust: large positive residuals are probably unlogged meals -> down-weight
        w = np.where(r > 35, 0.25, 1.0)
        a = np.abs(r)
        hub = np.where(a < 20, 0.5 * r * r, 20 * (a - 10))
        pen = sum(((zv - x0v) / PRIOR_SD[k]) ** 2 for k, zv, x0v in zip(FIT_KEYS, z, x0))
        return float(np.mean(w * hub) + 2.0 * pen)

    res = minimize(loss, x0, method="Nelder-Mead", options=dict(maxiter=700, xatol=1e-3, fatol=1e-3))
    p = unpack(res.x)
    out = simulate(p, sl["meal_mg"], sl["kabs"], sl["steps"], sl["si_mult"], sl["gb_shift"], sl["su"],
                   0, np.array([-1.0, 0, 0, 0, 0, 0]), 5)
    rmse = float(np.sqrt(np.nanmean((y[mask] - out[mask, 0]) ** 2)))
    return p, rmse


def observe(params, inp, cgm5, gain=0.35, meal_gain=0.35):
    return simulate_observer(params, inp["meal_mg"], inp["kabs"], inp["steps"], inp["si_mult"],
                             inp["gb_shift"], inp["su"], 0, cgm5, gain, meal_gain)


# ----------------------------------------------------------------------------- habit model
def habit_model(meals: pd.DataFrame, start, n_days=CAL_DAYS):
    """Per 5-min-of-day: probability a meal starts in that bin, and mean carbs. Learned from history."""
    m = meals[(meals.ts >= start) & (meals.ts < start + pd.Timedelta(days=n_days))]
    bins = ((m.ts - m.ts.dt.normalize()).dt.total_seconds() // 300).astype(int).to_numpy()
    rate = np.zeros(288); carbs = np.zeros(288); gi = np.full(288, 65.0)
    for b, c, g in zip(bins, m.carbs_g.to_numpy(), m.gi.to_numpy()):
        for off, wgt in ((-2, .1), (-1, .2), (0, .4), (1, .2), (2, .1)):  # smooth +-10 min
            rate[(b + off) % 288] += wgt / n_days
            carbs[(b + off) % 288] += wgt * c / n_days
            gi[(b + off) % 288] = g
    # widen: people are +-30 min variable
    k = np.exp(-0.5 * (np.arange(-8, 9) / 4.0) ** 2); k /= k.sum()
    rate_s = np.convolve(np.r_[rate[-8:], rate, rate[:8]], k, "same")[8:-8]
    carbs_s = np.convolve(np.r_[carbs[-8:], carbs, carbs[:8]], k, "same")[8:-8]
    return dict(rate=rate_s, carbs=carbs_s, gi=gi)


def steps_profile(stream: pd.DataFrame, n_days=CAL_DAYS):
    s = stream["steps"].to_numpy(float)[: n_days * 288].reshape(n_days, 288)
    return s.mean(0) / 5.0  # steps/min per 5-min bin


# ----------------------------------------------------------------------------- forecasting
@njit(cache=True)
def forecast(params, state, start_minute, horizon, steps_min, meal_mg, kabs_min, si_mult, gb_shift, su_level):
    """Simulate `horizon` minutes from `state`. Inputs are per-minute arrays of length horizon."""
    Gb, Sg, SI, gamma, Ib, Vg, f, dawn_amp, kEx = (
        params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7], params[8])
    G, X, I, Q1, Q2, E = state[0], state[1], state[2], state[3], state[4], state[5]
    out = np.empty(horizon // 5)
    k = 0
    for t in range(horizon):
        mod = (start_minute + t) % 1440
        gbe = Gb + gb_shift
        ra = f * kabs_min[t] * Q2
        dG = -(Sg + X * (1.0 + E)) * G + Sg * gbe + ra / Vg + dawn_amp * _dawn(mod) - kEx * steps_min[t] * G
        dX = -P2 * X + P2 * SI * si_mult * (I - Ib)
        dI = -N_CLEAR * (I - Ib) + gamma * max(G - gbe, 0.0) + su_level * np.exp(-t / 600.0)
        dQ1 = -kabs_min[t] * Q1 + meal_mg[t]
        dQ2 = kabs_min[t] * (Q1 - Q2)
        dE = -E / TAU_E + K_E * steps_min[t]
        G = max(G + dG, 20.0); X = X + dX; I = max(I + dI, 0.0)
        Q1 = max(Q1 + dQ1, 0.0); Q2 = max(Q2 + dQ2, 0.0); E = max(E + dE, 0.0)
        if (t + 1) % 5 == 0:
            out[k] = G
            k += 1
    return out


def routine_inputs(habit, steps_prof, start_minute, horizon=120, expected=True):
    """Future inputs for the next `horizon` min assuming the patient follows their routine."""
    mins = (start_minute + np.arange(horizon)) % 1440
    b = mins // 5
    steps_min = steps_prof[b]
    meal = np.zeros(horizon); kab = np.full(horizon, 0.03)
    if expected:
        # expected carbs, spread as the probability-weighted routine meal
        meal = habit["carbs"][b] * 1000.0 / 5.0  # expected mg/min entering the gut
        kab = GI_TO_KABS(habit["gi"][b])
    return steps_min, meal, kab
