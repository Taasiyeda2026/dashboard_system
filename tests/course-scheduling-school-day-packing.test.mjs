import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchoolPlanningGroups,
  comparePlanningPlanQuality,
  optimizeSchoolDayPackingPass,
  planningSchoolDayMetrics
} from '../frontend/src/screens/course-scheduling-planning.js';

const meeting = (date, start = '09:00', end = '10:00') => ({ date, start_time: start, end_time: end });
const option = (empId, date, start = '09:00', end = '10:00', extra = {}) => ({
  instructorEmpId: String(empId), instructorName: `מדריך ${empId}`,
  startDate: date, endDate: date, startTime: start, endTime: end,
  meetings: [meeting(date, start, end)], routeVerified: true, ...extra
});
const proposal = (id, schoolId, current, options, extra = {}) => ({
  courseId: id, schoolId, school: `בית ספר ${schoolId}`, authority: 'רשות', kind: 'proposal',
  instructorEmpId: current.instructorEmpId, instructorName: current.instructorName,
  startDate: current.startDate, endDate: current.endDate, startTime: current.startTime, endTime: current.endTime,
  meetings: current.meetings, options, ...extra
});
const activity = (id, schoolId) => ({ row_id: id, school_id: schoolId, school: `בית ספר ${schoolId}` });

test('A/M: same-school proposals, including Liron, use one legal weekday', () => {
  const mondayA = option(1550, '2027-01-04', '10:00', '11:00');
  const mondayB = option(1550, '2027-01-04', '11:00', '12:00');
  const rows = new Map([
    ['a', proposal('a', 'school-1', mondayA, [mondayA])],
    ['b', proposal('b', 'school-1', option(1550, '2027-01-05', '11:00', '12:00'), [mondayB])]
  ]);
  const result = optimizeSchoolDayPackingPass({ rowsById: rows, activities: [activity('a', 'school-1'), activity('b', 'school-1')] });
  assert.ok(result.moved >= 1);
  assert.deepEqual([...new Set([...rows.values()].flatMap((row) => row.schoolPlanning.actualWeekdays))], [1]);
  assert.equal(planningSchoolDayMetrics([...rows.values()]).avoidableSchoolDaySplits, 0);
});

test('B: packing commits a two-row bundle instead of stopping at a local minimum', () => {
  const rows = new Map();
  for (let index = 0; index < 4; index += 1) {
    const id = `bundle-${index}`;
    const start = `${9 + index}:00`;
    const end = `${10 + index}:00`;
    const monday = option('7', '2027-01-04', start, end);
    const current = index < 2 ? monday : option('7', '2027-01-05', start, end);
    rows.set(id, proposal(id, 'bundle-school', current, [monday]));
  }
  optimizeSchoolDayPackingPass({ rowsById: rows, activities: [...rows.keys()].map((id) => activity(id, 'bundle-school')) });
  assert.deepEqual([...new Set([...rows.values()].flatMap((row) => row.schoolPlanning.actualWeekdays))], [1]);
  assert.ok([...rows.values()].every((row) => row.startDate === '2027-01-04'));
});

test('C: six activities that require two weekdays use exactly two, not three or four', () => {
  const rows = new Map();
  const activities = [];
  for (let index = 0; index < 6; index += 1) {
    const id = `six-${index}`;
    const targetDate = index < 3 ? '2027-01-04' : '2027-01-05';
    const currentDate = ['2027-01-04', '2027-01-05', '2027-01-06'][index % 3];
    rows.set(id, proposal(id, 'six-school', option(index + 1, currentDate), [option(index + 1, targetDate)]));
    activities.push(activity(id, 'six-school'));
  }
  optimizeSchoolDayPackingPass({ rowsById: rows, activities });
  assert.equal(rows.get('six-0').schoolPlanning.actualWeekdays.length, 2);
  assert.equal(rows.get('six-0').schoolPlanning.minimumFeasibleWeekdays, 2);
});

test('D: parallel lanes with different instructors may pack into one day', () => {
  const monday1 = option('1', '2027-01-04');
  const monday2 = option('2', '2027-01-04');
  const rows = new Map([
    ['p1', proposal('p1', 'parallel', monday1, [monday1])],
    ['p2', proposal('p2', 'parallel', option('2', '2027-01-05'), [monday2])]
  ]);
  optimizeSchoolDayPackingPass({ rowsById: rows, activities: [activity('p1', 'parallel'), activity('p2', 'parallel')] });
  assert.equal(rows.get('p1').schoolPlanning.actualWeekdays.length, 1);
});

