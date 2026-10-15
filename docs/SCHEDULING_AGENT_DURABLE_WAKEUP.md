# Durable scheduling worker rollout (staged, not activated)

This infrastructure keeps the v38 planner and all existing SQL validators unchanged.
The migration, Edge Functions, secrets and activation have NOT been applied by this PR.
No production optimization is part of this change. Merge, deployment and real runs
need separate explicit owner authorization.

## Runtime contract

`request_optimization` serializes admission by the existing year-workspace advisory
lock. The existing job row is the durable outbox. Its insertion attempts a `pg_net`
notification after commit; delivery failure cannot erase the accepted job.
The one-minute Supabase supervisor recovers expired attempts and repeats due wakes.
It is registered **inactive**, and `autonomous_enabled` defaults to **false**.

The wake function authenticates a dedicated secret, reserves a DB dispatch token,
then mints a GitHub App installation token restricted to repository ID 1212938814
and Actions write. It verifies the actual token permissions, repository scope and
workflow state before dispatching `scheduling-agent-worker.yml` on `main`.
This requires no ChatGPT or browser process. GitHub can still delay runner startup;
dispatch acceptance is neither a claim nor a completed calculation.

The existing workflow's push trigger is removed: merging code is not consent to
calculate. The worker also requires `atomicCompletion=true` from the DB probe.
Thus new worker code against the old database stops idle before snapshot/compute.
GitHub schedule remains a fallback, not the primary liveness mechanism.

One invocation handles one job; the supervisor wakes remaining queued work.
Dispatch reservations last 90 seconds; accepted dispatches get two minutes to claim.
There are at most six dispatch attempts per computation attempt (30s exponential
backoff, capped at ten minutes). Three computation attempts are allowed. A running
machine job with a heartbeat older than 15 minutes is recovered only if no active
year-workspace lease exists. Historical browser claims are never reclaimed.
Only allowlisted network/revision/deadlock failures retry automatically. Domain
validation failures are terminal. Every minute supervision records terminal failures
and jobs queued/running without progress for 15 minutes, including persistent dispatch
failures and unresponsive workers. It creates one critical
`staff_messages` popup per job/fault type, addressed only to the active approving admin
through the existing selected-recipient UI (15-second polling when open).
A private `scheduling_agent_alerts` outbox delivers Microsoft 365 email independently
of the dashboard, using the existing verified server-only office mail identity (`FEEDBACK_STAFF_MS_*`). Recipient
email is resolved from that current active approver's `public.users.email`; callers
cannot choose recipients. Tokens must identify the configured tenant/app and carry
`Mail.Send`. The existing office sender identity is deliberately reused; no new Graph grants or personal tokens are introduced.
Mail sends have 90-second reservations and a durable `begin_send` barrier. The
four fault types are terminal failure, overdue queue, unresponsive worker and
persistent GitHub dispatch failure. Emails include type, job ID, UTC detection time
and an operator action. Healthy runs produce no mail. Unique job/fault keys suppress
repeated alerts for the same fault.
Only an explicit Graph 429 rejection releases the barrier for a bounded retry
(at most five reservations with backoff). A crash, uncertain response or lost ack
after begin_send is **never automatically resent**, preventing duplicate email.
Supervision marks it delivery_unknown and appends a visible warning to the existing
popup; the owner must inspect the sender mailbox. This trades guaranteed delivery
under an ambiguous outage for the requested no-duplicate behavior. `delivered_at`
means Graph accepted the mail (202), not inbox delivery. No exactly-once/inbox-delivery
guarantee is claimed. Planning receipts independently remain exactly-once.
If Supabase Cron itself stops, it cannot alert on its own outage: use an independent
platform uptime monitor for that failure class before claiming end-to-end monitoring.

Claim assigns its run ID atomically. Each attempt is fenced by that ID and the
existing lease/revision checks. Persist calls the unchanged full/incremental saver,
checks final preflight, writes a receipt and marks the job completed **in one DB
transaction**. A retry of persist/finish for that same run returns the receipt.
Concurrent duplicate deliveries cannot apply twice. A source edit after completion
is a new invalidation, not permission to replay an old job. Failure before commit
rolls everything back. Retries recompute from a fresh snapshot; this is not resumable
CPU checkpointing. Confirmed assignments and locks remain guarded by the old savers.

When an incremental snapshot has no targets, the runner does not call the planner.
It requires zero dirty rows and the exact current engine, then submits an explicit
`validationOnly:true`, empty patch. SQL independently rechecks those conditions,
lease and revisions, and calls the existing incremental saver. Its unchanged v38
wrapper validates the entire stored workspace, including protected rows. Only a
successful transaction advances the source stamp and completes the receipt. A
validator error rolls back; an old engine/dirty workspace cannot use this path.
This is the same empty-patch mechanism already used by the dashboard marker path,
now available in the server orchestration. No direct stamp update is added.

