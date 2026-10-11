import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BINDER = new URL('../frontend/src/screens/shared/activity-photo-consent-drawer.js', import.meta.url);
const CLIENT = new URL('../frontend/src/screens/shared/photo-consent-client.js', import.meta.url);
const CSS = new URL('../frontend/src/styles/activity-drawer-inline-layout.css', import.meta.url);

test('saved camera presence is checked from the persisted activity-specific metadata', async () => {
  const src = await readFile(CLIENT, 'utf8');
  const read = src.match(/export async function photoConsentActivityHasFiles\(activityId\) \{[\s\S]*?\n\}/);
  assert.ok(read, 'persisted presence read should exist');
  assert.match(read[0], /\.from\('activity_photo_consent_files'\)/);
  assert.match(read[0], /\.eq\('activity_id', id\)/);
  assert.match(read[0], /\.limit\(1\)/);
  assert.match(read[0], /if \(error\) throw/);
});

test('camera immediately turns green after confirmed upload and is rechecked on open/partial error', async () => {
  const src = await readFile(BINDER, 'utf8');
  assert.match(src, /photoConsentActivityHasFiles\(activityId\)/);
  assert.match(src, /classList\.toggle\('is-photo-consent-saved', hasFile\)/);
  assert.match(src, /paintCamera\(root, activityId, true\)/);
  assert.match(src, /if \(saved\.length\) \{/);
  assert.match(src, /void refreshCamera\(root, activityId\)/);
  assert.match(src, /button\.dataset\.photoConsentState = hasFile \? 'saved' : 'missing'/);
  assert.match(src, /if \(root\.dataset\.photoConsentDrawerBound === '1'\) return/);
  assert.match(src, /photoConsentCheckVersion/);
  assert.match(src, /Number\(root\.dataset\.photoConsentCheckVersion\) === sequence/);
  assert.match(src, /!button\.hasAttribute\('aria-busy'\)/);
});

test('green camera style stays readable and compact in the existing drawer header', async () => {
  const css = await readFile(CSS, 'utf8');
  assert.match(css, /\.activity-drawer__photo-upload\.is-photo-consent-saved \{/);
  assert.match(css, /background: #e4f7eb !important;/);
  assert.match(css, /color: #0d8543 !important;/);
  assert.match(css, /\.activity-drawer__photo-upload\.is-photo-consent-saved svg/);
  const src = await readFile(BINDER, 'utf8');
  assert.match(src, /אישור צילום שמור · העלאת אישור נוסף/);
  assert.match(src, /העלאת אישור צילום/);
});
