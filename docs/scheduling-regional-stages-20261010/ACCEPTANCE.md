# Regional scarcity stages — acceptance, 2026-10-10

Stabilizes national planning by staging operational blocks North → South → Center/borders while keeping one nationwide occupancy, active-only new candidates, proximity ranking (not hard geo partition), and scarcity-first ordering **inside** each region. Route-aware baseline pools are built per regional batch, not for the whole country upfront.

`ENGINE_VERSION` remains `planning-v37-20261010-constraint-block-planner` so the existing trusted SQL validator / capability handshake keep working; deployable cache markers (`HOTFIX_VERSION`, `CACHE_VERSION`) still refresh clients.

Supersedes the unproven interim measurement on PR #2253 (223 assigned / ~30.4s) that was taken **before** scarcity-within-region was restored.

## Same-input comparison

Frozen anonymous canonical fixture: `docs/scheduling-new-core-20261010/fixtures` with `DECISION_CANONICAL=1` (253 planning rows, 24 active instructors with addresses, 25 inactive excluded from new proposals, 109 `live` protected rows). Offline `scripts/acceptance/new-engine-national.mjs` + `new-engine-audit.mjs`. No production writes.

| Metric | main (full soft opt) | regional (full soft opt) | main (baseline only) | regional (baseline only) |
|---|---:|---:|---:|---:|
| Assigned activities | 228 | **233** | 223 | **229** |
| Runtime ms | 43925.8 | **34542.0** | 17983.2 | **16509.8** |
| Teaching hours | 3826.67 | **3990.17** | 3697.67 | **3928.67** |
| Final validation valid | yes | yes | yes | yes |
| Generated hard violations (independent audit) | 0 | 0 | — | — |
| Protected-source audit findings (historic) | 73 | 73 | — | — |
| Changed protected `live` projections | — | **0** | — | — |
| Pairwise instructor time overlaps | 0 | 0 | — | — |

After rebase onto latest `main`, baseline-only remeasure remained **229 assigned / 16.3s** (same coverage class as pre-rebase regional baseline).

Raw metrics and audits: `evidence/`.

## What failed before / what was kept

- Eager nationwide baseline pool generation + global ordering was expensive and mixed regional contention.
- Regional staging without scarcity ordering inside a stage let flexible courses consume scarce instructors (**223** assigned in the early PR measurement).
- Restored urgency+scarcity sort per regional batch; deferred pool generation; active-only geographic search; single shared occupancy and single final validation.

## UI

No new screen. Existing progress already surfaces the three regional phases plus final validation. No UI expansion proposed.

## Limits

- Soft optimization still reports bounded/non-optimal search (`completed:false` / `optimal:false` when budgets exhaust); valid coverage is not a global optimality certificate.
- Atomic SQL save/reload for this exact plan was not re-run here (no disposable Postgres on the agent host); the v37 save/recovery contract on the same 253-row schema remains the prior proof. Engine final validation and independent audit both passed with zero new hard violations.
- Do not merge without owner review of travel/waiting tradeoffs (coverage and hours improved; total travel km and some waiting rose with the extra assignments).

## Reproduction

```sh
# decode fixtures into DECISION_DIR per docs/scheduling-new-core-20261010/REPRODUCTION.md
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 ACCEPTANCE_OUT=/tmp/v37-regional \
  node scripts/acceptance/new-engine-national.mjs
DECISION_DIR=/tmp/v37-input DECISION_CANONICAL=1 \
  DECISION_PLAN=/tmp/v37-regional/national-plan.json \
  DECISION_AUDIT_PATH=/tmp/v37-regional/independent-audit.json \
  node scripts/acceptance/new-engine-audit.mjs
node --test --test-name-pattern="regional staging|inactive instructors|unknown-route" \
  tests/scheduling-operational-optimization.test.mjs
```
