import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDayPlacement, compareCandidatesStable } from '../frontend/src/screens/course-scheduling-score.js';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { applyReturnedSchedulingActivity, scoreBreakdownHtml } from '../frontend/src/screens/course-scheduling.js';

const meetings = Array.from({ length: 12 }, (_, index) => ({
  date: new Date(Date.UTC(2026, 9, 5 + index * 7)).toISOString().slice(0, 10),
  start_time: '10:00', end_time: '11:00'
}));
const course = (id, extra = {}) => ({ row_id: id, activity_name: id, activity_type: 'קורס', activity_season: 'school_2027', status: 'פתוח', school: 'יעד', school_id: 100, school_address: 'יעד 1', authority: 'א', instruction_language: 'he', required_instructor_gender: 'any', start_time: '10:00', end_time: '11:00', meetings, ...extra });
const instructor = (id, extra = {}) => ({ emp_id: id, full_name: id, active: 'yes', address: `בית ${id}`, ...extra });
const rules = (id) => [{ emp_id: id, weekday: 1, available: true, start_time: '08:00', end_time: '16:00' }];
const profile = { gender: 'female', instruction_languages: ['he'] };
const travelFor = (courseId, id, km = 10, minutes = 15) => ({ [courseId]: { [id]: { home: { distance_km: km, duration_minutes: minutes } } } });

test('daily efficiency is aggregated across every course meeting', () => {
  const existingActivities = meetings.slice(0, 10).map((meeting) => ({ ...meeting, start_time: '08:00', end_time: '09:00', school: 'יעד', school_id: 100 }));
  const placement = analyzeDayPlacement({ activity: course('c'), meetings, existingActivities, travel: { home: { distance_km: 10, duration_minutes: 15 }, transitions: {} } });
  assert.equal(placement.continuityMeetingCount, 12);
  assert.equal(placement.sameSchoolMeetingCount, 10);
  assert.equal(placement.newWorkDayMeetingCount, 2);
});

test('same-school ranking requires matching school_id and never falls back to the school name', () => {
  const oneMeeting = [meetings[0]];
  const target = course('school-id-only', { meetings: oneMeeting, school: 'שם זהה', school_id: '' });
  const existingActivities = [{ ...oneMeeting[0], start_time: '08:00', end_time: '09:00', school: 'שם זהה', school_id: '' }];
  const placement = analyzeDayPlacement({ activity: target, meetings: oneMeeting, existingActivities, travel: { transitions: {} } });
  assert.equal(placement.sameSchoolMeetingCount, 0);
  assert.equal(placement.existingWorkDayMeetingCount, 1);
});

test('candidate ranking includes real course meetings that cross the displayed half-year boundary', () => {
  const crossHalfMeetings = [
    { date: '2027-01-25', start_time: '10:00', end_time: '11:00' },
    { date: '2027-02-01', start_time: '10:00', end_time: '11:00' }
  ];
  const target = course('cross-half', { meetings: crossHalfMeetings });
  const saved = course('saved-next-half', {
    emp_id: 'i', instructor_assignment_locked: true, school_id: 100,
    meetings: [{ ...crossHalfMeetings[1], start_time: '08:00', end_time: '09:00' }]
  });
  const result = calculateCourseSchedule({
    activities: [target, saved], instructors: [instructor('i')], profiles: { i: profile },
    rules: { i: rules('i') }, exceptions: {}, periodKey: 'first',
    travel: travelFor('cross-half', 'i'), routeMatrix: {}, referenceDate: '2027-01-01'
  })[0].recommended;
  assert.equal(result.continuityMeetingCount, 2);
  assert.equal(result.sameSchoolMeetingCount, 1);
  assert.equal(result.newWorkDayMeetingCount, 1);
});

