import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { bindInstructorConstraintsModal, bindInstructorMatchingModal, instructorsScreen } from '../frontend/src/screens/instructors.js';
import { constraintsForm, matchingForm, profileHtml } from '../frontend/src/screens/instructor-workspace-ui.js';

function rows() {
  return [
    {
      emp_id: '1500', full_name: 'מדריך משובץ', active: 'yes', address: 'תל אביב',
      programs_count: 1, one_day_count: 0, has_activity_stats: true, activity_type_counts: { course: 1 }
    },
    {
      emp_id: '1501', full_name: 'מדריך לא משובץ', active: 'yes', address: '',
      programs_count: 0, one_day_count: 0, has_activity_stats: false, activity_type_counts: {}
    },
    {
      emp_id: '1502', full_name: 'מדריך לא פעיל', active: 'no', address: 'חיפה',
      programs_count: 0, one_day_count: 0, has_activity_stats: false, activity_type_counts: {}
    }
  ];
}

test('unified instructors screen includes active assigned and unassigned instructors', () => {
  const state = {};
  const html = instructorsScreen.render({ rows: rows(), scheduling: { loaded: true } }, { state });
  assert.match(html, /מדריך משובץ/);
  assert.match(html, /מדריך לא משובץ/);
  assert.doesNotMatch(html, /מדריך לא פעיל/);
  assert.match(html, /לא משובץ/);
  assert.match(html, /1 פעילים ללא כתובת/);
});

test('assignment filter can isolate unassigned instructors', () => {
  const state = { instructorsWorkspace: { q: '', active: 'yes', assignment: 'unassigned' } };
  const html = instructorsScreen.render({ rows: rows(), scheduling: { loaded: true } }, { state });
  assert.doesNotMatch(html, /מדריך משובץ/);
  assert.match(html, /מדריך לא משובץ/);
});

test('constraints edit action is rendered only when editing is allowed', () => {
  const row = { ...rows()[0], availability_rules: [], availability_exceptions: [], scheduling_profile: null, mobile: '0500000000' };
  const editable = profileHtml(row, [], true, true);
  const readonly = profileHtml(row, [], false, true);
  assert.match(editable, /data-edit-instructor-constraints/);
  assert.match(editable, /data-edit-instructor-contact/);
  assert.doesNotMatch(readonly, /data-edit-instructor-constraints/);
  assert.doesNotMatch(readonly, /data-edit-instructor-contact/);
});

