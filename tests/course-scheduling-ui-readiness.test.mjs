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

test('courses tab auto-selects nearest course and shows its details', () => {
  const state = { user: { role: 'admin' } };
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
  assert.match(html, /data-switch-tab="courses"/);
  assert.match(html, /data-switch-tab="calendar"/);
  assert.match(html, /<h1 class="course-scheduling-title">שיבוצים<\/h1>/);
  assert.match(html, /בחרו קורס, מצאו מדריך מתאים ושמרו כטיוטה או שבצו\./);
  assert.match(html, /<b>2<\/b><span>ממתינים לשיבוץ<\/span>/);
  assert.match(html, /<b>0<\/b><span>הצעות מוכנות<\/span>/);
  assert.match(html, /<b>0<\/b><span>טיוטות<\/span>/);
  assert.equal(state.courseSchedulingSelectedId, 'near');
  assert.match(html, /data-course-card="near"/);
  assert.match(html, /course-scheduling-course-card is-selected/);
  assert.match(html, /מצא מדריכים מתאימים/);
  assert.doesNotMatch(html, /בחר קורס כדי להתחיל/);
  assert.doesNotMatch(html, /טרם בוצע חישוב/);
  assert.doesNotMatch(html, /בניית ועדכון מאגר מרחקים/);
  assert.doesNotMatch(html, /מוכנות לשיבוץ/);
  assert.match(html, /⚙ תחזוקת המערכת/);
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
  assert.doesNotMatch(html, /תחזוקת המערכת/);
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
  assert.match(html, /קורסים לשיבוץ/);
  assert.doesNotMatch(html, /permission denied/);
  assert.doesNotMatch(html, /מידע על מפגשים שהתקיימו או בוטלו לא נטען/);
});

test('missing-courses alert is compact and expands into clear fix details', () => {
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
  assert.match(compact, /course-scheduling-alert-compact--warning/);
  assert.match(compact, /2 קורסים אינם מוכנים לשיבוץ/);
  assert.match(compact, /course-scheduling-btn--secondary[^"]*course-scheduling-btn--sm[^"]*"[^>]*data-toggle-missing-details|data-toggle-missing-details[^>]*course-scheduling-btn--sm/);
  assert.match(compact, /הצגת הקורסים לתיקון/);
  assert.doesNotMatch(compact, /3 קורסים פתוחים/);
  assert.doesNotMatch(compact, /חסר תאריך התחלה/);

  const expanded = courseSchedulingScreen.render(data, { state: { ...baseState, courseSchedulingShowMissingDetails: true } });
  assert.match(expanded, /חסר תאריך התחלה/);
  assert.match(expanded, /חסרה שעת התחלה/);
  assert.match(expanded, /data-open-missing-schedule-courses/);
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

test('selected course shows find-instructors CTA and waiting card before results', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a1', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, courseSchedulingSelectedId: 'a1' } });
  assert.match(html, /מצא מדריכים מתאימים/);
  assert.match(html, /טרם נבדקו מדריכים לקורס זה/);
  assert.doesNotMatch(html, /חשב הצעות שיבוץ/);
  assert.doesNotMatch(html, /openDrawer|course-panel/);
});

test('calendar tab empty state points users back to courses', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a1', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' }, courseSchedulingTab: 'calendar', courseSchedulingWeek: '2026-08-02' } });
  assert.match(html, /<h1 class="course-scheduling-title">מערכת שבועית<\/h1>/);
  assert.match(html, /צפו בקורסים ששובצו ובטיוטות לפי שבוע\./);
  assert.doesNotMatch(html, /בחרו קורס, מצאו מדריך מתאים ושמרו כטיוטה או שבצו\./);
  assert.match(html, /data-cs-ui="ux-polish-20260804-v4"/);
  assert.match(html, /data-cs-tab="calendar"/);
  assert.match(html, /course-scheduling-calendar-pane--empty/);
  assert.match(html, /course-scheduling-empty-wrap/);
  assert.match(html, /course-scheduling-empty--compact/);
  assert.match(html, /אין שיבוצים בשבוע זה/);
  assert.match(html, /course-scheduling-btn--secondary[^"]*course-scheduling-empty-action[^"]*"[^>]*data-switch-tab="courses"|data-switch-tab="courses"[^>]*course-scheduling-empty-action/);
  assert.doesNotMatch(html, /course-scheduling-empty-action[^"]*course-scheduling-btn--primary|course-scheduling-btn--primary[^"]*course-scheduling-empty-action/);
  assert.match(html, /מעבר לקורסים לשיבוץ/);
  const css = await readFile(new URL('../frontend/src/screens/course-scheduling.css', import.meta.url), 'utf8');
  assert.match(css, /\.course-scheduling-empty-action\s*\{[^}]*width:\s*auto;/s);
  assert.match(css, /\.course-scheduling-empty-action\s*\{[^}]*align-self:\s*center;/s);
  assert.match(css, /\.course-scheduling-empty-action\s*\{[^}]*padding:\s*9px\s+18px;/s);
  assert.doesNotMatch(css, /\.course-scheduling-empty-action\s*\{[^}]*width:\s*100%/s);
  assert.doesNotMatch(css, /\.course-scheduling-empty-action\s*\{[^}]*flex:\s*1(?!\s*0)/s);
  assert.match(html, /⚙ תחזוקת המערכת/);
  assert.match(html, /course-scheduling-calendar-toolbar-nav/);
  assert.match(html, /course-scheduling-calendar-toolbar-center/);
  assert.match(html, /course-scheduling-calendar-toolbar-views/);
  assert.match(html, /תצוגה שבועית/);
  assert.match(html, /מערכת קבועה/);
  assert.doesNotMatch(html, /מצא מדריכים מתאימים/);
  assert.doesNotMatch(html, /בחרו קורס, מצאו מדריך מתאים/);
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

test('cache versions on this branch are ahead of origin/main after sync', async () => {
  const branchSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const branchConfig = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  const { execFileSync } = await import('node:child_process');
  const mainSw = execFileSync('git', ['show', 'origin/main:frontend/sw.js'], { encoding: 'utf8' });
  const mainConfig = execFileSync('git', ['show', 'origin/main:frontend/src/config.js'], { encoding: 'utf8' });
  const branchCache = Number(/const CACHE_VERSION = (\d+);/.exec(branchSw)?.[1] || 0);
  const mainCache = Number(/const CACHE_VERSION = (\d+);/.exec(mainSw)?.[1] || 0);
  assert.ok(branchCache > mainCache, `expected CACHE_VERSION ${branchCache} > main ${mainCache}`);
  assert.match(branchConfig, /course-scheduling-blocking-fixes-20260803-v2/);
  assert.match(branchConfig, /single-route-expiry-ui-20260803-v4/);
  assert.match(branchConfig, /course-scheduling-isolated-design-20260803-v1/);
  assert.match(branchConfig, /course-scheduling-ux-redesign-20260804-v1/);
  assert.match(branchConfig, /course-scheduling-ux-polish-20260804-v1/);
  assert.match(branchConfig, /course-scheduling-empty-action-btn-20260804-v4/);
  assert.ok(branchConfig.includes('HOTFIX_VERSION'));
  assert.ok(mainConfig.includes('HOTFIX_VERSION'));
});
