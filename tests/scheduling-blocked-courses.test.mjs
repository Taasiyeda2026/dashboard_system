import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateInstructor, isCourseBlocked, BLOCKED_COURSE_CODE } from '../frontend/src/screens/instructor-matching-engine.js';
import { staticFailures, compileConstraints } from '../frontend/src/screens/scheduling-core/constraints.js';
import { matchingForm, profileHtml } from '../frontend/src/screens/instructor-workspace-ui.js';

const blocked = { course_restriction_mode: 'block_selected', course_ids: ['46091'], gender: 'female', instruction_languages: ['he'] };
const target = { row_id: 'ACT-course-1', activity_no: '46091', activity_name: 'רוקחים עולם', authority: 'חיפה', instruction_language: 'he' };

test('blocked course is a hard gate for individual instructor matching', () => {
  assert.equal(isCourseBlocked(blocked, target), true);
  assert.equal(isCourseBlocked(blocked, { ...target, activity_no: '57651' }), false);
  assert.equal(isCourseBlocked({ ...blocked, course_restriction_mode: 'all' }, target), false);
  assert.equal(isCourseBlocked({ ...blocked, course_ids: [] }, target), false);
  // Do not confuse a specific activity row ID with a course/program number.
  assert.equal(isCourseBlocked({ ...blocked, course_ids: ['ACT-course-1'] }, target), false);
  const response = evaluateInstructor({
    instructor: { emp_id: '1509', active: 'yes', address: 'חיפה' },
    profile: blocked,
    activity: target
  });
  assert.equal(response.eligible, false);
  assert.ok(response.failureCodes.includes(BLOCKED_COURSE_CODE));
  assert.equal(response.score, null);
});

test('v37 planner static constraints reject blocked program before travel scoring', () => {
  const context = compileConstraints({
    activities: [target],
    instructors: [{ emp_id: '1509', active: 'yes', address: 'חיפה' }],
    profiles: { '1509': blocked }
  });
  assert.ok(staticFailures(context, target, '1509').includes('blocked_course'));
  assert.equal(staticFailures(context, { ...target, activity_no: '57651' }, '1509').includes('blocked_course'), false);
});

test('instructor matching uses a closed course dropdown, chips and no free text field', () => {
  const html = matchingForm({
    scheduling_profile: blocked
  }, {
    courses: [{ value: '46091', label: 'רוקחים עולם · 46091' },
      { value: '57651', label: 'טכנולוגיות החלל · 57651' }]
  });
  assert.match(html, /data-blocked-course-select/);
  assert.match(html, /data-blocked-courses-value/);
  assert.match(html, /data-remove-blocked-course="46091"/);
  assert.match(html, /רוקחים עולם · 46091/);
  assert.doesNotMatch(html, /data-blocked-course-search/);
  const profile = profileHtml({ scheduling_profile: blocked }, [], true, true,
    [{ value: '46091', label: 'רוקחים עולם · 46091' }]);
  assert.match(profile, /קורסים חסומים/);
  assert.match(profile, /רוקחים עולם · 46091/);
});

test('profile saving uses existing course mode/ids and real system choices', () => {
  const source = readFileSync(new URL('../frontend/src/screens/instructor-scheduling-data.js', import.meta.url), 'utf8');
  assert.match(source, /course_restriction_mode: normalizedBlockedCourseIds\(row\?\.course_ids\)\.length \? 'block_selected' : 'all'/);
  assert.match(source, /catalog_program_details/);
  assert.match(source, /\.eq\('activity_season', 'school_2027'\)/);
  assert.match(source, /\.limit\(1000\)/);
});

test('production SQL gates block selected courses without disabling other safeguards', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261011225500_instructor_course_blocklist_hard_constraint.sql', import.meta.url), 'utf8');
  assert.match(sql, /scheduling_v37_workspace_validation/);
  assert.match(sql, /scheduling_course_instructor_violations/);
  assert.match(sql, /scheduling_manual_assignment_hard_violations/);
  assert.match(sql, /planning_server_overlap/);
  assert.match(sql, /planning_server_official_dates_changed/);
  assert.match(sql, /scheduling_course_blocked/);
  assert.match(sql, /new\.course_restriction_mode = 'block_selected'/);
  assert.match(sql, /scheduling_blocked_course_unknown/);
  assert.doesNotMatch(sql, /set\s+statement_timeout/i);
});
