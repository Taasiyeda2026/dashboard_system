import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPlanningOverviewRows,
  buildWeeklyPlanningMeetings,
  generatePlanningScenarios,
  hasOfficialPlanningSchedule,
  inferPlanningCourseSpec,
  planningDataFingerprint
} from '../frontend/src/screens/course-scheduling-planning.js';

const catalog = [{
  activity_name: 'ביומימיקרי – המצאות בהשראה מן הטבע',
  meetings_count: 11,
  hours_count: 16.5,
  unit_duration: ''
}];

const baseCourse = {
  row_id: 'c1',
  activity_season: 'school_2027',
  activity_type: 'course',
  status: 'פתוח',
  activity_name: 'ביומימיקרי – המצאות בהשראה מן הטבע',
  authority: 'רשות',
  school: 'בית ספר',
  district: 'מרכז',
  calendar_sector: 'general',
  instruction_language: 'he',
  required_instructor_gender: 'any'
};

test('planning spec derives meeting count and duration from catalog without changing the activity', () => {
  const spec = inferPlanningCourseSpec(baseCourse, catalog);
  assert.equal(spec.sessions, 11);
  assert.equal(spec.durationMinutes, 90);
  assert.equal(spec.complete, true);
  assert.equal(baseCourse.start_time, undefined);
});

test('weekly planning keeps every meeting inside first half and rejects a start that finishes too late', () => {
  const valid = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-10-04',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: []
  });
  assert.equal(valid.meetings.length, 11);
  assert.equal(valid.startDate, '2026-10-04');
  assert.ok(valid.endDate <= '2027-01-29');

  const tooLate = buildWeeklyPlanningMeetings({
    activity: baseCourse,
    startDate: '2026-12-06',
    startTime: '08:00',
    durationMinutes: 90,
    sessions: 11,
    schoolCalendar: []
  });
  assert.equal(tooLate, null);
});

test('planning scenarios offer dynamic dates and hours while respecting first-half completion', () => {
  const instructors = [{ emp_id: 1, full_name: 'מדריכה', active: 'yes' }];
  const rules = {
    1: [0, 1, 2, 3, 4].map((weekday) => ({
      emp_id: 1,
      weekday,
      available: true,
      start_time: '08:00',
      end_time: '16:00'
    }))
  };
  const generated = generatePlanningScenarios({
    activity: baseCourse,
    catalog,
    instructors,
    rules,
    activities: [],
    schoolCalendar: [],
    today: '2026-09-22'
  });
  assert.ok(generated.scenarios.length > 0);
  assert.ok(generated.startRange?.min >= '2026-09-22');
  assert.ok(generated.startRange?.max <= '2027-01-29');
  for (const scenario of generated.scenarios) {
    assert.equal(scenario.meetings.length, 11);
    assert.ok(scenario.endDate <= '2027-01-29');
    assert.ok(scenario.startTime);
    assert.ok(scenario.endTime);
  }
});

test('official schedules are synchronized into Planning as live data and missing schedules remain proposals only', () => {
  const live = {
    ...baseCourse,
    row_id: 'live',
    sessions: 2,
    emp_id: 10,
    instructor_name: 'מדריך קיים',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-10-04',
    date_2: '2026-10-11'
  };
  const missing = { ...baseCourse, row_id: 'missing' };
  assert.equal(hasOfficialPlanningSchedule(live), true);
  assert.equal(hasOfficialPlanningSchedule(missing), false);

  const rows = buildPlanningOverviewRows({ activities: [live, missing], catalog });
  assert.equal(rows.find((row) => row.courseId === 'live')?.kind, 'live');
  assert.equal(rows.find((row) => row.courseId === 'live')?.instructorName, 'מדריך קיים');
  assert.equal(rows.find((row) => row.courseId === 'missing')?.kind, 'missing');
  assert.equal(rows.find((row) => row.courseId === 'missing')?.status, 'ממתין לתכנון');
});

test('planning fingerprint changes when live scheduling data changes', () => {
  const first = planningDataFingerprint([{
    ...baseCourse,
    row_id: 'live',
    emp_id: 10,
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-10-04'
  }]);
  const second = planningDataFingerprint([{
    ...baseCourse,
    row_id: 'live',
    emp_id: 10,
    start_time: '09:30',
    end_time: '11:00',
    date_1: '2026-10-04'
  }]);
  assert.notEqual(first, second);
});

test('first-half Planning excludes courses scheduled only in second half', () => {
  const firstHalf = {
    ...baseCourse,
    row_id: 'first-half',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2026-11-01'
  };
  const secondHalf = {
    ...baseCourse,
    row_id: 'second-half',
    start_time: '08:00',
    end_time: '09:30',
    date_1: '2027-02-07'
  };
  const rows = buildPlanningOverviewRows({ activities: [firstHalf, secondHalf], catalog });
  assert.deepEqual(rows.map((row) => row.courseId), ['first-half']);
});

test('planning fingerprint follows saved draft proposed dates and hours', () => {
  const draft = {
    ...baseCourse,
    row_id: 'draft',
    draft_emp_id: '10',
    start_time: '08:00',
    end_time: '09:30',
    draft_proposed_meetings: [{ date: '2026-10-04', start_time: '08:00', end_time: '09:30' }]
  };
  const first = planningDataFingerprint([draft]);
  const second = planningDataFingerprint([{
    ...draft,
    draft_proposed_meetings: [{ date: '2026-10-11', start_time: '08:00', end_time: '09:30' }]
  }]);
  assert.notEqual(first, second);
});

test('Planning is a separate non-destructive workspace tab using scheduling permission', async () => {
  const [nav, capabilities, screen, planning] = await Promise.all([
    readFile(new URL('../frontend/src/screens/shared/instructors-workspace-nav.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/capability-registry.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8'),
    readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8')
  ]);
  assert.match(nav, /id: 'planning', label: 'תכנון', route: 'course-scheduling'/);
  assert.match(nav, /courseSchedulingTab = 'planning'/);
  assert.match(capabilities, /id: 'instructors\.planning'[\s\S]*permission: 'view_operations_scheduling'/);
  assert.match(screen, /planningTabHtml/);
  assert.match(screen, /proposal_activity_pricing/);
  assert.doesNotMatch(planning, /supabase\.rpc|save_course_assignment|assign_activity_instructor|update\s+public\.activities/i);
});
