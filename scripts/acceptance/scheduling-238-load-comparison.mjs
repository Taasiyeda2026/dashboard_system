// Isolated offline before/after on the read-only 238-course planning snapshot.
// No production network writes. Missing travel-cache legs are filled with a
// deterministic placeholder so validation can run offline; real cache rows win.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { buildDynamicCoursePlan } from '../../frontend/src/screens/course-scheduling-planning.js';
import { operationalQuality } from '../../frontend/src/screens/scheduling-core/quality.js';
import { createRouteClient } from '../../frontend/src/screens/course-scheduling-travel.js';
import { compileConstraints, isProtectedActivity, officialMeetings } from '../../frontend/src/screens/scheduling-core/constraints.js';

const root = process.env.SNAPSHOT_DIR || '/tmp/scheduling-238-snapshot';
const outDir = process.env.OUT_DIR || `${root}/results`;
mkdirSync(outDir, { recursive: true });
const fixture = JSON.parse(readFileSync(`${root}/fixture.json`, 'utf8'));

const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const homes = new Map(fixture.instructors.map((i) => [String(i.emp_id), i.address]));
const schoolById = new Map(fixture.schools.map((s) => [String(s.id), s.institution_address]));

// Prefer scheduling_school_location addresses when present on activities.
for (const activity of fixture.activities) {
  if (!activity.school_address && activity.school_id != null) {
    activity.school_address = schoolById.get(String(activity.school_id)) || '';
  }
}

const needed = new Set();
const addPair = (a, b) => {
  const origin = normalize(a), destination = normalize(b);
  if (!origin || !destination) return;
  needed.add(`${origin}\0${destination}`);
};
for (const row of fixture.existingRows) {
  const activity = fixture.activities.find((a) => String(a.row_id) === String(row.courseId));
  const school = activity?.school_address || schoolById.get(String(activity?.school_id || row.schoolId)) || '';
  const home = homes.get(String(row.instructorEmpId || activity?.emp_id || ''));
  if (home && school) { addPair(home, school); addPair(school, home); }
}
const byInstructorDate = new Map();
for (const row of fixture.existingRows) {
  if (!row.instructorEmpId) continue;
  const activity = fixture.activities.find((a) => String(a.row_id) === String(row.courseId));
  const school = activity?.school_address || '';
  for (const meeting of row.meetings || []) {
    const key = `${row.instructorEmpId}|${meeting.date}`;
    const list = byInstructorDate.get(key) || [];
    list.push({ start: meeting.start_time, school });
    byInstructorDate.set(key, list);
  }
}
for (const list of byInstructorDate.values()) {
  list.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  for (let i = 1; i < list.length; i++) addPair(list[i - 1].school, list[i].school);
}

const have = new Set(fixture.routes.map((r) => `${normalize(r.origin_key)}\0${normalize(r.destination_key)}`));
const fillers = [];
for (const key of needed) {
  if (have.has(key)) continue;
  const [origin_key, destination_key] = key.split('\0');
  fillers.push({ origin_key, destination_key, distance_km: 8, duration_minutes: 15 });
}

const routeClient = createRouteClient({
  preloadedRows: [...fixture.routes, ...fillers],
  invoke: async () => ({ data: { calculated: false }, error: null })
});

const baseInput = {
  activities: fixture.activities,
  instructors: fixture.instructors,
  profiles: fixture.profiles,
  rules: fixture.rules,
  exceptions: fixture.exceptions,
  schoolCalendar: fixture.schoolCalendar,
  catalog: fixture.catalog,
  today: '2026-10-09',
  periodKey: 'year',
  planningProfile: 'fast',
  existingRows: fixture.existingRows,
  committedRows: fixture.existingRows,
  lockedOptions: fixture.lockedOptions || {},
  routeClient,
  allowGlobalRepair: true
};

