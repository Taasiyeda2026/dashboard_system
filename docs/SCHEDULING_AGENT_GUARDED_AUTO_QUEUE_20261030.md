# Scheduling source invalidation → guarded automatic queue (school_2027)

## Production state
This change is **STAGED AND OFF** by design. Applying the migration adds
`scheduling_agent_worker_settings.auto_enqueue_enabled` with default **false**.
Existing one-minute supervisor, source revision tracking, manual request flow,
confirmed assignments, drafts and history stay unchanged. Merging the PR
is **not** consent to activate automatic enqueue or run a 142-row optimization.

## Queue contract
When explicitly enabled in a separate release:
1. Existing supervisor holds the nationwide year-workspace advisory lock.
2. A 3-minute source quiet window batches rapid edits; only a source revision
   newer than the saved validated workspace with dirty planning rows is eligible.
3. No admission if any job is queued/running or an active planning lease exists.
4. Remember the source revision before INSERT, so the existing queue INSERT
   wakeup trigger cannot recursively enqueue a second job.
5. Minimum 5 minutes between automatic requests, and no re-enqueue of the
   same source revision, even if a job fails.
6. **Fail closed:** if the last automatic job is not `completed` (including
   `failed`), no new automatic job is generated on future source revisions.
   The owner must diagnose and explicitly reset/authorize after remediation.
7. Only an incremental proposal job is enqueued. It never confirms activities;
   the existing worker still checks live source revisions, protected assignments,
   held intended instructors, lease ownership and final domain validation.

## Gate for activation
- Prove a 1–2 course isolated canary through the existing worker/validator;
  do not invoke a full 142-row production rebuild as a smoke test.
- Check canonical protected assignments and meeting times unchanged.
- Confirm no failed legacy optimization is automatically requeued.
- Only after reviewing a genuine successful small incremental job
  should `auto_enqueue_enabled` be enabled by a separate owner-approved rollout.
- Monitor job status, source version, audit event
  `automatic_source_update_requested`, and failure codes. Disable
  `auto_enqueue_enabled` immediately if a new automatic job fails.
- Existing `scheduling-agent-supervisor` remains at one-minute cadence.
- No additional user-facing buttons, statuses or notices are added.

## Test
CI PostgreSQL job uses a separate locally-created, disposable database.
Coverage includes default-off, 3-minute debounce, concurrency, exactly-once
version admission, failure pause, clean workspace, and restricted execution.
No SQL is executed against live Supabase by this test.
