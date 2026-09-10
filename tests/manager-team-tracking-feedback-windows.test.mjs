import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COMPONENT_COLUMNS,
  AVIGDOR_SHARON_EMP_ID,
  NOT_FOR_UPDATE_LABEL,
  LATE_LABEL,
  MIDYEAR_FEEDBACK_WINDOW_2027,
  YEAR_END_FEEDBACK_WINDOW_2027,
  completionCell,
  tableHtml,
  resolveIntroFeedbackDueDate,
  resolvePeriodicFeedbackState,
  isValidFeedbackCompletion,
  formatFeedbackWindowDate,
  israelDateOnly
} from '../frontend/src/manager-board-employee-file-tracking.js';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910204500_manager_team_feedback_windows.sql', import.meta.url),
  'utf8'
);
const seniorityMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260910193000_manager_team_roster_seniority_intro_due.sql', import.meta.url),
  'utf8'
);
const edgeSource = fs.readFileSync(
  new URL('../supabase/functions/instructor-employee-file-live/index.ts', import.meta.url),
  'utf8'
);

const midyearColumn = COMPONENT_COLUMNS.find((column) => column.field === 'midyear_feedback_completed');
const yearEndColumn = COMPONENT_COLUMNS.find((column) => column.field === 'year_end_feedback_completed');
const introColumn = COMPONENT_COLUMNS.find((column) => column.field === 'intro_feedback_completed');
const observation1Column = COMPONENT_COLUMNS.find((column) => column.field === 'observation_1_completed');
const observation2Column = COMPONENT_COLUMNS.find((column) => column.field === 'observation_2_completed');

function row(overrides = {}) {
  return {
    emp_id: 1001,
    full_name: 'מדריך רגיל',
    employment_type: 'שכיר',
    gender: 'male',
    seniority_years: 1,
    employee_created_at: '2026-09-09T10:00:00+03:00',
    intro_feedback_completed: false,
    intro_feedback_due_date: '2026-10-09',
    signed_agreement_completed: false,
    supporting_documents_completed: false,
    police_clearance_completed: false,
    midyear_feedback_completed: false,
    midyear_feedback_window_start: MIDYEAR_FEEDBACK_WINDOW_2027.start,
    midyear_feedback_due_date: MIDYEAR_FEEDBACK_WINDOW_2027.due,
    midyear_feedback_completed_at: null,
    year_end_feedback_completed: false,
    year_end_feedback_window_start: YEAR_END_FEEDBACK_WINDOW_2027.start,
    year_end_feedback_due_date: YEAR_END_FEEDBACK_WINDOW_2027.due,
    year_end_feedback_completed_at: null,
    observation_1_completed: false,
    observation_2_completed: false,
    observation_1_due_date: '2026-11-01',
    observation_2_due_date: null,
    first_activity_date: '2026-10-01',
    folder_web_url: 'https://example.com/folder',
    ...overrides
  };
}

function midyearHtml(overrides = {}, todayIso) {
  return completionCell(row(overrides), midyearColumn, { todayIso, schoolYear: '2027' });
}

function yearEndHtml(overrides = {}, todayIso) {
  return completionCell(row(overrides), yearEndColumn, { todayIso, schoolYear: '2027' });
}

test('A: midyear before window shows מ־15.1.27 and never ✓', () => {
  const html = midyearHtml({ midyear_feedback_completed: true, midyear_feedback_completed_at: '2027-01-10T12:00:00+02:00' }, '2027-01-14');
  assert.match(html, /מ־15\.1\.27/);
  assert.doesNotMatch(html, /✓/);
  assert.equal(
    resolvePeriodicFeedbackState(row({ midyear_feedback_completed: false }), midyearColumn, { todayIso: '2027-01-14' }).kind,
    'before'
  );
});

