import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountIsraaShareLanguage, shareIsraaGroupWithLanguage, israaShareErrorMessage, ISRAA_LANGUAGE_REQUIRED } from '../frontend/src/israa-share-language.js';

test('sharing requires an explicit language instead of inheriting the hidden Hebrew default', () => {
  const dom = new JSDOM('<form><div hidden><label>שפת הדרכה<select name="instruction_language"><option value="he">עברית</option></select></label></div><div id="bar"></div></form>');
  const form = dom.window.document.querySelector('form');
  const bar = form.querySelector('#bar');
  const select = mountIsraaShareLanguage(form, bar, null);
  assert.equal(select.value, '');
  assert.equal(select.closest('[hidden]'), null);
  assert.equal(form.querySelectorAll('[name="instruction_language"]').length, 1);
  assert.equal(bar.contains(select), true);
  dom.window.close();
});

test('saved Hebrew and Arabic choices are restored and one-day drawers can select a language', () => {
  for (const language of ['he', 'ar']) {
    const dom = new JSDOM('<form><div id="bar"></div></form>');
    const form = dom.window.document.querySelector('form');
    const select = mountIsraaShareLanguage(form, form.querySelector('#bar'), language);
    assert.equal(select.value, language);
    dom.window.close();
  }
});

test('missing language focuses the field and makes no save or publish request', async () => {
  let focused = false;
  const api = new Proxy({}, { get() { throw new Error('unexpected API request'); } });
  await assert.rejects(shareIsraaGroupWithLanguage(api, {}, { value: '', focus() { focused = true; } }), { message: ISRAA_LANGUAGE_REQUIRED });
  assert.equal(focused, true);
});

test('each explicit language is saved for the selected group before publishing', async () => {
  for (const language of ['he', 'ar']) {
    const calls = [];
    const api = {
      async saveIsraaActivityGroupDraft(...args) { calls.push(['save', ...args]); },
      async shareIsraaActivityGroup(...args) { calls.push(['share', ...args]); return { created_count: 1 }; }
    };
    const ref = { trackingId: 'tracking', proposalItemId: 'item', groupNumber: 2 };
    const result = await shareIsraaGroupWithLanguage(api, ref, { value: language });
    assert.deepEqual(calls, [['save', 'tracking', 'item', 2, { instruction_language: language }], ['share', 'tracking', 'item', 2]]);
    assert.equal(result.created_count, 1);
  }
});

test('a failed draft save prevents publication and preserves the actual failure', async () => {
  const api = {
    async saveIsraaActivityGroupDraft() { throw new Error('save failed'); },
    async shareIsraaActivityGroup() { assert.fail('must not publish after failed save'); }
  };
  await assert.rejects(shareIsraaGroupWithLanguage(api, {}, { value: 'ar' }), /save failed/);
});

test('language and permission failures get actionable messages without exposing raw database errors', () => {
  for (const message of ['israa_instruction_language_required', 'new row violates activities_school_2027_explicit_language_required', ISRAA_LANGUAGE_REQUIRED]) {
    assert.equal(israaShareErrorMessage({ message }), ISRAA_LANGUAGE_REQUIRED);
  }
  assert.match(israaShareErrorMessage({ message: 'israa_management_forbidden' }), /אין הרשאה/);
  assert.doesNotMatch(israaShareErrorMessage({ message: 'private SQL details' }), /private SQL/);
});
