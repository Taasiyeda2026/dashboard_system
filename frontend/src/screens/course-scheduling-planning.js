import {
  appendSchedulingRunActivityCooperatively,
  calculateCourseSchedule,
  calculateCourseScheduleCooperatively,
  preliminaryCourseCandidates,
  preliminaryCourseCandidatesCooperatively,
  prepareSchedulingRunContext,
  prepareSchedulingRunContextCooperatively,
  forkSchedulingRunContextCooperatively,
  updateSchedulingRunContextCooperatively
} from './course-scheduling-engine.js';
import { compareCandidatesStable } from './course-scheduling-score.js';
import {
  appendCandidateTravelActivity,
  calculateCandidateTravel,
  createCandidateTravelContext,
  createRouteClient
} from './course-scheduling-travel.js';
import { activityMeetings, schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import {
  blockedSchoolDates,
  effectiveEndTime,
  liveAvailabilityConflicts,
  validatePlanningMeetingsForInstructors,
  meetingInstructorEmpId
} from './course-scheduling-date-adjustments.js';
import { FIRST_HALF_CONTINUATION_END_DATE, planningPeriodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import {
  MAX_HOME_DISTANCE_KM,
  NEARBY_TRANSITION_BUFFER_MINUTES,
  exceedsTransitionDistanceLimit,
  transitionDistanceCapApplies,
  transitionBufferMinutes
} from './instructor-matching-engine.js';
import {
  isSchedulingActivityActive,
  isSchedulingBlockingAssignment,
  isSchedulingDraftAssignment,
  isFullDaySchedulingActivity,
  schedulingActivityTypeCategory
} from './shared/activity-scheduling-eligibility.js';
import {
  calendarPresentationTitle,
  filterSchoolCalendarRowsBySector,
  normalizeCalendarSector
} from './shared/school-calendar-logic.js';
import { normalizeOperationalDistrict } from './shared/district-normalization.js';
import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';
import { planningPerfCount, planningPerfTimer } from './course-scheduling-perf.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);
const empOf = (candidate) => text(candidate?.instructor?.emp_id);
const normalizationCache = new Map();
const norm = (value) => {
  const raw = text(value);
  if (normalizationCache.has(raw)) return normalizationCache.get(raw);
  const normalized = raw.replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
  if (normalizationCache.size >= 4096) normalizationCache.clear();
  normalizationCache.set(raw, normalized);
  return normalized;
};
const formatPlanningShortDate = (value) => {
  const raw = text(value).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1].slice(2)}` : formatDateHe(value);
};
export const DEFAULT_PLANNING_PERIOD_KEY = 'year';
export const PLANNING_OPERATIONAL_START_DATE = '2026-10-12';
export const FIRST_HALF_COUNT_START_DATE = '2026-09-01';
const DEFAULT_TIME_SLOTS = ['08:00', '09:30', '11:00', '12:30', '14:00'];
const MAX_TIME_SLOTS_PER_WEEKDAY = 10;
const MAX_SCENARIOS_PER_COURSE = 60;
const MAX_CANDIDATES_PER_SCENARIO = 4;
const MAX_ROUTED_PLANNING_PAIRS = 6;
const MAX_FINAL_OPTIONS = 6;
const MAX_SCHOOL_PACKING_OPTIONS = 24;
const SCHOOL_PACKING_OPTIONS_PER_SCENARIO = 2;
export const TOUR_OPERATIONAL_START_TIME = '09:00';
export const TOUR_OPERATIONAL_END_TIME = '14:00';
export const TOUR_OPERATIONAL_DURATION_MINUTES = 300;
const FAST_PLANNING_LIMITS = Object.freeze({
  maxScenarios: 12,
  maxCandidatesPerScenario: 3,
  maxRoutedPlanningPairs: 6,
  maxFinalOptions: 3,
  runGlobalRepair: false
});
export const FAST_RESCUE_BUDGET_MS = 12_000;
export const FAST_FULL_RESCUE_ACTIVITY_BUDGET_MS = 2_000;
export const FAST_FULL_RESCUE_TOTAL_BUDGET_MS = 20_000;
const FAST_FULL_RESCUE_MAX_SCENARIOS = 24;
class PlanningRescueBudgetExceededError extends Error {
  constructor() {
    super('planning_rescue_budget_exceeded');
    this.code = 'planning_rescue_budget_exceeded';
  }
}

export function createPlanningDeadlineCheckpoint({
  checkpoint = async () => {},
  budgetMs = FAST_RESCUE_BUDGET_MS,
  now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())
} = {}) {
  const deadline = now() + Math.max(0, Number(budgetMs) || 0);
  return async (...args) => {
    await checkpoint(...args);
    if (now() >= deadline) throw new PlanningRescueBudgetExceededError();
  };
}
const DEEP_PLANNING_LIMITS = Object.freeze({
  maxScenarios: MAX_SCENARIOS_PER_COURSE,
  maxCandidatesPerScenario: MAX_CANDIDATES_PER_SCENARIO,
  maxRoutedPlanningPairs: MAX_ROUTED_PLANNING_PAIRS,
  maxFinalOptions: MAX_FINAL_OPTIONS,
  runGlobalRepair: true
});
function planningLimits(profile = 'deep') {
  return text(profile).toLowerCase() === 'fast' ? FAST_PLANNING_LIMITS : DEEP_PLANNING_LIMITS;
}
export const PLANNING_OPTIMIZATION_WEIGHTS = Object.freeze({
  continuity: 30,
  capacity: 25,
  travel: 20,
  geography: 15,
  stability: 10
});
export const PLANNING_VALIDATION_VERSION = 'planning-validation-v2-20261006-certified-outcomes';
export const PLANNING_ENGINE_VERSION = 'planning-v29-20261006-certified-outcomes';
export const PLANNING_ACTIVITY_NO_ALIASES = Object.freeze({
  // Legacy Gefen identifier retained on existing activities; canonical catalog program is 53828.
  '82835': '53828'
});

/**
 * Validation-currency SoT for stored shared planning.
 *
 * Workspaces only persist `engine_version`. `PLANNING_VALIDATION_VERSION` documents
 * validation-logic eras, but it is not embedded in the engine token and must not be
 * substring-matched against it. Currency is therefore engine equality: when validation
 * hard-gates change, bump `PLANNING_ENGINE_VERSION` (and this constant together).
 */
export function isPlanningValidationCurrent(storedEngineVersion = '') {
  return text(storedEngineVersion) === PLANNING_ENGINE_VERSION;
}

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
    // scheduler.yield continuations can outrank timer tasks in Chromium. A
    // timer-queue boundary lets lease renewals and cancellation actually run.
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
    planningPerfCount('cooperativeYields');
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

const PLANNING_WEEKDAY_SHORT_LABELS = Object.freeze(['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'שבת']);

function planningWeekdayDisplay(value) {
  const day = Number.isInteger(value) ? value : weekday(value);
  if (day == null || day < 0 || day > 6) return '';
  const label = PLANNING_WEEKDAY_SHORT_LABELS[day];
  if (!label) return '';
  return day === 6 ? 'שבת' : `יום ${label}`;
}

function planningMeetingTimeRangeKey(meeting = {}) {
  const startTime = text(meeting?.start_time).slice(0, 5);
  const endTime = text(meeting?.end_time).slice(0, 5);
  if (!startTime || !endTime) return '';
  return `${startTime}–${endTime}`;
}

function planningDominantMapKey(counts = new Map()) {
  let bestKey = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }
  return bestKey;
}

/**
 * Presentation-only schedule summary for existing-team planning details.
 * Derives weekday/time labels from the full meeting series pattern, not meetings[0].
 * One-off moved outliers are excluded from the pattern; substitute assignments do not
 * change hours (hours always come from the meeting itself).
 */
export function planningActivityScheduleFields(row = {}) {
  const meetings = Array.isArray(row?.meetings) ? row.meetings : [];
  const meetingCount = meetings.length;
  if (!meetingCount) {
    return {
      meetingCount: 0,
      uniqueWeekdays: [],
      uniqueTimeRanges: [],
      dominantWeekday: null,
      dominantTimeRange: null,
      weekdayLabel: '',
      timeRangeLabel: '',
      hasVariableWeekdays: false,
      hasVariableTimes: false,
      startTime: '',
      endTime: ''
    };
  }

  const patternMeetings = meetings.filter((meeting) => meeting?.moved !== true);
  const series = patternMeetings.length ? patternMeetings : meetings;
  const weekdayCounts = new Map();
  const timeCounts = new Map();
  for (const meeting of series) {
    const day = weekday(meeting?.date);
    if (day != null) weekdayCounts.set(day, (weekdayCounts.get(day) || 0) + 1);
    const range = planningMeetingTimeRangeKey(meeting);
    if (range) timeCounts.set(range, (timeCounts.get(range) || 0) + 1);
  }

  const uniqueWeekdays = [...weekdayCounts.keys()].sort((a, b) => a - b);
  const uniqueTimeRanges = [...timeCounts.keys()].sort((a, b) => a.localeCompare(b));
  const dominantWeekdayRaw = planningDominantMapKey(weekdayCounts);
  const dominantTimeRange = planningDominantMapKey(timeCounts) || null;
  const dominantWeekday = dominantWeekdayRaw == null ? null : Number(dominantWeekdayRaw);
  const hasVariableWeekdays = uniqueWeekdays.length > 1;
  const hasVariableTimes = uniqueTimeRanges.length > 1;

  const weekdayLabel = hasVariableWeekdays
    ? `ימים ${uniqueWeekdays.map((day) => PLANNING_WEEKDAY_SHORT_LABELS[day]).join(', ')}`
    : planningWeekdayDisplay(dominantWeekday);

  let timeRangeLabel = '';
  if (hasVariableTimes) timeRangeLabel = 'שעות משתנות';
  else if (!hasVariableWeekdays && dominantTimeRange) timeRangeLabel = dominantTimeRange;

  const [startTime = '', endTime = ''] = dominantTimeRange
    ? String(dominantTimeRange).split('–')
    : ['', ''];

  return {
    meetingCount,
    uniqueWeekdays,
    uniqueTimeRanges,
    dominantWeekday,
    dominantTimeRange,
    weekdayLabel,
    timeRangeLabel,
    hasVariableWeekdays,
    hasVariableTimes,
    startTime,
    endTime
  };
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
  const fullDayTour = isFullDaySchedulingActivity(activity);
  const oneDayActivity = activityCategory === 'workshop' || fullDayTour;
  const sessions = fullDayTour
    ? 1
    : (meetingCount(activity)
      || (Number(catalog?.meetings_count) > 0 ? Math.min(35, Math.floor(Number(catalog.meetings_count))) : 0)
      || (oneDayActivity ? 1 : 0));

  let durationMinutes = fullDayTour ? TOUR_OPERATIONAL_DURATION_MINUTES : null;
  if (!fullDayTour && validTimeRange(activity.start_time, activity.end_time)) {
    durationMinutes = timeMinutes(activity.end_time) - timeMinutes(activity.start_time);
  } else if (!fullDayTour && Number(catalog?.hours_count) > 0 && Number(catalog?.meetings_count) > 0) {
    durationMinutes = (Number(catalog.hours_count) * 60) / Number(catalog.meetings_count);
  } else if (!fullDayTour) {
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

function instructorAllowsPlanningWeekday(empId, targetWeekday, { profiles = {}, rules = {}, activity = {} } = {}) {
  const day = Number(targetWeekday);
  const available = (rules[empId] || []).some((rule) =>
    Number(rule.weekday) === day && rule.available === true
  );
  if (!available) return false;
  // Explicit weekly availability is the source of truth for Friday.
  if (day === 6 && !activityAllowsSaturday(activity)) return false;
  return day >= 0 && day <= 6;
}

function flexiblePlanningWeekdays({ activeIds = new Set(), profiles = {}, rules = {}, activity = {} } = {}) {
  const weekdays = [0, 1, 2, 3, 4];
  for (const day of [5, 6]) {
    if ([...activeIds].some((empId) => instructorAllowsPlanningWeekday(empId, day, { profiles, rules, activity }))) {
      weekdays.push(day);
    }
  }
  return weekdays;
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
  const requestedStartDate = text(startDate).slice(0, 10);
  const hasSchoolDateAnchor = officialPlanningDates(activity).includes(requestedStartDate);
  const period = hasSchoolDateAnchor
    ? resolveCourseSchedulingPeriod(activityPeriodKey)
    : planningEffectivePeriod(activityPeriodKey);
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
        school_address: activity.school_address,
        authority: activity.authority
      });
    }
  }
  return rows;
}

function roundUpToPlanningSlot(minute, step = 30) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return null;
  return Math.ceil(value / step) * step;
}

function roundDownToPlanningSlot(minute, step = 30) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return null;
  return Math.floor(value / step) * step;
}

function peekCachedTransition(routeClient, originAddress, destinationAddress) {
  if (!routeClient?.peek || !text(originAddress) || !text(destinationAddress)) return null;
  return routeClient.peek(originAddress, destinationAddress)
    || routeClient.peek(destinationAddress, originAddress)
    || null;
}

/** Travel-aware adjacent start minutes relative to an existing meeting. Same school may abut; different schools require travel+buffer. */
export function travelAwareAdjacentStartMinutes({
  meeting = {},
  activity = {},
  durationMinutes = 90,
  routeClient = null
} = {}) {
  const meetingEnd = timeMinutes(meeting.end_time);
  const meetingStart = timeMinutes(meeting.start_time);
  const duration = Number(durationMinutes) || 0;
  const sameSchool = !!text(meeting.school_id)
    && text(meeting.school_id) === text(activity.school_id);
  const route = sameSchool
    ? null
    : peekCachedTransition(routeClient, meeting.school_address, activity.school_address);
  const travelMinutes = Number(route?.duration_minutes);
  const distanceKm = Number(route?.distance_km);
  // Over-cap routes are not valid consecutive transitions; do not invent adjacency slots for them.
  const knownTravel = Number.isFinite(travelMinutes) && travelMinutes >= 0
    && Number.isFinite(distanceKm) && !exceedsTransitionDistanceLimit(distanceKm);
  const bufferMinutes = knownTravel
    ? transitionBufferMinutes(distanceKm)
    : NEARBY_TRANSITION_BUFFER_MINUTES;
  const gapMinutes = sameSchool
    ? 0
    : (knownTravel ? travelMinutes : 0) + bufferMinutes;

  return {
    sameSchool,
    knownTravel,
    travelMinutes: knownTravel ? travelMinutes : null,
    bufferMinutes: sameSchool ? 0 : bufferMinutes,
    gapMinutes,
    afterStartMinute: meetingEnd == null ? null : (sameSchool ? meetingEnd : roundUpToPlanningSlot(meetingEnd + gapMinutes)),
    beforeStartMinute: meetingStart == null || duration <= 0
      ? null
      : (sameSchool
        ? meetingStart - duration
        : roundDownToPlanningSlot(meetingStart - duration - gapMinutes)),
    exactAfterOk: sameSchool,
    exactBeforeOk: sameSchool
  };
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
  profiles = {},
  rules = {},
  activities = [],
  activeIds = null,
  blockingMeetingRows = null,
  routeClient = null
} = {}) {
  const counts = new Map(DEFAULT_TIME_SLOTS.map((slot) => [slot, 1]));
  const resolvedActiveIds = activeIds || activeInstructorIds(instructors);
  const requestedStart = validTimeRange(activity.start_time, activity.end_time) ? text(activity.start_time).slice(0, 5) : '';
  if (requestedStart) counts.set(requestedStart, (counts.get(requestedStart) || 0) + 50);

  for (const empId of resolvedActiveIds) {
    if ([5, 6].includes(Number(targetWeekday))
      && !instructorAllowsPlanningWeekday(empId, targetWeekday, { profiles, rules, activity })) continue;
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
    const adjacent = travelAwareAdjacentStartMinutes({
      meeting,
      activity,
      durationMinutes,
      routeClient
    });
    // Prefer travel-aware adjacency. Zero-minute abut is only kept for same-school.
    if (adjacent.afterStartMinute != null) {
      const after = formatMinutes(adjacent.afterStartMinute);
      if (after) counts.set(after, (counts.get(after) || 0) + 8);
    }
    if (adjacent.beforeStartMinute != null) {
      const before = formatMinutes(adjacent.beforeStartMinute);
      if (before) counts.set(before, (counts.get(before) || 0) + 8);
    }
    if (adjacent.exactAfterOk) {
      const exactAfter = text(meeting.end_time).slice(0, 5);
      if (exactAfter) counts.set(exactAfter, (counts.get(exactAfter) || 0) + 6);
    }
    if (adjacent.exactBeforeOk) {
      const exactBefore = formatMinutes(timeMinutes(meeting.start_time) - durationMinutes);
      if (exactBefore) counts.set(exactBefore, (counts.get(exactBefore) || 0) + 6);
    }
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
    const fixedPeriod = resolveCourseSchedulingPeriod(activityPeriodKey);
    if (fixedStart < fixedPeriod.start || fixedStart > fixedPeriod.end || weekday(fixedStart) !== Number(targetWeekday)) return [];
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

function* scenarioHeuristicSteps({ scenario, instructors = [], profiles = {}, rules = {}, activities = [], activeIds = null, blockingMeetingRows = null, routeClient = null } = {}) {
  const resolvedActiveIds = activeIds || activeInstructorIds(instructors);
  const day = weekday(scenario.startDate);
  let availabilityCoverage = 0;
  for (const empId of resolvedActiveIds) {
    yield;
    if (!instructorAllowsPlanningWeekday(empId, day, { profiles, rules, activity: scenario.__activity || {} })) continue;
    if ((rules[empId] || []).some((rule) => Number(rule.weekday) === day && ruleCovers(rule, scenario.startTime, scenario.endTime))) {
      availabilityCoverage += 1;
    }
  }

  let adjacency = 0;
  let existingWorkday = 0;
  const activity = scenario.__activity || {};
  const scenarioStart = timeMinutes(scenario.startTime);
  const scenarioEnd = timeMinutes(scenario.endTime);
  for (const meeting of blockingMeetingRows || blockingMeetings(activities)) {
    yield;
    if (weekday(meeting.date) !== day) continue;
    existingWorkday += 1;
    if (text(meeting.school_id) && text(meeting.school_id) === text(activity.school_id)) existingWorkday += 2;
    else if (norm(meeting.authority) && norm(meeting.authority) === norm(activity.authority)) existingWorkday += 1;

    const adjacent = travelAwareAdjacentStartMinutes({
      meeting,
      activity,
      durationMinutes: (scenarioEnd != null && scenarioStart != null) ? (scenarioEnd - scenarioStart) : 90,
      routeClient
    });
    const meetingEnd = timeMinutes(meeting.end_time);
    const meetingStart = timeMinutes(meeting.start_time);
    // Same school: exact abut is a real adjacency bonus.
    if (adjacent.sameSchool) {
      if (text(meeting.end_time).slice(0, 5) === scenario.startTime || text(meeting.start_time).slice(0, 5) === scenario.endTime) {
        adjacency += 1;
      }
      continue;
    }
    // Different school: never reward zero-minute abut. Reward travel+buffer candidates.
    if (scenarioStart != null && adjacent.afterStartMinute != null && scenarioStart === adjacent.afterStartMinute) {
      adjacency += 1;
    } else if (
      scenarioEnd != null
      && meetingStart != null
      && adjacent.beforeStartMinute != null
      && scenarioStart === adjacent.beforeStartMinute
    ) {
      adjacency += 1;
    } else if (
      scenarioStart != null
      && meetingEnd != null
      && scenarioStart === meetingEnd
    ) {
      // Explicitly ignore false abut across schools — no bonus.
    }
  }
  // Prefer packing onto an already-open instructor workday before inventing a new one.
  return availabilityCoverage * 10 + adjacency * 4 + existingWorkday * 3;
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
  maxScenarios = MAX_SCENARIOS_PER_COURSE,
  routeClient = null
} = {}) {
  const spec = inferPlanningCourseSpec(activity, catalog);
  if (!spec.complete) return { spec, scenarios: [], startRange: null };

  const raw = [];
  const scenarioActiveIds = activeInstructorIds(instructors);
  const scenarioBlockingActivities = blockingActivities(activities);
  const scenarioBlockingMeetings = blockingMeetings(scenarioBlockingActivities);
  // Heuristic uses weekday and times, never the absolute start date. Different
  // weekly start series with those same values reuse an identical score.
  const heuristicScores = new Map();
  function* heuristicFor(built) {
    const key = `${weekday(built.startDate)}|${built.startTime}|${built.endTime}`;
    if (!heuristicScores.has(key)) {
      heuristicScores.set(key, yield* scenarioHeuristicSteps({ scenario: { ...built, __activity: activity }, instructors, profiles, rules, activities, activeIds: scenarioActiveIds, blockingMeetingRows: scenarioBlockingMeetings, routeClient }));
    }
    return heuristicScores.get(key);
  }
  const fixedWeekdays = officialPlanningDates(activity)
    .map((date) => weekday(date))
    .filter((day) => Number.isInteger(day));
  const candidateWeekdays = [...new Set([
    ...flexiblePlanningWeekdays({ activeIds: scenarioActiveIds, profiles, rules, activity }),
    ...fixedWeekdays
  ])].sort((a, b) => a - b);
  const fullDayTour = isFullDaySchedulingActivity(activity);
  const fixedStartMinute = timeMinutes(activity.start_time);
  const fixedEndMinute = timeMinutes(activity.end_time);
  const fixedStartTime = fullDayTour
    ? TOUR_OPERATIONAL_START_TIME
    : (fixedStartMinute != null
      ? formatMinutes(fixedStartMinute)
      : (fixedEndMinute != null ? formatMinutes(fixedEndMinute - spec.durationMinutes) : ''));
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
          profiles,
          rules,
          activities,
          activeIds: scenarioActiveIds,
          blockingMeetingRows: scenarioBlockingMeetings,
          routeClient
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
        heuristic: yield* heuristicFor(built)
      });
      yield;
    }
  } else {
    // Prefer weekdays that already host work for this instructor/context before opening a fresh day.
    const openWeekdays = new Set(
      scenarioBlockingMeetings.map((meeting) => weekday(meeting.date)).filter((day) => Number.isInteger(day))
    );
    const orderedWeekdays = [...candidateWeekdays].sort((a, b) => {
      const aOpen = openWeekdays.has(a) ? 0 : 1;
      const bOpen = openWeekdays.has(b) ? 0 : 1;
      return aOpen - bOpen || a - b;
    });
    for (const day of orderedWeekdays) {
      const times = fixedStartTime
        ? [fixedStartTime]
        : dynamicTimesForWeekday({
            targetWeekday: day,
            durationMinutes: spec.durationMinutes,
            activity,
            instructors,
            profiles,
            rules,
            activities,
            activeIds: scenarioActiveIds,
            blockingMeetingRows: scenarioBlockingMeetings,
            routeClient
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
            heuristic: yield* heuristicFor(built)
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

  // Reserve the strongest operational scenario for every eligible weekday
  // BEFORE broad availability coverage consumes the fast-planning budget.
  // This is essential for packed sequences: an exact same-school adjacency
  // must survive even when many instructors share generic morning windows.
  for (const day of candidateWeekdays) {
    const option = sorted.find((scenario) => weekday(scenario.startDate) === day);
    if (option) addScenario(option);
  }

  // Same-school adjacency is the highest-value packing opportunity. Retain a
  // second strong option on weekdays where the school already has a blocking
  // meeting, so both "before" and "after" sequences can reach final scoring.
  const sameSchoolWeekdays = new Set(
    scenarioBlockingMeetings
      .filter((meeting) => text(meeting.school_id) && text(meeting.school_id) === text(activity.school_id))
      .map((meeting) => weekday(meeting.date))
      .filter((day) => Number.isInteger(day))
  );
  for (const day of sameSchoolWeekdays) {
    const options = sorted.filter((scenario) => weekday(scenario.startDate) === day).slice(0, 2);
    options.forEach(addScenario);
  }

  // Cover the real weekly availability grid with the remaining slots. A key is
  // one instructor + one available weekday; greedy coverage still protects
  // narrow windows, but can no longer evict the operational packing candidates.
  const activeIds = scenarioActiveIds;
  const uncoveredAvailability = new Set();
  for (const empId of activeIds) {
    for (const rule of rules[empId] || []) {
      const day = Number(rule.weekday);
      if (rule.available === true
        && day >= 0 && day <= 6
        && instructorAllowsPlanningWeekday(empId, day, { profiles, rules, activity })) {
        uncoveredAvailability.add(`${empId}|${day}`);
      }
    }
  }
  const coverageByScenario = new Map();
  const coverageByTimes = new Map();
  for (const scenario of sorted) {
    yield;
    const day = weekday(scenario.startDate);
    const timesKey = `${day}|${scenario.startTime}|${scenario.endTime}`;
    let covered = coverageByTimes.get(timesKey);
    if (!covered) {
      covered = [];
      for (const empId of activeIds) {
        yield;
        if (instructorAllowsPlanningWeekday(empId, day, { profiles, rules, activity })
          && (rules[empId] || []).some(rule => Number(rule.weekday) === day && ruleCovers(rule, scenario.startTime, scenario.endTime))) {
          covered.push(`${empId}|${day}`);
        }
      }
      coverageByTimes.set(timesKey, covered);
    }
    coverageByScenario.set(scenarioKey(scenario), covered);
  }

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
  if (Number(candidate.nonTravelWaitingMinutes) > 0) {
    parts.push(`${Math.round(Number(candidate.nonTravelWaitingMinutes))} דקות המתנה נטו`);
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

export function planningHomeDistanceKm(item = {}) {
  const candidate = item.candidate || item._candidate || item;
  const direct = Number(candidate?.travel?.home?.distance_km);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const cached = Number(candidate?._planningHomeDistanceKm);
  return Number.isFinite(cached) && cached >= 0 ? cached : null;
}

export function planningLocalityTier(item = {}) {
  const km = planningHomeDistanceKm(item);
  if (km == null) return 5;
  if (km <= 5) return 0;
  if (km <= 15) return 1;
  if (km <= 25) return 2;
  if (km <= 40) return 3;
  return 4;
}

function staticPlanningCandidateInstructors(activity = {}, instructors = [], profiles = {}, routeClient = null) {
  const activeIds = activeInstructorIds(instructors);
  const requiredLanguage = normalizedLanguageRequirement(activity?.instruction_language);
  const requiredGender = normalizedGenderRequirement(activity?.required_instructor_gender);
  const destination = text(activity?.school_address);
  const candidates = (instructors || []).filter((instructor) => {
    const empId = text(instructor?.emp_id);
    if (!empId || !activeIds.has(empId)) return false;
    const profile = planningProfileFor(profiles, empId);
    if (requiredGender !== 'any' && normalizedGenderRequirement(profile?.gender) !== requiredGender) return false;
    if (requiredLanguage) {
      const languages = (profile?.instruction_languages || [])
        .map((value) => normalizedLanguageRequirement(value))
        .filter(Boolean);
      if (!languages.includes(requiredLanguage)) return false;
    }
    if (destination && text(instructor?.address)) {
      const cachedHome = routeClient?.peek?.(instructor.address, destination);
      const km = Number(cachedHome?.distance_km);
      if (Number.isFinite(km) && km > MAX_HOME_DISTANCE_KM) return false;
    }
    return true;
  });
  planningPerfCount('staticCandidatePruned', Math.max(0, (instructors || []).length - candidates.length));
  return candidates;
}

export function planningPairCompare(first = {}, second = {}) {
  const firstWeek = planningStartWeekKey(first.course?.start_date || first.startDate);
  const secondWeek = planningStartWeekKey(second.course?.start_date || second.startDate);
  if (firstWeek !== secondWeek) return firstWeek.localeCompare(secondWeek);

  // Within the same start week, compare the complete operational result before
  // home-locality. This prevents a fresh workday from outranking a valid packed
  // sequence merely because the instructor lives closer to the school.
  const firstScore = Number(first.planningOptimization?.total);
  const secondScore = Number(second.planningOptimization?.total);
  if (Number.isFinite(firstScore) && Number.isFinite(secondScore) && firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  const firstCandidate = first.candidate || first._candidate || first;
  const secondCandidate = second.candidate || second._candidate || second;
  const firstNewDays = Math.max(0, Number(firstCandidate?.newWorkDayMeetingCount) || 0);
  const secondNewDays = Math.max(0, Number(secondCandidate?.newWorkDayMeetingCount) || 0);
  if (firstNewDays !== secondNewDays) return firstNewDays - secondNewDays;

  const firstIdle = Math.max(0, Number(firstCandidate?.nonTravelWaitingMinutes) || 0);
  const secondIdle = Math.max(0, Number(secondCandidate?.nonTravelWaitingMinutes) || 0);
  if (firstIdle !== secondIdle) return firstIdle - secondIdle;

  const firstLocality = planningLocalityTier(first);
  const secondLocality = planningLocalityTier(second);
  if (firstLocality !== secondLocality) return firstLocality - secondLocality;

  const candidateOrder = compareCandidatesStable(first.candidate || first._candidate || {}, second.candidate || second._candidate || {});
  if (candidateOrder) return candidateOrder;
  const firstDate = text(first.course?.start_date || first.startDate);
  const secondDate = text(second.course?.start_date || second.startDate);
  if (firstDate !== secondDate) return firstDate.localeCompare(secondDate);
  return text(first.course?.start_time || first.startTime).localeCompare(text(second.course?.start_time || second.startTime));
}


function optionFromCandidate(course, candidate, { routeVerified = true, startRange = null } = {}) {
  if (!candidate) return null;
  const adjustedMeetings = Array.isArray(candidate.proposedMeetings) && candidate.proposedMeetings.length
    ? candidate.proposedMeetings
    : (Array.isArray(candidate.dateAdjustment?.meetings) && candidate.dateAdjustment.meetings.length
      ? candidate.dateAdjustment.meetings
      : activityMeetings(course));
  const meetings = adjustedMeetings;
  const planningOptimization = planningOptimizationScore(candidate);
  const singleMeetingSubstitutions = Array.isArray(candidate.singleMeetingSubstitutions)
    ? candidate.singleMeetingSubstitutions
    : (candidate.dateAdjustment?.singleMeetingSubstitutions || []);
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
      end_time: text(meeting.end_time || course.end_time).slice(0, 5),
      original_date: text(meeting.original_date || meeting.date).slice(0, 10),
      moved: meeting.moved === true,
      substituteEmpId: text(meeting.substituteEmpId) || undefined,
      substituteName: text(meeting.substituteName) || undefined,
      constraintKind: text(meeting.constraintKind) || undefined
    })),
    singleMeetingSubstitutions,
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
      newWorkDayMeetingCount: Math.max(0, Number(candidate.newWorkDayMeetingCount) || 0),
      nonTravelWaitingMinutes: Math.max(0, Number(candidate.nonTravelWaitingMinutes) || 0)
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

export function optionCompare(first, second) {
  const firstWeek = planningStartWeekKey(first.startDate);
  const secondWeek = planningStartWeekKey(second.startDate);
  if (firstWeek !== secondWeek) return firstWeek.localeCompare(secondWeek);

  const firstScore = Number(first.planningOptimization?.total);
  const secondScore = Number(second.planningOptimization?.total);
  if (Number.isFinite(firstScore) && Number.isFinite(secondScore) && firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  const firstCandidate = first._candidate || first;
  const secondCandidate = second._candidate || second;
  const firstNewDays = Math.max(0, Number(firstCandidate?.newWorkDayMeetingCount) || 0);
  const secondNewDays = Math.max(0, Number(secondCandidate?.newWorkDayMeetingCount) || 0);
  if (firstNewDays !== secondNewDays) return firstNewDays - secondNewDays;

  const firstIdle = Math.max(0, Number(firstCandidate?.nonTravelWaitingMinutes) || 0);
  const secondIdle = Math.max(0, Number(secondCandidate?.nonTravelWaitingMinutes) || 0);
  if (firstIdle !== secondIdle) return firstIdle - secondIdle;

  const firstLocality = planningLocalityTier({ candidate: firstCandidate });
  const secondLocality = planningLocalityTier({ candidate: secondCandidate });
  if (firstLocality !== secondLocality) return firstLocality - secondLocality;

  const candidateOrder = compareCandidatesStable(firstCandidate, secondCandidate);
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
  periodKey = DEFAULT_PLANNING_PERIOD_KEY,
  preparedContext = null,
  travelContext = null,
  limits = DEEP_PLANNING_LIMITS,
  packingCoverage = false
} = {}) {
  planningPerfCount('scenarioCount', scenarios.length);
  planningPerfCount('scenarioEvaluations', scenarios.length);
  const stopTimer = planningPerfTimer('evaluateScenarioOptions');
  const preliminaries = [];
  for (let index = 0; index < scenarios.length; index += 1) {
    const course = scenarioCourse(activity, scenarios[index], index);
    const candidates = (await preliminaryCourseCandidatesCooperatively({
      activities: [course],
      targetCourse: course,
      targetCourseId: course.row_id,
      periodKey,
      instructors,
      profiles,
      rules,
      exceptions,
      schoolCalendar,
      referenceDate: today,
      preparedContext,
      candidateInstructorIds: (instructors || []).map((row) => text(row?.emp_id)).filter(Boolean)
    }, checkpoint)).map((item) => item.candidate).filter(Boolean)
      .map((candidate) => {
        const cachedHome = routeClient?.peek?.(candidate?.instructor?.address, course?.school_address);
        const km = Number(cachedHome?.distance_km);
        return Number.isFinite(km) && km >= 0 ? { ...candidate, _planningHomeDistanceKm: km } : candidate;
      })
      .sort((first, second) => {
        const firstLocality = planningLocalityTier({ candidate: first });
        const secondLocality = planningLocalityTier({ candidate: second });
        if (firstLocality !== secondLocality) return firstLocality - secondLocality;
        return compareCandidatesStable(first, second);
      })
      .slice(0, limits.maxCandidatesPerScenario);
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
    stopTimer();
    return {
      options: [],
      preliminaryCount: 0,
      routedAttemptCount: 0,
      routeVerified: true,
      recruitmentNeeded: true
    };
  }

  preliminaries.sort(planningPairCompare);
  const preliminaryCandidateIdsByScenario = new Map();
  const preliminaryCountByScenario = new Map();
  for (const item of preliminaries) {
    const scenarioId = text(item?.course?.row_id);
    if (!scenarioId) continue;
    const ids = preliminaryCandidateIdsByScenario.get(scenarioId) || new Set();
    const empId = empOf(item?.candidate);
    if (empId) ids.add(empId);
    preliminaryCandidateIdsByScenario.set(scenarioId, ids);
    preliminaryCountByScenario.set(scenarioId, (preliminaryCountByScenario.get(scenarioId) || 0) + 1);
  }
  const options = [];
  const optionKeys = new Set();
  const processedByScenario = new Map();
  const validByScenario = new Map();
  let routedAttemptCount = 0;
  let finalEvaluationCount = 0;
  let routeVerified = false;
  let routeServiceFailed = false;

  for (let offset = 0; offset < preliminaries.length; offset += limits.maxRoutedPlanningPairs) {
    const batch = preliminaries.slice(offset, offset + limits.maxRoutedPlanningPairs);
    let routed = null;
    try {
      routed = await calculateCandidateTravel(
        batch.map((item) => ({ course: item.course, candidate: item.candidate })),
        contextActivities,
        routeClient,
        { checkpoint, signal, travelContext }
      );
    } catch (error) {
      if (isPlanningCancellationError(error)) throw error;
      routeServiceFailed = true;
      break;
    }

    routedAttemptCount += batch.length;
    if (!routed) {
      routeServiceFailed = true;
      continue;
    }
    if (text(routed.unavailableReason)) routeServiceFailed = true;
    if (text(routeClient.unavailableReason) === 'google_key_not_configured') break;
    // The final engine validates each candidate's own home/transition legs.
    // One missing route must not discard healthy candidates in the same batch.
    routeVerified ||= !text(routed.unavailableReason);

    // Each result already checks every instructor. Reuse it for the same
    // scenario within this batch, whose route matrix and calendar are identical.
    const finalResultsByScenario = new Map();
    for (const finalist of batch) {
      await checkpoint();
      const scenarioId = finalist.course.row_id;
      processedByScenario.set(scenarioId, (processedByScenario.get(scenarioId) || 0) + 1);
      if (!finalResultsByScenario.has(scenarioId)) {
        finalEvaluationCount += 1;
        const candidateInstructorIds = [...(preliminaryCandidateIdsByScenario.get(scenarioId) || [])];
        finalResultsByScenario.set(scenarioId, (await calculateCourseScheduleCooperatively({
          activities: [finalist.course],
          targetCourse: finalist.course,
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
          travelUnavailableReason: routed.unavailableReason || '',
          preparedContext,
          candidateInstructorIds
        }, checkpoint))[0]);
      }
      const finalResult = finalResultsByScenario.get(scenarioId);
      const expectedEmpId = empOf(finalist.candidate);
      const finalCandidate = (finalResult?.checked || []).find((candidate) =>
        candidate?.eligible && empOf(candidate) === expectedEmpId
      ) || null;
      if (!finalCandidate) continue;
      const option = optionFromCandidate(finalist.course, finalCandidate, {
        routeVerified: true,
        startRange
      });
      if (!option) continue;
      planningPerfCount('finalValidations');
      const validation = planningOptionPassesFinalValidation(option, {
        activity: finalist.course,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar
      });
      if (!validation.valid) continue;
      const key = `${option.instructorEmpId}|${option.startDate}|${option.startTime}`;
      if (optionKeys.has(key)) continue;
      optionKeys.add(key);
      options.push({ ...option, _candidate: finalCandidate, _planningScenarioId: scenarioId });
      validByScenario.set(scenarioId, (validByScenario.get(scenarioId) || 0) + 1);
      if (!packingCoverage && options.length >= limits.maxFinalOptions) break;
      if (packingCoverage && options.length >= MAX_SCHOOL_PACKING_OPTIONS) break;
    }

    if (!packingCoverage && options.length >= limits.maxFinalOptions) break;
    if (packingCoverage) {
      const resolved = [...preliminaryCountByScenario.entries()].every(([scenarioId, count]) =>
        (validByScenario.get(scenarioId) || 0) >= SCHOOL_PACKING_OPTIONS_PER_SCENARIO
        || (processedByScenario.get(scenarioId) || 0) >= count
      );
      if (resolved || options.length >= MAX_SCHOOL_PACKING_OPTIONS) break;
    }
  }

  const allSortedOptions = options.sort(optionCompare);
  const sortedOptions = allSortedOptions.slice(0, limits.maxFinalOptions);
  const packingOptions = packingCoverage
    ? allSortedOptions.slice(0, MAX_SCHOOL_PACKING_OPTIONS)
    : sortedOptions;
  const exhaustive = routedAttemptCount >= preliminaries.length;
  stopTimer();
  return {
    options: sortedOptions,
    packingOptions,
    preliminaryCount: preliminaries.length,
    routedAttemptCount,
    finalEvaluationCount,
    routeVerified: sortedOptions.length > 0 || (routeVerified && !routeServiceFailed),
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
  periodKey = DEFAULT_PLANNING_PERIOD_KEY,
  preparedContext = null,
  travelContext = null,
  limits = DEEP_PLANNING_LIMITS
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

  const candidates = (await preliminaryCourseCandidatesCooperatively({
    activities: [activity],
    targetCourse: activity,
    targetCourseId: idOf(activity),
    periodKey,
    instructors,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    referenceDate: today,
    preparedContext,
    candidateInstructorIds: (instructors || []).map((row) => text(row?.emp_id)).filter(Boolean)
  }, checkpoint)).map((item) => item.candidate).filter(Boolean)
    .map((candidate) => {
      const cachedHome = routeClient?.peek?.(candidate?.instructor?.address, activity?.school_address);
      const km = Number(cachedHome?.distance_km);
      return Number.isFinite(km) && km >= 0 ? { ...candidate, _planningHomeDistanceKm: km } : candidate;
    })
    .sort((first, second) => {
      const firstLocality = planningLocalityTier({ candidate: first });
      const secondLocality = planningLocalityTier({ candidate: second });
      if (firstLocality !== secondLocality) return firstLocality - secondLocality;
      return compareCandidatesStable(first, second);
    });

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

  for (let offset = 0; offset < ranked.length && options.length < limits.maxFinalOptions; offset += limits.maxRoutedPlanningPairs) {
    const batch = ranked.slice(offset, offset + limits.maxRoutedPlanningPairs);
    let routed = null;
    try {
      routed = await calculateCandidateTravel(
        batch.map((item) => ({ course: activity, candidate: item.candidate })),
        contextActivities,
        routeClient,
        { checkpoint, signal, travelContext }
      );
    } catch (error) {
      if (isPlanningCancellationError(error)) throw error;
      routeServiceFailed = true;
      break;
    }
    routedAttemptCount += batch.length;
    if (!routed) {
      routeServiceFailed = true;
      continue;
    }
    if (text(routed.unavailableReason)) routeServiceFailed = true;
    if (text(routeClient.unavailableReason) === 'google_key_not_configured') break;
    // The final engine validates each candidate's own home/transition legs.
    // One missing route must not discard healthy candidates in the same batch.
    routeVerified ||= !text(routed.unavailableReason);

    const result = (await calculateCourseScheduleCooperatively({
      activities: [activity],
      targetCourse: activity,
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
      preparedContext,
      candidateInstructorIds: batch.map((item) => empOf(item.candidate)).filter(Boolean)
    }, checkpoint))[0];

    for (const finalist of batch) {
      await checkpoint();
      const expectedEmpId = empOf(finalist.candidate);
      const finalCandidate = (result?.checked || []).find((candidate) =>
        candidate?.eligible && empOf(candidate) === expectedEmpId
      ) || null;
      if (!finalCandidate) continue;
      const option = optionFromCandidate(activity, finalCandidate, { routeVerified: true });
      if (!option) continue;
      planningPerfCount('finalValidations');
      const validation = planningOptionPassesFinalValidation(option, {
        activity,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar
      });
      if (!validation.valid) continue;
      // School-first packing needs at least one legal schedule per instructor
      // and weekday; deduplicating by instructor alone discarded the bundle
      // alternatives before the school pass could compare weekday sets.
      const key = `${text(option.instructorEmpId)}|${weekday(option.startDate || option.meetings?.[0]?.date)}`;
      if (optionKeys.has(key)) continue;
      optionKeys.add(key);
      options.push({ ...option, _candidate: finalCandidate });
      if (options.length >= limits.maxFinalOptions) break;
    }
  }

  const sortedOptions = options.filter(Boolean).sort(optionCompare).slice(0, limits.maxFinalOptions);
  const exhaustive = routedAttemptCount >= ranked.length;
  return {
    options: sortedOptions,
    preliminaryCount: candidates.length,
    routedAttemptCount,
    routeVerified: sortedOptions.length > 0 || (routeVerified && !routeServiceFailed),
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
      end_time: meeting.end_time,
      substituteEmpId: text(meeting?.substituteEmpId) || undefined,
      substituteName: text(meeting?.substituteName) || undefined,
      constraintKind: text(meeting?.constraintKind) || undefined,
      moved: meeting?.moved === true || undefined,
      original_date: text(meeting?.original_date) || undefined
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

function liveRow(activity = {}, periodKey = DEFAULT_PLANNING_PERIOD_KEY, {
  rules = {},
  exceptions = {},
  schoolCalendar = []
} = {}) {
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
  const empId = text(activity.emp_id || activity.draft_emp_id);
  const conflicts = assigned && empId
    ? liveAvailabilityConflicts({
      meetings: calendarMeetings.map((meeting) => ({
        date: text(meeting?.date).slice(0, 10),
        start_time: text(meeting?.start_time || activity.start_time).slice(0, 5),
        end_time: text(meeting?.end_time || activity.end_time).slice(0, 5)
      })),
      rules: rules[empId] || [],
      exceptions: exceptions[empId] || [],
      schoolCalendar: filterSchoolCalendarRowsBySector(schoolCalendar, activity?.calendar_sector)
    })
    : { liveAvailabilityConflictCount: 0, liveAvailabilityConflictDates: [] };
  return {
    courseId: idOf(activity),
    schoolId: text(activity.school_id),
    authority: text(activity.authority),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    fullDayBlocking: isFullDaySchedulingActivity(activity),
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
    liveAvailabilityConflictCount: conflicts.liveAvailabilityConflictCount,
    liveAvailabilityConflictDates: conflicts.liveAvailabilityConflictDates,
    reason: assigned
      ? (conflicts.liveAvailabilityConflictCount
        ? `נלקח מהשיבוץ הפעיל · ${conflicts.liveAvailabilityConflictCount} מפגשים סותרים את זמינות המדריך`
        : 'נלקח מהשיבוץ הפעיל')
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
    schoolId: text(activity.school_id),
    authority: text(activity.authority),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    fullDayBlocking: isFullDaySchedulingActivity(activity),
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

function scheduleOnlyOptions(scenarios = [], limit = 12) {
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

function planningProfileFor(profiles = {}, empId = '') {
  return profiles?.[empId] || profiles?.[String(empId)] || {};
}

function planningRowsFor(map = {}, empId = '') {
  return map?.[empId] || map?.[String(empId)] || [];
}

function recruitmentRescueSchedules(row = {}) {
  const source = Array.isArray(row?.scheduleOptions) && row.scheduleOptions.length
    ? row.scheduleOptions
    : [{
        startDate: row?.startDate,
        endDate: row?.endDate,
        startTime: row?.startTime,
        endTime: row?.endTime,
        meetings: row?.meetings
      }];
  const seen = new Set();
  return source
    .map((option) => {
      const meetings = (option?.meetings || []).map((meeting) => ({
        date: text(meeting?.date).slice(0, 10),
        start_time: text(meeting?.start_time || option?.startTime).slice(0, 5),
        end_time: text(meeting?.end_time || option?.endTime).slice(0, 5)
      })).filter((meeting) =>
        /^\d{4}-\d{2}-\d{2}$/.test(meeting.date)
        && validTimeRange(meeting.start_time, meeting.end_time)
      );
      if (!meetings.length) return null;
      const startDate = text(option?.startDate || meetings[0].date).slice(0, 10);
      const endDate = text(option?.endDate || meetings.at(-1).date).slice(0, 10);
      const startTime = text(option?.startTime || meetings[0].start_time).slice(0, 5);
      const endTime = text(option?.endTime || meetings[0].end_time).slice(0, 5);
      const key = `${startDate}|${startTime}|${endTime}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return { startDate, endDate, startTime, endTime, meetings };
    })
    .filter(Boolean);
}