test('B: midyear window opens on 2027-01-15 and shows עד 4.2.27 when incomplete', () => {
  const html = midyearHtml({}, '2027-01-15');
  assert.match(html, /עד 4\.2\.27/);
  assert.doesNotMatch(html, /✓|באיחור|מ־/);
  assert.equal(
    resolvePeriodicFeedbackState(row(), midyearColumn, { todayIso: '2027-01-15' }).kind,
    'open'
  );
});

test('C: midyear still inside window on due date 2027-02-04', () => {
  const html = midyearHtml({}, '2027-02-04');
  assert.match(html, /עד 4\.2\.27/);
  assert.doesNotMatch(html, /באיחור/);
  assert.equal(
    resolvePeriodicFeedbackState(row(), midyearColumn, { todayIso: '2027-02-04' }).kind,
    'open'
  );
});

test('D: midyear after window shows באיחור when incomplete', () => {
  const html = midyearHtml({}, '2027-02-05');
  assert.match(html, new RegExp(LATE_LABEL));
  assert.doesNotMatch(html, /✓|עד 4\.2\.27|מ־/);
  assert.equal(
    resolvePeriodicFeedbackState(row(), midyearColumn, { todayIso: '2027-02-05' }).kind,
    'late'
  );
});

test('E: midyear valid completion in window shows ✓', () => {
  const html = midyearHtml({
    midyear_feedback_completed: true,
    midyear_feedback_completed_at: '2027-01-20T09:30:00+02:00'
  }, '2027-01-20');
  assert.match(html, /✓/);
  assert.doesNotMatch(html, /עד 4\.2\.27|מ־|באיחור/);
  assert.equal(
    isValidFeedbackCompletion(row({
      midyear_feedback_completed: true,
      midyear_feedback_completed_at: '2027-01-15T00:00:00+02:00'
    }), midyearColumn),
    true
  );
});

