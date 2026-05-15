import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function installStorage(name) {
  if (globalThis[name]) return;
  const store = new Map();
  globalThis[name] = {
    getItem: (key) => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

installStorage('sessionStorage');
installStorage('localStorage');

const {
  activityHasDateInRange,
  rowMatchesActivitiesFilters,
  rowExceptionTypesFromActivity,
  buildExceptionsModelFromRows,
  normalizeActivityRow
} = await import('../frontend/src/api.js');

function activeCourse(overrides = {}) {
  return normalizeActivityRow({
    RowID: 'A-1',
    activity_type: 'course',
    activity_manager: 'ops',
    status: 'פעיל',
    emp_id: 'E-1',
    instructor_name: 'מדריכה',
    emp_id_2: '',
    instructor_name_2: '',
    ...overrides
  });
}

test('active course without start_date and date_1 appears as missing_start_date exception', () => {
  const row = activeCourse({ start_date: '', end_date: '', date_1: '' });

  assert.deepEqual(rowExceptionTypesFromActivity(row), ['missing_start_date']);

  const model = buildExceptionsModelFromRows([row], '2026-05', { include_rows: true });
  assert.equal(model.totalExceptionRows, 1);
  assert.equal(model.counts.missing_start_date, 1);
  assert.equal(model.rows[0].exception_type, 'missing_start_date');
  assert.ok(model.rows[0].exception_types.includes('missing_start_date'));
});

test('month filter does not hide a course that has no start_date and no date_1 from exceptions', () => {
  const row = activeCourse({ RowID: 'A-2', start_date: null, end_date: '', date_1: null });

  const mayModel = buildExceptionsModelFromRows([row], '2026-05', { include_rows: true });
  const decemberModel = buildExceptionsModelFromRows([row], '2026-12', { include_rows: true });

  assert.equal(mayModel.rows.length, 1);
  assert.equal(decemberModel.rows.length, 1);
  assert.equal(decemberModel.rows[0].RowID, 'A-2');
});

test('activity with start_date/end_date and no date_1 appears in activities by overlapping month', () => {
  const row = activeCourse({ RowID: 'A-3', start_date: '2026-04-20', end_date: '2026-06-10', date_1: '' });

  assert.equal(activityHasDateInRange(row, '2026-05-01', '2026-05-31'), true);
  assert.equal(rowMatchesActivitiesFilters(row, { month: '2026-05', activity_type: 'all' }), true);
  assert.equal(rowMatchesActivitiesFilters(row, { month: '2026-07', activity_type: 'all' }), false);
  assert.equal(rowExceptionTypesFromActivity(row).includes('missing_start_date'), false);
});

test('activity with date_1 is matched by meeting dates before start/end fallback', () => {
  const row = activeCourse({ RowID: 'A-4', start_date: '2026-05-01', end_date: '2026-05-31', date_1: '2026-06-03' });

  assert.equal(activityHasDateInRange(row, '2026-06-01', '2026-06-30'), true);
  assert.equal(activityHasDateInRange(row, '2026-05-01', '2026-05-31'), false);
  assert.equal(rowMatchesActivitiesFilters(row, { month: '2026-06', activity_type: 'all' }), true);
  assert.equal(rowMatchesActivitiesFilters(row, { month: '2026-05', activity_type: 'all' }), false);
});

test('entering a valid start_date or date_1 removes missing_start_date automatically', () => {
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '', date_1: '' })).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '2026-05-10', date_1: '' })).includes('missing_start_date'), false);
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '', date_1: '2026-05-10' })).includes('missing_start_date'), false);
});


test('textual null markers in start_date/date_1 are treated as missing_start_date', () => {
  const bothTextual = activeCourse({ RowID: 'A-5', start_date: 'NULL', date_1: '' });
  const date1Textual = activeCourse({ RowID: 'A-6', start_date: '', date_1: 'NULL' });
  const undefinedWhitespace = activeCourse({ RowID: 'A-7', start_date: ' undefined ', date_1: ' ' });

  assert.equal(rowExceptionTypesFromActivity(bothTextual).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(date1Textual).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(undefinedWhitespace).includes('missing_start_date'), true);
});

test('closed and non-course rows are excluded from course exceptions', () => {
  const workshop = activeCourse({ RowID: 'A-8', activity_type: 'workshop', start_date: '', date_1: '' });
  const closed = activeCourse({ RowID: 'A-9', status: 'סגור', start_date: '', date_1: '' });

  const model = buildExceptionsModelFromRows([workshop, closed], '2026-05', { include_rows: true });

  assert.equal(model.totalExceptionRows, 0);
  assert.equal(model.rows.length, 0);
  assert.equal(model.counts.missing_start_date, 0);
});

test('Supabase missing-start candidates are loaded broadly and filtered in code', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

  const block = source.match(/const \[missingStartResult[\s\S]*?\] = await Promise\.all\(\[([\s\S]*?)\n    \]\);/);
  assert.ok(block, 'readExceptionsFromSupabase should fetch parallel exception candidate queries');
  assert.match(block[1], /queryBase\(\),/);
  assert.doesNotMatch(block[1], /start_date\.is\.null,start_date\.eq\.[\s\S]*date_1\.is\.null,date_1\.eq\./);
});

test('allActivities export path reads all activities without applying month/date filters', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

  const match = source.match(/allActivities:\s*async \(\) => \{[\s\S]*?\n  \},\n  activities:/);
  assert.ok(match, 'allActivities block should be followed by the regular activities endpoint');
  assert.match(match[0], /const rows = await readAllActivitiesRowsSupabase\(\);/);
  assert.doesNotMatch(match[0], /rowMatchesActivitiesFilters|activityHasDateInRange|filters/);
});
