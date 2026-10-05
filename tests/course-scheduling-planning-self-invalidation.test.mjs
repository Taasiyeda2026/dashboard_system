import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_RECOVERABLE_EXCEPTION_MEETINGS,
  auditPlanningOptionHardGates,
  auditStoredPlanningHardGates,
  buildExceptionRecoveryPlan,
  expectedPlanningMeetingCount
} from '../frontend/src/screens/course-scheduling-date-adjustments.js';
import {
  applyLocalPlanningNeedsRecalc,
  applyStoredPlanningValidityAudit
} from '../frontend/src/screens/course-scheduling-planning-store.js';
import {
  PLANNING_ENGINE_VERSION,
  PLANNING_VALIDATION_VERSION
} from '../frontend/src/screens/course-scheduling-planning.js';

const migrationUrl = new URL(
  '../supabase/migrations/20260927190000_planning_self_invalidation.sql',
  import.meta.url
);
const activityMigrationUrl = new URL(
  '../supabase/migrations/20260927180000_mark_scheduling_planning_needs_recalc.sql',
  import.meta.url
);
const preferredWorkDaysMigrationUrl = new URL(
  '../supabase/migrations/20261001055000_planning_preferred_work_days_invalidation.sql',
  import.meta.url
);
const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);

const migration = await readFile(migrationUrl, 'utf8');
const activityMigration = await readFile(activityMigrationUrl, 'utf8');
const preferredWorkDaysMigration = await readFile(preferredWorkDaysMigrationUrl, 'utf8');
const screen = await readFile(screenUrl, 'utf8');
const store = await readFile(storeUrl, 'utf8');

const sundayRules = [{ weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }];

function proposalEntry(activityId, empId, meetings, { needsRecalc = false } = {}) {
  return {
    activityId,
    needsRecalc,
    row: {
      courseId: activityId,
      kind: 'proposal',
      instructorEmpId: empId,
      instructorName: `מדריך ${empId}`,
      meetings,
      options: [{ instructorEmpId: empId, meetings }]
    }
  };
}

test('1) INSERT exception blocked dirties only instructor-linked planning rows (SQL scoped)', () => {
  assert.match(migration, /mark_scheduling_planning_needs_recalc_for_instructor/);
  assert.match(migration, /instructor_availability_exceptions_invalidate_planning/);
  assert.match(migration, /scheduling_planning_row_references_instructor/);
  assert.match(migration, /p_exception_date/);
  assert.doesNotMatch(
    migration,
    /update\s+public\.scheduling_planning_rows\s+r\s+set\s+needs_recalc\s*=\s*true\s+where\s+r\.workspace_id\s*=\s*workspace_rec\.id\s*;/
  );
  assert.match(migration, /public\.scheduling_planning_row_references_instructor\(r, emp, p_exception_date\)/);
});

test('2) UPDATE exception marks relevant rows dirty', () => {
  assert.match(migration, /scheduling_invalidate_planning_after_availability_exception/);
  assert.match(migration, /tg_op = 'UPDATE'/);
  assert.match(migration, /old\.exception_date is distinct from new\.exception_date/);
});

test('3) DELETE exception marks relevant rows dirty', () => {
  assert.match(migration, /after insert or update or delete on public\.instructor_availability_exceptions/);
  assert.match(migration, /if tg_op = 'DELETE' then\s+emp := old\.emp_id;/);
});

test('4) activity gender change dirties its planning row', () => {
  assert.match(activityMigration, /required_instructor_gender/);
  assert.match(activityMigration, /activities_invalidate_planning_rows/);
  assert.match(activityMigration, /mark_scheduling_planning_needs_recalc/);
});

test('5) activity language change dirties its planning row', () => {
  assert.match(activityMigration, /instruction_language/);
  assert.match(activityMigration, /scheduling_planning_sensitive_changed/);
});

test('6) sessions change dirties its planning row', () => {
  assert.match(activityMigration, /p_old\.sessions is distinct from p_new\.sessions/);
});

