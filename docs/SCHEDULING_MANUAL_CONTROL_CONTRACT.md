# Human assignment and agent proposal boundary

Accepted product requirement, 2026-10-20. This document distinguishes the target
workflow from the limited client patch in this change. It is not proof of live
deployment.

## Target workflow

- The agent organizes proposals for unassigned courses only. Existing supported
  activity types remain unchanged: workshops and tours are managed manually and
  still block instructor calendars.
- An actual confirmed assignment is an immutable anchor for the agent: instructor,
  official dates, times, substitutions and historical meetings are retained. A
  later human edit becomes the new anchor. A conflict is reported; it does not
  authorize automatic reassignment or date movement.
- Eden (operation_manager) and admin, with scheduling permission, can select the
  instructor, dates and times and explicitly save, confirm, replace or cancel from
  the operational workboard without running or waiting for the agent.
- Human draft reservations and explicit choices must not be silently replaced by
  a subsequent optimization. A draft remains distinct from final assignment.
- Saving a human choice first commits the operational record and audit. Updating
  proposals for the remaining unassigned activities is separate and cannot
  determine whether the human save succeeds.
- The persistent instructor table is based on actual assignments/drafts, with
  saved plan proposals visibly distinguished. A missing/stale plan or stopped
  worker must not hide the table or manual controls.

## Implemented in this draft change

The client supplies activity updated_at on every mutation. It supplies plan
source/workspace revisions only when accepting a calculated proposal:
save_course_assignment_draft, save_course_assignment_draft_with_dates, or direct
final assignment without the same instructor in the saved activity draft.

Manual draft saves, matching saved-draft confirmation, reassignment, operational
replacement, cancellation and permanent unavailability confirmation do not use
the independently changing plan revision. They still use the allowlisted
scheduling_dashboard_assignment gateway and all existing domain validations,
permissions and audit.

This is a client dependency fix, not a new write API or constraint bypass.
Unknown actions are still rejected by the server allowlist. The matching-draft
test is not authorization: the server independently verifies the saved draft and
any required approvals.

## Live state observed before this change

The worker's compute-plan.mjs/runner.mjs boundary persists planning rows only.
The current planner builds live rows for protected operational assignments and
uses them as occupancy anchors. This must remain covered during the complete
change.

On 2026-10-20 the owner asked to stop the agent. worker enabled and
autonomous_enabled were set false, the scheduling-agent-supervisor Cron was
deactivated, and scheduling_agent_control.enabled remained false. Readback found
zero queued/running jobs. The later request preserves the agent's planning role,
but this draft does not reactivate it, enqueue calculations or send alerts.

## Work still required before claiming completion

1. Add an explicit manual date/time editor to the independent operational flow,
   including activities without an existing schedule. Existing official dates
   require explicit human confirmation; preserve attendance and completed meetings
   when changing a started activity.
2. Repair the server manual policy consistently across draft, confirmation,
   reassignment and date changes. Current manual guards can still reject missing
   route cache entries or demand additional approval. The diagnosed Alex/Gedera
   case remains blocked by scheduling_transition_unverified despite no overlap
   and a 4h45 gap. Merely removing plan revision checks does not repair it.
3. Preserve hard identity/permission/activity-version checks, real overlap
   detection, instructor locks and existing historical records. Document any
   changed travel/approval rule explicitly with scoped audit and regression tests.
4. Verify a confirmed human assignment cannot be changed by a later full or
   incremental planning run; test manual draft preservation, concurrent human
   edits, and plan invalidation after a human save.
5. Run Node tests, build/cache checks, isolated Postgres and Eden-equivalent
   desktop/mobile acceptance for the completed manual flow. Only then deploy
   the complete change and restore planning in the limited role above.

## Validation of the client patch

Seven behavioral test cases are provided in
tests/course-scheduling-manual-plan-independence.test.mjs. The actual module and
test bodies were executed in an isolated JavaScript V8 runtime: seven passed.
The Node imports/harness, application build, browser UI and Postgres flow have
not been executed because the shell execution environment is unavailable.

No operational scheduling records, SQL definitions, permissions or worker
activation settings are changed by this PR. No merge or deployment is claimed.
