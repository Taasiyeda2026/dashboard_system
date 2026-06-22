import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const BIND_MODULE = new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url).href;

function makeStorage(){ const m=new Map(); return {getItem:(k)=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:(k)=>m.delete(k),clear:()=>m.clear(),key:(i)=>Array.from(m.keys())[i]||null,get length(){return m.size;}}; }

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Event = dom.window.Event;
  global.MouseEvent = dom.window.MouseEvent;
  global.AbortController = dom.window.AbortController;
  global.localStorage = makeStorage();
  global.sessionStorage = makeStorage();
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  global.setTimeout = global.setTimeout || dom.window.setTimeout.bind(dom.window);
}

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEditRoot({ canDirectEdit = false, canRequestEdit = !canDirectEdit } = {}) {
  const root = document.createElement('div');
  root.innerHTML = `
    <form data-drawer-form data-source-sheet="activities" data-row-id="ACT-1" data-can-direct-edit="${canDirectEdit ? 'yes' : 'no'}" data-can-request-edit="${canRequestEdit ? 'yes' : 'no'}">
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
  assert.deepEqual(submitCall[1], {
    source_sheet: 'activities',
    source_row_id: 'ACT-1',
    changes: { activity_name: 'שם חדש' }
  });
  assert.equal(form.querySelector('[name="activity_name"]').value, 'שם ישן');
  assert.match(form.querySelector('.ds-activity-edit-status').textContent, /הבקשה נשלחה לאישור/);
});

test('user with can_edit_direct calls saveActivity and not submitEditRequest', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const calls = [];
  const root = buildEditRoot({ canDirectEdit: true });
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (...args) => {
        calls.push(['saveActivity', ...args]);
        return { ok: true, row: { row_id: 'ACT-1', activity_name: 'שם חדש', date_1: '2026-05-01' } };
      },
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

test('activity edit form blocks duplicate save clicks while first save is in flight', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  let resolveSave;
  const calls = [];
  const root = buildEditRoot({ canDirectEdit: true });
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (...args) => {
        calls.push(['saveActivity', ...args]);
        return new Promise((resolve) => { resolveSave = resolve; });
      },
      submitEditRequest: async (...args) => calls.push(['submitEditRequest', ...args])
    }
  });

  form.querySelector('[name="activity_name"]').value = 'שם חדש';
  const saveBtn = form.querySelector('[data-action="save-edit"]');
  saveBtn.click();
  saveBtn.click();
  await wait(20);
  assert.equal(calls.filter(([name]) => name === 'saveActivity').length, 1);
  resolveSave({ ok: true, row: { row_id: 'ACT-1', activity_name: 'שם חדש', date_1: '2026-05-01' } });
  await wait(20);
});

test('approving removes request immediately from pending filter', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/edit-requests.js', import.meta.url), 'utf8');
  assert.match(source, /const status = action === 'approve' \? 'approved' : 'rejected';/);
  assert.match(source, /if \(activeFilter === 'pending'\) \{\s*groupEl\.remove\(\);\s*\}/);
});

test('reviewEditRequest approval updates activities and then edit_requests', async () => {
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /if \(nextStatus === 'approved'\) \{[\s\S]*\.from\('activities'\)[\s\S]*\.update\([\s\S]*\)[\s\S]*\.eq\('row_id', sourceRowId\);[\s\S]*\}[\s\S]*\.from\('edit_requests'\)[\s\S]*status: nextStatus/);
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

function buildMultiMeetingEditRoot() {
  const root = document.createElement('div');
  root.innerHTML = `
    <form data-drawer-form data-source-sheet="activities" data-row-id="ACT-2" data-can-direct-edit="yes" data-can-request-edit="no">
      <button type="button" data-action="start-edit">עריכה</button>
      <input name="activity_name" value="קורס בדיקה">
      <div data-meeting-dates-edit>
        <div class="activity-drawer__date-card"><input name="meeting_date_0" data-meeting-idx="0" value="2026-05-01"></div>
        <div class="activity-drawer__date-card"><input name="meeting_date_1" data-meeting-idx="1" value="2026-05-08"></div>
        <div class="activity-drawer__date-card"><input name="meeting_date_2" data-meeting-idx="2" value=""></div>
      </div>
      <button type="button" data-action="save-edit">שמור</button>
      <div class="ds-activity-edit-status"></div>
    </form>`;
  document.body.appendChild(root);
  return root;
}

test('activity edit form maps meeting_date_N changes without collapsing empty meeting slots', async () => {
  const bindSource = await fs.readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8');
  assert.match(bindSource, /readMeetingDatePickerValues/);
  assert.match(bindSource, /collectMeetingDateChanges/);
  assert.doesNotMatch(bindSource, /\.filter\(\(value\) => value\)/);
  assert.match(bindSource, /changes\[`meeting_date_\$\{i\}`\] = current \? current : null/);
  assert.match(bindSource, /verifyMeetingDateChangesApplied/);
  assert.match(bindSource, /captureFormInitialValues\(form\)/);
});

test('direct save sends meeting_date changes and verifies returned row before success', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const calls = [];
  const root = buildMultiMeetingEditRoot();
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          row: {
            row_id: 'ACT-2',
            date_1: '2026-05-01',
            date_2: '2026-05-15',
            date_3: ''
          }
        };
      }
    }
  });

  form.querySelector('[data-action="start-edit"]').click();
  form.querySelector('[name="meeting_date_1"]').value = '2026-05-15';
  form.querySelector('[data-action="save-edit"]').click();
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].changes.meeting_date_1, '2026-05-15');
  assert.match(form.querySelector('.ds-activity-edit-status').textContent, /נשמרה בהצלחה/);
});

test('clearing a meeting date sends null in changes', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const calls = [];
  const root = buildMultiMeetingEditRoot();
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          row: {
            row_id: 'ACT-2',
            date_1: '2026-05-01',
            date_2: null,
            date_3: ''
          }
        };
      }
    }
  });

  form.querySelector('[data-action="start-edit"]').click();
  form.querySelector('[name="meeting_date_1"]').value = '';
  form.querySelector('[data-action="save-edit"]').click();
  await wait(30);

  assert.equal(calls[0].changes.meeting_date_1, null);
});

test('direct save shows error when returned row date does not match sent value', async () => {
  const { bindActivityEditForm } = await import(`${BIND_MODULE}?bust=${Date.now()}-${Math.random()}`);
  const root = buildMultiMeetingEditRoot();
  const form = root.querySelector('[data-drawer-form]');

  bindActivityEditForm(root, {
    api: {
      saveActivity: async () => ({
        ok: true,
        row: {
          row_id: 'ACT-2',
          date_1: '2026-05-01',
          date_2: '2026-05-08',
          date_3: ''
        }
      })
    }
  });

  form.querySelector('[data-action="start-edit"]').click();
  form.querySelector('[name="meeting_date_1"]').value = '2026-05-15';
  form.querySelector('[data-action="save-edit"]').click();
  await wait(30);

  const statusText = form.querySelector('.ds-activity-edit-status').textContent || '';
  assert.doesNotMatch(statusText, /נשמרה בהצלחה/);
  assert.match(statusText, /לא נשמר בפועל|שגיאה|⚠️/);
});

test('submitEditRequest preserves null meeting date deletions', async () => {
  const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /isDateField[\s\S]*acc\[key\] = null/);
  assert.match(source, /mapMeetingDateFieldNamesToSupabase\(reducedChanges\)/);
});

test('patchDrawerDatesSection refreshes edit inputs and form initial values', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');
  assert.match(source, /editGrid\.querySelector\(`input\[data-meeting-idx="\$\{index\}"\]`\)/);
  assert.match(source, /form\._refreshInitialValues/);
});
