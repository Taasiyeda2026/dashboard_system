import { supabase } from '../supabase-client.js';
import { hasPermission } from '../permission-policy.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { loadInstructorSchedulingData } from './instructor-scheduling-data.js';
import { activityMeetings, schedulingCalendarMeetings } from './instructor-scheduling-load.js';
import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import {
  calculateCandidateTravel,
  createRouteClient,
  loadSchedulingTravelCacheRows
} from './course-scheduling-travel.js';
import {
  attachCancelledMeetingsToActivities,
  loadCourseMeetingState,
  israelTodayIso,
  meetingsCompletedForCourse
} from './course-scheduling-meetings.js';
import { isSchedulableActivityType, isSchedulingActivityActive, schedulingActivityTypeCategory } from './shared/activity-scheduling-eligibility.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';
import { weekRange, shiftWeek, buildWeekRows, weekCalendarHtml, fixedScheduleHtml, weekNavLabel } from './course-scheduling-calendar.js';
import {
  enrichActivitiesWithSchoolAddresses,
  pickNearestActionableCourse,
  loadDistanceCoverage,
  runDistanceBuildLoop,
  translateSchedulingRouteError
} from './course-scheduling-distance-build.js';
import { instructionLanguageLabel } from './shared/instruction-language.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, filterMeetingsByCourseSchedulingPeriod, periodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import { OPERATIONAL_DISTRICTS, normalizeOperationalDistrict } from './shared/district-normalization.js';
import { loadSchoolCalendarRows } from './shared/school-calendar-data.js';
import { formatWorkloadHours } from './course-scheduling-score.js';
import {
  MAX_HOME_DISTANCE_KM,
  exceedsHomeDistanceLimit,
  homeDistanceLimitFailureMessage,
  formatAffectedMeetingsPhrase
} from './instructor-matching-engine.js';
import {
  bindInstructorsWorkspaceNav,
  instructorsWorkspaceHeaderHtml,
  instructorsWorkspaceNavStylesHtml
} from './shared/instructors-workspace-nav.js';
import {
  manualCandidateBlocked,
  manualCandidateWarnings
} from './shared/course-scheduling-manual-picker-access.js';
import { activeSchedulingInstructors } from './shared/course-scheduling-instructors.js';
import {
  submitCourseMeetingSubstituteRequest,
  substituteRequestErrorMessage
} from './shared/course-meeting-substitute-requests.js';
import {
  DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE,
  applyDistrictSimulationSaveOutcome,
  courseLabelForSimulationRow,
  defaultSelectedSimulationCourseIds,
  districtSimulationDraftSaveBlockReason,
  districtSimulationPanelHtml,
  hasReliableHomeRoute,
  isDistrictSimulationRowSelectable,
  normalizeSelectedSimulationCourseIds,
  runDistrictSchedulingSimulation,
  selectedSimulationCandidate,
  summarizeDistrictSimulation
} from './course-scheduling-district-simulation.js';
import {
  DEFAULT_PLANNING_PERIOD_KEY,
  FIRST_HALF_COUNT_START_DATE,
  PLANNING_ENGINE_VERSION,
  applyPlanningLockToRow,
  buildDynamicCoursePlan,
  buildPlanningCompletionRows,
  buildPlanningOverviewRows,
  createPlanningCheckpoint,
  isPlanningCancellationError,
  PlanningCancelledError,
  planningCompletionOverviewHtml,
  planningContextFingerprint,
  planningDataFingerprint,
  planningTabHtml,
  planningWorkspaceCourses
} from './course-scheduling-planning.js';
import {
  clearSharedPlanningWorkspace,
  clearSharedPlanningCheckpoint,
  confirmSharedPlanningDraft,
  loadSharedPlanningCheckpoint,
  loadSharedPlanningWorkspace,
  planningStoreErrorMessage,
  saveSharedPlanningCheckpoint,
  saveSharedPlanningLock,
  saveSharedPlanningSnapshot,
  sharedPlanningAffectedCourseIds,
  sharedPlanningLocks
} from './course-scheduling-planning-store.js';
import { exportPlanningWorkbook } from './course-scheduling-planning-export.js';

export { formatWorkloadHours, MAX_HOME_DISTANCE_KM, formatAffectedMeetingsPhrase };

const DIRECT_SINGLE_SUBSTITUTE_ROLES = new Set(['admin', 'operation_manager']);
const REQUEST_SINGLE_SUBSTITUTE_ROLES = new Set([
  'activities_manager',
  'instructor_manager',
  'domain_manager',
  'business_development_manager'
]);

let schedulingScreenActive = false;
let planningRunGeneration = 0;
let activePlanningRun = null;
let pendingPlanningStart = null;

function cancelPendingPlanningStart() {
  const pending = pendingPlanningStart;
  pendingPlanningStart = null;
  if (!pending) return;
  pending.cancelled = true;
  pending.onCancel?.();
  if (pending.idleId != null && typeof globalThis.cancelIdleCallback === 'function') {
    globalThis.cancelIdleCallback(pending.idleId);
  }
  if (pending.frameId != null && typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(pending.frameId);
  }
  if (pending.timerId != null) clearTimeout(pending.timerId);
}

export function cancelCourseSchedulingPlanning(state = null) {
  schedulingScreenActive = false;
  planningRunGeneration += 1;
  cancelPendingPlanningStart();
  activePlanningRun?.controller?.abort();
  activePlanningRun = null;
  if (state) {
    state.courseSchedulingPlanningLoading = false;
    state.courseSchedulingPlanningProgress = null;
  }
}

export function scheduleCoursePlanningStart({
  start,
  isActive = () => true,
  onCancel = () => {},
  requestIdle = typeof globalThis.requestIdleCallback === 'function' ? globalThis.requestIdleCallback.bind(globalThis) : null,
  requestFrame = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null,
  scheduleTimer = (callback) => setTimeout(callback, 0)
} = {}) {
  cancelPendingPlanningStart();
  const pending = { cancelled: false, idleId: null, frameId: null, timerId: null, onCancel };
  pendingPlanningStart = pending;
  const run = () => {
    if (pending.cancelled || pendingPlanningStart !== pending) return;
    if (!isActive()) {
      pendingPlanningStart = null;
      pending.cancelled = true;
      pending.onCancel?.();
      return;
    }
    pendingPlanningStart = null;
    start?.();
  };
  if (requestIdle) {
    pending.idleId = requestIdle(run, { timeout: 600 });
  } else if (requestFrame) {
    pending.frameId = requestFrame(() => {
      pending.frameId = null;
      if (!pending.cancelled) pending.timerId = scheduleTimer(run);
    });
  } else {
    pending.timerId = scheduleTimer(run);
  }
  return pending;
}

export function singleMeetingSubstitutionAccess(user = {}) {
  const role = text(user?.role).toLowerCase();
  const canDirect = DIRECT_SINGLE_SUBSTITUTE_ROLES.has(role);
  const canRequest = !canDirect
    && REQUEST_SINGLE_SUBSTITUTE_ROLES.has(role)
    && hasPermission(user, 'view_operations_scheduling');
  return { canDirect, canRequest, allowed: canDirect || canRequest };
}

/**
 * Maps server-side scheduling RPC error codes to clear Hebrew messages.
 * Used by draft-save, final-assign, and confirm-draft error handlers so the
 * user sees an actionable message instead of a raw technical code.
 * Does NOT duplicate any validation logic — the server remains the source of truth.
 */
const SCHEDULING_ASSIGNMENT_ERROR_HE = {
  scheduling_availability_missing:     'המדריך אינו זמין בתאריך אחד ממפגשי הקורס',
  scheduling_instructor_unavailable:   'המדריך חסום בתאריך אחד ממפגשי הקורס',
  scheduling_conflict_detected:        'קיימת חפיפה עם שיבוץ אחר של המדריך',
  scheduling_transition_insufficient:  'אין מספיק זמן מעבר בין הפעילויות',
  scheduling_transition_unverified:    'לא ניתן לאמת את זמן המעבר — ייתכן שכתובת חסרה',
  scheduling_home_route_unverified:    'המרחק מבית המדריך לבית הספר לא חושב. הריצו עדכון מרחקים ונסו שנית',
  scheduling_distance_exceeded:        `המדריך גר מעל ${MAX_HOME_DISTANCE_KM} ק"מ מבית הספר`,
  scheduling_home_distance_exceeded:   `המדריך גר מעל ${MAX_HOME_DISTANCE_KM} ק"מ מבית הספר`,
  scheduling_assignment_locked:        'הפעילות כבר שובצה או נשמרה כטיוטה — רעננו את המסך ונסו שנית',
  scheduling_gender_mismatch:          'מגדר המדריך אינו עומד בדרישת הקורס',
  scheduling_language_mismatch:        'המדריך אינו מלמד בשפת הוראה הנדרשת',
  scheduling_instructor_profile_incomplete: 'פרופיל המדריך אינו מלא (מגדר/שפות)',
  scheduling_daily_sequence_exceeded:  'המדריך עבר את מגבלת הפעילויות הרצופות ביום',
  scheduling_friday_not_allowed:       'המדריך אינו זמין בימי שישי',
  scheduling_permission_denied:        'אין הרשאה לביצוע שיבוץ. נדרשת הרשאת שיבוצים',
  scheduling_activity_not_open:        'הפעילות אינה פתוחה לשיבוץ',
  scheduling_activity_dates_missing:   'תאריכי המפגשים חסרים בפעילות',
  scheduling_activity_hours_missing:   'שעות המפגש חסרות או שגויות בפעילות',
  instructor_not_found:                'המדריך לא נמצא במאגר — ייתכן שהנתונים השתנו',
  instructor_inactive:                 'המדריך אינו פעיל',
  instructor_name_mismatch:            'שם המדריך אינו תואם — ייתכן שנתוני המדריך השתנו',
  activity_not_found:                  'הפעילות לא נמצאה',
  scheduling_no_existing_assignment:  'לפעילות אין מדריך משובץ',
  scheduling_reason_required:          'יש להזין סיבה',
  scheduling_effective_date_required:  'יש לבחור תאריך כניסה לתוקף',
  scheduling_meeting_date_required:     'יש לבחור מפגש',
  scheduling_meeting_not_found:         'המפגש שנבחר אינו קיים בלוח הפעילות',
  scheduling_substitute_already_assigned: 'המדריך שנבחר כבר משויך למפגש הזה',
  scheduling_single_substitution_missing: 'לא קיימת החלפה חד־פעמית במפגש זה',
  scheduling_request_permission_denied: 'אין הרשאה לשינוי ישיר. יש להגיש בקשה לעדכון',
  scheduling_course_locked_for_reassignment: 'לאחר שני מפגשים נדרשת החלפה תפעולית',
};

function translateSchedulingAssignmentError(codeOrMessage, prefix = 'הפעולה נכשלה') {
  const raw = String(codeOrMessage || '').trim();
  if (SCHEDULING_ASSIGNMENT_ERROR_HE[raw]) return `${prefix}: ${SCHEDULING_ASSIGNMENT_ERROR_HE[raw]}`;
  for (const [code, msg] of Object.entries(SCHEDULING_ASSIGNMENT_ERROR_HE)) {
    if (raw.includes(code)) return `${prefix}: ${msg}`;
  }
  return raw ? `${prefix}: ${raw}` : prefix;
}

/** Shared draft-save RPC + payload used by individual-course and district-simulation save paths. */
export function buildCourseAssignmentDraftRpc({ activityId, selected, topCandidate }) {
  const proposedMeetings = selected?.dateAdjustment?.meetings?.map(({ date }) => ({ date })) || null;
  const rpc = proposedMeetings ? 'save_course_assignment_draft_with_dates' : 'save_course_assignment_draft';
  const payload = {
    p_activity_id: activityId,
    p_emp_id: Number(emp(selected)),
    p_instructor_name: selected?.instructor?.full_name,
    p_top_emp_id: Number(emp(topCandidate)),
    p_selected_score: selected?.score,
    p_top_score: topCandidate?.score,
    ...(proposedMeetings ? { p_proposed_meetings: proposedMeetings } : {})
  };
  return { rpc, payload };
}

export function buildCourseReassignmentRpc({ activityId, selectedId, selected, topCandidate, decisionType, reason = null }) {
  return {
    p_activity_id: activityId,
    p_new_emp_id: Number(selectedId),
    p_new_instructor_name: selected.instructor.full_name,
    p_top_emp_id: Number(emp(topCandidate)),
    p_selected_score: selected.score,
    p_top_score: topCandidate.score,
    p_decision_type: decisionType || (selectedId === emp(topCandidate) ? 'approved' : 'overridden'),
    p_reason: text(reason) || null
  };
}

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((output, row) => {
  const id = text(row[key]);
  if (id) (output[id] ||= []).push(row);
  return output;
}, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);
export function applyReturnedSchedulingActivity(activities = [], returned = null) {
  const row = Array.isArray(returned) ? returned[0] : returned;
  const rowId = idOf(row || {});
  if (!rowId) return false;
  const index = activities.findIndex((activity) => idOf(activity) === rowId);
  if (index < 0) activities.push(row);
  else activities[index] = { ...activities[index], ...row };
  return true;
}
const today = () => israelTodayIso();
const formatDateHeDots = (value) => formatDateHe(value).replaceAll('/', '.');
export const PENDING_ACTIVITY_STORAGE_KEY = 'dashboard:pending-course-activity-id';
export const SCHEDULING_SNAPSHOT_KEY = 'dashboard:course-scheduling-calculation-v2';
export const SCHEDULING_SNAPSHOT_SCHEMA_VERSION = 4;
export const SCHEDULING_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const LEGACY_SCHEDULING_SNAPSHOT_KEYS = [
  'dashboard:course-scheduling-calculation-v1'
];

const STATUS = {
  waiting: 'ממתין לבדיקת מדריכים',
  ready: 'נמצאה המלצה',
  missing: 'חסר מידע',
  recruit: 'לא נמצא מדריך מתאים',
  draft: 'שמור כטיוטה',
  assigned: 'שובץ',
  problem: 'נדרשת בדיקה'
};

let courseSchedulingStylesPromise = null;
function ensureCourseSchedulingStyles() {
  if (typeof document === 'undefined' || !document.head) return;
  courseSchedulingStylesPromise ||= import('./course-scheduling.css').catch((error) => {
    console.warn('[course-scheduling] stylesheet load failed', error);
  });
}

function clearLegacySchedulingSnapshots() {
  if (typeof localStorage === 'undefined') return;
  for (const key of LEGACY_SCHEDULING_SNAPSHOT_KEYS) {
    try { localStorage.removeItem(key); } catch { /* local storage may be unavailable */ }
  }
}

function snapshotHasTravelAndChecks(results = []) {
  return results.every((result) => {
    const candidates = [result?.recommended, result?.bestAvailable, ...(result?.alternatives || []), ...(result?.checked || [])].filter(Boolean);
    if (!candidates.length) return true;
    return candidates.every((candidate) => candidate.travel && candidate.checks);
  });
}

function stableSchedulingValue(value) {
  if (Array.isArray(value)) return value.map(stableSchedulingValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSchedulingValue(value[key])]));
  }
  return value;
}

