# Dashboard-Taasiyeda — Project Memory

Hebrew RTL internal dashboard. Stack: Vanilla JS + Google Apps Script + Google Sheets.
Preserve: RTL, Hebrew, dark shell + light panels. Communication with user: Hebrew.

## Runtime
- Static server: `npx serve . -l 5000` (workflow: "Start application")
- SW networkFirst. Bump `CACHE_VERSION` in `sw.js` AND `?v=` in `index.html` together on every JS/CSS change.
- **Current versions**: SW v233, CSS v2604291, JS v2605011

## Key identifiers
- `SPREADSHEET_ID = '1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s'`
- GAS deployment URL (DEFAULT_API_URL in `frontend/src/config.js`):
  `AKfycbysqMOYDnPXDeTiU1R0qBr5Kp84E_q2m6kkMVk6CLXZX9akgvE4zKGPmm_h7CJjfnys`

## Test suite
- `node --test tests/*.test.mjs`
- Baseline: 92 pass / 5 fail (pre-existing jsdom-missing failures, unrelated to app logic)

## Architecture
- `frontend/src/screens/` — one file per screen (exceptions.js, finance.js, …)
- `backend/*.gs` — Google Apps Script files (actions.gs, dashboard-snapshot.gs, …)
- `tests/*.test.mjs` — Node test-runner tests (no jsdom; DOM tests fail, expected)

## Notable fixes (history)
1. **Data-maintenance pipeline**: `runDataMaintenance_` calls `refreshDataViews_()` before
   `refreshDashboardSnapshots_()`. Early-return on view failure.
2. **month_ym text format**: `ensureSnapshotMonthYmTextColumn_()` ensures `'YYYY-MM` prefix.
3. **Exceptions screen — all 3 types visible**: `computeExceptionsModel_` now only skips
   overlap check when `rowHasStart` is true, so `missing_start_date` / `missing_instructor`
   activities without a start_date are always included in month-filtered results.
4. **Exceptions — unique card actions**: card action format is `exception:<RowID>:<exception_type>`
   (not just RowID) so each exception type for the same activity gets its own card.
   Bind parses via `lastIndexOf(':')` and uses `findIndex` on both fields.
5. **Exceptions drawer**: shows exception-type chip via `exceptionTypeHeader()`.
