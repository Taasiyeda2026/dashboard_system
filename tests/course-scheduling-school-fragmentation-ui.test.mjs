import test from 'node:test';
import assert from 'node:assert/strict';
import { courseSchedulingScreen, stalePlanningRowForDisplay } from '../frontend/src/screens/course-scheduling.js';

if (!globalThis.sessionStorage) globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
if (!globalThis.document) globalThis.document = { dispatchEvent: () => true };

const activity = (id) => ({
  row_id: id, school_id: 'school-1', school: 'הר טוב', authority: 'מטה יהודה',
  activity_name: `פעילות ${id}`, activity_season: 'school_2027', activity_type: 'קורס', status: 'פתוח',
  start_date: '2027-01-04'
});
const planningRow = (id, stale = false) => {
  const row = {
    courseId: id, schoolId: 'school-1', school: 'הר טוב', kind: 'proposal',
    instructorEmpId: '1550', instructorName: 'לירון נחום-בלילה',
    startDate: '2027-01-04', startTime: '10:00', endTime: '11:00',
    meetings: [{ date: '2027-01-04', start_time: '10:00', end_time: '11:00' }],
    options: [{ instructorEmpId: '1550', instructorName: 'לירון נחום-בלילה', meetings: [{ date: '2027-01-04', start_time: '10:00', end_time: '11:00' }] }],
    schoolPlanning: {
      schoolId: 'school-1', groupActivityCount: 2, actualWeekdays: [1, 2],
      minimumFeasibleWeekdays: 1, avoidableSplitCount: 1, anchorWeekdays: [], packingStatus: 'avoidable_split'
    }
  };
  return stale ? stalePlanningRowForDisplay(row) : row;
};

function render(rows, state = {}) {
  return courseSchedulingScreen.render({
    activities: [activity('a'), activity('b')], instructors: [], scheduling: {}, planningCatalog: [],
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state: {
    user: { role: 'admin' }, routes: ['instructors', 'course-scheduling'],
    courseSchedulingPlanningRows: rows, courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '03.10.2026, 12:00', ...state
  } });
}

test('workboard and summary expose avoidable school fragmentation', () => {
  const html = render([planningRow('a'), planningRow('b')]);
  assert.match(html, /בתי ספר מפוצלים/);
  assert.match(html, /בתי ספר מפוצלים: 1/);
  assert.match(html, /2 פעילויות · ⚠ מפוצל ל־2 ימים — ניתן לצמצם/);
});

test('fragmented-school filter coexists with status/focus/search rendering', () => {
  const html = render([planningRow('a'), planningRow('b')], {
    courseSchedulingSchoolFragmentationFilter: true,
    courseSchedulingBusinessStatus: 'open',
    courseSchedulingListSearch: 'הר טוב'
  });
  assert.match(html, /data-school-fragmentation-filter/);
  assert.match(html, /data-course-list-search/);
  assert.match(html, /data-course-card="a"/);
  assert.match(html, /data-course-card="b"/);
});

test('detail drawer explains school activities and avoidable split', () => {
  const html = render([planningRow('a'), planningRow('b')], { courseSchedulingSelectedId: 'a' });
  assert.match(html, /פעילויות נוספות בבית הספר/);
  assert.match(html, /2 פעילויות · ימים ב׳, ג׳/);
  assert.match(html, /ניתן לצמצם את הפיצול/);
});

test('L: stale planning never presents fragmentation as current fact', () => {
  const html = render([planningRow('a', true), planningRow('b', true)]);
  assert.match(html, /נדרש עדכון תכנון/);
  assert.doesNotMatch(html, /⚠ מפוצל ל־2 ימים — ניתן לצמצם/);
  assert.match(html, /בתי ספר מפוצלים: 0/);
});
