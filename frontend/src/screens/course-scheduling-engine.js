import { evaluateInstructor, adjacentActivities } from './instructor-matching-engine.js';
import { activityMeetings, isoWeekKey } from './instructor-scheduling-load.js';
import { routeMatrixKey } from './course-scheduling-travel.js';
import { isActivitySchedulingEligible, isSchedulingBlockingAssignment, isSchedulingDraftAssignment } from './shared/activity-scheduling-eligibility.js';

const text = (value) => String(value ?? '').trim();
const minutes = (value) => {
  const [hours, mins] = text(value).split(':').map(Number);
  return hours * 60 + mins;
};
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (row) => text(row?.emp_id);
// Canonical resolved address only — school display names are not travel locations.
const placeOf = (row = {}) => text(row.school_address);

export function schedulingCourses(rows = []) {
  return rows.filter(isActivitySchedulingEligible);
}

export function schedulingInstructors(rows = []) {
  return rows.filter((row) => text(row?.active).toLowerCase() === 'yes');
}

export function missingCourseInformation(activity) {
  const missing = [];
  if (!text(activity?.school)) missing.push('בית ספר');
  if (!text(activity?.school_address)) missing.push('כתובת בית הספר');
  const meetings = activityMeetings(activity);
  if (!meetings.length) missing.push('תאריכי מפגשים');
  if (!meetings.length || meetings.some((meeting) => !text(meeting.start_time || activity?.start_time) || !text(meeting.end_time || activity?.end_time))) missing.push('שעות');
  // Missing instruction_language is not a blocker: resolveInstructionLanguage defaults to he.
  if (!text(activity?.education_level) && !text(activity?.grade)) missing.push('שכבת גיל');
  return [...new Set(missing)];
}

function meetingHours(meeting, activity = {}) {
  const start = minutes(meeting.start_time || activity.start_time);
  const end = minutes(meeting.end_time || activity.end_time);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0;
}

export function availabilityHours(profile = {}, rules = []) {
  // A personal weekly target/max (spec section 16) takes priority over raw availability
  // when the instructor's profile has one, but stays fully backward compatible: neither
  // field is required, and 0/unset falls straight back to summed weekly availability.
  const personalCapacity = Number(profile?.weekly_max_hours ?? profile?.weekly_target_hours);
  if (Number.isFinite(personalCapacity) && personalCapacity > 0) return personalCapacity;
  const availableRules = rules.filter((rule) => rule.available && Number(rule.weekday) !== 6);
  if (!availableRules.length) return 0;
  return availableRules.reduce((sum, rule) => sum + Math.max(0, minutes(rule.end_time) - minutes(rule.start_time)) / 60, 0);
}

export function instructorLoad(assignments = [], profile = {}, rules = []) {
  const weekHours = new Map();
  const weekDays = new Map();
  let hours = 0;
  let meetings = 0;
  const workDates = new Set();

  for (const activity of assignments) {
    for (const meeting of activityMeetings(activity)) {
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

function meetingAssignments(rows = []) {
  return rows.flatMap((activity) => activityMeetings(activity).map((meeting) => ({
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
  return { home: base?.home || null, transitions };
}

function fairnessVariance(loads = new Map()) {
  const values = [...loads.values()].map(Number).filter(Number.isFinite);
  if (!values.length) return 0;
  const average = averageFinite(values);
  return values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
}

function evaluateCandidate({ course, instructor, assignedRows, draftRows, profiles, rules, exceptions, input, averageRatio }) {
  const empId = text(instructor.emp_id);
  const occupiedRows = [...(assignedRows[empId] || []), ...(draftRows || [])];
  const load = instructorLoad([...occupiedRows, course], profiles[empId], rules[empId] || []);
  const occupiedMeetings = meetingAssignments(occupiedRows);
  const travel = dynamicTravel(course, instructor, occupiedMeetings, input);
  const result = evaluateInstructor({
    instructor,
    profile: profiles[empId],
    rules: rules[empId] || [],
    exceptions: exceptions[empId] || [],
    activity: course,
    existingActivities: occupiedMeetings,
    travel,
    validateTravel: !input.preliminary,
    workloadRatio: load.maxRatio,
    averageWorkloadRatio: averageRatio,
    fixedCourseCount: load.courseCount,
    weeklyWorkDayCount: load.maxWeekDayCount
  });
  return { ...result, instructor, load };
}

function candidateMap({ courses, instructors, profiles = {}, rules = {}, exceptions = {}, assignedRows, input }) {
  const baselineLoads = new Map(instructors.map((instructor) => {
    const empId = text(instructor.emp_id);
    return [empId, instructorLoad(assignedRows[empId] || [], profiles[empId], rules[empId] || []).maxRatio];
  }));
  const averageRatio = averageFinite([...baselineLoads.values()]);
  const output = new Map();

  for (const course of courses) {
    output.set(idOf(course), instructors.map((instructor) => evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: [],
      profiles,
      rules,
      exceptions,
      input,
      averageRatio
    })));
  }
  return { output, baselineLoads, averageRatio };
}

function draftRowsForInstructor(state, empId, ordered, excludeCourseId = '') {
  return [...state.draft.entries()]
    .filter(([courseId, candidate]) => courseId !== excludeCourseId && text(candidate.instructor.emp_id) === empId)
    .map(([courseId]) => ordered.find((row) => idOf(row) === courseId))
    .filter(Boolean);
}

export function calculateCourseSchedule(input = {}) {
  const activities = input.activities || [];
  const courses = schedulingCourses(activities);
  const instructors = schedulingInstructors(input.instructors || []);
  const assignedRows = assignedRowsByInstructor(activities, input.assignments || {});
  const profiles = input.profiles || {};
  const rules = input.rules || {};
  const exceptions = input.exceptions || {};
  const incomplete = new Map(courses.map((course) => [idOf(course), missingCourseInformation(course)]));
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
        const evaluated = evaluateCandidate({
          course,
          instructor: candidate.instructor,
          assignedRows,
          draftRows,
          profiles,
          rules,
          exceptions,
          input,
          averageRatio
        });
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
    return evaluateCandidate({
      course,
      instructor,
      assignedRows,
      draftRows: draftRowsForInstructor(bestState, empId, ordered, idOf(course)),
      profiles,
      rules,
      exceptions,
      input,
      averageRatio
    });
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
    const incompleteProfiles = checked.filter((candidate) => candidate.missingProfileData.length);

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
        : ''
    };
  });
}

export function preliminaryCourseCandidates(input = {}) {
  const results = calculateCourseSchedule({ ...input, travel: {}, routeMatrix: {}, preliminary: true });
  return results.flatMap((result) => result.checked
    .filter((candidate) => candidate.eligible)
    .map((candidate) => ({ course: result.course, candidate })));
}
