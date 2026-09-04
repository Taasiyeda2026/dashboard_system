import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.CustomEvent = dom.window.CustomEvent;

const { activityEditLocationChanges, syncActivityEditLocation } = await import(
  '../frontend/src/screens/shared/bind-activity-edit-form.js'
);

const authorities = [
  { id: 1, name: 'רשות א' },
  { id: 2, name: 'רשות ב' },
];
const schools = [
  { school_id: 10, authority_id: 1, name: 'בית ספר A' },
  { school_id: 11, authority_id: 1, name: 'בית ספר B' },
  { school_id: 20, authority_id: 2, name: 'בית ספר ג' },
];

function editForm() {
  document.body.innerHTML = `<form
    data-authority-records="${encodeURIComponent(JSON.stringify(authorities))}"
    data-school-records="${encodeURIComponent(JSON.stringify(schools))}">
    <select name="authority" data-role="activity-authority">
      <option value="רשות א" selected>רשות א</option>
      <option value="רשות ב">רשות ב</option>
    </select>
    <input name="authority_id" value="1" data-role="activity-authority-id">
    <input name="school" value="בית ספר A" data-role="activity-school">
    <input name="school_id" value="10" data-role="activity-school-id">
    <datalist data-role="activity-school-options"></datalist>
  </form>`;
  return document.querySelector('form');
}

test('editing school A to B sends the canonical B ID with all location fields', () => {
  const form = editForm();
  form.querySelector('[name="school"]').value = 'בית ספר B';
  const location = syncActivityEditLocation(form);
  const payload = activityEditLocationChanges({
    authority: 'רשות א', authority_id: '1', school: 'בית ספר A', school_id: '10',
  }, location.values);

  assert.equal(location.valid, true);
  assert.deepEqual(payload, {
    authority: 'רשות א', authority_id: '1', school: 'בית ספר B', school_id: '11',
  });
});

test('changing authority filters schools and clears a school from the old authority', () => {
  const form = editForm();
  form.querySelector('[name="authority"]').value = 'רשות ב';
  const location = syncActivityEditLocation(form, { resetInvalidSchool: true });

  assert.equal(form.querySelector('[name="authority_id"]').value, '2');
  assert.equal(form.querySelector('[name="school"]').value, '');
  assert.equal(form.querySelector('[name="school_id"]').value, '');
  assert.deepEqual(
    [...form.querySelector('[data-role="activity-school-options"]').options].map((option) => option.value),
    ['בית ספר ג'],
  );
  assert.equal(location.valid, true);
});

test('unresolved school text cannot produce a valid edit payload', () => {
  const form = editForm();
  form.querySelector('[name="school"]').value = 'בית ספר לא קיים';
  const location = syncActivityEditLocation(form);

  assert.equal(location.valid, false);
  assert.equal(form.querySelector('[name="school_id"]').value, '');
});