test('7) stored row with exception violation + needs_recalc=false is invalid in audit', () => {
  const meetings = [
    { date: '2027-01-03', start_time: '10:00', end_time: '11:00' },
    { date: '2027-01-10', start_time: '10:00', end_time: '11:00' }
  ];
  const shared = {
    rows: [proposalEntry('aline-row-1', '101', meetings, { needsRecalc: false })]
  };
  const audit = auditStoredPlanningHardGates({
    shared,
    activities: [{ row_id: 'aline-row-1', sessions: 2, instruction_language: 'he', required_instructor_gender: 'female' }],
    instructors: [{ emp_id: '101', active: 'yes' }],
    profiles: { 101: { gender: 'female', instruction_languages: ['he'] } },
    rules: { 101: sundayRules },
    exceptions: {
      101: [{ exception_date: '2027-01-03', available: false }]
    },
    schoolCalendar: []
  });
  assert.deepEqual(audit.invalidActivityIds, ['aline-row-1']);
  assert.equal(audit.hardGateInvalidCount, 1);
  assert.ok(audit.reasonsByActivityId['aline-row-1'].some((row) => row.reason === 'availability_exception'));
});

test('8) הכול מעודכן is blocked when audit finds invalid rows', () => {
  assert.match(screen, /hardGateInvalid/);
  assert.match(screen, /pendingRecalc > 0 \|\| hardGateInvalid > 0/);
  assert.match(screen, /applyStoredPlanningValidityAudit/);
  assert.match(screen, /מעדכן \$\{count\} פעילויות שהושפעו|נדרש עדכון · \$\{count\} פעילויות/);
  assert.match(screen, /הכול מעודכן/);

  const state = {
    courseSchedulingPlanningAffectedIds: [],
    courseSchedulingPlanningShared: {
      rows: [
        proposalEntry('stale-1', '7', [
          { date: '2027-01-03', start_time: '10:00', end_time: '11:00' }
        ], { needsRecalc: false })
      ]
    },
    courseSchedulingPlanningRows: []
  };
  const audit = applyStoredPlanningValidityAudit(state, {
    shared: state.courseSchedulingPlanningShared,
    activities: [{ row_id: 'stale-1', sessions: 1 }],
    instructors: [{ emp_id: '7', active: 'yes' }],
    profiles: { 7: { gender: 'female', instruction_languages: ['he'] } },
    rules: { 7: sundayRules },
    exceptions: { 7: [{ exception_date: '2027-01-03', available: false }] },
    persist: false
  });
  assert.equal(audit.hardGateInvalidCount, 1);
  assert.equal(state.courseSchedulingPlanningHardGateInvalidCount, 1);
  assert.deepEqual(state.courseSchedulingPlanningAffectedIds, ['stale-1']);
  assert.equal(state.courseSchedulingPlanningShared.rows[0].needsRecalc, true);
});

test('9) 1–2 availability exceptions keep permanent instructor via recovery plan', () => {
  assert.equal(MAX_RECOVERABLE_EXCEPTION_MEETINGS, 2);
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [
      { exception_date: '2027-01-10', available: false },
      { exception_date: '2027-01-24', available: false }
    ]
  });
  assert.equal(recovery.valid, true);
  assert.equal(recovery.eligibleAsPermanent, true);
  assert.equal(recovery.instructorExceptionCount, 2);
});

test('10) 3+ availability exceptions reject permanent instructor', () => {
  const meetings = ['2027-01-03', '2027-01-10', '2027-01-17', '2027-01-24'].map((date) => ({
    date, start_time: '10:00', end_time: '11:00'
  }));
  const recovery = buildExceptionRecoveryPlan({
    meetings,
    rules: sundayRules,
    exceptions: [
      { exception_date: '2027-01-10', available: false },
      { exception_date: '2027-01-17', available: false },
      { exception_date: '2027-01-24', available: false }
    ]
  });
  assert.equal(recovery.valid, false);
  assert.equal(recovery.eligibleAsPermanent, false);
});

