# Durable planning intentions

The team MCP (not the owner gateway) exposes three additional tools:

- `read_planning_intents`: current baselines and intended instructors, with versions.
- `save_planning_baseline`: durable instructor planning text (weekdays, primary schools, alternatives and conditions). Separate from existing profile notes and availability. Text survives optimization but is not itself an executable scheduling constraint.
- `save_intended_instructor`: versioned active/released instructor choice for a specific open, unassigned course, with no date/hour requirement. An active choice holds that course out of automatic optimization until explicitly released or finalized for the chosen instructor through the existing validated assignment workflow.

Read the snapshot and intentions first. Use expectedVersion `0` only for a new record; otherwise use the returned version. After an uncertain write outcome, read before retrying. A stale version is rejected, not merged implicitly. Save alternatives as baseline text; never convert an alternative into an active course choice without explicit user instruction.

A choice is not eligibility approval, a validated draft, an exception approval, or a calendar reservation. Dates, hours, travel, availability, and required approvals remain subject to the existing confirmation validators. Intent saving rejects existing official assignments, drafts, and planning locks. Explicit release is possible even after assignment; it never removes the assignment.

The worker receives a narrow machine-only intent view. Active unassigned courses are emitted as pending-validation exception rows retaining official meeting dates and cancellations, without assigned instructor or alternative proposals. Database guards reject stale worker proposals and conflicting instructor confirmations. Changes fence in-flight snapshots through the existing source revision. Baselines and choices are audited and never deleted by optimization.

Deployment order: apply the additive migration; deploy worker-api (existing custom OIDC authentication); merge the worker code; deploy team-gateway (existing per-user OAuth authentication). Do not create a verification optimization job. Check exact deployed source and tools/list after the connector refreshes. Existing authentication settings must stay unchanged.

Focused tests: `tests/scheduling-planning-intents.test.mjs`. The PostgreSQL test uses an isolated PGlite runtime via `PGLITE_MODULE_PATH`, with synthetic users/courses only; it must never point at production. It exercises access denial, optimistic versions, audit history, protection against stale planning and manual writes, and explicit release.
