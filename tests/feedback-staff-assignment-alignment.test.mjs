import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Audits the migration that was deployed to Supabase. This is a contract test:
// the email scheduler must never select an activity excluded from the dashboard.
const sql = readFileSync(new URL('../supabase/migrations/20261029083000_feedback_staff_auto_align_with_assigned_activities.sql',import.meta.url),'utf8');
const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js',import.meta.url),'utf8');

test('staff automated candidates exclude activities missing a locked instructor assignment',()=>{
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.feedback_staff_auto_candidates/);
  assert.match(sql,/a\.instructor_assignment_locked is true/);
  assert.match(sql,/a\.emp_id is not null or nullif\(btrim\(a\.emp_id_2\),'\'\) is not null/);
});

test('staff table reads the same academic-year activity groups instead of a second standalone list',()=>{
  assert.match(screen,/fetchGroups\(year\)/);
  assert.match(screen,/if \(scope === 'staff'\)/);
  assert.match(screen,/groupsTableHtml\(STAFF_SLOTS, 'staff'\)/);
});

test('stage dispatch windows are grouped AFTER computing individual activity meeting dates',()=>{
  const stageSql = readFileSync(new URL('../supabase/migrations/20261029110000_feedback_staff_activity_week_buckets.sql',import.meta.url),'utf8');
  assert.match(stageSql, /source_slots as \(/);
  assert.match(stageSql, /join keyed s on s\.row_id=sl\.row_id/);
  assert.match(stageSql, /expanded as \(/);
  assert.match(stageSql, /stage_batches as \(/);
  assert.match(stageSql, /partition by v\.row_id/);
  assert.match(stageSql, /e\.stage='pre'/);
  assert.match(stageSql, /e\.stage='mid'/);
  assert.match(stageSql, /e\.stage='final'/);
  assert.match(stageSql, /e\.batch_key/);
  assert.match(stageSql, /array_agg\(row_id order by row_id\)/);
});
test('a previously mailed representative does not block other activities in later weeks',()=>{
  const guards=readFileSync(new URL('../supabase/migrations/20261029111000_feedback_staff_week_batches_legacy_delivery_guards.sql',import.meta.url),'utf8');
  assert.match(guards, /o\.activity_row_id=any\(c\.member_row_ids\)/);
  assert.match(guards, /x\.activity_row_id=any\(o\.member_row_ids\)/);
  assert.match(guards, /o\.group_key=c\.group_key/);
  assert.doesNotMatch(guards, /existing\.member_row_ids\|\|c\.member_row_ids/);
});
test('staff closing link checks completed course on the server and retains the existing URL',()=>{
  const finalSql=readFileSync(new URL('../supabase/migrations/20261029112000_feedback_staff_final_completion_link_gate.sql',import.meta.url),'utf8');
  assert.match(finalSql, /private\.feedback_staff_final_activity_ready/);
  assert.match(finalSql, /public\.scheduling_effective_end_time/);
  assert.match(finalSql, /course_meeting_cancellations/);
  assert.match(finalSql, /when c\.audience='educational_staff' and c\.stage='final'/);
  assert.match(finalSql, /feedback_staff_final_course_not_completed/);
  assert.match(finalSql, /update public\.feedback_campaigns c set/);
  assert.doesNotMatch(finalSql, /update public\.feedback_recipients set token/);
});
test('consolidated dashboard retains exact per-activity dates, statuses and navigation',()=>{
  assert.match(screen,/staff_activities: activitiesByGroup\.get\(key\)/);
  assert.match(screen,/const stageSummary = \(g, stage\)/);
  assert.match(screen,/data-ifb-open-group="\$\{esc\(a\.row_id\)\}"/);
  assert.match(screen,/class="ifb-staff-activity-breakdown"/);
  assert.match(screen,/earlyFinal \? '<p class="ifb-muted">משוב הסיום ייפתח רק לאחר שהקורס/);
  assert.match(screen,/else if \(earlyFinal\) \{/);
  assert.match(screen,/נשלח במשלוח משותף/);
  assert.match(screen,/אין ליצור הזמנה כפולה/);
});

test('educational-staff action picker contains management buttons only, with no duplicate stage statuses or dates',()=>{
  const actions = screen.split('const actionsHtml = (g) => {')[1]?.split('const output = filtered.length ?')[0];
  assert.ok(actions, 'staff action renderer exists');
  assert.match(actions,/class="ifb-staff-group-action"/);
  assert.match(actions,/data-ifb-open-group="\\$\\{esc\\(a\\.row_id\\)\\}"/);
  assert.doesNotMatch(actions,/stageStatus\\(|fmtDate\\(|ifb-staff-breakdown-stage|ifb-staff-breakdown-item/);
});
