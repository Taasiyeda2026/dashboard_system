import { evaluateInstructor, adjacentActivities, schedulingQualityBand } from './instructor-matching-engine.js';
import { activityMeetings, isoWeekKey } from './instructor-scheduling-load.js';
import { routeMatrixKey } from './course-scheduling-travel.js';
import { isActivitySchedulingEligible, isSchedulingBlockingAssignment, isSchedulingDraftAssignment } from './shared/activity-scheduling-eligibility.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, isDateInCourseSchedulingPeriod, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import { proposeDateAdjustments } from './course-scheduling-date-adjustments.js';
import {
  SCORE_WEIGHTS,
  computeSchedulingScore,
  courseUrgency,
  isSafeEligibleCandidate,
  compareOptimizationStates,
  compareCandidatesStable
} from './course-scheduling-score.js';

export { SCORE_WEIGHTS, courseUrgency };

const text = (value) => String(value ?? '').trim();
const minutes = (value) => {
  const [hours, mins] = text(value).split(':').map(Number);
  return hours * 60 + mins;
};
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (row) => text(row?.emp_id);
// Canonical resolved address only — school display names are not travel locations.
const placeOf = (row = {}) => text(row.school_address);

export function schedulingCourses(rows = [], options = {}) {
  const periodKey = options.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const authority = text(options.authority);
  return rows.filter(isActivitySchedulingEligible)
    .filter((row) => !authority || text(row.authority) === authority)
    .filter((row) => activityMeetings(row).some((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey)));
}

export function schedulingInstructors(rows = []) {
  return rows.filter((row) => text(row?.active).toLowerCase() === 'yes');
}

export function missingCourseInformation(activity, options = {}) {
  const missing = [];
  if (!text(activity?.school)) missing.push('בית ספר');
  if (!text(activity?.school_address)) missing.push('כתובת בית הספר');
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
  const availableRules = rules.filter((rule) => rule.available && Number(rule.weekday) !== 6);
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
      workDates.add(text(meeting.date));
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
  return rows.flatMap((activity) => activityMeetings(activity?.draft_emp_id && Array.isArray(activity.draft_proposed_meetings)
    ? { ...activity, meetings: activity.draft_proposed_meetings }
    : activity)
    .filter((meeting) => options.allDates || isDateInCourseSchedulingPeriod(meeting.date, periodKey))
    .map((meeting) => ({
    ...meeting,
    activity_id: idOf(activity),
    school: activity.school,
    school_id: activity.school_id,
    authority: activity.authority,
    school_address: activity.school_address,
    activity_name: activity.activity_name
  })));
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
  // A saved draft holds its instructor's calendar slot too, so it is never proposed
  // twice — even though the official activity instructor is not set until approval.
  for (const row of rows.filter(isSchedulingDraftAssignment)) {
    add(text(row.draft_emp_id), row);
  }
  return assigned;
}

