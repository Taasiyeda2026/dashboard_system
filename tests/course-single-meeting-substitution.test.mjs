import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20260922011500_course_single_meeting_substitution.sql', import.meta.url);
const frontendUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const duplicateUrl = new URL('../attendance/src/duplicate-course-runtime.js', import.meta.url);

test('single-meeting substitutions extend the existing meeting instructor history instead of changing course ownership', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /alter table public\.course_meeting_instructor_history/);
  assert.match(sql, /assignment_kind text not null default 'history'/);
  assert.match(sql, /single_meeting_substitution/);
  assert.match(sql, /unique \(activity_id, meeting_date\)|on conflict \(activity_id, meeting_date\)/);
  assert.doesNotMatch(sql, /update public\.activities[\s\S]*set emp_id = p_substitute_emp_id/);
});

test('single-meeting substitution RPCs are permission checked and preserve an overwritten history row', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create or replace function public\.set_course_meeting_substitute/);
  assert.match(sql, /create or replace function public\.clear_course_meeting_substitute/);
  assert.match(sql, /public\.app_has_permission\('view_operations_scheduling'\)/);
  assert.match(sql, /previous_emp_id/);
  assert.match(sql, /previous_instructor_name/);
  assert.match(sql, /replaces_history/);
  assert.match(sql, /assignment_kind = 'history'/);
  assert.match(sql, /assignment_kind = 'single_meeting_substitution'/);
});

test('attendance activity lookup resolves the actual instructor for a meeting date', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const byDate = sql.split('create or replace function public.av2_get_instructor_activities_for_date')[1]
    .split('revoke all on function public.av2_get_instructor_activities_for_date')[0];
  assert.match(byDate, /left join public\.course_meeting_instructor_history h/);
  assert.match(byDate, /h\.meeting_date = p_date/);
  assert.match(byDate, /coalesce\(h\.emp_id, a\.emp_id::text\) = p_emp_id::text/);

  const activityList = sql.split('create or replace function public.av2_get_instructor_activities')[1]
    .split('revoke all on function public.av2_get_instructor_activities')[0];
  assert.match(activityList, /exists \([\s\S]*course_meeting_instructor_history h[\s\S]*h\.emp_id = p_emp_id::text/);
});

test('attendance validation accepts only the instructor resolved for the reported meeting', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const validation = sql.split('create or replace function public.av2_validate_attendance_month_dashboard')[1];
  assert.match(validation, /h\.meeting_date = r\.report_date/);
  assert.match(validation, /v_resolved_emp_id = p_emp_id::text/);
  assert.match(validation, /המפגש משויך בדשבורד למדריך אחר/);
});

test('smart duplication sees the immediate next dashboard meeting and blocks when it belongs to another instructor', async () => {
  const [sql, duplicate] = await Promise.all([
    readFile(migrationUrl, 'utf8'),
    readFile(duplicateUrl, 'utf8')
  ]);
  const datesRpc = sql.split('create or replace function public.av2_get_activity_meeting_dates')[1]
    .split('revoke all on function public.av2_get_activity_meeting_dates')[0];
  assert.match(datesRpc, /'assigned_to_current'/);
  assert.match(datesRpc, /coalesce\(h\.emp_id, a\.emp_id::text\) = p_emp_id::text/);
  assert.match(duplicate, /nextMeetingAssignedToCurrent/);
  assert.match(duplicate, /המפגש הבא בדשבורד משויך למדריך אחר ולכן לא ניתן לדלג למפגש מאוחר יותר/);
});

test('course scheduling exposes a minimal meeting plus substitute flow', async () => {
  const source = await readFile(frontendUrl, 'utf8');
  assert.match(source, /data-open-single-substitute/);
  assert.match(source, /data-single-substitute-date/);
  assert.match(source, /data-single-substitute-emp/);
  assert.match(source, /set_course_meeting_substitute/);
  assert.match(source, /clear_course_meeting_substitute/);
  assert.match(source, /המדריך הקבוע נשאר/);
});
