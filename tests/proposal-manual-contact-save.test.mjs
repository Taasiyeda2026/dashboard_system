import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function proposalFormHtml({ sourceId = '', mode = 'other' } = {}) {
  return `<main id="app"><form data-pa-form>
    <input type="hidden" name="contact_selection_mode" value="${mode}">
    <input type="hidden" name="contact_source_table" value="">
    <input type="hidden" name="contact_source_id" value="${sourceId}">
    <input type="hidden" name="contact_source_client_type" value="school">
    <input type="hidden" name="contact_source_client_name" value="שחר אשכול">
    <input type="hidden" name="contact_source_authority_id" value="12">
    <input type="hidden" name="contact_source_school_id" value="34">
    <input type="hidden" name="contact_source_authority_code" value="A12">
    <input type="hidden" name="contact_source_semel_mosad" value="123456">
    <input type="hidden" name="contact_source_authority" value="אשכול">
    <input type="hidden" name="contact_source_school" value="שחר אשכול">
    <input type="hidden" name="contact_source_name" value="">
    <input type="hidden" name="contact_source_role" value="">
    <input type="hidden" name="contact_source_mobile" value="">
    <input type="hidden" name="contact_source_phone" value="">
    <input type="hidden" name="contact_source_email" value="">
    <div data-pa-contact-manual-fields>
      <input name="contact_name" value="ישראל ישראלי">
      <input name="contact_role" value="מנהל">
    </div>
    <div data-pa-contact-channels-fields>
      <input name="phone" value="0501234567">
      <input name="email" value="israel@example.com">
    </div>
    <p data-pa-form-error hidden></p>
  </form></main>`;
}

async function withDom(html, callback) {
  const dom = new JSDOM(html, { url: 'https://example.test/' });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Element: globalThis.Element,
    Event: globalThis.Event,
    MutationObserver: globalThis.MutationObserver,
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Element = dom.window.Element;
  globalThis.Event = dom.window.Event;
  globalThis.MutationObserver = dom.window.MutationObserver;
  try {
    await callback(dom.window.document);
  } finally {
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.Element = previous.Element;
    globalThis.Event = previous.Event;
    globalThis.MutationObserver = previous.MutationObserver;
    dom.window.close();
  }
}

const runtime = await import('../frontend/src/client-contact-form-integrity.js');

test('manual contact inside proposal gets an explicit save button when no contact id exists', async () => {
  await withDom(proposalFormHtml(), async (document) => {
    const form = document.querySelector('[data-pa-form]');
    runtime.ensureClientContactFormIntegrity(document);
    const button = form.querySelector('[data-pa-manual-contact-save]');
    assert.ok(button, 'manual/new contact must expose a save action');
    assert.equal(button.textContent, 'שמירה');
    assert.equal(runtime.isManualProposalContact(form), true);
  });
});

test('manual proposal contact save persists once and writes the returned contacts_schools identity back to the proposal', async () => {
  await withDom(proposalFormHtml(), async (document) => {
    const form = document.querySelector('[data-pa-form]');
    let calls = 0;
    let candidate;
    const saved = await runtime.saveManualProposalContact(form, {
      api: {},
      persistNewClientContact: async (_api, row) => {
        calls += 1;
        candidate = row;
        return { ...row, id: 987, source_id: 987, source_table: 'contacts_schools' };
      },
    });

    assert.equal(calls, 1);
    assert.equal(candidate.contact_name, 'ישראל ישראלי');
    assert.equal(candidate.contact_role, 'מנהל');
    assert.equal(candidate.mobile, '0501234567');
    assert.equal(candidate.email, 'israel@example.com');
    assert.equal(candidate.authority_id, '12');
    assert.equal(candidate.school_id, '34');
    assert.equal(saved.id, 987);
    assert.equal(form.querySelector('[name="contact_source_id"]').value, '987');
    assert.equal(form.querySelector('[name="contact_source_table"]').value, 'contacts_schools');
    assert.equal(form.querySelector('[name="contact_source_name"]').value, 'ישראל ישראלי');
    assert.equal(form.querySelector('[name="contact_source_mobile"]').value, '0501234567');

    runtime.ensureClientContactFormIntegrity(document);
    assert.equal(form.querySelector('[data-pa-manual-contact-save]'), null, 'create button must disappear once the contact has a real database id');
    assert.equal(runtime.isManualProposalContact(form), false);
  });
});

test('existing contact selection does not receive the new-contact save button', async () => {
  await withDom(proposalFormHtml({ sourceId: '654', mode: '' }), async (document) => {
    const form = document.querySelector('[data-pa-form]');
    runtime.ensureClientContactFormIntegrity(document);
    assert.equal(form.querySelector('[data-pa-manual-contact-save]'), null);
  });
});
