import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

test('updateActivityInSupabase maps meeting_date fields before one-day normalization', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fnBlock = source.match(/async function updateActivityInSupabase\(payload = \{\}\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(fnBlock, /const mappedChanges = mapMeetingDateFieldNamesToSupabase\(rawChanges\)/);
  assert.match(fnBlock, /const needsExisting = Object\.keys\(mappedChanges\)/);
  assert.match(fnBlock, /normalizeOneDayActivityForSave\(\{ \.\.\.existingForNormalization, \.\.\.mappedChanges \}\)/);
  assert.doesNotMatch(fnBlock, /normalizeOneDayActivityForSave\(\{ \.\.\.existingForNormalization, \.\.\.rawChanges \}\)/);
  assert.doesNotMatch(fnBlock, /oneDayTypeFromActivityFields\(rawChanges\./);
});

test('one-day activity save keeps mapped meeting date over existing row dates', async () => {
  const { normalizeOneDayActivityForSave } = await import('../frontend/src/api.js');
  const existing = {
    activity_family: 'one_day',
    activity_type: 'סדנה',
    item_type: 'סדנה',
    status: 'פעיל',
    date_1: '2026-07-01',
    start_date: '2026-07-01',
    end_date: '2026-07-01'
  };
  const mappedChanges = { status: 'פתוח', date_1: '2026-07-15' };
  const normalized = normalizeOneDayActivityForSave({ ...existing, ...mappedChanges });
  assert.equal(normalized.date_1, '2026-07-15');
  assert.equal(normalized.start_date, '2026-07-15');
  assert.equal(normalized.end_date, '2026-07-15');
});
