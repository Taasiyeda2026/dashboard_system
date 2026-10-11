import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { photoConsentSchoolManagementGroups, photoConsentSchoolOperationalSummary } from '../frontend/src/screens/shared/photo-consent-school.js';

const CLIENT = new URL('../frontend/src/screens/shared/photo-consent-client.js', import.meta.url);
const DRAWER = new URL('../frontend/src/screens/shared/activity-photo-consent-drawer.js', import.meta.url);
const VIEWER = new URL('../frontend/src/screens/shared/activity-photo-consent-viewer.js', import.meta.url);
const WORKSPACE = new URL('../frontend/src/screens/photo-consent-workspace.js', import.meta.url);

test('school operational summary shows unique linked managers, instructors and course starts', () => {
  const activities = [
    { id: 1, school: 'אורנים', authority: 'חיפה', activity_name: 'חלל', activity_manager: 'גיל נאמן',
      instructor_name: 'הנאא אבו אמנה', start_date: '2026-10-15' },
    { id: 2, school: 'אורנים', authority: 'חיפה', activity_name: 'ביומימיקרי', activity_manager: 'הילה רוזן',
      instructor_name: 'אילנה טיטייבסקי', start_date: '2026-11-02' },
    { id: 3, school: 'ברושים', authority: 'חיפה', activity_name: 'AI', activity_manager: 'עדן כהן',
      instructor_name: 'כרמית', start_date: '2026-12-03' }
  ];
  const files = [
    { id: 'doc1', activity_id: 1, uploaded_at: '2026-10-11T09:00:00Z' },
    { id: 'doc2', activity_id: 1, uploaded_at: '2026-10-11T10:00:00Z' },
    { id: 'doc3', activity_id: 2, uploaded_at: '2026-10-11T11:00:00Z' }
  ];
  const groups = photoConsentSchoolManagementGroups(activities, files);
  assert.equal(groups.length, 1, 'only schools with an uploaded document appear');
  assert.equal(groups[0].activityCount, 2, 'multiple documents for one course are not counted twice');
  assert.deepEqual(groups[0].operational.managers, ['הילה רוזן', 'גיל נאמן']);
  assert.deepEqual(groups[0].operational.instructors, ['אילנה טיטייבסקי', 'הנאא אבו אמנה']);
  assert.deepEqual(groups[0].operational.startDates, ['2026-10-15', '2026-11-02']);
  assert.equal(groups[0].operational.firstStartDate, '2026-10-15');
  assert.deepEqual(photoConsentSchoolOperationalSummary([]),
    { managers: [], instructors: [], startDates: [], firstStartDate: null });
});

test('management shows manager, instructor and start date in both desktop and mobile views and per file', async () => {
  const src = await readFile(WORKSPACE, 'utf8');
  assert.match(src, /activity_manager,instructor_name,start_date/);
  assert.match(src, /<th>מנהל פעילות<\/th><th>מדריך<\/th><th class="pc-date-th">תחילת קורס<\/th>/);
  assert.match(src, /group\.operational\.managers/);
  assert.match(src, /group\.operational\.instructors/);
  assert.match(src, /firstStartDate/);
  assert.match(src, /תאריכי התחלה נוספים/);
  assert.match(src, /class="pc-mobile-meta-grid"/);
  assert.match(src, /group\.operational\.managers/);
  assert.match(src, /group\.operational\.instructors/);
  assert.match(src, /file\.ownerActivity\?\.start_date/);
  assert.match(src, /colspan="6"/);
  assert.doesNotMatch(src, /data-pc-upload/);
});

test('green camera opens private documents while regular camera offers upload', async () => {
  const src = await readFile(DRAWER, 'utf8');
  assert.match(src, /button\.dataset\.photoConsentState === 'saved'/);
  assert.match(src, /openActivityPhotoConsentViewer\(activityId/);
  assert.match(src, /onAdd: \(\) => openPicker\(button, activityId\)/);
  assert.match(src, /if \(!opened\)/);
  assert.match(src, /paintCamera\(root, activityId, false\)/);
  assert.match(src, /openPicker\(button, activityId\)/);
  assert.match(src, /const label = hasFile \? 'צפייה באישורי צילום' : 'העלאת אישור צילום'/);
});

test('private viewer supports direct single preview, multiple file selection and add-another action', async () => {
  const [src, client] = await Promise.all([readFile(VIEWER, 'utf8'), readFile(CLIENT, 'utf8')]);
  assert.match(src, /photoConsentActivityFiles\(activityId, \{ instructorMode \}\)/);
  assert.match(src, /if \(!files\.length\) return false/);
  assert.match(src, /if \(files\.length === 1\) void showPreview\(files\[0\]\)/);
  assert.match(src, /else showList\(\)/);
  assert.match(src, /photoConsentInvoke\('download', \{/);
  assert.match(src, /העלאת אישור נוסף/);
  assert.match(src, /onAdd\(\)/);
  assert.match(src, /URL\.revokeObjectURL/);
  assert.match(src, /data\.mime_type === 'application\/pdf'/);
  assert.match(client, /from\('activity_photo_consent_files'\)/);
  assert.match(client, /\.eq\('activity_id', id\)/);
  assert.match(client, /\.order\('uploaded_at', \{ ascending: false \}\)/);
  assert.doesNotMatch(src, /MS_CLIENT_SECRET/);
});
