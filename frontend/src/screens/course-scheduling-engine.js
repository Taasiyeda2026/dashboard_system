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
  for (const meeting of activityMeetings(course)) {
    const { previous, next } = adjacentActivities(existingMeetings, meeting);
    transitions[meeting.date] = {
      previous: previous ? routeLeg(input.routeMatrix, placeOf(previous), destination, sameSchool(previous, course)) : null,
      next: next ? routeLeg(input.routeMatrix, destination, placeOf(next), sameSchool(course, next)) : null
    };
  }
  const home = base?.home || null;
  const unavailableReason = travelUnavailableReason(course, instructor, home, input);
  return {
    home,
    transitions,
    ...(unavailableReason ? { unavailableReason } : {})
  };
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

function rescoreWithPeers(candidates = [], course = {}) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const peerProjectedHours = eligible.map((candidate) => Number(candidate.projectedHalfHours) || 0);
  return candidates.map((candidate) => {
    if (!candidate.eligible) return candidate;
    const scored = computeSchedulingScore({
      eligible: true,
      activity: candidate.periodCourse || course,
      meetings: activityMeetings(candidate.periodCourse || course),
      existingActivities: candidate.existingMeetings || [],
      travel: candidate.travel,
      // Baseline work days only — projected load already includes this course.
      workDates: candidate.baselineWorkDates || new Set(),
      dateAdjustment: candidate.dateAdjustment,
      currentHalfHours: candidate.currentHalfHours,
      projectedHalfHours: candidate.projectedHalfHours,
      peerProjectedHours,
      activeWorkDays: candidate.activeWorkDays,
      scoreReasons: candidate.scoreReasons || []
    });
    const score = scored.score;
    return {
      ...candidate,
      score,
      ...schedulingQualityBand(score, true),
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
      hasSameAuthorityDay: scored.hasSameAuthorityDay
    };
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
  const result = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: periodCourse,
    existingActivities: occupiedPeriodMeetings,
    travel,
    validateTravel: !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined),
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
    activeWorkDays: projectedLoad.workDays
  };
}

function enrichCandidate(candidate, { eligibleCandidateCount = 0, urgency = null, rank = null } = {}) {
  const empId = text(candidate.instructor?.emp_id);
  const recommended = candidate.eligible && Number(candidate.score) >= 60;
  return {
    ...candidate,
    empId,
    instructorName: candidate.instructor?.full_name || '',
    totalScore: candidate.score,
    recommended,
    bestAvailable: candidate.eligible && !recommended,
    eligibleCandidateCount,
    urgencyBand: urgency?.urgencyBand ?? null,
    daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
    nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
    rank
  };
}

