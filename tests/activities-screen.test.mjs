import { test } from 'node:test';
import assert from 'node:assert/strict';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const { activitiesScreen } = await import('../frontend/src/screens/activities.js');

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
      date_1: '2026-04-10',
      Date2: '2026-04-17',
      emp_id: '',
      instructor_name: '',
      emp_id_2: '',
      instructor_name_2: ''
    }]
  };
  const html = activitiesScreen.render(data, { state: baseState() });
  assert.match(html, /<th>תוכנית \/ סוג<\/th><th>רשות<\/th><th>בית ספר<\/th><th>מדריך<\/th><th>תאריך התחלה<\/th><th>תאריך סיום<\/th><th>תאריכי מפגשים<\/th><th>הערות<\/th>/);
  assert.match(html, /10\/04\/2026, 17\/04\/2026/);
});


test('activities render: admin sees compact Excel export and admin summary buttons', () => {
  const html = activitiesScreen.render({ rows: [] }, { state: baseState() });
  assert.match(html, /data-activities-export-all/);
  assert.match(html, />ייצוא לאקסל<\/button>/);
  assert.match(html, /data-activities-admin-summary/);
  assert.match(html, />סיכום אדמין<\/button>/);
  assert.doesNotMatch(html, /ייצוא כל הפעילויות לאקסל<\/button>/);
});

test('activities render: non-admin does not see admin toolbar buttons', () => {
  const state = baseState();
  state.user = { display_role: 'authorized_user', role: 'authorized_user', can_add_activity: false };
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.doesNotMatch(html, /data-activities-export-all/);
  assert.doesNotMatch(html, /data-activities-admin-summary/);
  assert.doesNotMatch(html, /ייצוא לאקסל/);
  assert.doesNotMatch(html, /סיכום אדמין/);
});

test('activities source includes admin summary all-activities loading and district/type safeguards', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /function buildAdminActivitiesSummary\(rows\)/);
  assert.match(source, /api\.allActivities/);
  assert.match(source, /טוען סיכום…/);
  assert.match(source, /\[admin-summary:failed\]/);
  assert.match(source, /ADMIN_SUMMARY_DISTRICT_FIELDS = \['district', 'region', 'area', 'authority_district'\]/);
  assert.match(source, /course[\s\S]*workshop[\s\S]*tour[\s\S]*after_school/);
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


test('admin all-activities Excel export is imported and logs failures', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ exportActivitiesToExcel \} from '\.\/shared\/excel-export\.js';/);
  assert.match(source, /data-activities-export-all/);
  assert.match(source, /exportActivitiesToExcel\(Array\.isArray\(res\?\.rows\) \? res\.rows : \[\], 'כל_הפעילויות'\)/);
  assert.match(source, /catch \(err\) \{[\s\S]*console\.error\('Failed to export all activities to Excel', err\);/);
});

test('all-activities Excel filename keeps Hebrew base and date stamp', async () => {
  const { exportActivitiesToExcel } = await import('../frontend/src/screens/shared/excel-export.js');
  const originalDocument = globalThis.document;
  const originalUrl = globalThis.URL;
  const originalBlob = globalThis.Blob;
  const appended = [];
  let downloaded = '';

  class TestBlob {
    constructor(parts, options) {
      this.parts = parts;
      this.options = options;
    }
  }

  const anchor = {
    set href(value) { this._href = value; },
    set download(value) { downloaded = value; },
    click() {},
    remove() {}
  };

  globalThis.Blob = TestBlob;
  globalThis.URL = {
    createObjectURL() { return 'blob:test'; },
    revokeObjectURL() {}
  };
  globalThis.document = {
    createElement(tag) {
      assert.equal(tag, 'a');
      return anchor;
    },
    body: { appendChild(node) { appended.push(node); } }
  };

  try {
    exportActivitiesToExcel([{ RowID: 'A1', activity_name: 'בדיקה' }], 'כל_הפעילויות');
    assert.equal(appended.length, 1);
    assert.match(downloaded, /^כל_הפעילויות_\d{4}-\d{2}-\d{2}\.xls$/);
  } finally {
    globalThis.document = originalDocument;
    globalThis.URL = originalUrl;
    globalThis.Blob = originalBlob;
  }
});
