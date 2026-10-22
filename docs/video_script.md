# Chaya: demo video script (about 18 minutes; the form allows 15–20)

Record it as a screen recording with your voice over the slides and the live Chaya app, then upload it to YouTube as **Unlisted**.
Keep a webcam bubble in a corner if you can; judges respond to faces.

**Before you record**
- Open `docs/Chaya_Presentation.pdf` full-screen.
- In a second window, open https://chaya-tau.vercel.app (or run `uvicorn api.server:app` locally and go to http://127.0.0.1:8000). Open a private window so the first-visit welcome slip appears.
- Open a terminal in the repo root and run `python scripts/generate_data.py 150` once beforehand, so the commands are warm.
- Recording setup: 1080p, mic close to your mouth, notifications off.

---

## 0:00 – 1:00 · Hook (slide 1)
> "Every three months, a person with diabetes in India gets one number, their HbA1c. In between, there are about 270 meals, and the doctor sees none of them. We built Chaya, a digital twin that watches those meals through wearables, understands this patient's physiology from their health record, and warns the care team two hours before a glucose spike happens."

Introduce the team: names, college, roles (one line each).

## 1:00 – 3:00 · The problem (slides 2–3)
- India has 101 million people with diabetes and 136 million with prediabetes (ICMR-INDIAB, Lancet Diabetes & Endocrinology, 2023).
- Indian diets get about 62% of calories from carbohydrates (ICMR-INDIAB, Nature Medicine, 2025). Post-meal spikes are the daily, invisible problem.
- South Asians develop diabetes at a lower BMI. Western risk models under-call Indian patients.
- Care is reactive: a quarterly lab test, a prescription change, and a wait for the next quarter.
- Say the use case clearly: *"Our outcome is a glucose spike above 180 mg/dL, predicted two hours in advance, for adults with Type 2 Diabetes or prediabetes."*

## 3:00 – 5:30 · What a digital twin means here (slides 4–5)
- Not a generic classifier. Each patient gets a small physiological model: food enters the gut, glucose enters the blood, and insulin pushes it back down.
- Walk through the four personal parameters in plain words:
  - **Insulin sensitivity**: how well the body responds to insulin.
  - **β-cell response**: how much insulin the pancreas releases when glucose rises.
  - **Basal glucose**: where glucose settles with no food.
  - **Meal bioavailability** and **dawn effect**.
- The twin starts from the EHR (the static stream) and is then tuned on the first 7 days of wearable data (the dynamic stream). This is the fusion the challenge asks for, done at the physiology level.
- Mention the extras: it detects unlogged meals, and it accounts for short sleep and missed metformin.

## 5:30 – 7:30 · Data and sandbox rules (slide 5)
- All data is synthetic. Explain why we built our own generator instead of only Synthea: we needed Indian meals, Indian prescriptions (teneligliptin, glimepiride), late dinners and festival days, and CGM physics that stays consistent with the HbA1c in the record.
- Show the numbers: 150 patients, 14 days each, 604,800 five-minute readings.
- Real-world mess is built in: patients log only 45–98% of meals and under-estimate carbs, miss doses, and sleep badly; the CGM has lag, noise and dropouts.
- EHR records are exported as **FHIR R4** bundles with LOINC and SNOMED codes, so the same pipeline can later read real ABDM-consented records.
- **Live (30 s):** open `data/ehr/fhir/GT-1102.json` and scroll the bundle, then `data/wearables/stream_5min.parquet` (or the CSV logs).

## 7:30 – 9:00 · Architecture (slide 6)
Walk left to right on the diagram: two data streams → ingest → twin core (prior, calibrate, observe, habit, forecast) → fused features (18 EHR + 25 wearable + 11 twin) → LightGBM spike classifier and 2-hour regressor → SHAP explanations → API and clinician console.

