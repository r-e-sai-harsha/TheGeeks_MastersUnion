# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Live: Vercel (static web app + Node API function in Mumbai, `bom1`) over Supabase Postgres with row-level security. Also runs as a Python FastAPI service with PostgreSQL on Railway or SQLite locally. Plain HTML/CSS/JS front end, no build step; an offline fallback runs from bundled synthetic data.

## Users

- **Primary:** diabetologists, endocrinologists and diabetes care coordinators in India who monitor a panel of adults with Type 2 Diabetes or prediabetes wearing a CGM. They work between consults and need to know quickly which patient needs attention and why.
- **Patients:** adults with T2D using the bilingual (English, Hindi) patient app: their own glucose with a two-hour shadow, plain warnings, dose reminders, meal logging and the doctor's advice.
- **Buyer:** hospital and clinic leadership reading the Clinic outcomes page (time in range, low safety, alert load, warning-to-action funnel).
- **Secondary (evaluation context):** the Happiest Health Digital Twin Challenge 2026 jury of technical and clinical experts, who open the demo cold and must understand it without a guide.

## Product Purpose

Chaya builds a personal physiological "twin" for each patient from their health record (static) and wearables (dynamic). It flags a likely glucose spike above 180 mg/dL about two hours before it happens, explains the drivers, and lets a clinician simulate changes (meal swap, post-meal walk, sleep, missed metformin) on that patient's twin before advising them. It also warns of likely lows (forecast below 80 mg/dL), gives every warning an owner and a contact-by time, and sends advice to the patient's phone. Success: the right patient gets attention before the spike or low, someone acts on it, and advice is specific to that patient's body and reaches the patient.

## Positioning

A calibrated physiology model per patient, not only a black-box score: it can answer "what if" for this specific person and works from day one with no training data, while the ML layer adds accuracy as data grows.

## Operating Context

- Clinic workflow: scan panel → open patient → read risk and reasons → assign an owner and contact the patient → test a change on the Rx pad → save and send → see it read in the patient app.
- Navigation: the home page has a floating section bar at the bottom; the clinic is entered from the pulsing hero CTA and the patient app from the pulsing CTA in its section right below the hero.
- Health record: point-in-time EHR values (target bars, plain status) kept apart from this week's CGM trends (GMI, waking glucose); i buttons explain in tooltips. Inside the product: home icon, Clinic / Patient app switcher, Outcomes, Data sources.
- Demo uses a 7-day replay of a synthetic week (Mon 14 – Sun 20 Sep 2026); the clinician scrubs a "now" clock.
- Indian context: regional meals (idli, dosa, rajma chawal, biryani, ragi mudde), late dinners, festival days, common Indian prescriptions.

## Capabilities and Constraints

- Low-glucose warning (forecast < 80 mg/dL or CGM < 70); escalation with WhatsApp or call log; adjustable alert threshold; clinic outcomes; patient app with logging that feeds the twin; data provenance for 25 parameters.
- Spike prediction every 15 min; 2-hour glucose forecast; reasons from grouped SHAP; twin physiology (insulin sensitivity, β-cell response, basal glucose) versus EHR estimate; what-if simulator up to 4 h.
- All patient data is synthetic. Every surface must say so clearly; it must never look like real patient data.
- Decision support only: no dosing, not a medical device.

## Brand Commitments

- Name: **Chaya** (Sanskrit/Hindi: shadow, shade). The twin is the patient's shadow that walks two hours ahead and offers shade from harm.
- Repo: https://github.com/r-e-sai-harsha/TheGeeks_MastersUnion
- Voice: plain clinical English, specific numbers, no hype.

## Evidence on Hand

- Held-out results in `reports/metrics.json`: AUROC 0.942, sensitivity 83%, precision 79%, 87% of spikes flagged ≥ 60 min ahead, 2-h forecast RMSE 24.3 mg/dL, Clarke A+B 99.3%.
- Twin validity: correlation with hidden truth 0.99 / 0.84 / 0.91.
- Low warnings (`web/data/outcomes.json`): 7 of 10 held-out lows warned, median 80 min ahead, 0.16 low warnings per patient a day.
- Threshold trade-off: 2.6–4.6 spike warnings per patient a day for 74–98% of spikes warned within 2 h.
- No real customers, testimonials, pilots or partnerships exist. Do not invent any.

## Product Principles

1. Attention before alarm: rank and explain; never shout.
2. Every number has a reason the clinician can read.
3. Show the patient's own body, not population averages.
4. Honest about simulation: synthetic data and limitations are always visible.
5. One screen answers "who, why, what can we change".

## Accessibility & Inclusion

WCAG 2.1 AA contrast, keyboard operable, colour never the only signal (spike vs in-range differ in lightness and shape).
