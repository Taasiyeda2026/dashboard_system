import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('manual date typing guards avoid no-op writes to the active date control', async () => {
  const [runtime, calendar] = await Promise.all([
    fs.readFile(new URL('../frontend/src/activity-routine-stability-runtime.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/screens/shared/school-calendar-form-guard.js', import.meta.url), 'utf8')
  ]);

  assert.match(runtime, /if \(input\.min !== SCHOOL_2027_DATE_MIN\) input\.min = SCHOOL_2027_DATE_MIN;/);
  assert.match(runtime, /if \(input\.max !== SCHOOL_2027_DATE_MAX\) input\.max = SCHOOL_2027_DATE_MAX;/);
  assert.match(runtime, /setRangeValidity\(event\.target, isSchool2027Form\(form\)\);/);
  assert.match(calendar, /if \(String\(picker\.value \|\| ''\) !== candidate\) picker\.value = candidate;/);
  assert.match(calendar, /if \(allowedDate !== currentValue\) \{[\s\S]*pickers\[position\]\.value = allowedDate;/);
});
