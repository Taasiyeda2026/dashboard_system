import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { loadInstructorSchedulingData } from './instructor-scheduling-data.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import { calculateCandidateTravel } from './course-scheduling-travel.js';
import { loadCourseMeetingState, meetingsCompletedForCourse, courseMeetingStage } from './course-scheduling-meetings.js';
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
  runDistanceBuildLoop,
  translateSchedulingRouteError
} from './course-scheduling-distance-build.js';
import { instructionLanguageLabel } from './shared/instruction-language.js';
import { DEFAULT_COURSE_SCHEDULING_PERIOD_KEY, filterMeetingsByCourseSchedulingPeriod, periodOptions, resolveCourseSchedulingPeriod } from './course-scheduling-periods.js';
import { OPERATIONAL_DISTRICTS, normalizeOperationalDistrict } from './shared/district-normalization.js';

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((output, row) => {
  const id = text(row[key]);
  if (id) (output[id] ||= []).push(row);
  return output;
}, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);
const today = () => new Date().toISOString().slice(0, 10);
const formatDateHeDots = (value) => formatDateHe(value).replaceAll('/', '.');
export const PENDING_ACTIVITY_STORAGE_KEY = 'dashboard:pending-course-activity-id';
export const SCHEDULING_SNAPSHOT_KEY = 'dashboard:course-scheduling-calculation-v2';
export const SCHEDULING_SNAPSHOT_SCHEMA_VERSION = 3;
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
    const candidates = [result?.recommended, ...(result?.alternatives || []), ...(result?.checked || [])].filter(Boolean);
    if (!candidates.length) return true;
    return candidates.every((candidate) => candidate.travel && candidate.checks);
  });
}

