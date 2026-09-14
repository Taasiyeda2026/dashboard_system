import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { instructorActivityMeetingDates, instructorUpcomingMeetings, nextInstructorMeeting } from '../frontend/src/screens/instructor-portal/portal-data.js';

const state = { user: { emp_id: '1503', role: 'instructor' } };

const row = (overrides = {}) => ({
  RowID: 'course-1',
  emp_id: '1503',
  activity_name: 'ביומימיקרי',
  activity_type: 'course',
  school: 'מקיף אבו גוש',
  authority: 'אבו גוש',
  status: 'פתוח',
  start_time: '08:30:00',
  end_time: '10:30:00',
  start_date: '2026-09-01',
  date_1: '2026-09-01',
  date_2: '2026-09-08',
  date_3: '2026-09-15',
  date_4: '2026-10-06',
  ...overrides
});

test('rolling seven-day dashboard uses actual meeting dates, not only course start date', () => {
  const meetings = instructorUpcomingMeetings([row()], state, { today: '2026-09-14', days: 7 });
  assert.equal(meetings.length, 1);
  assert.equal(meetings[0].date, '2026-09-15');
  assert.equal(meetings[0].activity_name, 'ביומימיקרי');
});

test('rolling seven-day dashboard returns every meeting and sorts by date then time', () => {
  const rows = [
    row({ RowID: 'later', activity_name: 'פעילות ב', date_1: '2026-09-16', date_2: null, date_3: null, date_4: null, start_time: '11:00:00' }),
    row({ RowID: 'early-time', activity_name: 'פעילות א', date_1: '2026-09-15', date_2: null, date_3: null, date_4: null, start_time: '12:00:00' }),
    row({ RowID: 'earliest-time', activity_name: 'פעילות ג', date_1: '2026-09-15', date_2: null, date_3: null, date_4: null, start_time: '09:00:00' })
  ];
  const meetings = instructorUpcomingMeetings(rows, state, { today: '2026-09-14', days: 7 });
  assert.deepEqual(meetings.map((item) => item.row.RowID), ['earliest-time', 'early-time', 'later']);
});

test('closed/deleted activities do not appear and next meeting can fall beyond seven days', () => {
  const rows = [
    row({ RowID: 'closed', status: 'סגור', date_1: '2026-09-15', date_2: null, date_3: null, date_4: null }),
    row({ RowID: 'future', activity_name: 'סדנה עתידית', date_1: '2026-09-30', date_2: null, date_3: null, date_4: null })
  ];
  assert.equal(instructorUpcomingMeetings(rows, state, { today: '2026-09-14', days: 7 }).length, 0);
  assert.equal(nextInstructorMeeting(rows, state, { today: '2026-09-14' })?.row?.RowID, 'future');
});

test('meeting dates are deduplicated and fall back to start date only when no meeting dates exist', () => {
  assert.deepEqual(instructorActivityMeetingDates(row({ meeting_dates: ['2026-09-15', '2026-09-15'] })), ['2026-09-01', '2026-09-08', '2026-09-15', '2026-10-06']);
  assert.deepEqual(instructorActivityMeetingDates(row({ date_1: null, date_2: null, date_3: null, date_4: null, start_date: '2026-09-20' })), ['2026-09-20']);
});

test('dashboard renders a seven-day upcoming section and no longer relies on summary.next', () => {
  const source = fs.readFileSync(new URL('../frontend/src/screens/instructor-portal/dashboard.js', import.meta.url), 'utf8');
  assert.match(source, /instructorUpcomingMeetings/);
  assert.match(source, /הפעילויות הקרובות · 7 ימים/);
  assert.match(source, /הפעילות הבאה שלך/);
  assert.doesNotMatch(source, /const next = summary\.next/);
});
