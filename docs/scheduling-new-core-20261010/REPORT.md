# New scheduling core v37 — acceptance, 10 October 2026 (Asia/Jerusalem)

Status: **draft PR for review, not ready for production**. No merge, deployment, production migration or production data writes. Reuses the existing screen, saved-workspace revisions/leases/checkpoints, route broker and PR #2229 Worker scaffolding without merging that PR. Replaces the product planning entry point with a new constraint-first block planner; does not rewrite the application.

## Implemented

`frontend/src/screens/scheduling-core/{planner,constraints,recruitment}.js`: compiled context, immutable approved/fixed anchors (all 35 official dates), legal candidate generation, scarcity/block ordering, bounded displacement optimization, independent final validation and explicit unfilled reasons/recruitment requirements. Friday requires a separate true permission. Saturday requires explicit availability and Arab/Druze activity. Jewish, general and unknown sectors cannot use Saturday.

`course-scheduling-planning.js` adapts the existing API/checkpoint system to v37. `course-scheduling-planning-store.js` computes date-specific changes and transitive occupied-resource dependencies through protected rows. The Worker/client/protocol/workspace modules keep calculation off the Main Thread; national execution is an explicit API and point requests cannot silently expand to national execution. Cancellation/crash never commits provisional results. The UI retains saved views, lazy details, search, paging and Excel; capability handshake fails closed if trusted v37 validation is absent.

The isolated, CLI-generated SQL migration adds private source-authoritative validation around all three existing fenced writers, atomic rollback, immutable source identities/dates, external blockers and capability RPCs. Source authority comes from database records, not client `kind` labels or new locks. Existing permissions, leases and revision fences remain. SQL definition patching fails if installed hard-eligibility bodies drift; deployment review is required. **Migration was applied only in disposable local PostgreSQL.**

Cache release marker and Service Worker cache version updated. No source activities, approved assignments, drafts, dates, overrides or production checkpoints were changed.

## Actual paired representative measurements

Same frozen anonymous input, canonical locations, routes, fast profile and machine. Current-year planning has 253 activities and 49 instructors in the source export; 24 are active under canonical filtering. Both runs used preloaded routes: 0 DB requests during engine calculation. One fresh national run per engine; national values are not p95 claims.

| Metric | Existing v36 | New v37 |
|---|---:|---:|
| Wall time | 43,005.02 ms | 11,863.18 ms |
| CPU | 41,675.81 ms | 11,600.81 ms |
| OS process peak RSS | 550,240 KiB | 399,816 KiB |
| Covered activities | 198 / 253 | 226 / 253 |
| Meeting hours | 3,250.33 | 3,766.67 |
| Independent newly generated violations | 59 | 0 |
| Independent protected-source findings | 117 | 73 |

Wall time reduced 72.4%, peak RSS 27.3%; 28 additional activities covered. Increased hours also include restoration of protected official meetings omitted by the old plan, not solely optimization gains. Context 15.18 ms, 41,719 candidate checks, final validation 46.28 ms, optimization 5,041.63 ms. Optimization reaches its 5-second budget and returns the best **already validated** base, not a claim of global optimality. 27 unfilled: 14 recruitment requirements and 13 missing-data/incomplete cases. Five compatible recruitment profiles are a feasible upper bound, not a proof of minimum staffing. Candidate/optimization budgets cannot establish that every possible legal alternative was exhausted.

73 protected-source findings (16 home-distance, 21 availability, one calendar end time, 35 transitions) pre-existed and are preserved visibly rather than silently repaired. They prevent certifying all source history as legal. The core's warning count differs from the independent arithmetic audit because checks and granularity differ. The shared new Friday/Saturday policy is applied to both compared plans.

`activities.csv` reports each of the 253 activities/reasons/issues. `instructors.csv` reports all 49 instructors, hours and availability denominator. Denominator covers declared weekly windows plus date exceptions; it is not adjusted for every sector holiday. Independent travel observations total 9,254.197 km across 707 observations (old: 8,138.28 km/506). These include course-home/adjacent observations, **not complete daily round-trip mileage**, so they are not a normalized travel-quality win.

