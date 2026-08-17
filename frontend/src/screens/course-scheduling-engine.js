import { evaluateInstructor, adjacentActivities } from './instructor-matching-engine.js';
import { activityMeetings, isoWeekKey } from './instructor-scheduling-load.js';
import { routeMatrixKey } from './course-scheduling-travel.js';
import {
  hasDraftInstructor,
  isSchedulingReadyActivity,
  isSchedulingReadyInstructor,
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment
} from './shared/activity-scheduling-eligibility.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, isDateInCourseSchedulingPeriod, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import { effectiveEndTime, proposeDateAdjustments } from './course-scheduling-date-adjustments.js';
import {
  computeSchedulingScore,
  courseUrgency,
  compareCandidatesStable
} from './course-scheduling-score.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';

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
  const includeIncompleteWithoutPeriodMeetings = !!options.includeIncompleteWithoutPeriodMeetings;
  return rows.filter(isSchedulingReadyActivity)
    .filter((row) => !hasDraftInstructor(row))
    .filter((row) => !authority || text(row.authority) === authority)
    .filter((row) => !district || districtOf(row) === district)
    .filter((row) => {
      const meetings = activityMeetings(row);
      if (meetings.some((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey))) return true;
      // District simulation must still surface courses that lack dates/hours as חסרים נתונים.
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
  return rows.flatMap((activity) => activityMeetings(activity?.draft_emp_id && Array.isArray(activity.draft_proposed_meetings)
    ? { ...activity, meetings: activity.draft_proposed_meetings }
    : activity)
    .filter((meeting) => options.allDates || isDateInCourseSchedulingPeriod(meeting.date, periodKey))
    .map((meeting) => ({
      ...meeting,
      end_time: effectiveEndTime(text(meeting.date).slice(0, 10), meeting.end_time || activity.end_time, schoolCalendar),
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
  for (const row of rows.filter(isSchedulingDraftAssignment)) {
    add(text(row.draft_emp_id), row);
  }
  return assigned;
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
      // Route that existed before inserting the course. Subtracting this leg is
      // what turns surrounding travel into the course's real incremental travel.
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

/** Planning-state activity row — prefers proposed meetings of a selected candidate. */
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

/** Internal planning recommendations only (unsaved automatic picks). */
function planningRowsForInstructor(planningDraft, empId, ordered, excludeCourseId = '') {
  return [...planningDraft.entries()]
    .filter(([courseId, candidate]) => courseId !== excludeCourseId && text(candidate.instructor?.emp_id) === empId)
    .map(([courseId, candidate]) => {
      const course = ordered.find((row) => idOf(row) === courseId);
      return draftActivityFromCandidate(course, candidate);
    })
    .filter(Boolean);
}

function evaluateCandidate({
  course,
  instructor,
  assignedRows,
  planningRows,
  profiles,
  rules,
  exceptions,
  input
}) {
  const empId = text(instructor.emp_id);
  // A: persisted schedule only — approved assignments + saved drafts.
  const persistedRows = [...(assignedRows[empId] || [])];
  // Unsaved automatic recommendations are intentionally ignored. Only approved
  // assignments and drafts that the user actually saved may affect another course.
  void planningRows;
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const allMeetings = activityMeetings(course);
  const periodMeetings = allMeetings.filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey));
  const originalPeriodCourse = { ...course, meetings: periodMeetings };
  const meetingOptions = { periodKey, allDates: true, schoolCalendar: input.schoolCalendar || [] };
  const persistedMeetings = meetingAssignments(persistedRows, meetingOptions);
  const adjustmentInput = {
    meetings: allMeetings,
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    schoolCalendar: input.schoolCalendar || [],
    existingActivities: persistedMeetings,
    halfEnd: resolveCourseSchedulingPeriod(periodKey).end
  };
  let adjustment = proposeDateAdjustments(adjustmentInput);
  if (adjustment?.valid) {
    const destination = placeOf(course);
    const transitions = Object.fromEntries(adjustment.meetings.map((meeting) => {
      const { previous, next } = adjacentActivities(persistedMeetings, meeting);
      return [meeting.date, {
        previous: previous ? { ...previous, ...routeLeg(input.routeMatrix || {}, placeOf(previous), destination, sameSchool(previous, course)) } : null,
        next: next ? { ...next, ...routeLeg(input.routeMatrix || {}, destination, placeOf(next), sameSchool(course, next)) } : null
      }];
    }));
    adjustment = proposeDateAdjustments({ ...adjustmentInput, transitions });
  }
  const periodCourse = adjustment?.valid ? { ...course, meetings: adjustment.meetings } : originalPeriodCourse;

  // User-facing workload / workdays: persisted rows (+ current course for projected) only.
  const persistedBaselineLoad = instructorLoad(persistedRows, profiles[empId], rules[empId] || [], { periodKey });
  const persistedProjectedLoad = instructorLoad([...persistedRows, periodCourse], profiles[empId], rules[empId] || [], { periodKey });
  const persistedPeriodMeetings = meetingAssignments(persistedRows, { periodKey, schoolCalendar: input.schoolCalendar || [] });
  // Hard-gate must inspect every active meeting of the course, not only those inside
  // the selected half-year window.  The period filter is for display/planning only.
  // allMeetingsCourse: when a date adjustment is valid its meetings already span the
  // full adjusted schedule; otherwise fall back to all non-cancelled course meetings.
  const plannerAllMeetings = meetingAssignments(persistedRows, meetingOptions);
  const allMeetingsCourse = adjustment?.valid ? periodCourse : { ...course, meetings: allMeetings };
  const gateTravel = dynamicTravel(allMeetingsCourse, instructor, plannerAllMeetings, input);
  // Persisted-period travel is kept for UI display.  Planner-period travel feeds soft scoring.
  const travel = dynamicTravel(periodCourse, instructor, persistedPeriodMeetings, input);
  const gate = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: allMeetingsCourse,
    existingActivities: plannerAllMeetings,
    travel: gateTravel,
    validateTravel: !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined)
  });
  if (adjustment && !adjustment.valid) {
    gate.failures = [...new Set([...(gate.failures || []), adjustment.reason])];
    gate.eligible = false;
    gate.score = null;
    gate.scoreBreakdown = null;
  }

  const eligible = !!gate.eligible;
  const scored = computeSchedulingScore({
    eligible,
    activity: periodCourse,
    meetings: activityMeetings(periodCourse),
    existingActivities: persistedPeriodMeetings,
    travel,
    workDates: persistedBaselineLoad.workDates || new Set(),
    dateAdjustment: adjustment?.valid ? adjustment : null,
    currentHalfHours: persistedBaselineLoad.hours,
    projectedHalfHours: persistedProjectedLoad.hours,
    availabilityHours: persistedProjectedLoad.availabilityHours,
    projectedWeeklyHours: Math.max(0, ...Object.values(persistedProjectedLoad.weekHours)),
    utilizationRatio: persistedProjectedLoad.maxRatio,
    seniorityYears: instructor.seniority_years ?? profiles[empId]?.seniority_years,
    activeWorkDays: persistedProjectedLoad.workDays,
    existingWorkDays: persistedBaselineLoad.workDays,
    projectedWorkDays: persistedProjectedLoad.workDays
  });

  return {
    ...gate,
    eligible,
    score: scored.score,
    totalScore: scored.totalScore,
    qualityBand: eligible ? 'eligible' : null,
    qualityLabel: eligible ? 'מתאים' : null,
    scoreBreakdown: scored.scoreBreakdown,
    recommendationReason: scored.recommendationReason,
    instructor,
    load: persistedProjectedLoad,
    baselineWorkDates: persistedBaselineLoad.workDates || new Set(),
    travel,
    periodCourse,
    originalPeriodCourse,
    // User-facing / hard-gate neighbors: persisted only. Soft scorer keeps planner meetings separately.
    existingMeetings: persistedPeriodMeetings,
    plannerMeetings: persistedPeriodMeetings,
    planningMeetings: [],
    persistedRows,
    planningRows: [],
    dateAdjustment: adjustment?.valid ? adjustment : null,
    proposedMeetings: adjustment?.valid ? adjustment.meetings : null,
    currentHalfHours: scored.currentHalfHours,
    projectedHalfHours: scored.projectedHalfHours,
    plannerCurrentHalfHours: persistedBaselineLoad.hours,
    plannerProjectedHalfHours: persistedProjectedLoad.hours,
    availabilityHours: scored.availabilityHours,
    projectedWeeklyHours: scored.projectedWeeklyHours,
    utilizationRatio: scored.utilizationRatio,
    seniorityYears: scored.seniorityYears,
    activeWorkDays: scored.activeWorkDays,
    existingWorkDays: scored.existingWorkDays,
    projectedWorkDays: scored.projectedWorkDays,
    relevantTravelMinutes: scored.relevantTravelMinutes,
    relevantTravelDistance: scored.relevantTravelDistance,
    movedMeetingsCount: scored.movedMeetingsCount,
    totalShiftDays: scored.totalShiftDays,
    halfOverflow: scored.halfOverflow,
    sameSchoolMeetingCount: scored.sameSchoolMeetingCount,
    sameAuthorityMeetingCount: scored.sameAuthorityMeetingCount,
    nearbyMeetingCount: scored.nearbyMeetingCount,
    existingWorkDayMeetingCount: scored.existingWorkDayMeetingCount,
    newWorkDayMeetingCount: scored.newWorkDayMeetingCount,
    continuityMeetingCount: scored.continuityMeetingCount,
    opensNewWorkDay: scored.opensNewWorkDay,
    nonTravelWaitingMinutes: scored.nonTravelWaitingMinutes
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

function evaluateCourseCandidates({
  course,
  instructors,
  assignedRows,
  planningDraft,
  ordered,
  profiles,
  rules,
  exceptions,
  input
}) {
  const raw = instructors.map((instructor) => evaluateCandidate({
    course,
    instructor,
    assignedRows,
    planningRows: planningRowsForInstructor(planningDraft, text(instructor.emp_id), ordered),
    profiles,
    rules,
    exceptions,
    input
  }));
  return rescoreEligiblePeers(raw, course);
}

/**
 * Stage 3 sequential planner: order courses by urgency/scarcity, score instructors,
 * recommend one primary + up to three alternatives. Temporary planning state only.
 */
export function calculateCourseSchedule(input = {}) {
  const activities = input.activities || [];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const courses = schedulingCourses(activities, {
    periodKey,
    authority: input.authority,
    district: input.district,
    includeIncompleteWithoutPeriodMeetings: !!input.includeIncompleteWithoutPeriodMeetings
  });
  const profiles = input.profiles || {};
  const rules = input.rules || {};
  const instructors = schedulingInstructors(input.instructors || [], profiles, rules);
  const assignedRows = assignedRowsByInstructor(activities, input.assignments || {});
  const exceptions = input.exceptions || {};
  const incomplete = new Map(courses.map((course) => [idOf(course), missingCourseInformation(course, { periodKey })]));
  const ready = courses.filter((course) => !incomplete.get(idOf(course)).length);
  const referenceDate = input.referenceDate || input.now || null;
  const urgencyByCourse = new Map(ready.map((course) => [idOf(course), courseUrgency(course, referenceDate)]));

  // Baseline eligibility counts — against approved/draft only, before planning recommendations.
  const baselineEligibleCount = new Map();
  for (const course of ready) {
    const baseline = evaluateCourseCandidates({
      course,
      instructors,
      assignedRows,
      planningDraft: new Map(),
      ordered: ready,
      profiles,
      rules,
      exceptions,
      input
    });
    baselineEligibleCount.set(idOf(course), baseline.filter((candidate) => candidate.eligible).length);
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

  const planningDraft = new Map();
  const resultsById = new Map();

  for (const course of ordered) {
    const courseId = idOf(course);
    const urgency = urgencyByCourse.get(courseId);
    const stateBeforeCourse = new Map(planningDraft);
    const evaluated = evaluateCourseCandidates({
      course,
      instructors,
      assignedRows,
      planningDraft: stateBeforeCourse,
      ordered,
      profiles,
      rules,
      exceptions,
      input
    });
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

    // Do not feed this unsaved recommendation into later courses. A subsequent
    // calculation will see it only after it has been persisted as a saved draft.
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

  // Ready courses are returned in planning order; incomplete courses follow.
  return [...ordered.map((course) => resultsById.get(idOf(course))), ...incompleteResults];
}

export function preliminaryCourseCandidates(input = {}) {
  const results = calculateCourseSchedule({ ...input, travel: {}, routeMatrix: {}, preliminary: true });
  return results.flatMap((result) => result.checked
    .filter((candidate) => candidate.eligible)
    .map((candidate) => ({ course: result.course, candidate })));
}
