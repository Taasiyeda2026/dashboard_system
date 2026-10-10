# v37 operational optimization — review snapshot, 2026-10-10

Work stopped at the owner's cost-control boundary. No further optimization or national run was performed after that instruction. This PR preserves the developed version and its existing measurements; it is not a claim of improved execution speed or globally optimal coverage.

## Existing measured comparison

Sequential, uncontended runs on the same anonymous canonical 253-activity input and frozen lawful v37 incumbent. The baseline planner matches the main planner at base commit 4106b0f. These are historical representative fixtures, not a fresh production snapshot. `evidence/comparison.json` includes input hashes, individual instructor availability/utilization, operational metrics, protected projections and independent audit findings.

| Metric | Before | After |
|---|---:|---:|
| Assigned activities | 225 | 228 |
| Unassigned activities | 28 | 25 |
| Teaching hours | 3745.67 | 3826.67 |
| Availability utilization | 12.0335% | 12.2937% |
| Waiting minutes | 17848 | 16262 |
| Split days | 195 | 186 |
| Same-school sequences | 868 | 926 |
| Travel minutes | 63203 | 64131 |
| Travel km | 54229.161 | 55219.693 |
| Runtime ms | 14039.383 | 51361.429 |
| New generated constraint violations | 0 | 0 |
| Changed protected rows | 0 | 0 |

109 visible protected schedules retain identical business projections; the engine also considers external protected anchors. Historic protected audit findings remain unchanged (73); they are not newly introduced violations. Travel includes verified home round trips and school-to-school legs. Raw weekly availability is not reduced by sector holidays or travel, and reported free windows are not certified feasible course slots.

## Developed changes retained

- `planner.js`: scarce-instructor ordering, opportunity costs, legal incumbent preservation, staged bounded augmenting/quality search, consistent final validation and valid-base fallback. Official dates and immutable anchors remain protected.
- `augmenting-search.js`: private-branch multi-activity relocation; partial chains never become accepted plans.
- `quality.js`: lexicographic coverage/hours before waiting, continuity and verified travel, including per-instructor measurements.
- `rejection-reasons.js`: actionable Hebrew rejection descriptions without claiming exhaustive infeasibility.
- Focused acceptance and comparison scripts plus operational regressions. Required frontend cache markers refreshed; no UI redesign, new infrastructure or SQL migration.

## Final two regression repairs only

1. Zero optimization budget previously bypassed the failure marker when no search node ran. It now returns the verified base with `planning_optimization_budget_exceeded`. Cancellation takes precedence and throws `planning_cancelled`, rather than leaking a budget error.
2. Point recalculation previously allowed a teacher with more than two blocked incumbent meetings to reappear through unrestricted shifted-series generation. The point candidate filter now excludes that incumbent under the existing non-recoverable policy. At most two recoverable exceptions retain the permanent teacher; official dates cannot move.

Only the two affected test names were executed after these repairs: **2 passed, 0 failed**, 179.9ms total. The preceding broader run had 37 passed and these two failures out of 39; it was not rerun under the owner's focused-test instruction. Final changes affect explicit zero-budget/cancellation or point-recalculation paths, not the default national path, so the existing national measurements were retained without rerunning 253 activities.

## Single save/recovery acceptance

Existing disposable localhost PostgreSQL, real existing checkpoint and atomic commit RPCs, explicitly modeled admin identity (not live Supabase Auth). Used the already-computed 253-row plan: save **2706.57ms**, full reload deep equality, durable validated checkpoint, client disconnect/reconnect, recovered commit, full reload deep equality. Passed; revisions 4 then 5. No planning engine invocation, production connection, schema migration or production data mutation.

## Limits / recommendation

Submit for review; **do not merge without owner approval of tradeoffs**. Runtime increased about 3.66x and total travel rose with coverage. Search reports `completed:false`, `optimal:false` with bounded-stage exhaustion; valid output is not proof that no legal unused alternative exists. Fourteen recruitment outcomes remain unproven exhaustive infeasibility. No fresh national rerun, new build, full GUI/Worker test, full legacy suite, or deployed Supabase authentication acceptance was performed after the stop instruction. Existing measurement files describe the measured revision before the two narrowly scoped final repairs. No merge or deployment performed.
