import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schedulingDraftIdsForScope,
  courseSchedulingScreen
} from '../frontend/src/screens/course-scheduling.js';

function draftCourse(id, {
  district = 'דרום',
  dates = ['2026-10-01'],
  draftDates = null,
  empId = '',
  instructorName = ''
} = {}) {
  const row = {
    row_id: id,
    activity_season: 'school_2027',
    activity_type: 'course',
    status: 'פתוח',
    district,
    authority: 'רשות',
    school: 'בית ספר',
    school_id: 1,
    school_address: 'כתובת 1',
    activity_name: 'קורס בדיקה',
    instruction_language: 'he',
    start_date: dates[0] || '',
    start_time: '10:00',
    end_time: '11:00',
    draft_emp_id: '100',
    draft_instructor_name: 'מדריך טיוטה',
    emp_id: empId,
    instructor_name: instructorName
  };
  dates.forEach((date, index) => { row[`date_${index + 1}`] = date; });
  if (draftDates) row.draft_proposed_meetings = draftDates.map((date) => ({ date }));
  return row;
}

test('draft reset scope keeps only drafts in the selected district and half-year', () => {
  const activities = [
    draftCourse('south-first'),
    draftCourse('north-first', { district: 'צפון' }),
    draftCourse('south-second', { dates: ['2027-03-01'] })
  ];

  assert.deepEqual(
    schedulingDraftIdsForScope(activities, { periodKey: 'first', district: 'דרום' }),
    ['south-first']
  );
  assert.deepEqual(
    schedulingDraftIdsForScope(activities, { periodKey: 'second', district: 'דרום' }),
    ['south-second']
  );
});

test('national draft reset includes only operational districts', () => {
  const activities = [
    draftCourse('north', { district: 'צפון' }),
    draftCourse('center', { district: 'מרכז' }),
    draftCourse('south', { district: 'דרום' }),
    draftCourse('invalid', { district: 'מחוז לא תקין' }),
    draftCourse('blank', { district: '' })
  ];

  assert.deepEqual(
    schedulingDraftIdsForScope(activities, { periodKey: 'first', district: '' }).sort(),
    ['center', 'north', 'south']
  );
});

test('draft proposed dates define the reset half-year when present', () => {
  const movedDraft = draftCourse('moved', {
    dates: ['2026-12-20'],
    draftDates: ['2027-02-10']
  });

  assert.deepEqual(
    schedulingDraftIdsForScope([movedDraft], { periodKey: 'first', district: 'דרום' }),
    []
  );
  assert.deepEqual(
    schedulingDraftIdsForScope([movedDraft], { periodKey: 'second', district: 'דרום' }),
    ['moved']
  );
});

test('bulk reset never targets an activity that already has a final instructor', () => {
  const assignedWithStaleDraft = draftCourse('assigned', {
    empId: '200',
    instructorName: 'מדריך משובץ'
  });
  assert.deepEqual(
    schedulingDraftIdsForScope([assignedWithStaleDraft], { periodKey: 'first', district: 'דרום' }),
    []
  );
});

test('scheduling screen exposes one-click draft reset with the scoped count', () => {
  const html = courseSchedulingScreen.render({
    activities: [draftCourse('d1'), draftCourse('d2')],
    instructors: [],
    scheduling: {},
    schoolLocations: [],
    schoolCalendar: [],
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, {
    state: {
      user: { role: 'admin' },
      courseSchedulingTab: 'courses',
      courseSchedulingDistrict: 'דרום',
      courseSchedulingPeriodKey: 'first'
    }
  });

  assert.match(html, /data-reset-scheduling-drafts/);
  assert.match(html, /איפוס 2 טיוטות וחישוב מחדש/);
});

test('bulk reset path uses canonical cancellation RPC and only recalculates after a clean reset', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf("root.querySelector('[data-reset-scheduling-drafts]')");
  const end = source.indexOf("root.querySelector('[data-run-district-simulation]')", start);
  assert.ok(start > 0 && end > start);
  const handler = source.slice(start, end);
  assert.match(handler, /cancel_course_assignment_draft/);
  assert.match(handler, /if \(failures\.length\)/);
  assert.match(handler, /לא בוצע חישוב חדש/);
  assert.match(handler, /await runDistrictSimulation\(\)/);
  assert.doesNotMatch(handler, /assign_activity_instructor/);
});
