import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CustomEvent = dom.window.CustomEvent;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
});
Object.defineProperty(globalThis, 'sessionStorage', {
  value: dom.window.sessionStorage,
  configurable: true
});
Object.defineProperty(globalThis, 'localStorage', {
  value: dom.window.localStorage,
  configurable: true
});

const {
  applyActivityCatalogSelectionToAddForm,
  bindAddActivitySessionCountSync,
  syncSessionDateRows
} = await import('../frontend/src/screens/activities.js');

function createForm(type = 'course', sessions = '1') {
  document.body.innerHTML = `
    <form>
      <select name="activity_type" data-add-activity-type>
        <option value="${type}" selected>${type}</option>
      </select>
      <input name="activity_no" data-add-activity-no>
      <label data-field-sessions><input name="sessions" data-add-sessions value="${sessions}"></label>
      <label data-field-one-day-date style="display:none"><input name="one_day_date" type="date"></label>
      <label data-field-start-date><input name="start_date" type="date" value="2026-09-01"></label>
      <label data-field-end-date><input name="end_date" type="date"></label>
      <div data-add-date-rows-wrap><div data-add-date-rows></div></div>
    </form>
  `;
  return document.querySelector('form');
}

function rowCount(form) {
  return form.querySelectorAll('input[data-add-session-date]').length;
}

test('course 6089 autofills 11 sessions and creates 11 date rows', () => {
  const form = createForm('course');
  applyActivityCatalogSelectionToAddForm(
    form,
    { gefen_number: '6089', activity_no: '6089', meetings_count: 11 },
    'course'
  );
  syncSessionDateRows(form);

  assert.equal(form.querySelector('[data-add-activity-no]').value, '6089');
  assert.equal(form.querySelector('[data-add-sessions]').value, '11');
  assert.equal(rowCount(form), 11);
  assert.notEqual(form.querySelector('[data-field-sessions]').style.display, 'none');
});

test('switching from an 11-session course to an 8-session course shrinks date rows', () => {
  const form = createForm('course');
  applyActivityCatalogSelectionToAddForm(form, { activity_no: '6089', meetings_count: 11 }, 'course');
  syncSessionDateRows(form);
  applyActivityCatalogSelectionToAddForm(form, { activity_no: '9545', meetings_count: 8 }, 'course');
  syncSessionDateRows(form);

  assert.equal(form.querySelector('[data-add-activity-no]').value, '9545');
  assert.equal(form.querySelector('[data-add-sessions]').value, '8');
  assert.equal(rowCount(form), 8);
});

test('switching from an 8-session course to an 11-session course adds date rows', () => {
  const form = createForm('course');
  applyActivityCatalogSelectionToAddForm(form, { activity_no: '9545', meetings_count: 8 }, 'course');
  syncSessionDateRows(form);
  applyActivityCatalogSelectionToAddForm(form, { gefen_number: '6089', activity_no: 'legacy-6089', meetings_count: 11 }, 'course');
  syncSessionDateRows(form);

  assert.equal(form.querySelector('[data-add-activity-no]').value, '6089');
  assert.equal(form.querySelector('[data-add-sessions]').value, '11');
  assert.equal(rowCount(form), 11);
});

test('manual session count change triggers date-row synchronization', () => {
  const form = createForm('course', '11');
  syncSessionDateRows(form);
  bindAddActivitySessionCountSync(form);
  const input = form.querySelector('[data-add-sessions]');
  input.value = '6';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));

  assert.equal(rowCount(form), 6);
});

test('workshop hides sessions and remains a single-day activity', () => {
  const form = createForm('workshop', '9');
  syncSessionDateRows(form);

  assert.equal(form.querySelector('[data-add-sessions]').value, '1');
  assert.equal(form.querySelector('[data-add-sessions]').disabled, true);
  assert.equal(form.querySelector('[data-field-sessions]').style.display, 'none');
  assert.equal(form.querySelector('[data-add-date-rows-wrap]').style.display, 'none');
  assert.equal(rowCount(form), 1);
});

test('missing meetings_count keeps the existing manual session value without crashing', () => {
  const form = createForm('course', '4');
  applyActivityCatalogSelectionToAddForm(form, { activity_no: '9999' }, 'course');
  syncSessionDateRows(form);

  assert.equal(form.querySelector('[data-add-sessions]').value, '4');
  assert.equal(rowCount(form), 4);
});
