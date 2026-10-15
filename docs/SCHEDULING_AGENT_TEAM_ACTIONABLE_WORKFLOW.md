# Team scheduling agent: explain → approve → execute (staged)

The previous team MCP gateway discarded business errors, returning `request_rejected` for missing meeting dates. Three rejected attempts on 15 Oct 2026 for teacher 1537 were traced to `scheduling_activity_dates_missing` in PostgreSQL; no assignment was saved.

## Conversation contract

1. Read the current scheduling snapshot. Match exact school, activity and class; do not infer identity from only a program title.
2. For missing dates/hours, give the employee an actionable diagnosis before writing. A file can be read in ChatGPT, but the existing MCP does **not** fetch private Google files. Never claim to read a document the agent cannot access.
3. Parse source dates, flag suspicious year errors (e.g. `1.2.26` among 2027 meetings), validate the number of meetings and weekday. **Ask**, do not autocorrect.
4. Show one complete schedule preview (activities, teacher, each date, start/end hours) and ask for explicit approval of this exact proposal. Only after approval call `stage_schedule_batch` with ISO date strings. This transaction stages all supplied courses, or none.
5. For every staged course call `manager_approval_state`. Submit existing approval requests when required and explicitly authorized, then wait. **Never bypass administrator approvals**.
6. Explain that the staged courses have not yet been finally assigned and official dates are not yet changed. Obtain **separate explicit consent to finalize** the confirmed list of staged drafts. Then call `confirm_schedule_batch` with the returned `draftCreatedAt` stamps. That second database transaction updates official dates and confirms all requested course assignments together, or rolls back everything.
7. Re-read snapshot and report exactly what completed and what remains. If a step fails, explain the Hebrew message, affected activity, what needs fixing, and retain original user goal. Do not blindly retry failed writes or claim success when the database returned an error.

## Technical scope and safety

- SQL lives in `20261017100000_scheduling_agent_team_schedule_batch.sql` and is not part of the v38 optimizer.
- Stage changes only blank-course meeting hours and `draft_*` fields, using a personally attributable caller-owned draft and the existing manual hard constraints / cached-route requirement. Existing official dates and assigned or locked courses cannot be overwritten via this entrypoint.
- The existing owner/admin exception approval remains authoritative, including long-distance and transition exceptions. Stage does not grant any approval. Confirm delegates to the existing team confirmation RPC.
- Do not ingest arbitrary new dates for a course that already has official dates/hours; such changes need a separate supervised schedule-change workflow.
- `diagnostics.mjs` only returns known, whitelisted reason codes and action text. Raw SQL, email addresses and access data stay hidden.
- Changes to Team Edge Function need **both** `index.ts` and `diagnostics.mjs` deployed; migration must be reviewed/applied before activating the new tools.
- Deployment is not part of opening this PR. Confirm migrations, protected-row baseline and exact file/DB contract in isolated tests before approval. Do not run real production drafts/calculations for testing.

## Focused tests

`node --test tests/scheduling-agent-team-actionable-workflow.test.mjs`

The tests verify safe error translation and code contracts; they are **not** a live authenticated end-to-end certification of PostgreSQL triggers, business-rule conflicts or final confirmation. Do not declare production readiness without such testing.
