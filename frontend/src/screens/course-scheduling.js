import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { loadInstructorSchedulingData } from './instructor-scheduling-data.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import { calculateCandidateTravel } from './course-scheduling-travel.js';
import {
  attachCancelledMeetingsToActivities,
  loadCourseMeetingState,
  israelTodayIso
} from './course-scheduling-meetings.js';
import { isCourseSchedulingInterfaceEligible } from './shared/activity-scheduling-eligibility.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';
import { weekRange, shiftWeek, buildWeekRows, weekCalendarHtml, fixedScheduleHtml, weekNavLabel } from './course-scheduling-calendar.js';
import {
  collectMissingScheduleCourseIds,
  courseSchedulingDataReadiness,
  courseReadinessRows,
  enrichActivitiesWithSchoolAddresses,
  instructorReadinessRows,
  MISSING_SCHEDULE_FILTER_STORAGE_KEY,
  pickNearestActionableCourse,
  loadDistanceCoverage,
  runDistanceBuildLoop,
  translateSchedulingRouteError
} from './course-scheduling-distance-build.js';
import { instructionLanguageLabel } from './shared/instruction-language.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, filterMeetingsByCourseSchedulingPeriod, periodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import { OPERATIONAL_DISTRICTS, normalizeOperationalDistrict } from './shared/district-normalization.js';
import { loadSchoolCalendarRows } from './shared/school-calendar-data.js';
import { SCORE_WEIGHTS, formatWorkloadHours } from './course-scheduling-score.js';
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

export { formatWorkloadHours, MAX_HOME_DISTANCE_KM, formatAffectedMeetingsPhrase };

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

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((output, row) => {
  const id = text(row[key]);
  if (id) (output[id] ||= []).push(row);
  return output;
}, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);
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

function withSelectedPeriod(course, state = {}) {
  return { ...course, periodKey: selectedPeriodKey(state) };
}

