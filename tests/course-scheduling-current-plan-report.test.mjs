import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { courseSchedulingScreen } from '../frontend/src/screens/course-scheduling.js';

function course(row_id, school, overrides = {}) {
  return {
    row_id, school, activity_name: 'ביומימיקרי', authority: 'רחובות',
    activity_season: 'school_2027', activity_type: 'course', status: 'פתוח',
    date_1: '2026-11-01', start_date: '2026-11-01', start_time: '10:00',
    end_time: '11:30', sessions: 10, ...overrides
  };
}
const baseActivities = [
  course('live', 'אורנים', { emp_id: '31', instructor_name: 'מדריכה שמורה' }),
  course('missing', 'ברושים')
];
const obsoleteProposal = {
  courseId: 'missing', kind: 'proposal', instructorEmpId: '99',
  instructorName: 'מדריך מוצע ישן', school: 'ברושים',
  courseName: 'ביומימיקרי', startDate: '2026-11-01',
  startTime: '10:00', endTime: '11:30',
  meetings: [{ date: '2026-11-01', start_time: '10:00', end_time: '11:30' }]
};
function renderPlanning({ stale = false, affected = [], needsRecalc = false } = {}) {
  const state = {
    user: { role: 'admin' },
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '18.10.2026',
    courseSchedulingPlanningStale: stale,
    courseSchedulingPlanningAffectedIds: affected,
    courseSchedulingPlanningRows: [{ ...obsoleteProposal, needsRecalc }],
    courseSchedulingPlanningReportOpen: true
  };
  const activities = baseActivities.map(a => ({ ...a }));
  const html = courseSchedulingScreen.render({
    activities, instructors: [], scheduling: {}, planningCatalog: [], schoolCalendar: [],
    meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map(), error: '' }
  }, { state });
  const dom = new JSDOM(html);
  return { doc: dom.window.document, dom, activities };
}

test('stale proposals never inflate the instructor work plan or become recruitment recommendations', () => {
  const { doc, dom, activities } = renderPlanning({ stale: true });
  const plan = doc.querySelector('[data-planning-report]');
  assert.equal(plan.dataset.planningReportMode, 'operational-only');
  assert.match(plan.textContent, /שיבוצים שמורים — מחצית א׳/);
  assert.match(plan.textContent, /1 משובצות/);
  assert.match(plan.textContent, /1 טרם שובצו/);
  assert.match(plan.textContent, /מדריכה שמורה/);
  assert.doesNotMatch(plan.textContent, /מדריך מוצע ישן|תקני גיוס מוצעים|תוכנית עבודה מלאה/);
  assert.match(plan.textContent, /המלצות התכנון אינן מעודכנות ולכן אינן מוצגות בדוח/);
  assert.equal(activities[1].emp_id, undefined, 'display rendering cannot create assignments');
  dom.window.close();
});

test('a single dirty planning row or affected activity makes the report operational-only', () => {
  for (const opts of [{ needsRecalc: true }, { affected: ['missing'] }]) {
    const { doc, dom } = renderPlanning(opts);
    assert.equal(doc.querySelector('[data-planning-report]').dataset.planningReportMode, 'operational-only');
    assert.doesNotMatch(doc.querySelector('[data-planning-report]').textContent, /מדריך מוצע ישן/);
    dom.window.close();
  }
});

test('current, validated planning can still display its proposals distinctly from saved assignments', () => {
  const { doc, dom } = renderPlanning();
  const plan = doc.querySelector('[data-planning-report]');
  assert.equal(plan.dataset.planningReportMode, 'current');
  assert.match(plan.textContent, /תוכנית עבודה מלאה — מחצית א׳/);
  assert.match(plan.textContent, /מדריך מוצע ישן/);
  assert.doesNotMatch(plan.textContent, /המלצות התכנון אינן מעודכנות ולכן אינן מוצגות בדוח/);
  dom.window.close();
});
