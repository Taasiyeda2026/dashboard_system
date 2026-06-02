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
  assert.match(html, /<th>תוכנית \/ סוג<\/th><th>רשות<\/th><th>בית ספר<\/th><th>מדריך<\/th><th>תאריך התחלה<\/th><th>תאריך סיום<\/th><th>המפגש הבא<\/th><th>הערות<\/th>/);
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

test('activities render: operation_manager sees add activity button', () => {
  const state = baseState();
  state.user = { display_role: 'operation_manager', role: 'operation_manager', can_add_activity: false };
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.match(html, /data-activities-add-btn/);
});

test('activities render: authorized_user without can_add_activity does not see add activity button', () => {
  const state = baseState();
  state.user = { display_role: 'authorized_user', role: 'authorized_user', can_add_activity: false };
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.doesNotMatch(html, /data-activities-add-btn/);
});

test('activities quick filters include one-day summer rows by family and district', () => {
  const state = baseState();
  state.activityQuickFamily = 'short';
  state.activityQuickManager = 'מחוז צפון';
  const data = {
    rows: [
      {
        RowID: 'SUMMER-NORTH',
        activity_name: 'קייטנת קיץ',
        activity_type: 'workshop',
        activity_family: 'one_day',
        district: 'מחוז צפון',
        activity_manager: 'מנהל א',
        authority: 'רשות א',
        school: 'בית ספר א',
        start_date: '2026-04-05',
        end_date: '2026-04-05'
      },
      {
        RowID: 'SUMMER-SOUTH',
        activity_name: 'קייטנת קיץ דרום',
        activity_type: 'workshop',
        activity_family: 'one_day',
        district: 'מחוז דרום',
        activity_manager: 'מנהל ב',
        authority: 'רשות ב',
        school: 'בית ספר ב',
        start_date: '2026-04-06',
        end_date: '2026-04-06'
      },
      {
        RowID: 'PROGRAM-NORTH',
        activity_name: 'תוכנית שנתית',
        activity_type: 'course',
        activity_family: 'program',
        district: 'מחוז צפון',
        activity_manager: 'מנהל א',
        authority: 'רשות ג',
        school: 'בית ספר ג',
        start_date: '2026-04-07',
        end_date: '2026-04-30'
      }
    ]
  };

  const html = activitiesScreen.render(data, { state });

  assert.match(html, /קייטנת קיץ/);
  assert.doesNotMatch(html, /קייטנת קיץ דרום/);
  assert.doesNotMatch(html, /תוכנית שנתית/);
});

test('activities summer quick filter matches activity_season and summer start dates only', () => {
  const state = baseState();
  state.activitiesMonthYm = '2026-07';
  state.routes = ['activities', 'week', 'month'];
  state.activityQuickFamily = 'summer';
  const data = {
    rows: [
      {
        RowID: 'SUMMER-1',
        activity_name: 'פעילות מדעים',
        activity_season: 'summer_2026',
        activity_type: 'workshop',
        authority: 'רשות א',
        school: 'בית ספר א',
        start_date: '',
        end_date: ''
      },
      {
        RowID: 'SUMMER-2',
        activity_name: 'פעילות יולי',
        activity_season: 'regular',
        activity_type: 'workshop',
        authority: 'רשות א',
        school: 'בית ספר א',
        start_date: '2026-07-01',
        end_date: '2026-07-01'
      },
      {
        RowID: 'NOT-SUMMER-NOTES',
        activity_name: 'פעילות עם הערת קיץ',
        activity_season: 'regular',
        activity_type: 'workshop',
        authority: 'רשות ג',
        school: 'בית ספר ג',
        start_date: '2026-04-05',
        end_date: '2026-04-05',
        notes: 'פעילות קיץ'
      },
      {
        RowID: 'REGULAR-1',
        activity_name: 'פעילות רגילה',
        activity_season: 'regular',
        activity_type: 'course',
        authority: 'רשות ב',
        school: 'בית ספר ב',
        start_date: '2026-04-06',
        end_date: '2026-04-06'
      }
    ]
  };

  const html = activitiesScreen.render(data, { state });

  assert.match(html, /data-route-switch="week"[\s\S]*data-route-switch="month"[\s\S]*data-activities-summer-filter/);
  assert.match(html, /ds-activities-view-btn--summer is-active/);
  assert.match(html, /פעילות מדעים/);
  assert.match(html, /פעילות יולי/);
  assert.doesNotMatch(html, /פעילות עם הערת קיץ/);
  assert.doesNotMatch(html, /פעילות רגילה/);
});

test('activities view switcher shows summer button next to week and month when inactive', () => {
  const state = baseState();
  state.routes = ['activities', 'week', 'month'];
  const html = activitiesScreen.render({ rows: [] }, { state });

  assert.match(html, /data-route-switch="week"[\s\S]*>שבוע<\/button>[\s\S]*data-route-switch="month"[\s\S]*>חודש<\/button>[\s\S]*data-activities-summer-filter[\s\S]*>קיץ<\/button>/);
  assert.doesNotMatch(html, /ds-activities-view-btn--summer is-active/);
});

