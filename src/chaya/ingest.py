"""Ingestion: read the two raw streams for one patient.

Static  : FHIR R4 Bundle (Patient, Condition, MedicationStatement, Observation[LOINC])
Dynamic : 5-min wearable stream (CGM, steps, heart rate, HRV, sleep stage) + meal, medication and sleep logs
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

LOINC = {"4548-4": "hba1c_pct", "1558-6": "fasting_glucose_mgdl", "39156-5": "bmi", "8280-0": "waist_cm",
         "2571-8": "triglycerides_mgdl", "2085-9": "hdl_mgdl", "33914-3": "egfr", "8480-6": "systolic_bp"}
SNOMED = {"44054006": "T2D", "714628002": "Prediabetes", "38341003": "hypertension", "370992007": "dyslipidemia",
          "197321007": "nafld"}
DRUGS = {"Metformin": "on_metformin", "Glimepiride": "on_sulfonylurea", "Teneligliptin": "on_dpp4",
         "Dapagliflozin": "on_sglt2", "Insulin glargine": "on_basal_insulin"}


def ehr_from_fhir(bundle: dict, reference_year: int = 2026) -> pd.Series:
    row = dict(hypertension=False, dyslipidemia=False, nafld=False, condition="T2D",
               **{v: False for v in DRUGS.values()})
    for e in bundle["entry"]:
        r = e["resource"]; t = r["resourceType"]
        if t == "Patient":
            row.update(pid=r["id"], sex="F" if r["gender"] == "female" else "M",
                       age=reference_year - int(r["birthDate"][:4]), city=r["address"][0]["city"],
                       name=r["name"][0]["given"][0])
        elif t == "Condition":
            code = r["code"]["coding"][0]["code"]; v = SNOMED.get(code)
            if v in ("T2D", "Prediabetes"): row["condition"] = v
            elif v: row[v] = True
        elif t == "MedicationStatement":
            for k, v in DRUGS.items():
                if r["medicationCodeableConcept"]["text"].startswith(k): row[v] = True
        elif t == "Observation":
            if "valueString" in r:
                row["tcf7l2_rs7903146"] = r["valueString"]
            else:
                code = r["code"]["coding"][0]["code"]
                if code in LOINC: row[LOINC[code]] = r["valueQuantity"]["value"]
    return pd.Series(row)


def load_patient(pid: str, data_dir: str | Path = "data"):
    d = Path(data_dir)
    fhir = json.loads((d / "ehr/fhir" / f"{pid}.json").read_text())
    ehr = ehr_from_fhir(fhir)
    # fields the FHIR bundle carries elsewhere in a real EHR (anthropometrics, history) come from the registry table
    reg = pd.read_csv(d / "ehr/patients.csv").set_index("pid").loc[pid]
    for k in ["weight_kg", "diabetes_years", "family_history_t2d"]:
        ehr[k] = reg[k]
    w = pd.read_parquet(d / "wearables/stream_5min.parquet", filters=[("pid", "==", pid)])
    meals = pd.read_csv(d / "wearables/meal_log.csv", parse_dates=["ts"]).query("pid == @pid")
    meds = pd.read_csv(d / "wearables/medication_log.csv", parse_dates=["ts"]).query("pid == @pid")
    nights = pd.read_csv(d / "wearables/sleep_nightly.csv").query("pid == @pid")
    return ehr, w, meals, meds, nights
