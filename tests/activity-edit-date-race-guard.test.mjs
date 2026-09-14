import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const {
  rememberEditedMeetingDate,
  restoreEditedMeetingDates,
  clearEditedMeetingDateDrafts,
  handleDateSectionMutation
} = await import('../frontend/src/activity-edit-date-race-guard.js');

function buildForm({ editing = 'yes', loading = true } = {}) {
  const dom = new JSDOM(`
    <form data-drawer-form data-editing="${editing}">
      <section data-dates-section${loading ? ' data-dates-loading="true"' : ''}>
        <div data-meeting-dates-edit>
          <input type="date" name="meeting_date_0" data-meeting-idx="0" value="">
          <input type="date" name="meeting_date_1" data-meeting-idx="1" value="">
        </div>
      </section>
    </form>
  `);
  return {
    dom,
    form: dom.window.document.querySelector('[data-drawer-form]'),
    section: dom.window.document.querySelector('[data-dates-section]')
  };
}

function loadingFinishedMutation(section) {
  return { type: 'attributes', attributeName: 'data-dates-loading', target: section };
}

test('undated activity keeps the date selected by the user when background activityDates finishes', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');

  first.value = '2026-10-13';
  assert.equal(rememberEditedMeetingDate(first), true);

  // Simulate the stale async dates response patching the edit input back to empty.
  first.value = '';
  section.removeAttribute('data-dates-loading');

  assert.equal(handleDateSectionMutation(loadingFinishedMutation(section)), 1);
  assert.equal(first.value, '2026-10-13');
  assert.equal(first.dataset.prevValue, '2026-10-13');
});

test('background date completion does not overwrite unrelated programmatic meeting changes', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  const second = form.querySelector('[data-meeting-idx="1"]');

  first.value = '2026-10-13';
  rememberEditedMeetingDate(first);

  // A chain/holiday calculation is allowed to update another meeting.
  second.value = '2026-10-27';
  first.value = '';
  section.removeAttribute('data-dates-loading');
  handleDateSectionMutation(loadingFinishedMutation(section));

  assert.equal(first.value, '2026-10-13');
  assert.equal(second.value, '2026-10-27');
});

test('guard is inactive outside edit mode', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  first.value = '2026-10-13';
  rememberEditedMeetingDate(first);

  form.dataset.editing = 'no';
  first.value = '';
  section.removeAttribute('data-dates-loading');

  assert.equal(handleDateSectionMutation(loadingFinishedMutation(section)), 0);
  assert.equal(first.value, '');
});

test('cleared drafts are never restored after edit completes', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  first.value = '2026-10-13';
  rememberEditedMeetingDate(first);
  clearEditedMeetingDateDrafts(form);

  first.value = '';
  section.removeAttribute('data-dates-loading');
  assert.equal(restoreEditedMeetingDates(form), 0);
  assert.equal(first.value, '');
});

test('deployment loads the narrow race guard and bumps the cache version', async () => {
  const index = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
  const sw = await fs.readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(index, /activity-edit-date-race-guard\.js\?v=20260915-activity-date-edit-race-v1/);
  assert.match(sw, /const CACHE_VERSION = 1717;/);
});
