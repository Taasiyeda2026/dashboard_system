# Scheduling incremental save 57014 — targeted production remediation

Date: 2026-10-12

## Verified evidence
Postgres `postgres_logs` for 2026-10-12 show `57014` repeatedly during
`save_scheduling_planning_incremental_snapshot`, notably at 09:48:32 UTC
while executing its full prior-row `jsonb_agg`. Other errors occurred while
checking `activities.updated_at`, firing the `scheduling_planning_rows_stamp_recalc`
trigger and executing the final v37 hard validator. Two additional timeout
events originated in `get_scheduling_planning_workspace`.

At inspection: 247 saved planning activities, 100 `needs_recalc`, source
revision 279 vs saved validated source revision 267, workspace revision 11988.
The prior aggregate contained **9,202,110 bytes** because each previous
row included all `options` and alternate candidates. v37 actually consumes
only the prior row's `startDate`, `instructorEmpId` and `meetings`, plus
`courseId` and `lockedOption`. Thus three wrappers now construct exactly
that validation context, leaving persisted rows untouched. A side-effect-free
EXPLAIN ANALYZE of the two aggregates measured **~645ms original vs ~42ms
slim** and size **9.2 MB vs 292 KB** under production workload.

The underlying incremental UPSERT used to update every existing row even
if all values were identical, repeatedly invoking the `needs_recalc` trigger.
It now updates only when `row_data`, `activity_updated_at`, or `needs_recalc`
requires a real change, including clearing existing dirty flags.

## Verified after SQL installation
Rollback-only transaction with a genuine run lease, current revision/source,
and 8s statement timeout:
- 1-row incremental RPC reached authoritative v37 validator in **352ms**.
- 100-row incremental RPC reached authoritative validator in **479ms**.
- Both failed at **`planning_server_official_dates_changed`**, rather than
  `57014`, because 2 *approved/live* rows still contain outdated meeting
  dates in their saved planning projection. No writes survived test rollback.
  The source activities for both rows now start one week later, with instructor
  1546 unchanged. Do not edit approved or canonical activities merely to pass
  performance tests: the client's authorized recalculation must reconcile
  source dates before a real save.

## Remaining limitation
These measurements prove the targeted **incremental writer** no longer
spends the same time serializing full prior snapshots. They do **not** prove
an end-to-end national planner run including all dirty rows. Database
`statement_timeout=8s` remains unchanged, and production assignments and
existing proposals were left untouched by this migration.
