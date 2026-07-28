import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { instructorsScreen } from '../frontend/src/screens/instructors.js';
import { profileHtml } from '../frontend/src/screens/instructor-workspace-ui.js';

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
