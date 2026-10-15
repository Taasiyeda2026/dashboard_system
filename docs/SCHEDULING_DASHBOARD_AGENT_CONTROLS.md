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
