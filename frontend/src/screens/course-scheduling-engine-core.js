import { evaluateInstructor, adjacentActivities, isAuthorityBlocked, BLOCKED_AUTHORITY_MESSAGE, BLOCKED_AUTHORITY_CODE } from './instructor-matching-engine.js';
import { activityMeetings, isoWeekKey } from './instructor-scheduling-load.js';
import { routeMatrixKey } from './course-scheduling-travel.js';
import {
  hasDraftInstructor,
  isActivitySchedulingEligible,
  isSchedulingReadyActivity,
  isSchedulingReadyInstructor,
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment
} from './shared/activity-scheduling-eligibility.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, FIRST_HALF_CONTINUATION_END_DATE, isDateInCourseSchedulingPeriod, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import {
  effectiveEndTime,
  proposeDateAdjustments,
  buildExceptionRecoveryPlan,
  classifyMeetingAvailabilityBlocks,
  MAX_RECOVERABLE_EXCEPTION_MEETINGS
} from './course-scheduling-date-adjustments.js';
import {
  courseUrgency,
  compareCandidatesStable
} from './course-scheduling-score.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { filterSchoolCalendarRowsBySector, normalizeCalendarSector } from './shared/school-calendar-logic.js';
import { planningPerfCount, planningPerfTimer } from './course-scheduling-perf.js';

export { courseUrgency };

const text = (value) => String(value ?? '').trim();
const minutes = (value) => {
  const [hours, mins] = text(value).split(':').map(Number);
  return hours * 60 + mins;
};
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (row) => text(row?.emp_id);
const placeOf = (row = {}) => text(row.school_address);
const districtOf = (row = {}) => normalizeOperationalDistrict(row.district || row.school_district || row.authority_district);

export function schedulingCourses(rows = [], options = {}) {
  const periodKey = options.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const authority = text(options.authority);
  const district = text(options.district);
  const allDistricts = options.allDistricts === true;
  const includeIncompleteWithoutPeriodMeetings = !!options.includeIncompleteWithoutPeriodMeetings;
  return rows.filter((row) => (
    includeIncompleteWithoutPeriodMeetings
      ? isActivitySchedulingEligible(row)
      : isSchedulingReadyActivity(row)
  ))
    .filter((row) => !hasDraftInstructor(row))
    .filter((row) => !authority || text(row.authority) === authority)
    .filter((row) => {
      const rowDistrict = districtOf(row);
      if (district) return rowDistrict === district;
      if (allDistricts) return !!rowDistrict;
      return true;
    })
    .filter((row) => {
      const meetings = activityMeetings(row);
      if (meetings.some((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey))) return true;
      if (includeIncompleteWithoutPeriodMeetings && !meetings.length) return true;
      return false;
    });
}

export function schedulingInstructors(rows = [], profiles = {}, rules = {}) {
  return rows.filter((row) => isSchedulingReadyInstructor(
    row,
    profiles[text(row?.emp_id)] || null,
    rules[text(row?.emp_id)] || []
  ));
}

export function missingCourseInformation(activity, options = {}) {
  const missing = [];
  if (!text(activity?.school_id)) missing.push('שיוך בית ספר');
  if (!text(activity?.school)) missing.push('בית ספר');
  if (!text(activity?.school_address)) missing.push('כתובת בית הספר');
  if (!text(activity?.calendar_sector)) missing.push('מגזר בית הספר');
  const periodKey = options.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const meetings = activityMeetings(activity).filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey));
  if (!meetings.length) missing.push('תאריכי מפגשים');
  if (!meetings.length || meetings.some((meeting) => !text(meeting.start_time || activity?.start_time) || !text(meeting.end_time || activity?.end_time))) missing.push('שעות');
  if (!text(activity?.instruction_language)) missing.push('שפת הדרכה');
  return [...new Set(missing)];
}

function meetingHours(meeting, activity = {}) {
  const start = minutes(meeting.start_time || activity.start_time);
  const end = minutes(meeting.end_time || activity.end_time);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0;
}

export function availabilityHours(profile = {}, rules = []) {
  void profile;
  const availableRules = rules.filter((rule) => rule.available);
  if (!availableRules.length) return 0;
  return availableRules.reduce((sum, rule) => sum + Math.max(0, minutes(rule.end_time) - minutes(rule.start_time)) / 60, 0);
}

