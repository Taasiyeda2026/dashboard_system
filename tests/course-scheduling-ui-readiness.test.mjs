import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  courseSchedulingScreen,
  courseSchedulingCounts,
  compactMeetingsHtml,
  PENDING_ACTIVITY_STORAGE_KEY
} from '../frontend/src/screens/course-scheduling.js';
import {
  applyMissingScheduleFilter,
  collectMissingScheduleCourseIds,
  courseSchedulingDataReadiness,
  MISSING_SCHEDULE_FILTER_STORAGE_KEY,
  pickNearestActionableCourse,
  translateSchedulingRouteError
} from '../frontend/src/screens/course-scheduling-distance-build.js';
import { fixedScheduleHtml } from '../frontend/src/screens/course-scheduling-calendar.js';

function ensureBrowserGlobals() {
  if (!globalThis.sessionStorage) {
    const store = new Map();
    globalThis.sessionStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => { store.set(String(key), String(value)); },
      removeItem: (key) => { store.delete(String(key)); }
    };
  }
  if (!globalThis.document) {
    globalThis.document = {
      dispatchEvent() { return true; }
    };
  }
}
ensureBrowserGlobals();

const openCourse = (overrides = {}) => ({
  row_id: overrides.row_id || 'c1',
  activity_season: 'school_2027',
  activity_type: 'קורס',
  status: 'פתוח',
  start_date: overrides.start_date ?? '',
  start_time: overrides.start_time ?? '',
  end_time: '11:00',
  school: 'בית ספר',
  authority: 'רשות',
  activity_name: overrides.activity_name || 'קורס בדיקה',
  date_1: overrides.date_1 || overrides.start_date || '',
  ...overrides
});

test('courses start collapsed and render details only after course selection', () => {
  const state = { user: { role: 'admin' }, routes: ['instructors', 'course-scheduling', 'operations-management'] };
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'later', start_date: '2026-09-08', start_time: '10:00', date_1: '2026-09-08' }),
      openCourse({ row_id: 'near', start_date: '2026-08-20', start_time: '10:00', date_1: '2026-08-20' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });

  assert.match(html, /course-scheduling-screen/);
  assert.match(html, /data-instructors-workspace-tab="scheduling"[^>]*aria-selected="true"/);
  assert.match(html, /data-instructors-workspace-tab="maintenance"/);
  assert.doesNotMatch(html, /data-switch-tab=/);
  assert.doesNotMatch(html, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.doesNotMatch(html, /<h2[^>]*instructors-workspace-content-title/);
  assert.doesNotMatch(html, /בחרו קורס, מצאו מדריך מתאים ושמרו כטיוטה או שבצו\./);
  assert.doesNotMatch(html, /course-scheduling-subtitle/);
  assert.match(html, /<b>1<\/b><span>ממתינים לשיבוץ<\/span>/);
  assert.match(html, /<b>0<\/b><span>הצעות מוכנות<\/span>/);
  assert.match(html, /<b>0<\/b><span>טיוטות<\/span>/);
  assert.equal(state.courseSchedulingSelectedId, undefined);
  assert.match(html, /data-course-card="later"/);
  assert.doesNotMatch(html, /course-scheduling-course-card is-selected/);
  assert.doesNotMatch(html, /data-expanded-course-details/);
  assert.match(html, /בחר קורס כדי להתחיל/);

  state.courseSchedulingSelectedId = 'later';
  const openedHtml = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'later', start_date: '2026-09-08', start_time: '10:00', date_1: '2026-09-08' }),
      openCourse({ row_id: 'near', start_date: '2026-08-20', start_time: '10:00', date_1: '2026-08-20' })
    ],
    instructors: [], scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });
  assert.match(openedHtml, /course-scheduling-course-card is-selected/);
  assert.match(openedHtml, /data-expanded-course-details/);
  assert.match(openedHtml, /מצא מדריכים מתאימים/);
  assert.doesNotMatch(openedHtml, /בחר קורס כדי להתחיל/);
  assert.doesNotMatch(html, /טרם בוצע חישוב/);
  assert.doesNotMatch(html, /בניית ועדכון מאגר מרחקים/);
  assert.doesNotMatch(html, /מוכנות לשיבוץ/);
  assert.doesNotMatch(html, /⚙ תחזוקה</);
});

