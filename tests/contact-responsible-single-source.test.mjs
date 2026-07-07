import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContactResponsibleIndex,
  findContactResponsibleGroup,
  contactResponsibleGroupsArray,
  isUserResponsibleForGroup,
  resolveSchoolContact,
  buildSummerContactIndex,
  buildContactsSchoolsIndex,
  buildSchoolsCatalogContactIndex,
  normalizeContactMatchText,
  looseContactMatchText
} from '../frontend/src/screens/shared/contact-responsible.js';

const DATE = '2026-07-21';

function activity(overrides = {}) {
  return {
    RowID: 'r1',
    start_date: DATE,
    start_time: '08:00',
    school: 'בית ספר מגנים',
    authority: 'קריית שמונה',
    instructor_name: 'אייל יוחאי',
    emp_id: '1525',
    ...overrides
  };
}

test('manager and instructor resolve the identical contact responsible for the same date+school', () => {
  const rows = [
    activity({ RowID: 'A1', start_time: '08:00', school_id: '55', instructor_name: 'אייל יוחאי', emp_id: '1525' }),
    activity({ RowID: 'A2', start_time: '09:00', school_id: '55', instructor_name: 'הילה רוזן', emp_id: '1500', instructor_name_2: '', emp_id_2: '' })
  ];
  const index = buildContactResponsibleIndex(rows, []);

  // "Manager view": read every group directly off the index.
  const managerGroups = contactResponsibleGroupsArray(index);
  assert.equal(managerGroups.length, 1);
  const managerAnswer = managerGroups[0].responsibleName;

  // "Instructor view": resolve starting from the instructor's own row only.
  const instructorAnswer = findContactResponsibleGroup(rows[1], index).responsibleName;

  assert.equal(managerAnswer, instructorAnswer);
  assert.equal(managerAnswer, 'אייל יוחאי'); // deterministic: earliest activity's primary instructor
});

