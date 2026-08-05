import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCourseTrainingAssignedPairs,
  setTrainingVisual
} from '../frontend/src/screens/operations-2027-training-assignment-fix.js';

const courses = [
  { id: 'activity-no-course', gefen_number: '100', short_name: 'קורס לפי מספר פעילות', full_name: 'קורס לפי מספר פעילות מלא' },
  { id: 'gefen-course', gefen_number: '200', short_name: 'קורס לפי גפן', full_name: 'קורס לפי גפן מלא' },
  { id: 'exact-name-course', gefen_number: '300', short_name: 'שם מדויק', full_name: 'שם מדויק מלא' },
  { id: 'ai', gefen_number: '501', short_name: 'בינה מלאכותית', full_name: 'בינה מלאכותית' },
  { id: 'entrepreneurship', gefen_number: '502', short_name: 'יזמות פרימיום', full_name: 'יזמות פרימיום' }
];

function key(courseId, name) {
  return `${courseId}::${name}`;
}

function classListStub() {
  const values = new Set();
  return {
    values,
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
    },
    contains(name) {
      return values.has(name);
    }
  };
}

function buttonStub() {
  const attrs = new Map();
  return {
    textContent: '',
    title: '',
    dataset: {},
    classList: classListStub(),
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, value) { attrs.set(name, value); },
    removeAttribute(name) { attrs.delete(name); if (name === 'title') this.title = ''; }
  };
}

test('course activity assignment resolves by activity_no before gefen_number', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_no: '100', gefen_number: '200', activity_name: 'קורס לפי גפן', instructor_name: 'מדריך א' }
  ], courses);

  assert.equal(pairs.has(key('activity-no-course', 'מדריך א')), true);
  assert.equal(pairs.has(key('gefen-course', 'מדריך א')), false);
});

test('course activity assignment resolves by gefen_number', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { gefen_number: '200', activity_name: 'שם אחר', instructor_name: 'מדריך ב' }
  ], courses);

  assert.deepEqual([...pairs], [key('gefen-course', 'מדריך ב')]);
});

test('course activity assignment uses exact name matching only', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_name: 'שם מדויק', instructor_name: 'מדריך ג' },
    { activity_name: 'שם', instructor_name: 'מדריך ד' },
    { activity_name: 'שם מדויק מורחב', instructor_name: 'מדריך ה' }
  ], courses);

  assert.equal(pairs.has(key('exact-name-course', 'מדריך ג')), true);
  assert.equal(pairs.has(key('exact-name-course', 'מדריך ד')), false);
  assert.equal(pairs.has(key('exact-name-course', 'מדריך ה')), false);
});

test('premium AI entrepreneurship activity remains unmatched without identifiers or exact course name', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_name: 'בינה מלאכותית-יזמות פרימיום', activity_no: null, gefen_number: null, instructor_name: 'מדריך ו' }
  ], courses);

  assert.equal(pairs.size, 0);
});

test('unmatched activities do not create red X assignments for any course', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_name: 'פעילות לא קיימת', instructor_name: 'מדריך ז' }
  ], courses);

  assert.equal(pairs.size, 0);
});

test('deleted and cancelled activities do not create assignments', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_no: '100', instructor_name: 'מחוק', deleted_at: '2026-01-01' },
    { activity_no: '100', instructor_name: 'נמחק', is_deleted: true },
    { activity_no: '100', instructor_name: 'מבוטל', status: 'בוטל' },
    { activity_no: '100', instructor_name: 'מבוטל באנגלית', status: 'cancelled' },
    { activity_no: '100', instructor_name: 'פעיל' }
  ], courses);

  assert.deepEqual([...pairs], [key('activity-no-course', 'פעיל')]);
});

test('activities without instructor names do not create assignments', () => {
  const pairs = buildCourseTrainingAssignedPairs([
    { activity_no: '100', instructor_name: '' },
    { activity_no: '100' }
  ], courses);

  assert.equal(pairs.size, 0);
});

test('training visual uses shared training cell state for green, red and empty cells', () => {
  const trainedButton = buttonStub();
  setTrainingVisual(trainedButton, { trained: true, assigned: false });
  assert.equal(trainedButton.textContent, '✓');
  assert.equal(trainedButton.classList.contains('is-yes'), true);
  assert.equal(trainedButton.dataset.assigned, '0');

  const assignedButton = buttonStub();
  setTrainingVisual(assignedButton, { trained: false, assigned: true });
  assert.equal(assignedButton.textContent, '✕');
  assert.equal(assignedButton.classList.contains('is-no'), true);
  assert.equal(assignedButton.dataset.assigned, '1');

  const emptyButton = buttonStub();
  setTrainingVisual(emptyButton, { trained: false, assigned: false });
  assert.equal(emptyButton.textContent, '');
  assert.equal(emptyButton.classList.contains('is-empty'), true);
  assert.equal(emptyButton.dataset.assigned, '0');
});