test('readiness counts missing date and missing time separately without double-counting schedule gaps', () => {
  const readiness = courseSchedulingDataReadiness([
    openCourse({ row_id: '1', start_date: '2026-09-01', start_time: '10:00' }),
    openCourse({ row_id: '2', start_date: '2026-09-01', start_time: '' }),
    openCourse({ row_id: '3', start_date: '', start_time: '' }),
    openCourse({ row_id: '4', start_date: '', start_time: '10:00' }),
    { ...openCourse({ row_id: '5' }), status: 'סגור', start_date: '2026-09-01', start_time: '10:00' }
  ]);
  assert.equal(readiness.openCount, 4);
  assert.equal(readiness.readyForInterface, 1);
  assert.equal(readiness.missingStartDate, 2);
  assert.equal(readiness.missingStartTime, 2);
  assert.equal(readiness.missingScheduleCount, 3);
});

test('a course missing both date and time counts once in missingScheduleCount', () => {
  const readiness = courseSchedulingDataReadiness([
    openCourse({ row_id: 'both', start_date: '', start_time: '' })
  ]);
  assert.equal(readiness.missingStartDate, 1);
  assert.equal(readiness.missingStartTime, 1);
  assert.equal(readiness.missingScheduleCount, 1);
});

test('nearest actionable course is preferred and week jumps to its start date', () => {
  const picked = pickNearestActionableCourse([
    { id: 'later', bucket: 'later', course: openCourse({ row_id: 'later', start_date: '2026-12-01' }) },
    { id: 'soon', bucket: 'soon', course: openCourse({ row_id: 'soon', start_date: '2026-08-10' }) },
    { id: 'past', bucket: 'treatment', course: openCourse({ row_id: 'past', start_date: '2026-07-01' }) }
  ], '2026-08-03');
  assert.equal(picked.id, 'soon');
});

test('empty selection prompt appears only when no course can be auto-selected', () => {
  const html = courseSchedulingScreen.render({
    activities: [],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' } } });
  assert.match(html, /אין קורסים לשיבוץ כרגע/);
  assert.doesNotMatch(html, /מצא מדריכים מתאימים/);
});

test('non-admin users do not reach maintenance controls', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'instructor' } } });
  assert.match(html, /אין הרשאה/);
  assert.doesNotMatch(html, /⚙ תחזוקה/);
  assert.doesNotMatch(html, /data-maintenance-action/);
});

test('compact meetings wraps only date and time ranges for RTL', () => {
  const html = compactMeetingsHtml(openCourse({
    start_date: '2026-09-01',
    start_time: '10:00',
    end_time: '11:30',
    date_1: '2026-09-01',
    date_2: '2026-09-08'
  }));
  assert.match(html, /^2 מפגשים ·/);
  assert.match(html, /<bdi dir="ltr">/);
  assert.doesNotMatch(html, /<bdi dir="ltr">2 מפגשים/);
  const bdiCount = (html.match(/<bdi dir="ltr">/g) || []).length;
  assert.equal(bdiCount, 2);
});

test('fixed schedule keeps Hebrew weekday outside ltr bdi', () => {
  const html = fixedScheduleHtml([
    openCourse({
      row_id: 'x',
      emp_id: '1',
      instructor_name: 'נועה',
      start_date: '2026-09-01',
      start_time: '10:00',
      end_time: '11:00',
      date_1: '2026-09-01',
      date_2: '2026-09-08'
    })
  ], 'x');
  assert.match(html, /יום ושעה/);
  assert.doesNotMatch(html, /<bdi dir="ltr">[^<]*יום/);
  assert.match(html, /<bdi dir="ltr">/);
});