export function instructorLoad(assignments = [], profile = {}, rules = [], options = {}) {
  const periodKey = options.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const weekHours = new Map();
  const weekDays = new Map();
  let hours = 0;
  let meetings = 0;
  const workDates = new Set();

  for (const activity of assignments) {
    const source = activity?.draft_emp_id && Array.isArray(activity.draft_proposed_meetings)
      ? { ...activity, meetings: activity.draft_proposed_meetings }
      : activity;
    for (const meeting of activityMeetings(source).filter((item) => isDateInCourseSchedulingPeriod(item.date, periodKey))) {
      const duration = meetingHours(meeting, source);
      const week = isoWeekKey(meeting.date);
      hours += duration;
      meetings += 1;
      workDates.add(text(meeting.date).slice(0, 10));
      if (week) {
        weekHours.set(week, (weekHours.get(week) || 0) + duration);
        const weekday = new Date(`${meeting.date}T12:00:00`).getDay();
        if (!weekDays.has(week)) weekDays.set(week, new Set());
        weekDays.get(week).add(weekday);
      }
    }
  }

  const capacity = availabilityHours(profile, rules);
  const ratios = capacity > 0 ? [...weekHours.values()].map((value) => value / capacity) : [];
  const maxRatio = capacity > 0 ? Math.max(0, ...ratios) : Number.POSITIVE_INFINITY;
  const averageRatio = ratios.length ? ratios.reduce((sum, value) => sum + value, 0) / ratios.length : 0;
  const maxWeekDayCount = weekDays.size ? Math.max(0, ...[...weekDays.values()].map((set) => set.size)) : 0;

  return {
    hours,
    meetings,
    workDays: workDates.size,
    workDates,
    maxWeekDayCount,
    courseCount: assignments.length,
    availabilityHours: capacity,
    weekHours: Object.fromEntries(weekHours),
    maxRatio,
    averageRatio,
    ratio: maxRatio
  };
}

function meetingAssignments(rows = [], options = {}) {
  const periodKey = options.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const schoolCalendar = options.schoolCalendar || [];
  return rows.flatMap((activity) => {
    const activityCalendar = filterSchoolCalendarRowsBySector(schoolCalendar, activity?.calendar_sector);
    return activityMeetings(activity?.draft_emp_id && Array.isArray(activity.draft_proposed_meetings)
      ? { ...activity, meetings: activity.draft_proposed_meetings }
      : activity)
      .filter((meeting) => options.allDates || isDateInCourseSchedulingPeriod(meeting.date, periodKey))
      .map((meeting) => ({
        ...meeting,
        end_time: effectiveEndTime(text(meeting.date).slice(0, 10), meeting.end_time || activity.end_time, activityCalendar),
        activity_id: idOf(activity),
        school: activity.school,
        school_id: activity.school_id,
        authority: activity.authority,
        school_address: activity.school_address,
        activity_name: activity.activity_name
      }));
  });
}

function assignedRowsByInstructor(rows = [], supplied = {}) {
  const assigned = {};
  const add = (empId, row) => {
    if (!empId || !row) return;
    const list = assigned[empId] ||= [];
    const rowId = idOf(row);
    if (!list.some((existing) => idOf(existing) === rowId)) list.push(row);
  };

  for (const [empId, values] of Object.entries(supplied || {})) {
    for (const row of values || []) add(text(empId), row);
  }
  for (const row of rows.filter(isSchedulingBlockingAssignment)) {
    add(text(row.emp_id), row);
    add(text(row.emp_id_2), row);
  }
  for (const row of rows.filter(isSchedulingDraftAssignment)) {
    add(text(row.draft_emp_id), row);
  }
  return assigned;
}


function preparedContextVersion(activities = [], instructors = [], periodKey = '') {
  let latestActivityVersion = '';
  for (const activity of activities || []) {
    const version = text(activity?.updated_at || activity?.updatedAt);
    if (version > latestActivityVersion) latestActivityVersion = version;
  }
  return `${text(periodKey)}|a:${activities.length}|i:${instructors.length}|u:${latestActivityVersion}`;
}

function rebuildPreparedInstructorContext(context, empId) {
  const id = text(empId);
  if (!id || !context) return;
  const rows = [...(context.assignedRows?.[id] || [])];
  const profile = context.profiles?.[id];
  const instructorRules = context.rules?.[id] || [];
  const periodMeetings = meetingAssignments(rows, {
    periodKey: context.periodKey,
    schoolCalendar: context.schoolCalendar || []
  });
  const allMeetings = meetingAssignments(rows, {
    periodKey: context.periodKey,
    allDates: true,
    schoolCalendar: context.schoolCalendar || []
  });
  const baselineLoad = instructorLoad(rows, profile, instructorRules, { periodKey: context.periodKey });
  context.instructorContext.set(id, {
    persistedRows: rows,
    baselineLoad,
    periodMeetings,
    allMeetings
  });
  context.assignedMeetingsByInstructor[id] = allMeetings;

  const previousKeys = context.activityDateKeysByInstructor.get(id) || [];
  for (const key of previousKeys) context.activitiesByInstructorAndDate.delete(key);
  const nextKeys = [];
  for (const meeting of allMeetings) {
    const date = text(meeting?.date).slice(0, 10);
    if (!date) continue;
    const key = `${id}|${date}`;
    const bucket = context.activitiesByInstructorAndDate.get(key) || [];
    bucket.push(meeting);
    context.activitiesByInstructorAndDate.set(key, bucket);
    nextKeys.push(key);
  }
  context.activityDateKeysByInstructor.set(id, [...new Set(nextKeys)]);
}

