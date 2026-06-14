import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

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

const { activitiesScreen, getActivitiesAccessDebug } = await import('../frontend/src/screens/activities.js');

function baseState() {
  return {
    activitiesMonthYm: '2026-04',
    activityPeriodTab: 'school_2026',
    user: { display_role: 'מנהל מערכת', role: 'admin', can_add_activity: true },
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


test('activities render: admin sees compact Excel export but no admin summary button', () => {
  const html = activitiesScreen.render({ rows: [] }, { state: baseState() });
  assert.match(html, /data-activities-export-all/);
  assert.match(html, />ייצוא לאקסל<\/button>/);
  assert.doesNotMatch(html, /data-activities-admin-summary/);
  assert.doesNotMatch(html, />סיכום אדמין<\/button>/);
  assert.doesNotMatch(html, /ייצוא כל הפעילויות לאקסל<\/button>/);
});

test('activities access: admin idann can view without edit or add permissions', () => {
  const state = baseState();
  state.user = {
    username: 'idann',
    display_role: 'admin',
    role: 'admin',
    permissions: { view_activities: 'yes' },
    can_review_requests: true,
    can_edit_direct: false,
    can_add_activity: false
  };
  const debug = getActivitiesAccessDebug(state);
  assert.equal(debug.hasActivitiesAccess, true);
  assert.equal(debug.reasonDenied, '');
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.doesNotMatch(html, /אין הרשאה/);
});


test('activities access: allowed technical roles can view when display_role is Hebrew label', () => {
  const users = [
    ['idann', 'admin', 'מנהל מערכת'],
    ['edenc', 'operation_manager', 'מנהלת תפעול'],
    ['giln', 'activities_manager', 'מנהל פעילויות'],
    ['yaela', 'domain_manager', 'מנהלת תחום'],
    ['hilar', 'instructor_manager', 'מנהלת מדריכים'],
    ['esraaa', 'business_development_manager', 'מנהלת פיתוח עסקי']
  ];

  for (const [username, role, displayRole] of users) {
    const state = baseState();
    state.user = {
      username,
      role,
      display_role: displayRole,
      permissions: {},
      can_edit_direct: false,
      can_add_activity: false
    };
    const debug = getActivitiesAccessDebug(state);
    assert.equal(debug.role, role);
    assert.equal(debug.displayRole, displayRole);
    assert.equal(debug.hasActivitiesAccess, true, `${username} with role=${role} should access activities`);
    const html = activitiesScreen.render({ rows: [] }, { state });
    assert.doesNotMatch(html, /אין הרשאה/, `${username} with role=${role} should not see access denied`);
  }
});


test('activities render: admin idann sees summer activity layout button without add/edit flags', () => {
  const state = baseState();
  state.activityPeriodTab = 'summer_2026';
  state.user = {
    username: 'idann',
    display_role: 'מנהל מערכת',
    role: 'admin',
    can_edit_direct: false,
    can_add_activity: false,
    can_request_edit: false,
    can_request_create_activity: false
  };
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.match(html, /data-activity-layout-list/);
  assert.match(html, />פריסת פעילות<\/button>/);
});

test('activities render: giln can request adding an activity when direct add is disabled', () => {
  const state = baseState();
  state.user = {
    username: 'giln',
    display_role: 'מנהל פעילויות',
    role: 'activities_manager',
    can_add_activity: false,
    can_edit_direct: false,
    can_request_create_activity: true,
    can_request_edit: true
  };
  const html = activitiesScreen.render({ rows: [] }, { state });
  assert.match(html, /data-activities-add-btn/);
  assert.match(html, /בקשה להוספת פעילות/);
});

test('activities access: view permission and activities route allow viewing without add/edit permissions', () => {
  const permittedByPermission = baseState();
  permittedByPermission.user = {
    display_role: 'authorized_user',
    role: 'authorized_user',
    permissions: { view_activities: 'yes' },
    can_edit_direct: false,
    can_add_activity: false
  };
  assert.equal(getActivitiesAccessDebug(permittedByPermission).hasActivitiesAccess, true);

  const permittedByRoute = baseState();
  permittedByRoute.user = {
    display_role: 'authorized_user',
    role: 'authorized_user',
    routes: ['activities'],
    can_edit_direct: false,
    can_add_activity: false
  };
  assert.equal(getActivitiesAccessDebug(permittedByRoute).hasActivitiesAccess, true);
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
  state.user = { display_role: 'operation_manager', role: 'operation_manager', can_add_activity: true };
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

test('activities period tabs split rows by start_date and default to school 2026', () => {
  const state = baseState();
  state.activitiesMonthYm = '2026-06';
  delete state.activityPeriodTab;
  const data = {
    rows: [
      { RowID: 'SCHOOL-2026', activity_name: 'פעילות יוני', activity_type: 'workshop', authority: 'רשות א', school: 'בית ספר א', start_date: '2026-06-30' },
      { RowID: 'SUMMER-2026', activity_name: 'פעילות יולי', activity_type: 'workshop', authority: 'רשות ב', school: 'בית ספר ב', start_date: '2026-07-01' },
      { RowID: 'SCHOOL-2027', activity_name: 'פעילות ספטמבר', activity_type: 'course', authority: 'רשות ג', school: 'בית ספר ג', start_date: '2026-09-01' },
      { RowID: 'ARCHIVE-CLOSED', activity_name: 'פעילות סגורה', activity_type: 'course', authority: 'רשות ד', school: 'בית ספר ד', start_date: '2026-07-10', status: 'סגור' }
    ]
  };

  const html = activitiesScreen.render(data, { state });

  assert.match(html, /data-activity-period-tab="school_2026"[\s\S]*תשפ״ו \/ 2026[\s\S]*<strong>1<\/strong>/);
  assert.match(html, /aria-selected="true" data-activity-period-tab="school_2026"/);
  assert.match(html, /data-activity-period-tab="school_2027"[\s\S]*<strong>0<\/strong>/);
  assert.match(html, /data-activity-period-tab="archive"[\s\S]*<strong>0<\/strong>/);
  assert.match(html, /פעילות יוני/);
  assert.doesNotMatch(html, /פעילות יולי/);
  assert.doesNotMatch(html, /פעילות ספטמבר/);
  assert.doesNotMatch(html, /פעילות סגורה/);
  assert.doesNotMatch(html, /כל הפעילויות/);
});

test('activities summer tab opens on first dated summer month and filters rows by start_date month', () => {
  const state = baseState();
  state.activityPeriodTab = 'summer_2026';
  state.activitiesMonthYm = '2026-06';
  const data = {
    rows: [
      { RowID: 'summer_july_1', activity_name: 'פעילות יולי', activity_type: 'workshop', authority: 'רשות א', school: 'בית ספר א', start_date: '2026-07-01', status: 'פעיל' },
      { RowID: 'summer_undated_1', activity_name: 'פעילות קיץ ללא תאריך', activity_type: 'workshop', authority: 'רשות ב', school: 'בית ספר ב', start_date: '', status: 'פעיל' },
      { RowID: 'summer_cancelled_1', activity_name: 'פעילות קיץ מבוטלת', activity_type: 'workshop', authority: 'רשות ג', school: 'בית ספר ג', start_date: '2026-07-02', status: 'בוטל' },
      { RowID: 'REGULAR-JULY', activity_name: 'פעילות רגילה ביולי', activity_type: 'workshop', authority: 'רשות ד', school: 'בית ספר ד', start_date: '2026-07-03', status: 'פעיל' }
    ]
  };

  const html = activitiesScreen.render(data, { state });

  assert.equal(state.activitiesMonthYm, '2026-07');
  assert.match(html, /data-activity-period-tab="summer_2026"[\s\S]*<strong>1<\/strong>/);
  assert.match(html, /ניהול פעילויות · יולי · 1 פעילויות/);
  assert.match(html, /פעילות יולי/);
  assert.doesNotMatch(html, /פעילות קיץ ללא תאריך/);
  assert.doesNotMatch(html, /דורש שיבוץ תאריך/);
  assert.doesNotMatch(html, /פעילות קיץ מבוטלת/);
  assert.doesNotMatch(html, /פעילות רגילה ביולי/);
});



test('activities summer month initialization does not override manual summer navigation after first entry', () => {
  const state = baseState();
  state.activityPeriodTab = 'summer_2026';
  state.activitiesMonthYm = '2026-06';
  const data = {
    rows: [
      { RowID: 'summer_july_1', activity_name: 'פעילות יולי', activity_type: 'workshop', authority: 'רשות א', school: 'בית ספר א', start_date: '2026-07-01', status: 'פעיל' }
    ]
  };

  activitiesScreen.render(data, { state });
  assert.equal(state.activitiesMonthYm, '2026-07');

  state.activitiesMonthYm = '2026-08';
  const html = activitiesScreen.render(data, { state });
  assert.equal(state.activitiesMonthYm, '2026-08');
  assert.match(html, /ניהול פעילויות · אוגוסט · 0 פעילויות/);
  assert.doesNotMatch(html, /פעילות יולי/);
});

test('activities selected month drives title, count and table rows', () => {
  const state = baseState();
  state.activitiesMonthYm = '2026-05';
  const data = {
    rows: [
      { RowID: 'MAY-1', activity_name: 'פעילות מאי', activity_type: 'workshop', authority: 'רשות א', school: 'בית ספר א', start_date: '2026-05-10', end_date: '2026-05-10' },
      { RowID: 'JUNE-1', activity_name: 'פעילות יוני', activity_type: 'workshop', authority: 'רשות ב', school: 'בית ספר ב', start_date: '2026-06-12', end_date: '2026-06-12' },
      { RowID: 'SPAN-MAY-JUNE', activity_name: 'פעילות חוצה חודשים', activity_type: 'course', authority: 'רשות ג', school: 'בית ספר ג', start_date: '2026-05-20', end_date: '2026-06-10' },
      { RowID: 'DATES-JUNE', activity_name: 'מפגש יוני', activity_type: 'course', authority: 'רשות ד', school: 'בית ספר ד', start_date: '2026-05-01', end_date: '2026-05-31', date_1: '2026-06-03' }
    ]
  };

  const mayHtml = activitiesScreen.render(data, { state });
  assert.match(mayHtml, /ניהול פעילויות · מאי · 3 פעילויות/);
  assert.match(mayHtml, /פעילות מאי/);
  assert.match(mayHtml, /פעילות חוצה חודשים/);
  assert.doesNotMatch(mayHtml, /פעילות יוני/);
  assert.match(mayHtml, /מפגש יוני/);

  state.activitiesMonthYm = '2026-06';
  const juneHtml = activitiesScreen.render(data, { state });
  assert.match(juneHtml, /ניהול פעילויות · יוני · 1 פעילויות/);
  assert.doesNotMatch(juneHtml, /פעילות מאי/);
  assert.match(juneHtml, /פעילות יוני/);
  assert.doesNotMatch(juneHtml, /פעילות חוצה חודשים/);
  assert.doesNotMatch(juneHtml, /מפגש יוני/);
});

test('activities month navigation updates the single selected month state and rerenders RTL title/table', async () => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAbortController = globalThis.AbortController;
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://example.test/dashboard?route=activities' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const state = baseState();
    state.activitiesMonthYm = '2026-05';
    const data = {
      rows: [
        { RowID: 'MAY-1', activity_name: 'פעילות מאי', activity_type: 'workshop', authority: 'רשות א', school: 'בית ספר א', start_date: '2026-05-10', end_date: '2026-05-10' },
        { RowID: 'JUNE-1', activity_name: 'פעילות יוני', activity_type: 'workshop', authority: 'רשות ב', school: 'בית ספר ב', start_date: '2026-06-12', end_date: '2026-06-12' }
      ]
    };
    const root = dom.window.document.querySelector('#root');
    const rerender = () => {
      root.innerHTML = activitiesScreen.render(data, { state });
      activitiesScreen.bind({ root, data, state, rerender, api: {}, ui: { bindInteractiveCards() {} } });
    };

    rerender();
    assert.match(root.querySelector('.ds-activities-title-row')?.getAttribute('dir') || '', /rtl/);
    assert.match(root.textContent, /ניהול פעילויות · מאי · 1 פעילויות/);
    assert.match(root.textContent, /פעילות מאי/);
    assert.doesNotMatch(root.textContent, /פעילות יוני/);

    root.querySelector('[data-activities-month-next]').click();
    assert.equal(state.activitiesMonthYm, '2026-06');
    assert.match(root.textContent, /ניהול פעילויות · יוני · 1 פעילויות/);
    assert.doesNotMatch(root.textContent, /פעילות מאי/);
    assert.match(root.textContent, /פעילות יוני/);

    await new Promise((resolve) => setTimeout(resolve, 450));
    root.querySelector('[data-activities-month-prev]').click();
    assert.equal(state.activitiesMonthYm, '2026-05');
    assert.match(root.textContent, /ניהול פעילויות · מאי · 1 פעילויות/);
    assert.match(root.textContent, /פעילות מאי/);
    assert.doesNotMatch(root.textContent, /פעילות יוני/);
    await new Promise((resolve) => setTimeout(resolve, 450));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousAbortController === undefined) delete globalThis.AbortController;
    else globalThis.AbortController = previousAbortController;
  }
});

test('activities view switcher keeps week and month routes without an all/summer mixing button', () => {
  const state = baseState();
  state.routes = ['activities', 'week', 'month'];
  const html = activitiesScreen.render({ rows: [] }, { state });

  assert.match(html, /data-route-switch="week"[\s\S]*>שבוע<\/button>[\s\S]*data-route-switch="month"[\s\S]*>חודש<\/button>/);
  assert.doesNotMatch(html, /data-activities-summer-filter/);
  assert.doesNotMatch(html, /ds-activities-view-btn--summer/);
});

test('activities source no longer wires the admin summary drawer into the activities page', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /data-activities-admin-summary/);
  assert.doesNotMatch(source, /\[admin-summary:failed\]/);
  assert.doesNotMatch(source, /querySelector\('\[data-activities-admin-summary\]'\)/);
});