test('every instructor scheduled at the same school+date resolves to the same responsible', () => {
  const rows = [
    activity({ RowID: 'B1', start_time: '08:00', school_id: '7', instructor_name: 'דנה', emp_id: '1' }),
    activity({ RowID: 'B2', start_time: '09:00', school_id: '7', instructor_name: 'רון', emp_id: '2' }),
    activity({ RowID: 'B3', start_time: '10:00', school_id: '7', instructor_name: 'מיה', emp_id: '3' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  const answers = rows.map((row) => findContactResponsibleGroup(row, index).responsibleName);
  assert.deepEqual(new Set(answers), new Set(['דנה']));
});

test('rows with school_id and rows without school_id for the same school merge into one group', () => {
  const rows = [
    activity({ RowID: 'C1', start_time: '08:00', school: 'בית ספר מגנים', school_id: '55', instructor_name: 'אייל יוחאי', emp_id: '1525' }),
    activity({ RowID: 'C2', start_time: '09:00', school: 'מגנים', school_id: '', instructor_name: 'הילה רוזן', emp_id: '1500' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  assert.equal(contactResponsibleGroupsArray(index).length, 1);
  const g1 = findContactResponsibleGroup(rows[0], index);
  const g2 = findContactResponsibleGroup(rows[1], index);
  assert.equal(g1.key, g2.key);
  assert.deepEqual(g1.instructors.map((i) => i.name).sort(), ['אייל יוחאי', 'הילה רוזן']);
});

test('a manual override in activity_school_contact_responsibles always wins over the fallback', () => {
  const rows = [
    activity({ RowID: 'D1', start_time: '08:00', school_id: '55', instructor_name: 'אייל יוחאי', emp_id: '1525' }),
    activity({ RowID: 'D2', start_time: '09:00', school_id: '55', instructor_name: 'הילה רוזן', emp_id: '1500' })
  ];
  const overrides = [{ activity_date: DATE, school_id: '55', school: '', responsible_emp_id: '1500', responsible_name: 'הילה רוזן' }];
  const index = buildContactResponsibleIndex(rows, overrides);
  const group = findContactResponsibleGroup(rows[0], index);
  assert.equal(group.responsibleEmpId, '1500');
  assert.equal(group.responsibleName, 'הילה רוזן');
  assert.equal(group.responsibleSource, 'override');
});

test('override matches by school text even when the override row was saved without a school_id', () => {
  const rows = [activity({ RowID: 'E1', school_id: '', school: 'בית ספר מגנים', instructor_name: 'אייל יוחאי', emp_id: '1525' })];
  const overrides = [{ activity_date: DATE, school_id: '', school: 'מגנים', responsible_emp_id: '9', responsible_name: 'מנהל תפעול' }];
  const index = buildContactResponsibleIndex(rows, overrides);
  const group = findContactResponsibleGroup(rows[0], index);
  assert.equal(group.responsibleName, 'מנהל תפעול');
  assert.equal(group.responsibleSource, 'override');
});

test('fallback responsible is deterministic and does not depend on which rows the caller passes as "own rows"', () => {
  const rows = [
    activity({ RowID: 'F1', start_time: '11:00', school_id: '3', instructor_name: 'ג׳', emp_id: '3' }),
    activity({ RowID: 'F2', start_time: '08:00', school_id: '3', instructor_name: 'א׳', emp_id: '1' }),
    activity({ RowID: 'F3', start_time: '09:30', school_id: '3', instructor_name: 'ב׳', emp_id: '2' })
  ];
  // Build the index from the full dataset in one order...
  const indexA = buildContactResponsibleIndex(rows, []);
  // ...and again from a differently-ordered/reversed dataset (simulating a different
  // fetch/user session) - the resolved responsible must not change.
  const indexB = buildContactResponsibleIndex([...rows].reverse(), []);
  const nameA = findContactResponsibleGroup(rows[0], indexA).responsibleName;
  const nameB = findContactResponsibleGroup(rows[0], indexB).responsibleName;
  assert.equal(nameA, nameB);
  assert.equal(nameA, 'א׳'); // earliest start_time (08:00) wins, regardless of array order
});

test('an instructor who is not responsible is not flagged responsible; the responsible one is', () => {
  const rows = [
    activity({ RowID: 'G1', start_time: '08:00', school_id: '9', instructor_name: 'אייל יוחאי', emp_id: '1525' }),
    activity({ RowID: 'G2', start_time: '09:00', school_id: '9', instructor_name: 'הילה רוזן', emp_id: '1500' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  const group = findContactResponsibleGroup(rows[0], index);
  assert.equal(isUserResponsibleForGroup(group, ['1525']), true);
  assert.equal(isUserResponsibleForGroup(group, ['1500']), false);
});

test('managers and instructors resolve the same responsible AND the same school contact for a printed schedule', () => {
  const rows = [
    activity({ RowID: 'H1', start_time: '08:00', school_id: '20', school: 'בית ספר הדס', instructor_name: 'אייל יוחאי', emp_id: '1525' })
  ];
  const overrides = [];
  const responsibleIndex = buildContactResponsibleIndex(rows, overrides);
  const summerIndex = buildSummerContactIndex([
    { season: 'summer_2026', active: true, authority: 'קריית שמונה', school: 'בית ספר הדס', contact_name: 'מזכירת קיץ', contact_phone: '050-0000000' }
  ]);

  // Manager's printed schedule path and the instructor's own screen both call the
  // exact same two functions with the exact same inputs - so they cannot diverge.
  const managerResponsible = findContactResponsibleGroup(rows[0], responsibleIndex).responsibleName;
  const managerContact = resolveSchoolContact({ authority: 'קריית שמונה', schoolNames: ['בית ספר הדס'], schoolCatalogId: '' }, { summerIndex });
  const instructorResponsible = findContactResponsibleGroup(rows[0], responsibleIndex).responsibleName;
  const instructorContact = resolveSchoolContact({ authority: 'קריית שמונה', schoolNames: ['בית ספר הדס'], schoolCatalogId: '' }, { summerIndex });

  assert.equal(managerResponsible, instructorResponsible);
  assert.deepEqual(managerContact, instructorContact);
  assert.equal(managerContact.name, 'מזכירת קיץ');
});

test('school contact resolution never changes based on who is asking - only on the data', () => {
  const summerIndex = buildSummerContactIndex([
    { season: 'summer_2026', active: true, authority: 'א', school: 'ב', contact_name: 'קשר קיץ', contact_phone: '050-1111111' }
  ]);
  const args = [{ authority: 'א', schoolNames: ['ב'], schoolCatalogId: '' }, { summerIndex }];
  const first = resolveSchoolContact(...args);
  const second = resolveSchoolContact(...args);
  assert.deepEqual(first, second);
});

test('school contact priority: dedicated summer contact wins, contacts_schools and catalog fill missing fields only', () => {
  const summerIndex = buildSummerContactIndex([
    { season: 'summer_2026', active: true, authority: 'קריית שמונה', school: 'מגנים', contact_name: 'קיץ-איש-קשר', contact_phone: '050-1111111' }
  ]);
  const contactsSchoolsIndex = buildContactsSchoolsIndex([
    { authority: 'קריית שמונה', school: 'מגנים', school_id: '999', contact_name: 'רגיל-איש-קשר', phone: '050-2222222', contact_role: 'מזכירה' }
  ]);
  const schoolsCatalogIndex = buildSchoolsCatalogContactIndex([
    { id: '55', authority: 'קריית שמונה', school_name: 'מגנים', principal_name: 'מנהל בית הספר', school_phone: '050-4444444', institution_address: 'רחוב הדקל 5' },
    { id: '999', authority: 'קריית שמונה', school_name: 'שונה לגמרי', principal_name: 'לא רלוונטי', school_phone: '000-0000000' }
  ]);

  const resolved = resolveSchoolContact(
    { authority: 'קריית שמונה', schoolNames: ['מגנים'], schoolCatalogId: '55' },
    { summerIndex, contactsSchoolsIndex, schoolsCatalogIndex }
  );

  assert.equal(resolved.source, 'summer');
  assert.equal(resolved.name, 'קיץ-איש-קשר');
  assert.equal(resolved.phone, '050-1111111');
  // role is missing from the summer tier -> filled from contacts_schools
  assert.equal(resolved.role, 'מזכירה');
  // address is missing from both summer and contacts_schools -> filled from the
  // schools catalog, matched by schools.id=55, never by contacts_schools.id=999
  // (which is a completely different row in the catalog with unrelated data).
  assert.equal(resolved.address, 'רחוב הדקל 5');
});

test('school catalog id (schools.id) is never confused with contacts_schools.id', () => {
  const contactsSchoolsIndex = buildContactsSchoolsIndex([
    { authority: 'א', school: 'ב', school_id: '42', contact_name: 'איש קשר רגיל', phone: '050-0000001' }
  ]);
  const schoolsCatalogIndex = buildSchoolsCatalogContactIndex([
    { id: '42', authority: 'א', school_name: 'בית ספר לא קשור', principal_name: 'מנהל אחר', school_phone: '050-9999999' }
  ]);
  // schoolCatalogId=42 must resolve against the SCHOOLS CATALOG's own id=42 row
  // (a different, unrelated school), never against contacts_schools' school_id=42.
  const resolved = resolveSchoolContact({ authority: 'לא קיים', schoolNames: ['גם לא קיים'], schoolCatalogId: '42' }, { contactsSchoolsIndex, schoolsCatalogIndex });
  assert.equal(resolved.name, 'מנהל אחר');
  assert.notEqual(resolved.name, 'איש קשר רגיל');
});

test('loose school-name matching merges "בית ספר X" with "X" for both grouping and overrides', () => {
  assert.equal(looseContactMatchText('בית ספר מגנים'), looseContactMatchText('מגנים'));
  assert.equal(normalizeContactMatchText('בית ספר מגנים') === normalizeContactMatchText('מגנים'), false);

  const rows = [
    activity({ RowID: 'I1', school: 'בית ספר מגנים', school_id: '', instructor_name: 'אייל יוחאי', emp_id: '1525' }),
    activity({ RowID: 'I2', school: 'מגנים', school_id: '', start_time: '07:00', instructor_name: 'הילה רוזן', emp_id: '1500' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  assert.equal(contactResponsibleGroupsArray(index).length, 1);
});

test('different dates or different schools never merge into the same responsible group', () => {
  const rows = [
    activity({ RowID: 'J1', start_date: '2026-07-21', school_id: '1', school: 'בית ספר מגנים', instructor_name: 'א' }),
    activity({ RowID: 'J2', start_date: '2026-07-22', school_id: '1', school: 'בית ספר מגנים', instructor_name: 'ב' }),
    activity({ RowID: 'J3', start_date: '2026-07-21', school_id: '2', school: 'בית ספר אחר לגמרי', instructor_name: 'ג' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  assert.equal(contactResponsibleGroupsArray(index).length, 3);
});

test('two different schools that happen to share a common generic name in different authorities do not merge', () => {
  const rows = [
    activity({ RowID: 'K1', authority: 'רשות א', school: 'בית ספר יסודי א', school_id: '', instructor_name: 'א' }),
    activity({ RowID: 'K2', authority: 'רשות ב', school: 'בית ספר יסודי א', school_id: '', instructor_name: 'ב' })
  ];
  const index = buildContactResponsibleIndex(rows, []);
  assert.equal(contactResponsibleGroupsArray(index).length, 2);
  const g1 = findContactResponsibleGroup(rows[0], index);
  const g2 = findContactResponsibleGroup(rows[1], index);
  assert.notEqual(g1.key, g2.key);
});
