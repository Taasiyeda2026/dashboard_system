import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMPONENT_COLUMNS, completionCell } from '../frontend/src/manager-board-employee-file-tracking.js';

const introColumn = COMPONENT_COLUMNS.find((column) => column.field === 'intro_feedback_completed');
const baseRow = {
  emp_id: 9991,
  full_name: 'בדיקת תאריך',
  employment_type: 'שכיר',
  gender: 'male',
  seniority_years: 1,
  employee_created_at: '2026-08-30T10:00:00+03:00',
  intro_feedback_completed: false,
  intro_feedback_due_date: '2026-09-30'
};

test('past incomplete intro due date stays visible and is marked late/red', () => {
  const html = completionCell(baseRow, introColumn, { todayIso: '2026-10-04', schoolYear: '2027' });
  assert.match(html, /עד 30\.09\.26/);
  assert.match(html, /manager-workspace-deadline-date--late/);
  assert.doesNotMatch(html, /✓/);
});

test('future incomplete intro due date stays normal', () => {
  const html = completionCell({ ...baseRow, employee_created_at: '2026-09-28T10:00:00+03:00' }, introColumn, { todayIso: '2026-10-04', schoolYear: '2027' });
  assert.match(html, /עד 28\.10\.26/);
  assert.doesNotMatch(html, /manager-workspace-deadline-date--late/);
});

test('completed item shows checkmark even when its due date is in the past', () => {
  const html = completionCell({ ...baseRow, intro_feedback_completed: true }, introColumn, { todayIso: '2026-10-04', schoolYear: '2027' });
  assert.match(html, /✓/);
  assert.doesNotMatch(html, /manager-workspace-deadline-date--late/);
});

test('late deadline class is red in manager workspace CSS', () => {
  const css = fs.readFileSync(new URL('../frontend/src/styles/manager-board-workspace.css', import.meta.url), 'utf8');
  assert.match(css, /\.manager-workspace-deadline-date--late\{color:#dc2626\}/);
});