export function prepareSchedulingRunContext(input = {}) {
  planningPerfCount('contextRebuilds');
  const activities = input.activities || [];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const profiles = input.profiles || {};
  const rules = input.rules || {};
  const exceptions = input.exceptions || {};
  const schoolCalendar = input.schoolCalendar || [];
  const instructors = schedulingInstructors(input.instructors || [], profiles, rules);
  const assignedRows = assignedRowsByInstructor(activities, input.assignments || {});
  const instructorById = new Map(instructors.map((row) => [text(row?.emp_id), row]));
  const profileByInstructor = new Map(Object.entries(profiles || {}).map(([id, value]) => [text(id), value]));
  const rulesByInstructor = new Map(Object.entries(rules || {}).map(([id, value]) => [text(id), value || []]));
  const exceptionsByInstructor = new Map(Object.entries(exceptions || {}).map(([id, value]) => [text(id), value || []]));
  const schoolCalendarBySector = new Map();
  const sectors = new Set(['general', ...(activities || []).map((row) => normalizeCalendarSector(row?.calendar_sector) || 'general')]);
  for (const sector of sectors) {
    schoolCalendarBySector.set(sector, filterSchoolCalendarRowsBySector(schoolCalendar, sector));
  }

  const context = {
    activities,
    periodKey,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    instructors,
    instructorById,
    profileByInstructor,
    rulesByInstructor,
    exceptionsByInstructor,
    assignedRows,
    instructorContext: new Map(),
    assignedMeetingsByInstructor: {},
    activitiesByInstructorAndDate: new Map(),
    activityDateKeysByInstructor: new Map(),
    schoolCalendarBySector,
    travelCacheMap: input.travelCacheMap instanceof Map ? input.travelCacheMap : new Map(),
    candidateEvaluationCache: new Map(),
    contextRevision: 0,
    contextVersion: text(input.contextVersion) || preparedContextVersion(activities, instructors, periodKey)
  };
  for (const instructor of instructors) rebuildPreparedInstructorContext(context, instructor?.emp_id);
  return context;
}

export function appendSchedulingRunActivity(context, activity = {}) {
  if (!context || !activity) return context;
  const affected = new Set();
  const add = (empId) => {
    const id = text(empId);
    if (!id) return;
    const list = context.assignedRows[id] ||= [];
    const rowId = idOf(activity);
    if (!list.some((row) => idOf(row) === rowId)) list.push(activity);
    affected.add(id);
  };
  if (isSchedulingBlockingAssignment(activity)) {
    add(activity.emp_id);
    add(activity.emp_id_2);
  }
  if (isSchedulingDraftAssignment(activity)) add(activity.draft_emp_id);
  if (!affected.size) return context;

  context.contextRevision = (Number(context.contextRevision) || 0) + 1;
  context.contextVersion = `${context.contextVersion.split('|r:')[0]}|r:${context.contextRevision}`;
  for (const empId of affected) rebuildPreparedInstructorContext(context, empId);
  return context;
}

function sameSchool(first = {}, second = {}) {
  const firstId = text(first.school_id);
  const secondId = text(second.school_id);
  return !!(firstId && secondId && firstId === secondId);
}

function routeLeg(routeMatrix = {}, origin, destination, sameLocation = false) {
  if (sameLocation || (text(origin) && text(origin).toLocaleLowerCase('he-IL') === text(destination).toLocaleLowerCase('he-IL'))) {
    return { distance_km: 0, duration_minutes: 0 };
  }
  return Object.prototype.hasOwnProperty.call(routeMatrix, routeMatrixKey(origin, destination))
    ? routeMatrix[routeMatrixKey(origin, destination)]
    : null;
}

function travelUnavailableReason(course, instructor, home, input = {}) {
  if (home && Number.isFinite(Number(home.distance_km)) && Number.isFinite(Number(home.duration_minutes))) return '';
  if (!text(instructor?.address)) return 'missing_instructor_address';
  if (!placeOf(course)) return 'missing_school_address';
  if (input.preliminary) return 'not_calculated';
  if (input.travelUnavailableReason) return 'service_unavailable';
  return 'no_route';
}

