"""Step 1: generate the synthetic Indian T2D cohort (static EHR + 14 days of wearable streams)."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from chaya.cohort import generate_cohort  # noqa: E402

if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 150
    generate_cohort(n_patients=n, seed=7, out_dir=ROOT / "data")
    print(f"Generated {n} synthetic patients in data/")