test('ranking follows efficiency, added travel, availability utilization, and seniority in that order', () => {
  const base = { sameSchoolMeetingCount: 10, nearbyMeetingCount: 0, existingWorkDayMeetingCount: 0, newWorkDayMeetingCount: 2, incrementalTravelKnown: true, relevantTravelMinutes: 20, relevantTravelDistance: 10, utilizationRatio: .5, seniorityYears: 2 };
  assert.ok(compareCandidatesStable({ ...base, instructor: instructor('efficient') }, { ...base, sameSchoolMeetingCount: 0, newWorkDayMeetingCount: 12, instructor: instructor('new-days') }) < 0);
  assert.ok(compareCandidatesStable({ ...base, relevantTravelMinutes: 12, instructor: instructor('short') }, { ...base, relevantTravelMinutes: 30, instructor: instructor('long') }) < 0);
  assert.ok(compareCandidatesStable({ ...base, utilizationRatio: .2, instructor: instructor('free') }, { ...base, utilizationRatio: .8, instructor: instructor('busy') }) < 0);
  assert.ok(compareCandidatesStable({ ...base, seniorityYears: 8, instructor: instructor('senior') }, { ...base, seniorityYears: 1, instructor: instructor('junior') }) < 0);
  assert.ok(compareCandidatesStable(
    { ...base, sameSchoolMeetingCount: 0, existingWorkDayMeetingCount: 12, newWorkDayMeetingCount: 0, instructor: instructor('all-integrated') },
    { ...base, sameSchoolMeetingCount: 1, existingWorkDayMeetingCount: 0, newWorkDayMeetingCount: 11, instructor: instructor('one-same-school') }
  ) < 0, '12/12 integrated meetings must outrank one same-school meeting plus 11 new days');
});

const travelPlacement = ({ previous = null, next = null, previousLeg = null, nextLeg = null, baseline = null, home = null, homeReturn = null }) => analyzeDayPlacement({
  activity: course('travel', { meetings: [meetings[0]] }), meetings: [meetings[0]],
  existingActivities: [previous, next].filter(Boolean),
  travel: { home, homeReturn, transitions: { [meetings[0].date]: { previous: previousLeg, next: nextLeg, baseline } } }
});
const activityBefore = { ...meetings[0], start_time: '08:00', end_time: '09:00', school_id: 200 };
const activityAfter = { ...meetings[0], start_time: '12:00', end_time: '13:00', school_id: 300 };
const leg = (duration_minutes, distance_km) => ({ duration_minutes, distance_km });

test('incremental travel covers only, first, middle, and last activity positions', () => {
  assert.deepEqual(
    (({ relevantTravelMinutes, relevantTravelDistance }) => ({ relevantTravelMinutes, relevantTravelDistance }))(
      travelPlacement({ home: leg(20, 10), homeReturn: leg(22, 11) })
    ), { relevantTravelMinutes: 42, relevantTravelDistance: 21 }, 'only activity includes both home legs');
  assert.equal(travelPlacement({ next: activityAfter, home: leg(20, 10), nextLeg: leg(8, 4), baseline: leg(25, 13) }).relevantTravelMinutes, 3, 'first activity subtracts the old home-to-next route');
  assert.equal(travelPlacement({ previous: activityBefore, next: activityAfter, previousLeg: leg(7, 3), nextLeg: leg(8, 4), baseline: leg(12, 6) }).relevantTravelMinutes, 3, 'middle activity replaces the old previous-to-next route');
  assert.equal(travelPlacement({ previous: activityBefore, previousLeg: leg(7, 3), homeReturn: leg(22, 11), baseline: leg(24, 12) }).relevantTravelMinutes, 5, 'last activity subtracts the old previous-to-home route');
});

test('missing home return or baseline keeps incremental travel unknown and ranks after known travel', () => {
  const missingReturn = travelPlacement({ home: leg(20, 10) });
  const missingBaseline = travelPlacement({ next: activityAfter, home: leg(20, 10), nextLeg: leg(8, 4) });
  assert.equal(missingReturn.incrementalTravelKnown, false);
  assert.equal(missingReturn.relevantTravelMinutes, null);
  assert.equal(missingBaseline.incrementalTravelKnown, false);
  assert.equal(missingBaseline.relevantTravelDistance, null);
  const common = { sameSchoolMeetingCount: 0, nearbyMeetingCount: 0, existingWorkDayMeetingCount: 1, newWorkDayMeetingCount: 0, utilizationRatio: .5, seniorityYears: 2 };
  assert.ok(compareCandidatesStable({ ...common, incrementalTravelKnown: true, relevantTravelMinutes: 10, relevantTravelDistance: 5, instructor: instructor('known') }, { ...common, incrementalTravelKnown: false, relevantTravelMinutes: null, relevantTravelDistance: null, instructor: instructor('unknown') }) < 0);
});

