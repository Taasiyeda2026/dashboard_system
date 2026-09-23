import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import { compareCandidatesStable } from './course-scheduling-score.js';
import { calculateCandidateTravel, createRouteClient } from './course-scheduling-travel.js';
import { activityMeetings, schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import { blockedSchoolDates, effectiveEndTime } from './course-scheduling-date-adjustments.js';
import { planningPeriodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import {
  isSchedulingActivityActive,
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment,
  schedulingActivityTypeCategory
} from './shared/activity-scheduling-eligibility.js';
import { filterSchoolCalendarRowsBySector } from './shared/school-calendar-logic.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (candidate) => text(candidate?.instructor?.emp_id);
const norm = (value) => text(value).replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
export const DEFAULT_PLANNING_PERIOD_KEY = 'year';
export const PLANNING_OPERATIONAL_START_DATE = '2026-10-06';
const DEFAULT_TIME_SLOTS = ['08:00', '09:30', '11:00', '12:30', '14:00'];
const MAX_TIME_SLOTS_PER_WEEKDAY = 10;
const MAX_SCENARIOS_PER_COURSE = 30;
const MAX_FINAL_OPTIONS = 3;
export const PLANNING_ENGINE_VERSION = 'planning-v5-20260923-start-20261006-fill-instructor-days';
export const PLANNING_ACTIVITY_NO_ALIASES = Object.freeze({
  // Legacy Gefen identifier retained on existing activities; canonical catalog program is 53828.
  '82835': '53828'
});

export function canonicalPlanningActivityNo(value) {
  const raw = text(value);
  return PLANNING_ACTIVITY_NO_ALIASES[raw] || raw;
}

const yieldToBrowser = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
  else setTimeout(resolve, 0);
});

function timeMinutes(value) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(total) {
  const value = Number(total);
  if (!Number.isFinite(value) || value < 0 || value >= 24 * 60) return '';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function addDays(value, days) {
  const date = new Date(`${text(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function weekday(value) {
  const date = new Date(`${text(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getUTCDay();
}

function validTimeRange(startTime, endTime) {
  const start = timeMinutes(startTime);
  const end = timeMinutes(endTime);
  return start != null && end != null && end > start;
}

export function planningEffectivePeriod(periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const period = resolveCourseSchedulingPeriod(periodKey);
  return {
    ...period,
    start: period.start < PLANNING_OPERATIONAL_START_DATE
      ? PLANNING_OPERATIONAL_START_DATE
      : period.start
  };
}

function meetingCount(activity = {}) {
  const configured = Number(activity.sessions);
  if (Number.isFinite(configured) && configured > 0) return Math.min(35, Math.floor(configured));
  return activityMeetings(activity).length;
}

function parseUnitDurationMinutes(value) {
  const raw = text(value);
  if (!raw) return null;
  const minutesMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:דק|דקות|minute|min)/i);
  if (minutesMatch) return Number(minutesMatch[1]);
  const hoursMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:שעה|שעות|hour|hr)/i);
  if (hoursMatch) return Number(hoursMatch[1]) * 60;
  return null;
}

function roundedDurationMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(30, Math.round(num / 15) * 15);
}

export function planningCatalogIndex(rows = []) {
  const byActivityNo = new Map();
  const byName = new Map();
  for (const row of rows || []) {
    for (const identifier of [row?.activity_no, row?.gefen_number, row?.pricing_key]) {
      const raw = text(identifier);
      const canonical = canonicalPlanningActivityNo(raw);
      if (raw && !byActivityNo.has(raw)) byActivityNo.set(raw, row);
      if (canonical && !byActivityNo.has(canonical)) byActivityNo.set(canonical, row);
    }
    for (const name of [row?.activity_name, row?.program_name, row?.name, row?.title]) {
      const key = norm(name);
      if (key && !byName.has(key)) byName.set(key, row);
    }
  }
  return { byActivityNo, byName };
}

function catalogRowForActivity(activity = {}, catalogIndex = planningCatalogIndex()) {
  for (const identifier of [activity.activity_no, activity.gefen_number]) {
    const raw = text(identifier);
    const canonical = canonicalPlanningActivityNo(raw);
    if (raw && catalogIndex.byActivityNo?.has(raw)) return catalogIndex.byActivityNo.get(raw);
    if (canonical && catalogIndex.byActivityNo?.has(canonical)) return catalogIndex.byActivityNo.get(canonical);
  }
  return catalogIndex.byName?.get(norm(activity.activity_name || activity.program_name || activity.name)) || null;
}

export function inferPlanningCourseSpec(activity = {}, catalogRows = []) {
  const catalogIndex = catalogRows?.byActivityNo instanceof Map ? catalogRows : planningCatalogIndex(catalogRows);
  const catalog = catalogRowForActivity(activity, catalogIndex);
  const activityCategory = schedulingActivityTypeCategory(activity.activity_type || activity.type);
  const oneDayActivity = activityCategory === 'workshop' || activityCategory === 'tour';
  const sessions = meetingCount(activity)
    || (Number(catalog?.meetings_count) > 0 ? Math.min(35, Math.floor(Number(catalog.meetings_count))) : 0)
    || (oneDayActivity ? 1 : 0);

  let durationMinutes = null;
  if (validTimeRange(activity.start_time, activity.end_time)) {
    durationMinutes = timeMinutes(activity.end_time) - timeMinutes(activity.start_time);
  } else if (Number(catalog?.hours_count) > 0 && Number(catalog?.meetings_count) > 0) {
    durationMinutes = (Number(catalog.hours_count) * 60) / Number(catalog.meetings_count);
  } else {
    durationMinutes = parseUnitDurationMinutes(catalog?.unit_duration);
    if (durationMinutes == null && oneDayActivity && Number(catalog?.hours_count) > 0) {
      durationMinutes = Number(catalog.hours_count) * 60;
    }
  }

  const roundedDuration = roundedDurationMinutes(durationMinutes);
  return {
    sessions,
    durationMinutes: roundedDuration,
    catalog,
    activityCategory,
    complete: sessions > 0 && roundedDuration != null
  };
}

export function isPlanningActivity(activity = {}) {
  return String(activity.activity_season || '') === 'school_2027'
    && isSchedulingActivityActive(activity)
    && !!schedulingActivityTypeCategory(activity.activity_type || activity.type);
}

// Backward-compatible export name for older callers/tests.
export const isPlanningCourse = isPlanningActivity;

export function planningWorkspaceCourses(activities = [], district = '', periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const normalizedDistrict = normalizeOperationalDistrict(district);
  const period = planningEffectivePeriod(periodKey);
  return (activities || [])
    .filter(isPlanningActivity)
    .filter((activity) => {
      const meetings = schedulingCalendarMeetings(activity);
      if (!meetings.length) return true;
      return meetings.some((meeting) => {
        const date = text(meeting?.date).slice(0, 10);
        return date >= period.start && date <= period.end;
      });
    })
    .filter((activity) => !normalizedDistrict || normalizeOperationalDistrict(activity.district || activity.school_district || activity.authority_district) === normalizedDistrict);
}

