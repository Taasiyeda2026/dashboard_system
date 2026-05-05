# Dashboard-Taasiyeda — Project Memory

Hebrew RTL internal dashboard. Stack: Vanilla JS + Google Apps Script + Google Sheets + Supabase.
Preserve: RTL, Hebrew, dark shell + light panels. Communication with user: Hebrew.

## Runtime
- Static server: `npx serve dist -l 5000` (workflow: "Start application")
- SW cache bump: edit `CACHE_VERSION` in `frontend/sw.js` after any JS/CSS change.
- **Current versions**: SW v321 (frontend/sw.js)

## Key identifiers
- `SPREADSHEET_ID = '1odLLnhpm7gLwSsDrgzxjIy2cuHXZGNNQYXCkuhAt52s'`
- GAS deployment URL (DEFAULT_API_URL in `frontend/src/config.js`):
  `AKfycbx0QRcn7lbK7Cenx1FzAaKQTk7ICk4YALPpDCynMHwZ0bMlpUq8hWVG5J-8y0ZNr23q`
- Supabase URL: `https://szinlhjuwyiyszdpsdop.supabase.co` (anon key in `frontend/src/supabase-client.js`)

## Test suite
- `node --test tests/*.test.mjs`
- Baseline: 92 pass / 5 fail (pre-existing jsdom-missing failures, unrelated to app logic)

## Architecture
- `frontend/src/screens/` — one file per screen (exceptions.js, finance.js, week.js, month.js, …)
- `frontend/src/api.js` — API layer; week/month read ONLY from Supabase (no GAS fallback)
- `backend/*.gs` — Google Apps Script files (actions.gs, dashboard-snapshot.gs, …)
- `tests/*.test.mjs` — Node test-runner tests (no jsdom; DOM tests fail, expected)

## Supabase data sources
- `data_short` — short activities; `start_date` = meeting date
- `data_long` — long activities; joined from `activity_meetings.source_row_id → data_long.RowID`
- `activity_meetings` — per-meeting rows for long programs; `meeting_date` = calendar date

## Supabase-only screens (no GAS fallback)
- **week**: `api.week` → `readWeekFromSupabase` only. On failure: empty payload with `_debug`.
- **month**: `api.month` → `readMonthFromSupabase` only. On failure: empty payload with `_debug`.
- Helper functions: `buildCalendarMapping`, `detectActivityMeetingsDateField`, `emptyWeekPayload`, `emptyMonthPayload`
- Diagnostic logs: `[supabase][activity_meetings]`, `[supabase][week]`, `[supabase][month]`

## Notable fixes (history)
1. **Data-maintenance pipeline**: `runDataMaintenance_` calls `refreshDataViews_()` before
   `refreshDashboardSnapshots_()`. Early-return on view failure.
2. **month_ym text format**: `ensureSnapshotMonthYmTextColumn_()` ensures `'YYYY-MM` prefix.
3. **Exceptions screen — all 3 types visible**: `computeExceptionsModel_` now only skips
   overlap check when `rowHasStart` is true.
4. **Exceptions — unique card actions**: format `exception:<RowID>:<exception_type>`.
5. **week/month — Supabase-only**: GAS fallback removed; empty payload returned on failure.