function schedulingFingerprint(value) {
  const input = JSON.stringify(stableSchedulingValue(value));
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function schedulingSnapshotContext(data = {}) {
  const session = data.authSession || {};
  const userId = text(session.user?.id);
  const sessionId = text(session.sessionId);
  if (!userId || !sessionId) return null;
  return {
    userId,
    sessionId,
    dataFingerprint: schedulingFingerprint({
      activities: data.activities || [],
      instructors: data.instructors || [],
      scheduling: data.scheduling || {},
      schoolCalendar: data.schoolCalendar || []
    })
  };
}

function restoreCalculationSnapshot(state, courses, context = null, now = Date.now()) {
  if ((state.courseSchedulingResults || []).length) return;
  if (typeof localStorage === 'undefined') return;
  clearLegacySchedulingSnapshots();
  try {
    const snapshot = JSON.parse(localStorage.getItem(SCHEDULING_SNAPSHOT_KEY) || 'null');
    if (!snapshot || !Array.isArray(snapshot.results)) return;
    const contextMatches = context
      && snapshot.userId === context.userId
      && snapshot.sessionId === context.sessionId
      && snapshot.dataFingerprint === context.dataFingerprint;
    const fresh = Number.isFinite(Number(snapshot.savedAt))
      && now - Number(snapshot.savedAt) >= 0
      && now - Number(snapshot.savedAt) <= SCHEDULING_SNAPSHOT_TTL_MS;
    if (Number(snapshot.schemaVersion) !== SCHEDULING_SNAPSHOT_SCHEMA_VERSION || !contextMatches || !fresh) {
      localStorage.removeItem(SCHEDULING_SNAPSHOT_KEY);
      return;
    }
    if (!snapshotHasTravelAndChecks(snapshot.results)) {
      localStorage.removeItem(SCHEDULING_SNAPSHOT_KEY);
      return;
    }
    const courseById = new Map(courses.map((course) => [idOf(course), course]));
    state.courseSchedulingResults = snapshot.results.flatMap((result) => {
      const course = courseById.get(idOf(result?.course));
      return course && !text(course.emp_id) && !text(course.draft_emp_id)
        ? [{ ...result, course }]
        : [];
    });
    state.courseSchedulingCalculatedAt = text(snapshot.calculatedAt);
  } catch {
    try { localStorage.removeItem(SCHEDULING_SNAPSHOT_KEY); } catch { /* local storage may be unavailable */ }
  }
}

function saveCalculationSnapshot(state, courses, context = null, now = Date.now()) {
  if (typeof localStorage === 'undefined') return;
  if (!context?.userId || !context?.sessionId || !context?.dataFingerprint) return;
  try {
    const courseById = new Map(courses.map((course) => [idOf(course), course]));
    const results = (state.courseSchedulingResults || []).filter((result) => {
      const course = courseById.get(idOf(result?.course));
      return course && !text(course.emp_id) && !text(course.draft_emp_id);
    });
    localStorage.setItem(SCHEDULING_SNAPSHOT_KEY, JSON.stringify({
      schemaVersion: SCHEDULING_SNAPSHOT_SCHEMA_VERSION,
      savedAt: now,
      userId: context.userId,
      sessionId: context.sessionId,
      dataFingerprint: context.dataFingerprint,
      calculatedAt: state.courseSchedulingCalculatedAt || '',
      results
    }));
    clearLegacySchedulingSnapshots();
  } catch {
    // Persistence is optional.
  }
}


function selectedPeriodKey(state = {}) {
  return state.courseSchedulingPeriodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
}

function planningPeriodKey(state = {}) {
  return state.courseSchedulingPlanningPeriodKey || DEFAULT_PLANNING_PERIOD_KEY;
}

function withSelectedPeriod(course, state = {}) {
  return { ...course, periodKey: selectedPeriodKey(state) };
}

function authorityOptions(courses = []) {
  return [...new Set(courses.map((course) => text(course.authority)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

function districtValue(row = {}) {
  return normalizeOperationalDistrict(row.district || row.school_district || row.authority_district);
}

export function schedulingDraftIdsForScope(activities = [], {
  periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY,
  district = ''
} = {}) {
  const normalizedDistrict = normalizeOperationalDistrict(district);
  return [...new Set((activities || [])
    .filter((activity) => text(activity?.activity_season) === 'school_2027')
    .filter((activity) => isSchedulingActivityActive(activity))
    .filter((activity) => !!text(activity?.draft_emp_id))
    .filter((activity) => ![activity?.emp_id, activity?.emp_id_2, activity?.instructor_name, activity?.instructor_name_2].some(text))
    .filter((activity) => {
      const rowDistrict = districtValue(activity);
      return normalizedDistrict ? rowDistrict === normalizedDistrict : OPERATIONAL_DISTRICTS.includes(rowDistrict);
    })
    .filter((activity) => filterMeetingsByCourseSchedulingPeriod(
      schedulingCalendarMeetings(activity),
      periodKey
    ).length > 0)
    .map((activity) => idOf(activity))
    .filter(Boolean))];
}

function hasOfficialCourseDate(course = {}) {
  if (activityMeetings(course).some((meeting) => /^\d{4}-\d{2}-\d{2}$/.test(text(meeting?.date).slice(0, 10)))) return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(text(course?.start_date).slice(0, 10));
}

function courseMatchesSchedulingPeriod(course = {}, periodKey = DEFAULT_COURSE_SCHEDULING_PERIOD_KEY) {
  // Activities without a school-provided date belong to the first-half work queue.
  if (!hasOfficialCourseDate(course) && periodKey === 'second') return false;
  const meetings = schedulingCalendarMeetings(course);
  return meetings.length === 0 || filterMeetingsByCourseSchedulingPeriod(meetings, periodKey).length > 0;
}

function filteredInterfaceCourses(courses = [], state = {}) {
  const periodKey = selectedPeriodKey(state);
  const district = text(state.courseSchedulingDistrict || '');
  const authority = text(state.courseSchedulingAuthority || '');
  const activityType = text(state.activitySchedulingType || 'all');
  return courses
    .filter((activity) => activityType === 'all' || schedulingActivityTypeCategory(activity.activity_type || activity.type) === activityType)
    .filter((course) => courseMatchesSchedulingPeriod(course, periodKey))
    .filter((course) => !district || districtValue(course) === district)
    .filter((course) => !authority || text(course.authority) === authority)
    .map((course) => withSelectedPeriod(course, state));
}

/** Assigned courses are display-only until the user explicitly starts replacement. */
export function isAssignedCourseSchedulingManageable(activity = {}) {
  return isSchedulingActivityActive(activity)
    && isSchedulableActivityType(activity.activity_type || activity.type)
    && !!text(activity.emp_id);
}

function schedulingWorkspaceCourses(activities = []) {
  return activities.filter((activity) =>
    isSchedulingActivityActive(activity)
    && isSchedulableActivityType(activity.activity_type || activity.type)
  );
}

function schedulingScopeHtml(allCourses = [], state = {}, allActivities = allCourses) {
  const periodKey = selectedPeriodKey(state);
  const period = resolveCourseSchedulingPeriod(periodKey);
  const periodButtons = periodOptions().map((option) => `<button type="button" class="course-scheduling-tab${option.key === periodKey ? ' is-active' : ''}" data-period-key="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`).join('');
  const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
  const districtSelectHtml = `<option value="">כל המחוזות</option>${OPERATIONAL_DISTRICTS.map((item) => `<option value="${escapeHtml(item)}"${item === district ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  const scopedForAuthority = allCourses
    .filter((course) => courseMatchesSchedulingPeriod(course, periodKey))
    .filter((course) => !district || districtValue(course) === district);
  const selectedAuthority = text(state.courseSchedulingAuthority || '');
  const authorityList = authorityOptions(scopedForAuthority);
  const authoritySelectHtml = `<option value="">כל הרשויות</option>${authorityList.map((item) => `<option value="${escapeHtml(item)}"${item === selectedAuthority ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  const displayStart = periodKey === 'first' ? FIRST_HALF_COUNT_START_DATE : period.start;
  const periodRange = `${formatDateHeDots(displayStart)} – ${formatDateHeDots(period.end)}`;
  const selectedActivityType = text(state.activitySchedulingType || 'all');
  const activityTypeOptions = [['all', 'הכול'], ['course', 'קורסים'], ['workshop', 'סדנאות'], ['tour', 'סיורים']]
    .map(([value, label]) => `<option value="${value}"${value === selectedActivityType ? ' selected' : ''}>${label}</option>`).join('');
  const selectedBusinessStatus = text(state.courseSchedulingBusinessStatus || 'all');
  const businessStatusOptions = [['all', 'הכול'], ['open', 'פתוח'], ['draft', 'ממתין לאישור'], ['assigned', 'משובץ']]
    .map(([value, label]) => `<option value="${value}"${value === selectedBusinessStatus ? ' selected' : ''}>${label}</option>`).join('');
  return `<section class="course-scheduling-scope"><div class="course-scheduling-scope-inner">
    <div class="course-scheduling-tabs course-scheduling-tabs--inner">${periodButtons}</div>
    <label class="course-scheduling-filter-label">מחוז<select class="course-scheduling-input" data-district-filter>${districtSelectHtml}</select></label>
    <label class="course-scheduling-filter-label">רשות<select class="course-scheduling-input" data-authority-filter>${authoritySelectHtml}</select></label>
    <label class="course-scheduling-filter-label">פעילות<select class="course-scheduling-input" data-activity-type-filter>${activityTypeOptions}</select></label>
    <label class="course-scheduling-filter-label">מצב<select class="course-scheduling-input" data-business-status-filter>${businessStatusOptions}</select></label>
    <p class="course-scheduling-period-range course-scheduling-period-range--push">${escapeHtml(periodRange)}</p>
  </div></section>`;
}
function activeTab(state) {
  if (state.courseSchedulingTab === 'maintenance') return 'maintenance';
  return 'courses';
}

function cardStatusClass(statusLabel) {
  if (statusLabel === STATUS.ready) return ' is-status-ready';
  if (statusLabel === STATUS.waiting || statusLabel === STATUS.missing) return ' is-status-warning';
  if (statusLabel === STATUS.problem || statusLabel === STATUS.recruit) return ' is-status-danger';
  if (statusLabel === STATUS.draft) return ' is-status-draft';
  if (statusLabel === STATUS.assigned) return ' is-status-ready';
  return '';
}

function userFacingStatus(resultStatus, treatmentReason = '') {
  if (resultStatus === 'הצעה מוכנה') return STATUS.ready;
  if (resultStatus === 'חסר מידע') return STATUS.missing;
  if (resultStatus === 'נדרש גיוס') return STATUS.recruit;
  if (resultStatus === 'נדרש טיפול') return text(treatmentReason) ? STATUS.problem : STATUS.problem;
  return STATUS.waiting;
}

export function courseSchedulingCounts(results = []) {
  return {
    ready: results.filter((result) => result.status === 'הצעה מוכנה').length,
    treatment: results.filter((result) => result.status === 'נדרש טיפול').length,
    recruit: results.filter((result) => result.status === 'נדרש גיוס').length,
    missing: results.filter((result) => result.status === 'חסר מידע').length
  };
}

function daysUntil(dateStr) {
  const start = text(dateStr);
  if (!start) return Number.POSITIVE_INFINITY;
  return Math.ceil((new Date(`${start}T00:00:00`) - new Date(`${today()}T00:00:00`)) / 86400000);
}

function courseDayTimeHtml(activity) {
  const meetings = filterMeetingsByCourseSchedulingPeriod(activityMeetings(activity), activity?.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY);
  if (!meetings.length) {
    const time = formatTimeRangeShort(activity.start_time, activity.end_time);
    return time ? `<bdi dir="ltr">${escapeHtml(time)}</bdi>` : '—';
  }
  const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${meetings[0].date}T12:00:00`));
  const timeRange = `<bdi dir="ltr">${escapeHtml(formatTimeRangeShort(meetings[0].start_time || activity.start_time, meetings[0].end_time || activity.end_time))}</bdi>`;
  return `${escapeHtml(weekday)} · ${timeRange}`;
}

// Wrap only date/time/numeric ranges in bdi — never a full Hebrew sentence.
export function compactMeetingsHtml(activity) {
  const meetings = filterMeetingsByCourseSchedulingPeriod(activityMeetings(activity), activity?.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY);
  if (!meetings.length) return '—';
  const dates = meetings.map((meeting) => text(meeting.date)).sort();
  const weekdays = [...new Set(dates.map((date) => new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))))];
  const dateRange = `<bdi dir="ltr">${escapeHtml(formatDateHe(dates[0]))}–${escapeHtml(formatDateHe(dates.at(-1)))}</bdi>`;
  const timeRange = `<bdi dir="ltr">${escapeHtml(formatTimeRangeShort(meetings[0].start_time || activity.start_time, meetings[0].end_time || activity.end_time))}</bdi>`;
  return `${meetings.length} מפגשים · ${dateRange} · ${escapeHtml(weekdays.join(', '))} · ${timeRange}`;
}

const BUSINESS_STATUS = Object.freeze({
  open: 'פתוח',
  draft: 'ממתין לאישור',
  assigned: 'משובץ'
});

function planningPrimaryOption(planningRow = {}) {
  const options = Array.isArray(planningRow?.options) ? planningRow.options : [];
  const selected = options.find((option) =>
    text(option?.instructorEmpId) === text(planningRow?.instructorEmpId)
    && text(option?.startDate) === text(planningRow?.startDate)
    && text(option?.startTime) === text(planningRow?.startTime)
  );
  return selected || options[0] || null;
}

function uniquePlanningChoiceValues(items = [], keyOf = (item) => item) {
  const seen = new Set();
  const result = [];
  for (const item of items || []) {
    const key = text(keyOf(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export function planningJointChoiceModel(planningRow = {}, draft = {}) {
  const options = (Array.isArray(planningRow?.options) ? planningRow.options : [])
    .filter((option) =>
      text(option?.startDate)
      && text(option?.startTime)
      && text(option?.endTime)
      && text(option?.instructorEmpId)
      && Array.isArray(option?.meetings)
      && option.meetings.length
    );
  if (!options.length) {
    return {
      options: [],
      dates: [],
      times: [],
      instructors: [],
      selectedDate: '',
      selectedTimeKey: '',
      selectedInstructorEmpId: '',
      optionIndex: -1,
      option: null
    };
  }

  const dates = uniquePlanningChoiceValues(options, (option) => option.startDate)
    .map((option) => text(option.startDate));
  const preferredDate = text(draft?.date || planningRow?.startDate || options[0]?.startDate);
  const selectedDate = dates.includes(preferredDate) ? preferredDate : dates[0];

  const dateOptions = options.filter((option) => text(option.startDate) === selectedDate);
  const timeOptions = uniquePlanningChoiceValues(dateOptions, (option) => `${text(option.startTime)}|${text(option.endTime)}`);
  const times = timeOptions.map((option) => ({
    key: `${text(option.startTime)}|${text(option.endTime)}`,
    startTime: text(option.startTime),
    endTime: text(option.endTime)
  }));
  const planningTimeKey = `${text(planningRow?.startTime)}|${text(planningRow?.endTime)}`;
  const preferredTimeKey = text(draft?.timeKey) || planningTimeKey;
  const selectedTimeKey = times.some((item) => item.key === preferredTimeKey)
    ? preferredTimeKey
    : (times[0]?.key || '');

  const [selectedStartTime = '', selectedEndTime = ''] = selectedTimeKey.split('|');
  const instructorOptions = dateOptions.filter((option) =>
    text(option.startTime) === selectedStartTime
    && text(option.endTime) === selectedEndTime
  );
  const instructors = uniquePlanningChoiceValues(instructorOptions, (option) => option.instructorEmpId)
    .map((option) => ({
      empId: text(option.instructorEmpId),
      name: text(option.instructorName || option.instructorEmpId)
    }));
  const preferredInstructor = text(draft?.instructorEmpId || planningRow?.instructorEmpId || instructorOptions[0]?.instructorEmpId);
  const selectedInstructorEmpId = instructors.some((item) => item.empId === preferredInstructor)
    ? preferredInstructor
    : (instructors[0]?.empId || '');

  const optionIndex = options.findIndex((option) =>
    text(option.startDate) === selectedDate
    && text(option.startTime) === selectedStartTime
    && text(option.endTime) === selectedEndTime
    && text(option.instructorEmpId) === selectedInstructorEmpId
  );

  return {
    options,
    dates,
    times,
    instructors,
    selectedDate,
    selectedTimeKey,
    selectedInstructorEmpId,
    optionIndex,
    option: optionIndex >= 0 ? options[optionIndex] : null
  };
}

function workboardAlert(row = {}) {
  const planning = row.planningRow || {};
  const result = row.result || {};
  if (row.hasReplannedDraft) {
    if (planning.kind === 'recruitment') return 'הטיוטה הקיימת אינה מיטבית · מועד חלופי מוכן ונדרש גיוס';
    if (planning.kind === 'proposal' || planning.kind === 'fixed-proposal') return 'מומלץ לשנות את הטיוטה הקיימת לפי התכנון הארצי';
  }
  if (planning.kind === 'recruitment' || result.status === 'נדרש גיוס') {
    return planning.startDate ? 'מועד מוצע לבית הספר מוכן · נדרש גיוס' : 'אין מדריך מתאים כרגע';
  }
  if (planning.kind === 'missing' || planning.kind === 'fixed' || result.status === 'חסר מידע') {
    return text(planning.reason)
      || (planning.startDate ? 'מועד מוצע מוכן · נדרשת בדיקה נוספת' : 'חסר מידע לתכנון');
  }
  if (result.status === 'נדרש טיפול') return text(result.treatmentReason) || 'נדרשת בדיקה';
  const option = planningPrimaryOption(planning);
  if (option?.routeVerified === false || planning?.diagnostics?.routeVerified === false) return 'הנסיעה טרם אומתה';
  if (planning.halfOverflow) return text(planning.halfOverflowLabel) || 'חורג מתקופת התכנון';
  return '';
}

function workboardMeetings(row = {}) {
  if (row.isAssigned) return activityMeetings(row.course);
  if (row.hasReplannedDraft && Array.isArray(row.planningRow?.meetings) && row.planningRow.meetings.length) {
    return row.planningRow.meetings;
  }
  if (row.hasActualDraft) return schedulingCalendarMeetings(row.course);
  if (Array.isArray(row.planningRow?.meetings) && row.planningRow.meetings.length) return row.planningRow.meetings;
  return [];
}

function workboardScheduleLabel(row = {}) {
  const meetings = workboardMeetings(row);
  const first = meetings[0] || {};
  const startDate = text(first.date || row.planningRow?.startDate || row.course?.start_date);
  const startTime = text(first.start_time || row.planningRow?.startTime || row.course?.start_time);
  const endTime = text(first.end_time || row.planningRow?.endTime || row.course?.end_time);
  if (!startDate && !startTime) return 'טרם נקבע';
  const parts = [];
  if (startDate) parts.push(formatDateHe(startDate));
  if (startTime && endTime) parts.push(formatTimeRangeShort(startTime, endTime));
  return parts.join(' · ') || 'טרם נקבע';
}

function workboardInstructorLabel(row = {}) {
  const course = row.course || {};
  const planning = row.planningRow || {};
  if (row.isAssigned) return text(course.instructor_name || course.emp_id) || '—';
  if (planning.kind === 'recruitment') {
    return text(planning.recruitmentProfileLabel) || 'נדרש גיוס';
  }
  if (row.hasReplannedDraft) {
    return text(planning.instructorName || planning.instructorEmpId) || 'נדרש גיוס';
  }
  if (row.hasActualDraft) return text(course.draft_instructor_name || course.draft_emp_id) || '—';
  return text(planning.instructorName || planning.instructorEmpId) || 'טרם נקבע';
}

function courseRowModel(course, resultByCourseId, planningByCourseId = new Map()) {
  const id = idOf(course);
  const isAssigned = !!text(course.emp_id);
  const hasActualDraft = !isAssigned && !!text(course.draft_emp_id);
  const planningRow = planningByCourseId.get(id) || null;
  const hasPlanningDraft = !isAssigned && !hasActualDraft
    && planningRow?.planningLocked === true
    && !!text(planningRow?.instructorEmpId);
  const hasReplannedDraft = hasActualDraft
    && planningRow?.sourceHadDraft === true
    && ['proposal', 'fixed-proposal', 'recruitment', 'missing'].includes(text(planningRow?.kind));
  const hasDraft = hasActualDraft || hasPlanningDraft;
  const result = resultByCourseId.get(id) || null;
  const bucket = isAssigned ? 'assigned' : (hasDraft ? 'draft' : 'open');
  const statusLabel = BUSINESS_STATUS[bucket];
  const row = {
    course,
    id,
    result,
    planningRow,
    isAssigned,
    hasActualDraft,
    hasPlanningDraft,
    hasReplannedDraft,
    hasDraft,
    bucket,
    statusLabel
  };
  row.alert = workboardAlert(row);
  row.scheduleLabel = workboardScheduleLabel(row);
  row.instructorLabel = workboardInstructorLabel(row);
  return row;
}

const LIST_GROUPS = [
  { key: 'open', label: 'פתוח' },
  { key: 'draft', label: 'ממתין לאישור' },
  { key: 'assigned', label: 'משובץ' }
];

function summaryCardsHtml(rowModels = []) {
  const total = rowModels.length;
  const open = rowModels.filter((row) => row.bucket === 'open').length;
  const drafts = rowModels.filter((row) => row.bucket === 'draft').length;
  const assigned = rowModels.filter((row) => row.bucket === 'assigned').length;
  return `<article class="course-scheduling-summary-card"><b>${total}</b><span>סה״כ</span></article>
    <article class="course-scheduling-summary-card course-scheduling-summary-card--waiting"><b>${open}</b><span>פתוח</span></article>
    <article class="course-scheduling-summary-card course-scheduling-summary-card--draft"><b>${drafts}</b><span>ממתין לאישור</span></article>
    <article class="course-scheduling-summary-card course-scheduling-summary-card--ready"><b>${assigned}</b><span>משובץ</span></article>`;
}

function planningAlternativeButtonsHtml(row = {}, expanded = false, state = {}) {
  const planning = row.planningRow || {};
  const scheduleAlternatives = Array.isArray(planning.scheduleOptions)
    ? planning.scheduleOptions.filter((option) =>
        text(option.startDate) !== text(planning.startDate)
        || text(option.startTime) !== text(planning.startTime)
      ).slice(0, 4)
    : [];
  if (!expanded || row.isAssigned) return '';

  const draft = state?.courseSchedulingChoiceDrafts?.[row.id] || {};
  const choice = planningJointChoiceModel(planning, draft);
  if (choice.options.length && !row.hasActualDraft) {
    return `<div class="course-scheduling-workboard-alternatives course-scheduling-workboard-choice-panel">
      <strong>בחר תאריך, שעה ומדריך</strong>
      <label class="course-scheduling-planning-choice">
        <span>תאריך התחלה</span>
        <select data-course-row-action data-planning-choice-date data-course-id="${escapeHtml(row.id)}">
          ${choice.dates.map((date) => `<option value="${escapeHtml(date)}"${date === choice.selectedDate ? ' selected' : ''}>${escapeHtml(formatDateHe(date))}</option>`).join('')}
        </select>
      </label>
      <label class="course-scheduling-planning-choice">
        <span>שעות</span>
        <select data-course-row-action data-planning-choice-time data-course-id="${escapeHtml(row.id)}">
          ${choice.times.map((item) => `<option value="${escapeHtml(item.key)}"${item.key === choice.selectedTimeKey ? ' selected' : ''}>${escapeHtml(formatTimeRangeShort(item.startTime, item.endTime))}</option>`).join('')}
        </select>
      </label>
      <label class="course-scheduling-planning-choice">
        <span>מדריך</span>
        <select data-course-row-action data-planning-choice-instructor data-course-id="${escapeHtml(row.id)}">
          ${choice.instructors.map((item) => `<option value="${escapeHtml(item.empId)}"${item.empId === choice.selectedInstructorEmpId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="course-scheduling-workboard-primary course-scheduling-planning-choice-apply"
        data-course-row-action data-planning-pick-option data-planning-course-id="${escapeHtml(row.id)}"
        data-planning-option-index="${choice.optionIndex}"${choice.optionIndex < 0 ? ' disabled' : ''}>
        בחר שילוב
      </button>
      <small class="course-scheduling-planning-choice-note">מוצגים רק שילובים שעברו את תנאי הסף והבדיקות התפעוליות.</small>
    </div>`;
  }

  if (scheduleAlternatives.length || planning.startDate) {
    const schedules = [
      ...(planning.startDate ? [{
        startDate: planning.startDate,
        endDate: planning.endDate,
        startTime: planning.startTime,
        endTime: planning.endTime
      }] : []),
      ...scheduleAlternatives
    ].slice(0, 4);
    return `<div class="course-scheduling-workboard-alternatives">
      <strong>${planning.kind === 'recruitment' ? 'מועדים אפשריים לגיוס' : 'מועדים אפשריים'}</strong>
      ${schedules.map((option) => `<div class="course-scheduling-workboard-alt is-static">
        <span><bdi dir="ltr">${escapeHtml(formatDateHe(option.startDate))}</bdi></span>
        <small>שעות: <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(option.startTime, option.endTime))}</bdi></small>
      </div>`).join('')}
      <small class="course-scheduling-planning-choice-note">${planning.kind === 'recruitment'
        ? 'למועדים האלה לא נמצא כרגע מדריך מהצוות שעובר את כל תנאי הסף.'
        : escapeHtml(text(planning.reason) || 'נדרשת בדיקה נוספת לפני בחירת מדריך.')}</small>
    </div>`;
  }
  return '';
}

function workboardActionsHtml(row = {}, { planningLoading = false, alternativesExpanded = false } = {}) {
  if (row.isAssigned) {
    return '<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-open-course-detail>פתח</button>';
  }
  if (row.hasActualDraft) {
    if (row.hasReplannedDraft) {
      const hasScheduleAlternatives = (row.planningRow?.scheduleOptions || []).length > 1;
      return `${hasScheduleAlternatives ? `<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-workboard-alternatives data-course-id="${escapeHtml(row.id)}">${alternativesExpanded ? 'סגור חלופות' : 'חלופות למועד'}</button>` : ''}
        <button type="button" class="course-scheduling-workboard-primary" data-course-row-action data-open-course-detail>שנה טיוטה</button>`;
    }
    return `<button type="button" class="course-scheduling-workboard-primary" data-course-row-action data-confirm-actual-draft data-course-id="${escapeHtml(row.id)}">אשר שיבוץ</button>
      <button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-open-course-detail>שינוי</button>`;
  }
  if (row.hasPlanningDraft) {
    const hasAlternatives = (row.planningRow?.options || []).length > 1;
    return `<button type="button" class="course-scheduling-workboard-primary" data-course-row-action data-confirm-planning-draft data-course-id="${escapeHtml(row.id)}">אשר שיבוץ</button>
      ${hasAlternatives ? `<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-workboard-alternatives data-course-id="${escapeHtml(row.id)}">${alternativesExpanded ? 'סגור חלופות' : 'חלופות'}</button>` : ''}
      <button type="button" class="course-scheduling-workboard-link" data-course-row-action data-planning-unlock data-planning-course-id="${escapeHtml(row.id)}">בטל בחירה</button>`;
  }
  const planning = row.planningRow || {};
  const primary = planningPrimaryOption(planning);
  if (primary?.instructorEmpId && Array.isArray(primary.meetings) && primary.meetings.length) {
    return `<button type="button" class="course-scheduling-workboard-primary" data-course-row-action data-planning-pick-option data-planning-course-id="${escapeHtml(row.id)}" data-planning-option-index="0">בחר הצעה</button>
      ${(planning.options || []).length > 1 ? `<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-workboard-alternatives data-course-id="${escapeHtml(row.id)}">${alternativesExpanded ? 'סגור חלופות' : 'חלופות'}</button>` : ''}`;
  }
  if (planningLoading) return '<span class="course-scheduling-workboard-working">מכין הצעה…</span>';
  if ((planning.scheduleOptions || []).length > 1) {
    return `<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-workboard-alternatives data-course-id="${escapeHtml(row.id)}">${alternativesExpanded ? 'סגור חלופות' : 'חלופות למועד'}</button>
      <button type="button" class="course-scheduling-workboard-link" data-course-row-action data-open-course-detail>פתח</button>`;
  }
  return '<button type="button" class="course-scheduling-workboard-secondary" data-course-row-action data-open-course-detail>בדיקה ידנית</button>';
}

function courseListCardHtml(row, selectedId, state = {}) {
  const c = row.course;
  const selectedClass = row.id === selectedId ? ' is-selected' : '';
  const school = text(c.school) || '—';
  const authority = text(c.authority) || '—';
  const courseName = text(c.activity_name) || '—';
  const expanded = text(state.courseSchedulingAlternativesCourseId) === row.id;
  const alert = row.alert
    ? `<small class="course-scheduling-workboard-alert">⚠ ${escapeHtml(row.alert)}</small>`
    : '';
  return `<div class="course-scheduling-compact-row course-scheduling-course-card${selectedClass}" data-course-card="${escapeHtml(row.id)}" role="button" tabindex="0" aria-label="${escapeHtml(`${school}, ${authority}, ${courseName}, ${row.statusLabel}`)}">
    <span class="course-scheduling-compact-cell course-scheduling-compact-school" title="${escapeHtml(school)}"><strong>${escapeHtml(school)}</strong><small>${escapeHtml(authority)}</small></span>
    <strong class="course-scheduling-compact-cell course-scheduling-compact-course" title="${escapeHtml(courseName)}">${escapeHtml(courseName)}</strong>
    <span class="course-scheduling-compact-cell course-scheduling-workboard-schedule"><bdi dir="ltr">${escapeHtml(row.scheduleLabel)}</bdi></span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-instructor" title="${escapeHtml(row.instructorLabel)}">${escapeHtml(row.instructorLabel)}</span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-status"><span class="course-scheduling-status-chip${row.bucket === 'draft' ? ' is-status-draft' : (row.bucket === 'assigned' ? ' is-status-ready' : ' is-status-warning')}">${escapeHtml(row.statusLabel)}</span>${alert}</span>
    <span class="course-scheduling-compact-cell course-scheduling-workboard-actions">${workboardActionsHtml(row, {
      planningLoading: !!state.courseSchedulingPlanningLoading,
      alternativesExpanded: expanded
    })}</span>
    ${planningAlternativeButtonsHtml(row, expanded, state)}
  </div>`;
}

function courseListHtml(rowModels, selectedId, state = {}) {
  const statusFilter = text(state.courseSchedulingBusinessStatus || 'all');
  const filteredRows = statusFilter === 'all'
    ? rowModels
    : rowModels.filter((row) => row.bucket === statusFilter);
  const groups = LIST_GROUPS
    .map((group) => ({ ...group, rows: filteredRows.filter((row) => row.bucket === group.key) }))
    .filter((group) => group.rows.length);
  if (!groups.length) {
    return `<div class="course-scheduling-empty">
      <strong>אין פעילויות במצב שנבחר</strong>
      <p>אפשר לשנות את מסנן המצב כדי לראות את שאר הפעילויות.</p>
    </div>`;
  }
  const header = '<div class="course-scheduling-compact-table-head" aria-hidden="true"><span>בית ספר</span><span>פעילות</span><span>מועד</span><span>מדריך</span><span>מצב</span><span>פעולה</span></div>';
  return header + groups.map((group) => `<section class="course-scheduling-course-group"><h3>${escapeHtml(group.label)} <span class="course-scheduling-badge">${group.rows.length}</span></h3>${group.rows.map((row) => courseListCardHtml(row, selectedId, state)).join('')}</section>`).join('');
}


function schedulingPlanningStatusHtml(state = {}) {
  const loading = !!state.courseSchedulingPlanningLoading;
  const pending = Math.max(0, Number((state.courseSchedulingPlanningAffectedIds || []).length) || 0);
  const progress = state.courseSchedulingPlanningProgress || {};
  const error = text(state.courseSchedulingPlanningError);
  const calculatedAt = text(state.courseSchedulingPlanningCalculatedAt);
  if (error) {
    return `<div class="course-scheduling-auto-plan is-error" role="status" data-planning-status aria-busy="false">
      <span data-planning-status-message><strong>ההצעות לא עודכנו.</strong> ${escapeHtml(error)}</span>
      <button type="button" class="course-scheduling-workboard-secondary" data-run-course-planning>נסה שוב</button>
    </div>`;
  }
  if (loading) {
    const total = Number(progress.total) || 0;
    const completed = Number(progress.completed) || 0;
    const suffix = total ? ` · ${completed} מתוך ${total}` : '';
    return `<div class="course-scheduling-auto-plan is-working" role="status" data-planning-status aria-busy="true"><span data-planning-status-message><strong>מחשב הצעות שיבוץ</strong>${escapeHtml(suffix)}. אפשר להמשיך לעבוד במסך.</span></div>`;
  }
  if (!state.courseSchedulingPlanningSharedLoaded) {
    return '<div class="course-scheduling-auto-plan is-working" role="status" data-planning-status aria-busy="true"><span data-planning-status-message><strong>טוען את התכנון השמור…</strong></span></div>';
  }
  if (!calculatedAt) {
    return `<div class="course-scheduling-auto-plan is-ready" role="status" data-planning-status aria-busy="false">
      <span data-planning-status-message><strong>אין עדיין תכנון שמור.</strong> החישוב יתחיל רק כשתבחר לבנות הצעות.</span>
      <button type="button" class="course-scheduling-workboard-primary" data-run-course-planning>בנה הצעות</button>
    </div>`;
  }
  if (state.courseSchedulingPlanningStale) {
    const reason = text(state.courseSchedulingPlanningStaleReason) || 'נתוני התכנון השתנו';
    return `<div class="course-scheduling-auto-plan is-warning" role="status" data-planning-status aria-busy="false">
      <span data-planning-status-message><strong>התכנון השמור אינו עדכני ולכן אינו מוצג כהמלצה.</strong> ${escapeHtml(reason)}.</span>
      <button type="button" class="course-scheduling-workboard-primary" data-run-course-planning>חשב תכנון מחדש</button>
    </div>`;
  }
  if (pending) {
    return `<div class="course-scheduling-auto-plan is-ready" role="status" data-planning-status aria-busy="false">
      <span data-planning-status-message><strong>התכנון האחרון נשאר מוצג.</strong> ${pending} פעילויות השתנו מאז החישוב האחרון.</span>
      <button type="button" class="course-scheduling-workboard-primary" data-run-course-planning>עדכן רק את השינויים</button>
    </div>`;
  }
  return `<div class="course-scheduling-auto-plan is-ready" role="status" data-planning-status aria-busy="false">
    <span data-planning-status-message><strong>התכנון שמור ומעודכן.</strong> עודכן ${escapeHtml(calculatedAt)}. מעבר בין מסכים לא מפעיל חישוב חדש.</span>
    <button type="button" class="course-scheduling-workboard-secondary" data-run-course-planning>חשב מחדש</button>
  </div>`;
}

function genderRequirementLabel(course = {}) {
  const value = text(course.required_instructor_gender).toLocaleLowerCase('he-IL');
  if (!value || value === 'any' || value === 'ללא' || value === 'ללא דרישה') return 'ללא דרישה';
  if (value === 'female' || value === 'f' || value === 'נקבה' || value === 'מדריכה') return 'מדריכה';
  if (value === 'male' || value === 'm' || value === 'זכר' || value === 'מדריך') return 'מדריך';
  return text(course.required_instructor_gender);
}

export function candidateHardBlockReason(candidate) {
  if (!candidate) return 'לא נבחר מועמד';
  const homeKm = candidate?.travel?.home?.distance_km;
  // Defensive client gate: never allow draft/assign for a candidate above the hard distance limit,
  // even if stale state or DOM manipulation marks them selected/eligible.
  if (exceedsHomeDistanceLimit(homeKm)) {
    return homeDistanceLimitFailureMessage(homeKm);
  }
  // Unknown / unverified home routes are missing data — never selectable for draft or final assign.
  if (!hasReliableHomeRoute(candidate)) {
    return distanceUnavailableReason(candidate) || 'חסרים נתונים: מסלול נסיעה אמין';
  }
  const checks = candidate.checks || {};
  if (checks.language?.passed !== true) return checks.language?.reason || checks.language?.label || 'שפת ההדרכה אינה תואמת';
  if (checks.gender?.passed !== true) return checks.gender?.reason || checks.gender?.label || 'חסר מגדר בפרופיל';
  if (!candidate.eligible) return [...(candidate.failures || []), ...(candidate.missingProfileData || [])][0] || 'המועמד אינו עומד בתנאי הסף';
  return '';
}

export function actionDisabledReason({ candidate, busy = false, canEdit = true } = {}) {
  if (!canEdit) return 'אין הרשאת עריכה';
  if (busy) return 'פעולה מתבצעת כעת';
  return candidate ? '' : 'יש לבחור מדריך';
}

function candidateConstraintBadgesHtml(candidate, course = {}) {
  const checks = candidate?.checks || {};
  const genderRequired = genderRequirementLabel(course) !== 'ללא דרישה';
  const rows = [
    ['שפה מתאימה', checks.language?.passed === true, `שפה: ${checks.language?.label || 'מתאימה'}`],
    ...(genderRequired ? [['מגדר מתאים', checks.gender?.passed === true, `מגדר: ${checks.gender?.label || 'מתאים'}`]] : []),
    ['זמינות מתאימה', checks.availability?.passed === true, `זמינות: ${checks.availability?.label || 'מתאימה'}`]
  ];
  return `<span class="course-scheduling-candidate-badges" aria-label="התאמה לדרישות הפעילות">${rows.map(([label, passed, title]) => `<span class="course-scheduling-mini-check${passed ? ' is-pass' : ' is-fail'}" title="${escapeHtml(title)}">${passed ? '✓' : '✗'} ${escapeHtml(label)}<span class="sr-only"> ${escapeHtml(title)}</span></span>`).join('')}</span>`;
}

function dateAdjustmentHtml(candidate) {
  const adjustment = candidate?.dateAdjustment;
  if (!adjustment) return '';
  return `<details class="course-scheduling-details course-scheduling-date-adjustment">
    <summary>${escapeHtml(adjustment.label)} · ${adjustment.movedCount} מפגשים יוזזו · סיום חדש ${escapeHtml(formatDateHe(adjustment.newEndDate))}</summary>
    <p>${escapeHtml(adjustment.reason)}. המועדים טרם נשמרו ואינם מהווים אישור.</p>
    ${adjustment.exceedsHalf ? '<p class="scheduling-warning"><b>אזהרה:</b> מועד הסיום המוצע חורג מהמחצית. שמירת טיוטה אינה מאשרת את החריגה; אישור סופי ידרוש אישור מפורש.</p>' : ''}
    <ul>${adjustment.meetings.filter((meeting) => meeting.moved).map((meeting) => `<li>${escapeHtml(formatDateHe(meeting.original_date))} ← ${escapeHtml(formatDateHe(meeting.date))}</li>`).join('')}</ul>
  </details>`;
}

function courseFactRows(course) {
  const meetings = filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), course?.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY);
  return [
    ['תאריך ושעה', `${courseDayTimeHtml(course)}`],
    ['שפת הדרכה', escapeHtml(instructionLanguageLabel(course))],
    ['דרישת מגדר', escapeHtml(genderRequirementLabel(course))]
  ];
}

function selectedCourseMetaHtml(course) {
  return `<header class="course-scheduling-detail-header">
    <dl class="course-scheduling-detail-facts">${courseFactRows(course).map(([label, value]) => `<div class="course-scheduling-detail-fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>
  </header>`;
}

const DISTANCE_UNAVAILABLE_LABELS = {
  missing_instructor_address: 'חסרה כתובת מדריך',
  missing_school_address: 'חסרה כתובת בית ספר',
  service_unavailable: 'שירות המרחקים לא היה זמין',
  not_calculated: 'שירות המרחקים לא היה זמין',
  no_route: 'לא נמצא מסלול'
};

export function distanceUnavailableReason(candidate) {
  const reason = text(candidate?.travel?.unavailableReason);
  if (DISTANCE_UNAVAILABLE_LABELS[reason]) return DISTANCE_UNAVAILABLE_LABELS[reason];
  if (!text(candidate?.instructor?.address)) return DISTANCE_UNAVAILABLE_LABELS.missing_instructor_address;
  return DISTANCE_UNAVAILABLE_LABELS.no_route;
}

export function distanceLabel(candidate) {
  const home = candidate?.travel?.home;
  const km = home?.distance_km;
  const minutes = home?.duration_minutes;
  if (km != null && Number.isFinite(Number(km)) && minutes != null && Number.isFinite(Number(minutes))) {
    return `מרחק מהבית: ${Math.round(Number(km))} ק״מ · זמן נסיעה משוער: ${Math.round(Number(minutes))} דקות`;
  }
  return `מרחק לא זמין — ${distanceUnavailableReason(candidate)}`;
}

export function availabilityLabel(candidate) {
  const availability = candidate?.checks?.availability;
  if (availability?.passed === true) return availability.label || 'זמין בכל מועדי הקורס';
  if (availability?.passed === false) return availability.label || 'לא זמין במלואו';
  if (availability?.passed == null && availability?.reason) return availability.reason;
  return 'לא נבדק';
}

function checkMark(passed) {
  if (passed === true) return '✓';
  if (passed === false) return '✗';
  return '•';
}

function checkRowHtml(label, check) {
  const passed = check?.passed;
  const value = passed == null
    ? (check?.reason || 'לא נבדק')
    : (check?.label || (passed ? 'מתאים' : 'לא מתאים'));
  const detail = passed === false && check?.reason && check.reason !== value
    ? ` — ${check.reason}`
    : '';
  const stateClass = passed === true ? ' is-pass' : passed === false ? ' is-fail' : ' is-unknown';
  return `<li class="course-scheduling-check-row${stateClass}"><span class="course-scheduling-check-mark">${checkMark(passed)}</span><span><b>${escapeHtml(label)}:</b> ${escapeHtml(value)}${escapeHtml(detail)}</span></li>`;
}

export function requirementsFitHtml(candidate, course = {}) {
  const checks = candidate?.checks || {};
  const meetingCount = activityMeetings(course).length;
  const availability = checks.availability || {};
  const availabilityLabelText = availability.passed === true
    ? (availability.label || (meetingCount ? `פנויה בכל ${meetingCount} המפגשים` : 'מתאים'))
    : availability.passed === false
      ? (availability.label || 'לא זמין במלואו')
      : (availability.reason || 'לא נבדק');
  const travel = checks.travel || {};
  const travelLabel = travel.passed === true
    ? travel.label
    : travel.passed === false
      ? (travel.reason || travel.label || 'לא מתאים')
      : (travel.reason || 'לא נבדק');
  return `<div class="course-scheduling-requirements-fit">
    <h4>התאמה לדרישות הפעילות</h4>
    <ul class="course-scheduling-check-list">
      ${checkRowHtml('מגדר', checks.gender)}
      ${checkRowHtml('שפה', checks.language)}
      ${checkRowHtml('זמינות', { ...availability, label: availabilityLabelText, passed: availability.passed })}
      ${checkRowHtml('מרחק', { ...travel, label: travelLabel, passed: travel.passed })}
    </ul>
  </div>`;
}

export function scoreBreakdownHtml(candidate) {
  if (!candidate?.eligible) return `<div class="course-scheduling-score-breakdown"><h4>פירוט הדירוג</h4><p class="course-scheduling-muted">לא מתאים — תנאי סף לא התקיימו.</p></div>`;
  return `<div class="course-scheduling-score-breakdown">
    <h4>נתוני דירוג תפעוליים</h4>
    ${scoreComponentsHtml(candidate)}
    <p class="course-scheduling-score-note">תנאי הסף קובעים התאמה; הדירוג משווה השתלבות בימי עבודה, איכות מיקום, יעילות נסיעה, ניצול זמינות וותק — ללא ציון נקודות.</p>
  </div>`;
}

function scoreComponentsHtml(candidate) {
  if (!candidate?.eligible) return '<p class="course-scheduling-muted">לא מתאים — תנאי סף לא התקיימו.</p>';
  const halfHours = candidate.projectedHalfHours != null && Number.isFinite(Number(candidate.projectedHalfHours))
    ? `<li>סה״כ שעות במחצית: ${escapeHtml(formatWorkloadHours(candidate.projectedHalfHours))}</li>`
    : '';
  return `<ul class="course-scheduling-ranking-details">
    <li>באותו בית ספר: ${Number(candidate.sameSchoolMeetingCount) || 0} מפגשים</li>
    <li>באזור קרוב: ${Number(candidate.nearbyMeetingCount) || 0} מפגשים</li>
    <li>ביום עבודה קיים: ${Number(candidate.existingWorkDayMeetingCount) || 0} מפגשים</li>
    ${halfHours}
  </ul>`;
}

function candidateMetricsHtml(candidate, { compact = false } = {}) {
  const total = Number(candidate.continuityMeetingCount) || 0;
  const integrated = (Number(candidate.sameSchoolMeetingCount) || 0)
    + (Number(candidate.nearbyMeetingCount) || 0)
    + (Number(candidate.existingWorkDayMeetingCount) || 0);
  const metrics = [
    ['רציפות', `${integrated} מתוך ${total} מפגשים`],
    ['ניצול זמינות', `${formatWorkloadHours(candidate.projectedWeeklyHours || 0).replace(/\s*שעות$/, '')} מתוך ${formatWorkloadHours(candidate.availabilityHours || 0)}`]
  ];
  const seniority = candidate.seniorityYears == null ? 'לא הוזן' : `${candidate.seniorityYears} שנים`;
  return `<div class="course-scheduling-key-metrics${compact ? ' is-compact' : ''}">
    ${metrics.map(([label, value]) => `<div class="course-scheduling-key-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}
  </div>
  <p class="course-scheduling-key-meta">${Number(candidate.newWorkDayMeetingCount) || 0} מפגשים פותחים יום עבודה חדש · ותק: ${escapeHtml(seniority)}</p>`;
}

function candidateMetaLine(candidate) {
  const load = candidate?.projectedHalfHours != null && Number.isFinite(Number(candidate.projectedHalfHours))
    ? `עומס לאחר השיבוץ: ${formatWorkloadHours(candidate.projectedHalfHours)}`
    : 'עומס לאחר השיבוץ: —';
  const moved = Number(candidate?.movedMeetingsCount) || 0;
  const existingDays = Number(candidate?.existingWorkDays);
  const projectedDays = Number(
    candidate?.projectedWorkDays != null ? candidate.projectedWorkDays : candidate?.activeWorkDays
  );
  const existingLabel = Number.isFinite(existingDays)
    ? `ימי עבודה קיימים: ${existingDays}`
    : 'ימי עבודה קיימים: —';
  const projectedLabel = Number.isFinite(projectedDays)
    ? `ימי עבודה לאחר שיבוץ זה: ${projectedDays}`
    : 'ימי עבודה לאחר שיבוץ זה: —';
  return [
    escapeHtml(distanceLabel(candidate)),
    escapeHtml(load),
    escapeHtml(`מפגשים שהוזזו: ${moved}`),
    escapeHtml(existingLabel),
    escapeHtml(projectedLabel)
  ].map((item) => `<span class="course-scheduling-candidate-meta-item">${item}</span>`).join('');
}

function primaryCandidateCardHtml(candidate, {
  kind = 'recommended',
  selectedId = '',
  expandedId = '',
  name = 'course-candidate'
} = {}) {
  const id = emp(candidate);
  const checked = id && id === selectedId ? ' checked' : '';
  const selected = id && id === selectedId ? ' is-selected' : '';
  const expanded = id && id === expandedId;
  const statusLabel = kind === 'recommended' ? 'recommended' : 'bestAvailable';
  // One clear text status only — no repeated equivalent pills or badges.
  const statusText = kind === 'recommended' ? 'מומלץ' : 'נדרשת בדיקה';
  const radioId = `course-candidate-primary-${escapeHtml(id || 'x')}`;
  return `<article class="course-scheduling-primary-card${selected}${expanded ? ' is-expanded' : ''}" data-candidate-row="${escapeHtml(id)}" data-candidate-kind="${statusLabel}" aria-expanded="${expanded}">
    <div class="course-scheduling-primary-card__body">
      <div class="course-scheduling-primary-card__topline">
        <span class="course-scheduling-primary-card__name">${escapeHtml(candidate.instructor?.full_name || id)}</span>
        <span class="course-scheduling-result-status${kind === 'recommended' ? ' is-positive' : ''}">${escapeHtml(kind === 'recommended' ? `מומלץ 1` : statusText)}</span>
      </div>
      ${candidateMetricsHtml(candidate)}
      <button type="button" class="course-scheduling-details-toggle" data-candidate-toggle aria-expanded="${expanded}">${expanded ? 'הסתר פירוט' : 'הצג פירוט'}</button>
      ${expanded ? `<div class="course-scheduling-candidate-expanded" data-candidate-expanded>
        <label class="course-scheduling-primary-card__select" for="${radioId}">
          <input id="${radioId}" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}> בחירת מדריך
        </label>
        ${requirementsFitHtml(candidate)}
        <div class="course-scheduling-primary-card__breakdown">${scoreComponentsHtml(candidate)}</div>
      </div>` : ''}
    </div>
  </article>`;
}

function candidateAltDistanceMeta(candidate) {
  const home = candidate?.travel?.home;
  const km = home?.distance_km;
  const minutes = home?.duration_minutes;
  if (km == null || !Number.isFinite(Number(km))) return '—';
  const kmStr = `${Math.round(Number(km))} ק״מ`;
  if (minutes != null && Number.isFinite(Number(minutes))) return `${kmStr} · ${Math.round(Number(minutes))} דק'`;
  return kmStr;
}

function alternativeCandidateCardHtml(candidate, { rank, selectedId = '', expandedId = '', name = 'course-candidate' } = {}) {
  const id = emp(candidate);
  const checked = id && id === selectedId ? ' checked' : '';
  const selected = id && id === selectedId ? ' is-selected' : '';
  const expanded = id && id === expandedId;
  const radioId = `course-candidate-alt-${escapeHtml(id || 'x')}`;
  return `<div class="cs-alt-row${selected}${expanded ? ' is-expanded' : ''}" data-candidate-row="${escapeHtml(id)}" aria-expanded="${expanded}">
    <span class="cs-alt-row__name">${escapeHtml(candidate.instructor?.full_name || id)}</span>
    <span class="cs-alt-row__score">מומלץ ${rank}</span>
    <div class="cs-alt-row__summary">${candidateMetricsHtml(candidate, { compact: true })}</div>
    <button type="button" class="course-scheduling-details-toggle" data-candidate-toggle aria-expanded="${expanded}">${expanded ? 'הסתר פירוט' : 'הצג פירוט'}</button>
    ${expanded ? `<div class="cs-alt-row__details course-scheduling-candidate-expanded" data-candidate-expanded>
      <label for="${radioId}"><input id="${radioId}" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}> בחירת מדריך</label>
      ${requirementsFitHtml(candidate)}
      <div class="course-scheduling-primary-card__breakdown">${scoreComponentsHtml(candidate)}</div>
    </div>` : ''}
  </div>`;
}

function conciseRejectionReason(candidate) {
  const reason = text(candidate?.failures?.[0]);
  if (!reason) return 'לא עומד בתנאי הסף';

  if (/מרחק|מגבלה של\s*40\s*ק[״"]?מ/.test(reason)) {
    const homeKm = Number(candidate?.travel?.home?.distance_km);
    const distanceFromReason = reason.match(/(\d+(?:\.\d+)?)\s*ק[״"]?מ/)?.[1];
    const km = Number.isFinite(homeKm) ? homeKm : Number(distanceFromReason);
    if (Number.isFinite(km)) return `מרחק מהבית ${Math.round(km)} ק״מ`;
  }
  if (/חפיפה/.test(reason)) return 'חפיפה עם פעילות קיימת';
  if (/מרחק בין הפעילויות/.test(reason)) return reason.match(/מרחק בין הפעילויות\s+\d+(?:\.\d+)?\s*ק[״"]?מ/)?.[0] || 'מרחק בין הפעילויות חורג מהמותר';
  if (/אין זמן מעבר מספיק|זמן מעבר.*(?:אינו|לא).*מספיק/.test(reason)) return 'אין מספיק זמן מעבר בין הפעילויות';
  if (/זמינות|זמין|פנוי|פנויה|שעות.*(?:אינן|לא).*מכס/.test(reason)) return 'לא זמין בשעות הקורס';
  if (/שפ(?:ת|ה)|עברית|ערבית/.test(reason)) return 'שפה לא מתאימה';
  if (/מגדר|דורש מדריכ|דרישת.*מדריכ/.test(reason)) return 'לא מתאים לדרישת המגדר';
  return reason
    .replace(/\s*-\s*משפיע על (?:מפגש אחד|\d+ מפגשים).*$/, '')
    .replace(/\s*\([^)]*(?:\d{2}:\d{2}|\d{4}-\d{2}-\d{2})[^)]*\).*$/, '')
    .trim() || 'לא עומד בתנאי הסף';
}

function rejectedCandidatesHtml(result) {
  // Hard threshold failures only — incomplete profiles (eligible:false, failures:[]) stay in incompleteProfilesHtml.
  const rejected = (result.checked || []).filter((candidate) => (candidate.failures || []).length);
  if (!rejected.length) return '';
  const incompleteIds = new Set((result.incompleteProfiles || []).map((candidate) => emp(candidate)).filter(Boolean));
  const rows = rejected.filter((candidate) => !incompleteIds.has(emp(candidate)));
  if (!rows.length) return '';
  return `<details class="course-scheduling-rejected" data-rejected-candidates><summary>לא עברו תנאי סף (${rows.length})</summary>
    <div class="course-scheduling-rejected-list">
      ${rows.map((candidate) => {
        const primary = conciseRejectionReason(candidate);
        return `<div class="course-scheduling-rejected-row" data-rejected-candidate="${escapeHtml(emp(candidate))}">
          <strong>${escapeHtml(candidate.instructor?.full_name || emp(candidate) || '—')}</strong>
          <div class="course-scheduling-rejected-row__details">
            <p class="course-scheduling-rejected-primary">${escapeHtml(primary)}</p>
          </div>
        </div>`;
      }).join('')}
    </div>
  </details>`;
}

export function manualCandidateConfirmationHtml(confirmation = null) {
  if (!confirmation) return '';
  const reasons = Array.isArray(confirmation.reasons) ? confirmation.reasons.filter(text) : [];
  return `<div class="course-scheduling-overlay" data-manual-candidate-confirmation>
    <div class="course-scheduling-modal" role="dialog" aria-modal="true" aria-labelledby="manual-candidate-confirmation-title">
      <h2 id="manual-candidate-confirmation-title">בחירת מדריך ידנית</h2>
      <p>המדריך שנבחר אינו עומד בכל תנאי ההתאמה לפעילות. האם להמשיך בכל זאת?</p>
      ${reasons.length ? `<div class="course-scheduling-alert" role="alert"><strong>סיבות אי־ההתאמה:</strong><ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>` : ''}
      <div class="course-scheduling-detail-actions">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-cancel-manual-candidate>חזרה</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-confirm-manual-candidate>המשך בבחירה ידנית</button>
      </div>
    </div>
  </div>`;
}

export function openManualCandidateConfirmation(state, candidate) {
  state.courseSchedulingManualConfirmation = {
    candidateId: emp(candidate),
    reasons: manualCandidateWarnings(candidate)
  };
}

export function closeManualCandidateConfirmation(state) {
  state.courseSchedulingManualConfirmation = null;
}

export function consumeManualCandidateConfirmation(state, candidates = []) {
  const candidateId = text(state.courseSchedulingManualConfirmation?.candidateId);
  closeManualCandidateConfirmation(state);
  return candidates.find((candidate) => emp(candidate) === candidateId) || null;
}

function manualCandidatePickerHtml(result, state = {}) {
  const candidates = (result?.manualCandidates || result?.checked || []).filter((candidate) => emp(candidate));
  if (!candidates.length) return '';
  const open = state.courseSchedulingManualPickerOpen === true;
  const query = text(state.courseSchedulingManualSearch).toLocaleLowerCase('he-IL');
  const visible = candidates.filter((candidate) => {
    const haystack = `${candidate.instructor?.full_name || ''} ${emp(candidate)}`.toLocaleLowerCase('he-IL');
    return !query || haystack.includes(query);
  });
  return `<section class="course-scheduling-manual-picker" data-manual-picker>
    <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-toggle-manual-picker>${open ? 'סגור בחירה ידנית' : 'בחר מדריך אחר'}</button>
    ${open ? `<div class="course-scheduling-manual-picker__panel">
      <input class="ds-input" type="search" value="${escapeHtml(state.courseSchedulingManualSearch || '')}" placeholder="חיפוש מדריך לפי שם" data-manual-candidate-search>
      <div class="course-scheduling-manual-picker__list">
        ${visible.length ? visible.map((candidate) => {
          const warnings = manualCandidateWarnings(candidate);
          const blocked = manualCandidateBlocked(candidate);
          return `<button type="button" class="course-scheduling-manual-candidate${blocked ? ' is-blocked' : ''}" data-manual-candidate="${escapeHtml(emp(candidate))}" data-manual-candidate-search-text="${escapeHtml(`${candidate.instructor?.full_name || ''} ${emp(candidate)}`.toLocaleLowerCase('he-IL'))}" ${blocked ? 'disabled' : ''}>
            <strong>${escapeHtml(candidate.instructor?.full_name || emp(candidate))}</strong>
            <span>${escapeHtml(warnings[0] || 'ניתן לבחור ידנית')}</span>
          </button>`;
        }).join('') : '<p class="ds-muted">לא נמצאו מדריכים בחיפוש.</p>'}
      </div>
    </div>` : ''}
  </section>`;
}

function proposedMeetingsPanelHtml(candidate) {
  if (!candidate) return '';
  const meetings = Array.isArray(candidate.proposedMeetings) ? candidate.proposedMeetings : [];
  const adjustmentMeetings = Array.isArray(candidate?.dateAdjustment?.meetings) ? candidate.dateAdjustment.meetings : meetings;
  const movedCount = Number(candidate.movedMeetingsCount)
    || Number(candidate?.dateAdjustment?.movedCount)
    || adjustmentMeetings.filter((meeting) => meeting?.moved).length;
  if (!meetings.length || !movedCount) {
    return `<p class="course-scheduling-meetings-unchanged" data-proposed-meetings>מועדי הפעילות נשארים ללא שינוי</p>`;
  }
  const rows = adjustmentMeetings.map((meeting, index) => {
    const moved = !!meeting.moved || text(meeting.original_date) !== text(meeting.date);
    const original = meeting.original_date || meeting.date || '';
    const proposed = meeting.date || '';
    const time = [meeting.start_time || meeting.start, meeting.end_time || meeting.end].filter(Boolean).join('–') || '—';
    return `<tr class="${moved ? 'is-moved' : ''}">
      <td>${index + 1}</td>
      <td><bdi dir="ltr">${escapeHtml(formatDateHe(original) || '—')}</bdi></td>
      <td><bdi dir="ltr">${escapeHtml(formatDateHe(proposed) || '—')}</bdi>${moved ? ' <span class="course-scheduling-moved-mark">הוזז</span>' : ''}</td>
      <td><bdi dir="ltr">${escapeHtml(time)}</bdi></td>
    </tr>`;
  }).join('');
  return `<section class="course-scheduling-meetings-panel" data-proposed-meetings>
    <h4>מועדי הפעילות</h4>
    <div class="course-scheduling-meetings-table-wrap">
      <table class="course-scheduling-meetings-table">
        <thead><tr><th>מפגש</th><th>מועד מקורי</th><th>מועד מוצע</th><th>שעה</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function halfOverflowWarningHtml(candidate) {
  if (!candidate?.halfOverflow && !candidate?.dateAdjustment?.exceedsHalf) return '';
  const originalEnd = candidate.originalEndDate || candidate?.dateAdjustment?.meetings?.map((row) => row.original_date || row.date).filter(Boolean).sort().at(-1) || '';
  const proposedEnd = candidate.proposedEndDate || candidate?.dateAdjustment?.newEndDate || '';
  return `<div class="course-scheduling-half-overflow" data-half-overflow role="alert">
    <p><b>אזהרה:</b> המועדים המוצעים חורגים מתקופת המחצית. בעת השיבוץ הסופי תידרש הסכמה מפורשת.</p>
    <p>תאריך סיום מקורי: <bdi dir="ltr">${escapeHtml(formatDateHe(originalEnd) || '—')}</bdi></p>
    <p>תאריך סיום מוצע: <bdi dir="ltr">${escapeHtml(formatDateHe(proposedEnd) || '—')}</bdi></p>
  </div>`;
}

function resultsActionsHtml(result, selectedId, state = {}) {
  const selected = [result.recommended, result.bestAvailable, ...(result.alternatives || []), ...(result.checked || [])]
    .filter(Boolean)
    .find((item) => emp(item) === selectedId);
  const note = selected
    ? `נבחרה: ${escapeHtml(selected.instructor?.full_name || selectedId)}`
    : 'בחרו מדריך כדי להמשיך';
  return `${selected ? proposedMeetingsPanelHtml(selected) : ''}
    ${selected ? halfOverflowWarningHtml(selected) : ''}
    <div class="course-scheduling-action-bar" data-selection-actions>
      <span class="course-scheduling-action-bar__selected" data-selection-note>${note}</span>
      <span class="course-scheduling-action-bar__sep" aria-hidden="true">|</span>
      <div class="course-scheduling-action-bar__buttons">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-assign-course disabled title="בחרו מדריך כשיר">${state.courseSchedulingReplacementCourseId ? 'אשר מדריך חדש' : 'שבץ מדריך'}</button>
        ${state.courseSchedulingReplacementCourseId ? '' : `<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-save-draft disabled title="בחרו מדריך כשיר">בחר הצעה</button>`}
        <button type="button" class="course-scheduling-text-btn" data-clear-candidate>ביטול</button>
      </div>
    </div>`;
}

function candidatesResultsLayoutHtml(result, state, { primary, kind }) {
  const selectedId = text(state.courseSchedulingSelectedCandidateId);
  const expandedId = text(state.courseSchedulingExpandedCandidateId);
  const radioName = `course-candidate-${idOf(result.course)}`;
  // The engine keeps the complete, stably ranked candidate set. The primary
  // results view intentionally presents only the next two eligible candidates.
  const alternatives = (result.alternatives || []).filter((item) => item?.eligible).slice(0, 2);
  return `<div class="course-scheduling-result-block" data-course-options>
    ${primaryCandidateCardHtml(primary, { kind, selectedId, expandedId, name: radioName })}
    ${alternatives.length ? `<section class="course-scheduling-alternatives" data-alternatives>
      <p class="course-scheduling-alternatives-label">מדריכים מומלצים נוספים</p>
      <div class="cs-alt-table">
        ${alternatives.map((item, index) => alternativeCandidateCardHtml(item, { rank: index + 2, selectedId, expandedId, name: radioName })).join('')}
      </div>
    </section>` : ''}
    ${rejectedCandidatesHtml(result)}
      ${resultsActionsHtml(result, selectedId, state)}
  </div>`;
}

function incompleteProfilesHtml(result) {
  const incomplete = result?.incompleteProfiles || [];
  if (!incomplete.length) return '';
  return `<details class="course-scheduling-details" open><summary>פרופילים חסרים להשלמה</summary>
    ${incomplete.map((candidate) => {
      const issues = (candidate.issues || []).filter((issue) => issue.missing);
      const issuePrefixes = issues.map((issue) => issue.message);
      // Keep short field labels only; issue summaries are rendered once below with dates.
      const missing = (candidate.missingProfileData || []).filter((item) => {
        if (item === 'כתובת') return false;
        return !issuePrefixes.some((prefix) => text(item).startsWith(prefix));
      });
      return `<div class="course-scheduling-incomplete-profile">
        <p><b>${escapeHtml(candidate.instructor?.full_name || '—')} | ${escapeHtml(emp(candidate))}</b></p>
        ${text(candidate.instructor?.address) ? `<p>${escapeHtml(candidate.instructor.address)}</p>` : ''}
        ${missing.length ? `<p><b>חסר להשלמה:</b> ${escapeHtml(missing.join(' · '))}</p>` : ''}
        ${issues.map((issue) => `<p>${escapeHtml(issue.message)} - ${escapeHtml(formatAffectedMeetingsPhrase(issue.dates.length))}<br>${issue.dates.map((date) => escapeHtml(date)).join(', ')}</p>`).join('')}
      </div>`;
    }).join('')}
  </details>`;
}

export function instructorsResultsHtml(result, state = {}) {
  if (!result?.recommended && result?.status === 'חסר מידע') {
    return `<div class="course-scheduling-result-block">
      <h3>חסרים פרטים לפעילות זו</h3>
      <p>${escapeHtml((result.missing || []).join(' · ') || 'יש להשלים פרטים בפעילות לפני שיבוץ.')}</p>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות לתיקון</button>
    </div>`;
  }
  if (!result?.recommended && result?.bestAvailable) {
    return candidatesResultsLayoutHtml(result, state, { primary: result.bestAvailable, kind: 'bestAvailable' });
  }
  if (!result?.recommended && result?.status === 'נדרש גיוס') {
    return `<div class="course-scheduling-result-block course-scheduling-result-block--negative">
      <p class="course-scheduling-result-message">לא נמצא מדריך מתאים</p>
      <details class="course-scheduling-details"><summary>הצג פרטים</summary>
        ${result.treatmentReason ? `<p>${escapeHtml(result.treatmentReason)}</p>` : ''}
        <p>שפת הדרכה: ${escapeHtml(instructionLanguageLabel(result.course))} · מגדר: ${escapeHtml(result.course.required_instructor_gender || 'ללא')}</p>
        ${rejectedCandidatesHtml(result)}
      </details>
      ${manualCandidatePickerHtml(result, state)}
    </div>`;
  }
  if (!result?.recommended && result?.status === 'נדרש טיפול') {
    return `<div class="course-scheduling-result-block">
      <p class="course-scheduling-result-message">${escapeHtml(result.treatmentReason || 'נדרשת בדיקה נוספת לפני שניתן להציע שיבוץ אוטומטי.')}</p>
      ${incompleteProfilesHtml(result)}
      ${rejectedCandidatesHtml(result)}
      ${manualCandidatePickerHtml(result, state)}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות</button>
    </div>`;
  }
  if (!result?.recommended) return '';
  return candidatesResultsLayoutHtml(result, state, { primary: result.recommended, kind: 'recommended' });
}

/** Compatibility export used by focused engine/UI tests. */
export function detailsHtml(result, state = {}) {
  return instructorsResultsHtml(result, state);
}

function loadingInstructorsHtml(step = 1) {
  const steps = [
    { key: 1, label: 'בדיקת זמינות' },
    { key: 2, label: 'בדיקת התאמה' },
    { key: 3, label: 'בדיקת מרחקים' }
  ];
  return `<div class="course-scheduling-loading" aria-live="polite">
    <strong>בודק מדריכים מתאימים...</strong>
    <ul class="course-scheduling-progress">
      ${steps.map((item) => `<li class="${step >= item.key ? 'is-active' : ''}${step > item.key ? ' is-done' : ''}">${escapeHtml(item.label)}</li>`).join('')}
    </ul>
  </div>`;
}

function draftProposedMeetingsFromCourse(course = {}) {
  const proposed = Array.isArray(course.draft_proposed_meetings) ? course.draft_proposed_meetings : [];
  if (!proposed.length) return null;
  const official = activityMeetings(course);
  const meetings = proposed.map((row, index) => {
    const original = official[index]?.date || row.original_date || '';
    const date = text(row.date || row);
    return {
      ...row,
      date,
      original_date: text(original) || date,
      moved: !!original && text(original) !== date,
      start_time: row.start_time || course.start_time,
      end_time: row.end_time || course.end_time
    };
  });
  const movedCount = meetings.filter((meeting) => meeting.moved).length;
  const newEndDate = meetings.map((meeting) => meeting.date).filter(Boolean).sort().at(-1) || '';
  const period = resolveCourseSchedulingPeriod(course.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY);
  return {
    proposedMeetings: meetings,
    dateAdjustment: {
      meetings,
      movedCount,
      newEndDate,
      exceedsHalf: !!period.end && !!newEndDate && newEndDate > period.end,
      label: 'מועדים מוצעים בטיוטה',
      reason: 'הטיוטה שומרת מועדים מוצעים עד לאישור סופי'
    },
    movedMeetingsCount: movedCount,
    halfOverflow: !!period.end && !!newEndDate && newEndDate > period.end,
    proposedEndDate: newEndDate,
    originalEndDate: official.map((meeting) => meeting.date).filter(Boolean).sort().at(-1) || ''
  };
}

function draftDetailHtml(course) {
  const proposed = draftProposedMeetingsFromCourse(course);
  return `<p class="course-scheduling-status-chip is-draft">${STATUS.draft}</p>
    <p>מדריך בטיוטה: <b>${escapeHtml(course.draft_instructor_name || course.draft_emp_id)}</b></p>
    <p class="course-scheduling-muted">הטיוטה שומרת את השיבוץ המוצע ואינה מעדכנת את הפעילות עד לאישור.</p>
    ${proposed ? proposedMeetingsPanelHtml(proposed) : ''}
    ${proposed ? halfOverflowWarningHtml(proposed) : ''}
    <div class="course-scheduling-detail-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-confirm-draft>שבץ מדריך</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-cancel-draft>בטל בחירה</button>
    </div>`;
}

export function assignedDetailHtml(row, state = {}) {
  const c = row.course;
  const completed = meetingsCompletedForCourse(c, state.meetingState);
  const history = state.courseSchedulingMeetingHistory?.[row.id] || [];
  const substituteAccess = singleMeetingSubstitutionAccess(state?.user || {});
  const substituteAction = substituteAccess.allowed
    ? `<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-single-substitute>${substituteAccess.canDirect ? 'החלפה חד־פעמית' : 'בקשת החלפה חד־פעמית'}</button>`
    : '';
  return `<p class="course-scheduling-status-chip is-ready">${STATUS.assigned}</p>
    <p>מדריך משובץ: <b>${escapeHtml(c.instructor_name || c.emp_id)}</b></p>
    <p><b>${escapeHtml(c.activity_name || '—')}</b> · ${escapeHtml(c.school || '—')} · ${escapeHtml(c.authority || '—')}</p>
    <p>${courseDayTimeHtml(c)} · ${compactMeetingsHtml(c)}</p>
    ${completed == null ? '' : `<p>מפגשים שהתקיימו: <b>${completed}</b></p>`}
    ${meetingInstructorHistoryHtml(history, state.courseSchedulingReplacements?.[row.id] || [], state.courseSchedulingSingleSubstitutions?.[row.id] || [])}
    <div class="course-scheduling-detail-actions">
      ${substituteAction}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-change-assignment>שינוי / החלפת מדריך</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-cancel-assignment>ביטול שיבוץ</button>
    </div>`;
}

function singleMeetingSubstitutionModalHtml(data = {}, state = {}) {
  const courseId = text(state.courseSchedulingSingleSubstitutionCourseId);
  if (!courseId) return '';
  const substituteAccess = singleMeetingSubstitutionAccess(state?.user || {});
  if (!substituteAccess.allowed) return '';
  const course = (data.activities || []).find((item) => idOf(item) === courseId) || {};
  const meetings = activityMeetings(course);
  const selectedDate = text(state.courseSchedulingSingleSubstitutionDate);
  const substitutions = state.courseSchedulingSingleSubstitutions?.[courseId] || [];
  const currentSubstitution = substitutions.find((row) => text(row.meeting_date) === selectedDate) || null;
  const currentPrimaryIds = new Set([text(course.emp_id), text(course.emp_id_2)].filter(Boolean));
  const activeInstructors = activeSchedulingInstructors(data.instructors || [])
    .filter((instructor) => !currentPrimaryIds.has(text(instructor.emp_id)))
    .sort((a, b) => text(a.full_name).localeCompare(text(b.full_name), 'he'));
  const meetingOptions = meetings.map((meeting, index) => {
    const meetingNo = Number(meeting.meeting_no) || index + 1;
    const date = text(meeting.date);
    const timeLabel = formatTimeRangeShort(meeting.start_time || course.start_time, meeting.end_time || course.end_time);
    const label = `מפגש ${meetingNo} · ${formatDateHeDots(date)} · ${timeLabel}`;
    return `<option value="${escapeHtml(date)}"${date === selectedDate ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
  const instructorOptions = activeInstructors.map((instructor) => {
    const instructorId = text(instructor.emp_id);
    return `<option value="${escapeHtml(instructorId)}"${instructorId === text(state.courseSchedulingSingleSubstitutionEmpId) ? ' selected' : ''}>${escapeHtml(instructor.full_name || instructorId)}</option>`;
  }).join('');
  const approvalNote = substituteAccess.canRequest
    ? '<p class="course-scheduling-alert" role="note"><b>נדרש אישור אדמין או תפעול.</b> השינוי יבוצע רק לאחר אישור הבקשה.</p>'
    : '';
  const clearLabel = substituteAccess.canDirect ? 'בטל החלפה' : 'בקש ביטול החלפה';
  const saveLabel = substituteAccess.canDirect ? 'שמור החלפה' : 'שלח בקשה לעדכון';
  return `<div class="course-scheduling-overlay" data-single-substitute-overlay>
    <div class="course-scheduling-modal" role="dialog" aria-modal="true" aria-labelledby="single-substitute-title">
      <h2 id="single-substitute-title">${substituteAccess.canDirect ? 'החלפה חד־פעמית' : 'בקשת החלפה חד־פעמית'}</h2>
      <p><b>${escapeHtml(course.activity_name || '—')}</b> · ${escapeHtml(course.school || '—')}</p>
      <p class="course-scheduling-muted">המדריך הקבוע נשאר ${escapeHtml(course.instructor_name || course.emp_id || '—')}. ההחלפה תחול רק על המפגש שתבחרו.</p>
      ${approvalNote}
      <label>מפגש *
        <select class="course-scheduling-input" data-single-substitute-date>
          <option value="">בחרו מפגש</option>${meetingOptions}
        </select>
      </label>
      ${currentSubstitution ? `<p class="course-scheduling-success">במפגש זה מוגדרת כרגע החלפה: <b>${escapeHtml(currentSubstitution.instructor_name || currentSubstitution.emp_id)}</b></p>` : ''}
      <label>מדריך מחליף *
        <select class="course-scheduling-input" data-single-substitute-emp>
          <option value="">בחרו מדריך</option>${instructorOptions}
        </select>
      </label>
      <div class="course-scheduling-detail-actions">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-close-single-substitute>חזרה</button>
        ${currentSubstitution ? `<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-clear-single-substitute>${clearLabel}</button>` : ''}
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-save-single-substitute>${saveLabel}</button>
      </div>
    </div>
  </div>`;
}
function selectedCoursePanelHtml(row, state) {
  if (!row) {
    return `<div class="course-scheduling-empty course-scheduling-empty--center">
      <strong>בחרו פעילות כדי להתחיל</strong>
      <p>בחרו פעילות מהרשימה כדי לראות פרטים ולמצוא מדריכים מתאימים.</p>
    </div>`;
  }
  if (row.isAssigned && state.courseSchedulingReplacementCourseId !== row.id) return assignedDetailHtml(row, state);
  if (row.hasDraft) return draftDetailHtml(row.course);

  const finding = !!state.courseSchedulingLoading;
  const result = row.result;
  const hasSuggestion = !!result?.recommended;
  const findButtonClass = hasSuggestion
    ? 'course-scheduling-btn course-scheduling-btn--secondary'
    : 'course-scheduling-btn course-scheduling-btn--primary course-scheduling-btn--xl';
  const replacementMeetings = Number(state.courseSchedulingReplacementMeetings) || 0;
  const replacementControls = state.courseSchedulingReplacementCourseId === row.id ? `<div class="course-scheduling-alert" role="alert">
      <b>${replacementMeetings >= 2 ? 'החלפת מדריך עקב צורך תפעולי' : 'שינוי מדריך'}</b>
      ${replacementMeetings === 1 ? '<p>כבר התקיים מפגש. נדרשת סיבה לשינוי.</p>' : ''}
      <label>סיבה${replacementMeetings ? ' *' : ''}<textarea class="course-scheduling-input" data-replacement-reason>${escapeHtml(state.courseSchedulingReplacementReason || '')}</textarea></label>
      ${replacementMeetings >= 2 ? `<label>תאריך כניסה לתוקף *<input class="course-scheduling-input" type="date" data-replacement-effective-from value="${escapeHtml(state.courseSchedulingReplacementEffectiveFrom || '')}"></label><label><input type="checkbox" data-replacement-confirm ${state.courseSchedulingReplacementConfirmed ? 'checked' : ''}> אני מאשר/ת את ההחלפה התפעולית</label>` : ''}
    </div>` : '';
  return `${replacementControls}<div class="course-scheduling-primary-action">
      <button type="button" class="${findButtonClass}" data-find-instructors ${finding ? 'disabled' : ''}>
        ${finding ? 'בודק מדריכים...' : (hasSuggestion ? 'בדיקה מחדש של מדריכים' : 'מצא מדריכים מתאימים')}
      </button>
    </div>
    ${finding ? loadingInstructorsHtml(state.courseSchedulingProgressStep || 1) : instructorsResultsHtml(result, state)}`;
}

function maintenanceTabHtml(state) {
  const distanceBusy = !!state.courseSchedulingDistanceLoading;
  const coverageLoading = !!state.courseSchedulingDistanceCoverageLoading;
  const stats = state.courseSchedulingDistanceStats || {};
  const count = (key) => coverageLoading && stats[key] == null ? '…' : Number(stats[key]) || 0;
  const doneMessage = text(state.courseSchedulingDistanceDoneMessage);
  const doneError = !!state.courseSchedulingDistanceError;
  const updateDisabled = distanceBusy || coverageLoading;
  return `<section class="course-scheduling-maintenance-tab" aria-labelledby="course-scheduling-maintenance-heading">
    <h2 id="course-scheduling-maintenance-heading" class="course-scheduling-visually-hidden">פעולות תחזוקה</h2>
    <article class="course-scheduling-maintenance-card">
      <div>
        <h3>עדכון מסלולי בסיס</h3>
        <p class="course-scheduling-maintenance-note">הספירה מתייחסת למסלולי הבסיס שנבנו מראש. מסלולי מעבר נוספים בין פעילויות נבדקים לפי הצורך בזמן השיבוץ.</p>
        <div class="course-scheduling-distance-coverage">
          <p>נדרשים: ${count('required_count')}</p>
          <p>קיימים: ${count('existing_count')}</p>
          <p>חסרים: ${count('missing_count')}</p>
          <p>דורשים רענון: ${count('refresh_required_count')}</p>
          <button type="button" class="course-scheduling-distance-refresh" data-refresh-distance-coverage aria-label="רענון נתוני מצב" title="רענון נתוני מצב" ${coverageLoading || distanceBusy ? 'disabled' : ''}>↻</button>
        </div>
        ${doneMessage ? `<p class="${doneError ? 'course-scheduling-alert' : 'course-scheduling-success'}">${escapeHtml(doneMessage)}</p>` : ''}
      </div>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-update-distances ${updateDisabled ? 'disabled' : ''}>${distanceBusy ? 'מעדכן מסלולי בסיס...' : 'עדכון מסלולי בסיס'}</button>
    </article>
  </section>`;
}

function calendarTabHtml({ interfaceCourses, selectedId, state }) {
  const anchor = state.courseSchedulingWeek || today();
  const { start, end, days } = weekRange(anchor);
  const view = state.courseSchedulingCalendarView === 'fixed' ? 'fixed' : 'week';
  const weekRows = buildWeekRows(interfaceCourses, days);
  let calendarBody = view === 'fixed'
    ? fixedScheduleHtml(interfaceCourses, selectedId)
    : weekCalendarHtml({ days, rows: weekRows, selectedCourseId: selectedId });

  const isEmptyWeek = calendarBody.includes('course-scheduling-calendar-empty');
  if (isEmptyWeek) {
    calendarBody = `<div class="course-scheduling-empty-wrap">
      <div class="course-scheduling-empty course-scheduling-empty--compact course-scheduling-calendar-empty">
        <strong>אין שיבוצים בשבוע זה</strong>
        <p>שיבוצים שבוצעו במסך "פעילויות לשיבוץ" יופיעו כאן.</p>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-empty-action" data-switch-tab="courses">מעבר לפעילויות לשיבוץ</button>
      </div>
    </div>`;
  }

  return `<section class="course-scheduling-calendar-pane${isEmptyWeek ? ' course-scheduling-calendar-pane--empty' : ''}">
    <div class="course-scheduling-calendar-toolbar">
      <div class="course-scheduling-calendar-toolbar-nav">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-week-nav="prev">השבוע הקודם</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-week-nav="today">היום</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-week-nav="next">השבוע הבא</button>
      </div>
      <div class="course-scheduling-calendar-toolbar-center">
        <input class="course-scheduling-input" type="date" data-week-pick value="${escapeHtml(start)}" aria-label="בחירת תאריך">
        <span class="course-scheduling-calendar-label">${weekNavLabel({ start, end })}</span>
      </div>
      <div class="course-scheduling-calendar-toolbar-views">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--sm${view === 'week' ? ' course-scheduling-btn--primary' : ' course-scheduling-btn--secondary'}" data-calendar-view="week">תצוגה שבועית</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--sm${view === 'fixed' ? ' course-scheduling-btn--primary' : ' course-scheduling-btn--secondary'}" data-calendar-view="fixed">מערכת קבועה</button>
      </div>
    </div>
    ${calendarBody}
  </section>`;
}

export function meetingInstructorHistoryHtml(meetingRows, replacements, singleSubstitutions = []) {
  if (!meetingRows?.length) return '';
  const effectiveDates = new Set((replacements || []).map((row) => text(row.effective_from)));
  const singleDates = new Set((singleSubstitutions || []).map((row) => text(row.meeting_date)));
  const rows = meetingRows.map((row) => {
    const isEffectiveFrom = effectiveDates.has(text(row.meeting_date));
    const isSingleSubstitution = singleDates.has(text(row.meeting_date));
    const marker = isSingleSubstitution
      ? ' <span class="course-scheduling-status-chip">החלפה חד־פעמית</span>'
      : (isEffectiveFrom ? ' <span class="course-scheduling-status-chip">מכאן ואילך</span>' : '');
    return `<tr><td><bdi dir="ltr">${escapeHtml(formatDateHe(row.meeting_date))}</bdi></td><td>${escapeHtml(row.instructor_name || row.emp_id || '—')}${marker}</td></tr>`;
  }).join('');
  return `<details class="course-scheduling-details"><summary>הצגת פרטים — מדריך לפי מפגש</summary>${dsTableWrap(`<table class="ds-table"><thead><tr><th>תאריך</th><th>מדריך</th></tr></thead><tbody>${rows}</tbody></table>`)}</details>`;
}

function clickActivityRowWhenReady(rowId, attempts = 40) {
  const tryOpen = () => {
    const row = [...document.querySelectorAll('.ds-data-row')].find((node) => text(node.dataset.rowId) === text(rowId));
    if (row) {
      try { sessionStorage.removeItem(PENDING_ACTIVITY_STORAGE_KEY); } catch { /* storage may be unavailable */ }
      row.click();
      return;
    }
    if (attempts > 0) setTimeout(() => clickActivityRowWhenReady(rowId, attempts - 1), 125);
  };
  setTimeout(tryOpen, 0);
}

function distanceDoneMessage(stats = {}, { done = false, stopped = false, errorMessage = '' } = {}) {
  if (errorMessage) return { message: 'עדכון המרחקים נכשל', details: errorMessage, error: true };
  const remaining = (Number(stats.missing_count) || 0) + (Number(stats.refresh_required_count) || 0);
  if (stopped) return { message: 'עדכון המרחקים הופסק', details: '', error: false };
  if (done && remaining > 0) return { message: `נותרו ${remaining} מסלולים לעדכון`, details: '', error: true };
  if (done) return { message: 'כל מסלולי הבסיס מעודכנים', details: '', error: false };
  const processed = (Number(stats.inserted_count) || 0) + (Number(stats.renewed_count) || 0) + (Number(stats.failed_count) || 0);
  const total = Number(stats.action_required_count) || processed + remaining;
  return { message: `מעדכן ${processed} מתוך ${total}...`, details: '', error: false };
}

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling, meetingState, schoolLocations, schoolCalendar, authResult, planningCatalogResult] = await Promise.all([
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true, select: 'row_id,district,authority_id,authority,school,school_id,activity_name,catalog_slug,activity_no,proposal_item_id,activity_type,item_type,activity_season,grade,education_level,class_group,sessions,start_time,end_time,instruction_language,required_instructor_gender,scheduling_note,instructor_assignment_status,instructor_assignment_locked,draft_emp_id,draft_instructor_name,draft_created_at,draft_proposed_meetings,emp_id,instructor_name,emp_id_2,instructor_name_2,start_date,end_date,status,date_1,date_2,date_3,date_4,date_5,date_6,date_7,date_8,date_9,date_10,date_11,date_12,date_13,date_14,date_15,date_16,date_17,date_18,date_19,date_20,date_21,date_22,date_23,date_24,date_25,date_26,date_27,date_28,date_29,date_30,date_31,date_32,date_33,date_34,date_35,updated_at' }),
      api.instructorContacts(),
      loadInstructorSchedulingData(),
      loadCourseMeetingState(),
      supabase.rpc('scheduling_authority_school_locations'),
      loadSchoolCalendarRows(),
      supabase.auth.getSession(),
      supabase
        .from('proposal_activity_pricing')
        .select('activity_name,activity_no,gefen_number,pricing_key,program_name,name,title,meetings_count,hours_count,unit_duration,is_active_for_proposals')
    ]);
    const schoolRows = schoolLocations?.data || [];
    const schoolAddressLookupError = schoolLocations?.error
      ? translateSchedulingRouteError('school_address_lookup_failed')
      : '';
    const enriched = enrichActivitiesWithSchoolAddresses(activities?.rows || [], schoolRows);
    return {
      activities: attachCancelledMeetingsToActivities(enriched.activities, meetingState),
      instructors: activeSchedulingInstructors(contacts?.rows || []),
      scheduling,
      meetingState,
      schoolLocations: schoolRows,
      schoolCalendar,
      planningCatalog: planningCatalogResult?.error ? [] : (planningCatalogResult?.data || []),
      authSession: (() => {
        const session = authResult?.data?.session;
        if (!session?.user?.id) return null;
        let sessionId = '';
        try {
          const payload = JSON.parse(atob(session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/')));
          sessionId = text(payload.session_id);
        } catch { /* an opaque/invalid token must not enable snapshot restore */ }
        return { user: { id: session.user.id }, sessionId };
      })(),
      schoolAddressStats: {
        uniqueSchoolCount: enriched.uniqueSchoolCount,
        duplicateSchoolCount: enriched.duplicateSchoolCount,
        missingCount: enriched.missingCount
      },
      schoolAddressLookupError,
      reloadPlanningSnapshot: () => courseSchedulingScreen.load({ api })
    };
  },

  onLeave({ state } = {}) {
    cancelCourseSchedulingPlanning(state);
  },

  render(data, { state }) {
    ensureCourseSchedulingStyles();
    if (state.courseSchedulingTab === 'planning' || state.courseSchedulingTab === 'calendar') {
      state.courseSchedulingTab = 'courses';
    }
    if (state.courseSchedulingTab !== 'maintenance') {
      state.courseSchedulingSimulationView = false;
      state.courseSchedulingSimulationConfirmSave = false;
    }
    const requiredPermission = activeTab(state) === 'maintenance' ? 'manage_instructor_maintenance' : 'view_operations_scheduling';
    if (!hasPermission(state?.user, requiredPermission)) {
      return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בשיבוץ פעילויות.'));
    }

    state.meetingState = data.meetingState;
    const allInterfaceCourses = schedulingWorkspaceCourses(data.activities || []);
    const interfaceCourses = filteredInterfaceCourses(allInterfaceCourses, state);
    restoreCalculationSnapshot(state, interfaceCourses, schedulingSnapshotContext(data));
    const results = state.courseSchedulingResults || [];
    const resultByCourseId = new Map(results.map((result) => [idOf(result.course), result]));
    const tab = activeTab(state);
    const selectedId = state.courseSchedulingSelectedId || '';
    const activePlanningPeriodKey = planningPeriodKey(state);
    const planningRows = state.courseSchedulingPlanningRows?.length
      ? state.courseSchedulingPlanningRows
      : buildPlanningOverviewRows({
          activities: data.activities || [],
          catalog: data.planningCatalog || [],
          district: state.courseSchedulingPlanningDistrict || '',
          periodKey: activePlanningPeriodKey
        });
    const planningByCourseId = new Map(planningRows.map((row) => [text(row?.courseId), row]));
    const completionRows = buildPlanningCompletionRows({
      activities: data.activities || [],
      planningRows
    });
    const rowModels = interfaceCourses.map((course) => courseRowModel(course, resultByCourseId, planningByCourseId));
    const selectedRow = rowModels.find((row) => row.id === selectedId)
      || (selectedId
        ? courseRowModel(
            interfaceCourses.find((course) => idOf(course) === selectedId) || { row_id: selectedId },
            resultByCourseId,
            planningByCourseId
          )
        : null);

    return dsScreenStack(`${instructorsWorkspaceNavStylesHtml()}
    <div class="course-scheduling-screen is-compact-symmetric-layout is-simple-workboard" dir="rtl" data-cs-ui="simple-workboard-20260924-v1" data-cs-tab="${escapeHtml(tab)}">
      ${instructorsWorkspaceHeaderHtml({
        activeTab: tab === 'maintenance' ? 'maintenance' : 'scheduling',
        state
      })}

      ${tab === 'maintenance'
        ? maintenanceTabHtml(state)
        : `${schedulingScopeHtml(allInterfaceCourses, state, data.activities || [])}
      ${schedulingPlanningStatusHtml(state)}
      <section class="course-scheduling-summary">${summaryCardsHtml(rowModels)}</section>
      ${state.courseSchedulingPlanningSharedLoaded && !state.courseSchedulingPlanningLoading && !state.courseSchedulingPlanningStale
        ? planningCompletionOverviewHtml(completionRows, {
            pendingChanges: (state.courseSchedulingPlanningAffectedIds || []).length,
            schoolYearTotal: allInterfaceCourses.length
          })
        : ''}
      <p data-course-scheduling-error class="course-scheduling-alert"${state.courseSchedulingError ? '' : ' hidden'}>${escapeHtml(state.courseSchedulingError || '')}</p>
      <div class="course-scheduling-layout course-scheduling-layout--courses">
        <aside class="course-scheduling-courses">${courseListHtml(rowModels, selectedId, state)}</aside>
        <section class="course-scheduling-detail${selectedId ? ' is-open' : ''}" data-course-detail>${
          selectedId && selectedRow?.course
            ? selectedCoursePanelHtml(selectedRow, state)
            : ''
        }</section>
      </div>`}
    ${singleMeetingSubstitutionModalHtml(data, state)}
    ${state.courseSchedulingCancelCourseId ? (() => {
      const course = (data.activities || []).find((item) => idOf(item) === state.courseSchedulingCancelCourseId) || {};
      const completed = meetingsCompletedForCourse(course, data.meetingState) || 0;
      return `<div class="course-scheduling-overlay" data-cancel-assignment-overlay><div class="course-scheduling-modal" role="dialog" aria-modal="true"><h2>ביטול שיבוץ מדריך</h2><p><b>${escapeHtml(course.instructor_name || course.emp_id)}</b></p><p>${escapeHtml(course.activity_name || '—')} · ${escapeHtml(course.school || '—')}</p>${completed ? '<p class="course-scheduling-alert">הביטול יחול על המשך הפעילות. היסטוריית המפגשים הקודמים תישמר.</p>' : ''}<label>סיבת הביטול *<textarea class="course-scheduling-input" data-cancel-assignment-reason>${escapeHtml(state.courseSchedulingCancelReason || '')}</textarea></label><div class="course-scheduling-detail-actions"><button class="course-scheduling-btn course-scheduling-btn--secondary" data-close-cancel-assignment>חזרה</button><button class="course-scheduling-btn course-scheduling-btn--primary" data-confirm-cancel-assignment>בטל שיבוץ</button></div></div></div>`;
    })() : ''}
    ${manualCandidateConfirmationHtml(state.courseSchedulingManualConfirmation)}
    </div>`);
  },

  bind({ root, data, state, rerender, clearScreenDataCache }) {
    schedulingScreenActive = true;
    const canEdit = hasPermission(state?.user, activeTab(state) === 'maintenance' ? 'manage_instructor_maintenance' : 'view_operations_scheduling');
    const substituteAccess = singleMeetingSubstitutionAccess(state?.user || {});
    const resultByCourseId = new Map((state.courseSchedulingResults || []).map((result) => [idOf(result.course), result]));
    const allInterfaceCourses = schedulingWorkspaceCourses(data.activities || []);
    const interfaceCourses = filteredInterfaceCourses(allInterfaceCourses, state);
    // Include all loaded activities so district draft-save can validate courses outside the authority filter.
    const courseById = new Map(
      (data.activities || [])
        .map((course) => [idOf(course), course])
        .filter(([id]) => !!id)
    );
    bindInstructorsWorkspaceNav(root, { state, rerender });
    const invokeDistanceRoute = (body) => supabase.functions.invoke('scheduling-route', { body });

    const restoreWorkboardScroll = () => {
      const saved = state.courseSchedulingWorkboardScroll;
      if (!saved) return;
      state.courseSchedulingWorkboardScroll = null;
      const list = root.querySelector('.course-scheduling-courses');
      if (list && Number.isFinite(Number(saved.listTop))) list.scrollTop = Number(saved.listTop);
      if (typeof window !== 'undefined' && Number.isFinite(Number(saved.windowY))) {
        const restore = () => window.scrollTo({ top: Number(saved.windowY), behavior: 'auto' });
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
        else setTimeout(restore, 0);
      }
    };
    restoreWorkboardScroll();

    const rerenderPreservingWorkboardScroll = () => {
      const list = root.querySelector('.course-scheduling-courses');
      state.courseSchedulingWorkboardScroll = {
        listTop: Number(list?.scrollTop) || 0,
        windowY: typeof window !== 'undefined' ? Number(window.scrollY || window.pageYOffset) || 0 : 0
      };
      rerender();
    };

    const updatePlanningStatusInPlace = () => {
      const status = root.querySelector('[data-planning-status]');
      const message = status?.querySelector('[data-planning-status-message]');
      if (!status || !message) return;
      const progress = state.courseSchedulingPlanningProgress || {};
      const total = Number(progress.total) || 0;
      const completed = Number(progress.completed) || 0;
      const phase = text(progress.phase);
      status.classList.remove('is-ready', 'is-warning', 'is-error');
      status.classList.add('is-working');
      status.setAttribute('aria-busy', 'true');
      message.textContent = total
        ? `${phase || 'המערכת מעדכנת את סידור העבודה'} · ${completed} מתוך ${total}. אפשר להמשיך לעבוד במסך.`
        : `${phase || 'המערכת מעדכנת את סידור העבודה'}… אפשר להמשיך לעבוד במסך.`;
    };

    const scheduleBackgroundPlanning = ({ forceFull = false } = {}) => {
      if (data._planningBackgroundScheduled || state.courseSchedulingPlanningLoading) return;
      data._planningBackgroundScheduled = true;
      scheduleCoursePlanningStart({
        start: () => {
          data._planningBackgroundScheduled = false;
          void runCoursePlanning({ forceFull });
        },
        isActive: () => schedulingScreenActive && state.route === 'course-scheduling' && root.isConnected,
        onCancel: () => { data._planningBackgroundScheduled = false; }
      });
    };

    const planningScope = () => {
      const periodKey = DEFAULT_PLANNING_PERIOD_KEY;
      const district = '';
      state.courseSchedulingPlanningPeriodKey = periodKey;
      state.courseSchedulingPlanningDistrict = district;
      return { periodKey, district, key: `${periodKey}|${district}` };
    };

    const planningInputFromSnapshot = (snapshot, periodKey = planningPeriodKey(state)) => ({
      activities: snapshot?.activities || [],
      instructors: snapshot?.instructors || [],
      profiles: snapshot?.scheduling?.profiles || [],
      rules: snapshot?.scheduling?.rules || [],
      exceptions: snapshot?.scheduling?.exceptions || [],
      schoolCalendar: snapshot?.schoolCalendar || [],
      catalog: snapshot?.planningCatalog || [],
      periodKey
    });

    const formatPlanningSavedAt = (value) => {
      if (!value) return '';
      try {
        return new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
      } catch {
        return text(value);
      }
    };

    const applySharedPlanningState = (shared, snapshot = data) => {
      const scope = planningScope();
      const currentCourses = planningWorkspaceCourses(
        snapshot?.activities || [],
        scope.district,
        scope.periodKey
      );
      const currentCourseIds = currentCourses.map((course) => idOf(course));
      const contextFingerprint = planningContextFingerprint(planningInputFromSnapshot(snapshot, scope.periodKey));
      const workspace = shared?.workspace || null;
      const engineChanged = !!workspace && text(workspace.engineVersion) !== PLANNING_ENGINE_VERSION;
      const inputChanged = !!workspace && text(workspace.contextFingerprint) !== contextFingerprint;
      const contextChanged = engineChanged || inputChanged;
      const affectedIds = workspace
        ? sharedPlanningAffectedCourseIds({
            shared,
            activities: snapshot?.activities || [],
            currentCourseIds,
            contextChanged
          })
        : currentCourseIds;

      const sharedRows = (shared?.rows || [])
        .filter((entry) => currentCourseIds.includes(text(entry.activityId)))
        .map((entry) => {
          if (entry.lockedOption) return applyPlanningLockToRow(entry.row, entry.lockedOption, scope.periodKey);
          if (entry.needsRecalc === true && entry.row?.planningLocked) {
            return {
              ...entry.row,
              planningLocked: false,
              kind: 'proposal',
              status: 'ממתין לעדכון תכנון',
              reason: 'הבחירה שוחררה ונשמרה במערכת המשותפת. הפעילות תתעדכן בהרצה המצומצמת הבאה.'
            };
          }
          return entry.row;
        });
      state.courseSchedulingPlanningStale = contextChanged;
      state.courseSchedulingPlanningStaleReason = engineChanged
        ? 'גרסת מנוע התכנון השתנתה מאז החישוב האחרון'
        : (inputChanged ? 'נתוני הפעילויות, הזמינות או כללי התכנון השתנו מאז החישוב האחרון' : '');
      state.courseSchedulingPlanningStoredEngineVersion = text(workspace?.engineVersion);
      state.courseSchedulingPlanningRows = contextChanged ? [] : sharedRows;
      state.courseSchedulingPlanningLocks = sharedPlanningLocks(shared);
      state.courseSchedulingPlanningAffectedIds = [...new Set(affectedIds.map(text).filter(Boolean))];
      state.courseSchedulingPlanningFingerprint = text(workspace?.dataFingerprint);
      state.courseSchedulingPlanningContextFingerprint = contextFingerprint;
      state.courseSchedulingPlanningCalculatedAt = formatPlanningSavedAt(workspace?.calculatedAt);
      state.courseSchedulingPlanningSharedRevision = Number(workspace?.revision) || 0;
      state.courseSchedulingPlanningSharedUpdatedAt = formatPlanningSavedAt(workspace?.updatedAt);
      state.courseSchedulingPlanningSharedUpdatedBy = text(workspace?.updatedByName);
      state.courseSchedulingPlanningSharedLoaded = true;
      state.courseSchedulingPlanningShared = shared || { workspace: null, rows: [] };
      state.courseSchedulingPlanningDirtyLockIds = [];
      state.courseSchedulingPlanningBeforeLock = {};
      data._planningSharedLoadedKey = scope.key;
    };

    const reloadSharedPlanningState = async ({ refreshData = true, isCurrent = () => true } = {}) => {
      const scope = planningScope();
      const [fresh, shared] = await Promise.all([
        refreshData ? data.reloadPlanningSnapshot?.() : Promise.resolve(data),
        loadSharedPlanningWorkspace({ periodKey: scope.periodKey, district: scope.district })
      ]);
      if (!isCurrent()) throw new PlanningCancelledError();
      if (fresh && fresh !== data) Object.assign(data, fresh);
      applySharedPlanningState(shared, fresh || data);
      return { fresh: fresh || data, shared };
    };

    const invalidatePlanningWorkboard = () => {
      data._planningSharedLoadedKey = '';
      state.courseSchedulingPlanningSharedLoaded = false;
    };

    const currentPlanningScope = planningScope();
    if (
      activeTab(state) !== 'maintenance'
      && data._planningSharedLoadedKey !== currentPlanningScope.key
      && !state.courseSchedulingPlanningLoading
    ) {
      data._planningSharedLoadedKey = currentPlanningScope.key;
      reloadSharedPlanningState({ refreshData: false })
        .then(() => {
          if (!schedulingScreenActive || state.route !== 'course-scheduling' || !root.isConnected) return;
          // Entering the screen only restores the shared plan. Recalculation is always explicit.
          rerenderPreservingWorkboardScroll();
        })
        .catch((error) => {
          if (!schedulingScreenActive || state.route !== 'course-scheduling' || !root.isConnected) return;
          data._planningSharedLoadedKey = '';
          data._planningAutoStartedKey = currentPlanningScope.key;
          state.courseSchedulingPlanningSharedLoaded = true;
          state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'טעינת הצעות השיבוץ נכשלה');
          rerender();
        });
    }

    const reloadDistanceCoverage = async () => {
      const coverage = await loadDistanceCoverage(invokeDistanceRoute, 'all');
      state.courseSchedulingDistanceStats = coverage;
      state.courseSchedulingDistanceCoverageLoaded = true;
      return coverage;
    };

    if (activeTab(state) === 'maintenance'
      && !state.courseSchedulingDistanceCoverageLoaded
      && !state.courseSchedulingDistanceCoverageLoading) {
      state.courseSchedulingDistanceCoverageLoading = true;
      reloadDistanceCoverage()
        .then((coverage) => {
          state.courseSchedulingDistanceStats = coverage;
          state.courseSchedulingDistanceError = false;
          state.courseSchedulingDistanceDoneMessage = '';
        })
        .catch((error) => {
          state.courseSchedulingDistanceError = true;
          state.courseSchedulingDistanceDoneMessage = translateSchedulingRouteError(error.code || error.message, error.message);
        })
        .finally(() => {
          state.courseSchedulingDistanceCoverageLoading = false;
          state.courseSchedulingDistanceCoverageLoaded = true;
          rerender();
        });
    }

    const openMissingCourse = (activityId) => {
      try { sessionStorage.setItem(PENDING_ACTIVITY_STORAGE_KEY, activityId); } catch { /* storage may be unavailable */ }
      state.activityPeriodTab = 'school_2027';
      state.activitiesInnerTab = 'year_all';
      state.activitiesMonthYm = '';
      state.allActivitiesStatusFilter = 'all';
      state.listFilters ||= {};
      state.listFilters.activities = { ...(state.listFilters.activities || {}), q: activityId, appliedQ: activityId, visibleCount: 10000 };
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'activities' } }));
      clickActivityRowWhenReady(activityId);
    };
    const clearCoursePlanning = ({ clearLocks = true, clearSharedMeta = false } = {}) => {
      state.courseSchedulingPlanningRows = [];
      state.courseSchedulingPlanningLoading = false;
      state.courseSchedulingPlanningProgress = null;
      state.courseSchedulingPlanningError = '';
      state.courseSchedulingPlanningCalculatedAt = '';
      state.courseSchedulingPlanningRouteStats = null;
      state.courseSchedulingPlanningFingerprint = '';
      state.courseSchedulingPlanningContextFingerprint = '';
      state.courseSchedulingPlanningAffectedIds = [];
      state.courseSchedulingPlanningDirtyLockIds = [];
      state.courseSchedulingPlanningBeforeLock = {};
      state.courseSchedulingPlanningStale = false;
      state.courseSchedulingPlanningStaleReason = '';
      state.courseSchedulingPlanningStoredEngineVersion = '';
      if (clearLocks) state.courseSchedulingPlanningLocks = {};
      if (clearSharedMeta) {
        state.courseSchedulingPlanningShared = null;
        state.courseSchedulingPlanningSharedLoaded = false;
        state.courseSchedulingPlanningSharedRevision = 0;
        state.courseSchedulingPlanningSharedUpdatedAt = '';
        state.courseSchedulingPlanningSharedUpdatedBy = '';
      }
    };

    const runCoursePlanning = async ({ forceFull = false } = {}) => {
      cancelPendingPlanningStart();
      activePlanningRun?.controller?.abort();
      const run = {
        generation: ++planningRunGeneration,
        controller: new AbortController(),
        root
      };
      activePlanningRun = run;
      const ownsRun = () => (
        activePlanningRun === run
        && run.generation === planningRunGeneration
        && !run.controller.signal.aborted
        && schedulingScreenActive
        && state.route === 'course-scheduling'
      );
      const assertRunOwnership = () => {
        if (!ownsRun()) throw new PlanningCancelledError();
      };
      const checkpoint = createPlanningCheckpoint({
        signal: run.controller.signal,
        isOwner: ownsRun
      });
      const scope = planningScope();
      state.courseSchedulingPlanningLoading = true;
      state.courseSchedulingPlanningError = '';
      state.courseSchedulingPlanningProgress = { phase: 'רענון נתונים', completed: 0, total: 0 };
      updatePlanningStatusInPlace();

      try {
        const routeCachePromise = loadSchedulingTravelCacheRows().catch(() => []);
        const [freshStart, shared, routeCacheRows] = await Promise.all([
          data.reloadPlanningSnapshot(),
          loadSharedPlanningWorkspace({ periodKey: scope.periodKey, district: scope.district }),
          routeCachePromise
        ]);
        assertRunOwnership();
        Object.assign(data, freshStart);

        const startFingerprintInput = planningInputFromSnapshot(freshStart, scope.periodKey);
        const startFingerprint = planningDataFingerprint(startFingerprintInput);
        const startContextFingerprint = planningContextFingerprint(startFingerprintInput);
        const currentCourseIds = planningWorkspaceCourses(
          freshStart.activities || [],
          scope.district,
          scope.periodKey
        ).map((course) => idOf(course));

        const contextChanged = !!shared?.workspace && (
          text(shared.workspace.engineVersion) !== PLANNING_ENGINE_VERSION
          || text(shared.workspace.contextFingerprint) !== startContextFingerprint
        );
        const existingRows = (shared?.rows || [])
          .filter((entry) => currentCourseIds.includes(text(entry.activityId)))
          .map((entry) => entry.lockedOption
            ? applyPlanningLockToRow(entry.row, entry.lockedOption, scope.periodKey)
            : entry.row);
        const affectedIds = shared?.workspace
          ? sharedPlanningAffectedCourseIds({
              shared,
              activities: freshStart.activities || [],
              currentCourseIds,
              contextChanged
            })
          : currentCourseIds;

        const fullRun = forceFull || !shared?.workspace || !existingRows.length || contextChanged || affectedIds.length === 0;

        let silentCheckpoint = null;
        if (fullRun) {
          try {
            silentCheckpoint = await loadSharedPlanningCheckpoint({
              periodKey: scope.periodKey,
              district: scope.district,
              engineVersion: PLANNING_ENGINE_VERSION,
              dataFingerprint: startFingerprint,
              contextFingerprint: startContextFingerprint
            });
          } catch {
            silentCheckpoint = null;
          }
        }
        assertRunOwnership();

        const checkpointCompletedIds = new Set(
          (silentCheckpoint?.completedActivityIds || [])
            .map((value) => text(value))
            .filter((courseId) => currentCourseIds.includes(courseId))
        );
        const resumableRows = (silentCheckpoint?.rows || [])
          .filter((row) => checkpointCompletedIds.has(text(row?.courseId)));
        const resumeFromCheckpoint = fullRun
          && checkpointCompletedIds.size > 0
          && resumableRows.length > 0;
        const targetCourseIds = fullRun
          ? (resumeFromCheckpoint
              ? currentCourseIds.filter((courseId) => !checkpointCompletedIds.has(courseId))
              : null)
          : affectedIds;
        const planningExistingRows = resumeFromCheckpoint ? resumableRows : existingRows;
        let lastSilentCheckpointCount = checkpointCompletedIds.size;

        state.courseSchedulingPlanningProgress = {
          phase: fullRun ? 'בניית תכנון מלא' : 'עדכון שינויים בלבד',
          completed: 0,
          total: fullRun ? currentCourseIds.length : affectedIds.length
        };
        updatePlanningStatusInPlace();

        const profiles = Object.fromEntries((freshStart.scheduling?.profiles || []).map((row) => [text(row.emp_id), row]));
        const routeClient = createRouteClient({
          preloadedRows: routeCacheRows,
          concurrency: 6,
          signal: run.controller.signal
        });
        const lockedOptions = sharedPlanningLocks(shared);

        const result = await buildDynamicCoursePlan({
          activities: freshStart.activities || [],
          instructors: freshStart.instructors || [],
          profiles,
          rules: group(freshStart.scheduling?.rules || [], 'emp_id'),
          exceptions: group(freshStart.scheduling?.exceptions || [], 'emp_id'),
          schoolCalendar: freshStart.schoolCalendar || [],
          catalog: freshStart.planningCatalog || [],
          district: scope.district,
          periodKey: scope.periodKey,
          today: today(),
          routeClient,
          lockedOptions,
          existingRows: planningExistingRows,
          targetCourseIds,
          resumeFromCheckpoint,
          signal: run.controller.signal,
          checkpoint,
          onProgress: async (progress) => {
            if (!ownsRun()) return;
            state.courseSchedulingPlanningProgress = {
              phase: progress.phase,
              completed: progress.completed,
              total: progress.total
            };
            if (Array.isArray(progress.rows)) state.courseSchedulingPlanningRows = progress.rows;
            updatePlanningStatusInPlace();

            if (
              !fullRun
              || progress.phase !== 'בניית תוכנית'
              || !text(progress.courseId)
              || !Array.isArray(progress.rows)
            ) return;

            checkpointCompletedIds.add(text(progress.courseId));
            const finishedThisPass = Number(progress.completed) >= Number(progress.total) && Number(progress.total) > 0;
            const shouldSaveCheckpoint = checkpointCompletedIds.size - lastSilentCheckpointCount >= 50
              || finishedThisPass;
            if (!shouldSaveCheckpoint) return;

            const checkpointRows = progress.rows.filter((row) =>
              checkpointCompletedIds.has(text(row?.courseId))
            );
            try {
              await saveSharedPlanningCheckpoint({
                periodKey: scope.periodKey,
                district: scope.district,
                engineVersion: PLANNING_ENGINE_VERSION,
                dataFingerprint: startFingerprint,
                contextFingerprint: startContextFingerprint,
                completedCount: checkpointCompletedIds.size,
                totalCount: checkpointCompletedIds.size + Math.max(0, Number(progress.total) - Number(progress.completed)),
                completedActivityIds: [...checkpointCompletedIds],
                rows: checkpointRows
              });
              lastSilentCheckpointCount = checkpointCompletedIds.size;
            } catch {
              // Checkpointing is resilience-only and deliberately silent.
            }
          }
        });

        assertRunOwnership();
        const freshEnd = await data.reloadPlanningSnapshot();
        assertRunOwnership();
        const endFingerprintInput = planningInputFromSnapshot(freshEnd, scope.periodKey);
        const endFingerprint = planningDataFingerprint(endFingerprintInput);
        const endContextFingerprint = planningContextFingerprint(endFingerprintInput);
        if (startFingerprint !== endFingerprint) {
          Object.assign(data, freshEnd);
          applySharedPlanningState(shared, freshEnd);
          state.courseSchedulingPlanningError = 'נתוני השיבוץ השתנו בזמן החישוב. התוצאה לא נשמרה; יש לעדכן רק את השינויים.';
          return;
        }

        assertRunOwnership();
        const saved = await saveSharedPlanningSnapshot({
          periodKey: scope.periodKey,
          district: scope.district,
          engineVersion: PLANNING_ENGINE_VERSION,
          dataFingerprint: endFingerprint,
          contextFingerprint: endContextFingerprint,
          rows: result.rows || [],
          activities: freshEnd.activities || [],
          expectedRevision: Number(shared?.workspace?.revision) || 0
        });

        assertRunOwnership();
        const canonical = await loadSharedPlanningWorkspace({
          periodKey: scope.periodKey,
          district: scope.district
        });
        assertRunOwnership();
        Object.assign(data, freshEnd);
        applySharedPlanningState(canonical, freshEnd);
        state.courseSchedulingPlanningRouteStats = result.routeStats || null;
        state.courseSchedulingPlanningSharedRevision = Number(saved?.revision || canonical?.workspace?.revision) || 0;
        state.courseSchedulingPlanningAffectedIds = [];
        if (fullRun) {
          try {
            await clearSharedPlanningCheckpoint({
              periodKey: scope.periodKey,
              district: scope.district
            });
          } catch {
            // Final canonical save succeeded; stale checkpoints are harmless and hidden.
          }
        }

        const updatedCount = fullRun ? currentCourseIds.length : affectedIds.length;
        showToast(
          fullRun
            ? `התכנון המשותף נשמר: ${currentCourseIds.length} פעילויות נבדקו.`
            : `התכנון המשותף עודכן: חושבו מחדש רק ${updatedCount} פעילויות שהושפעו.`,
          'success'
        );
      } catch (error) {
        if (isPlanningCancellationError(error) || !ownsRun()) return;
        state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'חישוב התכנון נכשל');
        try {
          await reloadSharedPlanningState({ isCurrent: ownsRun });
        } catch {
          if (ownsRun()) data._planningSharedLoadedKey = '';
        }
      } finally {
        if (!ownsRun()) return;
        state.courseSchedulingPlanningLoading = false;
        state.courseSchedulingPlanningProgress = null;
        activePlanningRun = null;
        rerenderPreservingWorkboardScroll();
      }
    };

    const clonePlanningOption = (option = {}) => ({
      ...option,
      meetings: (option.meetings || []).map((meeting) => ({ ...meeting })),
      planningOptimization: option.planningOptimization ? { ...option.planningOptimization } : option.planningOptimization,
      explanation: option.explanation ? { ...option.explanation } : option.explanation,
      startRange: option.startRange ? { ...option.startRange } : option.startRange
    });

    const persistPlanningLock = async (courseId, option) => {
      const scope = planningScope();
      const result = await saveSharedPlanningLock({
        periodKey: scope.periodKey,
        district: scope.district,
        activityId: courseId,
        option,
        expectedRevision: Number(state.courseSchedulingPlanningSharedRevision) || 0
      });
      state.courseSchedulingPlanningSharedRevision = Number(result?.revision) || state.courseSchedulingPlanningSharedRevision || 0;
      await reloadSharedPlanningState({ refreshData: false });
      return result;
    };

    root.querySelectorAll('[data-planning-instructor-details-toggle]').forEach((button) => button.addEventListener('click', () => {
      const detailKey = text(button.dataset.planningInstructorDetailsToggle);
      if (!detailKey) return;
      const detailRow = [...root.querySelectorAll('[data-planning-instructor-details]')]
        .find((row) => text(row.dataset.planningInstructorDetails) === detailKey);
      if (!detailRow) return;
      const opening = detailRow.hidden;
      detailRow.hidden = !opening;
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    }));

    root.querySelectorAll('[data-planning-pick-option]').forEach((button) => button.addEventListener('click', async () => {
      if (state.courseSchedulingPlanningLoading || button.disabled) return;
      const courseId = text(button.dataset.planningCourseId);
      const optionIndex = Number(button.dataset.planningOptionIndex);
      const row = (state.courseSchedulingPlanningRows || []).find((item) => text(item.courseId) === courseId);
      const option = Number.isInteger(optionIndex) ? row?.options?.[optionIndex] : null;
      if (!courseId || !option?.instructorEmpId || !(option.meetings || []).length) return;

      button.disabled = true;
      state.courseSchedulingPlanningError = '';
      try {
        await persistPlanningLock(courseId, clonePlanningOption(option));
        if (state.courseSchedulingChoiceDrafts) delete state.courseSchedulingChoiceDrafts[courseId];
        state.courseSchedulingAlternativesCourseId = '';
        const pending = (state.courseSchedulingPlanningAffectedIds || []).length;
        showToast(
          pending
            ? `ההצעה נבחרה. ${pending} פעילויות דורשות עדכון — לחץ "עדכן רק את השינויים".`
            : 'ההצעה נבחרה.',
          'success'
        );
      } catch (error) {
        state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'שמירת הבחירה בתכנון נכשלה');
        try { await reloadSharedPlanningState({ refreshData: false }); } catch { /* keep actionable error */ }
      } finally {
        rerender();
      }
    }));

    root.querySelectorAll('[data-planning-unlock]').forEach((button) => button.addEventListener('click', async () => {
      if (state.courseSchedulingPlanningLoading || button.disabled) return;
      const courseId = text(button.dataset.planningCourseId);
      if (!courseId) return;
      button.disabled = true;
      state.courseSchedulingPlanningError = '';
      try {
        await persistPlanningLock(courseId, null);
        if (state.courseSchedulingChoiceDrafts) delete state.courseSchedulingChoiceDrafts[courseId];
        state.courseSchedulingAlternativesCourseId = '';
        const pending = (state.courseSchedulingPlanningAffectedIds || []).length;
        showToast(
          pending
            ? `הבחירה בוטלה. ${pending} פעילויות דורשות עדכון — לחץ "עדכן רק את השינויים".`
            : 'הבחירה בוטלה.',
          'success'
        );
      } catch (error) {
        state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'שחרור הבחירה בתכנון נכשל');
        try { await reloadSharedPlanningState({ refreshData: false }); } catch { /* keep actionable error */ }
      } finally {
        rerender();
      }
    }));
    root.querySelectorAll('[data-confirm-planning-draft]').forEach((button) => button.addEventListener('click', async () => {
      if (!canEdit || state.courseSchedulingPlanningLoading || button.disabled) return;
      const courseId = text(button.dataset.courseId);
      const row = (state.courseSchedulingPlanningRows || []).find((item) => text(item.courseId) === courseId);
      if (!courseId || !row?.planningLocked || !row?.instructorEmpId) return;
      if (!window.confirm(`לאשר את הטיוטה ולשבץ את ${row.instructorName || row.instructorEmpId} לפעילות?`)) return;

      button.disabled = true;
      state.courseSchedulingPlanningError = '';
      try {
        const scope = planningScope();
        const updatedActivity = await confirmSharedPlanningDraft({
          periodKey: scope.periodKey,
          district: scope.district,
          activityId: courseId,
          expectedRevision: Number(state.courseSchedulingPlanningSharedRevision) || 0
        });
        applyReturnedSchedulingActivity(data.activities, updatedActivity);
        state.courseSchedulingSelectedId = '';
        state.courseSchedulingAlternativesCourseId = '';
        clearScreenDataCache?.();
        await reloadSharedPlanningState();
        const pending = (state.courseSchedulingPlanningAffectedIds || []).length;
        showToast(
          pending
            ? `השיבוץ אושר. ${pending} פעילויות דורשות עדכון — לחץ "עדכן רק את השינויים".`
            : 'השיבוץ אושר.',
          'success'
        );
        rerender();
      } catch (error) {
        state.courseSchedulingPlanningError = planningStoreErrorMessage(
          error,
          translateSchedulingAssignmentError(error?.message, 'אישור השיבוץ נכשל')
        );
        try { await reloadSharedPlanningState(); } catch { /* keep actionable error */ }
        rerender();
      } finally {
        button.disabled = false;
      }
    }));


    root.querySelector('[data-run-course-planning]')?.addEventListener('click', () => {
      const pending = (state.courseSchedulingPlanningAffectedIds || []).length;
      const forceFull = pending === 0 && !!state.courseSchedulingPlanningCalculatedAt;
      void runCoursePlanning({ forceFull });
    });
    root.querySelector('[data-refresh-shared-planning]')?.addEventListener('click', async (event) => {
      if (state.courseSchedulingPlanningLoading) return;
      event.currentTarget.disabled = true;
      try {
        await reloadSharedPlanningState({ refreshData: false });
        state.courseSchedulingPlanningError = '';
      } catch (error) {
        state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'רענון התכנון המשותף נכשל');
      } finally {
        rerender();
      }
    });
    root.querySelector('[data-export-course-planning]')?.addEventListener('click', () => {
      const rows = state.courseSchedulingPlanningRows || [];
      if (!state.courseSchedulingPlanningCalculatedAt || !rows.length) {
        showToast('קודם יש לבנות את מערכת ההדרכות המלאה.', 'info');
        return;
      }
      try {
        const filename = exportPlanningWorkbook(rows);
        showToast(`קובץ Excel נוצר: ${filename}`);
      } catch (error) {
        showToast(error?.message || 'ייצוא Excel נכשל.', 'error');
      }
    });
    root.querySelector('[data-clear-course-planning]')?.addEventListener('click', async (event) => {
      if (state.courseSchedulingPlanningLoading) return;
      if (!window.confirm('לאפס את התכנון המשותף עבור התקופה והמחוז שנבחרו? האיפוס יוצג גם לשאר הצוות.')) return;
      event.currentTarget.disabled = true;
      const scope = planningScope();
      try {
        await clearSharedPlanningWorkspace({
          periodKey: scope.periodKey,
          district: scope.district,
          expectedRevision: Number(state.courseSchedulingPlanningSharedRevision) || 0
        });
        try {
          await clearSharedPlanningCheckpoint({
            periodKey: scope.periodKey,
            district: scope.district
          });
        } catch {
          // Hidden recovery data must never block an explicit workspace reset.
        }
        clearCoursePlanning({ clearSharedMeta: true });
        data._planningSharedLoadedKey = '';
        await reloadSharedPlanningState({ refreshData: false });
        showToast('התכנון המשותף אופס.', 'success');
      } catch (error) {
        state.courseSchedulingPlanningError = planningStoreErrorMessage(error, 'איפוס התכנון נכשל');
      } finally {
        rerender();
      }
    });
    root.querySelector('[data-planning-period-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingPlanningPeriodKey = event.target.value || DEFAULT_PLANNING_PERIOD_KEY;
      clearCoursePlanning({ clearSharedMeta: true });
      data._planningSharedLoadedKey = '';
      rerender();
    });
    root.querySelector('[data-planning-district-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingPlanningDistrict = event.target.value;
      clearCoursePlanning({ clearSharedMeta: true });
      data._planningSharedLoadedKey = '';
      rerender();
    });

    const clearDistrictSimulation = () => {
      state.courseSchedulingSimulationView = false;
      state.courseSchedulingSimulationLoading = false;
      state.courseSchedulingSimulationError = '';
      state.courseSchedulingSimulationRows = [];
      state.courseSchedulingSimulationCounts = null;
      state.courseSchedulingSimulationResults = [];
      state.courseSchedulingSimulationStatusFilter = '';
      state.courseSchedulingSimulationSelectedIds = [];
      state.courseSchedulingSimulationSaving = false;
      state.courseSchedulingSimulationConfirmSave = false;
      state.courseSchedulingSimulationSaveResult = null;
    };

    root.querySelectorAll('[data-period-key]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingPeriodKey = button.dataset.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      clearDistrictSimulation();
      rerender();
    }));
    root.querySelector('[data-district-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingDistrict = event.target.value;
      state.courseSchedulingAuthority = '';
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      clearDistrictSimulation();
      rerender();
    });
    root.querySelector('[data-authority-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingAuthority = event.target.value;
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      // Authority filter applies only to the ordinary course list — reset any open district simulation
      // so stale district-wide results never appear authority-filtered.
      if (state.courseSchedulingSimulationView || (state.courseSchedulingSimulationRows || []).length) {
        clearDistrictSimulation();
      }
      rerender();
    });
    root.querySelector('[data-activity-type-filter]')?.addEventListener('change', (event) => {
      state.activitySchedulingType = event.target.value;
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      clearDistrictSimulation();
      rerender();
    });
    root.querySelector('[data-business-status-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingBusinessStatus = event.target.value || 'all';
      state.courseSchedulingSelectedId = '';
      rerender();
    });
    root.querySelectorAll('[data-planning-choice-date]').forEach((select) => select.addEventListener('change', (event) => {
      const courseId = text(select.dataset.courseId);
      if (!courseId) return;
      state.courseSchedulingChoiceDrafts ||= {};
      state.courseSchedulingChoiceDrafts[courseId] = {
        date: text(event.target.value),
        timeKey: '',
        instructorEmpId: ''
      };
      rerenderPreservingWorkboardScroll();
    }));
    root.querySelectorAll('[data-planning-choice-time]').forEach((select) => select.addEventListener('change', (event) => {
      const courseId = text(select.dataset.courseId);
      if (!courseId) return;
      state.courseSchedulingChoiceDrafts ||= {};
      const current = state.courseSchedulingChoiceDrafts[courseId] || {};
      state.courseSchedulingChoiceDrafts[courseId] = {
        ...current,
        timeKey: text(event.target.value),
        instructorEmpId: ''
      };
      rerenderPreservingWorkboardScroll();
    }));
    root.querySelectorAll('[data-planning-choice-instructor]').forEach((select) => select.addEventListener('change', (event) => {
      const courseId = text(select.dataset.courseId);
      if (!courseId) return;
      state.courseSchedulingChoiceDrafts ||= {};
      const current = state.courseSchedulingChoiceDrafts[courseId] || {};
      state.courseSchedulingChoiceDrafts[courseId] = {
        ...current,
        instructorEmpId: text(event.target.value)
      };
      rerenderPreservingWorkboardScroll();
    }));

    root.querySelectorAll('[data-workboard-alternatives]').forEach((button) => button.addEventListener('click', () => {
      const courseId = text(button.dataset.courseId);
      state.courseSchedulingAlternativesCourseId =
        text(state.courseSchedulingAlternativesCourseId) === courseId ? '' : courseId;
      rerender();
    }));
    root.querySelectorAll('[data-open-course-detail]').forEach((button) => button.addEventListener('click', () => {
      const row = button.closest?.('[data-course-card]');
      const courseId = text(row?.dataset?.courseCard);
      if (!courseId) return;
      state.courseSchedulingSelectedId = courseId;
      state.courseSchedulingSelectedCandidateId = '';
      state.courseSchedulingExpandedCandidateId = '';
      state.courseSchedulingShowAllCandidates = false;
      rerender();
    }));

    root.querySelectorAll('[data-switch-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.courseSchedulingTab = button.dataset.switchTab === 'maintenance' ? 'maintenance' : 'courses';
        state.courseSchedulingShowDistanceConfirm = false;
        rerender();
      });
    });

    root.querySelectorAll('[data-course-card]').forEach((button) => {
      button.addEventListener('click', (event) => {
        if (event.target.closest('[data-course-row-action]')) return;
        const nextId = button.dataset.courseCard;
        state.courseSchedulingSelectedId = state.courseSchedulingSelectedId === nextId ? '' : nextId;
        state.courseSchedulingSelectedCandidateId = '';
        state.courseSchedulingExpandedCandidateId = '';
        state.courseSchedulingShowAllCandidates = false;
        state.courseSchedulingTab = 'courses';
        const course = courseById.get(state.courseSchedulingSelectedId);
        if (course?.start_date) state.courseSchedulingWeek = course.start_date;
        rerender();
      });
    });

    root.querySelectorAll('[data-course-card][role="button"]').forEach((row) => {
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        row.click();
      });
    });

    root.querySelectorAll('[data-calendar-course]').forEach((button) => {
      button.addEventListener('click', () => {
        state.courseSchedulingSelectedId = button.dataset.calendarCourse;
        state.courseSchedulingTab = 'courses';
        state.courseSchedulingSelectedCandidateId = '';
        rerender();
      });
    });

    root.querySelectorAll('[data-close-course-scheduling-overlay]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingShowDistanceConfirm = false;
      rerender();
    }));
    root.querySelectorAll('[data-course-scheduling-overlay]').forEach((overlay) => overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        state.courseSchedulingShowDistanceConfirm = false;
        rerender();
      }
    }));

    root.querySelectorAll('[data-week-nav]').forEach((button) => button.addEventListener('click', () => {
      const anchor = state.courseSchedulingWeek || today();
      if (button.dataset.weekNav === 'prev') state.courseSchedulingWeek = shiftWeek(anchor, -1);
      else if (button.dataset.weekNav === 'next') state.courseSchedulingWeek = shiftWeek(anchor, 1);
      else state.courseSchedulingWeek = today();
      rerender();
    }));
    root.querySelector('[data-week-pick]')?.addEventListener('change', (event) => {
      if (event.target.value) { state.courseSchedulingWeek = event.target.value; rerender(); }
    });
    root.querySelectorAll('[data-calendar-view]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingCalendarView = button.dataset.calendarView;
      rerender();
    }));

    const detailRoot = root.querySelector('[data-course-detail]') || root;
    const selectedCourseId = state.courseSchedulingSelectedId;
    const selectedCourse = courseById.get(selectedCourseId);

    detailRoot.querySelector('[data-open-single-substitute]')?.addEventListener('click', async () => {
      if (!canEdit || !substituteAccess.allowed || !selectedCourseId) return;
      const [substitutionResult, historyResult] = await Promise.all([
        supabase.rpc('scheduling_course_meeting_substitutions', { p_activity_id: selectedCourseId }),
        supabase.rpc('scheduling_course_meeting_instructors', { p_activity_id: selectedCourseId })
      ]);
      const error = substitutionResult.error || historyResult.error;
      if (error) {
        showToast(translateSchedulingAssignmentError(error.message, 'טעינת ההחלפות נכשלה'), 'error');
        return;
      }
      state.courseSchedulingSingleSubstitutions ||= {};
      state.courseSchedulingSingleSubstitutions[selectedCourseId] = substitutionResult.data || [];
      state.courseSchedulingMeetingHistory ||= {};
      state.courseSchedulingMeetingHistory[selectedCourseId] = historyResult.data || [];
      state.courseSchedulingSingleSubstitutionCourseId = selectedCourseId;
      state.courseSchedulingSingleSubstitutionDate = '';
      state.courseSchedulingSingleSubstitutionEmpId = '';
      rerender();
    });

    root.querySelector('[data-close-single-substitute]')?.addEventListener('click', () => {
      state.courseSchedulingSingleSubstitutionCourseId = '';
      state.courseSchedulingSingleSubstitutionDate = '';
      state.courseSchedulingSingleSubstitutionEmpId = '';
      rerender();
    });
    root.querySelector('[data-single-substitute-overlay]')?.addEventListener('click', (event) => {
      if (event.target !== event.currentTarget) return;
      state.courseSchedulingSingleSubstitutionCourseId = '';
      state.courseSchedulingSingleSubstitutionDate = '';
      state.courseSchedulingSingleSubstitutionEmpId = '';
      rerender();
    });
    root.querySelector('[data-single-substitute-date]')?.addEventListener('change', (event) => {
      state.courseSchedulingSingleSubstitutionDate = event.target.value;
      state.courseSchedulingSingleSubstitutionEmpId = '';
      rerender();
    });
    root.querySelector('[data-single-substitute-emp]')?.addEventListener('change', (event) => {
      state.courseSchedulingSingleSubstitutionEmpId = event.target.value;
    });

    const refreshSingleSubstitutionState = async (courseId) => {
      const [substitutionResult, historyResult] = await Promise.all([
        supabase.rpc('scheduling_course_meeting_substitutions', { p_activity_id: courseId }),
        supabase.rpc('scheduling_course_meeting_instructors', { p_activity_id: courseId })
      ]);
      if (substitutionResult.error) throw substitutionResult.error;
      if (historyResult.error) throw historyResult.error;
      state.courseSchedulingSingleSubstitutions ||= {};
      state.courseSchedulingSingleSubstitutions[courseId] = substitutionResult.data || [];
      state.courseSchedulingMeetingHistory ||= {};
      state.courseSchedulingMeetingHistory[courseId] = historyResult.data || [];
    };

    root.querySelector('[data-save-single-substitute]')?.addEventListener('click', async (event) => {
      const courseId = text(state.courseSchedulingSingleSubstitutionCourseId);
      const meetingDate = text(state.courseSchedulingSingleSubstitutionDate);
      const substituteEmpId = Number(state.courseSchedulingSingleSubstitutionEmpId);
      if (!courseId || !meetingDate) { showToast('יש לבחור מפגש', 'error'); return; }
      if (!Number.isInteger(substituteEmpId) || substituteEmpId <= 0) { showToast('יש לבחור מדריך מחליף', 'error'); return; }
      event.currentTarget.disabled = true;
      if (substituteAccess.canRequest) {
        try {
          await submitCourseMeetingSubstituteRequest({
            activityId: courseId,
            meetingDate,
            substituteEmpId,
            action: 'set'
          });
          state.courseSchedulingSingleSubstitutionCourseId = '';
          state.courseSchedulingSingleSubstitutionDate = '';
          state.courseSchedulingSingleSubstitutionEmpId = '';
          clearScreenDataCache?.();
          try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch {}
          showToast('הבקשה לעדכון נשלחה לאישור אדמין או תפעול', 'success');
          rerender();
        } catch (error) {
          showToast(substituteRequestErrorMessage(error), 'error');
          event.currentTarget.disabled = false;
        }
        return;
      }
      const { error } = await supabase.rpc('set_course_meeting_substitute', {
        p_activity_id: courseId,
        p_meeting_date: meetingDate,
        p_substitute_emp_id: substituteEmpId
      });
      if (error) {
        showToast(translateSchedulingAssignmentError(error.message, 'שמירת ההחלפה נכשלה'), 'error');
        event.currentTarget.disabled = false;
        return;
      }
      try { await refreshSingleSubstitutionState(courseId); } catch {}
      state.courseSchedulingSingleSubstitutionCourseId = '';
      state.courseSchedulingSingleSubstitutionDate = '';
      state.courseSchedulingSingleSubstitutionEmpId = '';
      clearScreenDataCache?.();
      showToast('ההחלפה החד־פעמית נשמרה', 'success');
      rerender();
    });

    root.querySelector('[data-clear-single-substitute]')?.addEventListener('click', async (event) => {
      const courseId = text(state.courseSchedulingSingleSubstitutionCourseId);
      const meetingDate = text(state.courseSchedulingSingleSubstitutionDate);
      if (!courseId || !meetingDate) return;
      event.currentTarget.disabled = true;
      if (substituteAccess.canRequest) {
        try {
          await submitCourseMeetingSubstituteRequest({
            activityId: courseId,
            meetingDate,
            action: 'clear'
          });
          state.courseSchedulingSingleSubstitutionCourseId = '';
          state.courseSchedulingSingleSubstitutionDate = '';
          state.courseSchedulingSingleSubstitutionEmpId = '';
          clearScreenDataCache?.();
          try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch {}
          showToast('הבקשה לביטול ההחלפה נשלחה לאישור אדמין או תפעול', 'success');
          rerender();
        } catch (error) {
          showToast(substituteRequestErrorMessage(error), 'error');
          event.currentTarget.disabled = false;
        }
        return;
      }
      const { error } = await supabase.rpc('clear_course_meeting_substitute', {
        p_activity_id: courseId,
        p_meeting_date: meetingDate
      });
      if (error) {
        showToast(translateSchedulingAssignmentError(error.message, 'ביטול ההחלפה נכשל'), 'error');
        event.currentTarget.disabled = false;
        return;
      }
      try { await refreshSingleSubstitutionState(courseId); } catch {}
      state.courseSchedulingSingleSubstitutionCourseId = '';
      state.courseSchedulingSingleSubstitutionDate = '';
      state.courseSchedulingSingleSubstitutionEmpId = '';
      clearScreenDataCache?.();
      showToast('ההחלפה החד־פעמית בוטלה', 'success');
      rerender();
    });
    detailRoot.querySelector('[data-change-assignment]')?.addEventListener('click', async () => {
      if (!canEdit || !selectedCourseId) return;
      const [{ data: completed, error }, historyResult] = await Promise.all([
        supabase.rpc('scheduling_course_meetings_completed', { p_activity_id: selectedCourseId }),
        supabase.rpc('scheduling_course_meeting_instructors', { p_activity_id: selectedCourseId })
      ]);
      if (error) { showToast(translateSchedulingAssignmentError(error.message, 'בדיקת הפעילות נכשלה'), 'error'); return; }
      state.courseSchedulingMeetingHistory ||= {};
      state.courseSchedulingMeetingHistory[selectedCourseId] = historyResult.data || [];
      state.courseSchedulingReplacementCourseId = selectedCourseId;
      state.courseSchedulingReplacementMeetings = Number(completed) || 0;
      state.courseSchedulingReplacementReason = '';
      state.courseSchedulingReplacementEffectiveFrom = '';
      state.courseSchedulingReplacementConfirmed = false;
      await runFindInstructors();
    });

    detailRoot.querySelector('[data-open-cancel-assignment]')?.addEventListener('click', () => {
      state.courseSchedulingCancelCourseId = selectedCourseId;
      state.courseSchedulingCancelReason = '';
      rerender();
    });
    root.querySelector('[data-close-cancel-assignment]')?.addEventListener('click', () => {
      state.courseSchedulingCancelCourseId = '';
      rerender();
    });
    root.querySelector('[data-cancel-assignment-reason]')?.addEventListener('input', (event) => { state.courseSchedulingCancelReason = event.target.value; });
    root.querySelector('[data-confirm-cancel-assignment]')?.addEventListener('click', async (event) => {
      const reason = text(root.querySelector('[data-cancel-assignment-reason]')?.value);
      if (!reason) { showToast('יש להזין סיבת ביטול', 'error'); return; }
      event.currentTarget.disabled = true;
      const { data: updatedActivity, error } = await supabase.rpc('cancel_confirmed_course_assignment', { p_activity_id: state.courseSchedulingCancelCourseId, p_reason: reason });
      if (error) { showToast(translateSchedulingAssignmentError(error.message, 'ביטול השיבוץ נכשל'), 'error'); event.currentTarget.disabled = false; return; }
      applyReturnedSchedulingActivity(data.activities, updatedActivity);
      state.courseSchedulingCancelCourseId = '';
      state.courseSchedulingCancelReason = '';
      state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((result) => idOf(result.course) !== selectedCourseId);
      clearScreenDataCache?.();
      invalidatePlanningWorkboard();
      showToast('השיבוץ בוטל והפעילות חזרה לפתוח. המערכת מעדכנת את סידור העבודה.', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-replacement-reason]')?.addEventListener('input', (event) => { state.courseSchedulingReplacementReason = event.target.value; });
    detailRoot.querySelector('[data-replacement-effective-from]')?.addEventListener('change', (event) => { state.courseSchedulingReplacementEffectiveFrom = event.target.value; });
    detailRoot.querySelector('[data-replacement-confirm]')?.addEventListener('change', (event) => { state.courseSchedulingReplacementConfirmed = event.target.checked; });

    detailRoot.querySelector('[data-open-missing-course]')?.addEventListener('click', () => {
      if (selectedCourseId) openMissingCourse(selectedCourseId);
    });

    detailRoot.querySelector('[data-clear-candidate]')?.addEventListener('click', () => {
      state.courseSchedulingSelectedCandidateId = '';
      const radios = detailRoot.querySelectorAll('input[type="radio"][name^="course-candidate"]');
      radios.forEach((radio) => { radio.checked = false; });
      rerender();
    });

    const currentCandidateResult = () => resultByCourseId.get(selectedCourseId);
    const allCandidatesForResult = (result) => [result?.recommended, result?.bestAvailable, ...(result?.alternatives || []), ...(result?.checked || [])].filter(Boolean);
    const selectedCandidateForResult = (result) => {
      const selectedId = text(state.courseSchedulingSelectedCandidateId) || text(detailRoot.querySelector('input[type="radio"][name^="course-candidate"]:checked')?.value);
      return allCandidatesForResult(result).find((item) => emp(item) === selectedId) || null;
    };
    const updateCandidateActions = (busy = false) => {
      const result = currentCandidateResult();
      const candidate = selectedCandidateForResult(result);
      const reason = actionDisabledReason({ candidate, busy, canEdit });
      detailRoot.querySelectorAll('[data-assign-course], [data-save-draft]').forEach((button) => {
        button.disabled = !!reason;
        button.title = reason || '';
        button.setAttribute('aria-disabled', reason ? 'true' : 'false');
      });
      const note = detailRoot.querySelector('[data-selection-note]');
      if (note) note.textContent = candidate ? `נבחרה: ${candidate.instructor?.full_name || emp(candidate)}${reason ? ` — ${reason}` : ''}` : 'בחרו מדריך כדי להמשיך';
    };
    if (typeof detailRoot.addEventListener === 'function') detailRoot.addEventListener('change', (event) => {
      const input = event.target?.closest?.('input[type="radio"][name^="course-candidate"]');
      if (!input) return;
      state.courseSchedulingSelectedCandidateId = text(input.value);
      detailRoot.querySelectorAll('[data-candidate-row]').forEach((row) => row.classList.toggle('is-selected', row.dataset.candidateRow === state.courseSchedulingSelectedCandidateId));
      rerender();
    });
    if (typeof detailRoot.addEventListener === 'function') detailRoot.addEventListener('click', (event) => {
      const row = event.target?.closest?.('[data-candidate-row]');
      const toggle = event.target?.closest?.('[data-candidate-toggle]');
      if (!row || (!toggle && (event.target?.closest?.('[data-candidate-expanded]') || event.target?.matches?.('input,button,a,label')))) return;
      const nextId = text(row.dataset.candidateRow);
      state.courseSchedulingExpandedCandidateId = state.courseSchedulingExpandedCandidateId === nextId ? '' : nextId;
      rerender();
    });
    updateCandidateActions(false);

    const runFindInstructors = async () => {
      if (state.courseSchedulingLoading) return;
      state.courseSchedulingLoading = true;
      state.courseSchedulingError = '';
      state.courseSchedulingProgressStep = 1;
      state.courseSchedulingSelectedCandidateId = '';
      state.courseSchedulingExpandedCandidateId = '';
      rerender();
      try {
        if (data.schoolAddressLookupError) throw new Error(data.schoolAddressLookupError);
        const enriched = enrichActivitiesWithSchoolAddresses(data.activities || [], data.schoolLocations || []);
        let activitiesWithCancellations = attachCancelledMeetingsToActivities(enriched.activities, data.meetingState);
        if (state.courseSchedulingReplacementCourseId === selectedCourseId) {
          activitiesWithCancellations = activitiesWithCancellations.map((course) => idOf(course) === selectedCourseId
            ? { ...course, emp_id: null, instructor_name: null, instructor_assignment_locked: false, instructor_assignment_status: null }
            : course);
        }
        if (state.courseSchedulingReplacementCourseId !== selectedCourseId) data.activities = activitiesWithCancellations;
        data.schoolAddressStats = {
          uniqueSchoolCount: enriched.uniqueSchoolCount,
          duplicateSchoolCount: enriched.duplicateSchoolCount,
          missingCount: enriched.missingCount
        };
        const scheduling = data.scheduling || {};
        const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        const input = {
          activities: activitiesWithCancellations,
          // Narrow recommendation targets without removing context activities used
          // for persisted assignments, drafts, overlaps, workload and transitions.
          targetCourseId: selectedCourseId,
          periodKey: selectedPeriodKey(state),
          authority: text(state.courseSchedulingAuthority || ''),
          instructors: data.instructors,
          profiles,
          rules: group(scheduling.rules || [], 'emp_id'),
          exceptions: group(scheduling.exceptions || [], 'emp_id'),
          schoolCalendar: data.schoolCalendar || []
        };
        state.courseSchedulingProgressStep = 2;
        rerender();
        const preliminary = preliminaryCourseCandidates(input);
        state.courseSchedulingProgressStep = 3;
        rerender();
        const routed = await calculateCandidateTravel(preliminary, activitiesWithCancellations);
        state.courseSchedulingResults = calculateCourseSchedule({
          ...input,
          referenceDate: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date()),
          travel: routed.travel,
          routeMatrix: routed.routeMatrix,
          travelUnavailableReason: routed.unavailableReason || ''
        });
        const activeInstructors = activeSchedulingInstructors(data.instructors || []);
        state.courseSchedulingResults = state.courseSchedulingResults.map((result) => {
          const checkedByEmpId = new Map((result.checked || []).map((candidate) => [emp(candidate), candidate]));
          return {
            ...result,
            manualCandidates: activeInstructors.map((instructor) => checkedByEmpId.get(text(instructor.emp_id)) || {
              instructor,
              eligible: false,
              score: null,
              failures: ['חסרים נתוני התאמה מלאים'],
              missingProfileData: []
            })
          };
        });
        if (routed.unavailableReason === 'google_key_not_configured') {
          state.courseSchedulingError = 'לא ניתן לבדוק מרחקים כרגע. ניתן להמשיך לפי זמינות והתאמה בלבד.';
        } else if (routed.unavailableReason) {
          state.courseSchedulingError = 'חלק מבדיקות המרחק לא הושלמו. ההצעות מציגות רק מדריכים שאומתו בבטחה.';
        }
        state.courseSchedulingCalculatedAt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
        const selectedResult = (state.courseSchedulingResults || []).find((result) => idOf(result.course) === selectedCourseId);
        if (selectedResult?.recommended || selectedResult?.bestAvailable) {
          state.courseSchedulingSelectedCandidateId = emp(selectedResult.recommended || selectedResult.bestAvailable);
        }
        saveCalculationSnapshot(state, interfaceCourses, schedulingSnapshotContext(data));
      } catch (error) {
        state.courseSchedulingError = `איתור המדריכים נכשל: ${translateSchedulingRouteError(error.message, error.message)}`;
      } finally {
        state.courseSchedulingLoading = false;
        state.courseSchedulingProgressStep = 0;
        rerender();
      }
    };
    const confirmActivityDraft = async (courseId, trigger = null) => {
      if (!canEdit || !courseId) return false;
      const course = courseById.get(courseId);
      if (!course || !text(course.draft_emp_id)) return false;
      const proposedMeetings = Array.isArray(course.draft_proposed_meetings) ? course.draft_proposed_meetings : null;
      const proposedSummary = draftProposedMeetingsFromCourse({ ...course, periodKey: selectedPeriodKey(state) });
      const proposedEnd = proposedSummary?.proposedEndDate || proposedMeetings?.at(-1)?.date || '';
      const originalEnd = proposedSummary?.originalEndDate || '';
      const halfEnd = resolveCourseSchedulingPeriod(selectedPeriodKey(state))?.end || '';
      const exceedsHalf = !!proposedEnd && !!halfEnd && proposedEnd > halfEnd;
      const movedCount = Number(proposedSummary?.movedMeetingsCount) || 0;
      let approvalMessage = `לאשר את הטיוטה ולשבץ את ${course.draft_instructor_name || course.draft_emp_id}?`;
      if (movedCount > 0) {
        approvalMessage = `הטיוטה כוללת ${movedCount} מועדים מוצעים (סיום מקורי ${formatDateHe(originalEnd) || '—'}, סיום מוצע ${formatDateHe(proposedEnd) || '—'}). לאשר את הטיוטה כשיבוץ סופי?`;
      }
      if (exceedsHalf) {
        approvalMessage = `המועדים בטיוטה מסתיימים בתאריך ${formatDateHe(proposedEnd)} וחורגים מהתקופה שנבחרה. לאשר כשיבוץ סופי?`;
      }
      if (!window.confirm(approvalMessage)) return false;
      if (trigger) trigger.disabled = true;

      const empId = Number(course.draft_emp_id);
      const { data: updatedActivity, error } = await supabase.rpc(
        proposedMeetings ? 'assign_activity_instructor_with_dates' : 'assign_activity_instructor',
        {
          p_activity_id: courseId,
          p_emp_id: empId,
          p_instructor_name: course.draft_instructor_name,
          p_top_emp_id: empId,
          p_selected_score: null,
          p_top_score: null,
          p_decision_type: 'approved',
          p_reason: null,
          ...(proposedMeetings ? { p_proposed_meetings: proposedMeetings } : {})
        }
      );
      if (error) {
        showToast(translateSchedulingAssignmentError(error.message, 'אישור הטיוטה נכשל'), 'error');
        if (trigger) trigger.disabled = false;
        return false;
      }

      applyReturnedSchedulingActivity(data.activities, updatedActivity);
      state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((result) => idOf(result.course) !== courseId);
      state.courseSchedulingSelectedId = '';
      clearScreenDataCache?.();
      invalidatePlanningWorkboard();
      showToast('השיבוץ אושר. המערכת מעדכנת את שאר סידור העבודה.', 'success');
      rerender();
      return true;
    };

    root.querySelectorAll('[data-confirm-actual-draft]').forEach((button) => {
      button.addEventListener('click', () => {
        void confirmActivityDraft(text(button.dataset.courseId), button);
      });
    });

    root.querySelectorAll('[data-find-instructors]').forEach((button) => {
      button.addEventListener('click', runFindInstructors);
    });

    detailRoot.querySelector('[data-toggle-manual-picker]')?.addEventListener('click', () => {
      state.courseSchedulingManualPickerOpen = state.courseSchedulingManualPickerOpen !== true;
      state.courseSchedulingManualSearch = '';
      rerender();
    });
    detailRoot.querySelector('[data-manual-candidate-search]')?.addEventListener('input', (event) => {
      state.courseSchedulingManualSearch = text(event.target?.value);
      const query = state.courseSchedulingManualSearch.toLocaleLowerCase('he-IL');
      detailRoot.querySelectorAll('[data-manual-candidate]').forEach((candidateButton) => {
        candidateButton.hidden = !!query && !text(candidateButton.dataset.manualCandidateSearchText).includes(query);
      });
    });
    const saveManualCandidate = async (candidate, button) => {
        if (!canEdit || !selectedCourseId || !candidate || button?.disabled) return;
        const result = resultByCourseId.get(selectedCourseId);
        if (!candidate || manualCandidateBlocked(candidate)) return;
        if (button) button.disabled = true;
        const topCandidate = result?.recommended || result?.bestAvailable || candidate;
        const payload = {
          p_activity_id: selectedCourseId,
          p_emp_id: Number(emp(candidate)),
          p_instructor_name: candidate.instructor?.full_name,
          p_top_emp_id: Number(emp(topCandidate)) || null,
          p_selected_score: Number.isFinite(candidate.score) ? candidate.score : null,
          p_top_score: Number.isFinite(topCandidate?.score) ? topCandidate.score : null,
          p_reason: manualCandidateWarnings(candidate).join(' · ') || 'בחירה ידנית'
        };
        const { error } = await supabase.rpc('save_course_assignment_manual_draft', payload);
        if (error) {
          if (button) button.disabled = false;
          showToast(translateSchedulingAssignmentError(error.message, 'שמירת הבחירה הידנית נכשלה'), 'error');
          return;
        }
        if (selectedCourse) {
          selectedCourse.draft_emp_id = String(payload.p_emp_id);
          selectedCourse.draft_instructor_name = payload.p_instructor_name;
        }
        state.courseSchedulingManualPickerOpen = false;
        state.courseSchedulingManualSearch = '';
        clearScreenDataCache?.();
        showToast('הבחירה הידנית נשמרה כטיוטה. יתר התכנון מתעדכן.', 'success');
        await runFindInstructors();
    };
    detailRoot.querySelectorAll('[data-manual-candidate]').forEach((button) => {
      button.addEventListener('click', () => {
        if (!canEdit || !selectedCourseId || button.disabled) return;
        const result = resultByCourseId.get(selectedCourseId);
        const candidate = (result?.manualCandidates || result?.checked || []).find((item) => emp(item) === text(button.dataset.manualCandidate));
        if (!candidate || manualCandidateBlocked(candidate)) return;
        openManualCandidateConfirmation(state, candidate);
        rerender();
      });
    });
    root.querySelector('[data-cancel-manual-candidate]')?.addEventListener('click', () => {
      closeManualCandidateConfirmation(state);
      rerender();
    });
    root.querySelector('[data-confirm-manual-candidate]')?.addEventListener('click', async (event) => {
      const result = resultByCourseId.get(selectedCourseId);
      const candidate = consumeManualCandidateConfirmation(state, result?.manualCandidates || result?.checked || []);
      rerender();
      await saveManualCandidate(candidate, event.currentTarget);
    });

    const runDistrictSimulation = async () => {
      if (state.courseSchedulingSimulationLoading || state.courseSchedulingLoading) return;
      const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
      const allDistricts = !district;
      state.courseSchedulingSimulationLoading = true;
      state.courseSchedulingSimulationView = true;
      state.courseSchedulingSimulationError = '';
      state.courseSchedulingSimulationStatusFilter = '';
      state.courseSchedulingTab = 'courses';
      rerender();
      try {
        if (data.schoolAddressLookupError) throw new Error(data.schoolAddressLookupError);
        const enriched = enrichActivitiesWithSchoolAddresses(data.activities || [], data.schoolLocations || []);
        const activitiesWithCancellations = attachCancelledMeetingsToActivities(enriched.activities, data.meetingState);
        data.activities = activitiesWithCancellations;
        data.schoolAddressStats = {
          uniqueSchoolCount: enriched.uniqueSchoolCount,
          duplicateSchoolCount: enriched.duplicateSchoolCount,
          missingCount: enriched.missingCount
        };
        const scheduling = data.scheduling || {};
        const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        // Batch planning scope is half-year + one district, or all operational districts nationally.
        // The ordinary authority filter affects the single-course list only and must not narrow this calculation.
        const input = {
          activities: activitiesWithCancellations,
          periodKey: selectedPeriodKey(state),
          district,
          allDistricts,
          instructors: data.instructors,
          profiles,
          rules: group(scheduling.rules || [], 'emp_id'),
          exceptions: group(scheduling.exceptions || [], 'emp_id'),
          schoolCalendar: data.schoolCalendar || []
        };
        const preliminary = preliminaryCourseCandidates(input);
        const routed = await calculateCandidateTravel(preliminary, activitiesWithCancellations);
        const simulation = runDistrictSchedulingSimulation({
          ...input,
          referenceDate: new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Jerusalem',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date()),
          travel: routed.travel,
          routeMatrix: routed.routeMatrix,
          travelUnavailableReason: routed.unavailableReason || ''
        });
        if (!simulation.ok) {
          state.courseSchedulingSimulationError = simulation.error || 'הסימולציה נכשלה';
          state.courseSchedulingSimulationRows = [];
          state.courseSchedulingSimulationCounts = summarizeDistrictSimulation([]);
          state.courseSchedulingSimulationResults = [];
          state.courseSchedulingSimulationSelectedIds = [];
        } else {
          state.courseSchedulingSimulationRows = simulation.rows;
          state.courseSchedulingSimulationCounts = simulation.counts;
          state.courseSchedulingSimulationResults = simulation.results;
          state.courseSchedulingSimulationSelectedIds = defaultSelectedSimulationCourseIds(simulation.rows);
          // A helper route may fail without blocking a course (for example an unused
          // return leg). Warn only when a simulation row is actually blocked.
          if (simulation.hasRouteMissing) {
            state.courseSchedulingSimulationError = DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE;
          }
        }
        state.courseSchedulingSimulationConfirmSave = false;
        state.courseSchedulingSimulationSaveResult = null;
        // Read-only: never save drafts/assignments and never call assignment RPCs from this path.
      } catch (error) {
        state.courseSchedulingSimulationError = `תכנון ${allDistricts ? 'ארצי' : 'מחוזי'} נכשל: ${translateSchedulingRouteError(error.message, error.message)}`;
        state.courseSchedulingSimulationRows = [];
        state.courseSchedulingSimulationCounts = summarizeDistrictSimulation([]);
        state.courseSchedulingSimulationResults = [];
        state.courseSchedulingSimulationSelectedIds = [];
        state.courseSchedulingSimulationConfirmSave = false;
        state.courseSchedulingSimulationSaveResult = null;
      } finally {
        state.courseSchedulingSimulationLoading = false;
        rerender();
      }
    };

    root.querySelector('[data-reset-scheduling-drafts]')?.addEventListener('click', async () => {
      if (!canEdit || state.courseSchedulingDraftResetting || state.courseSchedulingSimulationLoading || state.courseSchedulingSimulationSaving) return;
      const periodKey = selectedPeriodKey(state);
      const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
      const draftIds = schedulingDraftIdsForScope(data.activities || [], { periodKey, district });
      if (!draftIds.length) {
        showToast('אין טיוטות לאיפוס בהיקף הנוכחי', 'success');
        return;
      }
      const periodLabel = resolveCourseSchedulingPeriod(periodKey)?.label || '';
      const scopeLabel = district ? `מחוז ${district}` : 'כל המחוזות';
      const confirmed = window.confirm(
        `פעולה זו תבטל ${draftIds.length} טיוטות ב${scopeLabel}, ${periodLabel}.\n\nשיבוצים מאושרים לא ייפגעו. לאחר האיפוס יבוצע חישוב חדש ונקי.\n\nלהמשיך?`
      );
      if (!confirmed) return;

      clearDistrictSimulation();
      state.courseSchedulingDraftResetting = true;
      state.courseSchedulingResults = [];
      state.courseSchedulingCalculatedAt = '';
      try { localStorage.removeItem(SCHEDULING_SNAPSHOT_KEY); } catch { /* storage may be unavailable */ }
      rerender();

      const failures = [];
      let cleared = 0;
      try {
        const batchSize = 5;
        for (let offset = 0; offset < draftIds.length; offset += batchSize) {
          const batch = draftIds.slice(offset, offset + batchSize);
          const outcomes = await Promise.all(batch.map(async (courseId) => {
            try {
              const { data: updatedActivity, error } = await supabase.rpc('cancel_course_assignment_draft', { p_activity_id: courseId });
              if (error) return { ok: false, courseId, reason: text(error.message) || 'ביטול הטיוטה נכשל' };
              applyReturnedSchedulingActivity(data.activities || [], updatedActivity);
              return { ok: true, courseId };
            } catch (error) {
              return { ok: false, courseId, reason: text(error?.message) || 'ביטול הטיוטה נכשל' };
            }
          }));
          outcomes.forEach((outcome) => {
            if (outcome.ok) cleared += 1;
            else failures.push(outcome);
          });
        }
      } finally {
        clearScreenDataCache?.();
        state.courseSchedulingDraftResetting = false;
      }

      if (failures.length) {
        showToast(`אופסו ${cleared} מתוך ${draftIds.length} טיוטות. ${failures.length} טיוטות לא אופסו ולכן לא בוצע חישוב חדש.`, 'error');
        rerender();
        return;
      }

      showToast(`אופסו ${cleared} טיוטות. מריץ חישוב נקי מחדש...`, 'success');
      rerender();
      await runDistrictSimulation();
    });

    root.querySelector('[data-run-district-simulation]')?.addEventListener('click', runDistrictSimulation);
    root.querySelector('[data-close-district-simulation]')?.addEventListener('click', () => {
      clearDistrictSimulation();
      rerender();
    });
    root.querySelector('[data-simulation-status-select]')?.addEventListener('change', (event) => {
      state.courseSchedulingSimulationStatusFilter = event.target.value || '';
      rerender();
    });
    root.querySelectorAll('[data-simulation-status-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = text(button.dataset.simulationStatusFilter);
        state.courseSchedulingSimulationStatusFilter = state.courseSchedulingSimulationStatusFilter === next ? '' : next;
        rerender();
      });
    });
    root.querySelectorAll('[data-simulation-select-course]').forEach((input) => {
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('change', (event) => {
        event.stopPropagation();
        const courseId = text(input.dataset.simulationSelectCourse);
        if (!courseId) return;
        const row = (state.courseSchedulingSimulationRows || []).find((item) => text(item.courseId) === courseId);
        if (!isDistrictSimulationRowSelectable(row, courseById.get(courseId))) {
          input.checked = false;
          return;
        }
        const current = new Set(normalizeSelectedSimulationCourseIds(
          state.courseSchedulingSimulationRows || [],
          state.courseSchedulingSimulationSelectedIds || []
        ));
        if (input.checked) current.add(courseId);
        else current.delete(courseId);
        state.courseSchedulingSimulationSelectedIds = [...current];
        state.courseSchedulingSimulationSaveResult = null;
        rerender();
      });
    });
    root.querySelectorAll('[data-simulation-select-cell], [data-simulation-select-wrap]').forEach((node) => {
      node.addEventListener('click', (event) => event.stopPropagation());
    });
    root.querySelector('[data-save-simulation-drafts]')?.addEventListener('click', () => {
      if (!canEdit || state.courseSchedulingSimulationSaving) return;
      const selectedIds = normalizeSelectedSimulationCourseIds(
        state.courseSchedulingSimulationRows || [],
        state.courseSchedulingSimulationSelectedIds || []
      );
      if (!selectedIds.length) return;
      state.courseSchedulingSimulationSelectedIds = selectedIds;
      state.courseSchedulingSimulationConfirmSave = true;
      rerender();
    });
    root.querySelector('[data-cancel-simulation-draft-save]')?.addEventListener('click', () => {
      state.courseSchedulingSimulationConfirmSave = false;
      rerender();
    });
    root.querySelector('[data-district-simulation-confirm-overlay]')?.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-district-simulation-confirm]')) return;
      state.courseSchedulingSimulationConfirmSave = false;
      rerender();
    });
    const saveSelectedSimulationDrafts = async () => {
      if (!canEdit || state.courseSchedulingSimulationSaving) return;
      const selectedIds = normalizeSelectedSimulationCourseIds(
        state.courseSchedulingSimulationRows || [],
        state.courseSchedulingSimulationSelectedIds || []
      );
      if (!selectedIds.length) {
        state.courseSchedulingSimulationConfirmSave = false;
        rerender();
        return;
      }
      state.courseSchedulingSimulationConfirmSave = false;
      state.courseSchedulingSimulationSaving = true;
      state.courseSchedulingSimulationSaveResult = null;
      rerender();
      const instructors = data.instructors || [];
      const outcomes = [];
      for (const courseId of selectedIds) {
        const row = (state.courseSchedulingSimulationRows || []).find((item) => text(item.courseId) === courseId);
        const course = courseById.get(courseId) || row?.engineResult?.course || null;
        const courseLabel = courseLabelForSimulationRow(row || { courseId, school: course?.school, courseName: course?.activity_name });
        const blockReason = districtSimulationDraftSaveBlockReason({
          row,
          course,
          instructors,
          candidateHardBlockReason
        });
        if (blockReason) {
          outcomes.push({ ok: false, courseId, courseLabel, reason: blockReason });
          continue;
        }
        const engineResult = row.engineResult
          || (state.courseSchedulingSimulationResults || []).find((result) => idOf(result.course) === courseId);
        const selected = selectedSimulationCandidate(engineResult || {});
        const topCandidate = engineResult?.recommended || engineResult?.bestAvailable || selected;
        if (!selected || !topCandidate) {
          outcomes.push({ ok: false, courseId, courseLabel, reason: 'אין מדריך מוצע תקף' });
          continue;
        }
        const { rpc, payload } = buildCourseAssignmentDraftRpc({
          activityId: courseId,
          selected,
          topCandidate
        });
        const { error } = await supabase.rpc(rpc, payload);
        if (error) {
          const message = text(error.message);
          let reason = message || 'שמירת הטיוטה נכשלה';
          if (/draft|טיוט/i.test(message)) reason = 'הפעילות כבר נשמרה כטיוטה';
          else if (/assigned|שובץ|locked|מאושר/i.test(message)) reason = 'הפעילות כבר שובצה';
          else if (/instructor|מדריך/i.test(message)) reason = 'המדריך אינו זמין עוד';
          outcomes.push({ ok: false, courseId, courseLabel, reason });
          continue;
        }
        // Reflect the saved draft locally so later rows and the next calculation see it as a blocker.
        if (course) {
          course.draft_emp_id = String(payload.p_emp_id);
          course.draft_instructor_name = payload.p_instructor_name;
          if (payload.p_proposed_meetings) course.draft_proposed_meetings = payload.p_proposed_meetings;
        }
        outcomes.push({ ok: true, courseId, courseLabel });
      }
      const applied = applyDistrictSimulationSaveOutcome({
        rows: state.courseSchedulingSimulationRows || [],
        results: state.courseSchedulingSimulationResults || [],
        selectedIds,
        outcomes
      });
      state.courseSchedulingSimulationRows = applied.rows;
      state.courseSchedulingSimulationResults = applied.results;
      state.courseSchedulingSimulationCounts = applied.counts;
      state.courseSchedulingSimulationSelectedIds = applied.selectedIds;
      state.courseSchedulingSimulationSaveResult = {
        message: applied.message,
        failures: applied.failures,
        saved: applied.savedCount,
        failed: applied.failedCount
      };
      state.courseSchedulingSimulationSaving = false;
      // Drop stale single-course results for courses that are now drafts.
      const savedIds = new Set(outcomes.filter((item) => item.ok).map((item) => text(item.courseId)));
      if (savedIds.size) {
        state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((result) => !savedIds.has(idOf(result.course)));
      }
      clearScreenDataCache?.();
      rerender();
    };
    root.querySelector('[data-confirm-simulation-draft-save]')?.addEventListener('click', () => {
      saveSelectedSimulationDrafts();
    });
    const openSimulationCourseDetail = (courseId) => {
      const id = text(courseId);
      if (!id) return;
      const simulationResult = (state.courseSchedulingSimulationResults || []).find((result) => idOf(result.course) === id);
      if (simulationResult) {
        const others = (state.courseSchedulingResults || []).filter((result) => idOf(result.course) !== id);
        state.courseSchedulingResults = [...others, simulationResult];
      }
      state.courseSchedulingSelectedId = id;
      state.courseSchedulingSelectedCandidateId = emp(simulationResult?.recommended || simulationResult?.bestAvailable) || '';
      state.courseSchedulingShowAllCandidates = false;
      state.courseSchedulingTab = 'courses';
      state.courseSchedulingSimulationView = false;
      const course = courseById.get(id) || (data.activities || []).find((row) => idOf(row) === id);
      if (course?.start_date) state.courseSchedulingWeek = course.start_date;
      rerender();
    };
    root.querySelectorAll('[data-simulation-course-row]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target?.closest?.('[data-simulation-select-cell], [data-simulation-select-course], [data-simulation-select-wrap]')) return;
        openSimulationCourseDetail(row.dataset.simulationCourseRow);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        if (event.target?.closest?.('[data-simulation-select-cell], [data-simulation-select-course], [data-simulation-select-wrap]')) return;
        event.preventDefault();
        openSimulationCourseDetail(row.dataset.simulationCourseRow);
      });
    });

    detailRoot.querySelector('[data-assign-course]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourseId) return;
      const result = resultByCourseId.get(selectedCourseId);
      const topCandidate = result?.recommended || result?.bestAvailable;
      if (!topCandidate) return;
      const selectedId = text(state.courseSchedulingSelectedCandidateId)
        || text(detailRoot.querySelector('input[type="radio"][name^="course-candidate"]:checked')?.value);
      const selected = allCandidatesForResult(result).find((item) => emp(item) === selectedId);
      const blockReason = actionDisabledReason({ candidate: selected, canEdit });
      if (blockReason) { showToast(blockReason, 'error'); updateCandidateActions(false); return; }
      if (state.courseSchedulingReplacementCourseId === selectedCourseId) {
        const meetingsDone = Number(state.courseSchedulingReplacementMeetings) || 0;
        const reason = text(state.courseSchedulingReplacementReason);
        const effectiveFrom = text(state.courseSchedulingReplacementEffectiveFrom);
        if (meetingsDone === 1 && !reason) { showToast('לאחר מפגש אחד יש להזין סיבה', 'error'); return; }
        if (meetingsDone >= 2 && (!reason || !effectiveFrom || !state.courseSchedulingReplacementConfirmed)) {
          showToast('החלפה תפעולית דורשת סיבה, תאריך תחולה ואישור מפורש', 'error'); return;
        }
        updateCandidateActions(true);
        const rpc = meetingsDone >= 2 ? 'replace_locked_course_instructor' : 'reassign_locked_course_instructor';
        const payload = meetingsDone >= 2 ? {
          p_activity_id: selectedCourseId, p_new_emp_id: Number(selectedId), p_new_instructor_name: selected.instructor.full_name,
          p_effective_from: effectiveFrom, p_reason: reason
        } : buildCourseReassignmentRpc({
          activityId: selectedCourseId,
          selectedId,
          selected,
          topCandidate,
          decisionType: selectedId === emp(result.recommended) ? 'approved' : 'overridden',
          reason
        });
        const { data: updatedActivity, error } = await supabase.rpc(rpc, payload);
        if (error) { showToast(translateSchedulingAssignmentError(error.message, 'החלפת המדריך נכשלה'), 'error'); updateCandidateActions(false); return; }
        applyReturnedSchedulingActivity(data.activities, updatedActivity);
        state.courseSchedulingReplacementCourseId = '';
        state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((item) => idOf(item.course) !== selectedCourseId);
        clearScreenDataCache?.();
        invalidatePlanningWorkboard();
        showToast('המדריך הוחלף. המערכת מעדכנת את סידור העבודה.', 'success');
        rerender();
        return;
      }
      const adjustment = selected.dateAdjustment;
      const approvalMessage = adjustment?.exceedsHalf
        ? `המועדים המוצעים חורגים מהמחצית ומסתיימים בתאריך ${formatDateHe(adjustment.newEndDate)}. לאשר סופית את שינוי המועדים ואת שיבוץ ${selected.instructor.full_name}?`
        : `לשבץ את ${selected.instructor.full_name} לפעילות ${result.course.activity_name}?`;
      if (!window.confirm(approvalMessage)) return;
      updateCandidateActions(true);
      const proposedMeetings = adjustment?.meetings?.map(({ date }) => ({ date })) || null;
      const { data: updatedActivity, error } = await supabase.rpc(proposedMeetings ? 'assign_activity_instructor_with_dates' : 'assign_activity_instructor', {
        p_activity_id: selectedCourseId,
        p_emp_id: Number(selectedId),
        p_instructor_name: selected.instructor.full_name,
        p_top_emp_id: Number(emp(topCandidate)),
        p_selected_score: selected.score,
        p_top_score: topCandidate.score,
        p_decision_type: selectedId === emp(result.recommended) ? 'approved' : 'overridden',
        p_reason: null,
        ...(proposedMeetings ? { p_proposed_meetings: proposedMeetings } : {})
      });
      if (error) { showToast(translateSchedulingAssignmentError(error.message, 'השיבוץ נכשל'), 'error'); updateCandidateActions(false); return; }
      applyReturnedSchedulingActivity(data.activities, updatedActivity);
      state.courseSchedulingSelectedCandidateId = '';
      clearScreenDataCache?.();
      invalidatePlanningWorkboard();
      state.courseSchedulingSelectedId = '';
      showToast('השיבוץ נשמר. המערכת מעדכנת את שאר סידור העבודה.', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-save-draft]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourseId) return;
      const result = resultByCourseId.get(selectedCourseId);
      const topCandidate = result?.recommended || result?.bestAvailable;
      if (!topCandidate) return;
      const selectedId = text(state.courseSchedulingSelectedCandidateId)
        || text(detailRoot.querySelector('input[type="radio"][name^="course-candidate"]:checked')?.value);
      const selected = allCandidatesForResult(result).find((item) => emp(item) === selectedId);
      const liveCourse = (data.activities || []).find((row) => idOf(row) === selectedCourseId) || selectedCourse;
      if (text(liveCourse?.draft_emp_id)) {
        showToast('הפעילות כבר נשמרה כטיוטה', 'error');
        updateCandidateActions(false);
        return;
      }
      const blockReason = actionDisabledReason({ candidate: selected, canEdit });
      if (blockReason) { showToast(blockReason, 'error'); updateCandidateActions(false); return; }
      updateCandidateActions(true);
      const { rpc, payload } = buildCourseAssignmentDraftRpc({
        activityId: selectedCourseId,
        selected,
        topCandidate
      });
      const { error } = await supabase.rpc(rpc, payload);
      if (error) { showToast(translateSchedulingAssignmentError(error.message, 'שמירת הטיוטה נכשלה'), 'error'); updateCandidateActions(false); return; }
      if (liveCourse) {
        liveCourse.draft_emp_id = String(payload.p_emp_id);
        liveCourse.draft_instructor_name = payload.p_instructor_name;
        if (payload.p_proposed_meetings) liveCourse.draft_proposed_meetings = payload.p_proposed_meetings;
      }
      clearScreenDataCache?.();
      invalidatePlanningWorkboard();
      state.courseSchedulingSelectedId = '';
      showToast('הטיוטה נשמרה. המערכת מתכננת את שאר הפעילויות סביבה.', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-confirm-draft]')?.addEventListener('click', (event) => {
      void confirmActivityDraft(selectedCourseId, event.currentTarget);
    });

    detailRoot.querySelector('[data-cancel-draft]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourseId) return;
      if (!window.confirm('לבטל את הטיוטה?')) return;
      event.target.disabled = true;
      const { data: updatedActivity, error } = await supabase.rpc('cancel_course_assignment_draft', { p_activity_id: selectedCourseId });
      if (error) { showToast(`ביטול הטיוטה נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
      applyReturnedSchedulingActivity(data.activities, updatedActivity);
      clearScreenDataCache?.();
      invalidatePlanningWorkboard();
      state.courseSchedulingSelectedId = '';
      showToast('הטיוטה בוטלה. המערכת מעדכנת את סידור העבודה.', 'success');
      rerender();
    });

    root.querySelector('[data-refresh-distance-coverage]')?.addEventListener('click', async () => {
      if (state.courseSchedulingDistanceCoverageLoading || state.courseSchedulingDistanceLoading) return;
      state.courseSchedulingDistanceCoverageLoading = true;
      rerender();
      try {
        await reloadDistanceCoverage();
        state.courseSchedulingDistanceError = false;
        state.courseSchedulingDistanceDoneMessage = '';
      } catch (error) {
        state.courseSchedulingDistanceError = true;
        state.courseSchedulingDistanceDoneMessage = translateSchedulingRouteError(error.code || error.message, error.message);
      } finally {
        state.courseSchedulingDistanceCoverageLoading = false;
        rerender();
      }
    });

    root.querySelector('[data-update-distances]')?.addEventListener('click', async () => {
      if (state.courseSchedulingDistanceLoading) return;
      state.courseSchedulingDistanceLoading = true;
      state.courseSchedulingDistanceStopRequested = false;
      state.courseSchedulingDistanceError = false;
      state.courseSchedulingDistanceDoneMessage = 'מעדכן מרחקים...';
      state.courseSchedulingDistanceDetails = '';
      rerender();
      let buildResult = null;
      try {
        const initialCoverage = await loadDistanceCoverage(invokeDistanceRoute, 'all');
        state.courseSchedulingDistanceStats = {
          ...initialCoverage,
          action_required_count: initialCoverage.missing_count + initialCoverage.refresh_required_count
        };
        buildResult = await runDistanceBuildLoop({
          invoke: invokeDistanceRoute,
          scope: 'all',
          limit: 25,
          shouldStop: () => !!state.courseSchedulingDistanceStopRequested,
          onProgress: async ({ stats, done, stopped }) => {
            const info = distanceDoneMessage(stats, { done, stopped });
            state.courseSchedulingDistanceStats = {
              ...stats,
              action_required_count: state.courseSchedulingDistanceStats.action_required_count
            };
            state.courseSchedulingDistanceDoneMessage = info.message;
            state.courseSchedulingDistanceDetails = info.details;
            state.courseSchedulingDistanceError = info.error;
            rerender();
          }
        });
        const info = distanceDoneMessage(buildResult.stats, { done: buildResult.done, stopped: buildResult.stopped });
        state.courseSchedulingDistanceStats = buildResult.stats;
        state.courseSchedulingDistanceDoneMessage = info.message;
        state.courseSchedulingDistanceDetails = info.details;
        state.courseSchedulingDistanceError = info.error;
      } catch (error) {
        const info = distanceDoneMessage({}, { errorMessage: translateSchedulingRouteError(error.code || error.message, error.message) });
        state.courseSchedulingDistanceError = true;
        state.courseSchedulingDistanceDoneMessage = info.message;
        state.courseSchedulingDistanceDetails = info.details;
      } finally {
        try {
          const finalCoverage = await reloadDistanceCoverage();
          if (buildResult) {
            const finalStats = { ...buildResult.stats, ...finalCoverage };
            const info = distanceDoneMessage(finalStats, { done: buildResult.done, stopped: buildResult.stopped });
            state.courseSchedulingDistanceStats = finalStats;
            state.courseSchedulingDistanceDoneMessage = info.message;
            state.courseSchedulingDistanceDetails = info.details;
            state.courseSchedulingDistanceError = info.error;
          }
        } catch (coverageError) {
          if (!state.courseSchedulingDistanceError) {
            state.courseSchedulingDistanceError = true;
            state.courseSchedulingDistanceDoneMessage = translateSchedulingRouteError(coverageError.code || coverageError.message, coverageError.message);
          }
        }
        state.courseSchedulingDistanceLoading = false;
        state.courseSchedulingDistanceStopRequested = false;
        rerender();
      }
    });
  }
};

// Keep helper export used by older readiness tests around selection preference.
export {
  pickNearestActionableCourse,
  userFacingStatus,
  STATUS,
  restoreCalculationSnapshot,
  saveCalculationSnapshot,
  runDistrictSchedulingSimulation,
  summarizeDistrictSimulation
};
