import test from 'node:test';
import assert from 'node:assert/strict';
import { weekRange, shiftWeek, buildWeekRows } from '../frontend/src/screens/course-scheduling-calendar.js';

test('a week runs Sunday through Friday and never includes Saturday', () => {
  const { start, end, days } = weekRange('2027-09-02'); // a Thursday
  assert.equal(start, '2027-08-29'); // preceding Sunday
  assert.equal(end, '2027-09-03'); // Friday
  assert.equal(days.length, 6);
  assert.ok(!days.includes('2027-09-04')); // the Saturday that would follow
});

test('shifting a week by +/-1 moves a full seven days from the same anchor weekday', () => {
  const next = shiftWeek('2027-09-02', 1);
  const previous = shiftWeek('2027-09-02', -1);
  assert.equal(next, '2027-09-05');
  assert.equal(previous, '2027-08-22');
});

test('an unassigned, draft-free course never occupies a calendar row', () => {
  const days = weekRange('2027-09-02').days;
  const rows = buildWeekRows([{ row_id: 'pending', meetings: [{ date: days[0], start_time: '10:00', end_time: '11:00' }] }], days);
  assert.equal(rows.length, 0);
});

test('a draft assignment occupies its own row, distinguishable from a real assignment', () => {
  const days = weekRange('2027-09-02').days;
  const activities = [
    { row_id: 'assigned', emp_id: '1', instructor_name: 'נועה', activity_name: 'קורס א', meetings: [{ date: days[0], start_time: '09:00', end_time: '10:00' }] },
    { row_id: 'draft', draft_emp_id: '1', draft_instructor_name: 'נועה', activity_name: 'קורס ב', meetings: [{ date: days[1], start_time: '09:00', end_time: '10:00' }] }
  ];
  const rows = buildWeekRows(activities, days);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].byDay.get(days[0])[0].kind, 'assigned');
  assert.equal(rows[0].byDay.get(days[1])[0].kind, 'draft');
});
