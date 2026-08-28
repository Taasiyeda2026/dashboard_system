import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const adminHome = await readFile(new URL('../frontend/src/screens/admin-home.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../attendance/src/app.js', import.meta.url), 'utf8');
const identity = await readFile(new URL('../attendance/src/auth/identity.service.js', import.meta.url), 'utf8');
const attendanceService = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const activitiesService = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const storageService = await readFile(new URL('../attendance/src/services/storage.service.js', import.meta.url), 'utf8');
const previewMode = await readFile(new URL('../attendance/src/preview/preview-mode.js', import.meta.url), 'utf8');

test('admin management opens employee preview while non-admin attendance stays unchanged', () => {
  assert.match(adminHome, /title:\s*'תצוגת עובד'/);
  assert.match(adminHome, /attendance\/\?adminPreview=1/);
  assert.match(adminHome, /title:\s*'מערכת נוכחות'/);
  assert.match(adminHome, /url:\s*'\/dashboard_system\/attendance\/'/);
});

test('employee preview is restricted to active admins and uses a synthetic employee identity', () => {
  assert.match(identity, /resolveAdminPreviewIdentity/);
  assert.match(identity, /userRow\.role.*admin/);
  assert.match(identity, /getAdminPreviewIdentity/);
  assert.match(previewMode, /PREVIEW_EMP_ID/);
  assert.match(previewMode, /name:\s*'עובד\/ת לדוגמה'/);
});

test('preview mode routes attendance reads and writes to in-memory demo state', () => {
  for (const source of [attendanceService, activitiesService, storageService]) {
    assert.match(source, /isAdminPreviewRequested/);
  }
  assert.match(attendanceService, /createPreviewRecord/);
  assert.match(attendanceService, /updatePreviewRecord/);
  assert.match(attendanceService, /deletePreviewRecord/);
  assert.match(attendanceService, /submitPreviewMonth/);
  assert.match(storageService, /return `preview\/\$\{path\}`/);
  assert.match(previewMode, /state\.records/);
  assert.doesNotMatch(previewMode, /supabase|fetch\(/);
});

test('preview UI is clearly marked and exits without signing the dashboard session out', () => {
  assert.match(app, /מצב בדיקה לאדמין/);
  assert.match(app, /כל הנתונים כאן הם נתוני הדגמה ולא נשמרים במערכת/);
  assert.match(app, /if \(state\.previewMode\)[\s\S]*window\.location\.assign\('\/dashboard_system\/'\)/);
});
