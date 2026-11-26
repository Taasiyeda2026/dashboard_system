# National planning worker performance, 26 November 2026

The historical 50/175 event predates the server-owned planner on current main. [PR #2120](https://github.com/Taasiyeda2026/dashboard_system/pull/2120) documents reproduced Chromium timer starvation and the former 900-second lease. The supplied timestamps establish the missed heartbeat and absence of release. They do not identify what ended that specific browser process. Read-only production logs from 26 November contain PostgREST Warp thread timeouts. The most recent recorded incremental worker failure has SQLSTATE 57014, consistent with a database statement being cancelled. Neither observation correlates the old browser checkpoint to a specific request.

On current main, the active worker acquired a lease and loaded the complete snapshot and travel cache before checking for useful work. The active v38 planner repeated availability computations for identical instructor/date/time windows, built anchor occupancy for each candidate pool, rescanned alternatives to obtain scarcity during sorting, and repeated checks even against unchanged anchors. Flexible schedule generation, block simulations and final rescoring also had synchronous work between checkpoints. The first deep benchmark of the revised search reached the default Node heap limit. Sharing immutable generated meeting series allowed the same fixture to finish without a larger heap.

## Engine benchmark

Node 24.19.0. Baseline main **5e550550**. The synthetic fixture has 175 flexible activities, 35 schools, 24 instructors, eight meetings per activity and 3,422 ordered warm route pairs. Times are single wall-clock observations, not percentiles or production SLAs. Timer lag is the maximum observed delay beyond a 100 ms interval.

| Scenario | Baseline | Revised | Evidence |
|---|---:|---:|---|
| Full, fast profile | 304.68 s | 49.62 s | 6.1× faster, 175 assigned rows and 499,968 candidate checks in both runs |
| Progress at 50/175, fast profile | 163.08 s | 17.83 s | 9.1× sooner |
| Max timer lag, fast profile | 3,123 ms | 130 ms | 433 timer ticks in the revised run |
| One target within the 175-activity context | 0.873 s | 0.467 s | One activity and 4,608 candidate checks in both runs |
| Full, deep profile | — | 132.24 s | 175 assignments, 1,999,872 candidate checks, 112 ms maximum timer lag and 1,238 timer ticks |

The revised fast and deep runs passed whole-plan validation, used one prepared constraint context each, and made zero DB, Edge route-provider or Google calls. Actual production requests also include GitHub workflow dispatch, snapshot reads, heartbeat and persistence. Timer probes are Node observations. They do not measure a specific browser Long Task.

```sh
ENGINE_ROOT=/path/to/baseline node scripts/benchmarks/scheduling-runtime.mjs full
node scripts/benchmarks/scheduling-runtime.mjs full
node scripts/benchmarks/scheduling-runtime.mjs point
BENCH_PROFILE=deep node scripts/benchmarks/scheduling-runtime.mjs full
```

## Database and worker request counts

- A clean incremental job now returns a receipt from one worker Edge call and one command RPC. It performs zero snapshot, route-cache or planner work and acquires no engine lease. The preflight function returned in 2.05 ms over isolated local PostgreSQL. The isolated PostgreSQL test verified that the receipt leaves the workspace revision and saved rows unchanged. GitHub dispatch latency and the live one-to-two-second goal remain unmeasured.
- A concurrent claim returns immediately when the planning advisory lock is held. The isolated PostgreSQL regression compared the response to a 500 ms deadline while the competing transaction still held that lock. Live leases and the server's expected revision check continue to fence writes across owners and run IDs.
- A dirty job reuses the post-snapshot preflight and skips the former extra worker probe. It retrieves route rows in key order with a fixed timestamp and only for the canonical endpoints in the snapshot. Production read-only sampling found 13,843 warm routes (28 requests at 500 per page in the existing loader). The scoped SQL calculation with current school and home endpoints matched 7,928 rows before external blockers. Including blockers bounds the new page count between 8 and 14 at 1,000 rows per page. These are bounds derived from live counts, not measurements against a deployed new Edge function.
- The production national workspace was revision 13365 on v38, with 173 rows explicitly marked dirty and no active lease at sampling. That is a later snapshot than the one-row historical reference.
- Run summaries report snapshot and route-cache reads, route rows, Edge calls, Google calls, activities computed, candidate checks, context builds, checkpoint writes, lease heartbeats, phase durations and event-loop lag. Progress summaries have no activity, instructor or school identifiers.

## Verification and rollout

Focused Node tests cover scope, constraints, alternative selection, cancellation, checkpoints and worker contracts. The two disposable PostgreSQL suites cover same- and different-owner concurrency, forced expiry, heartbeat under CPU load, ownership loss, revision conflicts, checkpoint writes and resume, atomic no-op receipts and route scope permissions. The new worker checkpoint actions were also exercised in the queue fixture; the underlying fenced checkpoint procedures were independently exercised with their real migrations. The frontend build and Deno Edge type check passed.

Apply `20261126111844_scheduling_worker_current_plan_fast_path.sql` before deploying the Edge function or worker. It leaves the existing source revision journal and engine version in place. The new worker runs only after the reviewed main release. Production changes were limited to reads during this task. Validate new end-to-end timings, dispatch overhead, route page counts, database timeouts and checkpoint recovery in staging or during the approved release. For rollback, restore the previous worker and Edge function, then restore the previous worker command and recovery function bodies by corrective migration if required. No scheduling assignments or source rows are altered by the migration.