function candidateMap({ courses, instructors, profiles = {}, rules = {}, exceptions = {}, assignedRows, input, cache }) {
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const output = new Map();
  const urgencyByCourse = new Map();
  const referenceDate = input.referenceDate || input.now || null;

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
    const rescored = rescoreWithPeers(rawCandidates, course);
    const eligibleCount = rescored.filter(isSafeEligibleCandidate).length;
    const urgency = urgencyByCourse.get(idOf(course));
    const ranked = [...rescored]
      .filter((candidate) => candidate.eligible)
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));
    const rankMap = new Map(ranked.map((candidate, index) => [text(candidate.instructor.emp_id), index + 1]));
    output.set(idOf(course), rescored.map((candidate) => enrichCandidate(candidate, {
      eligibleCandidateCount: eligibleCount,
      urgency,
      rank: rankMap.get(text(candidate.instructor?.emp_id)) || null
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
    .map(([courseId]) => ordered.find((row) => idOf(row) === courseId))
    .filter(Boolean);
}

function summarizeState(state, ordered, urgencyByCourse, maps) {
  let urgency7Missed = 0;
  let urgency14Missed = 0;
  let scarceMissed = 0;
  let sameSchoolCount = 0;
  let sameAuthorityCount = 0;
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

  for (const course of ordered) {
    const courseId = idOf(course);
    const urgency = urgencyByCourse.get(courseId) || {};
    const eligibleCount = (maps.get(courseId) || []).filter(isSafeEligibleCandidate).length;
    const selected = state.draft.get(courseId);
    if (!selected) {
      if (urgency.urgencyRank === 1) urgency7Missed += 1;
      else if (urgency.urgencyRank === 2) urgency14Missed += 1;
      if (eligibleCount > 0 && eligibleCount <= 1) scarceMissed += 1;
      continue;
    }
    sameSchoolCount += selected.hasSameSchoolDay ? 1 : 0;
    sameAuthorityCount += selected.hasSameAuthorityDay ? 1 : 0;
    // Unknown/uncomputed travel must not beat a known route in the lex travel objective.
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
    scarceMissed,
    sameSchoolCount,
    sameAuthorityCount,
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
  const { output: maps, urgencyByCourse } = candidateMap({
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
    const firstEligible = maps.get(idOf(first)).filter(isSafeEligibleCandidate).length;
    const secondEligible = maps.get(idOf(second)).filter(isSafeEligibleCandidate).length;
    if (firstEligible !== secondEligible) return firstEligible - secondEligible;
    return idOf(first).localeCompare(idOf(second));
  });

  const baselineLoads = new Map(instructors.map((instructor) => {
    const empId = text(instructor.emp_id);
    return [empId, cache.hoursByInstructor.get(empId) || 0];
  }));

  let states = [summarizeState({ draft: new Map(), loads: new Map(baselineLoads) }, ordered, urgencyByCourse, maps)];
  for (const course of ordered) {
    const expanded = [];
    for (const state of states) {
      expanded.push(state);
      const candidates = maps.get(idOf(course))
        .filter(isSafeEligibleCandidate)
        .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second));

      for (const candidate of candidates) {
        const empId = text(candidate.instructor.emp_id);
        const draftRows = draftRowsForInstructor(state, empId, ordered);
        const evaluated = rescoreWithPeers([evaluateCandidate({
          course,
          instructor: candidate.instructor,
          assignedRows,
          draftRows,
          profiles,
          rules,
          exceptions,
          input,
          cache
        })], course)[0];
        if (!isSafeEligibleCandidate(evaluated)) continue;

        const draft = new Map(state.draft);
        draft.set(idOf(course), enrichCandidate(evaluated, {
          eligibleCandidateCount: candidate.eligibleCandidateCount,
          urgency: urgencyByCourse.get(idOf(course)),
          rank: candidate.rank
        }));
        const loads = new Map(state.loads);
        loads.set(empId, evaluated.projectedHalfHours);
        expanded.push(summarizeState({ draft, loads }, ordered, urgencyByCourse, maps));
      }
    }
    states = expanded
      .sort(compareOptimizationStates)
      .slice(0, 200);
  }

  const bestState = states[0] || { draft: new Map() };
  const refreshCandidate = (course, instructor) => {
    const empId = text(instructor.emp_id);
    const evaluated = rescoreWithPeers([evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: draftRowsForInstructor(bestState, empId, ordered, idOf(course)),
      profiles,
      rules,
      exceptions,
      input,
      cache
    })], course)[0];
    const baseline = (maps.get(idOf(course)) || []).find((row) => text(row.instructor?.emp_id) === empId);
    return enrichCandidate(evaluated, {
      eligibleCandidateCount: baseline?.eligibleCandidateCount || (maps.get(idOf(course)) || []).filter(isSafeEligibleCandidate).length,
      urgency: urgencyByCourse.get(idOf(course)),
      rank: baseline?.rank || null
    });
  };

  return courses.map((course) => {
    const id = idOf(course);
    const missing = incomplete.get(id);
    if (missing.length) return { course, status: 'חסר מידע', missing, recommended: null, alternatives: [], checked: [] };

    const checked = maps.get(id) || [];
    const selected = bestState.draft.get(id) || null;
    const selectedCandidate = selected ? refreshCandidate(course, selected.instructor) : null;
    const recommended = selectedCandidate?.score >= 60 ? { ...selectedCandidate, recommended: true, bestAvailable: false } : null;
    const bestAvailable = recommended ? null : (selectedCandidate ? { ...selectedCandidate, recommended: false, bestAvailable: true } : null);
    const primary = recommended || bestAvailable;
    const alternatives = checked
      .filter((candidate) => candidate.eligible && text(candidate.instructor.emp_id) !== text(primary?.instructor?.emp_id))
      .map((candidate) => refreshCandidate(course, candidate.instructor))
      .filter((candidate) => candidate.eligible)
      .sort((first, second) => (second.score - first.score) || compareCandidatesStable(first, second))
      .slice(0, bestAvailable ? 2 : 3);
    const incompleteProfiles = checked.filter((candidate) => !candidate.failures.length && candidate.missingProfileData.length);
    const urgency = urgencyByCourse.get(id);

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
      eligibleCandidateCount: checked.filter(isSafeEligibleCandidate).length,
      urgencyBand: urgency?.urgencyBand ?? null,
      daysUntilNextMeeting: urgency?.daysUntilNextMeeting ?? null,
      nextUpcomingMeetingDate: urgency?.nextUpcomingMeetingDate ?? null,
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
