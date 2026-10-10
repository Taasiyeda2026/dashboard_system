#!/usr/bin/env node
// Isolated OR-Tools PoC helper: dump legal complete-course candidates using the
// same hard-constraint helpers as the live v37 planner. Does not mutate planner
// behavior, production data, or saved workspaces.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decisionInput } from '../acceptance/new-engine-input.mjs';
import { createRouteClient } from '../../frontend/src/screens/course-scheduling-travel.js';
import { resolveCourseSchedulingPeriod } from '../../frontend/src/screens/course-scheduling-periods.js';
import { classifyMeetingAvailabilityBlocks } from '../../frontend/src/screens/course-scheduling-date-adjustments.js';
import { isFullDaySchedulingActivity, schedulingActivityTypeCategory, isSchedulingActivityActive } from '../../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { normalizeOperationalDistrict } from '../../frontend/src/screens/shared/district-normalization.js';
import {
  inferPlanningCourseSpec,
  planningCatalogIndex,
} from '../../frontend/src/screens/course-scheduling-planning.js';
import {
  compileConstraints, createOccupancy, candidateFailures, staticFailures, meetingFailures, knownRoute,
  ensureRoute, ensureCandidateRoutes, officialMeetings, isProtectedActivity, activeInstructor,
  ENGINE_VERSION, text, activityId, minute, weekday, addDays, transitionFailure,
} from '../../frontend/src/screens/scheduling-core/constraints.js';

const outDir = process.env.ORTOOLS_OUT || process.env.ACCEPTANCE_OUT;
if (!outDir) throw Error('ORTOOLS_OUT or ACCEPTANCE_OUT required');
await mkdir(outDir, { recursive: true });

