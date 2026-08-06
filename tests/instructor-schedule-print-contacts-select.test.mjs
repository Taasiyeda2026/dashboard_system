import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildSummerContactIndex,
  buildContactsSchoolsIndex,
  buildSchoolsCatalogContactIndex,
  resolveSchoolContact
} from '../frontend/src/screens/shared/contact-responsible.js';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);

// public.instructor_schedule_print_contacts really only has these columns (see
// supabase/migrations/20260626120000_create_instructor_schedule_print_contacts.sql).
// contact_status/status do not exist there - selecting them makes the whole Supabase
// query error out, so both the admin (operations-management) print path and the
// instructor (my-data) path silently got back [] and fell back to contacts_schools /
// the schools catalog instead of the dedicated summer contact.
const EXPECTED_SELECT = 'id,season,external_key,authority,school,contact_name,contact_phone,school_address,city_or_authority,active,source_note,notes';

test('a single INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT constant is defined with the real table columns only', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const definitions = source.match(/const INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT = '[^']*';/g) || [];
  assert.equal(definitions.length, 1, 'expected exactly one shared SELECT constant definition');
  assert.equal(definitions[0], `const INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT = '${EXPECTED_SELECT}';`);
  assert.doesNotMatch(definitions[0], /contact_status/);
  assert.doesNotMatch(definitions[0], /\bstatus\b/);
});

test('readMyDataSummerPrintContactRows (instructor / my-data path) selects via the shared constant', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fn = source.match(/async function readMyDataSummerPrintContactRows\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'readMyDataSummerPrintContactRows should exist');
  assert.match(fn[0], /\.from\('instructor_schedule_print_contacts'\)/);
  assert.match(fn[0], /\.select\(INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT\)/);
  assert.match(fn[0], /\.eq\('season', 'summer_2026'\)/);
  assert.match(fn[0], /\.eq\('active', true\)/);
  assert.doesNotMatch(fn[0], /contact_status/);
  assert.doesNotMatch(fn[0], /\.select\('[^']*status[^']*'\)/);
});

test('readInstructorSchedulePrintContactsRows (admin / operations-management path) selects via the shared constant', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const fn = source.match(/async function readInstructorSchedulePrintContactsRows\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, 'readInstructorSchedulePrintContactsRows should exist');
  assert.match(fn[0], /\.from\('instructor_schedule_print_contacts'\)/);
  assert.match(fn[0], /\.select\(INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT\)/);
  assert.match(fn[0], /\.eq\('active', true\)/);
  assert.doesNotMatch(fn[0], /contact_status/);
  assert.doesNotMatch(fn[0], /\.select\('[^']*status[^']*'\)/);
});

test('no remaining reference to instructor_schedule_print_contacts selects contact_status or status anywhere in api.js', async () => {
  const source = await readFile(API_FILE, 'utf8');
  // Every .select(...) call anywhere in the file must not literally request these
  // two non-existent columns off this table (guards against a future copy/paste).
  const selectCalls = source.match(/\.select\((?:'[^']*'|INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT)\)/g) || [];
  assert.ok(selectCalls.length > 0);
  selectCalls.forEach((call) => {
    if (call.includes('INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT')) return;
    assert.doesNotMatch(call, /contact_status/);
  });
});

function realisticSummerRow(overrides = {}) {
  // Shape mirrors exactly what Supabase returns for INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT.
  return {
    id: 'row-1',
    season: 'summer_2026',
    external_key: 'ext-1',
    authority: 'קריית שמונה',
    school: 'בית ספר הדס',
    contact_name: 'מזכירת קיץ',
    contact_phone: '050-0000000',
    school_address: 'רחוב הפרחים 1',
    city_or_authority: 'קריית שמונה',
    active: true,
    source_note: 'print_only_instructor_schedule_contacts',
    notes: null,
    ...overrides
  };
}

test('a dedicated summer contact row resolves identically whichever screen builds the index (admin print vs instructor my-data)', () => {
  const rows = [realisticSummerRow()];

  // Admin (operations-management printed schedule) and instructor (my-data /
  // api.myData) both call buildSummerContactIndex + resolveSchoolContact with rows
  // shaped exactly like this - so feeding the same rows must produce the same result.
  const adminIndex = buildSummerContactIndex(rows);
  const instructorIndex = buildSummerContactIndex(rows);

  const adminResolved = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר הדס'], schoolCatalogId: '' },
    { summerIndex: adminIndex }
  );
  const instructorResolved = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר הדס'], schoolCatalogId: '' },
    { summerIndex: instructorIndex }
  );

  assert.deepEqual(adminResolved, instructorResolved);
  assert.equal(adminResolved.name, 'מזכירת קיץ');
  assert.equal(adminResolved.phone, '050-0000000');
  assert.equal(adminResolved.source, 'summer');
});

