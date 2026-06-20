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