test('profile opens from every card without requiring an existing assignment', () => {
  const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { url: 'http://localhost/' });
  const saved = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element, HTMLElement: globalThis.HTMLElement, requestAnimationFrame: globalThis.requestAnimationFrame };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.requestAnimationFrame = (callback) => callback();
  try {
    const root = document.getElementById('root');
    const state = { instructorsWorkspace: { q: '', active: 'yes', assignment: '' }, user: { role: 'admin' } };
    const data = { rows: rows(), detail_rows: [], scheduling: { loaded: true } };
    root.innerHTML = instructorsScreen.render(data, { state });
    let opened = 0;
    instructorsScreen.bind({
      root, data, state, rerender: () => {}, api: {},
      ui: { openDrawer: () => { opened += 1; }, closeDrawer: () => {} }
    });
    root.querySelector('[data-instructor-profile="1501"]').click();
    assert.equal(opened, 1);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

test('matching modal provides searchable tagged choices and saves exactly once from its footer', async () => {
  const row = { emp_id: '1500', scheduling_profile: { gender: 'female', instruction_languages: ['he'], course_restriction_mode: 'allow_only', course_ids: ['c1'], blocked_authorities: [], blocked_schools: [], matching_note: 'קיים' } };
  const dom = new JSDOM(`<section class="ds-modal ds-modal--instructor-matching"><div class="ds-modal__content">${matchingForm(row, { courses: [{ value: 'c1', label: 'עברית · 101' }, { value: 'c2', label: 'ערבית · 202' }], authorities: [{ value: 'a1', label: 'חיפה' }], schools: [{ value: 's1', label: 'אלון · חיפה' }] })}</div><footer class="ds-modal__footer"><button data-save-instructor-matching>שמירה</button></footer></section>`);
  const saved = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element });
  try {
    const modal = document.querySelector('.ds-modal');
    let calls = 0;
    let payload;
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    bindInstructorMatchingModal(modal, { row, saveProfile: async (value) => { calls += 1; payload = value; await pending; }, onSuccess: () => {} });
    bindInstructorMatchingModal(modal, { row, saveProfile: async () => { calls += 10; } });
    assert.match(modal.innerHTML, /data-multiselect-tags/);
    assert.equal(modal.querySelector('[data-course-picker]').hidden, false);
    modal.querySelector('[name="course_restriction_mode"][value="all"]').click();
    assert.equal(modal.querySelector('[data-course-picker]').hidden, true);
    const save = modal.querySelector('[data-save-instructor-matching]');
    save.click();
    save.click();
    assert.equal(calls, 1);
    assert.equal(save.textContent, 'שומר...');
    assert.equal(save.disabled, true);
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(payload.course_ids, []);
    assert.equal(payload.matching_note, 'קיים');
    const reopened = new JSDOM(matchingForm({ scheduling_profile: payload }, {}));
    assert.equal(reopened.window.document.querySelector('[name="gender"][value="female"]').checked, true);
    assert.equal(reopened.window.document.querySelector('[name="language"][value="he"]').checked, true);
    assert.equal(reopened.window.document.querySelector('[name="matching_note"]').value, 'קיים');
    reopened.window.close();
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

test('matching modal keeps entered values and re-enables save after a failure', async () => {
  const dom = new JSDOM(`<section class="ds-modal"><div class="ds-modal__content">${matchingForm({ scheduling_profile: {} }, {})}</div><footer class="ds-modal__footer"><button data-save-instructor-matching>שמירה</button></footer></section>`);
  const saved = { window: globalThis.window, document: globalThis.document, Element: globalThis.Element };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Element: dom.window.Element });
  try {
    const modal = document.querySelector('.ds-modal');
    bindInstructorMatchingModal(modal, { row: { emp_id: '1', scheduling_profile: {} }, saveProfile: async () => { throw new Error('תקלה זמנית'); } });
    modal.querySelector('[name="matching_note"]').value = 'לא למחוק';
    modal.querySelector('[data-save-instructor-matching]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(modal.querySelector('[name="matching_note"]').value, 'לא למחוק');
    assert.equal(modal.querySelector('[data-save-instructor-matching]').disabled, false);
    assert.match(modal.querySelector('[data-matching-status]').textContent, /תקלה זמנית/);
  } finally {
    Object.assign(globalThis, saved);
    dom.window.close();
  }
});

function constraintsModal(row) {
  return new JSDOM(`<section class="ds-modal ds-modal--instructor-constraints"><div class="ds-modal__content">${constraintsForm(row)}</div><footer class="ds-modal__footer"><button data-ui-close-modal>סגירה</button><button data-save-instructor-constraints>שמירת זמינות</button></footer></section>`);
}

test('constraints footer save binds once, locks during saving, and submits all weekdays', async () => {
  const row = { emp_id: '1500', scheduling_profile: { friday_allowed: false }, availability_rules: [], availability_exceptions: [] };
  const dom = constraintsModal(row);
  let profileCalls = 0;
  let rulesCalls = 0;
  let profilePayload;
  let rulesPayload;
  let successCalls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  try {
    const modal = dom.window.document.querySelector('.ds-modal');
    const options = { row, saveProfile: async (payload) => { profileCalls += 1; profilePayload = payload; await pending; }, saveWeeklyRules: async (_empId, rules) => { rulesCalls += 1; rulesPayload = rules; }, onSuccess: () => { successCalls += 1; } };
    bindInstructorConstraintsModal(modal, options);
    bindInstructorConstraintsModal(modal, options);
    assert.ok(modal.querySelector('.ds-modal__footer [data-save-instructor-constraints]'));
    const unavailable = modal.querySelector('[data-weekday-row="2"]');
    unavailable.querySelector('[name="available"]').click();
    assert.equal(unavailable.querySelector('[name="start_time"]').disabled, true);
    modal.querySelector('[name="friday_allowed"]').checked = true;
    const save = modal.querySelector('[data-save-instructor-constraints]');
    save.click();
    save.click();
    assert.equal(profileCalls, 1);
    assert.equal(rulesCalls, 1);
    assert.equal(save.disabled, true);
    assert.equal(save.textContent, 'שומר...');
    assert.equal(save.getAttribute('aria-busy'), 'true');
    assert.equal(rulesPayload.length, 7);
    assert.deepEqual(rulesPayload.map((rule) => rule.weekday), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(rulesPayload.find((rule) => rule.weekday === 2).available, false);
    assert.equal(rulesPayload.find((rule) => rule.weekday === 6).available, false);
    assert.equal(profilePayload.friday_allowed, true);
    release();
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(successCalls, 1);
  } finally { dom.window.close(); }
});

test('constraints save failure preserves values and restores its footer button', async () => {
  const row = { emp_id: '1500', scheduling_profile: {}, availability_rules: [], availability_exceptions: [] };
  const dom = constraintsModal(row);
  try {
    const modal = dom.window.document.querySelector('.ds-modal');
    bindInstructorConstraintsModal(modal, { row, saveProfile: async () => { throw new Error('תקלה זמנית'); }, saveWeeklyRules: async () => {} });
    modal.querySelector('[name="notes"]').value = 'לא למחוק';
    const save = modal.querySelector('[data-save-instructor-constraints]');
    save.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(modal.querySelector('[name="notes"]').value, 'לא למחוק');
    assert.equal(save.disabled, false);
    assert.equal(save.textContent, 'שמירת זמינות');
    assert.equal(save.hasAttribute('aria-busy'), false);
    assert.match(modal.querySelector('[data-constraints-status]').textContent, /תקלה זמנית/);
    assert.ok(modal.isConnected);
  } finally { dom.window.close(); }
});

test('constraints exception add and delete actions remain connected', async () => {
  const row = { emp_id: '1500', scheduling_profile: {}, availability_rules: [], availability_exceptions: [{ id: 'ex-1', exception_date: '2026-08-02', available: false }] };
  const dom = constraintsModal(row);
  const actions = [];
  try {
    const modal = dom.window.document.querySelector('.ds-modal');
    bindInstructorConstraintsModal(modal, { row, saveProfile: async () => {}, saveWeeklyRules: async () => {}, saveException: async (payload) => { actions.push(['add', payload]); }, deleteException: async (id) => { actions.push(['delete', id]); }, onExceptionChange: async (action) => { actions.push(['refresh', action]); } });
    modal.querySelector('[name="exception_date"]').value = '2026-08-03';
    modal.querySelector('[data-add-availability-exception]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    modal.querySelector('[data-delete-availability-exception]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(actions[0][0], 'add');
    assert.equal(actions[0][1].exception_date, '2026-08-03');
    assert.deepEqual(actions.slice(1), [['refresh', 'add'], ['delete', 'ex-1'], ['refresh', 'delete']]);
  } finally { dom.window.close(); }
});