function instructorMeetingAvailable(empId, meeting, activity, { rules = {}, exceptions = {} } = {}) {
  const date = text(meeting?.date).slice(0, 10);
  const day = weekday(date);
  if (!date || !Number.isInteger(day)) return false;
  if (day === 6 && !activityAllowsSaturday(activity)) return false;

  const exception = planningRowsFor(exceptions, empId).find((row) =>
    text(row?.exception_date || row?.date).slice(0, 10) === date
  );
  if (exception) return ruleCovers(exception, meeting.start_time, meeting.end_time);

  return planningRowsFor(rules, empId).some((rule) =>
    Number(rule?.weekday) === day && ruleCovers(rule, meeting.start_time, meeting.end_time)
  );
}

function* rescueScheduleConflictSteps(empId, schedule, row, existingRows = []) {
  const incoming = schedule?.meetings || [];
  for (const existing of existingRows || []) {
    yield;
    if (text(existing?.courseId) === text(row?.courseId)) continue;
    if (text(existing?.instructorEmpId) !== text(empId)) continue;
    for (const current of existing?.meetings || []) {
      for (const meeting of incoming) {
        yield;
        if (timeRangesOverlap(current, meeting)) return true;
      }
    }
  }
  return false;
}

function* recruitmentRescueProbeSteps({
  row = {},
  activity = {},
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  routeClient = null,
  existingRows = []
} = {}) {
  const schedules = recruitmentRescueSchedules(row);
  if (!schedules.length) {
    return { possible: false, schedules: [], candidateEmpIds: [], knownMatches: 0, unknownRouteMatches: 0 };
  }

  const activeIds = activeInstructorIds(instructors);
  const requiredLanguage = normalizedLanguageRequirement(row.requiredLanguage || activity.instruction_language);
  const requiredGender = normalizedGenderRequirement(row.requiredGender || activity.required_instructor_gender);
  const destination = text(activity.school_address);
  const matches = [];

  for (const instructor of instructors || []) {
    yield;
    const empId = text(instructor?.emp_id);
    if (!empId || !activeIds.has(empId)) continue;
    const profile = planningProfileFor(profiles, empId);
    const languages = (profile?.instruction_languages || []).map((value) => normalizedLanguageRequirement(value)).filter(Boolean);
    if (requiredLanguage && !languages.includes(requiredLanguage)) continue;
    if (requiredGender !== 'any' && text(profile?.gender) !== requiredGender) continue;

    const cachedHome = destination ? routeClient?.peek?.(instructor?.address, destination) : null;
    const homeKm = Number(cachedHome?.distance_km);
    const homeKnown = Number.isFinite(homeKm) && homeKm >= 0;
    if (homeKnown && homeKm > 40) continue;

    for (const schedule of schedules) {
      yield;
      const available = schedule.meetings.every((meeting) =>
        instructorMeetingAvailable(empId, meeting, activity, { rules, exceptions })
      );
      if (!available) continue;
      if (yield* rescueScheduleConflictSteps(empId, schedule, row, existingRows)) continue;
      matches.push({
        empId,
        homeKm: homeKnown ? homeKm : null,
        routeKnown: homeKnown,
        schedule
      });
    }
  }

  matches.sort((first, second) => {
    if (first.routeKnown !== second.routeKnown) return first.routeKnown ? -1 : 1;
    const firstKm = first.homeKm == null ? Number.POSITIVE_INFINITY : first.homeKm;
    const secondKm = second.homeKm == null ? Number.POSITIVE_INFINITY : second.homeKm;
    return firstKm - secondKm || first.empId.localeCompare(second.empId, 'en');
  });

  const candidateEmpIds = [...new Set(matches.map((match) => match.empId))];
  const scenarioKeys = new Set();
  const rescueScenarios = [];
  for (const match of matches) {
    const schedule = match.schedule;
    const key = `${schedule.startDate}|${schedule.startTime}|${schedule.endTime}`;
    if (scenarioKeys.has(key)) continue;
    scenarioKeys.add(key);
    rescueScenarios.push({
      ...schedule,
      heuristic: 0
    });
  }

  return {
    possible: matches.length > 0,
    schedules: rescueScenarios,
    candidateEmpIds,
    knownMatches: matches.filter((match) => match.routeKnown).length,
    unknownRouteMatches: matches.filter((match) => !match.routeKnown).length
  };
}

