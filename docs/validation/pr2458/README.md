# PR #2458 — pre-merge validation, 2026-10-29

**Recommendation: NOT READY TO MERGE. Keep Draft.** No merge, deployment, production migration or cloud project creation was performed. No tests were run against the production database. Earlier read-only schema/identity findings are recorded in the implementation plan; they are not staging validation.

## Changes in this review

- Attendance manager notification routing now combines `contacts_instructors.direct_manager` with `employee_profiles.direct_manager`, linking staff through `employee_profiles.user_id → users.user_id` and employee IDs. Missing managers, contradictory roster managers, conflicting employee IDs or multiple active users with the same manager name produce a routing exception, with no broadcast. Explicit reviewed assignments retain their existing precedence.
- Staff notification labels now resolve the employee's name from the staff roster. Recipient/RLS checks remain required.
- A task awaiting the next approval is styled red even when its triggering event records the previous approval. Completed updates can remain green. Reading a notification does not close its task.
- Frontend release marker refreshed; dashboard `CACHE_VERSION` is 2046. No new cache/precache paths or automatic browser workflow were added.

## Executed checks

| Check | Result | Scope and limits |
| --- | --- | --- |
| Staff manager routing | Passed, 1 focused PGlite case with multiple assertions | Staff without instructor row; employee label; unrelated recipient isolation; missing manager; conflicting rosters; conflicting employee IDs; duplicate manager names. No general recipient fallback. |
| Instructor attendance routing and missing/ambiguous assignment | Passed, 2 existing PGlite cases selected with the initial routing change | Server-trigger state changes and recipient selection. Not actual Auth/PostgREST/RPC/Realtime integration. |
| Existing staff manager approval RPC | Blocker reproduced, 1 passing diagnostic case | Executes the **unchanged** `manager_finalize_attendance_month_review` body from `20261013042258_unified_attendance_travel_time_cancellation.sql`. Staff notification reaches the manager, but approval raises `payroll_attendance_permission_denied`. |
| Notification label RLS | Passed, 1 focused PGlite case after label-query changes | Cross-user notification/label isolation, forbidden client writes and internal function access. |
| UI regression | Passed, 4 focused cases | Existing edit request groups, names/escaping, read versus task state, tabs/history filters, empty state, many rows and pending-stage styling. DOM tests, not business approval execution. |
| Actual browser rendering | Passed, 3 viewport scenarios | System Chromium 151 via Playwright; 1440×1000, 390×844 and 320×740. Real screen components, navigation renderer and application CSS, synthetic labelled test data and test service only. |
| New local integration scripts | Syntax checks passed | **Not executed** against a running Supabase stack. Syntax success is not integration success. |

The browser checks exercised all three tabs, unread clearing while tasks stay open, existing incoming/sent/history edit request groups, one compact empty message, 150 tasks, RTL, no horizontal overflow and no page errors. External requests were blocked and the test asserted none occurred. The captures were inspected, including desktop pending and mobile updates. The browser fixture does not authenticate into the whole dashboard or execute document actions.

Evidence: [machine-readable browser results](browser-results.json), [desktop tasks](desktop-pending.png), [mobile updates](mobile-updates.png), [small mobile history](small-mobile-history.png), [desktop empty state](desktop-empty.png).

Focused DB runs were repeated only after relevant SQL/fixture changes: first staff routing, then staff labels, then contradictory-ID/name cases. UI rendering was repeated after correcting pending-task styling; screenshot capture was corrected to disable transitions. These repetitions are not counted as additional unique cases. The previous delivery's 52 passing scenarios, build and nine reproduced legacy failures are historical results in the implementation plan, not a fresh full-suite run. No new build was needed for this focused rendering/SQL change; real Vite/Chromium rendering and targeted tests were used.

## Isolated Supabase attempt and unverified requirements

Supabase CLI 2.78.1 was initialized in `work/notification-staging` with local project ID `notifications-pr2458`, without a production project link. Docker was available. The first start failed because `public.ecr.aws` is forbidden by the environment network policy. The CLI's supported `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` option could pull official Auth, Realtime, PostgREST and Kong images. PostgreSQL image extraction then failed with:

