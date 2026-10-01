import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://example.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.AbortController = dom.window.AbortController;

const { activityEditLocationChanges, activityEditLocationForSave, bindActivityEditForm, captureActivityEditLocationValues, handleActivityAuthorityChange, syncActivityEditLocation } = await import(
  '../frontend/src/screens/shared/bind-activity-edit-form.js'
);
const { enhanceActivityDrawerForm } = await import('../frontend/src/activity-drawer-inline-layout.js');
const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');

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
    <div data-role="activity-school-options" hidden></div>
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
  const location = handleActivityAuthorityChange(form);

  assert.equal(form.querySelector('[name="authority_id"]').value, '2');
  assert.equal(form.querySelector('[name="school"]').value, '');
  assert.equal(form.querySelector('[name="school_id"]').value, '');
  assert.deepEqual(
    [...form.querySelectorAll('[data-role="activity-school-options"] [data-school-name]')].map((option) => option.dataset.schoolName),
    ['בית ספר ג'],
  );
  assert.equal(form.querySelector('[data-role="activity-school-options"]').hidden, false);
  assert.equal(form.querySelector('[name="school"]').getAttribute('aria-expanded'), 'true');
  assert.equal(document.activeElement, form.querySelector('[name="school"]'));
  assert.equal(location.valid, true);
});

test('unresolved school text cannot produce a valid edit payload', () => {
  const form = editForm();
  form.querySelector('[name="school"]').value = 'בית ספר לא קיים';
  const location = syncActivityEditLocation(form);

  assert.equal(location.valid, false);
  assert.equal(form.querySelector('[name="school_id"]').value, '');
});

test('missing DB authority ID is still sent when another field is the only user edit', () => {
  const form = editForm();
  form.querySelector('[name="school"]').value = "מקיף ה' כללי";
  form.querySelector('[name="school_id"]').value = '250';
  form.dataset.schoolRecords = encodeURIComponent(JSON.stringify([
    { school_id: 250, authority_id: 268, name: "מקיף ה' כללי" },
  ]));
  form.dataset.authorityRecords = encodeURIComponent(JSON.stringify([
    { id: 268, name: 'אשדוד' },
  ]));
  form.querySelector('[name="authority"]').innerHTML = '<option value="אשדוד" selected>אשדוד</option>';
  form.querySelector('[name="authority_id"]').value = '';

  const dbLocation = captureActivityEditLocationValues(form);
  const location = syncActivityEditLocation(form);
  const payload = activityEditLocationChanges(dbLocation, location.values);

  assert.equal(location.valid, true);
  assert.deepEqual(payload, {
    authority: 'אשדוד',
    authority_id: '268',
    school: "מקיף ה' כללי",
    school_id: '250',
  });
});

test('rendered existing activity keeps canonical IDs and saves the new authority school after inline enhancement', () => {
  const settings = { dropdown_options: {
    authority: ['רשות א', 'רשות ב'], authority_records: authorities, school_records: schools
  } };
  document.body.innerHTML = `<div class="ds-drawer__content">${activityWorkDrawerHtml({
    row_id: 'LOCATION-FLOW', activity_type: 'course', activity_name: 'בדיקה', activity_season: 'school_2027',
    authority: 'רשות א', authority_id: '1', school: 'בית ספר A', school_id: '10'
  }, { settings, canEdit: true, canDirectEdit: true })}</div>`;
  const form = document.querySelector('[data-drawer-form]');
  assert.equal(enhanceActivityDrawerForm(form), true);
  assert.equal(form.querySelector('[name="authority_id"]')?.value, '1');
  assert.equal(form.querySelector('[name="school_id"]')?.value, '10');

  form.dataset.editing = 'yes';
  form.querySelector('[name="authority"]').value = 'רשות ב';
  const cleared = handleActivityAuthorityChange(form);
  assert.equal(form.querySelector('[name="authority_id"]').value, '2');
  assert.equal(form.querySelector('[name="school"]').value, '');
  assert.equal(form.querySelector('[name="school_id"]').value, '');
  assert.equal(form.querySelector('[data-role="activity-school-options"]').hidden, false);
  assert.deepEqual([...form.querySelectorAll('[data-school-name]')].map((option) => option.dataset.schoolName), ['בית ספר ג']);

  form.querySelector('[name="school"]').value = 'בית ספר ג';
  const selected = syncActivityEditLocation(form);
  const payload = activityEditLocationChanges({ authority: 'רשות א', authority_id: '1', school: 'בית ספר A', school_id: '10' }, selected.values);
  assert.equal(cleared.valid, true);
  assert.deepEqual(payload, { authority: 'רשות ב', authority_id: '2', school: 'בית ספר ג', school_id: '20' });
});