test('missing seniority stays unknown and is not converted to zero or disqualifying', () => {
  const common = { sameSchoolMeetingCount: 0, nearbyMeetingCount: 0, existingWorkDayMeetingCount: 1, newWorkDayMeetingCount: 0, incrementalTravelKnown: true, relevantTravelMinutes: 10, relevantTravelDistance: 5, utilizationRatio: .5 };
  assert.ok(compareCandidatesStable({ ...common, seniorityYears: null, instructor: instructor('1') }, { ...common, seniorityYears: 8, instructor: instructor('9') }) < 0, 'one missing value skips the seniority tiebreak and reaches the stable id fallback');
  assert.match(scoreBreakdownHtml({ eligible: true, continuityMeetingCount: 1, existingWorkDayMeetingCount: 1, incrementalTravelKnown: false, availabilityHours: 8, projectedWeeklyHours: 1, seniorityYears: null }), /וותק: לא הוזן/);
});

test('returned RPC activity replaces local assignment state before recalculation', () => {
  const activities = [{ row_id: 'c', draft_emp_id: '1', school_address: 'enriched' }];
  assert.equal(applyReturnedSchedulingActivity(activities, { row_id: 'c', draft_emp_id: null, emp_id: '1' }), true);
  assert.deepEqual(activities[0], { row_id: 'c', draft_emp_id: null, school_address: 'enriched', emp_id: '1' });
});

test('distance over 40 km is rejected and unavailable or overlapping instructors are not ranked', () => {
  const target = course('gates', { meetings: [meetings[0]] });
  const people = [instructor('far'), instructor('unavailable'), instructor('overlap'), instructor('ok')];
  const availability = { far: rules('far'), unavailable: [{ emp_id: 'unavailable', weekday: 2, available: true, start_time: '08:00', end_time: '16:00' }], overlap: rules('overlap'), ok: rules('ok') };
  const occupied = course('occupied', { emp_id: 'overlap', instructor_assignment_locked: true, school: 'אחר', school_id: 200, meetings: [meetings[0]] });
  const travel = { gates: { far: travelFor('gates', 'far', 40.1).gates.far, unavailable: travelFor('gates', 'unavailable').gates.unavailable, overlap: travelFor('gates', 'overlap').gates.overlap, ok: travelFor('gates', 'ok').gates.ok } };
  const result = calculateCourseSchedule({ activities: [target, occupied], instructors: people, profiles: Object.fromEntries(people.map((row) => [row.emp_id, profile])), rules: availability, exceptions: {}, travel, routeMatrix: {}, referenceDate: '2026-09-01' })[0];
  assert.equal(result.recommended.instructor.emp_id, 'ok');
  for (const id of ['far', 'unavailable', 'overlap']) assert.equal(result.checked.find((item) => item.instructor.emp_id === id).eligible, false);
});

test('unsaved recommendations do not affect another course, while a saved draft does immediately', () => {
  const person = instructor('i');
  const first = course('first', { meetings: [meetings[0]], school: 'יעד', school_id: 100 });
  const second = course('second', { meetings: [{ ...meetings[0], start_time: '12:00', end_time: '13:00' }], start_time: '12:00', end_time: '13:00', school: 'יעד', school_id: 100 });
  const input = { instructors: [person], profiles: { i: profile }, rules: { i: rules('i') }, exceptions: {}, travel: { ...travelFor('first', 'i'), ...travelFor('second', 'i') }, routeMatrix: {}, referenceDate: '2026-09-01' };
  const unsaved = calculateCourseSchedule({ ...input, activities: [first, second] }).find((row) => row.course.row_id === 'second').recommended;
  assert.equal(unsaved.existingMeetings.length, 0);
  const saved = { ...first, draft_emp_id: 'i', draft_instructor_name: 'i', draft_proposed_meetings: first.meetings };
  const afterSave = calculateCourseSchedule({ ...input, activities: [saved, second] })[0].recommended;
  assert.equal(afterSave.existingMeetings.length, 1);
  assert.equal(afterSave.sameSchoolMeetingCount, 1);
});