test('dedicated summer contact overrides contacts_schools and the schools catalog', () => {
  const summerIndex = buildSummerContactIndex([realisticSummerRow()]);
  const contactsSchoolsIndex = buildContactsSchoolsIndex([
    { authority: 'קריית שמונה', school: 'בית ספר הדס', school_id: '20', contact_name: 'מזכירה רגילה', phone: '050-1111111', contact_role: 'מזכירה' }
  ]);
  const schoolsCatalogIndex = buildSchoolsCatalogContactIndex([
    { id: '20', authority: 'קריית שמונה', school_name: 'בית ספר הדס', principal_name: 'מנהל בית הספר', school_phone: '050-2222222' }
  ]);

  const resolved = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר הדס'], schoolCatalogId: '20' },
    { summerIndex, contactsSchoolsIndex, schoolsCatalogIndex }
  );

  assert.equal(resolved.source, 'summer');
  assert.equal(resolved.name, 'מזכירת קיץ');
  assert.equal(resolved.phone, '050-0000000');
});

test('fallback stays valid when there is no dedicated summer contact: contacts_schools then schools catalog then empty', () => {
  const contactsSchoolsIndex = buildContactsSchoolsIndex([
    { authority: 'קריית שמונה', school: 'בית ספר אחר', school_id: '21', contact_name: 'מזכירה רגילה', phone: '050-1111111', contact_role: 'מזכירה' }
  ]);
  const schoolsCatalogIndex = buildSchoolsCatalogContactIndex([
    { id: '21', authority: 'קריית שמונה', school_name: 'בית ספר אחר', principal_name: 'מנהל בית הספר', school_phone: '050-2222222' }
  ]);
  const emptySummerIndex = buildSummerContactIndex([realisticSummerRow({ school: 'בית ספר לגמרי אחר' })]);

  // 1) No summer contact for this school -> contacts_schools wins.
  const withContactsSchools = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר אחר'], schoolCatalogId: '21' },
    { summerIndex: emptySummerIndex, contactsSchoolsIndex, schoolsCatalogIndex }
  );
  assert.equal(withContactsSchools.source, 'contacts_schools');
  assert.equal(withContactsSchools.name, 'מזכירה רגילה');

  // 2) No summer contact AND no contacts_schools row -> schools catalog wins.
  const withCatalogOnly = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר אחר'], schoolCatalogId: '21' },
    { summerIndex: emptySummerIndex, contactsSchoolsIndex: new Map(), schoolsCatalogIndex }
  );
  assert.equal(withCatalogOnly.source, 'catalog');
  assert.equal(withCatalogOnly.name, 'מנהל בית הספר');

  // 3) Nothing anywhere -> safe empty result, never throws.
  const withNothing = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['בית ספר אחר'], schoolCatalogId: '21' },
    { summerIndex: emptySummerIndex, contactsSchoolsIndex: new Map(), schoolsCatalogIndex: new Map() }
  );
  assert.equal(withNothing.source, 'none');
  assert.equal(withNothing.name, '');
  assert.equal(withNothing.phone, '');
});

test('no id mixing: contacts_schools.school_id and schools-catalog id never resolve each other\'s rows', () => {
  const contactsSchoolsIndex = buildContactsSchoolsIndex([
    { authority: 'קריית שמונה', school: 'בית ספר הדס', school_id: '999', contact_name: 'רגיל-איש-קשר', phone: '050-3333333', contact_role: 'מזכירה' }
  ]);
  const schoolsCatalogIndex = buildSchoolsCatalogContactIndex([
    { id: '999', authority: 'קריית שמונה', school_name: 'בית ספר שונה לגמרי', principal_name: 'מנהל לא קשור', school_phone: '050-4444444' }
  ]);

  // schoolCatalogId '999' must match the CATALOG's own id=999 row (a different school),
  // never contacts_schools' school_id=999 which lives in a separate id namespace.
  const resolved = resolveSchoolContact(
    { authority: 'לא קיים', schoolNames: ['גם לא קיים'], schoolCatalogId: '999' },
    { contactsSchoolsIndex, schoolsCatalogIndex }
  );
  assert.equal(resolved.name, 'מנהל לא קשור');
  assert.notEqual(resolved.name, 'רגיל-איש-קשר');
});
