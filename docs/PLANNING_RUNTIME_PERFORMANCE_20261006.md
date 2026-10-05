# Planning runtime performance and ownership — 20261006

This change makes NO-OP authoritative before heavy reads, keeps lease timers responsive during CPU work, reduces repeated national context preparation, and fences every planning write. It preserves the v28 business rules and PR #2114 route batching. No production migration, deployment or merge was performed.

## Verified causes and limits

The original lease lasted 900 seconds, renewed every 120 seconds, did not detect stale heartbeats independently of expiry, and did not fence snapshot/checkpoint writes. Its renewal result was ignored. A closed or suspended page could therefore leave the scope blocked for the remaining lease duration, while another stale run could continue calculating.

A real Chromium 151 check found a separate timer starvation defect: `scheduler.yield()` continuations let the cooperative planner continue while timers did not execute. Five warm-route activities took 977.4 ms with zero timer ticks; a cancellation timer never fired during a 222.8 ms history preparation. The corrected timer-queue yield produced 132 ticks during the same five-activity check, maximum timer delay 14.3 ms, and cancellation in 17.4 ms. Both produced five proposals and made zero route service calls. The corrected check took 1,361.9 ms: yielding to timers has a measurable cost and provides actual responsiveness.

The engine also rebuilt national contexts 318 times, repeatedly normalized the same strings, recomputed difficulty/gap sort keys inside comparators, recalculated instructor historical loads for each candidate, and rescanned school-independent provisional context. The new code reuses indexes and applies instructor deltas. The baseline's 100 ms timer probe showed a 42.7 ms maximum delay; this synthetic Node fixture does **not** reproduce the reported multi-minute production stall.

The exact reason the historical run stopped after checkpoint 50/175 remains unverified. Tab suspension/closure, priority starvation, a particular CPU-heavy input, and a live RPC problem cannot be distinguished from the supplied timestamps alone. Authenticated Supabase/database/log access is still missing; the environment requirement `SUPABASE_ACCESS_TOKEN` has no saved binding. Local PostgreSQL and real Chromium evidence must not be represented as production log verification.

## Reproducible before/after

Baseline source: `1c7f6a336912d848efd02b8e0f8b11d126425e0c`. Node 24.19.0. Fixture: 175 flexible activities, 35 schools, 24 ready instructors, eight meetings per activity, fixed reference date 2026-09-29, fast UI profile and 3,422 warm ordered route pairs. These measurements call the engine, with no database or network I/O. Single/three-row increments reuse the full result and allow only the requested scopes and real optimization dependencies.

| Scenario | Before | After | Reduction | Full context builds | Activities calculated |
|---|---:|---:|---:|---:|---:|
| full-175 | 269.840s | 133.170s | 50.6% | 318 → 3 | 175 |
| one-dirty | 2.067s | 0.837s | 59.5% | 2 → 2 | 1 |
| three-dirty | 7.602s | 3.854s | 49.3% | 6 → 2 | 3 |

The SHA-256 signatures of sorted activity ID, kind, assigned instructor and meetings match exactly before/after in all three scenarios. Full output: 161 proposals and 14 recruitment rows. Full-run search volume is unchanged: 117,829 candidate evaluations, 4,751 preliminary calls/scenarios, 4,452 schedule calls, 4,046 route requests and 4,458 final validations. There are 35 isolated school forks and 246 instructor context updates, instead of national rebuilds. All scenarios make zero Google/service calls. Full-run maximum 100 ms timer delay is 38.65 ms; maximum measured synchronous cooperative core/scoring step is 17.63 ms. The latter excludes synchronous helpers in other modules; the timer probe covers the whole engine but is not a browser Long Task trace.

Raw counts, phase durations, timers and signatures: [before](PLANNING_RUNTIME_20261006.before.json) and [after](PLANNING_RUNTIME_20261006.after.json).

Manual reproduction from the checkout:

```sh
BENCH_OUTPUT=/tmp/planning-after.json node scripts/benchmark-planning-runtime.mjs
# Point to a source archive of the baseline, with its dependencies available:
BENCH_ENGINE_ROOT=/path/to/baseline BENCH_OUTPUT=/tmp/planning-before.json node scripts/benchmark-planning-runtime.mjs
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
# In another terminal, Chromium must be installed:
node scripts/verify-planning-browser-runtime.mjs
```

