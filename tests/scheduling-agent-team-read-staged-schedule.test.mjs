import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const gateway = readFileSync('supabase/functions/scheduling-agent-team-gateway/index.ts','utf8');
const migration = readFileSync('supabase/migrations/20261017110000_scheduling_agent_team_read_staged_schedule.sql','utf8');

test('team agent exposes read-only persisted schedule retrieval',()=>{
  assert.match(gateway,/name: 'read_staged_schedule'/);
  assert.match(gateway,/read_staged_schedule:'scheduling_agent_team_read_staged_schedule'/);
  assert.match(gateway,/annotations: \{readOnlyHint: true/);
  assert.match(migration,/scheduling_agent_team_assert_member\(\)/);
  assert.match(migration,/draft_proposed_meetings/);
  assert.match(migration,/draftCreatedAt/);
  assert.match(migration,/activityUpdatedAt/);
  assert.match(migration,/isCallerOwned/);
  assert.doesNotMatch(migration,/\bupdate\s+public\.activities\b/i);
});
