import test from 'node:test';
import assert from 'node:assert/strict';
import { COORDINATION_STATUS } from '../frontend/src/activity-coordination/domain.js';
import {
  STATUS_PRESENTATION,
  coordinationDrawerActionHtml,
  coordinationMissingDetails,
  coordinationStatusHtml,
  coordinationUiStatus,
  renderCoordinationActivityModal,
  renderCoordinationWorkspace
} from '../frontend/src/activity-coordination/view.js';

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

test('workspace exposes only the three requested UI states and lists concrete missing details', () => {
  assert.deepEqual(Object.values(STATUS_PRESENTATION).map(({ label }) => label), ['נשלח', 'חסרים פרטים', 'מוכן לשליחה']);
  const missing = {
    ...readyItem,
    status: COORDINATION_STATUS.MISSING_DETAILS,
    readiness: { ready: false, missing: ['date_1', 'start_time', 'end_time'] },
    technical_blocker: 'חסרה כתובת מייל פעילה לנמען',
    activity: { school_id: 2 },
    snapshot: { school: { name: 'אלון' }, program: { name: 'רובוטיקה' }, contact: {} }
  };
  assert.deepEqual(coordinationMissingDetails(missing), ['חסרים תאריכי פעילות', 'חסרה שעת התחלה', 'חסרה שעת סיום', 'חסרה כתובת מייל פעילה לנמען']);
  const html = renderCoordinationWorkspace({ items: [missing] }, { canManage: true });
  assert.match(html, /חסרים תאריכי פעילות/);
  assert.match(html, /חסרה כתובת מייל פעילה לנמען/);
  assert.doesNotMatch(html, /coordination-kpi|data-coordination-filter/);
});

test('changed activity remains sent and single-activity modal contains no workspace controls', () => {
  const changed = {
    ...readyItem,
    status: COORDINATION_STATUS.CHANGED_SINCE_SENT,
    activity: { grade: 'ח׳', class_group: 'א׳' },
    snapshot: {
      school: { name: 'אלון' }, program: { name: 'רובוטיקה', meetings: [{ date: '01/09/2026', hours: '08:00–09:00' }] },
      contact: { name: 'נועה' }
    },
    recipient_email: 'noa@example.com', cc_email: 'manager@example.com'
  };
  assert.equal(coordinationUiStatus(changed), COORDINATION_STATUS.SENT);
  const html = renderCoordinationActivityModal(changed);
  assert.match(html, /נשלח/);
  assert.match(html, /הפרטים השתנו מאז השליחה/);
  assert.match(html, /שליחת אישור מעודכן/);
  assert.match(html, /data-activity-id="7"/);
  assert.doesNotMatch(html, /coordination-workspace|coordination-kpi|data-coordination-filter|data-coordination-school-select/);
});
