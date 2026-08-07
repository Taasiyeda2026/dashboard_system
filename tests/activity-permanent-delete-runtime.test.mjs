import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimePath = new URL('../frontend/src/activity-performance-runtime.js', import.meta.url);
const source = await readFile(runtimePath, 'utf8');

test('activity deletion is handled as a permanent delete outside the generic save flow', () => {
  assert.match(source, /האם למחוק את הפעילות לצמיתות\? לא ניתן לשחזר את הפעילות לאחר המחיקה\./);
  assert.match(source, /הפעילות נמחקה לצמיתות\./);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /\{ capture: true, signal: controller\.signal \}/);
  assert.match(source, /removeDeletedRowFromScreenData\(context\.data, rowId\)/);
  assert.match(source, /context\.clearScreenDataCache\?\.\('activities'\)/);
  assert.match(source, /context\.clearScreenDataCache\?\.\('operations-management'\)/);
  assert.match(source, /context\.rerender\?\.\(\)/);
  assert.doesNotMatch(source, /הפעילות נשמרה בתקופה אחרת/);
  assert.doesNotMatch(source, /onSaveSuccess/);
});

test('read-only historical activities continue to use the existing mutation guard', () => {
  assert.match(source, /isActivityMutationBlocked\(\{/);
  assert.match(source, /activityPeriod: String\(context\.state\?\.activityPeriodTab/);
  assert.match(source, /activitySeason: String\(form\.getAttribute\('data-activity-season'\)/);
});
