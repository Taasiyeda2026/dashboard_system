import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('exceptions are computed from computeExceptionsModel_ via getExceptionsSummary_', async () => {
  const source = await fs.readFile(new URL('../backend/actions.gs', import.meta.url), 'utf8');
  assert.match(source, /function getExceptionsSummary_\(rows, ym, opts\) \{\s*return computeExceptionsModel_\(rows, ym, opts \|\| \{\}\);\s*\}/);
  assert.match(source, /var exceptionSummary = getExceptionsSummary_\(combined, ym, \{ include_rows: false \}\);/);
  assert.match(source, /var exceptionSummary = getExceptionsSummary_\(rows, month, \{ include_rows: true, include_debug: yesNo_\(payload && payload\.debug\) === 'yes' \}\);/);
});

test('dashboard and manager summary read exceptions from shared summary object', async () => {
  const source = await fs.readFile(new URL('../backend/actions.gs', import.meta.url), 'utf8');
  assert.match(source, /missingInstructorCount = exceptionSummary\.counts\.missing_instructor \|\| 0;/);
  assert.match(source, /missingStartDateCount = exceptionSummary\.counts\.missing_start_date \|\| 0;/);
  assert.match(source, /var exceptionSum = exceptionSummary\.totalExceptionInstances \|\| 0;/);
  assert.match(source, /managerExceptions = exceptionSummary\.byManager \|\| \{\};/);
});
