# Simplified manual scheduling — acceptance and release report

Date: 2026-11-26. Base: `a4dc351b65bd7b431632a38b50af49a01713e45f`
(merged PR #2807). Branch: `fix/manual-scheduling-simplified-workflow`.
No PR #2805/#2806 changes, finance changes or unrelated approval changes.

## Delivered behavior

Direct compact RTL instructor assignment, read-only activity summary, collapsed
complete meeting list, local name search, visible inactive instructor status,
conditional reason/consent, and one-click clean draft/final save. Existing
replacement effective date and separate cancellation/meeting actions remain.
Missing official data is shown immediately and blocks saving, with the existing
All Activities correction navigation. A stale preview or activity refresh requires
fresh review and never silently reuses warning consent.

Server schedule arguments are now compatibility assertions. Official activity data
is authoritative for preview, commit and draft occupancy. Commit writes assignment
fields only. The legacy calendar setter cannot create or move activity dates.
Mismatched old drafts are retained, explicitly rechecked and archived in audit on
an authorized subsequent save. No production rows were changed.

## Acceptance evidence

| # | Scenario | Evidence |
|---|---|---|
| 1–2 | Direct entry; no date/time editing | Bound UI and real Chromium desktop/mobile |
| 3–4 | Official summary; complete collapsed list | Node, PostgreSQL and Chromium |
| 5 | Local instructor search | Chromium; no search RPC |
| 6 | One click clean save | Controller and Chromium; preview then commit |
| 7–8 | Warning consent; conditional reason | Bound UI, PostgreSQL and Chromium |
| 9 | Blocker prevents commit | Controller and management-role PostgreSQL |
| 10–11 | Missing dates/hours/session data | Immediate UI validation and PostgreSQL |
| 12 | Activity revision changed | Controller reload/recheck and PostgreSQL timestamp fence |
| 13 | RPC schedule override attempted | Isolated preview, commit and legacy setter rejection |
| 14 | No authorization | Bound UI and PostgreSQL anonymous/inactive/non-operator cases |
| 15–16 | Draft save and confirm | Bound UI and PostgreSQL |
| 17 | Old draft schedule | PostgreSQL mismatch warning, official occupancy and original draft audit |
| 18 | Replacement scope/history | Bound UI arguments and PostgreSQL preserved attribution |
| 19 | Double/concurrent save | Controller single-flight and two PostgreSQL connections; one audit |
| 20 | Network/server failure | Controller and bound UI; no success callback |
| 21 | Successful refresh | Bound UI and Chromium; dialog closes after returned row |
| 22 | Existing constraints | Existing manual warning tests and PostgreSQL route/calendar/profile/secondary/history checks |
| 23 | No automatic planning calls | Bound UI and Chromium RPC traces; external requests blocked in browser harness |
| 24 | All Activities remains editable | Activity correction navigation retained; separate frontend API untouched; direct fixture activity update remains effective |
| 25 | Old interface client | Differing legacy arguments rejected by both RPCs; unavailable capability fails closed |
| 26 | Desktop/mobile | Chromium at 1366×900 and 390×844; visual inspection, bounds and accessible footer checks |

## Checks performed

- 77 Node tests in `tests/scheduling-dashboard-agent-controls.test.mjs`: 76 in the
  complete relevant file plus the newly added targeted row-refresh case, all
  passed. Includes imported controller, assignment-history and revision tests.
- 4 directory tests in `tests/course-scheduling-active-instructors.test.mjs`: passed.
- 6 PWA/cache guard tests: passed. Cache version **2142**, appended HOTFIX marker,
  and updated direct stylesheet query version. Root SW remains an entry shim.
- Isolated PostgreSQL: **19 scenarios + parent test (20 reported)**, all passed.
  The fixture executes implementation SQL and the checked-in migration. Covers
  two concurrent clients and admin-only management final approval.
- Real Chromium: **20 grouped acceptance checks across desktop/mobile**, passed.
  Uses synthetic activity/instructor data and mocked RPC responses; all external
  requests are blocked. Screenshots were visually inspected separately.
- Frontend build: passed. Existing bundle-size advisory remains; no new build error.
- Syntax/whitespace: passed. PR Basic PR Check is the final remote validation.

Development reruns followed implementation changes, newly added regression cases,
or fixes to stale test expectations. A first PostgreSQL failure exposed a SQL
parenthesis error, which was fixed; another was a test date timezone assertion,
fixed by asserting the database date as text. Older bound UI tests were migrated
from the retired two-click picker to the current direct preview/commit contract.
The installed system Chromium launcher was incomplete and the browser CDN was
blocked; a disposable Chromium binary from npm enabled the actual browser checks.
No browser dependency, browser install workflow or production credentials were
added to the repository. Build-generated `dist` changes are excluded from the PR.

## Deployment after independent review

1. Review this PR and `SCHEDULING_MANUAL_CONTROL_CONTRACT.md` independently.
2. Apply `supabase/migrations/20261126142551_manual_scheduling_official_schedule.sql`
   to the Dashboard project, `szinlhjuwyiyszdpsdop`, through the normal reviewed
   migration process. There is no business data backfill or deletion.
3. Verify the permission-gated capabilities response includes
   `officialScheduleReadOnly: true` under an authorized identity. The frontend
   will not fall back to a legacy editor if the migration is unavailable.
4. Release the paired frontend with the updated cache layers. No gateway, Edge
   Function, cron, polling or optimization deployment is needed.
5. Verify entry, read-only fields and correction navigation through read-only
   inspection. Do not make trial assignments on real production activities.

No merge, production deployment or production migration was performed.
