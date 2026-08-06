import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { weekScreenCacheKey, monthScreenCacheKey } from '../frontend/src/screens/shared/calendar-cache-key.js';

const weekSrc = fs.readFileSync(new URL('../frontend/src/screens/week.js', import.meta.url), 'utf8');
const monthSrc = fs.readFileSync(new URL('../frontend/src/screens/month.js', import.meta.url), 'utf8');
const dashboardSrc = fs.readFileSync(new URL('../frontend/src/screens/dashboard.js', import.meta.url), 'utf8');

test('month nav uses snapshot month API and guarded loading flag', () => {
  assert.match(monthSrc, /api\.month\(\{\s*ym:\s*targetYm/);
  assert.match(monthSrc, /state\.monthNavLoading = true/);
  assert.match(monthSrc, /finally\s*\{[\s\S]*state\.monthNavLoading = false/);
});

test('week nav uses compact week API and guarded loading flag', () => {
  assert.match(weekSrc, /api\.week\(\{\s*week_offset:\s*nextOffset/);
  assert.match(weekSrc, /state\.weekNavLoading = true/);
  assert.match(weekSrc, /finally\s*\{[\s\S]*state\.weekNavLoading = false/);
});

test('dashboard month navigation uses dashboardSnapshot path', () => {
  assert.match(dashboardSrc, /api\.dashboardSnapshot\(\{ month: nextYm \}\)/);
  assert.doesNotMatch(dashboardSrc, /api\.dashboardSheet\s*\(/);
  assert.doesNotMatch(dashboardSrc, /api\.dashboard\s*\(\s*\{/);
  assert.match(dashboardSrc, /state\.dashboardNavLoading = true/);
  assert.match(dashboardSrc, /finally\s*\{[\s\S]*state\.dashboardNavLoading = false/);
});

test('week and month navigation use the same period-aware cache key shape as the route cache', () => {
  const regular = { activityPeriodTab: 'regular' };
  const nextYear = { activityPeriodTab: 'school_2027' };
  assert.equal(weekScreenCacheKey(2, regular), 'week:2:period:regular');
  assert.equal(weekScreenCacheKey(2, nextYear), 'week:2:period:school_2027');
  assert.equal(monthScreenCacheKey('2026-08', regular), 'month:2026-08:period:regular');
  assert.equal(monthScreenCacheKey('2026-09', nextYear), 'month:2026-09:period:school_2027');
});