```text
failed to register layer: write /docker-entrypoint-initdb.d/migrations/20251121132723_correct_search_path_pgbouncer.sql: no space left on device
```

The CLI was stopped. The Docker daemon uses the `vfs` storage driver; no daemon/storage changes were made. No Supabase containers or usable local stack were created. The PR migration **was not applied to a CLI-managed Supabase instance**. PGlite is an isolated PostgreSQL engine with reduced test tables and test Auth helpers; it does not provide Supabase Auth, PostgREST or Realtime.

Consequently, the following remain **NOT VERIFIED** end to end:

- Employee → manager → Idan final approval → Idan payroll dispatch → Toni using real authenticated business RPCs and real WebSockets.
- Proposal awaiting signature, actual signature approval and return for correction through the existing production screen/action path. Trigger-level status fixtures from the earlier DB tests do not verify signing/PDF permissions.
- Personal report submission → correction → resubmission → approval through the complete authenticated UI/RPC path. The named `request_personal_report_correction` definition is not provided by the reduced local fixture; status updates do not substitute for that RPC.
- Two-user/two-tab delivery, read synchronization, automatic task closure and duplicate prevention over actual Realtime. The earlier client-contract/DOM/RLS tests cover individual behaviors only.
- Protected direct navigation to an actual report/proposal/month including session restoration, extra authentication and source-record permissions. Existing unit coverage is not a logged-in browser acceptance test.
- All existing edit request write operations and sensitive profile changes through actual Supabase Auth/PostgREST. Earlier regression/SQL tests remain useful but are not full-stack acceptance.

## Merge blockers and next steps

1. **Staff approval authorization mismatch:** the existing manager RPC checks `contacts_instructors` (lines 1032–1039 in the source migration) rather than the staff roster. Routing is fixed, but the requested staff process is not executable by that manager in the reduced reproduction. No instructor rows were fabricated and the business RPC was not broadened. Confirm the intended staff approval path and review its authorization against the existing employee-manager sources before changing it. Add both positive staff approval and negative unrelated-manager tests for the agreed path.
2. **Full-stack acceptance remains blocked by local Docker storage.** Rerun on a sufficiently provisioned isolated Docker host, or provide another explicitly nonproduction environment. Apply the PR migration there only and complete the above acceptance matrix. Do not substitute production for this environment.
3. Resolve/review the known assignment exceptions (including Idan's own report and missing/ambiguous owners) before any separately authorized initialization. Toni's privileges were not promoted automatically.

## Manual reproduction

No new automatic CI browser job was introduced. From the repository root, with the existing dependencies and system Chromium:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5187
# In another terminal:
node tests/central-notifications-browser.mjs
```

Browser output defaults to `work/notification-staging/visual`. Configure `NOTIFICATIONS_CHROMIUM` if Chromium is elsewhere. All test data is under `tests/fixtures/central-notifications`; no fixture is imported by a production entry point.

The prepared **unexecuted** local-stack runner is `tests/central-notifications-local.mjs`. On an isolated machine, initialize a disposable Supabase workdir at `work/notification-staging` with project ID `notifications-pr2458`, start it using the CLI and keep the fixture Vite server running. Then run:

```sh
NOTIFICATIONS_SUPABASE_CLI=supabase node tests/central-notifications-local.mjs
```

It accepts only a localhost API URL and named local Docker container, refuses initialization when notification tables already exist, creates synthetic Auth users, loads a reduced source schema, copies unchanged attendance RPC definitions with a SHA-256 manifest, and applies the actual PR notification migration. It is prepared to exercise Auth/PostgREST/WebSockets/browser clients, but **has not run or produced live results**. Its reduced source policies, proposal status fixtures and absent personal correction RPC mean it still does not replace a full business UI acceptance test even after a successful run. Use a fresh disposable database; do not use this bootstrap on any real environment. No teardown/reset or production commands are part of this report.
