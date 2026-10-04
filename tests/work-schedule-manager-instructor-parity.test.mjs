import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('manager and instructor work schedules use the same row model, table view and print document', async () => {
  const [managerSource, instructorSource, portalDataSource] = await Promise.all([
    read('../frontend/src/screens/operations-management.js'),
    read('../frontend/src/screens/instructor-portal/work-schedule.js'),
    read('../frontend/src/screens/instructor-portal/portal-data.js')
  ]);

  assert.match(managerSource, /buildInstructorWorkScheduleRows/);
  assert.match(managerSource, /courseScheduleTableHtml\(scheduleRows/);
  assert.match(managerSource, /openCourseSchedulePrintWindow\(\{ instructorName, rows \}\)/);

  assert.match(portalDataSource, /buildInstructorWorkScheduleRows\(assigned\)/);
  assert.match(instructorSource, /courseScheduleTableHtml\(rows, \{ expandedDates, showInstructorColumn: false \}\)/);
  assert.match(instructorSource, /openCourseSchedulePrintWindow\(\{ instructorName: currentInstructorName\(state\), rows \}\)/);
});

test('school-2027 manager rows carry the same activity manager required by instructor print rows', async () => {
  const [runtimeSource, apiSource] = await Promise.all([
    read('../frontend/src/activity-2027-contact-list-runtime.js'),
    read('../frontend/src/api.js')
  ]);

  assert.match(runtimeSource, /row_id,school_contact_id,contact_name,contact_phone,contact_email,activity_manager,activity_domain,israa_shared/);
  assert.match(runtimeSource, /activity_manager:\s*text\(meta\.activity_manager\) \|\| text\(row\.activity_manager\)/);
  assert.match(apiSource, /INSTRUCTOR_PORTAL_ACTIVITY_COLUMNS[^;]+activity_manager,school_contact_id,contact_name,contact_phone,contact_email/);
});

test('canonical printable document keeps the approved three-column layout and meeting-date section', async () => {
  const printSource = await read('../frontend/src/screens/shared/instructor-course-schedule-print.js');

  const activity = printSource.indexOf('<h2 class="cs-card__section-title">פרטי הפעילות</h2>');
  const school = printSource.indexOf('<h2 class="cs-card__section-title">בית הספר ופרטי איש קשר</h2>');
  const ops = printSource.indexOf('<h2 class="cs-card__section-title">פרטים תפעוליים</h2>');
  const dates = printSource.indexOf('<h2 class="cs-card__dates-title">תאריכי המפגשים</h2>');

  assert.ok(activity >= 0 && school > activity && ops > school && dates > ops);
  assert.match(printSource, /fieldRowHtml\('סוג הפעילות', row\.activityType\)[\s\S]*fieldRowHtml\('שם הפעילות', row\.name\)[\s\S]*fieldRowHtml\('מספר מפגשים',[\s\S]*fieldRowHtml\('מנהל הפעילות', row\.manager\)/);
  assert.match(printSource, /fieldRowHtml\('רשות', row\.authority\)[\s\S]*fieldRowHtml\('בית ספר', row\.school\)[\s\S]*fieldRowHtml\('כיתה', row\.grade\)[\s\S]*fieldRowHtml\('שם איש הקשר', row\.contactName\)[\s\S]*fieldRowHtml\('טלפון איש הקשר', row\.contactPhone\)/);
  assert.match(printSource, /fieldRowHtml\('יום קבוע', row\.weekday\)[\s\S]*fieldRowHtml\('שעות', row\.timeRange\)[\s\S]*fieldRowHtml\('תאריך התחלה',[\s\S]*fieldRowHtml\('תאריך סיום',/);
  assert.match(printSource, /<div class="cs-dates-grid">\$\{datesHtml\}<\/div>/);
});
