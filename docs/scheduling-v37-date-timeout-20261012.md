# v37 validation timeout — targeted date expansion performance

Date: 2026-10-12

## Observed problem
Supabase authenticated and authenticator role `statement_timeout=8s`.
`pg_stat_statements` recorded checkpoint commit attempts averaging ~5.9s,
with maximum ~6.9s among *completed* executions; user independently reported
`57014 / canceling statement due to statement timeout`. Failed aborted
statements are not represented in those completed-run measurements.

Snapshot: workspace revision 11977, 252 rows, 2556 saved meetings,
40 rows marked needs_recalc, 267 source revision (validated source revision 265).

## Optimization
The v37 validator previously converted a full `activities` record
to JSON up to 35 times per activity for official dates. `date_1 .. date_35`
are native PostgreSQL DATE columns. Replace only three date-enumeration sites
with a positional `unnest(date[])` or `WITH ORDINALITY`: scope eligibility,
official-date verification and flexible-date detection. Existing authorization,
profile/course block, locked/protected instructor, substitute, schedule, calendar,
overlap, transition and fencing checks stay unchanged.

## Production acceptance
- SQL equality across 255 current school_2027 activities: **0 date-order/sequence
  mismatches and 0 first-date mismatches**.
- Before/after same-data, rollback-only temp-function comparison:
  original 2058ms vs optimized 1367ms; both reject the same stale candidate
  with `planning_server_candidate_constraint_failed`.
- Optimized full validator passed (after temporarily unassigning 117 stale
  *unlocked* proposals inside an intentionally aborted transaction): 2064ms
  total, zero persistent writes.
- **Actual fenced atomic commit RPC** `commit_scheduling_planning_checkpoint`
  was exercised with all 252 checkpoint rows, 8s statement timeout, real run
  lease and production validator in one intentionally aborted transaction.
  Synthetic checkpoint retained protected/live rows but cleared instructor
  choice on unlocked proposals. Result: success in **2512ms**; all writes and
  lease were rolled back. This checks checkpoint mechanics and speed, not the
  ability of the client planner to find valid proposals.
- Existing workspaces, approved instructors, proposals and stored revisions
  remain unchanged.

## Outstanding
The client/worker planner and a *persisted full run* have not been executed here;
40 activities flagged needs_recalc still need recomputation. Do not state
the end-to-end scheduling workflow is fully proven until that completes.
