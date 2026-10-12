import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { mountInstructorExtendedReview, MAX_INSTRUCTOR_RECOMMENDATIONS } from '../frontend/src/impact-feedback/feedback-instructor-review.js';

function fixture(language = 'he', initialReview = null) {
  const dom = new JSDOM('<main id="root"></main>');
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const root = dom.window.document.getElementById('root');
  const changes = [];
  const form = mountInstructorExtendedReview(root, { language, initialReview, onChange: (value) => changes.push(value) });
  const change = (element, value) => {
    if (element.type === 'checkbox' || element.type === 'radio') element.checked = Boolean(value);
    else element.value = value;
    element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  };
  const input = (element, value) => {
    element.value = value;
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  const click = (element) => element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  return { dom, root, form, changes, change, input, click };
}

test('the opt-in is explicit; declined reviews never submit details', () => {
  const f = fixture();
  assert.equal(f.form.validate(), false);
  const no = f.root.querySelector('[name="ifb-extra-consent"][value="no"]');
  f.change(no, true);
  assert.equal(f.form.validate(), true);
  assert.deepEqual(f.form.getReview(), { opted_in: false, items: [] });
  assert.equal(f.root.querySelector('[data-review-details]').hidden, true);
});

test('opt-in reveals typed recommendations and supports add/remove/change-of-mind', () => {
  const f = fixture();
  f.change(f.root.querySelector('[name="ifb-extra-consent"][value="yes"]'), true);
  assert.equal(f.root.querySelectorAll('.ifb-extra-item').length, 1);
  assert.equal(f.form.validate(), false);
  f.change(f.root.querySelector('[data-review-field="area"]'), 'slides');
  f.change(f.root.querySelector('[data-review-field="actions"][value="simplify"]'), true);
  f.input(f.root.querySelector('[data-review-field="issue"]'), 'The slide is too dense');
  f.input(f.root.querySelector('[data-review-field="recommendation"]'), 'Replace text with a visual example');
  assert.equal(f.form.validate(), true);
  assert.deepEqual(f.form.getReview().items[0].actions, ['simplify']);
  f.click(f.root.querySelector('[data-review-add]'));
  assert.equal(f.root.querySelectorAll('.ifb-extra-item').length, 2);
  f.click(f.root.querySelector('[data-review-remove="1"]'));
  assert.equal(f.root.querySelectorAll('.ifb-extra-item').length, 1);
  f.change(f.root.querySelector('[name="ifb-extra-consent"][value="no"]'), true);
  assert.deepEqual(f.form.getReview(), { opted_in: false, items: [] });
  f.change(f.root.querySelector('[name="ifb-extra-consent"][value="yes"]'), true);
  assert.equal(f.form.getReview().items[0].issue, 'The slide is too dense');
});

test('an Arabic instructor sees translated opt-in and categories', () => {
  const f = fixture('ar');
  assert.match(f.root.textContent, /5 دقائق/);
  f.change(f.root.querySelector('[name="ifb-extra-consent"][value="yes"]'), true);
  assert.match(f.root.textContent, /العروض والشرائح/);
});

test('the add button is capped at eight recommendations', () => {
  const f = fixture();
  f.change(f.root.querySelector('[name="ifb-extra-consent"][value="yes"]'), true);
  for (let i = 1; i < MAX_INSTRUCTOR_RECOMMENDATIONS; i++) f.click(f.root.querySelector('[data-review-add]'));
  assert.equal(f.root.querySelectorAll('.ifb-extra-item').length, MAX_INSTRUCTOR_RECOMMENDATIONS);
  assert.equal(f.root.querySelector('[data-review-add]').hidden, true);
});

test('the opt-in only applies to instructor finals and uses the atomic submit RPC', () => {
  const frontend = readFileSync(new URL('../frontend/src/impact-feedback/feedback-form.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('../frontend/src/impact-feedback/feedback-public.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261013024000_feedback_optional_instructor_deep_review.sql', import.meta.url), 'utf8');
  assert.match(frontend, /payload\.audience === 'instructor' && \['final', 'final_b'\]\.includes\(payload\.stage\)/);
  assert.match(page, /feedback_public_submit_instructor_review/);
  assert.match(migration, /v_result := public\.feedback_public_submit\(/);
  assert.match(migration, /on conflict \(response_id\) do nothing/);
  assert.match(migration, /private\.feedback_can_view\(\)/);
  assert.match(migration, /enable row level security/);
});
