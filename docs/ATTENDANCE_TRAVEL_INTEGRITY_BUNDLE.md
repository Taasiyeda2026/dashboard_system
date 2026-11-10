# Travel integrity bundle — local acceptance and release boundary

Status: implemented and tested locally, NOT deployed. No operational data edits,
historical backfill, commit or push have been performed.

Base: GitHub main `fb2cbe4b14ddd347d805550577dfddbcf5b4e8ca`, rechecked after
acceptance. Live SQL definitions and RLS predicates were read from Dashboard
(`szinlhjuwyiyszdpsdop`) before preparing the changes.

## Changes actually implemented

1. Shared JS route validity rejects `google_verified_zero` for different places,
   matching SQL. Same-place aliases/hyphens follow SQL canonicalization; the
   existing verified-campus exception is preserved. SQL also prevents a suspect
   entry from bypassing its block through the same-place shortcut.
2. The save RPC rejects missing/null/incorrectly typed numbers, fractional minutes,
   values outside the existing ranges, invalid modes, fares and locations. The
   existing travel formulas, thresholds and maximum ranges are unchanged.
3. New saves retain a nullable context fingerprint over the physical attendance
   chain and its effective destination snapshots. Preview includes the hash, so
   a stale browser draft cannot silently save against changed attendance. Approval
   compares the saved context to the current context. Existing reports are not
   backfilled. Untouched legacy reports keep the existing path; a later source
   mutation marks them for a fresh save. Legacy reports whose source timestamp
   is later than their report timestamp require checking before future approval.
   No historical approvals are reopened merely by installing this migration.
4. A per-employee/day transaction lock serializes save, approval and attendance
   mutations, including a first save without an existing daily row. Generated
   compensation writes do not recursively acquire another day's lock.
5. Material attendance changes retract prior approval and the generated daily
   payable. Notes and online-only additions/deletions do not invalidate a valid
   physical chain. The context hash excludes the instructor's CURRENT home address:
   a current address edit must not rewrite the historical trip. No travel formulas
   or assignment eligibility rules were changed.
6. Whole-chain deletion follows the expressly approved rule; other attendance and
   independent manual cancellation are preserved. The existing reports screen
   warns first, confirms an actual deleted row, and provides the specified notice
   with existing travel navigation for the affected date when physical work remains.
7. The manager read/review paths require a mapped, active identity and a nonempty
   matching direct-manager identity for cross-employee manager access. Existing
   admin/operations and finance read-only scopes are retained. Closed/payroll-approved
   months block changes. Rejection still works after an address-only change; the new
   context guard prevents payment approval, not the existing rejection workflow.
8. Manual route calculation reloads BOTH coverage and queue; a still-pending pair
   is clearly not presented as repaired. Existing review-completion does the same.
   Save-timeout confirmation also compares activity IDs and context, not amounts alone.
9. Cache versions are prepared: dashboard 2101, Attendance 164, matching HTML
   asset versions and the bundle release marker. No bulk precache paths were added.

## Release files

The single CLI-generated release migration is:
`supabase/migrations/20261110202214_attendance_travel_integrity_bundle.sql`.
It includes the review sources in `supabase/patches/attendance-daily-travel-delete.sql`
and `supabase/patches/attendance-travel-integrity.sql`. Apply the SINGLE migration
through the normal approved release, not each review patch as a separate change.
The migration contains definitions, grants and one nullable column; no standalone
operational data cleanup. New internal helpers live in `private` with no public,
anonymous or authenticated execution grant.

Coordinate the migration, frontend/Attendance runtime and the Edge bundles using
the changed shared contract (`scheduling-route`, `attendance-travel-compensation`,
`attendance-base-training-routes`). Deploying only a subset will not complete the
repair. Older open travel forms can be rejected as stale and must reload the day
through the existing interface. Recheck source/deployed-definition freshness before
an expressly approved production release.

## Final acceptance evidence

66 distinct targeted cases passed; zero unresolved test failures:

| Group | Passed | Evidence |
|---|---:|---|
| Integrated PostgreSQL | 27 | Live RPC baseline, release migration, copied live RLS/month/generated-record guards; input rejection, context changes, ownership, manager/finance/admin, closed months, deletion/refill, actual payroll workbook, concurrent delete/save, no historical rewrite |
| Deletion UI/service | 7 | Exact notice, direct date callback, warning, last activity, no false success, repeat click, server confirmation |
| Deletion source contracts | 4 | Cleanup scope and current client call |
| Maintenance/context UI | 4 | Both reloads, pending-zero result, invalid result handling, exact save confirmation |
| Chromium | 7 | Hanging load/save, server persistence after timeout, date switching, retry safety, changed-context values |
| Shared route contract | 11 | Route validity, suspect blocking, demand filtering, cache reuse and singleflight |
| Request-guard regressions | 3 | Timeout, exact confirmation, guarded loading |
| Existing payroll regression | 1 | Daily approved kilometers, cancellation and transit counted once |
| Built artifact | 2 | Attendance artifact equals current source; cache versions aligned |

`npm run build`, changed-module syntax checks and `git diff --check` passed.
The route parity case was rerun after the final SQL suspect-shortcut change;
unaffected passing cases were not repeated for that isolated change. Earlier
integration failures (SQL alias, irrelevant online invalidation and test identity
reset) were corrected before the passing results above.

The database tests use a fixed local PostgreSQL 17 container with `--network none`,
synthetic data and SET ROLE/JWT-claim identity emulation. Real Supabase Auth login,
production HTTP routing, live Google calls and a production payroll run were not
performed. The tests validate database authorization and payroll INPUTS/export;
they do not claim a production payroll payment was executed.

Reproduce the main database acceptance:

```sh
ATTENDANCE_TRAVEL_DELETE_TEST_CONTAINER=attendance-travel-delete-test node --test tests/attendance-daily-delete-postgres.test.mjs
```

For installed system Chromium, set `ATTENDANCE_TEST_CHROMIUM_PATH=/usr/bin/chromium`
when running `tests/attendance-travel-browser-recovery.test.mjs`.

## Existing data and remaining decisions

No existing data repairs were applied. Replaying the coverage calculation on the
audit snapshot with the corrected contract gives 219 required, 213 usable, 6 to
investigate. These are zero-route pairs, NOT six newly deleted routes. They include
instructor 1540 to schools 2212/2346 and school transitions 2212↔2346, 2346↔2366.
This base-universe count must not be added to the separate directed missing queue.
Map/source verification is required before any targeted correction is proposed.

The earlier inactive-instructor assignment, grandfathered records, legacy distance
differences and address-change cases still require the specific data review already
requested. Current-month unreported days remain completion items until their due
date, not automatically software defects. No new deadline rule was introduced.

No known failing case remains within this repair scope. The code and migration
are prepared for a separately approved coordinated release. Operational data
corrections and production execution require explicit approval and are not included
in this completion claim.