The baseline was first measured for counters (267.9 s), then rerun with plan signatures and incremental scenarios because the first capture did not establish exact output equivalence. After measurements were repeated only after relevant context/cooperative code changes. The accepted final capture follows the recruitment-loop changes. It is an engine measurement; live snapshot latency, real Edge cache misses, actual UI checkpoints and production rendering remain unmeasured.

## Fast path, invalidation and persistence

The new preflight is one permission-checked SQL snapshot returning less than 1 KiB in the native fixture. Direct local PostgreSQL readings were approximately 2–4 ms. The test verifies one read and zero acquisitions for matching engine + validated source revision + dirty=0, and no planner/snapshot/route callbacks through the gate. A busy lease is checked before acquisition and before heavy reads. `forceFull` still requires the explicit maintenance flow; the ordinary retry handler remains `forceFull:false`.

An existing workspace has no validated source cursor when this migration is installed. It requires a single full **bootstrap validation**, including current route facts, before the fast path can certify it. An empty incremental marker cannot establish that proof. This is a schema currency transition, not an engine-upgrade or generic `contextChanged` trigger. Subsequent single-row changes stay incremental. A checkpoint alone never certifies the source or advances the engine.

The singleton source revision changes in the same transaction as relevant source mutations. Before-statement source locking and canonical source-before-workspace lock order prevent lock inversion with legacy invalidation triggers. Joined school/address inputs, comma-separated completion IDs, new eligible instructors and route fact changes receive granular invalidation; legacy instructor/date/school dependency rules are retained. Route insertion warms the derived cache and dirties related missing/recruitment rows; identical renewal metadata does not abort a run. The journal covers existing source tables; any future source-table migration must attach the same hooks.

Heavy snapshot reads are bracketed by cheap source/workspace checks. Planning reads a fresh calendar and rejects source read failures, rather than certifying cached or empty fallback data. Canonical commits require expected workspace revision, authenticated run owner, live lease and the unchanged source revision. SQL checks ownership before and after writing. Old-owner full/incremental saves, heartbeat and checkpoint writes/clears are rejected after takeover. Retry text uses the server's actual retry timestamp.

Lease defaults: 120 s expiry, 15 s renewal, 10 s renewal deadline, 60 s stale-heartbeat reclaim. Heartbeats are serialized and failures abort the current run. Cancel/error/success release in finally; pagehide stops renewal and sends a best-effort release. Browser termination cannot guarantee delivery, so stale reclaim is the remaining bound. A lost owner neither applies stale UI results nor continues recovery writes.

Checkpoint proposals live in `scheduling_planning_checkpoint_rows`; the parent contains metadata and actual persisted IDs/counts. Progress sends changed rows every ten completed courses or 15 elapsed seconds at a progress boundary. Stage snapshots and validated saves are chunked to at most ten activities and a 256 KiB target **entire request** size; one oversized activity may use up to 1 MiB, larger payloads fail explicitly. The server also enforces size/count limits. The first chunks remain running; only the complete final chunk can be validated. Resume checks source revision, workspace revision, engine, fingerprints, phase, required rows and scope. Network checkpoint failures remain best-effort; ownership/source/revision failures stop immediately. A single long course may delay a progress checkpoint until its next reporting boundary, while heartbeat timers continue independently.

## Hot-path audit and constraints

- Context preparation/virtual additions: instructor histories and meetings yield internally; school forks copy assignment arrays; accepted deltas update only affected instructor revisions. Exceptions keep a global cache revision because substitutes can depend on another instructor.
- Candidates: cooperative per-instructor core evaluation and preliminary scoring; load projection reuses the baseline and preserves public load results, including draft dates in instructor history. A native test combines real PostgreSQL renewals/takeover with 6,000 CPU-heavy candidates.
- Scenarios: generator boundaries inside instructor/meeting heuristic loops, memoization by weekday/time for identical heuristics and availability coverage, difficulty keys prepared once.
- School packing: existing cooperative exact/beam searches and bounded local repair retained; independent school contexts no longer rebuild national indexes.
- Workday consolidation/gap compaction: latest-row context is synchronized by instructor deltas; gap sort values computed once per pass. Acceptance objectives remain unchanged.
- Recruitment rescue/profile assignment: generators yield within history comparisons and candidate schedule loops, including cancellation inside a single instructor's rescue history.
- Final coherence: cooperative row/date/pair traversal and unchanged hard validators. Routing still batches on demand and never preloads the full route table for planning.