test('status-only edit preserves an existing canonical location when the drawer catalog is stale', () => {
  const form = editForm();
  form.querySelector('[name="authority"]').innerHTML = '<option value="פרדס חנה-כרכור" selected>פרדס חנה-כרכור</option>';
  form.querySelector('[name="authority_id"]').value = '439';
  form.querySelector('[name="school"]').value = 'מרחבים';
  form.querySelector('[name="school_id"]').value = '2364';
  form._initialLocationValues = captureActivityEditLocationValues(form);
  form.dataset.authorityRecords = encodeURIComponent(JSON.stringify(authorities));
  form.dataset.schoolRecords = encodeURIComponent(JSON.stringify(schools));

  // Opening the stale drawer used to erase the IDs before a status-only save.
  syncActivityEditLocation(form);
  const location = activityEditLocationForSave(form);

  assert.equal(location.valid, true);
  assert.deepEqual(location.values, {
    authority: 'פרדס חנה-כרכור', authority_id: '439', school: 'מרחבים', school_id: '2364',
  });
  assert.equal(form.querySelector('[name="authority_id"]').value, '439');
  assert.equal(form.querySelector('[name="school_id"]').value, '2364');
  assert.deepEqual(activityEditLocationChanges(form._initialLocationValues, location.values), {});
});

test('changing authority without a valid school is blocked at save', () => {
  const form = editForm();
  form._initialLocationValues = captureActivityEditLocationValues(form);
  form.querySelector('[name="authority"]').value = 'רשות ב';

  const location = activityEditLocationForSave(form);

  assert.equal(location.valid, false);
  assert.equal(location.values.authority_id, '2');
  assert.equal(location.values.school_id, '');
});

test('changing to a school owned by another authority is blocked at save', () => {
  const form = editForm();
  form._initialLocationValues = captureActivityEditLocationValues(form);
  form.querySelector('[name="school"]').value = 'בית ספר ג';

  const location = activityEditLocationForSave(form);

  assert.equal(location.valid, false);
  assert.equal(location.values.authority_id, '1');
  assert.equal(location.values.school_id, '');
});

test('changing to a catalog-valid authority and school saves their canonical IDs', () => {
  const form = editForm();
  form._initialLocationValues = captureActivityEditLocationValues(form);
  form.querySelector('[name="authority"]').value = 'רשות ב';
  form.querySelector('[name="school"]').value = 'בית ספר ג';

  const location = activityEditLocationForSave(form);

  assert.equal(location.valid, true);
  assert.deepEqual(activityEditLocationChanges(form._initialLocationValues, location.values), {
    authority: 'רשות ב', authority_id: '2', school: 'בית ספר ג', school_id: '20',
  });
});

test('activityEditLocationChanges still returns all location fields only when one changes', () => {
  const initial = { authority: 'רשות א', authority_id: '1', school: 'בית ספר A', school_id: '10' };

  assert.deepEqual(activityEditLocationChanges(initial, { ...initial }), {});
  assert.deepEqual(activityEditLocationChanges(initial, { ...initial, school: 'בית ספר B', school_id: '11' }), {
    authority: 'רשות א', authority_id: '1', school: 'בית ספר B', school_id: '11',
  });
});

