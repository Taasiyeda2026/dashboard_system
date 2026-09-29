import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  courseSchedulingScreen,
  filterCourseRowModelsBySearch,
  isCourseSchedulingFocusMode
} from '../frontend/src/screens/course-scheduling.js';
import { activityWorkDrawerHtml } from '../frontend/src/screens/shared/activity-detail-html.js';
import { activitySchedulingStatusSummary } from '../frontend/src/screens/shared/activity-instructor-filter.js';

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
    globalThis.document = { dispatchEvent() { return true; } };
  }
}
ensureBrowserGlobals();

const openCourse = (overrides = {}) => ({
  row_id: overrides.row_id || 'c1',
  activity_season: 'school_2027',
  activity_type: 'קורס',
  status: 'פתוח',
  start_date: overrides.start_date ?? '2026-09-08',
  start_time: overrides.start_time ?? '10:00',
  end_time: overrides.end_time ?? '11:00',
  school: overrides.school || 'בית ספר אלון',
  authority: overrides.authority || 'רמת גן',
  activity_name: overrides.activity_name || 'ביומימיקרי',
  instructor_name: overrides.instructor_name || '',
  emp_id: overrides.emp_id || '',
  draft_emp_id: overrides.draft_emp_id || '',
  draft_instructor_name: overrides.draft_instructor_name || '',
  date_1: overrides.date_1 || overrides.start_date || '2026-09-08',
  ...overrides
});

const baseData = (activities) => ({
  activities,
  instructors: [],
  scheduling: {},
  meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
});

test('activities handoff sets selectedId and focus mode flags', () => {
  const source = readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  const start = source.indexOf("contentRoot.querySelector('[data-open-activity-scheduling]')");
  assert.ok(start > 0);
  const handler = source.slice(start, start + 2600);
  assert.match(handler, /state\.courseSchedulingSelectedId = activityId/);
  assert.match(handler, /state\.courseSchedulingFocusMode = true/);
  assert.match(handler, /state\.courseSchedulingFocusSelectedCard = true/);
  assert.match(handler, /state\.courseSchedulingListSearch = ''/);
  assert.match(handler, /route: 'course-scheduling'/);
});

test('selected activity opens detail automatically and marks scroll/focus target', () => {
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling'],
    courseSchedulingSelectedId: 'focus-1',
    courseSchedulingFocusMode: true,
    courseSchedulingFocusSelectedCard: true
  };
  const html = courseSchedulingScreen.render(baseData([
    openCourse({ row_id: 'focus-1', activity_name: 'פעילות ממוקדת' }),
    openCourse({ row_id: 'other-2', activity_name: 'פעילות אחרת', school: 'בית ספר אחר' })
  ]), { state });

  assert.match(html, /course-scheduling-detail is-open/);
  assert.match(html, /data-course-card="focus-1"[^>]*data-course-scroll-target="selected"|data-course-scroll-target="selected"[^>]*data-course-card="focus-1"/);
  assert.match(html, /course-scheduling-course-card is-selected/);
  assert.match(html, /is-activity-focus/);
  assert.match(html, /has-selected-course/);
  assert.equal(state.courseSchedulingSelectedId, 'focus-1');
});

test('focus mode shows only the selected activity and reveal-all restores the full list', () => {
  const activities = [
    openCourse({ row_id: 'focus-1', activity_name: 'פעילות ממוקדת' }),
    openCourse({ row_id: 'other-2', activity_name: 'פעילות אחרת', school: 'בית ספר אחר' }),
    openCourse({ row_id: 'other-3', activity_name: 'עוד פעילות', authority: 'חולון' })
  ];
  const state = {
    user: { role: 'admin' },
    routes: ['instructors', 'course-scheduling'],
    courseSchedulingSelectedId: 'focus-1',
    courseSchedulingFocusMode: true
  };

  assert.equal(isCourseSchedulingFocusMode(state), true);
  const focusedHtml = courseSchedulingScreen.render(baseData(activities), { state });
  assert.match(focusedHtml, /data-course-focus-banner/);
  assert.match(focusedHtml, /הצג את כל הפעילויות/);
  assert.match(focusedHtml, /data-course-card="focus-1"/);
  assert.doesNotMatch(focusedHtml, /data-course-card="other-2"/);
  assert.doesNotMatch(focusedHtml, /data-course-card="other-3"/);

  state.courseSchedulingFocusMode = false;
  const allHtml = courseSchedulingScreen.render(baseData(activities), { state });
  assert.doesNotMatch(allHtml, /data-course-focus-banner/);
  assert.match(allHtml, /data-course-card="focus-1"/);
  assert.match(allHtml, /data-course-card="other-2"/);
  assert.match(allHtml, /data-course-card="other-3"/);
});

