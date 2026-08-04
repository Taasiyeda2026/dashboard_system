import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { meetingInstructorHistoryHtml } from '../frontend/src/screens/course-scheduling.js';

test('the meeting history reads the instructor per date from the rows it is given, not a single value', () => {
  const html = meetingInstructorHistoryHtml(
    [
      { meeting_date: '2020-01-01', emp_id: '1', instructor_name: 'נועה' },
      { meeting_date: '2099-01-01', emp_id: '2', instructor_name: 'דנה' }
    ],
    []
  );
  assert.match(html, /נועה/);
  assert.match(html, /דנה/);
  // The past meeting's row must not also show the new instructor's name.
  const pastRowHtml = html.split('דנה')[0];
  assert.doesNotMatch(pastRowHtml.split('נועה')[1] || '', /דנה/);
});

test('the meeting on or after an operational replacement is marked as the effective date', () => {
  const html = meetingInstructorHistoryHtml(
    [
      { meeting_date: '2020-01-01', emp_id: '1', instructor_name: 'נועה' },
      { meeting_date: '2099-01-01', emp_id: '2', instructor_name: 'דנה' }
    ],
    [{ effective_from: '2099-01-01' }]
  );
  const rows = html.split('<tr>').slice(1);
  const pastRow = rows.find((row) => row.includes('נועה'));
  const futureRow = rows.find((row) => row.includes('דנה'));
  assert.doesNotMatch(pastRow, /מכאן ואילך/);
  assert.match(futureRow, /מכאן ואילך/);
});

test('an empty or not-yet-fetched meeting list renders no meeting-history section instead of guessing', () => {
  assert.equal(meetingInstructorHistoryHtml([], []), '');
  assert.equal(meetingInstructorHistoryHtml(undefined, undefined), '');
});

test('the course panel fetches per-meeting instructors from the RPC instead of inferring from activities.emp_id', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const meetingsSource = await readFile(new URL('../frontend/src/screens/course-scheduling-meetings.js', import.meta.url), 'utf8');
  assert.match(source, /loadCourseMeetingState/);
  assert.match(source, /meetingInstructorHistoryHtml/);
  assert.match(meetingsSource, /activity_completion_approval_uploads/);
  assert.match(meetingsSource, /course_meeting_cancellations/);
  assert.doesNotMatch(source, /activities\.emp_id.*meeting_date/);
});
