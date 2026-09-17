import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });

const { draftInstructorDisplayValue } = await import('../frontend/src/activities-approved-ui-fix.js');

test('draft instructor is shown only when no approved instructor exists', () => {
  assert.equal(draftInstructorDisplayValue({
    emp_id: '',
    instructor_name: '',
    draft_emp_id: '6000',
    draft_instructor_name: 'עדן כהן'
  }), 'עדן כהן');

  assert.equal(draftInstructorDisplayValue({
    emp_id: '1503',
    instructor_name: 'הנאא אבו אמנה',
    draft_emp_id: '6000',
    draft_instructor_name: 'עדן כהן'
  }), '');
});

test('draft employee id is a fallback only when draft name is missing', () => {
  assert.equal(draftInstructorDisplayValue({
    draft_emp_id: '6000',
    draft_instructor_name: ''
  }), '6000');

  assert.equal(draftInstructorDisplayValue({}), '');
});
