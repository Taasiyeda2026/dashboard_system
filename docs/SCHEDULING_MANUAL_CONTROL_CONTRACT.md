# Manual scheduling with explicit operator decisions

Accepted requirement: 2026-10-21. Isolated PostgreSQL, UI, build and cache checks
passed in GitHub Actions; production readiness is verified during rollout.

## Product behavior

The agent organizes proposals for unassigned courses only. Confirmed instructor,
dates, times, secondary instructor and meeting substitutions remain fixed anchors.
Only an explicit human action changes them. Workshops/tours stay manual and remain
calendar occupancy.

Active admin and operation_manager with scheduling permission can select an
instructor and individual meeting dates/times independently of the agent, save a
draft, confirm or replace an instructor. Existing cancellation actions remain.

ALL scheduling business constraints become warnings in this new manual path:
overlap, full-day tours, missing/explicit unavailability, inactive instructor,
missing profile, language, gender, blocked authority/program, Friday/Saturday,
holidays, shortened school day, missing routes, distance and insufficient travel
time. Automatic recommendations still use their existing strict constraints.

The warning popup lists dates/other activities when applicable. The operator must
explicitly acknowledge every presented set and enter the business reason or
describe an advance admin approval. The same operator can save immediately.
No second-person approval or agent calculation is required.

Canonical IDs, active operator authorization, valid date/time format, season
bounds, count/order, activity revision and historical record integrity remain
enforced. Past/recorded/cancelled meeting positions/times are preserved. A stale
activity or changed warning set requires another preview, never a blind save.

## Server boundary

services/scheduling-agent/manual-operations.sql is the implementation source.
The pinned Supabase CLI generated supabase/migrations/20261020213712_operator_manual_scheduling.sql.
The generated migration contains this exact tested source. Never run assignment
tests on production records.

- scheduling_manual_capabilities: permission-gated API availability.
- get_scheduling_manual_assignment_preview: read-only canonical preview, warnings,
  activity revision and hash of the exact checked result.
- commit_scheduling_manual_assignment: repeats authorization/checks under the
  shared planning/source lock plus instructor/activity locks. Rechecks the hash,
  acknowledgement and reason, writes once and audits the decision.
- scheduling_manual_private.decisions: private, RLS-enabled receipts with no
  client schema/table/function privileges. Scope includes exact instructor,
  school/location, all official/draft dates/times and home addresses. Clients
  cannot manufacture an exception by sending a flag or an audit entry.
- Existing calendar/tour/manual-approval/pending-reservation triggers recognize
  only a matching private receipt. Their ordinary paths retain their bodies.
- Locked revalidation honors the scoped decision, rechecks current limitations,
  and flags newly changed warnings without deleting/moving the assignment.
- Confirming a replacement preserves prior meeting attribution. Resolved pending
  reservations retain their original records in decision_context. Changing an
  intended instructor is itself acknowledged and audited before release.
- Draft dates/times reserve the calendar through draft_proposed_meetings, without
  altering official hours. Final schedule updates are atomic, not 35 partial edits.
- A scoped shortened-day acknowledgement preserves the explicitly chosen end.

No route/network calculation occurs on this path; it reads existing cached facts.
A missing fact is an acknowledgeable warning. There is no invented distance or
long-gap shortcut.

## Live rule drift found during preparation

The older map describes a 120-minute separate-trip boundary and a 5/15-minute
buffer. Live SQL on 2026-10-21 instead defines
scheduling_transition_distance_cap_applies(gap) as every nonnegative gap and
scheduling_transition_buffer_minutes(km) as 10 minutes through 10km, otherwise 15.
This change reports that contradiction and does not silently alter those automatic
rules. The manual path makes their business constraints explicit warnings.

## UI and agent boundary

The frontend probes the paired API once; until available it retains the existing
interface. Eden/admin manual entry then opens the independent editor. A changed
instructor/date/time invalidates the preview. Late responses cannot certify new
inputs. The warning state is an alertdialog with a reason, acknowledgement and
explicit save. Failure never reports success or clears the user's editor.

Operational commands omit unrelated plan source/workspace revisions but keep the
activity timestamp. Accepting a stored proposal retains its plan revision checks.
The agent snapshots protected source rows before compute and rejects changes to
their instructor, schedule, substitutions or secondary instructor. Fixed anchors
do not request routes again during final validation. Unlocated existing anchors
remain visible, while unassigned proposals still need verified locations/routes.

## Verification and rollout

The manual workflow_dispatch job in the existing Scheduling Local Engine Cutover
workflow runs the disposable PostgreSQL test, application build, cache checks and
Supabase CLI migration generation. It has read-only contents permission, no
production credentials and no automatic PR build/browser job.

Run tests/scheduling-dashboard-agent-controls.test.mjs for the actual bound UI,
manual controller, revision fencing and fixed-agent regression cases. Run
tests/scheduling-manual-operations-postgres.test.mjs only with
SCHEDULING_MANUAL_TEST_DATABASE_URL pointing to a named local *_test database.
The fixture deliberately rebuilds it and rejects remote/production URLs. Fixture
dependencies are synthetic; the new API, scoped trigger bodies and revalidation
are actual implementation SQL.

Deploy the generated migration before the paired frontend and verify read-only
readiness under the intended role. Do not test by assigning a real instructor or
sending messages. Worker reactivation/optimization is separate from manual
operation; keep the production pause until the completed release is verified.

Verified 2026-10-20 UTC: isolated run 39501709430 passed 14 PostgreSQL tests,
the application build and six PWA/cache checks. Focused UI CI passed 63 tests,
including bound warning acknowledgement/save behavior and protected anchors.

Release verified: PR 2420 merged and Pages run 39502049081 succeeded. The API
was read-only previewed under authenticated admin and operation_manager for
Alex/Gedera: no blockers, missing-transition warnings, no assignment writes.
Planning worker/supervisor resumed; the external assignment gateway stays disabled.
The manual directory also retains inactive instructors with a visible inactive
label and warning acknowledgement; the automatic planning pool stays active-only.