function restoreCalculationSnapshot(state, courses) {
  if ((state.courseSchedulingResults || []).length) return;
  if (typeof localStorage === 'undefined') return;
  clearLegacySchedulingSnapshots();
  try {
    const snapshot = JSON.parse(localStorage.getItem(SCHEDULING_SNAPSHOT_KEY) || 'null');
    if (!snapshot || !Array.isArray(snapshot.results)) return;
    if (Number(snapshot.schemaVersion) !== SCHEDULING_SNAPSHOT_SCHEMA_VERSION) {
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

function saveCalculationSnapshot(state, courses) {
  if (typeof localStorage === 'undefined') return;
  try {
    const courseById = new Map(courses.map((course) => [idOf(course), course]));
    const results = (state.courseSchedulingResults || []).filter((result) => {
      const course = courseById.get(idOf(result?.course));
      return course && !text(course.emp_id) && !text(course.draft_emp_id);
    });
    localStorage.setItem(SCHEDULING_SNAPSHOT_KEY, JSON.stringify({
      schemaVersion: SCHEDULING_SNAPSHOT_SCHEMA_VERSION,
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
    .filter((course) => filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), periodKey).length)
    .filter((course) => !district || districtValue(course) === district)
    .filter((course) => !authority || text(course.authority) === authority)
    .map((course) => withSelectedPeriod(course, state));
}

function schedulingScopeHtml(allCourses = [], state = {}) {
  const periodKey = selectedPeriodKey(state);
  const period = resolveCourseSchedulingPeriod(periodKey);
  const periodButtons = periodOptions().map((option) => `<button type="button" class="course-scheduling-tab${option.key === periodKey ? ' is-active' : ''}" data-period-key="${escapeHtml(option.key)}">${escapeHtml(option.label)}</button>`).join('');
  const district = normalizeOperationalDistrict(state.courseSchedulingDistrict || '');
  const districtOptions = `<label>מחוז<select class="course-scheduling-input" data-district-filter><option value="">כל המחוזות</option>${OPERATIONAL_DISTRICTS.map((item) => `<option value="${escapeHtml(item)}"${item === district ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>`;
  const scopedForAuthority = allCourses.filter((course) => filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), periodKey).length).filter((course) => !district || districtValue(course) === district);
  const selectedAuthority = text(state.courseSchedulingAuthority || '');
  const authorities = authorityOptions(scopedForAuthority);
  const authoritySelect = `<label>רשות<select class="course-scheduling-input" data-authority-filter><option value="">כל הרשויות</option>${authorities.map((item) => `<option value="${escapeHtml(item)}"${item === selectedAuthority ? ' selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select></label>`;
  const periodRange = `${formatDateHeDots(period.start)} עד ${formatDateHeDots(period.end)}`;
  return `<section class="course-scheduling-scope"><div class="course-scheduling-scope-inner"><div class="course-scheduling-tabs course-scheduling-tabs--inner">${periodButtons}</div><p class="course-scheduling-period-range">${escapeHtml(periodRange)}</p><div class="course-scheduling-filter-row">${districtOptions}${authoritySelect}</div></div></section>`;
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

function courseRowModel(course, resultByCourseId, meetingState) {
  const id = idOf(course);
  const isAssigned = !!text(course.emp_id);
  const hasDraft = !isAssigned && !!text(course.draft_emp_id);
  const meetingsCompleted = isAssigned ? meetingsCompletedForCourse(course, meetingState) : 0;
  const meetingStateLoaded = meetingState?.loaded !== false;
  const stage = isAssigned && meetingsCompleted != null ? courseMeetingStage(meetingsCompleted) : null;
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

  return { course, id, result, isAssigned, hasDraft, meetingsCompleted, meetingStateLoaded, stage, bucket, statusLabel };
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
  const instructor = instructorCellLabel(row);
  return `<div class="course-scheduling-compact-row course-scheduling-course-card${selectedClass}" data-course-card="${escapeHtml(row.id)}" role="button" tabindex="0" aria-label="${escapeHtml(`${school}, ${authority}, ${courseName}`)}">
    <span class="course-scheduling-compact-cell course-scheduling-compact-school" title="${escapeHtml(school)}">${escapeHtml(school)}</span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-authority" title="${escapeHtml(authority)}">${escapeHtml(authority)}</span>
    <strong class="course-scheduling-compact-cell course-scheduling-compact-course" title="${escapeHtml(courseName)}">${escapeHtml(courseName)}</strong>
    <span class="course-scheduling-compact-cell course-scheduling-compact-instructor" title="${escapeHtml(instructor)}">${escapeHtml(instructor)}</span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-status"><span class="course-scheduling-status-chip${cardStatusClass(row.statusLabel)}">${escapeHtml(row.statusLabel)}</span></span>
    <span class="course-scheduling-compact-cell course-scheduling-compact-action-cell"><button type="button" class="course-scheduling-compact-action" data-course-row-action="${escapeHtml(row.id)}">${escapeHtml(actionLabelForRow(row))}</button></span>
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
  const header = '<div class="course-scheduling-compact-table-head" aria-hidden="true"><span>בית ספר</span><span>רשות</span><span>קורס</span><span>מדריך</span><span>סטטוס</span><span>פעולה</span></div>';
  return header + groups.map((group) => `<section class="course-scheduling-course-group"><h3>${escapeHtml(group.label)} <span class="course-scheduling-badge">${group.rows.length}</span></h3>${group.rows.map((row) => courseListCardHtml(row, selectedId)).join('')}</section>`).join('');
}


function genderRequirementLabel(course = {}) {
  const value = text(course.required_instructor_gender).toLocaleLowerCase('he-IL');
  if (!value || value === 'any' || value === 'ללא' || value === 'ללא דרישה') return 'ללא דרישה';
  if (value === 'female' || value === 'f' || value === 'נקבה' || value === 'מדריכה') return 'מדריכה';
  if (value === 'male' || value === 'm' || value === 'זכר' || value === 'מדריך') return 'מדריך';
  return text(course.required_instructor_gender);
}

function candidateHardBlockReason(candidate) {
  if (!candidate) return 'לא נבחר מועמד';
  const checks = candidate.checks || {};
  if (checks.language?.passed !== true) return checks.language?.reason || checks.language?.label || 'שפת ההדרכה אינה תואמת';
  if (checks.gender?.passed === false || (checks.gender?.passed == null && genderRequirementLabel(candidate.periodCourse || {}) !== 'ללא דרישה')) return checks.gender?.reason || checks.gender?.label || 'לא ניתן לאמת התאמה לדרישת המגדר';
  if (!candidate.eligible) return [...(candidate.failures || []), ...(candidate.missingProfileData || [])][0] || 'המועמד אינו עומד בתנאי הסף';
  return '';
}

function actionDisabledReason({ candidate, busy = false, canEdit = true } = {}) {
  if (!canEdit) return 'אין הרשאת עריכה';
  if (busy) return 'פעולה מתבצעת כעת';
  return candidateHardBlockReason(candidate);
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

function courseFactRows(course) {
  const meetings = filterMeetingsByCourseSchedulingPeriod(activityMeetings(course), course?.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY);
  return [
    ['בית ספר', escapeHtml(course.school || '—')],
    ['קורס', escapeHtml(course.activity_name || '—')],
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
    <div class="course-scheduling-detail-title-row">
      <h2 class="course-scheduling-detail-title">${escapeHtml(course.activity_name || '—')}</h2>
    </div>
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

export function scoreBreakdownHtml(candidate) {
  const breakdown = candidate?.scoreBreakdown;
  if (!breakdown) {
    return `<div class="course-scheduling-score-breakdown"><h4>פירוט הציון</h4><p class="course-scheduling-muted">אין ציון להצגה — תנאי סף לא התקיימו.</p></div>`;
  }
  const rows = [
    breakdown.continuity,
    breakdown.workload,
    breakdown.distance,
    breakdown.seniority
  ].filter(Boolean);
  return `<div class="course-scheduling-score-breakdown">
    <h4>פירוט הציון · ${candidate.score ?? '—'}</h4>
    <ul class="course-scheduling-score-list">
      ${rows.map((row) => `<li><span>${escapeHtml(row.label)}</span><b>${Number(row.points) || 0}</b></li>`).join('')}
    </ul>
    <p class="course-scheduling-score-note">${escapeHtml(breakdown.gateNote || 'מגדר ושפה הם תנאי סף ואינם מוסיפים נקודות.')}</p>
  </div>`;
}

function candidateRowHtml(candidate, { recommended = false, selectedId = '', name = 'course-candidate', course = null } = {}) {
  const id = emp(candidate);
  const checked = id && id === selectedId ? ' checked' : '';
  const selected = id && id === selectedId ? ' is-selected' : '';
  const title = recommended ? 'מומלץ' : 'חלופה';
  const breakdown = candidate?.scoreBreakdown || {};
  const continuity = breakdown.continuity?.points ?? '—';
  const distance = distanceLabel(candidate);
  const hardBlock = candidateHardBlockReason(candidate);
  const disabled = hardBlock ? ' disabled' : '';
  const tooltip = hardBlock ? ` title="${escapeHtml(hardBlock)}"` : '';
  return `<tr class="course-scheduling-candidate-row${selected}" data-candidate-row="${escapeHtml(id)}">
    <td class="course-scheduling-candidate-select"><input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}${disabled}${tooltip}></td>
    <td class="course-scheduling-candidate-name"><strong title="${escapeHtml(candidate.instructor.full_name || id)}">${escapeHtml(candidate.instructor.full_name || id)}</strong><span>${title}</span></td>
    <td class="course-scheduling-candidate-score"><b>${candidate.score ?? '—'}</b><span class="sr-only"> פירוט הציון עומס וחלוקה שוויונית ותק תנאי סף ואינם מוסיפים נקודות</span></td>
    <td>${escapeHtml(availabilityLabel(candidate))}</td>
    <td title="${escapeHtml(breakdown.continuity?.label || 'אין רציפות בבית הספר או ברשות')}">התאמה ${escapeHtml(String(continuity))}<span class="sr-only"> ${escapeHtml(breakdown.continuity?.label || 'אין רציפות בבית הספר או ברשות')}</span></td>
    <td title="${escapeHtml(distance)}">${escapeHtml(distance)}</td>
    <td>${candidateConstraintBadgesHtml(candidate, course || {})}</td>
  </tr>`;
}

function rejectedCandidatesHtml(result) {
  const rejected = (result.checked || []).filter((candidate) => (candidate.failures || []).length);
  if (!rejected.length) return '';
  return `<details class="course-scheduling-rejected" data-rejected-candidates><summary>לא עברו תנאי סף (${rejected.length})</summary>
    <div class="course-scheduling-rejected-list">
      ${rejected.map((candidate) => {
        const reasons = (candidate.failures || []).length
          ? candidate.failures
          : [candidateHardBlockReason(candidate) || 'לא עומד בתנאי הסף'];
        return `<div class="course-scheduling-rejected-row"><strong>${escapeHtml(candidate.instructor?.full_name || emp(candidate) || '—')}</strong><span>${escapeHtml(reasons.join(', '))}</span></div>`;
      }).join('')}
    </div>
  </details>`;
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
        ${issues.map((issue) => `<p>${escapeHtml(issue.message)} — משפיע על ${issue.dates.length} מפגשים.<br>${issue.dates.map((date) => escapeHtml(date)).join(', ')}</p>`).join('')}
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
  if (!result?.recommended && result?.status === 'נדרש גיוס') {
    return `<div class="course-scheduling-result-block">
      <h3>לא נמצא מדריך מתאים</h3>
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

  const selectedId = text(state.courseSchedulingSelectedCandidateId);
  const alternatives = result.alternatives || [];
  const visibleAlts = alternatives.slice(0, 3);
  const hiddenAlts = alternatives.slice(3);
  const showMore = !!state.courseSchedulingShowAllCandidates;
  const radioName = `course-candidate-${idOf(result.course)}`;
  const moreChecked = (result.checked || []).filter((item) => item.eligible && emp(item) !== emp(result.recommended) && !alternatives.some((alt) => emp(alt) === emp(item)));

  return `<div class="course-scheduling-result-block" data-course-options>
    <div class="course-scheduling-candidates-table-wrap"><table class="course-scheduling-candidates-table"><thead><tr><th>בחירה</th><th>שם המדריך</th><th>ציון</th><th>זמינות</th><th>התאמה מקצועית</th><th>מרחק</th><th>אילוצים</th></tr></thead><tbody>
      ${candidateRowHtml(result.recommended, { recommended: true, selectedId, name: radioName, course: result.course })}
      ${visibleAlts.map((item) => candidateRowHtml(item, { selectedId, name: radioName, course: result.course })).join('')}
    </tbody></table></div>
    ${(hiddenAlts.length || moreChecked.length) ? `<details class="course-scheduling-details" data-more-candidates ${showMore ? 'open' : ''}><summary>הצגת מדריכים נוספים</summary><div class="course-scheduling-candidates-table-wrap"><table class="course-scheduling-candidates-table"><tbody>${[...hiddenAlts, ...moreChecked].map((item) => candidateRowHtml(item, { selectedId, name: radioName, course: result.course })).join('')}</tbody></table></div></details>` : ''}
    ${rejectedCandidatesHtml(result)}
    <div class="course-scheduling-selection-note" data-selection-note>${selectedId ? `נבחרה: ${escapeHtml(([result.recommended, ...(result.alternatives || []), ...(result.checked || [])].find((item) => emp(item) === selectedId)?.instructor?.full_name) || selectedId)}` : 'בחרו מדריך כדי להפעיל את הפעולות'}</div>
    <div class="course-scheduling-detail-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-save-draft disabled title="בחרו מדריך כשיר">שמור כטיוטה</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-assign-course disabled title="בחרו מדריך כשיר">שבץ מדריך</button>
      <button type="button" class="course-scheduling-text-btn" data-clear-candidate>ביטול</button>
    </div>
  </div>`;
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

function draftDetailHtml(course) {
  return `${selectedCourseMetaHtml(course)}
    <p class="course-scheduling-status-chip is-draft">${STATUS.draft}</p>
    <p>מדריך בטיוטה: <b>${escapeHtml(course.draft_instructor_name || course.draft_emp_id)}</b></p>
    <p class="course-scheduling-muted">הטיוטה שומרת את השיבוץ המוצע ואינה מעדכנת את הפעילות עד לאישור.</p>
    <div class="course-scheduling-detail-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-confirm-draft>שבץ מדריך</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-cancel-draft>בטל טיוטה</button>
    </div>`;
}

function assignedDetailHtml(row) {
  const c = row.course;
  return `${selectedCourseMetaHtml(c)}
    <p class="course-scheduling-status-chip is-ready">${STATUS.assigned}</p>
    <p>מדריך משובץ: <b>${escapeHtml(c.instructor_name || c.emp_id)}</b></p>
    <p class="course-scheduling-muted">הקורס מופיע גם במערכת השבועית.</p>
    <div class="course-scheduling-detail-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-switch-tab="calendar">מעבר למערכת שבועית</button>
    </div>`;
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
  return `${selectedCourseMetaHtml(row.course)}
    <div class="course-scheduling-primary-action">
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

function distanceMaintenanceDialogHtml(state) {
  const distanceBusy = !!state.courseSchedulingDistanceLoading;
  const doneMessage = text(state.courseSchedulingDistanceDoneMessage);
  const doneError = !!state.courseSchedulingDistanceError;
  return `<div class="course-scheduling-overlay" data-course-scheduling-overlay>
    <section class="course-scheduling-modal" role="dialog" aria-modal="true" aria-labelledby="course-scheduling-distance-title">
      <button type="button" class="course-scheduling-close" data-close-course-scheduling-overlay aria-label="סגירה">×</button>
      <h3 id="course-scheduling-distance-title">עדכון מרחקים</h3>
      <p>פעולה זו מעדכנת את זמני הנסיעה בין כתובות המדריכים ובתי הספר. בדרך כלל אין צורך להפעיל אותה לפני כל שיבוץ.</p>
      <div class="course-scheduling-detail-actions">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-update-distances ${distanceBusy ? 'disabled' : ''}>${distanceBusy ? 'מעדכן מרחקים...' : 'עדכן מרחקים'}</button>
        ${distanceBusy ? '<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-stop-distance-build>עצור</button>' : ''}
      </div>
      ${doneMessage ? `<p class="${doneError ? 'course-scheduling-alert' : 'course-scheduling-success'}">${escapeHtml(doneMessage)}</p>
        ${text(state.courseSchedulingDistanceDetails) ? `<details class="course-scheduling-details"><summary>הצגת פרטים</summary><p>${escapeHtml(state.courseSchedulingDistanceDetails)}</p></details>` : ''}` : ''}
    </section>
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

function maintenanceTabHtml() {
  return `<section class="course-scheduling-maintenance-tab" aria-labelledby="course-scheduling-maintenance-heading">
    <h2 id="course-scheduling-maintenance-heading" class="course-scheduling-visually-hidden">פעולות תחזוקה</h2>
    <article class="course-scheduling-maintenance-card">
      <div><h3>עדכון מרחקים</h3><p>חישוב ועדכון מרחקי הנסיעה בין כתובות המדריכים לבתי הספר.</p></div>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-maintenance-action="distances">עדכן מרחקים</button>
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
  const failed = Number(stats.failed_count) || 0;
  if (stopped) return { message: 'עדכון המרחקים הופסק', details: '', error: false };
  if (failed > 0) {
    return {
      message: `העדכון הסתיים עם ${failed} כתובות שלא זוהו`,
      details: `עובדו ${Number(stats.processed_count) || 0} זוגות · עודכנו ${Number(stats.inserted_count) || 0}`,
      error: true
    };
  }
  if (done) return { message: 'מאגר המרחקים עודכן בהצלחה', details: '', error: false };
  return { message: 'מעדכן מרחקים...', details: '', error: false };
}

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling, meetingState, schoolLocations] = await Promise.all([
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true, select: 'row_id,district,authority_id,authority,school,school_id,activity_name,catalog_slug,activity_no,proposal_item_id,activity_type,item_type,activity_season,grade,education_level,class_group,sessions,start_time,end_time,instruction_language,required_instructor_gender,allowed_instructor_ids,blocked_instructor_ids,scheduling_note,instructor_assignment_status,instructor_assignment_locked,draft_emp_id,draft_instructor_name,draft_created_at,emp_id,instructor_name,emp_id_2,instructor_name_2,start_date,end_date,status,date_1,date_2,date_3,date_4,date_5,date_6,date_7,date_8,date_9,date_10,date_11,date_12,date_13,date_14,date_15,date_16,date_17,date_18,date_19,date_20,date_21,date_22,date_23,date_24,date_25,date_26,date_27,date_28,date_29,date_30,date_31,date_32,date_33,date_34,date_35' }),
      api.instructorContacts(),
      loadInstructorSchedulingData(),
      loadCourseMeetingState(),
      supabase.rpc('scheduling_authority_school_locations')
    ]);
    const schoolRows = schoolLocations?.data || [];
    const schoolAddressLookupError = schoolLocations?.error
      ? translateSchedulingRouteError('school_address_lookup_failed')
      : '';
    const enriched = enrichActivitiesWithSchoolAddresses(activities?.rows || [], schoolRows);
    return {
      activities: enriched.activities,
      instructors: contacts?.rows || [],
      scheduling,
      meetingState,
      schoolLocations: schoolRows,
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
    restoreCalculationSnapshot(state, interfaceCourses);
    const results = state.courseSchedulingResults || [];
    const resultByCourseId = new Map(results.map((result) => [idOf(result.course), result]));
    const rowModels = interfaceCourses.map((course) => courseRowModel(course, resultByCourseId, data.meetingState));
    const tab = activeTab(state);
    if (tab === 'courses' && !text(state.courseSchedulingSelectedId) && rowModels.length) {
      const nearest = pickNearestActionableCourse(rowModels, today()) || rowModels[0];
      if (nearest) {
        state.courseSchedulingSelectedId = nearest.id;
        state.courseSchedulingWeek = nearest.course?.start_date || state.courseSchedulingWeek;
      }
    }
    const selectedId = state.courseSchedulingSelectedId || '';
    const selectedRow = rowModels.find((row) => row.id === selectedId)
      || (selectedId ? courseRowModel(interfaceCourses.find((course) => idOf(course) === selectedId) || { row_id: selectedId }, resultByCourseId, data.meetingState) : null);
    const readiness = courseSchedulingDataReadiness(data.activities || []);
    const title = tab === 'calendar' ? 'מערכת שבועית' : (tab === 'maintenance' ? 'תחזוקה' : 'שיבוצים');

    return dsScreenStack(`
    <div class="course-scheduling-screen" dir="rtl" data-cs-ui="ux-polish-20260805-v1" data-cs-tab="${tab}">
      <header class="course-scheduling-header">
        <div class="course-scheduling-header-copy">
          <h1 class="course-scheduling-title">${title}</h1>
          <nav class="course-scheduling-tabs" aria-label="ניווט ממשק השיבוצים">
        <button type="button" class="course-scheduling-tab${tab === 'courses' ? ' is-active' : ''}" data-switch-tab="courses">קורסים לשיבוץ</button>
        <button type="button" class="course-scheduling-tab${tab === 'calendar' ? ' is-active' : ''}" data-switch-tab="calendar">מערכת שבועית</button>
        <button type="button" class="course-scheduling-tab${tab === 'maintenance' ? ' is-active' : ''}" data-switch-tab="maintenance">תחזוקה</button>
          </nav>
        </div>
      </header>

      ${schedulingScopeHtml(allInterfaceCourses, state)}
      ${tab === 'courses' ? `
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
      ` : (tab === 'calendar' ? calendarTabHtml({ interfaceCourses, selectedId, state }) : maintenanceTabHtml())}
      ${state.courseSchedulingShowDistanceConfirm ? distanceMaintenanceDialogHtml(state) : ''}
      ${dataReadinessDrawerHtml(data, state)}
    </div>`);
  },

  bind({ root, data, state, rerender, clearScreenDataCache }) {
    const canEdit = ['admin', 'operation_manager'].includes(text(state?.user?.role));
    const resultByCourseId = new Map((state.courseSchedulingResults || []).map((result) => [idOf(result.course), result]));
    const allInterfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
    const interfaceCourses = filteredInterfaceCourses(allInterfaceCourses, state);
    const courseById = new Map(interfaceCourses.map((course) => [idOf(course), course]));

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

    root.querySelectorAll('[data-period-key]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingPeriodKey = button.dataset.periodKey || DEFAULT_COURSE_SCHEDULING_PERIOD_KEY;
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      rerender();
    }));
    root.querySelector('[data-district-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingDistrict = event.target.value;
      state.courseSchedulingAuthority = '';
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
      rerender();
    });
    root.querySelector('[data-authority-filter]')?.addEventListener('change', (event) => {
      state.courseSchedulingAuthority = event.target.value;
      state.courseSchedulingSelectedId = '';
      state.courseSchedulingResults = [];
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
        state.courseSchedulingSelectedId = button.dataset.courseCard;
        state.courseSchedulingSelectedCandidateId = '';
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
      state.instructorsWorkspace = { ...(state.instructorsWorkspace || {}), q: empId, active: 'yes', assignment: '' };
      state.pendingInstructorEmpId = empId;
      state.pendingInstructorEdit = button.dataset.openInstructorMatching ? 'matching' : 'constraints';
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructors' } }));
    }));

    root.querySelectorAll('[data-maintenance-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.maintenanceAction === 'distances') {
          state.courseSchedulingShowDistanceConfirm = true;
          state.courseSchedulingShowDataReadiness = false;
        } else {
          state.courseSchedulingShowDataReadiness = true;
          state.courseSchedulingShowDistanceConfirm = false;
          state.courseSchedulingReadinessTab = 'courses';
        }
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
    const allCandidatesForResult = (result) => [result?.recommended, ...(result?.alternatives || []), ...(result?.checked || [])].filter(Boolean);
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
      if (note) note.textContent = candidate ? `נבחרה: ${candidate.instructor?.full_name || emp(candidate)}${reason ? ` — ${reason}` : ''}` : (reason || 'בחרו מדריך כדי להפעיל את הפעולות');
    };
    if (typeof detailRoot.addEventListener === 'function') detailRoot.addEventListener('change', (event) => {
      const input = event.target?.closest?.('input[type="radio"][name^="course-candidate"]');
      if (!input) return;
      state.courseSchedulingSelectedCandidateId = text(input.value);
      detailRoot.querySelectorAll('[data-candidate-row]').forEach((row) => row.classList.toggle('is-selected', row.dataset.candidateRow === state.courseSchedulingSelectedCandidateId));
      updateCandidateActions(false);
    });
    if (typeof detailRoot.addEventListener === 'function') detailRoot.addEventListener('click', (event) => {
      const row = event.target?.closest?.('[data-candidate-row]');
      if (!row || event.target?.matches?.('input,button,a,summary')) return;
      const radio = row.querySelector('input[type="radio"]');
      if (radio && !radio.disabled) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    updateCandidateActions(false);

    const runFindInstructors = async () => {
      if (state.courseSchedulingLoading) return;
      state.courseSchedulingLoading = true;
      state.courseSchedulingError = '';
      state.courseSchedulingProgressStep = 1;
      state.courseSchedulingSelectedCandidateId = '';
      rerender();
      try {
        if (data.schoolAddressLookupError) throw new Error(data.schoolAddressLookupError);
        const enriched = enrichActivitiesWithSchoolAddresses(data.activities || [], data.schoolLocations || []);
        data.activities = enriched.activities;
        data.schoolAddressStats = {
          uniqueSchoolCount: enriched.uniqueSchoolCount,
          duplicateSchoolCount: enriched.duplicateSchoolCount,
          missingCount: enriched.missingCount
        };
        const scheduling = data.scheduling || {};
        const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        const input = {
          activities: enriched.activities,
          periodKey: selectedPeriodKey(state),
          authority: text(state.courseSchedulingAuthority || ''),
          instructors: data.instructors,
          profiles,
          rules: group(scheduling.rules || [], 'emp_id'),
          exceptions: group(scheduling.exceptions || [], 'emp_id')
        };
        state.courseSchedulingProgressStep = 2;
        rerender();
        const preliminary = preliminaryCourseCandidates(input);
        state.courseSchedulingProgressStep = 3;
        rerender();
        const routed = await calculateCandidateTravel(preliminary, enriched.activities);
        state.courseSchedulingResults = calculateCourseSchedule({
          ...input,
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
        if (selectedResult?.recommended) {
          state.courseSchedulingSelectedCandidateId = emp(selectedResult.recommended);
        }
        saveCalculationSnapshot(state, interfaceCourses);
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

    detailRoot.querySelector('[data-assign-course]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourseId) return;
      const result = resultByCourseId.get(selectedCourseId);
      if (!result?.recommended) return;
      const selectedId = text(state.courseSchedulingSelectedCandidateId)
        || text(detailRoot.querySelector('input[type="radio"][name^="course-candidate"]:checked')?.value);
      const selected = allCandidatesForResult(result).find((item) => emp(item) === selectedId);
      const blockReason = actionDisabledReason({ candidate: selected, canEdit });
      if (blockReason) { showToast(blockReason, 'error'); updateCandidateActions(false); return; }
      let reason = null;
      if (selectedId !== emp(result.recommended)) {
        reason = window.prompt('יש להזין נימוק קצר לבחירת מדריך שאינו המומלץ:')?.trim();
        if (!reason) return;
      }
      if (!window.confirm(`לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name}?`)) return;
      updateCandidateActions(true);
      const { error } = await supabase.rpc('assign_activity_instructor', {
        p_activity_id: selectedCourseId,
        p_emp_id: Number(selectedId),
        p_instructor_name: selected.instructor.full_name,
        p_top_emp_id: Number(emp(result.recommended)),
        p_selected_score: selected.score,
        p_top_score: result.recommended.score,
        p_decision_type: selectedId === emp(result.recommended) ? 'approved' : 'overridden',
        p_reason: reason
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
      if (!result?.recommended) return;
      const selectedId = text(state.courseSchedulingSelectedCandidateId)
        || text(detailRoot.querySelector('input[type="radio"][name^="course-candidate"]:checked')?.value);
      const selected = allCandidatesForResult(result).find((item) => emp(item) === selectedId);
      const blockReason = actionDisabledReason({ candidate: selected, canEdit });
      if (blockReason) { showToast(blockReason, 'error'); updateCandidateActions(false); return; }
      updateCandidateActions(true);
      const { error } = await supabase.rpc('save_course_assignment_draft', {
        p_activity_id: selectedCourseId,
        p_emp_id: Number(selectedId),
        p_instructor_name: selected.instructor.full_name,
        p_top_emp_id: Number(emp(result.recommended)),
        p_selected_score: selected.score,
        p_top_score: result.recommended.score
      });
      if (error) { showToast(`שמירת הטיוטה נכשלה: ${error.message}`, 'error'); updateCandidateActions(false); return; }
      clearScreenDataCache?.();
      showToast('נשמר כטיוטה', 'success');
      rerender();
    });

    detailRoot.querySelector('[data-confirm-draft]')?.addEventListener('click', async (event) => {
      if (!canEdit || !selectedCourse) return;
      if (!window.confirm(`לאשר את שיבוץ ${selectedCourse.draft_instructor_name}?`)) return;
      event.target.disabled = true;
      const empId = Number(selectedCourse.draft_emp_id);
      const { error } = await supabase.rpc('assign_activity_instructor', {
        p_activity_id: selectedCourseId,
        p_emp_id: empId,
        p_instructor_name: selectedCourse.draft_instructor_name,
        p_top_emp_id: empId,
        p_selected_score: null,
        p_top_score: null,
        p_decision_type: 'approved',
        p_reason: null
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

    root.querySelector('[data-stop-distance-build]')?.addEventListener('click', () => {
      state.courseSchedulingDistanceStopRequested = true;
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
        const result = await runDistanceBuildLoop({
          invoke: (body) => supabase.functions.invoke('scheduling-route', { body }),
          scope: 'all',
          limit: 25,
          shouldStop: () => !!state.courseSchedulingDistanceStopRequested,
          onProgress: async ({ stats, done, stopped }) => {
            const info = distanceDoneMessage(stats, { done, stopped });
            state.courseSchedulingDistanceStats = stats;
            state.courseSchedulingDistanceDoneMessage = info.message;
            state.courseSchedulingDistanceDetails = info.details;
            state.courseSchedulingDistanceError = info.error;
            rerender();
          }
        });
        const info = distanceDoneMessage(result.stats, { done: result.done, stopped: result.stopped });
        state.courseSchedulingDistanceStats = result.stats;
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
export { pickNearestActionableCourse, userFacingStatus, STATUS, restoreCalculationSnapshot, saveCalculationSnapshot };