test('meeting-state load failure does not dump technical warnings into the main UX', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: false, approvedDates: new Map(), cancelledDates: new Map(), error: 'permission denied' }
  }, { state: { user: { role: 'admin' } } });
  assert.match(html, /data-course-card="a"/);
  assert.match(html, /בחר קורס כדי להתחיל/);
  assert.doesNotMatch(html, /permission denied/);
  assert.doesNotMatch(html, /מידע על מפגשים שהתקיימו או בוטלו לא נטען/);
});

test('missing-info count appears once as a compact clickable counter, not a wide banner', () => {
  const baseState = { user: { role: 'admin' } };
  const data = {
    activities: [
      openCourse({ row_id: 'ready', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' }),
      openCourse({ row_id: 'missing-date', start_date: '', start_time: '' }),
      openCourse({ row_id: 'missing-time', start_date: '2026-09-02', start_time: '' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  };
  const compact = courseSchedulingScreen.render(data, { state: baseState });
  // The old wide alert strip (and its separate "הצגת הקורסים" link) must be gone entirely.
  assert.doesNotMatch(compact, /course-scheduling-alert-compact/);
  assert.doesNotMatch(compact, /קורסים חסרים פרטים ואינם משתתפים בשיבוץ/);
  assert.doesNotMatch(compact, /הצגת הקורסים/);
  // The count shows exactly once, inside the compact clickable "חסרי מידע" counter.
  assert.match(compact, /course-scheduling-summary-card--missing/);
  assert.match(compact, /data-open-readiness-drawer/);
  const missingCountMatches = compact.match(/<b>2<\/b><span>חסרי מידע<\/span>/g) || [];
  assert.equal(missingCountMatches.length, 1);
  assert.doesNotMatch(compact, /3 קורסים פתוחים/);
  assert.doesNotMatch(compact, /חסר תאריך התחלה/);

  const expanded = courseSchedulingScreen.render(data, { state: { ...baseState, courseSchedulingShowDataReadiness: true } });
  assert.match(expanded, /course-scheduling-drawer/);
  assert.match(expanded, /מוכנות לשיבוץ/);
  // Exactly one visible heading carries the drawer title — no duplicate h-tag and no duplicate hidden span.
  const headingMatches = expanded.match(/<h[1-6][^>]*>מוכנות לשיבוץ<\/h[1-6]>/g) || [];
  assert.equal(headingMatches.length, 1);
  assert.doesNotMatch(expanded, /<span[^>]*hidden[^>]*>מוכנות לשיבוץ</);
  assert.match(expanded, /תאריכי המפגשים/);
  assert.match(expanded, /שעת התחלה/);
  assert.match(expanded, /data-open-readiness-course/);
});

test('opening missing activities stores only missing course ids and filters the activities list', () => {
  const activities = [
    openCourse({ row_id: 'ready', start_date: '2026-09-01', start_time: '10:00' }),
    openCourse({ row_id: 'missing-date', start_date: '', start_time: '' }),
    openCourse({ row_id: 'missing-time', start_date: '2026-09-02', start_time: '' }),
    openCourse({ row_id: 'closed', start_date: '', start_time: '', status: 'סגור' })
  ];
  assert.deepEqual(collectMissingScheduleCourseIds(activities).sort(), ['missing-date', 'missing-time']);

  const state = { user: { role: 'admin' }, activitiesMissingScheduleOnly: false, courseSchedulingShowMissingDetails: true };
  const root = {
    handlers: {},
    querySelector(selector) {
      if (selector === '[data-open-missing-schedule-courses]') {
        return {
          addEventListener: (event, handler) => { this.handlers.open = handler; }
        };
      }
      return null;
    },
    querySelectorAll() { return []; }
  };
  const navigations = [];
  const originalDispatch = document.dispatchEvent.bind(document);
  document.dispatchEvent = (event) => {
    navigations.push(event.detail);
    return true;
  };
  try {
    sessionStorage.removeItem(MISSING_SCHEDULE_FILTER_STORAGE_KEY);
    courseSchedulingScreen.bind({
      root,
      data: {
        activities: [
          openCourse({ row_id: 'ready', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' }),
          openCourse({ row_id: 'missing-date', start_date: '', start_time: '' }),
          openCourse({ row_id: 'missing-time', start_date: '2026-09-02', start_time: '', date_1: '2026-09-02' })
        ],
        instructors: [],
        scheduling: {},
        meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
      },
      state,
      rerender: () => {},
      api: {},
      ui: null,
      clearScreenDataCache: () => {}
    });
    assert.ok(root.handlers.open);
    root.handlers.open();
    assert.equal(state.activitiesMissingScheduleOnly, true);
    assert.equal(state.activityPeriodTab, 'school_2027');
    const stored = JSON.parse(sessionStorage.getItem(MISSING_SCHEDULE_FILTER_STORAGE_KEY) || '[]').sort();
    assert.deepEqual(stored, ['missing-date', 'missing-time']);
    assert.deepEqual(navigations.at(-1), { route: 'activities' });

    const filtered = applyMissingScheduleFilter(activities, state, sessionStorage);
    assert.deepEqual(filtered.map((row) => row.row_id).sort(), ['missing-date', 'missing-time']);
    assert.ok(!filtered.some((row) => row.row_id === 'ready'));
    assert.ok(!filtered.some((row) => row.row_id === 'closed'));
  } finally {
    document.dispatchEvent = originalDispatch;
    sessionStorage.removeItem(MISSING_SCHEDULE_FILTER_STORAGE_KEY);
  }
});

test('selected course shows find-instructors CTA without a placeholder waiting card before results', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a1', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, courseSchedulingSelectedId: 'a1' } });
  assert.match(html, /מצא מדריכים מתאימים/);
  assert.doesNotMatch(html, /טרם נבדקו מדריכים לקורס זה/);
  assert.doesNotMatch(html, /חשב הצעות שיבוץ/);
  assert.doesNotMatch(html, /openDrawer|course-panel/);
});

test('removed legacy calendar tab state falls back to the approved courses workspace', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a1', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, routes: ['instructors', 'course-scheduling', 'operations-management'], courseSchedulingTab: 'calendar', courseSchedulingWeek: '2026-08-02' } });
  assert.doesNotMatch(html, /<h1 class="ds-page-header__title">מדריכים<\/h1>/);
  assert.match(html, /data-cs-ui="ux-polish-20260805-v1"/);
  assert.match(html, /data-cs-tab="calendar"/);
  assert.match(html, /data-instructors-workspace-tab="scheduling"[^>]*aria-selected="true"/);
  assert.match(html, /data-course-card="a1"/);
  assert.match(html, /בחר קורס כדי להתחיל/);
  assert.doesNotMatch(html, /course-scheduling-calendar-pane/);
  assert.doesNotMatch(html, /data-switch-tab=/);
});

test('course table renders authority as the second of four compact columns', async () => {
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'with-authority', school: 'בית ספר השקמה', authority: 'רשות השרון', activity_name: 'רובוטיקה', date_1: '2026-09-01', start_date: '2026-09-01', start_time: '10:00' }),
      openCourse({ row_id: 'without-authority', school: 'בית ספר גנים', authority: '', activity_name: 'מדעים', date_1: '2026-09-02', start_date: '2026-09-02', start_time: '10:00' })
    ],
    instructors: [], scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' } } });

  assert.match(html, /<div class="course-scheduling-compact-table-head"[^>]*><span>בית ספר<\/span><span>רשות<\/span><span>קורס<\/span><span>סטטוס<\/span><\/div>/);
  assert.doesNotMatch(html, /data-expanded-course-details/);
  assert.match(html, /course-scheduling-compact-school[^>]*>בית ספר השקמה<\/span>\s*<span class="course-scheduling-compact-cell course-scheduling-compact-authority" title="רשות השרון">רשות השרון<\/span>\s*<strong[^>]*>רובוטיקה<\/strong>/);
  assert.match(html, /course-scheduling-compact-authority" title="—">—<\/span>/);
  assert.match(html, /aria-label="בית ספר השקמה, רשות השרון, רובוטיקה"/);
  const row = /<div class="course-scheduling-compact-row[^>]*data-course-card="with-authority"[\s\S]*?<\/div>/.exec(html)?.[0] || '';
  assert.equal((row.match(/course-scheduling-compact-cell/g) || []).length, 4);

  const compactCss = await readFile(new URL('../frontend/src/screens/course-scheduling-compact-layout.css', import.meta.url), 'utf8');
  const rowColumnDefinitions = compactCss.match(/--course-scheduling-row-columns:[^;]+;/g) || [];
  assert.deepEqual(rowColumnDefinitions, ['--course-scheduling-row-columns: minmax(0, 1.05fr) minmax(0, .75fr) minmax(0, .95fr) minmax(130px, .95fr);']);
  assert.match(compactCss, /\.course-scheduling-compact-authority/);
  assert.doesNotMatch(compactCss, /course-scheduling-compact-action-cell/);
  assert.doesNotMatch(compactCss, /--course-scheduling-row-columns:[^;]*minmax\((?:1[5-9]\d|[2-9]\d\d)px/);
});

test('maintenance is a main tab with inline actions and no legacy dropdown', async () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ date_1: '2026-09-01', start_date: '2026-09-01', start_time: '10:00' })],
    instructors: [], scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, routes: ['instructors', 'course-scheduling', 'operations-management'], courseSchedulingTab: 'maintenance', courseSchedulingDistrict: 'מרכז', courseSchedulingAuthority: 'רשות' } });

  assert.match(html, /data-cs-tab="maintenance"/);
  assert.match(html, /data-instructors-workspace-tab="maintenance"[^>]*aria-selected="true"/);
  assert.match(html, /course-scheduling-maintenance-tab/);
  assert.match(html, /מרחקים קיימים: 0 מתוך 0/);
  assert.match(html, /חסרים: 0/);
  assert.match(html, /דורשים רענון: 0/);
  assert.match(html, /data-update-distances[^>]*>עדכן מרחקים/);
  assert.match(html, /data-maintenance-action="readiness">פתח בדיקת נתונים/);
  assert.doesNotMatch(html, /data-maintenance-action="distances"/);
  assert.doesNotMatch(html, /data-toggle-maintenance|course-scheduling-maintenance-menu|⚙/);
  assert.doesNotMatch(html, /data-district-filter|data-authority-filter/);

  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /instructorsWorkspaceHeaderHtml\(\{ activeTab: tab === 'maintenance' \? 'maintenance' : 'scheduling'/);
  assert.match(source, /loadDistanceCoverage/);
  assert.match(source, /courseSchedulingShowDataReadiness = true/);
  assert.doesNotMatch(source, /distanceMaintenanceDialogHtml|courseSchedulingShowDistanceConfirm = true/);
  assert.doesNotMatch(source, /courseSchedulingMaintenanceOpen|maintenanceMenuHtml|data-toggle-maintenance/);
});