function averageFinite(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function sameSchool(first = {}, second = {}) {
  const firstId = text(first.school_id);
  const secondId = text(second.school_id);
  if (firstId && secondId) return firstId === secondId;
  return text(first.school).toLocaleLowerCase('he-IL') === text(second.school).toLocaleLowerCase('he-IL');
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
  const homeAddress = text(instructor.address);
  for (const meeting of activityMeetings(course)) {
    const { previous, next } = adjacentActivities(existingMeetings, meeting);
    transitions[meeting.date] = {
      previous: previous ? routeLeg(input.routeMatrix, placeOf(previous), destination, sameSchool(previous, course)) : null,
      next: next ? routeLeg(input.routeMatrix, destination, placeOf(next), sameSchool(course, next)) : null
    };
  }
  const home = base?.home || null;
  // Prefer an explicit return leg; fall back to route matrix school→home, never invent reverse(home).
  const homeReturn = base?.homeReturn
    || (homeAddress && destination ? routeLeg(input.routeMatrix || {}, destination, homeAddress) : null)
    || null;
  const unavailableReason = travelUnavailableReason(course, instructor, home, input);
  return {
    home,
    homeReturn,
    transitions,
    ...(unavailableReason ? { unavailableReason } : {})
  };
}

function candidateRequiresHomeRoute(course, existingMeetings = []) {
  return activityMeetings(course).some((meeting) => {
    const { previous } = adjacentActivities(existingMeetings, meeting);
    return !previous;
  });
}

function candidateRequiresHomeReturn(course, existingMeetings = []) {
  return activityMeetings(course).some((meeting) => {
    const { next } = adjacentActivities(existingMeetings, meeting);
    return !next;
  });
}

/** Activity row used for blocking/load — prefers proposed meetings from a selected candidate. */
function draftActivityFromCandidate(course, candidate) {
  if (!course) return null;
  const meetings = (candidate?.proposedMeetings && candidate.proposedMeetings.length)
    ? candidate.proposedMeetings
    : (candidate?.periodCourse?.meetings && candidate.periodCourse.meetings.length)
      ? candidate.periodCourse.meetings
      : activityMeetings(course);
  return {
    ...course,
    meetings,
    start_time: course.start_time || meetings[0]?.start_time || '',
    end_time: course.end_time || meetings[0]?.end_time || '',
    school: course.school,
    school_id: course.school_id,
    authority: course.authority,
    school_address: course.school_address
  };
}

function meetingSignature(meetings = []) {
  return (meetings || [])
    .map((meeting) => `${text(meeting.date).slice(0, 10)}@${text(meeting.start_time)}-${text(meeting.end_time)}`)
    .join(',');
}

function fairnessVariance(loads = new Map()) {
  const values = [...loads.values()].map(Number).filter(Number.isFinite);
  if (!values.length) return 0;
  const average = averageFinite(values);
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function buildPreprocessCache({ instructors, assignedRows, profiles, rules, periodKey }) {
  const activitiesByInstructor = new Map();
  const activitiesByDate = new Map();
  const hoursByInstructor = new Map();
  const workDaysByInstructor = new Map();

  for (const instructor of instructors) {
    const empId = text(instructor.emp_id);
    const rows = assignedRows[empId] || [];
    const load = instructorLoad(rows, profiles[empId], rules[empId] || [], { periodKey });
    const meetings = meetingAssignments(rows, { periodKey, allDates: true });
    activitiesByInstructor.set(empId, meetings);
    hoursByInstructor.set(empId, load.hours);
    workDaysByInstructor.set(empId, load.workDates || new Set());
    for (const meeting of meetings) {
      const date = text(meeting.date).slice(0, 10);
      if (!activitiesByDate.has(date)) activitiesByDate.set(date, []);
      activitiesByDate.get(date).push({ ...meeting, emp_id: empId });
    }
  }

  return {
    activitiesByInstructor,
    activitiesByDate,
    hoursByInstructor,
    workDaysByInstructor
  };
}

function applyScoreToCandidate(candidate, course, peerProjectedHours = []) {
  if (!candidate?.eligible) return candidate;
  const scored = computeSchedulingScore({
    eligible: true,
    activity: candidate.periodCourse || course,
    meetings: activityMeetings(candidate.periodCourse || course),
    existingActivities: candidate.existingMeetings || [],
    travel: candidate.travel,
    workDates: candidate.baselineWorkDates || new Set(),
    dateAdjustment: candidate.dateAdjustment,
    currentHalfHours: candidate.currentHalfHours,
    projectedHalfHours: candidate.projectedHalfHours,
    peerProjectedHours,
    activeWorkDays: candidate.activeWorkDays,
    scoreReasons: candidate.scoreReasons || []
  });
  return {
    ...candidate,
    score: scored.score,
    ...schedulingQualityBand(scored.score, true),
    scoreBreakdown: scored.scoreBreakdown,
    recommendationReason: scored.recommendationReason,
    currentHalfHours: scored.currentHalfHours,
    projectedHalfHours: scored.projectedHalfHours,
    activeWorkDays: scored.activeWorkDays,
    relevantTravelMinutes: scored.relevantTravelMinutes,
    relevantTravelDistance: scored.relevantTravelDistance,
    dailyTravelMinutes: scored.dailyTravelMinutes,
    movedMeetingsCount: scored.movedMeetingsCount,
    totalShiftDays: scored.totalShiftDays,
    originalEndDate: scored.originalEndDate,
    proposedEndDate: scored.proposedEndDate,
    halfOverflow: scored.halfOverflow,
    opensNewWorkDay: scored.opensNewWorkDay,
    gapBeforeMinutes: scored.gapBeforeMinutes,
    gapAfterMinutes: scored.gapAfterMinutes,
    nonTravelWaitingMinutes: scored.nonTravelWaitingMinutes,
    hasSameSchoolDay: scored.hasSameSchoolDay,
    hasSameAuthorityDay: scored.hasSameAuthorityDay,
    sameSchoolMeetingCount: scored.sameSchoolMeetingCount,
    sameAuthorityMeetingCount: scored.sameAuthorityMeetingCount,
    nearbyMeetingCount: scored.nearbyMeetingCount,
    existingWorkDayMeetingCount: scored.existingWorkDayMeetingCount,
    newWorkDayMeetingCount: scored.newWorkDayMeetingCount,
    continuityMeetingCount: scored.continuityMeetingCount,
    continuityAverage: scored.continuityAverage,
    homeRouteVerified: !!(candidate.travel?.home
      && Number.isFinite(Number(candidate.travel.home.duration_minutes))
      && Number.isFinite(Number(candidate.travel.home.distance_km))),
    homeReturnVerified: !!(candidate.travel?.homeReturn
      && Number.isFinite(Number(candidate.travel.homeReturn.duration_minutes))
      && Number.isFinite(Number(candidate.travel.homeReturn.distance_km)))
  };
}

function rescoreWithPeers(candidates = [], course = {}, peerProjectedHours = null) {
  const safe = candidates.filter((candidate) => isSafeEligibleCandidate(candidate, { preliminary: false }));
  const peers = peerProjectedHours
    || safe.map((candidate) => Number(candidate.projectedHalfHours) || 0);
  return candidates.map((candidate) => {
    if (!candidate.eligible) return candidate;
    return applyScoreToCandidate(candidate, course, peers);
  });
}

function evaluateCandidate({ course, instructor, assignedRows, draftRows, profiles, rules, exceptions, input, cache }) {
  const empId = text(instructor.emp_id);
  const occupiedRows = [...(assignedRows[empId] || []), ...(draftRows || [])];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const allMeetings = activityMeetings(course);
  const periodMeetings = allMeetings.filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey));
  const originalPeriodCourse = { ...course, meetings: periodMeetings };
  const existingMeetings = meetingAssignments(occupiedRows, { periodKey, allDates: true });
  const adjustmentInput = {
    meetings: allMeetings,
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    schoolCalendar: input.schoolCalendar || [],
    existingActivities: existingMeetings,
    halfEnd: resolveCourseSchedulingPeriod(periodKey).end
  };
  let adjustment = proposeDateAdjustments(adjustmentInput);
  if (adjustment?.valid) {
    const destination = placeOf(course);
    const transitions = Object.fromEntries(adjustment.meetings.map((meeting) => {
      const { previous, next } = adjacentActivities(existingMeetings, meeting);
      return [meeting.date, {
        previous: previous ? { ...previous, ...routeLeg(input.routeMatrix || {}, placeOf(previous), destination, sameSchool(previous, course)) } : null,
        next: next ? { ...next, ...routeLeg(input.routeMatrix || {}, destination, placeOf(next), sameSchool(course, next)) } : null
      }];
    }));
    adjustment = proposeDateAdjustments({ ...adjustmentInput, transitions });
  }
  const periodCourse = adjustment?.valid ? { ...course, meetings: adjustment.meetings } : originalPeriodCourse;
  const baselineLoad = instructorLoad(occupiedRows, profiles[empId], rules[empId] || [], { periodKey });
  const projectedLoad = instructorLoad([...occupiedRows, periodCourse], profiles[empId], rules[empId] || [], { periodKey });
  const occupiedPeriodMeetings = meetingAssignments(occupiedRows, { periodKey });
  const travel = dynamicTravel(periodCourse, instructor, occupiedPeriodMeetings, input);
  const validateTravel = !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined);
  // Home/home-return safety applies only when this run is validating travel (final routed calculation).
  const requiresHomeRoute = validateTravel && candidateRequiresHomeRoute(periodCourse, occupiedPeriodMeetings);
  const requiresHomeReturn = validateTravel && candidateRequiresHomeReturn(periodCourse, occupiedPeriodMeetings);
  const homeRouteVerified = !!(travel?.home
    && Number.isFinite(Number(travel.home.duration_minutes))
    && Number.isFinite(Number(travel.home.distance_km)));
  const homeReturnVerified = !!(travel?.homeReturn
    && Number.isFinite(Number(travel.homeReturn.duration_minutes))
    && Number.isFinite(Number(travel.homeReturn.distance_km)));
  const result = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: periodCourse,
    existingActivities: occupiedPeriodMeetings,
    travel,
    validateTravel,
    dateAdjustment: adjustment?.valid ? adjustment : null,
    currentHalfHours: baselineLoad.hours,
    projectedHalfHours: projectedLoad.hours,
    activeWorkDays: projectedLoad.workDays,
    workDates: cache?.workDaysByInstructor?.get(empId) || baselineLoad.workDates
  });
  if (adjustment && !adjustment.valid) {
    result.failures = [...new Set([...result.failures, adjustment.reason])];
    result.eligible = false;
    result.score = null;
    result.scoreBreakdown = null;
  }
  return {
    ...result,
    instructor,
    load: projectedLoad,
    travel,
    periodCourse,
    originalPeriodCourse,
    existingMeetings: occupiedPeriodMeetings,
    baselineWorkDates: baselineLoad.workDates || new Set(),
    dateAdjustment: adjustment?.valid ? adjustment : null,
    proposedMeetings: adjustment?.valid ? adjustment.meetings : null,
    currentHalfHours: baselineLoad.hours,
    projectedHalfHours: projectedLoad.hours,
    activeWorkDays: projectedLoad.workDays,
    requiresHomeRoute,
    requiresHomeReturn,
    homeRouteVerified,
    homeReturnVerified,
    preliminary: !!input.preliminary
  };
}

