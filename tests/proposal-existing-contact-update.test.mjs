import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ensureClientContactFormIntegrity,
  isExistingProposalContact,
  saveExistingProposalContact,
} from '../frontend/src/client-contact-form-integrity.js';

function existingContactFormHtml() {
  const optionPayload = encodeURIComponent(JSON.stringify({
    id: 654,
    source_id: 654,
    source_table: 'contacts_schools',
    contact_name: 'שם ישן',
    contact_role: 'תפקיד ישן',
    mobile: '0500000000',
    email: 'old@example.com'
  }));
  return `<main id="app"><form data-pa-form>
    <input type="hidden" name="contact_selection_mode" value="">
    <input type="hidden" name="contact_source_table" value="contacts_schools">
    <input type="hidden" name="contact_source_id" value="654">
    <input type="hidden" name="contact_source_name" value="שם ישן">
    <input type="hidden" name="contact_source_role" value="תפקיד ישן">
    <input type="hidden" name="contact_source_mobile" value="0500000000">
    <input type="hidden" name="contact_source_email" value="old@example.com">
    <select data-pa-contact-select>
      <option value="contact:654" data-pa-contact-option="${optionPayload}" selected>שם ישן</option>
    </select>
    <div data-pa-contact-manual-fields hidden>
      <input name="contact_name" value="שם חדש">
      <input name="contact_role" value="תפקיד חדש">
    </div>
    <div data-pa-contact-channels-fields hidden>
      <input name="phone" value="0501234567">
      <input name="email" value="new@example.com">
    </div>
    <p data-pa-form-error hidden></p>
  </form></main>`;
}

test('existing proposal contact receives an explicit update save button', () => {
  const dom = new JSDOM(existingContactFormHtml());
  const { document } = dom.window;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    const form = document.querySelector('[data-pa-form]');
    ensureClientContactFormIntegrity(document);
    const button = form.querySelector('[data-pa-existing-contact-save]');
    assert.equal(isExistingProposalContact(form), true);
    assert.ok(button);
    assert.equal(button.textContent, 'שמירת עדכון');
    assert.equal(form.querySelector('[data-pa-manual-contact-save]'), null);
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test('existing proposal contact update persists all editable fields and refreshes proposal source metadata', async () => {
  const dom = new JSDOM(existingContactFormHtml());
  const { document } = dom.window;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    const form = document.querySelector('[data-pa-form]');
    const calls = [];
    const saved = await saveExistingProposalContact(form, {
      api: {
        updateUnifiedContactRecord: async (payload) => {
          calls.push(payload);
          return { ok: true };
        }
      }
    });

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      source_table: 'contacts_schools',
      source_id: '654',
      fields: {
        contact_name: 'שם חדש',
        contact_role: 'תפקיד חדש',
        mobile: '0501234567',
        email: 'new@example.com'
      }
    });
    assert.equal(saved.source_id, '654');
    assert.equal(form.querySelector('[name="contact_source_name"]').value, 'שם חדש');
    assert.equal(form.querySelector('[name="contact_source_role"]').value, 'תפקיד חדש');
    assert.equal(form.querySelector('[name="contact_source_mobile"]').value, '0501234567');
    assert.equal(form.querySelector('[name="contact_source_email"]').value, 'new@example.com');

    const option = form.querySelector('[data-pa-contact-select] option:checked');
    const payload = JSON.parse(decodeURIComponent(option.dataset.paContactOption));
    assert.equal(payload.contact_name, 'שם חדש');
    assert.equal(payload.contact_role, 'תפקיד חדש');
    assert.equal(payload.mobile, '0501234567');
    assert.equal(payload.email, 'new@example.com');
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test('existing contact update allows filling or clearing optional details but requires a contact name', async () => {
  const dom = new JSDOM(existingContactFormHtml());
  const { document } = dom.window;
  const previousDocument = globalThis.document;
  globalThis.document = document;
  try {
    const form = document.querySelector('[data-pa-form]');
    form.querySelector('[name="contact_name"]').value = '';
    await assert.rejects(
      saveExistingProposalContact(form, { api: { updateUnifiedContactRecord: async () => ({ ok: true }) } }),
      /יש להזין שם איש קשר/
    );
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});
