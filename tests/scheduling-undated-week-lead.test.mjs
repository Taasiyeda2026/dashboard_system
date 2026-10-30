import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { earliestUndatedCourseStart, activityHasOfficialCourseDate, undatedProposalNeedsNewStart } from '../frontend/src/screens/course-scheduling-start-policy.js';
import { generatePlanningScenarios } from '../frontend/src/screens/course-scheduling-planning.js';

const undated = {
  row_id: 'test-undated', activity_season: 'school_2027', activity_type: 'course',
  status: 'פתוח', activity_name: 'ביומימיקרי', school: 'בית ספר',
  school_id: 'school-1', school_address: 'כתובת בית ספר', authority: 'רשות',
  district: 'מרכז', calendar_sector: 'general', instruction_language: 'he',
  required_instructor_gender: 'any', sessions: 2
};
const catalog = [{ activity_name: 'ביומימיקרי', meetings_count: 2, hours_count: 3 }];
const instructor = { emp_id: 1, active: 'yes', full_name: 'מדריך', address: 'כתובת' };
const rules = { 1: [0,1,2,3,4].map(weekday=>({emp_id:1,weekday,available:true,start_time:'08:00',end_time:'16:00'})) };

test('Israel two-week calendar minimum is exactly fourteen days, including month/year rollover', () => {
  assert.equal(earliestUndatedCourseStart('2026-10-12'), '2026-10-26');
  assert.equal(earliestUndatedCourseStart('2026-12-29'), '2027-01-12');
  assert.equal(earliestUndatedCourseStart('2026-10-13'), '2026-10-27');
});

test('undated new recommendations are stale before fourteen days; source-fixed and approved rows exempt', () => {
  const row = { kind:'proposal',startDate:'2026-10-25',instructorEmpId:'1' };
  assert.equal(activityHasOfficialCourseDate(undated), false);
  assert.equal(undatedProposalNeedsNewStart(row,undated,'2026-10-12'),true);
  assert.equal(undatedProposalNeedsNewStart({...row,startDate:'2026-10-26'},undated,'2026-10-12'),false);
  assert.equal(undatedProposalNeedsNewStart(row,{...undated,date_1:'2026-10-13'},'2026-10-12'),false);
  assert.equal(undatedProposalNeedsNewStart(row,{...undated,start_date:'2026-10-13'},'2026-10-12'),false);
  assert.equal(undatedProposalNeedsNewStart(row,{...undated,emp_id:1},'2026-10-12'),false);
  assert.equal(undatedProposalNeedsNewStart({...row,kind:'live'},undated,'2026-10-12'),false);
  assert.equal(undatedProposalNeedsNewStart({...row,planningLocked:true},undated,'2026-10-12'),false);
});

test('scenario builder starts all undated courses no earlier than two weeks ahead', () => {
  const result = generatePlanningScenarios({
    activity: undated, catalog, instructors:[instructor],
    profiles: { 1: { emp_id:1,gender:'male',instruction_languages:['he'],friday_allowed:false } },
    rules, activities:[], schoolCalendar:[], today:'2026-10-12', periodKey:'year'
  });
  assert.ok(result.scenarios.length > 0, 'must offer some feasible future course dates');
  assert.ok(result.scenarios.every(s=>s.startDate >= '2026-10-26'), 'no system proposal may start this week');
  assert.ok(result.scenarios.some(s=>s.startDate === '2026-10-26'), 'first eligible Monday at the fourteen-day floor is allowed');
});

test('new national core honors the same fourteen-day floor but preserves school start-date anchors', () => {
  const source = readFileSync(new URL('../frontend/src/screens/scheduling-core/planner.js', import.meta.url),'utf8');
  assert.match(source,/officialStart \|\| \[period.start, earliestUndatedCourseStart\(input.today\)/);
  assert.match(source,/if \(official.length\) \{ yield official; return; \}/);
});

test('preflight automatically expires saved proposals, server refuses new early drafts', () => {
  const historical = readFileSync(new URL('../supabase/migrations/20261012011500_scheduling_undated_seven_day_lead.sql', import.meta.url),'utf8');
  const sql = readFileSync(new URL('../supabase/migrations/20261030190000_scheduling_undated_fourteen_day_lead.sql', import.meta.url),'utf8');
  assert.match(historical,/planning_server_undated_start_too_soon/);
  assert.match(sql,/Asia\/Jerusalem/);
  assert.match(sql,/planning_server_undated_start_too_soon/);
  assert.match(sql,/r\.needs_recalc/);
  assert.match(historical,/previous->'row'->'meetings' = item.row_data->'meetings'/);
  assert.match(sql,/v_new text := .*\+ 14/);
  assert.match(sql,/scheduling_undated_lead_function_shape_changed/);
  assert.doesNotMatch(sql,/alter\s+role|set\s+statement_timeout/i);
});