function enrichCandidate(candidate, { eligibleCandidateCount = 0, urgency = null, rank = null, preliminary = false } = {}) {
  const empId = text(candidate.instructor?.emp_id);
  const safe = isSafeEligibleCandidate(candidate, { preliminary });
  const recommended = safe && Number(candidate.score) >= 60;
  return {
    ...candidate,
    empId,
    instructorName: candidate.instructor?.full_name || '',
    totalScore: candidate.score,
    recommended,
    bestAvailable: safe && !recommended,
    eligibleCandidateCount,
    urgencyBand: urgency?.urgencyBand ?? null,
    daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
    nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
    rank: safe ? rank : null
  };
}

function candidateMap({ courses, instructors, profiles = {}, rules = {}, exceptions = {}, assignedRows, input, cache }) {
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const output = new Map();
  const urgencyByCourse = new Map();
  const referenceDate = input.referenceDate || input.now || null;
  const preliminary = !!input.preliminary;

  for (const course of courses) {
    urgencyByCourse.set(idOf(course), courseUrgency(course, referenceDate));
    const rawCandidates = instructors.map((instructor) => evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: [],
      profiles,
      rules,
      exceptions,
      input,
      cache
    }));
    const peerHours = rawCandidates
      .filter((candidate) => isSafeEligibleCandidate(candidate, { preliminary }))
      .map((candidate) => Number(candidate.projectedHalfHours) || 0);
    const rescored = rescoreWithPeers(rawCandidates, course, peerHours);
    const safeFilter = (candidate) => isSafeEligibleCandidate(candidate, { preliminary });
    const eligibleCount = rescored.filter(safeFilter).length;
    const urgency = urgencyByCourse.get(idOf(course));
    const ranked = [...rescored]
      .filter(safeFilter)
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));
    const rankMap = new Map(ranked.map((candidate, index) => [text(candidate.instructor.emp_id), index + 1]));
    output.set(idOf(course), rescored.map((candidate) => enrichCandidate(candidate, {
      eligibleCandidateCount: eligibleCount,
      urgency,
      rank: rankMap.get(text(candidate.instructor?.emp_id)) || null,
      preliminary
    })));
  }
  return { output, urgencyByCourse, periodKey };
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