Eligibility/scoring/hard-rule definitions were not weakened: active/ready profiles, language/gender, blocked authorities, weekly availability and exceptions, school calendars/sector/early finish, Friday/Saturday, official dates, live/locked anchors, 40 km automatic home gate, 20 km transitions and distance-dependent travel buffers, consecutive work, school packing and existing staff before recruitment are covered by the selected regression tests. Individual synchronous third-party scoring/gate helpers and native sorts still execute between cooperative boundaries; the measured budgets are observations, not a proof for arbitrary input size or hardware.

## Validation and review status

The selected existing planning/scheduling regression command executed 264 cases: 258 passed initially. Three assertions affected by this change were updated and passed separately, leaving 261 passing and three **pre-existing** legacy failures:

1. `course-scheduling-half-year`: expects score/scoreBreakdown null, although the existing adapter computes the approved rubric. The same failure was reproduced against the untouched baseline source; workload checks still pass.
2. `course-scheduling-planning-v26`: its source regex expects `snapshotRows` after a stage label; both baseline and new source pass the snapshot as the positional argument to `report`.
3. `course-scheduling-shared-planning`: its source regex requires literal numeric concurrency; both baseline and new source use the existing bounded 6/8 conditional.

No baseline/fixture was changed to hide these failures. Further checks: ten prepared-context/cooperative cancellation cases; sixteen new runtime/chunk/bootstrap/load-equivalence cases; sixteen real PostgreSQL source/preflight/lease/checkpoint/ownership cases; thirteen existing PostgreSQL invalidation cases; seventeen recruitment/rescue cases after their loop changes; real Chromium timer/cancellation check; six PWA/cache checks; changed-file Quick CI and staged production build. Focused reruns were required after relevant SQL/heartbeat/bootstrap changes or to repair a failing changed contract. The new draft-history case initially used a draft as the planning target, which the existing eligibility rule excludes; it was corrected to test an eligible target against draft history and passed. Builds were repeated after late ownership/bootstrap orchestration and load-projection changes. Quick CI also invokes the repository build; its generated tracked `dist` changes were restored, and later builds used an external source copy. No generated `dist` changes are included in the PR.

The initial PR check also exercised scheduling contracts outside the selected regression command. Local execution of the previously unchecked cases ran 235 cases: 234 passed, and one scroll-stability source contract still used the removed full-snapshot end marker. Its slice boundary now uses the authoritative end-preflight call; all assertions about in-place progress and scroll preservation are retained. That single case passed after the contract update. The existing GitHub PostgreSQL job passed on the initial PR head.

Changed areas: `course-scheduling-preflight`, engine core/adapter, planner, run-plan/perf/store/orchestration, fresh planning calendar read, cache markers, migration, focused tests, two manual verification scripts and this map/evidence. No new CI workflow or heavy automatic browser/performance job was added. The branch was rebased onto `1ebc6db4` after the measurements; its attendance changes do not modify the engine benchmark path. `HOTFIX_VERSION` has the runtime marker and frontend `CACHE_VERSION` is 1906, above the newly updated main branch's 1905; the relevant cache check was repeated for this bump. Root SW remains the entry shim.

Before deployment, review/apply `20261006100000_planning_preflight_and_fenced_runs.sql` after the existing lease/persistence migrations and release the frontend with it. Older clients cannot use unfenced persistence RPCs; reload them for the new signature. Validate authenticated Supabase permissions, representative live data and logs after secure access is connected. The PR remains a draft pending this external verification. Do not merge/deploy based solely on these synthetic/local results.
