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

test('summary before calculation shows interface course count and טרם בוצע חישוב', () => {
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'a', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' }),
      openCourse({ row_id: 'b', start_date: '2026-09-08', start_time: '10:00', date_1: '2026-09-08' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' } } });

  assert.match(html, /2 קורסים בממשק/);
  assert.match(html, /טרם בוצע חישוב/);
  assert.doesNotMatch(html, /0 קורסים נבדקו/);
  assert.doesNotMatch(html, /0 הצעה מוכנה/);
  assert.match(html, /בניית ועדכון מאגר מרחקים/);
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

test('auto-select on bind chooses nearest actionable course and sets the week', () => {
  const state = { user: { role: 'admin' } };
  let renders = 0;
  courseSchedulingScreen.bind({
    root: { querySelector: () => null, querySelectorAll: () => [] },
    data: {
      activities: [
        openCourse({ row_id: 'far', start_date: '2026-11-01', start_time: '09:00', date_1: '2026-11-01' }),
        openCourse({ row_id: 'near', start_date: '2026-08-20', start_time: '09:00', date_1: '2026-08-20' })
      ],
      instructors: [],
      scheduling: {},
      meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
    },
    state,
    rerender: () => { renders += 1; },
    api: {},
    ui: null,
    clearScreenDataCache: () => {}
  });
  assert.equal(state.courseSchedulingSelectedId, 'near');
  assert.equal(state.courseSchedulingWeek, '2026-08-20');
  assert.equal(renders, 1);
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

test('meeting-state load failure surfaces a warning and not fake zeros in the panel path', () => {
  const html = courseSchedulingScreen.render({
    activities: [openCourse({ row_id: 'a', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' })],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: false, approvedDates: new Map(), cancelledDates: new Map(), error: 'permission denied' }
  }, { state: { user: { role: 'admin' } } });
  assert.match(html, /מידע על מפגשים שהתקיימו או בוטלו לא נטען/);
});

test('readiness warning is dynamic and exposes an action to open missing activities', () => {
  const html = courseSchedulingScreen.render({
    activities: [
      openCourse({ row_id: 'ready', start_date: '2026-09-01', start_time: '10:00', date_1: '2026-09-01' }),
      openCourse({ row_id: 'missing-date', start_date: '', start_time: '' }),
      openCourse({ row_id: 'missing-time', start_date: '2026-09-02', start_time: '' })
    ],
    instructors: [],
    scheduling: {},
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: { user: { role: 'admin' } } });
  assert.match(html, /3 קורסים פתוחים/);
  assert.match(html, /1 מוכנים להצגה בממשק/);
  assert.match(html, /1 חסרים תאריך התחלה/);
  assert.match(html, /2 חסרים שעת התחלה/);
  assert.match(html, /data-open-missing-schedule-courses/);
  assert.doesNotMatch(html, /117/);
});

test('opening missing activities stores only missing course ids and filters the activities list', () => {
  const activities = [
    openCourse({ row_id: 'ready', start_date: '2026-09-01', start_time: '10:00' }),
    openCourse({ row_id: 'missing-date', start_date: '', start_time: '' }),
    openCourse({ row_id: 'missing-time', start_date: '2026-09-02', start_time: '' }),
    openCourse({ row_id: 'closed', start_date: '', start_time: '', status: 'סגור' })
  ];
  assert.deepEqual(collectMissingScheduleCourseIds(activities).sort(), ['missing-date', 'missing-time']);

  const state = { user: { role: 'admin' }, activitiesMissingScheduleOnly: false };
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
    // Auto-select rerenders once before listeners attach; call bind again after selection.
    if (!root.handlers.open) {
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
    }
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
  assert.ok(branchConfig.includes('HOTFIX_VERSION'));
  assert.ok(mainConfig.includes('HOTFIX_VERSION'));
});