function draftRowsForInstructor(state, empId, ordered, excludeCourseId = '') {
  return [...state.draft.entries()]
    .filter(([courseId, candidate]) => courseId !== excludeCourseId && text(candidate.instructor.emp_id) === empId)
    .map(([courseId, candidate]) => {
      const course = ordered.find((row) => idOf(row) === courseId);
      return draftActivityFromCandidate(course, candidate);
    })
    .filter(Boolean);
}

/**
 * State-aware peer projected hours: re-evaluate each baseline peer against the current draft
 * (including proposedMeetings). Only currently safe/eligible peers contribute.
 */
function buildStateAwarePeerHours({
  course,
  maps,
  assignedRows,
  state,
  ordered,
  profiles,
  rules,
  exceptions,
  input,
  cache,
  excludeCourseId = '',
  evalCache = null
}) {
  const hours = [];
  const courseId = idOf(course);
  const baselines = maps.get(courseId) || [];
  for (const baseline of baselines) {
    const empId = text(baseline.instructor?.emp_id);
    const draftSig = assignmentSignature(state.draft, empId);
    const cacheKey = `${courseId}|${empId}|${draftSig}|${excludeCourseId}`;
    let evaluated = evalCache?.get(cacheKey);
    if (!evaluated) {
      evaluated = evaluateCandidate({
        course,
        instructor: baseline.instructor,
        assignedRows,
        draftRows: draftRowsForInstructor(state, empId, ordered, excludeCourseId || courseId),
        profiles,
        rules,
        exceptions,
        input,
        cache
      });
      evalCache?.set(cacheKey, evaluated);
    }
    if (!isSafeEligibleCandidate(evaluated)) continue;
    hours.push(Number(evaluated.projectedHalfHours) || 0);
  }
  return hours;
}

function summarizeState(state, ordered, urgencyByCourse, maps) {
  let urgency7Missed = 0;
  let urgency14Missed = 0;
  let sameSchoolMeetingCount = 0;
  let sameAuthorityMeetingCount = 0;
  let newWorkDayMeetingCount = 0;
  let totalTravelMinutes = 0;
  let totalNonTravelWaiting = 0;
  let newWorkDaysOpened = 0;
  let totalShiftDays = 0;
  let totalScore = 0;
  let tieProjectedHours = 0;
  let tieTravel = 0;
  let tieNewDays = 0;
  let tieMovedMeetings = 0;
  const empIds = [];
  const scarcityMissedByCount = [];

  for (const course of ordered) {
    const courseId = idOf(course);
    const urgency = urgencyByCourse.get(courseId) || {};
    const eligibleCount = (maps.get(courseId) || []).filter((candidate) => isSafeEligibleCandidate(candidate)).length;
    const selected = state.draft.get(courseId);
    if (!selected) {
      if (urgency.urgencyRank === 1) urgency7Missed += 1;
      else if (urgency.urgencyRank === 2) urgency14Missed += 1;
      if (eligibleCount > 0) {
        scarcityMissedByCount[eligibleCount] = (scarcityMissedByCount[eligibleCount] || 0) + 1;
      }
      continue;
    }
    sameSchoolMeetingCount += Number(selected.sameSchoolMeetingCount) || (selected.hasSameSchoolDay ? 1 : 0);
    sameAuthorityMeetingCount += Number(selected.sameAuthorityMeetingCount) || (selected.hasSameAuthorityDay ? 1 : 0);
    newWorkDayMeetingCount += Number(selected.newWorkDayMeetingCount) || (selected.opensNewWorkDay ? 1 : 0);
    const travelUnknown = selected.relevantTravelMinutes == null
      || selected.scoreBreakdown?.travelDistance?.note === 'המרחק טרם חושב'
      || selected.scoreBreakdown?.travelDistance?.note === 'מסלול לא ידוע — ללא ניקוד נסיעה רגיל';
    totalTravelMinutes += travelUnknown ? 100000 : (Number(selected.dailyTravelMinutes) || 0);
    totalNonTravelWaiting += Number(selected.nonTravelWaitingMinutes) || 0;
    newWorkDaysOpened += selected.opensNewWorkDay ? 1 : 0;
    totalShiftDays += Number(selected.totalShiftDays) || 0;
    totalScore += Number(selected.score) || 0;
    tieProjectedHours += Number(selected.projectedHalfHours) || 0;
    tieTravel += Number(selected.dailyTravelMinutes) || 0;
    tieNewDays += selected.opensNewWorkDay ? 1 : 0;
    tieMovedMeetings += Number(selected.movedMeetingsCount) || 0;
    empIds.push(text(selected.instructor?.emp_id));
  }

  return {
    ...state,
    assignedCount: state.draft.size,
    urgency7Missed,
    urgency14Missed,
    scarcityMissedByCount,
    sameSchoolMeetingCount,
    sameAuthorityMeetingCount,
    newWorkDayMeetingCount,
    // Keep legacy booleans for older compare fixtures.
    sameSchoolCount: sameSchoolMeetingCount,
    sameAuthorityCount: sameAuthorityMeetingCount,
    totalTravelMinutes,
    totalNonTravelWaiting,
    newWorkDaysOpened,
    totalShiftDays,
    totalScore,
    workloadVariance: fairnessVariance(state.loads),
    tieProjectedHours,
    tieTravel,
    tieNewDays,
    tieMovedMeetings,
    tieEmpId: empIds.sort().join(',')
  };
}

