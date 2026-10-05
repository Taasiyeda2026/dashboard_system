import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20261005180000_instructor_resolved_meetings_sot.sql', import.meta.url);
const portalDataUrl = new URL('../frontend/src/screens/instructor-portal/portal-data.js', import.meta.url);
const resolvedUrl = new URL('../frontend/src/screens/instructor-portal/resolved-meetings.js', import.meta.url);
const apiUrl = new URL('../frontend/src/api.js', import.meta.url);
const calendarEventsUrl = new URL('../frontend/src/screens/instructor-portal/calendar-events.js', import.meta.url);
const myActivitiesUrl = new URL('../frontend/src/screens/instructor-portal/my-activities.js', import.meta.url);

const sql = await readFile(migrationUrl, 'utf8');

test('resolved meetings core stays private and is not granted to instructors', () => {
  assert.match(sql, /create or replace function private\.av2_get_instructor_resolved_meetings/);
  assert.match(sql, /revoke all on function private\.av2_get_instructor_resolved_meetings\(bigint, date, date\) from public, anon, authenticated/);
  assert.doesNotMatch(sql, /grant execute on function private\.av2_get_instructor_resolved_meetings/);
});

test('public instructor RPC derives emp_id only from auth.uid and instructor role', () => {
  const fn = sql.split('create or replace function public.av2_get_current_instructor_resolved_meetings')[1]
    .split('revoke all on function public.av2_get_current_instructor_resolved_meetings')[0];
  assert.match(fn, /auth\.uid\(\)/);
  assert.match(fn, /u\.role = 'instructor'/);
  assert.match(fn, /u\.is_active = true/);
  assert.match(fn, /private\.av2_get_instructor_resolved_meetings\(v_emp_id, p_from, p_to\)/);
  assert.doesNotMatch(fn, /p_emp_id/);
  assert.match(sql, /grant execute on function public\.av2_get_current_instructor_resolved_meetings\(date, date\) to authenticated/);
});

test('server validates date range and caps season-length queries', () => {
  assert.match(sql, /p_to < p_from/);
  assert.match(sql, /\(p_to - p_from\) > 400/);
  assert.match(sql, /invalid_resolved_meetings_range/);
});

test('ownership uses history coalesce and preserves emp_id_2 secondary behavior', () => {
  const core = sql.split('create or replace function private.av2_get_instructor_resolved_meetings')[1]
    .split('revoke all on function private.av2_get_instructor_resolved_meetings')[0];
  assert.match(core, /coalesce\(h\.emp_id, a\.emp_id::text\) = p_emp_id::text/);
  assert.match(core, /btrim\(coalesce\(a\.emp_id_2, ''\)\) = p_emp_id::text/);
  assert.match(core, /'is_secondary_instructor'/);
  assert.match(core, /'primary_resolved_emp_id'/);
  assert.match(core, /course_meeting_cancellations/);
  assert.doesNotMatch(core, /update public\.activities/);
});

test('meeting_no matches for_date semantics including cancelled prior meetings', () => {
  const core = sql.split('create or replace function private.av2_get_instructor_resolved_meetings')[1]
    .split('revoke all on function private.av2_get_instructor_resolved_meetings')[0];
  assert.match(core, /'meeting_no', \(/);
  assert.match(core, /prior\.meeting_date < d\.meeting_date/);
  assert.match(core, /cmc_prev\.meeting_date = prior\.meeting_date/);
});

test('attendance calendar events rewrite keeps contract fields and uses the SoT', () => {
  const calendar = sql.split('create or replace function private.av2_get_current_instructor_calendar_events')[1]
    .split('revoke all on function private.av2_get_current_instructor_calendar_events')[0];
  assert.match(calendar, /private\.av2_get_instructor_resolved_meetings/);
  assert.match(calendar, /'date', item->>'meeting_date'/);
  assert.match(calendar, /'meeting_no'/);
  assert.match(calendar, /'single_school_name'/);
  assert.match(calendar, /'linked_schools_json'/);
  assert.match(calendar, /invalid_calendar_range/);
  assert.match(calendar, /\(p_to - p_from\) > 62/);
});

test('adds emp_id meeting index for substitute discovery path', () => {
  assert.match(sql, /course_meeting_instructor_history_emp_meeting_idx/);
  assert.match(sql, /on public\.course_meeting_instructor_history \(emp_id, meeting_date\)/);
});

test('frontend portal consumes current-instructor resolved meetings RPC', async () => {
  const [api, portal, resolved, myActivities, calendarEvents] = await Promise.all([
    readFile(apiUrl, 'utf8'),
    readFile(portalDataUrl, 'utf8'),
    readFile(resolvedUrl, 'utf8'),
    readFile(myActivitiesUrl, 'utf8'),
    readFile(calendarEventsUrl, 'utf8')
  ]);
  assert.match(api, /av2_get_current_instructor_resolved_meetings/);
  const resolvedApi = api.split('instructorResolvedMeetings:')[1]?.split('attendanceControlRequest:')[0] || '';
  assert.match(resolvedApi, /av2_get_current_instructor_resolved_meetings/);
  assert.doesNotMatch(resolvedApi, /p_emp_id/);
  assert.match(portal, /loadInstructorPortalSchedule/);
  assert.match(portal, /applyResolvedMeetingsToActivityRow/);
  assert.match(resolved, /substitution_only/);
  assert.match(resolved, /applyResolvedMeetingsToActivityRow/);
  assert.match(myActivities, /portalActivityForDrawer/);
  assert.match(myActivities, /החלפה חד־פעמית/);
  assert.match(calendarEvents, /resolvedMeetings/);
});