test('11) meeting count mismatch marks row dirty via audit', () => {
  const info = expectedPlanningMeetingCount({
    sessions: 11,
    date_1: '2026-10-01',
    date_2: '2026-10-08'
  });
  assert.equal(info.mismatch, true);

  const meetings = Array.from({ length: 10 }, (_, index) => ({
    date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    start_time: '10:00',
    end_time: '11:00'
  }));
  const result = auditPlanningOptionHardGates(
    { instructorEmpId: '5', meetings },
    {
      activity: { sessions: 11, instruction_language: 'he', required_instructor_gender: 'any' },
      instructors: [{ emp_id: '5', active: 'yes' }],
      profiles: { 5: { gender: 'female', instruction_languages: ['he'] } },
      rules: {
        5: [
          { weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 1, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 2, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 3, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 4, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 5, available: true, start_time: '08:00', end_time: '16:00' },
          { weekday: 6, available: true, start_time: '08:00', end_time: '16:00' }
        ]
      },
      exceptions: {},
      schoolCalendar: []
    }
  );
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((row) => row.reason === 'meeting_count_mismatch'));
});

test('12) instructor availability change is scoped (not full workspace / not 248)', () => {
  assert.match(migration, /mark_scheduling_planning_needs_recalc_for_instructor/);
  assert.match(migration, /instructor_availability_rules_invalidate_planning/);
  assert.doesNotMatch(migration, /needs_recalc = true[\s\S]{0,80}where r\.workspace_id = workspace_rec\.id;/);
  assert.match(migration, /PAI-ae276b4c-9042-4ae0-acff-41fbb558e9b0-3/);
  assert.match(migration, /ACT-4b161a51-4e41-4dd6-9454-db8ab327599b/);
  assert.match(migration, /planning_self_invalidation_hotfix_rows_touched/);

  const state = {
    courseSchedulingPlanningAffectedIds: [],
    courseSchedulingPlanningShared: {
      rows: [
        proposalEntry('only-aline', '101', [{ date: '2026-12-01', start_time: '10:00', end_time: '11:00' }]),
        proposalEntry('other', '202', [{ date: '2026-12-01', start_time: '10:00', end_time: '11:00' }])
      ]
    },
    courseSchedulingPlanningRows: []
  };
  applyLocalPlanningNeedsRecalc(state, { activityIds: ['only-aline'] });
  assert.deepEqual(state.courseSchedulingPlanningAffectedIds, ['only-aline']);
  assert.notEqual(state.courseSchedulingPlanningShared.rows.length, state.courseSchedulingPlanningAffectedIds.length);
  assert.equal(state.courseSchedulingPlanningShared.rows.length, 2);
});

test('13) confirm validation blocks invalid stale row', () => {
  assert.match(migration, /planning_draft_stale_needs_recalc/);
  assert.match(migration, /scheduling_course_instructor_violations/);
  assert.match(migration, /scheduling_assert_assignment_calendar/);
  assert.match(migration, /scheduling_proposed_meeting_count_mismatch/);
  assert.match(store, /planning_draft_stale_needs_recalc/);
});

test('validation version exists and engine bump does not imply full-workspace dirty SQL', () => {
  assert.match(PLANNING_VALIDATION_VERSION, /self-invalidation/);
  assert.match(PLANNING_ENGINE_VERSION, /self-invalidation/);
  assert.match(screen, /isPlanningValidationCurrent/);
  assert.doesNotMatch(screen, /\.includes\(PLANNING_VALIDATION_VERSION\)/);
  assert.match(migration, /instructor_scheduling_profiles_invalidate_planning/);
  assert.match(migration, /contacts_instructors_invalidate_planning/);
  assert.match(preferredWorkDaysMigration, /preferred_work_days/);
  assert.match(preferredWorkDaysMigration, /mark_scheduling_planning_needs_recalc_for_instructor/);
  assert.match(store, /mark_scheduling_planning_needs_recalc_many/);
});
