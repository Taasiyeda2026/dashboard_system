import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingsCompletedForCourse, courseMeetingStage } from '../frontend/src/screens/course-scheduling-meetings.js';

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const course = (dates) => ({ row_id: 'course-1', meetings: dates.map((date) => ({ date, start_time: '10:00', end_time: '11:00' })) });

test('a course with only future meetings has completed zero meetings', () => {
  const state = { approvedDates: new Map(), cancelledDates: new Map() };
  assert.equal(meetingsCompletedForCourse(course([tomorrow]), state), 0);
  assert.equal(courseMeetingStage(0), 'not_started');
});

test('a past meeting counts once it is not marked cancelled, without needing an approval', () => {
  const state = { approvedDates: new Map(), cancelledDates: new Map() };
  assert.equal(meetingsCompletedForCourse(course([yesterday]), state), 1);
  assert.equal(courseMeetingStage(1), 'one_completed');
});

test('an approved completion upload counts even if the priority order is checked first', () => {
  const state = { approvedDates: new Map([['course-1', new Set([tomorrow])]]), cancelledDates: new Map() };
  assert.equal(meetingsCompletedForCourse(course([tomorrow]), state), 1);
});

test('a manually cancelled date is excluded even though it is in the past', () => {
  const state = { approvedDates: new Map(), cancelledDates: new Map([['course-1', new Set([yesterday])]]) };
  assert.equal(meetingsCompletedForCourse(course([yesterday, twoWeeksAgo]), state), 1);
});

test('two or more completed meetings lock the course out of automatic replacement', () => {
  const state = { approvedDates: new Map(), cancelledDates: new Map() };
  assert.equal(meetingsCompletedForCourse(course([twoWeeksAgo, yesterday]), state), 2);
  assert.equal(courseMeetingStage(2), 'locked');
  assert.equal(courseMeetingStage(5), 'locked');
});

test('start date alone is never used as a stand-in for meetings completed', () => {
  // A course that starts today/soon but has no meeting dates recorded yet must not be
  // treated as already met — only actual meeting-date evidence counts.
  const state = { approvedDates: new Map(), cancelledDates: new Map() };
  assert.equal(meetingsCompletedForCourse({ row_id: 'course-2', start_date: yesterday, meetings: [] }, state), 0);
});
