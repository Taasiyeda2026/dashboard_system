import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COMPONENT_COLUMNS,
  AVIGDOR_SHARON_EMP_ID,
  NOT_FOR_UPDATE_LABEL,
  MISSING_SENIORITY_LABEL,
  LATE_LABEL,
  MIDYEAR_FEEDBACK_WINDOW_2027,
  YEAR_END_FEEDBACK_WINDOW_2027,
  completionCell,
  tableHtml,
  resolveIntroFeedbackDueDate,
  resolveObservation1DueDate,
  resolveObservation2Window,
  resolvePeriodicFeedbackState,
  isValidFeedbackCompletion,
  isObservationNewInstructor,
  isObservationVeteranInstructor,
  hasValidObservationSeniority,
  addOneCalendarMonthPlusDays,
  addCalendarDays,
  israelDateOnly
} from '../frontend/src/manager-board-employee-file-tracking.js';

const migration = fs.readFileSync(
  new URL('../supabase/migrations/20260910220000_manager_team_observation_rules.sql', import.meta.url),
  'utf8'
);
const feedbackMigration = fs.readFileSync(
  new URL('../supabase/migrations/20260910204500_manager_team_feedback_windows.sql', import.meta.url),
  'utf8'
);
const edgeSource = fs.readFileSync(
  new URL('../supabase/functions/instructor-employee-file-live/index.ts', import.meta.url),
  'utf8'
);
const swSource = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');
const configSource = fs.readFileSync(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const observation1Column = COMPONENT_COLUMNS.find((column) => column.field === 'observation_1_completed');
const observation2Column = COMPONENT_COLUMNS.find((column) => column.field === 'observation_2_completed');
const introColumn = COMPONENT_COLUMNS.find((column) => column.field === 'intro_feedback_completed');
const midyearColumn = COMPONENT_COLUMNS.find((column) => column.field === 'midyear_feedback_completed');
const yearEndColumn = COMPONENT_COLUMNS.find((column) => column.field === 'year_end_feedback_completed');
const policeColumn = COMPONENT_COLUMNS.find((column) => column.field === 'police_clearance_completed');

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
    observation_1_completed_at: null,
    observation_1_due_date: null,
    observation_2_window_start: null,
    observation_2_due_date: null,
    observation_2_completed_at: null,
    first_activity_date: '2026-09-10',
    folder_web_url: 'https://example.com/folder',
    ...overrides
  };
}

function obs1Html(overrides = {}, todayIso) {
  return completionCell(row(overrides), observation1Column, { todayIso, schoolYear: '2027' });
}

function obs2Html(overrides = {}, todayIso) {
  return completionCell(row(overrides), observation2Column, { todayIso, schoolYear: '2027' });
}

test('1: veteran seniority_years=2 first activity 10.09.2026 → observation 1 due 25.10.2026', () => {
  assert.equal(
    resolveObservation1DueDate({ seniority_years: 2, first_activity_date: '2026-09-10' }),
    '2026-10-25'
  );
  assert.match(obs1Html({
    seniority_years: 2,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-25'
  }, '2026-10-01'), /25\.10\.26/);
  assert.doesNotMatch(obs1Html({
    seniority_years: 2,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-25'
  }, '2026-10-01'), /באיחור|✓/);
});

