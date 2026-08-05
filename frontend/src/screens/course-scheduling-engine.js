import { evaluateInstructor, adjacentActivities } from './instructor-matching-engine.js';
import { activityMeetings, isoWeekKey } from './instructor-scheduling-load.js';
import { routeMatrixKey } from './course-scheduling-travel.js';
import { isActivitySchedulingEligible, isSchedulingBlockingAssignment, isSchedulingDraftAssignment } from './shared/activity-scheduling-eligibility.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, isDateInCourseSchedulingPeriod } from './course-scheduling-periods.js';

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
    for (const meeting of activityMeetings(activity).filter((item) => isDateInCourseSchedulingPeriod(item.date, periodKey))) {
      const duration = meetingHours(meeting, activity);
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
  return rows.flatMap((activity) => activityMeetings(activity)
    .filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey))
    .map((meeting) => ({
    ...meeting,
    activity_id: idOf(activity),
    school: activity.school,
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


function courseWeekHours(load = {}, course = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const weeks = new Set(activityMeetings(course).filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey)).map((meeting) => isoWeekKey(meeting.date)).filter(Boolean));
  const weekHours = load.weekHours || {};
  return [...weeks].reduce((sum, week) => sum + (Number(weekHours[week]) || 0), 0);
}

function linearLowLoadPoints(value, min, max, points) {
  if (!Number.isFinite(value)) return 0;
  if (min === max) return points;
  return Math.max(0, Math.min(points, points * (max - value) / (max - min)));
}

function applyWorkloadPoints(candidates = [], course = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  const eligible = candidates.filter((candidate) => candidate.eligible);
  const totals = eligible.map((candidate) => Number(candidate.load?.hours) || 0);
  const weeks = eligible.map((candidate) => courseWeekHours(candidate.load, course, periodKey));
  const minTotal = Math.min(...totals);
  const maxTotal = Math.max(...totals);
  const minWeek = Math.min(...weeks);
  const maxWeek = Math.max(...weeks);
  return candidates.map((candidate) => {
    if (!candidate.eligible) return candidate;
    const totalHours = Number(candidate.load?.hours) || 0;
    const courseWeeksHours = courseWeekHours(candidate.load, course, periodKey);
    const totalHoursPoints = linearLowLoadPoints(totalHours, minTotal, maxTotal, 12);
    const courseWeeksPoints = linearLowLoadPoints(courseWeeksHours, minWeek, maxWeek, 8);
    const workload = {
      points: totalHoursPoints + courseWeeksPoints,
      totalHoursPoints,
      courseWeeksPoints,
      totalHours,
      courseWeeksHours
    };
    const baseWithoutWorkload = (candidate.scoreBreakdown?.distance?.points || 0)
      + (candidate.scoreBreakdown?.continuity?.points || 0)
      + (candidate.scoreBreakdown?.seniority?.points || 0);
    return {
      ...candidate,
      score: Math.round(baseWithoutWorkload + workload.points),
      workloadPoints: workload,
      scoreBreakdown: candidate.scoreBreakdown ? { ...candidate.scoreBreakdown, workload: { ...candidate.scoreBreakdown.workload, ...workload, points: Math.round(workload.points) } } : candidate.scoreBreakdown
    };
  });
}

function evaluateCandidate({ course, instructor, assignedRows, draftRows, profiles, rules, exceptions, input, averageRatio }) {
  const empId = text(instructor.emp_id);
  const occupiedRows = [...(assignedRows[empId] || []), ...(draftRows || [])];
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const periodMeetings = activityMeetings(course).filter((meeting) => isDateInCourseSchedulingPeriod(meeting.date, periodKey));
  const periodCourse = { ...course, meetings: periodMeetings };
  const load = instructorLoad([...occupiedRows, periodCourse], profiles[empId], rules[empId] || [], { periodKey });
  const occupiedMeetings = meetingAssignments(occupiedRows, { periodKey });
  const travel = dynamicTravel(periodCourse, instructor, occupiedMeetings, input);
  const result = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: periodCourse,
    existingActivities: occupiedMeetings,
    travel,
    validateTravel: !input.preliminary && (input.travel !== undefined || input.routeMatrix !== undefined),
    workloadRatio: load.maxRatio,
    averageWorkloadRatio: averageRatio,
    fixedCourseCount: load.courseCount,
    weeklyWorkDayCount: load.maxWeekDayCount
  });
  // Persist the exact travel object used for scoring so the UI never shows a different route.
  return { ...result, instructor, load, travel, periodCourse };
}

