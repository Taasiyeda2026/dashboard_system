# Manual scheduling contract — official activity schedules

Updated 2026-11-26, after PR #2807. Scheduling is manual only.

## Ownership and operator workflow

All Activities owns dates, start/end dates, hours, session count, school,
authority and activity requirements. Scheduling selects an instructor, validates
that choice and saves a draft or final assignment. The manual dialog cannot edit
activity dates or times. Replacement effective date remains an assignment field.

Every assignment entry opens the compact manual dialog directly. The activity
summary is read-only; the complete official meeting list is collapsed initially.
Name search filters the existing manual directory locally, without RPC calls,
ranking or recommendations. Inactive instructor contacts remain selectable and
visibly marked because the existing manual server policy treats inactivity as an
acknowledgeable warning. Only explicitly approved active management users are
added as management choices; their final assignment still requires an admin.

One **בדיקה ושמירת שיבוץ** (or draft) click performs the existing preview and,
when it returns no blockers, warnings or reason requirement, commits immediately.
Warnings stop the workflow for explicit acknowledgement. The reason field is
shown only when `reasonRequired` is true. There is no separate check button.
Blockers prevent saving and preserve the operator's selection.

Missing/invalid official dates, hours or session count prevent assignment. The
activity correction action uses the existing All Activities navigation and edit
permissions. No dates, hours or weekly sequence are generated.

## Preserved business policy

The existing manual classifications remain unchanged. Overlap, full-day tours,
availability, inactive instructors, profile/language/gender, program/authority,
Friday/Saturday, holidays, shortened school days, cached routes, distance and
travel time remain explicit warnings under the existing operator policy.
Authorization, canonical IDs, season/date/time/count/order validity, duplicate
secondary instructor, locks, historical integrity and activity revisions remain
hard checks. Management final approval remains admin-only.

Cancellation, additional instructors, substitutions, individual meetings and
other approval/notification interfaces are not redesigned by this change.
Replacement preserves earlier meeting attribution and its effective date.

## Server boundary

Implementation: `services/scheduling-agent/manual-operations.sql`.
Migration: `supabase/migrations/20261126142551_manual_scheduling_official_schedule.sql`.

- `scheduling_manual_capabilities` retains v1 compatibility and advertises
  `officialScheduleReadOnly: true`. The new frontend requires this capability and
  fails closed when the paired migration is missing. No legacy picker fallback.
- `get_scheduling_manual_assignment_preview` calls `scheduling_manual_private.prepare`.
  `prepare` reads all dates and hours from the current activity. New clients send
  null legacy schedule arguments. Legacy clients supplying different dates/hours
  receive `scheduling_official_schedule_read_only`.
- `commit_scheduling_manual_assignment` retains shared/instructor/activity locks,
  authorization, timestamp, preview hash, warning acknowledgement and reason
  checks. It repeats validation and writes instructor/draft fields only. It does
  not UPDATE date fields, start/end date or hours.
- `scheduling_set_activity_meetings`, used by legacy scheduling finalizers, now
  asserts exact official dates/hours and returns the existing activity without
  writing its schedule. It cannot establish dates for an undated activity.
  All Activities uses its independent activity-edit API.
- `scheduling_effective_meetings` uses official dates/hours for both confirmed and
  draft occupancy, preserving cancellation/pending-history exclusions and the
  existing effective end-time function. Old draft dates never take precedence.
- `draft_matches_official` compares legacy draft values semantically. A mismatch
  adds `manual_draft_schedule_changed` to the fresh preview and requires explicit
  acknowledgement/reason. Preview never edits or deletes a draft. An authorized
  subsequent save records its original contents in audit `previousDraft`.
- Existing private decision receipts, audit context, history and trigger guards
  remain in place. No data backfill, deletion, automatic scheduling, new cron,
  polling or Edge Function is introduced.

## Stale results, failures and resource use

Editing selection/action/effective date invalidates preview and consent. While
checking/saving, controls are disabled and duplicate clicks are ignored. A changed
warning hash causes a fresh preview without automatic retry/consent. An activity
revision conflict reloads that activity once and checks again; the operator must
review and click again. Refresh failures leave the editor open without success.
Only a validated server save response closes the dialog and updates the screen.

Opening the dialog does not request candidates, routes or planning snapshots.
Search does not perform server validation. Preview and commit each perform the
necessary server checks using existing cached route facts.

## Verification and deployment

Use focused Node controller/bound UI tests, the isolated PostgreSQL gateway suite,
the synthetic desktop/mobile browser harness, frontend build, cache checks and
Basic PR Check. Never run assignment tests against production records.

The PostgreSQL suite accepts only localhost databases with names ending `_test`.
It rebuilds synthetic fixtures and executes implementation SQL and the migration.
Run with `SCHEDULING_MANUAL_TEST_DATABASE_URL`. The browser harness is
`node tests/manual/manual-scheduling-browser.mjs`; it starts local Vite, mocks
RPC responses and blocks all external requests. `CHROMIUM_PATH` is optional.

After independent review: apply the migration before releasing the paired
frontend; confirm `officialScheduleReadOnly` under an authorized identity, then
release the frontend with both cache layers refreshed. This change does not
require a gateway or Edge Function deployment. Keep automatic scheduling off.
No production migration, assignment, merge or deployment is part of preparation.
