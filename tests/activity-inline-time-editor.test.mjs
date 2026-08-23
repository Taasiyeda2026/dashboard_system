import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeTypedTime } from '../frontend/src/activity-drawer-approved-fixes.js';

test('typed activity times normalize without fixed interval choices', () => {
  assert.equal(normalizeTypedTime('8'), '08:00');
  assert.equal(normalizeTypedTime('830'), '08:30');
  assert.equal(normalizeTypedTime('945'), '09:45');
  assert.equal(normalizeTypedTime('14'), '14:00');
  assert.equal(normalizeTypedTime('1430'), '14:30');
  assert.equal(normalizeTypedTime('09:45'), '09:45');
  assert.equal(normalizeTypedTime('2360'), '');
  assert.equal(normalizeTypedTime('24:00'), '');
});

test('approved drawer runtime keeps the edit header compact and removes duplicate domain card', () => {
  const source = fs.readFileSync('frontend/src/activity-drawer-approved-fixes.js', 'utf8');
  assert.match(source, /HEADER_ORDER/);
  assert.match(source, /'activity_domain'/);
  assert.match(source, /oldField\?\.remove\(\)/);
  assert.match(source, /activity-drawer-inline__header-field--name/);
  assert.match(source, /grid-column: auto !important/);
  assert.match(source, /activity-approved-time-row/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /שעת הסיום חייבת להיות מאוחרת משעת ההתחלה/);
});

test('approved drawer fixes are loaded with the existing drawer runtime', () => {
  const loader = fs.readFileSync('frontend/src/activity-drawer-type-layout-safe-runtime.js', 'utf8');
  assert.match(loader, /activity-drawer-approved-fixes\.js\?v=20260823-v1/);
});
