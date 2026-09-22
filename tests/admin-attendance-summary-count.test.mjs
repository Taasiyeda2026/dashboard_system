import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminSource = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');

test('admin overview excludes generated travel-time cancellation rows from report counts', () => {
  assert.match(adminSource, /const generationKind = text\(row\?\.generationKind \|\| row\?\.generation_kind\);/);
  assert.match(adminSource, /if \(generationKind === 'travel_time_cancellation'\) continue;/);
  assert.match(adminSource, /קיים · \${reportCount} דיווחים/);
});

test('admin overview still counts ordinary attendance rows', () => {
  assert.match(adminSource, /recordCounts\.set\(id, \(recordCounts\.get\(id\) \|\| 0\) \+ 1\);/);
});

test('admin attendance table shows monthly cancellation hours without inflating report count', () => {
  assert.match(adminSource, /const cancellationHours = new Map/);
  assert.match(adminSource, /if \(isCancellationAttendanceRow\(row\)\)/);
  assert.match(adminSource, /cancellationHours\.set\(id, \(cancellationHours\.get\(id\) \|\| 0\) \+ attendanceHoursValue\(row\)\)/);
  assert.match(adminSource, /<th>ביטול זמן<\/th>/);
  assert.match(adminSource, /formatAttendanceHours\(cancellation\)/);
  assert.match(adminSource, /recordCounts, cancellationHours, monthKey/);
});

test('admin attendance asset and cache markers are bumped', async () => {
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  assert.match(index, /admin-attendance-standalone\.js\?v=20260916-admin-attendance-summary-count-v2/);
  assert.match(sw, /const CACHE_VERSION = 1735;/);
  assert.match(config, /attendance-cancellation-summary-parity-20260922-v1/);
});
