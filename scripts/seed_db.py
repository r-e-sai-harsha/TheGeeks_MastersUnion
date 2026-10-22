"""Seed the Chaya database (Railway Postgres or local SQLite) from web/data/demo.json.

    python scripts/seed_db.py            # seeds only if empty (safe to run on every deploy)
    python scripts/seed_db.py --reset    # drop and reload everything (case notes are lost)
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from chaya.seed import seed  # noqa: E402

if __name__ == "__main__":
    seed(reset="--reset" in sys.argv)
