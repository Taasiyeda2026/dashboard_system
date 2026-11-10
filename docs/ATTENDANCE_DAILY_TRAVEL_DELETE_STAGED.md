# Approved daily travel deletion — staged, not deployed

Approved in the current review: deleting a physical attendance source removes
the whole saved travel chain for that employee/day, its approval and generated
payable. Other attendance records remain unchanged. No partial chain repair,
new screen, formula change, historical cleanup or data backfill is included.

## Local implementation

- `supabase/patches/attendance-daily-travel-delete.sql` replaces the existing
  deletion trigger function. It deletes the daily report and the generated
  `daily_travel_cancellation` row inside the attendance deletion transaction.
  The existing source FK handles source-linked legacy children. The existing
  audit trace is retained as evidence, not as payable data.
- The patch removes the old unscoped deletion of ALL manual cancellation rows
  on the same date: those rows have no daily-chain link and are other attendance.
- My Reports warns before deletion, waits for a confirmed deleted record, then
  refreshes through its existing flow. For a saved chain deleted while another
  physical activity remains, it shows exactly:

  > בעקבות מחיקת רשומת הנוכחות, גם דיווח הנסיעות של יום זה נמחק. יש למלא מחדש את נסיעות היום.

- The button calls the existing `onTravelReport(date)` navigation. If no physical
  activity remains, there is no refill request or button. Online-only activities
  do not require a new physical trip. A day without a saved chain does not get a
  false deletion notice. Display decisions use the loaded trip and refreshed
  attendance, not a new reporting process.
- Duplicate clicks are blocked while the delete is in flight. Zero-row deletions
  and server errors do not show success. Frontend and Attendance cache markers
  are prepared together; no new paths were added to precache.

## Verification

Run UI/service/contract cases:

```sh
node --test tests/attendance-daily-delete-ui.test.mjs tests/attendance-travel-after-attendance-delete.test.mjs
```

Database acceptance is explicit opt-in to a fixed local disposable container:

```sh
ATTENDANCE_TRAVEL_DELETE_TEST_CONTAINER=attendance-travel-delete-test node --test tests/attendance-daily-delete-postgres.test.mjs
```

The container must run PostgreSQL 17 with `--network none`. The runner only uses
the local Docker socket and a fixed disposable database. It does not accept a
database URL or Supabase credentials. The synthetic fixture includes the baseline
save/review/payable routines so refill is tested through real PostgreSQL writes.
Identity and month permission helpers are stubs; full production RLS and month
locking are outside this acceptance fixture. No passing result certifies them.

Acceptance covers: pending/approved chains; deleting the first or another source;
last physical activity; unchanged remaining attendance fields; independent manual
cancellation; another employee/day; legacy child cascades; online-only source;
refill and repeat save with one trip and one generated payable; warning, exact
message, existing navigation, cancellation, failed deletion and duplicate clicks.

## Release boundary

This deletion component is included in the completed local repair bundle. See
`ATTENDANCE_TRAVEL_INTEGRITY_BUNDLE.md` for the combined release and tests. The
patch files remain review sources; the release migration was generated through
the CLI and includes both patches. No production execution, commit or push has
been performed. A separately approved release must recheck deployed freshness.

Unreported days in the current month remain described by the existing UI as
days to complete by month end. This change does not label them software errors
or alter the reporting deadline.

Initial deletion result: all 19 targeted cases passed. Combined acceptance now
also runs the live RLS predicates and month guards in isolated PostgreSQL;
see the bundle report for final counts and remaining environment limits.
