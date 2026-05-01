import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('dashboard summary wording is correct Hebrew phrasing', () => {
  const src = read('frontend/src/screens/dashboard.js');
  assert.match(src, /יש \(<strong>\$\{activeCurrent\}<\/strong>\) קורסים פעילים/);
  assert.match(src, /להסתיים \(<strong>\$\{endingCurrent\}<\/strong>\) קורסים\./);
});

test('exceptions month title uses Hebrew month label helper', () => {
  const src = read('frontend/src/screens/exceptions.js');
  assert.match(src, /function hebrewMonthLabel\(ym\)/);
  assert.match(src, /hebrewMonthLabel\(data\.month\)/);
});

test('activities include activity_type filter and clear hook resets drill state', () => {
  const src = read('frontend/src/screens/activities.js');
  assert.match(src, /key: 'activity_type', label: 'סוג הפעילות'/);
  assert.match(src, /onClear:\s*\(\)\s*=>\s*\{[\s\S]*activityQuickFamily\s*=\s*'';[\s\S]*activityQuickManager\s*=\s*'';[\s\S]*activityEndingCurrentMonth\s*=\s*false;/);
});