const pick = (q, extra = {}) => ({
  covered: q.covered,
  uncovered: q.uncovered,
  meetingHours: q.meetingHours,
  schoolActiveDays: q.schoolActiveDays,
  instructorWorkDays: q.instructorWorkDays ?? q.workDays,
  sameSchoolSequences: q.sameSchoolSequences,
  splitDays: q.splitDays,
  waitingMinutes: q.waitingMinutes,
  totalTravelMinutes: q.totalTravelMinutes,
  totalTravelKm: q.totalTravelKm,
  unknownRouteLegs: q.unknownRouteLegs,
  instructorsUsed: q.instructorsUsed,
  ...extra
});

const normMeetings = (meetings = []) => (meetings || []).map((m) => ({
  date: m.date,
  start_time: String(m.start_time || '').slice(0, 5),
  end_time: String(m.end_time || '').slice(0, 5)
}));
const projection = (row) => ({
  courseId: row.courseId,
  kind: ['live', 'planning-locked'].includes(row.kind) || row.planningLocked ? (row.planningLocked || row.kind === 'planning-locked' ? 'planning-locked' : 'live') : row.kind,
  instructorEmpId: String(row.instructorEmpId || ''),
  meetings: normMeetings(row.meetings),
  planningLocked: !!(row.planningLocked || row.kind === 'planning-locked')
});

const context = compileConstraints(baseInput);
const incumbentQuality = operationalQuality(fixture.existingRows, baseInput, context);

const t0 = performance.now();
const before = await buildDynamicCoursePlan({ ...baseInput, skipSoftOptimization: true });
const beforeMs = performance.now() - t0;

const t1 = performance.now();
const after = await buildDynamicCoursePlan({ ...baseInput, skipSoftOptimization: false });
const afterMs = performance.now() - t1;

const protectedBefore = fixture.existingRows
  .filter((row) => {
    const activity = fixture.activities.find((a) => String(a.row_id) === String(row.courseId));
    return row.kind === 'live' || row.planningLocked || (activity && isProtectedActivity(activity));
  })
  .map(projection)
  .sort((a, b) => a.courseId.localeCompare(b.courseId));
const protectedAfter = after.rows
  .filter((row) => protectedBefore.some((p) => p.courseId === row.courseId))
  .map(projection)
  .sort((a, b) => a.courseId.localeCompare(b.courseId));

const missingTargets = fixture.existingRows.filter((r) => !r.instructorEmpId).map((r) => r.courseId).slice(0, 5);
const t2 = performance.now();
const scoped = await buildDynamicCoursePlan({
  ...baseInput,
  targetCourseIds: missingTargets,
  allowGlobalRepair: false,
  skipSoftOptimization: false
});
const scopedMs = performance.now() - t2;