test('F: midyear completion before 15.1.27 is not a valid ✓', () => {
  const early = row({
    midyear_feedback_completed: true,
    midyear_feedback_completed_at: '2027-01-14T23:30:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(early, midyearColumn), false);
  assert.equal(israelDateOnly(early.midyear_feedback_completed_at), '2027-01-14');

  const beforeHtml = midyearHtml(early, '2027-01-14');
  assert.match(beforeHtml, /מ־15\.1\.27/);
  assert.doesNotMatch(beforeHtml, /✓/);

  const openHtml = midyearHtml(early, '2027-01-20');
  assert.match(openHtml, /עד 4\.2\.27/);
  assert.doesNotMatch(openHtml, /✓/);

  const lateHtml = midyearHtml(early, '2027-02-05');
  assert.match(lateHtml, new RegExp(LATE_LABEL));
  assert.doesNotMatch(lateHtml, /✓/);
});

test('G: year-end before window shows מ־1.5.27', () => {
  const html = yearEndHtml({
    year_end_feedback_completed: true,
    year_end_feedback_completed_at: '2027-04-01T12:00:00+03:00'
  }, '2027-04-30');
  assert.match(html, /מ־1\.5\.27/);
  assert.doesNotMatch(html, /✓/);
});

test('H: year-end window opens on 2027-05-01 and shows עד 30.5.27 when incomplete', () => {
  const html = yearEndHtml({}, '2027-05-01');
  assert.match(html, /עד 30\.5\.27/);
  assert.doesNotMatch(html, /✓|באיחור|מ־/);
});

test('I: year-end still inside window on due date 2027-05-30', () => {
  const html = yearEndHtml({}, '2027-05-30');
  assert.match(html, /עד 30\.5\.27/);
  assert.doesNotMatch(html, /באיחור/);
});

test('J: year-end after window shows באיחור when incomplete', () => {
  const html = yearEndHtml({}, '2027-05-31');
  assert.match(html, new RegExp(LATE_LABEL));
  assert.doesNotMatch(html, /✓|עד 30\.5\.27/);
});

test('K: year-end valid completion in window shows ✓', () => {
  const html = yearEndHtml({
    year_end_feedback_completed: true,
    year_end_feedback_completed_at: '2027-05-15T11:00:00+03:00'
  }, '2027-05-15');
  assert.match(html, /✓/);
  assert.doesNotMatch(html, /עד 30\.5\.27|מ־|באיחור/);
});

test('L: year-end completion before 1.5.27 is not a valid ✓', () => {
  const early = row({
    year_end_feedback_completed: true,
    year_end_feedback_completed_at: '2027-04-30T22:00:00+03:00'
  });
  assert.equal(isValidFeedbackCompletion(early, yearEndColumn), false);
  assert.equal(israelDateOnly(early.year_end_feedback_completed_at), '2027-04-30');

  assert.match(yearEndHtml(early, '2027-04-30'), /מ־1\.5\.27/);
  assert.doesNotMatch(yearEndHtml(early, '2027-05-10'), /✓/);
  assert.match(yearEndHtml(early, '2027-05-10'), /עד 30\.5\.27/);
  assert.match(yearEndHtml(early, '2027-05-31'), new RegExp(LATE_LABEL));
});

test('M: Avigdor emp_id 1519 keeps both feedbacks as לא לעדכון without windows', () => {
  const avigdor = row({
    emp_id: AVIGDOR_SHARON_EMP_ID,
    full_name: 'אביגדור שרון',
    seniority_years: 5,
    midyear_feedback_completed: true,
    midyear_feedback_completed_at: '2027-01-20T12:00:00+02:00',
    year_end_feedback_completed: true,
    year_end_feedback_completed_at: '2027-05-10T12:00:00+03:00',
    police_clearance_completed: true
  });
  const html = tableHtml([avigdor], { todayIso: '2027-02-05' });

  assert.match(html, /משוב אמצע שנה: לא לעדכון/);
  assert.match(html, /משוב סוף שנה: לא לעדכון/);
  assert.doesNotMatch(html, /משוב אמצע שנה[\s\S]*מ־15\.1\.27/);
  assert.doesNotMatch(html, /משוב אמצע שנה[\s\S]*באיחור/);
  assert.doesNotMatch(html, /משוב סוף שנה[\s\S]*מ־1\.5\.27/);
  assert.doesNotMatch(html, /משוב סוף שנה[\s\S]*באיחור/);
  assert.equal((html.match(new RegExp(NOT_FOR_UPDATE_LABEL, 'g')) || []).length >= 2, true);
});

test('N: PR #1785 seniority / opening-year intro rules remain intact', () => {
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: 1, employee_created_at: '2026-09-09' }), '2026-10-09');
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: 2 }), '2026-10-20');
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: null, employee_created_at: '2026-09-09' }), null);

  const veteranHtml = completionCell(
    row({ seniority_years: 2, intro_feedback_due_date: '2026-10-20' }),
    introColumn
  );
  assert.match(veteranHtml, /עד 20\.10\.26/);
  assert.match(veteranHtml, /aria-label="שיחת פתיחת שנה:/);

  assert.match(seniorityMigration, /when v_school_year = 2027 and ci\.seniority_years > 1 then date '2026-10-20'/);
  assert.match(migration, /when v_school_year = 2027 and ci\.seniority_years > 1 then date '2026-10-20'/);
  assert.match(migration, /seniority_years smallint/);
});

