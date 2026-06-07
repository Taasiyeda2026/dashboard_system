import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editRequestsScreen } from '../frontend/src/screens/edit-requests.js';

test('edit requests screen hides empty requests and keeps non-empty field rows', () => {
  const html = editRequestsScreen.render({
    canReview: true,
    groups: [
      {
        request_id: 'REQ-EMPTY',
        status: 'pending',
        fields: []
      },
      {
        request_id: 'REQ-OK',
        status: 'pending',
        fields: [{ field_name: 'notes', old_value: 'ישן', new_value: 'חדש' }]
      }
    ]
  });

  assert.doesNotMatch(html, /REQ-EMPTY/);
  assert.match(html, /REQ-OK/);
  assert.match(html, /הערות/);
  assert.match(html, /ישן/);
  assert.match(html, /חדש/);
  assert.match(html, /בקשות פתוחות \(1\)/);
});


test('edit requests screen hides review actions for non-reviewers', () => {
  const html = editRequestsScreen.render({
    canReview: false,
    groups: [
      {
        request_id: 'REQ-MINE',
        status: 'pending',
        fields: [{ field_name: 'notes', old_value: 'ישן', new_value: 'חדש' }]
      }
    ]
  });

  assert.match(html, /בקשות פעילות שהגשת/);
  assert.doesNotMatch(html, /data-action="approve"/);
  assert.doesNotMatch(html, /data-action="reject"/);
});
