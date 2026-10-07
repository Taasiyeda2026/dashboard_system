import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_RECOVERABLE_EXCEPTION_MEETINGS,
  buildExceptionRecoveryPlan,
  classifyMeetingAvailabilityBlocks,
  liveAvailabilityConflicts,
  proposeDateAdjustments,
  validatePlanningMeetingsForInstructors
} from '../frontend/src/screens/course-scheduling-date-adjustments.js';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { planningOptionPassesFinalValidation } from '../frontend/src/screens/course-scheduling-planning.js';

const sundayRules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];
const profile = { gender: 'female', instruction_languages: ['he'], seniority_years: 5 };
const instructor = (empId, name = `מדריך ${empId}`) => ({
  emp_id: String(empId),
  full_name: name,
  active: 'yes',
  address: `כתובת ${empId}`
});

function course(id, meetings) {
  return {
    row_id: id,
    activity_name: id,
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: 'בית ספר',
    school_id: 'school-1',
    school_address: 'כתובת בית ספר',
    authority: 'רשות',
    instruction_language: 'he',
    calendar_sector: 'jewish',
    start_time: '10:00',
    end_time: '11:00',
    meetings
  };
}

test('recovery budget allows at most two instructor exceptions', () => {
  assert.equal(MAX_RECOVERABLE_EXCEPTION_MEETINGS, 2);
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const classified = classifyMeetingAvailabilityBlocks({
    meetings,
    rules: sundayRules,
    exceptions: [
      { exception_date: '2027-01-10', available: false },
      { exception_date: '2027-01-17', available: false },
      { exception_date: '2027-01-24', available: false }
    ]
  });
  assert.equal(classified.instructorExceptionCount, 3);
  assert.equal(classified.recoverable, false);
});

test('two instructor exceptions keep the permanent instructor eligible with append-to-end recovery', () => {
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [
      { exception_date: '2027-01-10', available: false },
      { exception_date: '2027-01-24', available: false }
    ]
  });
  assert.equal(recovery.valid, true);
  assert.equal(recovery.eligibleAsPermanent, true);
  assert.equal(recovery.instructorExceptionCount, 2);
  assert.deepEqual(recovery.meetings.map((row) => row.date), [
    '2027-01-03', '2027-01-17', '2027-01-31', '2027-02-07'
  ]);
  assert.equal(recovery.movedCount, 2);
});

test('three instructor exceptions reject the permanent instructor', () => {
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [
      { exception_date: '2027-01-10', available: false },
      { exception_date: '2027-01-17', available: false },
      { exception_date: '2027-01-24', available: false }
    ]
  });
  assert.equal(recovery.valid, false);
  assert.equal(recovery.eligibleAsPermanent, false);
  assert.equal(recovery.reason, 'too_many_availability_exceptions');
});

test('a valid substitute keeps the original date and does not append a meeting', () => {
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [{ exception_date: '2027-01-10', available: false }],
    findSubstitute: (meeting) => meeting.date === '2027-01-10'
      ? { empId: '99', name: 'מחליף' }
      : null
  });
  assert.equal(recovery.valid, true);
  assert.deepEqual(recovery.meetings.map((row) => row.date), ['2027-01-03', '2027-01-10', '2027-01-17']);
  assert.equal(recovery.movedCount, 0);
  assert.equal(recovery.meetings[1].substituteEmpId, '99');
  assert.equal(recovery.singleMeetingSubstitutions.length, 1);
});

test('missing substitute appends only the blocked meeting to the end', () => {
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [{ exception_date: '2027-01-10', available: false }],
    findSubstitute: () => null
  });
  assert.equal(recovery.valid, true);
  assert.deepEqual(recovery.meetings.map((row) => row.date), ['2027-01-03', '2027-01-17', '2027-01-24']);
  assert.equal(recovery.meetings.at(-1).original_date, '2027-01-10');
});

test('engine rejects unavailable or overlapping substitutes', () => {
  const target = course('aline-like', [
    { date: '2026-12-01', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-08', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-15', start_time: '10:00', end_time: '11:00' }
  ]);
  const main = instructor(1, 'אלין');
  const busySub = instructor(2, 'מחליף עסוק');
  const freeSub = instructor(3, 'מחליף פנוי');
  const overlap = course('other', [{ date: '2026-12-08', start_time: '10:00', end_time: '11:00' }]);
  overlap.emp_id = '2';
  overlap.instructor_assignment_locked = true;

  const withBusyOnly = calculateCourseSchedule({
    activities: [target, overlap],
    instructors: [main, busySub],
    profiles: { 1: profile, 2: profile },
    rules: { 1: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }], 2: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }] },
    exceptions: { 1: [{ exception_date: '2026-12-08', available: false }], 2: [] },
    assignments: { 2: [overlap] },
    travel: {
      'aline-like': {
        1: { home: { distance_km: 5, duration_minutes: 10 } },
        2: { home: { distance_km: 5, duration_minutes: 10 } }
      }
    },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-11-01'
  })[0];
  const mainBusy = withBusyOnly.checked.find((row) => row.instructor.emp_id === '1');
  assert.ok(mainBusy?.eligible);
  assert.equal((mainBusy.singleMeetingSubstitutions || []).length, 0);
  assert.ok(mainBusy.proposedMeetings?.some((meeting) => meeting.moved));

  const withFree = calculateCourseSchedule({
    activities: [target],
    instructors: [main, freeSub],
    profiles: { 1: profile, 3: profile },
    rules: {
      1: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }],
      3: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }]
    },
    exceptions: { 1: [{ exception_date: '2026-12-08', available: false }], 3: [] },
    travel: {
      'aline-like': {
        1: { home: { distance_km: 5, duration_minutes: 10 } },
        3: { home: { distance_km: 4, duration_minutes: 8 } }
      }
    },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-11-01'
  })[0];
  const mainFree = withFree.checked.find((row) => row.instructor.emp_id === '1');
  assert.ok(mainFree?.eligible);
  assert.equal(mainFree.singleMeetingSubstitutions?.length, 1);
  assert.equal(mainFree.proposedMeetings.find((row) => row.date === '2026-12-08')?.substituteEmpId, '3');
  assert.equal(mainFree.movedMeetingsCount, 0);
});

