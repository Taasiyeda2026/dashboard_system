# Private scheduling agent gateway — staged release

This change provides a read-only private Sheets reader, deterministic synchronization
diffs, a stateless MCP transport, and an owner-bound, human-approved dashboard
confirmation path. **It is not an active bidirectional production synchronizer.**
No existing scheduling rules, assignments, dates, instructors, or instructor constraints
are migrated. Do not enable either write switch during setup or dry-run verification.

## Actual rollout state

- Base migration `20261013220700_scheduling_agent_approval_gateway.sql` was installed
  under the earlier authorization for technical configuration. Its database control
  remains `enabled=false`; no real approval requests or assignments were created.
- A v1 JSON API was deployed before the later instruction prohibiting further
  production deployment. Anonymous POST requests were verified to return HTTP 401.
- The human-channel follow-up migration, Google service-account adapter, MCP transport,
  and approval/consent page in this PR are **staged, not deployed**.
- The existing private plugin has not been pointed at an unverified MCP endpoint.
- Google server credentials and Supabase OAuth-server settings have not been changed.
- Google cell writes are deliberately absent. Do not interpret dashboard confirmation
  as a completed sheet update: the receipt explicitly reports a separate pending projection.

## Authority and approval

Operational records remain the source for confirmed assignments. Spreadsheet manual
choices and unconfirmed dashboard suggestions are compared; differences do not mean
the spreadsheet should automatically be overwritten. Unknown/duplicate course IDs block
sync. The gateway allows existing stored plan options only and preserves confirmed,
secondary, draft, and locked assignments. Business-rule changes are outside this release.

The existing `set_scheduling_planning_lock` and `confirm_scheduling_planning_draft`
execute inside a single database RPC transaction with the durable approval receipt.
The immutable request includes source/workspace revisions, activity version, selected
option, sheet hash, owner identity and expiration. A failure rolls back assignment,
lock, approval consumption and existing audit writes. A committed request returns the
same receipt on retry. Pending requests expire after 30 minutes; approval lasts at most
10 additional minutes, bounded by the original expiry.

Approval is not an MCP tool. The follow-up migration rejects OAuth `client_id` tokens
at the human approval and operator-queue endpoints. Only the owner's active first-party
admin session can approve the exact preview hash through the separate review page.
No `service_role` key, plaintext credential, arbitrary SQL, arbitrary RPC, arbitrary
spreadsheet ID, or arbitrary assignment payload is accepted from a tool argument.

## Google access: shortest safe setup for a dedicated private file

Use a dedicated Google service account, with no Google Cloud IAM roles and no domain-wide
delegation. Share **only the selected file**, initially as Reader. No folder-wide or public
sharing is necessary. An OAuth refresh-token reader is also implemented, but setting up
an OAuth web application and consent flow is more involved for this single-file use case.

The user must perform the Cloud/secret steps because the installed connectors do not
create Cloud service accounts or write Edge Function secrets:

1. In Google Cloud Console, select a project and enable **Google Sheets API** and
   **Google Drive API** under APIs & Services → Library.
2. IAM & Admin → Service Accounts → Create Service Account. Use a dedicated name such
   as `taasiyeda-scheduling-agent`. Leave project roles empty. Create a JSON key from
   Keys → Add key → Create new key → JSON.
3. In the Supabase project, open Edge Functions → Secrets and save the **complete JSON**
   as `SCHEDULING_AGENT_GOOGLE_SERVICE_ACCOUNT`. Do not put it in chat, Git, a Sheet,
   a public environment variable, or a client-side app.
4. Return **only `client_email`**, which is non-secret. The existing Drive connector can
   then grant Reader permission to that verified account on the one grounded file.

The service-account token requests read-only Drive/Sheets scopes. The library import
is pinned to `google-auth-library@11.3.0`. Native metadata is verified before and after
a bounded read; file identity, parent folder, revision and tab structure must match.
Credentials and tokens never enter response payloads or logs. The connected Drive
plugin's token is not copied or extracted for server use.

