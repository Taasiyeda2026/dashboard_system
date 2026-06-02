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
  rowMatchesActivitiesFilters,
  sanitizeActivityPayload,
  sanitizeActivityPayloadForSupabase,
  normalizeActivityRow
} = await import('../frontend/src/api.js');

function normalizeForSave(payload) {
  return sanitizeActivityPayloadForSupabase(sanitizeActivityPayload(payload), { includeRowId: true });
}

test('new tour activity is normalized as one_day before Supabase insert', () => {
  const row = normalizeForSave({
    activity_type: 'tour',
    activity_family: 'program',
    source: 'long',
    activity_name: 'סיור בדיקה',
    start_date: '2026-06-15',
    end_date: '2026-06-15'
  });

  assert.equal(row.activity_type, 'tour');
  assert.equal(row.activity_family, 'one_day');
  assert.equal(row.item_type, 'tour');
  assert.equal(row.status, 'פתוח');
  assert.equal(row.date_1, '2026-06-15');
});

test('new workshop activity is normalized as one_day before Supabase insert', () => {
  const row = normalizeForSave({
    activity_type: 'workshop',
    activity_family: 'program',
    source: 'long',
    activity_name: 'סדנת בדיקה',
    start_date: '2026-06-16',
    end_date: '2026-06-16'
  });

  assert.equal(row.activity_type, 'workshop');
  assert.equal(row.activity_family, 'one_day');
  assert.equal(row.item_type, 'workshop');
  assert.equal(row.status, 'פתוח');
});

test('one-day Hebrew and escape-room activity types override wrong family/source values', () => {
  for (const activityType of ['סיור', 'סיורים', 'סדנה', 'סדנאות', 'escape_room', 'escaperoom', 'חדר בריחה', 'חדר_בריחה']) {
    const row = normalizeForSave({
      activity_type: activityType,
      activity_family: 'program',
      source: 'long',
      activity_name: `בדיקה ${activityType}`,
      start_date: '2026-06-17'
    });
    assert.equal(row.activity_family, 'one_day', `${activityType} should be one_day`);
    assert.equal(row.activity_type, row.item_type, `${activityType} activity_type and item_type should match`);
    assert.equal(row.status, 'פתוח', `${activityType} should save as open`);
  }
});

test('saved one-day activity appears in activities month filter when displayed month matches', () => {
  const savedRow = normalizeActivityRow(normalizeForSave({
    row_id: 'ACT-ONE-DAY-REGRESSION',
    activity_type: 'tour',
    activity_family: 'program',
    source: 'long',
    activity_name: 'סיור שמופיע במסך',
    start_date: '2026-06-18',
    end_date: '2026-06-18',
    status: 'פעיל'
  }));

  assert.equal(savedRow.activity_family, 'one_day');
  assert.equal(savedRow.status, 'פתוח');
  assert.equal(rowMatchesActivitiesFilters(savedRow, { month: '2026-06', activity_type: 'all' }), true);
  assert.equal(rowMatchesActivitiesFilters(savedRow, { month: '2026-07', activity_type: 'all' }), false);
});


test('one-day save rejects missing activity name and date', () => {
  assert.throws(() => normalizeForSave({
    activity_type: 'tour',
    activity_name: '',
    start_date: '2026-06-20'
  }), /שם פעילות/);

  assert.throws(() => normalizeForSave({
    activity_type: 'workshop',
    activity_name: 'סדנה ללא תאריך'
  }), /תאריך תקין/);
});

test('conflicting one-day item_type is corrected to canonical activity_type on save', () => {
  const row = normalizeForSave({
    activity_type: 'workshop',
    item_type: 'escape_room',
    activity_name: 'סדנת תיקון',
    date_1: '2026-06-21',
    status: 'פעיל'
  });

  assert.equal(row.activity_type, 'workshop');
  assert.equal(row.item_type, 'workshop');
  assert.equal(row.status, 'פתוח');
  assert.equal(row.start_date, '2026-06-21');
  assert.equal(row.end_date, '2026-06-21');
});

test('one-day activity save rejects generic type labels as activity_name', () => {
  assert.throws(() => normalizeForSave({
    activity_type: 'סדנה',
    activity_family: 'one_day',
    activity_name: 'סדנה',
    start_date: '2026-06-18'
  }), /יש לבחור שם פעילות מתוך הרשימה/);
});

test('Hebrew one-day type label saves canonical activity_type and selected specific name', () => {
  const row = normalizeForSave({
    activity_type: 'סדנה',
    item_type: 'חדר בריחה',
    activity_family: 'program',
    activity_name: 'צמידי שמש',
    start_date: '2026-06-19',
    status: 'פעיל'
  });

  assert.equal(row.activity_type, 'workshop');
  assert.equal(row.item_type, 'workshop');
  assert.equal(row.activity_family, 'one_day');
  assert.equal(row.activity_name, 'צמידי שמש');
  assert.equal(row.start_date, '2026-06-19');
  assert.equal(row.end_date, '2026-06-19');
  assert.equal(row.date_1, '2026-06-19');
  assert.equal(row.status, 'פתוח');
});

test('new workshop save generates a row_id and stores selected workshop name/date fields', () => {
  const row = normalizeForSave({
    activity_type: 'workshop',
    item_type: 'workshop',
    activity_family: 'program',
    activity_name: 'סדנת רובוטיקה מתקדמת',
    one_day_date: '2026-07-05',
    status: 'פעיל'
  });

  assert.match(row.row_id, /^ACT-/);
  assert.equal(row.activity_family, 'one_day');
  assert.equal(row.activity_type, 'workshop');
  assert.equal(row.item_type, 'workshop');
  assert.equal(row.activity_name, 'סדנת רובוטיקה מתקדמת');
  assert.equal(row.status, 'פתוח');
  assert.equal(row.date_1, '2026-07-05');
  assert.equal(row.start_date, '2026-07-05');
  assert.equal(row.end_date, '2026-07-05');
});
