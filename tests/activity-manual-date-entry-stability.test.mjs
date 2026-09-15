import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const bootstrapDom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = bootstrapDom.window;
globalThis.document = bootstrapDom.window.document;
globalThis.MutationObserver = bootstrapDom.window.MutationObserver;
globalThis.sessionStorage = bootstrapDom.window.sessionStorage;
globalThis.localStorage = bootstrapDom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: bootstrapDom.window.navigator, configurable: true });

const routine = await import('../frontend/src/activity-routine-stability-runtime.js');
routine.stopActivityRoutineStabilityRuntimeForTests();
const { generateSessionDatesFromFirstMeeting } = await import('../frontend/src/screens/shared/school-calendar-form-guard.js');

function school2027Form(date = '2026-10-13') {
  const dom = new JSDOM(`
    <form data-drawer-form data-activity-season="school_2027">
      <select name="activity_season"><option value="school_2027" selected>2027</option></select>
      <input type="date" name="start_date" value="${date}">
      <div data-meeting-dates-edit>
        <div class="activity-drawer__date-card"><span class="activity-drawer__weekday"></span><input type="date" data-meeting-idx="0" value="${date}"></div>
        <div class="activity-drawer__date-card"><span class="activity-drawer__weekday"></span><input type="date" data-meeting-idx="1"></div>
        <div class="activity-drawer__date-card"><span class="activity-drawer__weekday"></span><input type="date" data-meeting-idx="2"></div>
      </div>
      <section data-session-total="3"></section>
      <strong data-computed-end-display></strong>
    </form>
  `, { url: 'https://example.test/' });
  return dom.window.document.querySelector('form');
}

function trackPropertyWrites(element, property) {
  const proto = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(proto, property);
  assert.ok(descriptor?.get && descriptor?.set, `${property} must have a native getter/setter`);
  let writes = 0;
  Object.defineProperty(element, property, {
    configurable: true,
    get() {
      return descriptor.get.call(this);
    },
    set(value) {
      writes += 1;
      descriptor.set.call(this, value);
    }
  });
  return () => writes;
}

test('reapplying school_2027 bounds does not rewrite min/max on an active date input', () => {
  const form = school2027Form();
  routine.applySchool2027DateBounds(form);
  const input = form.querySelector('input[data-meeting-idx="0"]');
  assert.equal(input.min, routine.SCHOOL_2027_DATE_MIN);
  assert.equal(input.max, routine.SCHOOL_2027_DATE_MAX);

  const minWrites = trackPropertyWrites(input, 'min');
  const maxWrites = trackPropertyWrites(input, 'max');
  routine.applySchool2027DateBounds(form);

  assert.equal(minWrites(), 0);
  assert.equal(maxWrites(), 0);
});

test('manual first-date entry is preserved while later weekly meetings are generated', () => {
  const form = school2027Form('2026-10-13');
  const first = form.querySelector('input[data-meeting-idx="0"]');
  const firstValueWrites = trackPropertyWrites(first, 'value');
  first.focus();

  const result = generateSessionDatesFromFirstMeeting(form, []);
  const values = [...form.querySelectorAll('input[data-meeting-idx]')].map((input) => input.value);

  assert.equal(firstValueWrites(), 0);
  assert.equal(first.value, '2026-10-13');
  assert.deepEqual(values, ['2026-10-13', '2026-10-20', '2026-10-27']);
  assert.deepEqual(result.dates, values);
  assert.equal(form.ownerDocument.activeElement, first);
});

test('a blocked first meeting can still be moved to the next allowed week', () => {
  const form = school2027Form('2026-10-13');
  const first = form.querySelector('input[data-meeting-idx="0"]');
  const firstValueWrites = trackPropertyWrites(first, 'value');
  const holiday = [{
    title: 'חופשה',
    start_date: '2026-10-13',
    end_date: '2026-10-13',
    blocks_scheduling: true,
    show_on_main_calendar: true,
    is_active: true
  }];

  const result = generateSessionDatesFromFirstMeeting(form, holiday);

  assert.equal(firstValueWrites(), 1);
  assert.equal(first.value, '2026-10-20');
  assert.equal(result.dates[0], '2026-10-20');
  assert.deepEqual(result.deferred, [{ meeting: 1, skippedWeeks: 1 }]);
});

test('manual-date-entry release markers and cache version are deployed together', async () => {
  const [index, config, sw] = await Promise.all([
    fs.readFile(new URL('../index.html', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8')
  ]);

  assert.match(index, /activity-routine-stability-runtime\.js\?v=20260915-manual-date-entry-stability-v1/);
  assert.match(config, /activity-manual-date-entry-stability-20260915-v1/);
  assert.match(sw, /const CACHE_VERSION = 1718;/);
});
