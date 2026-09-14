import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const {
  primeScheduleBaseline,
  rememberEditedMeetingDate,
  rememberScheduleStructureChange,
  restoreEditedMeetingDates,
  clearEditedMeetingDateDrafts,
  handleDateSectionMutation,
  startActivityEditDateRaceGuard,
  stopActivityEditDateRaceGuardForTests
} = await import('../frontend/src/activity-edit-date-race-guard.js');

function buildForm({ editing = 'yes', loading = true, first = '', second = '' } = {}) {
  const dom = new JSDOM(`
    <form data-drawer-form data-editing="${editing}">
      <section data-dates-section${loading ? ' data-dates-loading="true"' : ''}>
        <div data-meeting-dates-edit>
          <div class="activity-drawer__date-card"><input type="date" name="meeting_date_0" data-meeting-idx="0" value="${first}"></div>
          <div class="activity-drawer__date-card"><input type="date" name="meeting_date_1" data-meeting-idx="1" value="${second}"></div>
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
  primeScheduleBaseline(form);

  first.value = '2026-10-13';
  assert.equal(rememberEditedMeetingDate(first), true);

  // Simulate the stale async dates response patching the edit input back to empty.
  first.value = '';
  section.removeAttribute('data-dates-loading');

  assert.equal(handleDateSectionMutation(loadingFinishedMutation(section)), 1);
  assert.equal(first.value, '2026-10-13');
  assert.equal(first.dataset.prevValue, '2026-10-13');
});

test('live observer restores a user-selected date after the loading flag is removed', async () => {
  const { dom, form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  const previousDocument = globalThis.document;
  const previousMutationObserver = globalThis.MutationObserver;

  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  try {
    stopActivityEditDateRaceGuardForTests();
    startActivityEditDateRaceGuard();

    first.value = '2026-10-13';
    first.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    // Equivalent to the late activityDates patch: stale DB value, then loading completes.
    first.value = '';
    section.removeAttribute('data-dates-loading');
    await new Promise((resolve) => dom.window.queueMicrotask(resolve));

    assert.equal(first.value, '2026-10-13');
  } finally {
    stopActivityEditDateRaceGuardForTests();
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousMutationObserver === undefined) delete globalThis.MutationObserver;
    else globalThis.MutationObserver = previousMutationObserver;
  }
});

test('complete visible chain is restored if stale background data overwrites all dates', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  const second = form.querySelector('[data-meeting-idx="1"]');
  primeScheduleBaseline(form);

  // The drawer's synchronous chain handler runs before the document-level guard.
  first.value = '2026-10-13';
  second.value = '2026-10-20';
  rememberEditedMeetingDate(first);

  // Late activityDates returns the old undated schedule and overwrites both fields.
  first.value = '';
  second.value = '';
  section.removeAttribute('data-dates-loading');
  handleDateSectionMutation(loadingFinishedMutation(section));

  assert.equal(first.value, '2026-10-13');
  assert.equal(second.value, '2026-10-20');
});

test('authoritative untouched dates from hydration are retained', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  const second = form.querySelector('[data-meeting-idx="1"]');
  primeScheduleBaseline(form);

  first.value = '2026-10-13';
  rememberEditedMeetingDate(first);

  // The late response has an authoritative second date that the user never touched.
  first.value = '';
  second.value = '2026-10-20';
  section.removeAttribute('data-dates-loading');
  handleDateSectionMutation(loadingFinishedMutation(section));

  assert.equal(first.value, '2026-10-13');
  assert.equal(second.value, '2026-10-20');
});

test('remove-meeting draft keeps the user-visible card count after stale hydration', () => {
  const { form, section } = buildForm();
  const grid = form.querySelector('[data-meeting-dates-edit]');
  primeScheduleBaseline(form);
  grid.lastElementChild.remove();
  assert.equal(rememberScheduleStructureChange(form), true);
  assert.equal(grid.children.length, 1);

  // Stale server hydration re-adds the removed second card.
  const card = form.ownerDocument.createElement('div');
  card.className = 'activity-drawer__date-card';
  card.innerHTML = '<input type="date" name="meeting_date_1" data-meeting-idx="1" value="">';
  grid.append(card);
  section.removeAttribute('data-dates-loading');

  assert.ok(handleDateSectionMutation(loadingFinishedMutation(section)) >= 1);
  assert.equal(grid.children.length, 1);
});

test('guard is inactive outside edit mode', () => {
  const { form, section } = buildForm();
  const first = form.querySelector('[data-meeting-idx="0"]');
  primeScheduleBaseline(form);
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
  primeScheduleBaseline(form);
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