test('activities screen wires the missing-schedule filter into local filtering', async () => {
  const src = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(src, /applyMissingScheduleFilter/);
  assert.match(src, /activitiesMissingScheduleOnly/);
  assert.match(src, /data-clear-missing-schedule-filter/);
  assert.match(src, /data-missing-schedule-filter-banner/);
});

test('counts helper still works after a real calculation payload', () => {
  assert.deepEqual(courseSchedulingCounts([
    { status: 'הצעה מוכנה' },
    { status: 'נדרש טיפול' },
    { status: 'נדרש גיוס' },
    { status: 'חסר מידע' }
  ]), { ready: 1, treatment: 1, recruit: 1, missing: 1 });
});

test('route error helper never returns the raw Edge Function non-2xx string', () => {
  assert.notEqual(
    translateSchedulingRouteError('Edge Function returned a non-2xx status code'),
    'Edge Function returned a non-2xx status code'
  );
});

test('pending activity storage key remains stable for open-activity navigation', () => {
  assert.equal(PENDING_ACTIVITY_STORAGE_KEY, 'dashboard:pending-course-activity-id');
});

test('cache version and hotfix marker are refreshed for the scheduling layout release', async () => {
  const branchSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const branchConfig = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  const branchCache = Number(/const CACHE_VERSION = (\d+);/.exec(branchSw)?.[1] || 0);
  assert.ok(branchCache >= 1412, `expected CACHE_VERSION to include this release, got ${branchCache}`);
  assert.match(branchConfig, /course-scheduling-structural-layout-20260805-v1/);
  assert.match(branchConfig, /scheduling-stage-4-ui-20260806-v1/);
  assert.ok(branchConfig.includes('HOTFIX_VERSION'));
});

