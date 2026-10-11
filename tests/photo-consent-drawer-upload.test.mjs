import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DRAWER = new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url);
const ACTIVITIES = new URL('../frontend/src/screens/activities.js', import.meta.url);
const BINDER = new URL('../frontend/src/screens/shared/activity-photo-consent-drawer.js', import.meta.url);
const CLIENT = new URL('../frontend/src/screens/shared/photo-consent-client.js', import.meta.url);
const MANAGER = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('activity drawer renders an accessible small camera action for authorized dated activities only', async () => {
  const src = await readFile(DRAWER, 'utf8');
  assert.match(src, /data-activity-photo-upload/);
  assert.match(src, /aria-label="העלאת אישור צילום"/);
  assert.match(src, /viewBox="0 0 24 24"/);
  assert.match(src, /canManagePhotoConsents && !!row\?\.start_date/);
  assert.match(src, /Number\.isSafeInteger\(Number\(row\?\.id\)\)/);
  assert.match(src, /canManagePhotoConsents: opts\.canManagePhotoConsents === true && !instructorLimited/);
});

test('activity route wires icon with named permission and survives drawer rerender after saving', async () => {
  const src = await readFile(ACTIVITIES, 'utf8');
  assert.match(src, /state\?\.user\?\.permissions\?\.manage_photo_consents/);
  assert.match(src, /canManagePhotoConsents:/);
  assert.match(src, /bindActivityPhotoConsentUpload\(contentRoot, showToast\)/);
  assert.match(src, /import \{ bindActivityPhotoConsentUpload \}/);
});

test('drawer picker uploads files through the existing secure client rather than direct Graph credentials', async () => {
  const binder = await readFile(BINDER, 'utf8');
  const client = await readFile(CLIENT, 'utf8');
  assert.match(binder, /root\.addEventListener\('click'/);
  assert.match(binder, /input\.type = 'file'/);
  assert.match(binder, /input\.multiple = true/);
  assert.match(binder, /uploadPhotoConsentFiles\(activityId, files/);
  assert.match(client, /supabase\.functions\.invoke\('photo-consent-sharepoint'/);
  assert.match(client, /action, \.\.\.payload/);
  assert.match(client, /selection\.forEach\(validatePhotoConsentFile\)/);
  assert.match(client, /PHOTO_CONSENT_MAX_BYTES = 6 \* 1024 \* 1024/);
  assert.doesNotMatch(client, /MS_CLIENT_SECRET/);
});

test('management supports viewing and editing but has no new uploads', async () => {
  const manager = await readFile(MANAGER, 'utf8');
  assert.match(manager, /photoConsentSchoolManagementGroups/);
  assert.match(manager, /data-pc-view/);
  assert.match(manager, /data-pc-download/);
  assert.match(manager, /data-pc-replace/);
  assert.match(manager, /data-pc-delete/);
  assert.doesNotMatch(manager, /data-pc-upload/);
  assert.match(manager, /state\?\.user\?\.permissions\?\.manage_photo_consents/);
});
