import test from 'node:test';
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

const { buildExceptionsModelFromRows, normalizeActivityRow } = await import('../frontend/src/api.js');

function summerWorkshop(status, rowId) {
  return normalizeActivityRow({
    row_id: rowId,
    activity_family: 'one_day',
    activity_type: 'workshop',
    item_type: 'workshop',
    activity_season: 'summer_2026',
    activity_name: 'סדנת בדיקה',
    authority: 'רשות בדיקה',
    school: 'בית ספר בדיקה',
    district: 'מחוז דרום',
    activity_manager: 'עידן',
    instructor_name: 'מדריכה',
    emp_id: '1500',
    start_date: '2000-01-01',
    end_date: '2000-01-01',
    date_1: '2000-01-01',
    status
  });
}

test('closed Summer 2026 activity is archived and not counted as an exception', () => {
  const model = buildExceptionsModelFromRows(
    [summerWorkshop('סגור', 'SUMMER-CLOSED')],
    '2026-08',
    { include_rows: true, completionApprovalUploads: [] }
  );

  assert.equal(model.rows.length, 0);
  assert.equal(model.exceptionInstances.length, 0);
  assert.equal(model.uniqueExceptionActivities, 0);
  assert.equal(model.counts.missing_completion_approval, 0);
  assert.equal(model.counts.summer_ended_open, 0);
});

test('open ended Summer 2026 activity still appears as an operational exception', () => {
  const model = buildExceptionsModelFromRows(
    [summerWorkshop('פתוח', 'SUMMER-OPEN')],
    '2026-08',
    { include_rows: true, completionApprovalUploads: [] }
  );

  assert.equal(model.rows.length, 1);
  assert.ok(model.rows[0].exception_types.includes('summer_ended_open'));
  assert.ok(model.rows[0].exception_types.includes('missing_completion_approval'));
});