## Relevant checks actually run

- New-core unit/regression: **24 passed**; matching policy: **14 passed**; shared planning contracts: **10 passed**. Targeted date-adjustments, stage2 and PWA files also passed. Final build and changed-file checks are recorded separately; no full legacy suite or new heavy automatic workflow.
- Actual Worker endpoint: 21 point samples, 20 warm; warm p95 **256.02 ms**, each calculates one activity and validates the whole result. Real national Worker result matches direct baseline rows, ~8.53 s, 146 progress events. No hidden national execution from point requests.
- Representative date block: **89 affected/89 computed**, 8.52 s with other acceptance processes running; official dates and all 109 visible protected assignments preserved. This is a broad genuine dependency closure, not a single-activity latency claim.
- Actual local PostgreSQL 17 RPCs: **16 passed**, including full snapshot/incremental/checkpoint save, reload parity for all 253 rows, denied access, protected identity/date tampering, newly locked invalid candidates, cancellation, engine downgrade and rollback. Representative checkpoint commit 3,774.83 ms under concurrent acceptance load. Identities are modeled test users; authenticated/anonymous SQL roles and grants were exercised. This is **not a full deployed Supabase Auth/RLS instance with three real user sessions**.
- Chromium real screen, isolated RPC stub: warm point p95 **145.70 ms desktop / 591.10 ms mobile CPU4**; UI input-to-paint p95 **38.70 / 77.30 ms**, 80 actual search/open/navigation/edit actions per device during artificial 30-second Worker CPU stress. Cancellation **548.9 / 735.7 ms**, saved rows unchanged and zero commits. CDP throttling of Worker CPU is not established.
- Run-button start feedback, 20 samples/device: desktop p95 **34.5 ms**, mobile **131.2 ms**, so the mobile 100 ms start goal is **not met** (cold maximum 254.6 ms). Cancellation before compute completion makes zero writes.
- Real UI Excel download and parsing passed on both devices: 3 sheets, **253 work-plan rows / 759 alternatives / 2,024 instructor-system rows**. Worker crash, permission denial, stale source and browser close/reopen preserve the saved 253-row plan with no commit.
- Browser offline route lookup rejects; online retry returns one valid assignment; saved plan unchanged on desktop and mobile. No assumption that failed routing returns a valid plan.
- Real process `SIGKILL` after 12 provisional rows: incomplete checkpoint rejected, no partial commit, safe full rebuild produces 253 validated rows. This demonstrates safe restart, **not incremental recovery from that partial checkpoint**. Matching complete v37 checkpoints accepted; old engine/stale source/corrupt timing rejected.

Early failed checks were corrected in the acceptance harness (RPC envelope and timestamp precision, expected offline rejection and whole-plan partial-checkpoint rejection) or obsolete source assertions (Friday permission and display-only loading). They are not represented as product fixes. New edge regressions cover seconds precision, explicit Saturday exceptions and source co-teachers.

## Open acceptance gates / recommendation

Review the new engine and measured coverage/constraint improvements now; **do not merge or deploy yet**. Remaining gates: fix the mobile start-feedback p95, run complete national computation through the full real interface with a real isolated Supabase Auth stack and three role sessions, and prove source-version conflicts/two managers through that complete stack. Current full-interface CPU-stress tests and actual Worker/SQL tests are separate evidence, not a claim that this combined scenario has passed. No server infrastructure was built; closing the browser stops its Worker. Partial checkpoint recovery currently safely rebuilds rather than continuing partial progress. Protected-source violations require an explicit business treatment outside this preservation task.

All measurements and reproductions are under `evidence/`, with anonymous fixture hashes under `fixtures/manifest.json`. No production migration is authorized by this PR.

Publication check: the first GitHub basic check found trailing spaces in a captured Vite log and one seed-script line. Whitespace was normalized without changing results or runtime behavior; no build or business-test rerun was needed.
