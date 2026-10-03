import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { optimizeSchoolDayPackingPass } from '../frontend/src/screens/course-scheduling-planning.js';
import { planningEngineUpgradeAffectedCourseIds } from '../frontend/src/screens/course-scheduling-planning-store.js';

function option(emp, date, start, end) {
  return {
    instructorEmpId: emp,
    instructorName: emp,
    startDate: date,
    endDate: date,
    startTime: start,
    endTime: end,
    routeVerified: true,
    meetings: [{ date, start_time: start, end_time: end }]
  };
}

test('school packing uses hidden coverage options, not only the three UI alternatives', () => {
  const activities = [
    { row_id: 'a', school_id: 'school-1', school: 'School', activity_type: 'course' },
    { row_id: 'b', school_id: 'school-1', school: 'School', activity_type: 'course' }
  ];
  const rowsById = new Map([
    ['a', {
      courseId: 'a',
      schoolId: 'school-1',
      school: 'School',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: '1',
      startDate: '2026-10-12',
      startTime: '10:00',
      endTime: '11:30',
      meetings: [{ date: '2026-10-12', start_time: '10:00', end_time: '11:30' }],
      options: [option('1', '2026-10-12', '10:00', '11:30')],
      packingOptions: [
        option('1', '2026-10-12', '10:00', '11:30'),
        option('1', '2026-10-13', '10:00', '11:30')
      ]
    }],
    ['b', {
      courseId: 'b',
      schoolId: 'school-1',
      school: 'School',
      kind: 'proposal',
      instructorEmpId: '1',
      instructorName: '1',
      startDate: '2026-10-14',
      startTime: '12:00',
      endTime: '13:30',
      meetings: [{ date: '2026-10-14', start_time: '12:00', end_time: '13:30' }],
      options: [option('1', '2026-10-14', '12:00', '13:30')],
      packingOptions: [
        option('1', '2026-10-14', '12:00', '13:30'),
        option('1', '2026-10-13', '12:00', '13:30')
      ]
    }]
  ]);

  const result = optimizeSchoolDayPackingPass({ rowsById, activities });
  assert.equal(result.moved, 2);
  assert.equal(rowsById.get('a').startDate, '2026-10-13');
  assert.equal(rowsById.get('b').startDate, '2026-10-13');
  assert.equal(rowsById.get('a').schoolPlanning.minimumFeasibleWeekdays, 1);
  assert.equal(rowsById.get('a').schoolPlanning.packingStatus, 'packed');
});

test('v24 to v25 upgrade targets only multi-proposal schools', () => {
  const activities = [
    { row_id: 'a', school_id: 'school-1' },
    { row_id: 'b', school_id: 'school-1' },
    { row_id: 'c', school_id: 'school-2' }
  ];
  const shared = {
    rows: [
      { activityId: 'a', row: { courseId: 'a', schoolId: 'school-1', kind: 'proposal' } },
      { activityId: 'b', row: { courseId: 'b', schoolId: 'school-1', kind: 'proposal' } },
      { activityId: 'c', row: { courseId: 'c', schoolId: 'school-2', kind: 'proposal' } }
    ]
  };

  const ids = planningEngineUpgradeAffectedCourseIds({
    shared,
    activities,
    storedEngineVersion: 'planning-v24-20261003-school-day-packing-self-invalidation',
    currentEngineVersion: 'planning-v25-20261003-school-packing-option-coverage'
  });

  assert.deepEqual(new Set(ids), new Set(['a', 'b']));
});

test('fast UI alternatives no longer cap school-packing coverage at three options', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
  assert.match(source, /MAX_SCHOOL_PACKING_OPTIONS\s*=\s*24/);
  assert.match(source, /packingCoverage/);
  assert.match(source, /packingOptions/);
  assert.match(source, /row\?\.packingOptions\?\.length\s*\?\s*row\.packingOptions\s*:\s*row\?\.options/);
});

test('planning progress names the current phase instead of presenting phase resets as a new run', async () => {
  const source = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = source.indexOf('const updatePlanningStatusInPlace');
  const end = source.indexOf('const onPlanningNeedsRecalc', start);
  const block = source.slice(start, end);
  assert.match(block, /const phaseLabel = phase/);
  assert.match(block, /זה שלב בתוך אותה ריצה; החישוב לא התחיל מחדש/);
  assert.doesNotMatch(block, /pending > 0 && !\/מלא\//);
});
