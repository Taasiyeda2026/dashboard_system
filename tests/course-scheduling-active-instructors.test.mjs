import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeSchedulingInstructors,
  isActiveSchedulingInstructor,
  manualCourseInstructorOptions
} from '../frontend/src/screens/shared/course-scheduling-instructors.js';

test('scheduling accepts only explicitly active instructors', () => {
  assert.equal(isActiveSchedulingInstructor({ active: 'yes' }), true);
  assert.equal(isActiveSchedulingInstructor({ active: true }), true);
  assert.equal(isActiveSchedulingInstructor({ active: 1 }), true);
  assert.equal(isActiveSchedulingInstructor({ active: 'no' }), false);
  assert.equal(isActiveSchedulingInstructor({ active: false }), false);
  assert.equal(isActiveSchedulingInstructor({ active: 0 }), false);
  assert.equal(isActiveSchedulingInstructor({}), false);
});

test('inactive instructors never enter the scheduling candidate pool', () => {
  const rows = [
    { emp_id: 1547, full_name: 'שון פדידה', active: 'no' },
    { emp_id: 1600, full_name: 'מדריכה פעילה', active: 'yes' }
  ];
  assert.deepEqual(
    activeSchedulingInstructors(rows).map((row) => row.emp_id),
    [1600]
  );
});

test('management users appear only in manual course instructor choices', () => {
  const contacts = [
    { emp_id: 1507, full_name: 'מדריך רגיל', active: 'yes' },
    { emp_id: 1547, full_name: 'מדריך לא פעיל', active: 'no' },
    { emp_id: 1548, full_name: 'מדריכה לא פעילה', active: false },
    { emp_id: 1549, full_name: 'מדריך ללא סטטוס', active: null },
    // Existing management employee's old instructor contact is inactive,
    // yet they remain selectable when their management user is active.
    { emp_id: 1500, full_name: 'הילה רוזן', active: 'no' }
  ];
  const managers = [
    { emp_id: 1500, full_name: 'הילה רוזן', role: 'activities_manager', is_active: true },
    { emp_id: 5000, full_name: 'גיל נאמן', role: 'activities_manager', is_active: true },
    { emp_id: 6000, full_name: 'מנהלת תפעול פעילה', role: 'operation_manager', is_active: true },
    { emp_id: 3000, full_name: 'מנהלת תחום פעילה', role: 'domain_manager', is_active: true },
    { emp_id: 3030, full_name: 'מנהלת פיתוח עסקי', role: 'business_development_manager', is_active: true },
    { emp_id: 8000, full_name: 'אדמין פעיל', role: 'admin', is_active: true },
    { emp_id: 7000, full_name: 'מנהל פעילויות אחר', role: 'activities_manager', is_active: true },
    { emp_id: 4444, full_name: 'מישהו ללא תפקיד ניהולי', role: 'instructor', is_active: true }
  ];
  const options = manualCourseInstructorOptions(contacts, managers);
  assert.equal(options.filter(x => x.emp_id === 1500).length, 1);
  assert.equal(options.find(x => x.emp_id === 1500).isManagementEmployee, true);
  assert.equal(options.find(x => x.emp_id === 1500).active, 'yes');
  assert.equal(options.find(x => x.emp_id === 5000).isManagementEmployee, true);
  assert.equal(options.some(x => [1547, 1548, 1549, 6000, 3000, 3030, 8000, 7000, 4444].includes(x.emp_id)), false);
  assert.deepEqual(options.map(x => x.emp_id).sort((a,b) => a-b), [1500, 1507, 5000]);
  assert.deepEqual(activeSchedulingInstructors(contacts).map(x => x.emp_id), [1507]);
});

test('manual instructor choices require an active instructor contact unless approved manager user exists', () => {
  const options = manualCourseInstructorOptions([
    { emp_id: 10, full_name: 'פעיל', active: 'yes' },
    { emp_id: 11, full_name: 'לא פעיל', active: 'no' },
    { emp_id: 12, full_name: 'חסר סטטוס' },
    { emp_id: 13, full_name: 'פעיל בוליאני', active: true },
    { emp_id: 1500, full_name: 'הילה רוזן', active: 'no' }
  ], [
    { emp_id: 1500, full_name: 'הילה רוזן', role: 'activities_manager', is_active: true },
    { emp_id: 5000, full_name: 'גיל נאמן', role: 'activities_manager', is_active: false }
  ]);
  assert.deepEqual(options.map(row => row.emp_id).sort((a,b) => a-b), [10, 13, 1500]);
  assert.equal(options.find(row => row.emp_id === 1500).isManagementEmployee, true);
});