test('three exception dates make the permanent instructor ineligible in the engine', () => {
  const target = course('too-many', [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-24', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: {
      1: [
        { exception_date: '2027-01-10', available: false },
        { exception_date: '2027-01-17', available: false },
        { exception_date: '2027-01-24', available: false }
      ]
    },
    travel: { 'too-many': { 1: { home: { distance_km: 3, duration_minutes: 6 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-12-01'
  })[0];
  assert.equal(result.checked[0].eligible, false);
  assert.ok(result.checked[0].failures.includes('too_many_availability_exceptions'));
});

test('Aline-style two dated exceptions remain recoverable as permanent instructor', () => {
  const target = course('aline', [
    { date: '2026-12-01', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-08', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-15', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-22', start_time: '10:00', end_time: '11:00' },
    { date: '2026-12-29', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-05', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1, 'אלין סאלח')],
    profiles: { 1: profile },
    rules: { 1: [{ weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }] },
    exceptions: {
      1: [
        { exception_date: '2026-12-01', available: false },
        { exception_date: '2026-12-29', available: false }
      ]
    },
    travel: { aline: { 1: { home: { distance_km: 5, duration_minutes: 10 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-11-01'
  })[0];
  const candidate = result.checked[0];
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.instructorExceptionCount, 2);
  assert.ok(candidate.proposedMeetings.every((meeting) => meeting.date !== '2026-12-01' || meeting.moved || meeting.substituteEmpId));
  assert.ok(!candidate.proposedMeetings.some((meeting) => meeting.date === '2026-12-01' && !meeting.moved && !meeting.substituteEmpId));
});

test('live availability conflicts are marked without moving the live assignment', () => {
  const conflicts = liveAvailabilityConflicts({
    meetings: [{ date: '2026-09-03', start_time: '12:00', end_time: '13:30' }],
    rules: [{ weekday: 4, available: true, start_time: '08:00', end_time: '12:00' }],
    exceptions: []
  });
  assert.equal(conflicts.liveAvailabilityConflictCount, 1);
  assert.deepEqual(conflicts.liveAvailabilityConflictDates, ['2026-09-03']);
});

test('planning options are invalid when any meeting fails the effective instructor gates', () => {
  const option = {
    instructorEmpId: '1',
    meetings: [
      { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-10', start_time: '10:00', end_time: '11:00' }
    ]
  };
  const invalid = planningOptionPassesFinalValidation(option, {
    activity: { instruction_language: 'he', calendar_sector: 'jewish' },
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-10', available: false }] }
  });
  assert.equal(invalid.valid, false);

  const withSub = planningOptionPassesFinalValidation({
    instructorEmpId: '1',
    meetings: [
      { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-10', start_time: '10:00', end_time: '11:00', substituteEmpId: '2', substituteName: 'מחליף' }
    ]
  }, {
    activity: { instruction_language: 'he', calendar_sector: 'jewish' },
    instructors: [instructor(1), instructor(2)],
    profiles: { 1: profile, 2: profile },
    rules: {
      1: sundayRules,
      2: sundayRules
    },
    exceptions: { 1: [{ exception_date: '2027-01-10', available: false }], 2: [] }
  });
  assert.equal(withSub.valid, true);
});

test('unavailable substitute fails planning meeting validation', () => {
  const result = validatePlanningMeetingsForInstructors({
    meetings: [{ date: '2027-01-10', start_time: '10:00', end_time: '11:00', substituteEmpId: '2' }],
    mainInstructorEmpId: '1',
    instructorContexts: {
      2: {
        instructor: instructor(2),
        rules: sundayRules,
        exceptions: [{ exception_date: '2027-01-10', available: false }],
        existingActivities: []
      }
    }
  });
  assert.equal(result.valid, false);
  assert.equal(result.failures[0].reason, 'availability_exception');
});

test('confirm migration validates substitutes and writes single_meeting_substitution history atomically', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260927120000_confirm_planning_single_meeting_substitutions.sql', import.meta.url), 'utf8');
  assert.match(sql, /p_skip_meeting_dates date\[]/);
  assert.match(sql, /set_course_meeting_substitute/);
  assert.match(sql, /substituteEmpId/);
  assert.match(sql, /scheduling_conflict_detected/);
  assert.match(sql, /scheduling_instructor_unavailable/);
  assert.match(sql, /skip_dates/);
});


test('planning mode keeps two exception dates fixed and leaves them for manual handling without substitutes', () => {
  const target = course('manual-two', [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-24', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: {
      1: [
        { exception_date: '2027-01-10', available: false },
        { exception_date: '2027-01-24', available: false }
      ]
    },
    travel: { 'manual-two': { 1: { home: { distance_km: 3, duration_minutes: 6 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-12-01',
    allowSubstitutes: false,
    allowUnresolvedInstructorExceptions: true
  })[0];
  const candidate = result.checked[0];
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.instructorExceptionCount, 2);
  assert.deepEqual(candidate.unresolvedInstructorExceptionDates, ['2027-01-10', '2027-01-24']);
  assert.equal((candidate.singleMeetingSubstitutions || []).length, 0);
  assert.equal(candidate.proposedMeetings, null);
  assert.deepEqual(candidate.periodCourse.meetings.map((row) => row.date), target.meetings.map((row) => row.date));
});

test('planning final validation accepts only explicitly marked <=2 manual exception dates', () => {
  const option = {
    instructorEmpId: '1',
    unresolvedInstructorExceptionDates: ['2027-01-10', '2027-01-24'],
    meetings: [
      { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-10', start_time: '10:00', end_time: '11:00', constraintKind: 'instructor_exception_manual' },
      { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
      { date: '2027-01-24', start_time: '10:00', end_time: '11:00', constraintKind: 'instructor_exception_manual' }
    ]
  };
  const result = planningOptionPassesFinalValidation(option, {
    activity: { instruction_language: 'he', calendar_sector: 'jewish', sessions: 4 },
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: {
      1: [
        { exception_date: '2027-01-10', available: false },
        { exception_date: '2027-01-24', available: false }
      ]
    }
  });
  assert.equal(result.valid, true);
});


test('planning weekly-shift mode moves a blocked meeting one week and cascades the remaining series', () => {
  const target = course('weekly-shift-one', [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-24', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: { 1: [{ exception_date: '2027-01-10', available: false }] },
    travel: { 'weekly-shift-one': { 1: { home: { distance_km: 3, duration_minutes: 6 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-12-01',
    allowSubstitutes: false,
    shiftInstructorExceptionsByWeek: true
  })[0];

  const candidate = result.checked[0];
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.instructorExceptionCount, 1);
  assert.equal((candidate.singleMeetingSubstitutions || []).length, 0);
  assert.deepEqual(candidate.proposedMeetings.map((row) => row.date), [
    '2027-01-03', '2027-01-17', '2027-01-24', '2027-01-31'
  ]);
  assert.deepEqual(candidate.proposedMeetings.map((row) => row.original_date), [
    '2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'
  ]);
  assert.equal(candidate.movedMeetingsCount, 3);
});

test('planning weekly-shift mode skips a second blocked date and keeps the same permanent instructor', () => {
  const target = course('weekly-shift-two', [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-24', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: {
      1: [
        { exception_date: '2027-01-10', available: false },
        { exception_date: '2027-01-24', available: false }
      ]
    },
    travel: { 'weekly-shift-two': { 1: { home: { distance_km: 3, duration_minutes: 6 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-12-01',
    allowSubstitutes: false,
    shiftInstructorExceptionsByWeek: true
  })[0];

  const candidate = result.checked[0];
  assert.equal(candidate.eligible, true);
  assert.equal(candidate.instructorExceptionCount, 2);
  assert.equal((candidate.singleMeetingSubstitutions || []).length, 0);
  assert.deepEqual(candidate.proposedMeetings.map((row) => row.date), [
    '2027-01-03', '2027-01-17', '2027-01-31', '2027-02-07'
  ]);
});

test('planning weekly-shift mode still rejects a permanent instructor with three blocked dates', () => {
  const target = course('weekly-shift-three', [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-17', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-24', start_time: '10:00', end_time: '11:00' }
  ]);
  const result = calculateCourseSchedule({
    activities: [target],
    instructors: [instructor(1)],
    profiles: { 1: profile },
    rules: { 1: sundayRules },
    exceptions: {
      1: [
        { exception_date: '2027-01-10', available: false },
        { exception_date: '2027-01-17', available: false },
        { exception_date: '2027-01-24', available: false }
      ]
    },
    travel: { 'weekly-shift-three': { 1: { home: { distance_km: 3, duration_minutes: 6 } } } },
    routeMatrix: {},
    periodKey: 'first',
    referenceDate: '2026-12-01',
    allowSubstitutes: false,
    shiftInstructorExceptionsByWeek: true
  })[0];

  const candidate = result.checked[0];
  assert.equal(candidate.eligible, false);
  assert.ok(candidate.failures.includes('too_many_availability_exceptions'));
});