test('local course list search filters by activity, school, authority, instructor and id', () => {
  const rows = [
    {
      id: 'a1',
      instructorLabel: 'ורד עליאן',
      course: openCourse({
        row_id: 'a1',
        activity_name: 'ביומימיקרי',
        school: 'בית ספר אלון',
        authority: 'רמת גן',
        instructor_name: 'ורד עליאן',
        emp_id: '1500'
      })
    },
    {
      id: 'b2',
      instructorLabel: 'אפרת אוחיון',
      course: openCourse({
        row_id: 'b2',
        activity_name: 'רובוטיקה',
        school: 'בית ספר ניצן',
        authority: 'חולון',
        draft_instructor_name: 'אפרת אוחיון',
        draft_emp_id: '1600'
      })
    }
  ];

  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'ביו').map((row) => row.id), ['a1']);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'ניצן').map((row) => row.id), ['b2']);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'חולון').map((row) => row.id), ['b2']);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'ורד').map((row) => row.id), ['a1']);
  assert.deepEqual(filterCourseRowModelsBySearch(rows, 'b2').map((row) => row.id), ['b2']);

  const html = courseSchedulingScreen.render(baseData(rows.map((row) => row.course)), {
    state: {
      user: { role: 'admin' },
      routes: ['instructors', 'course-scheduling'],
      courseSchedulingListSearch: 'רובוטיקה'
    }
  });
  assert.match(html, /data-course-list-search/);
  assert.match(html, /data-clear-course-list-search/);
  assert.match(html, /data-course-card="b2"/);
  assert.doesNotMatch(html, /data-course-card="a1"/);
});

test('desktop workboard keeps independent list scroll while mobile stays page-scroll', async () => {
  const compactCss = readFileSync(new URL('../frontend/src/screens/course-scheduling-compact-layout.css', import.meta.url), 'utf8');
  const baseCss = readFileSync(new URL('../frontend/src/screens/course-scheduling.css', import.meta.url), 'utf8');
  assert.match(compactCss, /\.course-scheduling-screen\.is-simple-workboard \.course-scheduling-courses \{[\s\S]*overflow-y:\s*auto/);
  assert.match(compactCss, /max-height:\s*calc\(100vh/);
  assert.match(compactCss, /has-selected-course \.course-scheduling-layout--courses \{[\s\S]*grid-template-columns:\s*minmax\(0, 1\.25fr\)/);
  assert.match(compactCss, /@media \(max-width: 900px\) \{[\s\S]*\.course-scheduling-screen\.is-simple-workboard \.course-scheduling-courses \{[\s\S]*overflow:\s*visible/);
  assert.match(baseCss, /@media \(max-width: 900px\) \{[\s\S]*\.course-scheduling-screen\.is-simple-workboard \.course-scheduling-courses \{[\s\S]*overflow:\s*visible/);
});

test('activity drawer shows scheduling status card and open-scheduling CTA', () => {
  const html = activityWorkDrawerHtml({
    id: 'activity-1',
    row_id: '1',
    activity_type: 'course',
    status: 'open',
    activity_name: 'ביומימיקרי',
    activity_season: 'school_2027',
    instructor_name: 'ורד עליאן',
    emp_id: '1500',
    start_date: '2026-09-09',
    start_time: '10:00',
    end_time: '11:30',
    date_1: '2026-09-09'
  }, { canEdit: true, canDirectEdit: true, canSchedule: true });
  const rendered = new JSDOM(html).window.document;
  const status = rendered.querySelector('[data-activity-scheduling-status]');
  assert.ok(status);
  assert.match(status.textContent, /מצב שיבוץ/);
  assert.match(status.textContent, /משובץ · ורד עליאן/);
  assert.equal(rendered.querySelector('[data-open-activity-scheduling]')?.textContent.trim(), 'פתח שיבוץ');
  assert.equal(rendered.querySelector('[data-activity-actions] [data-open-activity-scheduling]'), null);

  assert.deepEqual(activitySchedulingStatusSummary({
    draft_emp_id: '12',
    draft_instructor_name: 'אפרת אוחיון'
  }), {
    assignment: 'draft',
    statusLabel: 'ממתין לאישור · אפרת אוחיון',
    scheduleLabel: '',
    hasProposal: false,
    proposalLabel: ''
  });
  assert.equal(activitySchedulingStatusSummary({}, { kind: 'proposal', instructorEmpId: '9', startDate: '2026-09-01' }).proposalLabel, 'קיימת הצעה');
});

test('bind focuses selected card with scrollIntoView center when arriving from activities', () => {
  const source = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /scrollIntoView\(\{ block: 'center'/);
  assert.match(source, /courseSchedulingFocusSelectedCard/);
  assert.match(source, /data-show-all-courses/);
  assert.match(source, /data-course-list-search/);
});
