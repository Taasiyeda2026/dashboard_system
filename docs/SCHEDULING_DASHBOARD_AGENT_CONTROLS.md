# Dashboard assignment controls / agent integration

Staged on a separate branch based on main. No production writes, optimization,
permission changes, merge or deploy were performed.

## Diagnosis and changes

`course-scheduling.js::runFindInstructors` returned immediately when
SCHEDULING_AGENT_OWNS_COMPUTE=true; the replacement handler still awaited it.
The find button was also disabled. It now loads authenticated server snapshots
and persisted v38 options via `course-scheduling-agent-selection.js`. No browser
matching, routing, scoring or optimization is called on that path.

Manual instructors are listed without fabricated eligibility/checks. Save goes
through the existing manual-draft hard gates and existing explicit manager approval
flow. For replacement a manual selection enters the existing replacement action;
it does not attempt to create a draft on a locked course. Reassignment and operational
replacement retain their meeting-count/reason/effective-date rules and history.

`20261016100000_scheduling_dashboard_agent_controls.sql` was generated with the CLI
and resequenced after existing migrations. It adds two permission-gated RPCs:

- `get_scheduling_dashboard_candidates(text)`: one STABLE snapshot of the scheduling-only current
  activity projection, stored plan/options, source/workspace revisions, active instructor names
  and existing review context. Stale plans never produce clickable recommendations;
  manually selected instructors still require server validation.
- `scheduling_dashboard_assignment(text,jsonb,timestamptz,bigint,bigint)`: only the
  nine explicit existing assignment/draft/replacement/cancellation RPCs. It checks
  active user + scheduling permission, activity timestamp and optional source/workspace
  revisions under the existing year advisory lock, delegates and returns the saved row.
  Regular drafts also run existing server eligibility validation. Unsupported actions,
  including manager approval review, cannot be invoked through this wrapper. No new
  bypass, exception approval authority, assignment backfill or engine change is added.

UI snapshots survive rerenders but are invalidated after writes/conflicts. Old
browser-calculated result caches are excluded. A visible refresh action reloads live
input and restores disabled cached views. Failed planning loads no longer clear their
load key and retry indefinitely on every rerender; explicit refresh permits retry.
Existing manager-approval state UI remains in force; pending approval cannot finalize.
Cache release marker and frontend CACHE_VERSION 2015 are included; no precache list
or root SW shim changes are needed.

## Read-only production evidence

Eden Cohen is an active operation_manager with view_operations_scheduling=yes,
view_operations_management=yes and existing direct-edit permission. No permission
change was needed or made. Tests use a synthetic identity with equivalent scheduling
permissions; they do not authenticate as Eden or act on her production records.

Two locked Eldar (emp_id 1502) assignments at Shemesh Gvulot remain unchanged:

- school_2027_101
- ACT-9d569363-1e35-4f28-bb00-1cd04d899a65

Both currently show נדרש טיפול. Approved exception requests 156 and 152 respectively
refer to instructor 1502. Assignment audit records explicitly describe approval of
approximately 73 km home travel. Subsequent revalidation audits on 2026-10-14 record
`scheduling_revalidation_error:P0001:scheduling_home_distance_exceeded`.
The live `scheduling_locked_course_validation_reason` calls the ordinary validator
again; that validator rejects home distance >40 km and does not resolve these prior
exception approvals. This is a distinct revalidation/exception lifecycle issue,
not a revoked Eden permission or evidence that the instructor was removed.

This PR does NOT falsely display those records as valid or clear their status. It
exposes existing approval and audit reason in the authenticated selection snapshot,
restores management controls, and preserves the locked assignments. A safe future
revalidation fix needs structured exception scope tied to the exact approved
assignment/location/meetings and must keep all other constraints. No general
ignore-distance rule, engine change or automatic status correction is included.

Live SELECTs verified the exact signatures of all nine delegated RPCs and inspected
the current ordinary/manual/proposed-date validators. The live proposed-date draft
saver already validates canonical proposed meetings and rolls back on violations;
final date assignment delegates to the ordinary assignment validator. Production
write RPCs were NOT invoked for tests, even inside rollback transactions.

## Validation and rollout

Focused Node/JSDOM tests exercise the actual rendered/bound controls as an
operation_manager: load stored alternatives, choose manual instructor, stage draft,
confirm draft, replace and cancel, stale cache, denied permission and pending admin
approval. All Supabase calls are mocked. A local-only disposable PostgreSQL test
executes the real migration against synthetic dependencies and domain RPC stubs:
permission/active gates, all nine routes, source/activity/workspace conflicts,
concurrent duplicate commands, propagated domain/admin failures, read-only candidate
loading and denied anonymous execution. Stubs do not recertify v38 business rules.