function authorityOptions(courses = []) {
  return [...new Set(courses.map((course) => text(course.authority)).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

function districtValue(row = {}) {
  return normalizeOperationalDistrict(row.district || row.school_district || row.authority_district);
}

function filteredInterfaceCourses(courses = [], state = {}) {
  const periodKey = selectedPeriodKey(state);
  const district = text(state.courseSchedulingDistrict || '');
  const authority = text(state.courseSchedulingAuthority || '');
  return courses
    .filter((course) => {
      const meetings = activityMeetings(course);
      return meetings.length === 0 || filterMeetingsByCourseSchedulingPeriod(meetings, periodKey).length;
    })
    .filter((course) => !district || districtValue(course) === district)
    .filter((course) => !authority || text(course.authority) === authority)
    .map((course) => withSelectedPeriod(course, state));
}

function schedulingScopeHtml(allCourses = [], state = {}) {
  const periodKey = selectedPeriodKey(state);
  const period = resolveCourseSchedulingPeriod(periodKey);
  const periodButtons = periodOptions().map((option) => `<button type="button" class="course-scheduling-tab${option.key === periodKey ? ' is-active' : ''}" data-period-key="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`).join('');
  const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
  const districtSelectHtml = `<option value="">כל המחוזות</option>${OPERATIONAL_DISTRICTS.map((item) => `<option value="${escapeHtml(item)}"${item === district ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  const scopedForAuthority = allCourses.filter((course) => filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), periodKey).length).filter((course) => !district || districtValue(course) === district);
  const selectedAuthority = text(state.courseSchedulingAuthority || '');
  const authorityList = authorityOptions(scopedForAuthority);
  const authoritySelectHtml = `<option value="">כל הרשויות</option>${authorityList.map((item) => `<option value="${escapeHtml(item)}"${item === selectedAuthority ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}`;
  const periodRange = `${formatDateHeDots(period.start)} – ${formatDateHeDots(period.end)}`;
  const districtPlanDisabled = !district || !!state.courseSchedulingSimulationLoading;
  return `<section class="course-scheduling-scope"><div class="course-scheduling-scope-inner">
    <div class="course-scheduling-tabs course-scheduling-tabs--inner">${periodButtons}</div>
    <label class="course-scheduling-filter-label">מחוז<select class="course-scheduling-input" data-district-filter>${districtSelectHtml}</select></label>
    <label class="course-scheduling-filter-label">רשות<select class="course-scheduling-input" data-authority-filter>${authoritySelectHtml}</select></label>
    <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-run-district-simulation ${districtPlanDisabled ? 'disabled' : ''} title="${district ? 'הפעלת סימולציית תכנון למחוז הנבחר' : 'יש לבחור מחוז'}">הפעל תכנון מחוזי</button>
    <p class="course-scheduling-period-range course-scheduling-period-range--push">${escapeHtml(periodRange)}</p>
  </div></section>`;
}

function activeTab(state) {
  return ['courses', 'calendar', 'maintenance'].includes(state.courseSchedulingTab)
    ? state.courseSchedulingTab
    : 'courses';
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

function courseRowModel(course, resultByCourseId) {
  const id = idOf(course);
  const isAssigned = !!text(course.emp_id);
  const hasDraft = !isAssigned && !!text(course.draft_emp_id);
  const result = resultByCourseId.get(id) || null;
  let bucket = null;
  let statusLabel = STATUS.waiting;

  if (isAssigned) {
    statusLabel = STATUS.assigned;
    if (text(course.instructor_assignment_status) === 'נדרש טיפול') {
      bucket = 'treatment';
      statusLabel = STATUS.problem;
    }
  } else if (hasDraft) {
    bucket = 'draft';
    statusLabel = STATUS.draft;
  } else if (!result) {
    bucket = daysUntil(course.start_date) <= 7 ? 'soon' : daysUntil(course.start_date) <= 14 ? 'upcoming' : 'later';
    statusLabel = STATUS.waiting;
  } else if (result.status === 'חסר מידע') { bucket = 'missing'; statusLabel = STATUS.missing; }
  else if (result.status === 'נדרש גיוס') { bucket = 'recruit'; statusLabel = STATUS.recruit; }
  else if (result.status === 'נדרש טיפול') { bucket = 'treatment'; statusLabel = STATUS.problem; }
  else {
    const days = daysUntil(course.start_date);
    bucket = days <= 7 ? 'soon' : days <= 14 ? 'upcoming' : 'later';
    statusLabel = STATUS.ready;
  }

  return { course, id, result, isAssigned, hasDraft, bucket, statusLabel };
}

const LIST_GROUPS = [
  { key: 'soon', label: 'מתחילים בתוך 7 ימים' },
  { key: 'upcoming', label: 'מתחילים בתוך 8–14 ימים' },
  { key: 'later', label: 'מתחילים בהמשך' },
  { key: 'draft', label: 'שמורים כטיוטה' },
  { key: 'missing', label: 'חסרים פרטים' },
  { key: 'recruit', label: 'נדרש גיוס' },
  { key: 'treatment', label: 'נדרשת בדיקה' }
];

function summaryCardsHtml(interfaceCourses, results, readiness = {}) {
  const waiting = interfaceCourses.filter((course) => !text(course.emp_id) && !text(course.draft_emp_id)).length;
  const drafts = interfaceCourses.filter((course) => !text(course.emp_id) && text(course.draft_emp_id)).length;
  const ready = results.filter((result) => result.status === 'הצעה מוכנה').length;
  const missing = Number(readiness.missingScheduleCount) || 0;
  return `<article class="course-scheduling-summary-card course-scheduling-summary-card--waiting"><b>${waiting}</b><span>ממתינים לשיבוץ</span></article>
    <article class="course-scheduling-summary-card course-scheduling-summary-card--ready"><b>${ready}</b><span>הצעות מוכנות</span></article>
    <article class="course-scheduling-summary-card course-scheduling-summary-card--draft"><b>${drafts}</b><span>טיוטות</span></article>
    <button type="button" class="course-scheduling-summary-card course-scheduling-summary-card--missing course-scheduling-summary-card--button" data-open-readiness-drawer><b>${missing}</b><span>חסרי מידע</span></button>`;
}

function instructorCellLabel(row) {
  const course = row?.course || {};
  const assignedName = text(course.instructor_name || course.instructor_full_name || course.emp_name || course.employee_name);
  if (assignedName) return assignedName;
  if (row?.statusLabel === STATUS.assigned) return STATUS.assigned;
  if (row?.statusLabel === STATUS.draft) return 'טיוטת מדריך';
  return 'טרם שובץ';
}

function actionLabelForRow(row) {
  if (row?.statusLabel === STATUS.assigned) return 'החלף מדריך';
  if (row?.statusLabel === STATUS.draft) return 'פתח טיוטה';
  if (row?.statusLabel === STATUS.ready) return 'בדוק מדריכים';
  return 'מצא מדריך';
}

function courseListCardHtml(row, selectedId) {
  const c = row.course;
  const selectedClass = row.id === selectedId ? ' is-selected' : '';
  const school = text(c.school) || '—';
  const authority = text(c.authority) || '—';
  const courseName = text(c.activity_name) || '—';
  return `<div class="course-scheduling-compact-row course-scheduling-course-card${selectedClass}" data-course-card="${escapeHtml(row.id)}" role="button" tabindex="0" aria-label="${escapeHtml(`${school}, ${authority}, ${courseName}`)}">
    <span class="course-scheduling-compact-cell course-scheduling-compact-school" title="${escapeHtml(school)}">${escapeHtml(school)}</span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-authority" title="${escapeHtml(authority)}">${escapeHtml(authority)}</span>
    <strong class="course-scheduling-compact-cell course-scheduling-compact-course" title="${escapeHtml(courseName)}">${escapeHtml(courseName)}</strong>
    <span class="course-scheduling-compact-cell course-scheduling-compact-status"><span class="course-scheduling-status-chip${cardStatusClass(row.statusLabel)}">${escapeHtml(row.statusLabel)}</span></span>
    ${row.id === selectedId ? `<div class="course-scheduling-inline-details" data-expanded-course-details>${selectedCourseMetaHtml(c)}</div>` : ''}
  </div>`;
}

function courseListHtml(rowModels, selectedId) {
  const groups = LIST_GROUPS.map((group) => ({ ...group, rows: rowModels.filter((row) => row.bucket === group.key) })).filter((group) => group.rows.length);
  if (!groups.length) {
    return `<div class="course-scheduling-empty">
      <strong>אין קורסים הממתינים לשיבוץ</strong>
      <p>שיבוצים שבוצעו יופיעו בלשונית המערכת השבועית.</p>
    </div>`;
  }
  const header = '<div class="course-scheduling-compact-table-head" aria-hidden="true"><span>בית ספר</span><span>רשות</span><span>קורס</span><span>סטטוס</span></div>';
  return header + groups.map((group) => `<section class="course-scheduling-course-group"><h3>${escapeHtml(group.label)} <span class="course-scheduling-badge">${group.rows.length}</span></h3>${group.rows.map((row) => courseListCardHtml(row, selectedId)).join('')}</section>`).join('');
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
  return `<span class="course-scheduling-candidate-badges" aria-label="התאמה לדרישות הקורס">${rows.map(([label, passed, title]) => `<span class="course-scheduling-mini-check${passed ? ' is-pass' : ' is-fail'}" title="${escapeHtml(title)}">${passed ? '✓' : '✗'} ${escapeHtml(label)}<span class="sr-only"> ${escapeHtml(title)}</span></span>`).join('')}</span>`;
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

function specialRequirementTagsHtml(course) {
  if (genderRequirementLabel(course) === 'ללא דרישה') return '';
  const label = genderRequirementLabel(course) === 'מדריכה' ? 'נדרשת מדריכה' : 'נדרש מדריך';
  return `<div class="course-scheduling-requirement-tags"><span class="course-scheduling-requirement-tag">${escapeHtml(label)}</span></div>`;
}

function selectedCourseMetaHtml(course) {
  return `<header class="course-scheduling-detail-header">
    <dl class="course-scheduling-detail-facts">${courseFactRows(course).map(([label, value]) => `<div class="course-scheduling-detail-fact"><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join('')}</dl>
    ${specialRequirementTagsHtml(course)}
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
    <h4>התאמה לדרישות הקורס</h4>
    <ul class="course-scheduling-check-list">
      ${checkRowHtml('מגדר', checks.gender)}
      ${checkRowHtml('שפה', checks.language)}
      ${checkRowHtml('זמינות', { ...availability, label: availabilityLabelText, passed: availability.passed })}
      ${checkRowHtml('מרחק', { ...travel, label: travelLabel, passed: travel.passed })}
    </ul>
  </div>`;
}

const SCORE_COMPONENT_DISPLAY = [
  { key: 'continuityEfficiency', name: 'רציפות ויעילות ביום', max: SCORE_WEIGHTS.continuityEfficiency },
  { key: 'travelDistance', name: 'מרחק ונסיעות', max: SCORE_WEIGHTS.travelDistance },
  { key: 'actualWorkload', name: 'עומס עבודה בפועל', max: SCORE_WEIGHTS.actualWorkload },
  { key: 'originalSchedulePreservation', name: 'שמירה על המועדים המקוריים', max: SCORE_WEIGHTS.originalSchedulePreservation },
  { key: 'gapsAndNewDays', name: 'צמצום חלונות ופתיחת ימי עבודה', max: SCORE_WEIGHTS.gapsAndNewDays }
];

export function scoreBreakdownHtml(candidate) {
  const breakdown = candidate?.scoreBreakdown;
  if (!breakdown) {
    return `<div class="course-scheduling-score-breakdown"><h4>פירוט הציון</h4><p class="course-scheduling-muted">אין ציון להצגה — תנאי סף לא התקיימו.</p></div>`;
  }
  return `<div class="course-scheduling-score-breakdown">
    <h4>פירוט הציון · ${candidate.score ?? '—'}/100</h4>
    ${scoreComponentsHtml(candidate)}
    <p class="course-scheduling-score-note">פעילות, כתובת, זמינות, שפה ומגדר כאשר נדרש הם תנאי סף ואינם מוסיפים נקודות.</p>
  </div>`;
}

function scoreComponentsHtml(candidate) {
  const breakdown = candidate?.scoreBreakdown;
  if (!breakdown) return '<p class="course-scheduling-muted">אין ציון להצגה — תנאי סף לא התקיימו.</p>';
  return `<ul class="course-scheduling-score-bars">
    ${SCORE_COMPONENT_DISPLAY.map(({ key, name, max }) => {
      const row = breakdown[key] || {};
      const points = Number(row.points) || 0;
      const pct = max > 0 ? Math.max(0, Math.min(100, (points / max) * 100)) : 0;
      // Only show an explanatory line when it adds real information — never repeat the component title.
      const usefulNote = text(row.note);
      const showNote = usefulNote && usefulNote !== name;
      return `<li class="course-scheduling-score-bar" data-score-component="${escapeHtml(key)}">
        <div class="course-scheduling-score-bar__head">
          <span class="course-scheduling-score-bar__name">${escapeHtml(name)}</span>
          <b class="course-scheduling-score-bar__value" aria-label="${escapeHtml(name)}: ${points} מתוך ${max}">${points} מתוך ${max}</b>
        </div>
        <div class="course-scheduling-score-bar__track" role="presentation"><span class="course-scheduling-score-bar__fill" style="--score-pct:${pct}%"></span></div>
        ${showNote ? `<p class="course-scheduling-score-bar__note">${escapeHtml(usefulNote)}</p>` : ''}
      </li>`;
    }).join('')}
  </ul>`;
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
  // One clear status badge only — no repeated equivalent pills.
  const statusText = kind === 'recommended' ? 'מומלץ' : 'נדרשת בדיקה';
  const radioId = `course-candidate-primary-${escapeHtml(id || 'x')}`;
  return `<article class="course-scheduling-primary-card${selected}${expanded ? ' is-expanded' : ''}" data-candidate-row="${escapeHtml(id)}" data-candidate-kind="${statusLabel}" aria-expanded="${expanded}">
    <div class="course-scheduling-primary-card__body">
      <div class="course-scheduling-primary-card__topline">
        <span class="course-scheduling-primary-card__name">${escapeHtml(candidate.instructor?.full_name || id)}</span>
        <div class="course-scheduling-primary-card__score" aria-label="ציון ${candidate.score ?? '—'}/100">
          <strong>${candidate.score ?? '—'}</strong><span>/100</span>
        </div>
        ${kind === 'recommended' ? `<span class="course-scheduling-status-pill course-scheduling-status-pill--ready">${escapeHtml(statusText)}</span>` : ''}
      </div>
      ${expanded ? `<div class="course-scheduling-candidate-expanded" data-candidate-expanded>
        <label class="course-scheduling-primary-card__select" for="${radioId}">
          <input id="${radioId}" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}> בחירת מדריך
        </label>
        ${text(candidate.recommendationReason) ? `<p class="course-scheduling-primary-card__reason">${escapeHtml(candidate.recommendationReason)}</p>` : ''}
        <div class="course-scheduling-candidate-meta">${candidateMetaLine(candidate)}</div>
        ${requirementsFitHtml(candidate)}
        <div class="course-scheduling-primary-card__breakdown"><h4>פירוט הציון</h4>${scoreComponentsHtml(candidate)}</div>
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

function alternativeCandidateCardHtml(candidate, { selectedId = '', expandedId = '', name = 'course-candidate' } = {}) {
  const id = emp(candidate);
  const checked = id && id === selectedId ? ' checked' : '';
  const selected = id && id === selectedId ? ' is-selected' : '';
  const expanded = id && id === expandedId;
  const radioId = `course-candidate-alt-${escapeHtml(id || 'x')}`;
  return `<div class="cs-alt-row${selected}${expanded ? ' is-expanded' : ''}" data-candidate-row="${escapeHtml(id)}" aria-expanded="${expanded}">
    <span class="cs-alt-row__name">${escapeHtml(candidate.instructor?.full_name || id)}</span>
    <span class="cs-alt-row__score" aria-label="ציון ${candidate.score ?? '—'} מתוך 100">${candidate.score ?? '—'}<small>/100</small></span>
    ${expanded ? `<div class="cs-alt-row__details course-scheduling-candidate-expanded" data-candidate-expanded>
      <label for="${radioId}"><input id="${radioId}" type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}> בחירת מדריך</label>
      ${text(candidate.recommendationReason) ? `<p class="course-scheduling-primary-card__reason">${escapeHtml(candidate.recommendationReason)}</p>` : ''}
      <div class="course-scheduling-candidate-meta">${candidateMetaLine(candidate)}</div>
      ${requirementsFitHtml(candidate)}
      <div class="course-scheduling-primary-card__breakdown"><h4>פירוט הציון</h4>${scoreComponentsHtml(candidate)}</div>
    </div>` : ''}
  </div>`;
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
        const failures = candidate.failures || [];
        const primary = failures[0] || 'לא עומד בתנאי הסף';
        const additionalFailures = failures.slice(1);
        // Avoid re-printing a missing-profile reason already shown as the primary/additional failure.
        const missing = (candidate.missingProfileData || []).filter((item) => {
          const value = text(item);
          return value && !failures.some((failure) => text(failure).includes(value) || value.includes(text(failure)));
        });
        return `<div class="course-scheduling-rejected-row" data-rejected-candidate="${escapeHtml(emp(candidate))}">
          <strong>${escapeHtml(candidate.instructor?.full_name || emp(candidate) || '—')}</strong>
          <div class="course-scheduling-rejected-row__details">
            <p class="course-scheduling-rejected-primary">${escapeHtml(primary)}</p>
            ${additionalFailures.length ? `<ul class="course-scheduling-rejected-failures">${additionalFailures.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}
            ${missing.length ? `<p class="course-scheduling-rejected-missing">נתונים חסרים: ${escapeHtml(missing.join(' · '))}</p>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>
  </details>`;
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

function resultsActionsHtml(result, selectedId) {
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
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-assign-course disabled title="בחרו מדריך כשיר">שבץ מדריך</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-save-draft disabled title="בחרו מדריך כשיר">שמור כטיוטה</button>
        <button type="button" class="course-scheduling-text-btn" data-clear-candidate>ביטול</button>
      </div>
    </div>`;
}

function candidatesResultsLayoutHtml(result, state, { primary, kind }) {
  const selectedId = text(state.courseSchedulingSelectedCandidateId);
  const expandedId = text(state.courseSchedulingExpandedCandidateId);
  const radioName = `course-candidate-${idOf(result.course)}`;
  const alternatives = (result.alternatives || []).filter((item) => item?.eligible);
  const title = kind === 'recommended'
    ? 'המדריך המומלץ'
    : 'ההתאמה הטובה ביותר שנמצאה';
  return `<div class="course-scheduling-result-block" data-course-options>
    <div class="course-scheduling-result-heading">
      <h3>${title}</h3>
    </div>
    ${primaryCandidateCardHtml(primary, { kind, selectedId, expandedId, name: radioName })}
    ${alternatives.length ? `<section class="course-scheduling-alternatives" data-alternatives>
      <h4>חלופות מתאימות</h4>
      <div class="cs-alt-table">
        ${alternatives.map((item) => alternativeCandidateCardHtml(item, { selectedId, expandedId, name: radioName })).join('')}
      </div>
    </section>` : ''}
    ${rejectedCandidatesHtml(result)}
    ${resultsActionsHtml(result, selectedId)}
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
      <h3>חסרים פרטים לקורס זה</h3>
      <p>${escapeHtml((result.missing || []).join(' · ') || 'יש להשלים פרטים בפעילות לפני שיבוץ.')}</p>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות לתיקון</button>
    </div>`;
  }
  if (!result?.recommended && result?.bestAvailable) {
    return candidatesResultsLayoutHtml(result, state, { primary: result.bestAvailable, kind: 'bestAvailable' });
  }
  if (!result?.recommended && result?.status === 'נדרש גיוס') {
    return `<div class="course-scheduling-result-block">
      <h3>לא נמצא מדריך שעומד בתנאי הסף</h3>
      <p>${escapeHtml(result.treatmentReason || 'כל המדריכים הפעילים והמוכנים נבדקו וחישובי המסלולים הושלמו, אך אף מדריך אינו עומד בכל תנאי הסף.')}</p>
      <details class="course-scheduling-details"><summary>הצגת פרטים</summary>
        <p>שפת הדרכה: ${escapeHtml(instructionLanguageLabel(result.course))} · מגדר: ${escapeHtml(result.course.required_instructor_gender || 'ללא')}</p>
      </details>
      ${rejectedCandidatesHtml(result)}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות</button>
    </div>`;
  }
  if (!result?.recommended && result?.status === 'נדרש טיפול') {
    return `<div class="course-scheduling-result-block">
      <h3>נדרשת בדיקה נוספת</h3>
      <p>${escapeHtml(result.treatmentReason || 'לא ניתן להציע שיבוץ אוטומטי לקורס זה כרגע.')}</p>
      ${incompleteProfilesHtml(result)}
      ${rejectedCandidatesHtml(result)}
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
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-cancel-draft>בטל טיוטה</button>
    </div>`;
}

function assignedDetailHtml(row) {
  const c = row.course;
  return `<p class="course-scheduling-status-chip is-ready">${STATUS.assigned}</p>
    <p>מדריך משובץ: <b>${escapeHtml(c.instructor_name || c.emp_id)}</b></p>
    <p class="course-scheduling-muted">השיבוץ אושר ומופיע בסידור העבודה.</p>`;
}

function selectedCoursePanelHtml(row, state) {
  if (!row) {
    return `<div class="course-scheduling-empty course-scheduling-empty--center">
      <strong>בחר קורס כדי להתחיל</strong>
      <p>בחרו קורס מהרשימה כדי לראות פרטים ולמצוא מדריכים מתאימים.</p>
    </div>`;
  }
  if (row.isAssigned) return assignedDetailHtml(row);
  if (row.hasDraft) return draftDetailHtml(row.course);

  const finding = !!state.courseSchedulingLoading;
  const result = row.result;
  const hasSuggestion = !!result?.recommended;
  const findButtonClass = hasSuggestion
    ? 'course-scheduling-btn course-scheduling-btn--secondary'
    : 'course-scheduling-btn course-scheduling-btn--primary course-scheduling-btn--xl';
  return `<div class="course-scheduling-primary-action">
      <button type="button" class="${findButtonClass}" data-find-instructors ${finding ? 'disabled' : ''}>
        ${finding ? 'בודק מדריכים...' : (hasSuggestion ? 'בדיקה מחדש של מדריכים' : 'מצא מדריכים מתאימים')}
      </button>
    </div>
    ${finding ? loadingInstructorsHtml(state.courseSchedulingProgressStep || 1) : instructorsResultsHtml(result, state)}`;
}

function readinessValue(value, fallback = '—') {
  return text(value) || fallback;
}

function courseReadinessListHtml(rows = []) {
  if (!rows.length) return '<p class="course-scheduling-muted">כל הקורסים הפתוחים מוכנים לשיבוץ.</p>';
  return rows.map(({ course, missing }) => `<article class="course-scheduling-readiness-row">
    <h4>${escapeHtml(readinessValue(course.activity_name || course.program_name || course.name || course.title))}</h4>
    <p>${escapeHtml(readinessValue(course.school))} · ${escapeHtml(readinessValue(course.authority))}</p>
    <p><b>חסר להשלמה:</b> ${escapeHtml(missing.join(' · '))}</p>
    <div class="course-scheduling-readiness-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-open-readiness-course="${escapeHtml(idOf(course))}">השלמת פרטים</button>
    </div>
  </article>`).join('');
}

function instructorReadinessListHtml(rows = []) {
  if (!rows.length) return '<p class="course-scheduling-muted">כל המדריכים הפעילים מוכנים לשיבוץ.</p>';
  return rows.map(({ instructor, missing }) => `<article class="course-scheduling-readiness-row">
    <h4>${escapeHtml(readinessValue(instructor.full_name || instructor.emp_id))}</h4>
    ${text(instructor.address) ? `<p>${escapeHtml(instructor.address)}</p>` : ''}
    <p><b>חסר להשלמה:</b> ${escapeHtml(missing.join(' · '))}</p>
    <div class="course-scheduling-readiness-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-open-instructor-matching="${escapeHtml(text(instructor.emp_id))}">עריכת התאמה</button>
      <button type="button" class="course-scheduling-text-btn" data-open-instructor-constraints="${escapeHtml(text(instructor.emp_id))}">עדכון זמינות ואילוצים</button>
    </div>
  </article>`).join('');
}

function dataReadinessHtml(data, state = {}) {
  const courseRows = courseReadinessRows(data?.activities || []);
  const instructorRows = instructorReadinessRows(data || {});
  const tab = state.courseSchedulingReadinessTab === 'instructors' ? 'instructors' : 'courses';
  return `<div class="course-scheduling-maintenance-panel course-scheduling-readiness" data-readiness-panel>
    <h3 id="course-scheduling-readiness-title" class="course-scheduling-readiness-title">מוכנות לשיבוץ</h3>
    <nav class="course-scheduling-tabs course-scheduling-tabs--inner" aria-label="מוכנות לשיבוץ">
      <button type="button" class="course-scheduling-tab${tab === 'courses' ? ' is-active' : ''}" data-readiness-tab="courses">קורסים להשלמה (${courseRows.length})</button>
      <button type="button" class="course-scheduling-tab${tab === 'instructors' ? ' is-active' : ''}" data-readiness-tab="instructors">מדריכים להשלמה (${instructorRows.length})</button>
    </nav>
    <div class="course-scheduling-readiness-list">${tab === 'courses' ? courseReadinessListHtml(courseRows) : instructorReadinessListHtml(instructorRows)}</div>
  </div>`;
}

function dataReadinessDrawerHtml(data, state = {}) {
  if (!state.courseSchedulingShowDataReadiness) return '';
  return `<div class="course-scheduling-overlay course-scheduling-overlay--drawer" data-course-scheduling-overlay>
    <aside class="course-scheduling-drawer" role="dialog" aria-modal="true" aria-labelledby="course-scheduling-readiness-title">
      <button type="button" class="course-scheduling-close" data-close-course-scheduling-overlay aria-label="סגירה">×</button>
      ${dataReadinessHtml(data, state)}
    </aside>
  </div>`;
}

function maintenanceTabHtml(state) {
  const distanceBusy = !!state.courseSchedulingDistanceLoading;
  const coverageLoading = !!state.courseSchedulingDistanceCoverageLoading;
  const stats = state.courseSchedulingDistanceStats || {};
  const count = (key) => coverageLoading && stats[key] == null ? '…' : Number(stats[key]) || 0;
  const doneMessage = text(state.courseSchedulingDistanceDoneMessage);
  const doneError = !!state.courseSchedulingDistanceError;
  return `<section class="course-scheduling-maintenance-tab" aria-labelledby="course-scheduling-maintenance-heading">
    <h2 id="course-scheduling-maintenance-heading" class="course-scheduling-visually-hidden">פעולות תחזוקה</h2>
    <article class="course-scheduling-maintenance-card">
      <div>
        <h3>עדכון מרחקים</h3>
        <p>מרחקים קיימים: ${count('existing_count')} מתוך ${count('required_count')}</p>
        <p>חסרים: ${count('missing_count')}</p>
        <p>דורשים רענון: ${count('refresh_required_count')}</p>
        ${doneMessage ? `<p class="${doneError ? 'course-scheduling-alert' : 'course-scheduling-success'}">${escapeHtml(doneMessage)}</p>` : ''}
      </div>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-update-distances ${distanceBusy || coverageLoading ? 'disabled' : ''}>${distanceBusy ? 'מעדכן מרחקים...' : 'עדכן מרחקים'}</button>
    </article>
    <article class="course-scheduling-maintenance-card">
      <div><h3>בדיקת נתונים</h3><p>איתור פעילויות, מדריכים או כתובות שחסר בהם מידע הנדרש לשיבוץ.</p></div>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-maintenance-action="readiness">פתח בדיקת נתונים</button>
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
        <p>שיבוצים שבוצעו במסך "קורסים לשיבוץ" יופיעו כאן.</p>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-empty-action" data-switch-tab="courses">מעבר לקורסים לשיבוץ</button>
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

export function meetingInstructorHistoryHtml(meetingRows, replacements) {
  if (!meetingRows?.length) return '';
  const effectiveDates = new Set((replacements || []).map((row) => text(row.effective_from)));
  const rows = meetingRows.map((row) => {
    const isEffectiveFrom = effectiveDates.has(text(row.meeting_date));
    const marker = isEffectiveFrom ? ' <span class="course-scheduling-status-chip">מכאן ואילך</span>' : '';
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
  if (done) return { message: 'כל המרחקים מעודכנים', details: '', error: false };
  const processed = (Number(stats.inserted_count) || 0) + (Number(stats.renewed_count) || 0) + (Number(stats.failed_count) || 0);
  const total = Number(stats.action_required_count) || processed + remaining;
  return { message: `מעדכן ${processed} מתוך ${total}...`, details: '', error: false };
}

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling, meetingState, schoolLocations, schoolCalendar, authResult] = await Promise.all([
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true, select: 'row_id,district,authority_id,authority,school,school_id,activity_name,catalog_slug,activity_no,proposal_item_id,activity_type,item_type,activity_season,grade,education_level,class_group,sessions,start_time,end_time,instruction_language,required_instructor_gender,scheduling_note,instructor_assignment_status,instructor_assignment_locked,draft_emp_id,draft_instructor_name,draft_created_at,draft_proposed_meetings,emp_id,instructor_name,emp_id_2,instructor_name_2,start_date,end_date,status,date_1,date_2,date_3,date_4,date_5,date_6,date_7,date_8,date_9,date_10,date_11,date_12,date_13,date_14,date_15,date_16,date_17,date_18,date_19,date_20,date_21,date_22,date_23,date_24,date_25,date_26,date_27,date_28,date_29,date_30,date_31,date_32,date_33,date_34,date_35' }),
      api.instructorContacts(),
      loadInstructorSchedulingData(),
      loadCourseMeetingState(),
      supabase.rpc('scheduling_authority_school_locations'),
      loadSchoolCalendarRows(),
      supabase.auth.getSession()
    ]);
    const schoolRows = schoolLocations?.data || [];
    const schoolAddressLookupError = schoolLocations?.error
      ? translateSchedulingRouteError('school_address_lookup_failed')
      : '';
    const enriched = enrichActivitiesWithSchoolAddresses(activities?.rows || [], schoolRows);
    return {
      activities: attachCancelledMeetingsToActivities(enriched.activities, meetingState),
      instructors: contacts?.rows || [],
      scheduling,
      meetingState,
      schoolLocations: schoolRows,
      schoolCalendar,
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
      schoolAddressLookupError
    };
  },

  render(data, { state }) {
    ensureCourseSchedulingStyles();
    if (!['admin', 'operation_manager'].includes(text(state?.user?.role))) {
      return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בשיבוץ קורסים.'));
    }

    const allInterfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
    const interfaceCourses = filteredInterfaceCourses(allInterfaceCourses, state);
    restoreCalculationSnapshot(state, interfaceCourses, schedulingSnapshotContext(data));
    const results = state.courseSchedulingResults || [];
    const resultByCourseId = new Map(results.map((result) => [idOf(result.course), result]));
    const rowModels = interfaceCourses.map((course) => courseRowModel(course, resultByCourseId));
    const tab = activeTab(state);
    const selectedId = state.courseSchedulingSelectedId || '';
    const selectedRow = rowModels.find((row) => row.id === selectedId)
      || (selectedId ? courseRowModel(interfaceCourses.find((course) => idOf(course) === selectedId) || { row_id: selectedId }, resultByCourseId) : null);
    const readiness = courseSchedulingDataReadiness(data.activities || []);
    return dsScreenStack(`${instructorsWorkspaceNavStylesHtml()}
    <div class="course-scheduling-screen" dir="rtl" data-cs-ui="ux-polish-20260805-v1" data-cs-tab="${escapeHtml(tab)}">
      ${instructorsWorkspaceHeaderHtml({ activeTab: tab === 'maintenance' ? 'maintenance' : 'scheduling', state })}

      ${tab === 'maintenance'
        ? maintenanceTabHtml(state)
        : `${schedulingScopeHtml(allInterfaceCourses, state)}
      ${state.courseSchedulingSimulationView
        ? districtSimulationPanelHtml({
          rows: state.courseSchedulingSimulationRows || [],
          counts: state.courseSchedulingSimulationCounts || summarizeDistrictSimulation([]),
          statusFilter: state.courseSchedulingSimulationStatusFilter || '',
          selectedId,
          selectedCourseIds: state.courseSchedulingSimulationSelectedIds,
          district: normalizeOperationalDistrict(state.courseSchedulingDistrict || ''),
          loading: !!state.courseSchedulingSimulationLoading,
          error: state.courseSchedulingSimulationError || '',
          saving: !!state.courseSchedulingSimulationSaving,
          confirmSave: !!state.courseSchedulingSimulationConfirmSave,
          saveResult: state.courseSchedulingSimulationSaveResult || null
        })
        : `
      <section class="course-scheduling-summary">${summaryCardsHtml(interfaceCourses, results, readiness)}</section>
      <p data-course-scheduling-error class="course-scheduling-alert"${state.courseSchedulingError ? '' : ' hidden'}>${escapeHtml(state.courseSchedulingError || '')}</p>
      <div class="course-scheduling-layout course-scheduling-layout--courses">
        <aside class="course-scheduling-courses">${courseListHtml(rowModels, selectedId)}</aside>
        <section class="course-scheduling-detail" data-course-detail>${
          !interfaceCourses.length
            ? `<div class="course-scheduling-empty course-scheduling-empty--center">
                <strong>אין קורסים לשיבוץ כרגע</strong>
                <p>כשיופיעו קורסים ממתינים, תוכלו לבחור קורס ולהתחיל שיבוץ.</p>
              </div>`
            : selectedCoursePanelHtml(selectedRow?.course ? selectedRow : null, state)
        }</section>
      </div>
    `}`}
      ${dataReadinessDrawerHtml(data, state)}
    </div>`);
  },

  bind({ root, data, state, rerender, clearScreenDataCache }) {
    const canEdit = ['admin', 'operation_manager'].includes(text(state?.user?.role));
    const resultByCourseId = new Map((state.courseSchedulingResults || []).map((result) => [idOf(result.course), result]));
    const allInterfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
    const interfaceCourses = filteredInterfaceCourses(allInterfaceCourses, state);
    // Include all loaded activities so district draft-save can validate courses outside the authority filter.
    const courseById = new Map(
      (data.activities || [])
        .map((course) => [idOf(course), course])
        .filter(([id]) => !!id)
    );
    bindInstructorsWorkspaceNav(root, { state, rerender });

    if (activeTab(state) === 'maintenance'
      && !state.courseSchedulingDistanceCoverageLoaded
      && !state.courseSchedulingDistanceCoverageLoading) {
      state.courseSchedulingDistanceCoverageLoading = true;
      loadDistanceCoverage((body) => supabase.functions.invoke('scheduling-route', { body }))
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

    const openMissingScheduleCourses = () => {
      const missingIds = collectMissingScheduleCourseIds(data.activities || []);
      try {
        sessionStorage.setItem(MISSING_SCHEDULE_FILTER_STORAGE_KEY, JSON.stringify(missingIds));
      } catch { /* storage may be unavailable */ }
      state.activitiesMissingScheduleOnly = true;
      state.activityPeriodTab = 'school_2027';
      state.activitiesInnerTab = 'year_all';
      state.activitiesMonthYm = '';
      state.allActivitiesStatusFilter = 'all';
      state.listFilters ||= {};
      state.listFilters.activities = {
        ...(state.listFilters.activities || {}),
        q: '',
        appliedQ: '',
        visibleCount: 10000
      };
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'activities' } }));
    };

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

    root.querySelectorAll('[data-switch-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.courseSchedulingTab = ['courses', 'calendar', 'maintenance'].includes(button.dataset.switchTab)
          ? button.dataset.switchTab
          : 'courses';
        state.courseSchedulingShowDistanceConfirm = false;
        state.courseSchedulingShowDataReadiness = false;
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

    root.querySelectorAll('[data-open-readiness-drawer]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingShowDataReadiness = true;
      state.courseSchedulingShowDistanceConfirm = false;
      state.courseSchedulingReadinessTab = 'courses';
      rerender();
    }));
    root.querySelector('[data-open-missing-schedule-courses]')?.addEventListener('click', openMissingScheduleCourses);

    root.querySelectorAll('[data-readiness-tab]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingReadinessTab = button.dataset.readinessTab === 'instructors' ? 'instructors' : 'courses';
      rerender();
    }));
    root.querySelectorAll('[data-open-readiness-course]').forEach((button) => button.addEventListener('click', () => openMissingCourse(button.dataset.openReadinessCourse)));
    root.querySelectorAll('[data-open-instructor-matching],[data-open-instructor-constraints]').forEach((button) => button.addEventListener('click', () => {
      const empId = button.dataset.openInstructorMatching || button.dataset.openInstructorConstraints || '';
      state.instructorsWorkspace = { ...(state.instructorsWorkspace || {}), active: 'yes', assignment: '' };
      state.pendingInstructorEmpId = empId;
      state.pendingInstructorEdit = button.dataset.openInstructorMatching ? 'matching' : 'constraints';
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructors' } }));
    }));

    root.querySelectorAll('[data-maintenance-action]').forEach((button) => {
      button.addEventListener('click', async () => {
        state.courseSchedulingShowDataReadiness = true;
        state.courseSchedulingShowDistanceConfirm = false;
        state.courseSchedulingReadinessTab = 'courses';
        rerender();
      });
    });

    root.querySelectorAll('[data-close-course-scheduling-overlay]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingShowDistanceConfirm = false;
      state.courseSchedulingShowDataReadiness = false;
      rerender();
    }));
    root.querySelectorAll('[data-course-scheduling-overlay]').forEach((overlay) => overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        state.courseSchedulingShowDistanceConfirm = false;
        state.courseSchedulingShowDataReadiness = false;
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
      if (!row || event.target?.closest?.('[data-candidate-expanded]') || event.target?.matches?.('input,button,a,label')) return;
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
        const activitiesWithCancellations = attachCancelledMeetingsToActivities(enriched.activities, data.meetingState);
        data.activities = activitiesWithCancellations;
        data.schoolAddressStats = {
          uniqueSchoolCount: enriched.uniqueSchoolCount,
          duplicateSchoolCount: enriched.duplicateSchoolCount,
          missingCount: enriched.missingCount
        };
        const scheduling = data.scheduling || {};
        const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        const input = {
          activities: activitiesWithCancellations,
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
    root.querySelectorAll('[data-find-instructors]').forEach((button) => {
      button.addEventListener('click', runFindInstructors);
    });

    const runDistrictSimulation = async () => {
      if (state.courseSchedulingSimulationLoading || state.courseSchedulingLoading) return;
      const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
      if (!district) {
        state.courseSchedulingSimulationError = 'יש לבחור מחוז לפני הפעלת תכנון מחוזי';
        state.courseSchedulingSimulationView = true;
        rerender();
        return;
      }
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
        // District simulation scope is half-year + district only. The ordinary authority filter
        // continues to affect the single-course list, but must not narrow this calculation.
        const input = {
          activities: activitiesWithCancellations,
          periodKey: selectedPeriodKey(state),
          district,
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
          if (routed.unavailableReason || simulation.hasRouteMissing) {
            state.courseSchedulingSimulationError = DISTRICT_SIMULATION_ROUTE_MISSING_MESSAGE;
          }
        }
        state.courseSchedulingSimulationConfirmSave = false;
        state.courseSchedulingSimulationSaveResult = null;
        // Read-only: never save drafts/assignments and never call assignment RPCs from this path.
      } catch (error) {
        state.courseSchedulingSimulationError = `תכנון מחוזי נכשל: ${translateSchedulingRouteError(error.message, error.message)}`;
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
          if (/draft|טיוט/i.test(message)) reason = 'הקורס כבר נשמר כטיוטה';
          else if (/assigned|שובץ|locked|מאושר/i.test(message)) reason = 'הקורס כבר שובץ';
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
      const adjustment = selected.dateAdjustment;
      const approvalMessage = adjustment?.exceedsHalf
        ? `המועדים המוצעים חורגים מהמחצית ומסתיימים בתאריך ${formatDateHe(adjustment.newEndDate)}. לאשר סופית את שינוי המועדים ואת שיבוץ ${selected.instructor.full_name}?`
        : `לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name}?`;
      if (!window.confirm(approvalMessage)) return;
      updateCandidateActions(true);
      const proposedMeetings = adjustment?.meetings?.map(({ date }) => ({ date })) || null;
      const { error } = await supabase.rpc(proposedMeetings ? 'assign_activity_instructor_with_dates' : 'assign_activity_instructor', {
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
      if (error) { showToast(`השיבוץ נכשל: ${error.message}`, 'error'); updateCandidateActions(false); return; }
      state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((item) => idOf(item.course) !== selectedCourseId);
      state.courseSchedulingSelectedCandidateId = '';
      clearScreenDataCache?.();
      showToast('המדריך שובץ בהצלחה', 'success');
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
        showToast('הקורס כבר נשמר כטיוטה', 'error');
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
      if (error) { showToast(`שמירת הטיוטה נכשלה: ${error.message}`, 'error'); updateCandidateActions(false); return; }
      clearScreenDataCache?.();
      showToast('נשמר כטיוטה', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-confirm-draft]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourse) return;
      const proposedMeetings = Array.isArray(selectedCourse.draft_proposed_meetings) ? selectedCourse.draft_proposed_meetings : null;
      const proposedSummary = draftProposedMeetingsFromCourse({ ...selectedCourse, periodKey: selectedPeriodKey(state) });
      const proposedEnd = proposedSummary?.proposedEndDate || proposedMeetings?.at(-1)?.date || '';
      const originalEnd = proposedSummary?.originalEndDate || '';
      const halfEnd = resolveCourseSchedulingPeriod(selectedPeriodKey(state))?.end || '';
      const exceedsHalf = !!proposedEnd && !!halfEnd && proposedEnd > halfEnd;
      const movedCount = Number(proposedSummary?.movedMeetingsCount) || 0;
      let approvalMessage = `לאשר את שיבוץ ${selectedCourse.draft_instructor_name}?`;
      if (movedCount > 0) {
        approvalMessage = `הטיוטה כוללת ${movedCount} מועדים מוצעים (סיום מקורי ${formatDateHe(originalEnd) || '—'}, סיום מוצע ${formatDateHe(proposedEnd) || '—'}). לאשר סופית את שינוי המועדים ואת שיבוץ ${selectedCourse.draft_instructor_name}?`;
      }
      if (exceedsHalf) {
        approvalMessage = `המועדים המוצעים חורגים מהמחצית ומסתיימים בתאריך ${formatDateHe(proposedEnd)}. לאשר סופית את שינוי המועדים ואת שיבוץ ${selectedCourse.draft_instructor_name}?`;
      }
      if (!window.confirm(approvalMessage)) return;
      event.target.disabled = true;
      const empId = Number(selectedCourse.draft_emp_id);
      const { error } = await supabase.rpc(proposedMeetings ? 'assign_activity_instructor_with_dates' : 'assign_activity_instructor', {
        p_activity_id: selectedCourseId,
        p_emp_id: empId,
        p_instructor_name: selectedCourse.draft_instructor_name,
        p_top_emp_id: empId,
        p_selected_score: null,
        p_top_score: null,
        p_decision_type: 'approved',
        p_reason: null,
        ...(proposedMeetings ? { p_proposed_meetings: proposedMeetings } : {})
      });
      if (error) { showToast(`אישור הטיוטה נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
      clearScreenDataCache?.();
      showToast('המדריך שובץ בהצלחה', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-cancel-draft]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourseId) return;
      if (!window.confirm('לבטל את הטיוטה?')) return;
      event.target.disabled = true;
      const { error } = await supabase.rpc('cancel_course_assignment_draft', { p_activity_id: selectedCourseId });
      if (error) { showToast(`ביטול הטיוטה נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
      clearScreenDataCache?.();
      showToast('הטיוטה בוטלה', 'success');
      rerender();
    });

    root.querySelector('[data-update-distances]')?.addEventListener('click', async () => {
      if (state.courseSchedulingDistanceLoading) return;
      state.courseSchedulingDistanceLoading = true;
      state.courseSchedulingDistanceStopRequested = false;
      state.courseSchedulingDistanceError = false;
      state.courseSchedulingDistanceDoneMessage = 'מעדכן מרחקים...';
      state.courseSchedulingDistanceDetails = '';
      rerender();
      try {
        const initialCoverage = await loadDistanceCoverage(
          (body) => supabase.functions.invoke('scheduling-route', { body })
        );
        state.courseSchedulingDistanceStats = {
          ...initialCoverage,
          action_required_count: initialCoverage.missing_count + initialCoverage.refresh_required_count
        };
        const result = await runDistanceBuildLoop({
          invoke: (body) => supabase.functions.invoke('scheduling-route', { body }),
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
        const finalCoverage = await loadDistanceCoverage(
          (body) => supabase.functions.invoke('scheduling-route', { body })
        );
        const finalStats = { ...result.stats, ...finalCoverage };
        const info = distanceDoneMessage(finalStats, { done: result.done, stopped: result.stopped });
        state.courseSchedulingDistanceStats = finalStats;
        state.courseSchedulingDistanceDoneMessage = info.message;
        state.courseSchedulingDistanceDetails = info.details;
        state.courseSchedulingDistanceError = info.error;
      } catch (error) {
        const info = distanceDoneMessage({}, { errorMessage: translateSchedulingRouteError(error.code || error.message, error.message) });
        state.courseSchedulingDistanceError = true;
        state.courseSchedulingDistanceDoneMessage = info.message;
        state.courseSchedulingDistanceDetails = info.details;
      } finally {
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
