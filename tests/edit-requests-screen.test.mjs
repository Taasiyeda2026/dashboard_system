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
  assert.match(html, /בקשות \(1\)/);
});