export function hasOfficialPlanningSchedule(activity = {}) {
  const meetings = activityMeetings(activity);
  return meetings.length > 0 && meetings.every((meeting) =>
    validTimeRange(meeting?.start_time || activity.start_time, meeting?.end_time || activity.end_time)
  );
}

function courseCalendarRows(activity = {}, schoolCalendar = []) {
  return filterSchoolCalendarRowsBySector(schoolCalendar || [], activity.calendar_sector);
}

export function buildWeeklyPlanningMeetings({
  activity = {},
  startDate = '',
  startTime = '',
  durationMinutes = 90,
  sessions = 0,
  schoolCalendar = [],
  periodKey = DEFAULT_PLANNING_PERIOD_KEY
} = {}) {
  const period = planningEffectivePeriod(periodKey);
  const count = Math.max(0, Math.min(35, Math.floor(Number(sessions) || 0)));
  const duration = roundedDurationMinutes(durationMinutes);
  const startMinutes = timeMinutes(startTime);
  if (!count || !duration || startMinutes == null) return null;
  const endTime = formatMinutes(startMinutes + duration);
  if (!endTime) return null;

  const calendarRows = courseCalendarRows(activity, schoolCalendar);
  const blocked = blockedSchoolDates(calendarRows);
  let candidate = text(startDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate) || candidate < period.start || candidate > period.end) return null;
  if (weekday(candidate) === 6) return null;

  const meetings = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) candidate = addDays(candidate, 7);
    let guard = 0;
    while ((weekday(candidate) === 6 || blocked.has(candidate)) && guard++ < 30) {
      candidate = addDays(candidate, 7);
    }
    if (!candidate || candidate > period.end || guard >= 30) return null;
    const cappedEnd = effectiveEndTime(candidate, endTime, calendarRows);
    if (text(cappedEnd).slice(0, 5) !== endTime) return null;
    meetings.push({
      date: candidate,
      meeting_no: index + 1,
      start_time: startTime,
      end_time: endTime
    });
  }

  return {
    meetings,
    startDate: meetings[0]?.date || '',
    endDate: meetings.at(-1)?.date || '',
    startTime,
    endTime
  };
}

export function buildFixedDatePlanningMeetings({
  activity = {},
  startTime = '',
  durationMinutes = 90,
  schoolCalendar = [],
  periodKey = DEFAULT_PLANNING_PERIOD_KEY
} = {}) {
  const period = planningEffectivePeriod(periodKey);
  const duration = roundedDurationMinutes(durationMinutes);
  const startMinutes = timeMinutes(startTime);
  const sourceMeetings = activityMeetings(activity);
  if (!sourceMeetings.length || !duration || startMinutes == null) return null;
  const endTime = formatMinutes(startMinutes + duration);
  if (!endTime) return null;

  const calendarRows = courseCalendarRows(activity, schoolCalendar);
  const blocked = blockedSchoolDates(calendarRows);
  const meetings = [];
  for (let index = 0; index < sourceMeetings.length; index += 1) {
    const date = text(sourceMeetings[index]?.date).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.start || date > period.end) return null;
    if (weekday(date) === 6 || blocked.has(date)) return null;
    const cappedEnd = effectiveEndTime(date, endTime, calendarRows);
    if (text(cappedEnd).slice(0, 5) !== endTime) return null;
    meetings.push({
      date,
      meeting_no: Number(sourceMeetings[index]?.meeting_no) || index + 1,
      start_time: startTime,
      end_time: endTime
    });
  }

  return {
    meetings,
    startDate: meetings[0]?.date || '',
    endDate: meetings.at(-1)?.date || '',
    startTime,
    endTime
  };
}

function firstOnOrAfter(date, targetWeekday) {
  let cursor = text(date).slice(0, 10);
  for (let guard = 0; guard < 8; guard += 1) {
    if (weekday(cursor) === targetWeekday) return cursor;
    cursor = addDays(cursor, 1);
  }
  return '';
}

function lastOnOrBefore(date, targetWeekday) {
  let cursor = text(date).slice(0, 10);
  for (let guard = 0; guard < 8; guard += 1) {
    if (weekday(cursor) === targetWeekday) return cursor;
    cursor = addDays(cursor, -1);
  }
  return '';
}

export function latestFeasiblePlanningStart({ activity = {}, targetWeekday, startTime, durationMinutes, sessions, schoolCalendar = [], periodKey = DEFAULT_PLANNING_PERIOD_KEY } = {}) {
  const period = planningEffectivePeriod(periodKey);
  let candidate = lastOnOrBefore(period.end, targetWeekday);
  while (candidate && candidate >= period.start) {
    const built = buildWeeklyPlanningMeetings({ activity, startDate: candidate, startTime, durationMinutes, sessions, schoolCalendar, periodKey });
    if (built) return candidate;
    candidate = addDays(candidate, -7);
  }
  return '';
}

function blockingActivities(activities = []) {
  return (activities || []).filter((activity) => isSchedulingBlockingAssignment(activity) || isSchedulingDraftAssignment(activity));
}

function blockingMeetings(activities = []) {
  const rows = [];
  for (const activity of blockingActivities(activities)) {
    const source = isSchedulingDraftAssignment(activity)
      ? schedulingCalendarMeetings(activity)
      : activityMeetings(activity);
    for (const meeting of source) {
      rows.push({
        ...meeting,
        emp_id: isSchedulingDraftAssignment(activity) ? text(activity.draft_emp_id) : text(activity.emp_id),
        activity_id: idOf(activity),
        school_id: activity.school_id,
        school: activity.school,
        authority: activity.authority
      });
    }
  }
  return rows;
}

function activeInstructorIds(instructors = []) {
  return new Set((instructors || [])
    .filter((row) => !['no', 'false', '0', 'לא', 'inactive', 'לא פעיל'].includes(text(row?.active).toLocaleLowerCase('he-IL')))
    .map((row) => text(row.emp_id))
    .filter(Boolean));
}

