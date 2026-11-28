import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { POSTER_MANAGEMENT_URL, posterNavigationPlacement } from '../frontend/src/poster-navigation.js';

test('poster navigation is restricted to admin, activities_manager and explicit poster capability', () => {
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

 test('explicit poster capability grants only poster placement and can be revoked', () => {
  const user = {role:'business_development_manager', permissions:{manage_all_posters:'yes'}};
  assert.equal(posterNavigationPlacement(user), 'manager-sidebar');
  assert.equal(posterNavigationPlacement({...user, is_active:false}), null);
  assert.equal(posterNavigationPlacement({...user, permissions:{manage_all_posters:'no'}}), null);
  assert.equal(posterNavigationPlacement({...user, permissions:{manage_all_posters:false}}), null);
  const screen = readFileSync(new URL('../frontend/src/screens/israa-management.js', import.meta.url), 'utf8');
  assert.ok(!screen.includes('data-israa-posters'));
  assert.ok(!screen.includes('POSTER_MANAGEMENT_URL'));
 });

 test('poster capability is registered as a boolean admin editor permission', () => {
  const source = readFileSync(new URL('../frontend/src/screens/permissions.js', import.meta.url),'utf8');
  assert.ok(source.includes("manage_all_posters: 'no'"));
  assert.ok(source.includes("k.startsWith('can_') || k === 'manage_all_posters'"));
 });
