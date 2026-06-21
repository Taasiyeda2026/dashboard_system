import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildContactsInstructorLookup,
  resolveEmpIdForInstructorName,
  syncInstructorEmpFields,
  validateActivityInstructorPair,
  validateActivityInstructors
} from '../frontend/src/screens/shared/activity-options.js';

const roster = [
  { name: 'אלכס זפקה', emp_id: '1600' },
  { name: 'הילה הזן', emp_id: '1500' },
  { name: 'אלדר מיכאל טייב', emp_id: '1400' }
];

const contacts = [
  { emp_id: '1600', full_name: 'אלכס זפקה' },
  { emp_id: '1500', full_name: 'הילה הזן' },
  { emp_id: '1400', full_name: 'אלדר מיכאל טייב' }
];

const contactsLookup = buildContactsInstructorLookup(contacts);

test('resolveEmpIdForInstructorName returns matching emp_id for roster name', () => {
  const result = resolveEmpIdForInstructorName('אלכס זפקה', roster);
  assert.equal(result.error, null);
  assert.equal(result.emp_id, '1600');
});

test('resolveEmpIdForInstructorName clears empty instructor without error', () => {
  const result = resolveEmpIdForInstructorName('', roster);
  assert.equal(result.error, null);
  assert.equal(result.emp_id, null);
});

test('resolveEmpIdForInstructorName rejects unknown instructor name', () => {
  const result = resolveEmpIdForInstructorName('מדריך לא קיים', roster);
  assert.equal(result.error, 'instructor_name_not_in_roster');
  assert.equal(result.emp_id, null);
});

test('syncInstructorEmpFields updates emp_id when instructor_name changes', () => {
  const { changes, errors } = syncInstructorEmpFields(
    { instructor_name: 'הילה הזן' },
    roster,
    { strict: true }
  );
  assert.deepEqual(errors, []);
  assert.equal(changes.instructor_name, 'הילה הזן');
  assert.equal(changes.emp_id, '1500');
});

test('syncInstructorEmpFields clears emp_id when instructor_name is cleared', () => {
  const { changes, errors } = syncInstructorEmpFields(
    { instructor_name: '' },
    roster,
    { strict: true }
  );
  assert.deepEqual(errors, []);
  assert.equal(changes.instructor_name, '');
  assert.equal(changes.emp_id, null);
});

test('syncInstructorEmpFields syncs secondary instructor fields', () => {
  const { changes, errors } = syncInstructorEmpFields(
    { instructor_name_2: 'אלדר מיכאל טייב' },
    roster,
    { strict: true }
  );
  assert.deepEqual(errors, []);
  assert.equal(changes.instructor_name_2, 'אלדר מיכאל טייב');
  assert.equal(changes.emp_id_2, '1400');
});

test('validateActivityInstructorPair detects mismatch against contacts_instructors', () => {
  const result = validateActivityInstructorPair('אלכס זפקה', '1500', contactsLookup);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'instructor_emp_mismatch');
  assert.equal(result.emp_id, '1600');
});

test('validateActivityInstructorPair accepts consistent instructor name and emp_id', () => {
  const result = validateActivityInstructorPair('הילה הזן', '1500', contactsLookup);
  assert.equal(result.valid, true);
  assert.equal(result.error, null);
  assert.equal(result.emp_id, '1500');
});

test('validateActivityInstructors flags activity rows with mismatched instructor pairs', () => {
  const result = validateActivityInstructors({
    instructor_name: 'אלכס זפקה',
    emp_id: '1500',
    instructor_name_2: 'אלדר מיכאל טייב',
    emp_id_2: '1400'
  }, contactsLookup);

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['instructor_emp_mismatch']);
});

test('validateActivityInstructors accepts fully consistent instructor pairs', () => {
  const result = validateActivityInstructors({
    instructor_name: 'אלכס זפקה',
    emp_id: '1600',
    instructor_name_2: 'הילה הזן',
    emp_id_2: '1500'
  }, contactsLookup);

  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

import {
  resolveInstructorSelectionByEmpId,
  validateInstructorIdentityPayload,
  getValidInstructorUsers,
  validateInstructorBinding
} from '../frontend/src/screens/shared/activity-options.js';

test('add activity instructor selection uses selected emp_id canonical name', () => {
  const result = resolveInstructorSelectionByEmpId('1500', roster);
  assert.equal(result.error, null);
  assert.equal(result.emp_id, '1500');
  assert.equal(result.name, 'הילה הזן');
});

test('add activity blocks duplicate instructor names with different emp_id values', () => {
  const result = resolveInstructorSelectionByEmpId('2000', [
    { name: 'שם זהה', emp_id: '2000' },
    { name: 'שם זהה', emp_id: '2001' }
  ]);
  assert.equal(result.error, 'instructor_name_ambiguous');
  assert.equal(result.emp_id, null);
});

test('add activity blocks instructor roster entries without emp_id', () => {
  const result = resolveInstructorSelectionByEmpId('', [
    { name: 'מדריך ללא עובד', emp_id: '' }
  ], { optional: false });
  assert.equal(result.error, 'instructor_missing_emp_id');
});

test('activity save guard rejects mismatched instructor_name and emp_id', () => {
  const result = validateInstructorIdentityPayload({
    instructor_name: 'אלכס זפקה',
    emp_id: '1500'
  }, roster);
  assert.equal(result.valid, false);
  assert.equal(result.errors[0].code, 'instructor_emp_mismatch');
});

test('activity save guard allows activity without optional instructor', () => {
  const result = validateInstructorIdentityPayload({
    instructor_name: '',
    emp_id: '',
    instructor_name_2: '',
    emp_id_2: ''
  }, roster);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});


test('activity with emp_id missing from contacts_instructors is blocked', () => {
  const result = validateInstructorBinding({ empId: '1525', instructorName: 'אסאלה ברהום' }, contacts);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'instructor_not_in_contacts');
});

test('valid instructor picker options exclude list entries missing from contacts_instructors', () => {
  const settings = {
    dropdown_options: {
      instructor_users: [
        { name: 'אלכס זפקה', emp_id: '1600' },
        { name: 'אסאלה ברהום', emp_id: '1525' },
        { name: 'ללא עובד', emp_id: '' }
      ],
      contacts_instructor_users: contacts.map((c) => ({ name: c.full_name, emp_id: c.emp_id }))
    }
  };
  const result = getValidInstructorUsers(settings);
  assert.deepEqual(result.map((user) => user.emp_id), ['1600']);
});

test('contacts validation does not fallback by instructor name', () => {
  const result = validateInstructorBinding({ empId: '1525', instructorName: 'אלכס זפקה' }, contacts);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'instructor_not_in_contacts');
});

test('contacts validation does not auto-select another instructor by name', () => {
  const result = validateInstructorBinding({ empId: '9999', instructorName: 'הילה הזן' }, contacts);
  assert.equal(result.valid, false);
  assert.equal(result.error, 'instructor_not_in_contacts');
});
