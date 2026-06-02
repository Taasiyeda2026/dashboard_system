import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const BIND_FORM_FILE = new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url);
const MAIN_FILE = new URL('../frontend/src/main.js', import.meta.url);
const EDIT_REQUESTS_FILE = new URL('../frontend/src/screens/edit-requests.js', import.meta.url);
const EXCEPTIONS_FILE = new URL('../frontend/src/screens/exceptions.js', import.meta.url);

test('edit request submission keeps persistent pending status with request id', async () => {
  const source = await readFile(BIND_FORM_FILE, 'utf8');
  assert.match(source, /הבקשה נשלחה לאישור\. סטטוס: ממתין לאישור/);
  assert.match(source, /lastEditRequestId/);
  assert.match(source, /requestResult\?\.request_id/);
});

test('admin edit request badge and review permission include can_review_requests', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const mainSource = await readFile(MAIN_FILE, 'utf8');
  assert.match(apiSource, /canReviewEditRequestsUser/);
  assert.match(apiSource, /permissionFlagYes\(user\?\.can_review_requests\)/);
  assert.match(apiSource, /\.in\('status', openStatuses\)/);
  assert.match(mainSource, /ds-nav-count-badge--edit-requests/);
  assert.match(mainSource, /app:edit-requests-updated/);
});

test('review approval applies requested values to activities and refreshes requests', async () => {
  const apiSource = await readFile(API_FILE, 'utf8');
  const screenSource = await readFile(EDIT_REQUESTS_FILE, 'utf8');
  assert.match(apiSource, /\.from\('activities'\)\s*\.update\(sanitizedRequestedValues\)/);
  assert.match(apiSource, /edit_request_already_reviewed/);
  assert.match(apiSource, /activity_not_found_or_forbidden/);
  assert.match(screenSource, /הבקשה אושרה והשינוי נשמר בפעילויות/);
  assert.match(screenSource, /app:edit-requests-updated/);
});

test('exceptions save flow explains resolved exception removal and offers activities navigation', async () => {
  const source = await readFile(EXCEPTIONS_FILE, 'utf8');
  assert.match(source, /הפעילות נשמרה בהצלחה\. החריגה תוקנה ולכן הפעילות הוסרה ממסך החריגות/);
  assert.match(source, /data-exception-go-activities/);
  assert.match(source, /route: 'activities'/);
});