test('activities source includes admin summary all-activities loading and no district buckets', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /function buildAdminActivitiesSummary\(rows, settings = \{\}\)/);
  assert.match(source, /api\.allActivities/);
  assert.match(source, /טוען סיכום…/);
  assert.match(source, /\[admin-summary:failed\]/);
  assert.match(source, /course[\s\S]*workshop[\s\S]*tour[\s\S]*after_school/);

  assert.match(source, /uniqueAdminSummaryRows\(rows\)/);
  assert.match(source, /ADMIN_SUMMARY_DEDUPE_ID_FIELDS = \['RowID', 'row_id', 'source_row_id'\]/);
  assert.match(source, /activity_name', 'activity_type', 'school', 'authority', 'start_date', 'end_date'/);
  assert.doesNotMatch(source, /summary\.districts/);
  assert.doesNotMatch(source, /ADMIN_SUMMARY_DISTRICTS/);
  assert.doesNotMatch(source, /buildAdminSummaryManagerDistrictLookup/);
});

test('admin activities summary renders one total summary without district sections', async () => {
  const { renderAdminActivitiesSummary } = await import('../frontend/src/screens/activities.js');
  const rows = [
    { RowID: 'A1', activity_name: 'פעילות א', activity_type: 'course', activity_manager: 'מנהל צפון' },
    { RowID: 'A2', activity_name: 'פעילות ב', activity_type: 'workshop', activity_manager: 'מנהל דרום' },
    { RowID: 'A3', activity_name: 'פעילות ג', activity_type: 'tour' },
    { RowID: 'A4', activity_name: 'פעילות ד', activity_type: 'after_school' },
    { RowID: 'A5', activity_name: 'פעילות א', activity_type: 'course' }
  ];

  const html = renderAdminActivitiesSummary(rows, {
    dropdown_options: {
      activity_managers: [
        { name: 'מנהל צפון', district: 'מחוז צפון' },
        { name: 'מנהל דרום', district: 'מחוז דרום' }
      ]
    }
  });

  assert.equal((html.match(/סיכום אדמין – כלל הפעילויות/g) || []).length, 1);
  assert.doesNotMatch(html, /מחוז צפון/);
  assert.doesNotMatch(html, /מחוז דרום/);
  assert.doesNotMatch(html, /ללא מחוז/);
  assert.doesNotMatch(html, /סה״כ כללי/);
  assert.equal((html.match(/פירוט לפי שם פעילות/g) || []).length, 1);
  assert.match(html, />קורסים<\/span><strong>2<\/strong>/);
  assert.match(html, />סדנאות<\/span><strong>1<\/strong>/);
  assert.match(html, />סיורים<\/span><strong>1<\/strong>/);
  assert.match(html, />אפטרסקול<\/span><strong>1<\/strong>/);
  assert.match(html, />סה״כ כל הפעילויות<\/span><strong>5<\/strong>/);
  assert.equal((html.match(/פעילות א/g) || []).length, 1);
});





test('activities screen wires add-activity form submit to api.addActivity flow', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /data-add-activity-form/);
  assert.match(source, /document\.addEventListener\('submit'[\s\S]*submitAddActivityForm/);
  assert.match(source, /await api\.addActivity\(payload\)/);
  assert.match(source, /statusEl\) statusEl\.textContent = `שגיאה בשמירה:/);
  assert.match(source, /const ADD_ACTIVITY_TYPE_ORDER = \['workshop', 'escape_room', 'tour', 'after_school'\]/);
  assert.doesNotMatch(source, /data-add-family=/);
  assert.match(source, /'workshop'/);
  assert.match(source, /'tour'/);
  assert.match(source, /'escape_room'/);
  assert.match(source, /sessionsInput\.disabled = isOneDay/);
  assert.match(source, /sessionsField\.style\.display = isOneDay \? 'none' : ''/);
  assert.match(source, /activity_family: isOneDay \? 'one_day' : 'program'/);
  assert.match(source, /payload\.Date1 = selectedDate/);
  assert.match(source, /payload\.date_1 = selectedDate/);
  assert.doesNotMatch(source, /for \(let i = 2; i <= 35; i\+\+\) payload\[`Date/);
});

test('activity drawer uses instructor emp_id fallback for display consistency', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');
  assert.match(source, /function resolveInstructorDisplayName\(name, empId, lookup\)/);
  assert.match(source, /resolveInstructorDisplayName\(row\.instructor_name,\s*row\.emp_id,\s*instructorLookup\)/);
});