function dynamicTimesForWeekday({
  targetWeekday,
  durationMinutes,
  activity = {},
  instructors = [],
  rules = {},
  activities = []
} = {}) {
  const counts = new Map(DEFAULT_TIME_SLOTS.map((slot) => [slot, 1]));
  const activeIds = activeInstructorIds(instructors);
  const requestedStart = validTimeRange(activity.start_time, activity.end_time) ? text(activity.start_time).slice(0, 5) : '';
  if (requestedStart) counts.set(requestedStart, (counts.get(requestedStart) || 0) + 50);

  for (const empId of activeIds) {
    const weekdayRules = (rules[empId] || []).filter((rule) =>
      Number(rule.weekday) === Number(targetWeekday) && rule.available === true
    );
    for (const rule of weekdayRules) {
      const from = timeMinutes(rule.start_time);
      const to = timeMinutes(rule.end_time);
      if (from == null || to == null || to - from < durationMinutes) continue;
      for (let minute = from; minute + durationMinutes <= to; minute += 30) {
        const slot = formatMinutes(minute);
        counts.set(slot, (counts.get(slot) || 0) + 2);
      }
    }
  }

  for (const meeting of blockingMeetings(activities)) {
    if (weekday(meeting.date) !== Number(targetWeekday)) continue;
    const after = text(meeting.end_time).slice(0, 5);
    const beforeMinute = timeMinutes(meeting.start_time) - durationMinutes;
    if (after) counts.set(after, (counts.get(after) || 0) + 6);
    const before = formatMinutes(beforeMinute);
    if (before) counts.set(before, (counts.get(before) || 0) + 6);
  }

  return [...counts.entries()]
    .filter(([slot]) => {
      const minute = timeMinutes(slot);
      return minute != null && minute >= 7 * 60 && minute + durationMinutes <= 18 * 60;
    })
    .sort((a, b) => b[1] - a[1] || timeMinutes(a[0]) - timeMinutes(b[0]))
    .slice(0, MAX_TIME_SLOTS_PER_WEEKDAY)
    .map(([slot]) => slot);
}

function candidateStartDates({ activity, targetWeekday, sessions, startTime, durationMinutes, schoolCalendar = [], today, activities = [], periodKey = DEFAULT_PLANNING_PERIOD_KEY } = {}) {
  const period = planningEffectivePeriod(periodKey);
  const fixedStart = text(activityMeetings(activity)
    .map((meeting) => text(meeting?.date).slice(0, 10))
    .filter((date) => date >= period.start && date <= period.end)
    .sort()[0] || activity.start_date).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fixedStart)) {
    if (fixedStart < period.start || fixedStart > period.end || weekday(fixedStart) !== Number(targetWeekday)) return [];
    const built = buildWeeklyPlanningMeetings({
      activity, startDate: fixedStart, startTime, durationMinutes, sessions, schoolCalendar, periodKey
    });
    if (!built) return [];
    const knownMeetings = activityMeetings(activity);
    const respectsKnownDates = knownMeetings.every((meeting, index) => {
      const meetingNo = Math.max(1, Number(meeting?.meeting_no) || index + 1);
      return text(built.meetings[meetingNo - 1]?.date).slice(0, 10) === text(meeting?.date).slice(0, 10);
    });
    return respectsKnownDates ? [fixedStart] : [];
  }

  const todayDate = text(today).slice(0, 10);
  const floor = todayDate > period.start ? todayDate : period.start;
  const earliest = firstOnOrAfter(floor, targetWeekday);
  const latest = latestFeasiblePlanningStart({ activity, targetWeekday, startTime, durationMinutes, sessions, schoolCalendar, periodKey });
  const values = new Set();
  if (earliest && earliest <= period.end) values.add(earliest);

  const releaseDates = blockingActivities(activities)
    .flatMap((activity) => {
      const meetings = schedulingCalendarMeetings(activity);
      const last = meetings.map((meeting) => text(meeting.date).slice(0, 10)).filter(Boolean).sort().at(-1);
      return last ? [last] : [];
    })
    .filter((date) => date >= floor && date <= period.end)
    .sort();

  for (const release of releaseDates) {
    const next = firstOnOrAfter(addDays(release, 1), targetWeekday);
    if (next && next >= floor && next <= period.end) values.add(next);
    if (values.size >= 3) break;
  }
  if (latest && latest >= floor && latest <= period.end) values.add(latest);
  return [...values].sort().slice(0, 4);
}

function ruleCovers(rule, startTime, endTime) {
  if (!rule?.available) return false;
  const start = timeMinutes(startTime);
  const end = timeMinutes(endTime);
  const ruleStart = timeMinutes(rule.start_time);
  const ruleEnd = timeMinutes(rule.end_time);
  return start != null && end != null && ruleStart != null && ruleEnd != null && start >= ruleStart && end <= ruleEnd;
}

function scenarioHeuristic({ scenario, instructors = [], rules = {}, activities = [] } = {}) {
  const activeIds = activeInstructorIds(instructors);
  const day = weekday(scenario.startDate);
  let availabilityCoverage = 0;
  for (const empId of activeIds) {
    if ((rules[empId] || []).some((rule) => Number(rule.weekday) === day && ruleCovers(rule, scenario.startTime, scenario.endTime))) {
      availabilityCoverage += 1;
    }
  }

  let adjacency = 0;
  for (const meeting of blockingMeetings(activities)) {
    if (weekday(meeting.date) !== day) continue;
    if (text(meeting.end_time).slice(0, 5) === scenario.startTime || text(meeting.start_time).slice(0, 5) === scenario.endTime) adjacency += 1;
  }
  return availabilityCoverage * 10 + adjacency * 4;
}

