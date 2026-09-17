import test from 'node:test';
import assert from 'node:assert/strict';

const { israaInstructorPickerOptions } = await import('../frontend/src/activities-approved-ui-fix.js');

test('israa instructor picker exposes active instructor roster with employee ids', () => {
  const settings = {
    dropdown_options: {
      contacts_instructor_users: [
        { emp_id: '1503', full_name: 'הנאא אבו אמנה', active: true },
        { emp_id: '1507', full_name: 'אלכס זפקה', active: true },
        { emp_id: '1507', full_name: 'אלכס זפקה', active: true },
        { emp_id: '9999', full_name: 'לא פעיל', active: false }
      ]
    }
  };

  assert.deepEqual(israaInstructorPickerOptions(settings), [
    { emp_id: '1503', name: 'הנאא אבו אמנה' },
    { emp_id: '1507', name: 'אלכס זפקה' }
  ]);
});
