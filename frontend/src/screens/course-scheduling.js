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
  enrichActivitiesWithSchoolAddresses,
  MISSING_SCHEDULE_FILTER_STORAGE_KEY,
  pickNearestActionableCourse,
  runDistanceBuildLoop,
  translateSchedulingRouteError
} from './course-scheduling-distance-build.js';

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((output, row) => {
  const id = text(row[key]);
  if (id) (output[id] ||= []).push(row);
  return output;
}, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);
const today = () => new Date().toISOString().slice(0, 10);
export const PENDING_ACTIVITY_STORAGE_KEY = 'dashboard:pending-course-activity-id';
const SCHEDULING_SNAPSHOT_KEY = 'dashboard:course-scheduling-calculation-v1';

const STATUS = {
  waiting: 'ממתין לבדיקת מדריכים',
  ready: 'נמצאה הצעת שיבוץ',
  missing: 'חסרים פרטים',
  recruit: 'נדרש גיוס',
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

function restoreCalculationSnapshot(state, courses) {
  if ((state.courseSchedulingResults || []).length) return;
  if (typeof localStorage === 'undefined') return;
  try {
    const snapshot = JSON.parse(localStorage.getItem(SCHEDULING_SNAPSHOT_KEY) || 'null');
    if (!snapshot || !Array.isArray(snapshot.results)) return;
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
      calculatedAt: state.courseSchedulingCalculatedAt || '',
      results
    }));
  } catch {
    // Persistence is optional.
  }
}

