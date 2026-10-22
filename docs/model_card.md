# Model card: Chaya

**Intended use.** Clinical decision support for diabetologists and care coordinators monitoring adults with Type 2 Diabetes or prediabetes who wear a CGM. It flags a likely glucose spike (> 180 mg/dL) up to 2 hours ahead, explains the drivers, and simulates lifestyle and medication scenarios.

**Not intended for:** insulin dosing, Type 1 Diabetes, children, pregnancy, or any automated treatment decision. Prototype only; not a medical device.

**Models**
- Per-patient physiological twin (extended Bergman minimal model), MAP-calibrated on 7 days of data.
- LightGBM binary classifier (spike within 2 h) and LightGBM L1 regressor (glucose at +2 h) on 54 fused features (18 EHR, 25 wearable, 11 twin).

**Training data.** Fully synthetic: 150 Indian adults, 14 days each (see README §5). No real patient data.

**Evaluation.** 45 held-out patients, days 8–14. AUROC 0.942, sensitivity 83%, precision 79%; 2-h forecast RMSE 24.3 mg/dL, Clarke A+B 99.3%. Full results in `reports/metrics.json`.

**Known limitations and risks**
- Performance on real patients is unknown until validated on real CGM datasets.
- Synthetic behaviour reflects our assumptions about Indian diets and routines; regional and socioeconomic variety is simplified.
- Alert fatigue: about 4 alert episodes per patient-day at the current threshold. The threshold can be tuned per clinic.
- Relies on meal logging. Unlogged meals are partly recovered by the twin's observer.

**Fairness checks to run on real data:** performance by sex, age band, region, diet (vegetarian / non-vegetarian), BMI band and diabetes duration.

**Privacy.** FHIR-native, so it can work with consented records through ABDM. Designed for DPDP Act 2023 compliance: purpose limitation, consent and data minimisation.