function drainPlanningSteps(steps) {
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
async function drainPlanningStepsCooperatively(steps, checkpoint) {
  let next = steps.next();
  while (!next.done) { await checkpoint(); next = steps.next(); }
  return next.value;
}
export function recruitmentRescueProbe(input = {}) { return drainPlanningSteps(recruitmentRescueProbeSteps(input)); }
export function recruitmentRescueProbeCooperatively(input = {}, checkpoint = async () => {}) {
  return drainPlanningStepsCooperatively(recruitmentRescueProbeSteps(input), checkpoint);
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

function* recruitmentProfileCanTakeSteps(profile, row, schedule) {
  const district = normalizeOperationalDistrict(row.district) || text(row.district);
  if (profile.district && district && profile.district !== district) return false;
  const gender = normalizedGenderRequirement(row.requiredGender);
  if (profile.gender !== 'any' && gender !== 'any' && profile.gender !== gender) return false;

  for (const existing of profile.meetings) {
    for (const incoming of schedule.meetings || []) {
      yield;
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
  const sameAuthority = profile.authorities.has(norm(row.authority)) ? 40 : 0;
  const sameProgram = profile.programs.has(norm(row.courseName)) ? 8 : 0;
  const weekdays = new Set((schedule.meetings || []).map((meeting) => weekday(meeting.date)));
  const reusedDay = [...weekdays].some((day) => profile.weekdays.has(day)) ? 10 : 0;
  const laterStart = text(schedule.startDate) >= '2027-01-01' ? 2 : 0;
  // Reusing an existing feasible profile is always preferable to opening a new hire.
  return 100 + sameAuthority + sameProgram + reusedDay + laterStart + Math.min(20, profile.activities.length);
}

function* assignRecruitmentProfileSteps(rows = []) {
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
    yield;
    const selectedSchoolSchedule = row?.diagnostics?.schoolFirstOptimized === true && row.meetings?.length
      ? [{
          startDate: row.startDate,
          endDate: row.endDate,
          startTime: row.startTime,
          endTime: row.endTime,
          meetings: row.meetings
        }]
      : null;
    const sourceChoices = selectedSchoolSchedule
      || (row.scheduleOptions?.length
        ? row.scheduleOptions
        : (row.meetings?.length ? [{
            startDate: row.startDate,
            endDate: row.endDate,
            startTime: row.startTime,
            endTime: row.endTime,
            meetings: row.meetings
          }] : []));
    const choices = row.schoolDateAnchored
      ? sourceChoices
      : sourceChoices.filter((schedule) =>
          (schedule.meetings || []).every((meeting) => {
            const day = weekday(meeting.date);
            return day >= 0 && day <= 4;
          })
        );
    if (!choices.length) continue;

    let best = null;
    for (const profile of profiles) {
      for (const schedule of choices) {
        yield;
        if (!(yield* recruitmentProfileCanTakeSteps(profile, row, schedule))) continue;
        const score = recruitmentPlacementScore(profile, row, schedule);
        if (!best || score > best.score) best = { profile, schedule, score };
      }
    }

    if (!best) {
      const district = normalizeOperationalDistrict(row.district) || text(row.district);
      const districtIndex = profiles.filter((item) => item.district === district).length + 1;
      const profile = {
        id: `recruitment-${district || 'general'}-${districtIndex}`,
        label: district ? `תקן גיוס ${district} ${districtIndex}` : `תקן גיוס ${profiles.length + 1}`,
        district,
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
    row.reason = `לאחר מיצוי אפשרויות הצוות הקיים: נדרש גיוס. הפעילות משויכת ל${row.recruitmentProfileLabel}, שמרכז ${row.recruitmentProfileSize} פעילויות לאורך התקופה ללא חפיפה.`;
  }
  return result;
}

export function assignRecruitmentProfiles(rows = []) { return drainPlanningSteps(assignRecruitmentProfileSteps(rows)); }
export function assignRecruitmentProfilesCooperatively(rows = [], checkpoint = async () => {}) {
  return drainPlanningStepsCooperatively(assignRecruitmentProfileSteps(rows), checkpoint);
}

export function planningOutcomeClassification(option = null, diagnostics = {}) {
  if (option) {
    return {
      kind: 'proposal',
      status: 'מועד מומלץ לבית הספר',
      searchIncomplete: false,
      recruitmentCertified: false
    };
  }
  const searchIncomplete = diagnostics.searchIncomplete === true || diagnostics.rescueBudgetExceeded === true;
  const recruitmentCertified = diagnostics.recruitmentNeeded === true && !searchIncomplete;
  return {
    kind: recruitmentCertified ? 'recruitment' : 'missing',
    status: recruitmentCertified ? 'נדרש גיוס' : (searchIncomplete ? 'בדיקת התאמה נמשכת' : 'נדרש טיפול'),
    searchIncomplete,
    recruitmentCertified
  };
}

function planRowFromOption(activity, option, options, startRange, spec, diagnostics = {}) {
  const outcome = planningOutcomeClassification(option, diagnostics);
  const searchIncomplete = outcome.searchIncomplete;
  const recruitmentNeeded = outcome.recruitmentCertified;
  const scheduleOptions = diagnostics.scheduleOptions || [];
  const scheduleOnly = scheduleOptions[0] || null;
  return {
    courseId: idOf(activity),
    schoolId: text(activity.school_id),
    authority: text(activity.authority),
    district: text(activity.district || activity.school_district || activity.authority_district),
    school: text(activity.school),
    courseName: text(activity.activity_name),
    activityType: activityTypeLabel(activity),
    fullDayBlocking: isFullDaySchedulingActivity(activity),
    requiredLanguage: text(activity.instruction_language),
    requiredGender: text(activity.required_instructor_gender),
    sourceHadDraft: !!text(activity.draft_emp_id),
    schoolDateAnchored: officialPlanningDates(activity).length > 0,
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
    kind: outcome.kind,
    status: outcome.status,
    startDate: option?.startDate || scheduleOnly?.startDate || '',
    endDate: option?.endDate || scheduleOnly?.endDate || '',
    startTime: option?.startTime || scheduleOnly?.startTime || '',
    endTime: option?.endTime || scheduleOnly?.endTime || '',
    instructorName: option?.instructorName || '',
    instructorEmpId: option?.instructorEmpId || '',
    meetings: option?.meetings || scheduleOnly?.meetings || [],
    scheduleOptions,
    options: (options || []).map(({ _candidate, _planningScenarioId, ...item }) => item),
    packingOptions: (diagnostics.packingOptions || options || [])
      .map(({ _candidate, _planningScenarioId, ...item }) => item),
    startRange,
    diagnostics: {
      preliminaryCount: Number(diagnostics.preliminaryCount) || 0,
      routedAttemptCount: Number(diagnostics.routedAttemptCount) || 0,
      finalEvaluationCount: Number(diagnostics.finalEvaluationCount) || 0,
      routeVerified: diagnostics.routeVerified === true,
      routeEvaluationVersion: 2,
      searchIncomplete,
      recruitmentCertified: recruitmentNeeded,
      rescueDeferred: diagnostics.rescueDeferred === true,
      rescuePass: diagnostics.rescuePass === true,
      rescueBudgetExceeded: diagnostics.rescueBudgetExceeded === true
    },
    reason: option?.reason
      || (recruitmentNeeded
        ? 'לא נמצא אף מדריך פעיל שעומד בתנאי הסף בכל חלונות התכנון שנבדקו — רק בשלב זה נדרש גיוס'
        : searchIncomplete
          ? 'קיימים מועמדים בצוות, אך בדיקת ההתאמה המלאה טרם הסתיימה — הפעילות אינה מסומנת לגיוס'
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
      end_time: text(meeting?.end_time).slice(0, 5),
      original_date: text(meeting?.original_date || meeting?.date).slice(0, 10) || undefined,
      moved: meeting?.moved === true,
      substituteEmpId: text(meeting?.substituteEmpId) || undefined,
      substituteName: text(meeting?.substituteName) || undefined,
      constraintKind: text(meeting?.constraintKind) || undefined
    }))
    .filter((meeting) =>
      /^\d{4}-\d{2}-\d{2}$/.test(meeting.date)
      && meeting.date >= period.start
      && meeting.date <= scheduleEnd
      && validTimeRange(meeting.start_time, meeting.end_time)
    );
  if (!instructorEmpId || !meetings.length) return null;
  const singleMeetingSubstitutions = Array.isArray(option.singleMeetingSubstitutions)
    ? option.singleMeetingSubstitutions
    : meetings
      .filter((meeting) => text(meeting.substituteEmpId))
      .map((meeting) => ({
        meetingDate: meeting.date,
        substituteEmpId: meeting.substituteEmpId,
        substituteName: meeting.substituteName || '',
        constraintKind: meeting.constraintKind || 'instructor_exception'
      }));
  return {
    ...option,
    instructorEmpId,
    instructorName: instructorName || instructorEmpId,
    startDate: meetings[0].date,
    endDate: meetings.at(-1).date,
    startTime: meetings[0].start_time,
    endTime: meetings[0].end_time,
    meetings,
    singleMeetingSubstitutions
  };
}

export function planningOptionPassesFinalValidation(option = {}, {
  activity = {},
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  assignments = {},
  schoolCalendar = []
} = {}) {
  const mainEmpId = text(option?.instructorEmpId);
  const meetings = Array.isArray(option?.meetings) ? option.meetings : [];
  if (!mainEmpId || !meetings.length) return { valid: false, failures: [{ reason: 'missing_option' }] };
  const instructorById = new Map((instructors || []).map((row) => [text(row.emp_id), row]));
  const profileMap = profiles && typeof profiles === 'object' && !Array.isArray(profiles)
    ? profiles
    : Object.fromEntries((profiles || []).map((row) => [text(row?.emp_id), row]).filter(([id]) => id));
  const failures = [];
  const requiredGender = normalizedGenderRequirement(activity?.required_instructor_gender);
  const requiredLanguage = normalizedLanguageRequirement(activity?.instruction_language);
  const mainProfile = planningProfileFor(profileMap, mainEmpId);
  const mainInstructor = instructorById.get(mainEmpId);
  if (mainInstructor && (String(mainInstructor.active ?? 'yes').toLowerCase() === 'no' || mainInstructor.active === false)) {
    failures.push({ reason: 'inactive', empId: mainEmpId });
  }
  if (requiredGender !== 'any' && text(mainProfile?.gender) !== requiredGender) {
    failures.push({ reason: 'gender_mismatch', empId: mainEmpId });
  }
  if (requiredLanguage) {
    const languages = (mainProfile?.instruction_languages || [])
      .map((value) => normalizedLanguageRequirement(value))
      .filter(Boolean);
    if (!languages.includes(requiredLanguage)) {
      failures.push({ reason: 'language_mismatch', empId: mainEmpId });
    }
  }
  const instructorContexts = {};
  for (const meeting of meetings) {
    const empId = meetingInstructorEmpId(meeting, mainEmpId);
    if (!empId || instructorContexts[empId]) continue;
    instructorContexts[empId] = {
      instructor: instructorById.get(empId) || { emp_id: empId, active: 'yes' },
      rules: rules[empId] || [],
      exceptions: exceptions[empId] || [],
      existingActivities: (assignments[empId] || []).flatMap((row) =>
        activityMeetings(row).map((meeting) => ({
          ...meeting,
          activity_id: idOf(row),
          activity_name: text(row?.activity_name || row?.program_name),
          activity_type: row?.activity_type || row?.type,
          activity_no: row?.activity_no,
          full_day_blocking: isFullDaySchedulingActivity(row)
        }))
      ),
      profile: profileMap[empId] || null
    };
  }
  const meetingValidation = validatePlanningMeetingsForInstructors({
    meetings,
    mainInstructorEmpId: mainEmpId,
    instructorContexts,
    activity,
    schoolCalendar: filterSchoolCalendarRowsBySector(schoolCalendar, activity?.calendar_sector),
    allowSaturday: normalizeCalendarSector(activity?.calendar_sector) === 'arab'
  });
  failures.push(...(meetingValidation.failures || []));
  return { valid: failures.length === 0, failures };
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
  const a = context.difficultyById?.get(idOf(first)) || planningActivityDifficulty({ activity: first, ...context });
  const b = context.difficultyById?.get(idOf(second)) || planningActivityDifficulty({ activity: second, ...context });
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
    .filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))
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
  const schoolDayMetrics = planningSchoolDayMetrics(source);
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
    averageOperationalScore: scoreCount ? Math.round((score / scoreCount) * 10) / 10 : 0,
    ...schoolDayMetrics
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
    avoidableSchoolDaySplits: quality.avoidableSchoolDaySplits,
    totalSchoolWeekdays: quality.totalSchoolWeekdays,
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
  // Coverage repair is different from pure quality tuning: every uncovered row
  // must get the first-choice opportunity in the repair ordering. Capping this
  // list meant large plans could leave later recruitment rows behind resources
  // already consumed by the first N rows, without ever testing the inverse
  // ordering. The cap remains useful only for non-critical efficiency tuning.
  if (critical.length) return critical.map((item) => item.id);

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
  if (after.avoidableSchoolDaySplits < before.avoidableSchoolDaySplits) return true;
  if (after.avoidableSchoolDaySplits > before.avoidableSchoolDaySplits) return false;
  const gain = Math.round((after.total - before.total) * 10) / 10;
  return gain >= Math.max(0, Number(minGain) || 0);
}

export function comparePlanningPlanQuality(firstRows = [], secondRows = []) {
  const first = planningPlanQuality(firstRows);
  const second = planningPlanQuality(secondRows);
  if (first.uncovered !== second.uncovered) return first.uncovered - second.uncovered;
  if (first.recruitmentProfiles !== second.recruitmentProfiles) return first.recruitmentProfiles - second.recruitmentProfiles;
  if (first.avoidableSchoolDaySplits !== second.avoidableSchoolDaySplits) {
    return first.avoidableSchoolDaySplits - second.avoidableSchoolDaySplits;
  }

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

export const PLANNING_CONTEXT_SCHEMA_VERSION = 'planning-context-v1';
export const PLANNING_CONTEXT_PARTS_VERSION = 1;

function fnv1aHash(value = '') {
  let hash = 2166136261;
  const raw = String(value ?? '');
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function stableEntityHash(value) {
  return fnv1aHash(JSON.stringify(value ?? null));
}

function flattenSchedulingRows(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value).flat();
  return [];
}

function instructorContextPayload(row = {}) {
  return {
    emp_id: text(row.emp_id),
    active: row.active,
    address: row.address,
    gender: row.gender,
    languages: row.languages
  };
}

function catalogContextPayload(row = {}) {
  return {
    activity_no: row.activity_no,
    gefen_number: row.gefen_number,
    pricing_key: row.pricing_key,
    activity_name: row.activity_name,
    meetings_count: row.meetings_count,
    hours_count: row.hours_count,
    unit_duration: row.unit_duration
  };
}

function catalogProgramKey(row = {}) {
  return canonicalPlanningActivityNo(row.activity_no)
    || text(row.pricing_key)
    || canonicalPlanningActivityNo(row.gefen_number)
    || text(row.activity_name);
}

function schoolCalendarEventKey(row = {}) {
  const sector = normalizeCalendarSector(row.calendar_sector || row.sector) || 'general';
  const start = text(row.start_date || row.iso).slice(0, 10);
  // Keep end out of the identity key so range edits stay on one window and only
  // change the stored hash/bounds (used for affected-date overlap).
  const title = calendarPresentationTitle(row.title || row.name || row.event_name);
  return [sector, start, title].join('|');
}

export function buildPlanningContextParts(input = {}) {
  const snapshot = input || {};
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const instructors = {};
  const availability = {};
  const exceptions = {};
  const profiles = {};
  const schoolCalendar = {};
  const catalog = {};

  for (const row of snapshot.instructors || []) {
    const empId = text(row?.emp_id);
    if (!empId) continue;
    instructors[empId] = stableEntityHash(instructorContextPayload(row));
  }

  for (const row of flattenSchedulingRows(snapshot.rules)) {
    const empId = text(row?.emp_id);
    if (!empId) continue;
    const bucket = availability[empId] || [];
    bucket.push({
      weekday: row.weekday,
      available: row.available,
      start_time: row.start_time,
      end_time: row.end_time
    });
    availability[empId] = bucket;
  }
  for (const empId of Object.keys(availability)) {
    availability[empId] = stableEntityHash(stableRows(availability[empId]));
  }

  for (const row of flattenSchedulingRows(snapshot.exceptions)) {
    const empId = text(row?.emp_id);
    if (!empId) continue;
    const bucket = exceptions[empId] || [];
    bucket.push({
      exception_date: text(row.exception_date || row.date).slice(0, 10),
      available: row.available,
      start_time: row.start_time,
      end_time: row.end_time,
      note: row.note
    });
    exceptions[empId] = bucket;
  }
  for (const empId of Object.keys(exceptions)) {
    exceptions[empId] = stableEntityHash(stableRows(exceptions[empId]));
  }

  for (const row of flattenSchedulingRows(snapshot.profiles)) {
    const empId = text(row?.emp_id);
    if (!empId) continue;
    profiles[empId] = stableEntityHash(row);
  }

  for (const row of snapshot.schoolCalendar || []) {
    const key = schoolCalendarEventKey(row);
    if (!key || key === 'general|||') continue;
    schoolCalendar[key] = {
      hash: stableEntityHash(row),
      sector: normalizeCalendarSector(row.calendar_sector || row.sector) || 'general',
      start: text(row.start_date || row.iso).slice(0, 10),
      end: text(row.end_date || row.start_date || row.iso).slice(0, 10)
    };
  }

  for (const row of snapshot.catalog || []) {
    const key = catalogProgramKey(row);
    if (!key) continue;
    catalog[key] = stableEntityHash(catalogContextPayload(row));
  }

  return {
    contextVersion: PLANNING_CONTEXT_SCHEMA_VERSION,
    period: planningEffectivePeriod(periodKey),
    instructors,
    availability,
    exceptions,
    profiles,
    schoolCalendar,
    catalog
  };
}

export function emptyPlanningContextDiff() {
  return {
    changedInstructorProfileIds: [],
    changedAvailabilityInstructorIds: [],
    changedExceptionInstructorIds: [],
    changedCalendarWindows: [],
    changedCatalogKeys: [],
    unrecoverableGlobal: false
  };
}

function mapKeyDiff(previous = {}, current = {}) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
  const changed = [];
  for (const key of keys) {
    const prev = previous?.[key];
    const next = current?.[key];
    const prevHash = prev && typeof prev === 'object' && prev.hash != null ? prev.hash : prev;
    const nextHash = next && typeof next === 'object' && next.hash != null ? next.hash : next;
    if (prevHash !== nextHash) changed.push(key);
  }
  return changed;
}

export function diffPlanningContextParts(previousParts = null, currentParts = null) {
  const diff = emptyPlanningContextDiff();
  if (!previousParts || !currentParts || typeof previousParts !== 'object' || typeof currentParts !== 'object') {
    diff.unrecoverableGlobal = true;
    return diff;
  }
  const previousPeriod = previousParts.period && typeof previousParts.period === 'object'
    ? previousParts.period
    : { key: text(previousParts.period) };
  const currentPeriod = currentParts.period && typeof currentParts.period === 'object'
    ? currentParts.period
    : { key: text(currentParts.period) };
  const periodChanged = text(previousPeriod.key) !== text(currentPeriod.key)
    || text(previousPeriod.start) !== text(currentPeriod.start)
    || text(previousPeriod.end) !== text(currentPeriod.end);
  if (
    text(previousParts.contextVersion) !== text(currentParts.contextVersion)
    || periodChanged
  ) {
    diff.unrecoverableGlobal = true;
    return diff;
  }

  diff.changedInstructorProfileIds = mapKeyDiff(previousParts.instructors, currentParts.instructors);
  const profileOnly = new Set(diff.changedInstructorProfileIds);
  for (const empId of mapKeyDiff(previousParts.profiles, currentParts.profiles)) {
    if (!profileOnly.has(empId)) {
      diff.changedInstructorProfileIds.push(empId);
      profileOnly.add(empId);
    }
  }
  diff.changedAvailabilityInstructorIds = mapKeyDiff(previousParts.availability, currentParts.availability);
  diff.changedExceptionInstructorIds = mapKeyDiff(previousParts.exceptions, currentParts.exceptions);

  const calendarKeys = mapKeyDiff(previousParts.schoolCalendar, currentParts.schoolCalendar);
  const windows = [];
  for (const key of calendarKeys) {
    const prev = previousParts.schoolCalendar?.[key];
    const next = currentParts.schoolCalendar?.[key];
    const source = next || prev || {};
    windows.push({
      key,
      sector: text(source.sector) || 'general',
      start: text(source.start).slice(0, 10),
      end: text(source.end).slice(0, 10)
    });
  }
  diff.changedCalendarWindows = windows;
  diff.changedCatalogKeys = mapKeyDiff(previousParts.catalog, currentParts.catalog);
  return diff;
}

export function parsePlanningContextFingerprint(stored = '') {
  const raw = text(stored);
  if (!raw) return { hash: '', parts: null, storage: '' };
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && Number(parsed.v) === PLANNING_CONTEXT_PARTS_VERSION && text(parsed.hash)) {
        return {
          hash: text(parsed.hash),
          parts: parsed.parts && typeof parsed.parts === 'object' ? parsed.parts : null,
          storage: raw
        };
      }
    } catch {
      // Legacy plain-hash fingerprints remain supported.
    }
  }
  return { hash: raw, parts: null, storage: raw };
}