export function generatePlanningScenarios({
  activity = {},
  catalog = [],
  instructors = [],
  profiles = {},
  rules = {},
  activities = [],
  schoolCalendar = [],
  today = '',
  periodKey = DEFAULT_PLANNING_PERIOD_KEY,
  maxScenarios = MAX_SCENARIOS_PER_COURSE
} = {}) {
  const spec = inferPlanningCourseSpec(activity, catalog);
  if (!spec.complete) return { spec, scenarios: [], startRange: null };

  const raw = [];
  const fridayPossible = activeInstructorIds(instructors).size > 0 && instructors.some((instructor) => {
    const empId = text(instructor.emp_id);
    return !!profiles[empId]?.friday_allowed
      && (rules[empId] || []).some((rule) => Number(rule.weekday) === 5 && rule.available === true);
  });
  const fixedStartMinute = timeMinutes(activity.start_time);
  const fixedEndMinute = timeMinutes(activity.end_time);
  const fixedStartTime = fixedStartMinute != null
    ? formatMinutes(fixedStartMinute)
    : (fixedEndMinute != null ? formatMinutes(fixedEndMinute - spec.durationMinutes) : '');
  const knownMeetings = activityMeetings(activity);
  const hasCompleteFixedDates = knownMeetings.length >= spec.sessions && spec.sessions > 0;

  if (hasCompleteFixedDates) {
    const day = weekday(knownMeetings[0]?.date);
    const times = fixedStartTime
      ? [fixedStartTime]
      : dynamicTimesForWeekday({
          targetWeekday: day,
          durationMinutes: spec.durationMinutes,
          activity,
          instructors,
          rules,
          activities
        });
    for (const startTime of times) {
      const built = buildFixedDatePlanningMeetings({
        activity,
        startTime,
        durationMinutes: spec.durationMinutes,
        schoolCalendar,
        periodKey
      });
      if (!built) continue;
      raw.push({
        ...built,
        heuristic: scenarioHeuristic({ scenario: built, instructors, rules, activities })
      });
    }
  } else {
    for (const day of fridayPossible ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4]) {
      const times = fixedStartTime
        ? [fixedStartTime]
        : dynamicTimesForWeekday({
            targetWeekday: day,
            durationMinutes: spec.durationMinutes,
            activity,
            instructors,
            rules,
            activities
          });
      const starts = [...new Set(times.flatMap((startTime) => candidateStartDates({
        activity, targetWeekday: day, sessions: spec.sessions, startTime,
        durationMinutes: spec.durationMinutes, schoolCalendar, today, activities, periodKey
      })))];
      for (const startDate of starts) {
        for (const startTime of times) {
          const built = buildWeeklyPlanningMeetings({
            activity,
            startDate,
            startTime,
            durationMinutes: spec.durationMinutes,
            sessions: spec.sessions,
            schoolCalendar,
            periodKey
          });
          if (!built) continue;
          raw.push({
            ...built,
            heuristic: scenarioHeuristic({ scenario: built, instructors, rules, activities })
          });
        }
      }
    }
  }

  const unique = [...new Map(raw.map((scenario) => [`${scenario.startDate}|${scenario.startTime}|${scenario.endTime}`, scenario])).values()];
  const sorted = unique.sort((a, b) =>
    b.heuristic - a.heuristic
    || a.startDate.localeCompare(b.startDate)
    || a.startTime.localeCompare(b.startTime)
  );
  const limit = Math.max(1, Number(maxScenarios) || MAX_SCENARIOS_PER_COURSE);
  const diversified = [];
  const selectedKeys = new Set();
  const addScenario = (scenario) => {
    const key = `${scenario.startDate}|${scenario.startTime}|${scenario.endTime}`;
    if (selectedKeys.has(key) || diversified.length >= limit) return;
    selectedKeys.add(key);
    diversified.push(scenario);
  };
  // Keep at least one strong option for every available weekday before filling
  // the remaining slots. This prevents popular hours from crowding out a day
  // that is important for a smaller subset of instructors.
  for (const day of [0, 1, 2, 3, 4, 5]) {
    const option = sorted.find((scenario) => weekday(scenario.startDate) === day);
    if (option) addScenario(option);
  }
  for (const scenario of sorted) addScenario(scenario);

  const startDates = unique.map((item) => item.startDate).sort();
  return {
    spec,
    scenarios: diversified,
    startRange: startDates.length ? { min: startDates[0], max: startDates.at(-1) } : null
  };
}

function scenarioCourse(activity, scenario, index = 0) {
  const sourceId = idOf(activity);
  return {
    ...activity,
    row_id: `planning:${sourceId}:${index + 1}`,
    __planning_source_id: sourceId,
    meetings: scenario.meetings,
    start_date: scenario.startDate,
    end_date: scenario.endDate,
    start_time: scenario.startTime,
    end_time: scenario.endTime,
    emp_id: null,
    instructor_name: null,
    emp_id_2: null,
    instructor_name_2: null,
    draft_emp_id: null,
    draft_instructor_name: null,
    draft_proposed_meetings: null,
    instructor_assignment_locked: false,
    instructor_assignment_status: null,
    status: 'פתוח'
  };
}

function selectedCandidate(result = {}) {
  return result?.recommended || result?.bestAvailable || null;
}

function optionFromCandidate(course, candidate, { routeVerified = true, startRange = null } = {}) {
  if (!candidate) return null;
  const meetings = activityMeetings(course);
  return {
    instructorEmpId: empOf(candidate),
    instructorName: text(candidate.instructor?.full_name) || empOf(candidate),
    score: Number.isFinite(Number(candidate.score)) ? Number(candidate.score) : null,
    startDate: meetings[0]?.date || course.start_date || '',
    endDate: meetings.at(-1)?.date || course.end_date || '',
    startTime: text(meetings[0]?.start_time || course.start_time).slice(0, 5),
    endTime: text(meetings[0]?.end_time || course.end_time).slice(0, 5),
    meetings: meetings.map((meeting, index) => ({
      date: text(meeting.date).slice(0, 10),
      meeting_no: Number(meeting.meeting_no) || index + 1,
      start_time: text(meeting.start_time || course.start_time).slice(0, 5),
      end_time: text(meeting.end_time || course.end_time).slice(0, 5)
    })),
    routeVerified,
    startRange,
    explanation: {
      continuity: text(candidate.scoreBreakdown?.continuityEfficiency?.note || candidate.scoreBreakdown?.continuityEfficiency?.label),
      workload: text(candidate.scoreBreakdown?.actualWorkload?.note),
      travel: text(candidate.scoreBreakdown?.travelDistance?.note),
      scheduleSource: idOf(course).startsWith('planning:') ? 'מועד שנוצר בתכנון' : 'מועד קבוע מהפעילות',
      hardGates: 'זמינות, שפה, מגדר, חפיפות ומעברים נבדקו'
    },
    reason: text(candidate.recommendationReason)
      || (routeVerified ? 'האפשרות משתלבת בלוח הקיים ועומדת בתנאי הסף' : 'האפשרות מתאימה לפי זמינות; נדרש אימות מרחקים')
  };
}

function optionCompare(first, second) {
  const candidateOrder = compareCandidatesStable(first._candidate || {}, second._candidate || {});
  if (candidateOrder) return candidateOrder;
  if (first.startDate !== second.startDate) return first.startDate.localeCompare(second.startDate);
  return first.startTime.localeCompare(second.startTime);
}

async function evaluateScenarioOptions({
  activity,
  scenarios,
  startRange,
  contextActivities,
  instructors,
  profiles,
  rules,
  exceptions,
  schoolCalendar,
  today,
  routeClient,
  periodKey = DEFAULT_PLANNING_PERIOD_KEY
} = {}) {
  const preliminaries = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const course = scenarioCourse(activity, scenarios[index], index);
    const candidates = preliminaryCourseCandidates({
      activities: [...contextActivities, course],
      targetCourseId: course.row_id,
      periodKey,
      instructors,
      profiles,
      rules,
      exceptions,
      schoolCalendar,
      referenceDate: today
    }).map((item) => item.candidate).filter(Boolean).sort(compareCandidatesStable);
    const candidate = candidates[0] || null;
    if (candidate) preliminaries.push({ course, candidate });
  }
  if (!preliminaries.length) return [];

  preliminaries.sort((first, second) => {
    const order = compareCandidatesStable(first.candidate, second.candidate);
    if (order) return order;
    return text(first.course.start_date).localeCompare(text(second.course.start_date));
  });
  const finalists = preliminaries.slice(0, MAX_FINAL_OPTIONS);

  let routed = null;
  try {
    routed = await calculateCandidateTravel(
      finalists.map((item) => ({ course: item.course, candidate: item.candidate })),
      contextActivities,
      routeClient
    );
  } catch {
    routed = null;
  }

  const options = [];
  for (const finalist of finalists) {
    let finalCandidate = null;
    if (routed) {
      const finalResult = calculateCourseSchedule({
        activities: [...contextActivities, finalist.course],
        targetCourseId: finalist.course.row_id,
        periodKey,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        referenceDate: today,
        travel: routed.travel,
        routeMatrix: routed.routeMatrix,
        travelUnavailableReason: routed.unavailableReason || ''
      })[0];
      finalCandidate = selectedCandidate(finalResult);
    }
    if (!finalCandidate) continue;
    const option = optionFromCandidate(finalist.course, finalCandidate, {
      routeVerified: true,
      startRange
    });
    if (option) options.push({ ...option, _candidate: finalCandidate });
  }
  return options.sort(optionCompare).slice(0, MAX_FINAL_OPTIONS);
}

