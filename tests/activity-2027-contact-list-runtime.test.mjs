import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installActivity2027ContactListRuntime, isPrivateIsraaActivity } from '../frontend/src/activity-2027-contact-list-runtime.js';

test('contact runtime wraps both activities and allActivities so work schedule rows are enriched', async () => {
  const activitiesResult = { rows: [{ activity_season: 'regular', row_id: 'A-1' }] };
  const allActivitiesResult = { rows: [{ activity_season: 'regular', row_id: 'A-2' }] };
  const targetApi = {
    activities: async () => activitiesResult,
    allActivities: async () => allActivitiesResult
  };
  const originalActivities = targetApi.activities;
  const originalAllActivities = targetApi.allActivities;

  assert.equal(installActivity2027ContactListRuntime(targetApi), true);
  assert.notEqual(targetApi.activities, originalActivities);
  assert.notEqual(targetApi.allActivities, originalAllActivities);
  assert.deepEqual(await targetApi.activities(), activitiesResult);
  assert.deepEqual(await targetApi.allActivities(), allActivitiesResult);
  assert.equal(installActivity2027ContactListRuntime(targetApi), false);
});

test('private Israa rows stay out of shared activity lists until explicitly published', () => {
  assert.equal(isPrivateIsraaActivity({ activity_domain: 'E', israa_shared: false }), true);
  assert.equal(isPrivateIsraaActivity({ activity_domain: 'E', israa_shared: 'false' }), true);
  assert.equal(isPrivateIsraaActivity({ activity_domain: 'E', israa_shared: true }), false);
  assert.equal(isPrivateIsraaActivity({ activity_domain: 'Y', israa_shared: false }), false);
  assert.equal(isPrivateIsraaActivity({ activity_domain: '', israa_shared: false }), false);
});