## Owner setup required — stop before this boundary

No broad personal access token is supported. Create a GitHub App under the repository
owner account at https://github.com/settings/apps/new:

1. Name it, for example, `Taasiyeda Scheduling Wakeup`. Set the homepage to the repo.
   Webhook delivery can be disabled; no OAuth user flow is required.
2. Repository permissions: **Actions: Read and write**. Metadata read is automatic.
   Do not grant Contents write or Administration. Restrict installation to
   **Only select repositories → dashboard_system**.
   GitHub's Actions permission is repository-wide, not per workflow; the server
   enforces the fixed workflow/branch allowlist.
3. Record the App ID and installation ID (from the installation URL), then generate
   a private key. Keep it off Git, chat, logs and browser code.
4. GitHub normally downloads a PKCS#1 RSA PEM. Convert it locally to unencrypted
   PKCS#8 for Web Crypto: `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app.pk8.pem`.
   Both files are secrets; use a protected directory and delete temporary copies
   after secure upload. Do not paste their contents into chat.

After separate deployment approval, configure server-side Edge Function secrets at
https://supabase.com/dashboard/project/szinlhjuwyiyszdpsdop/functions/secrets:

| Secret | Value |
|---|---|
| `SCHEDULING_GITHUB_APP_ID` | App ID |
| `SCHEDULING_GITHUB_INSTALLATION_ID` | Installation ID |
| `SCHEDULING_GITHUB_APP_PRIVATE_KEY` | PKCS#8 PEM |
| `SCHEDULING_WAKEUP_SECRET` | Random dedicated secret, at least 32 characters |

Store that last same value in Supabase Vault under the name
`scheduling_agent_wakeup_secret`. Use Vault UI or a secure operator channel, not a
committed SQL file. Do not reuse a user token, publishable key or service-role key.
Existing Supabase runtime credentials stay inside Edge Functions.

Microsoft 365 readiness uses the existing `FEEDBACK_STAFF_MS_TENANT_ID`,
`FEEDBACK_STAFF_MS_CLIENT_ID`, `FEEDBACK_STAFF_MS_CLIENT_SECRET` in the same project.
The sender is pinned to `office@think.org.il` and the owner recipient remains the active admin. Do not paste
or replace credentials in chat. Confirm in Entra that this existing application has
Graph **Application Mail.Send** with admin consent and is restricted through Exchange
application RBAC/access policy to the chosen sender mailbox. No new broad application
permission is granted by this PR. If shared credentials lack Mail.Send, stop for owner
approval to configure a suitably mailbox-restricted app; do not grant it automatically.
The approving admin must have a valid email in `public.users`. No address is committed.
Existing deployed mail functions prove an integration exists, not that these credentials
or mailbox permissions are currently valid for this service.

## Deployment and readiness — separately approved, still paused

1. Merge only after review. Deploy both `scheduling-agent-wakeup` and the modified
   `scheduling-agent-worker-api`. Their `verify_jwt=false` settings are intentional:
   the former checks its dedicated secret, the latter verifies GitHub OIDC.
2. Apply `20261016000000_scheduling_agent_durable_wakeup.sql` after the existing
   `20261015190000` migration. The CLI-generated file was resequenced because existing
   migrations already have later timestamps on the day of development.
3. Keep `autonomous_enabled=false` and the new cron job inactive.
4. POST `{"action":"verify"}` to `/functions/v1/scheduling-agent-wakeup` using
   `x-scheduling-wakeup-secret` from a secure operator client. This checks App identity,
   granted Actions write, repository scope and active workflow. It does **not** reserve
   queue work, send dispatch, acquire a lease or run the planner. Expected result:
   `verified:true`, `actions:"write"`, and the exact repository name, plus
   `alerts:{configured:true,mailSend:true,recipientReady:true}`. The mail check acquires
   a Graph token and reads the owner email readiness; it does not send email. Actual
   sender-mailbox authorization/inbox delivery needs a separately approved test mail.
5. Review queued/failed jobs, source/workspace freshness and protected-row baseline.
   Do not clear or replace existing jobs. A receipt-less historical failure is not
   automatically retried by installing this change.

## Activation — real calculation requires a further explicit approval

Enabling the gate can let the GitHub fallback consume the existing queued request
immediately. The approval must specifically include processing job
`d7592a28-9a2d-4288-b5ab-0dad107bc6c7` (if still queued) and future authorized requests.
Only then, in one operator transaction, set `autonomous_enabled=true` on the singleton
worker settings and activate cron job `scheduling-agent-supervisor`. Keep the existing
`enabled` gate under owner control. The next supervisor tick processes outstanding
due work; no manual `Run workflow` or new optimization request is needed.