/** Signature includes proposed meeting dates so different adjustments are distinct states. */
function assignmentSignature(draft, onlyEmpId = '') {
  return [...draft.entries()]
    .filter(([, candidate]) => !onlyEmpId || text(candidate.instructor?.emp_id) === onlyEmpId)
    .map(([courseId, candidate]) => {
      const meetings = candidate.proposedMeetings || candidate.periodCourse?.meetings || [];
      return `${courseId}:${text(candidate.instructor?.emp_id)}:${meetingSignature(meetings)}`;
    })
    .sort()
    .join('|');
}

/**
 * Partition courses into independent components: two courses share a component when they
 * share any baseline-safe instructor. Components have no shared instructors, so no travel /
 * overlap / proposed-date interaction across them — solving separately is exact.
 */
function independentCourseComponents(ordered, maps) {
  const parent = ordered.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const unite = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const instructorCourses = new Map();
  ordered.forEach((course, index) => {
    for (const candidate of (maps.get(idOf(course)) || []).filter((row) => isSafeEligibleCandidate(row))) {
      const empId = text(candidate.instructor?.emp_id);
      if (!instructorCourses.has(empId)) instructorCourses.set(empId, []);
      instructorCourses.get(empId).push(index);
    }
  });
  for (const indexes of instructorCourses.values()) {
    for (let i = 1; i < indexes.length; i += 1) unite(indexes[0], indexes[i]);
  }
  const groups = new Map();
  ordered.forEach((course, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(course);
  });
  return [...groups.values()];
}

/**
 * Max-assignment search with admissible upper-bound pruning and memoization.
 * Never uses a fixed beam width. Never prunes using original-date conflicts
 * (date adjustments can move meetings). Time-budgeted for browser safety.
 */
