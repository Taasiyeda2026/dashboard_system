import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const core=migration('20261018153000_scoped_permanent_availability_approval_core.sql');
const confirm=migration('20261018153100_confirm_permanent_unstaffed_availability.sql');
const options=migration('20261018153200_permanent_availability_dashboard_options.sql');
const integrity=migration('20261018153300_unstaffed_calendar_validation_and_integrity.sql');
const ui=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');

test('1. Only designated owner can grant explicit approval; reason is not authorization',()=>{
  assert.match(core,/scheduling_approve_permanent_unavailability/);
  assert.match(core,/app_current_role\(\)\s*<>\s*'admin'/);
  assert.match(core,/scheduling_agent_control c where c\.approver_id=auth\.uid\(\)/);
  assert.match(core,/scope_start <= scope_end/);
  assert.match(core,/revoked_at is null/);
  assert.doesNotMatch(core,/matching_note|matchingNote/);
});
test('2. More than two approved absence dates use a separate confirmed course route',()=>{
  assert.match(confirm,/scheduling_confirm_permanent_unavailability/);
  assert.match(confirm,/for lesson in select value from jsonb_array_elements\(public\.scheduling_activity_official_meetings\(a\)\) loop/);
  assert.doesNotMatch(confirm,/MAX_RECOVERABLE_EXCEPTION_MEETINGS|blocked_count\s*[><]=?\s*2/);
  assert.match(confirm,/public\.assign_activity_instructor/);
  assert.match(confirm,/blocked_count:=blocked_count\+1/);
});
test('3. No approval blocks finalization; existing language, route and overlap gates remain',()=>{
  assert.match(confirm,/scheduling_manager_approval_required/);
  assert.match(confirm,/public\.scheduling_assert_assignment_calendar/);
  assert.match(confirm,/public\.assign_activity_instructor/);
  assert.match(core,/e\.available is false/);
  assert.match(integrity,/scheduling_validate_proposed_meetings/);
});
test('4. Unstaffed date has NO actual instructor in SOT, resolved calendar or payroll',()=>{
  assert.match(core,/availability_blocked_pending/);
  assert.match(core,/emp_id,''/);
  assert.match(core,/nullif\(coalesce\(h\.emp_id,t\.emp_id::text\),''\)/);
  assert.match(core,/not exists\(select 1 from public\.course_meeting_instructor_history h/);
  assert.match(core,/h\.assignment_kind='availability_blocked_pending'/);
  assert.match(options,/נדרש טיפול – מפגש חסום/);
  assert.match(core,/courseStatus.*שיבוץ אושר – קיימים מפגשים לטיפול/s);
});
test('5. Substitution and undo update only the targeted pending meeting',()=>{
  assert.match(confirm,/set_course_meeting_substitute/);
  assert.match(confirm,/clear_course_meeting_substitute/);
  assert.match(confirm,/v_existing\.availability_approval_id is not null/);
  assert.match(confirm,/where id=v_existing\.id/);
  assert.match(integrity,/scheduling_assert_proposed_eligibility/);
});
test('6. Existing unapproved assignments are not modified by any migration backfill',()=>{
  for(const sql of [core,confirm,options,integrity]) {
    assert.doesNotMatch(sql,/update public\.instructor_availability_exceptions|delete from public\.instructor_availability_exceptions/i);
    assert.doesNotMatch(sql,/update public\.activities\s+set\s+emp_id\s*=/i);
    assert.doesNotMatch(sql,/insert into public\.scheduling_permanent_availability_approvals\s*select\b/i);
  }
  assert.match(integrity,/scheduling_unstaffed_assignment_integrity/);
});
test('Eden UI offers approved instructor even without optimizer recommendation',()=>{
  assert.match(ui,/scheduling_permanent_availability_options/);
  assert.match(ui,/data-confirm-approved-unavailable/);
  assert.match(ui,/שיבוץ אושר – קיימים מפגשים לטיפול/);
  assert.match(ui,/scheduling_confirm_permanent_unavailability/);
});
