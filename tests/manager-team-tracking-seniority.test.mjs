import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  resolveIntroFeedbackDueDate,
  tableHtml,
  completionCell,
  COMPONENT_COLUMNS,
  AVIGDOR_SHARON_EMP_ID,
  NOT_FOR_UPDATE_LABEL,
  MISSING_SENIORITY_LABEL,
  formatDate
} from '../frontend/src/manager-board-employee-file-tracking.js';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910193000_manager_team_roster_seniority_intro_due.sql', import.meta.url),
  'utf8'
);
const runtime = fs.readFileSync(
  new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url),
  'utf8'
);

const introColumn = COMPONENT_COLUMNS.find((column) => column.field === 'intro_feedback_completed');

function row(overrides = {}) {
  return {
    emp_id: 1001,
    full_name: 'מדריך רגיל',
    employment_type: 'שכיר',
    gender: 'male',
    seniority_years: 1,
    employee_created_at: '2026-09-09T10:00:00+03:00',
    intro_feedback_completed: false,
    intro_feedback_due_date: null,
    signed_agreement_completed: false,
    supporting_documents_completed: false,
    police_clearance_completed: false,
    midyear_feedback_completed: false,
    year_end_feedback_completed: false,
    observation_1_completed: false,
    observation_2_completed: false,
    observation_1_due_date: '2026-11-01',
    observation_2_due_date: null,
    folder_web_url: 'https://example.com/folder',
    ...overrides
  };
}

