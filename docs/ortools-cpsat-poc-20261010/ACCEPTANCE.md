# OR-Tools CP-SAT national scheduling PoC — acceptance, 2026-10-10

Isolated prototype for GitHub issue #2257. **No production writes, migrations, UI changes, merge, or deploy.**

## Architecture

1. `scripts/ortools-poc/export-model.mjs` — builds a typed candidate model from the frozen anonymous fixture using the **same hard-constraint helpers** as v37 (`constraints.js` + `inferPlanningCourseSpec`). Only active instructors receive new candidates; 109 protected live rows are anchors.
2. `scripts/ortools-poc/solve_cpsat.py` — Google OR-Tools CP-SAT set packing: one Boolean per complete course-schedule candidate; at most one candidate/course; pairwise instructor overlap/transition conflicts; lexicographic maximize assigned → teaching minutes → minimize home-travel score.
3. Independent audit via existing `scripts/acceptance/new-engine-audit.mjs`.

## Comparison (identical fixture)

Baseline: regional JS engine evidence in `docs/scheduling-regional-stages-20261010` (**233 assigned / ~34.5s / 3990.2 teaching hours**).

| Metric | JS regional baseline | OR-Tools PoC |
|---|---:|---:|
| Assigned activities | 233 | **234** |
| Open courses assigned | 124 | **125** |
| Protected live | 109 | **109** (0 changed) |
| Teaching hours | 3990.17 | **4005.17** |
| New hard violations (audit) | 0 | **0** |
| Pairwise instructor overlaps | 0 | **0** |
| Solver status | n/a | FEASIBLE (coverage+hours stages **OPTIMAL** at 125 open / 125000 teaching minutes; travel stage FEASIBLE, not proven optimal) |
| Wall time | ~34.5s (end-to-end JS) | export ~12.8 min + solve ~265s (candidate dump + 5.1M conflict pairs dominate) |

Raw evidence: `evidence/`.

## Blockers flagged (not guessed away)

- 3 open courses remain `missing_school_data` blockers (`activity-000594`, `activity-000045`, `activity-000061`).
- 18 open courses still have zero legal candidates after catalog/`inferPlanningCourseSpec` and previous-meeting duration recovery; packing proves at most **125** open assignments under this candidate universe (OPTIMAL).

## Reproducibility

```sh
# from repo root
./scripts/ortools-poc/run.sh
# optional: ORTOOLS_OUT=/tmp/ortools-poc ORTOOLS_TIME_LIMIT=240 ORTOOLS_SEED=1
```

Pinned dependency: `scripts/ortools-poc/requirements.txt` (`ortools==9.14.6206`). Focused tests: `python3 -m unittest scripts/ortools-poc/test_solve_cpsat.py`.

## Recommendation

**GO for continued evaluation / staged integration design** — PoC beats the frozen regional baseline on coverage and teaching hours with zero new hard violations and unchanged protected lives. **NO-GO for immediate production replacement**: export/solve runtime is far above the JS path, travel lexicographic stage is not proven optimal, and integration with leases/save/UI is out of scope. Owner decides next step separately.
