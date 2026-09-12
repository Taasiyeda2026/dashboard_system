import test from 'node:test';
import assert from 'node:assert/strict';
import { courseScheduleTableHtml } from '../frontend/src/screens/shared/instructor-course-schedule-view.js';

const row = {
  key: 'activity-1',
  name: 'פעילות לדוגמה',
  activityType: 'קורס',
  authority: 'רשות',
  school: 'בית ספר',
  instructorNames: ['מדריך'],
  weekday: 'יום א׳',
  timeRange: '08:30–10:30',
  startDate: '2026-09-01',
  endDate: '2026-12-01',
  grade: 'ה׳',
  sessionsCount: 11,
  dates: ['2026-09-01', '2026-09-08']
};

test('work schedule hides date count and uses a fixed activity-dates button', () => {
  const html = courseScheduleTableHtml([row]);

  assert.doesNotMatch(html, /מס׳ תאריכים|מספר תאריכים/);
  assert.doesNotMatch(html, />11<|11 תאריכים|תאריך אחד/);
  assert.equal((html.match(/>תאריכי הפעילות</g) || []).length, 4);
  assert.match(html, /data-ops-course-dates-toggle="activity-1"[^>]*aria-expanded="false"[^>]*>תאריכי הפעילות<\/button>/);
  assert.match(html, /data-ops-course-dates-row="activity-1" hidden><td colspan="10">/);
});

test('work schedule keeps the same fixed button label when dates are expanded', () => {
  const html = courseScheduleTableHtml([row], { expandedDates: { 'activity-1': true } });

  assert.match(html, /data-ops-course-dates-toggle="activity-1"[^>]*aria-expanded="true"[^>]*>תאריכי הפעילות<\/button>/);
  assert.doesNotMatch(html, /הצגת תאריכי מפגשים|הסתרת תאריכי מפגשים/);
  assert.match(html, /data-ops-course-dates-row="activity-1"><td colspan="10">/);
});