function dynamicTravel(course, instructor, existingMeetings, input = {}) {
  const base = input.travel?.[idOf(course)]?.[text(instructor.emp_id)] || null;
  const transitions = {};
  const destination = placeOf(course);
  for (const meeting of activityMeetings(course)) {
    const { previous, next } = adjacentActivities(existingMeetings, meeting);
    transitions[meeting.date] = {
      previous: previous ? routeLeg(input.routeMatrix, placeOf(previous), destination, sameSchool(previous, course)) : null,
      next: next ? routeLeg(input.routeMatrix, destination, placeOf(next), sameSchool(course, next)) : null,
      baseline: previous && next
        ? routeLeg(input.routeMatrix, placeOf(previous), placeOf(next), sameSchool(previous, next))
        : previous
          ? routeLeg(input.routeMatrix, placeOf(previous), text(instructor.address))
          : next
            ? routeLeg(input.routeMatrix, text(instructor.address), placeOf(next))
            : null
    };
  }
  const home = base?.home || null;
  const homeReturn = base?.homeReturn || null;
  const unavailableReason = travelUnavailableReason(course, instructor, home, input);
  return {
    home,
    homeReturn,
    transitions,
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

function tryFindSingleMeetingSubstitute({
  meeting,
  course,
  mainEmpId,
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  assignedRows = {},
  input = {}
}) {
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const meetingOptions = { periodKey, allDates: true, schoolCalendar: input.schoolCalendar || [] };
  for (const candidate of instructors) {
    const candidateEmpId = text(candidate?.emp_id);
    if (!candidateEmpId || candidateEmpId === mainEmpId) continue;
    const persistedMeetings = meetingAssignments(assignedRows[candidateEmpId] || [], meetingOptions);
    const singleCourse = { ...course, meetings: [meeting] };
    const travel = dynamicTravel(singleCourse, candidate, persistedMeetings, input);
    const gate = evaluateInstructor({
      instructor: candidate,
      profile: profiles[candidateEmpId],
      rules: rules[candidateEmpId] || [],
      exceptions: exceptions[candidateEmpId] || [],
      activity: singleCourse,
      existingActivities: persistedMeetings,
      travel,
      validateTravel: !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined),
      includeLegacyScore: false
    });
    if (!gate.eligible) continue;
    return {
      empId: candidateEmpId,
      name: text(candidate.full_name) || candidateEmpId,
      constraintKind: 'instructor_exception'
    };
  }
  return null;
}

function evaluateCandidate({
  course,
  instructor,
  assignedRows,
  profiles,
  rules,
  exceptions,
  input,
  instructors = []
}) {
  const empId = text(instructor.emp_id);
  const preparedInstructor = input.preparedContext?.instructorContext?.get(empId) || null;
  const persistedRows = preparedInstructor
    ? preparedInstructor.persistedRows
    : [...(assignedRows[empId] || [])];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const allMeetings = activityMeetings(course);
  const periodMeetings = allMeetings.filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey));
  const originalPeriodCourse = { ...course, meetings: periodMeetings };
  const profile = profiles[empId];

  // Skip travel/date-adjustment work when the authority is personally blocked.
  if (isAuthorityBlocked(profile?.blocked_authorities, course?.authority)) {
    const gate = evaluateInstructor({
      instructor,
      profile,
      rules: rules[empId] || [],
      exceptions: exceptions[empId] || [],
      activity: course,
      existingActivities: [],
      travel: null,
      validateTravel: false,
      includeLegacyScore: false
    });
    const persistedBaselineLoad = preparedInstructor?.baselineLoad
      || instructorLoad(persistedRows, profile, rules[empId] || [], { periodKey });
    const persistedProjectedLoad = instructorLoad([...persistedRows, originalPeriodCourse], profile, rules[empId] || [], { periodKey });
    const persistedPeriodMeetings = preparedInstructor?.periodMeetings
      || meetingAssignments(persistedRows, { periodKey, schoolCalendar: input.schoolCalendar || [] });
    return {
      ...gate,
      eligible: false,
      failures: [...new Set([...(gate.failures || []), BLOCKED_AUTHORITY_MESSAGE])],
      failureCodes: [...new Set([...(gate.failureCodes || []), BLOCKED_AUTHORITY_CODE])],
      score: null,
      totalScore: null,
      qualityBand: null,
      qualityLabel: null,
      scoreBreakdown: null,
      recommendationReason: '',
      instructor,
      load: persistedProjectedLoad,
      baselineWorkDates: persistedBaselineLoad.workDates || new Set(),
      travel: null,
      periodCourse: originalPeriodCourse,
      originalPeriodCourse,
      existingMeetings: persistedPeriodMeetings,
      plannerMeetings: persistedPeriodMeetings,
      persistedRows,
      dateAdjustment: null,
      proposedMeetings: null,
      singleMeetingSubstitutions: [],
      instructorExceptionCount: 0,
      currentHalfHours: persistedBaselineLoad.hours,
      projectedHalfHours: persistedProjectedLoad.hours,
      plannerCurrentHalfHours: persistedBaselineLoad.hours,
      plannerProjectedHalfHours: persistedProjectedLoad.hours,
      currentCourseCount: persistedBaselineLoad.courseCount,
      availabilityHours: persistedProjectedLoad.availabilityHours,
      projectedWeeklyHours: Math.max(0, ...Object.values(persistedProjectedLoad.weekHours || {})),
      currentUtilizationRatio: persistedBaselineLoad.maxRatio,
      projectedUtilizationRatio: persistedProjectedLoad.maxRatio,
      utilizationRatio: persistedProjectedLoad.maxRatio,
      activeWorkDays: persistedProjectedLoad.workDays,
      existingWorkDays: persistedBaselineLoad.workDays,
      projectedWorkDays: persistedProjectedLoad.workDays,
      relevantTravelMinutes: null,
      relevantTravelDistance: null,
      incrementalTravelKnown: false,
      movedMeetingsCount: 0,
      totalShiftDays: 0,
      halfOverflow: false,
      sameSchoolMeetingCount: 0,
      sameAuthorityMeetingCount: 0,
      nearbyMeetingCount: 0,
      existingWorkDayMeetingCount: 0,
      newWorkDayMeetingCount: 0,
      continuityMeetingCount: 0,
      opensNewWorkDay: false,
      nonTravelWaitingMinutes: 0
    };
  }

  const sectorKey = normalizeCalendarSector(course?.calendar_sector) || 'general';
  const courseSchoolCalendar = input.preparedContext?.schoolCalendarBySector?.get(sectorKey)
    || filterSchoolCalendarRowsBySector(input.schoolCalendar || [], course?.calendar_sector);
  const meetingOptions = { periodKey, allDates: true, schoolCalendar: input.schoolCalendar || [] };
  const persistedMeetings = preparedInstructor?.allMeetings
    || meetingAssignments(persistedRows, meetingOptions);
  const allowSaturday = normalizeCalendarSector(course?.calendar_sector) === 'arab';
  const adjustmentInput = {
    meetings: allMeetings,
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    schoolCalendar: courseSchoolCalendar,
    existingActivities: persistedMeetings,
    halfEnd: periodKey === 'first' ? FIRST_HALF_CONTINUATION_END_DATE : resolveCourseSchedulingPeriod(periodKey).end,
    allowSaturday
  };

  const classification = classifyMeetingAvailabilityBlocks(adjustmentInput);
  const tooManyExceptions = classification.instructorExceptionCount > MAX_RECOVERABLE_EXCEPTION_MEETINGS;
  const allowAdjustments = input.allowDateAdjustments !== false;

  let adjustment = null;
  if (allowAdjustments && !tooManyExceptions) {
    const findSubstitute = input.allowSubstitutes === false
      ? null
      : (meeting) => tryFindSingleMeetingSubstitute({
        meeting,
        course,
        mainEmpId: empId,
        instructors: instructors.length ? instructors : (input.instructors || []),
        profiles,
        rules,
        exceptions,
        assignedRows,
        input
      });
    adjustment = buildExceptionRecoveryPlan({
      ...adjustmentInput,
      findSubstitute
    });
    if (adjustment?.valid) {
      const destination = placeOf(course);
      const transitions = Object.fromEntries((adjustment.meetings || []).map((meeting) => {
        if (meeting.substituteEmpId) return [meeting.date, {}];
        const { previous, next } = adjacentActivities(persistedMeetings, meeting);
        return [meeting.date, {
          previous: previous ? { ...previous, ...routeLeg(input.routeMatrix || {}, placeOf(previous), destination, sameSchool(previous, course)) } : null,
          next: next ? { ...next, ...routeLeg(input.routeMatrix || {}, destination, placeOf(next), sameSchool(course, next)) } : null
        }];
      }));
      const substitutionsByDate = Object.fromEntries(
        (adjustment.singleMeetingSubstitutions || []).map((row) => [text(row.meetingDate), {
          empId: row.substituteEmpId,
          name: row.substituteName,
          constraintKind: row.constraintKind
        }])
      );
      adjustment = proposeDateAdjustments({ ...adjustmentInput, transitions, substitutionsByDate });
      if (adjustment?.valid) {
        adjustment = {
          ...adjustment,
          eligibleAsPermanent: true,
          instructorExceptionCount: classification.instructorExceptionCount,
          singleMeetingSubstitutions: adjustment.singleMeetingSubstitutions || []
        };
      }
    }
  } else if (allowAdjustments && tooManyExceptions) {
    // School-calendar blocks may still move, but instructor exceptions beyond the
    // recoverable budget cannot keep this instructor as the permanent assignee.
    adjustment = proposeDateAdjustments({
      ...adjustmentInput,
      exceptions: []
    });
    if (adjustment?.valid) {
      adjustment = {
        ...adjustment,
        valid: false,
        reason: 'too_many_availability_exceptions',
        eligibleAsPermanent: false,
        instructorExceptionCount: classification.instructorExceptionCount
      };
    } else {
      adjustment = {
        valid: false,
        reason: 'too_many_availability_exceptions',
        eligibleAsPermanent: false,
        instructorExceptionCount: classification.instructorExceptionCount,
        meetings: []
      };
    }
  }

  const periodCourse = adjustment?.valid ? { ...course, meetings: adjustment.meetings } : originalPeriodCourse;
  const mainTeachingMeetings = (adjustment?.valid ? adjustment.meetings : allMeetings)
    .filter((meeting) => !text(meeting?.substituteEmpId));
  const mainTeachingCourse = { ...course, meetings: mainTeachingMeetings };

  const persistedBaselineLoad = preparedInstructor?.baselineLoad
    || instructorLoad(persistedRows, profiles[empId], rules[empId] || [], { periodKey });
  const persistedProjectedLoad = instructorLoad([...persistedRows, periodCourse], profiles[empId], rules[empId] || [], { periodKey });
  const persistedPeriodMeetings = preparedInstructor?.periodMeetings
    || meetingAssignments(persistedRows, { periodKey, schoolCalendar: input.schoolCalendar || [] });
  const plannerAllMeetings = preparedInstructor?.allMeetings
    || meetingAssignments(persistedRows, meetingOptions);
  const allMeetingsCourse = adjustment?.valid ? mainTeachingCourse : { ...course, meetings: allMeetings };
  const gateTravel = dynamicTravel(allMeetingsCourse, instructor, plannerAllMeetings, input);
  const travel = dynamicTravel(periodCourse, instructor, persistedPeriodMeetings, input);
  const gate = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: allMeetingsCourse,
    existingActivities: plannerAllMeetings,
    travel: gateTravel,
    validateTravel: !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined),
    includeLegacyScore: false
  });
  if (tooManyExceptions) {
    gate.failures = [...new Set([...(gate.failures || []), 'too_many_availability_exceptions'])];
    gate.eligible = false;
    gate.score = null;
    gate.scoreBreakdown = null;
  } else if (adjustment && !adjustment.valid) {
    gate.failures = [...new Set([...(gate.failures || []), adjustment.reason])];
    gate.eligible = false;
    gate.score = null;
    gate.scoreBreakdown = null;
  }

  const eligible = !!gate.eligible;
  return {
    ...gate,
    eligible,
    // The adapter in course-scheduling-engine.js is the sole owner of the
    // approved five-component / 100-point score. Core matching returns only
    // hard-gate facts and raw planning inputs.
    score: null,
    totalScore: null,
    qualityBand: eligible ? 'eligible' : null,
    qualityLabel: eligible ? 'מתאים' : null,
    scoreBreakdown: null,
    recommendationReason: '',
    instructor,
    load: persistedProjectedLoad,
    baselineWorkDates: persistedBaselineLoad.workDates || new Set(),
    travel,
    periodCourse,
    originalPeriodCourse,
    existingMeetings: persistedPeriodMeetings,
    plannerMeetings: persistedPeriodMeetings,
    persistedRows,
    dateAdjustment: adjustment?.valid ? adjustment : null,
    proposedMeetings: adjustment?.valid ? adjustment.meetings : null,
    singleMeetingSubstitutions: adjustment?.valid ? (adjustment.singleMeetingSubstitutions || []) : [],
    instructorExceptionCount: classification.instructorExceptionCount,
    currentHalfHours: persistedBaselineLoad.hours,
    projectedHalfHours: persistedProjectedLoad.hours,
    plannerCurrentHalfHours: persistedBaselineLoad.hours,
    plannerProjectedHalfHours: persistedProjectedLoad.hours,
    currentCourseCount: persistedBaselineLoad.courseCount,
    availabilityHours: persistedProjectedLoad.availabilityHours,
    projectedWeeklyHours: Math.max(0, ...Object.values(persistedProjectedLoad.weekHours)),
    currentUtilizationRatio: persistedBaselineLoad.maxRatio,
    projectedUtilizationRatio: persistedProjectedLoad.maxRatio,
    utilizationRatio: persistedProjectedLoad.maxRatio,
    activeWorkDays: persistedProjectedLoad.workDays,
    existingWorkDays: persistedBaselineLoad.workDays,
    projectedWorkDays: persistedProjectedLoad.workDays,
    relevantTravelMinutes: null,
    relevantTravelDistance: null,
    incrementalTravelKnown: false,
    movedMeetingsCount: adjustment?.valid ? Number(adjustment.movedCount) || 0 : 0,
    totalShiftDays: 0,
    halfOverflow: !!adjustment?.exceedsHalf,
    sameSchoolMeetingCount: 0,
    sameAuthorityMeetingCount: 0,
    nearbyMeetingCount: 0,
    existingWorkDayMeetingCount: 0,
    newWorkDayMeetingCount: 0,
    continuityMeetingCount: 0,
    opensNewWorkDay: false,
    nonTravelWaitingMinutes: 0
  };
}

