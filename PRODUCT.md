# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Functional backend with a database, hosted on Railway (user's answer). Delegated details: Python FastAPI service, PostgreSQL on Railway (SQLite fallback for local runs), plain HTML/CSS/JS front end served by the API, no build step.

## Users

- **Primary:** diabetologists, endocrinologists and diabetes care coordinators in India who monitor a panel of adults with Type 2 Diabetes or prediabetes wearing a CGM. They work between consults and need to know quickly which patient needs attention and why.
- **Secondary (evaluation context):** the Happiest Health Digital Twin Challenge 2026 jury of technical and clinical experts, who open the demo cold and must understand it without a guide.

## Product Purpose

Chaya builds a personal physiological "twin" for each patient from their health record (static) and wearables (dynamic). It flags a likely glucose spike above 180 mg/dL about two hours before it happens, explains the drivers, and lets a clinician simulate changes (meal swap, post-meal walk, sleep, missed metformin) on that patient's twin before advising them. Success: the right patient gets attention before the spike, and advice is specific to that patient's body.

## Positioning

A calibrated physiology model per patient, not only a black-box score: it can answer "what if" for this specific person and works from day one with no training data, while the ML layer adds accuracy as data grows.

## Operating Context

- Clinic workflow: scan panel → open patient → read risk and reasons → test a change → advise.
- Demo uses a 7-day replay of a synthetic week (Mon 14 – Sun 20 Sep 2026); the clinician scrubs a "now" clock.
- Indian context: regional meals (idli, dosa, rajma chawal, biryani, ragi mudde), late dinners, festival days, common Indian prescriptions.

## Capabilities and Constraints

- Spike prediction every 15 min; 2-hour glucose forecast; reasons from grouped SHAP; twin physiology (insulin sensitivity, β-cell response, basal glucose) versus EHR estimate; what-if simulator up to 4 h.
- All patient data is synthetic. Every surface must say so clearly; it must never look like real patient data.
- Decision support only: no dosing, not a medical device.

## Brand Commitments

- Name: **Chaya** (Sanskrit/Hindi: shadow, shade). The twin is the patient's shadow that walks two hours ahead and offers shade from harm.
- Repo: https://github.com/r-e-sai-harsha/GlucoTwin
- Voice: plain clinical English, specific numbers, no hype.

## Evidence on Hand

- Held-out results in `reports/metrics.json`: AUROC 0.942, sensitivity 83%, precision 79%, 87% of spikes flagged ≥ 60 min ahead, 2-h forecast RMSE 24.3 mg/dL, Clarke A+B 99.3%.
- Twin validity: correlation with hidden truth 0.99 / 0.84 / 0.91.
- No real customers, testimonials, pilots or partnerships exist. Do not invent any.

## Product Principles

1. Attention before alarm: rank and explain; never shout.
2. Every number has a reason the clinician can read.
3. Show the patient's own body, not population averages.
4. Honest about simulation: synthetic data and limitations are always visible.
5. One screen answers "who, why, what can we change".

## Accessibility & Inclusion

WCAG 2.1 AA contrast, keyboard operable, colour never the only signal (spike vs in-range differ in lightness and shape).
