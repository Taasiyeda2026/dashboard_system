import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../supabase/migrations/20261020022500_postmerge_observation_scheduling_hardening.sql',import.meta.url),'utf8');
test('new approval foreign keys have indexes',()=>{
  assert.match(source,/course_meeting_instructor_history_availability_approval_idx/);
  assert.match(source,/scheduling_permanent_availability_approvals_emp_id_idx/);
});
test('observation RLS preserves owner-only updates and admin read',()=>{
  assert.match(source,/created_by = \(select auth\.uid\(\)\)/);
  assert.match(source,/public\.app_current_role\(\)\) = 'admin'/);
  assert.match(source,/status = 'draft'/);
  assert.match(source,/status in \('draft','completed'\)/);
});
test('hardening does not change course assignments or approvals',()=>{
  assert.doesNotMatch(source,/\b(update|insert into|delete from)\s+public\.(activities|scheduling_permanent_availability_approvals|course_meeting_instructor_history)\b/i);
  assert.doesNotMatch(source,/\bdisable row level security\b/i);
});
