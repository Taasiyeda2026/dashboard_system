import { test } from 'node:test';
import assert from 'node:assert/strict';

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
  rowExceptionTypesFromActivity,
  buildExceptionsModelFromRows,
  normalizeActivityRow
} = await import('../frontend/src/api.js');

function activity(overrides = {}) {
  return normalizeActivityRow({
    RowID: overrides.RowID || 'A-1',
    row_id: overrides.RowID || 'A-1',
    activity_type: 'course',
    status: 'פעיל',
    district: 'מחוז צפון',
    activity_manager: 'לא משויך',
    activity_name: 'פעילות בדיקה',
    authority: 'רשות',
    school: 'בית ספר',
    start_date: '2026-05-01',
    end_date: '2026-06-10',
    instructor_name: 'מדריכה',
    emp_id: 'E-1',
    ...overrides
  });
}

test('open activity with future end_date is not ended-not-closed', () => {
  const row = activity({ status: 'פתוח', end_date: '2999-01-01' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('end_date_passed'), false);
});

test('open activity with past end_date is ended-not-closed', () => {
  const row = activity({ status: 'פתוח', end_date: '2000-01-01' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('end_date_passed'), true);
});

test('end_date different from latest meeting date is end_date_out_of_sync', () => {
  const row = activity({ end_date: '2026-06-07', date_1: '2026-06-08', date_2: '2026-06-14' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('end_date_out_of_sync'), true);
});

test('end_date equal to latest meeting date is not end_date_out_of_sync', () => {
  const row = activity({ end_date: '2026-06-14', date_1: '2026-06-08', date_2: '2026-06-14' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('end_date_out_of_sync'), false);
});

test('activity without instructor appears as missing_instructor', () => {
  const row = activity({ instructor_name: '', emp_id: '', instructor_name_2: '', emp_id_2: '' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('missing_instructor'), true);
});

test('activity without start_date appears as missing_start_date', () => {
  const row = activity({ start_date: null, date_1: '2026-05-01' });
  assert.equal(rowExceptionTypesFromActivity(row).includes('missing_start_date'), true);
});

test('unassigned manager with valid district is counted under the district and totals are exception instances', () => {
  const row = activity({ RowID: 'DIST-1', activity_manager: 'לא משויך', district: 'מחוז דרום', start_date: null, instructor_name: '', emp_id: '' });
  const model = buildExceptionsModelFromRows([row], '2026-05', { include_rows: true });
  assert.equal(model.counts.missing_start_date, 1);
  assert.equal(model.counts.missing_instructor, 1);
  assert.equal(model.totalExceptionRows, 1);
  assert.equal(model.totalExceptionInstances, 2);
  assert.equal(model.byDistrict['מחוז דרום'], 2);
});
