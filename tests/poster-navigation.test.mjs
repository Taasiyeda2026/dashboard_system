import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POSTER_MANAGEMENT_URL, posterNavigationPlacement } from '../frontend/src/poster-navigation.js';

test('poster navigation is exclusive to admin and activities_manager', () => {
  assert.equal(posterNavigationPlacement({ role: 'admin' }), 'admin-management');
  assert.equal(posterNavigationPlacement({ role: 'activities_manager' }), 'manager-sidebar');
  for (const role of ['instructor', 'manager', 'operations_manager', 'business_development_manager', 'finance', '']) {
    assert.equal(posterNavigationPlacement({ role }), null);
  }
  assert.equal(posterNavigationPlacement({ role: 'admin', is_active: false }), null);
  assert.equal(posterNavigationPlacement({ role: 'activities_manager', is_active: false }), null);
  assert.equal(posterNavigationPlacement(null), null);
  assert.equal(POSTER_MANAGEMENT_URL, 'https://taasiyeda2026.github.io/spin-off/poster.html?view=management');
});

test('dashboard navigation uses distinct placements and rechecks role on click', () => {
  const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const admin = readFileSync(new URL('../frontend/src/screens/admin-home.js', import.meta.url), 'utf8');
  assert.equal(main.split("posterNavigationPlacement(state.user) === 'manager-sidebar'").length - 1, 2);
  assert.equal(admin.split("posterNavigationPlacement(state.user) === 'admin-management'").length - 1, 2);
  assert.ok(main.includes('data-poster-manager-nav="true"'));
  assert.ok(admin.includes("title: 'פוסטרים'"));
});
