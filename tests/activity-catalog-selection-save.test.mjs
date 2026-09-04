import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  catalogActivityChangesFromRows,
  selectedActivityCatalogIdentity,
  syncActivityCatalogIdentityFromName
} from '../frontend/src/activity-catalog-identity.js';

const CATALOG_6089 = {
  selection: { activity_name: 'ביומימיקרי', activity_no: '6089', gefen_number: '6089' },
  listRow: {
    activity_name: 'ביומימיקרי',
    activity_no: '6089',
    gefen_number: '6089',
    activity_type: 'course',
    meetings_count: 11
  },
  pricingRow: {
    activity_name: 'ביומימיקרי – המצאות בהשראה מן הטבע',
    activity_no: '6089',
    gefen_number: '6089',
    item_type: 'course',
    meetings_count: 11
  },
  courseRow: {
    short_name: 'ביומימיקרי',
    gefen_number: '6089',
    meetings_count: 11
  }
};

const NON_GEFEN_CATALOG_1001 = {
  selection: { activity_name: 'פעילות שאינה גפ״ן', activity_no: '1001', gefen_number: '' },
  listRow: {
    activity_name: 'פעילות שאינה גפ״ן',
    activity_no: '1001',
    gefen_number: '',
    activity_type: 'course'
  },
  pricingRow: {
    // The pricing record is not the activity catalog display source and must
    // not make this item a Gefen activity.
    activity_name: 'שם תמחור שונה',
    activity_no: '1001',
    gefen_number: '9999',
    item_type: 'course',
    meetings_count: 4
  }
};

function replacementChanges() {
  return catalogActivityChangesFromRows(CATALOG_6089);
}

test('67867 -> 6089 uses the canonical catalog identity and 11 canonical sessions without changing order confirmation', () => {
  assert.deepEqual(replacementChanges(), {
    activity_name: 'ביומימיקרי',
    activity_no: '6089',
    gefen_number: '6089',
    activity_name_override: false,
    sessions: 11,
    activity_type: 'course',
    item_type: 'course'
  });
  assert.equal(Object.hasOwn(replacementChanges(), 'exists_in_gefen'), false);
});

test('catalog replacement preserves the agreed activity price unless the user edits it', () => {
  const existing = { activity_no: '67867', gefen_number: '67867', sessions: 10, price: 9500 };
  const saved = { ...existing, ...replacementChanges() };
  assert.equal(saved.price, 9500);
  assert.equal('price' in replacementChanges(), false, 'catalog data must not set a general catalog price');

  const savedWithExplicitPrice = { ...existing, ...replacementChanges(), price: 9700 };
  assert.equal(savedWithExplicitPrice.price, 9700);
});

test('moving from 6089 to non-Gefen 1001 clears catalog identity but preserves manual order confirmation', () => {
  const existingGefenActivity = {
    activity_name: 'ביומימיקרי',
    activity_no: '6089',
    gefen_number: '6089',
    exists_in_gefen: true,
    price: 9500
  };
  const saved = {
    ...existingGefenActivity,
    ...catalogActivityChangesFromRows(NON_GEFEN_CATALOG_1001)
  };
  assert.equal(saved.activity_no, '1001');
  assert.equal(saved.gefen_number, null);
  assert.equal(saved.exists_in_gefen, true);
  assert.equal(saved.price, 9500);
  assert.notEqual(saved.gefen_number, '6089');
});

test('catalog replacement leaves local authority, school, manager, contacts, funding, assignment and dates intact', () => {
  const existing = {
    authority: 'רשות מקומית',
    school: 'בית ספר לדוגמה',
    contact_name: 'ישראל ישראלי',
    activity_manager: 'מנהלת פעילות',
    funding: 'מימון מוסכם',
    emp_id: '1234',
    instructor_name: 'מדריכה לדוגמה',
    start_date: '2026-09-01',
    end_date: '2026-11-01'
  };
  const reloaded = { ...existing, ...replacementChanges() };
  for (const [field, value] of Object.entries(existing)) {
    assert.equal(reloaded[field], value, `${field} must remain activity-local`);
  }
});

test('a duplicate display label resolves from the selected option stable ID, not the label text', () => {
  const dom = new JSDOM(`
    <form>
      <select data-role="activity-name-select">
        <option value="פעילות כפולה" data-activity-no="67867" data-gefen-number="67867">פעילות כפולה</option>
        <option value="פעילות כפולה" data-activity-no="6089" data-gefen-number="6089" data-meetings-count="11" data-activity-type="course" selected>פעילות כפולה</option>
      </select>
      <input data-activity-no value="67867">
      <input data-gefen-number value="67867">
    </form>
  `);
  const form = dom.window.document.querySelector('form');
  assert.deepEqual(selectedActivityCatalogIdentity(form), {
    isCatalogSelection: true,
    activity_name: 'פעילות כפולה',
    activity_no: '6089',
    gefen_number: '6089',
    meetings_count: 11,
    activity_type: 'course'
  });
  syncActivityCatalogIdentityFromName(form);
  assert.equal(form.querySelector('[data-activity-no]').value, '6089');
  assert.equal(form.querySelector('[data-gefen-number]').value, '6089');
});

test('a regular catalog selection clears the manual activity-name override', () => {
  assert.equal(replacementChanges().activity_name_override, false);
});

test('reopening after save returns the same canonical catalog fields', () => {
  const reloaded = {
    activity_name: 'קודם',
    activity_no: '67867',
    gefen_number: '67867',
    sessions: 10,
    price: 9500,
    ...replacementChanges()
  };
  assert.deepEqual(
    {
      activity_name: reloaded.activity_name,
      activity_no: reloaded.activity_no,
      gefen_number: reloaded.gefen_number,
      sessions: reloaded.sessions,
      activity_name_override: reloaded.activity_name_override,
      price: reloaded.price
    },
    {
      activity_name: 'ביומימיקרי',
      activity_no: '6089',
      gefen_number: '6089',
      sessions: 11,
      activity_name_override: false,
      price: 9500
    }
  );
});

test('the API resolves catalog replacements by stable IDs in both direct-save and edit-request paths', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(source, /catalogAwareChanges\.activity_name_override === false/);
  assert.match(source, /resolveCatalogActivityChanges\(catalogAwareChanges\)/);
  assert.match(source, /catalogText\(catalogAwareChanges\.activity_no\).*catalogText\(catalogAwareChanges\.gefen_number\)/s);
  assert.match(source, /requestedValues\.activity_name_override === false/);
  assert.match(source, /if \(!listRow && !pricingRow && !courseRow\) throw new Error\('catalog_activity_not_found'\)/);
  assert.match(source, /isDateField \|\| key === 'gefen_number'/);
  assert.doesNotMatch(
    source.slice(source.indexOf('async function resolveCatalogActivityChanges'), source.indexOf('async function validateActivityInstructorBindingsOrThrow')),
    /activity_name\)\.eq|\.eq\('activity_name'/,
    'catalog resolution must not query by the browser label'
  );
});
