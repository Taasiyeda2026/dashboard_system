import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const summarySource = await readFile(new URL('../attendance/src/components/report-summary-row.js', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const routeFunctionSource = await readFile(new URL('../supabase/functions/attendance-base-training-routes/index.ts', import.meta.url), 'utf8');
const guardMigrationSource = await readFile(new URL('../supabase/migrations/20260927045500_guard_base_training_attendance.sql', import.meta.url), 'utf8');

test('base training is offered only for the historical Sep 15-17 dates and fills Yakum / Greenwork automatically', () => {
  assert.match(source, /BASE_TRAINING_ALLOWED_DATES = new Set\(\['2026-09-15', '2026-09-16', '2026-09-17'\]\)/);
  assert.match(source, /activity_name: 'הכשרת בסיס'/);
  assert.match(source, /authority_name: 'יקום'/);
  assert.match(source, /single_school_name: 'Greenwork'/);
  assert.match(source, /school_link_status: 'single_school'/);
  assert.match(source, /if \(reportType === TRAINING_REPORT_TYPE\)[\s\S]*if \(!isBaseTrainingDate\(\)\)/);
  assert.match(source, /source\.unshift\(BASE_TRAINING_ACTIVITY\)/);
  assert.match(source, /id === BASE_TRAINING_OPTION_VALUE\) return isBaseTrainingDate\(\) \? BASE_TRAINING_ACTIVITY : null/);
  assert.match(source, /isBaseTraining && !isBaseTrainingDate\(dateStr\)/);
  assert.match(source, /הכשרת בסיס ניתנת לדיווח רק בתאריכים 15–17\.09\.2026/);
});

test('base training stores snapshots without fake canonical ids', () => {
  assert.match(source, /const isBaseTraining = isBaseTrainingActivity\(activity\)/);
  assert.match(source, /activity_id: isOpen \|\| isBaseTraining \|\| activity\?\.__attendanceTrainingSchedule \? null/);
  assert.match(source, /activity_row_id: isOpen \|\| isBaseTraining \|\| activity\?\.__attendanceTrainingSchedule \? null/);
  assert.match(source, /activity_no: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /activity_season: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /program_name: isOpen \|\| isBaseTraining \? null/);
});

test('edit and duplicate restore base training from the saved snapshot', () => {
  assert.match(source, /initialReportType === TRAINING_REPORT_TYPE[\s\S]*activity_name_snapshot[\s\S]*BASE_TRAINING_ACTIVITY\.activity_name/);
  assert.match(source, /applySelectedActivity\(BASE_TRAINING_ACTIVITY, \{ autoFillTimes: false \}\)/);
});

test('base training hides fixed location fields from creation and editing UI', () => {
  assert.match(source, /setLocationFieldsVisible\(!isBaseTrainingActivity\(activity\) && !isOnlineTraining\(\)\)/);
  assert.match(reportsSource, /isBaseTraining = reportType === 'הכשרה'[\s\S]*actNameField\.input\.value\.trim\(\) === 'הכשרת בסיס'/);
  assert.match(reportsSource, /authField\.wrap\.hidden = isOperations \|\| isBaseTraining/);
  assert.match(reportsSource, /schoolField\.wrap\.hidden = isOperations \|\| isBaseTraining/);
  assert.match(reportsSource, /authority_name_snapshot: isOperations \|\| isOnlineTraining \? null : \(isBaseTraining \? 'יקום'/);
  assert.match(reportsSource, /school_name_snapshot:\s+isOperations \|\| isOnlineTraining \? null : \(isBaseTraining \? 'Greenwork'/);
});

test('attendance summary shows only supplemental meaningful details without repeating the collapsed row', () => {
  assert.match(summarySource, /Expanded details therefore contain only additional, meaningful information/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'תאריך'/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'סה״כ שעות'/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'שם פעילות'/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'בית ספר'/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'רשות'/);
  assert.doesNotMatch(summarySource, /addDetail\(details, 'סטטוס'/);
  assert.doesNotMatch(summarySource, /addDetail\([\s\S]*'ביטול זמן'/);
  assert.match(summarySource, /if \(record\.meeting_no != null\) addDetail\(details, 'מפגש'/);
  assert.match(summarySource, /if \(km > 0\) addDetail\(details, 'ק״מ'/);
  assert.match(summarySource, /if \(usesPublicTransport\) addDetail\(details, 'תחבורה ציבורית', 'כן'\)/);
  assert.match(summarySource, /if \(expenses > 0\) addDetail\(details, 'הוצאות'/);
  assert.match(reportsSource, /schoolCell\.textContent = baseTraining \? '—'/);
  assert.match(reportsSource, /authCell\.textContent = baseTraining \? '—'/);
});


test('base training shows a pre-save home-to-Greenwork route preview', () => {
  assert.match(serviceSource, /functions\.invoke\('attendance-base-training-routes'/);
  assert.match(serviceSource, /body: \{ mode: 'preview' \}/);
  assert.match(source, /getBaseTrainingRoutePreview/);
  assert.match(source, /הבית שלך → Greenwork, יקום/);
  assert.match(source, /הלוך \$\{formatTravelMinutes\(outbound\)\}/);
  assert.match(source, /חזור \$\{formatTravelMinutes\(returning\)\}/);
  assert.match(source, /ביטול זמן צפוי \$\{formatTravelMinutes\(cancellation\)\}/);
  assert.match(source, /אין צורך לדווח ביטול זמן בנפרד/);
});

test('base training route service derives instructor home server-side and warms all active instructors', () => {
  assert.match(routeFunctionSource, /GREENWORK_ADDRESS = '6RVR\+XM, יקום'/);
  assert.match(routeFunctionSource, /mode === 'build_all'/);
  assert.match(routeFunctionSource, /from\('contacts_instructors'\)/);
  assert.match(routeFunctionSource, /select\('emp_id,address,active'\)/);
  assert.match(routeFunctionSource, /Math\.max\(0, outbound - 45\) \+ Math\.max\(0, returning - 45\)/);
  assert.match(routeFunctionSource, /mode !== 'preview'/);
  assert.match(routeFunctionSource, /Number\(appUser\.emp_id\)/);
});


test('base training guard exists in both edit UI and database', () => {
  assert.match(reportsSource, /BASE_TRAINING_ALLOWED_DATES = new Set\(\['2026-09-15', '2026-09-16', '2026-09-17'\]\)/);
  assert.match(reportsSource, /isBaseTraining && !isBaseTrainingAllowedDate\(reportDateField\.input\.value\)/);
  assert.match(guardMigrationSource, /new\.report_date < date '2026-09-15'/);
  assert.match(guardMigrationSource, /new\.report_date > date '2026-09-17'/);
  assert.match(guardMigrationSource, /base_training_date_not_allowed/);
  assert.match(guardMigrationSource, /attendance_records_base_training_emp_date_unique/);
});