function optimizeAssignments({
  ordered,
  maps,
  urgencyByCourse,
  instructors,
  assignedRows,
  profiles,
  rules,
  exceptions,
  input,
  cache,
  baselineLoads,
  periodKey,
  timeBudgetMs = 4000
}) {
  // Solve instructor-disjoint components separately first (exact merge).
  // Share one deadline across components — do not divide the budget into slices that
  // falsely mark complete components as incomplete.
  const components = independentCourseComponents(ordered, maps);
  if (components.length > 1) {
    const mergedDraft = new Map();
    const mergedLoads = new Map(baselineLoads);
    let allComplete = true;
    let totalNodes = 0;
    let totalPruned = 0;
    const deadline = Date.now() + timeBudgetMs;
    for (const component of components) {
      const remainingMs = Math.max(50, deadline - Date.now());
      const partial = optimizeAssignments({
        ordered: component,
        maps,
        urgencyByCourse,
        instructors,
        assignedRows,
        profiles,
        rules,
        exceptions,
        input,
        cache,
        baselineLoads,
        periodKey,
        timeBudgetMs: remainingMs
      });
      for (const [courseId, candidate] of partial.draft.entries()) mergedDraft.set(courseId, candidate);
      for (const [empId, hours] of partial.loads.entries()) mergedLoads.set(empId, hours);
      allComplete = allComplete && partial.optimizationComplete !== false;
      totalNodes += Number(partial.nodesVisited) || 0;
      totalPruned += Number(partial.branchesPruned) || 0;
    }
    const mergedState = { draft: mergedDraft, loads: mergedLoads };
    const mergedSummary = summarizeState(mergedState, ordered, urgencyByCourse, maps);
    return {
      ...mergedSummary,
      draft: mergedDraft,
      loads: mergedLoads,
      optimizationComplete: allComplete,
      nodesVisited: totalNodes,
      branchesPruned: totalPruned
    };
  }

  const startedAt = Date.now();
  let nodesVisited = 0;
  let branchesPruned = 0;
  let optimizationComplete = true;
  const draft = new Map();
  const loads = new Map(baselineLoads);
  const state = { draft, loads };
  const evalCache = new Map();
  let bestSummary = summarizeState(state, ordered, urgencyByCourse, maps);
  let bestDraft = new Map();
  let bestLoads = new Map(baselineLoads);
  const memo = new Set();

  const peerHoursFor = (course) => buildStateAwarePeerHours({
    course,
    maps,
    assignedRows,
    state,
    ordered,
    profiles,
    rules,
    exceptions,
    input,
    cache,
    evalCache
  });

  // Greedy warm-start: admissible lower bound on assignedCount (and a full lex state).
  {
    const warmDraft = new Map();
    const warmLoads = new Map(baselineLoads);
    const warmState = { draft: warmDraft, loads: warmLoads };
    for (const course of ordered) {
      const peerHours = buildStateAwarePeerHours({
        course,
        maps,
        assignedRows,
        state: warmState,
        ordered,
        profiles,
        rules,
        exceptions,
        input,
        cache,
        evalCache
      });
      const candidates = (maps.get(idOf(course)) || [])
        .filter((candidate) => isSafeEligibleCandidate(candidate))
        .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));
      for (const candidate of candidates) {
        const empId = text(candidate.instructor.emp_id);
        const evaluated = applyScoreToCandidate(evaluateCandidate({
          course,
          instructor: candidate.instructor,
          assignedRows,
          draftRows: draftRowsForInstructor(warmState, empId, ordered),
          profiles,
          rules,
          exceptions,
          input,
          cache
        }), course, peerHours);
        if (!isSafeEligibleCandidate(evaluated)) continue;
        warmDraft.set(idOf(course), enrichCandidate(evaluated, {
          eligibleCandidateCount: candidate.eligibleCandidateCount,
          urgency: urgencyByCourse.get(idOf(course)),
          rank: candidate.rank
        }));
        warmLoads.set(empId, evaluated.projectedHalfHours);
        break;
      }
    }
    const warmSummary = summarizeState(warmState, ordered, urgencyByCourse, maps);
    if (compareOptimizationStates(warmSummary, bestSummary) < 0) {
      bestSummary = warmSummary;
      bestDraft = new Map(warmDraft);
      bestLoads = new Map(warmLoads);
    }
  }

  /**
   * Admissible remaining capacity: number of yet-unprocessed courses that still have at least
   * one baseline-safe candidate. Does NOT subtract conflict assumptions (date moves may free slots).
   */
  const remainingAssignable = (fromIndex) => {
    let count = 0;
    for (let index = fromIndex; index < ordered.length; index += 1) {
      if ((maps.get(idOf(ordered[index])) || []).some((candidate) => isSafeEligibleCandidate(candidate))) {
        count += 1;
      }
    }
    return count;
  };

  // Admissible: forced urgency misses among courses already decided unassigned (index < courseIndex).
  const countForcedMisses = (courseIndex) => {
    let miss7 = 0;
    let miss14 = 0;
    for (let index = 0; index < courseIndex; index += 1) {
      const courseId = idOf(ordered[index]);
      if (draft.has(courseId)) continue;
      const urgency = urgencyByCourse.get(courseId) || {};
      if (urgency.urgencyRank === 1) miss7 += 1;
      else if (urgency.urgencyRank === 2) miss14 += 1;
    }
    return { miss7, miss14 };
  };

  const search = (courseIndex) => {
    nodesVisited += 1;
    if (Date.now() - startedAt > timeBudgetMs) {
      optimizationComplete = false;
      return;
    }

    // Admissible: assigned + remaining courses that still have ≥1 baseline-safe candidate.
    // Does not assume original-date conflicts (date adjustments may free slots).
    const remainingCap = remainingAssignable(courseIndex);
    if (draft.size + remainingCap < bestSummary.assignedCount) {
      branchesPruned += 1;
      return;
    }

    // Admissible urgency prune when cardinality cannot beat best: current forced misses already worse.
    if (draft.size + remainingCap === bestSummary.assignedCount) {
      const { miss7, miss14 } = countForcedMisses(courseIndex);
      if (miss7 > (bestSummary.urgency7Missed || 0)) {
        branchesPruned += 1;
        return;
      }
      if (miss7 === (bestSummary.urgency7Missed || 0) && miss14 > (bestSummary.urgency14Missed || 0)) {
        branchesPruned += 1;
        return;
      }
    }

    if (courseIndex >= ordered.length) {
      const summary = summarizeState(state, ordered, urgencyByCourse, maps);
      if (compareOptimizationStates(summary, bestSummary) < 0) {
        bestSummary = summary;
        bestDraft = new Map(draft);
        bestLoads = new Map(loads);
      }
      return;
    }

    // Memo includes proposed meeting signatures via assignmentSignature — distinct adjustments ≠ same state.
    const memoKey = `${courseIndex}|${assignmentSignature(draft)}`;
    if (memo.has(memoKey)) {
      branchesPruned += 1;
      return;
    }
    memo.add(memoKey);

    const course = ordered[courseIndex];
    const peerHours = peerHoursFor(course);
    const candidates = (maps.get(idOf(course)) || [])
      .filter((candidate) => isSafeEligibleCandidate(candidate))
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));

    const exploreUnassigned = () => search(courseIndex + 1);
    const exploreAssignments = () => {
      for (const candidate of candidates) {
        if (!optimizationComplete && Date.now() - startedAt > timeBudgetMs) break;
        // Admissible cardinality prune only (no original-date conflict assumptions).
        if (draft.size + remainingCap < bestSummary.assignedCount) {
          branchesPruned += 1;
          break;
        }
        const empId = text(candidate.instructor.emp_id);
        const evaluatedRaw = evaluateCandidate({
          course,
          instructor: candidate.instructor,
          assignedRows,
          draftRows: draftRowsForInstructor(state, empId, ordered),
          profiles,
          rules,
          exceptions,
          input,
          cache
        });
        const evaluated = applyScoreToCandidate(evaluatedRaw, course, peerHours);
        if (!isSafeEligibleCandidate(evaluated)) continue;

        const courseId = idOf(course);
        const previousLoad = loads.has(empId) ? loads.get(empId) : null;
        draft.set(courseId, enrichCandidate(evaluated, {
          eligibleCandidateCount: candidate.eligibleCandidateCount,
          urgency: urgencyByCourse.get(courseId),
          rank: candidate.rank
        }));
        loads.set(empId, evaluated.projectedHalfHours);
        search(courseIndex + 1);
        draft.delete(courseId);
        if (previousLoad == null) loads.delete(empId);
        else loads.set(empId, previousLoad);
      }
    };

    // High branching: try unassigned first to lock a strong cardinality lower bound quickly.
    if (candidates.length > 20) {
      exploreUnassigned();
      exploreAssignments();
    } else {
      exploreAssignments();
      exploreUnassigned();
    }
  };

  search(0);
  return {
    ...bestSummary,
    draft: bestDraft,
    loads: bestLoads,
    optimizationComplete,
    nodesVisited,
    branchesPruned
  };
}

