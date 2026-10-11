import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const url = (path) => new URL('../' + path, import.meta.url);
const EDGE = url('supabase/functions/photo-consent-sharepoint/index.ts');
const CLIENT = url('frontend/src/screens/shared/photo-consent-client.js');
const BINDER = url('frontend/src/screens/shared/activity-photo-consent-drawer.js');
const VIEWER = url('frontend/src/screens/shared/activity-photo-consent-viewer.js');
const INSTRUCTOR = url('frontend/src/screens/instructor-portal/activity-drawer.js');
const HTML = url('frontend/src/screens/shared/activity-detail-html.js');
const MANAGER = url('frontend/src/screens/photo-consent-workspace.js');

test('instructor sees the same accessible camera in only a dated own activity drawer', async () => {
  const [html, instr] = await Promise.all([readFile(HTML,'utf8'),readFile(INSTRUCTOR,'utf8')]);
  assert.match(instr, /state\?\.user\?\.role === 'instructor'/);
  assert.match(instr, /row\.row_id \|\| row\.RowID/);
  assert.match(instr, /canUploadOwnPhotoConsent/);
  assert.match(instr, /instructorLimited: true/);
  assert.match(instr, /onOpen: \(contentRoot\)/);
  assert.match(instr, /bindActivityPhotoConsentUpload\(contentRoot, showToast, \{ instructorMode: true \}\)/);
  assert.match(html, /canUploadOwnPhotoConsent &&/);
  assert.match(html, /data-activity-photo-upload/);
  assert.match(html, /escapeHtml\(String\(activityId\)\)/);
  assert.match(html, /instructorLimited && opts\.canUploadOwnPhotoConsent === true/);
});

test('instructor client never reads global metadata directly and only submits row ID', async () => {
  const [client,binder,viewer] = await Promise.all([readFile(CLIENT,'utf8'),readFile(BINDER,'utf8'),readFile(VIEWER,'utf8')]);
  assert.match(client, /photoConsentInvoke\('instructor_status', \{ activity_row_id: rowId \}\)/);
  assert.match(client, /photoConsentInvoke\('instructor_list', \{ activity_row_id: rowId \}\)/);
  assert.match(client, /\{ activity_row_id: String\(activityId\) \}/);
  assert.match(binder, /instructorMode/);
  assert.match(binder, /photoConsentActivityHasFiles\(activityId, \{ instructorMode \}\)/);
  assert.match(binder, /uploadPhotoConsentFiles\(activityId, files,[\s\S]*?\{ instructorMode \}\)/);
  assert.match(binder, /openActivityPhotoConsentViewer\(activityId/);
  assert.match(viewer, /photoConsentActivityFiles\(activityId, \{ instructorMode \}\)/);
  assert.match(viewer, /file_id: file\.id,[\s\S]*?\{ activity_row_id: String\(activityId\) \}/);
  assert.doesNotMatch(binder+client+viewer,/SUPABASE_SERVICE_ROLE_KEY|MS_CLIENT_SECRET/);
});

test('server grants no instructor ability to access foreign activity, delete documents or all files', async () => {
  const src = await readFile(EDGE,'utf8');
  assert.match(src, /user\?\.role === "instructor"/);
  assert.match(src, /txt\(ctx\.user\.emp_id\)/);
  assert.match(src, /employee === txt\(activity\.emp_id\) \|\| employee === txt\(activity\.emp_id_2\)/);
  assert.match(src, /av2_get_current_instructor_resolved_meetings/);
  assert.match(src, /p_from: year \+ "-09-01", p_to: \(year \+ 1\) \+ "-08-31"/);
  assert.match(src, /if \(!Array\.isArray\(meetings\) \|\|/);
  assert.match(src, /"instructor_status" \|\| action === "instructor_list"/);
  assert.match(src, /instructorActivity\(ctx, body\.activity_row_id\)/);
  assert.match(src, /file = files\.find\(\(f\) => f\.id === txt\(body\.file_id\)\)/);
  assert.match(src, /if \(!file \|\| file\.sp_drive_id !== DRIVE\)/);
  assert.match(src, /if \(!manager\) throw new HttpFailure\("מחיקת מסמכים/);
  assert.match(src, /if \(instructor && !manager\)/);
  assert.match(src, /privilegedRows\(ctx, "activity_photo_consent_files"/);
  assert.match(src, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(src, /auth.uid\(\)/);
});

test('instructor permission does not grant global management or RLS rights', async () => {
  const manager = await readFile(MANAGER,'utf8');
  const policy = await readFile(url('supabase/migrations/20261011201500_photo_consent_named_access.sql'),'utf8');
  assert.match(manager,/manage_photo_consents/);
  assert.doesNotMatch(manager,/canUploadOwnPhotoConsent|instructorMode/);
  assert.match(policy,/manage_photo_consents/);
  assert.doesNotMatch(policy,/role\s*=\s*'instructor'/);
});
