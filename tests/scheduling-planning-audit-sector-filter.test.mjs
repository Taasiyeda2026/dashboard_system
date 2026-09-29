import test from 'node:test';
import assert from 'node:assert/strict';
import {
  auditPlanningOptionHardGates,
  auditStoredPlanningHardGates
} from '../frontend/src/screens/course-scheduling-date-adjustments.js';

const DATE = '2027-01-03'; // Sunday UTC

function weeklyRules(empId = '100') {
  return {
    [empId]: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      available: true,
      start_time: '08:00',
      end_time: '16:00'
    }))
  };
}

function option(empId = '100', date = DATE) {
  return {
    instructorEmpId: empId,
    meetings: [{ date, start_time: '10:00', end_time: '11:00' }]
  };
}

function activity(sector) {
  return {
    row_id: `act-${sector}`,
    sessions: 1,
    calendar_sector: sector,
    instruction_language: 'he',
    required_instructor_gender: 'any'
  };
}

function auditArgs(sector, schoolCalendar) {
  return {
    activity: activity(sector),
    instructors: [{ emp_id: '100', active: 'yes' }],
    profiles: { 100: { gender: 'female', instruction_languages: ['he'] } },
    rules: weeklyRules('100'),
    exceptions: {},
    schoolCalendar
  };
}

test('jewish activity stays valid when only an arab sector block overlaps the meeting', () => {
  const result = auditPlanningOptionHardGates(option(), auditArgs('jewish', [
    {
      calendar_sector: 'arab',
      blocks_scheduling: true,
      is_active: true,
      start_date: DATE,
      end_date: DATE,
      title: 'חופשה ערבית'
    }
  ]));
  assert.equal(result.valid, true);
  assert.equal(result.failures.some((row) => row.reason === 'school_calendar_blocked'), false);
});

test('arab activity is invalid when an arab sector block overlaps the meeting', () => {
  const result = auditPlanningOptionHardGates(option(), auditArgs('arab', [
    {
      calendar_sector: 'arab',
      blocks_scheduling: true,
      is_active: true,
      start_date: DATE,
      end_date: DATE,
      title: 'חופשה ערבית'
    }
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((row) => row.reason === 'school_calendar_blocked'));
});

test('jewish activity is invalid when a general block overlaps the meeting', () => {
  const result = auditPlanningOptionHardGates(option(), auditArgs('jewish', [
    {
      calendar_sector: 'general',
      blocks_scheduling: true,
      is_active: true,
      start_date: DATE,
      end_date: DATE,
      title: 'חג כללי'
    }
  ]));
  assert.equal(result.valid, false);
  assert.ok(result.failures.some((row) => row.reason === 'school_calendar_blocked'));
});

test('stored audit of a just-built sector-correct plan does not mark needs_recalc', () => {
  const shared = {
    rows: [
      {
        activityId: 'act-jewish',
        needsRecalc: false,
        lockedOption: option('100', DATE),
        row: { kind: 'proposal', ...option('100', DATE) }
      }
    ]
  };
  const schoolCalendar = [
    {
      calendar_sector: 'arab',
      blocks_scheduling: true,
      is_active: true,
      start_date: DATE,
      end_date: DATE,
      title: 'חופשה ערבית'
    },
    {
      calendar_sector: 'druze',
      blocks_scheduling: true,
      is_active: true,
      start_date: DATE,
      end_date: DATE,
      title: 'חופשה דרוזית'
    }
  ];
  const audit = auditStoredPlanningHardGates({
    shared,
    activities: [activity('jewish')],
    instructors: [{ emp_id: '100', active: 'yes' }],
    profiles: { 100: { gender: 'female', instruction_languages: ['he'] } },
    rules: weeklyRules('100'),
    exceptions: {},
    schoolCalendar
  });
  assert.deepEqual(audit.invalidActivityIds, []);
  assert.equal(audit.hardGateInvalidCount, 0);
});
