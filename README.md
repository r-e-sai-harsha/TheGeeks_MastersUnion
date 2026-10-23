# Chaya (छाया): a personal digital twin that sees glucose spikes 2 hours ahead

**Digital Twin Challenge 2026 · Happiest Health · Phase 1: Prototype & Code Submission**

*Chaya* is Sanskrit and Hindi for shadow and shade: the patient's twin walks two hours ahead of them and keeps them out of harm's way.

Chaya builds a small, personal physiological model ("twin") for each person with Type 2 Diabetes. It starts from the electronic health record, tunes itself on a week of wearable data, and then runs beside the live CGM. Every 15 minutes it estimates the chance that glucose will cross 180 mg/dL within the next 2 hours, explains why, and lets a doctor simulate "what if" scenarios: a different meal, a walk after lunch, a missed metformin dose, a short night's sleep.

| | |
|---|---|
| 📹 **Demo video (15–20 min)** | `<<PASTE UNLISTED YOUTUBE LINK>>` |
| 🌐 **Live app** | https://chaya-tau.vercel.app · home page, simulated clinic, patient app, data-source catalogue, product tour and guided case walkthrough |
| 🧭 **Architecture diagram** | [`docs/Chaya_Architecture.pdf`](docs/Chaya_Architecture.pdf) |
| 📊 **Presentation** | [`docs/Chaya_Presentation.pdf`](docs/Chaya_Presentation.pdf) |
| ⚖️ **License** | [MIT](LICENSE) |

---

## 1. Team

**Team name:** The Geeks · **College:** Masters' Union, Gurugram

| Member | Role | Programme | Email |
|---|---|---|---|
| R. E. Sai Harsha Sadhu | Team leader | PGP TBM, Masters' Union | harsha.sadhu2027@mastersunion.org |
| Sanskriti Saraf | Member | PGP TBM, Masters' Union | sanskriti.saraf2027@mastersunion.org |
| Muskan Sharma | Member | PGP TBM, Masters' Union | muskan.sharma2027@mastersunion.org |

> Submission folder / repository: `TheGeeks_MastersUnion`

---

## 2. Problem statement and healthcare use case

**Condition:** Type 2 Diabetes and prediabetes in Indian adults.
**Outcome predicted:** a post-meal glucose spike (CGM > 180 mg/dL) **within the next 2 hours**, predicted while glucose is still in range.

