"""
Glucose–insulin physiology core shared by the synthetic data generator and the digital twin.

Extended Bergman minimal model (1-minute Euler integration):

    dG/dt = -(Sg + X·(1+E))·G + Sg·Gb_eff + Ra(t)/Vg + dawn(t) - kEx·steps(t)·G
    dX/dt = -p2·X + p2·SI_eff(t)·(I - Ib)
    dI/dt = -n·(I - Ib) + γ·max(G - Gb_eff, 0) + su(t)
    dQ1/dt = -kabs·Q1 + meal(t)            (gut, two-compartment)
    dQ2/dt =  kabs·(Q1 - Q2);  Ra = f·kabs·Q2
    dE/dt  = -E/τE + kE·steps(t)            (exercise-induced insulin sensitivity)

G  plasma glucose (mg/dL)        X  remote insulin action (1/min)
I  plasma insulin (µU/mL)        Q  gut glucose (mg)
E  exercise sensitisation (–)

Time-varying inputs let the twin represent sleep debt / stress (SI_eff),
missed metformin (Gb_eff), sulfonylurea secretion (su) and the dawn phenomenon.
"""
from __future__ import annotations

import numpy as np
from numba import njit

# parameter vector layout
P_GB, P_SG, P_SI, P_GAMMA, P_IB, P_VG, P_F, P_DAWN, P_KEX = range(9)
N_PARAMS = 9
P2, N_CLEAR, TAU_E, K_E = 0.025, 0.14, 240.0, 0.0008


@njit(cache=True)
def _dawn(minute_of_day: float) -> float:
    # smooth bump between ~03:30 and 08:30, peak ~06:00
    x = (minute_of_day - 360.0) / 75.0
    return np.exp(-0.5 * x * x)


@njit(cache=True)
def simulate(params, meal_mg, kabs, steps, si_mult, gb_shift, su, t0_minute, state0, out_every):
    """Simulate one patient.

    params   : (N_PARAMS,) physiology parameters
    meal_mg  : (T,) carbohydrate entering the gut each minute (mg)
    kabs     : (T,) absorption rate in force each minute (1/min) — meal GI dependent
    steps    : (T,) steps per minute
    si_mult  : (T,) multiplier on insulin sensitivity (sleep debt, stress, illness)
    gb_shift : (T,) additive shift of basal glucose (e.g. missed metformin)
    su       : (T,) sulfonylurea-driven insulin secretion (µU/mL/min)
    t0_minute: minute-of-day of the first sample
    state0   : (6,) initial state [G, X, I, Q1, Q2, E]; G<0 means start at basal
    out_every: record every n minutes
    returns  : (T//out_every, 6) state trajectory
    """
    T = meal_mg.shape[0]
    Gb, Sg, SI, gamma, Ib, Vg, f, dawn_amp, kEx = (
        params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7], params[8])
    G, X, I, Q1, Q2, E = state0[0], state0[1], state0[2], state0[3], state0[4], state0[5]
    if G < 0:
        G, X, I, Q1, Q2, E = Gb, 0.0, Ib, 0.0, 0.0, 0.0
    n_out = T // out_every
    out = np.empty((n_out, 6))
    k = 0
    for t in range(T):
        mod = (t0_minute + t) % 1440
        gbe = Gb + gb_shift[t]
        ra = f * kabs[t] * Q2
        dG = -(Sg + X * (1.0 + E)) * G + Sg * gbe + ra / Vg + dawn_amp * _dawn(mod) - kEx * steps[t] * G
        dX = -P2 * X + P2 * SI * si_mult[t] * (I - Ib)
        dI = -N_CLEAR * (I - Ib) + gamma * max(G - gbe, 0.0) + su[t]
        dQ1 = -kabs[t] * Q1 + meal_mg[t]
        dQ2 = kabs[t] * (Q1 - Q2)
        dE = -E / TAU_E + K_E * steps[t]
        G = max(G + dG, 20.0)
        X = X + dX
        I = max(I + dI, 0.0)
        Q1 = max(Q1 + dQ1, 0.0)
        Q2 = max(Q2 + dQ2, 0.0)
        E = max(E + dE, 0.0)
        if (t + 1) % out_every == 0:
            out[k, 0] = G; out[k, 1] = X; out[k, 2] = I
            out[k, 3] = Q1; out[k, 4] = Q2; out[k, 5] = E
            k += 1
    return out


@njit(cache=True)
def simulate_observer(params, meal_mg, kabs, steps, si_mult, gb_shift, su, t0_minute, cgm5, gain, meal_gain):
    """Run the twin alongside observed CGM (5-min samples), nudging the state toward
    measurements (a simple Luenberger observer). Positive, persistent innovations are
    interpreted as unlogged carbohydrate and injected into the gut compartment, so the
    twin can 'notice' a meal the patient forgot to log.

    Returns (n5, 6) states at each CGM sample (after correction) and (n5,) inferred carbs (g).
    """
    T = meal_mg.shape[0]
    Gb, Sg, SI, gamma, Ib, Vg, f, dawn_amp, kEx = (
        params[0], params[1], params[2], params[3], params[4], params[5], params[6], params[7], params[8])
    G, X, I, Q1, Q2, E = Gb, 0.0, Ib, 0.0, 0.0, 0.0
    n5 = T // 5
    states = np.empty((n5, 6))
    inferred = np.zeros(n5)
    prev_innov = 0.0
    k = 0
    for t in range(T):
        mod = (t0_minute + t) % 1440
        gbe = Gb + gb_shift[t]
        ra = f * kabs[t] * Q2
        dG = -(Sg + X * (1.0 + E)) * G + Sg * gbe + ra / Vg + dawn_amp * _dawn(mod) - kEx * steps[t] * G
        dX = -P2 * X + P2 * SI * si_mult[t] * (I - Ib)
        dI = -N_CLEAR * (I - Ib) + gamma * max(G - gbe, 0.0) + su[t]
        dQ1 = -kabs[t] * Q1 + meal_mg[t]
        dQ2 = kabs[t] * (Q1 - Q2)
        dE = -E / TAU_E + K_E * steps[t]
        G = max(G + dG, 20.0); X = X + dX; I = max(I + dI, 0.0)
        Q1 = max(Q1 + dQ1, 0.0); Q2 = max(Q2 + dQ2, 0.0); E = max(E + dE, 0.0)
        if (t + 1) % 5 == 0:
            y = cgm5[k]
            if y == y:  # not NaN
                innov = y - G
                G = G + gain * innov
                # persistent positive innovation -> unlogged meal
                if innov > 12.0 and prev_innov > 8.0:
                    add = meal_gain * innov * Vg / f
                    Q1 += add
                    inferred[k] = add / 1000.0
                prev_innov = innov
            states[k, 0] = G; states[k, 1] = X; states[k, 2] = I
            states[k, 3] = Q1; states[k, 4] = Q2; states[k, 5] = E
            k += 1
    return states, inferred


def default_params(weight_kg: float) -> np.ndarray:
    p = np.zeros(N_PARAMS)
    p[P_GB], p[P_SG], p[P_SI], p[P_GAMMA] = 140.0, 0.012, 2.5e-4, 0.0035
    p[P_IB], p[P_VG], p[P_F], p[P_DAWN], p[P_KEX] = 10.0, 1.7 * weight_kg, 0.55, 0.12, 2.0e-5
    return p


GI_TO_KABS = lambda gi: 0.012 + 0.00045 * gi  # GI 40 -> 0.030 /min, GI 85 -> 0.050 /min
