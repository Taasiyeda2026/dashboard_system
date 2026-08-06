import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { generateSessionDatesFromFirstMeeting } from '../frontend/src/screens/shared/school-calendar-form-guard.js';

const holiday = [{
  title: 'חופשת חנוכה', start_date: '2026-12-09', end_date: '2026-12-09',
  blocks_scheduling: true, show_on_main_calendar: true, is_active: true
}];

function makeForm({ count = 10, first = '2026-11-11', once = false } = {}) {
  const dom = new JSDOM(`<form data-is-once="${once ? 'yes' : 'no'}">
    <section data-session-total="${count}"><div data-meeting-dates-edit>${Array.from({ length: count }, (_, i) =>
      `<div class="activity-drawer__date-card"><span class="activity-drawer__weekday"></span><input data-meeting-idx="${i}" value="${i ? '' : first}"></div>`).join('')}</div></section>
    <strong data-computed-end-display></strong>
  </form>`);
  globalThis.document = dom.window.document;
  return dom.window.document.querySelector('form');
}

const values = (form) => Array.from(form.querySelectorAll('[data-meeting-idx]'), (input) => input.value);

test('first meeting creates exactly ten weekly dates and updates boundaries', () => {
  const form = makeForm();
  const result = generateSessionDatesFromFirstMeeting(form, []);
  assert.equal(result.dates.length, 10);
  assert.equal(values(form).length, 10);
  assert.equal(result.dates[9], '2027-01-13');
  assert.equal(form.dataset.autoStartDate, '2026-11-11');
  assert.equal(form.dataset.autoEndDate, '2027-01-13');
  result.dates.slice(1).forEach((date, i) => {
    assert.equal((new Date(date) - new Date(result.dates[i])) / 86400000, 7);
  });
});

test('blocked holiday is skipped, weekday and full meeting count are preserved', () => {
  const form = makeForm();
  const result = generateSessionDatesFromFirstMeeting(form, holiday);
  assert.equal(result.dates.length, 10);
  assert.ok(!result.dates.includes('2026-12-09'));
  assert.equal(result.dates[4], '2026-12-16');
  assert.ok(result.dates.every((date) => new Date(`${date}T12:00:00`).getDay() === 3));
  assert.deepEqual(result.deferred, [{ meeting: 5, skippedWeeks: 1 }]);
  assert.match(form.querySelector('[data-session-deferral-note]').textContent, /נדחה בשבוע/);
});

test('changing meeting 1 rebuilds later dates but a later manual edit otherwise remains', () => {
  const form = makeForm();
  generateSessionDatesFromFirstMeeting(form, []);
  const inputs = form.querySelectorAll('[data-meeting-idx]');
  inputs[5].value = '2027-04-01';
  assert.equal(inputs[5].value, '2027-04-01');
  inputs[0].value = '2026-11-18';
  generateSessionDatesFromFirstMeeting(form, []);
  assert.equal(inputs[5].value, '2026-12-23');
});

test('clearing meeting 1 clears every generated later date', () => {
  const form = makeForm();
  generateSessionDatesFromFirstMeeting(form, []);
  form.querySelector('[data-meeting-idx="0"]').value = '';
  generateSessionDatesFromFirstMeeting(form, holiday);
  assert.deepEqual(values(form), Array(10).fill(''));
  assert.equal(form.dataset.autoEndDate, '');
});

test('one-day activity remains one meeting', () => {
  const form = makeForm({ count: 1, once: true });
  const result = generateSessionDatesFromFirstMeeting(form, holiday);
  assert.deepEqual(result.dates, ['2026-11-11']);
  assert.equal(values(form).length, 1);
});

test('existing activity is untouched until generation is explicitly requested', () => {
  const form = makeForm({ count: 3 });
  const inputs = form.querySelectorAll('[data-meeting-idx]');
  inputs[1].value = '2026-11-20';
  inputs[2].value = '2026-12-01';
  assert.deepEqual(values(form), ['2026-11-11', '2026-11-20', '2026-12-01']);
});
