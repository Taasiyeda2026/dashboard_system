import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const ACTIVITIES_FILE = new URL('../frontend/src/screens/activities.js', import.meta.url);
const EDIT_REQUESTS_FILE = new URL('../frontend/src/screens/edit-requests.js', import.meta.url);

test('activity roles split direct managers, request-only managers, and read-only users', async () => {
  const apiSource = await fs.readFile(API_FILE, 'utf8');
  const activitiesSource = await fs.readFile(ACTIVITIES_FILE, 'utf8');

  assert.match(apiSource, /ACTIVITY_DIRECT_MANAGE_ROLES = new Set\(\['admin', 'operation_manager'\]\)/);
  assert.match(apiSource, /ACTIVITY_REQUEST_ROLES = new Set\(\['activities_manager', 'instructor_manager', 'business_development_manager'\]\)/);
  assert.match(apiSource, /domain_manager: \{ can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no'/);
  assert.match(apiSource, /finance: \{ can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no'/);
  assert.match(apiSource, /instructor: \{ can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no'/);
  assert.match(activitiesSource, /function canDirectManageActivities\(state\)/);
  assert.match(activitiesSource, /function canOpenCreateActivity\(state\)/);
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
  assert.match(editRequestsSource, /סוג בקשה/);
  assert.match(editRequestsSource, /פרטי הפעילות המבוקשת/);
});
