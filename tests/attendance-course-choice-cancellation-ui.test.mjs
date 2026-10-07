import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { canEditMonth } from '../attendance/src/services/month-gate.service.js';

const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test/attendance/' });
for (const name of ['window','document','HTMLElement','HTMLFormElement','Element','MutationObserver','Event']) globalThis[name] = dom.window[name];
globalThis.CSS = { escape: value => value };
const calls = [];
window.supabase = { createClient: () => ({
  rpc: async (name, args) => { calls.push({ name, args }); return { data: { eligible: true } }; },
  functions: { invoke: async () => ({ data: { eligible: true, status: 'resolved' } }) },
}) };
await import('../attendance/src/attendance-followup-runtime-v2.js');
const tick = ms => new Promise(resolve => setTimeout(resolve, ms));

function pickerParts() {
  const picker = document.querySelector('[data-av2-time-cancel-edit] .av2-time-picker');
  assert.ok(picker, 'keyboard-free cancellation picker missing');
  const triggers = picker.querySelectorAll('.av2-csel__trigger');
  assert.equal(triggers.length, 2);
  return { picker, hour: triggers[0], minute: triggers[1] };
}

function pickerValue() {
  const { hour, minute } = pickerParts();
  return `${hour.textContent.trim()}:${minute.textContent.trim()}`;
}

function selectPickerPart(trigger, label) {
  trigger.click();
  const root = trigger.closest('.av2-csel');
  const option = [...root.querySelectorAll('.av2-csel__option')]
    .find((item) => item.textContent.trim() === label);
  assert.ok(option, `missing picker option ${label}`);
  option.click();
}

function setPickerValue(hourLabel, minuteLabel) {
  const parts = pickerParts();
  selectPickerPart(parts.hour, hourLabel);
  const refreshed = pickerParts();
  selectPickerPart(refreshed.minute, minuteLabel);
}
function report(label, audit = '') {
  document.getElementById('app').innerHTML = `<div class="av2-report-row" data-record-id="source-1">
    <div class="av2-rr__hours">2:00</div><div class="av2-rr__travel-compensation"><strong>${label}</strong><small class="av2-rr__travel-audit">${audit}</small></div></div>
    <form class="av2-report__form" data-av2-edit-record-id="source-1"><div class="av2-report__hours-display">2:00</div></form>`;
  return document.querySelector('.av2-report-row');
}
after(() => dom.window.close());

test('open-month cancellation edit writes 0:00 against the source after the report saves', async () => {
  const now = new Date();
  assert.equal(canEditMonth(now.getFullYear(), now.getMonth() + 1, { status: 'open' }, now), true);
  const oldRow = report('0:35');
  await tick(40);
  assert.equal(document.querySelector('[data-av2-time-cancel-edit] input'), null);
  assert.equal(pickerValue(), '00:35');
  setPickerValue('00', '00');
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  oldRow.replaceWith(oldRow.cloneNode(true));
  await tick(220);
  assert.deepEqual(calls.find(call => call.name === 'av2_override_attendance_time_cancellation')?.args, {
    p_source_id: 'source-1', p_final_minutes: 0,
  });
  assert.equal(document.querySelector('.av2-rr__time-cancel').dataset.minutes, '0');
});
test('saved 0:00 remains editable and return-to-automatic restores the original calculated minutes', async () => {
  calls.length = 0;
  report('0:00', 'תוקן ידנית (אוטומטי: 0:35)');
  await tick(40);
  assert.equal(document.querySelector('[data-av2-time-cancel-edit] input'), null);
  assert.equal(pickerValue(), '00:00');
  const button = [...document.querySelectorAll('[data-av2-time-cancel-edit] button')].find(el => el.textContent === 'חזור לחישוב האוטומטי');
  assert.ok(button); button.click(); await tick(10);
  assert.deepEqual(calls.find(call => call.name === 'av2_override_attendance_time_cancellation')?.args, {
    p_source_id: 'source-1', p_final_minutes: 35,
  });
  assert.equal(document.querySelector('.av2-rr__time-cancel').textContent, '0:35');
});
