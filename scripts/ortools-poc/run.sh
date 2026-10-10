#!/usr/bin/env bash
# One-command isolated OR-Tools CP-SAT PoC on the frozen anonymous fixture.
# No production writes, no merge, no deploy.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DECISION_DIR="${DECISION_DIR:-/tmp/v37-input}"
ORTOOLS_OUT="${ORTOOLS_OUT:-/tmp/ortools-poc}"
TIME_LIMIT="${ORTOOLS_TIME_LIMIT:-120}"
SEED="${ORTOOLS_SEED:-1}"
WORKERS="${ORTOOLS_WORKERS:-8}"
BASELINE_METRICS="${BASELINE_METRICS:-$ROOT/docs/scheduling-regional-stages-20261010/evidence/regional-full-metrics.json}"

mkdir -p "$DECISION_DIR" "$ORTOOLS_OUT"

if [[ ! -f "$DECISION_DIR/anonymous-snapshot.json" ]]; then
  python3 - <<PY
import base64, gzip, hashlib, json, pathlib
src = pathlib.Path("$ROOT/docs/scheduling-new-core-20261010/fixtures")
dst = pathlib.Path("$DECISION_DIR")
manifest = json.loads((src / "manifest.json").read_text())
for name, meta in manifest.items():
    b64 = src / f"{name}.gz.b64"
    if not b64.exists():
        continue
    raw = gzip.decompress(base64.b64decode(b64.read_text()))
    assert hashlib.sha256(raw).hexdigest() == meta["sha256"], name
    (dst / name).write_bytes(raw)
print("decoded fixtures into", dst)
PY
fi

python3 -m pip install -q -r "$ROOT/scripts/ortools-poc/requirements.txt"

echo "== export legal candidates via existing JS hard constraints =="
DECISION_DIR="$DECISION_DIR" DECISION_CANONICAL=1 ORTOOLS_OUT="$ORTOOLS_OUT" \
  node "$ROOT/scripts/ortools-poc/export-model.mjs"

echo "== CP-SAT set packing =="
python3 "$ROOT/scripts/ortools-poc/solve_cpsat.py" \
  --model "$ORTOOLS_OUT/ortools-model.json" \
  --out "$ORTOOLS_OUT" \
  --time-limit "$TIME_LIMIT" \
  --seed "$SEED" \
  --workers "$WORKERS"

echo "== adapt plan for independent audit =="
node "$ROOT/scripts/ortools-poc/to_audit_plan.mjs" \
  "$ORTOOLS_OUT/ortools-plan.json" \
  "$ORTOOLS_OUT/audit-plan.json"

echo "== independent audit (same as JS baseline tooling) =="
DECISION_DIR="$DECISION_DIR" DECISION_CANONICAL=1 \
  DECISION_PLAN="$ORTOOLS_OUT/audit-plan.json" \
  DECISION_AUDIT_PATH="$ORTOOLS_OUT/independent-audit.json" \
  node "$ROOT/scripts/acceptance/new-engine-audit.mjs"

echo "== compare to regional JS baseline =="
python3 "$ROOT/scripts/ortools-poc/compare_to_baseline.py" \
  --ortools-metrics "$ORTOOLS_OUT/ortools-metrics.json" \
  --baseline-metrics "$BASELINE_METRICS" \
  --out "$ORTOOLS_OUT/comparison.json"

echo "Done. Artifacts in $ORTOOLS_OUT"
