# Team scheduling agent: explain → approve → execute (staged)

The previous team MCP gateway discarded business errors, returning `request_rejected` for missing meeting dates. Three rejected attempts on 15 Oct 2026 for teacher 1537 were traced to `scheduling_activity_dates_missing` in PostgreSQL; no assignment was saved.

## Conversation contract

1. Read the current scheduling snapshot. Match exact school, activity and class; do not infer identity from only a program title.
2. For missing dates/hours, give the employee an actionable diagnosis before writing. A file can be read in ChatGPT, but the existing MCP does **not** fetch private Google files. Never claim to read a document the agent cannot access.
3. Parse source dates, flag suspicious year errors (e.g. `1.2.26` among 2027 meetings), validate the number of meetings and weekday. **Ask**, do not autocorrect.
4. Show one complete schedule preview (activities, teacher, each date, start/end hours) and ask for explicit approval of this exact proposal. Only after approval call `stage_schedule_batch` with ISO date strings. This transaction stages all supplied courses, or none.
5. For every staged course call `manager_approval_state`. Submit existing approval requests when required and explicitly authorized, then wait. **Never bypass administrator approvals**.
6. Explain that the staged courses have not yet been finally assigned and official dates are not yet changed. Obtain **separate explicit consent to finalize** the confirmed list of staged drafts. Then call `confirm_schedule_batch` with the returned `draftCreatedAt` and `activityUpdatedAt` stamps. That second database transaction updates official dates and confirms all requested course assignments together, or rolls back everything.
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

## Saved draft count / undated official schedule (October 2026)

- The **official** required meeting count is `activities.sessions` (valid integer, 1–35). Never derive it from the number of populated `date_1..date_35` fields; those can all be empty before final confirmation.
- A course with `sessions=10`, a persisted `draft_proposed_meetings` array of exactly ten valid dates, and no official dates is a **complete staged draft**, not a missing-calendar case. Use `read_staged_schedule`; never call `stage_schedule_batch` again merely because `startDate/endDate` are empty.
- Distinguish `requiredMeetingCount`, `draftMeetingCount` and `officialMeetingCount` in read-only diagnostics and error messages. Missing/invalid `sessions` is a separate error; nine or eleven proposed meetings for a ten-session course must still fail.
- When the caller owns an existing valid draft and approval is current, use `confirm_own_draft`. For a staged multi-item operation use `confirm_schedule_batch` with current `draftCreatedAt` and `activityUpdatedAt` from `read_staged_schedule`, and obtain **separate explicit final confirmation**. The server validates the entire date array **before** applying any official dates; any subsequent error rolls back all writes.
- Manager approval is scoped to the instructor-assignment exception. A meeting beyond the first-half boundary is a **separate period review**, not a count mismatch and not automatically permitted by the instructor approval. Preserve every submitted date (including the final date) until the authorized date-period decision is made; never trim, move, or silently confirm it.
- Existing official dates and locked instructors remain protected. A proposed date change to an already official calendar requires the designated schedule-change process, not draft confirmation.
- On `scheduling_proposed_meeting_count_mismatch` or `scheduling_activity_sessions_invalid`, report the **required count, staged count, official count** where accessible. Do not fabricate meetings or retry a failed write automatically. For uncertain network outcomes read the persisted state before considering any further action.

**Read-only incident reference:** Narat / Marom HaGalil, Space Technologies, draft instructor 1528; required 10, draft 10, official 0; 2026-11-22 to 2027-02-07. The teacher approval does not determine whether 2027-02-07 is authorized as a first-half continuation.
