import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const summarySource = await readFile(new URL('../attendance/src/components/report-summary-row.js', import.meta.url), 'utf8');

test('training includes base training and fills Yakum / Greenwork automatically', () => {
  assert.match(source, /activity_name: 'הכשרת בסיס'/);
  assert.match(source, /authority_name: 'יקום'/);
  assert.match(source, /single_school_name: 'Greenwork'/);
  assert.match(source, /school_link_status: 'single_school'/);
  assert.match(source, /if \(reportType === TRAINING_REPORT_TYPE\)/);
  assert.match(source, /source\.unshift\(BASE_TRAINING_ACTIVITY\)/);
  assert.match(source, /if \(id === BASE_TRAINING_OPTION_VALUE\) return BASE_TRAINING_ACTIVITY/);
});

test('base training stores snapshots without fake canonical ids', () => {
  assert.match(source, /const isBaseTraining = isBaseTrainingActivity\(activity\)/);
  assert.match(source, /activity_id: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /activity_row_id: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /activity_no: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /activity_season: isOpen \|\| isBaseTraining \? null/);
  assert.match(source, /program_name: isOpen \|\| isBaseTraining \? null/);
});

test('edit and duplicate restore base training from the saved snapshot', () => {
  assert.match(source, /initialReportType === TRAINING_REPORT_TYPE[\s\S]*activity_name_snapshot[\s\S]*BASE_TRAINING_ACTIVITY\.activity_name/);
  assert.match(source, /applySelectedActivity\(BASE_TRAINING_ACTIVITY\)/);
});

test('base training hides fixed location fields from creation and editing UI', () => {
  assert.match(source, /setLocationFieldsVisible\(!isBaseTrainingActivity\(activity\)\)/);
  assert.match(reportsSource, /isBaseTraining = reportType === 'הכשרה'[\s\S]*actNameField\.input\.value\.trim\(\) === 'הכשרת בסיס'/);
  assert.match(reportsSource, /authField\.wrap\.hidden = isOperations \|\| isBaseTraining/);
  assert.match(reportsSource, /schoolField\.wrap\.hidden = isOperations \|\| isBaseTraining/);
  assert.match(reportsSource, /authority_name_snapshot: isOperations \? null : \(isBaseTraining \? 'יקום'/);
  assert.match(reportsSource, /school_name_snapshot:\s+isOperations \? null : \(isBaseTraining \? 'Greenwork'/);
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
