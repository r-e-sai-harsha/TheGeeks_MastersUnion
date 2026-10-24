# Chaya: demo video script (about 19 minutes; the form allows 15–20)

Updated for the submission build: low-glucose warnings, escalation, clinic outcomes, alert threshold, the bilingual patient app with logging and read receipts, the new header and clinic workspace (pinned panes, ℞ dock, toast link), patient surnames, data sources and the patient app tour.

Record your voice over the slides (`docs/Chaya_Presentation.pdf`, 22 slides) and the live app (https://chaya-tau.vercel.app), then upload to YouTube as **Unlisted**. The narration is also in [`video/narration.json`](video/narration.json), one segment per shot, so the voice-over can be regenerated; this file is rebuilt from it by `python docs/video/build_script.py`. Timings assume 134 words a minute plus a 3-second pause per shot.

**Before you record**
- Open the presentation full-screen, and the live app in a private window so the welcome slip appears.
- Check the header pill says *Live · Supabase*. If it says *Offline demo*, reload once (the first request can be a cold start).
- 1080p, mic close, notifications off. A webcam bubble in a corner helps.

## Run-sheet

| Time | Shot | On screen |
|---|---|---|
| 0:00 | `01_hook` | Title slide (slide 1) or b-roll; Chaya wordmark. |
| 0:35 | `02_team` | Team card: three names, Masters' Union. |
| 1:00 | `03_problem` | Presentation slide 2. |
| 1:38 | `04_india` | Presentation slide 3. |
| 2:18 | `05_twin` | Presentation slide 4. |
| 3:16 | `06_data` | Presentation slide 5. |
| 4:11 | `07_arch` | Presentation slide 6. |
| 5:05 | `08_validity` | Presentation slide 7. |
| 5:46 | `09_results` | Presentation slide 8. |
| 6:32 | `10_fusion` | Presentation slide 9. |
| 6:58 | `11_coldstart` | Presentation slide 10. |
| 7:33 | `11b_explain` | Presentation slide 12. |
| 8:01 | `12_home` | Live app home page. On the forecast slip click **Chicken biryani** + **Rest** (SPIKE LIKELY), then **Ragi mudde** + **Walk 20 min** (IN RANGE). Scroll past the *The clinic* and *Patient app* sections. |
| 8:47 | `13_clinic` | Click **Open the simulated clinic** in the hero. Point at the header (home icon, Clinic / Patient app switcher, Outcomes, Data sources), the purple synthetic strip and the *Live · Supabase* pill. |
| 9:32 | `13b_tour` | Welcome slip → **Take the 1-minute tour**. Let it run: register pinned left, forecast and twin pinned right, ℞ *Try advice* bottom right. |
| 10:16 | `14_case_a` | **Guide → Walk through a case**, steps 1–3 (Sanjay Krishnan at 12:15; biryani 237). |
| 11:03 | `15_case_b` | Case steps 4–5 (ragi mudde 194; + 20-min walk 178, 0 min above 180). |
| 11:30 | `16_case_c` | Case steps 6–8 (12:45, SPIKE LIKELY 92%), then **Save and send to patient**. Wait for the toast. |
| 12:09 | `16b_patient` | Click **Open Sanjay's advice** in the toast → Advice tab → **Got it**. Then Today: scroll to medicines, tap **+** (log sheet, close), tap **हिं** and back to **EN**. |
| 12:55 | `17_register` | Switch to **Clinic** in the header. Sort the register by *Lowest time in range* and *Low-glucose risk*; open another patient; press **Replay** for ~15 s. |
| 13:19 | `19_review` | Click **Mark warning as reviewed**; click an **i** and a **Sources** button. |
| 13:38 | `19b_low` | Home → patient app section → **See a low-glucose warning** (Geeta Mukherjee, Mon 09:15). Show the phone, then switch to **Clinic**: LOW LIKELY stamp and reasons. |
| 14:27 | `19c_escalate` | Under *Who acts on this?* pick an owner and 15 min → **Assign and start the clock** → show **WhatsApp** and **Log a call** (log one outcome). |
| 15:00 | `20_rx` | Open ℞ **Try advice**; set metformin *Missed* and sleep 5 h; the peak rises; minimise and reopen the dock. |
| 15:38 | `20b_outcomes` | Header → **Outcomes**: TIR goal, daily TIR, low safety, alert load, funnel. Back to Clinic → **Alerts** control: *Catch more* ↔ *Fewer alerts*. |
| 16:15 | `20c_data` | Header → **Data sources**: the four groups; open one parameter. |
| 16:45 | `20d_ptour` | **Guide → Patient app tour**: click through 3–4 steps. |
| 17:04 | `22_backend` | Open `https://chaya-tau.vercel.app/api/health`; optionally local `/docs` and `/api/pipeline/GT-1102/risk?at=2026-09-20T12:45`. |
| 17:36 | `23_safety` | Presentation slide 20. |
| 18:18 | `24_roadmap` | Presentation slide 21. |
| 18:47 | `25_close` | Presentation slide 22. |

Total ≈ 19:13.

## Narration

### 0:00 · 01_hook

*Title slide (slide 1) or b-roll; Chaya wordmark.*

> Every three months, a person with diabetes in India gets one number: their H-b-A-1-c. In between, there are about two hundred and seventy meals, and the doctor sees none of them. This is Chaya. Chaya means shadow. It is a digital twin that walks two hours ahead of a patient, warns the care team before a glucose spike or a low, and puts the doctor and the patient on the same page.

### 0:35 · 02_team

*Team card: three names, Masters' Union.*

> We are The Geeks, from Masters' Union: Sanskriti Saraf, Muskan Sharma and Sai Harsha Sadhu. This is our Phase One submission for the Happiest Health Digital Twin Challenge. In this video we will show you the problem, how the twin works, how well it performs, and the working product.

### 1:00 · 03_problem

*Presentation slide 2.*

> India has about one hundred and one million people living with diabetes, and another one hundred and thirty six million with prediabetes. Indian diets get roughly sixty two percent of their calories from carbohydrates, so the real damage happens after meals, as glucose spikes, several times a day. Yet care is built around a single quarterly lab test. A doctor sees one H-b-A-1-c value, adjusts a prescription, and waits three months. Between those visits, the spikes are invisible.

### 1:38 · 04_india

*Presentation slide 3.*

> And India needs its own model. South Asians develop insulin resistance at a lower body weight, so Western risk scores under-call Indian patients. The plate is different too: rice, roti, dosa, biryani and sweets, each with its own load. And daily life matters: late dinners, short sleep, festival days and missed doses. So our use case is precise. We predict a glucose spike above one hundred and eighty milligrams per decilitre, two hours before it happens, for adults with Type Two diabetes or prediabetes.

### 2:18 · 05_twin

*Presentation slide 4.*

> Here is what a digital twin means in Chaya. Every patient gets a small physiological model of their own body: food enters the gut, glucose enters the blood, and insulin pushes it back down. Four personal numbers shape it: insulin sensitivity, how strongly the body responds to insulin; beta-cell response, how much insulin the pancreas releases; basal glucose, where the patient settles with no food; and meal absorption, with the morning dawn effect. The twin starts from the health record, the static stream, and is tuned on the first seven days of wearables, the dynamic stream. That is data fusion at the level of physiology. It also spots meals the patient forgot to log, and accounts for short sleep and missed metformin.

### 3:16 · 06_data

*Presentation slide 5.*

> Because this challenge runs in a sandbox, all of our data is synthetic. We built our own generator, because we needed Indian meals, Indian prescriptions like teneligliptin and glimepiride, late dinners and festival days, and glucose physics that stays consistent with the H-b-A-1-c in each record. The cohort has one hundred and fifty patients, fourteen days each: six hundred and four thousand eight hundred five-minute readings. It is realistically messy: patients log only some of their meals, under-estimate carbohydrates, miss doses and sleep badly, and the sensor has lag, noise and dropouts. Every health record is a FHIR R4 bundle with LOINC and SNOMED codes, so the same pipeline can later read real, consented records through ABDM.

### 4:11 · 07_arch

*Presentation slide 6.*

> This is the architecture, left to right. The health record and the wearables flow into an ingest layer, then the twin core: a prior from the record, calibration on the first week, an observer, a habit model and a forecaster. We fuse eighteen record features, twenty five wearable features and eleven from the twin. LightGBM predicts the spike and forecasts glucose two hours ahead, the same twin forecast read downwards warns of lows, and SHAP gives the reasons. The output goes to a simulated clinic and to a patient app. Page two shows the care loop, from warning to the patient reading the advice, and the deployment on Vercel in Mumbai over Supabase.

### 5:05 · 08_validity

*Presentation slide 7.*

> First, does the twin actually learn the patient? Because the data is synthetic, we know each person's true hidden physiology, so we can check. After one week of wearable data, the twin recovers basal glucose with a correlation of zero point nine nine, insulin sensitivity at zero point eight four, and beta-cell response at zero point nine one. The health record alone reaches only zero point seven seven, zero point seven five and zero point eight eight. The wearable stream is what makes the twin personal.

### 5:46 · 09_results

*Presentation slide 8.*

> Second, does it predict spikes? We tested on forty five patients the model never saw in training. The area under the R-O-C curve is zero point nine four two. Sensitivity is eighty three percent, precision is seventy nine percent, and eighty seven percent of spikes are flagged at least an hour ahead. In plain words: eight in ten spikes, warned before they happen. The two-hour glucose forecast has an error of about twenty four milligrams per decilitre, and ninety nine point three percent of forecasts land in the clinically safe zones of the Clarke error grid.

### 6:32 · 10_fusion

*Presentation slide 9.*

> Each stream adds signal. The health record alone scores zero point eight seven six. Wearables alone score zero point nine three six. The physics twin alone, with no training at all, already scores zero point eight one nine. Fusing all of them gives the best result, zero point nine four two.

### 6:58 · 11_coldstart

*Presentation slide 10.*

> So why build a twin if machine learning gets close on its own? Because real clinics start with very little data. With only five training patients, adding the twin lifts the score from zero point eight seven three to zero point eight nine three. The physics carries knowledge the data has not taught the model yet. And the twin can answer what-if questions, which a black-box classifier cannot. Let us show you.

### 7:33 · 11b_explain

*Presentation slide 12.*

> Every alert comes with its reasons. SHAP breaks each score into contributions, grouped into drivers a clinician recognises: the twin's forecast, a recent meal, activity, glucose trend, sleep, medication and meals the patient forgot to log. The twin's own forecast is the biggest single driver, so the physics is doing real work inside the model.

### 8:01 · 12_home

*Live app home page. On the forecast slip click **Chicken biryani** + **Rest** (SPIKE LIKELY), then **Ragi mudde** + **Walk 20 min** (IN RANGE). Scroll past the *The clinic* and *Patient app* sections.*

> This is Chaya, live on the web. The home page shows the product in a single card, a forecast slip for one patient at twelve fifteen, just before lunch. If he eats chicken biryani and rests, the violet shadow climbs well above one eighty, and the stamp reads spike likely. Switch to ragi mudde, a millet dish, and add a twenty-minute walk. The shadow flattens, and the stamp reads in range. Further down, the page explains how it works, where every number comes from, the evidence, and the patient app, with its own button to open it.

### 8:47 · 13_clinic

*Click **Open the simulated clinic** in the hero. Point at the header (home icon, Clinic / Patient app switcher, Outcomes, Data sources), the purple synthetic strip and the *Live · Supabase* pill.*

> Now let us open the simulated clinic, from the button at the top of the page. Inside, the header changes to a workspace: a home icon, a switch between the clinic and the patient app that keeps the same patient, and links to clinic outcomes and data sources. The strip reminds everyone that every patient here is synthetic. The pill says live, Supabase: the clinic is served by our API on Vercel, in Mumbai, next to the database. A welcome slip offers a one-minute tour, or a guided walkthrough of one patient's case.

### 9:32 · 13b_tour

*Welcome slip → **Take the 1-minute tour**. Let it run: register pinned left, forecast and twin pinned right, ℞ *Try advice* bottom right.*

> First, the one-minute product tour. The register, pinned to the left edge, ranks patients by spike warnings this week. The clock bar replays one synthetic week, and every panel shows only what Chaya knew at that moment. In the middle, the day trace draws glucose in ink and Chaya's two-hour forecast as a violet shadow. Pinned to the right, the stamp escalates from in range to spike likely, with three reasons, above the personal numbers the twin learned. And the Rx pad waits behind the Try advice button, like composing an email.

### 10:16 · 14_case_a

***Guide → Walk through a case**, steps 1–3 (Sanjay Krishnan at 12:15; biryani 237).*

> Now, from the guide menu, let us walk through Sanjay Krishnan's case. It is Sunday, twelve fifteen, and Sanjay is about to eat lunch. He is fifty three, has had Type Two diabetes for about four years, and takes metformin and glimepiride. His glucose is calm and in range. Over his first week, his twin learned that his insulin sensitivity is low, lower than his health record suggested. That is why lunch hits him hard. If he eats chicken biryani, the twin projects a peak of two hundred and thirty seven, with about two hours above one eighty.

### 11:03 · 15_case_b

*Case steps 4–5 (ragi mudde 194; + 20-min walk 178, 0 min above 180).*

> Swap the rice for ragi mudde, and the peak drops to one hundred and ninety four. Add a twenty-minute walk after lunch, and the peak falls to one hundred and seventy eight, with zero minutes above one eighty. That is advice a patient can actually follow, with a number attached for his own body.

### 11:30 · 16_case_c

*Case steps 6–8 (12:45, SPIKE LIKELY 92%), then **Save and send to patient**. Wait for the toast.*

> Now, what actually happened. At twelve forty five, Sanjay logged an eighty one gram lunch. Chaya stamped his slip spike likely, ninety two percent, and listed the reasons, forty minutes before his glucose actually crossed one eighty. That is the window a care coordinator needs to make a call. Finally, the doctor chooses save and send to patient. The advice is written to the database with the twin's projection, and a note pops up with a link: open Sanjay's advice.

### 12:09 · 16b_patient

*Click **Open Sanjay's advice** in the toast → Advice tab → **Got it**. Then Today: scroll to medicines, tap **+** (log sheet, close), tap **हिं** and back to **EN**.*

> And here is exactly what Sanjay sees on his phone. The advice arrives in his doctor's handwriting, with what it should do: a peak of about one seventy eight instead of one ninety four. He taps got it, and the clinic sees that he read it. Today shows his glucose with the same violet shadow, plain warnings, and his medicines at his own usual dose times. The plus button logs a meal in two taps, and it lands on the clinic's trace. One tap switches to Hindi. He never sees risk scores or other patients.

### 12:55 · 17_register

*Switch to **Clinic** in the header. Sort the register by *Lowest time in range* and *Low-glucose risk*; open another patient; press **Replay** for ~15 s.*

> Back in the clinic. Every patient now has a full name, so no two people in the register look alike. Sort by lowest time in range, or by low-glucose risk, and open another patient. Press replay, and watch the warnings appear before the spikes, not after them.

### 13:19 · 19_review

*Click **Mark warning as reviewed**; click an **i** and a **Sources** button.*

> Every warning can be marked as reviewed, which keeps an audit trail. And if a term is unfamiliar, each panel has a small i button, and a Sources button that shows exactly where that number comes from.

### 13:38 · 19b_low

*Home → patient app section → **See a low-glucose warning** (Geeta Mukherjee, Mon 09:15). Show the phone, then switch to **Clinic**: LOW LIKELY stamp and reasons.*

> Spikes are only half of the safety story. The same twin forecast, read downwards, warns of lows. Here is Geeta Mukherjee, on glimepiride and basal insulin, on Monday morning. Her glucose is one hundred and seven and falling, and the twin forecasts a dip to about seventy three. The stamp reads low likely, in a deep blue, with the medication listed as a reason. On her phone, the low card moves to the very top. On the held-out week, Chaya warned of seven of ten lows, a median of eighty minutes early, at about one low warning per patient a week.

### 14:27 · 19c_escalate

*Under *Who acts on this?* pick an owner and 15 min → **Assign and start the clock** → show **WhatsApp** and **Log a call** (log one outcome).*

> A warning only matters if someone acts on it. Under who acts on this, the doctor picks an owner, the care coordinator, the doctor on call or the diabetes educator, and a contact-by time. The owner can open a prefilled WhatsApp message, or log a call and its outcome. If nobody acts in time, the case goes overdue and moves to the doctor on call. Every step is stored.

### 15:00 · 20_rx

*Open ℞ **Try advice**; set metformin *Missed* and sleep 5 h; the peak rises; minimise and reopen the dock.*

> The Rx pad opens from the Try advice button at the bottom, like an email draft. It floats over the case sheet, so the forecast stays in view, and it can be minimised or closed. Set metformin to missed, and last night's sleep to five hours. The twin redraws the next four hours, and the peak rises. This is a conversation a doctor can have with a patient, using numbers for this patient's body rather than generic advice.

### 15:38 · 20b_outcomes

*Header → **Outcomes**: TIR goal, daily TIR, low safety, alert load, funnel. Back to Clinic → **Alerts** control: *Catch more* ↔ *Fewer alerts*.*

> This is what a hospital buyer would look at: clinic outcomes. Patients meeting the time-in-range goal, daily time in range, low-glucose safety, alert load, and a funnel showing whether warnings turned into action, from reviewed to seen by the patient. Back in the clinic, the alerts control sets how readily spike warnings fire: about two point six to four point six warnings per patient a day, for seventy four to ninety eight percent of spikes warned.

### 16:15 · 20c_data

*Header → **Data sources**: the four groups; open one parameter.*

> Every number has a source. The data sources page lists all twenty five parameters Chaya monitors, in four groups: wearables, patient app logs, the health record, and values Chaya computes. For each, it shows what it is used for, where this prototype gets it, where a real clinic would get it, its standard code, and how often it arrives.

### 16:45 · 20d_ptour

***Guide → Patient app tour**: click through 3–4 steps.*

> And for anyone opening the patient app cold, the guide now includes a patient app tour, eleven short steps through the reading, warnings, dose reminders, logging, advice, the week, the Hindi switch, and a low-glucose example.

### 17:04 · 22_backend

*Open `https://chaya-tau.vercel.app/api/health`; optionally local `/docs` and `/api/pipeline/GT-1102/risk?at=2026-09-20T12:45`.*

> Under the hood, this is a real backend. The health endpoint reports the database and its forty five patients. Reviews, escalations, advice, read receipts and patient logs are stored in Supabase Postgres with row-level security. Locally, a FastAPI service runs the full pipeline from a raw FHIR bundle and the wearable stream to a risk with reasons. Everything is open source under the MIT licence.

### 17:36 · 23_safety

*Presentation slide 20.*

> Chaya is built to support the doctor, not to replace them. It is decision support only, with a clinician in the loop and no dosing advice. Alerts are merged into episodes, and the clinic sets the threshold, seeing the trade-off as it does. Lows come first on the patient's screen. There is no real patient data in this prototype. When it moves to real records, consent will flow through ABDM, in line with India's Digital Personal Data Protection Act, and the system is FHIR-native from day one.

### 18:18 · 24_roadmap

*Presentation slide 21.*

> Today, the prototype covers the clinic and a bilingual patient app, for both spikes and lows, live on Vercel and Supabase. Next, we validate on public glucose datasets such as CGMacros and BIG IDEAs. Then a supervised pilot with a partner diabetes clinic. And then we extend: the WhatsApp Business API for escalations, ABDM-consented records, and a hypertension twin.

### 18:47 · 25_close

*Presentation slide 22.*

> Diabetes care in India does not have to be reactive. With Chaya, we see the spike before it happens, we make sure someone acts on it, and we show the patient how to avoid it. The live app and all our code are linked below. Thank you from The Geeks.

## What is new since the first cut of the video

| New in the product | Where it appears in this script |
|---|---|
| Header: section links on home; inside, home icon, Clinic / Patient app switcher, Outcomes, Data sources | `13_clinic` |
| Register and forecast panes pinned to the screen edges; ℞ *Try advice* dock | `13b_tour`, `20_rx` |
| *Save and send to patient* toast linking to the patient's Advice tab | `16_case_c`, `16b_patient` |
| Bilingual patient app: advice with read receipt, today, dose reminders, meal logging, Hindi | `16b_patient` |
| Surnames for every patient | `14_case_a`, `17_register` |
| Low-glucose warnings (7 of 10 lows, median 80 min ahead) | `07_arch`, `19b_low` |
| Escalation: owner, contact-by time, WhatsApp, call log | `19c_escalate` |
| Clinic outcomes and the alert threshold trade-off | `20b_outcomes` |
| Data sources page and Sources buttons | `19_review`, `20c_data` |
| Patient app tour | `20d_ptour` |
| API in Mumbai, data in Supabase | `13_clinic`, `22_backend` |

### Speaking tips
- Talk to one doctor, not to "the jury".
- Pause on each result slide for two seconds before you speak.
- If a number feels dense, say what it means: "eight in ten spikes, warned an hour early."