export function serializePlanningContextFingerprint(input = {}) {
  const hash = planningContextFingerprint(input);
  return JSON.stringify({
    v: PLANNING_CONTEXT_PARTS_VERSION,
    hash,
    parts: buildPlanningContextParts(input)
  });
}

/**
 * Exact pre-granular (pre-PR #2010) context fingerprint.
 * Uses raw emp_id values and the old profiles/rules/exceptions flattening so
 * production plain hashes such as "1gl1u9a" still compare correctly.
 */
export function planningLegacyPlainContextFingerprint(input = {}, marker = PLANNING_CONTEXT_SCHEMA_VERSION) {
  const snapshot = input || {};
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const value = JSON.stringify({
    contextVersion: text(marker) || PLANNING_CONTEXT_SCHEMA_VERSION,
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
  return fnv1aHash(value);
}

export function resolvePlanningContextChange({
  storedFingerprint = '',
  currentInput = {},
  engineChanged = false,
  legacyFingerprint = ''
} = {}) {
  const stored = parsePlanningContextFingerprint(storedFingerprint);
  const currentStorage = serializePlanningContextFingerprint(currentInput);
  const current = parsePlanningContextFingerprint(currentStorage);
  const legacyPlainHash = planningLegacyPlainContextFingerprint(currentInput);
  const hashMatches = !!stored.hash && stored.hash === current.hash;
  const legacyPlainMatches = !!stored.hash && !stored.parts && stored.hash === legacyPlainHash;
  const legacyEngineMatches = engineChanged && !!stored.hash && stored.hash === text(legacyFingerprint);
  const fingerprintUpgraded = legacyPlainMatches || (
    !!stored.hash && !stored.parts && (hashMatches || legacyEngineMatches)
  );

  if (!stored.hash || hashMatches || legacyPlainMatches || legacyEngineMatches) {
    return {
      contextChanged: false,
      unrecoverableGlobalContextChange: false,
      contextDiff: emptyPlanningContextDiff(),
      currentHash: current.hash,
      storageValue: currentStorage,
      storedParts: stored.parts,
      currentParts: current.parts,
      fingerprintUpgraded,
      legacyPlainHash
    };
  }

  if (stored.parts && current.parts) {
    const contextDiff = diffPlanningContextParts(stored.parts, current.parts);
    return {
      contextChanged: true,
      unrecoverableGlobalContextChange: contextDiff.unrecoverableGlobal === true,
      contextDiff,
      currentHash: current.hash,
      storageValue: currentStorage,
      storedParts: stored.parts,
      currentParts: current.parts,
      fingerprintUpgraded: false,
      legacyPlainHash
    };
  }

  // Legacy plain hash that no longer matches: context changed, but without parts we
  // must not force a full run — only activity/dirty-row mapping remains available.
  return {
    contextChanged: true,
    unrecoverableGlobalContextChange: false,
    contextDiff: emptyPlanningContextDiff(),
    currentHash: current.hash,
    storageValue: currentStorage,
    storedParts: stored.parts,
    currentParts: current.parts,
    fingerprintUpgraded: false,
    legacyPlainHash
  };
}

function planningContextFingerprintWithMarker(input = {}, marker = PLANNING_CONTEXT_SCHEMA_VERSION) {
  const snapshot = input || {};
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const value = JSON.stringify({
    contextVersion: text(marker) || PLANNING_CONTEXT_SCHEMA_VERSION,
    period: planningEffectivePeriod(periodKey),
    instructors: stableRows((snapshot.instructors || []).map((row) => instructorContextPayload(row))),
    profiles: stableRows(flattenSchedulingRows(snapshot.profiles)),
    rules: stableRows(flattenSchedulingRows(snapshot.rules)),
    exceptions: stableRows(flattenSchedulingRows(snapshot.exceptions)),
    schoolCalendar: stableRows(snapshot.schoolCalendar || []),
    catalog: stableRows((snapshot.catalog || []).map((row) => catalogContextPayload(row)))
  });
  return fnv1aHash(value);
}

export function planningContextFingerprint(input = {}) {
  return planningContextFingerprintWithMarker(input, PLANNING_CONTEXT_SCHEMA_VERSION);
}

export function planningLegacyEngineContextFingerprint(input = {}, engineVersion = '') {
  const snapshot = input || {};
  const periodKey = text(snapshot.periodKey) || DEFAULT_PLANNING_PERIOD_KEY;
  const value = JSON.stringify({
    engineVersion: text(engineVersion) || PLANNING_ENGINE_VERSION,
    period: planningEffectivePeriod(periodKey),
    instructors: stableRows((snapshot.instructors || []).map((row) => instructorContextPayload(row))),
    profiles: stableRows(flattenSchedulingRows(snapshot.profiles)),
    rules: stableRows(flattenSchedulingRows(snapshot.rules)),
    exceptions: stableRows(flattenSchedulingRows(snapshot.exceptions)),
    schoolCalendar: stableRows(snapshot.schoolCalendar || []),
    catalog: stableRows((snapshot.catalog || []).map((row) => catalogContextPayload(row)))
  });
  return fnv1aHash(value);
}

export function mergePlanningResumeRows(existingRows = [], completedRows = []) {
  const byId = new Map();
  for (const row of existingRows || []) {
    const id = text(row?.courseId);
    if (id) byId.set(id, row);
  }
  for (const row of completedRows || []) {
    const id = text(row?.courseId);
    if (id) byId.set(id, row);
  }
  return [...byId.values()];
}

function rowWeekdaySet(row = {}) {
  return new Set(
    (Array.isArray(row?.meetings) ? row.meetings : [])
      .map((meeting) => weekday(meeting?.date))
      .filter((day) => Number.isInteger(day))
  );
}

function instructorOpenWeekdaysFromRows(rows = [], empId = '', excludeCourseId = '') {
  const days = new Set();
  for (const row of rows || []) {
    if (text(row?.instructorEmpId) !== text(empId)) continue;
    if (excludeCourseId && text(row?.courseId) === text(excludeCourseId)) continue;
    for (const day of rowWeekdaySet(row)) days.add(day);
  }
  return days;
}

function countInstructorWorkdays(rows = [], empId = '') {
  return instructorOpenWeekdaysFromRows(rows, empId).size;
}

function instructorPlanTravelKm(rows = [], empId = '') {
  let total = 0;
  let seen = false;
  for (const row of rows || []) {
    if (text(row?.instructorEmpId) !== text(empId)) continue;
    const km = Number(planningRowPrimaryOption(row)?.operationalMetrics?.relevantTravelDistance);
    if (!Number.isFinite(km)) continue;
    total += km;
    seen = true;
  }
  return seen ? Math.round(total * 10) / 10 : null;
}

/**
 * Day consolidation may accept a reseat only when workdays drop, or when workdays
 * stay equal and measured travel actually improves. Equal days with equal/worse
 * travel (or unknown travel) must keep the existing plan.
 */
export function dayConsolidationAcceptsMove({
  beforeDays,
  afterDays,
  beforeTravelKm = null,
  afterTravelKm = null
} = {}) {
  const before = Number(beforeDays);
  const after = Number(afterDays);
  if (!Number.isFinite(before) || !Number.isFinite(after)) return false;
  if (after > before) return false;
  if (after < before) return true;
  const beforeTravel = Number(beforeTravelKm);
  const afterTravel = Number(afterTravelKm);
  if (!Number.isFinite(beforeTravel) || !Number.isFinite(afterTravel)) return false;
  return afterTravel < beforeTravel;
}

/**
 * Bounded local pass: try to move flexible proposals onto weekdays already open
 * for an eligible existing instructor, including reassignment when that removes
 * a workday. Does not touch fixed/locked/live/started/source-dated anchors or run
 * a national rebuild.
 */
function planningRowAsVirtualOption(row = {}) {
  if (!text(row?.instructorEmpId) || !Array.isArray(row?.meetings) || !row.meetings.length) return null;
  return {
    instructorEmpId: text(row.instructorEmpId),
    instructorName: text(row.instructorName),
    startDate: text(row.startDate),
    endDate: text(row.endDate),
    startTime: text(row.startTime),
    endTime: text(row.endTime),
    fullDayBlocking: row?.fullDayBlocking === true,
    meetings: row.meetings.map((meeting) => ({ ...meeting }))
  };
}

function consolidationContextForCourse({
  rowsById,
  activityById,
  currentContextActivities = [],
  excludeCourseId = ''
} = {}) {
  // currentContextActivities contains the virtual proposals created during the
  // initial pass. Strip them and rebuild virtual rows from rowsById so every
  // consolidation decision sees the latest accepted moves rather than stale
  // pre-consolidation placements.
  const context = (currentContextActivities || []).filter((item) =>
    !text(idOf(item)).startsWith('planning-block:')
  );
  for (const row of rowsById?.values?.() || []) {
    const courseId = text(row?.courseId);
    if (!courseId || courseId === text(excludeCourseId)) continue;
    if (text(row?.kind) === 'live') continue; // already present in base context
    const option = planningRowAsVirtualOption(row);
    const activity = activityById?.get?.(courseId);
    if (!option || !activity) continue;
    const virtual = blockingVirtualActivity(activity, option);
    if (virtual) context.push(virtual);
  }
  return context;
}

function planningRowSchoolId(row = {}, activityById = new Map()) {
  return text(row?.schoolId || activityById.get(text(row?.courseId))?.school_id);
}

function planningRowWeekdays(row = {}) {
  return new Set((row?.meetings || [])
    .map((meeting) => weekday(text(meeting?.date).slice(0, 10)))
    .filter((day) => Number.isInteger(day)));
}

function schoolWeekdayCount(rows = [], schoolId = '') {
  const days = new Set();
  for (const row of rows || []) {
    if (!schoolId || text(row?.schoolId) !== text(schoolId)) continue;
    for (const day of planningRowWeekdays(row)) days.add(day);
  }
  return days.size;
}

function isSchoolPlanningAnchor(row = {}, activity = {}) {
  return ['live', 'fixed', 'fixed-proposal', 'planning-locked'].includes(text(row?.kind))
    || row?.planningLocked === true
    || row?.schoolDateAnchored === true
    || planningActivityHasStarted(activity);
}

export function buildSchoolPlanningGroups({ rows = [], activities = [] } = {}) {
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const grouped = new Map();
  for (const row of rows || []) {
    const courseId = text(row?.courseId);
    const schoolId = planningRowSchoolId(row, activityById);
    if (!courseId || !schoolId) continue;
    const activity = activityById.get(courseId) || {};
    const group = grouped.get(schoolId) || {
      schoolId,
      school: text(row?.school || activity?.school),
      authority: text(row?.authority || activity?.authority),
      anchors: [],
      movableRows: [],
      rows: [],
      allCourseIds: [],
      currentWeekdays: new Set(),
      anchorWeekdays: new Set(),
      candidateWeekdays: new Set()
    };
    const days = planningRowWeekdays(row);
    group.rows.push(row);
    group.allCourseIds.push(courseId);
    for (const day of days) group.currentWeekdays.add(day);

    if (isSchoolPlanningAnchor(row, activity)) {
      group.anchors.push(row);
      for (const day of days) group.anchorWeekdays.add(day);
    } else if (['proposal', 'recruitment'].includes(text(row?.kind))) {
      // School-first owns the calendar shape before instructor-day optimization.
      // Recruitment rows participate too. Preserve any staff alternatives that
      // existed before a school-conflict fallback, so a later packing/recovery
      // pass can bring the activity back to existing staff instead of trapping
      // it permanently in recruitment.
      group.movableRows.push(row);
      const source = text(row?.kind) === 'recruitment'
        ? [
            ...(row?.packingOptions || []),
            ...(row?.options || []),
            ...(row?.scheduleOptions || [])
          ]
        : (row?.packingOptions?.length ? row.packingOptions : (row?.options || []));
      for (const option of source) {
        for (const day of planningRowWeekdays(option)) group.candidateWeekdays.add(day);
      }
      for (const day of days) group.candidateWeekdays.add(day);
    }
    grouped.set(schoolId, group);
  }
  return [...grouped.values()].filter((group) => group.allCourseIds.length >= 2 && group.movableRows.length > 0);
}

function weekdaySetCombinations(values = [], size = 0, start = 0, selected = [], result = []) {
  if (selected.length === size) {
    result.push(new Set(selected));
    return result;
  }
  for (let index = start; index < values.length; index += 1) {
    selected.push(values[index]);
    weekdaySetCombinations(values, size, index + 1, selected, result);
    selected.pop();
  }
  return result;
}

function schoolPackingScheduleOption(row = {}, option = {}) {
  const meetings = (option?.meetings || []).map((meeting) => ({ ...meeting }));
  if (!meetings.length) return null;
  return {
    ...option,
    instructorEmpId: text(option?.instructorEmpId),
    instructorName: text(option?.instructorName),
    startDate: text(option?.startDate || meetings[0]?.date),
    endDate: text(option?.endDate || meetings.at?.(-1)?.date),
    startTime: text(option?.startTime || meetings[0]?.start_time),
    endTime: text(option?.endTime || meetings[0]?.end_time),
    meetings,
    fullDayBlocking: row?.fullDayBlocking === true,
    schoolScheduleOnly: !text(option?.instructorEmpId)
  };
}

function schoolPackingCurrentOption(row = {}) {
  const withInstructor = planningRowAsVirtualOption(row);
  if (withInstructor) return { ...withInstructor, schoolScheduleOnly: false };
  if (!Array.isArray(row?.meetings) || !row.meetings.length) return null;
  return schoolPackingScheduleOption(row, {
    startDate: row.startDate,
    endDate: row.endDate,
    startTime: row.startTime,
    endTime: row.endTime,
    meetings: row.meetings
  });
}

function schoolPackingOptions(row = {}, candidateDays = new Set()) {
  const current = schoolPackingCurrentOption(row);
  const source = text(row?.kind) === 'recruitment'
    ? [
        ...(row?.packingOptions || []),
        ...(row?.options || []),
        ...(row?.scheduleOptions || [])
      ]
    : ((row?.packingOptions?.length ? row.packingOptions : row?.options) || []);
  const options = [
    current,
    ...source.map((option) => schoolPackingScheduleOption(row, option))
  ].filter(Boolean);

  const seen = new Set();
  return options.filter((option) => {
    if (option?.routeVerified === false) return false;
    const days = planningRowWeekdays(option);
    if (!days.size || [...days].some((day) => !candidateDays.has(day))) return false;
    const key = `${text(option.instructorEmpId) || 'schedule-only'}|${planningMeetingsSignature(option.meetings)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function schoolPackingOptionsConflict(first = {}, second = {}) {
  const firstMainEmpId = text(first?.instructorEmpId);
  const secondMainEmpId = text(second?.instructorEmpId);
  for (const a of first?.meetings || []) {
    const aEmpId = meetingInstructorEmpId(a, firstMainEmpId);
    if (!aEmpId) continue;
    for (const b of second?.meetings || []) {
      const bEmpId = meetingInstructorEmpId(b, secondMainEmpId);
      if (!bEmpId || aEmpId !== bEmpId) continue;
      if (text(a?.date).slice(0, 10) !== text(b?.date).slice(0, 10)) continue;
      const aStart = timeMinutes(a?.start_time);
      const aEnd = timeMinutes(a?.end_time);
      const bStart = timeMinutes(b?.start_time);
      const bEnd = timeMinutes(b?.end_time);
      if (first?.fullDayBlocking === true || second?.fullDayBlocking === true) return true;
      if ([aStart, aEnd, bStart, bEnd].some((value) => value == null)) continue;
      if (aStart < bEnd && bStart < aEnd) return true;
    }
  }
  return false;
}

function schoolPackingSecondaryCost(options = []) {
  return (options || []).reduce((sum, option) => {
    const metrics = option?.operationalMetrics || {};
    return sum
      + Math.max(0, Number(metrics.newWorkDayMeetingCount) || 0) * 1000
      + Math.max(0, Number(metrics.relevantTravelDistance) || 0) * 10
      + Math.max(0, Number(metrics.nonTravelWaitingMinutes) || 0)
      - Math.max(0, Number(metrics.sameSchoolMeetingCount) || 0) * 25
      - Math.max(0, Number(option?.planningOptimization?.total) || 0);
  }, 0);
}

function schoolPackingBundleCost(choices = [], group = {}) {
  const weekdays = new Set();
  const instructorCounts = new Map();
  const anchorInstructorIds = new Set((group?.anchors || []).map((row) => text(row?.instructorEmpId)).filter(Boolean));
  let recruitmentCount = 0;

  for (const choice of choices || []) {
    const option = choice?.option || {};
    for (const day of planningRowWeekdays(option)) weekdays.add(day);
    const empId = text(option?.instructorEmpId);
    if (empId) instructorCounts.set(empId, (instructorCounts.get(empId) || 0) + 1);
    else recruitmentCount += 1;
  }

  const realInstructorIds = [...instructorCounts.keys()];
  const newInstructorCount = realInstructorIds.filter((empId) => !anchorInstructorIds.has(empId)).length;
  const singletonInstructorCount = [...instructorCounts.values()].filter((count) => count === 1).length;
  const repeatedAssignments = [...instructorCounts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);

  // Lexicographic business objective encoded as large, separated weights:
  // 1) as few school weekdays as possible,
  // 2) cover the timetable with existing staff before declaring recruitment,
  // 3) reuse instructors already serving the school / use fewer instructors,
  // 4) only then optimize workdays, travel, waiting and model score.
  return weekdays.size * 1_000_000_000
    + recruitmentCount * 100_000_000
    + newInstructorCount * 10_000_000
    + realInstructorIds.length * 1_000_000
    + singletonInstructorCount * 100_000
    - repeatedAssignments * 50_000
    + schoolPackingSecondaryCost((choices || []).map((choice) => choice.option));
}

function schoolPackingChoicesOperationallyConflict(firstChoice = {}, secondChoice = {}, {
  activityById = new Map(),
  routeClient = null
} = {}) {
  const first = firstChoice?.option || firstChoice;
  const second = secondChoice?.option || secondChoice;
  if (schoolPackingOptionsConflict(first, second)) return true;

  const firstRow = firstChoice?.row || {};
  const secondRow = secondChoice?.row || {};
  const firstActivity = activityById.get(text(firstRow?.courseId)) || {};
  const secondActivity = activityById.get(text(secondRow?.courseId)) || {};
  const sameSchool = !!text(firstRow?.schoolId)
    && text(firstRow?.schoolId) === text(secondRow?.schoolId);

  const firstMainEmpId = text(first?.instructorEmpId);
  const secondMainEmpId = text(second?.instructorEmpId);
  for (const a of first?.meetings || []) {
    const aEmpId = meetingInstructorEmpId(a, firstMainEmpId);
    if (!aEmpId) continue;
    for (const b of second?.meetings || []) {
      const bEmpId = meetingInstructorEmpId(b, secondMainEmpId);
      if (!bEmpId || aEmpId !== bEmpId) continue;
      if (text(a?.date).slice(0, 10) !== text(b?.date).slice(0, 10)) continue;
      if (sameSchool) continue;

      const aStart = timeMinutes(a?.start_time);
      const aEnd = timeMinutes(a?.end_time);
      const bStart = timeMinutes(b?.start_time);
      const bEnd = timeMinutes(b?.end_time);
      if ([aStart, aEnd, bStart, bEnd].some((value) => value == null)) return true;

      const firstBeforeSecond = aEnd <= bStart;
      const secondBeforeFirst = bEnd <= aStart;
      if (!firstBeforeSecond && !secondBeforeFirst) return true;

      const previous = firstBeforeSecond
        ? { end: aEnd, activity: firstActivity }
        : { end: bEnd, activity: secondActivity };
      const next = firstBeforeSecond
        ? { start: bStart, activity: secondActivity }
        : { start: aStart, activity: firstActivity };

      const route = peekCachedTransition(
        routeClient,
        previous.activity?.school_address,
        next.activity?.school_address
      );
      const km = Number(route?.distance_km);
      const travelMinutes = Number(route?.duration_minutes);
      if (!Number.isFinite(km) || !Number.isFinite(travelMinutes)) return true;
      const availableGap = next.start - previous.end;
      if (transitionDistanceCapApplies(availableGap) && exceedsTransitionDistanceLimit(km)) return true;
      if (availableGap < travelMinutes + transitionBufferMinutes(km)) return true;
    }
  }
  return false;
}

function schoolPackingChoiceInstructorIds(choice = {}) {
  const option = choice?.option || choice || {};
  const mainEmpId = text(option?.instructorEmpId);
  const ids = new Set(mainEmpId ? [mainEmpId] : []);
  for (const meeting of option?.meetings || []) {
    const empId = meetingInstructorEmpId(meeting, mainEmpId);
    if (empId) ids.add(empId);
  }
  return ids;
}

function solveSchoolPackingGroup(group = {}, candidateDays = new Set(), beamWidth = 96, {
  blockers = [],
  activityById = new Map(),
  routeClient = null,
  maxExactNodes = 500000
} = {}) {
  const rows = [...(group.movableRows || [])]
    .map((row) => ({
      row,
      options: schoolPackingOptions(row, candidateDays)
        .sort((first, second) =>
          schoolPackingBundleCost([{ row, option: first }], group)
          - schoolPackingBundleCost([{ row, option: second }], group)
        )
    }))
    .sort((a, b) => a.options.length - b.options.length || text(a.row.courseId).localeCompare(text(b.row.courseId)));
  if (rows.some((item) => !item.options.length)) return null;

  const blockersByInstructor = new Map();
  for (const blocker of blockers) {
    for (const empId of schoolPackingChoiceInstructorIds(blocker)) {
      const bucket = blockersByInstructor.get(empId) || [];
      bucket.push(blocker);
      blockersByInstructor.set(empId, bucket);
    }
  }

  const candidateFits = (choices, candidateChoice) => {
    const relevantBlockers = new Set();
    for (const empId of schoolPackingChoiceInstructorIds(candidateChoice)) {
      for (const blocker of blockersByInstructor.get(empId) || []) relevantBlockers.add(blocker);
    }
    if ([...relevantBlockers].some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    )) return false;
    return !choices.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    );
  };

  // Small school groups are cheap enough to search exactly. This prevents a
  // beam from discarding a slightly more expensive partial state that is the
  // only route to a complete non-overlapping school timetable.
  if (rows.length <= 6) {
    const complete = [];
    const maxNodes = Math.max(500, Number(maxExactNodes) || 500000);
    let visited = 0;
    let exhausted = true;

    const search = (index, choices) => {
      if (visited >= maxNodes) {
        exhausted = false;
        return;
      }
      visited += 1;
      if (index >= rows.length) {
        complete.push({
          choices: [...choices],
          cost: schoolPackingBundleCost(choices, group)
        });
        complete.sort((a, b) => a.cost - b.cost);
        if (complete.length > 12) complete.length = 12;
        return;
      }

      const item = rows[index];
      for (const option of item.options) {
        if (visited >= maxNodes) {
          exhausted = false;
          break;
        }
        const candidateChoice = { row: item.row, option };
        if (!candidateFits(choices, candidateChoice)) continue;
        search(index + 1, [...choices, candidateChoice]);
      }
    };

    search(0, []);
    if (complete.length) {
      const alternatives = complete.slice(0, 3);
      return {
        ...alternatives[0],
        alternatives,
        searchMode: exhausted ? 'exact' : 'bounded-exact',
        visitedNodes: visited
      };
    }
  }

  // Larger school groups use a wider bounded beam. This is still local and
  // route-cache-only, so it is cheap compared with candidate routing while
  // preserving substantially more timetable diversity than the old beam=24.
  const width = Math.max(24, Number(beamWidth) || 96);
  let beam = [{ choices: [], cost: 0 }];
  for (const item of rows) {
    const next = [];
    for (const state of beam) {
      for (const option of item.options) {
        const candidateChoice = { row: item.row, option };
        if (!candidateFits(state.choices, candidateChoice)) continue;
        const choices = [...state.choices, candidateChoice];
        next.push({ choices, cost: schoolPackingBundleCost(choices, group) });
      }
    }
    beam = next.sort((a, b) => a.cost - b.cost).slice(0, width);
    if (!beam.length) return null;
  }

  const alternatives = [];
  const seen = new Set();
  for (const state of beam.sort((a, b) => a.cost - b.cost)) {
    const signature = state.choices
      .map(({ row, option }) => `${text(row?.courseId)}:${text(option?.instructorEmpId)}:${planningMeetingsSignature(option?.meetings)}`)
      .sort()
      .join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    alternatives.push(state);
    if (alternatives.length >= 3) break;
  }
  const best = alternatives[0] || null;
  return best ? { ...best, alternatives, searchMode: 'beam' } : null;
}

function schoolPackingAlternativeSummary(state = {}, rank = 1) {
  const weekdays = new Set();
  const instructorIds = new Set();
  let recruitmentCount = 0;
  const assignments = (state?.choices || []).map(({ row, option }) => {
    for (const day of planningRowWeekdays(option)) weekdays.add(day);
    const empId = text(option?.instructorEmpId);
    if (empId) instructorIds.add(empId);
    else recruitmentCount += 1;
    return {
      courseId: text(row?.courseId),
      courseName: text(row?.courseName),
      kind: text(row?.kind),
      startDate: text(option?.startDate || option?.meetings?.[0]?.date),
      startTime: text(option?.startTime || option?.meetings?.[0]?.start_time),
      endTime: text(option?.endTime || option?.meetings?.[0]?.end_time),
      instructorEmpId: empId,
      instructorName: text(option?.instructorName)
    };
  });
  return {
    rank,
    schoolDayCount: weekdays.size,
    weekdays: [...weekdays].sort((a, b) => a - b),
    instructorCount: instructorIds.size,
    recruitmentCount,
    assignments
  };
}

function annotateSchoolPlanningGroup(group = {}, minimumFeasibleWeekdayCount = null, alternatives = []) {
  const actualWeekdays = [...group.currentWeekdays].sort((a, b) => a - b);
  const solvedMinimum = minimumFeasibleWeekdayCount != null
    && minimumFeasibleWeekdayCount !== ''
    && Number.isInteger(Number(minimumFeasibleWeekdayCount))
    && Number(minimumFeasibleWeekdayCount) >= 0;
  const minimum = solvedMinimum ? Number(minimumFeasibleWeekdayCount) : null;
  const avoidableSplitCount = minimum == null ? 0 : Math.max(0, actualWeekdays.length - minimum);
  const hasFullDayTour = (group.rows || []).some((row) => row?.fullDayBlocking === true);
  const splitReason = actualWeekdays.length <= 1
    ? ''
    : group.anchorWeekdays.size > 1
      ? 'anchor_weekdays'
      : hasFullDayTour
        ? 'tour_day_exclusive'
        : solvedMinimum && minimum > 1
          ? 'no_single_day_complete_bundle'
          : 'solver_no_complete_bundle';
  const packingStatus = avoidableSplitCount > 0
    ? 'avoidable_split'
    : (actualWeekdays.length <= 1
      ? 'packed'
      : (solvedMinimum ? 'required_split' : 'unresolved_split'));
  const normalizedAlternatives = (alternatives || []).slice(0, 3);
  const schoolPlanning = {
    schoolId: group.schoolId,
    groupActivityCount: group.allCourseIds.length,
    anchorActivityCount: group.anchors.length,
    flexibleActivityCount: group.movableRows.length,
    actualWeekdays,
    minimumFeasibleWeekdays: minimum,
    avoidableSplitCount,
    splitReason,
    anchorWeekdays: [...group.anchorWeekdays].sort((a, b) => a - b),
    packingStatus,
    alternativeCount: normalizedAlternatives.length,
    alternatives: normalizedAlternatives
  };
  for (const row of group.rows || [...group.anchors, ...group.movableRows]) row.schoolPlanning = { ...schoolPlanning };
  return schoolPlanning;
}

function schoolPackingConflictFallback({
  group = {},
  rowsById,
  candidateDays = [],
  blockers = [],
  activityById = new Map(),
  routeClient = null
} = {}) {
  const allowedDays = new Set(candidateDays);
  const selectedChoices = [];
  let moved = 0;
  let recruitmentCount = 0;

  const items = [...(group.movableRows || [])]
    .map((row) => ({
      row,
      options: schoolPackingOptions(row, allowedDays)
        .filter((option) => text(option?.instructorEmpId))
        .sort((first, second) =>
          schoolPackingBundleCost([{ row, option: first }], group)
          - schoolPackingBundleCost([{ row, option: second }], group)
        )
    }))
    .sort((a, b) => a.options.length - b.options.length || text(a.row?.courseId).localeCompare(text(b.row?.courseId)));

  const fits = (candidateChoice) => {
    if (blockers.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    )) return false;
    return !selectedChoices.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    );
  };

  for (const item of items) {
    const row = item.row;
    const chosen = item.options.find((option) => fits({ row, option })) || null;
    if (chosen) {
      const replacement = {
        ...row,
        kind: 'proposal',
        status: row?.status || 'הצעת מערכת',
        instructorEmpId: text(chosen.instructorEmpId),
        instructorName: text(chosen.instructorName),
        startDate: text(chosen.startDate || chosen.meetings?.[0]?.date),
        endDate: text(chosen.endDate || chosen.meetings?.at?.(-1)?.date),
        startTime: text(chosen.startTime || chosen.meetings?.[0]?.start_time),
        endTime: text(chosen.endTime || chosen.meetings?.[0]?.end_time),
        meetings: (chosen.meetings || []).map((meeting) => ({ ...meeting })),
        diagnostics: {
          ...(row?.diagnostics || {}),
          schoolDayPacking: true,
          schoolFirstOptimized: true,
          schoolConflictFallback: true
        }
      };
      const current = schoolPackingCurrentOption(row);
      const changed = text(current?.instructorEmpId) !== text(chosen.instructorEmpId)
        || planningMeetingsSignature(current?.meetings) !== planningMeetingsSignature(chosen.meetings);
      rowsById.set(text(row.courseId), replacement);
      selectedChoices.push({ row: replacement, option: schoolPackingCurrentOption(replacement) });
      if (changed) moved += 1;
      continue;
    }

    const scheduleCandidates = [
      ...(row?.scheduleOptions || []).map((option) => schoolPackingScheduleOption(row, option)),
      schoolPackingCurrentOption(row)
    ].filter(Boolean);
    const schedule = scheduleCandidates.find((option) => {
      const days = planningRowWeekdays(option);
      return days.size && [...days].every((day) => allowedDays.has(day));
    }) || scheduleCandidates[0] || null;
    if (!schedule) continue;

    const selectedSchedule = {
      startDate: text(schedule.startDate || schedule.meetings?.[0]?.date),
      endDate: text(schedule.endDate || schedule.meetings?.at?.(-1)?.date),
      startTime: text(schedule.startTime || schedule.meetings?.[0]?.start_time),
      endTime: text(schedule.endTime || schedule.meetings?.[0]?.end_time),
      meetings: (schedule.meetings || []).map((meeting) => ({ ...meeting }))
    };
    rowsById.set(text(row.courseId), {
      ...row,
      kind: 'recruitment',
      status: 'נדרש גיוס',
      instructorEmpId: '',
      instructorName: '',
      ...selectedSchedule,
      scheduleOptions: [
        selectedSchedule,
        ...(row?.scheduleOptions || []).filter((candidate) =>
          planningMeetingsSignature(candidate?.meetings) !== planningMeetingsSignature(selectedSchedule.meetings)
        )
      ],
      diagnostics: {
        ...(row?.diagnostics || {}),
        schoolDayPacking: true,
        schoolFirstOptimized: true,
        schoolConflictFallback: true,
        staffBundleComplete: false
      },
      reason: 'לא נמצאה חבילת צוות קיים ללא חפיפה לכל פעילויות בית הספר; לוח בית הספר נשמר ונדרשת השלמת מדריך.'
    });
    recruitmentCount += 1;
    moved += 1;
  }

  return { moved, recruitmentCount };
}

export function optimizeSchoolDayPackingPass({
  rowsById,
  activities = [],
  targetCourseIds = null,
  beamWidth = 24,
  routeClient = null,
  maxExactNodes = 500000,
  _recoveryPass = false
} = {}) {
  const targetIds = Array.isArray(targetCourseIds) ? new Set(targetCourseIds.map(text).filter(Boolean)) : null;
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  let moved = 0;
  const groups = buildSchoolPlanningGroups({ rows: [...(rowsById?.values?.() || [])], activities });

  for (const originalGroup of groups) {
    if (targetIds && !originalGroup.allCourseIds.some((courseId) => targetIds.has(courseId))) continue;
    const candidateDays = [...new Set([...originalGroup.anchorWeekdays, ...originalGroup.candidateWeekdays])].sort((a, b) => a - b);
    const requiredDays = [...originalGroup.anchorWeekdays];
    const optionalDays = candidateDays.filter((day) => !originalGroup.anchorWeekdays.has(day));
    const groupCourseIds = new Set(originalGroup.allCourseIds.map(text));
    const blockers = [
      ...(originalGroup.anchors || []).map((row) => ({ row, option: schoolPackingCurrentOption(row) })).filter((choice) => choice.option),
      ...[...rowsById.values()]
        .filter((row) => !groupCourseIds.has(text(row?.courseId)))
        .map((row) => ({ row, option: schoolPackingCurrentOption(row) }))
        .filter((choice) => choice.option && text(choice.option?.instructorEmpId))
    ];

    let solution = null;
    let minimum = null;
    let sameSizeSolutions = [];

    // First choose the smallest legal school-day footprint. For that footprint,
    // evaluate ALL weekday-set alternatives and only then choose the instructor
    // assignment. This prevents "first feasible weekday set wins".
    for (let size = requiredDays.length; size <= candidateDays.length; size += 1) {
      const addCount = size - requiredDays.length;
      const candidates = [];
      for (const extra of weekdaySetCombinations(optionalDays, addCount)) {
        const set = new Set([...requiredDays, ...extra]);
        const solved = solveSchoolPackingGroup(originalGroup, set, beamWidth, {
          blockers,
          activityById,
          routeClient,
          maxExactNodes
        });
        if (!solved) continue;
        for (const state of solved.alternatives || [solved]) candidates.push(state);
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.cost - b.cost);
        sameSizeSolutions = candidates;
        solution = candidates[0];
        minimum = size;
        break;
      }
    }

    const alternatives = [];
    const altSeen = new Set();
    for (const state of sameSizeSolutions) {
      const summary = schoolPackingAlternativeSummary(state, alternatives.length + 1);
      const signature = summary.assignments
        .map((item) => `${item.courseId}:${item.startDate}:${item.startTime}:${item.instructorEmpId}`)
        .sort()
        .join('|');
      if (altSeen.has(signature)) continue;
      altSeen.add(signature);
      alternatives.push(summary);
      if (alternatives.length >= 3) break;
    }

    const currentChoices = originalGroup.movableRows
      .map((row) => ({ row, option: schoolPackingCurrentOption(row) }))
      .filter((choice) => choice.option);
    const currentHasConflict = currentChoices.some((choice, index) =>
      currentChoices.slice(index + 1).some((other) =>
        schoolPackingChoicesOperationallyConflict(choice, other, { activityById, routeClient })
      )
    );
    const currentCost = currentChoices.length === originalGroup.movableRows.length && !currentHasConflict
      ? schoolPackingBundleCost(currentChoices, originalGroup)
      : Number.POSITIVE_INFINITY;
    const shouldApply = !!solution
      && minimum != null
      && (
        originalGroup.currentWeekdays.size > minimum
        || solution.cost + 0.1 < currentCost
      );

    if (!solution && currentHasConflict) {
      const fallback = schoolPackingConflictFallback({
        group: originalGroup,
        rowsById,
        candidateDays,
        blockers,
        activityById,
        routeClient
      });
      moved += fallback.moved;
    }

    if (shouldApply) {
      for (const { row, option } of solution.choices) {
        const isRecruitment = !text(option?.instructorEmpId);
        const selectedSchedule = {
          startDate: text(option.startDate || option.meetings?.[0]?.date),
          endDate: text(option.endDate || option.meetings?.at?.(-1)?.date),
          startTime: text(option.startTime || option.meetings?.[0]?.start_time),
          endTime: text(option.endTime || option.meetings?.[0]?.end_time),
          meetings: (option.meetings || []).map((meeting) => ({ ...meeting }))
        };
        const replacement = {
          ...row,
          kind: isRecruitment ? 'recruitment' : 'proposal',
          status: isRecruitment ? 'נדרש גיוס' : 'מועד מומלץ לבית הספר',
          instructorEmpId: isRecruitment ? '' : text(option.instructorEmpId),
          instructorName: isRecruitment ? '' : text(option.instructorName),
          ...selectedSchedule,
          scheduleOptions: isRecruitment
            ? [
                selectedSchedule,
                ...(row.scheduleOptions || []).filter((candidate) =>
                  planningMeetingsSignature(candidate?.meetings) !== planningMeetingsSignature(selectedSchedule.meetings)
                )
              ]
            : row.scheduleOptions,
          diagnostics: {
            ...(row.diagnostics || {}),
            schoolDayPacking: true,
            schoolFirstOptimized: true,
            ...(isRecruitment ? { schoolConflictFallback: true, staffBundleComplete: false } : {})
          }
        };
        const currentOption = schoolPackingCurrentOption(row);
        const changed = text(currentOption?.instructorEmpId) !== text(replacement.instructorEmpId)
          || planningMeetingsSignature(currentOption?.meetings) !== planningMeetingsSignature(replacement.meetings);
        if (changed || isRecruitment) {
          rowsById.set(text(row.courseId), replacement);
        }
        if (changed) moved += 1;
      }
    }

    const refreshed = buildSchoolPlanningGroups({ rows: [...rowsById.values()], activities })
      .find((group) => group.schoolId === originalGroup.schoolId) || originalGroup;
    const schoolPlanning = annotateSchoolPlanningGroup(refreshed, minimum, alternatives);
    // Outcome-based: a staff bundle is complete only when every school row kept an
    // existing instructor. Path-based flags were overwritten by the recovery pass
    // and incorrectly reported complete bundles that still required recruitment.
    const schoolRowsAfter = [...rowsById.values()]
      .filter((row) => text(row?.schoolId) === text(originalGroup.schoolId));
    const staffConflictFallbackCount = schoolRowsAfter
      .filter((row) => text(row?.kind) === 'recruitment')
      .length;
    const proposalRowsAfter = schoolRowsAfter.filter((row) => text(row?.kind) === 'proposal');
    const hasOverlappingProposals = proposalRowsAfter.some((first, index) =>
      proposalRowsAfter.slice(index + 1).some((second) => {
        if (text(first?.instructorEmpId) !== text(second?.instructorEmpId) || !text(first?.instructorEmpId)) return false;
        return schoolPackingChoicesOperationallyConflict(
          { row: first, option: schoolPackingCurrentOption(first) },
          { row: second, option: schoolPackingCurrentOption(second) },
          { activityById, routeClient }
        );
      })
    );
    const staffBundleComplete = staffConflictFallbackCount === 0 && !hasOverlappingProposals;
    for (const row of refreshed.rows || []) {
      row.schoolPlanning = {
        ...(row.schoolPlanning || schoolPlanning),
        staffBundleComplete,
        staffConflictFallbackCount
      };
    }
  }
  if (!_recoveryPass) {
    const needsRecruitmentRecovery = [...rowsById.values()].some((row) =>
      text(row?.kind) === 'recruitment'
      && row?.diagnostics?.schoolConflictFallback === true
      && [...(row?.packingOptions || []), ...(row?.options || [])]
        .some((option) => text(option?.instructorEmpId))
    );
    if (needsRecruitmentRecovery) {
      const recovery = optimizeSchoolDayPackingPass({
        rowsById,
        activities,
        targetCourseIds,
        beamWidth,
        routeClient,
        maxExactNodes,
        _recoveryPass: true
      });
      moved += recovery.moved;
    }
  }
  return { moved, groups: groups.length };
}

// Sync solver remains available for deterministic unit checks. The browser path
// uses the cooperative solver below so exact/beam/weekday loops can yield and
// honour cancellation inside a single school group — not only between schools.
async function solveSchoolPackingGroupCooperatively(group = {}, candidateDays = new Set(), beamWidth = 96, {
  blockers = [],
  activityById = new Map(),
  routeClient = null,
  maxExactNodes = 1000,
  checkpoint = async () => {},
  yieldEveryNodes = 32
} = {}) {
  const rows = [...(group.movableRows || [])]
    .map((row) => ({
      row,
      options: schoolPackingOptions(row, candidateDays)
        .sort((first, second) =>
          schoolPackingBundleCost([{ row, option: first }], group)
          - schoolPackingBundleCost([{ row, option: second }], group)
        )
    }))
    .sort((a, b) => a.options.length - b.options.length || text(a.row.courseId).localeCompare(text(b.row.courseId)));
  if (rows.some((item) => !item.options.length)) return null;

  const blockersByInstructor = new Map();
  for (const blocker of blockers) {
    for (const empId of schoolPackingChoiceInstructorIds(blocker)) {
      const bucket = blockersByInstructor.get(empId) || [];
      bucket.push(blocker);
      blockersByInstructor.set(empId, bucket);
    }
  }

  const candidateFits = (choices, candidateChoice) => {
    const relevantBlockers = new Set();
    for (const empId of schoolPackingChoiceInstructorIds(candidateChoice)) {
      for (const blocker of blockersByInstructor.get(empId) || []) relevantBlockers.add(blocker);
    }
    if ([...relevantBlockers].some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    )) return false;
    return !choices.some((choice) =>
      schoolPackingChoicesOperationallyConflict(choice, candidateChoice, { activityById, routeClient })
    );
  };

  const nodeBudget = Math.max(1, Number(yieldEveryNodes) || 32);
  let nodesSinceYield = 0;
  const maybeYield = async () => {
    nodesSinceYield += 1;
    if (nodesSinceYield >= nodeBudget) {
      nodesSinceYield = 0;
      await checkpoint();
    }
  };

  if (rows.length <= 6) {
    const complete = [];
    const maxNodes = Math.max(500, Number(maxExactNodes) || 500000);
    let visited = 0;
    let exhausted = true;

    const search = async (index, choices) => {
      await maybeYield();
      if (visited >= maxNodes) {
        exhausted = false;
        return;
      }
      visited += 1;
      if (index >= rows.length) {
        complete.push({
          choices: [...choices],
          cost: schoolPackingBundleCost(choices, group)
        });
        complete.sort((a, b) => a.cost - b.cost);
        if (complete.length > 12) complete.length = 12;
        return;
      }

      const item = rows[index];
      for (const option of item.options) {
        if (visited >= maxNodes) {
          exhausted = false;
          break;
        }
        const candidateChoice = { row: item.row, option };
        if (!candidateFits(choices, candidateChoice)) continue;
        await search(index + 1, [...choices, candidateChoice]);
      }
    };

    await search(0, []);
    if (complete.length) {
      const alternatives = complete.slice(0, 3);
      return {
        ...alternatives[0],
        alternatives,
        searchMode: exhausted ? 'exact' : 'bounded-exact',
        visitedNodes: visited
      };
    }
  }

  const width = Math.max(24, Number(beamWidth) || 96);
  let beam = [{ choices: [], cost: 0 }];
  for (const item of rows) {
    await checkpoint();
    const next = [];
    for (const state of beam) {
      for (const option of item.options) {
        await maybeYield();
        const candidateChoice = { row: item.row, option };
        if (!candidateFits(state.choices, candidateChoice)) continue;
        const choices = [...state.choices, candidateChoice];
        next.push({ choices, cost: schoolPackingBundleCost(choices, group) });
      }
    }
    beam = next.sort((a, b) => a.cost - b.cost).slice(0, width);
    if (!beam.length) return null;
  }

  const alternatives = [];
  const seen = new Set();
  for (const state of beam.sort((a, b) => a.cost - b.cost)) {
    const signature = state.choices
      .map(({ row, option }) => `${text(row?.courseId)}:${text(option?.instructorEmpId)}:${planningMeetingsSignature(option?.meetings)}`)
      .sort()
      .join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    alternatives.push(state);
    if (alternatives.length >= 3) break;
  }
  if (!alternatives.length) return null;
  return {
    ...alternatives[0],
    alternatives,
    searchMode: 'beam',
    visitedNodes: 0
  };
}

/**
 * Browser school-packing entry point. Yields between weekday-set attempts and
 * inside exact/beam search so a single dense school cannot monopolize the main
 * thread. Deterministic search order matches the sync solver.
 */
export async function optimizeSchoolDayPackingPassCooperatively({
  rowsById,
  activities = [],
  targetCourseIds = null,
  beamWidth = 96,
  routeClient = null,
  maxExactNodes = 1000,
  checkpoint = async () => {},
  yieldEveryNodes = 32,
  _recoveryPass = false
} = {}) {
  const targetIds = Array.isArray(targetCourseIds)
    ? new Set(targetCourseIds.map(text).filter(Boolean))
    : null;
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const groups = buildSchoolPlanningGroups({ rows: [...(rowsById?.values?.() || [])], activities })
    .filter((group) => !targetIds || group.allCourseIds.some((courseId) => targetIds.has(text(courseId))));
  let moved = 0;
  let longestSliceMs = 0;
  let yieldCount = 0;
  const nowMs = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now());
  let sliceStartedAt = nowMs();
  const instrumentedCheckpoint = async (options = {}) => {
    longestSliceMs = Math.max(longestSliceMs, Math.max(0, nowMs() - sliceStartedAt));
    yieldCount += 1;
    const result = await checkpoint(options);
    sliceStartedAt = nowMs();
    return result;
  };

  for (const originalGroup of groups) {
    await instrumentedCheckpoint({ force: true });
    const candidateDays = [...new Set([...originalGroup.anchorWeekdays, ...originalGroup.candidateWeekdays])].sort((a, b) => a - b);
    const requiredDays = [...originalGroup.anchorWeekdays];
    const optionalDays = candidateDays.filter((day) => !originalGroup.anchorWeekdays.has(day));
    const groupCourseIds = new Set(originalGroup.allCourseIds.map(text));
    const blockers = [
      ...(originalGroup.anchors || []).map((row) => ({ row, option: schoolPackingCurrentOption(row) })).filter((choice) => choice.option),
      ...[...rowsById.values()]
        .filter((row) => !groupCourseIds.has(text(row?.courseId)))
        .map((row) => ({ row, option: schoolPackingCurrentOption(row) }))
        .filter((choice) => choice.option && text(choice.option?.instructorEmpId))
    ];

    let solution = null;
    let minimum = null;
    let sameSizeSolutions = [];

    for (let size = requiredDays.length; size <= candidateDays.length; size += 1) {
      await instrumentedCheckpoint();
      const addCount = size - requiredDays.length;
      const candidates = [];
      for (const extra of weekdaySetCombinations(optionalDays, addCount)) {
        await instrumentedCheckpoint();
        const set = new Set([...requiredDays, ...extra]);
        const solved = await solveSchoolPackingGroupCooperatively(originalGroup, set, beamWidth, {
          blockers,
          activityById,
          routeClient,
          maxExactNodes,
          checkpoint: instrumentedCheckpoint,
          yieldEveryNodes
        });
        if (!solved) continue;
        for (const state of solved.alternatives || [solved]) candidates.push(state);
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.cost - b.cost);
        sameSizeSolutions = candidates;
        solution = candidates[0];
        minimum = size;
        break;
      }
    }

    const alternatives = [];
    const altSeen = new Set();
    for (const state of sameSizeSolutions) {
      const summary = schoolPackingAlternativeSummary(state, alternatives.length + 1);
      const signature = summary.assignments
        .map((item) => `${item.courseId}:${item.startDate}:${item.startTime}:${item.instructorEmpId}`)
        .sort()
        .join('|');
      if (altSeen.has(signature)) continue;
      altSeen.add(signature);
      alternatives.push(summary);
      if (alternatives.length >= 3) break;
    }

    const currentChoices = originalGroup.movableRows
      .map((row) => ({ row, option: schoolPackingCurrentOption(row) }))
      .filter((choice) => choice.option);
    const currentHasConflict = currentChoices.some((choice, index) =>
      currentChoices.slice(index + 1).some((other) =>
        schoolPackingChoicesOperationallyConflict(choice, other, { activityById, routeClient })
      )
    );
    const currentCost = currentChoices.length === originalGroup.movableRows.length && !currentHasConflict
      ? schoolPackingBundleCost(currentChoices, originalGroup)
      : Number.POSITIVE_INFINITY;
    const shouldApply = !!solution
      && minimum != null
      && (
        originalGroup.currentWeekdays.size > minimum
        || solution.cost + 0.1 < currentCost
      );

    if (!solution && currentHasConflict) {
      const fallback = schoolPackingConflictFallback({
        group: originalGroup,
        rowsById,
        candidateDays,
        blockers,
        activityById,
        routeClient
      });
      moved += fallback.moved;
    }

    if (shouldApply) {
      for (const { row, option } of solution.choices) {
        const isRecruitment = !text(option?.instructorEmpId);
        const selectedSchedule = {
          startDate: text(option.startDate || option.meetings?.[0]?.date),
          endDate: text(option.endDate || option.meetings?.at?.(-1)?.date),
          startTime: text(option.startTime || option.meetings?.[0]?.start_time),
          endTime: text(option.endTime || option.meetings?.[0]?.end_time),
          meetings: (option.meetings || []).map((meeting) => ({ ...meeting }))
        };
        const replacement = {
          ...row,
          kind: isRecruitment ? 'recruitment' : 'proposal',
          status: isRecruitment ? 'נדרש גיוס' : 'מועד מומלץ לבית הספר',
          instructorEmpId: isRecruitment ? '' : text(option.instructorEmpId),
          instructorName: isRecruitment ? '' : text(option.instructorName),
          ...selectedSchedule,
          scheduleOptions: isRecruitment
            ? [
                selectedSchedule,
                ...(row.scheduleOptions || []).filter((candidate) =>
                  planningMeetingsSignature(candidate?.meetings) !== planningMeetingsSignature(selectedSchedule.meetings)
                )
              ]
            : row.scheduleOptions,
          diagnostics: {
            ...(row.diagnostics || {}),
            schoolDayPacking: true,
            schoolFirstOptimized: true,
            ...(isRecruitment ? { schoolConflictFallback: true, staffBundleComplete: false } : {})
          }
        };
        const currentOption = schoolPackingCurrentOption(row);
        const changed = text(currentOption?.instructorEmpId) !== text(replacement.instructorEmpId)
          || planningMeetingsSignature(currentOption?.meetings) !== planningMeetingsSignature(replacement.meetings);
        if (changed || isRecruitment) {
          rowsById.set(text(row.courseId), replacement);
        }
        if (changed) moved += 1;
      }
    }

    const refreshed = buildSchoolPlanningGroups({ rows: [...rowsById.values()], activities })
      .find((group) => group.schoolId === originalGroup.schoolId) || originalGroup;
    const schoolPlanning = annotateSchoolPlanningGroup(refreshed, minimum, alternatives);
    const schoolRowsAfter = [...rowsById.values()]
      .filter((row) => text(row?.schoolId) === text(originalGroup.schoolId));
    const staffConflictFallbackCount = schoolRowsAfter
      .filter((row) => text(row?.kind) === 'recruitment')
      .length;
    const proposalRowsAfter = schoolRowsAfter.filter((row) => text(row?.kind) === 'proposal');
    const hasOverlappingProposals = proposalRowsAfter.some((first, index) =>
      proposalRowsAfter.slice(index + 1).some((second) => {
        if (text(first?.instructorEmpId) !== text(second?.instructorEmpId) || !text(first?.instructorEmpId)) return false;
        return schoolPackingChoicesOperationallyConflict(
          { row: first, option: schoolPackingCurrentOption(first) },
          { row: second, option: schoolPackingCurrentOption(second) },
          { activityById, routeClient }
        );
      })
    );
    const staffBundleComplete = staffConflictFallbackCount === 0 && !hasOverlappingProposals;
    for (const row of refreshed.rows || []) {
      row.schoolPlanning = {
        ...(row.schoolPlanning || schoolPlanning),
        staffBundleComplete,
        staffConflictFallbackCount
      };
    }

    await instrumentedCheckpoint({ force: true });
  }
  longestSliceMs = Math.max(longestSliceMs, Math.max(0, nowMs() - sliceStartedAt));

  if (!_recoveryPass) {
    const needsRecruitmentRecovery = [...rowsById.values()].some((row) =>
      text(row?.kind) === 'recruitment'
      && row?.diagnostics?.schoolConflictFallback === true
      && [...(row?.packingOptions || []), ...(row?.options || [])]
        .some((option) => text(option?.instructorEmpId))
    );
    if (needsRecruitmentRecovery) {
      const recovery = await optimizeSchoolDayPackingPassCooperatively({
        rowsById,
        activities,
        targetCourseIds,
        beamWidth,
        routeClient,
        maxExactNodes,
        checkpoint: instrumentedCheckpoint,
        yieldEveryNodes,
        _recoveryPass: true
      });
      moved += Number(recovery?.moved) || 0;
      longestSliceMs = Math.max(longestSliceMs, Number(recovery?.longestSliceMs) || 0);
      yieldCount += Number(recovery?.yieldCount) || 0;
    }
  }

  return { moved, groups: groups.length, longestSliceMs, yieldCount };
}

export function planningSchoolDayMetrics(rows = [], activities = []) {
  const groups = buildSchoolPlanningGroups({ rows, activities });
  const diagnostics = groups.map((group) => {
    const existing = [...group.anchors, ...group.movableRows].find((row) => row?.schoolPlanning)?.schoolPlanning;
    return existing || annotateSchoolPlanningGroup(group, group.currentWeekdays.size);
  });
  return {
    schoolCount: new Set((rows || []).map((row) => text(row?.schoolId)).filter(Boolean)).size,
    schoolsWithMultipleFlexibleActivities: groups.filter((group) => group.movableRows.length >= 2).length,
    fragmentedSchools: diagnostics.filter((item) => item.actualWeekdays.length > 1).length,
    totalSchoolWeekdays: diagnostics.reduce((sum, item) => sum + item.actualWeekdays.length, 0),
    avoidableSchoolDaySplits: diagnostics.reduce((sum, item) => sum + item.avoidableSplitCount, 0),
    maxSchoolWeekdays: diagnostics.reduce((max, item) => Math.max(max, item.actualWeekdays.length), 0),
    groups: diagnostics
  };
}

function refreshSchoolPlanningDiagnostics(rowsById, activities = []) {
  const groups = buildSchoolPlanningGroups({ rows: [...(rowsById?.values?.() || [])], activities });
  for (const group of groups) {
    const prior = [...group.anchors, ...group.movableRows]
      .find((row) => row?.schoolPlanning)?.schoolPlanning;
    annotateSchoolPlanningGroup(
      group,
      prior?.minimumFeasibleWeekdays != null
        && prior.minimumFeasibleWeekdays !== ''
        && Number.isInteger(Number(prior.minimumFeasibleWeekdays))
        ? Number(prior.minimumFeasibleWeekdays)
        : null,
      Array.isArray(prior?.alternatives) ? prior.alternatives : []
    );
  }
}

/**
 * Global workday-consolidation pass for flexible proposals.
 *
 * Unlike the old one-shot local pass, this pass is iterative and rebuilds its
 * candidate context after every accepted move. It therefore handles chains of
 * flexible activities (including several courses at the same school) without
 * scoring the next row against stale virtual proposals.
 */

function optimizationContextFactory({ instructors, profiles, rules, exceptions, schoolCalendar, checkpoint }) {
  const contexts = new Map();
  return async (activities, periodKey, candidateInstructors) => {
    let context = contexts.get(periodKey);
    if (!context) {
      context = await prepareSchedulingRunContextCooperatively({ activities, instructors, profiles, rules, exceptions, schoolCalendar, periodKey }, checkpoint);
      contexts.set(periodKey, context);
    } else {
      await updateSchedulingRunContextCooperatively(context, activities, checkpoint);
    }
    return { ...context, instructors: candidateInstructors,
      instructorById: new Map(candidateInstructors.map(row => [text(row.emp_id), row])) };
  };
}

export async function consolidateInstructorWorkdaysPass({
  rowsById,
  targetCourseIds = null,
  targets = [],
  catalog = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  today = '',
  routeClient = null,
  currentContextActivities = [],
  checkpoint = async () => {},
  signal = null,
  limits = FAST_PLANNING_LIMITS,
  report = async () => {}
} = {}) {
  const activityById = new Map((targets || []).map((activity) => [idOf(activity), activity]));
  const preparedForOptimization = optimizationContextFactory({ instructors, profiles, rules, exceptions, schoolCalendar, checkpoint });
  const targetIds = Array.isArray(targetCourseIds)
    ? new Set(targetCourseIds.map((value) => text(value)).filter(Boolean))
    : null;
  const maxPasses = 4;
  let moved = 0;
  let passes = 0;

  const movableRows = () => [...rowsById.values()]
    .filter((row) =>
      text(row?.kind) === 'proposal'
      && (!targetIds || targetIds.has(text(row?.courseId)))
      && row?.schoolDateAnchored !== true
      && row?.planningLocked !== true
      && text(row?.instructorEmpId)
      && Array.isArray(row?.meetings)
      && row.meetings.length
    )
    .sort((first, second) => {
      const firstEmp = text(first.instructorEmpId);
      const secondEmp = text(second.instructorEmpId);
      const firstNew = Math.max(0, Number(planningRowPrimaryOption(first)?.operationalMetrics?.newWorkDayMeetingCount) || 0);
      const secondNew = Math.max(0, Number(planningRowPrimaryOption(second)?.operationalMetrics?.newWorkDayMeetingCount) || 0);
      if (firstNew !== secondNew) return secondNew - firstNew;
      return text(first.courseId).localeCompare(text(second.courseId));
    });

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const movable = movableRows();
    if (!movable.length) break;
    let movedThisPass = 0;
    passes += 1;

    let processedThisPass = 0;
    for (const row of movable) {
      processedThisPass += 1;
      await report(`ריכוז ימי עבודה · סבב ${pass + 1}`, processedThisPass, movable.length, row.courseId);
      const empId = text(row.instructorEmpId);
      const activity = activityById.get(text(row.courseId));
      if (!activity || planningActivityHasStarted(activity, today)) continue;
      if (officialPlanningDates(activity).length) continue;

      const currentDays = rowWeekdaySet(row);
      const currentRows = [...rowsById.values()];
      const currentOpenDays = instructorOpenWeekdaysFromRows(currentRows, empId, row.courseId);
      const opensOnlyNewDays = [...currentDays].every((day) => !currentOpenDays.has(day));
      if (!opensOnlyNewDays) continue;

      // Consolidation is an assignment problem, not only a date problem. A
      // flexible course may move to another eligible existing instructor when
      // that removes a workday. Fixed/source-dated activities were excluded
      // above and therefore remain immutable anchors.
      const openDaysByEmp = new Map();
      const consolidationInstructors = (instructors || []).filter((item) => {
        const candidateEmpId = text(item?.emp_id);
        if (!candidateEmpId) return false;
        const days = instructorOpenWeekdaysFromRows(currentRows, candidateEmpId, row.courseId);
        if (!days.size) return false;
        openDaysByEmp.set(candidateEmpId, days);
        return true;
      });
      if (!consolidationInstructors.length) continue;

      const activityPeriodKey = planningPeriodKeyForActivity(activity);
      const contextWithoutSelf = consolidationContextForCourse({
        rowsById,
        activityById,
        currentContextActivities,
        excludeCourseId: row.courseId
      });
      const generated = await generatePlanningScenariosCooperatively({
        activity,
        catalog,
        instructors: consolidationInstructors,
        rules,
        profiles,
        activities: contextWithoutSelf,
        schoolCalendar,
        today,
        periodKey: activityPeriodKey,
        maxScenarios: Math.min(18, Math.max(12, Number(limits.maxScenarios) || 12)),
        routeClient
      }, checkpoint);
      if (!generated.spec.complete || !generated.scenarios?.length) continue;

      const openWeekdays = new Set([...openDaysByEmp.values()].flatMap((days) => [...days]));
      const preferredScenarios = generated.scenarios.filter((scenario) => openWeekdays.has(weekday(scenario.startDate)));
      if (!preferredScenarios.length) continue;

      // Rebuild prepared/travel contexts from the CURRENT rows, not from the
      // initial virtual plan. This is the critical stale-context fix.
      const freshPreparedContext = await preparedForOptimization(contextWithoutSelf, activityPeriodKey, consolidationInstructors);
      const freshTravelContext = createCandidateTravelContext(contextWithoutSelf);

      const evaluation = await evaluateScenarioOptions({
        activity,
        scenarios: preferredScenarios,
        startRange: generated.startRange,
        contextActivities: contextWithoutSelf,
        instructors: consolidationInstructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        today,
        routeClient,
        checkpoint,
        signal,
        periodKey: activityPeriodKey,
        preparedContext: freshPreparedContext,
        travelContext: freshTravelContext,
        limits: {
          ...limits,
          maxScenarios: preferredScenarios.length,
          maxCandidatesPerScenario: Math.max(3, Number(limits.maxCandidatesPerScenario) || 0),
          maxRoutedPlanningPairs: Math.max(8, Number(limits.maxRoutedPlanningPairs) || 0),
          maxFinalOptions: Math.max(8, Number(limits.maxFinalOptions) || 0),
          runGlobalRepair: false
        }
      });
      let best = null;
      for (const option of evaluation.options || []) {
        const optionEmpId = text(option?.instructorEmpId);
        const candidateOpenDays = openDaysByEmp.get(optionEmpId);
        if (!candidateOpenDays?.size) continue;
        const optionDays = new Set((option.meetings || [])
          .map((meeting) => weekday(meeting.date))
          .filter((day) => Number.isInteger(day)));
        if (![...optionDays].some((day) => candidateOpenDays.has(day))) continue;

        const trialRows = new Map(rowsById);
        const trialRow = planRowFromOption(
          activity,
          option,
          evaluation.options || [],
          generated.startRange,
          generated.spec,
          {
            ...evaluation,
            dayConsolidation: true,
            scheduleOptions: scheduleOnlyOptions(preferredScenarios)
          }
        );
        trialRows.set(row.courseId, trialRow);

        const affectedEmpIds = new Set([empId, optionEmpId]);
        const beforeDays = [...affectedEmpIds]
          .reduce((sum, affectedEmpId) => sum + countInstructorWorkdays(currentRows, affectedEmpId), 0);
        const afterRows = [...trialRows.values()];
        const afterDays = [...affectedEmpIds]
          .reduce((sum, affectedEmpId) => sum + countInstructorWorkdays(afterRows, affectedEmpId), 0);
        const beforeTravelParts = [...affectedEmpIds].map((affectedEmpId) => instructorPlanTravelKm(currentRows, affectedEmpId));
        const afterTravelParts = [...affectedEmpIds].map((affectedEmpId) => instructorPlanTravelKm(afterRows, affectedEmpId));
        const beforeTravelKm = beforeTravelParts.every((value) => Number.isFinite(Number(value)))
          ? beforeTravelParts.reduce((sum, value) => sum + Number(value), 0)
          : null;
        const afterTravelKm = afterTravelParts.every((value) => Number.isFinite(Number(value)))
          ? afterTravelParts.reduce((sum, value) => sum + Number(value), 0)
          : null;
        const beforeSchoolDays = schoolWeekdayCount(currentRows, row.schoolId);
        const afterSchoolDays = schoolWeekdayCount(afterRows, row.schoolId);
        if (afterSchoolDays > beforeSchoolDays) continue;
        if (!dayConsolidationAcceptsMove({ beforeDays, afterDays, beforeTravelKm, afterTravelKm })) continue;
        if (
          optionEmpId === empId
          && text(option.startTime) === text(row.startTime)
          && text(option.startDate) === text(row.startDate)
        ) continue;

        const dayGain = beforeDays - afterDays;
        const travelGain = Number.isFinite(Number(beforeTravelKm)) && Number.isFinite(Number(afterTravelKm))
          ? Number(beforeTravelKm) - Number(afterTravelKm)
          : 0;
        const score = Number(option?.planningOptimization?.total) || 0;
        if (
          !best
          || dayGain > best.dayGain
          || (dayGain === best.dayGain && travelGain > best.travelGain)
          || (dayGain === best.dayGain && travelGain === best.travelGain && score > best.score)
        ) {
          best = { trialRow, dayGain, travelGain, score };
        }
      }
      if (!best) continue;

      rowsById.set(row.courseId, best.trialRow);
      moved += 1;
      movedThisPass += 1;
      await checkpoint();
    }

    if (!movedThisPass) break;
  }

  return { moved, passes };
}


function rowNeighborGapMinutes(row = {}, rows = []) {
  const empId = text(row?.instructorEmpId);
  const courseId = text(row?.courseId);
  if (!empId || !courseId || !Array.isArray(row?.meetings) || !row.meetings.length) return 0;

  const otherMeetingsByDate = new Map();
  for (const other of rows || []) {
    if (text(other?.courseId) === courseId || text(other?.instructorEmpId) !== empId) continue;
    for (const meeting of other?.meetings || []) {
      const date = text(meeting?.date).slice(0, 10);
      const start = timeMinutes(meeting?.start_time);
      const end = timeMinutes(meeting?.end_time);
      if (!date || start == null || end == null) continue;
      const bucket = otherMeetingsByDate.get(date) || [];
      bucket.push({ start, end });
      otherMeetingsByDate.set(date, bucket);
    }
  }

  let gapTotal = 0;
  let gapCount = 0;
  for (const meeting of row.meetings || []) {
    const date = text(meeting?.date).slice(0, 10);
    const start = timeMinutes(meeting?.start_time);
    const end = timeMinutes(meeting?.end_time);
    if (!date || start == null || end == null) continue;
    const others = (otherMeetingsByDate.get(date) || []).sort((a, b) => a.start - b.start);
    const previous = [...others].reverse().find((item) => item.end <= start) || null;
    const next = others.find((item) => item.start >= end) || null;
    if (previous) {
      gapTotal += Math.max(0, start - previous.end);
      gapCount += 1;
    }
    if (next) {
      gapTotal += Math.max(0, next.start - end);
      gapCount += 1;
    }
  }
  return gapCount ? Math.round((gapTotal / gapCount) * 10) / 10 : 0;
}

/**
 * After instructor/day assignment is stable, compact flexible course times
 * inside each already-selected weekday. Hard gates still own feasibility:
 * overlap, availability and travel+buffer are re-evaluated. This pass only
 * accepts a time move when it reduces the real clock gap to adjacent work and
 * does not open an extra workday.
 */
async function compactInstructorDayGapsPass({
  rowsById,
  targetCourseIds = null,
  targets = [],
  catalog = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  today = '',
  routeClient = null,
  currentContextActivities = [],
  checkpoint = async () => {},
  signal = null,
  limits = FAST_PLANNING_LIMITS,
  maxPasses = 3,
  report = async () => {}
} = {}) {
  const activityById = new Map((targets || []).map((activity) => [idOf(activity), activity]));
  const preparedForOptimization = optimizationContextFactory({ instructors, profiles, rules, exceptions, schoolCalendar, checkpoint });
  const targetIds = Array.isArray(targetCourseIds)
    ? new Set(targetCourseIds.map((value) => text(value)).filter(Boolean))
    : null;
  const passLimit = Math.max(0, Number(maxPasses) || 0);
  let moved = 0;

  for (let pass = 0; pass < passLimit; pass += 1) {
    let movedThisPass = 0;
    let processedThisPass = 0;
    const gapRows = [...rowsById.values()];
    const gapById = new Map();
    for (const candidate of gapRows) {
      gapById.set(text(candidate.courseId), rowNeighborGapMinutes(candidate, gapRows));
      await checkpoint();
    }
    const movable = gapRows
      .filter((row) =>
        text(row?.kind) === 'proposal'
        && (!targetIds || targetIds.has(text(row?.courseId)))
        && row?.schoolDateAnchored !== true
        && row?.planningLocked !== true
        && text(row?.instructorEmpId)
        && Array.isArray(row?.meetings)
        && row.meetings.length
      )
      .sort((a, b) => gapById.get(text(b.courseId)) - gapById.get(text(a.courseId)));

    for (const row of movable) {
      processedThisPass += 1;
      await report(`צמצום חלונות ביום · סבב ${pass + 1}`, processedThisPass, movable.length, row.courseId);
      const empId = text(row.instructorEmpId);
      const activity = activityById.get(text(row.courseId));
      if (!activity || planningActivityHasStarted(activity, today) || officialPlanningDates(activity).length) continue;

      const beforeGap = rowNeighborGapMinutes(row, [...rowsById.values()]);
      if (!(beforeGap > 0)) continue;

      const contextWithoutSelf = consolidationContextForCourse({
        rowsById,
        activityById,
        currentContextActivities,
        excludeCourseId: row.courseId
      });
      const oneInstructor = (instructors || []).filter((item) => text(item?.emp_id) === empId);
      if (!oneInstructor.length) continue;

      const activityPeriodKey = planningPeriodKeyForActivity(activity);
      const generated = await generatePlanningScenariosCooperatively({
        activity,
        catalog,
        instructors: oneInstructor,
        rules,
        profiles,
        activities: contextWithoutSelf,
        schoolCalendar,
        today,
        periodKey: activityPeriodKey,
        maxScenarios: Math.min(24, Math.max(18, Number(limits.maxScenarios) || 18)),
        routeClient
      }, checkpoint);
      if (!generated.spec.complete || !generated.scenarios?.length) continue;

      const sameSeries = generated.scenarios.filter((scenario) =>
        text(scenario.startDate) === text(row.startDate)
        && weekday(scenario.startDate) === weekday(row.startDate)
      );
      if (!sameSeries.length) continue;

      const freshPreparedContext = await preparedForOptimization(contextWithoutSelf, activityPeriodKey, oneInstructor);
      const freshTravelContext = createCandidateTravelContext(contextWithoutSelf);
      const evaluation = await evaluateScenarioOptions({
        activity,
        scenarios: sameSeries,
        startRange: generated.startRange,
        contextActivities: contextWithoutSelf,
        instructors: oneInstructor,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        today,
        routeClient,
        checkpoint,
        signal,
        periodKey: activityPeriodKey,
        preparedContext: freshPreparedContext,
        travelContext: freshTravelContext,
        limits: {
          ...limits,
          maxScenarios: sameSeries.length,
          maxCandidatesPerScenario: 1,
          maxRoutedPlanningPairs: 8,
          maxFinalOptions: 8,
          runGlobalRepair: false
        }
      });

      let best = null;
      for (const option of evaluation.options || []) {
        if (text(option.instructorEmpId) !== empId || text(option.startDate) !== text(row.startDate)) continue;
        const trialRows = new Map(rowsById);
        const trialRow = planRowFromOption(
          activity,
          option,
          evaluation.options || [],
          generated.startRange,
          generated.spec,
          {
            ...evaluation,
            timeCompaction: true,
            scheduleOptions: scheduleOnlyOptions(sameSeries)
          }
        );
        trialRows.set(row.courseId, trialRow);
        const afterGap = rowNeighborGapMinutes(trialRow, [...trialRows.values()]);
        const beforeDays = countInstructorWorkdays([...rowsById.values()], empId);
        const afterDays = countInstructorWorkdays([...trialRows.values()], empId);
        if (afterDays > beforeDays || !(afterGap + 0.1 < beforeGap)) continue;
        const score = Number(option.planningOptimization?.total) || 0;
        if (!best || afterGap < best.afterGap || (afterGap === best.afterGap && score > best.score)) {
          best = { option, trialRow, afterGap, score };
        }
      }

      if (!best) continue;
      rowsById.set(row.courseId, best.trialRow);
      moved += 1;
      movedThisPass += 1;
      await checkpoint();
    }

    if (!movedThisPass) break;
  }

  return { moved };
}


function planningBlockingAssignmentsByInstructor(activities = []) {
  const result = {};
  for (const activity of blockingActivities(activities)) {
    const empIds = [
      text(activity?.emp_id),
      text(activity?.emp_id_2),
      text(activity?.draft_emp_id)
    ].filter(Boolean);
    for (const empId of new Set(empIds)) {
      if (!result[empId]) result[empId] = [];
      result[empId].push(activity);
    }
  }
  return result;
}

function planningRowMeetingAssignments(row = {}, activityById = new Map()) {
  const activity = activityById.get(text(row?.courseId)) || {};
  const fullDayBlocking = row?.fullDayBlocking === true || isFullDaySchedulingActivity(activity);
  const generated = ['proposal', 'fixed-proposal', 'planning-locked'].includes(text(row?.kind));
  return (row?.meetings || []).map((meeting) => ({
    empId: meetingInstructorEmpId(meeting, row?.instructorEmpId),
    courseId: text(row?.courseId),
    kind: text(row?.kind),
    generated,
    date: text(meeting?.date).slice(0, 10),
    startTime: text(meeting?.start_time || row?.startTime).slice(0, 5),
    endTime: text(meeting?.end_time || row?.endTime).slice(0, 5),
    schoolId: text(row?.schoolId || activity?.school_id),
    school: text(row?.school || activity?.school),
    schoolAddress: text(activity?.school_address),
    fullDayBlocking
  })).filter((meeting) =>
    meeting.empId && /^\d{4}-\d{2}-\d{2}$/.test(meeting.date)
    && validTimeRange(meeting.startTime, meeting.endTime)
  );
}

/**
 * Final whole-plan guard after all packing/consolidation passes.
 * Individual options are rechecked against live availability; then the complete
 * planned schedule is checked for plan-to-plan overlap, tour-day exclusivity,
 * and any known travel+buffer violation introduced by optimization.
 */
function* validatePlanningPlanCoherenceSteps({
  rows = [],
  activities = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  routeClient = null
} = {}) {
  const failures = [];
  const warnings = [];
  const activityById = new Map((activities || []).map((activity) => [idOf(activity), activity]));
  const liveAssignments = planningBlockingAssignmentsByInstructor(activities);

  for (const row of rows || []) {
    yield;
    if (!['proposal', 'fixed-proposal', 'planning-locked'].includes(text(row?.kind))) continue;
    if (!text(row?.instructorEmpId) || !(row?.meetings || []).length) continue;
    const activity = activityById.get(text(row?.courseId)) || {};
    const option = {
      instructorEmpId: row.instructorEmpId,
      instructorName: row.instructorName,
      meetings: row.meetings,
      startDate: row.startDate,
      endDate: row.endDate,
      startTime: row.startTime,
      endTime: row.endTime
    };
    const result = planningOptionPassesFinalValidation(option, {
      activity,
      instructors,
      profiles,
      rules,
      exceptions,
      assignments: liveAssignments,
      schoolCalendar
    });
    for (const failure of result.failures || []) {
      failures.push({
        ...failure,
        courseId: text(row.courseId),
        reason: failure.reason || 'hard_gate'
      });
    }
  }

  const byInstructorDate = new Map();
  for (const row of rows || []) {
    yield;
    for (const meeting of planningRowMeetingAssignments(row, activityById)) {
      const key = `${meeting.empId}|${meeting.date}`;
      const bucket = byInstructorDate.get(key) || [];
      bucket.push(meeting);
      byInstructorDate.set(key, bucket);
    }
  }

  for (const [key, dayMeetings] of byInstructorDate.entries()) {
    yield;
    const [empId, date] = key.split('|');
    const sorted = [...dayMeetings].sort((a, b) =>
      (timeMinutes(a.startTime) ?? 9999) - (timeMinutes(b.startTime) ?? 9999)
      || (timeMinutes(a.endTime) ?? 9999) - (timeMinutes(b.endTime) ?? 9999)
    );
    for (let index = 0; index < sorted.length; index += 1) {
      const first = sorted[index];
      for (let otherIndex = index + 1; otherIndex < sorted.length; otherIndex += 1) {
        yield;
        const second = sorted[otherIndex];
        if (first.courseId === second.courseId) continue;
        if (!first.generated && !second.generated) continue;

        if (first.fullDayBlocking || second.fullDayBlocking) {
          failures.push({
            reason: 'full_day_tour_conflict',
            empId,
            date,
            firstCourseId: first.courseId,
            secondCourseId: second.courseId
          });
          continue;
        }

        const firstStart = timeMinutes(first.startTime);
        const firstEnd = timeMinutes(first.endTime);
        const secondStart = timeMinutes(second.startTime);
        const secondEnd = timeMinutes(second.endTime);
        if ([firstStart, firstEnd, secondStart, secondEnd].some((value) => value == null)) continue;
        if (firstStart < secondEnd && secondStart < firstEnd) {
          failures.push({
            reason: 'overlap',
            empId,
            date,
            firstCourseId: first.courseId,
            secondCourseId: second.courseId
          });
        }
      }
    }

    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const next = sorted[index];
      if (previous.courseId === next.courseId || (!previous.generated && !next.generated)) continue;
      if (previous.schoolId && previous.schoolId === next.schoolId) continue;
      const previousEnd = timeMinutes(previous.endTime);
      const nextStart = timeMinutes(next.startTime);
      if (previousEnd == null || nextStart == null || nextStart < previousEnd) continue;
      if (!previous.schoolAddress || !next.schoolAddress || !routeClient?.peek) {
        warnings.push({ reason: 'travel_unverified', empId, date, firstCourseId: previous.courseId, secondCourseId: next.courseId });
        continue;
      }
      const route = routeClient.peek(previous.schoolAddress, next.schoolAddress);
      const km = Number(route?.distance_km);
      const travelMinutes = Number(route?.duration_minutes);
      if (!Number.isFinite(km) || !Number.isFinite(travelMinutes)) {
        warnings.push({ reason: 'travel_unverified', empId, date, firstCourseId: previous.courseId, secondCourseId: next.courseId });
        continue;
      }
      const availableGap = nextStart - previousEnd;
      if (transitionDistanceCapApplies(availableGap) && exceedsTransitionDistanceLimit(km)) {
        failures.push({ reason: 'transition_distance_exceeded', empId, date, firstCourseId: previous.courseId, secondCourseId: next.courseId, distanceKm: km, availableMinutes: availableGap });
        continue;
      }
      const requiredGap = travelMinutes + transitionBufferMinutes(km);
      if (availableGap < requiredGap) {
        failures.push({
          reason: 'transition_insufficient',
          empId,
          date,
          firstCourseId: previous.courseId,
          secondCourseId: next.courseId,
          requiredMinutes: requiredGap,
          availableMinutes: availableGap
        });
      }
    }
  }

  const dedupe = (items) => [...new Map(items.map((item) => [JSON.stringify(item), item])).values()];
  const uniqueFailures = dedupe(failures);
  return {
    valid: uniqueFailures.length === 0,
    failures: uniqueFailures,
    warnings: dedupe(warnings)
  };
}


export function validatePlanningPlanCoherence(input = {}) {
  const steps = validatePlanningPlanCoherenceSteps(input);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export async function validatePlanningPlanCoherenceCooperatively(input = {}, checkpoint = async () => {}) {
  const steps = validatePlanningPlanCoherenceSteps(input);
  let next = steps.next();
  while (!next.done) { await checkpoint(); next = steps.next(); }
  return next.value;
}

export function finalValidationRepairCourseIds(failures = [], rows = [], maxIds = 24) {
  const direct = new Set();
  const instructorDates = new Set();
  for (const failure of failures || []) {
    for (const value of [failure?.courseId, failure?.firstCourseId, failure?.secondCourseId]) {
      const id = text(value);
      if (id) direct.add(id);
    }
    const empId = text(failure?.empId);
    const date = text(failure?.date).slice(0, 10);
    if (empId && /^\d{4}-\d{2}-\d{2}$/.test(date)) instructorDates.add(`${empId}|${date}`);
  }
  if (!direct.size) return [];

  const rowById = new Map((rows || []).map((row) => [text(row?.courseId), row]));
  const schoolIds = new Set(
    [...direct]
      .map((id) => text(rowById.get(id)?.schoolId))
      .filter(Boolean)
  );
  const expanded = new Set(direct);

  for (const row of rows || []) {
    const courseId = text(row?.courseId);
    if (!courseId) continue;
    if (schoolIds.has(text(row?.schoolId)) && ['proposal', 'fixed-proposal', 'planning-locked', 'recruitment', 'missing'].includes(text(row?.kind))) {
      expanded.add(courseId);
    }
    for (const meeting of row?.meetings || []) {
      const empId = meetingInstructorEmpId(meeting, row?.instructorEmpId);
      const date = text(meeting?.date).slice(0, 10);
      if (empId && instructorDates.has(`${empId}|${date}`)) {
        expanded.add(courseId);
        break;
      }
    }
  }

  return [...expanded].slice(0, Math.max(1, Number(maxIds) || 24));
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
  optimizationOnlyCourseIds = null,
  upgradeOptimizationScopes = null,
  onProgress = null,
  signal = null,
  checkpoint = createPlanningCheckpoint({ signal }),
  resumeFromCheckpoint = false,
  allowGlobalRepair = null,
  _repairPass = false,
  _repairPriorityIds = [],
  _finalValidationRepairPass = 0,
  planningProfile = 'deep'
} = {}) {
  const limits = planningLimits(planningProfile);
  const report = async (phase, completed = 0, total = 0, courseId = '', row = null, snapshotRows = null) => {
    planningPerfCount('progressUiUpdates');
    if (typeof onProgress === 'function') {
      await onProgress({ phase, completed, total, courseId, row, snapshotRows });
    }
    await checkpoint();
  };
  await report('הכנת נתונים');
  const targets = planningWorkspaceCourses(activities, district, periodKey);
  const schoolActivityCount = new Map();
  for (const activity of targets) {
    await checkpoint();
    const schoolId = text(activity?.school_id);
    if (!schoolId) continue;
    schoolActivityCount.set(schoolId, (schoolActivityCount.get(schoolId) || 0) + 1);
  }
  const schoolPackingCoverageCourseIds = new Set(
    targets
      .filter((activity) => text(activity?.school_id) && (schoolActivityCount.get(text(activity.school_id)) || 0) >= 2)
      .map((activity) => idOf(activity))
  );
  // Approved assignments are hard constraints. Existing drafts are deliberately
  // removed from the blocking calendar here: the national planner may move or
  // replace them before it concludes that new staff are needed.
  const contextActivities = planningContextActivities(activities);
  const currentContextActivities = [...contextActivities];
  const virtualPlans = new Map();
  const preparedRunContexts = new Map();
  const independentSchoolContexts = new Map();
  const travelContext = createCandidateTravelContext(currentContextActivities);
  const preparedContextFor = async (requestedPeriodKey = periodKey) => {
    const key = text(requestedPeriodKey) || DEFAULT_PLANNING_PERIOD_KEY;
    if (!preparedRunContexts.has(key)) {
      preparedRunContexts.set(key, await prepareSchedulingRunContextCooperatively({
        activities: currentContextActivities,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        periodKey: key
      }, checkpoint));
    }
    return preparedRunContexts.get(key);
  };
  const rememberVirtualPlan = async (virtual) => {
    if (!virtual) return;
    const virtualId = idOf(virtual);
    if (!virtualId || virtualPlans.has(virtualId)) return;
    virtualPlans.set(virtualId, virtual);
    currentContextActivities.push(virtual);
    appendCandidateTravelActivity(travelContext, virtual);
    for (const prepared of preparedRunContexts.values()) await appendSchedulingRunActivityCooperatively(prepared, virtual, checkpoint);
    for (const schoolContext of independentSchoolContexts.values()) {
      if (schoolContext.schoolId === text(virtual.school_id)) continue;
      schoolContext.activities.push(virtual);
      await appendSchedulingRunActivityCooperatively(schoolContext.prepared, virtual, checkpoint);
      appendCandidateTravelActivity(schoolContext.travel, virtual);
    }
  };
  const rowsById = new Map();
  const existingById = new Map((existingRows || [])
    .map((row) => [text(row?.courseId) || idOf(row), row])
    .filter(([courseId]) => !!courseId));
  const recruitmentRescueById = new Map();
  const deferredFullMaintenanceRescues = [];
  const incrementalIds = Array.isArray(targetCourseIds)
    ? new Set(targetCourseIds.map((value) => text(value)).filter(Boolean))
    : null;
  const optimizationOnlyIds = Array.isArray(optimizationOnlyCourseIds)
    ? new Set(optimizationOnlyCourseIds.map((value) => text(value)).filter(Boolean))
    : null;
  const upgradeSchoolPackingIds = upgradeOptimizationScopes
    ? new Set((upgradeOptimizationScopes.schoolPackingCourseIds || []).map(text).filter(Boolean))
    : null;
  const upgradeRecruitmentRecoveryIds = upgradeOptimizationScopes
    ? new Set((upgradeOptimizationScopes.recruitmentRecoveryCourseIds || []).map(text).filter(Boolean))
    : null;
  const upgradeWorkdayConsolidationIds = upgradeOptimizationScopes
    ? new Set((upgradeOptimizationScopes.workdayConsolidationCourseIds || []).map(text).filter(Boolean))
    : null;
  const withIncrementalIds = (upgradeIds) => incrementalIds === null
    ? null
    : new Set([...incrementalIds, ...(upgradeIds || [])]);
  const schoolPackingTargetIds = withIncrementalIds(upgradeSchoolPackingIds);
  const workdayConsolidationTargetIds = withIncrementalIds(upgradeWorkdayConsolidationIds);
  // Gap compaction predates v28 and is already reflected in a valid v27
  // snapshot. Re-running it for every row touched only by the v28 migration
  // turns a snapshot upgrade into another multi-pass planning run. Keep this
  // pass strictly scoped to genuine source/context dirty rows; v28's own
  // school packing and workday passes already validate the options they move.
  const gapCompactionTargetIds = incrementalIds === null
    ? null
    : new Set(incrementalIds);
  // A national rebuild is exceptional and already finishes with the same hard
  // whole-plan validation as an incremental run. Keep the first full result
  // fast: use the normal fast scenario breadth and defer expensive soft gap
  // polishing. Hard whole-plan validation still runs before anything is saved.
  // Day-to-day incremental runs retain the richer soft-optimization passes.
  const fastFullMaintenance = allowGlobalRepair === true
    && text(planningProfile).toLowerCase() === 'fast';
  const fixedUnassigned = [];
  const missingSchedule = [];

  for (const activity of targets) {
    await checkpoint();
    const activityId = idOf(activity);
    const activityPeriodKey = planningPeriodKeyForActivity(activity, periodKey);
    if (text(activity.emp_id)) {
      rowsById.set(activityId, liveRow(activity, activityPeriodKey, { rules, exceptions, schoolCalendar }));
      continue;
    }

    const locked = normalizePlanningLockedOption(lockedOptions?.[activityId], activityPeriodKey);
    if (locked) {
      const lockedRow = lockedPlanningRow(activity, locked, catalog, activityPeriodKey);
      if (lockedRow) rowsById.set(activityId, lockedRow);
      const virtual = blockingVirtualActivity(activity, locked);
      await rememberVirtualPlan(virtual);
      continue;
    }

    const existing = existingById.get(activityId);
    if (optimizationOnlyIds?.has(activityId) && existing && text(existing?.kind) === 'proposal') {
      const reused = { ...existing, schoolId: text(existing.schoolId || activity.school_id), planningLocked: false };
      rowsById.set(activityId, reused);
      const virtual = blockingVirtualActivity(activity, planningRowAsVirtualOption(reused));
      await rememberVirtualPlan(virtual);
      continue;
    }
    const upgradeRecruitmentTarget = upgradeRecruitmentRecoveryIds?.has(activityId) === true;
    if ((incrementalIds?.has(activityId) || upgradeRecruitmentTarget) && text(existing?.kind) === 'recruitment') {
      const rescue = await recruitmentRescueProbeCooperatively({
        row: existing,
        activity,
        instructors,
        profiles,
        rules,
        exceptions,
        routeClient,
        existingRows
      }, checkpoint);
      if (!rescue.possible) {
        rowsById.set(activityId, {
          ...existing,
          schoolId: text(existing.schoolId || activity.school_id),
          planningLocked: false,
          diagnostics: {
            ...(existing?.diagnostics || {}),
            fastRescueSkipped: true,
            fastRescueReason: 'no_existing_staff_candidate'
          }
        });
        continue;
      }
      recruitmentRescueById.set(activityId, rescue);
    }

    const upgradeRecruitmentRescue = upgradeRecruitmentTarget && recruitmentRescueById.has(activityId);
    if (incrementalIds && !incrementalIds.has(activityId) && !upgradeRecruitmentRescue) {
      const existing = existingById.get(activityId);
      if (existing) {
        const reused = { ...existing, schoolId: text(existing.schoolId || activity.school_id), planningLocked: false };
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
          await rememberVirtualPlan(virtual);
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

  const difficultyContext = { catalog, instructors, profiles, rules, difficultyById: new Map() };
  for (const activity of missingSchedule) {
    difficultyContext.difficultyById.set(idOf(activity), planningActivityDifficulty({ activity, catalog, instructors, profiles, rules }));
    await checkpoint();
  }
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
    if (!incrementalIds || incrementalIds.has(idOf(activity))) planningPerfCount('activitiesComputed');
    else planningPerfCount('upgradeActivitiesComputed');
    const currentContext = currentContextActivities;
    const activitySchoolId = text(activity?.school_id);
    const useIndependentSchoolCandidatePool = type !== 'fixed'
      && !!activitySchoolId
      && (schoolActivityCount.get(activitySchoolId) || 0) >= 2;
    const basePreparedContext = await preparedContextFor(activityPeriodKey);
    const schoolContextKey = `${activityPeriodKey}|${activitySchoolId}`;
    if (useIndependentSchoolCandidatePool && !independentSchoolContexts.has(schoolContextKey)) {
      const exclude = contextActivity => text(idOf(contextActivity)).startsWith('planning-block:')
        && text(contextActivity?.school_id) === activitySchoolId;
      const prepared = await forkSchedulingRunContextCooperatively(basePreparedContext, exclude, schoolContextKey, checkpoint);
      independentSchoolContexts.set(schoolContextKey, {
        schoolId: activitySchoolId,
        activities: prepared.activities,
        prepared,
        travel: createCandidateTravelContext(prepared.activities)
      });
      await checkpoint();
    }
    const schoolContext = useIndependentSchoolCandidatePool ? independentSchoolContexts.get(schoolContextKey) : null;
    const candidateContext = schoolContext?.activities || currentContext;
    const candidatePreparedContext = schoolContext?.prepared || basePreparedContext;
    const candidateTravelContext = schoolContext?.travel || travelContext;
    const schoolFirstScenarioLimit = useIndependentSchoolCandidatePool
      ? (fastFullMaintenance ? 12 : Math.max(Number(limits.maxScenarios) || 0, 24))
      : limits.maxScenarios;
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
        periodKey: activityPeriodKey,
        preparedContext: await preparedContextFor(activityPeriodKey),
        travelContext,
        limits
      });
      const options = evaluation.options || [];
      const chosen = options[0] || null;
      const recruitmentNeeded = !chosen && evaluation.recruitmentNeeded === true;
      const fixedLive = liveRow(activity, activityPeriodKey, { rules, exceptions, schoolCalendar });
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
          routeVerified: evaluation.routeVerified === true,
          routeEvaluationVersion: 2
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
      await rememberVirtualPlan(virtual);
    } else {
      const rescue = recruitmentRescueById.get(idOf(activity));
      if (rescue) {
        await report('בדיקת הצלה מהירה מגיוס', completed, queue.length, idOf(activity));
        const rescueIds = new Set(rescue.candidateEmpIds);
        const rescueInstructors = (instructors || []).filter((instructor) => rescueIds.has(text(instructor?.emp_id)));
        const rescueStartDates = rescue.schedules.map((scenario) => text(scenario.startDate)).filter(Boolean).sort();
        const rescueRange = rescueStartDates.length
          ? { min: rescueStartDates[0], max: rescueStartDates.at(-1) }
          : null;
        const rescueEvaluation = await evaluateScenarioOptions({
          activity,
          scenarios: rescue.schedules,
          startRange: rescueRange,
          contextActivities: candidateContext,
          instructors: rescueInstructors,
          profiles,
          rules,
          exceptions,
          schoolCalendar,
          today,
          routeClient,
          checkpoint,
          signal,
          periodKey: activityPeriodKey,
          preparedContext: candidatePreparedContext,
          travelContext: candidateTravelContext,
          limits: {
            ...FAST_PLANNING_LIMITS,
            maxScenarios: Math.max(1, rescue.schedules.length),
            maxCandidatesPerScenario: Math.max(1, Math.min(6, rescueInstructors.length)),
            maxRoutedPlanningPairs: 3,
            maxFinalOptions: 1,
            runGlobalRepair: false
          }
        });
        const rescueOptions = rescueEvaluation.options || [];
        const rescued = rescueOptions[0] || null;
        if (rescued) {
          const spec = inferPlanningCourseSpec(activity, catalog);
          rowsById.set(idOf(activity), planRowFromOption(
            activity,
            rescued,
            rescueOptions,
            rescueRange,
            spec,
            {
              ...rescueEvaluation,
              fastRecruitmentRescue: true,
              rescueCandidateCount: rescue.candidateEmpIds.length,
              scheduleOptions: rescue.schedules
            }
          ));
          const virtual = blockingVirtualActivity(activity, rescued);
          await rememberVirtualPlan(virtual);
        } else {
          const existing = existingById.get(idOf(activity));
          rowsById.set(idOf(activity), {
            ...existing,
            schoolId: text(existing.schoolId || activity.school_id),
            planningLocked: false,
            diagnostics: {
              ...(existing?.diagnostics || {}),
              fastRecruitmentRescue: true,
              rescueCandidateCount: rescue.candidateEmpIds.length,
              rescueScheduleCount: rescue.schedules.length,
              rescueRouteVerified: rescueEvaluation.routeVerified === true
            }
          });
        }
      } else {
      const generated = await generatePlanningScenariosCooperatively({
        activity,
        catalog,
        instructors,
        rules,
        profiles,
        activities: candidateContext,
        schoolCalendar,
        today,
        periodKey: activityPeriodKey,
        maxScenarios: schoolFirstScenarioLimit,
        routeClient
      }, checkpoint);
      if (!generated.spec.complete) {
        rowsById.set(idOf(activity), missingOverviewRow(activity, catalog));
      } else {
        const evaluationInstructors = staticPlanningCandidateInstructors(activity, instructors, profiles, routeClient);
        let evaluation = await evaluateScenarioOptions({
          activity,
          scenarios: generated.scenarios,
          startRange: generated.startRange,
          contextActivities: candidateContext,
          instructors: evaluationInstructors,
          profiles,
          rules,
          exceptions,
          schoolCalendar,
          today,
          routeClient,
          checkpoint,
          signal,
          periodKey: activityPeriodKey,
          preparedContext: candidatePreparedContext,
          travelContext: candidateTravelContext,
          limits,
          packingCoverage: schoolPackingCoverageCourseIds.has(idOf(activity))
        });
        let effectiveGenerated = generated;

        // Recruitment is a last resort. On full maintenance, do not run an
        // expensive deep search inside every activity. Defer those searches to
        // one bounded tail pass after the fast base plan is complete.
        if (
          text(planningProfile).toLowerCase() === 'fast'
          && !(evaluation.options || []).length
          && evaluation.recruitmentNeeded === true
          && evaluationInstructors.length > 0
        ) {
          if (fastFullMaintenance) {
            deferredFullMaintenanceRescues.push({
              activity,
              activityPeriodKey,
              fastEvaluation: evaluation,
              candidateCount: evaluationInstructors.length
            });
            evaluation = {
              ...evaluation,
              recruitmentNeeded: false,
              searchIncomplete: true,
              rescueDeferred: true
            };
            planningPerfCount('rescueDeferred');
          } else {
            await report('מיצוי צוות קיים לפני גיוס', completed, queue.length, idOf(activity));
            const rescueCheckpoint = createPlanningDeadlineCheckpoint({ checkpoint });
            let rescueBudgetExceeded = false;
            try {
              const deepGenerated = await generatePlanningScenariosCooperatively({
                activity,
                catalog,
                instructors: evaluationInstructors,
                rules,
                profiles,
                activities: candidateContext,
                schoolCalendar,
                today,
                periodKey: activityPeriodKey,
                maxScenarios: DEEP_PLANNING_LIMITS.maxScenarios,
                routeClient
              }, rescueCheckpoint);
              if (deepGenerated.spec.complete) {
                const deepEvaluation = await evaluateScenarioOptions({
                  activity,
                  scenarios: deepGenerated.scenarios,
                  startRange: deepGenerated.startRange,
                  contextActivities: candidateContext,
                  instructors: evaluationInstructors,
                  profiles,
                  rules,
                  exceptions,
                  schoolCalendar,
                  today,
                  routeClient,
                  checkpoint: rescueCheckpoint,
                  signal,
                  periodKey: activityPeriodKey,
                  preparedContext: candidatePreparedContext,
                  travelContext: candidateTravelContext,
                  limits: DEEP_PLANNING_LIMITS,
                  packingCoverage: schoolPackingCoverageCourseIds.has(idOf(activity))
                });
                evaluation = {
                  ...deepEvaluation,
                  recruitmentNeeded: false,
                  searchIncomplete: !(deepEvaluation.options || []).length,
                  rescuePass: true,
                  fastPreliminaryCount: Number(evaluation.preliminaryCount) || 0,
                  fastRoutedAttemptCount: Number(evaluation.routedAttemptCount) || 0
                };
                effectiveGenerated = deepGenerated;
              }
            } catch (error) {
              if (error?.code !== 'planning_rescue_budget_exceeded') throw error;
              rescueBudgetExceeded = true;
              planningPerfCount('rescueBudgetExceeded');
            }
            if (rescueBudgetExceeded) {
              evaluation = {
                ...evaluation,
                recruitmentNeeded: false,
                searchIncomplete: true,
                rescuePass: true,
                rescueBudgetExceeded: true,
                fastPreliminaryCount: Number(evaluation.preliminaryCount) || 0,
                fastRoutedAttemptCount: Number(evaluation.routedAttemptCount) || 0
              };
            }
          }
        }

        const options = evaluation.options || [];
        const chosen = options[0] || null;
        rowsById.set(idOf(activity), planRowFromOption(
          activity,
          chosen,
          options,
          effectiveGenerated.startRange,
          effectiveGenerated.spec,
          {
            ...evaluation,
            scheduleOptions: scheduleOnlyOptions(effectiveGenerated.scenarios)
          }
        ));
        const virtual = blockingVirtualActivity(activity, chosen);
        await rememberVirtualPlan(virtual);
      }
      }
    }

    completed += 1;
    await report('בניית תוכנית', completed, queue.length, idOf(activity), rowsById.get(idOf(activity)) || null);
  }

  if (fastFullMaintenance && deferredFullMaintenanceRescues.length) {
    let remainingRescueBudgetMs = FAST_FULL_RESCUE_TOTAL_BUDGET_MS;
    const rescueQueue = [...deferredFullMaintenanceRescues]
      .sort((first, second) => first.candidateCount - second.candidateCount || idOf(first.activity).localeCompare(idOf(second.activity)));
    for (const rescueItem of rescueQueue) {
      const activity = rescueItem.activity;
      const activityId = idOf(activity);
      if (remainingRescueBudgetMs <= 0) {
        const current = rowsById.get(activityId);
        rowsById.set(activityId, {
          ...current,
          status: 'בדיקת התאמה נמשכת',
          reason: 'קיימים מועמדים בצוות, אך בדיקת ההתאמה המלאה טרם הסתיימה — הפעילות אינה מסומנת לגיוס',
          diagnostics: {
            ...(current?.diagnostics || {}),
            searchIncomplete: true,
            recruitmentCertified: false,
            rescuePass: true,
            rescueBudgetExceeded: true,
            rescueDeferred: true
          }
        });
        planningPerfCount('rescueBudgetExceeded');
        continue;
      }

      const rescueStarted = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
      const rescueCheckpoint = createPlanningDeadlineCheckpoint({
        checkpoint,
        budgetMs: Math.min(FAST_FULL_RESCUE_ACTIVITY_BUDGET_MS, remainingRescueBudgetMs)
      });
      let rescueBudgetExceeded = false;
      try {
        await report('מיצוי צוות קיים לפני גיוס', completed, queue.length, activityId);
        const rescueInstructors = staticPlanningCandidateInstructors(activity, instructors, profiles, routeClient);
        if (rescueInstructors.length) {
          const activitySchoolId = text(activity?.school_id);
          const schoolContextKey = `${rescueItem.activityPeriodKey}|${activitySchoolId}`;
          const schoolContext = activitySchoolId ? independentSchoolContexts.get(schoolContextKey) : null;
          const candidateContext = schoolContext?.activities || currentContextActivities;
          const candidatePreparedContext = schoolContext?.prepared || await preparedContextFor(rescueItem.activityPeriodKey);
          const candidateTravelContext = schoolContext?.travel || travelContext;
          const deepGenerated = await generatePlanningScenariosCooperatively({
            activity,
            catalog,
            instructors: rescueInstructors,
            rules,
            profiles,
            activities: candidateContext,
            schoolCalendar,
            today,
            periodKey: rescueItem.activityPeriodKey,
            maxScenarios: FAST_FULL_RESCUE_MAX_SCENARIOS,
            routeClient
          }, rescueCheckpoint);
          if (deepGenerated.spec.complete) {
            const deepEvaluation = await evaluateScenarioOptions({
              activity,
              scenarios: deepGenerated.scenarios,
              startRange: deepGenerated.startRange,
              contextActivities: candidateContext,
              instructors: rescueInstructors,
              profiles,
              rules,
              exceptions,
              schoolCalendar,
              today,
              routeClient,
              checkpoint: rescueCheckpoint,
              signal,
              periodKey: rescueItem.activityPeriodKey,
              preparedContext: candidatePreparedContext,
              travelContext: candidateTravelContext,
              limits: { ...DEEP_PLANNING_LIMITS, maxScenarios: FAST_FULL_RESCUE_MAX_SCENARIOS },
              packingCoverage: schoolPackingCoverageCourseIds.has(activityId)
            });
            const options = deepEvaluation.options || [];
            const chosen = options[0] || null;
            if (chosen) {
              const rescuedRow = planRowFromOption(
                activity,
                chosen,
                options,
                deepGenerated.startRange,
                deepGenerated.spec,
                {
                  ...deepEvaluation,
                  rescuePass: true,
                  rescueDeferred: true,
                  fastPreliminaryCount: Number(rescueItem.fastEvaluation?.preliminaryCount) || 0,
                  fastRoutedAttemptCount: Number(rescueItem.fastEvaluation?.routedAttemptCount) || 0,
                  scheduleOptions: scheduleOnlyOptions(deepGenerated.scenarios)
                }
              );
              rowsById.set(activityId, rescuedRow);
              await rememberVirtualPlan(blockingVirtualActivity(activity, chosen));
              planningPerfCount('rescueRecovered');
              await report('מיצוי צוות קיים לפני גיוס', completed, queue.length, activityId, rescuedRow);
            } else {
              const current = rowsById.get(activityId);
              rowsById.set(activityId, {
                ...current,
                kind: 'missing',
                status: 'בדיקת התאמה נמשכת',
                reason: 'הסריקה המורחבת לא מצאה שיבוץ מאומת, אך קיימים מועמדים בצוות — לא מסומן לגיוס',
                diagnostics: {
                  ...(current?.diagnostics || {}),
                  searchIncomplete: true,
                  recruitmentCertified: false,
                  rescuePass: true,
                  rescueDeferred: true
                }
              });
            }
          }
        }
        planningPerfCount('rescueProcessed');
      } catch (error) {
        if (error?.code !== 'planning_rescue_budget_exceeded') throw error;
        rescueBudgetExceeded = true;
        planningPerfCount('rescueBudgetExceeded');
      } finally {
        const rescueEnded = typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
        remainingRescueBudgetMs = Math.max(0, remainingRescueBudgetMs - Math.max(0, rescueEnded - rescueStarted));
      }
      if (rescueBudgetExceeded) {
        const current = rowsById.get(activityId);
        rowsById.set(activityId, {
          ...current,
          kind: 'missing',
          status: 'בדיקת התאמה נמשכת',
          reason: 'קיימים מועמדים בצוות, אך בדיקת ההתאמה המלאה טרם הסתיימה — הפעילות אינה מסומנת לגיוס',
          diagnostics: {
            ...(current?.diagnostics || {}),
            searchIncomplete: true,
            recruitmentCertified: false,
            rescuePass: true,
            rescueBudgetExceeded: true,
            rescueDeferred: true
          }
        });
      }
    }
  }

  if (!_repairPass) {
    if (!optimizationOnlyIds || upgradeOptimizationScopes) {
      await optimizeSchoolDayPackingPassCooperatively({
        rowsById,
        activities: targets,
        targetCourseIds: schoolPackingTargetIds ? [...schoolPackingTargetIds] : null,
        beamWidth: 96,
        routeClient,
        checkpoint
      });
      await report('אריזת בתי ספר הושלמה', rowsById.size, rowsById.size, '', null, [...rowsById.values()]);
    }
    if (!optimizationOnlyIds || upgradeOptimizationScopes) await consolidateInstructorWorkdaysPass({
      rowsById,
      targetCourseIds: workdayConsolidationTargetIds ? [...workdayConsolidationTargetIds] : null,
      targets,
      catalog,
      instructors,
      profiles,
      rules,
      exceptions,
      schoolCalendar,
      today,
      routeClient,
      preparedContextFor,
      travelContext,
      currentContextActivities,
      checkpoint,
      signal,
      limits: {
        ...FAST_PLANNING_LIMITS,
        maxFinalOptions: 2,
        runGlobalRepair: false
      },
      report
    });
    if (!optimizationOnlyIds || upgradeOptimizationScopes) {
      await report('ריכוז ימי עבודה הושלם', rowsById.size, rowsById.size, '', null, [...rowsById.values()]);
    }
    if (gapCompactionTargetIds === null || gapCompactionTargetIds.size > 0) {
      await compactInstructorDayGapsPass({
        rowsById,
        targetCourseIds: gapCompactionTargetIds ? [...gapCompactionTargetIds] : null,
        targets,
        catalog,
        instructors,
        profiles,
        rules,
        exceptions,
        schoolCalendar,
        today,
        routeClient,
        currentContextActivities,
        checkpoint,
        signal,
        limits: {
          ...FAST_PLANNING_LIMITS,
          maxFinalOptions: 8,
          runGlobalRepair: false
        },
        maxPasses: fastFullMaintenance ? 0 : 3,
        report
      });
      await report('צמצום חלונות הושלם', rowsById.size, rowsById.size, '', null, [...rowsById.values()]);
    }
    refreshSchoolPlanningDiagnostics(rowsById, targets);
    await report('בקרת תקינות סופית', rowsById.size, rowsById.size, '', null, [...rowsById.values()]);
  }

  const rows = await assignRecruitmentProfilesCooperatively(
    targets.map((activity) => rowsById.get(idOf(activity)) || missingOverviewRow(activity, catalog)), checkpoint
  );
  const finalPlanValidation = await validatePlanningPlanCoherenceCooperatively({
    rows,
    activities: targets,
    instructors,
    profiles,
    rules,
    exceptions,
    schoolCalendar,
    routeClient
  }, checkpoint);
  if (!finalPlanValidation.valid) {
    const repairIds = finalValidationRepairCourseIds(finalPlanValidation.failures, rows);
    if (_finalValidationRepairPass < 2 && repairIds.length) {
      await report('תיקון מקומי לאחר בקרת תקינות', 0, repairIds.length);
      return buildDynamicCoursePlan({
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
        existingRows: rows,
        targetCourseIds: repairIds,
        optimizationOnlyCourseIds: null,
        upgradeOptimizationScopes: null,
        onProgress: typeof onProgress === 'function'
          ? (progress) => onProgress({ ...progress, phase: `תיקון מקומי · ${progress.phase}` })
          : null,
        signal,
        checkpoint,
        resumeFromCheckpoint: false,
        allowGlobalRepair: false,
        _repairPass: false,
        _repairPriorityIds: repairIds,
        _finalValidationRepairPass: _finalValidationRepairPass + 1,
        planningProfile: 'fast'
      });
    }
    const error = new Error('planning_final_validation_failed');
    error.code = 'planning_final_validation_failed';
    error.failures = finalPlanValidation.failures;
    error.rows = rows;
    error.repairCourseIds = repairIds;
    throw error;
  }
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

  const initialResult = summarize(rows, {
    repairApplied: _repairPass,
    finalPlanValidation
  });
  // Checkpointing changes progress, not scope. A resumed targeted run must not
  // turn into a national pass; a resumed full run may still repair coverage.
  if (_repairPass || !(allowGlobalRepair ?? !incrementalIds)) return initialResult;

  if (!limits.runGlobalRepair) return {
    ...initialResult,
    globalOptimization: {
      applied: false,
      before: planningGlobalObjective(rows),
      after: planningGlobalObjective(rows),
      gain: 0
    }
  };

  const repairPriorityIds = planningGlobalRepairPriorityIds(rows);
  const hasCriticalRepairNeed = rows.some((row) =>
    ['recruitment', 'missing', 'fixed'].includes(text(row?.kind))
  );
  // A second full national pass is expensive. Run it automatically only when
  // it can improve coverage or avoid unnecessary recruitment. Pure efficiency
  // tuning (travel/day packing/score) stays in the first-pass result instead of
  // making every full plan run almost twice.
  if (!repairPriorityIds.length || !hasCriticalRepairNeed) return {
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
    resumeFromCheckpoint: false,
    _repairPass: true,
    _repairPriorityIds: repairPriorityIds,
    planningProfile
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
    const schedule = planningActivityScheduleFields(row);
    const activity = {
      courseId: text(row?.courseId),
      courseName: text(row?.courseName) || 'פעילות',
      activityType,
      school: text(row?.school),
      authority: text(row?.authority),
      status: planningCompletionStatus(row),
      kind: text(row?.kind),
      startDate: dates.startDate,
      endDate: dates.endDate,
      weekdayLabel: schedule.weekdayLabel,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      timeRangeLabel: schedule.timeRangeLabel,
      meetingCount: schedule.meetingCount,
      uniqueWeekdays: schedule.uniqueWeekdays,
      uniqueTimeRanges: schedule.uniqueTimeRanges,
      dominantWeekday: schedule.dominantWeekday,
      dominantTimeRange: schedule.dominantTimeRange,
      hasVariableWeekdays: schedule.hasVariableWeekdays,
      hasVariableTimes: schedule.hasVariableTimes
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

const PLANNING_WEEKDAY_LABELS = PLANNING_WEEKDAY_SHORT_LABELS;

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
        district: normalizeOperationalDistrict(row.district) || text(row.district),
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
    .sort((a, b) =>
      text(a.district).localeCompare(text(b.district), 'he')
      || b.activities.length - a.activities.length
      || a.label.localeCompare(b.label, 'he')
    );
  const recruitmentProfilesByDistrict = recruitmentProfileRows.reduce((acc, profile) => {
    const district = text(profile.district) || 'ללא מחוז';
    acc[district] = (acc[district] || 0) + 1;
    return acc;
  }, {});
  const recruitmentDistrictSummary = ['צפון', 'מרכז', 'דרום']
    .filter((district) => recruitmentProfilesByDistrict[district])
    .map((district) => `${district} ${recruitmentProfilesByDistrict[district]}`)
    .join(' · ');

  const coverage = planningFullWorkPlanCoverage(firstHalfRows);
  const unresolvedRows = firstHalfRows.filter((row) =>
    !text(row?.instructorEmpId) && row.kind !== 'recruitment'
  );
  return `<section class="course-planning-completion-overview" data-planning-completion-overview>
    <div class="course-planning-section-heading course-planning-workplan-heading">
      <div>
        <strong>תוכנית עבודה מלאה — מחצית א׳</strong>
        <span class="course-planning-workplan-summary">${coverage.total} פעילויות · ${coverage.team} לצוות הקיים · ${coverage.recruitment} לגיוס${coverage.unresolved ? ` · ${coverage.unresolved} לטיפול` : ''}</span>
      </div>
    </div>
    ${recruitmentProfileRows.length ? `<details class="course-planning-recruitment-models">
      <summary class="course-planning-recruitment-summary">
        <span>
          <strong>תכנון לגיוס ולהכשרה</strong>
          <small>${coverage.recruitment} פעילויות ללא כיסוי · ${recruitmentProfileRows.length} תקני גיוס מוצעים${recruitmentDistrictSummary ? ` · ${recruitmentDistrictSummary}` : ''}</small>
        </span>
        <span class="course-planning-recruitment-summary-action">הצג פירוט</span>
      </summary>
      <div class="course-planning-recruitment-models-body">
        <p class="course-planning-recruitment-note">התקנים מחושבים לאורך ציר הזמן ובחלוקה למחוזות. פעילות שמתחילה מאוחר יכולה להצטרף לתקן קיים אם אין חפיפה; שישי ושבת אינם ברירת מחדל.</p>
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
      </div>
    </details>` : ''}
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
                ${item.activities.map((activity) => {
                  const scheduleBits = [
                    text(activity.weekdayLabel),
                    text(activity.timeRangeLabel),
                    Number(activity.meetingCount) > 0 ? `${Number(activity.meetingCount)} מפגשים` : ''
                  ].filter(Boolean);
                  return `<div class="course-planning-completion-activity-row">
                  <strong>${escapeHtml(activity.courseName || 'פעילות')}</strong>
                  <span>${escapeHtml(activity.school || 'ללא בית ספר')}${activity.authority ? ` · ${escapeHtml(activity.authority)}` : ''}</span>
                  <span>${escapeHtml(activity.status || '')}</span>
                  <span class="course-planning-completion-activity-schedule">${scheduleBits.length ? escapeHtml(scheduleBits.join(' · ')) : 'שעות טרם נקבעו'}</span>
                  <span>${activity.startDate ? `<bdi dir="ltr">${escapeHtml(formatDateHe(activity.startDate))}</bdi>` : 'ללא מועד'}${activity.endDate ? `–<bdi dir="ltr">${escapeHtml(formatDateHe(activity.endDate))}</bdi>` : ''}</span>
                </div>`;
                }).join('')}
              </div>
            </div>
          </td>
        </tr>`;
        }).join('')}</tbody>
      </table>
      </div>
    </section>` : ''}
    ${unresolvedRows.length ? `<details class="course-planning-workplan-unresolved">
      <summary>${unresolvedRows.length} פעילויות שדורשות טיפול נוסף</summary>
      <div class="course-planning-workplan-unresolved-table-wrap">
        <table class="course-planning-workplan-unresolved-table">
          <thead><tr><th>בית ספר</th><th>פעילות</th><th>סיבה</th></tr></thead>
          <tbody>
            ${unresolvedRows.map((row) => `<tr>
              <td><strong>${escapeHtml(row.school || 'ללא בית ספר')}</strong>${row.authority ? `<small>${escapeHtml(row.authority)}</small>` : ''}</td>
              <td>${escapeHtml(row.courseName || 'פעילות')}</td>
              <td>${escapeHtml(text(row.reason) || 'נדרש טיפול נוסף')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
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
  const progressCompleted = Math.max(0, Number(progress?.completed) || 0);
  const progressTotal = Math.max(0, Number(progress?.total) || rows.length);
  const progressPercent = loading && progressTotal > 0
    ? Math.max(0, Math.min(100, Math.round((progressCompleted / progressTotal) * 100)))
    : 0;
  const progressPhase = loading ? text(progress?.phase || 'הכנת נתונים') : '';
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
    ${loading ? `<div class="course-planning-progress" role="status" aria-live="polite" aria-label="${escapeHtml(progressPhase)}">
      <div class="course-planning-progress__head">
        <strong>${escapeHtml(progressPhase)}</strong>
        <span><bdi dir="ltr">${progressCompleted}/${progressTotal}</bdi> · ${progressPercent}%</span>
      </div>
      <div class="course-planning-progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
        <span style="width:${progressPercent}%"></span>
      </div>
      <small>החישוב נשמר בין שלבים וממשיך מאותה ריצה במקרה של תיקון מקומי.</small>
    </div>` : ''}
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