function rescoreEligiblePeers(candidates = [], course = {}) {
  void course;
  return candidates.map((candidate) => {
    if (!candidate.eligible) return candidate;
    return candidate;
  });
}

function enrichCandidate(candidate, {
  eligibleCandidateCount = 0,
  urgency = null,
  rank = null
} = {}) {
  const empId = text(candidate.instructor?.emp_id);
  const recommended = !!candidate.eligible && rank === 1;
  return {
    ...candidate,
    empId,
    instructorName: candidate.instructor?.full_name || '',
    totalScore: null,
    recommended,
    bestAvailable: !!candidate.eligible && !recommended,
    eligibleCandidateCount,
    urgencyBand: urgency?.urgencyBand ?? null,
    daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
    nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
    rank: candidate.eligible ? rank : null
  };
}

function primaryRejectionReason(checked = []) {
  const reasons = checked.flatMap((candidate) => [...(candidate.failures || []), ...(candidate.missingProfileData || [])]);
  if (!reasons.length) return 'כל המדריכים הפעילים והמוכנים נבדקו ולא נמצא מדריך שעובר את כל תנאי הסף.';
  const joined = reasons.join(' ');
  if (/שפה|דובר/.test(joined)) return 'אין מדריך המתאים לשפה.';
  if (/מגדר|מדריכה|מדריך/.test(joined)) return 'אין מדריך המתאים לדרישת המגדר.';
  if (/זמינות|זמין|פנוי|פנויה/.test(joined)) return 'אין מדריך זמין בכל המפגשים.';
  if (/חפיפה/.test(joined)) return 'קיימת חפיפה אצל כל המדריכים.';
  if (/מרחק|מסלול|40/.test(joined)) return 'אין מדריך בטווח המרחק או עם מסלול אמין.';
  if (/מעבר/.test(joined)) return 'אין זמן מעבר אפשרי.';
  return reasons[0];
}

