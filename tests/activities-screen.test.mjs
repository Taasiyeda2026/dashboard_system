import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activitiesScreen } from '../frontend/src/screens/activities.js';
import fs from 'node:fs';

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
  assert.match(html, /מדריך משויך/);
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

test('activities css includes fixed proportional column widths', () => {
  const css = fs.readFileSync('frontend/src/styles/main.css', 'utf8');
  assert.match(css, /ds-activities-col--program \{ width: 30%/);
  assert.match(css, /ds-activities-col--authority \{ width: 15%/);
  assert.match(css, /ds-activities-col--school \{ width: 20%/);
  assert.match(css, /ds-activities-col--instructor \{ width: 18%/);
  assert.match(css, /ds-activities-col--date \{ width: 8\.5%/);
});
