import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getActivityDateColumns } from '../frontend/src/screens/shared/format-date.js';
import { cleanInstructorName, resolveActivityInstructorName } from '../frontend/src/screens/shared/activity-options.js';

test('meeting date columns preserve duplicate dates as independent meetings', () => {
  const row = {
    date_1: '2026-05-01',
    date_2: '2026-05-08',
    date_3: '2026-05-08',
    date_4: '2026-05-15'
  };
  assert.deepEqual(getActivityDateColumns(row), [
    '2026-05-01',
    '2026-05-08',
    '2026-05-08',
    '2026-05-15'
  ]);
});

test('instructor resolver accepts UI name aliases and rejects explicit unassigned markers', () => {
  assert.equal(resolveActivityInstructorName({ guideName: '  דנה כהן  ' }), 'דנה כהן');
  assert.equal(resolveActivityInstructorName({ teacher: 'לא שובץ', instructor_name: ' - ' }), '');
  assert.equal(cleanInstructorName(' undefined '), '');
});

test('backend meeting maps and source-date collection do not deduplicate by date', () => {
  const views = fs.readFileSync('OLD-GAS/views.gs', 'utf8');
  const actions = fs.readFileSync('OLD-GAS/actions.gs', 'utf8');
  assert.doesNotMatch(views, /var seen = \{\};[\s\S]*collectActivityDatesFromSourceRow_/);
  assert.match(views, /if \(d\) dates\.push\(d\);/);
  assert.doesNotMatch(views, /Object\.keys\(uniq\)\.sort\(\)/);
  assert.doesNotMatch(actions, /Object\.keys\(uniq\)\.sort\(\)/);
});

test('exception logic uses normalized instructor name source rather than id-only checks', () => {
  const api = fs.readFileSync('frontend/src/api.js', 'utf8');
  const actions = fs.readFileSync('OLD-GAS/actions.gs', 'utf8');
  const helpers = fs.readFileSync('OLD-GAS/helpers.gs', 'utf8');
  assert.match(api, /resolveActivityInstructorName\(row\)/);
  assert.match(api, /const hasValidInstructor = !!instructorName \|\| isValidId\(emp1\) \|\| isValidId\(emp2\);/);
  assert.match(actions, /resolveActivityInstructorName_\(row, false\)/);
  assert.match(helpers, /'guideName'/);
  assert.match(helpers, /'teacherName'/);
  assert.match(helpers, /'facilitatorName'/);
});