async function evaluateFixedCourse({
  activity,
  contextActivities,
  instructors,
  profiles,
  rules,
  exceptions,
  schoolCalendar,
  today,
  routeClient,
  periodKey = DEFAULT_PLANNING_PERIOD_KEY
} = {}) {
  const calendarRows = courseCalendarRows(activity, schoolCalendar);
  const blocked = blockedSchoolDates(calendarRows);
  if (activityMeetings(activity).some((meeting) => {
    const date = text(meeting.date).slice(0, 10);
    return blocked.has(date)
      || text(effectiveEndTime(date, meeting.end_time || activity.end_time, calendarRows)).slice(0, 5)
        !== text(meeting.end_time || activity.end_time).slice(0, 5);
  })) return [];
  const candidates = preliminaryCourseCandidates({
    activities: contextActivities,
    targetCourseId: idOf(activity),
    periodKey,
    instructors,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    referenceDate: today,
    allowDateAdjustments: false
  }).map((item) => item.candidate).filter(Boolean).sort(compareCandidatesStable);

  const finalists = candidates.slice(0, MAX_FINAL_OPTIONS);
  if (!finalists.length) return [];
  let routed = null;
  try {
    routed = await calculateCandidateTravel(
      finalists.map((candidate) => ({ course: activity, candidate })),
      contextActivities,
      routeClient
    );
  } catch {
    routed = null;
  }
  const options = [];
  for (const preliminary of finalists) {
    let finalCandidate = null;
    if (routed) {
      const result = calculateCourseSchedule({
        activities: contextActivities,
        targetCourseId: idOf(activity),
        periodKey,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        referenceDate: today,
        travel: routed.travel,
        routeMatrix: routed.routeMatrix,
        travelUnavailableReason: routed.unavailableReason || '',
        allowDateAdjustments: false
      })[0];
      finalCandidate = selectedCandidate(result);
      if (finalCandidate) {
        const duplicate = options.some((option) => option.instructorEmpId === empOf(finalCandidate));
        if (!duplicate) options.push({ ...optionFromCandidate(activity, finalCandidate, { routeVerified: true }), _candidate: finalCandidate });
        break;
      }
    }
  }
  return options.filter(Boolean).sort(optionCompare).slice(0, MAX_FINAL_OPTIONS);
}

function blockingVirtualActivity(activity = {}, option = null) {
  if (!option?.instructorEmpId) return null;
  return {
    ...activity,
    row_id: `planning-block:${idOf(activity)}`,
    meetings: option.meetings,
    start_date: option.startDate,
    end_date: option.endDate,
    start_time: option.startTime,
    end_time: option.endTime,
    emp_id: null,
    instructor_name: null,
    emp_id_2: null,
    instructor_name_2: null,
    draft_emp_id: option.instructorEmpId,
    draft_instructor_name: option.instructorName,
    draft_proposed_meetings: option.meetings.map((meeting) => ({
      date: meeting.date,
      start_time: meeting.start_time,
      end_time: meeting.end_time
    })),
    instructor_assignment_locked: false,
    status: 'פתוח'
  };
}

function activityTypeLabel(activity = {}) {
  const category = schedulingActivityTypeCategory(activity.activity_type || activity.type);
  if (category === 'workshop') return 'סדנה';
  if (category === 'tour') return 'סיור';
  return 'קורס';
}

function activityMeetingsForPlanning(activity = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const period = planningEffectivePeriod(periodKey);
  return schedulingCalendarMeetings(activity).map((meeting, index) => ({
    date: text(meeting?.date).slice(0, 10),
    meeting_no: Number(meeting?.meeting_no) || index + 1,
    start_time: text(meeting?.start_time || activity.start_time).slice(0, 5),
    end_time: text(meeting?.end_time || activity.end_time).slice(0, 5)
  })).filter((meeting) => meeting.date >= period.start && meeting.date <= period.end);
}

function liveRow(activity = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const meetings = activityMeetingsForPlanning(activity, periodKey);
  const first = meetings[0] || {};
  const last = meetings.at(-1) || {};
  const draft = !text(activity.emp_id) && text(activity.draft_emp_id);
  const assigned = !!text(activity.emp_id);
  const period = planningEffectivePeriod(periodKey);
  const endDate = text(last.date || activity.end_date).slice(0, 10);
  const halfOverflow = !!draft && !!endDate && endDate > period.end;
  return {
    courseId: idOf(activity),
    authority: text(activity.authority),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    sessions: meetings.length || meetingCount(activity),
    kind: assigned ? 'live' : (draft ? 'draft' : 'fixed'),
    status: assigned ? 'מעודכן בפועל' : (draft ? 'טיוטת שיבוץ קיימת' : 'נדרש טיפול'),
    startDate: text(first.date || activity.start_date).slice(0, 10),
    endDate,
    startTime: text(first.start_time || activity.start_time).slice(0, 5),
    endTime: text(first.end_time || activity.end_time).slice(0, 5),
    instructorName: text(activity.instructor_name || activity.draft_instructor_name),
    instructorEmpId: text(activity.emp_id || activity.draft_emp_id),
    meetings,
    options: [],
    halfOverflow,
    halfOverflowLabel: halfOverflow ? 'חורגת מתקופת התכנון' : '',
    reason: assigned
      ? 'נלקח מהשיבוץ הפעיל'
      : (draft
          ? (halfOverflow
              ? `נלקח מטיוטת השיבוץ הקיימת · סיום ${formatDateHe(endDate)} לאחר סוף תקופת התכנון`
              : 'נלקח מטיוטת השיבוץ הקיימת')
          : 'התאריך והשעות נלקחו מהפעילות')
  };
}

function missingOverviewRow(activity = {}, catalog = []) {
  const spec = inferPlanningCourseSpec(activity, catalog);
  return {
    courseId: idOf(activity),
    authority: text(activity.authority),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    sessions: spec.sessions || meetingCount(activity),
    kind: 'missing',
    status: 'נדרש טיפול',
    startDate: '',
    endDate: '',
    startTime: '',
    endTime: '',
    instructorName: '',
    instructorEmpId: '',
    meetings: [],
    options: [],
    reason: spec.complete
      ? 'אין מועד קבוע מבית הספר — המערכת תציע תאריך, שעה ומדריך'
      : 'לא ניתן לחשב הצעה עד שיוגדרו מספר המפגשים ומשך המפגש'
  };
}

