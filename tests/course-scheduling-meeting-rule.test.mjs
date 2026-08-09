import test from 'node:test';
import assert from 'node:assert/strict';
import { meetingsCompletedForCourse } from '../frontend/src/screens/course-scheduling-meetings.js';

const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const course = (dates) => ({ row_id: 'course-1', meetings: dates.map((date) => ({ date, start_time: '10:00', end_time: '11:00' })) });
const loadedState = (overrides = {}) => ({
  approvedDates: new Map(),
  cancelledDates: new Map(),
  loaded: true,
  error: '',
  ...overrides
});

test('a course with only future meetings has completed zero meetings', () => {
  const state = loadedState();
  assert.equal(meetingsCompletedForCourse(course([tomorrow]), state), 0);
});

test('a past meeting counts once it is not marked cancelled, without needing an approval', () => {
  const state = loadedState();
  assert.equal(meetingsCompletedForCourse(course([yesterday]), state), 1);
});

test('an approved completion upload counts even if the priority order is checked first', () => {
  const state = loadedState({ approvedDates: new Map([['course-1', new Set([tomorrow])]]) });
  assert.equal(meetingsCompletedForCourse(course([tomorrow]), state), 1);
});

test('a manually cancelled date is excluded even though it is in the past', () => {
  const state = loadedState({ cancelledDates: new Map([['course-1', new Set([yesterday])]]) });
  assert.equal(meetingsCompletedForCourse(course([yesterday, twoWeeksAgo]), state), 1);
});

test('two or more completed meetings do not lock instructor replacement', () => {
  const state = loadedState();
  assert.equal(meetingsCompletedForCourse(course([twoWeeksAgo, yesterday]), state), 2);
});

test('start date alone is never used as a stand-in for meetings completed', () => {
  // A course that starts today/soon but has no meeting dates recorded yet must not be
  // treated as already met — only actual meeting-date evidence counts.
  const state = loadedState();
  assert.equal(meetingsCompletedForCourse({ row_id: 'course-2', start_date: yesterday, meetings: [] }, state), 0);
});

test('failed meeting-state load does not invent a completed count from partial data', () => {
  assert.equal(meetingsCompletedForCourse(course([yesterday]), { loaded: false, error: 'permission denied' }), null);
});
