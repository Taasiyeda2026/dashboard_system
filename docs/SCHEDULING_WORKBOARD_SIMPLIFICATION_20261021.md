# Scheduling workboard simplification — 21 October 2026

Scope: UI and read-only activity fields only. No database migration, automatic planning change, new route requests, or production assignment writes.

## Operator workflow

- The activity filters, status counts, and operational activity list appear first.
- National plan, recruitment models, and instructor completion remain available in a collapsed "תכנון הסוכן וצרכי גיוס" disclosure; expanded state survives UI rerenders.
- When the existing `scheduling_manual_capabilities` API is available, admin and operation_manager see a single primary workboard action for manual assignment or change. The action uses `get_scheduling_manual_assignment_preview` and `commit_scheduling_manual_assignment` with full server revalidation, existing history and role controls.
- If the new API cannot be reached, the legacy route remains available. This branch does **not** widen legacy bypasses.
- Stale plan details remain read-only until refreshed, while manual operations are independent of agent calculations.
- Activity general notes, scheduling notes, and authorized operational notes are presented under a compact, collapsible detail disclosure. No note is submitted to the scheduling engine; no notes are altered.

## Guardrails

- Approved assignments, original meeting history, existing manual decision receipts, and instructor calendar occupancy are unchanged.
- The private operational note is visible only to authorized admin/operation_manager with scheduling permission.
- Technical blockers (activity revision, invalid dates or counts, protected history, canonical identities, authorization) remain enforced server-side; business warnings still require explicit acknowledgement and recorded reason.
- No SQL rule changes are included. The previously identified transition buffer/cap inconsistency is a **separate policy/engine decision** and should not be silently changed as part of a cosmetic workboard patch.

## Acceptance

- Verify first-open layout: status counts and workboard above collapsed planning, on desktop and mobile.
- Confirm saved proposals and instructor overview remain accessible on opening the planning disclosure.
- On current manual API, test draft, confirmation, reassignment, one conflict warning/acknowledgement, stale activity revision, and notes for admin/operation_manager.
- Test that activity manager cannot see operational private notes or an unauthorized direct manual entry.
- Verify regression tests for legacy fallback, instructor calendar, attendance, and course/meeting history.
- Do not merge/deploy until CI and an operator read-only review pass, followed by explicit production authorization.