test('2: veteran seniority_years>1 → observation 2 is לא לעדכון', () => {
  const html = obs2Html({
    seniority_years: 3,
    observation_2_completed: false,
    observation_1_completed_at: '2026-10-10T10:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }, '2026-11-20');
  assert.match(html, new RegExp(NOT_FOR_UPDATE_LABEL));
  assert.doesNotMatch(html, /✓|באיחור|מ־|עד /);
});

test('3: veteran with accidental observation_2 document still לא לעדכון (no ✓)', () => {
  const html = obs2Html({
    seniority_years: 2,
    observation_2_completed: true,
    observation_2_completed_at: '2026-11-20T12:00:00+02:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }, '2026-11-20');
  assert.match(html, new RegExp(NOT_FOR_UPDATE_LABEL));
  assert.doesNotMatch(html, /✓/);
});

test('4: new seniority_years=1 first activity 10.09.2026 → observation 1 due 17.10.2026', () => {
  assert.equal(
    resolveObservation1DueDate({ seniority_years: 1, first_activity_date: '2026-09-10' }),
    '2026-10-17'
  );
  assert.match(obs1Html({
    seniority_years: 1,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-17'
  }, '2026-10-01'), /17\.10\.26/);
});

test('5-6: observation 1 completed 10.10.2026 → observation 2 opens 17.11.2026 through 30.11.2026 inclusive', () => {
  const window = resolveObservation2Window({
    seniority_years: 1,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00'
  });
  assert.deepEqual(window, { start: '2026-11-17', due: '2026-11-30' });
  assert.equal(addCalendarDays('2026-11-17', 13), '2026-11-30');
});

test('7: before window 16.11 → מ־17.11.26', () => {
  const html = obs2Html({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }, '2026-11-16');
  assert.match(html, /מ־17\.11\.26/);
  assert.doesNotMatch(html, /✓/);
});

test('8: window opens 17.11 → עד 30.11.26', () => {
  const html = obs2Html({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }, '2026-11-17');
  assert.match(html, /עד 30\.11\.26/);
  assert.doesNotMatch(html, /באיחור|מ־|✓/);
});

test('9: last window day 30.11 still open', () => {
  const state = resolvePeriodicFeedbackState(row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }), observation2Column, { todayIso: '2026-11-30' });
  assert.equal(state.kind, 'open');
  assert.match(obs2Html({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30'
  }, '2026-11-30'), /עד 30\.11\.26/);
});

test('10: 01.12 without completion → באיחור', () => {
  const html = obs2Html({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: false
  }, '2026-12-01');
  assert.match(html, new RegExp(LATE_LABEL));
  assert.doesNotMatch(html, /✓|עד 30\.11\.26|מ־/);
});

test('11: completion on 20.11 inside window → ✓', () => {
  const sample = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: true,
    observation_2_completed_at: '2026-11-20T11:00:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(sample, observation2Column), true);
  assert.match(obs2Html(sample, '2026-11-20'), /✓/);
});

test('12: late completion on 05.12 still → ✓', () => {
  const sample = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: true,
    observation_2_completed_at: '2026-12-05T11:00:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(sample, observation2Column), true);
  assert.match(obs2Html(sample, '2026-12-05'), /✓/);
  assert.doesNotMatch(obs2Html(sample, '2026-12-05'), new RegExp(LATE_LABEL));
});

test('13: early-only completion on 10.11 is not ✓', () => {
  const early = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: true,
    observation_2_completed_at: '2026-11-10T11:00:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(early, observation2Column), false);
  assert.equal(israelDateOnly(early.observation_2_completed_at), '2026-11-10');
  assert.match(obs2Html(early, '2026-11-16'), /מ־17\.11\.26/);
  assert.doesNotMatch(obs2Html(early, '2026-11-20'), /✓/);
  assert.match(obs2Html(early, '2026-11-20'), /עד 30\.11\.26/);
  assert.match(obs2Html(early, '2026-12-01'), new RegExp(LATE_LABEL));
});

test('14A: files 10.11 + 20.11 → latest=20.11 → ✓ when window_start=17.11', () => {
  const withLater = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: true,
    // current SharePoint scan latest among 10.11 + 20.11
    observation_2_completed_at: '2026-11-20T11:00:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(withLater, observation2Column), true);
  assert.match(obs2Html(withLater, '2026-11-20'), /✓/);
  assert.match(migration, /latest_file_created_at/);
  assert.match(migration, /max\(s\.latest_file_created_at\) filter \(where s\.component_key = 'observation_2'/);
  assert.match(edgeSource, /latest_file_created_at/);
  assert.match(edgeSource, /latestCreatedAt/);
  assert.match(edgeSource, /considerLatestCreatedAt/);
});

test('14B: later 20.11 deleted, only early 10.11 remains → latest must fall back → no ✓', () => {
  const onlyEarly = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: '2026-10-10T09:00:00+03:00',
    observation_2_window_start: '2026-11-17',
    observation_2_due_date: '2026-11-30',
    observation_2_completed: true,
    // current SharePoint scan after deleting 20.11 — must not keep historical max
    observation_2_completed_at: '2026-11-10T11:00:00+02:00'
  });
  assert.equal(isValidFeedbackCompletion(onlyEarly, observation2Column), false);
  assert.doesNotMatch(obs2Html(onlyEarly, '2026-11-20'), /✓/);
  assert.match(obs2Html(onlyEarly, '2026-11-20'), /עד 30\.11\.26/);
  // Trigger must accept current-scan latest as-is; never historically greatest().
  assert.doesNotMatch(migration, /greatest\(\s*old\.latest_file_created_at/);
  assert.doesNotMatch(migration, /greatest\(\s*public\.instructor_employee_document_status\.latest_file_created_at/);
  assert.match(migration, /current-scan|current SharePoint scan|leave NEW unchanged/i);
});

test('14C: UTC timestamp crossing midnight into Israel date for observation 2 window', () => {
  // 2026-10-10T22:30:00Z == 2026-10-11 01:30 Asia/Jerusalem
  assert.equal(israelDateOnly('2026-10-10T22:30:00Z'), '2026-10-11');
  const afterMidnightIsrael = resolveObservation2Window({
    seniority_years: 1,
    observation_1_completed_at: '2026-10-10T22:30:00Z'
  });
  assert.deepEqual(afterMidnightIsrael, { start: '2026-11-18', due: '2026-12-01' });

  // Other side of the boundary: still 10.10 in Israel (UTC+3 in October).
  assert.equal(israelDateOnly('2026-10-10T20:30:00Z'), '2026-10-10');
  const beforeMidnightIsrael = resolveObservation2Window({
    seniority_years: 1,
    observation_1_completed_at: '2026-10-10T20:30:00Z'
  });
  assert.deepEqual(beforeMidnightIsrael, { start: '2026-11-17', due: '2026-11-30' });

  assert.match(
    migration,
    /observation_1_completed_at at time zone 'Asia\/Jerusalem'\)::date/
  );
  assert.doesNotMatch(
    migration,
    /observation_2_window_start[\s\S]*observation_1_completed_at::date \+ interval '1 month'/
  );
});

test('14D: migration does not restore authenticated EXECUTE on manual component update', () => {
  assert.doesNotMatch(
    migration,
    /create or replace function public\.update_instructor_employee_file_component/
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.update_instructor_employee_file_component\([\s\S]*?\) to authenticated/i
  );
  assert.match(
    migration,
    /revoke execute on function public\.update_instructor_employee_file_component\(bigint,\s*text,\s*text,\s*boolean,\s*integer\)\s+from authenticated/i
  );
  assert.match(
    migration,
    /revoke all on function public\.update_instructor_employee_file_component\(bigint,\s*text,\s*text,\s*boolean,\s*integer\)\s+from public,\s*anon/i
  );
  assert.doesNotMatch(migration, /first_completed_at[\s\S]{0,80}now\(\)/);
});

test('15: observation_1 completed without reliable completed_at → no invented observation 2 window', () => {
  const sample = row({
    seniority_years: 1,
    observation_1_completed: true,
    observation_1_completed_at: null,
    observation_2_window_start: null,
    observation_2_due_date: null
  });
  assert.deepEqual(resolveObservation2Window(sample), { start: null, due: null });
  assert.equal(
    resolvePeriodicFeedbackState(sample, observation2Column, { todayIso: '2026-11-20' }).kind,
    'review'
  );
  assert.match(obs2Html(sample, '2026-11-20'), new RegExp(MISSING_SENIORITY_LABEL));
  assert.doesNotMatch(obs2Html(sample, '2026-11-20'), /מ־|עד |✓|באיחור/);
});

test('16-18: invalid seniority_years → לבדיקה for both observations', () => {
  for (const seniority of [null, 0, -1, 'abc']) {
    const sample = row({ seniority_years: seniority, first_activity_date: '2026-09-10' });
    assert.equal(hasValidObservationSeniority(seniority), false);
    assert.equal(resolveObservation1DueDate(sample), null);
    assert.match(obs1Html(sample, '2026-10-01'), new RegExp(MISSING_SENIORITY_LABEL));
    assert.match(obs2Html(sample, '2026-10-01'), new RegExp(MISSING_SENIORITY_LABEL));
  }
});

test('19: Avigdor emp_id=1519 → both observations לא לעדכון', () => {
  const avigdor = row({
    emp_id: AVIGDOR_SHARON_EMP_ID,
    full_name: 'אביגדור שרון',
    seniority_years: 5,
    observation_1_completed: true,
    observation_2_completed: true,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-25'
  });
  const html = tableHtml([avigdor], { todayIso: '2026-12-01' });
  assert.match(html, /תצפית 1: לא לעדכון/);
  assert.match(html, /תצפית 2: לא לעדכון/);
  assert.doesNotMatch(html, /תצפית 1[\s\S]*25\.10\.26/);
  assert.doesNotMatch(html, /תצפית 2[\s\S]*באיחור/);
  assert.doesNotMatch(html, /תצפית 1[\s\S]*✓/);
});

test('20: no regression for intro / feedback windows / police / employee-file titles', () => {
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: 1, employee_created_at: '2026-09-09' }), '2026-10-09');
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: 2 }), '2026-10-20');
  assert.equal(resolveIntroFeedbackDueDate({ seniority_years: null, employee_created_at: '2026-09-09' }), null);

  assert.equal(observation1Column.label, 'תצפית 1');
  assert.equal(observation2Column.label, 'תצפית 2');
  assert.equal(introColumn.label, 'משוב היכרות');
  assert.equal(midyearColumn.label, 'משוב אמצע שנה');
  assert.equal(yearEndColumn.label, 'משוב סוף שנה');
  assert.equal(policeColumn.label, 'אישור משטרה');

  assert.match(feedbackMigration, /date '2027-01-15'/);
  assert.match(feedbackMigration, /date '2027-02-04'/);
  assert.match(feedbackMigration, /date '2027-05-01'/);
  assert.match(feedbackMigration, /date '2027-05-30'/);
  assert.match(migration, /date '2027-01-15'/);
  assert.match(migration, /date '2027-02-04'/);
  assert.match(migration, /date '2027-05-01'/);
  assert.match(migration, /date '2027-05-30'/);
  assert.match(migration, /when v_school_year = 2027 and ci\.seniority_years > 1 then date '2026-10-20'/);
  assert.match(migration, /folder_web_url/);
  assert.match(migration, /police_clearance_completed/);
  assert.match(migration, /min\(s\.first_completed_at\) filter \(where s\.component_key = 'observation_1'/);
});

