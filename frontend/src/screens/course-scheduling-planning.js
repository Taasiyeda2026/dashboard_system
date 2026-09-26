import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import { compareCandidatesStable } from './course-scheduling-score.js';
import { calculateCandidateTravel, createRouteClient } from './course-scheduling-travel.js';
import { activityMeetings, schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import { blockedSchoolDates, effectiveEndTime } from './course-scheduling-date-adjustments.js';
import { FIRST_HALF_CONTINUATION_END_DATE, planningPeriodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import {
  isSchedulingActivityActive,
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment,
  schedulingActivityTypeCategory
} from './shared/activity-scheduling-eligibility.js';
import { filterSchoolCalendarRowsBySector, normalizeCalendarSector } from './shared/school-calendar-logic.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (candidate) => text(candidate?.instructor?.emp_id);
const norm = (value) => text(value).replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
const formatPlanningShortDate = (value) => {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : formatDateHe(value);
};
export const DEFAULT_PLANNING_PERIOD_KEY = 'year';
export const PLANNING_OPERATIONAL_START_DATE = '2026-10-06';
export const FIRST_HALF_COUNT_START_DATE = '2026-09-01';
const DEFAULT_TIME_SLOTS = ['08:00', '09:30', '11:00', '12:30', '14:00'];
const MAX_TIME_SLOTS_PER_WEEKDAY = 10;
const MAX_SCENARIOS_PER_COURSE = 60;
const MAX_CANDIDATES_PER_SCENARIO = 4;
const MAX_ROUTED_PLANNING_PAIRS = 6;
const MAX_FINAL_OPTIONS = 6;
export const PLANNING_OPTIMIZATION_WEIGHTS = Object.freeze({
  continuity: 30,
  capacity: 25,
  travel: 20,
  geography: 15,
  stability: 10
});
export const PLANNING_ENGINE_VERSION = 'planning-v15-20260926-date-time-instructor-options';
export const PLANNING_ACTIVITY_NO_ALIASES = Object.freeze({
  // Legacy Gefen identifier retained on existing activities; canonical catalog program is 53828.
  '82835': '53828'
});

export function canonicalPlanningActivityNo(value) {
  const raw = text(value);
  return PLANNING_ACTIVITY_NO_ALIASES[raw] || raw;
}

export const PLANNING_CPU_SLICE_MS = 8;

export class PlanningCancelledError extends Error {
  constructor() {
    super('planning_cancelled');
    this.name = 'PlanningCancelledError';
    this.code = 'planning_cancelled';
    this.silent = true;
  }
}

export function isPlanningCancellationError(error) {
  return error?.code === 'planning_cancelled' || error?.name === 'PlanningCancelledError' || error?.name === 'AbortError';
}

export function createPlanningCheckpoint({
  budgetMs = PLANNING_CPU_SLICE_MS,
  now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()),
  yieldControl = () => {
    if (typeof globalThis.scheduler?.yield === 'function') return globalThis.scheduler.yield();
    return new Promise((resolve) => setTimeout(resolve, 0));
  },
  signal = null,
  isOwner = () => true
} = {}) {
  const budget = Math.max(0, Number(budgetMs) || 0);
  let deadline = now() + budget;
  const assertActive = () => {
    if (signal?.aborted || !isOwner()) throw new PlanningCancelledError();
  };
  return async function checkpoint({ force = false } = {}) {
    assertActive();
    if (!force && now() < deadline) return false;
    await yieldControl();
    assertActive();
    deadline = now() + budget;
    return true;
  };
}

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

function planningScheduleEnd(periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  return text(periodKey) === 'first'
    ? FIRST_HALF_CONTINUATION_END_DATE
    : planningEffectivePeriod(periodKey).end;
}

function officialPlanningDates(activity = {}) {
  const meetingDates = activityMeetings(activity)
    .map((meeting) => text(meeting?.date).slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (meetingDates.length) return meetingDates;
  const startDate = text(activity?.start_date).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? [startDate] : [];
}

export function planningActivityHasStarted(activity = {}, today = '') {
  const currentDate = text(today).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) return false;
  const firstDate = officialPlanningDates(activity)[0] || '';
  return !!firstDate && firstDate <= currentDate;
}

/**
 * A school-provided date owns the semester. Activities without any official date
 * belong to the first half by default, even when the national planner is run for
 * the whole school year.
 */
export function planningPeriodKeyForActivity(activity = {}, requestedPeriodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const requested = text(requestedPeriodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const dates = officialPlanningDates(activity);
  const firstDate = dates[0] || '';

  if (requested === 'second') {
    if (!firstDate) return 'first';
    return firstDate >= resolveCourseSchedulingPeriod('second').start ? 'second' : 'first';
  }
  if (requested === 'first') return 'first';
  if (!firstDate) return 'first';
  return firstDate >= resolveCourseSchedulingPeriod('second').start ? 'second' : 'first';
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
  const requested = text(periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const first = resolveCourseSchedulingPeriod('first');
  const second = resolveCourseSchedulingPeriod('second');
  const year = resolveCourseSchedulingPeriod('year');
  return (activities || [])
    .filter(isPlanningActivity)
    .filter((activity) => {
      const officialDates = officialPlanningDates(activity);
      if (!officialDates.length) {
        // Undated work is a first-half planning responsibility, not a second-half pool.
        return requested !== 'second';
      }
      const firstDate = officialDates[0];
      if (requested === 'first') return firstDate >= first.start && firstDate <= first.end;
      if (requested === 'second') return firstDate >= second.start && firstDate <= second.end;
      return firstDate >= year.start && firstDate <= year.end;
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

function activityAllowsSaturday(activity = {}) {
  return normalizeCalendarSector(activity?.calendar_sector) === 'arab';
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
  const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
  const period = planningEffectivePeriod(activityPeriodKey);
  const scheduleEnd = planningScheduleEnd(activityPeriodKey);
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
  if (weekday(candidate) === 6 && !activityAllowsSaturday(activity)) return null;

  const meetings = [];
  for (let index = 0; index < count; index += 1) {
    if (index > 0) candidate = addDays(candidate, 7);
    let guard = 0;
    while (((weekday(candidate) === 6 && !activityAllowsSaturday(activity)) || blocked.has(candidate)) && guard++ < 30) {
      candidate = addDays(candidate, 7);
    }
    if (!candidate || candidate > scheduleEnd || guard >= 30) return null;
    if (index === 0 && candidate > period.end) return null;
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
  const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
  // A date/time already supplied by the school is an anchor, including fixed
  // September dates before the planner's operational proposal window.
  const period = resolveCourseSchedulingPeriod(activityPeriodKey);
  const scheduleEnd = planningScheduleEnd(activityPeriodKey);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.start || date > scheduleEnd) return null;
    if ((weekday(date) === 6 && !activityAllowsSaturday(activity)) || blocked.has(date)) return null;
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
  const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
  const period = planningEffectivePeriod(activityPeriodKey);
  let candidate = lastOnOrBefore(period.end, targetWeekday);
  while (candidate && candidate >= period.start) {
    const built = buildWeeklyPlanningMeetings({ activity, startDate: candidate, startTime, durationMinutes, sessions, schoolCalendar, periodKey: activityPeriodKey });
    if (built) return candidate;
    candidate = addDays(candidate, -7);
  }
  return '';
}

function blockingActivities(activities = []) {
  return (activities || []).filter((activity) => isSchedulingBlockingAssignment(activity) || isSchedulingDraftAssignment(activity));
}

function planningFlexibleActivity(activity = {}) {
  if (!activity || text(activity.emp_id)) return activity;
  if (!text(activity.draft_emp_id)) return activity;
  return {
    ...activity,
    draft_emp_id: null,
    draft_instructor_name: null,
    draft_proposed_meetings: null,
    draft_created_at: null,
    draft_created_by: null
  };
}

function planningContextActivities(activities = []) {
  return (activities || []).map(planningFlexibleActivity);
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
  activities = [],
  activeIds = null,
  blockingMeetingRows = null
} = {}) {
  const counts = new Map(DEFAULT_TIME_SLOTS.map((slot) => [slot, 1]));
  const resolvedActiveIds = activeIds || activeInstructorIds(instructors);
  const requestedStart = validTimeRange(activity.start_time, activity.end_time) ? text(activity.start_time).slice(0, 5) : '';
  if (requestedStart) counts.set(requestedStart, (counts.get(requestedStart) || 0) + 50);

  for (const empId of resolvedActiveIds) {
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

  for (const meeting of blockingMeetingRows || blockingMeetings(activities)) {
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

function candidateStartDates({ activity, targetWeekday, sessions, startTime, durationMinutes, schoolCalendar = [], today, activities = [], blockingActivityRows = null, periodKey = DEFAULT_PLANNING_PERIOD_KEY } = {}) {
  const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
  const period = planningEffectivePeriod(activityPeriodKey);
  const fixedStart = text(activityMeetings(activity)
    .map((meeting) => text(meeting?.date).slice(0, 10))
    .filter((date) => date >= period.start && date <= period.end)
    .sort()[0] || activity.start_date).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fixedStart)) {
    if (fixedStart < period.start || fixedStart > period.end || weekday(fixedStart) !== Number(targetWeekday)) return [];
    const built = buildWeeklyPlanningMeetings({
      activity, startDate: fixedStart, startTime, durationMinutes, sessions, schoolCalendar, periodKey: activityPeriodKey
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
  const latest = latestFeasiblePlanningStart({ activity, targetWeekday, startTime, durationMinutes, sessions, schoolCalendar, periodKey: activityPeriodKey });
  const values = new Set();
  if (earliest && earliest <= period.end) values.add(earliest);

  const releaseDates = (blockingActivityRows || blockingActivities(activities))
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

function scenarioHeuristic({ scenario, instructors = [], rules = {}, activities = [], activeIds = null, blockingMeetingRows = null } = {}) {
  const resolvedActiveIds = activeIds || activeInstructorIds(instructors);
  const day = weekday(scenario.startDate);
  let availabilityCoverage = 0;
  for (const empId of resolvedActiveIds) {
    if ((rules[empId] || []).some((rule) => Number(rule.weekday) === day && ruleCovers(rule, scenario.startTime, scenario.endTime))) {
      availabilityCoverage += 1;
    }
  }

  let adjacency = 0;
  for (const meeting of blockingMeetingRows || blockingMeetings(activities)) {
    if (weekday(meeting.date) !== day) continue;
    if (text(meeting.end_time).slice(0, 5) === scenario.startTime || text(meeting.start_time).slice(0, 5) === scenario.endTime) adjacency += 1;
  }
  return availabilityCoverage * 10 + adjacency * 4;
}

function* generatePlanningScenarioSteps({
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
  const scenarioActiveIds = activeInstructorIds(instructors);
  const scenarioBlockingActivities = blockingActivities(activities);
  const scenarioBlockingMeetings = blockingMeetings(scenarioBlockingActivities);
  const candidateWeekdays = [0, 1, 2, 3, 4, 5, 6]
    .filter((day) => day !== 6 || activityAllowsSaturday(activity));
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
          activities,
          activeIds: scenarioActiveIds,
          blockingMeetingRows: scenarioBlockingMeetings
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
        heuristic: scenarioHeuristic({ scenario: built, instructors, rules, activities, activeIds: scenarioActiveIds, blockingMeetingRows: scenarioBlockingMeetings })
      });
      yield;
    }
  } else {
    for (const day of candidateWeekdays) {
      const times = fixedStartTime
        ? [fixedStartTime]
        : dynamicTimesForWeekday({
            targetWeekday: day,
            durationMinutes: spec.durationMinutes,
            activity,
            instructors,
            rules,
            activities,
            activeIds: scenarioActiveIds,
            blockingMeetingRows: scenarioBlockingMeetings
          });
      const starts = [...new Set(times.flatMap((startTime) => candidateStartDates({
        activity, targetWeekday: day, sessions: spec.sessions, startTime,
        durationMinutes: spec.durationMinutes, schoolCalendar, today, activities,
        blockingActivityRows: scenarioBlockingActivities, periodKey
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
            heuristic: scenarioHeuristic({ scenario: built, instructors, rules, activities, activeIds: scenarioActiveIds, blockingMeetingRows: scenarioBlockingMeetings })
          });
          yield;
        }
        yield;
      }
      yield;
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
  const scenarioKey = (scenario) => `${scenario.startDate}|${scenario.startTime}|${scenario.endTime}`;
  const addScenario = (scenario) => {
    const key = scenarioKey(scenario);
    if (selectedKeys.has(key) || diversified.length >= limit) return;
    selectedKeys.add(key);
    diversified.push(scenario);
  };

  // Cover the real weekly availability grid before using the remaining slots
  // for generic high-score scenarios. A key is one instructor + one available
  // weekday; greedy coverage prevents a common 08:00 window from hiding a
  // narrower instructor/day window.
  const activeIds = scenarioActiveIds;
  const uncoveredAvailability = new Set();
  for (const empId of activeIds) {
    for (const rule of rules[empId] || []) {
      const day = Number(rule.weekday);
      if (rule.available === true && day >= 0 && day <= 6 && (day !== 6 || activityAllowsSaturday(activity))) {
        uncoveredAvailability.add(`${empId}|${day}`);
      }
    }
  }
  const coverageByScenario = new Map(sorted.map((scenario) => {
    const day = weekday(scenario.startDate);
    const covered = [];
    for (const empId of activeIds) {
      if ((rules[empId] || []).some((rule) =>
        Number(rule.weekday) === day && ruleCovers(rule, scenario.startTime, scenario.endTime)
      )) covered.push(`${empId}|${day}`);
    }
    return [scenarioKey(scenario), covered];
  }));

  while (uncoveredAvailability.size && diversified.length < limit) {
    let best = null;
    let bestCoverage = [];
    for (const scenario of sorted) {
      if (selectedKeys.has(scenarioKey(scenario))) continue;
      const coverage = (coverageByScenario.get(scenarioKey(scenario)) || [])
        .filter((key) => uncoveredAvailability.has(key));
      if (coverage.length > bestCoverage.length) {
        best = scenario;
        bestCoverage = coverage;
      }
    }
    if (!best || !bestCoverage.length) break;
    addScenario(best);
    bestCoverage.forEach((key) => uncoveredAvailability.delete(key));
    yield;
  }

  // Also retain at least one option for every weekday even when no currently
  // active instructor has a rule there, then fill the rest by the normal score.
  for (const day of candidateWeekdays) {
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

export function generatePlanningScenarios(options = {}) {
  const steps = generatePlanningScenarioSteps(options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

async function generatePlanningScenariosCooperatively(options = {}, checkpoint = async () => {}) {
  const steps = generatePlanningScenarioSteps(options);
  let next = steps.next();
  while (!next.done) {
    await checkpoint();
    next = steps.next();
  }
  return next.value;
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

function scaledPlanningComponent(points, sourceMax, targetMax) {
  const value = Number(points);
  if (!Number.isFinite(value) || !Number.isFinite(Number(sourceMax)) || Number(sourceMax) <= 0) return 0;
  return Math.max(0, Math.min(Number(targetMax), (value / Number(sourceMax)) * Number(targetMax)));
}

function planningGeographyPoints(candidate = {}) {
  const meetingCount = Math.max(1, Number(candidate.continuityMeetingCount) || 0);
  const weighted = (
    (Math.max(0, Number(candidate.sameSchoolMeetingCount) || 0) * 1)
    + (Math.max(0, Number(candidate.sameAuthorityMeetingCount) || 0) * 0.8)
    + (Math.max(0, Number(candidate.nearbyMeetingCount) || 0) * 0.6)
    + (Math.max(0, Number(candidate.existingWorkDayMeetingCount) || 0) * 0.35)
  ) / meetingCount;
  return Math.max(0, Math.min(PLANNING_OPTIMIZATION_WEIGHTS.geography, weighted * PLANNING_OPTIMIZATION_WEIGHTS.geography));
}

export function planningOptimizationScore(candidate = {}) {
  const breakdown = candidate.scoreBreakdown || {};
  const continuity = (
    scaledPlanningComponent(breakdown.continuityEfficiency?.points, 35, 24)
    + scaledPlanningComponent(breakdown.gapsAndNewDays?.points, 5, 6)
  );
  const capacity = scaledPlanningComponent(
    breakdown.actualWorkload?.points,
    20,
    PLANNING_OPTIMIZATION_WEIGHTS.capacity
  );
  const travel = scaledPlanningComponent(
    breakdown.travelDistance?.points,
    25,
    PLANNING_OPTIMIZATION_WEIGHTS.travel
  );
  const geography = planningGeographyPoints(candidate);
  const stability = scaledPlanningComponent(
    breakdown.originalSchedulePreservation?.points,
    15,
    PLANNING_OPTIMIZATION_WEIGHTS.stability
  );
  const total = continuity + capacity + travel + geography + stability;
  return {
    total: Math.round(total * 10) / 10,
    continuity: Math.round(continuity * 10) / 10,
    capacity: Math.round(capacity * 10) / 10,
    travel: Math.round(travel * 10) / 10,
    geography: Math.round(geography * 10) / 10,
    stability: Math.round(stability * 10) / 10
  };
}

function recurringSeriesIsStable(meetings = []) {
  if (!Array.isArray(meetings) || meetings.length <= 1) return true;
  const weekdays = new Set(meetings.map((meeting) => weekday(meeting.date)));
  const starts = new Set(meetings.map((meeting) => text(meeting.start_time).slice(0, 5)));
  const ends = new Set(meetings.map((meeting) => text(meeting.end_time).slice(0, 5)));
  return weekdays.size === 1 && starts.size === 1 && ends.size === 1;
}

function planningOperationalReason(course = {}, candidate = {}, optimization = planningOptimizationScore(candidate)) {
  const meetings = activityMeetings(course);
  const parts = [];
  const sameSchool = Number(candidate.sameSchoolMeetingCount) || 0;
  const sameAuthority = Number(candidate.sameAuthorityMeetingCount) || 0;
  const nearby = Number(candidate.nearbyMeetingCount) || 0;
  const existingDays = Number(candidate.existingWorkDayMeetingCount) || 0;
  const newDays = Number(candidate.newWorkDayMeetingCount) || 0;
  if (sameSchool) parts.push(`${sameSchool} מפגשים מתחברים לרצף באותו בית ספר`);
  else if (sameAuthority) parts.push(`${sameAuthority} מפגשים משתלבים באותה רשות`);
  else if (nearby) parts.push(`${nearby} מפגשים משתלבים באזור סמוך`);
  else if (existingDays) parts.push(`${existingDays} מפגשים ממלאים יום עבודה שכבר פתוח`);
  if (newDays > 0) parts.push(`${newDays} מפגשים פותחים יום עבודה חדש`);
  if (Number.isFinite(Number(candidate.relevantTravelDistance)) && Number.isFinite(Number(candidate.relevantTravelMinutes))) {
    parts.push(`${Math.round(Number(candidate.relevantTravelDistance))} ק״מ וכ-${Math.round(Number(candidate.relevantTravelMinutes))} דקות מעבר`);
  }
  if (Number.isFinite(Number(candidate.projectedUtilizationRatio))) {
    parts.push(`ניצול חזוי ${Math.round(Number(candidate.projectedUtilizationRatio) * 100)}%`);
  }
  if (recurringSeriesIsStable(meetings)) parts.push(`סדרה יציבה של ${meetings.length} מפגשים באותו יום ושעה`);
  parts.push(`ציון תפעולי ${optimization.total}/100`);
  return parts.join(' · ');
}

function planningStartWeekKey(value) {
  const raw = text(value).slice(0, 10);
  const date = new Date(`${raw}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(date.getTime())) return '9999-99-99';
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

function planningPairCompare(first = {}, second = {}) {
  const firstWeek = planningStartWeekKey(first.course?.start_date || first.startDate);
  const secondWeek = planningStartWeekKey(second.course?.start_date || second.startDate);
  if (firstWeek !== secondWeek) return firstWeek.localeCompare(secondWeek);

  const firstScore = Number(first.planningOptimization?.total);
  const secondScore = Number(second.planningOptimization?.total);
  if (Number.isFinite(firstScore) && Number.isFinite(secondScore) && firstScore !== secondScore) {
    return secondScore - firstScore;
  }
  const candidateOrder = compareCandidatesStable(first.candidate || first._candidate || {}, second.candidate || second._candidate || {});
  if (candidateOrder) return candidateOrder;
  const firstDate = text(first.course?.start_date || first.startDate);
  const secondDate = text(second.course?.start_date || second.startDate);
  if (firstDate !== secondDate) return firstDate.localeCompare(secondDate);
  return text(first.course?.start_time || first.startTime).localeCompare(text(second.course?.start_time || second.startTime));
}


function optionFromCandidate(course, candidate, { routeVerified = true, startRange = null } = {}) {
  if (!candidate) return null;
  const meetings = activityMeetings(course);
  const planningOptimization = planningOptimizationScore(candidate);
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
    planningOptimization,
    operationalMetrics: {
      relevantTravelDistance: Number.isFinite(Number(candidate.relevantTravelDistance)) ? Number(candidate.relevantTravelDistance) : null,
      relevantTravelMinutes: Number.isFinite(Number(candidate.relevantTravelMinutes)) ? Number(candidate.relevantTravelMinutes) : null,
      projectedUtilizationRatio: Number.isFinite(Number(candidate.projectedUtilizationRatio)) ? Number(candidate.projectedUtilizationRatio) : null,
      continuityMeetingCount: Math.max(0, Number(candidate.continuityMeetingCount) || 0),
      sameSchoolMeetingCount: Math.max(0, Number(candidate.sameSchoolMeetingCount) || 0),
      sameAuthorityMeetingCount: Math.max(0, Number(candidate.sameAuthorityMeetingCount) || 0),
      nearbyMeetingCount: Math.max(0, Number(candidate.nearbyMeetingCount) || 0),
      existingWorkDayMeetingCount: Math.max(0, Number(candidate.existingWorkDayMeetingCount) || 0),
      newWorkDayMeetingCount: Math.max(0, Number(candidate.newWorkDayMeetingCount) || 0)
    },
    explanation: {
      optimization: planningOperationalReason(course, candidate, planningOptimization),
      continuity: text(candidate.scoreBreakdown?.continuityEfficiency?.note || candidate.scoreBreakdown?.continuityEfficiency?.label),
      workload: text(candidate.scoreBreakdown?.actualWorkload?.note),
      travel: text(candidate.scoreBreakdown?.travelDistance?.note),
      scheduleSource: idOf(course).startsWith('planning:') ? 'מועד שנבנה לפי מערכת צוות ההדרכה' : 'מועד קבוע שהתקבל מבית הספר',
      hardGates: 'זמינות, שפה, מגדר, חפיפות, חגים ומעברים נבדקו'
    },
    reason: planningOperationalReason(course, candidate, planningOptimization)
      || text(candidate.recommendationReason)
      || (routeVerified ? 'האפשרות משתלבת בלוח הקיים ועומדת בתנאי הסף' : 'האפשרות מתאימה לפי זמינות; נדרש אימות מרחקים')
  };
}

function optionCompare(first, second) {
  const firstWeek = planningStartWeekKey(first.startDate);
  const secondWeek = planningStartWeekKey(second.startDate);
  if (firstWeek !== secondWeek) return firstWeek.localeCompare(secondWeek);

  const firstScore = Number(first.planningOptimization?.total);
  const secondScore = Number(second.planningOptimization?.total);
  if (Number.isFinite(firstScore) && Number.isFinite(secondScore) && firstScore !== secondScore) {
    return secondScore - firstScore;
  }
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
  checkpoint = async () => {},
  signal = null,
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
    }).map((item) => item.candidate).filter(Boolean).sort(compareCandidatesStable)
      .slice(0, MAX_CANDIDATES_PER_SCENARIO);
    for (const candidate of candidates) {
      preliminaries.push({
        course,
        candidate,
        planningOptimization: planningOptimizationScore(candidate)
      });
    }
    await checkpoint();
  }
  if (!preliminaries.length) {
    return {
      options: [],
      preliminaryCount: 0,
      routedAttemptCount: 0,
      routeVerified: true,
      recruitmentNeeded: true
    };
  }

  preliminaries.sort(planningPairCompare);
  const options = [];
  const optionKeys = new Set();
  let routedAttemptCount = 0;
  let routeVerified = false;
  let routeServiceFailed = false;

  for (let offset = 0; offset < preliminaries.length && options.length < MAX_FINAL_OPTIONS; offset += MAX_ROUTED_PLANNING_PAIRS) {
    const batch = preliminaries.slice(offset, offset + MAX_ROUTED_PLANNING_PAIRS);
    let routed = null;
    try {
      routed = await calculateCandidateTravel(
        batch.map((item) => ({ course: item.course, candidate: item.candidate })),
        contextActivities,
        routeClient,
        { checkpoint, signal }
      );
    } catch (error) {
      if (isPlanningCancellationError(error)) throw error;
      routeServiceFailed = true;
      break;
    }

    routedAttemptCount += batch.length;
    if (!routed || text(routed.unavailableReason)) {
      routeServiceFailed = true;
      break;
    }
    routeVerified = true;

    for (const finalist of batch) {
      await checkpoint();
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
      const expectedEmpId = empOf(finalist.candidate);
      const finalCandidate = (finalResult?.checked || []).find((candidate) =>
        candidate?.eligible && empOf(candidate) === expectedEmpId
      ) || null;
      if (!finalCandidate) continue;
      const option = optionFromCandidate(finalist.course, finalCandidate, {
        routeVerified: !text(routed.unavailableReason),
        startRange
      });
      if (!option) continue;
      const key = `${option.instructorEmpId}|${option.startDate}|${option.startTime}`;
      if (optionKeys.has(key)) continue;
      optionKeys.add(key);
      options.push({ ...option, _candidate: finalCandidate });
      if (options.length >= MAX_FINAL_OPTIONS) break;
    }
  }

  const sortedOptions = options.sort(optionCompare).slice(0, MAX_FINAL_OPTIONS);
  const exhaustive = routedAttemptCount >= preliminaries.length;
  return {
    options: sortedOptions,
    preliminaryCount: preliminaries.length,
    routedAttemptCount,
    routeVerified,
    recruitmentNeeded: sortedOptions.length === 0 && !routeServiceFailed && exhaustive
  };
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
  checkpoint = async () => {},
  signal = null,
  periodKey = DEFAULT_PLANNING_PERIOD_KEY
} = {}) {
  const calendarRows = courseCalendarRows(activity, schoolCalendar);
  const blocked = blockedSchoolDates(calendarRows);
  if (activityMeetings(activity).some((meeting) => {
    const date = text(meeting.date).slice(0, 10);
    return blocked.has(date)
      || text(effectiveEndTime(date, meeting.end_time || activity.end_time, calendarRows)).slice(0, 5)
        !== text(meeting.end_time || activity.end_time).slice(0, 5);
  })) {
    return {
      options: [],
      preliminaryCount: 0,
      routedAttemptCount: 0,
      routeVerified: true,
      recruitmentNeeded: false,
      fixedScheduleInvalid: true
    };
  }

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

  if (!candidates.length) {
    return {
      options: [],
      preliminaryCount: 0,
      routedAttemptCount: 0,
      routeVerified: false,
      recruitmentNeeded: true
    };
  }

  const ranked = candidates
    .map((candidate) => ({ course: activity, candidate, planningOptimization: planningOptimizationScore(candidate) }))
    .sort(planningPairCompare);

  const options = [];
  const optionKeys = new Set();
  let routedAttemptCount = 0;
  let routeVerified = false;
  let routeServiceFailed = false;

  for (let offset = 0; offset < ranked.length && options.length < MAX_FINAL_OPTIONS; offset += MAX_ROUTED_PLANNING_PAIRS) {
    const batch = ranked.slice(offset, offset + MAX_ROUTED_PLANNING_PAIRS);
    let routed = null;
    try {
      routed = await calculateCandidateTravel(
        batch.map((item) => ({ course: activity, candidate: item.candidate })),
        contextActivities,
        routeClient,
        { checkpoint, signal }
      );
    } catch (error) {
      if (isPlanningCancellationError(error)) throw error;
      routeServiceFailed = true;
      break;
    }
    routedAttemptCount += batch.length;
    if (!routed || text(routed.unavailableReason)) {
      routeServiceFailed = true;
      break;
    }
    routeVerified = true;

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

    for (const finalist of batch) {
      await checkpoint();
      const expectedEmpId = empOf(finalist.candidate);
      const finalCandidate = (result?.checked || []).find((candidate) =>
        candidate?.eligible && empOf(candidate) === expectedEmpId
      ) || null;
      if (!finalCandidate) continue;
      const option = optionFromCandidate(activity, finalCandidate, { routeVerified: !text(routed.unavailableReason) });
      if (!option) continue;
      const key = text(option.instructorEmpId);
      if (optionKeys.has(key)) continue;
      optionKeys.add(key);
      options.push({ ...option, _candidate: finalCandidate });
      if (options.length >= MAX_FINAL_OPTIONS) break;
    }
  }

  const sortedOptions = options.filter(Boolean).sort(optionCompare).slice(0, MAX_FINAL_OPTIONS);
  const exhaustive = routedAttemptCount >= ranked.length;
  return {
    options: sortedOptions,
    preliminaryCount: candidates.length,
    routedAttemptCount,
    routeVerified,
    recruitmentNeeded: sortedOptions.length === 0 && !routeServiceFailed && exhaustive
  };
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
  const period = resolveCourseSchedulingPeriod(periodKey);
  const scheduleEnd = planningScheduleEnd(periodKey);
  return schedulingCalendarMeetings(activity).map((meeting, index) => ({
    date: text(meeting?.date).slice(0, 10),
    meeting_no: Number(meeting?.meeting_no) || index + 1,
    start_time: text(meeting?.start_time || activity.start_time).slice(0, 5),
    end_time: text(meeting?.end_time || activity.end_time).slice(0, 5)
  })).filter((meeting) => meeting.date >= period.start && meeting.date <= scheduleEnd);
}

function liveRow(activity = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const calendarMeetings = schedulingCalendarMeetings(activity);
  const meetings = activityMeetingsForPlanning(activity, periodKey);
  const first = meetings[0] || {};
  const last = meetings.at(-1) || {};
  const draft = !text(activity.emp_id) && text(activity.draft_emp_id);
  const assigned = !!text(activity.emp_id);
  const period = planningEffectivePeriod(periodKey);
  const continuationEnd = planningScheduleEnd(periodKey);
  const endDate = text(last.date || activity.end_date).slice(0, 10);
  const rawEndDate = calendarMeetings.map((meeting) => text(meeting?.date).slice(0, 10)).filter(Boolean).sort().at(-1) || endDate;
  const continuesIntoFebruary = periodKey === 'first' && !!rawEndDate && rawEndDate > period.end && rawEndDate <= continuationEnd;
  const halfOverflow = !!rawEndDate && rawEndDate > continuationEnd;
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
    continuesIntoFebruary,
    halfOverflowLabel: halfOverflow ? 'נמשכת מעבר לסוף פברואר' : '',
    reason: assigned
      ? 'נלקח מהשיבוץ הפעיל'
      : (draft
          ? (halfOverflow
              ? `נלקח מטיוטת השיבוץ הקיימת · סיום ${formatDateHe(rawEndDate)} מעבר לסוף פברואר`
              : (continuesIntoFebruary
                  ? `נלקח מטיוטת השיבוץ הקיימת · מחצית א׳ נמשכת עד ${formatDateHe(rawEndDate)} בפברואר`
                  : 'נלקח מטיוטת השיבוץ הקיימת'))
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

function scheduleOnlyOptions(scenarios = [], limit = 8) {
  const seen = new Set();
  return [...(scenarios || [])]
    .filter((scenario) => Array.isArray(scenario?.meetings) && scenario.meetings.length)
    .sort((a, b) =>
      text(a.startDate).localeCompare(text(b.startDate))
      || text(a.startTime).localeCompare(text(b.startTime))
    )
    .filter((scenario) => {
      const key = `${text(scenario.startDate)}|${text(scenario.startTime)}|${text(scenario.endTime)}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(limit) || 8))
    .map((scenario) => ({
      startDate: text(scenario.startDate),
      endDate: text(scenario.endDate),
      startTime: text(scenario.startTime),
      endTime: text(scenario.endTime),
      meetings: (scenario.meetings || []).map((meeting) => ({ ...meeting }))
    }));
}

function timeRangesOverlap(first = {}, second = {}) {
  if (text(first.date) !== text(second.date)) return false;
  const firstStart = timeMinutes(first.start_time);
  const firstEnd = timeMinutes(first.end_time);
  const secondStart = timeMinutes(second.start_time);
  const secondEnd = timeMinutes(second.end_time);
  if ([firstStart, firstEnd, secondStart, secondEnd].some((value) => value == null)) return true;
  return firstStart < secondEnd && secondStart < firstEnd;
}

function normalizedGenderRequirement(value) {
  const raw = norm(value);
  if (['female', 'f', 'נקבה', 'מדריכה'].includes(raw)) return 'female';
  if (['male', 'm', 'זכר', 'מדריך'].includes(raw)) return 'male';
  return 'any';
}

function normalizedLanguageRequirement(value) {
  const raw = norm(value);
  if (!raw) return '';
  if (raw.includes('ערב') || raw === 'ar' || raw === 'arabic') return 'ar';
  if (raw.includes('עבר') || raw === 'he' || raw === 'hebrew') return 'he';
  return raw;
}

function meetingGapMinutes(first = {}, second = {}) {
  const firstStart = timeMinutes(first.start_time);
  const firstEnd = timeMinutes(first.end_time);
  const secondStart = timeMinutes(second.start_time);
  const secondEnd = timeMinutes(second.end_time);
  if ([firstStart, firstEnd, secondStart, secondEnd].some((value) => value == null)) return -1;
  if (firstEnd <= secondStart) return secondStart - firstEnd;
  if (secondEnd <= firstStart) return firstStart - secondEnd;
  return -1;
}

function recruitmentProfileCanTake(profile, row, schedule) {
  const gender = normalizedGenderRequirement(row.requiredGender);
  if (profile.gender !== 'any' && gender !== 'any' && profile.gender !== gender) return false;

  for (const existing of profile.meetings) {
    for (const incoming of schedule.meetings || []) {
      if (timeRangesOverlap(existing, incoming)) return false;
      if (text(existing.date) === text(incoming.date)) {
        const sameSchool = norm(existing.school) && norm(existing.school) === norm(row.school);
        const sameAuthority = norm(existing.authority) && norm(existing.authority) === norm(row.authority);
        if (!sameAuthority) return false;
        if (!sameSchool && meetingGapMinutes(existing, incoming) < 30) return false;
      }
    }
  }
  return true;
}

function recruitmentPlacementScore(profile, row, schedule) {
  const sameAuthority = profile.authorities.has(norm(row.authority)) ? 30 : 0;
  const sameProgram = profile.programs.has(norm(row.courseName)) ? 12 : 0;
  const weekdays = new Set((schedule.meetings || []).map((meeting) => weekday(meeting.date)));
  const reusedDay = [...weekdays].some((day) => profile.weekdays.has(day)) ? 6 : 0;
  return sameAuthority + sameProgram + reusedDay - profile.activities.length;
}

export function assignRecruitmentProfiles(rows = []) {
  const result = (rows || []).map((row) => ({
    ...row,
    meetings: (row.meetings || []).map((meeting) => ({ ...meeting })),
    scheduleOptions: (row.scheduleOptions || []).map((option) => ({
      ...option,
      meetings: (option.meetings || []).map((meeting) => ({ ...meeting }))
    }))
  }));
  const candidates = result
    .filter((row) => row.kind === 'recruitment')
    .sort((a, b) =>
      (a.scheduleOptions?.length || 1) - (b.scheduleOptions?.length || 1)
      || Number(b.sessions || 0) - Number(a.sessions || 0)
      || text(a.courseId).localeCompare(text(b.courseId))
    );
  const profiles = [];

  for (const row of candidates) {
    const choices = row.scheduleOptions?.length
      ? row.scheduleOptions
      : (row.meetings?.length ? [{
          startDate: row.startDate,
          endDate: row.endDate,
          startTime: row.startTime,
          endTime: row.endTime,
          meetings: row.meetings
        }] : []);
    if (!choices.length) continue;

    let best = null;
    for (const profile of profiles) {
      for (const schedule of choices) {
        if (!recruitmentProfileCanTake(profile, row, schedule)) continue;
        const score = recruitmentPlacementScore(profile, row, schedule);
        if (!best || score > best.score) best = { profile, schedule, score };
      }
    }

    if (!best) {
      const profile = {
        id: `recruitment-${profiles.length + 1}`,
        label: `מודל גיוס ${profiles.length + 1}`,
        gender: normalizedGenderRequirement(row.requiredGender),
        languages: new Set(),
        authorities: new Set(),
        programs: new Set(),
        weekdays: new Set(),
        meetings: [],
        activities: []
      };
      profiles.push(profile);
      best = { profile, schedule: choices[0], score: 0 };
    }

    const { profile, schedule } = best;
    const gender = normalizedGenderRequirement(row.requiredGender);
    if (profile.gender === 'any' && gender !== 'any') profile.gender = gender;
    const language = normalizedLanguageRequirement(row.requiredLanguage);
    if (language) profile.languages.add(language);
    if (norm(row.authority)) profile.authorities.add(norm(row.authority));
    if (norm(row.courseName)) profile.programs.add(norm(row.courseName));
    for (const meeting of schedule.meetings || []) {
      profile.meetings.push({ ...meeting, authority: row.authority, school: row.school, courseId: row.courseId });
      profile.weekdays.add(weekday(meeting.date));
    }
    profile.activities.push(row.courseId);

    row.startDate = schedule.startDate;
    row.endDate = schedule.endDate;
    row.startTime = schedule.startTime;
    row.endTime = schedule.endTime;
    row.meetings = (schedule.meetings || []).map((meeting) => ({ ...meeting }));
    row.recruitmentProfileId = profile.id;
    row.recruitmentProfileLabel = profile.label;
  }

  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  for (const row of result) {
    if (!row.recruitmentProfileId) continue;
    const profile = profileById.get(row.recruitmentProfileId);
    row.recruitmentProfileSize = profile?.activities?.length || 1;
    row.reason = `לאחר מיצוי אפשרויות הצוות הקיים: נדרש גיוס. המועד נשמר כהצעה לבית הספר ומשויך ל${row.recruitmentProfileLabel}, שמרכז ${row.recruitmentProfileSize} פעילויות.`;
  }
  return result;
}

function planRowFromOption(activity, option, options, startRange, spec, diagnostics = {}) {
  const recruitmentNeeded = !option && diagnostics.recruitmentNeeded === true;
  const scheduleOptions = diagnostics.scheduleOptions || [];
  const scheduleOnly = scheduleOptions[0] || null;
  return {
    courseId: idOf(activity),
    authority: text(activity.authority),
    district: text(activity.district || activity.school_district || activity.authority_district),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    requiredLanguage: text(activity.instruction_language),
    requiredGender: text(activity.required_instructor_gender),
    sourceHadDraft: !!text(activity.draft_emp_id),
    previousDraftInstructorEmpId: text(activity.draft_emp_id),
    previousDraftMeetings: text(activity.draft_emp_id)
      ? schedulingCalendarMeetings(activity).map((meeting, index) => ({
          date: text(meeting?.date).slice(0, 10),
          meeting_no: Number(meeting?.meeting_no) || index + 1,
          start_time: text(meeting?.start_time || activity.start_time).slice(0, 5),
          end_time: text(meeting?.end_time || activity.end_time).slice(0, 5)
        }))
      : [],
    previousDraftInstructorName: text(activity.draft_instructor_name || activity.draft_emp_id),
    sessions: spec?.sessions || meetingCount(activity),
    kind: option ? 'proposal' : (recruitmentNeeded ? 'recruitment' : 'missing'),
    status: option ? 'מועד מומלץ לבית הספר' : (recruitmentNeeded ? 'נדרש גיוס' : 'נדרש טיפול'),
    startDate: option?.startDate || scheduleOnly?.startDate || '',
    endDate: option?.endDate || scheduleOnly?.endDate || '',
    startTime: option?.startTime || scheduleOnly?.startTime || '',
    endTime: option?.endTime || scheduleOnly?.endTime || '',
    instructorName: option?.instructorName || '',
    instructorEmpId: option?.instructorEmpId || '',
    meetings: option?.meetings || scheduleOnly?.meetings || [],
    scheduleOptions,
    options: (options || []).map(({ _candidate, ...item }) => item),
    startRange,
    diagnostics: {
      preliminaryCount: Number(diagnostics.preliminaryCount) || 0,
      routedAttemptCount: Number(diagnostics.routedAttemptCount) || 0,
      routeVerified: diagnostics.routeVerified === true
    },
    reason: option?.reason
      || (recruitmentNeeded
        ? 'לא נמצא אף מדריך פעיל שעומד בתנאי הסף בכל חלונות התכנון שנבדקו — רק בשלב זה נדרש גיוס'
        : diagnostics.routeVerified === false && Number(diagnostics.preliminaryCount) > 0
          ? 'נמצאו מדריכים אפשריים לפי הזמינות, אך לא ניתן עדיין לאמת את הנסיעות — לא מסומן לגיוס'
          : 'לא נמצאה עדיין התאמה מאומתת; נדרשת בדיקה נוספת לפני החלטה על גיוס')
  };
}


export function normalizePlanningLockedOption(option = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const period = planningEffectivePeriod(periodKey);
  const scheduleEnd = planningScheduleEnd(periodKey);
  const instructorEmpId = text(option.instructorEmpId);
  const instructorName = text(option.instructorName);
  const meetings = (Array.isArray(option.meetings) ? option.meetings : [])
    .map((meeting, index) => ({
      date: text(meeting?.date).slice(0, 10),
      meeting_no: Number(meeting?.meeting_no) || index + 1,
      start_time: text(meeting?.start_time).slice(0, 5),
      end_time: text(meeting?.end_time).slice(0, 5)
    }))
    .filter((meeting) =>
      /^\d{4}-\d{2}-\d{2}$/.test(meeting.date)
      && meeting.date >= period.start
      && meeting.date <= scheduleEnd
      && validTimeRange(meeting.start_time, meeting.end_time)
    );
  if (!instructorEmpId || !meetings.length) return null;
  return {
    ...option,
    instructorEmpId,
    instructorName: instructorName || instructorEmpId,
    startDate: meetings[0].date,
    endDate: meetings.at(-1).date,
    startTime: meetings[0].start_time,
    endTime: meetings[0].end_time,
    meetings
  };
}

export function applyPlanningLockToRow(row = {}, option = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const normalized = normalizePlanningLockedOption(option, periodKey);
  if (!normalized) return { ...row, planningLocked: false };
  return {
    ...row,
    kind: 'planning-locked',
    status: 'נקבע בתכנון',
    planningLocked: true,
    startDate: normalized.startDate,
    endDate: normalized.endDate,
    startTime: normalized.startTime,
    endTime: normalized.endTime,
    instructorName: normalized.instructorName,
    instructorEmpId: normalized.instructorEmpId,
    meetings: normalized.meetings.map((meeting) => ({ ...meeting })),
    options: [
      normalized,
      ...(row?.options || []).filter((candidate) =>
        !(text(candidate?.instructorEmpId) === text(normalized.instructorEmpId)
          && text(candidate?.startDate) === text(normalized.startDate)
          && text(candidate?.startTime) === text(normalized.startTime))
      )
    ],
    reason: 'בחירה משותפת שנקבעה בתכנון — שאר הפעילויות מתעדכנות סביבה'
  };
}

function lockedPlanningRow(activity = {}, option = {}, catalog = [], periodKey = DEFAULT_PLANNING_PERIOD_KEY) {
  const normalized = normalizePlanningLockedOption(option, periodKey);
  if (!normalized) return null;
  const spec = inferPlanningCourseSpec(activity, catalog);
  return {
    ...planRowFromOption(activity, normalized, [normalized], normalized.startRange || null, spec, {
      preliminaryCount: 1,
      routedAttemptCount: 1,
      routeVerified: normalized.routeVerified !== false
    }),
    kind: 'planning-locked',
    status: 'נקבע בתכנון',
    planningLocked: true,
    reason: 'בחירה שנקבעה בתכנון — שאר הפעילויות מחושבות מחדש סביבה'
  };
}

function fixedPlanningWeekday(activity = {}) {
  const dates = activityMeetings(activity)
    .map((meeting) => text(meeting?.date).slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates.length ? weekday(dates[0]) : null;
}

export function estimatedPlanningInstructorCount({
  activity = {},
  spec = null,
  instructors = [],
  profiles = {},
  rules = {}
} = {}) {
  const resolvedSpec = spec || inferPlanningCourseSpec(activity, []);
  const duration = Number(resolvedSpec?.durationMinutes) || 0;
  if (!duration) return 0;
  const fixedDay = fixedPlanningWeekday(activity);
  const fixedStartMinute = timeMinutes(activity.start_time);
  const fixedEndMinute = timeMinutes(activity.end_time);
  const fixedStart = fixedStartMinute != null
    ? formatMinutes(fixedStartMinute)
    : (fixedEndMinute != null ? formatMinutes(fixedEndMinute - duration) : '');
  const fixedEnd = fixedStart ? formatMinutes(timeMinutes(fixedStart) + duration) : '';

  let count = 0;
  const activeIds = activeInstructorIds(instructors);
  for (const empId of activeIds) {
    const eligibleRule = (rules[empId] || []).some((rule) => {
      if (rule.available !== true) return false;
      const day = Number(rule.weekday);
      if (fixedDay != null && day !== fixedDay) return false;
      if (fixedStart && fixedEnd) return ruleCovers(rule, fixedStart, fixedEnd);
      const from = timeMinutes(rule.start_time);
      const to = timeMinutes(rule.end_time);
      return from != null && to != null && to - from >= duration;
    });
    if (eligibleRule) count += 1;
  }
  return count;
}

export function planningActivityDifficulty({
  activity = {},
  catalog = [],
  instructors = [],
  profiles = {},
  rules = {}
} = {}) {
  const spec = inferPlanningCourseSpec(activity, catalog);
  const estimatedInstructorCount = estimatedPlanningInstructorCount({
    activity,
    spec,
    instructors,
    profiles,
    rules
  });
  const knownDates = activityMeetings(activity).length;
  const hasTimeConstraint = timeMinutes(activity.start_time) != null || timeMinutes(activity.end_time) != null;
  return {
    estimatedInstructorCount,
    knownDates,
    hasTimeConstraint,
    sessions: Number(spec.sessions) || 0,
    durationMinutes: Number(spec.durationMinutes) || 0
  };
}

function comparePlanningDifficulty(first = {}, second = {}, context = {}) {
  const a = planningActivityDifficulty({ activity: first, ...context });
  const b = planningActivityDifficulty({ activity: second, ...context });
  if (a.estimatedInstructorCount !== b.estimatedInstructorCount) {
    return a.estimatedInstructorCount - b.estimatedInstructorCount;
  }
  if (a.knownDates !== b.knownDates) return b.knownDates - a.knownDates;
  if (a.hasTimeConstraint !== b.hasTimeConstraint) return a.hasTimeConstraint ? -1 : 1;
  if (a.sessions !== b.sessions) return b.sessions - a.sessions;
  if (a.durationMinutes !== b.durationMinutes) return b.durationMinutes - a.durationMinutes;
  return idOf(first).localeCompare(idOf(second));
}

function planningMeetingsSignature(meetings = []) {
  return (Array.isArray(meetings) ? meetings : [])
    .map((meeting) => [
      text(meeting?.date).slice(0, 10),
      text(meeting?.start_time).slice(0, 5),
      text(meeting?.end_time).slice(0, 5)
    ])
    .filter(([date]) => /^\\d{4}-\\d{2}-\\d{2}$/.test(date))
    .map((parts) => parts.join('|'))
    .sort()
    .join(';');
}

function planningDraftChanged(row = {}) {
  if (row.sourceHadDraft !== true) return false;
  const kind = text(row.kind);
  if (!['proposal', 'fixed-proposal', 'planning-locked'].includes(kind)) return true;

  const previousEmpId = text(row.previousDraftInstructorEmpId);
  const currentEmpId = text(row.instructorEmpId);
  if (!previousEmpId || previousEmpId !== currentEmpId) return true;

  const previousMeetings = planningMeetingsSignature(row.previousDraftMeetings);
  if (!previousMeetings) return false;
  return previousMeetings !== planningMeetingsSignature(row.meetings);
}

export function planningPlanQuality(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const missing = source.filter((row) => row.kind === 'missing' || row.kind === 'fixed').length;
  const recruitmentRows = source.filter((row) => row.kind === 'recruitment');
  const recruitment = recruitmentRows.length;
  const recruitmentProfiles = new Set(
    recruitmentRows.map((row) => text(row.recruitmentProfileId)).filter(Boolean)
  ).size || recruitment;
  const uncovered = missing + recruitment;
  const changedDrafts = source.filter((row) => planningDraftChanged(row)).length;

  let newWorkDayMeetings = 0;
  let travel = 0;
  let travelCount = 0;
  let score = 0;
  let scoreCount = 0;
  for (const row of source) {
    const option = planningRowPrimaryOption(row);
    if (!option) continue;
    newWorkDayMeetings += Math.max(0, Number(option?.operationalMetrics?.newWorkDayMeetingCount) || 0);
    const km = Number(option?.operationalMetrics?.relevantTravelDistance);
    if (Number.isFinite(km)) {
      travel += km;
      travelCount += 1;
    }
    const points = Number(option?.planningOptimization?.total);
    if (Number.isFinite(points)) {
      score += points;
      scoreCount += 1;
    }
  }

  return {
    uncovered,
    missing,
    recruitmentProfiles,
    recruitment,
    changedDrafts,
    newWorkDayMeetings,
    totalTravelKm: Math.round(travel * 10) / 10,
    averageTravelKm: travelCount ? Math.round((travel / travelCount) * 10) / 10 : 0,
    averageOperationalScore: scoreCount ? Math.round((score / scoreCount) * 10) / 10 : 0
  };
}

export const GLOBAL_PLANNING_OBJECTIVE_WEIGHTS = Object.freeze({
  recruitmentCoverage: 35,
  newWorkDays: 20,
  continuityGeography: 18,
  travel: 15,
  gaps: 7,
  workloadBalance: 3,
  stability: 2
});
export const GLOBAL_OPTIMIZATION_MIN_GAIN = 5;
export const GLOBAL_OPTIMIZATION_MAX_PRIORITY_ROWS = 30;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export function planningGlobalObjective(rows = []) {
  const source = Array.isArray(rows) ? rows : [];
  const quality = planningPlanQuality(source);
  const audit = planningQualityAudit(source);
  const totalActivities = Math.max(1, source.length);
  const totalMeetings = Math.max(1, source.reduce((sum, row) => sum + Math.max(0, Number(row?.meetings?.length) || Number(row?.sessions) || 0), 0));

  let continuityWeighted = 0;
  let continuityTotal = 0;
  for (const row of source) {
    const metrics = planningRowPrimaryOption(row)?.operationalMetrics || {};
    const total = Math.max(0, Number(metrics.continuityMeetingCount) || 0);
    if (!total) continue;
    continuityTotal += total;
    continuityWeighted += (
      Math.max(0, Number(metrics.sameSchoolMeetingCount) || 0)
      + Math.max(0, Number(metrics.sameAuthorityMeetingCount) || 0) * 0.8
      + Math.max(0, Number(metrics.nearbyMeetingCount) || 0) * 0.6
      + Math.max(0, Number(metrics.existingWorkDayMeetingCount) || 0) * 0.35
    );
  }

  const hours = (audit.instructorLoads || []).map((item) => Number(item.hours)).filter((value) => Number.isFinite(value) && value >= 0);
  const meanHours = hours.length ? hours.reduce((sum, value) => sum + value, 0) / hours.length : 0;
  const variance = meanHours > 0 && hours.length
    ? hours.reduce((sum, value) => sum + ((value - meanHours) ** 2), 0) / hours.length
    : 0;
  const coefficientOfVariation = meanHours > 0 ? Math.sqrt(variance) / meanHours : 0;
  const draftRows = source.filter((row) => row.sourceHadDraft === true).length;

  const ratios = {
    recruitmentCoverage: 1 - clamp01(quality.uncovered / totalActivities),
    newWorkDays: 1 - clamp01(quality.newWorkDayMeetings / totalMeetings),
    continuityGeography: continuityTotal ? clamp01(continuityWeighted / continuityTotal) : 1,
    travel: 1 - clamp01(quality.averageTravelKm / 40),
    gaps: audit.workDays ? clamp01(audit.packedDays / audit.workDays) : 1,
    workloadBalance: 1 - clamp01(coefficientOfVariation),
    stability: draftRows ? 1 - clamp01(quality.changedDrafts / draftRows) : 1
  };

  const components = Object.fromEntries(
    Object.entries(GLOBAL_PLANNING_OBJECTIVE_WEIGHTS).map(([key, weight]) => [
      key,
      Math.round((ratios[key] * weight) * 10) / 10
    ])
  );
  const total = Math.round(Object.values(components).reduce((sum, value) => sum + value, 0) * 10) / 10;

  return {
    total,
    components,
    ratios,
    uncovered: quality.uncovered,
    recruitment: quality.recruitment,
    recruitmentProfiles: quality.recruitmentProfiles,
    newWorkDayMeetings: quality.newWorkDayMeetings,
    totalTravelKm: quality.totalTravelKm,
    averageTravelKm: quality.averageTravelKm,
    changedDrafts: quality.changedDrafts,
    packedDays: audit.packedDays,
    workDays: audit.workDays,
    singletonDays: audit.singletonDays,
    workloadCoefficientOfVariation: Math.round(coefficientOfVariation * 1000) / 1000
  };
}

export function planningGlobalRepairPriorityIds(rows = [], limit = GLOBAL_OPTIMIZATION_MAX_PRIORITY_ROWS) {
  const source = [...(rows || [])].filter((row) => !['live', 'planning-locked', 'draft'].includes(text(row?.kind)));
  const maxRows = Math.max(1, Number(limit) || GLOBAL_OPTIMIZATION_MAX_PRIORITY_ROWS);
  const critical = source
    .filter((row) => ['recruitment', 'missing', 'fixed'].includes(text(row?.kind)))
    .map((row) => ({
      id: text(row?.courseId),
      priority: text(row?.kind) === 'recruitment' ? 2 : 1
    }))
    .filter((item) => item.id)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  // When coverage is incomplete, move only the uncovered activities to the
  // front. Marking already-covered rows as "priority" as well would preserve
  // the original order and defeat the repair swap that frees scarce staff.
  if (critical.length) return critical.slice(0, maxRows).map((item) => item.id);

  return source
    .map((row) => {
      const option = planningRowPrimaryOption(row);
      const metrics = option?.operationalMetrics || {};
      const optimization = Number(option?.planningOptimization?.total);
      const priority = (
        Math.max(0, Number(metrics.newWorkDayMeetingCount) || 0) * 120
        + Math.max(0, Number(metrics.relevantTravelDistance) || 0) * 4
        + (Number.isFinite(optimization) ? Math.max(0, 75 - optimization) * 3 : 100)
        + (row.sourceHadDraft === true ? 15 : 0)
      );
      return { id: text(row?.courseId), priority };
    })
    .filter((item) => item.id && item.priority > 0)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, maxRows)
    .map((item) => item.id);
}

export function globalOptimizationImprovesPlan(beforeRows = [], afterRows = [], minGain = GLOBAL_OPTIMIZATION_MIN_GAIN) {
  const before = planningGlobalObjective(beforeRows);
  const after = planningGlobalObjective(afterRows);
  if (after.uncovered < before.uncovered) return true;
  if (after.uncovered > before.uncovered) return false;
  if (after.recruitmentProfiles < before.recruitmentProfiles) return true;
  if (after.recruitmentProfiles > before.recruitmentProfiles) return false;
  const gain = Math.round((after.total - before.total) * 10) / 10;
  return gain >= Math.max(0, Number(minGain) || 0);
}

export function comparePlanningPlanQuality(firstRows = [], secondRows = []) {
  const first = planningPlanQuality(firstRows);
  const second = planningPlanQuality(secondRows);
  if (first.uncovered !== second.uncovered) return first.uncovered - second.uncovered;
  if (first.recruitmentProfiles !== second.recruitmentProfiles) return first.recruitmentProfiles - second.recruitmentProfiles;

  const firstObjective = planningGlobalObjective(firstRows);
  const secondObjective = planningGlobalObjective(secondRows);
  if (firstObjective.total !== secondObjective.total) return secondObjective.total - firstObjective.total;

  if (first.changedDrafts !== second.changedDrafts) return first.changedDrafts - second.changedDrafts;
  if (first.newWorkDayMeetings !== second.newWorkDayMeetings) return first.newWorkDayMeetings - second.newWorkDayMeetings;
  if (first.totalTravelKm !== second.totalTravelKm) return first.totalTravelKm - second.totalTravelKm;
  if (first.averageOperationalScore !== second.averageOperationalScore) return second.averageOperationalScore - first.averageOperationalScore;
  if (first.missing !== second.missing) return first.missing - second.missing;
  return 0;
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

export function planningContextFingerprint(input = {}) {
  const snapshot = input || {};
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  let hash = 2166136261;
  const value = JSON.stringify({
    engineVersion: PLANNING_ENGINE_VERSION,
    period: planningEffectivePeriod(periodKey),
    instructors: stableRows((snapshot.instructors || []).map((row) => ({
      emp_id: row.emp_id,
      active: row.active,
      address: row.address,
      gender: row.gender,
      languages: row.languages
    }))),
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
  lockedOptions = {},
  existingRows = [],
  targetCourseIds = null,
  onProgress = null,
  signal = null,
  checkpoint = createPlanningCheckpoint({ signal }),
  _repairPass = false,
  _repairPriorityIds = []
} = {}) {
  const report = async (phase, completed = 0, total = 0, courseId = '', rows = null) => {
    if (typeof onProgress === 'function') onProgress({ phase, completed, total, courseId, rows });
    await checkpoint();
  };
  await report('הכנת נתונים');
  const targets = planningWorkspaceCourses(activities, district, periodKey);
  // Approved assignments are hard constraints. Existing drafts are deliberately
  // removed from the blocking calendar here: the national planner may move or
  // replace them before it concludes that new staff are needed.
  const contextActivities = planningContextActivities(activities);
  const virtualPlans = [];
  const rowsById = new Map();
  const existingById = new Map((existingRows || [])
    .map((row) => [text(row?.courseId) || idOf(row), row])
    .filter(([courseId]) => !!courseId));
  const incrementalIds = Array.isArray(targetCourseIds)
    ? new Set(targetCourseIds.map((value) => text(value)).filter(Boolean))
    : null;
  const fixedUnassigned = [];
  const missingSchedule = [];

  for (const activity of targets) {
    const activityId = idOf(activity);
    const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
    if (text(activity.emp_id)) {
      rowsById.set(activityId, liveRow(activity, activityPeriodKey));
      continue;
    }

    const locked = normalizePlanningLockedOption(lockedOptions?.[activityId], activityPeriodKey);
    if (locked) {
      const lockedRow = lockedPlanningRow(activity, locked, catalog, activityPeriodKey);
      if (lockedRow) rowsById.set(activityId, lockedRow);
      const virtual = blockingVirtualActivity(activity, locked);
      if (virtual) virtualPlans.push(virtual);
      continue;
    }

    if (incrementalIds && !incrementalIds.has(activityId)) {
      const existing = existingById.get(activityId);
      if (existing) {
        const reused = { ...existing, planningLocked: false };
        rowsById.set(activityId, reused);
        if (text(reused.instructorEmpId) && Array.isArray(reused.meetings) && reused.meetings.length) {
          const virtual = blockingVirtualActivity(activity, {
            instructorEmpId: reused.instructorEmpId,
            instructorName: reused.instructorName,
            startDate: reused.startDate,
            endDate: reused.endDate,
            startTime: reused.startTime,
            endTime: reused.endTime,
            meetings: reused.meetings
          });
          if (virtual) virtualPlans.push(virtual);
        }
        continue;
      }
    }

    if (hasOfficialPlanningSchedule(activity)) {
      fixedUnassigned.push(activity);
    } else if (planningActivityHasStarted(activity, today)) {
      const dates = officialPlanningDates(activity);
      rowsById.set(activityId, {
        ...missingOverviewRow(activity, catalog),
        kind: 'fixed',
        status: 'מועד קיים — לא מזיזים',
        startDate: dates[0] || text(activity.start_date).slice(0, 10),
        endDate: dates.at(-1) || text(activity.end_date).slice(0, 10),
        startTime: text(activity.start_time).slice(0, 5),
        endTime: text(activity.end_time).slice(0, 5),
        reason: 'הפעילות כבר התחילה ולכן המערכת אינה משנה את המועדים שלה אוטומטית; יש להשלים מידע חסר או לשבץ מדריך למועד הקיים.'
      });
    } else {
      missingSchedule.push(activity);
    }
  }

  fixedUnassigned.sort((a, b) => {
    const ad = text(activityMeetings(a)[0]?.date || a.start_date);
    const bd = text(activityMeetings(b)[0]?.date || b.start_date);
    return ad.localeCompare(bd) || idOf(a).localeCompare(idOf(b));
  });

  const difficultyContext = { catalog, instructors, profiles, rules };
  missingSchedule.sort((a, b) => comparePlanningDifficulty(a, b, difficultyContext));

  let queue = [
    ...fixedUnassigned.map((activity) => ({ activity, type: 'fixed', activityPeriodKey: planningPeriodKeyForActivity(activity, periodKey) })),
    ...missingSchedule.map((activity) => ({ activity, type: 'missing', activityPeriodKey: planningPeriodKeyForActivity(activity, periodKey) }))
  ];
  if (_repairPass) {
    const priorities = new Set((_repairPriorityIds || []).map((value) => text(value)).filter(Boolean));
    queue = [...queue].sort((a, b) => {
      const aPriority = priorities.has(idOf(a.activity)) ? 0 : 1;
      const bPriority = priorities.has(idOf(b.activity)) ? 0 : 1;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const difficulty = comparePlanningDifficulty(a.activity, b.activity, difficultyContext);
      if (difficulty) return difficulty;
      if (a.type !== b.type) return a.type === 'fixed' ? -1 : 1;
      const aDate = text(officialPlanningDates(a.activity)[0]);
      const bDate = text(officialPlanningDates(b.activity)[0]);
      if (aDate !== bDate) return aDate.localeCompare(bDate);
      return idOf(a.activity).localeCompare(idOf(b.activity));
    });
  }
  let completed = 0;
  await report('יצירת אפשרויות', 0, queue.length);

  for (const item of queue) {
    await checkpoint();
    const { activity, type, activityPeriodKey } = item;
    const currentContext = [...contextActivities, ...virtualPlans];
    await report('בדיקת מדריכים', completed, queue.length, idOf(activity));
    await report('בדיקת נסיעות', completed, queue.length, idOf(activity));
    if (type === 'fixed') {
      const evaluation = await evaluateFixedCourse({
        activity,
        contextActivities: currentContext,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        today,
        routeClient,
        checkpoint,
        signal,
        periodKey: activityPeriodKey
      });
      const options = evaluation.options || [];
      const chosen = options[0] || null;
      const recruitmentNeeded = !chosen && evaluation.recruitmentNeeded === true;
      const fixedLive = liveRow(activity, activityPeriodKey);
      const row = {
        ...fixedLive,
        kind: chosen ? 'fixed-proposal' : (recruitmentNeeded ? 'recruitment' : 'missing'),
        status: chosen ? 'מדריך מומלץ למועד הקבוע' : (recruitmentNeeded ? 'נדרש גיוס' : 'נדרש טיפול'),
        instructorName: chosen?.instructorName || '',
        instructorEmpId: chosen?.instructorEmpId || '',
        meetings: chosen?.meetings || fixedLive.meetings,
        scheduleOptions: [{
          startDate: fixedLive.startDate,
          endDate: fixedLive.endDate,
          startTime: fixedLive.startTime,
          endTime: fixedLive.endTime,
          meetings: fixedLive.meetings
        }],
        requiredLanguage: text(activity.instruction_language),
        requiredGender: text(activity.required_instructor_gender),
        sourceHadDraft: !!text(activity.draft_emp_id),
        previousDraftInstructorEmpId: text(activity.draft_emp_id),
        previousDraftMeetings: text(activity.draft_emp_id)
          ? schedulingCalendarMeetings(activity).map((meeting, index) => ({
              date: text(meeting?.date).slice(0, 10),
              meeting_no: Number(meeting?.meeting_no) || index + 1,
              start_time: text(meeting?.start_time || activity.start_time).slice(0, 5),
              end_time: text(meeting?.end_time || activity.end_time).slice(0, 5)
            }))
          : [],
        previousDraftInstructorName: text(activity.draft_instructor_name || activity.draft_emp_id),
        district: text(activity.district || activity.school_district || activity.authority_district),
        options: options.map(({ _candidate, ...option }) => option),
        diagnostics: {
          preliminaryCount: Number(evaluation.preliminaryCount) || 0,
          routedAttemptCount: Number(evaluation.routedAttemptCount) || 0,
          routeVerified: evaluation.routeVerified === true
        },
        reason: chosen?.reason
          || (evaluation.fixedScheduleInvalid
            ? 'המועד שקבע בית הספר מתנגש בחופשה או בשעת סיום מותרת — נדרש טיפול במועד לפני גיוס'
            : recruitmentNeeded
              ? 'אין מדריך פעיל שעומד בתנאי הסף למועד הקבוע — נדרש גיוס'
              : Number(evaluation.preliminaryCount) > 0 && evaluation.routeVerified === false
                ? 'יש מדריכים אפשריים לפי הזמינות אך לא ניתן לאמת נסיעות — לא מסומן לגיוס'
                : 'נדרשת בדיקה נוספת לפני החלטה על גיוס')
      };
      rowsById.set(idOf(activity), row);
      const virtual = blockingVirtualActivity(activity, chosen);
      if (virtual) virtualPlans.push(virtual);
    } else {
      const generated = await generatePlanningScenariosCooperatively({
        activity,
        catalog,
        instructors,
        rules,
        profiles,
        activities: currentContext,
        schoolCalendar,
        today,
        periodKey: activityPeriodKey
      }, checkpoint);
      if (!generated.spec.complete) {
        rowsById.set(idOf(activity), missingOverviewRow(activity, catalog));
      } else {
        const evaluation = await evaluateScenarioOptions({
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
          checkpoint,
          signal,
          periodKey: activityPeriodKey
        });
        const options = evaluation.options || [];
        const chosen = options[0] || null;
        rowsById.set(idOf(activity), planRowFromOption(
          activity,
          chosen,
          options,
          generated.startRange,
          generated.spec,
          {
            ...evaluation,
            scheduleOptions: scheduleOnlyOptions(generated.scenarios)
          }
        ));
        const virtual = blockingVirtualActivity(activity, chosen);
        if (virtual) virtualPlans.push(virtual);
      }
    }

    completed += 1;
    const partialRows = targets.map((target) => rowsById.get(idOf(target)) || missingOverviewRow(target, catalog));
    await report('בניית תוכנית', completed, queue.length, idOf(activity), partialRows);
  }

  const rows = assignRecruitmentProfiles(
    targets.map((activity) => rowsById.get(idOf(activity)) || missingOverviewRow(activity, catalog))
  );
  const summarize = (selectedRows, extra = {}) => ({
    rows: selectedRows,
    total: selectedRows.length,
    planned: selectedRows.filter((row) => ['proposal', 'fixed-proposal', 'planning-locked'].includes(row.kind) && row.instructorEmpId).length,
    locked: selectedRows.filter((row) => row.kind === 'planning-locked').length,
    live: selectedRows.filter((row) => row.kind === 'live').length,
    drafts: selectedRows.filter((row) => row.kind === 'draft').length,
    missing: selectedRows.filter((row) => row.kind === 'missing' || row.kind === 'fixed').length,
    recruitment: selectedRows.filter((row) => row.kind === 'recruitment').length,
    quality: planningPlanQuality(selectedRows),
    routeStats: {
      googleCalls: Number(routeClient.googleCalls) || 0,
      cacheHits: Number(routeClient.cacheHits) || 0
    },
    ...extra
  });

  const initialResult = summarize(rows, { repairApplied: _repairPass });
  if (_repairPass || incrementalIds) return initialResult;

  const repairPriorityIds = planningGlobalRepairPriorityIds(rows);
  if (!repairPriorityIds.length) return {
    ...initialResult,
    globalOptimization: {
      applied: false,
      before: planningGlobalObjective(rows),
      after: planningGlobalObjective(rows),
      gain: 0
    }
  };

  await report('אופטימיזציה ארצית', 0, repairPriorityIds.length);
  const repaired = await buildDynamicCoursePlan({
    activities,
    instructors,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    catalog,
    district,
    periodKey,
    today,
    routeClient,
    lockedOptions,
    existingRows: [],
    targetCourseIds: null,
    onProgress: typeof onProgress === 'function'
      ? (progress) => onProgress({ ...progress, phase: `שיפור · ${progress.phase}` })
      : null,
    signal,
    checkpoint,
    _repairPass: true,
    _repairPriorityIds: repairPriorityIds
  });

  const beforeObjective = planningGlobalObjective(rows);
  const afterObjective = planningGlobalObjective(repaired.rows);
  const gain = Math.round((afterObjective.total - beforeObjective.total) * 10) / 10;
  const improved = comparePlanningPlanQuality(repaired.rows, rows) < 0
    && globalOptimizationImprovesPlan(rows, repaired.rows);

  if (improved) {
    return {
      ...repaired,
      repairApplied: true,
      repairImprovement: {
        before: planningPlanQuality(rows),
        after: planningPlanQuality(repaired.rows)
      },
      globalOptimization: {
        applied: true,
        before: beforeObjective,
        after: afterObjective,
        gain
      }
    };
  }
  return {
    ...initialResult,
    repairApplied: false,
    repairImprovement: {
      before: planningPlanQuality(rows),
      after: planningPlanQuality(repaired.rows)
    },
    globalOptimization: {
      applied: false,
      before: beforeObjective,
      after: afterObjective,
      gain
    }
  };
}

function rowMeetingSourceLabel(row = {}) {
  if (row.kind === 'live') return 'שיבוץ קיים';
  if (row.kind === 'draft') return 'טיוטה קיימת';
  if (row.kind === 'proposal' || row.kind === 'fixed-proposal') return 'הצעת מערכת';
  if (row.kind === 'planning-locked') return 'בחירה בתכנון';
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


function firstHalfCountingPeriod() {
  const period = resolveCourseSchedulingPeriod('first');
  return { ...period, start: FIRST_HALF_COUNT_START_DATE };
}

function planningCompletionStatus(row = {}) {
  if (row.kind === 'live') return 'משובץ';
  if (row.kind === 'draft') return 'טיוטה';
  if (row.kind === 'planning-locked') return 'נקבע בתכנון';
  if (row.sourceHadDraft && (row.kind === 'proposal' || row.kind === 'fixed-proposal')) return 'הצעת שינוי לטיוטה';
  if (row.kind === 'proposal' || row.kind === 'fixed-proposal') return 'הצעת מערכת';
  return text(row.status) || 'בתכנון';
}

function planningCompletionDateRange(row = {}) {
  const dates = [
    ...(Array.isArray(row?.meetings) ? row.meetings : []).map((meeting) => text(meeting?.date).slice(0, 10)),
    text(row?.startDate).slice(0, 10),
    text(row?.endDate).slice(0, 10)
  ].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  return {
    startDate: dates[0] || '',
    endDate: dates.at(-1) || ''
  };
}

function planningRowIsFirstHalf(row = {}) {
  const period = firstHalfCountingPeriod();
  const dates = planningCompletionDateRange(row);
  if (!dates.startDate && !dates.endDate) return true;
  const startDate = dates.startDate || dates.endDate;
  const endDate = dates.endDate || dates.startDate;
  return startDate <= period.end && endDate >= period.start;
}

export function buildPlanningCompletionRows({ activities = [], planningRows = [] } = {}) {
  const firstHalf = firstHalfCountingPeriod();
  const byId = new Map((planningRows || []).map((row) => [text(row?.courseId), row]));
  const rows = [];

  for (const activity of activities || []) {
    if (!isPlanningActivity(activity)) continue;
    const dates = officialPlanningDates(activity);
    const firstOfficialDate = dates[0] || '';
    if (firstOfficialDate && (firstOfficialDate < firstHalf.start || firstOfficialDate > firstHalf.end)) continue;

    const activityId = idOf(activity);
    const assigned = !!text(activity.emp_id);
    const draft = !assigned && !!text(activity.draft_emp_id);
    if (assigned) {
      rows.push(liveRow(activity, 'first'));
      continue;
    }

    const planningRow = byId.get(activityId);
    if (planningRow) {
      rows.push(planningRow);
      continue;
    }
    if (draft) {
      rows.push(liveRow(activity, 'first'));
      continue;
    }

    rows.push({
      ...missingOverviewRow(activity, []),
      reason: dates.length
        ? 'הפעילות במחצית א׳ אך עדיין אין לה שיבוץ בתכנון'
        : 'אין מועד קבוע — הפעילות שייכת למחצית א׳ ונדרשת לתכנון'
    });
  }

  return rows;
}

export function planningInstructorCompletionOverview(rows = []) {
  const firstHalf = firstHalfCountingPeriod();
  const groups = new Map();

  for (const row of rows || []) {
    const empId = text(row?.instructorEmpId);
    const name = text(row?.instructorName);
    if (!empId || !name || !planningRowIsFirstHalf(row)) continue;

    const key = empId || name;
    if (!groups.has(key)) {
      groups.set(key, {
        empId,
        name,
        activities: [],
        liveCount: 0,
        draftCount: 0,
        proposalCount: 0,
        courseCount: 0,
        otherActivityCount: 0,
        undatedCount: 0,
        continuationCount: 0,
        overflowCount: 0,
        meetings: [],
        travelWeightedKm: 0,
        travelMeetingWeight: 0
      });
    }

    const group = groups.get(key);
    const dates = planningCompletionDateRange(row);
    const activityType = text(row?.activityType) || 'קורס';
    const activity = {
      courseId: text(row?.courseId),
      courseName: text(row?.courseName) || 'פעילות',
      activityType,
      school: text(row?.school),
      authority: text(row?.authority),
      status: planningCompletionStatus(row),
      kind: text(row?.kind),
      startDate: dates.startDate,
      endDate: dates.endDate
    };
    group.activities.push(activity);

    for (const meeting of Array.isArray(row.meetings) ? row.meetings : []) {
      const date = text(meeting?.date).slice(0, 10);
      const startTime = text(meeting?.start_time || row.startTime).slice(0, 5);
      const endTime = text(meeting?.end_time || row.endTime).slice(0, 5);
      if (!date) continue;
      group.meetings.push({ date, startTime, endTime });
    }
    const primaryOption = planningRowPrimaryOption(row);
    const travelKm = Number(primaryOption?.operationalMetrics?.relevantTravelDistance);
    const travelMeetingCount = Array.isArray(row.meetings) ? row.meetings.length : 0;
    if (Number.isFinite(travelKm) && travelMeetingCount > 0) {
      group.travelWeightedKm += travelKm * travelMeetingCount;
      group.travelMeetingWeight += travelMeetingCount;
    }

    if (row.kind === 'live') group.liveCount += 1;
    else if (row.kind === 'draft' || row.kind === 'planning-locked') group.draftCount += 1;
    else if (['proposal', 'fixed-proposal'].includes(row.kind)) group.proposalCount += 1;

    if (activityType === 'קורס') group.courseCount += 1;
    else group.otherActivityCount += 1;
    if (!dates.startDate) group.undatedCount += 1;
    if (dates.endDate && dates.endDate > firstHalf.end && dates.endDate <= FIRST_HALF_CONTINUATION_END_DATE) group.continuationCount += 1;
    if (row.halfOverflow === true || (dates.endDate && dates.endDate > FIRST_HALF_CONTINUATION_END_DATE)) group.overflowCount += 1;
  }

  return [...groups.values()].map((group) => {
    const datedStarts = group.activities.map((item) => item.startDate).filter(Boolean).sort();
    const datedEnds = group.activities.map((item) => item.endDate).filter(Boolean).sort();
    const programs = [...new Set(group.activities.map((item) => item.courseName).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'he'));
    const activities = [...group.activities].sort((a, b) =>
      (a.startDate || '9999-99-99').localeCompare(b.startDate || '9999-99-99')
      || a.courseName.localeCompare(b.courseName, 'he')
      || a.school.localeCompare(b.school, 'he')
    );
    const workDates = new Set();
    const weeks = new Map();
    let teachingMinutes = 0;
    for (const meeting of group.meetings) {
      workDates.add(meeting.date);
      const start = timeMinutes(meeting.startTime);
      const end = timeMinutes(meeting.endTime);
      const minutes = start != null && end != null && end > start ? end - start : 0;
      teachingMinutes += minutes;
      const weekKey = planningStartWeekKey(meeting.date);
      if (!weeks.has(weekKey)) weeks.set(weekKey, { days: new Set(), minutes: 0, meetings: 0 });
      const week = weeks.get(weekKey);
      week.days.add(meeting.date);
      week.minutes += minutes;
      week.meetings += 1;
    }
    const peakWeek = [...weeks.entries()].sort((a, b) =>
      b[1].minutes - a[1].minutes
      || b[1].meetings - a[1].meetings
      || a[0].localeCompare(b[0])
    )[0] || null;
    return {
      ...group,
      activityCount: activities.length,
      meetingCount: group.meetings.length,
      teachingHours: Math.round((teachingMinutes / 60) * 10) / 10,
      averageWorkDaysPerWeek: weeks.size ? Math.round((workDates.size / weeks.size) * 10) / 10 : 0,
      peakWeekStart: peakWeek?.[0] || '',
      peakWeekHours: peakWeek ? Math.round((peakWeek[1].minutes / 60) * 10) / 10 : 0,
      peakWeekDays: peakWeek?.[1]?.days?.size || 0,
      expectedTravelKmPerMeeting: group.travelMeetingWeight
        ? Math.round((group.travelWeightedKm / group.travelMeetingWeight) * 10) / 10
        : null,
      firstStart: datedStarts[0] || '',
      lastEnd: datedEnds.at(-1) || '',
      programs,
      activities
    };
  }).sort((a, b) =>
    b.activityCount - a.activityCount
    || a.name.localeCompare(b.name, 'he')
  );
}


export function planningFullWorkPlanCoverage(rows = []) {
  const firstHalfRows = (rows || []).filter(planningRowIsFirstHalf);
  const team = firstHalfRows.filter((row) => !!text(row?.instructorEmpId)).length;
  const recruitment = firstHalfRows.filter((row) => row?.kind === 'recruitment').length;
  const unresolved = firstHalfRows.length - team - recruitment;
  return {
    total: firstHalfRows.length,
    team,
    recruitment,
    unresolved: Math.max(0, unresolved),
    complete: firstHalfRows.length === team + recruitment + Math.max(0, unresolved)
  };
}

function planningRecruitmentLanguageLabel(value) {
  const normalized = normalizedLanguageRequirement(value);
  if (normalized === 'ar') return 'ערבית';
  if (normalized === 'he') return 'עברית';
  return text(value);
}

function planningRecruitmentGenderLabel(value) {
  const normalized = normalizedGenderRequirement(value);
  if (normalized === 'female') return 'מדריכה';
  if (normalized === 'male') return 'מדריך';
  return '';
}

const PLANNING_WEEKDAY_LABELS = Object.freeze(['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת']);

export function planningCompletionOverviewHtml(rows = [], { pendingChanges = 0, schoolYearTotal = null } = {}) {
  const firstHalfRows = (rows || []).filter(planningRowIsFirstHalf);
  const overview = planningInstructorCompletionOverview(firstHalfRows);
  if (!firstHalfRows.length) return '';

  const totals = firstHalfRows.reduce((acc, row) => {
    const activityType = text(row?.activityType) || 'קורס';
    const dates = planningCompletionDateRange(row);
    acc.activities += 1;
    if (activityType === 'קורס') acc.courses += 1;
    else acc.otherActivities += 1;
    if (row.kind === 'live') acc.live += 1;
    else if (row.kind === 'draft' || row.kind === 'planning-locked') acc.drafts += 1;
    else if (row.kind === 'proposal' || row.kind === 'fixed-proposal') acc.proposals += 1;
    else if (row.kind === 'recruitment') acc.recruitment += 1;
    else acc.unresolved += 1;
    if (!dates.startDate) acc.undated += 1;
    if (dates.endDate && dates.endDate > firstHalfCountingPeriod().end && dates.endDate <= FIRST_HALF_CONTINUATION_END_DATE) acc.continuation += 1;
    if (row.halfOverflow === true || (dates.endDate && dates.endDate > FIRST_HALF_CONTINUATION_END_DATE)) acc.overflow += 1;
    return acc;
  }, {
    activities: 0,
    courses: 0,
    otherActivities: 0,
    live: 0,
    drafts: 0,
    proposals: 0,
    recruitment: 0,
    unresolved: 0,
    undated: 0,
    continuation: 0,
    overflow: 0
  });
  const recruitmentProfiles = new Map();
  for (const row of firstHalfRows.filter((item) => item.kind === 'recruitment' && item.recruitmentProfileId)) {
    const key = text(row.recruitmentProfileId);
    if (!recruitmentProfiles.has(key)) {
      recruitmentProfiles.set(key, {
        id: key,
        label: text(row.recruitmentProfileLabel) || key,
        activities: [],
        authorities: new Set(),
        programs: new Set(),
        languages: new Set(),
        gender: '',
        weekdays: new Set(),
        meetingCount: 0,
        teachingMinutes: 0,
        firstStart: '',
        lastEnd: ''
      });
    }
    const profile = recruitmentProfiles.get(key);
    profile.activities.push(row);
    if (text(row.authority)) profile.authorities.add(text(row.authority));
    if (text(row.courseName)) profile.programs.add(text(row.courseName));
    if (text(row.requiredLanguage)) profile.languages.add(planningRecruitmentLanguageLabel(row.requiredLanguage));
    const gender = planningRecruitmentGenderLabel(row.requiredGender);
    if (gender) profile.gender = gender;
    for (const meeting of Array.isArray(row.meetings) ? row.meetings : []) {
      const date = text(meeting?.date).slice(0, 10);
      const start = timeMinutes(meeting?.start_time || row.startTime);
      const end = timeMinutes(meeting?.end_time || row.endTime);
      const day = weekday(date);
      if (day != null && PLANNING_WEEKDAY_LABELS[day]) profile.weekdays.add(PLANNING_WEEKDAY_LABELS[day]);
      profile.meetingCount += 1;
      if (start != null && end != null && end > start) profile.teachingMinutes += end - start;
    }
    const dates = planningCompletionDateRange(row);
    if (dates.startDate && (!profile.firstStart || dates.startDate < profile.firstStart)) profile.firstStart = dates.startDate;
    if (dates.endDate && (!profile.lastEnd || dates.endDate > profile.lastEnd)) profile.lastEnd = dates.endDate;
  }
  const recruitmentProfileRows = [...recruitmentProfiles.values()]
    .map((profile) => ({
      ...profile,
      teachingHours: Math.round((profile.teachingMinutes / 60) * 10) / 10,
      weekdays: [...profile.weekdays]
    }))
    .sort((a, b) => b.activities.length - a.activities.length || a.label.localeCompare(b.label, 'he'));

  const coverage = planningFullWorkPlanCoverage(firstHalfRows);
  const unresolvedRows = firstHalfRows.filter((row) =>
    !text(row?.instructorEmpId) && row.kind !== 'recruitment'
  );
  return `<section class="course-planning-completion-overview" data-planning-completion-overview>
    <div class="course-planning-section-heading course-planning-workplan-heading">
      <div>
        <strong>תוכנית עבודה מלאה — מחצית א׳</strong>
        <span>${coverage.total} פעילויות = ${coverage.team} לצוות הקיים + ${coverage.recruitment} לגיוס + ${coverage.unresolved} חריגים</span>
      </div>
    </div>
    <div class="course-planning-workplan-balance" data-workplan-balance>
      <article class="course-planning-workplan-card is-total"><b>${coverage.total}</b><span>כל הפעילויות</span></article>
      <article class="course-planning-workplan-card is-team"><b>${coverage.team}</b><span>מתוכננות לצוות הקיים</span><small>${overview.length} מדריכים</small></article>
      <article class="course-planning-workplan-card is-recruitment"><b>${coverage.recruitment}</b><span>נדרש גיוס</span><small>${recruitmentProfileRows.length} מודלי גיוס</small></article>
      <article class="course-planning-workplan-card is-unresolved${coverage.unresolved ? ' has-attention' : ''}"><b>${coverage.unresolved}</b><span>חסר נתון / פתרון</span><small>${coverage.unresolved ? 'נדרש טיפול' : 'כל הפעילויות נכללות בתכנון'}</small></article>
    </div>
    ${recruitmentProfileRows.length ? `<section class="course-planning-recruitment-models">
      <div class="course-planning-section-heading">
        <div>
          <strong>תכנון לגיוס ולהכשרה</strong>
          <span>רק פעילויות שלא נמצא להן מדריך קיים שעובר את כל תנאי הסף</span>
        </div>
      </div>
      <div class="course-planning-recruitment-model-grid">
        ${recruitmentProfileRows.map((profile) => `<article class="course-planning-recruitment-model">
          <header><b>${escapeHtml(profile.label)}</b><span>${profile.activities.length} פעילויות</span></header>
          <div class="course-planning-recruitment-model-load">
            <strong>${profile.meetingCount} מפגשים · ${profile.teachingHours} ש׳</strong>
            <span>${profile.weekdays.length ? escapeHtml(profile.weekdays.join(', ')) : 'ימים ייקבעו לפי התכנון'}</span>
          </div>
          <p>${escapeHtml([...profile.authorities].join(', ') || 'מספר אזורים')}</p>
          <small>${profile.languages.size ? `שפה: ${escapeHtml([...profile.languages].join(', '))} · ` : ''}${profile.gender ? `${escapeHtml(profile.gender)} · ` : ''}${escapeHtml([...profile.programs].join(', '))}</small>
          <small>${profile.firstStart ? `<bdi dir="ltr">${escapeHtml(formatDateHe(profile.firstStart))}</bdi>` : 'ללא מועד'}${profile.lastEnd ? `–<bdi dir="ltr">${escapeHtml(formatDateHe(profile.lastEnd))}</bdi>` : ''}</small>
        </article>`).join('')}
      </div>
    </section>` : ''}
    ${overview.length ? `<section class="course-planning-team-plan">
      <div class="course-planning-section-heading">
        <div>
          <strong>תכנון לצוות הקיים</strong>
        </div>
      </div>
      <div class="course-planning-completion-table-wrap">
      <table class="course-planning-completion-table">
        <thead><tr>
          <th>מדריך</th>
          <th>משובץ</th>
          <th>ממתין לאישור</th>
          <th>בתכנון</th>
          <th>סה״כ מתוכנן</th>
          <th>מתחיל</th>
          <th>מסתיים</th>
        </tr></thead>
        <tbody>${overview.map((item) => {
          const detailKey = text(item.empId || item.name);
          const courseNames = (item.programs || []).filter(Boolean);
          return `<tr>
          <td class="course-planning-completion-cell is-instructor">
            <strong>${escapeHtml(item.name)}</strong>
            <button type="button" class="course-planning-completion-detail-toggle"
              data-planning-instructor-details-toggle="${escapeHtml(detailKey)}"
              aria-expanded="false">פעילויות וקורסים</button>
          </td>
          <td class="course-planning-completion-cell is-live">${item.liveCount}</td>
          <td class="course-planning-completion-cell is-draft">${item.draftCount}</td>
          <td class="course-planning-completion-cell is-proposal">${item.proposalCount}</td>
          <td class="course-planning-completion-cell is-load"><b>${item.activityCount}</b> פעילויות · <b>${item.meetingCount}</b> מפגשים · שבוע שיא: <b>${item.peakWeekDays}</b> י"ע${item.peakWeekStart ? ` (<bdi dir="ltr">${escapeHtml(formatPlanningShortDate(item.peakWeekStart))}</bdi>)` : ''}</td>
          <td class="course-planning-completion-cell is-start">${item.firstStart ? `<bdi dir="ltr">${escapeHtml(formatDateHe(item.firstStart))}</bdi>` : '<span class="course-planning-completion-missing">חסר מועד</span>'}</td>
          <td class="course-planning-completion-cell is-end ${item.overflowCount ? 'is-warning' : ''}">${item.lastEnd ? `<bdi dir="ltr">${escapeHtml(formatDateHe(item.lastEnd))}</bdi>` : '<span class="course-planning-completion-missing">חסר מועד</span>'}</td>
        </tr>
        <tr class="course-planning-completion-detail-row" data-planning-instructor-details="${escapeHtml(detailKey)}" hidden>
          <td colspan="7">
            <div class="course-planning-completion-detail-panel">
              <p><strong>קורסים:</strong> ${escapeHtml(courseNames.join(' · ') || 'ללא תוכנית')}</p>
              <div class="course-planning-completion-activity-list">
                ${item.activities.map((activity) => `<div class="course-planning-completion-activity-row">
                  <strong>${escapeHtml(activity.courseName || 'פעילות')}</strong>
                  <span>${escapeHtml(activity.school || 'ללא בית ספר')}${activity.authority ? ` · ${escapeHtml(activity.authority)}` : ''}</span>
                  <span>${escapeHtml(activity.status || '')}</span>
                  <span>${activity.startDate ? `<bdi dir="ltr">${escapeHtml(formatDateHe(activity.startDate))}</bdi>` : 'ללא מועד'}${activity.endDate ? `–<bdi dir="ltr">${escapeHtml(formatDateHe(activity.endDate))}</bdi>` : ''}</span>
                </div>`).join('')}
              </div>
            </div>
          </td>
        </tr>`;
        }).join('')}</tbody>
      </table>
      </div>
    </section>` : ''}
    ${unresolvedRows.length ? `<details class="course-planning-workplan-unresolved">
      <summary>${unresolvedRows.length} פעילויות שעדיין לא ניתן לכלול בתוכנית העבודה</summary>
      <div>
        ${unresolvedRows.map((row) => `<article>
          <strong>${escapeHtml(row.courseName || 'פעילות')}</strong>
          <span>${escapeHtml(row.school || 'ללא בית ספר')}${row.authority ? ` · ${escapeHtml(row.authority)}` : ''}</span>
          <small>${escapeHtml(text(row.reason) || 'נדרש טיפול נוסף')}</small>
        </article>`).join('')}
      </div>
    </details>` : ''}
  </section>`;
}

function planningRowPrimaryOption(row = {}) {
  const options = Array.isArray(row?.options) ? row.options : [];
  const selected = options.find((option) =>
    text(option?.instructorEmpId) === text(row?.instructorEmpId)
    && text(option?.startDate) === text(row?.startDate)
    && text(option?.startTime) === text(row?.startTime)
  );
  return selected || options[0] || null;
}

function planningQualityIssueRow(row = {}, type = '', label = '') {
  return {
    type,
    label,
    courseId: text(row.courseId),
    courseName: text(row.courseName) || text(row.courseId) || 'פעילות',
    school: text(row.school),
    authority: text(row.authority),
    instructorName: text(row.instructorName)
  };
}

export function planningQualityAudit(rows = [], { pendingChanges = 0 } = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const schedules = planningInstructorSchedules(sourceRows);
  const plannedKinds = new Set(['proposal', 'fixed-proposal', 'planning-locked']);
  const unresolvedRows = sourceRows.filter((row) =>
    ['missing', 'fixed'].includes(row.kind)
    || (plannedKinds.has(row.kind) && !text(row.instructorEmpId))
  );
  const recruitmentRows = sourceRows.filter((row) => row.kind === 'recruitment');
  const overflowRows = sourceRows.filter((row) => {
    if (!planningRowIsFirstHalf(row)) return false;
    const endDate = planningCompletionDateRange(row).endDate;
    return row.halfOverflow === true || (!!endDate && endDate > FIRST_HALF_CONTINUATION_END_DATE);
  });
  const unverifiedRows = sourceRows.filter((row) => {
    if (!plannedKinds.has(row.kind) || !text(row.instructorEmpId)) return false;
    const primary = planningRowPrimaryOption(row);
    return primary?.routeVerified === false || row?.diagnostics?.routeVerified === false;
  });
  const plannedRows = sourceRows.filter((row) => plannedKinds.has(row.kind) && text(row.instructorEmpId));
  const coveredRows = sourceRows.filter((row) => text(row.instructorEmpId));
  const operationalOptions = plannedRows.map(planningRowPrimaryOption).filter(Boolean);
  const scoreValues = operationalOptions
    .map((option) => Number(option?.planningOptimization?.total))
    .filter(Number.isFinite);
  const metrics = operationalOptions.map((option) => option.operationalMetrics || {});
  const newWorkDayMeetings = metrics.reduce((sum, item) => sum + (Number(item.newWorkDayMeetingCount) || 0), 0);
  const sameSchoolMeetings = metrics.reduce((sum, item) => sum + (Number(item.sameSchoolMeetingCount) || 0), 0);
  const sameAuthorityMeetings = metrics.reduce((sum, item) => sum + (Number(item.sameAuthorityMeetingCount) || 0), 0);
  const nearbyMeetings = metrics.reduce((sum, item) => sum + (Number(item.nearbyMeetingCount) || 0), 0);

  const conflicts = [];
  const instructorLoads = [];
  let workDays = 0;
  let packedDays = 0;
  let singletonDays = 0;
  let sameSchoolClusteredMeetings = 0;
  let sameAuthorityClusteredMeetings = 0;
  let totalMeetingMinutes = 0;

  for (const schedule of schedules) {
    const days = new Map();
    for (const meeting of schedule.meetings || []) {
      if (!days.has(meeting.date)) days.set(meeting.date, []);
      days.get(meeting.date).push(meeting);
    }

    let instructorMinutes = 0;
    let instructorPackedDays = 0;
    let instructorSingletonDays = 0;
    for (const [date, dayMeetings] of days.entries()) {
      const sorted = [...dayMeetings].sort((a, b) =>
        (timeMinutes(a.startTime) ?? 9999) - (timeMinutes(b.startTime) ?? 9999)
        || (timeMinutes(a.endTime) ?? 9999) - (timeMinutes(b.endTime) ?? 9999)
      );
      const courseIds = new Set(sorted.map((meeting) => text(meeting.courseId)).filter(Boolean));
      if (courseIds.size >= 2) {
        packedDays += 1;
        instructorPackedDays += 1;
      } else {
        singletonDays += 1;
        instructorSingletonDays += 1;
      }

      const schoolGroups = new Map();
      const authorityGroups = new Map();
      for (const meeting of sorted) {
        const schoolKey = norm(meeting.school);
        const authorityKey = norm(meeting.authority);
        if (schoolKey) {
          if (!schoolGroups.has(schoolKey)) schoolGroups.set(schoolKey, []);
          schoolGroups.get(schoolKey).push(meeting);
        }
        if (authorityKey) {
          if (!authorityGroups.has(authorityKey)) authorityGroups.set(authorityKey, []);
          authorityGroups.get(authorityKey).push(meeting);
        }
      }
      for (const group of schoolGroups.values()) {
        if (new Set(group.map((meeting) => text(meeting.courseId))).size >= 2) sameSchoolClusteredMeetings += group.length;
      }
      for (const group of authorityGroups.values()) {
        if (new Set(group.map((meeting) => text(meeting.courseId))).size >= 2) sameAuthorityClusteredMeetings += group.length;
      }
      workDays += 1;

      for (let index = 0; index < sorted.length; index += 1) {
        const current = sorted[index];
        const currentStart = timeMinutes(current.startTime);
        const currentEnd = timeMinutes(current.endTime);
        if (currentStart != null && currentEnd != null && currentEnd > currentStart) {
          const duration = currentEnd - currentStart;
          instructorMinutes += duration;
          totalMeetingMinutes += duration;
        }
        for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
          const previous = sorted[previousIndex];
          const previousStart = timeMinutes(previous.startTime);
          const previousEnd = timeMinutes(previous.endTime);
          if (currentStart == null || currentEnd == null || previousStart == null || previousEnd == null) continue;
          if (currentStart < previousEnd && previousStart < currentEnd) {
            conflicts.push({
              instructorEmpId: schedule.empId,
              instructorName: schedule.name,
              date,
              first: previous,
              second: current
            });
          }
        }
      }
    }

    instructorLoads.push({
      empId: schedule.empId,
      name: schedule.name,
      activityCount: schedule.activityCount,
      meetingCount: schedule.meetings.length,
      workDays: days.size,
      packedDays: instructorPackedDays,
      singletonDays: instructorSingletonDays,
      hours: Math.round((instructorMinutes / 60) * 10) / 10
    });
  }

  const pendingCount = Math.max(0, Number(pendingChanges) || 0);
  const hardIssueCount = conflicts.length + unverifiedRows.length;
  const attentionCount = unresolvedRows.length + recruitmentRows.length + overflowRows.length;
  let status = 'מוכן לעבודה';
  let tone = 'ready';
  if (pendingCount > 0) {
    status = 'ממתין לעדכון';
    tone = 'pending';
  } else if (hardIssueCount > 0) {
    status = 'נדרשת בדיקה';
    tone = 'warning';
  } else if (attentionCount > 0) {
    status = 'יש חריגים לטיפול';
    tone = 'attention';
  }

  const issues = [
    ...unverifiedRows.map((row) => planningQualityIssueRow(row, 'route', 'נסיעה לא אומתה')),
    ...unresolvedRows.map((row) => planningQualityIssueRow(row, 'unresolved', 'טרם נמצא שיבוץ מלא')),
    ...recruitmentRows.map((row) => planningQualityIssueRow(row, 'recruitment', 'נדרש גיוס')),
    ...overflowRows.map((row) => planningQualityIssueRow(row, 'overflow', 'נמשכת מעבר לסוף פברואר'))
  ];

  return {
    status,
    tone,
    pendingCount,
    totalActivities: sourceRows.length,
    coveredActivities: coveredRows.length,
    coveragePercent: sourceRows.length ? Math.round((coveredRows.length / sourceRows.length) * 100) : 0,
    unresolvedRows,
    recruitmentRows,
    overflowRows,
    unverifiedRows,
    conflicts,
    hardIssueCount,
    attentionCount,
    issues,
    instructorLoads: instructorLoads.sort((a, b) =>
      b.hours - a.hours || b.activityCount - a.activityCount || a.name.localeCompare(b.name, 'he')
    ),
    instructorCount: schedules.length,
    workDays,
    packedDays,
    singletonDays,
    packedDayPercent: workDays ? Math.round((packedDays / workDays) * 100) : 0,
    totalHours: Math.round((totalMeetingMinutes / 60) * 10) / 10,
    averageOperationalScore: scoreValues.length
      ? Math.round((scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length) * 10) / 10
      : null,
    newWorkDayMeetings,
    sameSchoolMeetings,
    sameAuthorityMeetings,
    nearbyMeetings,
    sameSchoolClusteredMeetings,
    sameAuthorityClusteredMeetings
  };
}

function planningQualityIssuesHtml(audit = {}) {
  const rows = [];
  for (const conflict of audit.conflicts || []) {
    rows.push(`<li><strong>חפיפה · ${escapeHtml(conflict.instructorName || 'מדריך')}</strong> · <bdi dir="ltr">${escapeHtml(formatDateHe(conflict.date))}</bdi> · ${escapeHtml(conflict.first?.courseName || conflict.first?.courseId || 'פעילות')} <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(conflict.first?.startTime, conflict.first?.endTime))}</bdi> מול ${escapeHtml(conflict.second?.courseName || conflict.second?.courseId || 'פעילות')} <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(conflict.second?.startTime, conflict.second?.endTime))}</bdi></li>`);
  }
  for (const issue of audit.issues || []) {
    const location = [issue.school, issue.authority].filter(Boolean).join(' · ');
    rows.push(`<li><strong>${escapeHtml(issue.label)}</strong> · ${escapeHtml(issue.courseName)}${location ? ` · ${escapeHtml(location)}` : ''}${issue.instructorName ? ` · ${escapeHtml(issue.instructorName)}` : ''}</li>`);
  }
  if (audit.pendingCount > 0) {
    rows.unshift(`<li><strong>התכנון טרם מעודכן</strong> · ${audit.pendingCount} פעילויות מסומנות לחישוב מצומצם</li>`);
  }
  return rows.length
    ? `<ul class="course-planning-quality-issues">${rows.join('')}</ul>`
    : '<p class="course-planning-quality-clear">לא נמצאו חפיפות, נסיעות לא מאומתות או פעילויות פתוחות לטיפול.</p>';
}

function planningQualityInstructorTableHtml(audit = {}) {
  if (!(audit.instructorLoads || []).length) return '<p class="course-planning-quality-clear">אין עדיין עומס מדריכים לחישוב.</p>';
  return `<div class="course-planning-quality-table-wrap">
    <table class="course-planning-quality-table">
      <thead><tr><th>מדריך</th><th>פעילויות</th><th>מפגשים</th><th>ימי עבודה</th><th>ימים מרוכזים</th><th>ימים עם פעילות אחת</th><th>שעות</th></tr></thead>
      <tbody>${audit.instructorLoads.map((item) => `<tr>
        <td><strong>${escapeHtml(item.name || item.empId || '—')}</strong></td>
        <td>${item.activityCount}</td>
        <td>${item.meetingCount}</td>
        <td>${item.workDays}</td>
        <td>${item.packedDays}</td>
        <td>${item.singletonDays}</td>
        <td>${item.hours}</td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

export function planningQualityAuditHtml(rows = [], { pendingChanges = 0 } = {}) {
  const audit = planningQualityAudit(rows, { pendingChanges });
  const scoreText = Number.isFinite(audit.averageOperationalScore)
    ? `${audit.averageOperationalScore}/100`
    : '—';
  const issueCount = (audit.conflicts?.length || 0) + (audit.issues?.length || 0) + (audit.pendingCount > 0 ? 1 : 0);
  return `<section class="course-planning-quality" data-planning-quality-audit>
    <div class="course-planning-quality-head">
      <strong>בדיקת איכות התכנון</strong>
      <span class="course-planning-quality-status is-${escapeHtml(audit.tone)}">${escapeHtml(audit.status)}</span>
    </div>
    <div class="course-planning-quality-grid">
      <article><b>${audit.coveragePercent}%</b><span>פעילויות עם מדריך</span><small>${audit.coveredActivities} מתוך ${audit.totalActivities}</small></article>
      <article class="${audit.conflicts.length ? 'is-alert' : 'is-ok'}"><b>${audit.conflicts.length}</b><span>חפיפות מדריך</span><small>${audit.conflicts.length ? 'דורש טיפול' : 'ללא התנגשויות'}</small></article>
      <article class="${audit.unverifiedRows.length ? 'is-alert' : 'is-ok'}"><b>${audit.unverifiedRows.length}</b><span>נסיעות לא מאומתות</span><small>${audit.unverifiedRows.length ? 'אין לאשר לפני אימות' : 'הצעות התכנון מאומתות'}</small></article>
      <article><b>${audit.recruitmentRows.length}</b><span>נדרש גיוס</span><small>${audit.unresolvedRows.length} נוספות לבירור</small></article>
      <article><b>${audit.packedDayPercent}%</b><span>ימי עבודה מרוכזים</span><small>${audit.packedDays} מתוך ${audit.workDays} ימי מדריך</small></article>
      <article><b>${audit.singletonDays}</b><span>ימים עם פעילות אחת</span><small>יעד לשיפור רציפות</small></article>
      <article><b>${scoreText}</b><span>ציון תפעולי ממוצע</span><small>להצעות שחושבו</small></article>
      <article><b>${audit.totalHours}</b><span>שעות הדרכה מתוכננות</span><small>${audit.instructorCount} מדריכים</small></article>
    </div>
    <div class="course-planning-quality-efficiency">
      <span><strong>${audit.sameSchoolClusteredMeetings}</strong> מפגשים מרוכזים באותו בית ספר ובאותו יום</span>
      <span><strong>${audit.sameAuthorityClusteredMeetings}</strong> מפגשים מרוכזים באותה רשות ובאותו יום</span>
      <span><strong>${audit.packedDays}</strong> ימי מדריך עם 2 פעילויות ומעלה</span>
      <span><strong>${audit.singletonDays}</strong> ימי מדריך עם פעילות אחת</span>
    </div>
    <details class="course-planning-quality-details"${issueCount ? ' open' : ''}>
      <summary>חריגים לטיפול (${issueCount})</summary>
      ${planningQualityIssuesHtml(audit)}
    </details>
    <details class="course-planning-quality-details">
      <summary>עומס ורציפות לפי מדריך (${audit.instructorCount})</summary>
      ${planningQualityInstructorTableHtml(audit)}
    </details>
  </section>`;
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
  if (kind === 'proposal' || kind === 'fixed-proposal' || kind === 'planning-locked') return ' is-proposal';
  if (kind === 'recruitment') return ' is-recruitment';
  return ' is-missing';
}

function optionHtml(option = {}, index = 1, courseId = '', optionIndex = 0, loading = false) {
  const range = option.startRange?.min && option.startRange?.max
    ? ` · טווח התחלה ${formatDateHe(option.startRange.min)}–${formatDateHe(option.startRange.max)}`
    : '';
  return `<div class="course-planning-option">
    <div class="course-planning-option-head">
      <strong>חלופה ${index}: ${escapeHtml(option.instructorName || '—')}</strong>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-planning-pick-btn"
        data-planning-pick-option data-planning-course-id="${escapeHtml(courseId)}" data-planning-option-index="${optionIndex}" ${loading ? 'disabled' : ''}>בחר חלופה</button>
    </div>
    <span><bdi dir="ltr">${escapeHtml(formatDateHe(option.startDate))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(option.endDate))}</bdi> · <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(option.startTime, option.endTime))}</bdi>${escapeHtml(range)}</span>
    <small>${escapeHtml(option.reason || '')}${option.routeVerified === false ? ' · מרחק טרם אומת' : ''}</small>
  </div>`;
}

function explanationHtml(option = {}) {
  const explanation = option.explanation || {};
  const items = [explanation.optimization, explanation.continuity, explanation.workload, explanation.travel, explanation.scheduleSource, explanation.hardGates].filter(Boolean);
  return items.length ? `<details class="course-planning-explanation"><summary>למה הוצע?</summary><ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></details>` : '';
}

export function planningRowsHtml(rows = [], { loading = false } = {}) {
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
    const alternatives = !row.planningLocked && (row.options || []).length > 1
      ? `<details class="course-planning-alternatives"><summary>${row.options.length - 1} חלופות</summary>${row.options.slice(1).map((option, index) => optionHtml(option, index + 1, row.courseId, index + 1, loading)).join('')}</details>`
      : '';
    const recommendationBadge = ['proposal', 'fixed-proposal'].includes(row.kind) && row.instructorEmpId
      ? '<span class="course-planning-recommended">מומלץ</span>'
      : (row.planningLocked ? '<span class="course-planning-recommended">נקבע בתכנון</span>' : '');
    const planningAction = row.planningLocked
      ? `<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-planning-inline-action"
          data-planning-unlock data-planning-course-id="${escapeHtml(row.courseId)}" ${loading ? 'disabled' : ''}>שחרר לתכנון מחדש</button>`
      : (['proposal', 'fixed-proposal'].includes(row.kind) && row.instructorEmpId && row.options?.[0]
          ? `<button type="button" class="course-scheduling-btn course-scheduling-btn--primary course-planning-inline-action"
              data-planning-pick-option data-planning-course-id="${escapeHtml(row.courseId)}" data-planning-option-index="0" ${loading ? 'disabled' : ''}>קבע בתכנון</button>`
          : '');
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
      <div class="course-planning-choice-actions">${recommendationBadge}${planningAction}</div>
      ${row.halfOverflow ? `<span class="course-planning-half-overflow">${escapeHtml(row.halfOverflowLabel || 'חורגת מתקופת התכנון')}</span>` : ''}
      ${row.reason ? `<p class="course-planning-reason">${escapeHtml(row.reason)}</p>` : ''}
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
  routeStats = null,
  pendingChanges = 0,
  sharedLoaded = false,
  sharedUpdatedAt = '',
  sharedUpdatedBy = '',
  sharedRevision = 0
} = {}) {
  const period = planningEffectivePeriod(periodKey);
  const planningPeriods = planningPeriodOptions();
  const districtOptions = ['<option value="">כל המחוזות</option>', ...(districts || []).map((item) =>
    `<option value="${escapeHtml(item)}"${normalizeOperationalDistrict(item) === normalizeOperationalDistrict(district) ? ' selected' : ''}>${escapeHtml(item)}</option>`
  )].join('');
  const periodOptionsHtml = planningPeriods.map((item) =>
    `<option value="${escapeHtml(item.key)}"${item.key === periodKey ? ' selected' : ''}>${escapeHtml(item.label)}</option>`
  ).join('');
  const live = rows.filter((row) => row.kind === 'live').length;
  const drafts = rows.filter((row) => row.kind === 'draft').length;
  const proposals = rows.filter((row) => ['proposal', 'fixed-proposal', 'planning-locked'].includes(row.kind) && row.instructorEmpId).length;
  const recruitment = rows.filter((row) => row.kind === 'recruitment').length;
  const waiting = rows.filter((row) =>
    ['missing', 'fixed'].includes(row.kind)
    || (['proposal', 'fixed-proposal'].includes(row.kind) && !row.instructorEmpId)
  ).length;
  const progressText = loading
    ? `${escapeHtml(progress?.phase || 'הכנת נתונים')} · ${Number(progress?.completed) || 0} מתוך ${Number(progress?.total) || rows.length} פעילויות`
    : '';
  const pendingCount = Math.max(0, Number(pendingChanges) || 0);
  const exportReady = !!calculatedAt && rows.length > 0 && !loading && pendingCount === 0;
  const runLabel = loading
    ? 'בונה מערכת…'
    : (!calculatedAt
      ? 'בנה מערכת הדרכות מלאה'
      : (pendingCount ? `עדכן רק ${pendingCount} פעילויות שהשתנו` : 'חשב הכל מחדש'));
  return `<section class="course-planning-tab" data-course-planning-tab>
    <div class="course-planning-banner">
      <strong>תכנון עבודה מלא</strong>
      <div class="course-planning-period">${escapeHtml(period.label)} · <bdi dir="ltr">${escapeHtml(formatDateHe(period.start))}</bdi>–<bdi dir="ltr">${escapeHtml(formatDateHe(period.end))}</bdi></div>
    </div>
    <div class="course-planning-toolbar">
      <label>תקופת תכנון<select class="course-scheduling-input" data-planning-period-filter>${periodOptionsHtml}</select></label>
      <label>מחוז<select class="course-scheduling-input" data-planning-district-filter>${districtOptions}</select></label>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-run-course-planning ${loading ? 'disabled' : ''}>${escapeHtml(runLabel)}</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-refresh-shared-planning ${loading ? 'disabled' : ''}>רענן תכנון משותף</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-export-course-planning ${exportReady ? '' : 'disabled'}>ייצוא Excel</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-clear-course-planning ${loading ? 'disabled' : ''}>אפס הצעות</button>
      ${calculatedAt ? `<span class="course-planning-updated">עודכן ${escapeHtml(calculatedAt)}</span>` : ''}
    </div>
    ${error ? `<p class="course-scheduling-alert">${escapeHtml(error)}</p>` : ''}
    ${progressText ? `<p class="course-planning-progress" role="status">${escapeHtml(progressText)}</p>` : ''}
    <div class="course-planning-summary">
      <article><b>${rows.length}</b><span>כל הפעילויות</span></article>
      <article><b>${live}</b><span>מעודכן בפועל</span></article>
      <article><b>${drafts}</b><span>טיוטות קיימות</span></article>
      <article><b>${proposals}</b><span>מועדים להצעה לבית הספר</span></article>
      <article><b>${waiting}</b><span>נדרש בירור נוסף</span></article>
      <article><b>${recruitment}</b><span>נדרש גיוס</span></article>
    </div>
    ${calculatedAt && rows.length && !loading ? planningQualityAuditHtml(rows, { pendingChanges: pendingCount }) : ''}
    ${calculatedAt && rows.length && !loading ? planningCompletionOverviewHtml(rows, { pendingChanges: pendingCount }) : ''}
    ${planningRowsHtml(rows, { loading })}
    ${calculatedAt && rows.length && pendingCount === 0 ? `<details class="course-planning-instructor-overview"><summary>מערכת מלאה לפי מדריך ולפי מפגש</summary>${planningInstructorScheduleHtml(rows)}</details>` : ''}
  </section>`;
}
