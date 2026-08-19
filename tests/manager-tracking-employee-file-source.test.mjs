import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../frontend/src/manager-board-employee-file-tracking-runtime.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260819112000_manager_tracking_employee_file_source.sql', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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
    assert.match(runtime, new RegExp(field));
    assert.ok(runtime.includes(label));
  }
  assert.doesNotMatch(runtime, /payroll_reports/);
  assert.ok(runtime.includes('דוחות שכר אינם מוצגים כאן'));
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

test('manager tracking projection is read-only and loaded after manager workspace', () => {
  assert.doesNotMatch(runtime, /update_manager_instructor_followup/);
  assert.doesNotMatch(runtime, /\.update\s*\(/);
  const workspaceIndex = indexHtml.indexOf('manager-board-workspace-runtime.js');
  const trackingIndex = indexHtml.indexOf('manager-board-employee-file-tracking-runtime.js');
  assert.ok(workspaceIndex >= 0);
  assert.ok(trackingIndex > workspaceIndex);
});
