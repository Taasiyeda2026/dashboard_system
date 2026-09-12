import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const trackingLogic = fs.readFileSync(new URL('../frontend/src/manager-board-employee-file-tracking.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260819112000_manager_tracking_employee_file_source.sql', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sources = `${workspace}\n${trackingLogic}`;

const expectedComponents = [
  ['signed_agreement_completed', 'הסכם חתום'],
  ['supporting_documents_completed', 'מסמכים נלווים'],
  ['police_clearance_completed', 'אישור משטרה'],
  ['intro_feedback_completed', 'משוב היכרות'],
  ['midyear_feedback_completed', 'משוב אמצע שנה'],
  ['year_end_feedback_completed', 'משוב סוף שנה'],
  ['observation_1_completed', 'תצפית 1'],
  ['observation_2_completed', 'תצפית 2']
];

test('manager tracking mirrors employee-file components and excludes payroll', () => {
  for (const [field, label] of expectedComponents) {
    assert.match(sources, new RegExp(field));
    assert.ok(sources.includes(label));
  }
  assert.doesNotMatch(sources, /payroll_reports/);
  assert.doesNotMatch(sources, /תצוגה לקריאה בלבד של תיק העובד/);
  assert.doesNotMatch(sources, /דוחות שכר אינם מוצגים כאן/);
});

test('manager roster derives tracking completion only from employee document status', () => {
  assert.match(migration, /from public\.instructor_employee_document_status s/i);
  assert.doesNotMatch(migration, /join public\.manager_instructor_followup/i);
  for (const key of [
    'signed_agreement',
    'supporting_documents',
    'police_clearance',
    'intro_feedback',
    'midyear_feedback',
    'year_end_feedback',
    'observation_1',
    'observation_2'
  ]) {
    assert.ok(migration.includes(`component_key = '${key}'`));
  }
});

test('manager tracking projection is read-only and rendered by the single roster owner', () => {
  assert.doesNotMatch(sources, /update_manager_instructor_followup/);
  assert.doesNotMatch(workspace, /\.update\s*\(/);
  assert.match(workspace, /tableHtml as trackingTableHtml/);
  assert.equal((workspace.match(/supabase\.rpc\('get_manager_team_roster'/g) || []).length, 1);
  assert.doesNotMatch(indexHtml, /manager-board-employee-file-tracking-runtime\.js/);
});

test('manager tracking shows existing deadlines inline without info popovers', () => {
  assert.match(sources, /manager-workspace-deadline-date/);
  assert.match(sources, />עד \$\{escapeHtml\(due\)\}<\/span>/);
  assert.match(sources, /match\[1\]\.slice\(2\)/);
  assert.match(sources, /manager-workspace-deadline-empty/);
  assert.doesNotMatch(sources, /manager-workspace-deadline-info/);
  assert.doesNotMatch(sources, /manager-workspace-deadline-popover/);
  assert.doesNotMatch(sources, /נותרו \$\{days\} ימים/);
});

test('manager tracking keeps the SharePoint target while using the requested label', () => {
  assert.match(workspace, /SHAREPOINT_EMPLOYEE_FILES_ROOT_2027/);
  assert.match(workspace, /פתיחת כל תיקי המדריכים/);
  assert.doesNotMatch(workspace, /פתיחת תיקי עובדים ב־SharePoint/);
});