function candidateMap({ courses, instructors, profiles = {}, rules = {}, exceptions = {}, assignedRows, input }) {
  const periodKey = input.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
  const baselineLoads = new Map(instructors.map((instructor) => {
    const empId = text(instructor.emp_id);
    const load = instructorLoad(assignedRows[empId] || [], profiles[empId], rules[empId] || [], { periodKey });
    return [empId, load.maxRatio];
  }));
  const baselineAverageRatio = averageFinite([...baselineLoads.values()]);
  const averageRatio = baselineAverageRatio > 0 ? baselineAverageRatio : null;
  const output = new Map();

  for (const course of courses) {
    const rawCandidates = instructors.map((instructor) => evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: [],
      profiles,
      rules,
      exceptions,
      input,
      averageRatio
    }));
    output.set(idOf(course), applyWorkloadPoints(rawCandidates, course, periodKey));
  }
  return { output, baselineLoads, averageRatio };
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
  const { output: maps, baselineLoads, averageRatio } = candidateMap({
    courses: ready,
    instructors,
    profiles,
    rules,
    exceptions,
    assignedRows,
    input
  });

  const ordered = [...ready].sort((first, second) =>
    maps.get(idOf(first)).filter((candidate) => candidate.eligible).length
      - maps.get(idOf(second)).filter((candidate) => candidate.eligible).length);

  let states = [{ draft: new Map(), score: 0, loads: new Map(baselineLoads), fairness: fairnessVariance(baselineLoads) }];
  for (const course of ordered) {
    const expanded = [];
    for (const state of states) {
      expanded.push(state);
      const candidates = maps.get(idOf(course))
        .filter((candidate) => candidate.eligible)
        .sort((first, second) => second.score - first.score);

      for (const candidate of candidates) {
        const empId = text(candidate.instructor.emp_id);
        const draftRows = draftRowsForInstructor(state, empId, ordered);
        const evaluated = applyWorkloadPoints([evaluateCandidate({
          course,
          instructor: candidate.instructor,
          assignedRows,
          draftRows,
          profiles,
          rules,
          exceptions,
          input,
          averageRatio
        })], course, periodKey)[0];
        if (!evaluated.eligible) continue;

        const draft = new Map(state.draft);
        draft.set(idOf(course), evaluated);
        const loads = new Map(state.loads);
        loads.set(empId, evaluated.load.maxRatio);
        expanded.push({
          draft,
          loads,
          fairness: fairnessVariance(loads),
          score: state.score + evaluated.score
        });
      }
    }
    states = expanded
      .sort((first, second) => second.draft.size - first.draft.size || first.fairness - second.fairness || second.score - first.score)
      .slice(0, 200);
  }

  const bestState = states[0] || { draft: new Map() };
  const refreshCandidate = (course, instructor) => {
    const empId = text(instructor.emp_id);
    return applyWorkloadPoints([evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: draftRowsForInstructor(bestState, empId, ordered, idOf(course)),
      profiles,
      rules,
      exceptions,
      input,
      averageRatio
    })], course, periodKey)[0];
  };

  return courses.map((course) => {
    const id = idOf(course);
    const missing = incomplete.get(id);
    if (missing.length) return { course, status: 'חסר מידע', missing, recommended: null, alternatives: [], checked: [] };

    const checked = maps.get(id) || [];
    const selected = bestState.draft.get(id) || null;
    const recommended = selected ? refreshCandidate(course, selected.instructor) : null;
    const alternatives = checked
      .filter((candidate) => candidate.eligible && text(candidate.instructor.emp_id) !== text(recommended?.instructor?.emp_id))
      .map((candidate) => refreshCandidate(course, candidate.instructor))
      .filter((candidate) => candidate.eligible)
      .sort((first, second) => second.score - first.score)
      .slice(0, 3);
    const incompleteProfiles = checked.filter((candidate) => !candidate.failures.length && candidate.missingProfileData.length);

    return {
      course,
      status: recommended
        ? (recommended.warnings.length ? 'נדרש טיפול' : 'הצעה מוכנה')
        : incompleteProfiles.length ? 'נדרש טיפול' : 'נדרש גיוס',
      recommended,
      alternatives,
      checked,
      incompleteProfiles,
      treatmentReason: !recommended && incompleteProfiles.length
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