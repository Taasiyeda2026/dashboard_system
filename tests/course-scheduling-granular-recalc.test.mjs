import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildPlanningContextParts,
  diffPlanningContextParts,
  parsePlanningContextFingerprint,
  planningContextFingerprint,
  resolvePlanningContextChange,
  serializePlanningContextFingerprint
} from '../frontend/src/screens/course-scheduling-planning.js';
import { sharedPlanningAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';

const catalog = [{
  activity_no: '53828',
  activity_name: 'ביומימיקרי',
  meetings_count: 11,
  hours_count: 16.5
}];

function baseInput(overrides = {}) {
  return {
    activities: [],
    instructors: [
      { emp_id: 'aline', active: 'yes', address: 'חיפה', gender: 'female', languages: ['he'] },
      { emp_id: 'eldar', active: 'yes', address: 'תל אביב', gender: 'male', languages: ['he'] },
      { emp_id: 'other', active: 'yes', address: 'ירושלים', gender: 'male', languages: ['he'] }
    ],
    profiles: [
      { emp_id: 'aline', friday_allowed: false },
      { emp_id: 'eldar', friday_allowed: true },
      { emp_id: 'other', friday_allowed: false }
    ],
    rules: [
      { emp_id: 'aline', weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
      { emp_id: 'eldar', weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
      { emp_id: 'other', weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }
    ],
    exceptions: [],
    schoolCalendar: [],
    catalog,
    periodKey: 'year',
    ...overrides
  };
}

function planningEntry(activityId, {
  instructorEmpId = '',
  optionInstructorIds = [],
  substituteIds = [],
  meetings = [],
  needsRecalc = false,
  activityUpdatedAt = '2026-09-20T10:00:00Z',
  kind = 'proposal'
} = {}) {
  return {
    activityId,
    activityUpdatedAt,
    needsRecalc,
    lockedOption: null,
    row: {
      courseId: activityId,
      kind,
      instructorEmpId,
      meetings: meetings.map((meeting, index) => ({
        date: meeting.date,
        meeting_no: index + 1,
        start_time: meeting.start || '08:00',
        end_time: meeting.end || '09:30',
        substituteEmpId: meeting.substituteEmpId || ''
      })),
      options: optionInstructorIds.map((empId) => ({
        instructorEmpId: empId,
        meetings: meetings.map((meeting, index) => ({
          date: meeting.date,
          meeting_no: index + 1,
          start_time: meeting.start || '08:00',
          end_time: meeting.end || '09:30'
        }))
      })),
      singleMeetingSubstitutions: substituteIds.map((empId) => ({ substituteEmpId: empId }))
    }
  };
}

function activity(rowId, {
  empId = '',
  updatedAt = '2026-09-20T10:00:00Z',
  activityNo = '53828',
  calendarSector = 'general',
  meetings = []
} = {}) {
  return {
    row_id: rowId,
    emp_id: empId,
    updated_at: updatedAt,
    activity_no: activityNo,
    activity_name: 'ביומימיקרי',
    calendar_sector: calendarSector,
    school_id: 1,
    authority: 'רשות',
    district: 'חיפה',
    start_time: '08:00',
    end_time: '09:30',
    draft_proposed_meetings: meetings.map((meeting, index) => ({
      date: meeting.date,
      meeting_no: index + 1,
      start_time: meeting.start || '08:00',
      end_time: meeting.end || '09:30'
    }))
  };
}

test('test 1: instructor exception change affects only related planning rows', () => {
  const previous = buildPlanningContextParts(baseInput());
  const current = buildPlanningContextParts(baseInput({
    exceptions: [{ emp_id: 'aline', exception_date: '2026-10-20', available: false }]
  }));
  const contextDiff = diffPlanningContextParts(previous, current);
  assert.deepEqual(contextDiff.changedExceptionInstructorIds, ['aline']);
  assert.equal(contextDiff.unrecoverableGlobal, false);

  const currentCourseIds = [
    'PAI-ae276b4c-9042-4ae0-acff-41fbb558e9b0-3',
    'PAI-ae276b4c-9042-4ae0-acff-41fbb558e9b0-4',
    'PAI-other-1',
    'PAI-other-2'
  ];
  const shared = {
    rows: [
      planningEntry(currentCourseIds[0], {
        instructorEmpId: 'aline',
        meetings: [{ date: '2026-10-20' }]
      }),
      planningEntry(currentCourseIds[1], {
        optionInstructorIds: ['aline', 'other'],
        meetings: [{ date: '2026-10-27' }]
      }),
      planningEntry(currentCourseIds[2], {
        instructorEmpId: 'other',
        meetings: [{ date: '2026-10-20' }]
      }),
      planningEntry(currentCourseIds[3], {
        instructorEmpId: 'eldar',
        meetings: [{ date: '2026-11-03' }]
      })
    ]
  };
  const activities = currentCourseIds.map((id, index) => activity(id, {
    empId: index < 2 ? '' : (index === 2 ? 'other' : 'eldar'),
    meetings: shared.rows[index].row.meetings
  }));

  const affectedIds = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds,
    contextDiff
  });
  assert.equal(affectedIds.length, 2);
  assert.ok(affectedIds.includes(currentCourseIds[0]));
  assert.ok(affectedIds.includes(currentCourseIds[1]));
  assert.ok(!affectedIds.includes(currentCourseIds[2]));
  assert.ok(!affectedIds.includes(currentCourseIds[3]));
});

test('test 2: instructor availability change affects only related rows', () => {
  const previous = buildPlanningContextParts(baseInput());
  const current = buildPlanningContextParts(baseInput({
    rules: [
      { emp_id: 'eldar', weekday: 0, available: true, start_time: '10:00', end_time: '14:00' },
      { emp_id: 'aline', weekday: 0, available: true, start_time: '08:00', end_time: '16:00' },
      { emp_id: 'other', weekday: 0, available: true, start_time: '08:00', end_time: '16:00' }
    ]
  }));
  const contextDiff = diffPlanningContextParts(previous, current);
  assert.deepEqual(contextDiff.changedAvailabilityInstructorIds, ['eldar']);

  const currentCourseIds = ['live-eldar', 'plan-eldar', 'plan-other'];
  const shared = {
    rows: [
      planningEntry('live-eldar', {
        instructorEmpId: 'eldar',
        kind: 'live',
        meetings: [{ date: '2026-10-13' }]
      }),
      planningEntry('plan-eldar', {
        optionInstructorIds: ['eldar'],
        meetings: [{ date: '2026-10-20' }]
      }),
      planningEntry('plan-other', {
        instructorEmpId: 'other',
        meetings: [{ date: '2026-10-20' }]
      })
    ]
  };
  const activities = [
    activity('live-eldar', { empId: 'eldar', meetings: [{ date: '2026-10-13' }] }),
    activity('plan-eldar', { meetings: [{ date: '2026-10-20' }] }),
    activity('plan-other', { meetings: [{ date: '2026-10-20' }] })
  ];
  const affectedIds = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds,
    contextDiff
  });
  assert.deepEqual(affectedIds.sort(), ['live-eldar', 'plan-eldar'].sort());
});

