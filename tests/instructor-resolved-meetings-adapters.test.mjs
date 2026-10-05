import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activitiesFromResolvedMeetings,
  applyResolvedMeetingsToActivityRow,
  instructorUpcomingFromResolvedMeetings,
  meetingsForActivity,
  nextMeetingFromResolvedMeetings
} from '../frontend/src/screens/instructor-portal/resolved-meetings.js';

const COURSE_A = 'ACT-biomimicry-0945';
const COURSE_B = 'school_2027_101';

function meeting({
  row_id,
  meeting_date,
  start_time = '09:45',
  end_time = '11:10',
  meeting_no = 1,
  is_single_meeting_substitution = false,
  is_secondary_instructor = false,
  activity_name = 'ביומימיקרי',
  school = 'שמש גבולות'
} = {}) {
  return {
    row_id,
    meeting_date,
    start_time,
    end_time,
    meeting_no,
    is_single_meeting_substitution,
    assignment_kind: is_single_meeting_substitution ? 'single_meeting_substitution' : null,
    is_secondary_instructor,
    activity_name,
    school,
    authority: 'אשכול',
    primary_resolved_emp_id: is_single_meeting_substitution ? '1502' : '1538',
    course_primary_emp_id: '1538'
  };
}

test('substitute sees only transferred meetings ahead of time', () => {
  const meetings = [
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-08', is_single_meeting_substitution: true, meeting_no: 3 }),
    meeting({ row_id: COURSE_B, meeting_date: '2026-10-08', start_time: '11:30', end_time: '13:00', is_single_meeting_substitution: true, meeting_no: 3 })
  ];
  const upcoming = instructorUpcomingFromResolvedMeetings(meetings, { today: '2026-10-05', days: 7 });
  assert.equal(upcoming.length, 2);
  assert.deepEqual(upcoming.map((item) => item.row.row_id).sort(), [COURSE_A, COURSE_B].sort());
  assert.ok(upcoming.every((item) => item.is_single_meeting_substitution));
});

test('permanent instructor does not see substituted meeting but keeps other meetings', () => {
  const meetings = [
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-01', meeting_no: 2 }),
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-15', meeting_no: 4 })
  ];
  const upcoming = instructorUpcomingFromResolvedMeetings(meetings, { today: '2026-10-05', days: 14 });
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].date, '2026-10-15');
  assert.equal(upcoming.some((item) => item.date === '2026-10-08'), false);
});

test('clearing a substitution restores the meeting to the permanent instructor view model', () => {
  const beforeClear = [
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-01', meeting_no: 2 }),
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-15', meeting_no: 4 })
  ];
  const afterClear = [
    ...beforeClear,
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-08', meeting_no: 3, is_single_meeting_substitution: false })
  ];
  const restored = instructorUpcomingFromResolvedMeetings(afterClear, { today: '2026-10-05', days: 14 });
  assert.ok(restored.some((item) => item.date === '2026-10-08'));
});

test('two groups on the same day remain separate records', () => {
  const meetings = [
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-08', is_single_meeting_substitution: true }),
    meeting({ row_id: COURSE_B, meeting_date: '2026-10-08', start_time: '11:30', end_time: '13:00', is_single_meeting_substitution: true })
  ];
  const activities = activitiesFromResolvedMeetings(meetings);
  assert.equal(activities.length, 2);
  assert.deepEqual(activities.map((row) => row.row_id).sort(), [COURSE_A, COURSE_B].sort());
});

test('my-activities drawer for a substitute only exposes owned meetings', () => {
  const activity = {
    row_id: COURSE_A,
    activity_name: 'ביומימיקרי',
    emp_id: '1538',
    date_1: '2026-09-10',
    date_2: '2026-09-17',
    date_3: '2026-10-08',
    date_4: '2026-10-15'
  };
  const owned = [
    meeting({ row_id: COURSE_A, meeting_date: '2026-10-08', is_single_meeting_substitution: true, meeting_no: 3 })
  ];
  const scoped = applyResolvedMeetingsToActivityRow(activity, owned);
  assert.equal(scoped.date_1, '2026-10-08');
  assert.equal(scoped.date_2, '');
  assert.equal(scoped.date_3, '');
  assert.equal(scoped.date_4, '');
  assert.equal(scoped.resolved_meetings.length, 1);
  assert.equal(scoped.substitution_only, true);
  assert.equal(meetingsForActivity(owned, COURSE_A).length, 1);
});

test('secondary instructor meetings stay visible even when primary is substituted elsewhere', () => {
  const meetings = [
    meeting({
      row_id: COURSE_A,
      meeting_date: '2026-10-08',
      is_single_meeting_substitution: true,
      is_secondary_instructor: true,
      primary_resolved_emp_id: '1502'
    }),
    meeting({
      row_id: COURSE_A,
      meeting_date: '2026-10-15',
      is_secondary_instructor: true,
      primary_resolved_emp_id: '1538'
    })
  ];
  const upcoming = instructorUpcomingFromResolvedMeetings(meetings, { today: '2026-10-05', days: 14 });
  assert.equal(upcoming.length, 2);
  assert.ok(upcoming.every((item) => item.row.is_secondary_instructor));
});

test('activity without history behaves as a normal upcoming assignment', () => {
  const meetings = [
    meeting({ row_id: 'ACT-plain', meeting_date: '2026-10-12', activity_name: 'סדנה רגילה', school: 'בית ספר א' })
  ];
  const next = nextMeetingFromResolvedMeetings(meetings, { today: '2026-10-05' });
  assert.equal(next.date, '2026-10-12');
  assert.equal(next.is_single_meeting_substitution, false);
  const activities = activitiesFromResolvedMeetings(meetings);
  assert.equal(activities[0].substitution_only, false);
  assert.equal(activities[0].resolved_meetings.length, 1);
});
