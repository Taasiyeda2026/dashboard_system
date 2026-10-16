import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { schedulingError, describeSchedulingSnapshot } from '../supabase/functions/scheduling-agent-team-gateway/diagnostics.mjs';
// Focused live-gateway regression checks for designated manager review and uncertain writes.
import './scheduling-gateway-followup.test.mjs';

const edge=readFileSync(new URL('../supabase/functions/scheduling-agent-team-gateway/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261017100000_scheduling_agent_team_schedule_batch.sql',import.meta.url),'utf8');

test('returns the actual missing dates reason in Hebrew instead of request_rejected',()=>{
  const error=schedulingError({code:'P0001',message:'scheduling_activity_dates_missing'},400);
  assert.equal(error.reasonCode,'scheduling_activity_dates_missing');
  assert.match(error.message,/תאריכי המפגשים חסרים/);
  assert.match(error.nextStep,/תאריכים/);
  assert.equal(error.writesCommitted,false);
});

test('preserves manager approval instructions even on SQLSTATE 42501',()=>{
  const error=schedulingError({code:'42501',message:'scheduling_manager_approval_required'},403);
  assert.equal(error.reasonCode,'scheduling_manager_approval_required');
  assert.match(error.nextStep,/מנהל/);
});

test('atomic batch failure includes safe activity and known reason only',()=>{
  const error=schedulingError({message:'scheduling_agent_batch_item_failed',
    details:'school_2027_012|scheduling_conflict_detected'},400);
  assert.equal(error.activityId,'school_2027_012');
  assert.equal(error.reasonCode,'scheduling_conflict_detected');
  assert.match(error.message,/התנגשות/);
});

test('raw SQL failures and details are never disclosed to employees',()=>{
  const raw='user_email@example.com: relation secrets does not exist';
  const error=schedulingError({message:raw,details:'sensitive'},500);
  assert.equal(error.error,'request_rejected');
  assert.doesNotMatch(JSON.stringify(error),/user_email|sensitive|relation secrets/);
});

test('snapshot exposes actionable preflight and keeps the existing fields',()=>{
  const original={rows:[{activityId:'A',startDate:null,endDate:null,startTime:null,endTime:null},
    {activityId:'B',startDate:'2026-10-26',endDate:'2026-12-14',startTime:'08:00',endTime:'09:30'}]};
  const result=describeSchedulingSnapshot(original);
  assert.deepEqual(result.rows[0].readiness.missing,['meeting_dates','meeting_hours']);
  assert.equal(result.rows[1].readiness.complete,true);
  assert.equal(result.rows[0].activityId,'A');
  assert.equal(original.rows[0].readiness,undefined);
});

test('MCP exposes staged and final schedule tools and validates explicit approved payload',()=>{
  assert.match(edge,/name: 'stage_schedule_batch'/);
  assert.match(edge,/name: 'confirm_schedule_batch'/);
  assert.match(edge,/scheduling_agent_team_stage_schedule_batch/);
  assert.match(edge,/scheduling_agent_team_confirm_schedule_batch/);
  assert.match(edge,/describeSchedulingSnapshot/);
  assert.match(edge,/schedulingError\(body,response.status\)/);
  assert.match(edge,/retrySameRequest:false/);
  assert.doesNotMatch(edge,/SUPABASE_SERVICE_ROLE_KEY|SCHEDULING_AGENT_GOOGLE_SERVICE_ACCOUNT/);
});

test('SQL batch is owner-of-draft protected, transactional and keeps existing validators',()=>{
  assert.match(sql,/scheduling_agent_team_assert_member\(\)/g);
  assert.match(sql,/scheduling_lock_instructor_for_write\(emp\)/);
  assert.match(sql,/scheduling_course_conflict_exists\(entry_id,emp\)/);
  assert.match(sql,/scheduling_manual_assignment_hard_violations\(entry_id,emp\)/);
  assert.match(sql,/scheduling_cached_travel_distance_km/);
  assert.match(sql,/scheduling_agent_team_confirm_own_draft\(entry_id\)/);
  assert.match(sql,/course\.draft_created_by is distinct from auth\.uid\(\)/);
  assert.match(sql,/course\.draft_created_at is distinct from expected_at/);
  assert.match(sql,/course\.updated_at is distinct from expected_updated_at/);
  assert.match(sql,/scheduling_manager_approval_required|check_manager_approval_state/);
  assert.match(sql,/jsonb_array_length\(p_items\) not between 1 and 5/);
  assert.match(sql,/raise exception using message='scheduling_agent_batch_item_failed'/);
  assert.match(sql,/grant execute on function public\.scheduling_agent_team_stage_schedule_batch\(jsonb\)[\s\S]*?to authenticated/);
  assert.match(sql,/revoke all on function public\.scheduling_agent_team_confirm_schedule_batch\(jsonb\)[\s\S]*?from public, anon/);
  assert.doesNotMatch(sql,/review_course_assignment_manager_approval|scheduling_agent_commit_approved/);
});

test('draft dates are not promoted before confirmation',()=>{
  const stage=sql.split('create or replace function public.scheduling_agent_team_confirm_schedule_batch(')[0];
  const confirm=sql.split('create or replace function public.scheduling_agent_team_confirm_schedule_batch(')[1];
  assert.match(stage,/draft_proposed_meetings=canonical/);
  assert.doesNotMatch(stage,/date_1=/);
  assert.match(confirm,/start_date=\$1,end_date=\$2/);
  assert.match(confirm,/perform public\.scheduling_validate_proposed_meetings\(entry_id,dates\)/);
});

test('team MCP advertises changed tool catalog and updated server version',()=>{
  assert.match(edge,/capabilities:\{tools:\{listChanged:true\}\}/);
  assert.match(edge,/serverInfo:\{name:'taasiyeda-team-scheduling-agent',version:'0\.3\.0'\}/);
  assert.match(edge,/name: 'stage_schedule_batch'/);
  assert.match(edge,/name: 'confirm_schedule_batch'/);
});