test('district filter keeps only operational districts and no reliability warning', () => {
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'n1', authority: 'א', district: 'מחוז צפון' }),
      openCourse({ row_id: 'c1', authority: 'ב', district: 'ירושלים' }),
      openCourse({ row_id: 'x1', authority: 'ג', district: 'מחוז לא תקין' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' } } });

  assert.match(html, /data-district-filter/);
  assert.match(html, /<option value="">כל המחוזות<\/option><option value="צפון">צפון<\/option><option value="מרכז">מרכז<\/option><option value="דרום">דרום<\/option>/);
  assert.doesNotMatch(html, /לא נמצא נתון מחוז אמין/);
  assert.doesNotMatch(html, /מחוז לא תקין/);
});

test('district selection filters authorities and courses by normalized district only', () => {
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'n1', authority: 'רשות צפון', district: 'מחוז צפון', activity_name: 'קורס צפון', date_1: '2026-09-02', start_date: '2026-09-02', start_time: '10:00' }),
      openCourse({ row_id: 'c1', authority: 'רשות מרכז', district: 'ירושלים', activity_name: 'קורס מרכז', date_1: '2026-09-03', start_date: '2026-09-03', start_time: '10:00' }),
      openCourse({ row_id: 'x1', authority: 'רשות חסרה', district: '', activity_name: 'קורס חסר', date_1: '2026-09-04', start_date: '2026-09-04', start_time: '10:00' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, courseSchedulingDistrict: 'מרכז' } });

  assert.match(html, /<option value="מרכז" selected>מרכז<\/option>/);
  assert.match(html, /רשות מרכז/);
  assert.match(html, /קורס מרכז/);
  assert.doesNotMatch(html, /רשות צפון/);
  assert.doesNotMatch(html, /קורס צפון/);
  assert.doesNotMatch(html, /רשות חסרה/);
  assert.doesNotMatch(html, /קורס חסר/);
});

