# PR #2458 — pre-merge validation, 2026-10-29

**Recommendation: NOT READY TO MERGE. Keep Draft.** No merge, deployment, production migration or cloud project creation was performed. No tests were run against the production database. Earlier read-only schema/identity findings are recorded in the implementation plan; they are not staging validation.

## Changes in this review

- Attendance applies to **instructors only**: instructor → direct manager from `contacts_instructors.direct_manager` → Idan final approval → Idan payroll dispatch → Toni. The staff-roster attendance routing and label fallback have been removed. No business approval RPC or permission was changed.
- Headquarters personal reports remain a separate process: submission/resubmission to Idan, correction/approval/payment updates to the report owner. Staff attendance approval is outside scope and is **not a merge blocker**.
- A task awaiting the next approval is styled red even when its triggering event records the previous approval. Completed updates can remain green. Reading a notification does not close its task.
- Frontend release marker refreshed; dashboard `CACHE_VERSION` is 2046. No new cache/precache paths or automatic browser workflow were added.

## Executed checks

| Check | Result | Scope and limits |
| --- | --- | --- |
| Instructor-only routing and no staff fallback | Passed, 1 focused PGlite case after scope correction | A staff profile without an instructor record creates no manager notification/task. For an instructor, a conflicting staff profile cannot override the instructor's manager or display name. |
| Staff personal report independence | Passed, 1 focused PGlite case after scope correction | Staff member has no instructor record: submission, correction, resubmission, approval and payment retain Idan/owner routing; unrelated users receive nothing; tasks close correctly. |
| Instructor attendance chain and missing/ambiguous assignment | Passed, 2 existing PGlite cases rerun after scope correction | Instructor → manager → Idan → payroll dispatch → Toni, including reopening and missing recipient exception. Server-trigger state changes, not actual Auth/PostgREST/RPC/Realtime integration. |
| Notification label RLS | Passed, 1 focused PGlite case rerun after scope correction | Cross-user notification/label isolation, forbidden client writes and internal function access. |
| UI regression | Passed, 4 focused cases | Existing edit request groups, names/escaping, read versus task state, tabs/history filters, empty state, many rows and pending-stage styling. DOM tests, not business approval execution. |
| Actual browser rendering | Passed, 3 viewport scenarios | System Chromium 151 via Playwright; 1440×1000, 390×844 and 320×740. Real screen components, navigation renderer and application CSS, synthetic labelled test data and test service only. |
| New local integration scripts | Syntax checks passed | **Not executed** against a running Supabase stack. Syntax success is not integration success. |

The browser checks exercised all three tabs, unread clearing while tasks stay open, existing incoming/sent/history edit request groups, one compact empty message, 150 tasks, RTL, no horizontal overflow and no page errors. External requests were blocked and the test asserted none occurred. The captures were inspected, including desktop pending and mobile updates. The browser fixture does not authenticate into the whole dashboard or execute document actions.

Evidence: [machine-readable browser results](browser-results.json), [desktop tasks](desktop-pending.png), [mobile updates](mobile-updates.png), [small mobile history](small-mobile-history.png), [desktop empty state](desktop-empty.png).

After the user clarified instructor-only attendance, five focused DB cases passed in one run. Existing routing/RLS cases were rerun because their SQL resolver/label query changed; two new cases verify scope exclusion and preservation of staff personal reports. The earlier staff attendance diagnostic was removed because that process is not required. The earlier UI checks and screenshots remain applicable: no frontend changed in this correction, so they were not rerun. The previous delivery's 52 passing scenarios, build and nine reproduced legacy failures are historical results in the implementation plan, not a fresh full-suite run. No build or cache bump was needed for this SQL/test/documentation-only correction; frontend cache version remains 2046.

## Isolated Supabase attempt and unverified requirements

Supabase CLI 2.78.1 was initialized in `work/notification-staging` with local project ID `notifications-pr2458`, without a production project link. Docker was available. The first start failed because `public.ecr.aws` is forbidden by the environment network policy. The CLI's supported `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io` option could pull official Auth, Realtime, PostgREST and Kong images. PostgreSQL image extraction then failed with:

```text
failed to register layer: write /docker-entrypoint-initdb.d/migrations/20251121132723_correct_search_path_pgbouncer.sql: no space left on device
```

The CLI was stopped. The Docker daemon uses the `vfs` storage driver; no daemon/storage changes were made. No Supabase containers or usable local stack were created. The PR migration **was not applied to a CLI-managed Supabase instance**. PGlite is an isolated PostgreSQL engine with reduced test tables and test Auth helpers; it does not provide Supabase Auth, PostgREST or Realtime.

Consequently, the following remain **NOT VERIFIED** end to end:

- Instructor → manager → Idan final approval → Idan payroll dispatch → Toni using real authenticated business RPCs and real WebSockets.
- Proposal awaiting signature, actual signature approval and return for correction through the existing production screen/action path. Trigger-level status fixtures from the earlier DB tests do not verify signing/PDF permissions.
- Personal report submission → correction → resubmission → approval through the complete authenticated UI/RPC path. The named `request_personal_report_correction` definition is not provided by the reduced local fixture; status updates do not substitute for that RPC.
- Two-user/two-tab delivery, read synchronization, automatic task closure and duplicate prevention over actual Realtime. The earlier client-contract/DOM/RLS tests cover individual behaviors only.
- Protected direct navigation to an actual report/proposal/month including session restoration, extra authentication and source-record permissions. Existing unit coverage is not a logged-in browser acceptance test.
- All existing edit request write operations and sensitive profile changes through actual Supabase Auth/PostgREST. Earlier regression/SQL tests remain useful but are not full-stack acceptance.

## Merge blockers and next steps

1. **Full-stack acceptance remains blocked by local Docker storage.** Rerun on a sufficiently provisioned isolated Docker host, or provide another explicitly nonproduction environment. Apply the PR migration there only and complete the above acceptance matrix. Do not substitute production for this environment. The instructor business RPC remains unchanged; staff attendance authorization is not required and is not a blocker.
2. Resolve/review the known assignment exceptions (including Idan's own personal report and missing/ambiguous owners) before any separately authorized initialization. Toni's privileges were not promoted automatically.

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