export function buildPlanningOverviewRows({ activities = [], catalog = [], district = '', periodKey = DEFAULT_PLANNING_PERIOD_KEY } = {}) {
  return planningWorkspaceCourses(activities, district, periodKey).map((activity) =>
    text(activity.emp_id) || text(activity.draft_emp_id) || hasOfficialPlanningSchedule(activity)
      ? liveRow(activity, periodKey)
      : missingOverviewRow(activity, catalog)
  );
}

function planRowFromOption(activity, option, options, startRange, spec) {
  return {
    courseId: idOf(activity),
    authority: text(activity.authority),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    sessions: spec?.sessions || meetingCount(activity),
    kind: 'proposal',
    status: option ? 'הצעת תכנון' : 'נדרש טיפול',
    startDate: option?.startDate || '',
    endDate: option?.endDate || '',
    startTime: option?.startTime || '',
    endTime: option?.endTime || '',
    instructorName: option?.instructorName || '',
    instructorEmpId: option?.instructorEmpId || '',
    meetings: option?.meetings || [],
    options: (options || []).map(({ _candidate, ...item }) => item),
    startRange,
    reason: option?.reason || 'לא נמצאה התאמה שעומדת בתנאי הסף'
  };
}

function stableRows(rows = []) {
  return [...(rows || [])].map((row) => Object.fromEntries(Object.entries(row || {}).sort(([a], [b]) => a.localeCompare(b))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export function planningDataFingerprint(input = []) {
  const snapshot = Array.isArray(input) ? { activities: input } : (input || {});
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const rows = planningWorkspaceCourses(snapshot.activities || [], '', periodKey)
    .map((activity) => ({
      id: idOf(activity),
      status: text(activity.status),
      emp: text(activity.emp_id),
      emp2: text(activity.emp_id_2),
      draft: text(activity.draft_emp_id),
      start: text(activity.start_time),
      end: text(activity.end_time),
      sessions: Number(activity.sessions) || null,
      schoolId: text(activity.school_id), school: text(activity.school), address: text(activity.school_address),
      authority: text(activity.authority), district: text(activity.district), sector: text(activity.calendar_sector),
      language: text(activity.instruction_language), gender: text(activity.required_instructor_gender),
      cancellations: stableRows((activity.cancelled_meeting_dates || []).map((date) => ({ date: text(date).slice(0, 10) }))),
      dates: schedulingCalendarMeetings(activity).map((meeting) => [
        text(meeting.date).slice(0, 10),
        text(meeting.start_time || activity.start_time).slice(0, 5),
        text(meeting.end_time || activity.end_time).slice(0, 5)
      ])
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  let hash = 2166136261;
  const value = JSON.stringify({
    engineVersion: PLANNING_ENGINE_VERSION,
    period: planningEffectivePeriod(periodKey),
    activities: rows,
    instructors: stableRows((snapshot.instructors || []).map((row) => ({ emp_id: row.emp_id, active: row.active, address: row.address }))),
    profiles: stableRows(Array.isArray(snapshot.profiles) ? snapshot.profiles : Object.values(snapshot.profiles || {})),
    rules: stableRows(Array.isArray(snapshot.rules) ? snapshot.rules : Object.values(snapshot.rules || {}).flat()),
    exceptions: stableRows(Array.isArray(snapshot.exceptions) ? snapshot.exceptions : Object.values(snapshot.exceptions || {}).flat()),
    schoolCalendar: stableRows(snapshot.schoolCalendar || []),
    catalog: stableRows((snapshot.catalog || []).map((row) => ({
      activity_no: row.activity_no,
      gefen_number: row.gefen_number,
      pricing_key: row.pricing_key,
      activity_name: row.activity_name,
      meetings_count: row.meetings_count,
      hours_count: row.hours_count,
      unit_duration: row.unit_duration
    })))
  });
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export async function buildDynamicCoursePlan({
  activities = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  catalog = [],
  district = '',
  periodKey = DEFAULT_PLANNING_PERIOD_KEY,
  today = '',
  routeClient = createRouteClient(),
  onProgress = null
} = {}) {
  const report = async (phase, completed = 0, total = 0, courseId = '', rows = null) => {
    if (typeof onProgress === 'function') onProgress({ phase, completed, total, courseId, rows });
    await yieldToBrowser();
  };
  await report('הכנת נתונים');
  const targets = planningWorkspaceCourses(activities, district, periodKey);
  const contextActivities = [...activities];
  const virtualPlans = [];
  const rowsById = new Map();
  const fixedUnassigned = [];
  const missingSchedule = [];

  for (const activity of targets) {
    if (text(activity.emp_id) || text(activity.draft_emp_id)) {
      rowsById.set(idOf(activity), liveRow(activity, periodKey));
    } else if (hasOfficialPlanningSchedule(activity)) {
      fixedUnassigned.push(activity);
    } else {
      missingSchedule.push(activity);
    }
  }

  fixedUnassigned.sort((a, b) => {
    const ad = text(activityMeetings(a)[0]?.date || a.start_date);
    const bd = text(activityMeetings(b)[0]?.date || b.start_date);
    return ad.localeCompare(bd) || idOf(a).localeCompare(idOf(b));
  });

  missingSchedule.sort((a, b) => {
    const as = inferPlanningCourseSpec(a, catalog);
    const bs = inferPlanningCourseSpec(b, catalog);
    return (bs.sessions - as.sessions)
      || ((bs.durationMinutes || 0) - (as.durationMinutes || 0))
      || idOf(a).localeCompare(idOf(b));
  });

  const queue = [
    ...fixedUnassigned.map((activity) => ({ activity, type: 'fixed' })),
    ...missingSchedule.map((activity) => ({ activity, type: 'missing' }))
  ];
  let completed = 0;
  await report('יצירת אפשרויות', 0, queue.length);

  for (const item of queue) {
    const { activity, type } = item;
    const currentContext = [...contextActivities, ...virtualPlans];
    await report('בדיקת מדריכים', completed, queue.length, idOf(activity));
    await report('בדיקת נסיעות', completed, queue.length, idOf(activity));
    if (type === 'fixed') {
      const options = await evaluateFixedCourse({
        activity,
        contextActivities: currentContext,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        today,
        routeClient,
        periodKey
      });
      const chosen = options[0] || null;
      const row = {
        ...liveRow(activity, periodKey),
        kind: 'fixed-proposal',
        status: chosen ? 'הצעת תכנון' : 'נדרש טיפול',
        instructorName: chosen?.instructorName || '',
        instructorEmpId: chosen?.instructorEmpId || '',
        options: options.map(({ _candidate, ...option }) => option),
        reason: chosen?.reason || 'לא נמצא מדריך שעומד בתנאי הסף'
      };
      rowsById.set(idOf(activity), row);
      const virtual = blockingVirtualActivity(activity, chosen);
      if (virtual) virtualPlans.push(virtual);
    } else {
      const generated = generatePlanningScenarios({
        activity,
        catalog,
        instructors,
        rules,
        profiles,
        activities: currentContext,
        schoolCalendar,
        today,
        periodKey
      });
      if (!generated.spec.complete) {
        rowsById.set(idOf(activity), missingOverviewRow(activity, catalog));
      } else {
        const options = await evaluateScenarioOptions({
          activity,
          scenarios: generated.scenarios,
          startRange: generated.startRange,
          contextActivities: currentContext,
          instructors,
          profiles,
          rules,
          exceptions,
          schoolCalendar,
          today,
          routeClient,
          periodKey
        });
        const chosen = options[0] || null;
        rowsById.set(idOf(activity), planRowFromOption(activity, chosen, options, generated.startRange, generated.spec));
        const virtual = blockingVirtualActivity(activity, chosen);
        if (virtual) virtualPlans.push(virtual);
      }
    }

    completed += 1;
    const partialRows = targets.map((target) => rowsById.get(idOf(target)) || missingOverviewRow(target, catalog));
    await report('בניית תוכנית', completed, queue.length, idOf(activity), partialRows);
  }

  const rows = targets.map((activity) => rowsById.get(idOf(activity)) || missingOverviewRow(activity, catalog));
  return {
    rows,
    total: rows.length,
    planned: rows.filter((row) => ['proposal', 'fixed-proposal'].includes(row.kind) && row.instructorEmpId).length,
    live: rows.filter((row) => row.kind === 'live').length,
    drafts: rows.filter((row) => row.kind === 'draft').length,
    missing: rows.filter((row) => row.kind === 'missing').length,
    routeStats: {
      googleCalls: Number(routeClient.googleCalls) || 0,
      cacheHits: Number(routeClient.cacheHits) || 0
    }
  };
}

function rowMeetingSourceLabel(row = {}) {
  if (row.kind === 'live') return 'שיבוץ קיים';
  if (row.kind === 'draft') return 'טיוטה קיימת';
  if (row.kind === 'proposal' || row.kind === 'fixed-proposal') return 'הצעת מערכת';
  return 'נדרש תכנון';
}

export function planningInstructorSchedules(rows = []) {
  const groups = new Map();
  for (const row of rows || []) {
    const empId = text(row?.instructorEmpId);
    const name = text(row?.instructorName);
    if (!empId || !name) continue;
    const key = empId || name;
    if (!groups.has(key)) groups.set(key, { empId, name, activityIds: new Set(), meetings: [] });
    const group = groups.get(key);
    group.activityIds.add(text(row.courseId));
    const meetings = Array.isArray(row.meetings) ? row.meetings : [];
    for (const meeting of meetings) {
      const date = text(meeting?.date).slice(0, 10);
      if (!date) continue;
      group.meetings.push({
        date,
        startTime: text(meeting?.start_time || row.startTime).slice(0, 5),
        endTime: text(meeting?.end_time || row.endTime).slice(0, 5),
        courseId: text(row.courseId),
        courseName: text(row.courseName),
        activityType: text(row.activityType) || 'קורס',
        school: text(row.school),
        authority: text(row.authority),
        source: rowMeetingSourceLabel(row)
      });
    }
  }
  return [...groups.values()]
    .map((group) => ({
      empId: group.empId,
      name: group.name,
      activityCount: group.activityIds.size,
      meetings: group.meetings.sort((a, b) =>
        a.date.localeCompare(b.date)
        || a.startTime.localeCompare(b.startTime)
        || a.courseName.localeCompare(b.courseName, 'he')
      )
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export function planningInstructorScheduleHtml(rows = []) {
  const schedules = planningInstructorSchedules(rows);
  if (!schedules.length) return '';
  return `<section class="course-planning-instructor-schedules">
    <div class="course-planning-section-heading">
      <div><strong>מערכת ההדרכות לפי מדריך</strong><span>${schedules.length} מדריכים עם שיבוץ קיים, טיוטה או הצעת מערכת</span></div>
    </div>
    <div class="course-planning-instructor-list">${schedules.map((schedule) => `
      <details class="course-planning-instructor-card">
        <summary>
          <strong>${escapeHtml(schedule.name)}</strong>
          <span>${schedule.activityCount} פעילויות · ${schedule.meetings.length} מפגשים</span>
        </summary>
        <div class="course-planning-instructor-table-wrap">
          <table class="course-planning-instructor-table">
            <thead><tr><th>תאריך</th><th>שעות</th><th>סוג</th><th>פעילות</th><th>בית ספר</th><th>רשות</th><th>מקור</th></tr></thead>
            <tbody>${schedule.meetings.map((meeting) => `<tr>
              <td><bdi dir="ltr">${escapeHtml(formatDateHe(meeting.date))}</bdi></td>
              <td><bdi dir="ltr">${escapeHtml(formatTimeRangeShort(meeting.startTime, meeting.endTime))}</bdi></td>
              <td>${escapeHtml(meeting.activityType)}</td>
              <td>${escapeHtml(meeting.courseName || '—')}</td>
              <td>${escapeHtml(meeting.school || '—')}</td>
              <td>${escapeHtml(meeting.authority || '—')}</td>
              <td>${escapeHtml(meeting.source)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </details>`).join('')}</div>
  </section>`;
}

function kindClass(kind) {
  if (kind === 'live') return ' is-live';
  if (kind === 'draft') return ' is-draft';
  if (kind === 'proposal' || kind === 'fixed-proposal') return ' is-proposal';
  return ' is-missing';
}

function optionHtml(option = {}, index = 0) {
  const range = option.startRange?.min && option.startRange?.max
    ? ` · טווח התחלה ${formatDateHe(option.startRange.min)}–${formatDateHe(option.startRange.max)}`
    : '';
  return `<div class="course-planning-option">
    <strong>חלופה ${index + 1}: ${escapeHtml(option.instructorName || '—')}</strong>
    <span><bdi dir="ltr">${escapeHtml(formatDateHe(option.startDate))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(option.endDate))}</bdi> · <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(option.startTime, option.endTime))}</bdi>${escapeHtml(range)}</span>
    <small>${escapeHtml(option.reason || '')}${option.routeVerified === false ? ' · מרחק טרם אומת' : ''}</small>
  </div>`;
}

function explanationHtml(option = {}) {
  const explanation = option.explanation || {};
  const items = [explanation.continuity, explanation.workload, explanation.travel, explanation.scheduleSource, explanation.hardGates].filter(Boolean);
  return items.length ? `<details class="course-planning-explanation"><summary>למה הוצע?</summary><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : '';
}

export function planningRowsHtml(rows = []) {
  if (!rows.length) {
    return '<div class="course-scheduling-empty"><strong>אין פעילויות פתוחות לתכנון בתקופה שנבחרה</strong></div>';
  }
  return `<div class="course-planning-list">${rows.map((row) => {
    const range = row.startRange?.min && row.startRange?.max
      ? `<span class="course-planning-range">טווח התחלה אפשרי: <bdi dir="ltr">${escapeHtml(formatDateHe(row.startRange.min))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(row.startRange.max))}</bdi></span>`
      : '';
    const dateRange = row.startDate
      ? `<bdi dir="ltr">${escapeHtml(formatDateHe(row.startDate))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(row.endDate))}</bdi>`
      : '—';
    const hours = row.startTime ? `<bdi dir="ltr">${escapeHtml(formatTimeRangeShort(row.startTime, row.endTime))}</bdi>` : '—';
    const alternatives = (row.options || []).length > 1
      ? `<details class="course-planning-alternatives"><summary>${row.options.length - 1} חלופות נוספות</summary>${row.options.slice(1).map((option, index) => optionHtml(option, index + 1)).join('')}</details>`
      : '';
    return `<article class="course-planning-row${kindClass(row.kind)}" data-planning-course="${escapeHtml(row.courseId)}">
      <div class="course-planning-main">
        <div class="course-planning-identity"><strong>${escapeHtml(row.courseName || '—')}</strong><span>${escapeHtml(row.activityType || 'קורס')} · ${escapeHtml(row.school || '—')} · ${escapeHtml(row.authority || '—')}</span></div>
        <div class="course-planning-field"><span>סטטוס</span><strong>${escapeHtml(row.status || '—')}</strong></div>
        <div class="course-planning-field"><span>מפגשים</span><strong>${escapeHtml(String(row.sessions || '—'))}</strong></div>
        <div class="course-planning-field"><span>תאריכים</span><strong>${dateRange}</strong></div>
        <div class="course-planning-field"><span>שעות</span><strong>${hours}</strong></div>
        <div class="course-planning-field"><span>מדריך</span><strong>${escapeHtml(row.instructorName || '—')}</strong></div>
      </div>
      ${range}
      ${row.halfOverflow ? `<span class="course-planning-half-overflow">${escapeHtml(row.halfOverflowLabel || 'חורגת מתקופת התכנון')}</span>` : ''}
      <p class="course-planning-reason">${escapeHtml(row.reason || '')}</p>
      ${explanationHtml(row.options?.[0])}
      ${alternatives}
    </article>`;
  }).join('')}</div>`;
}

export function planningTabHtml({
  rows = [],
  loading = false,
  progress = null,
  error = '',
  district = '',
  districts = [],
  periodKey = DEFAULT_PLANNING_PERIOD_KEY,
  calculatedAt = '',
  routeStats = null
} = {}) {
  const period = planningEffectivePeriod(periodKey);
  const planningPeriods = planningPeriodOptions();
  const districtOptions = ['<option value="">כל המחוזות</option>', ...(districts || []).map((item) =>
    `<option value="${escapeHtml(item)}"${normalizeOperationalDistrict(item) === normalizeOperationalDistrict(district) ? ' selected' : ''}>${escapeHtml(item)}</option>`
  )].join('');
  const periodOptionsHtml = planningPeriods.map((item) =>
    `<option value="${escapeHtml(item.key)}"${item.key === periodKey ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
  ).join('');
  const typeCounts = rows.reduce((acc, row) => {
    const key = row.activityType || 'קורס';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const live = rows.filter((row) => row.kind === 'live').length;
  const drafts = rows.filter((row) => row.kind === 'draft').length;
  const proposals = rows.filter((row) => ['proposal', 'fixed-proposal'].includes(row.kind) && row.instructorEmpId).length;
  const waiting = rows.filter((row) => row.kind === 'missing' || (['proposal', 'fixed-proposal'].includes(row.kind) && !row.instructorEmpId)).length;
  const progressText = loading
    ? `${escapeHtml(progress?.phase || 'הכנת נתונים')} · ${Number(progress?.completed) || 0} מתוך ${Number(progress?.total) || rows.length} פעילויות`
    : '';

  return `<section class="course-planning-tab" data-course-planning-tab>
    <div class="course-planning-banner">
      <div>
        <strong>תכנון מערכת הדרכות מלאה — ללא שינוי בשיבוצים</strong>
        <p>כל הפעילויות הפתוחות נכנסות למערכת החל מ־06.10.2026. מועדים שכבר נקבעו בבית הספר נשארים קבועים; כשחסר תאריך או שעה, המערכת משלימה אותם לפי ימי ושעות הזמינות של צוות ההדרכה.</p>
      </div>
      <div class="course-planning-period">${escapeHtml(period.label)} · <bdi dir="ltr">${escapeHtml(formatDateHe(period.start))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(period.end))}</bdi></div>
    </div>
    <div class="course-planning-toolbar">
      <label>תקופת תכנון<select class="course-scheduling-input" data-planning-period-filter>${periodOptionsHtml}</select></label>
      <label>מחוז<select class="course-scheduling-input" data-planning-district-filter>${districtOptions}</select></label>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-run-course-planning ${loading ? 'disabled' : ''}>${loading ? 'בונה מערכת…' : 'בנה מערכת הדרכות מלאה'}</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-clear-course-planning ${loading ? 'disabled' : ''}>אפס הצעות</button>
      ${calculatedAt ? `<span class="course-planning-updated">עודכן ${escapeHtml(calculatedAt)}</span>` : ''}
    </div>
    <p class="course-planning-note">המערכת בונה מערכת מלאה לקורסים, סדנאות וסיורים החל מ־06.10.2026. לכל פעילות ללא מועד מלא נבדקים מספר המפגשים, משך המפגש, ימי ושעות הזמינות של כל מדריך, חגים, חפיפות, מעברים, מרחקים והעומס שכבר קיים. המטרה היא לנצל את ימי העבודה הזמינים של כל מדריך בלי לחרוג מהאילוצים שלו.</p>
    <p class="course-planning-scope-counts">היקף נוכחי: <strong>${rows.length}</strong> פעילויות · ${Object.entries(typeCounts).map(([type, count]) => `${escapeHtml(type)} ${count}`).join(' · ')}</p>
    ${error ? `<p class="course-scheduling-alert">${escapeHtml(error)}</p>` : ''}
    ${progressText ? `<p class="course-planning-progress" role="status">${escapeHtml(progressText)}</p>` : ''}
    <div class="course-planning-summary">
      <article><b>${rows.length}</b><span>כל הפעילויות</span></article>
      <article><b>${live}</b><span>מעודכן בפועל</span></article>
      <article><b>${drafts}</b><span>טיוטות קיימות</span></article>
      <article><b>${proposals}</b><span>הצעות תכנון</span></article>
      <article><b>${waiting}</b><span>טרם נמצא פתרון</span></article>
    </div>
    ${planningRowsHtml(rows)}
    ${planningInstructorScheduleHtml(rows)}
    ${routeStats ? `<p class="course-planning-route-stats">בדיקות מרחק: ${Number(routeStats.cacheHits) || 0} מהמטמון · ${Number(routeStats.googleCalls) || 0} חישובים חדשים</p>` : ''}
  </section>`;
}
