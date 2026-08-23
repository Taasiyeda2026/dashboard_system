import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ux = fs.readFileSync(new URL('../frontend/src/israa-management-activities-ux-fix.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('Israa activities uses the real shared drawer UI without changing the main screen', () => {
  assert.match(ux, /createSharedInteractionLayer/);
  assert.match(ux, /root\?\.matches\?\.\(ISRAA_PANEL_SELECTOR\)/);
  assert.match(ux, /ui: sharedUi/);
  assert.match(ux, /return originalBind\.call\(this, args\)/);
});

test('moving an activity gives clear progress and success feedback', () => {
  assert.match(ux, /מעביר את הפעילות/);
  assert.match(ux, /הפעילות הועברה בהצלחה לפעילויות של איסראא/);
  assert.match(ux, /data-israa-select-activity/);
  assert.match(ux, /showToast/);
});

test('the Israa-only UX fix is loaded by the app bootstrap', () => {
  assert.match(bootstrap, /israa-management-activities-ux-fix\.js\?v=20260824-v1/);
});
