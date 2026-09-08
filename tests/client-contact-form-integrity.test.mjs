import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ensureClientContactFormIntegrity } from '../frontend/src/client-contact-form-integrity.js';

test('runtime integrity keeps cached contact forms complete and submittable', () => {
  const dom = new JSDOM(`<main id="app"><div data-pa-client-contact-modal><form data-pa-client-contact-form>
    <h3>הוספת איש קשר</h3>
    <label>שם מלא<input name="contact_name"></label>
    <label>תפקיד<input name="contact_role"></label>
    <label>נייד<input name="mobile"></label>
    <label>אימייל<input name="email"></label>
  </form></div></main>`);
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const app = document.getElementById('app');
    ensureClientContactFormIntegrity(app);
    ensureClientContactFormIntegrity(app);
    const form = app.querySelector('[data-pa-client-contact-form]');
    const submit = form.querySelector('button[type="submit"]');
    assert.ok(form.querySelector('[name="phone"]'));
    assert.ok(form.querySelector('[data-pa-client-contact-error]'));
    assert.ok(submit);
    assert.equal(submit.textContent, 'שמירה');
    assert.equal(form.querySelectorAll('button[type="submit"]').length, 1);
    assert.equal(form.querySelectorAll('[name="phone"]').length, 1);
    assert.equal(form.querySelector('[data-pa-client-contact-close]')?.textContent, 'ביטול');
    let submitted = false;
    form.addEventListener('submit', (event) => { event.preventDefault(); submitted = true; });
    submit.click();
    assert.equal(submitted, true, 'the restored button must use the existing submit event path');
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});
