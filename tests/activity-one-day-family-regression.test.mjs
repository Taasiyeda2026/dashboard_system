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
});

test('one-day Hebrew and escape-room activity types override wrong family/source values', () => {
  for (const activityType of ['סיור', 'סיורים', 'סדנה', 'סדנאות', 'escape_room', 'escaperoom', 'חדר בריחה', 'חדר_בריחה']) {
    const row = normalizeForSave({
      activity_type: activityType,
      activity_family: 'program',
      source: 'long',
      start_date: '2026-06-17'
    });
    assert.equal(row.activity_family, 'one_day', `${activityType} should be one_day`);
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
  assert.equal(rowMatchesActivitiesFilters(savedRow, { month: '2026-06', activity_type: 'all' }), true);
  assert.equal(rowMatchesActivitiesFilters(savedRow, { month: '2026-07', activity_type: 'all' }), false);
});
