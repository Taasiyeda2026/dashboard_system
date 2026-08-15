import test from 'node:test';
import assert from 'node:assert/strict';
import { COORDINATION_STATUS } from '../frontend/src/activity-coordination/domain.js';
import { coordinationDrawerActionHtml, coordinationStatusHtml } from '../frontend/src/activity-coordination/view.js';

const readyItem = { activity_row_id: '7', readiness: { ready: true }, status: COORDINATION_STATUS.READY };

test('coordination action changes only after a successful sent fingerprint or relevant data change', () => {
  assert.match(coordinationDrawerActionHtml(readyItem), />אישור תיאום</);
  assert.match(coordinationStatusHtml(readyItem, { action: true }), />אישור תיאום</);

  const sent = { ...readyItem, status: COORDINATION_STATUS.SENT };
  assert.match(coordinationDrawerActionHtml(sent), /✓<\/span> אישור תיאום נשלח/);
  assert.doesNotMatch(coordinationDrawerActionHtml(sent), /<button/);
  assert.doesNotMatch(coordinationStatusHtml(sent, { action: true }), /data-coordination-send/);

  const changed = { ...readyItem, status: COORDINATION_STATUS.CHANGED_SINCE_SENT };
  assert.match(coordinationDrawerActionHtml(changed), />שליחת אישור מעודכן</);
  assert.match(coordinationStatusHtml(changed, { action: true }), />שליחת אישור מעודכן</);
  assert.doesNotMatch(coordinationStatusHtml(changed, { action: true }), /שליחה מחדש/);
});