test('activity drawer progress auto-counts past dates and groups duplicate dates in view chips', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/activity-detail-html.js', import.meta.url), 'utf8');
  assert.match(source, /const autoDoneByDate = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\/\.test\(date\) && date < today/);
  assert.match(source, /const countLabel = count > 1 \? ` · \$\{count\} מפגשים` : '';/);
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

const { JSDOM } = await import('jsdom');
const { getActivityNamesForType } = await import('../frontend/src/screens/shared/activity-options.js');
const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');
const { bindActivityEditForm } = await import('../frontend/src/screens/shared/bind-activity-edit-form.js');

function activityNameSettings() {
  return {
    dropdown_options: {
      activity_names: [
        { label: 'חדר בריחה חלל', activity_no: 'ER-1', activity_type: 'חדר בריחה' },
        { label: 'סדנת רובוטיקה', activity_no: 'WS-1', activity_type: 'workshop' },
        { label: 'סיור מדעים', activity_no: 'TR-1', activity_type: 'סיור' }
      ]
    },
    one_day_activity_types: ['חדר בריחה', 'סדנה', 'סיור'],
    program_activity_types: ['קורס']
  };
}

test('activity name filtering normalizes Hebrew and English activity type aliases', () => {
  const settings = activityNameSettings();

  const escapeNames = getActivityNamesForType(settings, 'escape_room').map((item) => item.label);
  assert.deepEqual(escapeNames, ['חדר בריחה חלל']);

  const workshopNames = getActivityNamesForType(settings, 'סדנאות').map((item) => item.label);
  assert.deepEqual(workshopNames, ['סדנת רובוטיקה']);
});

test('activity edit form refreshes activity_name options and clears stale name when activity_type changes', () => {
  const settings = activityNameSettings();
  const dom = new JSDOM(`<main id="root">${activityWorkDrawerHtml({
    RowID: 'A-1',
    activity_name: 'חדר בריחה חלל',
    activity_no: 'ER-1',
    activity_type: 'חדר בריחה',
    status: 'פעיל'
  }, { settings, canEdit: true, canDirectEdit: true })}</main>`);
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAbortController = globalThis.AbortController;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('#root');
    bindActivityEditForm(root, { api: { saveActivity: async () => ({ ok: true }) } });

    const form = root.querySelector('[data-drawer-form]');
    const typeSelect = form.querySelector('select[name="activity_type"]');
    const nameSelect = form.querySelector('[data-role="activity-name-select"]');
    const noInput = form.querySelector('[data-activity-no]');

    assert.deepEqual(Array.from(nameSelect.options).map((option) => option.value).filter(Boolean), ['חדר בריחה חלל']);
    typeSelect.value = 'workshop';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

    assert.deepEqual(Array.from(nameSelect.options).map((option) => option.value).filter(Boolean), ['סדנת רובוטיקה']);
    assert.equal(nameSelect.value, '');
    assert.equal(noInput.value, '');
    assert.doesNotMatch(nameSelect.textContent, /חדר בריחה חלל/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.AbortController = previousAbortController;
  }
});

test('activity add form refreshes activity_name options and clears stale name when activity_type changes', () => {
  const settings = activityNameSettings();
  const state = baseState();
  state.clientSettings = settings;
  state.user = { display_role: 'admin', role: 'admin', can_add_activity: true };
  const dom = new JSDOM('<body><main id="root"></main></body>', { url: 'https://example.test/dashboard_system/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAbortController = globalThis.AbortController;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.querySelector('#root');
    root.innerHTML = activitiesScreen.render({ rows: [] }, { state });
    activitiesScreen.bind({
      root,
      data: { rows: [] },
      state,
      rerender: () => {},
      rerenderActivitiesView: () => {},
      clearScreenDataCache: () => {},
      api: { activities: async () => ({ rows: [] }), allActivities: async () => ({ rows: [] }) },
      ui: {
        bindInteractiveCards: () => {},
        openModal: ({ content }) => {
          const modal = dom.window.document.createElement('div');
          modal.className = 'ds-modal__content';
          modal.innerHTML = content;
          dom.window.document.body.appendChild(modal);
        }
      }
    });

    root.querySelector('[data-activities-add-btn]').click();
    const form = dom.window.document.querySelector('[data-add-activity-form]');
    const typeSelect = form.querySelector('[data-add-activity-type]');
    const nameSelect = form.querySelector('[data-add-activity-name]');
    const noInput = form.querySelector('[data-add-activity-no]');

    typeSelect.value = 'escape_room';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(Array.from(nameSelect.options).map((option) => option.value).filter(Boolean), ['חדר בריחה חלל']);
    nameSelect.value = 'חדר בריחה חלל';
    nameSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(noInput.value, 'ER-1');

    typeSelect.value = 'workshop';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.deepEqual(Array.from(nameSelect.options).map((option) => option.value).filter(Boolean), ['סדנת רובוטיקה']);
    assert.equal(nameSelect.value, '');
    assert.equal(noInput.value, '');
    assert.doesNotMatch(nameSelect.textContent, /חדר בריחה חלל/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.AbortController = previousAbortController;
  }
});
