// Final acceptance harness for Stage C.
// - Verified travel cache only (no dummy fillers)
// - Optional ENGINE_ROOT to compare main vs PR
// - No production writes / network route calculation
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRouteClient } from '../../frontend/src/screens/course-scheduling-travel.js';
import { compileConstraints, isProtectedActivity, officialMeetings } from '../../frontend/src/screens/scheduling-core/constraints.js';

const root = process.env.SNAPSHOT_DIR || '/tmp/scheduling-238-snapshot';
const outDir = process.env.OUT_DIR || `${root}/final-acceptance`;
const engineRoot = resolve(process.env.ENGINE_ROOT || '.');
const label = process.env.RUN_LABEL || 'pr';
const allowFillers = process.env.ALLOW_ROUTE_FILLERS === '1';
mkdirSync(outDir, { recursive: true });

const { buildDynamicCoursePlan } = await import(pathToFileURL(resolve(engineRoot, 'frontend/src/screens/course-scheduling-planning.js')).href);
// Always measure with the PR quality module so schoolActiveDays / instructorWorkDays
// are defined identically for main vs PR plan rows.
const { operationalQuality } = await import(pathToFileURL(resolve('/workspace/frontend/src/screens/scheduling-core/quality.js')).href);

const fixture = JSON.parse(readFileSync(`${root}/fixture.json`, 'utf8'));
const normalize = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const homes = new Map(fixture.instructors.map((i) => [String(i.emp_id), i.address]));
const schoolById = new Map(fixture.schools.map((s) => [String(s.id), s.institution_address]));
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
  const school = activity?.school_address || '';
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
const missingPairs = [...needed].filter((key) => !have.has(key)).map((key) => {
  const [origin_key, destination_key] = key.split('\0');
  return { origin_key, destination_key };
});
const fillers = allowFillers
  ? missingPairs.map((p) => ({ ...p, distance_km: 8, duration_minutes: 15 }))
  : [];

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
  waitingMinutes: q.waitingMinutes,
  totalTravelMinutes: q.totalTravelMinutes,
  totalTravelKm: q.totalTravelKm,
  unknownRouteLegs: q.unknownRouteLegs,
  ...extra
});

const projection = (row) => ({
  courseId: row.courseId,
  kind: row.kind,
  instructorEmpId: String(row.instructorEmpId || ''),
  meetings: (row.meetings || []).map((m) => ({
    date: m.date,
    start_time: String(m.start_time || '').slice(0, 5),
    end_time: String(m.end_time || '').slice(0, 5)
  }))
});

const context = compileConstraints(baseInput);
const protectedIds = new Set(
  fixture.existingRows
    .filter((row) => {
      const activity = fixture.activities.find((a) => String(a.row_id) === String(row.courseId));
      return row.kind === 'live' || row.planningLocked || row.kind === 'planning-locked' || (activity && isProtectedActivity(activity));
    })
    .map((r) => r.courseId)
);