test('O: observation columns keep titles; due dates now follow seniority observation rules', () => {
  assert.equal(observation1Column.label, 'תצפית 1');
  assert.equal(observation2Column.label, 'תצפית 2');

  const obs1 = completionCell(
    row({
      seniority_years: 1,
      first_activity_date: '2026-09-10',
      observation_1_completed: false,
      observation_1_due_date: '2026-10-17'
    }),
    observation1Column,
    { todayIso: '2026-10-01' }
  );
  assert.match(obs1, /17\.10\.26/);
  assert.doesNotMatch(obs1, /באיחור|מ־/);

  const obs2 = completionCell(
    row({
      seniority_years: 1,
      observation_1_completed: true,
      observation_1_completed_at: '2026-10-10T10:00:00+03:00',
      observation_2_window_start: '2026-11-17',
      observation_2_due_date: '2026-11-30',
      observation_2_completed: false
    }),
    observation2Column,
    { todayIso: '2026-11-17' }
  );
  assert.match(obs2, /עד 30\.11\.26/);

  // Historical feedback migration still had the older one-month observation anchors.
  assert.match(migration, /first_activity_date \+ interval '1 month'/);
  assert.match(migration, /observation_1_completed_at::date \+ interval '1 month'/);
});

test('late midyear completion after due date can still show ✓', () => {
  const html = midyearHtml({
    midyear_feedback_completed: true,
    midyear_feedback_completed_at: '2027-02-10T12:00:00+02:00'
  }, '2027-02-10');
  assert.match(html, /✓/);
  assert.doesNotMatch(html, new RegExp(LATE_LABEL));
});

test('missing completed_at never invents a valid ✓ even when completed flag is true', () => {
  assert.equal(
    isValidFeedbackCompletion(row({ midyear_feedback_completed: true, midyear_feedback_completed_at: null }), midyearColumn),
    false
  );
  assert.match(midyearHtml({ midyear_feedback_completed: true }, '2027-01-20'), /עד 4\.2\.27/);
});

test('formatFeedbackWindowDate drops leading zeros', () => {
  assert.equal(formatFeedbackWindowDate('2027-01-15'), '15.1.27');
  assert.equal(formatFeedbackWindowDate('2027-02-04'), '4.2.27');
  assert.equal(formatFeedbackWindowDate('2027-05-01'), '1.5.27');
  assert.equal(formatFeedbackWindowDate('2027-05-30'), '30.5.27');
});

test('RPC migration exposes 2027 feedback windows and first_completed_at timestamps', () => {
  assert.match(migration, /midyear_feedback_window_start date/);
  assert.match(migration, /midyear_feedback_due_date date/);
  assert.match(migration, /midyear_feedback_completed_at timestamptz/);
  assert.match(migration, /year_end_feedback_window_start date/);
  assert.match(migration, /year_end_feedback_due_date date/);
  assert.match(migration, /year_end_feedback_completed_at timestamptz/);
  assert.match(migration, /date '2027-01-15'/);
  assert.match(migration, /date '2027-02-04'/);
  assert.match(migration, /date '2027-05-01'/);
  assert.match(migration, /date '2027-05-30'/);
  assert.match(migration, /add column if not exists first_completed_at timestamptz/);
  assert.match(migration, /min\(s\.first_completed_at\) filter \(where s\.component_key = 'midyear_feedback'/);
  assert.match(migration, /min\(s\.first_completed_at\) filter \(where s\.component_key = 'year_end_feedback'/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /grant execute on function public\.get_manager_team_roster\(text, text\) to authenticated/);
  assert.match(migration, /revoke all on function public\.get_manager_team_roster\(text, text\) from public, anon, authenticated/);
});

test('edge live sync stores SharePoint createdDateTime as first_completed_at and does not invent from refresh now', () => {
  assert.match(edgeSource, /createdDateTime/);
  assert.match(edgeSource, /first_completed_at/);
  assert.match(edgeSource, /earliestCreatedAt/);
  assert.match(edgeSource, /Never invent it from refresh now/);
  assert.match(edgeSource, /\$select=id,name,file,folder,createdDateTime/);
  assert.doesNotMatch(
    edgeSource,
    /first_completed_at:\s*new Date\(\)\.toISOString\(\)/
  );
});

test('column titles for midyear and year-end feedback remain unchanged', () => {
  assert.equal(midyearColumn.label, 'משוב אמצע שנה');
  assert.equal(yearEndColumn.label, 'משוב סוף שנה');
});
