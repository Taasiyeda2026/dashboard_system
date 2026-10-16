# Activity notes in the organizational scheduling agent

`read_activity_notes(activityId)` returns the actual general `activities.notes`, a `notesVersion`, and `canAppendNotes`. It does not return financial or private notes.

`append_activity_note(activityId, note, expectedNotesVersion, requestId)` appends the explicitly requested text, preserving the existing note verbatim. Dates and a complete schedule are not prerequisites. Use the version returned by the read and a new UUID for each intentional append. Read back to verify. An uncertain outcome must be read before retrying; an exact retry must reuse the same request ID and content. Duplicate acknowledgements are safe and do not append twice. A reused ID with different content or a stale notes version is rejected.

Access is shared across existing authorized team users, using their own JWT. Both RPCs require existing team membership; writing also requires `app_can_edit_direct()`, the same predicate used by the activities UPDATE RLS policy. No roles or permissions are expanded. The audit table is RPC-only with default-deny RLS and revoked client grants.

The activity field, linked planning intention, and instructor baseline are distinct destinations. When asked for an activity note, use these actions; never silently save a planning note instead. A note such as an estimated-date warning never approves a schedule or exception. Assignments, dates, locks, availability and approval logic remain unchanged.

Deploy the additive migration, merge the gateway changes, then deploy the team gateway preserving its existing custom per-user authentication. Refresh the connector tool catalog to expose both actions. No user activity records need to be edited during rollout.

Focused validation: gateway tests in `scheduling-agent-activity-notes.test.mjs`; isolated PostgreSQL scenarios in `scheduling-agent-activity-notes-postgres.test.mjs` (PGLite through `PGLITE_MODULE_PATH`). They cover permissions, field privacy, append preservation, audit attribution, stale versions, retry idempotency and missing dates. No production fixtures are written.
