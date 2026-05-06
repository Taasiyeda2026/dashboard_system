import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const BIND_MODULE = new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url).href;

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.MouseEvent = dom.window.MouseEvent;
  global.AbortController = dom.window.AbortController;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.setTimeout = global.setTimeout || dom.window.setTimeout.bind(dom.window);
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEditRoot({ canDirectEdit = false } = {}) {
  const root = document.createElement('div');
  root.innerHTML = `
    <form data-drawer-form data-source-sheet="activities" data-row-id="ACT-1" data-can-direct-edit="${canDirectEdit ? 'yes' : 'no'}">
      <div data-mode="view"></div>
      <div data-mode="edit" hidden></div>
      <div data-edit-actions hidden></div>
      <button type="button" data-action="start-edit">עריכה</button>
      <input name="activity_name" value="שם ישן">
      <input name="date_1" data-meeting-idx="0" value="2026-05-01">
      <div data-meeting-dates-edit><div class="activity-drawer__date-card"><input name="meeting_date_0" data-meeting-idx="0" value="2026-05-01"></div></div>
      <button type="button" data-action="save-edit">שמור</button>
      <div class="ds-activity-edit-status"></div>
    </form>`;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  setupDom();
});

test('activity edit form blocks empty changes before submit', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!Object\.keys\(changes\)\.length\) \{[\s\S]*לא זוהו שינויים לשמירה[\s\S]*return;/);
});

test('user with can_request_edit only calls submitEditRequest and not saveActivity', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const calls = [];
  const root = buildEditRoot({ canDirectEdit: false });
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (...args) => calls.push(['saveActivity', ...args]),
      submitEditRequest: async (...args) => calls.push(['submitEditRequest', ...args])
    },
    clearScreenDataCache: () => calls.push(['clearScreenDataCache'])
  });

  form.querySelector('[name="activity_name"]').value = 'שם חדש';
  form.querySelector('[data-action="save-edit"]').click();
  await wait(20);

  assert.equal(calls.some(([name]) => name === 'saveActivity'), false);
  const submitCall = calls.find(([name]) => name === 'submitEditRequest');
  assert.ok(submitCall, 'submitEditRequest should be called');
  assert.equal(submitCall[1], 'ACT-1');
  assert.deepEqual(submitCall[2], { activity_name: 'שם חדש' });
  assert.equal(form.querySelector('[name="activity_name"]').value, 'שם ישן');
  assert.match(form.querySelector('.ds-activity-edit-status').textContent, /בקשת העריכה נשלחה לאישור/);
});

test('user with can_edit_direct calls saveActivity and not submitEditRequest', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const calls = [];
  const root = buildEditRoot({ canDirectEdit: true });
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (...args) => calls.push(['saveActivity', ...args]),
      submitEditRequest: async (...args) => calls.push(['submitEditRequest', ...args])
    }
  });

  form.querySelector('[name="activity_name"]').value = 'שם חדש';
  form.querySelector('[data-action="save-edit"]').click();
  await wait(20);

  assert.equal(calls.some(([name]) => name === 'submitEditRequest'), false);
  const saveCall = calls.find(([name]) => name === 'saveActivity');
  assert.ok(saveCall, 'saveActivity should be called');
  assert.deepEqual(saveCall[1], {
    source_sheet: 'activities',
    source_row_id: 'ACT-1',
    changes: { activity_name: 'שם חדש' }
  });
});

test('approving removes request immediately from pending filter', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/edit-requests.js', import.meta.url), 'utf8');
  assert.match(source, /const status = action === 'approve' \? 'approved' : 'rejected';/);
  assert.match(source, /if \(activeFilter === 'pending'\) \{\s*groupEl\.remove\(\);\s*\}/);
});

test('reviewEditRequest approval updates activities and then edit_requests', async () => {
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /if \(nextStatus === 'approved'\) \{[\s\S]*\.from\('activities'\)[\s\S]*\.update\(requestedValues\)[\s\S]*\.eq\('row_id', sourceRowId\);[\s\S]*\}[\s\S]*\.from\('edit_requests'\)[\s\S]*status: nextStatus/);
});

test('reviewEditRequest rejection updates only edit_requests status', async () => {
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /if \(nextStatus === 'approved'\) \{/);
  assert.doesNotMatch(source, /if \(nextStatus === 'rejected'\) \{[\s\S]*\.from\('activities'\)/);
  assert.match(source, /\.from\('edit_requests'\)[\s\S]*status: nextStatus/);
});

test('activity rows expose requester-facing edit status labels', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /if \(status === 'pending'\) return 'בקשת עריכה ממתינה';/);
  assert.match(source, /if \(status === 'approved'\) return 'בקשת העריכה אושרה';/);
  assert.match(source, /if \(status === 'rejected'\) return 'בקשת העריכה נדחתה';/);
});

test('add activity UI remains gated by can_add_activity', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /const canAddActivity = !!state\?\.user\?\.can_add_activity;/);
  assert.match(source, /if \(canAddActivity && ui && addBtn\) \{/);
  assert.match(source, /await api\.addActivity\(payload\);/);
});
