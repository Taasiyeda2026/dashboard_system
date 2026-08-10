/**
 * Stage 2 matching-engine regression tests.
 *
 * Covers the four confirmed bugs fixed in this stage:
 *  Bug 1 – Hard daily-activity-count block removed (>3 / >5 consecutive limit).
 *  Bug 2 – Same-school detected by school_id, not display name.
 *  Bug 3 – Cancelled meeting dates are filtered before overlap checks.
 *  Bug 4 – District simulation uses planningDraft meetings in the hard-gate.
 * Plus: enforce_end_time in date adjustments (proposeDateAdjustments).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { calculateCourseSchedule } from '../frontend/src/screens/course-scheduling-engine.js';
import { proposeDateAdjustments } from '../frontend/src/screens/course-scheduling-date-adjustments.js';
import { activityMeetings } from '../frontend/src/screens/instructor-scheduling-load.js';

// ─── shared helpers ──────────────────────────────────────────────────────────

const instructor = { emp_id: '1', full_name: 'נועה', active: 'yes', address: 'תל אביב' };
const profile = { gender: 'female', instruction_languages: ['he'] };
const sunday = { weekday: 0, available: true, start_time: '07:00', end_time: '18:00' };
const monday = { weekday: 1, available: true, start_time: '07:00', end_time: '18:00' };
const allWeek = [sunday, monday,
  { weekday: 2, available: true, start_time: '07:00', end_time: '18:00' },
  { weekday: 3, available: true, start_time: '07:00', end_time: '18:00' },
  { weekday: 4, available: true, start_time: '07:00', end_time: '18:00' }];

const activity = (overrides = {}) => ({
  row_id: 'test',
  activity_name: 'קורס בדיקה',
  activity_type: 'קורס',
  school: 'בית ספר א',
  school_id: 'S1',
  authority: 'תל אביב',
  instruction_language: 'he',
  required_instructor_gender: 'female',
  start_time: '10:00',
  end_time: '11:00',
  meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }], // Sunday
  ...overrides
});

const existing = (date, startTime, endTime, overrides = {}) => ({
  row_id: 'ex',
  activity_name: 'פעילות קיימת',
  school: 'בית ספר א',
  school_id: 'S1',
  authority: 'תל אביב',
  date,
  start_time: startTime,
  end_time: endTime,
  ...overrides
});

// ─── Bug 1: Daily count hard block removed ───────────────────────────────────

test('bug1: 6 non-overlapping same-day activities do not block instructor via count limit', () => {
  // Before the fix, >5 consecutive activities in a day (< 80 min each) would hard-block.
  // Now only availability window and actual time overlap matter.
  const target = activity({
    meetings: [{ date: '2026-09-06', start_time: '15:00', end_time: '16:00' }]
  });
  const sixActivities = [
    existing('2026-09-06', '08:00', '09:00', { row_id: 'e1' }),
    existing('2026-09-06', '09:00', '10:00', { row_id: 'e2' }),
    existing('2026-09-06', '10:00', '11:00', { row_id: 'e3' }),
    existing('2026-09-06', '11:00', '12:00', { row_id: 'e4' }),
    existing('2026-09-06', '12:00', '13:00', { row_id: 'e5' }),
    existing('2026-09-06', '13:00', '14:00', { row_id: 'e6' })
  ];
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: sixActivities,
    validateTravel: false
  });
  assert.equal(result.eligible, true, 'should not be blocked by daily count alone');
  assert.ok(
    !result.failures.some((f) => f.includes('רצף')),
    'no "רצף" failure should appear'
  );
});

test('bug1: instructor with 4 consecutive 80-min activities is still eligible after count removal', () => {
  // 4 × 80-min activities used to block because max consecutive ≥ 80-min > 3.
  const target = activity({
    meetings: [{ date: '2026-09-06', start_time: '13:20', end_time: '14:40' }]
  });
  const threeExisting = [
    existing('2026-09-06', '08:00', '09:20', { row_id: 'e1' }),
    existing('2026-09-06', '09:20', '10:40', { row_id: 'e2' }),
    existing('2026-09-06', '10:40', '12:00', { row_id: 'e3' })
  ];
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: threeExisting,
    validateTravel: false
  });
  assert.equal(result.eligible, true, '4 consecutive 80-min activities must not be hard-blocked');
});

test('bug1: exceeding availability window still blocks (existing guard untouched)', () => {
  // The daily count limit is gone but the availability gate is not.
  const target = activity({
    meetings: [{ date: '2026-09-06', start_time: '16:00', end_time: '17:00' }]
  });
  const result = evaluateInstructor({
    instructor, profile,
    rules: [{ weekday: 0, available: true, start_time: '08:00', end_time: '14:00' }],
    activity: target,
    existingActivities: [],
    validateTravel: false
  });
  assert.equal(result.eligible, false, 'activity outside availability window must still be blocked');
  assert.ok(result.failures.length > 0, 'there should be at least one failure reason');
});

// ─── Bug 2: Same school by school_id ─────────────────────────────────────────

test('bug2: same school_id is same school even with different display names', () => {
  // school_id=S1 on both sides → same school → 0 km travel required.
  // Should add sameSchool continuity points, not raise a travel warning.
  const target = activity({
    school: 'בית ספר א (שם ישן)', school_id: 'S1',
    meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }]
  });
  const neighborActivity = existing('2026-09-06', '10:00', '11:30', {
    school: 'בית ספר א (שם חדש)', school_id: 'S1',
    authority: 'תל אביב'
  });
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: [neighborActivity],
    travel: null,
    validateTravel: false
  });
  // With same school_id, no travel warning should appear.
  assert.ok(
    !result.issues.some((i) => i.kind === 'unverified_transition'),
    'same school_id must not produce an unverified-transition warning'
  );
});

test('bug2: different school_id is a different school even with identical display name', () => {
  // school_id=S1 vs school_id=S2 → different schools → needs travel info.
  const target = activity({
    school: 'בית ספר א', school_id: 'S2',
    meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }]
  });
  const neighborActivity = existing('2026-09-06', '10:00', '11:30', {
    school: 'בית ספר א', school_id: 'S1',
    authority: 'תל אביב'
  });
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: [neighborActivity],
    travel: null,
    validateTravel: true
  });
  // Different school_id → different schools → travel needed.
  assert.ok(
    result.issues.some((i) => i.kind === 'unverified_transition'),
    'different school_id with same name must produce an unverified-transition warning'
  );
});

test('bug2: missing school_id on either side falls back to name comparison', () => {
  // When school_id is absent, display-name equality is the fallback.
  const target = activity({
    school: 'בית ספר שיתוף', school_id: '',
    meetings: [{ date: '2026-09-06', start_time: '12:00', end_time: '13:00' }]
  });
  const neighborSameName = existing('2026-09-06', '10:00', '11:30', {
    school: 'בית ספר שיתוף', school_id: undefined,
    authority: 'תל אביב'
  });
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: [neighborSameName],
    travel: null,
    validateTravel: false
  });
  // Fallback: same name → same school → no travel warning.
  assert.ok(
    !result.issues.some((i) => i.kind === 'unverified_transition'),
    'when school_id is absent, same display name must still be treated as same school'
  );
});

// ─── Bug 3: Cancelled meetings filtered ──────────────────────────────────────

test('bug3: activityMeetings filters cancelled dates before they reach evaluateInstructor', () => {
  // In production, existingActivities are built by meetingAssignments → activityMeetings,
  // which already filters cancelled_meeting_dates. Verify that pipeline is correct:
  // an existing activity with its only meeting cancelled produces no flat rows,
  // and therefore evaluateInstructor sees no overlap.
  const target = activity({
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  // Existing activity that would conflict, but its 2026-09-06 meeting is cancelled.
  const activityWithCancelledMeeting = {
    row_id: 'ex-cancelled',
    activity_name: 'פעילות מבוטלת',
    school: 'בית ספר ב',
    school_id: 'S2',
    authority: 'תל אביב',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }],
    cancelled_meeting_dates: ['2026-09-06']
  };

  // activityMeetings must strip the cancelled date.
  const flatMeetings = activityMeetings(activityWithCancelledMeeting);
  assert.equal(flatMeetings.length, 0, 'activityMeetings must produce zero flat rows for a fully-cancelled activity');

  // When evaluated, no flat meetings → no overlap.
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: flatMeetings,
    validateTravel: false
  });
  assert.ok(
    !result.issues.some((i) => i.kind === 'overlap'),
    'no overlap when the existing activity had all meetings cancelled'
  );
  assert.equal(result.eligible, true);
});

test('bug3: non-cancelled meeting on same day still blocks even when other meetings are cancelled', () => {
  // Only the cancelled date should be skipped; an active date still blocks.
  const target = activity({
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '11:00' }]
  });
  const partlyCancelledExisting = {
    row_id: 'ex-partial',
    activity_name: 'פעילות חלקית',
    school: 'בית ספר ב',
    school_id: 'S2',
    authority: 'תל אביב',
    date: '2026-09-06',
    start_time: '10:00',
    end_time: '11:00',
    // 2026-09-13 is cancelled but 2026-09-06 is NOT cancelled.
    cancelled_meeting_dates: ['2026-09-13']
  };
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: target,
    existingActivities: [partlyCancelledExisting],
    validateTravel: false
  });
  assert.ok(
    result.issues.some((i) => i.kind === 'overlap'),
    'active (non-cancelled) meeting on the same date must still cause an overlap issue'
  );
});

test('bug3: cancelled meeting in target activity does not cause self-overlap', () => {
  // When the TARGET activity itself has cancelled meetings, those dates are skipped.
  const targetWithCancelled = activity({
    meetings: [
      { date: '2026-09-06', start_time: '10:00', end_time: '11:00' },
      { date: '2026-09-13', start_time: '10:00', end_time: '11:00' }
    ],
    cancelled_meeting_dates: ['2026-09-13']
  });
  const conflictOn13 = existing('2026-09-13', '10:00', '11:00', { row_id: 'c13' });
  const result = evaluateInstructor({
    instructor, profile,
    rules: allWeek,
    activity: targetWithCancelled,
    existingActivities: [conflictOn13],
    validateTravel: false
  });
  // 2026-09-13 is cancelled on the target course, so no conflict with conflictOn13.
  assert.ok(
    !result.issues.some((i) => i.kind === 'overlap'),
    'cancelled date on the target activity must be skipped (no overlap on that date)'
  );
  assert.equal(result.eligible, true);
});

// ─── Bug 4: District simulation hard-gate uses planningDraft ─────────────────

test('bug4: district simulation does not recommend same instructor for two time-overlapping courses', () => {
  const baseInstructor = {
    emp_id: '10',
    full_name: 'הילה',
    active: 'yes',
    address: 'רחוב הרצל 1, תל אביב'
  };
  const baseProfile = { gender: 'female', instruction_languages: ['he'] };
  const weekRules = [{ weekday: 0, available: true, start_time: '07:00', end_time: '18:00' }];

  // Two courses on the SAME date at the SAME overlapping times.
  const courseA = {
    row_id: 'courseA',
    activity_name: 'קורס א',
    activity_no: 'A',
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: 'בית ספר 1',
    school_id: 'SA1',
    school_address: 'רחוב בן גוריון 5, תל אביב',
    authority: 'תל אביב',
    district: 'תל אביב',
    instruction_language: 'he',
    required_instructor_gender: 'female',
    start_time: '09:00',
    end_time: '11:00',
    meetings: [{ date: '2026-09-06', start_time: '09:00', end_time: '11:00' }]
  };
  const courseB = {
    row_id: 'courseB',
    activity_name: 'קורס ב',
    activity_no: 'B',
    activity_type: 'קורס',
    activity_season: 'school_2027',
    status: 'פתוח',
    school: 'בית ספר 2',
    school_id: 'SA2',
    school_address: 'רחוב בן גוריון 10, תל אביב',
    authority: 'תל אביב',
    district: 'תל אביב',
    instruction_language: 'he',
    required_instructor_gender: 'female',
    start_time: '10:00',
    end_time: '12:00',
    meetings: [{ date: '2026-09-06', start_time: '10:00', end_time: '12:00' }]
  };

  const input = {
    activities: [courseA, courseB],
    instructors: [baseInstructor],
    profiles: { 10: baseProfile },
    rules: { 10: weekRules },
    exceptions: {},
    // No route matrix / travel — prevents preliminary pass complications.
    assignments: {}
  };

  const results = calculateCourseSchedule(input);
  // The simulation must not recommend instructor 10 for both courses at the same time.
  const primaryForA = results.find((r) => r.course?.row_id === 'courseA')?.primary?.instructor?.emp_id;
  const primaryForB = results.find((r) => r.course?.row_id === 'courseB')?.primary?.instructor?.emp_id;
  // At most one of the two courses can have instructor 10 as primary.
  // (If both are null that is also acceptable — no double booking.)
  assert.ok(
    !(primaryForA === '10' && primaryForB === '10'),
    `instructor 10 must not be primary for both overlapping courses (A=${primaryForA}, B=${primaryForB})`
  );
});

// ─── enforce_end_time in date adjustments ────────────────────────────────────

test('enforce_end_time: school calendar cap is applied to meeting end_time in proposed meetings', () => {
  // Course meeting runs until 15:00 but the school calendar says the day ends at 13:30.
  const meetings = [{ date: '2026-10-04', start_time: '12:00', end_time: '15:00' }]; // Sunday
  const schoolCalendar = [{
    start_date: '2026-10-04',
    end_date: '2026-10-04',
    day_status: 'short_day',
    school_day_end_time: '13:30',
    blocks_scheduling: false,
    enforce_end_time: true,
    is_active: true,
    show_on_main_calendar: true
  }];
  // No date adjustment needed (no blocked availability exception), but enforce_end_time applies.
  const result = proposeDateAdjustments({ meetings, rules: [], exceptions: [], schoolCalendar });
  assert.ok(result !== null, 'should return an adjustment when enforce_end_time caps are needed');
  assert.equal(result.valid, true, 'result should be valid');
  assert.equal(result.kind, 'enforce_end_time', 'kind should be enforce_end_time');
  assert.equal(result.meetings[0].end_time, '13:30', 'meeting end_time must be capped to school_day_end_time');
  assert.equal(result.meetings[0].date, '2026-10-04', 'date must remain unchanged');
});

test('enforce_end_time: no cap needed returns null as before', () => {
  // Meeting ends at 12:00, school day ends at 13:30 → no cap needed.
  const meetings = [{ date: '2026-10-04', start_time: '10:00', end_time: '12:00' }];
  const schoolCalendar = [{
    start_date: '2026-10-04',
    end_date: '2026-10-04',
    school_day_end_time: '13:30',
    blocks_scheduling: false,
    enforce_end_time: true,
    is_active: true,
    show_on_main_calendar: true
  }];
  const result = proposeDateAdjustments({ meetings, rules: [], exceptions: [], schoolCalendar });
  assert.equal(result, null, 'when end_time is already within the school day, result must be null');
});

test('enforce_end_time: cap is also applied when a date adjustment is triggered simultaneously', () => {
  // The meeting needs to move (exception blocks the original date) AND the target date
  // falls under an enforce_end_time constraint.
  const meetings = [
    { date: '2026-09-06', start_time: '10:00', end_time: '15:00' }, // Sunday
    { date: '2026-09-13', start_time: '10:00', end_time: '15:00' }  // Sunday +7
  ];
  // Exception makes the first meeting date (2026-09-06) unavailable on Sunday.
  const rules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];
  const exceptions = [{ exception_date: '2026-09-06', available: false }];
  // The replacement date (2026-09-13) falls under enforce_end_time.
  const schoolCalendar = [{
    start_date: '2026-09-13',
    end_date: '2026-09-13',
    school_day_end_time: '13:00',
    blocks_scheduling: false,
    enforce_end_time: true,
    is_active: true,
    show_on_main_calendar: true
  }];
  const result = proposeDateAdjustments({ meetings, rules, exceptions, schoolCalendar });
  assert.ok(result?.valid, 'adjustment should be valid');
  assert.equal(result.kind, 'proposed_date_adjustment', 'kind should be proposed_date_adjustment');
  // The meeting that landed on 2026-09-13 (or wherever it moved) must have its end_time capped.
  const movedMeeting = result.meetings.find((m) => m.date === '2026-09-13');
  assert.ok(movedMeeting, 'a meeting should land on 2026-09-13 (the originally blocked date is moved there)');
  assert.equal(movedMeeting.end_time, '13:00', 'end_time on the moved date must be capped');
});