test('calendar-month arithmetic is not fixed day counts', () => {
  assert.equal(addOneCalendarMonthPlusDays('2026-09-10', 7), '2026-10-17');
  assert.equal(addOneCalendarMonthPlusDays('2026-09-10', 15), '2026-10-25');
  assert.equal(addOneCalendarMonthPlusDays('2026-01-31', 7), '2026-03-07');
  assert.equal(addOneCalendarMonthPlusDays('2026-01-31', 15), '2026-03-15');
  assert.doesNotMatch(migration, /interval '45 days'|interval '37 days'/);
  assert.match(migration, /interval '1 month' \+ interval '7 days'/);
  assert.match(migration, /interval '1 month' \+ interval '15 days'/);
  assert.match(migration, /\+ interval '13 days'/);
});

test('new instructor is exactly seniority_years = 1 (not <= 1)', () => {
  assert.equal(isObservationNewInstructor(1), true);
  assert.equal(isObservationNewInstructor(0), false);
  assert.equal(isObservationNewInstructor(2), false);
  assert.equal(isObservationVeteranInstructor(2), true);
  assert.equal(isObservationVeteranInstructor(1), false);
  assert.match(migration, /when ci\.seniority_years = 1/);
  assert.match(migration, /when ci\.seniority_years > 1/);
  assert.match(migration, /ci\.seniority_years is distinct from 1/);
});

