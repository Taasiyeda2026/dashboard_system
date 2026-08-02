import { test } from 'node:test';
import assert from 'node:assert/strict';

function installStorage(name) {
  if (globalThis[name]) return;
  const store = new Map();
  globalThis[name] = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
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
const { hebrewExceptionType } = await import('../frontend/src/screens/shared/ui-hebrew.js');
const { exceptionsScreen } = await import('../frontend/src/screens/exceptions.js');

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
    date_1: '2026-06-10',
    instructor_name: 'מדריכה',
    emp_id: 'E-1',
    ...overrides
  });
}

test('hebrew labels distinguish missing authority from missing district', () => {
  assert.equal(hebrewExceptionType('missing_authority'), 'פעילויות ללא רשות');
  assert.equal(hebrewExceptionType('missing_district'), 'ללא שיוך מחוזי');
  assert.notEqual(hebrewExceptionType('missing_district'), 'רשויות ללא שיוך מחוזי');
});

test('2026 period keeps summer 2026 exceptions tab', () => {
  const html = exceptionsScreen.render(
    {
      month: '2026-07',
      activity_period: 'regular',
      rows: [
        {
          RowID: 'S1',
          activity_name: 'קיץ',
          activity_season: 'summer_2026',
          exception_types: ['missing_instructor']
        }
      ]
    },
    { state: { activityPeriodTab: 'regular', listFilters: {}, clientSettings: {} } }
  );
  assert.match(html, /חריגות קיץ 2026/);
});

test('exception model counts active pending-district rows as activities, not authorities', () => {
  const rows = [
    activity({ RowID: '1', authority: 'א', authority_id: 1, district: 'ממתין לשיוך מחוזי' }),
    activity({ RowID: '2', authority: 'א', authority_id: 1, district: 'ממתין לשיוך מחוזי' }),
    activity({ RowID: '3', authority: '', authority_id: null, district: 'ממתין לשיוך מחוזי' }),
    activity({ RowID: '4', authority: 'ב', authority_id: 2, district: 'ממתין לשיוך מחוזי', status: 'נמחק' })
  ];
  const model = buildExceptionsModelFromRows(rows, '2026-05', { include_rows: true });
  assert.equal(model.counts.missing_district, 2);
  assert.equal(model.counts.missing_authority, 1);
  assert.equal(model.uniqueExceptionActivities, 3);
  assert.ok(rowExceptionTypesFromActivity(rows[0]).includes('missing_district'));
  assert.ok(rowExceptionTypesFromActivity(rows[2]).includes('missing_authority'));
  assert.ok(!rowExceptionTypesFromActivity(rows[2]).includes('missing_district'));
});
