import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync(new URL('../frontend/src/israa-activities-main-workspace.js', import.meta.url), 'utf8');
const proposalItems = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const serviceWorker = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('Israa activities tab reuses the canonical main activities screen', () => {
  assert.match(workspace, /import \{ activitiesScreen \} from '\.\/screens\/activities\.js'/);
  assert.match(workspace, /activitiesScreen\.render\(data, \{ state: workspaceState \}\)/);
  assert.match(workspace, /activitiesScreen\.bind\(\{/);
  assert.match(workspace, /PANEL_SELECTOR = '\.israa-mgmt \.israa-activities-panel'/);
});

test('Israa workspace stays scoped and uses the dedicated E write path', () => {
  assert.match(workspace, /api\.saveIsraaActivityDraft/);
  assert.match(workspace, /api\.updateIsraaSharedActivity/);
  assert.match(workspace, /api\.shareIsraaActivity/);
  assert.match(workspace, /remove_israa_activity_draft/);
  assert.match(workspace, /activity_domain: 'E'/);
  assert.match(workspace, /can_edit_direct: 'yes'/);
  assert.match(workspace, /can_add_activity: 'no'/);
  assert.match(workspace, /israa_workspace_action_not_allowed/);
});

test('selecting an Israa proposal activity no longer reloads or closes the page', () => {
  assert.match(proposalItems, /save_israa_activity_draft/);
  assert.match(proposalItems, /selectButton\.textContent = 'כבר בפעילויות'/);
  assert.match(proposalItems, /israa-activities-changed/);
  assert.doesNotMatch(proposalItems, /window\.location\.reload/);
  assert.doesNotMatch(proposalItems, /REOPEN_ACTIVITIES_KEY/);
});

test('workspace is loaded by the app and cache is bumped', () => {
  assert.match(bootstrap, /israa-activities-main-workspace\.js\?v=20260824-v1/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1614;/);
});