References:
- https://developers.google.com/identity/protocols/oauth2/service-account
- https://docs.cloud.google.com/iam/docs/creating-managing-service-accounts
- https://docs.cloud.google.com/iam/docs/keys-create-delete
- https://supabase.com/docs/guides/functions/secrets

## MCP connection and first-party approval UI

After explicit approval for staging/deployment, publish the code and follow-up migration
while keeping writes disabled. The static approval page is
`scheduling-agent-approval.html`; it uses the existing dashboard sign-in session.
The page also implements the separate OAuth consent view when `authorization_id` is present.

In Authentication → OAuth Server, the project owner must enable OAuth 2.1 and set the
authorization path to `/scheduling-agent-approval.html` on the existing Site URL.
Register the intended client, or enable dynamic client registration with explicit owner
consent. No settings were enabled in this task. Verify discovery, PKCE sign-in, owner
read access, non-owner denial, and the inability of an agent token to approve.

Only after live read verification should the existing private plugin receive the
verified MCP URL (`.../functions/v1/scheduling-agent-gateway/mcp`). Neither plugin scope
nor sharing should change. The implemented tools are read_snapshot, preview_changes,
request_approval, commit_approved_changes and verify_commit. The read response includes
the review-only sheet/dashboard diff when Google is configured; otherwise it explicitly
reports `googleStatus=authorization_required` and blocks approval creation.

Reference: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication

## Required before any production write activation

1. Configure Google access and complete a signed, read-only end-to-end check.
2. Test the follow-up migration and human UI against real existing RPCs in staging:
   local PostgreSQL tests use transactional stubs and are not production acceptance.
3. Reconcile unmatched IDs and stale planning rows through specifically approved actions.
4. Implement and verify a separate approved sheet projection/write path with concurrency
   protection. Native Sheets REST batchUpdate is atomic per batch but does not guarantee
   preservation of concurrent collaborator edits. Do not silently treat Drive version
   as a supported Sheets conditional-write token. Google MCP `requiredRevisionId` is a
   Developer Preview feature; availability must be verified before relying on it.
5. Distinguish a dashboard commit from a failed/pending sheet mirror; never roll back
   another user's later change or report cross-system atomicity that does not exist.
6. Obtain explicit approval for merge/deployment and, separately, activation of writes.
   Both `scheduling_agent_control.enabled` and `SCHEDULING_AGENT_ENABLE_COMMITS` must
   remain false until those conditions are met. Google initially stays Reader/read-only.

Known existing constraint differences were observed, not changed: the frontend
transition-distance gate is stricter than the deployed SQL for long gaps, and one
confirmation RPC's Saturday sector check differs from the shared Arab/Druze policy.
Existing guards remain authoritative at commit; this gateway does not bypass them.

## Validation completed

- 40 distinct feature/database test cases passed (16 isolated PostgreSQL cases,
  24 gateway/reader/MCP/service-account/UI/diff cases).
- Three focused existing PWA/cache checks passed; cache marker and version updated.
- Vite production build passed. Deno TypeScript check passed after installing the
  pinned Google library through npm; direct Deno registry access was unavailable locally.
- Real-data dry-run: all 236 source rows checked, 127 matching, 101 different,
  eight unmapped IDs; zero writers and identical before/after input hash.
- Live readback confirmed no version changes in any of the 243 operational courses,
  no source/workspace revision change and zero real approval requests.
- Anonymous live v1 access returned HTTP 401.
- Security advisors reported expected deny-all RLS information and authenticated
  SECURITY DEFINER notices for the explicitly owner-gated RPCs. No anonymous grants
  or table access were added. General existing project findings were not modified.

Tests were repeated only after relevant source changes or to correct two multi-statement
calls in the isolated test harness. No legacy/full regression suite was run.

Local commands:

```sh
node --test tests/scheduling-agent-*.test.mjs
PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/acceptance/scheduling-agent-db.mjs
node scripts/acceptance/scheduling-agent-dry-sync.mjs /private/snapshot.json /private/dry-run.json
```

Use `@electric-sql/pglite@0.5.9` for the isolated harness. The harness cannot connect
to production. Private snapshots, identities, keys and audit exports must never be
committed to this public repository.