test('test 3: single activity change affects only that activity and dependencies', () => {
  const currentCourseIds = ['a1', 'a2', 'a3'];
  const shared = {
    rows: [
      planningEntry('a1', {
        instructorEmpId: 'aline',
        activityUpdatedAt: '2026-09-20T10:00:00Z',
        meetings: [{ date: '2026-10-20', start: '08:00', end: '09:30' }]
      }),
      planningEntry('a2', {
        instructorEmpId: 'aline',
        meetings: [{ date: '2026-10-20', start: '10:00', end: '11:30' }]
      }),
      planningEntry('a3', {
        instructorEmpId: 'other',
        meetings: [{ date: '2026-11-03', start: '08:00', end: '09:30' }]
      })
    ]
  };
  const activities = [
    activity('a1', {
      updatedAt: '2026-09-27T12:00:00Z',
      meetings: [{ date: '2026-10-20', start: '08:00', end: '09:30' }]
    }),
    activity('a2', { meetings: [{ date: '2026-10-20', start: '10:00', end: '11:30' }] }),
    activity('a3', { meetings: [{ date: '2026-11-03', start: '08:00', end: '09:30' }] })
  ];
  const affectedIds = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds
  });
  assert.ok(affectedIds.includes('a1'));
  assert.ok(affectedIds.includes('a2'));
  assert.ok(!affectedIds.includes('a3'));
});

test('test 4: school calendar day change affects only overlapping activities', () => {
  const previous = buildPlanningContextParts(baseInput({
    schoolCalendar: [{
      title: 'חג',
      start_date: '2026-10-20',
      end_date: '2026-10-20',
      calendar_sector: 'jewish',
      blocks_scheduling: true
    }]
  }));
  const current = buildPlanningContextParts(baseInput({
    schoolCalendar: [{
      title: 'חג',
      start_date: '2026-10-20',
      end_date: '2026-10-21',
      calendar_sector: 'jewish',
      blocks_scheduling: true
    }]
  }));
  const contextDiff = diffPlanningContextParts(previous, current);
  assert.equal(contextDiff.changedCalendarWindows.length, 1);

  const currentCourseIds = ['c-hit', 'c-miss', 'c-other-sector'];
  const shared = {
    rows: [
      planningEntry('c-hit', { instructorEmpId: 'aline', meetings: [{ date: '2026-10-20' }] }),
      planningEntry('c-miss', { instructorEmpId: 'aline', meetings: [{ date: '2026-11-10' }] }),
      planningEntry('c-other-sector', { instructorEmpId: 'other', meetings: [{ date: '2026-10-20' }] })
    ]
  };
  const activities = [
    activity('c-hit', { calendarSector: 'jewish', meetings: [{ date: '2026-10-20' }] }),
    activity('c-miss', { calendarSector: 'jewish', meetings: [{ date: '2026-11-10' }] }),
    activity('c-other-sector', { calendarSector: 'arab', meetings: [{ date: '2026-10-20' }] })
  ];
  const affectedIds = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds,
    contextDiff
  });
  assert.deepEqual(affectedIds, ['c-hit']);
});

