import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitiesScreen } from '../frontend/src/screens/activities.js';

function baseState() {
  return {
    activitiesMonthYm: '2026-04',
    user: { display_role: 'admin', can_add_activity: true },
    clientSettings: { hide_emp_id_on_screens: true, dropdown_options: {} },
    activityListFilters: {},
    screenDataCache: {}
  };
}

test('activities render: emp_id without name does not show "ללא מדריך"', () => {
  const data = {
    rows: [{
      RowID: 'SHORT-1',
      activity_name: 'תכנית בדיקה',
      activity_type: 'workshop',
      authority: 'רשות א',
      school: 'בית ספר א',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      emp_id: 'EMP-77',
      instructor_name: '',
      emp_id_2: '',
      instructor_name_2: ''
    }]
  };
  const html = activitiesScreen.render(data, { state: baseState() });
  assert.match(html, /ds-activities-instructor-name/);
  assert.doesNotMatch(html, /ללא מדריך/);
});

test('activities render: truly missing instructor shows "ללא מדריך"', () => {
  const data = {
    rows: [{
      RowID: 'SHORT-2',
      activity_name: 'תכנית בדיקה 2',
      activity_type: 'workshop',
      authority: 'רשות ב',
      school: 'בית ספר ב',
      start_date: '2026-04-01',
      end_date: '2026-04-02',
      emp_id: '',
      instructor_name: '',
      emp_id_2: '',
      instructor_name_2: ''
    }]
  };
  const html = activitiesScreen.render(data, { state: baseState() });
  assert.match(html, /ללא מדריך/);
});

test('activities table keeps expected columns structure', () => {
  const data = {
    rows: [{
      RowID: 'SHORT-3',
      activity_name: 'תכנית בדיקה 3',
      activity_type: 'workshop',
      authority: 'רשות ג',
      school: 'בית ספר ג',
      start_date: '2026-04-10',
      end_date: '2026-04-12',
      emp_id: '',
      instructor_name: '',
      emp_id_2: '',
      instructor_name_2: ''
    }]
  };
  const html = activitiesScreen.render(data, { state: baseState() });
  assert.match(html, /<th>תוכנית \/ סוג<\/th><th>רשות<\/th><th>בית ספר<\/th><th>מדריך<\/th><th>תאריך התחלה<\/th><th>תאריך סיום<\/th><th>הערות<\/th>/);
});





test('activities screen wires add-activity form submit to api.addActivity flow', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /data-add-activity-form/);
  assert.match(source, /document\.addEventListener\('submit'[\s\S]*submitAddActivityForm/);
  assert.match(source, /await api\.addActivity\(payload\)/);
  assert.match(source, /statusEl\) statusEl\.textContent = `שגיאה בשמירה:/);
});

test('activity drawer uses instructor emp_id fallback for display consistency', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');
  assert.match(source, /function resolveInstructorDisplayName\(name, empId, lookup\)/);
  assert.match(source, /resolveInstructorDisplayName\(row\.instructor_name,\s*row\.emp_id,\s*instructorLookup\)/);
});