export function calculateCourseSchedule(input = {}) {
  const activities = input.activities || [];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const courses = schedulingCourses(activities, { periodKey, authority: input.authority });
  const instructors = schedulingInstructors(input.instructors || []);
  const assignedRows = assignedRowsByInstructor(activities, input.assignments || {});
  const profiles = input.profiles || {};
  const rules = input.rules || {};
  const exceptions = input.exceptions || {};
  const incomplete = new Map(courses.map((course) => [idOf(course), missingCourseInformation(course, { periodKey })]));
  const ready = courses.filter((course) => !incomplete.get(idOf(course)).length);
  const cache = buildPreprocessCache({ instructors, assignedRows, profiles, rules, periodKey });
  // Tests may inject precomputed safe-candidate maps to exercise search without O(courses×instructors) preprocess.
  const precomputed = input.precomputedCandidateMaps;
  const { output: maps, urgencyByCourse } = precomputed?.output && precomputed?.urgencyByCourse
    ? precomputed
    : candidateMap({
      courses: ready,
      instructors,
      profiles,
      rules,
      exceptions,
      assignedRows,
      input,
      cache
    });

  const ordered = [...ready].sort((first, second) => {
    const firstUrgency = urgencyByCourse.get(idOf(first))?.urgencyRank || 4;
    const secondUrgency = urgencyByCourse.get(idOf(second))?.urgencyRank || 4;
    if (firstUrgency !== secondUrgency) return firstUrgency - secondUrgency;
    const firstEligible = maps.get(idOf(first)).filter((candidate) => isSafeEligibleCandidate(candidate)).length;
    const secondEligible = maps.get(idOf(second)).filter((candidate) => isSafeEligibleCandidate(candidate)).length;
    if (firstEligible !== secondEligible) return firstEligible - secondEligible;
    return idOf(first).localeCompare(idOf(second));
  });

  const baselineLoads = new Map(instructors.map((instructor) => {
    const empId = text(instructor.emp_id);
    return [empId, cache.hoursByInstructor.get(empId) || 0];
  }));

  const bestState = optimizeAssignments({
    ordered,
    maps,
    urgencyByCourse,
    instructors,
    assignedRows,
    profiles,
    rules,
    exceptions,
    input,
    cache,
    baselineLoads,
    periodKey,
    timeBudgetMs: Number(input.timeBudgetMs) > 0 ? Number(input.timeBudgetMs) : 4000
  });
  const finalEvalCache = new Map();

  const refreshCandidate = (course, instructor, peerHours, excludeCourseId = '') => {
    const empId = text(instructor.emp_id);
    const courseId = idOf(course);
    const cacheKey = `final|${courseId}|${empId}|${assignmentSignature(bestState.draft, empId)}|${excludeCourseId}`;
    let evaluatedRaw = finalEvalCache.get(cacheKey);
    if (!evaluatedRaw) {
      evaluatedRaw = evaluateCandidate({
        course,
        instructor,
        assignedRows,
        draftRows: draftRowsForInstructor(bestState, empId, ordered, excludeCourseId || courseId),
        profiles,
        rules,
        exceptions,
        input,
        cache
      });
      finalEvalCache.set(cacheKey, evaluatedRaw);
    }
    const evaluated = applyScoreToCandidate(evaluatedRaw, course, peerHours);
    return evaluated;
  };

  return courses.map((course) => {
    const id = idOf(course);
    const missing = incomplete.get(id);
    if (missing.length) {
      return {
        course,
        status: 'חסר מידע',
        missing,
        recommended: null,
        alternatives: [],
        checked: [],
        optimizationComplete: bestState.optimizationComplete !== false,
        nodesVisited: bestState.nodesVisited || 0,
        branchesPruned: bestState.branchesPruned || 0
      };
    }

    const peerHours = buildStateAwarePeerHours({
      course,
      maps,
      assignedRows,
      state: bestState,
      ordered,
      profiles,
      rules,
      exceptions,
      input,
      cache,
      excludeCourseId: id,
      evalCache: finalEvalCache
    });

    // Re-evaluate every baseline candidate against bestState (not the stale preliminary map).
    const baselines = maps.get(id) || [];
    const refreshedChecked = baselines.map((baseline) => {
      const evaluated = refreshCandidate(course, baseline.instructor, peerHours, id);
      return evaluated;
    });
    const safeEligible = refreshedChecked
      .filter((candidate) => isSafeEligibleCandidate(candidate))
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));
    const safeEligibleCount = safeEligible.length;
    const rankMap = new Map(safeEligible.map((candidate, index) => [text(candidate.instructor.emp_id), index + 1]));
    const urgency = urgencyByCourse.get(id);
    const checked = refreshedChecked.map((candidate) => enrichCandidate(candidate, {
      eligibleCandidateCount: safeEligibleCount,
      urgency,
      rank: rankMap.get(text(candidate.instructor?.emp_id)) || null,
      preliminary: !!input.preliminary
    }));

    const selected = bestState.draft.get(id) || null;
    const selectedEmp = text(selected?.instructor?.emp_id);
    const selectedCandidate = selectedEmp
      ? checked.find((candidate) => text(candidate.instructor?.emp_id) === selectedEmp)
      : null;
    const safeSelected = selectedCandidate && isSafeEligibleCandidate(selectedCandidate) ? selectedCandidate : null;
    const recommended = safeSelected?.score >= 60 ? { ...safeSelected, recommended: true, bestAvailable: false } : null;
    const bestAvailable = recommended ? null : (safeSelected ? { ...safeSelected, recommended: false, bestAvailable: true } : null);
    const primary = recommended || bestAvailable;
    const alternativeLimit = bestAvailable ? 2 : 3;
    // Refresh all peers first, then filter/sort, then slice — never slice before re-evaluation.
    const alternatives = checked
      .filter((candidate) => isSafeEligibleCandidate(candidate) && text(candidate.instructor.emp_id) !== text(primary?.instructor?.emp_id))
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second))
      .slice(0, alternativeLimit)
      .map((candidate) => ({ ...candidate, recommended: false, bestAvailable: false }));
    const incompleteProfiles = checked.filter((candidate) => !candidate.failures.length && candidate.missingProfileData.length);

    return {
      course,
      status: recommended
        ? (recommended.warnings.length ? 'נדרש טיפול' : 'הצעה מוכנה')
        : bestAvailable || incompleteProfiles.length ? 'נדרש טיפול' : 'נדרש גיוס',
      recommended,
      bestAvailable,
      alternatives,
      checked,
      incompleteProfiles,
      eligibleCandidateCount: safeEligibleCount,
      urgencyBand: urgency?.urgencyBand ?? null,
      daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
      nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
      optimizationComplete: bestState.optimizationComplete !== false,
      nodesVisited: bestState.nodesVisited || 0,
      branchesPruned: bestState.branchesPruned || 0,
      treatmentReason: bestAvailable
        ? 'נמצאו מדריכים שעומדים בתנאי הסף, אך הציון שלהם נמוך מסף ההמלצה.'
        : !recommended && incompleteProfiles.length
        ? 'לא ניתן להשלים את בדיקת השיבוץ משום שחסרים נתונים בפרופילי מדריכים.'
        : !recommended ? primaryRejectionReason(checked) : ''
    };
  });
}

export function preliminaryCourseCandidates(input = {}) {
  const results = calculateCourseSchedule({ ...input, travel: {}, routeMatrix: {}, preliminary: true });
  return results.flatMap((result) => result.checked
    .filter((candidate) => candidate.eligible)
    .map((candidate) => ({ course: result.course, candidate })));
}
