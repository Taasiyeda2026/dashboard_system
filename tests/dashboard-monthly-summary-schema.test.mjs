import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardSummarySchemaForMonth } from '../frontend/src/dashboard-summary-schema.js';
import { activityBelongsToCourseSchedulingPeriod } from '../frontend/src/screens/course-scheduling-periods.js';
import { renderStructuredSummary } from '../frontend/src/screens/dashboard.js';

const summary = {
  active_type_counts: { course: 2, workshop: 1, after_school: 1 },
  active_instructors: ['מדריכה א'], active_instructors_count: 1,
  ending_courses_current_month: 2, starting_activities_current_month: 3,
  semester_totals: { first: 11, second: 22 }, semester_1_unfinished_count: 4,
  counts: { missing_instructor: 5, missing_start_date: 6, end_date_passed: 7, end_date_after_cutoff: 8 }
};
const districts = [
  { activity_manager: 'צפון', total_activities: 1 },
  { activity_manager: 'מרכז', total_activities: 2 },
  { activity_manager: 'דרום', total_activities: 1 }
];

for (const month of ['2026-09', '2026-10']) {
  test(`${month} uses first-semester opening schema without endings`, () => {
    const html = renderStructuredSummary(summary, month, districts);
    assert.match(html, /מחצית א&#39; – סה"כ פעילויות: 11/);
    assert.match(html, /פעילויות שמתחילות החודש/);
    assert.doesNotMatch(html, /פעילויות שמסתיימות החודש/);
    assert.match(html, /ללא מדריך/);
    assert.match(html, /ללא תאריך התחלה/);
  });
}

for (const month of ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06']) {
  test(`${month} displays the existing course/afterschool endings metric`, () => {
    assert.match(renderStructuredSummary(summary, month, districts), /פעילויות שמסתיימות החודש: <strong>2<\/strong>/);
  });
}

test('February changes to semester B and shows unfinished semester A activities', () => {
  const html = renderStructuredSummary(summary, '2027-02', districts);
  assert.match(html, /מחצית ב&#39; – סה"כ פעילויות: 22/);
  assert.match(html, /פעילויות של מחצית א&#39; שטרם הסתיימו: <strong>4<\/strong>/);
});

test('only April through June includes the risky end-date exception', () => {
  assert.doesNotMatch(renderStructuredSummary(summary, '2027-03', districts), /תוכניות עם תאריך סיום בסיכון/);
  for (const month of ['2027-04', '2027-05', '2027-06']) {
    assert.match(renderStructuredSummary(summary, month, districts), /תוכניות עם תאריך סיום בסיכון: <strong>8<\/strong>/);
  }
});

test('selected historical month, rather than current date, determines schema', () => {
  assert.equal(dashboardSummarySchemaForMonth('2026-09').key, 'semester_1_opening');
  assert.equal(dashboardSummarySchemaForMonth('2027-04').key, 'semester_2_closing');
});

test('summary renders each configured exception metric only once', () => {
  const html = renderStructuredSummary(summary, '2026-09', districts);
  assert.equal((html.match(/ללא מדריך/g) || []).length, 1);
  assert.equal((html.match(/ללא תאריך התחלה/g) || []).length, 1);
});

test('semester assignment reuses scheduling meeting-date boundaries, not start_date', () => {
  const activity = { start_date: '2026-09-01', meeting_dates: ['2027-02-10'] };
  assert.equal(activityBelongsToCourseSchedulingPeriod(activity, 'first'), false);
  assert.equal(activityBelongsToCourseSchedulingPeriod(activity, 'second'), true);
});
