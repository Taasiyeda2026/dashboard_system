import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261015113000_scheduling_agent_team_least_privilege.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/scheduling-agent-team-gateway/index.ts', import.meta.url), 'utf8');

test('only the owner and the two explicitly named staff roles can access team scheduling RPCs', () => {
  for (const email of ['idann@think.org.il','edenc@think.org.il','esraas@think.org.il']) {
    assert.ok(sql.includes(email));
  }
  assert.match(sql, /auth\.uid\(\) is null/);
  assert.match(sql, /u\.auth_user_id = auth\.uid\(\)/);
  assert.match(sql, /u\.is_active is true/);
  assert.match(sql, /app_has_permission\('view_operations_scheduling'\)/);
  assert.match(sql, /u\.auth_user_id = \(select c\.approver_id/);
});

test('team snapshot is whitelisted and excludes private source data', () => {
  assert.match(sql, /scheduling_agent_team_read_snapshot/);
  assert.match(sql, /jsonb_build_object\(/);
  for (const forbidden of ['sheetHash','spreadsheetId','phone','mobile','email','address','salary','revenue','invoice','amount','cost','permissions','secret','credentials','token']) {
    assert.doesNotMatch(sql, new RegExp("'"+forbidden+"'",'i'), 'sensitive response key: '+forbidden);
  }
});

test('team tools cannot commit, approve, change settings or run arbitrary RPCs', () => {
  for (const tool of ['planning_status','read_snapshot','manager_approval_state','stage_manual_draft','submit_manager_approval','confirm_own_draft','confirm_planning_option']) {
    assert.ok(edge.includes("name: '"+tool+"'"));
  }
  assert.doesNotMatch(edge, /name: '(?:commit_approved_changes|review_manager_approval|update_settings|execute_sql)'/);
  assert.match(edge, /const names:Record<string,string>/);
  assert.match(edge, /if\(!allowed\[name\]\|\|Object\.keys\(args\)\.some/);
  assert.match(edge, /scheduling_agent_team_identity/);
});

test('every call is bound to its own JWT, not a service-role or owner token', () => {
  assert.match(edge,/auth\/v1\/user/);
  assert.match(edge,/Authorization:'Bearer '\+token/);
  assert.doesNotMatch(edge,/SUPABASE_SERVICE_ROLE_KEY|SCHEDULING_AGENT_GOOGLE_SERVICE_ACCOUNT|GITHUB_TOKEN/);
});

test('team draft request tracks real submitting identity and uses existing dashboard queue', () => {
  assert.match(sql,/a\.draft_created_by is distinct from auth\.uid\(\)/);
  assert.match(sql,/public\.save_course_assignment_manual_draft/);
  assert.match(sql,/public\.submit_course_assignment_manager_approval/);
  assert.match(sql,/target\.activity_type <> 'course'/);
  assert.doesNotMatch(sql,/public\.review_course_assignment_manager_approval\(/);
  assert.doesNotMatch(sql,/public\.scheduling_agent_commit_approved\(/);
});

test('anonymous cannot execute the team RPC functions', () => {
  for(const fn of ['scheduling_agent_team_identity','scheduling_agent_team_read_snapshot','scheduling_agent_team_stage_manual_draft','scheduling_agent_team_submit_manager_approval','scheduling_agent_team_manager_approval_state']) {
    const idx=sql.indexOf('revoke all on function public.'+fn+'(');
    assert.ok(idx>=0,'missing revoke for '+fn);
    assert.match(sql.slice(idx,idx+200),/from public, anon/);
  }
});

test('manual exceptions are derived from verified route data, not only user-entered text', () => {
  assert.match(sql, /scheduling_cached_travel_distance_km/);
  assert.match(sql, /home_distance_km > 40/);
  assert.match(sql, /scheduling_manual_assignment_hard_violations/);
  assert.match(sql, /scheduling_transition_distance_exceeded/);
  assert.match(sql, /effective_reason/);
});

test('regular team assignment is permitted only from a personally created draft', () => {
  const confirmation = readFileSync(
    new URL('../supabase/migrations/20261015114000_scheduling_agent_team_confirm_regular_drafts.sql',import.meta.url),'utf8'
  );
  assert.match(confirmation,/draft_created_by is distinct from auth.uid\(\)/);
  assert.match(confirmation,/scheduling_agent_team_assert_member\(\)/);
  assert.match(confirmation,/course_assignment_manager_approval_state/);
  assert.match(confirmation,/scheduling_manager_approval_required/);
  assert.match(confirmation,/public.assign_activity_instructor\(/);
  assert.match(confirmation,/scheduling_agent_team_confirm_own_draft/);
  assert.doesNotMatch(confirmation,/review_course_assignment_manager_approval\(/);
  assert.match(edge,/name: 'confirm_own_draft'/);
  assert.match(edge,/scheduling_agent_team_confirm_own_draft/);
});

test('a planned assignment must be from the current authorized planning snapshot', () => {
  const plan = readFileSync(
    new URL('../supabase/migrations/20261015114500_scheduling_agent_team_confirm_existing_option.sql',import.meta.url),'utf8'
  );
  assert.match(plan,/scheduling_agent_team_assert_member/);
  assert.match(plan,/p_workspace_revision/);
  assert.match(plan,/p_source_revision/);
  assert.match(plan,/r.needs_recalc/);
  assert.match(plan,/r.activity_updated_at is distinct from a.updated_at/);
  assert.match(plan,/option_data->>'eligible'/);
  assert.match(plan,/option_data->>'routeVerified'/);
  assert.match(plan,/scheduling_agent_existing_dates_protected/);
  assert.match(plan,/scheduling_agent_elapsed_meeting_protected/);
  assert.match(plan,/scheduling_agent_date_change_requires_explicit_consent/);
  assert.match(plan,/public.assign_activity_instructor_with_dates/);
  assert.doesNotMatch(plan,/review_course_assignment_manager_approval\(/);
  assert.match(edge,/name: 'confirm_planning_option'/);
  assert.match(edge,/scheduling_agent_team_confirm_planning_option/);
});

test('an outdated countrywide plan cannot be offered as a freshly calculated recommendation', () => {
  assert.match(sql,/create or replace function public\.scheduling_agent_team_planning_status\(/);
  assert.match(sql,/get_scheduling_planning_preflight\('year',''\)/);
  assert.match(sql,/can_recommend := \(preflight->>'planningCurrent'\)::boolean/);
  assert.match(sql,/can_recommend and r\.needs_recalc is distinct from true/);
  assert.match(sql,/planningCurrent/);
  assert.match(sql,/estimatedTravelKm/);
  assert.match(sql,/sameSchoolMeetingCount/);
  assert.match(sql,/nonTravelWaitingMinutes/);
  assert.match(sql,/with ordinality as opt\(value, ordinality\)/);
  assert.match(sql,/optionIndex/);
  assert.match(edge,/name: 'planning_status'/);
  assert.match(edge,/scheduling_agent_team_planning_status/);
});
