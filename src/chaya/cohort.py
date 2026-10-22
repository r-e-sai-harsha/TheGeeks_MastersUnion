"""
Synthetic Indian Type 2 Diabetes cohort: static EHR + dynamic wearable streams.

Design principles
- Physiology first: each patient gets latent physiology (insulin sensitivity, beta-cell
  function, basal glucose) derived from their EHR profile; CGM is *simulated* from it, then
  lab values (HbA1c, fasting glucose) are computed back from the simulated glucose so the two
  streams are mutually consistent.
- Indian context: South Asian phenotype (higher insulin resistance at lower BMI), carb-heavy
  regional meals with GI estimates, late dinners, chai, festival days, common Indian
  prescriptions (metformin, glimepiride, teneligliptin/sitagliptin, SGLT2i, basal insulin).
- Real-world messiness: patients log only some meals, miss metformin doses, sleep badly,
  CGM has sensor lag, noise and dropouts.

No real patient data is used anywhere (DPDP Act / HIPAA safe by construction).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path

import numpy as np
import pandas as pd

from .physiology import (N_PARAMS, P_GB, P_SG, P_SI, P_GAMMA, P_IB, P_VG, P_F, P_DAWN, P_KEX,
                         simulate, GI_TO_KABS)

START_DATE = pd.Timestamp("2026-09-07")  # Monday
N_DAYS = 14
FESTIVAL_DAY = 9  # 0-indexed day with festive eating

FIRST_NAMES_M = ["Arjun", "Ravi", "Suresh", "Vikram", "Anil", "Rajesh", "Karthik", "Manoj", "Sanjay", "Prakash",
                 "Imran", "Harish", "Deepak", "Naveen", "Srinivas", "Gopal", "Rahul", "Venkat", "Ashok", "Faisal"]
FIRST_NAMES_F = ["Lakshmi", "Priya", "Sunita", "Meena", "Kavya", "Anjali", "Rekha", "Divya", "Fatima", "Geeta",
                 "Shalini", "Pooja", "Revathi", "Nandini", "Asha", "Sarita", "Uma", "Farah", "Swati", "Padma"]
CITIES = [("Bengaluru", "south"), ("Chennai", "south"), ("Hyderabad", "south"), ("Kochi", "south"),
          ("Mumbai", "west"), ("Pune", "west"), ("Ahmedabad", "west"),
          ("Delhi", "north"), ("Lucknow", "north"), ("Chandigarh", "north"), ("Jaipur", "north"),
          ("Kolkata", "east"), ("Bhubaneswar", "east")]

# name, carbs (g), glycaemic index (approx.), veg?, region tag ("any"/south/north/west/east)
MEALS = {
    "breakfast": [
        ("Idli (3) + sambar", 52, 69, True, "south"), ("Masala dosa", 68, 77, True, "south"),
        ("Pongal", 60, 75, True, "south"), ("Upma", 48, 68, True, "south"),
        ("Poha", 50, 70, True, "west"), ("Aloo paratha + curd", 62, 72, True, "north"),
        ("Bread omelette", 38, 70, False, "any"), ("Oats with milk", 40, 55, True, "any"),
        ("Moong dal chilla", 30, 45, True, "north"), ("Luchi + aloo", 64, 78, True, "east"),
    ],
    "lunch": [
        ("Rice + sambar + poriyal", 85, 73, True, "south"), ("Curd rice", 70, 75, True, "south"),
        ("Roti (3) + dal + sabzi", 65, 58, True, "north"), ("Rajma chawal", 82, 68, True, "north"),
        ("Chicken biryani", 90, 72, False, "any"), ("Veg thali", 95, 70, True, "west"),
        ("Fish curry + rice", 80, 72, False, "east"), ("Millet (ragi) mudde + saaru", 60, 55, True, "south"),
        ("Chole bhature", 92, 80, True, "north"),
    ],
    "snack": [
        ("Chai + 2 biscuits", 22, 70, True, "any"), ("Samosa + chai", 38, 75, True, "any"),
        ("Banana", 27, 55, True, "any"), ("Roasted chana", 18, 30, True, "any"),
        ("Vada pav", 45, 78, True, "west"), ("Murukku + filter coffee", 30, 72, True, "south"),
    ],
    "dinner": [
        ("Chapati (3) + paneer sabzi", 58, 58, True, "any"), ("Rice + rasam + curry", 78, 74, True, "south"),
        ("Dosa (2) + chutney", 62, 77, True, "south"), ("Khichdi", 55, 65, True, "any"),
        ("Roti + chicken curry", 55, 58, False, "any"), ("Jeera rice + dal tadka", 75, 72, True, "north"),
        ("Pulao + raita", 70, 70, True, "any"),
    ],
    "sweet": [("Gulab jamun (2)", 40, 80, True, "any"), ("Laddoo", 30, 70, True, "any"),
              ("Kheer", 35, 65, True, "any"), ("Mysore pak", 32, 75, True, "south"),
              ("Rasgulla (2)", 38, 72, True, "east"), ("Modak (3)", 42, 70, True, "west")],
}


@dataclass
class Patient:
    pid: str
    name: str
    age: int
    sex: str
    city: str
    region: str
    vegetarian: bool
    height_cm: float
    weight_kg: float
    bmi: float
    waist_cm: float
    condition: str          # "T2D" or "Prediabetes"
    diabetes_years: float
    family_history_t2d: bool
    tcf7l2_rs7903146: str   # CC / CT / TT  (T = risk allele)
    hypertension: bool
    dyslipidemia: bool
    nafld: bool
    smoker: bool
    on_metformin: bool
    on_sulfonylurea: bool
    on_dpp4: bool
    on_sglt2: bool
    on_basal_insulin: bool
    # lifestyle traits (used to generate behaviour; not all visible in EHR)
    breakfast_skip_p: float
    dinner_time_mean: float
    post_dinner_walk_p: float
    daily_steps_mean: float
    sleep_hours_mean: float
    bedtime_mean: float
    sweet_p: float
    log_compliance: float
    metformin_adherence: float
    resting_hr: float
    fitness: float


def _rng_choice(rng, items):
    return items[rng.integers(len(items))]


def make_patient(i: int, rng: np.random.Generator) -> tuple[Patient, np.ndarray]:
    sex = "F" if rng.random() < 0.45 else "M"
    name = _rng_choice(rng, FIRST_NAMES_F if sex == "F" else FIRST_NAMES_M)
    city, region = _rng_choice(rng, CITIES)
    age = int(np.clip(rng.normal(52, 10), 28, 78))
    height = rng.normal(158 if sex == "F" else 169, 6)
    bmi = float(np.clip(rng.normal(26.3, 3.8), 19.5, 40))  # South Asian T2D: lower mean BMI
    weight = bmi * (height / 100) ** 2
    waist = float(np.clip((bmi * 3.1) + (8 if sex == "M" else 4) + rng.normal(0, 4), 70, 135))
    condition = "Prediabetes" if rng.random() < 0.18 else "T2D"
    years = 0.0 if condition == "Prediabetes" else float(np.clip(rng.gamma(2.0, 3.2), 0.3, 25))
    fam = rng.random() < 0.62
    allele_r = rng.random()
    tcf = "TT" if allele_r < 0.08 else ("CT" if allele_r < 0.45 else "CC")
    htn = rng.random() < (0.25 + 0.006 * (age - 40))
    dlp = rng.random() < 0.52
    nafld = rng.random() < (0.2 + 0.02 * max(bmi - 23, 0))
    smoker = (sex == "M") and rng.random() < 0.18
    t2d = condition == "T2D"
    met = t2d and rng.random() < 0.88
    su = t2d and years > 2 and rng.random() < 0.40
    dpp4 = t2d and rng.random() < 0.32
    sglt2 = t2d and rng.random() < 0.20
    ins = t2d and years > 8 and rng.random() < 0.28

    fitness = float(np.clip(rng.normal(0.5, 0.2), 0.05, 0.95))
    p = Patient(
        pid=f"GT-{1001 + i}", name=name, age=age, sex=sex, city=city, region=region,
        vegetarian=rng.random() < (0.55 if region in ("north", "west") else 0.28),
        height_cm=round(float(height), 1), weight_kg=round(float(weight), 1), bmi=round(bmi, 1),
        waist_cm=round(waist, 1), condition=condition, diabetes_years=round(years, 1),
        family_history_t2d=bool(fam), tcf7l2_rs7903146=tcf, hypertension=bool(htn), dyslipidemia=bool(dlp),
        nafld=bool(nafld), smoker=bool(smoker), on_metformin=bool(met), on_sulfonylurea=bool(su),
        on_dpp4=bool(dpp4), on_sglt2=bool(sglt2), on_basal_insulin=bool(ins),
        breakfast_skip_p=float(np.clip(rng.beta(1.2, 6), 0, 0.6)),
        dinner_time_mean=float(np.clip(rng.normal(21.0, 0.6), 19.5, 22.75)),
        post_dinner_walk_p=float(rng.beta(1.5, 2.5)),
        daily_steps_mean=float(np.clip(rng.normal(5200 + 4000 * fitness, 1500), 1500, 13000)),
        sleep_hours_mean=float(np.clip(rng.normal(6.4, 0.7), 4.8, 8.2)),
        bedtime_mean=float(np.clip(rng.normal(23.4, 0.6), 22.0, 25.0)),
        sweet_p=float(rng.beta(1.5, 5)),
        log_compliance=float(np.clip(rng.beta(6, 2), 0.45, 0.98)),
        metformin_adherence=float(np.clip(rng.beta(9, 1.4), 0.6, 1.0)),
        resting_hr=float(np.clip(rng.normal(76 - 12 * fitness, 5), 55, 95)),
        fitness=fitness,
    )

    # ---- latent physiology from profile -------------------------------------------------
    params = np.zeros(N_PARAMS)
    si = 4.2e-4 * np.exp(-0.055 * (bmi - 22)) * np.exp(-0.012 * (waist - 85)) * (0.75 + 0.5 * fitness)
    si *= np.exp(rng.normal(0, 0.18)) * (0.82 if nafld else 1.0)
    gamma = 0.010 * np.exp(-0.09 * years) * (0.80 if tcf == "TT" else (0.9 if tcf == "CT" else 1.0))
    gamma *= np.exp(rng.normal(0, 0.2)) * (0.75 if t2d else 1.0)
    gb = (106 if condition == "Prediabetes" else 138 + 3.0 * years) + rng.normal(0, 10)
    # treatment effects
    if met: gb -= 14
    if sglt2: gb -= 12
    if ins: gb -= 18
    if dpp4: gamma *= 1.25
    params[P_GB] = float(np.clip(gb, 92, 215))
    params[P_SG] = float(np.clip(rng.normal(0.012, 0.0015), 0.008, 0.016))
    params[P_SI] = float(np.clip(si, 0.6e-4, 8e-4))
    params[P_GAMMA] = float(np.clip(gamma, 0.0008, 0.014))
    params[P_IB] = float(np.clip(rng.normal(9 + 0.4 * (bmi - 22), 2), 5, 22))
    params[P_VG] = 1.7 * weight
    params[P_F] = float(np.clip(rng.normal(0.33, 0.035), 0.24, 0.42))
    params[P_DAWN] = float(np.clip(rng.normal(0.10 + (0.06 if t2d else 0), 0.04), 0.0, 0.25))
    params[P_KEX] = float(np.clip(rng.normal(2.0e-5, 0.4e-5), 1e-5, 3.5e-5))
    return p, params


def _pick_meal(rng, slot, p: Patient, festival=False):
    opts = [m for m in MEALS[slot] if (m[3] or not p.vegetarian) and (m[4] in ("any", p.region) or rng.random() < 0.15)]
    if not opts:
        opts = MEALS[slot]
    name, carbs, gi, *_ = _rng_choice(rng, opts)
    portion = float(np.clip(rng.normal(1.0, 0.15), 0.6, 1.5)) * (1.3 if festival else 1.0)
    return name, round(carbs * portion), gi


def generate_behaviour(p: Patient, params: np.ndarray, rng: np.random.Generator):
    """Minute-level inputs for 14 days + logs as the patient/wearable would report them."""
    T = N_DAYS * 1440
    meal_mg = np.zeros(T); kabs = np.full(T, 0.03); steps = np.zeros(T)
    si_mult = np.ones(T); gb_shift = np.zeros(T); su = np.zeros(T)
    sleep_stage = np.full(T, "", dtype=object)
    true_meals, logged_meals, med_log, nights = [], [], [], []

    def add_meal(minute, slot, name, carbs, gi, day):
        if minute < 0 or minute >= T: return
        dur = 15 if slot != "snack" else 8
        meal_mg[minute:minute + dur] += carbs * 1000 / dur
        kabs[minute:minute + 300] = GI_TO_KABS(gi)
        rec = dict(pid=p.pid, ts=START_DATE + pd.Timedelta(minutes=int(minute)), day=day, slot=slot,
                   meal=name, carbs_g=int(carbs), gi=int(gi))
        true_meals.append(rec)
        if rng.random() < p.log_compliance:
            # self-reported carbs are noisy (people under-estimate)
            r = dict(rec); r["carbs_g"] = int(max(5, carbs * rng.normal(0.9, 0.18)))
            r["ts"] = rec["ts"] + pd.Timedelta(minutes=int(rng.integers(-5, 20)))
            logged_meals.append(r)

    prev_sleep = p.sleep_hours_mean
    for d in range(N_DAYS):
        base = d * 1440
        weekend = (START_DATE + pd.Timedelta(days=d)).dayofweek >= 5
        festival = d == FESTIVAL_DAY
        # --- night that ends this morning: sleep from previous bedtime
        bed = p.bedtime_mean + rng.normal(0, 0.5) + (0.7 if weekend else 0) + (0.8 if festival else 0)
        sl_h = float(np.clip(rng.normal(p.sleep_hours_mean, 0.8) - (0.6 if rng.random() < 0.15 else 0), 3.5, 9.5))
        bed_min = int(base + (bed - 24) * 60)  # minutes relative to this day's midnight (negative = before)
        wake_min = int(bed_min + sl_h * 60)
        # sleep stages (5-min resolution but filled per minute)
        stages = []
        for m in range(max(bed_min, 0), min(wake_min, T), 5):
            frac = (m - bed_min) / max(sl_h * 60, 1)
            r = rng.random()
            deep_p = 0.30 * np.exp(-3 * frac) * (0.6 + 0.6 * p.fitness)
            rem_p = 0.12 + 0.18 * frac
            awake_p = 0.04 + (0.06 if sl_h < 5.5 else 0)
            st = "Deep" if r < deep_p else ("REM" if r < deep_p + rem_p else ("Awake" if r < deep_p + rem_p + awake_p else "Light"))
            sleep_stage[m:m + 5] = st
            stages.append(st)
        deep_frac = (np.array(stages) == "Deep").mean() if stages else 0.15
        # insulin sensitivity for the day: sleep debt + random stress/illness
        debt = max(0.0, 7.0 - sl_h) + 0.5 * max(0.0, 7.0 - prev_sleep)
        stress = rng.normal(0, 0.06) + (0.15 if rng.random() < 0.05 else 0)  # occasional bad/ill day
        day_si = float(np.clip(1.0 - 0.07 * debt - stress + 0.1 * (deep_frac - 0.15), 0.55, 1.15))
        si_mult[max(wake_min, 0):min(base + 1440 + 300, T)] = day_si
        nightly_hrv = float(np.clip(rng.normal(22 + 30 * p.fitness - 4 * debt - (p.age - 50) * 0.3, 4), 8, 80))
        nights.append(dict(pid=p.pid, date=(START_DATE + pd.Timedelta(days=d)).date().isoformat(), day=d,
                           sleep_hours=round(sl_h, 2), deep_pct=round(100 * deep_frac, 1),
                           bedtime=round(bed % 24, 2), hrv_rmssd=round(nightly_hrv, 1), _si_mult=round(day_si, 3)))
        prev_sleep = sl_h
        wake_clock = (wake_min - base) / 60

        # --- medications
        if p.on_metformin:
            taken_am = rng.random() < p.metformin_adherence
            taken_pm = rng.random() < p.metformin_adherence
            if taken_am: med_log.append(dict(pid=p.pid, ts=START_DATE + pd.Timedelta(minutes=base + int(wake_clock * 60) + 60), drug="Metformin 500 mg"))
            if taken_pm: med_log.append(dict(pid=p.pid, ts=START_DATE + pd.Timedelta(minutes=base + int(p.dinner_time_mean * 60)), drug="Metformin 500 mg"))
            missed = (not taken_am) + (not taken_pm)
            gb_shift[base:base + 1440] += 7.0 * missed
        if p.on_sulfonylurea:
            if rng.random() < 0.92:
                t_su = base + int((wake_clock + 1) * 60)
                med_log.append(dict(pid=p.pid, ts=START_DATE + pd.Timedelta(minutes=t_su), drug="Glimepiride 1 mg"))
                prof = 1.6 * np.exp(-np.arange(1440) / 600.0) * (1 - np.exp(-np.arange(1440) / 60.0))
                su[t_su:t_su + 1440] += prof[: max(0, min(1440, T - t_su))]
        if p.on_basal_insulin:
            med_log.append(dict(pid=p.pid, ts=START_DATE + pd.Timedelta(minutes=base + 22 * 60), drug="Insulin glargine 14 U"))

        # --- meals
        if rng.random() > p.breakfast_skip_p or festival:
            t_b = base + int((wake_clock + rng.uniform(0.6, 1.6)) * 60)
            add_meal(t_b, "breakfast", *_pick_meal(rng, "breakfast", p, festival), d)
        t_l = base + int(rng.normal(13.6 if not weekend else 14.0, 0.5) * 60)
        add_meal(t_l, "lunch", *_pick_meal(rng, "lunch", p, festival), d)
        if rng.random() < 0.75:
            t_s = base + int(rng.normal(17.2, 0.5) * 60)
            add_meal(t_s, "snack", *_pick_meal(rng, "snack", p), d)
        dinner_h = p.dinner_time_mean + rng.normal(0, 0.4) + (0.4 if weekend else 0)
        t_d = base + int(dinner_h * 60)
        skip_dinner = rng.random() < 0.04
        if not skip_dinner:
            add_meal(t_d, "dinner", *_pick_meal(rng, "dinner", p, festival), d)
        if festival or rng.random() < p.sweet_p * (1.6 if weekend else 1.0):
            t_sw = t_l + 25 if rng.random() < 0.5 or festival else t_d + 30
            add_meal(t_sw, "sweet", *_pick_meal(rng, "sweet", p), d)
            if festival:
                add_meal(t_d + 40, "sweet", *_pick_meal(rng, "sweet", p), d)

        # --- activity (steps/min)
        day_target = max(800.0, rng.normal(p.daily_steps_mean * (0.8 if weekend else 1.0), 1200))
        awake_from, awake_to = max(wake_min, base), min(base + int(bed % 24 * 60) if bed < 24 else base + 1439, base + 1439)
        n_awake = max(awake_to - awake_from, 60)
        background = rng.gamma(0.35, 1.0, n_awake)
        background = background / background.sum() * day_target * 0.65
        steps[awake_from:awake_from + n_awake] += background[: max(0, min(n_awake, T - awake_from))]
        # commute / morning walk bouts
        for _ in range(rng.integers(1, 4)):
            s = int(rng.uniform(awake_from, awake_to - 30))
            L = int(rng.integers(10, 30))
            steps[s:s + L] += day_target * 0.35 / 2 / L
        walked_after_dinner = (not skip_dinner) and rng.random() < p.post_dinner_walk_p
        if walked_after_dinner:
            s = t_d + int(rng.integers(15, 35)); L = int(rng.integers(15, 30))
            steps[s:s + L] += rng.uniform(85, 110)
        nights[-1]["post_dinner_walk"] = bool(walked_after_dinner)

    return dict(meal_mg=meal_mg, kabs=kabs, steps=steps, si_mult=si_mult, gb_shift=gb_shift, su=su,
                sleep_stage=sleep_stage, true_meals=true_meals, logged_meals=logged_meals,
                med_log=med_log, nights=nights)


def sensor_streams(p: Patient, beh: dict, G_min: np.ndarray, rng: np.random.Generator) -> pd.DataFrame:
    """Down-sample to a 5-minute wearable feed: CGM (with lag/noise/dropouts), HR, HRV, steps, sleep."""
    T = G_min.shape[0]
    # interstitial lag ~ 8 min
    Gi = np.empty(T); Gi[0] = G_min[0]
    for t in range(1, T):
        Gi[t] = Gi[t - 1] + (G_min[t - 1] - Gi[t - 1]) / 8.0
    idx = np.arange(4, T, 5)
    n = len(idx)
    ar = np.zeros(n)
    for k in range(1, n):
        ar[k] = 0.85 * ar[k - 1] + rng.normal(0, 3.2)
    drift = np.linspace(0, rng.normal(0, 6), n)
    cgm = Gi[idx] * (1 + rng.normal(0, 0.025, n)) + ar + drift
    cgm = np.clip(cgm, 40, 400)
    # dropouts (compression lows / signal loss)
    drop = np.zeros(n, bool)
    for _ in range(rng.integers(2, 7)):
        s = rng.integers(0, n - 30); drop[s:s + rng.integers(2, 24)] = True
    cgm[drop] = np.nan
    st5 = beh["steps"].reshape(-1, 5).sum(1)
    sleep5 = beh["sleep_stage"][idx]
    asleep = sleep5 != ""
    hr = p.resting_hr + 0.11 * st5 + rng.normal(0, 3, n) - 8 * asleep + 4 * (1 - beh["si_mult"][idx])
    hr = np.clip(hr, 42, 175)
    night_hrv = {n_["day"]: n_["hrv_rmssd"] for n_ in beh["nights"]}
    day_of = (idx // 1440)
    hrv = np.where(asleep, np.array([night_hrv[d] for d in day_of]) + rng.normal(0, 5, n), np.nan)
    ts = START_DATE + pd.to_timedelta(idx - 4, unit="m")
    return pd.DataFrame(dict(pid=p.pid, ts=ts, cgm_mgdl=np.round(cgm, 1), steps=np.round(st5).astype(int),
                             heart_rate=np.round(hr).astype(int), hrv_rmssd=np.round(hrv, 1),
                             sleep_stage=np.where(asleep, sleep5, "")))


def labs_from_glucose(p: Patient, G_min: np.ndarray, rng) -> dict:
    mean_g = float(np.mean(G_min))
    a1c = (mean_g + 46.7) / 28.7 + rng.normal(0, 0.25)  # ADAG relation + biological noise
    fasting = [G_min[d * 1440 + 7 * 60] for d in range(N_DAYS)]
    tg = rng.normal(150 + 40 * p.dyslipidemia + 3 * (p.bmi - 24), 30)
    hdl = rng.normal(44 - 6 * p.dyslipidemia + (5 if p.sex == "F" else 0), 6)
    ldl = rng.normal(108 + 25 * p.dyslipidemia, 22)
    egfr = np.clip(rng.normal(98 - 0.7 * (p.age - 40) - 0.6 * p.diabetes_years, 12), 25, 125)
    return dict(hba1c_pct=round(float(np.clip(a1c, 5.4, 13.5)), 1),
                fasting_glucose_mgdl=round(float(np.median(fasting) + rng.normal(0, 6))),
                triglycerides_mgdl=round(float(max(tg, 60))), hdl_mgdl=round(float(max(hdl, 22))),
                ldl_mgdl=round(float(max(ldl, 40))), egfr=round(float(egfr)),
                alt_u_l=round(float(np.clip(rng.normal(28 + 22 * p.nafld, 8), 8, 140))),
                systolic_bp=round(float(rng.normal(128 + 14 * p.hypertension, 9))),
                diastolic_bp=round(float(rng.normal(80 + 8 * p.hypertension, 6))))


def generate_cohort(n_patients: int = 150, seed: int = 7, out_dir: str | Path = "data") -> None:
    out = Path(out_dir)
    for sub in ("ehr", "ehr/fhir", "wearables", "_ground_truth"):
        (out / sub).mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(seed)
    ehr_rows, wear, meals_l, meals_t, meds, nights, truth = [], [], [], [], [], [], []
    for i in range(n_patients):
        p, params = make_patient(i, rng)
        beh = generate_behaviour(p, params, rng)
        traj = simulate(params, beh["meal_mg"], beh["kabs"], beh["steps"], beh["si_mult"], beh["gb_shift"],
                        beh["su"], 0, np.array([-1.0, 0, 0, 0, 0, 0]), 1)
        G = traj[:, 0]
        labs = labs_from_glucose(p, G, rng)
        row = asdict(p)
        hidden = ["breakfast_skip_p", "dinner_time_mean", "post_dinner_walk_p", "daily_steps_mean",
                  "sleep_hours_mean", "bedtime_mean", "sweet_p", "log_compliance", "metformin_adherence",
                  "resting_hr", "fitness"]
        truth.append(dict(pid=p.pid, **{k: row.pop(k) for k in hidden},
                          true_Gb=params[P_GB], true_SI=params[P_SI], true_gamma=params[P_GAMMA],
                          true_Ib=params[P_IB], true_f=params[P_F], true_dawn=params[P_DAWN],
                          true_Sg=params[P_SG], true_kEx=params[P_KEX]))
        row.update(labs)
        ehr_rows.append(row)
        wear.append(sensor_streams(p, beh, G, rng))
        meals_l += beh["logged_meals"]; meals_t += beh["true_meals"]; meds += beh["med_log"]
        nights += beh["nights"]
        (out / "ehr/fhir" / f"{p.pid}.json").write_text(json.dumps(to_fhir(row), indent=1))
    ehr = pd.DataFrame(ehr_rows)
    ehr.to_csv(out / "ehr/patients.csv", index=False)
    pd.concat(wear).to_parquet(out / "wearables/stream_5min.parquet", index=False)
    pd.DataFrame(meals_l).to_csv(out / "wearables/meal_log.csv", index=False)
    pd.DataFrame(meds).to_csv(out / "wearables/medication_log.csv", index=False)
    nd = pd.DataFrame(nights)
    nd.drop(columns=["_si_mult"]).to_csv(out / "wearables/sleep_nightly.csv", index=False)
    pd.DataFrame(meals_t).to_csv(out / "_ground_truth/true_meals.csv", index=False)
    pd.DataFrame(truth).to_csv(out / "_ground_truth/latent_physiology.csv", index=False)
    nd[["pid", "day", "_si_mult"]].to_csv(out / "_ground_truth/daily_si_multiplier.csv", index=False)


def to_fhir(row: dict) -> dict:
    """Minimal FHIR R4 Bundle so the EHR stream is interoperable with ABDM-style systems."""
    pid = row["pid"]
    def obs(code, display, value, unit):
        return {"resource": {"resourceType": "Observation", "status": "final", "subject": {"reference": f"Patient/{pid}"},
                             "code": {"coding": [{"system": "http://loinc.org", "code": code, "display": display}]},
                             "valueQuantity": {"value": value, "unit": unit}}}
    def cond(code, display):
        return {"resource": {"resourceType": "Condition", "subject": {"reference": f"Patient/{pid}"},
                             "code": {"coding": [{"system": "http://snomed.info/sct", "code": code, "display": display}]}}}
    def med(name):
        return {"resource": {"resourceType": "MedicationStatement", "status": "active", "subject": {"reference": f"Patient/{pid}"},
                             "medicationCodeableConcept": {"text": name}}}
    entries = [{"resource": {"resourceType": "Patient", "id": pid, "gender": "female" if row["sex"] == "F" else "male",
                             "birthDate": str(2026 - row["age"]), "address": [{"city": row["city"], "country": "IN"}],
                             "name": [{"given": [row["name"]], "family": "(synthetic)"}]}}]
    entries.append(cond("44054006", "Type 2 diabetes mellitus") if row["condition"] == "T2D" else cond("714628002", "Prediabetes"))
    if row["hypertension"]: entries.append(cond("38341003", "Hypertension"))
    if row["dyslipidemia"]: entries.append(cond("370992007", "Dyslipidemia"))
    if row["nafld"]: entries.append(cond("197321007", "Non-alcoholic fatty liver"))
    for k, n in [("on_metformin", "Metformin 500 mg BD"), ("on_sulfonylurea", "Glimepiride 1 mg OD"),
                 ("on_dpp4", "Teneligliptin 20 mg OD"), ("on_sglt2", "Dapagliflozin 10 mg OD"),
                 ("on_basal_insulin", "Insulin glargine 14 U HS")]:
        if row[k]: entries.append(med(n))
    entries += [obs("4548-4", "Hemoglobin A1c", row["hba1c_pct"], "%"),
                obs("1558-6", "Fasting glucose", row["fasting_glucose_mgdl"], "mg/dL"),
                obs("39156-5", "BMI", row["bmi"], "kg/m2"), obs("8280-0", "Waist circumference", row["waist_cm"], "cm"),
                obs("2571-8", "Triglycerides", row["triglycerides_mgdl"], "mg/dL"),
                obs("2085-9", "HDL cholesterol", row["hdl_mgdl"], "mg/dL"),
                obs("33914-3", "eGFR", row["egfr"], "mL/min/1.73m2"),
                obs("8480-6", "Systolic BP", row["systolic_bp"], "mmHg"),
                {"resource": {"resourceType": "Observation", "status": "final", "subject": {"reference": f"Patient/{pid}"},
                              "code": {"text": "TCF7L2 rs7903146 genotype"}, "valueString": row["tcf7l2_rs7903146"]}}]
    return {"resourceType": "Bundle", "type": "collection", "entry": entries}