test('A: new employee seniority_years=1 gets intro due one month after hire', () => {
  const due = resolveIntroFeedbackDueDate({
    seniority_years: 1,
    employee_created_at: '2026-09-09'
  });
  assert.equal(due, '2026-10-09');
  assert.equal(formatDate(due), '09.10.26');

  const html = completionCell(
    row({
      seniority_years: 1,
      employee_created_at: '2026-09-09',
      intro_feedback_due_date: '2026-10-09'
    }),
    introColumn
  );
  assert.match(html, /עד 09\.10\.26/);
  assert.match(html, /aria-label="שיחת היכרות:/);
  assert.doesNotMatch(html, /✓/);
});

test('B: veteran seniority_years=2 gets opening-year due 20.10.26', () => {
  const due = resolveIntroFeedbackDueDate({ seniority_years: 2 });
  assert.equal(due, '2026-10-20');
  assert.equal(formatDate(due), '20.10.26');

  const html = completionCell(
    row({
      seniority_years: 2,
      employee_created_at: '2024-01-01',
      intro_feedback_due_date: '2026-10-20'
    }),
    introColumn
  );
  assert.match(html, /עד 20\.10\.26/);
  assert.match(html, /aria-label="שיחת פתיחת שנה:/);
});

test('C: veteran with old employee_created_at still uses 20.10.26 not hire+1month', () => {
  const due = resolveIntroFeedbackDueDate({
    seniority_years: 2,
    employee_created_at: '2026-05-18'
  });
  assert.equal(due, '2026-10-20');
  assert.notEqual(due, '2026-06-18');

  const html = completionCell(
    row({
      seniority_years: 3,
      employee_created_at: '2026-05-18',
      intro_feedback_due_date: '2026-06-18'
    }),
    introColumn
  );
  assert.match(html, /עד 20\.10\.26/);
  assert.doesNotMatch(html, /18\.06\.26/);
});

test('D: null seniority_years does not invent a due date', () => {
  assert.equal(resolveIntroFeedbackDueDate({
    seniority_years: null,
    employee_created_at: '2026-09-09',
    intro_feedback_due_date: '2026-10-09'
  }), null);

  const html = completionCell(
    row({
      seniority_years: null,
      employee_created_at: '2026-09-09',
      intro_feedback_due_date: '2026-10-09'
    }),
    introColumn
  );
  assert.match(html, new RegExp(MISSING_SENIORITY_LABEL));
  assert.match(html, /אין נתון ותק/);
  assert.doesNotMatch(html, /עד \d{2}\.\d{2}\.\d{2}/);
  assert.doesNotMatch(html, />—</);
});

test('E: completed intro call shows checkmark instead of due date', () => {
  const html = completionCell(
    row({
      seniority_years: 2,
      intro_feedback_completed: true,
      intro_feedback_due_date: '2026-10-20'
    }),
    introColumn
  );
  assert.match(html, /✓/);
  assert.doesNotMatch(html, /עד 20\.10\.26/);
});

test('F: Avigdor emp_id 1519 keeps police clearance and marks other tracking cells as not-for-update', () => {
  const avigdor = row({
    emp_id: AVIGDOR_SHARON_EMP_ID,
    full_name: 'אביגדור שרון',
    seniority_years: 5,
    police_clearance_completed: true,
    intro_feedback_completed: true,
    signed_agreement_completed: true,
    observation_1_due_date: '2026-11-01',
    folder_web_url: 'https://example.com/avigdor'
  });
  const html = tableHtml([avigdor]);

  assert.equal(Number(avigdor.emp_id), 1519);
  assert.match(html, /data-manager-tracking-emp-id="1519"/);
  assert.match(html, /פתח תיק/);
  assert.match(html, /is-done[\s\S]*✓/);

  for (const label of [
    'הסכם חתום',
    'מסמכים נלווים',
    'משוב היכרות',
    'משוב אמצע שנה',
    'משוב סוף שנה',
    'תצפית 1',
    'תצפית 2'
  ]) {
    assert.match(html, new RegExp(`${label}: ${NOT_FOR_UPDATE_LABEL}`));
  }

  assert.equal((html.match(/manager-workspace-followup-cell--not-for-update/g) || []).length, 7);
  assert.equal((html.match(/manager-workspace-followup-cell__content--muted/g) || []).length, 7);
  assert.doesNotMatch(html, /אישור משטרה: לא לעדכון/);
  assert.doesNotMatch(html, /תצפית 1[\s\S]*עד 01\.11\.26/);
  assert.doesNotMatch(html, /משוב היכרות[\s\S]*עד 20\.10\.26/);
});

test('G: regular employee is unaffected by the Avigdor exception', () => {
  const html = tableHtml([
    row({
      emp_id: 2002,
      full_name: 'מדריך אחר',
      seniority_years: 1,
      intro_feedback_due_date: '2026-10-09',
      signed_agreement_completed: true
    })
  ]);
  assert.doesNotMatch(html, new RegExp(NOT_FOR_UPDATE_LABEL));
  assert.match(html, /עד 09\.10\.26/);
  assert.match(html, /is-done[\s\S]*✓/);
});

test('H: readonly footer sentence is removed from rendered markup', () => {
  const html = tableHtml([row()]);
  assert.doesNotMatch(html, /תצוגה לקריאה בלבד/);
  assert.doesNotMatch(html, /דוחות שכר אינם מוצגים כאן/);
  assert.doesNotMatch(html, /manager-workspace-source-note/);
  assert.doesNotMatch(runtime, /תצוגה לקריאה בלבד של תיק העובד/);
  assert.doesNotMatch(runtime, /דוחות שכר אינם מוצגים כאן/);
});

test('RPC migration returns seniority_years and applies 2027 intro due-date rules', () => {
  assert.match(migration, /seniority_years smallint/);
  assert.match(migration, /ci\.seniority_years/);
  assert.match(migration, /when ci\.seniority_years is null then null/);
  assert.match(migration, /when v_school_year = 2027 and ci\.seniority_years > 1 then date '2026-10-20'/);
  assert.match(
    migration,
    /coalesce\(usr\.employee_created_at, ef\.created_at\)::date \+ interval '1 month'/
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /grant execute on function public\.get_manager_team_roster\(text, text\) to authenticated/);
  assert.match(migration, /first_activity_date \+ interval '1 month'/);
  assert.match(migration, /observation_1_completed_at::date \+ interval '1 month'/);
});