## 9:00 – 12:00 · Results (slides 7–10)
- **Twin validity (slide 7):** because the data is synthetic, we know each patient's true hidden physiology. The calibrated twin recovers it: correlation 0.99 for basal glucose, 0.84 for insulin sensitivity and 0.91 for β-cell response. The EHR alone gets 0.77, 0.75 and 0.88. *"The wearable stream is what makes the twin personal."*
- **Spike prediction (slides 8–9):** on 45 held-out patients the model was never trained on, AUROC is 0.942, sensitivity 83%, precision 79%, and 87% of spikes are flagged at least an hour ahead. Walk through the ablation bars: EHR alone 0.876, wearables alone 0.936, physics twin alone 0.819 with no training at all, and the full fusion 0.942.
- **2-hour glucose forecast (slide 8):** error drops from 53 mg/dL (just assuming glucose stays the same) to 24 mg/dL. 99.3% of forecasts fall in the clinically safe Clarke zones A+B.
- **Why the twin matters (slide 10):** with only 5 training patients, the twin lifts AUROC from 0.873 to 0.893. The physics carries knowledge the data hasn't taught the model yet, which is exactly the situation of a new clinic or a new patient.
- Be honest: *"With plenty of data, ML alone gets close. The twin's value is in cold-start, robustness and what-if, which ML alone can't do."*

## 12:00 – 16:30 · Live demo (slides 11–13, then the app)
Follow this run-sheet:
1. **Home page.** Read the headline. On the forecast slip, click *Chicken biryani* and *Rest*: the stamp turns to SPIKE LIKELY. Click *Ragi mudde* and *Walk 20 min*: IN RANGE. *"That is the product in one card."*
2. **Open the simulated clinic.** Point at the purple strip: every patient is synthetic. Point at the pill top right: *Live · Supabase*: the clinic is served by the API on Vercel from a Supabase Postgres database.
3. **Welcome slip → Walk through Sanjay's case.** Let the guided walkthrough drive. Read each slip aloud:
   - 12:15, Sanjay about to eat lunch; his twin learned his insulin sensitivity is low.
   - Chicken biryani: peak **237 mg/dL**, about 2 hours above 180.
   - Ragi mudde: **194**. Plus a 20-minute walk: **178**, **0 minutes** above 180.
   - 12:45, what actually happened: an 81 g lunch, stamp **SPIKE LIKELY 92%**, with reasons, 40 minutes before his glucose crossed 180.
   - Save the advice to his case notes. It is written to the database.
4. **Register.** Sort by *Lowest time in range*, open another patient, and show the stamp change as you drag **Now**.
5. **Press Replay.** Let the clock run for about 20 seconds and watch warnings appear before the spikes.
6. **Mark warning as reviewed** on an alert, and open **Guide → What's what** to show the glossary. Click an **i** button on a panel.
7. **Rx pad on your own.** Set metformin to *Missed* and sleep to 5 h: the peak rises. *"This is a conversation a doctor can have with the patient, with numbers for this patient's body rather than generic advice."*
8. **Switch day** to the festival day (Wed 16) and show the bigger swings.
9. **Backend (30 s):** open `https://chaya-tau.vercel.app/api/health` (database status) and, if running locally, `http://127.0.0.1:8000/docs` and `/api/pipeline/GT-1102/risk?at=2026-09-20T12:45`. The pipeline endpoint reads the raw FHIR bundle and wearables, calibrates the twin and returns the risk with reasons.

## 16:30 – 18:00 · Safety, impact, roadmap (slides 14–16)
- Safety: decision support only, a clinician in the loop, alerts merged into episodes to limit fatigue (about 4 per patient-day at this threshold, tunable), and no real data.
- Privacy: synthetic data now; DPDP Act-aligned consent through ABDM later; FHIR-native.
- Roadmap: (1) validate on public CGM datasets such as PhysioNet's CGMacros and BIG IDEAs; (2) a supervised pilot with a partner diabetes clinic; (3) patient-side nudges; (4) extend the same twin to hypoglycaemia risk for sulfonylurea users and to hypertension.
- Close: *"Proactive, not reactive: we see the spike before it happens, and we can show the patient how to avoid it."*

## 18:00 · End card
Repo link, team names, thank you.

---

### Speaking tips
- Talk to one doctor, not to "the jury".
- Pause on each result slide for two seconds before you speak.
- If a number feels dense, say what it means: "eight in ten spikes, warned an hour early."
