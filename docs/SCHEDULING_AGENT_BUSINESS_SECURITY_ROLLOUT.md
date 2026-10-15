# Organizational scheduling agent — controlled rollout (15 Oct 2026)

## Goal / boundary
One ChatGPT Business plugin for Idan, Eden and Esraa: free-form scheduling chat only, with personally attributed manual draft creation and submissions to the **existing** dashboard manager approval queue. This plugin must never return financial data or grant owner, configuration, code, raw Google Drive, or system administration access.

The current private owner MCP endpoint `scheduling-agent-gateway` remains unchanged. Do **not** share it with staff. The team plugin uses a **separate** `scheduling-agent-team-gateway/mcp` URL and only five tools: `read_snapshot`, `manager_approval_state`, `stage_manual_draft`, `submit_manager_approval`, `confirm_own_draft`.

## Permission model
- Gate **every request** with the signed-in user's Supabase JWT, `/auth/v1/user` validation, and a SQL `SECURITY DEFINER` access check. Never use service-role, owner bearer, or shared Google token.
- Allow only active users with the scheduling-view permission and exact identity/role pairs: `idann@think.org.il` / admin **and** the `scheduling_agent_control.approver_id`, `edenc@think.org.il` / operation_manager, `esraas@think.org.il` / business_development_manager.
- `scheduling_agent_team_read_snapshot` responds with explicitly selected schedule fields. It intentionally strips addresses, personal contact details, financial data, owner controls, raw Google sheets and most raw planning metadata.
- Draft creation delegates to existing `save_course_assignment_manual_draft` validators under the caller JWT. Only open `school_2027` courses are accepted. No changes to a finalized assignment.
- **Normal authorized assignments:** a worker may confirm her own validated manual draft through `scheduling_agent_team_confirm_own_draft`. The existing dashboard assignment validators and exception-approval trigger remain mandatory. This function never reviews, approves, or overrides exception requests. The assistant must first ask for explicit approval of the particular assignment in chat.
- Team approval submission requires **the draft's creator** to equal `auth.uid()` and delegates to the existing `submit_course_assignment_manager_approval`. It is a **submission**, not an approval. Reject stale/inapplicable drafts as the existing dashboard already does.
- The dashboard reviewer RPC is additionally restricted to the designated owner ID so any future second admin cannot approve these exceptions.
- Do not use the older `scheduling_agent_request_approval` route: that is an entirely different owner-bound planning approval queue.

## Approval / deployment sequence — NOT yet authorized
1. Review PR and run `node --test tests/scheduling-agent-business-guard.test.mjs` plus existing `tests/scheduling-agent-gateway.test.mjs` and scheduling approval tests. No merge until owner agrees.
2. Back up current function definitions / verify deployed source match. Apply the three new SQL migrations in order and deploy the new `scheduling-agent-team-gateway` Edge Function; do not modify or enable existing private owner gateway commits.
3. Verify Supabase OAuth Server authorization URL leads to live `https://taasiyeda2026.github.io/dashboard_system/scheduling-agent-approval.html` instead of `127.0.0.1:3000`. Verify the deployed page exists. Changing global Auth Site URL affects other sign-in flows; do not change it without assessing them.
4. Create the organizational plugin using the validated archive `taasiyeda_scheduling_business_secure.zip` (version 0.2.0). Verify returned scope is WORKSPACE and do **not** create a replacement in the personal scope.
5. Restrict plugin sharing to owner, Eden and Esraa only. Staff receive usage access, never creator/editor/admin permissions; never set workspace-wide default.
6. Test with **their own** sessions: read schedule and planning options, ask revenue totals (must not reveal financial values), try settings/code/approval (no such tools / server deny), stage a *test* manual draft only if explicitly authorized by the owner, verify ordinary confirmation and exceptional submission separately, submit approval and verify `edit_requests.requested_by` matches the real requesting account. Check owner approval path separately. Do not use real production drafts for exploratory tests without authorization.
7. Check the raw SQL team RPCs are blocked for anonymous, non-listed and inactive users and confirm staff cannot reach the **old owner** gateway.
8. Only then publish to the exact three authorized people.

## Important distinctions
- Existing dashboard permissions of staff remain unchanged by this work. Do not promise this plugin revokes permissions available in other interfaces.
- Open chat cannot be constrained to a narrow topic purely by prompt. The server data and tool allowlist are the security boundary.
- Approval for >=60km home-distance manual exceptions and other pre-existing exceptions is enforced by the existing dashboard functions; the automatic 40km matching limit is not the manual approval threshold.
- Team chat can analyze the read-only live snapshot and its already calculated options; it does **not** trigger a new national optimization run. New optimization capability requires a separately reviewed engine execution endpoint.
- Drafts/requests/ordinary confirmations are database writes. Their tools require explicit consent to the *specific* action in chat, with post-write receipt.
- A successful schema/ZIP check does not establish OAuth success or account-level acceptance.

## Status
Prepared on review branch only. No migration, Edge Function deployment, merge, live ChatGPT workspace install or scheduling writes have taken place.