const report = {
  meta: {
    ...fixture.meta,
    generatedAt: new Date().toISOString(),
    engineRevision: after.optimization?.algorithmRevision,
    productionWrites: 0,
    routeFillers: fillers.length,
    note: 'Offline snapshot of scheduling_planning_rows (238) + school_2027 courses. Missing travel-cache legs filled deterministically (8km/15m) so validation can run without network.'
  },
  incumbentSavedPlan: pick(incumbentQuality, { rows: fixture.existingRows.length }),
  beforeSkipSoftOpt: pick(before.quality, {
    planned: before.planned,
    elapsedMs: beforeMs,
    optimizationMs: before.newEngineMetrics?.optimizationMs,
    valid: before.finalPlanValidation?.valid,
    constraintFailures: before.finalPlanValidation?.failures?.length || 0,
    stopReason: before.optimization?.stopReason,
    softOptimizationAttempted: before.optimization?.softOptimizationAttempted
  }),
  afterSoftOpt: pick(after.quality, {
    planned: after.planned,
    elapsedMs: afterMs,
    optimizationMs: after.newEngineMetrics?.optimizationMs,
    valid: after.finalPlanValidation?.valid,
    constraintFailures: after.finalPlanValidation?.failures?.length || 0,
    stopReason: after.optimization?.stopReason,
    softOptimizationAttempted: after.optimization?.softOptimizationAttempted,
    scope: after.optimization?.scope,
    stages: after.optimization?.stages,
    decisionCount: after.optimization?.decisions?.length || 0
  }),
  deltasSkipToSoft: {
    covered: after.quality.covered - before.quality.covered,
    schoolActiveDays: after.quality.schoolActiveDays - before.quality.schoolActiveDays,
    instructorWorkDays: (after.quality.instructorWorkDays ?? after.quality.workDays) - (before.quality.instructorWorkDays ?? before.quality.workDays),
    waitingMinutes: after.quality.waitingMinutes - before.quality.waitingMinutes,
    totalTravelMinutes: after.quality.totalTravelMinutes - before.quality.totalTravelMinutes,
    totalTravelKm: after.quality.totalTravelKm - before.quality.totalTravelKm,
    elapsedMs: afterMs - beforeMs
  },
  protectedAnchors: (() => {
    const beforeMap = new Map(protectedBefore.map((r) => [r.courseId, r]));
    const afterMap = new Map(protectedAfter.map((r) => [r.courseId, r]));
    const changed = [];
    for (const [id, beforeRow] of beforeMap) {
      const afterRow = afterMap.get(id);
      if (JSON.stringify(beforeRow) !== JSON.stringify(afterRow)) changed.push({ courseId: id, before: beforeRow, after: afterRow || null });
    }
    return { count: protectedBefore.length, unchanged: changed.length === 0, changed: changed.slice(0, 20) };
  })(),
  scopedSample: {
    targetCourseIds: missingTargets,
    planned: scoped.planned,
    elapsedMs: scopedMs,
    scope: scoped.optimization?.scope,
    decisions: scoped.optimization?.decisions || [],
    valid: scoped.finalPlanValidation?.valid
  },
  gates: {
    coveredDoesNotDecrease: after.quality.covered >= before.quality.covered,
    schoolActiveDaysDoNotIncreaseWhenCoverageEqual:
      !(after.quality.covered === before.quality.covered && after.quality.schoolActiveDays > before.quality.schoolActiveDays),
    noNewConstraintViolations: before.finalPlanValidation?.valid === true && after.finalPlanValidation?.valid === true,
    protectedInstructorsUnchanged: protectedBefore.every((row) => {
      const afterRow = protectedAfter.find((r) => r.courseId === row.courseId);
      return afterRow && afterRow.instructorEmpId === row.instructorEmpId;
    }),
    softOptDidNotTouchProtected: (after.optimization?.decisions || []).every((d) => !protectedBefore.some((p) => p.courseId === d.courseId)),
    // Live rows may sync meeting dates to current official activity dates; soft-opt must not relocate them.
    officialDatesPreservedForAnchored: after.rows.every((row) => {
      const activity = fixture.activities.find((a) => String(a.row_id) === String(row.courseId));
      if (!activity) return true;
      const official = officialMeetings(activity);
      if (!official.length) return true;
      return JSON.stringify((row.meetings || []).map((m) => m.date)) === JSON.stringify(official.map((m) => m.date));
    })
  }
};

writeFileSync(`${outDir}/load-before-after.json`, JSON.stringify(report, null, 2));
writeFileSync('docs/scheduling-v37-quality-priority-20261012/evidence/load-before-after-238.json', JSON.stringify(report, null, 2));
mkdirSync('/opt/cursor/artifacts', { recursive: true });
writeFileSync('/opt/cursor/artifacts/scheduling-v37-load-before-after-238.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  courses: fixture.meta.courses,
  planningRows: fixture.meta.planningRows,
  routeFillers: fillers.length,
  before: report.beforeSkipSoftOpt,
  after: report.afterSoftOpt,
  deltas: report.deltasSkipToSoft,
  gates: report.gates,
  protectedCount: report.protectedAnchors.count,
  scopedDecisions: report.scopedSample.decisions.length
}, null, 2));