test('E/G: fixed, locked and source-dated weekdays remain anchors and flexible siblings converge around them', () => {
  for (const kind of ['fixed', 'planning-locked', 'source-dated']) {
    const anchor = {
      courseId: `${kind}-anchor`,
      schoolId: kind,
      kind: kind === 'source-dated' ? 'proposal' : kind,
      planningLocked: kind === 'planning-locked',
      schoolDateAnchored: kind === 'source-dated',
      meetings: [meeting('2027-01-05')]
    };
    const flexible = proposal(`${kind}-flex`, kind, option('2', '2027-01-04'), [option('2', '2027-01-05')]);
    const rows = new Map([[anchor.courseId, anchor], [flexible.courseId, flexible]]);
    optimizeSchoolDayPackingPass({ rowsById: rows, activities: [activity(anchor.courseId, kind), activity(flexible.courseId, kind)] });
    assert.equal(rows.get(anchor.courseId).meetings[0].date, '2027-01-05');
    assert.equal(rows.get(flexible.courseId).meetings[0].date, '2027-01-05');
  }
});

test('school-conflict recruitment can return to an existing instructor when a stored staff option is feasible', () => {
  const staffed = option('7', '2027-01-04', '10:00', '11:00');
  const scheduleOnly = {
    instructorEmpId: '', instructorName: '',
    startDate: '2027-01-04', endDate: '2027-01-04', startTime: '10:00', endTime: '11:00',
    meetings: [meeting('2027-01-04', '10:00', '11:00')], routeVerified: true
  };
  const first = proposal('existing', 'recover', option('7', '2027-01-04', '09:00', '10:00'), [option('7', '2027-01-04', '09:00', '10:00')]);
  const fallback = {
    ...proposal('fallback', 'recover', staffed, [staffed]),
    kind: 'recruitment',
    instructorEmpId: '',
    instructorName: '',
    meetings: scheduleOnly.meetings,
    startDate: scheduleOnly.startDate,
    startTime: scheduleOnly.startTime,
    endTime: scheduleOnly.endTime,
    packingOptions: [staffed],
    scheduleOptions: [scheduleOnly],
    diagnostics: { schoolConflictFallback: true }
  };
  const rows = new Map([['existing', first], ['fallback', fallback]]);
  optimizeSchoolDayPackingPass({
    rowsById: rows,
    activities: [activity('existing', 'recover'), activity('fallback', 'recover')]
  });
  assert.equal(rows.get('fallback').kind, 'proposal');
  assert.equal(rows.get('fallback').instructorEmpId, '7');
});

test('F: a proven two-day requirement is required_split with no avoidable split', () => {
  const anchor = { courseId: 'anchor', schoolId: 'required', kind: 'fixed', meetings: [meeting('2027-01-05')] };
  const flex = proposal('flex', 'required', option('2', '2027-01-04'), [option('2', '2027-01-04')]);
  const rows = new Map([['anchor', anchor], ['flex', flex]]);
  optimizeSchoolDayPackingPass({ rowsById: rows, activities: [activity('anchor', 'required'), activity('flex', 'required')] });
  assert.equal(rows.get('flex').schoolPlanning.packingStatus, 'required_split');
  assert.equal(rows.get('flex').schoolPlanning.avoidableSplitCount, 0);
});

test('I/K: missing school_id never groups by name and unverified travel options are not packed', () => {
  const rowsWithoutIds = [
    proposal('x', '', option('1', '2027-01-04'), [], { school: 'שם זהה' }),
    proposal('y', '', option('2', '2027-01-05'), [], { school: 'שם זהה' })
  ];
  assert.equal(buildSchoolPlanningGroups({ rows: rowsWithoutIds, activities: [] }).length, 0);

  const a = proposal('a', 'travel', option('1', '2027-01-04'), [option('1', '2027-01-04')]);
  const b = proposal('b', 'travel', option('2', '2027-01-05'), [option('2', '2027-01-04', '09:00', '10:00', { routeVerified: false })]);
  const packed = new Map([['a', a], ['b', b]]);
  optimizeSchoolDayPackingPass({ rowsById: packed, activities: [activity('a', 'travel'), activity('b', 'travel')] });
  assert.equal(packed.get('b').startDate, '2027-01-05');
});

test('J: fewer avoidable school splits wins hierarchically before secondary score', () => {
  const first = option('1', '2027-01-04');
  const second = option('1', '2027-01-04', '10:00', '11:00');
  const packed = [proposal('a', 'fair', first, [first]), proposal('b', 'fair', second, [second])];
  packed.forEach((row) => { row.schoolPlanning = { actualWeekdays: [1], minimumFeasibleWeekdays: 1, avoidableSplitCount: 0, packingStatus: 'packed' }; });
  const split = structuredClone(packed);
  split[1].meetings = [meeting('2027-01-05')];
  split.forEach((row) => { row.schoolPlanning = { actualWeekdays: [1, 2], minimumFeasibleWeekdays: 1, avoidableSplitCount: 1, packingStatus: 'avoidable_split' }; });
  split.forEach((row) => { row.options[0].planningOptimization = { total: 100 }; });
  assert.ok(comparePlanningPlanQuality(packed, split) < 0);
});