test('test 5: catalog change for one program affects only that program', () => {
  const previous = buildPlanningContextParts(baseInput());
  const current = buildPlanningContextParts(baseInput({
    catalog: [{ ...catalog[0], meetings_count: 12 }]
  }));
  const contextDiff = diffPlanningContextParts(previous, current);
  assert.deepEqual(contextDiff.changedCatalogKeys, ['53828']);

  const currentCourseIds = ['p-bio', 'p-other'];
  const shared = {
    rows: [
      planningEntry('p-bio', { instructorEmpId: 'aline', meetings: [{ date: '2026-10-20' }] }),
      planningEntry('p-other', { instructorEmpId: 'other', meetings: [{ date: '2026-10-20' }] })
    ]
  };
  const activities = [
    activity('p-bio', { activityNo: '53828', meetings: [{ date: '2026-10-20' }] }),
    activity('p-other', { activityNo: '99999', meetings: [{ date: '2026-10-20' }] })
  ];
  const affectedIds = sharedPlanningAffectedCourseIds({
    shared,
    activities,
    currentCourseIds,
    contextDiff
  });
  assert.deepEqual(affectedIds, ['p-bio']);
});

test('test 6: context fingerprint change for one instructor does not imply fullRun', () => {
  const previousInput = baseInput();
  const currentInput = baseInput({
    exceptions: [{ emp_id: 'aline', exception_date: '2026-10-20', available: false }]
  });
  const stored = serializePlanningContextFingerprint(previousInput);
  const resolved = resolvePlanningContextChange({
    storedFingerprint: stored,
    currentInput
  });
  assert.equal(resolved.contextChanged, true);
  assert.equal(resolved.unrecoverableGlobalContextChange, false);
  assert.deepEqual(resolved.contextDiff.changedExceptionInstructorIds, ['aline']);
  assert.notEqual(planningContextFingerprint(previousInput), planningContextFingerprint(currentInput));
});

test('test 7/8/9 source contract: fullRun only for forceFull, missing workspace, empty rows, or unrecoverable global', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /const fullRun = forceFull\s*\|\|\s*!shared\?\.workspace\s*\|\|\s*!existingRows\.length\s*\|\|\s*unrecoverableGlobalContextChange/);
  assert.doesNotMatch(source, /fullRun =[^\n]*\|\|\s*contextChanged\b/);
  assert.doesNotMatch(source, /if \(contextChanged\) return \[\.\.\.currentIds\]/);
});

test('test 10: no affectedIds means no recalculation', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!fullRun && affectedIds\.length === 0\)/);
  assert.match(source, /התכנון כבר מעודכן/);

  const affectedIds = sharedPlanningAffectedCourseIds({
    shared: {
      rows: [
        planningEntry('stable', {
          instructorEmpId: 'aline',
          meetings: [{ date: '2026-10-20' }]
        })
      ]
    },
    activities: [activity('stable', { meetings: [{ date: '2026-10-20' }] })],
    currentCourseIds: ['stable'],
    contextDiff: diffPlanningContextParts(
      buildPlanningContextParts(baseInput()),
      buildPlanningContextParts(baseInput())
    )
  });
  assert.deepEqual(affectedIds, []);
});

test('test 11: engine version change with mappable affected rows is not a fullRun trigger', () => {
  const input = baseInput({
    exceptions: [{ emp_id: 'aline', exception_date: '2026-10-20', available: false }]
  });
  const previous = baseInput();
  const stored = serializePlanningContextFingerprint(previous);
  const resolved = resolvePlanningContextChange({
    storedFingerprint: stored,
    currentInput: input,
    engineChanged: true,
    legacyFingerprint: 'unrelated-legacy-hash'
  });
  assert.equal(resolved.contextChanged, true);
  assert.equal(resolved.unrecoverableGlobalContextChange, false);
});

test('test 12: true unmappable global change allows full run', () => {
  const hashOnly = planningContextFingerprint(baseInput());
  const resolved = resolvePlanningContextChange({
    storedFingerprint: hashOnly,
    currentInput: baseInput({
      exceptions: [{ emp_id: 'aline', exception_date: '2026-10-20', available: false }]
    })
  });
  assert.equal(resolved.contextChanged, true);
  assert.equal(resolved.unrecoverableGlobalContextChange, true);

  const periodShift = resolvePlanningContextChange({
    storedFingerprint: serializePlanningContextFingerprint(baseInput()),
    currentInput: baseInput({ periodKey: 'first_half' })
  });
  assert.equal(periodShift.unrecoverableGlobalContextChange, true);

  const parsed = parsePlanningContextFingerprint(serializePlanningContextFingerprint(baseInput()));
  assert.ok(parsed.parts);
  assert.equal(parsed.hash, planningContextFingerprint(baseInput()));
});

test('store never expands all course ids solely because contextChanged is true', async () => {
  const store = await readFile(new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(store, /if \(contextChanged\) return \[\.\.\.currentIds\]/);
  assert.match(store, /unrecoverableGlobalContextChange/);
});