test('observation 1 late status after due date', () => {
  assert.match(obs1Html({
    seniority_years: 1,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-17',
    observation_1_completed: false
  }, '2026-10-18'), new RegExp(LATE_LABEL));
  assert.match(obs1Html({
    seniority_years: 1,
    first_activity_date: '2026-09-10',
    observation_1_due_date: '2026-10-17',
    observation_1_completed: true
  }, '2026-10-18'), /✓/);
});

test('RPC migration exposes observation_2_window_start and preserves SECURITY DEFINER/grants', () => {
  assert.match(migration, /observation_2_window_start date/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = public/);
  assert.match(migration, /grant execute on function public\.get_manager_team_roster\(text, text\) to authenticated/);
  assert.match(migration, /revoke all on function public\.get_manager_team_roster\(text, text\) from public, anon, authenticated/);
  assert.match(migration, /add column if not exists latest_file_created_at timestamptz/);
});

test('edge live sync stores earliest + latest SharePoint createdDateTime and never invents from refresh now', () => {
  assert.match(edgeSource, /createdDateTime/);
  assert.match(edgeSource, /first_completed_at/);
  assert.match(edgeSource, /latest_file_created_at/);
  assert.match(edgeSource, /earliestCreatedAt/);
  assert.match(edgeSource, /latestCreatedAt/);
  assert.match(edgeSource, /Never invent it from refresh now/);
  assert.doesNotMatch(edgeSource, /first_completed_at:\s*new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(edgeSource, /latest_file_created_at:\s*new Date\(\)\.toISOString\(\)/);
});

test('cache bump and hotfix marker for deployable frontend change', () => {
  assert.match(swSource, /const CACHE_VERSION = 1689/);
  assert.match(configSource, /manager-team-observation-rules-20260910-v1/);
  assert.match(indexHtml, /manager-board-employee-file-tracking-runtime\.js\?v=20260910-team-observation-rules-v1/);
});