function preliminaryCandidateCacheKey(course = {}, instructor = {}, input = {}) {
  if (!input.preliminary) return '';
  const prepared = input.preparedContext;
  const dateSetFingerprint = activityMeetings(course)
    .map((meeting) => [
      text(meeting?.date).slice(0, 10),
      text(meeting?.start_time || course?.start_time).slice(0, 5),
      text(meeting?.end_time || course?.end_time).slice(0, 5)
    ].join('@'))
    .join(',');
  const hardGateFingerprint = [
    text(course?.__planning_source_id || course?.activity_no || course?.activity_name || idOf(course)),
    text(course?.activity_type),
    text(course?.education_level),
    text(course?.instruction_language),
    text(course?.required_instructor_gender),
    normalizeCalendarSector(course?.calendar_sector) || 'general',
    text(course?.school_id),
    text(course?.school_address)
  ].join('|');
  return [
    text(instructor?.emp_id),
    hardGateFingerprint,
    dateSetFingerprint,
    text(prepared?.contextVersion || input.contextVersion || '')
  ].join('::');
}

function evaluateCourseCandidates({
  course,
  instructors,
  assignedRows,
  profiles,
  rules,
  exceptions,
  input
}) {
  planningPerfCount('instructorScans');
  const stopTimer = planningPerfTimer('candidateEvaluation');
  const evaluationCache = input.preliminary
    ? (input.candidateEvaluationCache instanceof Map
      ? input.candidateEvaluationCache
      : input.preparedContext?.candidateEvaluationCache)
    : null;
  const raw = instructors.map((instructor) => {
    const cacheKey = evaluationCache ? preliminaryCandidateCacheKey(course, instructor, input) : '';
    if (cacheKey && evaluationCache.has(cacheKey)) return evaluationCache.get(cacheKey);
    planningPerfCount('candidateEvals');
    const evaluated = evaluateCandidate({
      course,
      instructor,
      assignedRows,
      profiles,
      rules,
      exceptions,
      input,
      instructors
    });
    if (cacheKey) evaluationCache.set(cacheKey, evaluated);
    return evaluated;
  });
  const result = rescoreEligiblePeers(raw, course);
  stopTimer();
  return result;
}

