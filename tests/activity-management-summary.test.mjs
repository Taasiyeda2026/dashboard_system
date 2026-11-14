import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { activityManagementSummary, activityMobileSummaryHtml, managementToday } from '../frontend/src/screens/shared/activity-management-summary.js';
import { applyActivityQuickFilter, applyActivitiesAdvancedFilters } from '../frontend/src/screens/shared/activities-advanced-filters.js';
import { activityWorkDrawerHtml, patchDrawerDatesSection } from '../frontend/src/screens/shared/activity-detail-html.js';

test('planning retains double meetings and never equates elapsed dates or attendance with verified execution', () => {
  const summary = activityManagementSummary({ sessions: 6, meeting_schedule: [{ date: '2026-11-01', performed: 'yes' }, { date: '2026-11-01' }, { date: '2026-11-20' }], attendance_records: [{}] }, '2026-11-14');
  assert.deepEqual(summary, { total: 6, elapsed: 2, future: 1, missingDates: 3, next: '2026-11-20', end: '2026-11-20', verified: null, cancelled: null, elapsedUnverified: null, missingReports: null });
  assert.equal(activityManagementSummary({}).total, null);
  assert.equal(managementToday(new Date('2026-11-14T23:00:00Z')), '2026-11-15');
});

test('mobile summary escapes projected data and never renders private or financial fields', () => {
  const html = activityMobileSummaryHtml({ status: '<script>bad</script>', private_note: 'PRIVATE', price: 'SECRET', date_1: '2027-01-01' }, { manager: 'מנהל', classGroup: 'א׳' });
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('PRIVATE'));
  assert.ok(!html.includes('SECRET'));
  assert.ok(html.includes('חסר תאריך התחלה'));
  assert.ok(!html.includes('ביצוע מאומת באישור ביצוע'));
  assert.ok(!html.includes('לא זמין'));
});

test('quick filters reuse date and assignment filters without changing season or other selections', () => {
  const filters = { program: 'selected' };
  const state = { activityPeriodTab: 'school_2027' };
  applyActivityQuickFilter(filters, state, 'week', '2026-11-14');
  assert.equal(filters.advMeetingFrom, '2026-11-08');
  assert.equal(filters.advMeetingTo, '2026-11-14');
  assert.equal(applyActivitiesAdvancedFilters([{ date_1: '2026-11-14' }, { date_1: '2026-11-15' }], filters).length, 1);
  applyActivityQuickFilter(filters, state, 'today', '2026-11-14');
  assert.equal(filters.advMeetingFrom, filters.advMeetingTo);
  applyActivityQuickFilter(filters, state, 'unassigned');
  assert.equal(state.activitiesInstructorStatusFilter, 'unassigned');
  applyActivityQuickFilter(filters, state, 'missing-start');
  assert.equal(filters.advStartPresence, 'missing');
  assert.equal(filters.program, 'selected');
  assert.equal(state.activityPeriodTab, 'school_2027');
});

test('async drawer dates update the same management summary and keep performance unverified', () => {
  const document = new JSDOM(activityWorkDrawerHtml({ activity_type: 'course', sessions: 4 }, { datesLoading: true })).window.document;
  const section = document.querySelector('[data-dates-section]');
  patchDrawerDatesSection(section, { meeting_schedule: [{ date: '2020-01-01', performed: 'no' }] });
  assert.match(section.querySelector('[data-dates-management-summary]').textContent, /1\/4/);
  assert.doesNotMatch(section.querySelector('[data-dates-management-summary]').textContent, /ביצוע מאומת|לא זמין|ללא אימות/);
  assert.equal(section.querySelector('.is-done'), null);
  assert.match(section.querySelector('[data-dates-progress-meta]').textContent, /לפי לוח מתוכנן/);
});

test('month count offers a numeric mobile label while retaining escaped desktop metadata', async () => {
  const { dsInteractiveCard } = await import('../frontend/src/screens/shared/layout.js');
  const document = new JSDOM(dsInteractiveCard({ action: 'monthcell|15', title: '15', meta: '2 פעילויות <unsafe>', mobileMeta: 2, variant: 'day-cell' })).window.document;
  assert.equal(document.querySelector('.month-count-mobile').textContent, '2');
  assert.equal(document.querySelector('.month-count-mobile').getAttribute('aria-label'), '2 פעילויות <unsafe>');
  assert.equal(document.querySelector('.month-count-desktop').textContent, '2 פעילויות <unsafe>');
  assert.equal(document.querySelector('unsafe'), null);
});

test('partial dated projection cannot invent a planned total; next meeting stays separate from completion', () => {
  assert.equal(activityManagementSummary({ date_1: '2099-01-01' }).total, null);
  const document = new JSDOM(activityWorkDrawerHtml({ activity_type: 'course', sessions: 3, meeting_schedule: [{ date: '2099-02-01' }, { date: '2099-01-01' }] })).window.document;
  assert.equal(document.querySelectorAll('.is-planned-next').length, 1);
  assert.match(document.querySelector('.is-planned-next').textContent, /01\/01\/2099/);
  assert.equal(document.querySelector('.is-done'), null);
});

 test('school 2027 compact summary preserves useful facts without technical diagnostics or duplicated schedule', () => {
  const row = { row_id: 'ACT-1', activity_season: 'school_2027', status: 'פתוח', sessions: 10, start_date: '2099-01-01', date_1: '2099-01-01', end_date: '2099-03-01', management: { approvalsAvailable: true, approvedDates: [], cancellationsAvailable: true, cancelledDates: [], attendanceAvailable: true, attendance: [], exceptionsAvailable: true, exceptions: ['x'], feedback: { available: true, applicable: false, slots: [] }, coordination: { available: true, status: 'not_sent' }, errors: ['staff-feedback'] } };
  const doc = new JSDOM(activityMobileSummaryHtml(row, { school: 'בית ספר', authority: 'רשות', manager: 'מנהל', classGroup: 'קבוצה 1', instructorHtml: '<span>מדריך</span>' })).window.document;
  assert.match(doc.body.textContent, /בית ספר · רשות · קבוצה 1/);
  assert.match(doc.body.textContent, /התקדמות לפי לוח/);
  assert.equal(doc.body.textContent.match(/המפגש הבא/g).length, 1);
  assert.equal(doc.body.textContent.match(/01\/01\/2099/g).length, 1);
  assert.equal(doc.querySelector('[data-management-action="activity"]').dataset.managementRow, 'ACT-1');
  assert.doesNotMatch(doc.body.textContent, /אישור ביצוע|אוכלוסיית|התמונה חלקית|לא זמין|לא נטענו/);
});
