import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { COORDINATION_STATUS } from '../frontend/src/activity-coordination/domain.js';
import {
  STATUS_PRESENTATION,
  bindCoordinationWorkspace,
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
  assert.deepEqual(coordinationMissingDetails(missing), ['תאריכי פעילות', 'שעת התחלה', 'שעת סיום', 'מייל']);
  const html = renderCoordinationWorkspace({ items: [missing] }, { canManage: true });
  assert.match(html, /⚠<\/span> חסרים: תאריכי פעילות, שעת התחלה, שעת סיום, מייל/);
  assert.equal((html.match(/תאריכי פעילות/g) || []).length, 1);
  assert.doesNotMatch(html, /ללא|לא צוין|coordination-kpi|data-coordination-filter/);
});

test('workspace keeps missing on one side and ready plus sent together on the other side', () => {
  const school = { school_id: 2 };
  const snapshot = { school: { name: 'אלון' }, program: { name: 'רובוטיקה' }, contact: {} };
  const missing = { ...readyItem, activity_row_id: 'missing', status: COORDINATION_STATUS.MISSING_DETAILS, readiness: { ready: false, missing: ['contact'] }, activity: school, snapshot };
  const ready = { ...readyItem, activity_row_id: 'ready', activity: school, snapshot, recipient_email: 'school@example.com' };
  const sent = { ...readyItem, activity_row_id: 'sent', status: COORDINATION_STATUS.SENT, activity: school, snapshot, recipient_email: 'school@example.com' };
  const context = { items: [missing, ready, sent] };
  const html = renderCoordinationWorkspace(context, { canManage: true });

  const dom = new JSDOM(`<main>${html}</main>`);
  const root = dom.window.document.querySelector('.coordination-workspace');
  const columns = root.querySelector('.coordination-workspace__columns');
  assert.ok(columns);
  assert.equal(columns.children.length, 2);
  assert.ok(columns.children[0].classList.contains('coordination-workspace__missing'));
  assert.ok(columns.children[1].classList.contains('coordination-workspace__right'));
  assert.equal(columns.children[0].querySelector('[data-coordination-section="missing_details"]') !== null, true);
  assert.equal(columns.children[0].querySelector('[data-coordination-section="ready"]'), null);
  assert.equal(columns.children[1].querySelector('[data-coordination-section="ready"]') !== null, true);
  assert.equal(columns.children[1].querySelector('[data-coordination-section="sent"]') !== null, true);

  assert.equal((html.match(/data-coordination-section=/g) || []).length, 3);
  assert.equal((html.match(/data-coordination-school-select/g) || []).length, 1);
  assert.equal((html.match(/data-coordination-item/g) || []).length, 1);
  assert.match(columns.children[1].innerHTML, /data-coordination-select-ready[\s\S]*data-coordination-prepare/);
  assert.match(html, />סמן מוכנים<\/button>/);
  assert.match(html, />שליחת מוכנים<\/button>/);
  assert.doesNotMatch(html, /בחר את כל המוכנים לשליחה|הכנת מיילים נבחרים/);

  bindCoordinationWorkspace(root, context);
  root.querySelector('[data-coordination-select-ready]').click();
  assert.deepEqual(Array.from(root.querySelectorAll('[data-coordination-item]:checked'), (input) => input.value), ['ready']);
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

test('single-activity modal omits missing fields and presents every missing value once', () => {
  const missing = {
    ...readyItem,
    status: COORDINATION_STATUS.MISSING_DETAILS,
    readiness: { ready: false, missing: ['grade_class', 'contact'] },
    technical_blocker: 'חסרה כתובת מייל פעילה לנמען',
    activity: {},
    snapshot: { school: { name: 'אלון' }, program: { name: 'רובוטיקה', meetings: [] }, contact: {} }
  };
  const html = renderCoordinationActivityModal(missing);
  assert.match(html, /⚠<\/span> חסרים: כיתה \/ קבוצה, איש קשר, מייל/);
  assert.equal((html.match(/כיתה \/ קבוצה/g) || []).length, 1);
  assert.equal((html.match(/איש קשר/g) || []).length, 1);
  assert.doesNotMatch(html, /<dd>—<\/dd>|ללא|data-coordination-modal-prepare/);
});