export function calculateCourseSchedule(input = {}) {
  planningPerfCount('scheduleCalls');
  const stopScheduleTimer = planningPerfTimer('calculateCourseSchedule');
  const activities = input.activities || [];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const targetCourseId = text(input.targetCourseId || input.targetActivityId);
  const targetCourse = input.targetCourse
    || (targetCourseId ? activities.find((course) => idOf(course) === targetCourseId) : null);
  const scopeOptions = {
    periodKey,
    authority: input.authority,
    district: input.district,
    allDistricts: input.allDistricts === true,
    includeIncompleteWithoutPeriodMeetings: !!input.includeIncompleteWithoutPeriodMeetings
  };
  const scopedCourses = targetCourseId && targetCourse
    ? schedulingCourses([targetCourse], scopeOptions)
    : schedulingCourses(activities, scopeOptions);
  const courses = targetCourseId
    ? scopedCourses.filter((course) => idOf(course) === targetCourseId)
    : scopedCourses;

  const prepared = input.preparedContext?.periodKey === periodKey
    ? input.preparedContext
    : prepareSchedulingRunContext({ ...input, periodKey });
  const profiles = prepared.profiles || input.profiles || {};
  const rules = prepared.rules || input.rules || {};
  const shortlistIds = new Set((input.candidateInstructorIds || []).map(text).filter(Boolean));
  const instructors = shortlistIds.size
    ? [...shortlistIds].map((empId) => prepared.instructorById.get(empId)).filter(Boolean)
    : prepared.instructors;
  const assignedRows = prepared.assignedRows || {};
  const exceptions = prepared.exceptions || input.exceptions || {};
  const incomplete = new Map(courses.map((course) => [idOf(course), missingCourseInformation(course, { periodKey })]));
  const ready = courses.filter((course) => !incomplete.get(idOf(course)).length);
  const referenceDate = input.referenceDate || input.now || null;
  const urgencyByCourse = new Map(ready.map((course) => [idOf(course), courseUrgency(course, referenceDate)]));

  const evaluatedByCourse = new Map();
  const baselineEligibleCount = new Map();
  for (const course of ready) {
    const courseId = idOf(course);
    const evaluated = evaluateCourseCandidates({
      course,
      instructors,
      assignedRows,
      profiles,
      rules,
      exceptions,
      input: { ...input, preparedContext: prepared }
    });
    evaluatedByCourse.set(courseId, evaluated);
    baselineEligibleCount.set(courseId, evaluated.filter((candidate) => candidate.eligible).length);
  }

  const ordered = [...ready].sort((first, second) => {
    const firstUrgency = urgencyByCourse.get(idOf(first))?.urgencyRank || 4;
    const secondUrgency = urgencyByCourse.get(idOf(second))?.urgencyRank || 4;
    if (firstUrgency !== secondUrgency) return firstUrgency - secondUrgency;
    const firstCount = baselineEligibleCount.get(idOf(first)) || 0;
    const secondCount = baselineEligibleCount.get(idOf(second)) || 0;
    if (firstCount !== secondCount) return firstCount - secondCount;
    const firstDate = urgencyByCourse.get(idOf(first))?.nextUpcomingMeetingDate || '9999-99-99';
    const secondDate = urgencyByCourse.get(idOf(second))?.nextUpcomingMeetingDate || '9999-99-99';
    if (firstDate !== secondDate) return firstDate.localeCompare(secondDate);
    return idOf(first).localeCompare(idOf(second));
  });

  const resultsById = new Map();

  for (const course of ordered) {
    const courseId = idOf(course);
    const urgency = urgencyByCourse.get(courseId);
    const evaluated = evaluatedByCourse.get(courseId) || [];
    const eligibleSorted = evaluated
      .filter((candidate) => candidate.eligible)
      .sort((first, second) => compareCandidatesStable(first, second));
    const eligibleCandidateCount = eligibleSorted.length;
    const rankMap = new Map(eligibleSorted.map((candidate, index) => [text(candidate.instructor.emp_id), index + 1]));
    const checked = evaluated.map((candidate) => enrichCandidate(candidate, {
      eligibleCandidateCount,
      urgency,
      rank: rankMap.get(text(candidate.instructor?.emp_id)) || null
    }));

    const primaryRaw = eligibleSorted[0] || null;
    const primary = primaryRaw
      ? enrichCandidate(primaryRaw, {
        eligibleCandidateCount,
        urgency,
        rank: 1
      })
      : null;
    const recommended = primary ? { ...primary, recommended: true, bestAvailable: false } : null;
    const bestAvailable = null;
    const alternatives = eligibleSorted
      .slice(1, 4)
      .map((candidate, index) => ({
        ...enrichCandidate(candidate, {
          eligibleCandidateCount,
          urgency,
          rank: index + 2
        }),
        recommended: false,
        bestAvailable: false
      }));
    const incompleteProfiles = checked.filter((candidate) => !(candidate.failures || []).length && (candidate.missingProfileData || []).length);

    resultsById.set(courseId, {
      course,
      status: recommended
        ? ((recommended.warnings || []).length ? 'נדרש טיפול' : 'הצעה מוכנה')
        : bestAvailable || incompleteProfiles.length ? 'נדרש טיפול' : 'נדרש גיוס',
      recommended,
      bestAvailable,
      alternatives,
      checked,
      incompleteProfiles,
      eligibleCandidateCount,
      urgencyBand: urgency?.urgencyBand ?? null,
      daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
      nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
      treatmentReason: !recommended && incompleteProfiles.length
        ? 'לא ניתן להשלים את בדיקת השיבוץ משום שחסרים נתונים בפרופילי מדריכים.'
        : !recommended ? primaryRejectionReason(checked) : ''
    });
  }

  const incompleteResults = courses
    .filter((course) => incomplete.get(idOf(course)).length)
    .map((course) => ({
      course,
      status: 'חסר מידע',
      missing: incomplete.get(idOf(course)),
      recommended: null,
      bestAvailable: null,
      alternatives: [],
      checked: [],
      eligibleCandidateCount: 0
    }));

  const output = [...ordered.map((course) => resultsById.get(idOf(course))), ...incompleteResults];
  stopScheduleTimer();
  return output;
}

export function preliminaryCourseCandidates(input = {}) {
  const results = calculateCourseSchedule({ ...input, travel: {}, routeMatrix: {}, preliminary: true });
  return results.flatMap((result) => result.checked
    .filter((candidate) => candidate.eligible)
    .map((candidate) => ({ course: result.course, candidate })));
}