test('activities summary projection includes both canonical location IDs', async () => {
  const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const tableColumns = apiSource.match(/const ACTIVITY_TABLE_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || '';

  assert.match(tableColumns, /'authority_id'/);
  assert.match(tableColumns, /'school_id'/);
});

test('immediate edit from summary row preserves location IDs and permits a status-only save before detail resolves', async () => {
  const summaryRow = {
    RowID: 'SUMMARY-439-2364',
    source_sheet: 'activities',
    activity_type: 'course',
    item_type: 'course',
    activity_name: 'פעילות קיימת',
    activity_no: 'ACT-439',
    activity_season: 'school_2027',
    status: 'פתוח',
    authority: 'פרדס חנה-כרכור',
    authority_id: 439,
    school: 'מרחבים',
    school_id: 2364,
  };
  const settings = { dropdown_options: {
    activity_names: [{ label: 'פעילות קיימת', activity_no: 'ACT-439', activity_type: 'course' }],
    authority_records: [],
    school_records: [],
  } };
  document.body.innerHTML = `<main id="summary-drawer">${activityWorkDrawerHtml(summaryRow, {
    settings, canEdit: true, canDirectEdit: true,
  })}</main>`;
  const root = document.querySelector('#summary-drawer');
  const saved = [];

  bindActivityEditForm(root, {
    api: { saveActivity: async (payload) => {
      saved.push(payload);
      return { row: { row_id: summaryRow.RowID, ...summaryRow, ...payload.changes } };
    } },
    appState: { clientSettings: settings, user: { can_edit_direct: true } },
  });

  const form = root.querySelector('[data-drawer-form]');
  assert.equal(form.querySelector('[name="authority_id"]').value, '439');
  assert.equal(form.querySelector('[name="school_id"]').value, '2364');
  assert.deepEqual(form._initialLocationValues, {
    authority: 'פרדס חנה-כרכור', authority_id: '439', school: 'מרחבים', school_id: '2364',
  });

  // This click deliberately happens before any activityDetail response can replace the summary drawer.
  root.querySelector('[data-action="start-edit"]').click();
  form.querySelector('[name="status"]').value = 'סגור';
  root.querySelector('[data-action="save-edit"]').click();
  await new Promise((resolve) => window.setTimeout(resolve, 25));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].changes.status, 'סגור');
  assert.equal(Object.hasOwn(saved[0].changes, 'authority'), false);
  assert.equal(Object.hasOwn(saved[0].changes, 'authority_id'), false);
  assert.equal(Object.hasOwn(saved[0].changes, 'school'), false);
  assert.equal(Object.hasOwn(saved[0].changes, 'school_id'), false);
  assert.equal(form.querySelector('.ds-activity-edit-status').classList.contains('is-error'), false);
});


test('status-only close ignores catalog metadata drift until the user actually changes the activity catalog', async () => {
  const activityName = 'תמיר - המחזור מתחיל בבית';
  const row = {
    RowID: 'TAMIR-60025',
    source_sheet: 'activities',
    activity_type: 'workshop',
    item_type: 'workshop',
    activity_name: activityName,
    activity_no: '60025',
    gefen_number: null,
    activity_name_override: false,
    activity_season: 'school_2027',
    status: 'פתוח',
    authority: 'פרדס חנה-כרכור',
    authority_id: 439,
    school: 'מרחבים',
    school_id: 2364,
  };
  const settings = { dropdown_options: {
    activity_names: [{
      label: activityName,
      activity_name: activityName,
      activity_no: '60025',
      gefen_number: '',
      activity_type: 'workshop',
      parent_value: 'workshop',
      active: true,
    }],
    authority_records: [],
    school_records: [],
  } };
  document.body.innerHTML = `<main id="tamir-status-drawer">${activityWorkDrawerHtml(row, {
    settings, canEdit: true, canDirectEdit: true,
  })}</main>`;
  const root = document.querySelector('#tamir-status-drawer');
  const saved = [];

  bindActivityEditForm(root, {
    api: { saveActivity: async (payload) => {
      saved.push(payload);
      return { row: { row_id: row.RowID, ...row, ...payload.changes } };
    } },
    appState: { clientSettings: settings, user: { can_edit_direct: true } },
  });

  const form = root.querySelector('[data-drawer-form]');
  root.querySelector('[data-action="start-edit"]').click();
  assert.equal(form.dataset.activityCatalogDirty, 'no');

  // Reproduce the production failure mode: drawer/catalog rebuilding mutates
  // option metadata without any user change to the activity name/type.
  const selectedOption = form.querySelector('[data-role="activity-name-select"]')?.selectedOptions?.[0];
  assert.ok(selectedOption);
  selectedOption.dataset.activityNo = activityName;
  selectedOption.dataset.gefenNumber = activityName;

  form.querySelector('[name="status"]').value = 'סגור';
  root.querySelector('[data-action="save-edit"]').click();
  await new Promise((resolve) => window.setTimeout(resolve, 25));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].changes.status, 'סגור');
  for (const key of ['activity_name', 'activity_no', 'gefen_number', 'activity_name_override']) {
    assert.equal(Object.hasOwn(saved[0].changes, key), false, `${key} must not be synthesized by a status-only save`);
  }
});
