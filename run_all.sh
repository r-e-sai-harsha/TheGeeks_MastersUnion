#!/usr/bin/env bash
# Reproduce everything: data -> twins -> models -> metrics/figures -> web data -> database  (~5 min on a laptop)
set -euo pipefail
cd "$(dirname "$0")"
python scripts/generate_data.py 150
python scripts/build_features.py
python -W ignore scripts/train_evaluate.py > reports/train_log.txt
python -W ignore scripts/export_dashboard.py
python scripts/seed_db.py --reset
echo "Done. Run:  uvicorn api.server:app  and open http://127.0.0.1:8000"
