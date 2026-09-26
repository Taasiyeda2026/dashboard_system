import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync(new URL('../frontend/src/israa-activities-main-workspace.js', import.meta.url), 'utf8');
const proposalItems = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const activities = fs.readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('Israa activities tab reuses the canonical main activities screen', () => {
  assert.match(workspace, /import \{ activitiesScreen \} from '\.\/screens\/activities\.js'/);
  assert.match(workspace, /createSharedInteractionLayer/);
  assert.match(workspace, /activitiesScreen\.render\(data, \{ state: workspaceState \}\)/);
  assert.match(workspace, /activitiesScreen\.bind\(\{/);
  assert.match(workspace, /ui: workspaceUi/);
  assert.match(workspace, /PANEL_SELECTOR = '\.israa-mgmt \.israa-activities-panel'/);
});

test('Israa workspace stays E-scoped while allowing a manual add only through the dedicated RPC', () => {
  assert.match(workspace, /\.eq\('activity_domain', 'E'\)/);
  assert.match(workspace, /api\.saveIsraaActivityGroupDraft/);
  assert.match(workspace, /api\.updateIsraaSharedActivity/);
  assert.match(workspace, /api\.shareIsraaActivity/);
  assert.match(workspace, /remove_israa_activity_draft/);
  assert.match(workspace, /create_israa_manual_activity/);
  assert.match(workspace, /update_israa_manual_activity/);
  assert.match(workspace, /activity_domain: 'E'/);
  assert.match(workspace, /activity_season: 'school_2027'/);
  assert.match(workspace, /can_edit_direct: true/);
  assert.match(workspace, /can_add_activity: true/);
  assert.match(workspace, /prop === 'deleteActivity' \|\| prop === 'submitCreateActivityRequest'/);
  assert.doesNotMatch(workspace, /prop === 'deleteActivity' \|\| prop === 'addActivity'/);
});

test('proposal quantity expands into one editable Israa activity row per group', () => {
  assert.match(workspace, /for \(let groupNumber = 1; groupNumber <= quantity; groupNumber \+= 1\)/);
  assert.match(workspace, /draftRowId\(tracking\.id, proposalItemId, group\)/);
  assert.match(workspace, /israa_group_number: group/);
  assert.match(workspace, /class_group: effective\.class_group \|\| effective\.group \|\| `קבוצה \\${group}`/);
  assert.match(workspace, /saveIsraaActivityGroupDraft\(draftRef\.trackingId, draftRef\.proposalItemId, draftRef\.groupNumber, changes\)/);
  const fallback = fs.readFileSync(new URL('../frontend/src/screens/israa-management.js', import.meta.url), 'utf8');
  assert.match(fallback, /קבוצה \\${groupNumber} מתוך \\${quantity}/);
  assert.match(fallback, /saveIsraaActivityGroupDraft\(trackingId, proposalItemId, groupNumber/);
});

test('published activities leave the Israa activities table and remain only in the main activities table', () => {
  assert.match(workspace, /const privateRows = allIsraaActivities\.filter/);
  assert.match(workspace, /workspaceRows = \[\.\.\.drafts, \.\.\.privateRows\]/);
  assert.match(workspace, /sharedKeys\.has\(key\)/);
  const fallback = fs.readFileSync(new URL('../frontend/src/screens/israa-management.js', import.meta.url), 'utf8');
  assert.match(fallback, /if \(shared\.length\) return;/);
  assert.doesNotMatch(fallback, /israa-shared-badge">נמצא בפעילויות/);
});

test('Israa manual add uses the exact canonical activities form without hiding domain or funding fields', () => {
  assert.match(workspace, /button\.textContent !== '\+ הוספת פעילות'/);
  assert.match(workspace, /\[data-activities-add-btn\]/);
  assert.match(workspace, /const workspaceUi = sharedUi;/);
  assert.doesNotMatch(workspace, /decorateManualAddModal/);
  assert.doesNotMatch(workspace, /domain\.value = 'E'/);
  assert.doesNotMatch(workspace, /field\.hidden = true/);
  assert.doesNotMatch(workspace, /pointerEvents = 'none'/);
  assert.match(activities, /name=\"activity_domain\"/);
  assert.match(activities, /funding_source_records/);
  assert.match(activities, /content: addActivityModalHtml\(state\?\.clientSettings \|\| \{\}, state\.activityPeriodTab\)/);
  assert.doesNotMatch(workspace, /\[data-activities-add-btn\]\{display:none!important\}/);
});

test('manual add button decoration is idempotent so MutationObserver cannot loop on text changes', () => {
  assert.match(workspace, /button\.dataset\.israaManualAddDecorated === 'yes'/);
  assert.match(workspace, /button\.dataset\.israaManualAddDecorated = 'yes'/);
  assert.match(workspace, /if \(button\.textContent !== '\+ הוספת פעילות'\) button\.textContent = '\+ הוספת פעילות'/);
});

test('selecting an Israa proposal activity no longer reloads or closes the page', () => {
  assert.match(proposalItems, /save_israa_activity_draft/);
  assert.match(proposalItems, /selectButton\.textContent = 'כבר בפעילויות'/);
  assert.match(proposalItems, /israa-activities-changed/);
  assert.doesNotMatch(proposalItems, /window\.location\.reload/);
  assert.doesNotMatch(proposalItems, /REOPEN_ACTIVITIES_KEY/);
});

test('workspace loads lazily with a fresh module and cache version', () => {
  assert.match(proposalItems, /import\('\.\/israa-activities-main-workspace\.js\?v=20260926-v5'\)/);
  assert.match(proposalItems, /data-israa-tab=\"activities\"/);
  assert.match(proposalItems, /ensureMainActivitiesWorkspace\(\)/);
  assert.doesNotMatch(bootstrap, /israa-activities-main-workspace/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1781;/);
});