After review and separate deployment approval: apply this migration, deploy the
frontend, then separately approve a user acceptance check with Eden. Until that
approval, do not modify either Eldar record, send a new optimization request, merge
or deploy. Infrastructure activation from PR #2372 remains a separate gated rollout.

Validation result: 17 focused Node/JSDOM cases and 7 isolated PostgreSQL scenarios
passed. Only new/affected cases were rerun while fixing test fixtures and the async
cancellation error path. The candidate read was rerun after narrowing its projection.
The complete production build passed after installing the lockfile dependencies into
this isolated worktree (initial shared node_modules lacked qrcode). No package/lockfile
change was made. Existing Vite warnings concern xlsx default export, mixed static/dynamic
imports and large chunks. Node's CSS-import warning is expected for these JSDOM tests.
Generated dist output is excluded from the PR. HOTFIX_VERSION and CACHE_VERSION are
updated; no new CI workflow, E2E job or infrastructure deployment is included.

CI follow-up: five existing contract cases were updated for the enabled agent-load
button and guarded assignmentRpc facade. Browser compute stays disabled; draft-only
writes and final date-change confirmation ordering remain asserted. These five cases
passed separately (22 focused Node cases total, without counting repeats).

## Focused PR review follow-up: manual selection beside recommendations

`instructorsResultsHtml` now includes the manual picker for both recommended and
bestAvailable result layouts. It does not rely on a later runtime enhancer inserting
controls. The selected manual replacement has an explicit pending-server-validation
notice, even when selecting a previously recommended instructor through the manual
picker. Neither selection nor opening the picker mutates the assignment. The guarded
replacement RPC and its existing complete server checks determine success.

Six focused Node/JSDOM cases cover direct HTML in both layouts; an operation_manager
with Eden-equivalent permissions completes manual replacement through actual bound
controls, reason entry, and the fenced server request. Tests delay the server response
and verify the old instructor stays in place, then simulate success, overlap rejection
and manager-approval-required rejection. A separate case verifies selecting the
recommended instructor manually is still explicitly pending verification. No real
server mutation, optimization or browser planner is used in these tests.

### Combined migration acceptance and deployment order

The actual PR #2372 head `27cdcb3127a11ef122ee10ec138e002568bed50f` was compared with
its checked-out fixture/migration before testing. A disposable local PostgreSQL DB
applied the existing queue/OIDC migrations, then both PR migrations, in order.
Three new combined scenarios verify: installation keeps Cron and autonomous compute
paused with zero dispatch; an operation_manager can read/select and invoke the
manual replacement RPC while compute stays paused; the worker's atomicCompletion
probe contract survives installation of the dashboard migration. Domain mutation
functions remain synthetic stubs; this proves migration/API coexistence, not a live
production business-rule certification. A fixture result-decoding failure was fixed
and only that affected scenario was rerun.

After separate merge/deployment approval, use this order:

1. Retain the existing base migrations through `20261015190000`.
2. Apply #2372 `20261016000000_scheduling_agent_durable_wakeup.sql` first. Keep
   `autonomous_enabled=false`, supervisor Cron inactive, and existing owner enable
   gate under owner control. Do not dispatch or enqueue acceptance calculations.
3. Apply #2373 `20261016100000_scheduling_dashboard_agent_controls.sql` second.
   It adds different RPC names; it does not replace worker_command, wakeup, queue
   admission, recovery, result receipts or alerts from #2372.
4. Deploy the paired worker-api/wakeup Edge code from #2372 and configure its
   GitHub App / Vault / Graph secrets securely, while compute remains paused.
5. Deploy the #2373 frontend after its RPCs exist. HOTFIX_VERSION includes the
   manual-picker review fix and frontend CACHE_VERSION is 2016. No cache list or
   root SW version source is added.
6. Run verify-only readiness for #2372 and read-only UI checks under the intended
   role. Separately authorize any production acceptance assignment/test email;
   these are not permitted by this PR's test execution.
7. Only with further explicit approval activate Cron/autonomous processing and
   perform a real optimization. This activation is independent of manual dashboard
   assignment management, which is available while automatic compute is paused.

All six management actions are implemented/tested through guarded APIs: selecting
an agent option, manual selection, saving a draft, confirming assignment, replacing
and cancelling. They are not claimed as already available in production before
migration/frontend deployment and live acceptance approval.
