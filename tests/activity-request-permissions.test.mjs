import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { canAddActivityDirect, canEditDirect, canRequestEdit } from '../frontend/src/permissions.js';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const ACTIVITIES_FILE = new URL('../frontend/src/screens/activities.js', import.meta.url);
const EDIT_REQUESTS_FILE = new URL('../frontend/src/screens/edit-requests.js', import.meta.url);

test('activity capabilities use permission helpers and canonical permissions JSON', async () => {
  const apiSource = await fs.readFile(API_FILE, 'utf8');
  const activitiesSource = await fs.readFile(ACTIVITIES_FILE, 'utf8');

  const parentPermission = { view_activities: 'yes' };
  assert.equal(canEditDirect({ permissions: { ...parentPermission, can_edit_direct: 'yes' } }), true);
  assert.equal(canRequestEdit({ permissions: { ...parentPermission, can_request_edit: 'yes' } }), true);
  assert.equal(canAddActivityDirect({ permissions: { ...parentPermission, can_add_activity: 'yes' } }), true);
  assert.equal(canEditDirect({ permissions: { can_edit_direct: 'yes' } }), false);
  assert.equal(canRequestEdit({ permissions: { view_activities: 'yes', can_request_edit: 'no' } }), false);
  assert.equal(canAddActivityDirect({ permissions: { view_activities: 'yes', can_add_activity: 'no' } }), false);

  assert.match(apiSource, /function canDirectManageActivitiesUser[\s\S]*return canEditDirect\(user\)/);
  assert.match(apiSource, /function canAddActivitiesUser[\s\S]*return canAddActivityDirect\(user\)/);
  assert.match(apiSource, /function canSubmitActivityRequestsUser[\s\S]*return canRequestEdit\(user\)/);
  assert.match(activitiesSource, /function canDirectManageActivities\(state\)[\s\S]*return canEditDirect\(state\?\.user\)/);
  assert.match(activitiesSource, /function canOpenCreateActivity\(state\)[\s\S]*canAddActivities\(state\) \|\| canRequestActivityCreate\(state\)/);
  assert.match(activitiesSource, /בקשה להוספת פעילות/);
  assert.match(activitiesSource, /submitCreateActivityRequest\(payload\)/);
});

test('create activity requests use edit_requests request_type and requested_payload', async () => {
  const apiSource = await fs.readFile(API_FILE, 'utf8');
  const editRequestsSource = await fs.readFile(EDIT_REQUESTS_FILE, 'utf8');

  assert.match(apiSource, /submitCreateActivityRequest: async/);
  assert.match(apiSource, /request_type: 'create_activity'/);
  assert.match(apiSource, /requested_payload: requestedPayload/);
  assert.match(apiSource, /status: 'pending'/);
  assert.match(apiSource, /requested_by_user_id/);
  assert.match(apiSource, /request_type: 'edit_activity'/);
  assert.match(apiSource, /normalizeEditRequestType/);
  assert.match(apiSource, /requestType === 'create_activity'/);
  assert.match(apiSource, /await upsertActivityToSupabase\(\{ activity: requestedPayload \}\)/);
  assert.match(editRequestsSource, /ds-er-card-kicker/);
  assert.match(editRequestsSource, /מה מבוקש לשנות\?/);
  assert.match(editRequestsSource, /פרטי הפעילות המבוקשת/);
  assert.match(editRequestsSource, /TECHNICAL_DISPLAY_FIELDS/);
});

test('activity mutation diagnostics read canonical permissions JSON instead of removed user columns', async () => {
  const apiSource = await fs.readFile(API_FILE, 'utf8');
  const start = apiSource.indexOf('async function buildActivityMutationAuthContext()');
  const end = apiSource.indexOf('\nfunction logActivityMutationDebug', start);
  const authContextSource = apiSource.slice(start, end);

  assert.match(authContextSource, /\.select\('user_id,role,permissions'\)/);
  assert.match(authContextSource, /parsePermissions\(userRow\?\.permissions\)/);
  assert.doesNotMatch(
    authContextSource,
    /\.select\([^\n]*(?:can_request_edit|can_request_edit_2|can_edit_direct|can_add_activity)/
  );
});
