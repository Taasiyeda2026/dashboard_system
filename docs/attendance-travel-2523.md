# Attendance travel fixes — issue #2523

This change fixes the October 30 audit findings without repairing historical
attendance, reported kilometers, payroll, route caches or manager decisions.
No production migration, Edge deployment, route recalculation or backfill was run.

The definition-only migration keeps the existing resolved-shape constraint and
RPC ACLs. New compensation rows start with zero payable minutes; reconciliation
also sets the payable field in the same UPDATE that enters `resolved`, preserving
locked decisions. System travel estimates still cannot approve payment. It also
preserves ordinary physical-training destination snapshots and recognizes the
explicit online modes in attendance-control location contexts.

The Edge distinguishes reconciliation, provider, route-data, cache and location
review failures. Reconciliation failures log only the database error code and do
not queue already-working routes as missing. No address or system travel estimate
is added to the instructor response.

Control loads both directions of address-only home routes, with bounded address
batches and existing deduplication. Legacy outbound-only fallback is retained,
including location rows without a home-address snapshot. Cancellation messages
require a guide claim or review/eligibility context; explicit zero claims remain
visible. Remote rows do not display physical-travel cancellation errors.

New/edit physical-report forms require an explicit kilometer amount, accepting
zero. Existing zero values stay zero. Online/public-transport reports retain zero
kilometers, and no system distance is copied into the instructor's claim.

Focused verification:

- `tests/attendance-travel-2523.test.mjs`: eight behavior/contract tests, including
  actual Edge requests with mocked dependencies, directed-cache loading across
  two address batches, mixed remote/physical days and blank versus explicit zero.
- `tests/attendance-travel-2523-postgres.test.mjs`: eight database tests using the
  actual changed SQL and existing review/payable functions in an isolated local
  PostgreSQL 16 container. Includes no migration-time data changes, unchanged RPC
  access, new/legacy pending rows, all locked decision types, physical/scheduled
  training, public transport and explicit online location flags.
- Seven existing actual-day route tests and three existing manager kilometer
  choice tests exercise day allocation, reverse/fallback behavior and write-back
  choices. No full legacy suite or additional CI workflow is introduced.

The database tests are opt-in with
`ATTENDANCE_TRAVEL_TEST_CONTAINER=attendance-travel-2523-test`. They accept only
that disposable local container, create a database named
`codex_attendance_travel_test`, and never use application connection settings.
The Edge runtime tests use Node's TypeScript stripping API; verification used Node 24.

Deployment remains a separate step after review: apply the definition-only
migration and deploy the changed Edge/frontend together. Historical failures,
unverified locations and ambiguous addresses require separately approved review;
this PR does not retry or rewrite them.