test('course scheduling load requests district and authority_id projection', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /api\.activities\(\{[^}]*activity_period:\s*'school_2027'[^}]*select:\s*'[^']*\bdistrict\b[^']*'/s);
  assert.match(source, /select:\s*'[^']*\bauthority_id\b[^']*'/s);
  assert.match(source, /select:\s*'[^']*\bauthority\b[^']*'/s);
  assert.match(source, /select:\s*'[^']*\bschool\b[^']*'/s);
});

test('scheduling first paint is gated only by the course list', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const loadStart = source.indexOf('async load({ api })');
  const loadEnd = source.indexOf('\n  render(data', loadStart);
  const loader = source.slice(loadStart, loadEnd);
  const primaryAwait = loader.indexOf('const activities = await api.activities');
  const secondaryStart = loader.indexOf('const secondaryPromise = Promise.all');
  const returned = loader.indexOf('return {', secondaryStart);
  assert.ok(primaryAwait >= 0 && secondaryStart > primaryAwait && returned > secondaryStart);
  assert.doesNotMatch(loader.slice(0, secondaryStart), /loadInstructorSchedulingData|loadCourseMeetingState|scheduling_authority_school_locations|loadSchoolCalendarRows|getSession/);
  assert.match(loader, /_secondaryPromise:\s*secondaryPromise/);
  assert.match(source, /await ensureSecondaryReady\(\);[\s\S]*?calculateCandidateTravel/);
});