test('activities overdue popup shows general exceptions message without count', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /יש תוכניות שהסתיימו ועדיין לא נסגרו/);
  assert.match(source, /מומלץ לעבור לעמוד החריגות, לבדוק את הרשומות הרלוונטיות ולעדכן סטטוס לפי הצורך/);
  assert.match(source, /מעבר לעמוד החריגות/);
  assert.doesNotMatch(source, /<strong>\$\{overdue\.length\}<\/strong>/);
  assert.doesNotMatch(source, /קיימות\s*<strong>\$\{overdue\.length\}<\/strong>/);
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
  assert.match(source, /form\.addEventListener\('submit'[\s\S]*submitAddActivityForm/);
  assert.match(source, /await api\.addActivity\(payload\)/);
  assert.match(source, /setAddActivityStatus\(statusEl, `לא ניתן לשמור:/);
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
  assert.match(source, /const rows = activityPeriodRows/);
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

test('activity add validation clears saving state and does not show duplicate in-progress error', async () => {
  const settings = activityNameSettings();
  settings.dropdown_options.authorities = ['רשות א'];
  settings.dropdown_options.schools = ['בית ספר א'];
  settings.dropdown_options.activity_managers = ['מנהלת א'];
  const state = baseState();
  state.clientSettings = settings;
  state.user = { display_role: 'admin', role: 'admin', can_add_activity: true };
  const dom = new JSDOM('<body><main id="root"></main></body>', { url: 'https://example.test/dashboard_system/' });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousAbortController = globalThis.AbortController;
  const previousFormData = globalThis.FormData;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  globalThis.FormData = dom.window.FormData;
  let addCalls = 0;
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
      api: {
        activities: async () => ({ rows: [] }),
        allActivities: async () => ({ rows: [] }),
        addActivity: async () => { addCalls += 1; return { row: { RowID: 'A-NEW', start_date: '2026-06-15' } }; }
      },
      ui: {
        bindInteractiveCards: () => {},
        closeModal: () => {},
        openModal: ({ content, actions }) => {
          const modal = dom.window.document.createElement('div');
          modal.className = 'ds-modal__content';
          modal.innerHTML = `${content}<footer>${actions}</footer>`;
          dom.window.document.body.appendChild(modal);
        }
      }
    });

    root.querySelector('[data-activities-add-btn]').click();
    const form = dom.window.document.querySelector('[data-add-activity-form]');
    const status = form.querySelector('[data-add-activity-status]');
    const submit = dom.window.document.querySelector('[data-add-activity-submit]');

    const typeSelect = form.querySelector('[data-add-activity-type]');
    const nameSelect = form.querySelector('[data-add-activity-name]');
    typeSelect.value = 'escape_room';
    typeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    nameSelect.value = 'חדר בריחה חלל';
    nameSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    form.querySelector('[name="authority"]').value = 'רשות א';
    form.querySelector('[name="school"]').value = 'בית ספר א';

    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(status.textContent, 'יש למלא תאריך פעילות');
    assert.notEqual(form.dataset.saving, 'yes');
    assert.equal(submit.disabled, false);
    assert.equal(submit.classList.contains('is-loading'), false);
    assert.doesNotMatch(status.textContent, /השמירה כבר בתהליך/);
    assert.equal(addCalls, 0);

    form.querySelector('[name="one_day_date"]').value = '2026-06-15';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(status.textContent, 'יש לבחור שעת התחלה');

    form.querySelector('[name="start_time"]').value = '09:00';
    form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(status.textContent, 'יש לבחור שעת סיום');
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.AbortController = previousAbortController;
    globalThis.FormData = previousFormData;
  }
});