const stamp = value => {
  const seconds = Math.round(value * 60);
  const result = `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
  return seconds % 60 ? `${result}:${String(seconds % 60).padStart(2, '0')}` : result;
};

function courseSpec(a, input, previousRow = null) {
  if (input.courseSpecs?.[activityId(a)]?.complete) return input.courseSpecs[activityId(a)];
  const inferred = input.courseSpecs?.[activityId(a)] || inferPlanningCourseSpec(a, input.catalogIndex || input.catalog || []);
  if (inferred?.complete) return inferred;
  // Fixture-saved proposal meetings already encode session count + duration used by
  // the live planner's schedules() previous-meeting yield. Recover that structure
  // without inventing a new duration policy.
  const prior = previousRow?.meetings || [];
  if (prior.length) {
    const durationMinutes = minute(prior[0].end_time) - minute(prior[0].start_time);
    if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
      return {
        sessions: Math.min(35, prior.length),
        durationMinutes: Math.max(30, Math.round(durationMinutes / 15) * 15),
        complete: true,
        recoveredFromPreviousMeetings: true,
      };
    }
  }
  return inferred || { sessions: 0, durationMinutes: null, complete: false };
}

function* schedules(context, a, empId, spec, input, previous, occupancy) {
  const official = officialMeetings(a);
  if (official.length) { yield official; return; }
  const period = resolveCourseSchedulingPeriod(input.periodKey || 'first');
  const year = resolveCourseSchedulingPeriod('year');
  const start = [period.start, input.today || period.start, '2026-10-12', text(a.start_date).slice(0, 10)].sort().at(-1);
  const end = period.key === 'first' ? '2027-02-28' : year.end;
  if (previous?.meetings?.length && previous.meetings[0].date >= start) {
    yield previous.meetings;
    if (previous.instructorEmpId === empId) {
      const blocks = classifyMeetingAvailabilityBlocks({
        meetings: previous.meetings,
        rules: input.rules?.[empId] || [],
        exceptions: input.exceptions?.[empId] || [],
      });
      if (blocks.instructorExceptionCount > 0 && blocks.recoverable) {
        const shifted = [];
        let nextAllowed = previous.meetings[0].date;
        let changed = false;
        for (const m of previous.meetings) {
          let date = m.date < nextAllowed ? nextAllowed : m.date;
          while (date <= end && meetingFailures(context, a, empId, { ...m, date }).length) date = addDays(date, 7);
          if (date > end) { shifted.length = 0; break; }
          changed ||= date !== m.date;
          shifted.push({ ...m, date });
          nextAllowed = addDays(date, 7);
        }
        if (changed && shifted.length === spec.sessions && (!a.start_date || shifted[0].date === text(a.start_date).slice(0, 10))) yield shifted;
      }
    }
  }
  for (let date = start; date <= (a.start_date ? text(a.start_date).slice(0, 10) : period.end); date = addDays(date, 1)) {
    const day = weekday(date);
    const dayRules = context.exceptions.get(empId)?.get(date) || context.rules.get(empId)?.get(day) || [];
    if (day === 5 && context.profiles[empId]?.friday_allowed !== true) continue;
    if (day === 6 && !['arab', 'druze'].includes(a.calendar_sector)) continue;
    for (const rule of dayRules.filter(r => r.available === true)) {
      const from = a.start_time ? minute(a.start_time) : a.end_time ? minute(a.end_time) - spec.durationMinutes : Math.ceil(minute(rule.start_time) / 15) * 15;
      const to = a.start_time || a.end_time ? from : minute(rule.end_time) - spec.durationMinutes;
      const nearby = (occupancy?.days.get(`${empId}|${date}`) || []).filter(m => m.courseId !== activityId(a));
      const adjacency = nearby.flatMap(m => {
        const route = m.schoolId === text(a.school_id) ? { distance_km: 0, duration_minutes: 0 } : knownRoute(context, a.school_address, m.address);
        if (!route) return [];
        const buffer = m.schoolId === text(a.school_id) ? 0 : (+route.distance_km <= 5 ? 5 : 15);
        return [
          Math.floor((m.start - spec.durationMinutes - (+route.duration_minutes) - buffer) / 30) * 30,
          Math.ceil((m.end + (+route.duration_minutes) + buffer) / 30) * 30,
        ];
      });
      const times = [...new Set([
        ...adjacency.filter(t => t >= from && t <= to),
        ...Array.from({
          length: Number.isFinite(from) && Number.isFinite(to) && to >= from ? Math.floor((to - from) / 30) + 1 : 0,
        }, (_, i) => from + i * 30),
      ])];
      for (const time of times) {
        const meetings = [];
        let next = date;
        while (meetings.length < spec.sessions && next <= end) {
          const meeting = { date: next, meeting_no: meetings.length + 1, start_time: stamp(time), end_time: stamp(time + spec.durationMinutes) };
          if (!meetingFailures(context, a, empId, meeting).length) meetings.push(meeting);
          next = addDays(next, 7);
        }
        if (meetings.length === spec.sessions && (!a.start_date || meetings[0].date === text(a.start_date).slice(0, 10))) yield meetings;
      }
    }
  }
}

function planningTargets(input) {
  const period = resolveCourseSchedulingPeriod(input.periodKey || 'year');
  const district = normalizeOperationalDistrict(input.district);
  return (input.activities || [])
    .filter(a => isSchedulingActivityActive(a) && schedulingActivityTypeCategory(a.activity_type || a.type))
    .filter(a => !district || normalizeOperationalDistrict(a.district || a.school_district || a.authority_district) === district)
    .filter(a => {
      const first = officialMeetings(a)[0]?.date;
      return first ? first >= period.start && first <= period.end : period.key !== 'second';
    });
}

function teachingHours(meetings) {
  return meetings.reduce((sum, m) => sum + Math.max(0, minute(m.end_time) - minute(m.start_time)) / 60, 0);
}

function candidatesConflict(context, leftActivity, left, rightActivity, right) {
  if (left.instructorEmpId !== right.instructorEmpId) return false;
  // Fast same-instructor conflict using the same overlap/transition predicates as
  // candidateFailures, without rebuilding occupancy for every pair.
  const leftItems = left.meetings.map(m => ({
    date: m.date,
    start: minute(m.start_time),
    end: minute(m.end_time),
    address: leftActivity.school_address,
    schoolId: text(leftActivity.school_id),
    fullDay: isFullDaySchedulingActivity(leftActivity),
  }));
  const rightItems = right.meetings.map(m => ({
    date: m.date,
    start: minute(m.start_time),
    end: minute(m.end_time),
    address: rightActivity.school_address,
    schoolId: text(rightActivity.school_id),
    fullDay: isFullDaySchedulingActivity(rightActivity),
  }));
  const byDate = new Map();
  for (const item of [...leftItems.map(i => ({ ...i, side: 'L' })), ...rightItems.map(i => ({ ...i, side: 'R' }))]) {
    if (!byDate.has(item.date)) byDate.set(item.date, []);
    byDate.get(item.date).push(item);
  }
  for (const list of byDate.values()) {
    list.sort((a, b) => a.start - b.start || a.side.localeCompare(b.side));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.side === b.side) continue;
        if (a.fullDay || b.fullDay || (a.start < b.end && a.end > b.start)) return true;
        const first = a.end <= b.start ? a : b;
        const second = a.end <= b.start ? b : a;
        if (transitionFailure(context, first, second)) return true;
      }
    }
  }
  return false;
}

const started = performance.now();
const { input, routes } = await decisionInput(process.env.DECISION_DIR);
input.routeClient = createRouteClient({
  preloadedRows: routes,
  invoke: async () => ({ data: { calculated: false }, error: null }),
});
input.periodKey = input.periodKey || 'year';
input.planningProfile = process.env.ORTOOLS_PROFILE || input.planningProfile || 'fast';
input.catalogIndex = planningCatalogIndex(input.catalog || []);
input.courseSpecs = Object.fromEntries(
  (input.activities || []).map(a => [activityId(a), inferPlanningCourseSpec(a, input.catalogIndex)]),
);
const limit = Number(process.env.ORTOOLS_CANDIDATE_BUDGET || (input.planningProfile === 'fast' ? 96 : 384));

const context = compileConstraints(input);
const targets = planningTargets(input);
const previous = new Map((input.existingRows || []).map(r => [r.courseId, r]));
const protectedRows = [];
const openActivities = [];
const blockers = [];

for (const a of targets) {
  const id = activityId(a);
  if (isProtectedActivity(a)) {
    const meetings = officialMeetings(a);
    protectedRows.push({
      courseId: id,
      kind: 'live',
      instructorEmpId: text(a.emp_id || a.emp_id_2),
      meetings,
      teachingHours: teachingHours(meetings),
      district: normalizeOperationalDistrict(a.district || a.school_district || a.authority_district),
    });
    continue;
  }
  openActivities.push(a);
}

const anchors = protectedRows.map(r => ({
  courseId: r.courseId,
  instructorEmpId: r.instructorEmpId,
  meetings: r.meetings,
  kind: 'live',
}));
const protectedOccupancy = createOccupancy(context, anchors);

const candidates = [];
const courseDiagnostics = [];
let routeMisses = 0;

for (const a of openActivities) {
  const id = activityId(a);
  const spec = courseSpec(a, input, previous.get(id));
  const failures = new Set();
  const options = [];
  let incomplete = false;
  const missingData = staticFailures(context, a, '').filter(r => ['missing_school_data', 'missing_language'].includes(r));
  if (missingData.length) {
    blockers.push({ courseId: id, fields: missingData, missingFields: missingData });
    courseDiagnostics.push({ courseId: id, options: 0, failures: missingData, missing: true });
    continue;
  }
  if (officialMeetings(a).some(m => !Number.isFinite(minute(m.start_time)) || !Number.isFinite(minute(m.end_time)) || minute(m.end_time) <= minute(m.start_time))) {
    courseDiagnostics.push({ courseId: id, options: 0, failures: ['source_time_conflict'], missing: true });
    continue;
  }
  if (officialMeetings(a).some(m => meetingFailures(context, a, '', m).some(reason => ['calendar_block', 'calendar_end_time', 'saturday_sector'].includes(reason)))) {
    courseDiagnostics.push({ courseId: id, options: 0, failures: ['source_date_conflict'], missing: true });
    continue;
  }
  if (a.start_time && a.end_time && minute(a.end_time) - minute(a.start_time) !== spec.durationMinutes && !officialMeetings(a).length) {
    courseDiagnostics.push({ courseId: id, options: 0, failures: ['source_duration_conflict'], missing: true });
    continue;
  }
  if (!spec.complete) {
    blockers.push({
      courseId: id,
      fields: ['sessions_or_duration'],
      missingFields: {
        sessions: a.sessions ?? null,
        start_time: a.start_time ?? null,
        end_time: a.end_time ?? null,
        activity_no: a.activity_no ?? null,
        activity_name: a.activity_name ?? null,
        previousMeetings: previous.get(id)?.meetings?.length || 0,
      },
    });
    courseDiagnostics.push({ courseId: id, options: 0, failures: ['missing_course_spec'], missing: true });
    continue;
  }

  const instructors = [...context.byInstructor]
    .filter(([, instructor]) => activeInstructor(instructor))
    .sort(([leftId, left], [rightId, right]) => {
      const leftRoute = knownRoute(context, left.address, a.school_address);
      const rightRoute = knownRoute(context, right.address, a.school_address);
      const leftDistance = leftRoute ? Number(leftRoute.distance_km) : Infinity;
      const rightDistance = rightRoute ? Number(rightRoute.distance_km) : Infinity;
      return leftDistance - rightDistance || leftId.localeCompare(rightId);
    });

  for (const [empId, instructor] of instructors) {
    const nonRouteFailures = staticFailures(context, a, empId).filter(r => r !== 'home_route_unknown');
    if (nonRouteFailures.length) { nonRouteFailures.forEach(r => failures.add(r)); continue; }
    if (!knownRoute(context, instructor.address, a.school_address)) {
      await ensureRoute(context, instructor.address, a.school_address);
      if (!knownRoute(context, instructor.address, a.school_address)) routeMisses++;
    }
    const rejected = staticFailures(context, a, empId);
    if (rejected.length) { rejected.forEach(r => failures.add(r)); continue; }
    let attempted = 0;
    for (const meetings of schedules(context, a, empId, spec, input, previous.get(id), protectedOccupancy)) {
      if (++attempted > limit) { incomplete = true; break; }
      if (!officialMeetings(a).length && meetings.length !== spec.sessions) continue;
      const option = {
        instructorEmpId: empId,
        meetings,
        startDate: meetings[0].date,
        endDate: meetings.at(-1).date,
        startTime: meetings[0].start_time,
        endTime: meetings[0].end_time,
      };
      await ensureCandidateRoutes(context, protectedOccupancy, a, option);
      const issues = candidateFailures(context, protectedOccupancy, a, option);
      if (issues.length) { issues.forEach(f => failures.add(f.reason)); continue; }
      const home = knownRoute(context, instructor.address, a.school_address);
      options.push({
        instructorEmpId: empId,
        meetings,
        teachingHours: teachingHours(meetings),
        homeKm: home ? +home.distance_km : null,
        homeMinutes: home ? +home.duration_minutes : null,
      });
    }
  }

  // Deterministic option order for reproducible packing indices.
  options.sort((x, y) =>
    x.instructorEmpId.localeCompare(y.instructorEmpId)
    || x.meetings[0].date.localeCompare(y.meetings[0].date)
    || x.meetings[0].start_time.localeCompare(y.meetings[0].start_time)
    || JSON.stringify(x.meetings).localeCompare(JSON.stringify(y.meetings)));

  for (const option of options) {
    candidates.push({
      id: candidates.length,
      courseId: id,
      instructorEmpId: option.instructorEmpId,
      meetings: option.meetings,
      teachingHours: option.teachingHours,
      homeKm: option.homeKm,
      homeMinutes: option.homeMinutes,
      officialDates: officialMeetings(a).length > 0,
    });
  }
  courseDiagnostics.push({
    courseId: id,
    options: options.length,
    incomplete,
    failures: [...failures],
    missing: options.length === 0 && (failures.has('missing_school_data') || failures.has('missing_course_spec') || failures.has('missing_language') || failures.has('home_route_unknown')),
  });
}

// Pairwise conflicts among open candidates that share an instructor.
const byInstructor = new Map();
for (const c of candidates) {
  if (!byInstructor.has(c.instructorEmpId)) byInstructor.set(c.instructorEmpId, []);
  byInstructor.get(c.instructorEmpId).push(c);
}
const conflictPairs = [];
const activityById = new Map(openActivities.map(a => [activityId(a), a]));
for (const [, group] of byInstructor) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const left = group[i];
      const right = group[j];
      if (left.courseId === right.courseId) {
        conflictPairs.push([left.id, right.id]);
        continue;
      }
      if (candidatesConflict(context, activityById.get(left.courseId), left, activityById.get(right.courseId), right)) {
        conflictPairs.push([left.id, right.id]);
      }
    }
  }
}

const model = {
  engineVersion: ENGINE_VERSION,
  source: 'scripts/ortools-poc/export-model.mjs',
  fixturePolicy: 'DECISION_CANONICAL=1 anonymous fixtures; no production writes',
  planningProfile: input.planningProfile,
  candidateBudgetPerInstructor: limit,
  exportElapsedMs: performance.now() - started,
  routeMisses,
  targets: targets.length,
  protectedRows,
  openCourseIds: openActivities.map(activityId),
  candidates,
  conflictPairs,
  courseDiagnostics,
  blockers,
  inputFingerprint: createHash('sha256').update(JSON.stringify({
    activityIds: targets.map(activityId).sort(),
    instructorIds: [...context.byInstructor.keys()].sort(),
    protected: protectedRows.map(r => [r.courseId, r.instructorEmpId]),
  })).digest('hex'),
};

await writeFile(`${outDir}/ortools-model.json`, JSON.stringify(model));
const summary = {
  exportElapsedMs: model.exportElapsedMs,
  targets: model.targets,
  protected: protectedRows.length,
  openCourses: openActivities.length,
  candidates: candidates.length,
  conflictPairs: conflictPairs.length,
  coursesWithZeroOptions: courseDiagnostics.filter(d => d.options === 0).length,
  blockers: blockers.length,
  routeMisses,
  inputFingerprint: model.inputFingerprint,
};
await writeFile(`${outDir}/ortools-model-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
