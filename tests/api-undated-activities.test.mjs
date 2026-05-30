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
    district: 'מחוז בדיקה',
    authority: 'רשות בדיקה',
    school: 'בית ספר בדיקה',
    status: 'פעיל',
    start_date: '2026-05-01',
    end_date: '2999-01-01',
    date_1: '2999-01-01',
    emp_id: 'E-1',
    instructor_name: 'מדריכה',
    emp_id_2: '',
    instructor_name_2: '',
    ...overrides
  });
}

test('active activity without start_date appears as missing_start_date exception', () => {
  const row = activeCourse({ start_date: '', end_date: '', date_1: '' });

  const types = rowExceptionTypesFromActivity(row);
  assert.ok(types.includes('missing_start_date'));
  assert.ok(types.includes('missing_end_date'));
  assert.ok(types.includes('missing_next_meeting'));

  const model = buildExceptionsModelFromRows([row], '2026-05', { include_rows: true });
  assert.equal(model.totalExceptionRows, 1);
  assert.equal(model.counts.missing_start_date, 1);
  assert.equal(model.rows[0].exception_type, 'missing_start_date');
  assert.ok(model.rows[0].exception_types.includes('missing_start_date'));
});

test('month filter does not hide an activity that has no start_date from exceptions', () => {
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

test('only a valid start_date removes missing_start_date automatically', () => {
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '', date_1: '' })).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '2026-05-10', date_1: '' })).includes('missing_start_date'), false);
  assert.equal(rowExceptionTypesFromActivity(activeCourse({ start_date: '', date_1: '2026-05-10' })).includes('missing_start_date'), true);
});

test('end_date_out_of_sync is computed from latest date_1..date_35', () => {
  const row = activeCourse({
    RowID: 'A-10',
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    date_1: '2026-06-16',
    date_2: '2026-06-10'
  });
  const types = rowExceptionTypesFromActivity(row);
  assert.equal(types.includes('end_date_out_of_sync'), true);
  assert.equal(row._calculated_end_date, '2026-06-16');
});

test('matching end_date and latest meeting date does not create end_date_out_of_sync', () => {
  const row = activeCourse({
    RowID: 'A-11',
    end_date: '2026-06-20',
    date_1: '2026-06-20'
  });
  const types = rowExceptionTypesFromActivity(row);
  assert.equal(types.includes('end_date_out_of_sync'), false);
});


test('textual null markers in start_date/date_1 are treated as missing_start_date', () => {
  const bothTextual = activeCourse({ RowID: 'A-5', start_date: 'NULL', date_1: '' });
  const date1Textual = activeCourse({ RowID: 'A-6', start_date: '', date_1: 'NULL' });
  const undefinedWhitespace = activeCourse({ RowID: 'A-7', start_date: ' undefined ', date_1: ' ' });

  assert.equal(rowExceptionTypesFromActivity(bothTextual).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(date1Textual).includes('missing_start_date'), true);
  assert.equal(rowExceptionTypesFromActivity(undefinedWhitespace).includes('missing_start_date'), true);
});

test('closed rows are excluded while non-course activities can still have exceptions', () => {
  const workshop = activeCourse({ RowID: 'A-8', activity_type: 'workshop', start_date: '', date_1: '' });
  const closed = activeCourse({ RowID: 'A-9', status: 'סגור', start_date: '', date_1: '' });

  const model = buildExceptionsModelFromRows([workshop, closed], '2026-05', { include_rows: true });

  assert.equal(model.totalExceptionRows, 1);
  assert.equal(model.rows.length, 1);
  assert.equal(model.counts.missing_start_date, 1);
});

test('Supabase exceptions read uses a single activities source and computes in code', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

  const block = source.match(/async function readExceptionsFromSupabase[\s\S]*?function syncContactToSupabase/);
  assert.ok(block, 'readExceptionsFromSupabase should exist');
  assert.match(block[0], /supabase\.from\('activities'\)\.select\('\*'\)/);
  assert.match(block[0], /buildExceptionsModelFromRows\(allRows/);
  assert.match(block[0], /late_end_date_threshold/);
  assert.doesNotMatch(block[0], /missingStartResult|lateEndDateResult/);
});

test('allActivities export path reads all activities without applying month/date filters', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

  const match = source.match(/allActivities:\s*async \(\) => \{[\s\S]*?readAllActivitiesRowsSupabase\(\);[\s\S]*?return \{ rows, _source: 'supabase' \};[\s\S]*?\n\s*\},/);
  assert.ok(match, 'allActivities block should be present before the following API endpoint');
  assert.match(match[0], /const rows = await readAllActivitiesRowsSupabase\(\);/);
  assert.doesNotMatch(match[0], /rowMatchesActivitiesFilters|activityHasDateInRange|filters/);
});