function activeTab(state) {
  return state.courseSchedulingTab === 'calendar' ? 'calendar' : 'courses';
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
  const meetings = activityMeetings(activity);
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
  const meetings = activityMeetings(activity);
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

function summaryCardsHtml(interfaceCourses, results) {
  const waiting = interfaceCourses.filter((course) => !text(course.emp_id) && !text(course.draft_emp_id)).length;
  const drafts = interfaceCourses.filter((course) => !text(course.emp_id) && text(course.draft_emp_id)).length;
  const ready = results.filter((result) => result.status === 'הצעה מוכנה').length;
  return `<article class="course-scheduling-summary-card is-accent"><b>${waiting}</b><span>ממתינים לשיבוץ</span></article>
    <article class="course-scheduling-summary-card"><b>${ready}</b><span>הצעות מוכנות</span></article>
    <article class="course-scheduling-summary-card"><b>${drafts}</b><span>טיוטות</span></article>`;
}

function courseListCardHtml(row, selectedId) {
  const c = row.course;
  const selectedClass = row.id === selectedId ? ' is-selected' : '';
  return `<button type="button" class="course-scheduling-course-card${selectedClass}${cardStatusClass(row.statusLabel)}" data-course-card="${escapeHtml(row.id)}">
    <strong>${escapeHtml(c.activity_name || '—')}</strong>
    <span class="course-scheduling-course-card-meta">${escapeHtml(c.school || '—')}</span>
    <span class="course-scheduling-course-card-meta">${escapeHtml(c.authority || '—')}</span>
    <span class="course-scheduling-course-card-meta"><bdi dir="ltr">${escapeHtml(formatDateHe(c.start_date))}</bdi></span>
    <span class="course-scheduling-course-card-meta">${courseDayTimeHtml(c)}</span>
    <span class="course-scheduling-status-chip">${escapeHtml(row.statusLabel)}</span>
  </button>`;
}

function courseListHtml(rowModels, selectedId) {
  const groups = LIST_GROUPS.map((group) => ({ ...group, rows: rowModels.filter((row) => row.bucket === group.key) })).filter((group) => group.rows.length);
  if (!groups.length) {
    return `<div class="course-scheduling-empty">
      <strong>אין קורסים הממתינים לשיבוץ</strong>
      <p>שיבוצים שבוצעו יופיעו בלשונית המערכת השבועית.</p>
    </div>`;
  }
  return groups.map((group) => `<section class="course-scheduling-course-group"><h3>${escapeHtml(group.label)} <span class="course-scheduling-badge">${group.rows.length}</span></h3>${group.rows.map((row) => courseListCardHtml(row, selectedId)).join('')}</section>`).join('');
}

function specialRequirementsHtml(course) {
  const parts = [];
  if (text(course.required_instructor_gender) && text(course.required_instructor_gender) !== 'any') {
    parts.push(course.required_instructor_gender === 'female' ? 'נדרשת מדריכה' : 'נדרש מדריך');
  }
  if (text(course.instruction_language)) parts.push(`שפה: ${course.instruction_language}`);
  if (text(course.education_level || course.grade)) parts.push(`שכבה: ${course.education_level || course.grade}`);
  if (!parts.length) return '';
  return `<p class="course-scheduling-requirements"><span>דרישות מיוחדות:</span> ${escapeHtml(parts.join(' · '))}</p>`;
}

function selectedCourseMetaHtml(course) {
  const meetings = activityMeetings(course);
  return `<header class="course-scheduling-detail-header">
    <h2 class="course-scheduling-detail-title">${escapeHtml(course.activity_name || '—')}</h2>
    <p>${escapeHtml(course.school || '—')} · ${escapeHtml(course.authority || '—')}</p>
    <p>תאריך התחלה: <bdi dir="ltr">${escapeHtml(formatDateHe(course.start_date))}</bdi></p>
    <p>${meetings.length || '—'} מפגשים · ${courseDayTimeHtml(course)}</p>
    ${specialRequirementsHtml(course)}
  </header>`;
}

function distanceLabel(candidate) {
  const km = candidate?.travel?.home?.distance_km;
  if (km == null || !Number.isFinite(Number(km))) return 'מרחק לא זמין';
  return `${Math.round(Number(km))} ק״מ מהבית`;
}

function availabilityLabel(candidate) {
  if (candidate?.eligible) return 'זמין בכל מועדי הקורס';
  return 'לא זמין במלואו';
}

function candidateCardHtml(candidate, { recommended = false, selectedId = '', name = 'course-candidate' } = {}) {
  const id = emp(candidate);
  const checked = id && id === selectedId ? ' checked' : '';
  const title = recommended ? 'מדריך מומלץ' : 'מדריך נוסף';
  return `<label class="course-scheduling-instructor-card${recommended ? ' is-recommended' : ''}${id === selectedId ? ' is-selected' : ''}">
    <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(id)}"${checked}>
    <span class="course-scheduling-instructor-card-body">
      <span class="course-scheduling-instructor-kicker">${title}</span>
      <strong>${escapeHtml(candidate.instructor.full_name || id)}</strong>
      <span class="course-scheduling-instructor-meta">ציון התאמה: ${candidate.score ?? '—'}</span>
      <span class="course-scheduling-instructor-meta">${escapeHtml(distanceLabel(candidate))}</span>
      <span class="course-scheduling-instructor-meta">${escapeHtml(availabilityLabel(candidate))}</span>
      <span class="course-scheduling-instructor-explain">${escapeHtml(candidate.explanation || 'התאמה כללית לקורס')}</span>
    </span>
  </label>`;
}

function instructorsResultsHtml(result, state) {
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
      <p>נבדקו מדריכים קיימים, אך אף אחד מהם אינו עומד בכל תנאי הקורס. ייתכן שנדרש גיוס.</p>
      <details class="course-scheduling-details"><summary>הצגת פרטים</summary>
        <p>שפה: ${escapeHtml(result.course.instruction_language || '—')} · שכבה: ${escapeHtml(result.course.education_level || result.course.grade || '—')} · מגדר: ${escapeHtml(result.course.required_instructor_gender || 'ללא')}</p>
      </details>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות</button>
    </div>`;
  }
  if (!result?.recommended && result?.status === 'נדרש טיפול') {
    return `<div class="course-scheduling-result-block">
      <h3>נדרשת בדיקה נוספת</h3>
      <p>${escapeHtml(result.treatmentReason || 'לא ניתן להציע שיבוץ אוטומטי לקורס זה כרגע.')}</p>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-open-missing-course>פתח פעילות</button>
    </div>`;
  }
  if (!result?.recommended) {
    return `<div class="course-scheduling-waiting-card">
      <strong>טרם נבדקו מדריכים לקורס זה</strong>
      <p>לחץ על "מצא מדריכים מתאימים" כדי לראות מדריכים זמינים ומתאימים.</p>
    </div>`;
  }

  const selectedId = text(state.courseSchedulingSelectedCandidateId) || emp(result.recommended);
  const alternatives = result.alternatives || [];
  const visibleAlts = alternatives.slice(0, 3);
  const hiddenAlts = alternatives.slice(3);
  const showMore = !!state.courseSchedulingShowAllCandidates;
  const moreChecked = (result.checked || []).filter((item) => item.eligible && emp(item) !== emp(result.recommended) && !alternatives.some((alt) => emp(alt) === emp(item)));

  return `<div class="course-scheduling-result-block" data-course-options>
    ${candidateCardHtml(result.recommended, { recommended: true, selectedId, name: `course-candidate-${idOf(result.course)}` })}
    ${visibleAlts.length ? `<div class="course-scheduling-alternatives"><h3>מדריכים נוספים</h3>${visibleAlts.map((item) => candidateCardHtml(item, { selectedId, name: `course-candidate-${idOf(result.course)}` })).join('')}</div>` : ''}
    ${(hiddenAlts.length || moreChecked.length) ? `<details class="course-scheduling-details" data-more-candidates ${showMore ? 'open' : ''}><summary>הצגת מדריכים נוספים</summary>${[...hiddenAlts, ...moreChecked].map((item) => candidateCardHtml(item, { selectedId, name: `course-candidate-${idOf(result.course)}` })).join('')}</details>` : ''}
    <div class="course-scheduling-detail-actions">
      <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-assign-course>שבץ מדריך</button>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-save-draft>שמור כטיוטה</button>
      <button type="button" class="course-scheduling-text-btn" data-clear-candidate>בטל בחירה</button>
    </div>
  </div>`;
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
    <p class="course-scheduling-status-chip${cardStatusClass(row.statusLabel)}">${escapeHtml(row.statusLabel)}</p>
    <div class="course-scheduling-primary-action">
      <button type="button" class="${findButtonClass}" data-find-instructors ${finding ? 'disabled' : ''}>
        ${finding ? 'בודק מדריכים...' : (hasSuggestion ? 'בדיקה מחדש של מדריכים' : 'מצא מדריכים מתאימים')}
      </button>
    </div>
    ${finding ? loadingInstructorsHtml(state.courseSchedulingProgressStep || 1) : instructorsResultsHtml(result, state)}`;
}

function missingCoursesAlertHtml(readiness, state) {
  if (!readiness.missingScheduleCount) return '';
  const expanded = !!state.courseSchedulingShowMissingDetails;
  return `<section class="course-scheduling-alert-compact course-scheduling-alert-compact--warning">
    <div>
      <strong>${readiness.missingScheduleCount} קורסים אינם מוכנים לשיבוץ</strong>
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-toggle-missing-details>${expanded ? 'הסתרת פירוט' : 'הצגת הקורסים לתיקון'}</button>
    </div>
    ${expanded ? `<ul class="course-scheduling-alert-details">
      <li>${readiness.missingStartDate} חסר תאריך התחלה</li>
      <li>${readiness.missingStartTime} חסרה שעת התחלה</li>
      <li><button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm" data-open-missing-schedule-courses>מעבר לרשימת הקורסים לתיקון</button></li>
    </ul>` : ''}
  </section>`;
}

function dataReadinessHtml(data) {
  const instructors = (data?.instructors || []).filter((row) => {
    const value = text(row.active).toLowerCase();
    return value === 'yes' || value === 'true' || value === '1';
  });
  if (!instructors.length) return '<p class="course-scheduling-muted">לא נמצאו מדריכים פעילים לבדיקה.</p>';
  const profiles = new Map((data?.scheduling?.profiles || []).map((row) => [text(row.emp_id), row]));
  const ruleCounts = new Map();
  for (const rule of (data?.scheduling?.rules || [])) {
    const empId = text(rule.emp_id);
    if (empId) ruleCounts.set(empId, (ruleCounts.get(empId) || 0) + 1);
  }
  const missingProfile = instructors.filter((row) => !profiles.has(text(row.emp_id))).length;
  const missingAddress = instructors.filter((row) => !text(row.address)).length;
  const missingAvailability = instructors.filter((row) => (ruleCounts.get(text(row.emp_id)) || 0) < 5).length;
  const ready = instructors.filter((row) => profiles.has(text(row.emp_id)) && text(row.address) && (ruleCounts.get(text(row.emp_id)) || 0) >= 5).length;
  return `<div class="course-scheduling-maintenance-panel">
    <h3>בדיקת נתונים</h3>
    <p><b>${ready}</b> מתוך ${instructors.length} מדריכים מוכנים לשיבוץ</p>
    <ul>
      <li>${missingAvailability} ללא זמינות שבועית מלאה</li>
      <li>${missingProfile} ללא פרופיל שיבוץ</li>
      <li>${missingAddress} ללא כתובת</li>
    </ul>
  </div>`;
}

function maintenanceMenuHtml(state, data) {
  const open = !!state.courseSchedulingMaintenanceOpen;
  const confirmDistance = !!state.courseSchedulingShowDistanceConfirm;
  const showReadiness = !!state.courseSchedulingShowDataReadiness;
  const distanceBusy = !!state.courseSchedulingDistanceLoading;
  const doneMessage = text(state.courseSchedulingDistanceDoneMessage);
  const doneError = !!state.courseSchedulingDistanceError;
  return `<div class="course-scheduling-maintenance">
    <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary course-scheduling-btn--sm course-scheduling-maintenance-trigger" data-toggle-maintenance aria-expanded="${open ? 'true' : 'false'}">⚙ תחזוקת המערכת</button>
    ${open ? `<div class="course-scheduling-maintenance-menu">
      <button type="button" class="course-scheduling-menu-item" data-maintenance-action="distances">עדכון מרחקים</button>
      <button type="button" class="course-scheduling-menu-item" data-maintenance-action="readiness">בדיקת נתונים</button>
      ${confirmDistance ? `<div class="course-scheduling-maintenance-panel">
        <p>פעולה זו מעדכנת את זמני הנסיעה בין כתובות המדריכים ובתי הספר. בדרך כלל אין צורך להפעיל אותה לפני כל שיבוץ.</p>
        <div class="course-scheduling-detail-actions">
          <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-update-distances ${distanceBusy ? 'disabled' : ''}>${distanceBusy ? 'מעדכן מרחקים...' : 'עדכן מרחקים'}</button>
          ${distanceBusy ? '<button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-stop-distance-build>עצור</button>' : ''}
        </div>
        ${doneMessage ? `<p class="${doneError ? 'course-scheduling-alert' : 'course-scheduling-success'}">${escapeHtml(doneMessage)}</p>
          ${text(state.courseSchedulingDistanceDetails) ? `<details class="course-scheduling-details"><summary>הצגת פרטים</summary><p>${escapeHtml(state.courseSchedulingDistanceDetails)}</p></details>` : ''}` : ''}
      </div>` : ''}
      ${showReadiness ? dataReadinessHtml(data) : ''}
    </div>` : ''}
  </div>`;
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
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true }),
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

    const interfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
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
    const isAdminRole = ['admin', 'operation_manager'].includes(text(state?.user?.role));
    const title = tab === 'calendar' ? 'מערכת שבועית' : 'שיבוצים';
    const subtitle = tab === 'calendar'
      ? 'צפו בקורסים ששובצו ובטיוטות לפי שבוע.'
      : 'בחרו קורס, מצאו מדריך מתאים ושמרו כטיוטה או שבצו.';

    return dsScreenStack(`
    <div class="course-scheduling-screen" dir="rtl" data-cs-ui="ux-polish-20260804-v4" data-cs-tab="${tab}">
      <header class="course-scheduling-header">
        <div class="course-scheduling-header-copy">
          <h1 class="course-scheduling-title">${title}</h1>
          <p class="course-scheduling-subtitle">${subtitle}</p>
        </div>
        ${isAdminRole ? maintenanceMenuHtml(state, data) : ''}
      </header>

      <nav class="course-scheduling-tabs" aria-label="ניווט ממשק השיבוצים">
        <button type="button" class="course-scheduling-tab${tab === 'courses' ? ' is-active' : ''}" data-switch-tab="courses">קורסים לשיבוץ</button>
        <button type="button" class="course-scheduling-tab${tab === 'calendar' ? ' is-active' : ''}" data-switch-tab="calendar">מערכת שבועית</button>
      </nav>

      ${tab === 'courses' ? `
        <section class="course-scheduling-summary">${summaryCardsHtml(interfaceCourses, results)}</section>
        ${missingCoursesAlertHtml(readiness, state)}
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
      ` : calendarTabHtml({ interfaceCourses, selectedId, state })}
    </div>`);
  },

  bind({ root, data, state, rerender, clearScreenDataCache }) {
    const canEdit = ['admin', 'operation_manager'].includes(text(state?.user?.role));
    const resultByCourseId = new Map((state.courseSchedulingResults || []).map((result) => [idOf(result.course), result]));
    const interfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
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

    root.querySelectorAll('[data-switch-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        state.courseSchedulingTab = button.dataset.switchTab === 'calendar' ? 'calendar' : 'courses';
        state.courseSchedulingMaintenanceOpen = false;
        rerender();
      });
    });

    root.querySelectorAll('[data-course-card]').forEach((button) => {
      button.addEventListener('click', () => {
        state.courseSchedulingSelectedId = button.dataset.courseCard;
        state.courseSchedulingSelectedCandidateId = '';
        state.courseSchedulingShowAllCandidates = false;
        state.courseSchedulingTab = 'courses';
        const course = courseById.get(state.courseSchedulingSelectedId);
        if (course?.start_date) state.courseSchedulingWeek = course.start_date;
        rerender();
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

    root.querySelector('[data-toggle-missing-details]')?.addEventListener('click', () => {
      state.courseSchedulingShowMissingDetails = !state.courseSchedulingShowMissingDetails;
      rerender();
    });
    root.querySelector('[data-open-missing-schedule-courses]')?.addEventListener('click', openMissingScheduleCourses);

    root.querySelector('[data-toggle-maintenance]')?.addEventListener('click', () => {
      state.courseSchedulingMaintenanceOpen = !state.courseSchedulingMaintenanceOpen;
      if (!state.courseSchedulingMaintenanceOpen) {
        state.courseSchedulingShowDistanceConfirm = false;
        state.courseSchedulingShowDataReadiness = false;
      }
      rerender();
    });
    root.querySelectorAll('[data-maintenance-action]').forEach((button) => {
      button.addEventListener('click', () => {
        if (button.dataset.maintenanceAction === 'distances') {
          state.courseSchedulingShowDistanceConfirm = true;
          state.courseSchedulingShowDataReadiness = false;
        } else {
          state.courseSchedulingShowDataReadiness = true;
          state.courseSchedulingShowDistanceConfirm = false;
        }
        rerender();
      });
    });

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

    detailRoot.querySelectorAll('input[type="radio"][name^="course-candidate"]').forEach((input) => {
      input.addEventListener('change', () => {
        state.courseSchedulingSelectedCandidateId = text(input.value);
        rerender();
      });
    });

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
        state.courseSchedulingResults = calculateCourseSchedule({ ...input, travel: routed.travel, routeMatrix: routed.routeMatrix });
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
        || text(detailRoot.querySelector('input[type="radio"]:checked')?.value)
        || emp(result.recommended);
      const selected = [result.recommended, ...(result.alternatives || [])].find((item) => emp(item) === selectedId)
        || (result.checked || []).find((item) => emp(item) === selectedId);
      if (!selected) return;
      let reason = null;
      if (selectedId !== emp(result.recommended)) {
        reason = window.prompt('יש להזין נימוק קצר לבחירת מדריך שאינו המומלץ:')?.trim();
        if (!reason) return;
      }
      if (!window.confirm(`לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name}?`)) return;
      event.target.disabled = true;
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
      if (error) { showToast(`השיבוץ נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
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
        || text(detailRoot.querySelector('input[type="radio"]:checked')?.value)
        || emp(result.recommended);
      const selected = [result.recommended, ...(result.alternatives || [])].find((item) => emp(item) === selectedId);
      if (!selected) return;
      event.target.disabled = true;
      const { error } = await supabase.rpc('save_course_assignment_draft', {
        p_activity_id: selectedCourseId,
        p_emp_id: Number(selectedId),
        p_instructor_name: selected.instructor.full_name,
        p_top_emp_id: Number(emp(result.recommended)),
        p_selected_score: selected.score,
        p_top_score: result.recommended.score
      });
      if (error) { showToast(`שמירת הטיוטה נכשלה: ${error.message}`, 'error'); event.target.disabled = false; return; }
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
export { pickNearestActionableCourse, userFacingStatus, STATUS };