Accept production operation only after checking dispatch audit, claim, lease,
`validated_plan_persisted`, receipt and `completed`, matching revisions, and unchanged
confirmed assignments/locks. Then verify another authorized request with both UIs
closed. Secrets/App permissions have not been validated live during PR development.

Read-only operator checks:

```sql
select id,status,attempt_count,dispatch_attempts,dispatch_failure_code,failure_code,
       claimed_at,worker_heartbeat_at,finished_at,result_receipt
from public.scheduling_agent_team_optimization_jobs order by created_at desc limit 20;
select job_id,run_id,event_type,created_at
from public.scheduling_agent_worker_audit order by id desc limit 50;
select jobname,active,schedule from cron.job where jobname='scheduling-agent-supervisor';
```

Pause by setting `autonomous_enabled=false` and deactivating the supervisor. New
worker commands then fail closed; an already in-flight save may finish its current
transaction. Do not delete receipts, jobs, planning rows or assignments to roll back.
For alerts, inspect `scheduling_agent_alerts` as an authorized operator: job_id,
kind,delivery_attempts,send_started_at,delivery_unknown,delivered_at,delivery_expires_at. The table has RLS and no
employee/anonymous table grants; machine delivery uses a service-only RPC.
Keep this protocol/migration paired; do not deploy the old runner against the new
receipt contract. GitHub schedule diagnostics can be pursued separately with Support.

## Isolated acceptance tests

`node --test --test-isolation=none tests/scheduling-agent-wakeup.test.mjs` covers signed
App JWTs, denied permissions, scope restrictions, disabled workflows, readiness,
authentication and lost network acknowledgements, with fake HTTP only.

`SCHEDULING_TEST_DATABASE_URL=postgresql://...@127.0.0.1:PORT/postgres node --test
tests/scheduling-agent-durable-postgres.test.mjs` creates and drops a unique database
on a **local-only disposable PostgreSQL** server. Never point it at a real database.
It executes the real migration and concurrent transactions against synthetic schema
dependencies. The existing domain saver is stubbed: these tests verify orchestration,
rollback, fencing and receipts, not a new certification of v38 business rules.
The v38 planner and validator source files are unchanged.

## Final review findings — 2026-10-15 (read-only production inspection)

- Run [38699085962](https://github.com/Taasiyeda2026/dashboard_system/actions/runs/38699085962)
  is a successful **schedule** event on main `d0924b866842938488c43392ec4359a12778bea2`.
  It claimed original job `d7592a28-9a2d-4288-b5ab-0dad107bc6c7` at 07:29:37 UTC;
  the worker log reports completed, current v38 engine, 251 rows at 07:30:08.
  Audit records saved source 665 at 07:30:05 and completed at 07:30:07.
  Therefore scheduling is demonstrably active; the former claim that it is disabled
  is withdrawn. Historical absence of schedule runs did not establish the cause.
  The direct App wake + Supabase supervisor design stays: GitHub schedule is fallback.
- Source revision 666 was recorded at 07:33:40.214 UTC, **after completion**.
  API logs show a successful contacts_schools INSERT at 07:33:39.910. The immediately
  subsequent proposal links contact 1176 / school 3095; a read-only count found zero
  activities for that school. The existing `scheduling_track_planning_source_change`
  unconditionally bumps the global source revision for contacts_schools changes,
  while only marking matching planning rows dirty. This explains how zero dirty rows
  can coexist with a revision mismatch. There is no source-change row-level journal;
  attributing that single increment to contact 1176 is strong temporal evidence,
  rather than a transaction-ID-level proof. There is no evidence the completed plan
  was invalid when committed. Later source changes require fresh validation.
- Do not manually set validated_source_revision to 666 or replay the completed job.
  The next explicitly authorized incremental request can use validation-only when
  still eligible; any newer dirty rows instead follow ordinary v38 computation.
  This PR did not change either production revision or create such a request.
- Live compatibility SELECTs confirmed pg_cron 1.6.4, pg_net 0.20.0, Vault 0.3.1;
  the real cron.alter_job, net.http_post, worker_command and both saver signatures
  match this migration. Live staff_messages supports selected_users + auth UUID[],
  and users.email exists. The live incremental saver calls ownership fencing before
  and after saving and invokes scheduling_v37_workspace_validation for v38 even for
  an empty patch. These functions, approval RPCs, RLS policies, locks and v38 rules
  are not replaced by this follow-up. Local domain saver tests are stubs: live
  credential integration and a real production calculation remain untested/unapproved.

Focused follow-up validation: 43 Node scenarios (mail, handler, runner, adapter and
App wake), 21 PostgreSQL scenarios plus their parent harness, and Deno check for both
changed Edge entrypoints. PostgreSQL was rerun only after changing the shared fixture
and SQL delivery contract. No build/cache bump is needed: no frontend asset changed.
