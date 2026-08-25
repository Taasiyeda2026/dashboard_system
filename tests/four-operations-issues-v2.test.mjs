import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [
  homeCards,
  managerRuntime,
  managerPhoneFix,
  managerStyles,
  api,
  activityForm,
  graphMail,
  outlook,
  coordinationView,
  migration
] = await Promise.all([
  readFile(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/styles/manager-board.css', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/microsoft/graph-mail.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/activity-coordination/outlook.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/activity-coordination/view.js', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/migrations/20260819090000_preserve_explicit_school_2027_activity_names.sql', import.meta.url), 'utf8')
]);

test('operations home cards use fixed canonical targets instead of visible labels', () => {
  assert.match(homeCards, /type: 'ops-tab', value: TAB_WORKSHOPS/);
  assert.match(homeCards, /type: 'route', value: 'invitations'/);
  assert.match(homeCards, /type: 'route', value: 'catalog'/);
  assert.match(homeCards, /type: 'route', value: 'certificates'/);
  assert.match(homeCards, /type: 'ops-custom-tab', value: OPS_CUSTOM_TAB_WORKSHOP_TRAINING/);
  assert.match(homeCards, /type: 'ops-custom-tab', value: OPS_CUSTOM_TAB_COURSE_TRAINING/);
  assert.match(homeCards, /type: 'ops-custom-tab', value: OPS_CUSTOM_TAB_PRINT_KITS/);
  assert.match(homeCards, /OPERATIONS_HOME_TARGETS/);
  assert.match(homeCards, /data-ops-home-target-type/);
  assert.doesNotMatch(homeCards, /MutationObserver|findPlaceholder|PLACEHOLDER_TEXT/);
});

test('manager instructor chips open the inline instructor center without the legacy phone popover', () => {
  assert.match(managerRuntime, /data-instructor-id=/);
  assert.match(managerRuntime, /data-manager-board-monthly-region/);
  assert.match(managerRuntime, /data-manager-instructor-back/);
  assert.match(managerRuntime, /activity\?\.emp_id, activity\?\.emp_id_2/);
  assert.match(managerRuntime, /const instructorCenterCache = new Map\(\)/);
  assert.match(managerRuntime, /function instructorCenterCacheKey\(empId, period\)/);
  assert.match(managerRuntime, /currentSessionKey\(\) \|\| 'session'/);
  assert.match(managerRuntime, /const token = \+\+instructorCenterRenderToken/);
  assert.match(managerRuntime, /get_instructor_employee_file_snapshot.*p_emp_id: Number\(key\)/);
  assert.match(managerRuntime, /\.select\('emp_id,full_name,direct_manager,active'\)/);
  assert.doesNotMatch(managerRuntime, /\.select\('emp_id,full_name,direct_manager,active,mobile'\)/);
  assert.doesNotMatch(managerRuntime, /const \[contactResult, profileResult, snapshotResult\]/);
  assert.match(managerRuntime, /formatFullDate\(point\.iso\)/);
  assert.doesNotMatch(managerRuntime, /משוב אמצע טרם בוצע|משוב סוף טרם בוצע|תצפית ראשונה טרם בוצעה|תצפית שנייה טרם בוצעה/);
  assert.match(managerRuntime, /state\.pendingInstructorEdit = 'profile';[\s\S]*closeManagerBoard\(\);[\s\S]*route: 'instructors'/);
  assert.doesNotMatch(managerRuntime, /loadInstructorSchedulingData/);
  assert.doesNotMatch(managerRuntime, /data-instructor-mobile/);
  assert.doesNotMatch(managerPhoneFix, /PhonePopover|instructorMobile|appendChild\(popover\)/);
  assert.doesNotMatch(managerStyles, /manager-board-phone-popover/);
});

test('only explicit name edits request an activity-name override and saves verify the persisted name', () => {
  assert.match(activityForm, /hasOwnProperty\.call\(changes, 'activity_name'\)[\s\S]*changes\.activity_name_override = true/);
  assert.match(api, /'activity_name_override'/);
  assert.match(api, /key === 'exists_in_gefen' \|\| key === 'activity_name_override'/);
  assert.match(api, /const isActivityName = key === 'activity_name'/);
  assert.match(api, /\.select\(`\$\{activityDateSelectColumns\(\)\},activity_name`\)/);
  assert.match(migration, /activity_name_override boolean not null default false/);
  assert.match(migration, /and new\.activity_name_override is true/);
  assert.match(migration, /new\.activity_name_override := false/);
});

test('coordination approvals send only after preparation and persist sent only after Graph accepts', () => {
  assert.match(graphMail, /scopes: \['Mail\.ReadWrite', 'Mail\.Send'\]/);
  assert.match(graphMail, /export function sendGraphMessage\(token, messageId\)/);
  assert.match(graphMail, /response\.status === 204 \|\| response\.status === 202/);
  assert.match(outlook, /export async function sendCoordinationDispatchGroup/);
  assert.match(outlook, /await sendGraphMessage\(token, messageId\);[\s\S]*await finishDispatch\(dispatch\.id, 'sent', sentAt\);/);
  assert.match(outlook, /await recordReconciliationException\(/);
  assert.match(coordinationView, /sendCoordinationDispatches/);
  assert.doesNotMatch(coordinationView, /טיוטת אישור התיאום מוכנה ב-Outlook/);
});
