import test from 'node:test';
import assert from 'node:assert/strict';
import { translateSchedulingDraftRpcErrorMessage } from '../frontend/src/supabase-client.js';

test('draft overlap error is translated to Hebrew', () => {
  assert.equal(
    translateSchedulingDraftRpcErrorMessage('scheduling_conflict_detected'),
    'קיימת חפיפה עם שיבוץ אחר של המדריך'
  );
});

test('draft transition error is translated to Hebrew', () => {
  assert.equal(
    translateSchedulingDraftRpcErrorMessage('error: scheduling_transition_insufficient'),
    'אין מספיק זמן מעבר בין הפעילויות'
  );
});

test('unknown draft errors keep their original message', () => {
  assert.equal(
    translateSchedulingDraftRpcErrorMessage('scheduling_home_route_unverified'),
    'scheduling_home_route_unverified'
  );
});