**Why it matters**
- India has **101 million** people with diabetes and **136 million** with prediabetes ([ICMR-INDIAB, *Lancet Diabetes & Endocrinology*, 2023](https://morungexpress.com/315-mn-indians-suffer-from-hypertension-101-mn-are-diabetic-icmr-study)).
- Indian diets draw about **62% of calories from carbohydrates** ([ICMR-INDIAB, *Nature Medicine*, 2025](https://www.downtoearth.org.in/amp/story/food/indian-diets-heavy-on-carbs-and-sugar-linked-to-surge-in-diabetes-study-finds)), so post-meal spikes are the daily problem.
- Care is reactive. An HbA1c every three months averages away hundreds of meals, and the doctor sees none of them.
- South Asian physiology differs: more insulin resistance at a lower BMI. Generic risk scores under-call Indian patients.

**Use case:** a diabetologist or care coordinator monitors a panel of CGM-wearing patients. Chaya ranks patients by risk, raises an alert ~2 hours before a likely spike with the reasons behind it, and lets the doctor test lifestyle and medication changes on the patient's twin before advising them.

---

## 3. What makes it a digital twin

| Layer | What it does |
|---|---|
| **Physiology core** | Extended Bergman minimal model: gut absorption (GI-dependent), glucose ⇄ insulin dynamics, β-cell secretion, dawn phenomenon, exercise effect, sleep-debt and missed-dose modifiers ([`physiology.py`](src/chaya/physiology.py)) |
| **EHR prior** (static stream) | BMI, waist, HbA1c, fasting glucose, diabetes duration, TCF7L2 genotype and medications give a starting estimate of each patient's physiology |
| **Calibration** (dynamic stream) | MAP fit to the first 7 days of CGM, meals, steps, sleep and medication logs → personal insulin sensitivity, β-cell response, basal glucose, meal bioavailability, dawn effect |
| **State observer** | Runs alongside live CGM, corrects its state and **detects unlogged meals** |
| **Habit model** | Learns when and how much this person usually eats |
| **Forecast & what-if** | Simulates 2–4 h ahead under the usual routine or any scenario a clinician enters (mirrored exactly in the browser) |
| **Hybrid ML** | LightGBM on fused EHR + wearable + twin features, with SHAP explanations grouped into clinical drivers |

---

## 4. Results (45 held-out patients, never seen in training)

**Evaluation protocol:** patient-level split (105 train / 45 test, stratified). Within each patient, days 1–7 calibrate the twin and days 8–14 are predicted. The alert threshold is chosen on training-patient folds only. Predictions are made every 15 minutes while glucose is below 180.

### Spike prediction (> 180 mg/dL within 2 h)

| Model | Data used | AUROC | AUPRC |
|---|---|---|---|
| CGM trend extrapolation | CGM | 0.645 | 0.505 |
| Twin physics only, **no training data** | EHR + wearables via the twin | 0.819 | 0.730 |
| EHR only | static | 0.876 | 0.789 |
| Wearables only | dynamic | 0.936 | 0.872 |
| Fusion, no twin | EHR + wearables | 0.934 | 0.869 |
| **Chaya (fusion + twin)** | **EHR + wearables + twin** | **0.942** | **0.880** |

At the operating threshold: **sensitivity 83%, precision 79%, specificity 90%**. **98%** of spike onsets are flagged ≥ 15 min ahead and **87% ≥ 60 min ahead**, with about 4 alert episodes per patient-day.

### 2-hour glucose forecast

| Model | RMSE (mg/dL) | MARD | Clarke A | Clarke A+B |
|---|---|---|---|---|
| Persistence (glucose stays where it is) | 53.2 | 23.4% | 54.7% | 94.1% |
| Twin physics only | 30.4 | 11.4% | 81.7% | 98.1% |
| ML fusion, no twin | 25.7 | 10.7% | 85.7% | 99.2% |
| **Chaya hybrid** | **24.3** | **9.5%** | **88.0%** | **99.3%** |

### Does the twin learn the real person?
Synthetic data lets us check the twin against each patient's hidden true physiology. Correlation of estimate with truth:

| Parameter | EHR prior only | Calibrated twin |
|---|---|---|
| Basal glucose | 0.77 | **0.99** |
| Insulin sensitivity | 0.75 | **0.84** |
| β-cell response | 0.88 | **0.91** |

### When does the twin matter most?
With few training patients, the twin's physics carries knowledge the ML has not learned yet. With 5 training patients, AUROC rises from 0.873 to 0.893, and the gap narrows as data grows ([`reports/figures/learning_curve.png`](reports/figures/learning_curve.png)). This matters for a new clinic or a newly onboarded patient. The twin also enables what-if simulation, which a black-box model cannot do.

All numbers are in [`reports/metrics.json`](reports/metrics.json); figures are in [`reports/figures/`](reports/figures).

---

## 5. Data (sandbox rules)

**No real patient data is used.** Everything is synthetic, in line with the DPDP Act 2023 and HIPAA constraints in the challenge rules.

We wrote our own generator ([`cohort.py`](src/chaya/cohort.py)) instead of using Synthea alone, because the challenge is about Indian patients and we needed:
- **Static EHR:** 150 adults across 13 Indian cities; South Asian BMI and waist distributions; T2D (76%) and prediabetes; hypertension, dyslipidaemia, NAFLD; Indian prescribing patterns (metformin, glimepiride, teneligliptin/sitagliptin, dapagliflozin, glargine); TCF7L2 rs7903146 genotype; HbA1c, fasting glucose, lipids, eGFR, ALT, BP. Exported as **FHIR R4 bundles** with LOINC and SNOMED codes ([`data/ehr/fhir/`](data/ehr/fhir)).
- **Dynamic wearables:** 14 days at 5-minute resolution, 604,800 rows: CGM, steps, heart rate, nightly HRV (RMSSD) and sleep stages, plus meal and medication logs.
- **Indian context:** 38 regional dishes with carbs and glycaemic index (idli-sambar, poha, rajma chawal, curd rice, ragi mudde, biryani…), late dinners, evening chai, a festival day with sweets.
- **Physiological consistency:** CGM is simulated from each patient's hidden physiology, and lab HbA1c and fasting glucose are derived from the simulated glucose, so the two streams agree with each other.
- **Real-world mess:** patients log 45–98% of meals and under-estimate carbs, miss metformin doses, and sleep badly (which lowers insulin sensitivity the next day); the CGM has sensor lag, noise, drift and dropouts.

Hidden ground truth (true meals, true physiology) sits in `data/_ground_truth/` and is used **only** for validation, never as model input.

---

## 6. Technical stack

| Area | Tools |
|---|---|
| Simulation & twin | Python 3.11+, NumPy, **Numba** (JIT ODE integration), SciPy (Nelder-Mead MAP calibration) |
| ML | **LightGBM** (binary classifier + L1 regressor), Tree SHAP via `pred_contrib`, scikit-learn metrics |
| Data | pandas, PyArrow/Parquet, FHIR R4 JSON |
| Backend | **FastAPI** + Uvicorn, **SQLAlchemy 2** |
| Database | **Supabase Postgres** (live), PostgreSQL on Railway, or SQLite automatically when `DATABASE_URL` is not set |
| Web app | Plain HTML/CSS/JS + **D3.js**, no build step. The twin simulator is re-implemented in JS and matches Python to 0.1 mg/dL |
| Hosting | **Vercel** (web app + Node API function, `web/vercel.json`); Railway alternative (Dockerfile + `railway.json`) |
| Docs | Matplotlib, Playwright (HTML → PDF) |

---

## 7. The app

**Home** (`/`) explains the product with a working forecast slip: change Sanjay's lunch and the twin redraws his next four hours.

**Clinic** (`/#/clinic`) is the clinician console:
- **Register**: patients ranked by spike warnings this week, with time-in-range bars.
- **Replay clock**: one synthetic week (Mon 14 – Sun 20 Sep 2026); everything shows only what Chaya knew at that moment.
- **Case sheet**: KPIs, the day trace with Chaya's violet 2-hour forecast, meals (logged and ones the twin noticed), steps, sleep, the health record and saved case notes.
- **Next 2 hours**: a stamp (Spike likely, Watch, In range, Above range, No signal), probability, 2-hour glucose, forecast peak, the three reasons and "Mark warning as reviewed".
- **Patient's twin**: insulin sensitivity, insulin response and resting glucose against the cohort and the EHR-only estimate.
- **Rx pad**: write advice (meal, timing, walk, sleep, metformin), see the four-hour simulation, then **save and send it to the patient**: it is stored in the case notes in the database and appears in the patient app.
- **Sources** buttons on every panel, and LOINC codes on every health-record field, open where that number comes from.

**Patient app** (`/#/patient/GT-1102`) is what the patient sees on their phone, shown in a phone frame on desktop and full-screen on mobile:
- **Today**: current glucose from the sensor with a trend arrow, the last three hours and the next two as a violet shadow, a plain-language heads-up, steps, sleep, doses and today's meals.
- **Advice**: every note the doctor saved on the Rx pad, in handwriting, with what the twin projects it will do; the patient taps *Got it*.
- **Week**: time in range day by day, average glucose, GMI against the last lab HbA1c, sleep and steps.
- **My data**: each connected device and record (CGM, smartwatch, meal log, medicine log, ABHA-linked health record) with when it last sent data.
- No risk percentages, twin parameters or other patients are shown to the patient.

**Data sources** (`/#/data`) lists all 23 parameters Chaya monitors, grouped into wearables, patient app logs, the health record and values computed by Chaya. Each has what it is used for, where this prototype gets it (file and simulation details), where it would come from in a clinic (device, API, ABDM), its standard code (LOINC, SNOMED CT, FHIR resource) and its cadence. Opened from a case, it also shows that patient's data completeness: CGM coverage, meals logged and noticed, doses and nights recorded.

**Guidance built in**: a first-visit welcome slip, a 9-stop **product tour**, a 9-step **guided case walkthrough** (Sanjay's Sunday lunch: biryani 237 → ragi mudde 194 → plus a 20-minute walk 178 mg/dL, ending on his phone), a **What's what** glossary, a **Where the data comes from** guide, and an `i` button on every panel.

## 8. Run it

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn api.server:app            # seeds a local SQLite database on first start
open http://127.0.0.1:8000
```

Rebuild everything from scratch (data → twins → models → metrics → web data, about 5 minutes): `./run_all.sh`.

### Deploy on Vercel + Supabase (live setup)

The hosted app runs the web front end on **Vercel** and stores the clinic in **Supabase Postgres**:
- `web/` is the Vercel project root. `web/api/index.js` is a Node serverless function that serves the same `/api/...` routes as `api/server.py`, reading and writing Supabase through its REST API with row-level security (read-only clinic data; clinicians can add and remove case notes and mark warnings reviewed).
- Tables: `patients` (register), `cases` (each patient's replay week as JSONB: readings, meals, predictions, twin state), `case_notes`, `alert_reviews`, `meta`.
- Environment variables on Vercel: `SUPABASE_URL`, `SUPABASE_KEY` (publishable key).
- The twin simulation runs in the browser; the full Python pipeline (`/api/pipeline/...`) runs locally or on Railway.

### Deploy on Railway (PostgreSQL)

1. Railway → **New project → Deploy from GitHub repo** → pick this repo. It builds the `Dockerfile`.
2. In the project, **+ New → Database → PostgreSQL**. In the web service's **Variables**, add `DATABASE_URL = ${{Postgres.DATABASE_URL}}`.
3. **Settings → Networking → Generate domain**. On first boot the service seeds Postgres (45 patients, about 90,000 readings) and serves the app. `GET /api/health` reports `"database": "PostgreSQL"`.

### API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/health` | Service and database status |
| GET | `/api/meta` | Week start, alert threshold, model metrics, meal catalogue |
| GET | `/api/patients` | The register |
| GET | `/api/patients/{pid}` | The full case for the replay week (readings, meals, predictions, twin) |
| POST | `/api/patients/{pid}/simulate` | Run the twin forward under advice |
| GET / POST / DELETE | `/api/patients/{pid}/notes` | Saved Rx advice with its projection |
| POST | `/api/patients/{pid}/alerts/{k}/review` | Mark a warning reviewed |
| GET | `/api/pipeline/{pid}/risk?at=ISO` | End to end from raw files: FHIR + wearables → calibrated twin → features → LightGBM |

```bash
curl "http://127.0.0.1:8000/api/pipeline/GT-1102/risk?at=2026-09-20T12:45"
curl -X POST http://127.0.0.1:8000/api/patients/GT-1102/simulate -H "Content-Type: application/json" \
     -d '{"k":1875,"carbs_g":60,"gi":55,"walk_min":20}'
```

Interactive API docs: `/docs`.

---

## 9. Repository layout

```
├── src/chaya/
│   ├── physiology.py   glucose–insulin model (Numba)
│   ├── cohort.py       synthetic Indian T2D cohort: EHR + wearables + FHIR export
│   ├── ingest.py       FHIR R4 + wearable stream ingestion
│   ├── twin.py         EHR prior, calibration, observer, habit model, forecasting
│   ├── features.py     fusion of EHR + wearable + twin features every 15 min
│   ├── model.py        LightGBM training, ablations, lead time, Clarke grid
│   ├── explain.py      SHAP → clinician-readable reasons
│   ├── db.py           SQLAlchemy models (Postgres / SQLite)
│   └── seed.py         loads the replay week into the database
├── scripts/            generate_data → build_features → train_evaluate → export_dashboard → seed_db
├── api/server.py       FastAPI: clinic API + pipeline endpoint + serves the web app
├── web/                Chaya web app (index.html, assets/, data/ for the offline fallback)
├── Dockerfile, railway.json
├── data/               synthetic EHR (CSV + FHIR), wearable streams, ground truth
├── models/             trained classifier + regressor, calibrated twin parameters (full twin states are rebuilt by run_all.sh)
├── reports/            metrics.json, figures, test predictions
├── docs/               architecture PDF, presentation PDF, video script, model card
│   └── video/          narration, subtitles and the scripts that recorded and edited the demo video
├── PRODUCT.md          product brief
└── DESIGN.md           design system (tokens, components, rules)
```

---

## 10. Limitations and next steps

- **Synthetic data.** Results show the method works and the pipeline is end-to-end, not clinical accuracy. Next: validate on public CGM datasets with wearables and meals (e.g. PhysioNet CGMacros, BIG IDEAs Lab) under their data-use terms.
- **Meal logging.** Real users log inconsistently. The twin's unlogged-meal detection helps, and photo-based logging is a natural add-on.
- **Scope.** Spikes only. The same twin can forecast hypoglycaemia for sulfonylurea and insulin users, and can be extended to hypertension.
- **Clinical use.** Decision support only, with a clinician in the loop. Not a medical device, and not for treatment decisions.

See [`docs/model_card.md`](docs/model_card.md) for intended use, risks and fairness notes.

---

## 11. License

Code and synthetic data are released under the [MIT License](LICENSE). D3.js (vendored in `web/assets/vendor/`) is ISC-licensed. Archivo, Kalam, JetBrains Mono (`web/assets/fonts/`) and IBM Plex (`docs/src/fonts/`) are under the SIL Open Font License.
