import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixUrl = new URL(
  '../supabase/migrations/20260817213000_course_scheduling_manual_finalize_soft_warnings.sql',
  import.meta.url
);
const manualDraftUrl = new URL(
  '../supabase/migrations/20260817193000_course_scheduling_manual_draft.sql',
  import.meta.url
);
const contractUrl = new URL(
  '../supabase/migrations/20260809180000_course_scheduling_contract_sync.sql',
  import.meta.url
);

function sliceFunction(sql, name, nextMarker = 'revoke all on function') {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = sql.indexOf(`${nextMarker} public.${name}(`, start);
  assert.ok(end > start, `${name} end not found`);
  return sql.slice(start, end);
}

test('manual finalization is enabled only by the persisted current manual draft and matching audit', async () => {
  const sql = await readFile(fixUrl, 'utf8');
  const fn = sliceFunction(sql, 'assign_activity_instructor');

  assert.match(fn, /result\.draft_emp_id = p_emp_id::text/);
  assert.match(fn, /result\.draft_created_at is not null/);
  assert.match(fn, /result\.draft_created_by is not null/);
  assert.match(fn, /ia\.decision_type = 'draft'/);
  assert.match(fn, /ia\.selected_by = result\.draft_created_by/);
  assert.match(fn, /ia\.created_at = result\.draft_created_at/);
  assert.match(fn, /ia\.reason like 'בחירה ידנית%'/);
  assert.doesNotMatch(fn, /p_manual|manual_override/i, 'client must not be able to request the bypass directly');
});

test('manual draft RPC records an explicit manual reason for server verification and audit', async () => {
  const sql = await readFile(manualDraftUrl, 'utf8');
  const fn = sliceFunction(sql, 'save_course_assignment_manual_draft');

  assert.match(fn, /decision_type, reason/);
  assert.match(fn, /'draft', nullif\(btrim\(p_reason\), ''\)/);
});

test('manual finalization bypasses home-distance and other soft recommendation gates only on verified manual path', async () => {
  const sql = await readFile(fixUrl, 'utf8');
  const helper = sliceFunction(sql, 'scheduling_manual_assignment_hard_violations');
  const assign = sliceFunction(sql, 'assign_activity_instructor');

  assert.doesNotMatch(helper, /scheduling_home_distance_exceeded/);
  assert.doesNotMatch(helper, /home_km\s*>\s*40/);
  assert.doesNotMatch(helper, /scheduling_home_route_unverified/);
  assert.doesNotMatch(helper, /scheduling_instructor_profile_incomplete/);
  assert.doesNotMatch(helper, /scheduling_language_mismatch/);
  assert.doesNotMatch(helper, /scheduling_gender_mismatch/);
  assert.doesNotMatch(helper, /scheduling_availability_missing/);
  assert.doesNotMatch(helper, /scheduling_transition_unverified/);

  assert.match(assign, /if is_verified_manual_draft then[\s\S]*scheduling_manual_assignment_hard_violations/);
  assert.match(assign, /else[\s\S]*scheduling_course_instructor_violations\(p_activity_id, p_emp_id, true\)/,
    'normal/recommended finalization must retain full validation');
});

test('40 km remains part of the ordinary recommendation validation', async () => {
  const sql = await readFile(contractUrl, 'utf8');
  const fn = sliceFunction(sql, 'scheduling_course_instructor_violations');

  assert.match(fn, /home_km/);
  assert.match(fn, /home_km\s*>\s*40/);
  assert.match(fn, /scheduling_home_distance_exceeded/);
});

test('manual finalization still blocks inactive instructors, real overlaps and explicit unavailability', async () => {
  const sql = await readFile(fixUrl, 'utf8');
  const helper = sliceFunction(sql, 'scheduling_manual_assignment_hard_violations');
  const assign = sliceFunction(sql, 'assign_activity_instructor');

  assert.match(assign, /instructor_inactive/);
  assert.match(helper, /instructor_inactive/);
  assert.match(helper, /scheduling_conflict_detected/);
  assert.match(helper, /scheduling_instructor_unavailable/);
  assert.match(helper, /scheduling_transition_insufficient/);
  assert.match(helper, /scheduling_assignment_locked/);
});

test('successful manual finalization clears the draft and carries the manual warning into final audit', async () => {
  const sql = await readFile(fixUrl, 'utf8');
  const fn = sliceFunction(sql, 'assign_activity_instructor');

  assert.match(fn, /draft_emp_id = null/);
  assert.match(fn, /draft_instructor_name = null/);
  assert.match(fn, /draft_created_at = null/);
  assert.match(fn, /draft_created_by = null/);
  assert.match(fn, /instructor_assignment_locked = true/);
  assert.match(fn, /instructor_assignment_status = final_status/);
  assert.match(fn, /final_reason := manual_reason/);
  assert.match(fn, /manual_selection_soft_warnings/);
});