const run = async (soft) => {
  const started = performance.now();
  try {
    const plan = await buildDynamicCoursePlan({ ...baseInput, skipSoftOptimization: !soft });
    const elapsedMs = performance.now() - started;
    const measured = operationalQuality(plan.rows, baseInput, context);
    const coveredIds = new Set(plan.rows.filter((r) => r.instructorEmpId).map((r) => r.courseId));
    const beforeCovered = new Set(fixture.existingRows.filter((r) => r.instructorEmpId).map((r) => r.courseId));
    const newlyCovered = [...coveredIds].filter((id) => !beforeCovered.has(id)).sort();
    const lost = [...beforeCovered].filter((id) => !coveredIds.has(id)).sort();
    const assignment = Object.fromEntries(
      plan.rows
        .filter((r) => r.instructorEmpId && ['proposal', 'fixed-proposal'].includes(r.kind))
        .map((r) => [r.courseId, { instructorEmpId: String(r.instructorEmpId), meetings: projection(r).meetings }])
    );
    const protectedAfter = plan.rows.filter((r) => protectedIds.has(r.courseId)).map(projection);
    const protectedBefore = fixture.existingRows.filter((r) => protectedIds.has(r.courseId)).map(projection);
    const protectedInstructorChanges = protectedBefore.filter((b) => {
      const a = protectedAfter.find((x) => x.courseId === b.courseId);
      return !a || a.instructorEmpId !== b.instructorEmpId;
    });
    const liveDateSync = protectedBefore
      .filter((b) => {
        const a = protectedAfter.find((x) => x.courseId === b.courseId);
        return a && a.instructorEmpId === b.instructorEmpId && JSON.stringify(a.meetings) !== JSON.stringify(b.meetings);
      })
      .map((b) => {
        const a = protectedAfter.find((x) => x.courseId === b.courseId);
        const activity = fixture.activities.find((x) => String(x.row_id) === String(b.courseId));
        const official = officialMeetings(activity).map((m) => ({
          date: m.date,
          start_time: String(m.start_time || '').slice(0, 5),
          end_time: String(m.end_time || '').slice(0, 5)
        }));
        return {
          courseId: b.courseId,
          instructorEmpId: b.instructorEmpId,
          matchesOfficial: JSON.stringify(a.meetings) === JSON.stringify(official),
          savedMeetings: b.meetings,
          resultMeetings: a.meetings,
          officialMeetings: official
        };
      });
    return {
      ok: true,
      elapsedMs,
      quality: pick(measured, {
        planned: plan.planned,
        valid: plan.finalPlanValidation?.valid,
        constraintFailures: plan.finalPlanValidation?.failures?.length || 0,
        failureReasons: [...new Set((plan.finalPlanValidation?.failures || []).map((f) => f.reason))],
        optimizationMs: plan.newEngineMetrics?.optimizationMs,
        stopReason: plan.optimization?.stopReason,
        scope: plan.optimization?.scope,
        decisionCount: plan.optimization?.decisions?.length || 0
      }),
      newlyCovered,
      lostCoverage: lost,
      assignmentFingerprint: Object.fromEntries(
        Object.entries(assignment).map(([id, v]) => [id, `${v.instructorEmpId}|${v.meetings.map((m) => m.date).join(',')}`])
      ),
      protectedInstructorChanges,
      liveDateSync,
      decisionsTouchingProtected: (plan.optimization?.decisions || []).filter((d) => protectedIds.has(d.courseId)),
      unknownRouteLegs: measured.unknownRouteLegs
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: performance.now() - started,
      error: { code: error.code || error.message, failures: (error.failures || []).slice(0, 40), failureCount: (error.failures || []).length,
        reasons: [...new Set((error.failures || []).map((f) => f.reason))],
        courseIds: [...new Set((error.failures || []).map((f) => f.courseId))].slice(0, 40) }
    };
  }
};

const verifiedSoft = await run(true);
const verifiedSkip = allowFillers ? null : await run(false);

const report = {
  meta: {
    label,
    engineRoot,
    allowFillers,
    missingVerifiedPairs: missingPairs.length,
    missingPairsSample: missingPairs.slice(0, 20),
    productionWrites: 0,
    generatedAt: new Date().toISOString()
  },
  verifiedRoutesOnly: {
    softOpt: verifiedSoft,
    skipSoft: verifiedSkip
  }
};

writeFileSync(`${outDir}/${label}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  label,
  allowFillers,
  missingVerifiedPairs: missingPairs.length,
  softOk: verifiedSoft.ok,
  soft: verifiedSoft.ok ? {
    covered: verifiedSoft.quality.covered,
    schoolActiveDays: verifiedSoft.quality.schoolActiveDays,
    instructorWorkDays: verifiedSoft.quality.instructorWorkDays,
    waitingMinutes: verifiedSoft.quality.waitingMinutes,
    totalTravelMinutes: verifiedSoft.quality.totalTravelMinutes,
    totalTravelKm: verifiedSoft.quality.totalTravelKm,
    unknownRouteLegs: verifiedSoft.quality.unknownRouteLegs,
    valid: verifiedSoft.quality.valid,
    constraintFailures: verifiedSoft.quality.constraintFailures,
    elapsedMs: verifiedSoft.elapsedMs,
    newlyCovered: verifiedSoft.newlyCovered,
    protectedInstructorChanges: verifiedSoft.protectedInstructorChanges.length,
    liveDateSync: verifiedSoft.liveDateSync.map((x) => ({ courseId: x.courseId, matchesOfficial: x.matchesOfficial })),
    decisionsTouchingProtected: verifiedSoft.decisionsTouchingProtected.length
  } : verifiedSoft.error
}, null, 2));
