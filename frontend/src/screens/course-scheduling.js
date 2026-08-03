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
  formatDistanceBuildProgress,
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

function optionHtml(candidate, recommended, courseId) {
  const inputName = `candidate-${courseId}`;
  return `<label class="course-scheduling__option"><input type="radio" name="${escapeHtml(inputName)}" value="${escapeHtml(emp(candidate))}"${emp(candidate) === emp(recommended) ? ' checked' : ''}><span><b>${escapeHtml(candidate.instructor.full_name || emp(candidate))}</b> · ציון ${candidate.score}<small>${escapeHtml(candidate.explanation)}</small></span></label>`;
}

function missingCandidateHtml(candidate, course) {
  const missing = candidate.missingProfileData.filter((item) => !item.includes('— משפיע'));
  const issueRows = candidate.issues
    .filter((issue) => issue.missing)
    .map((issue) => `<p>${escapeHtml(issue.message)} — משפיע על ${issue.dates.length} מפגשים. <details><summary>הצגת תאריכים</summary>${issue.dates.map((date) => `<span>${escapeHtml(date)}</span>`).join(' · ')}</details></p>`)
    .join('');
  const gender = missing.includes('מגדר') && course.required_instructor_gender === 'female'
    ? '<p>מגדר המדריך לא הוגדר. הקורס דורש מדריכה.</p>'
    : '';
  return `<article class="scheduling-candidate"><p><b>${escapeHtml(candidate.instructor.full_name || emp(candidate))} | ${escapeHtml(emp(candidate))}</b></p><p><b>סטטוס:</b> חסרים נתוני מדריך</p><p><b>כתובת:</b> ${escapeHtml(candidate.instructor.address || 'לא הוגדרה')}</p>${gender}<p><b>חסר להשלמה:</b> ${escapeHtml(missing.join(', '))}.</p>${issueRows}<p>לא ניתן לחשב ציון התאמה ועומס ביחס לזמינות עד להשלמת הפרופיל.</p></article>`;
}

export function detailsHtml(result) {
  if (result.status === 'חסר מידע') return `<details><summary>מה חסר?</summary><p>${escapeHtml(result.missing.join(' · '))}</p></details>`;
  if (result.status === 'נדרש גיוס') {
    const reasons = result.checked.flatMap((item) => item.failures).reduce((counts, reason) => counts.set(reason, (counts.get(reason) || 0) + 1), new Map());
    return `<details><summary>דרישות וסיבות פסילה</summary><p>שפה: ${escapeHtml(result.course.instruction_language)} · שכבה: ${escapeHtml(result.course.education_level || result.course.grade)} · מגדר: ${escapeHtml(result.course.required_instructor_gender || 'ללא')}</p><ul>${[...reasons].sort((first, second) => second[1] - first[1]).slice(0, 5).map(([reason, count]) => `<li>${escapeHtml(reason)} (${count})</li>`).join('')}</ul><p>${result.checked.length} מדריכים נבדקו</p></details>`;
  }
  if (!result.recommended && result.status === 'נדרש טיפול') {
    const incomplete = (result.incompleteProfiles || []).map((item) => missingCandidateHtml(item, result.course)).join('');
    return `<p>${escapeHtml(result.treatmentReason || 'נדרשת בדיקה ידנית של הקורס.')}</p>${incomplete ? `<details><summary>מדריכים עם נתונים חסרים</summary>${incomplete}</details>` : ''}`;
  }
  const courseId = idOf(result.course);
  return `<details data-course-options><summary>הצג חלופות</summary>${[result.recommended, ...result.alternatives].filter(Boolean).map((item) => optionHtml(item, result.recommended, courseId)).join('')}<details><summary>הצג את כל המדריכים שנבדקו</summary>${result.checked.map((item) => item.missingProfileData.length ? missingCandidateHtml(item, result.course) : `<p><b>${escapeHtml(item.instructor.full_name || emp(item))}</b>: ${item.eligible ? `ציון ${item.score} · ${escapeHtml(item.explanation)}` : `לא מתאים · ${escapeHtml(item.failures.join(' · '))}`}</p>`).join('')}</details></details>`;
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

// One row model per course shown in the interface (spec section 4 + 6.1): entry only
// requires a start date and start time, so unlike the matching engine's own eligibility
// filter this never hides a course for being closed, assigned, or short on data — it just
// buckets it. Locked/settled courses that need no action are shown on the calendar only.
function courseRowModel(course, resultByCourseId, meetingState) {
  const id = idOf(course);
  const isAssigned = !!text(course.emp_id);
  const hasDraft = !isAssigned && !!text(course.draft_emp_id);
  const meetingsCompleted = isAssigned ? meetingsCompletedForCourse(course, meetingState) : 0;
  const meetingStateLoaded = meetingState?.loaded !== false;
  const stage = isAssigned && meetingsCompleted != null ? courseMeetingStage(meetingsCompleted) : null;
  const result = resultByCourseId.get(id) || null;
  let bucket = null;
  let statusLabel = 'ממתין לשיבוץ';

  if (isAssigned) {
    if (text(course.instructor_assignment_status) === 'נדרש טיפול') { bucket = 'treatment'; statusLabel = 'נדרש טיפול'; }
    else statusLabel = text(course.instructor_assignment_status) || 'שובץ';
  } else if (hasDraft) {
    bucket = 'draft';
    statusLabel = 'שמור בטיוטה';
  } else if (!result) {
    bucket = daysUntil(course.start_date) <= 7 ? 'soon' : daysUntil(course.start_date) <= 14 ? 'upcoming' : 'later';
    statusLabel = 'ממתין לחישוב';
  } else if (result.status === 'חסר מידע') { bucket = 'missing'; statusLabel = 'חסר מידע'; }
  else if (result.status === 'נדרש גיוס') { bucket = 'recruit'; statusLabel = 'נדרש גיוס'; }
  else if (result.status === 'נדרש טיפול') { bucket = 'treatment'; statusLabel = 'נדרש טיפול'; }
  else {
    const days = daysUntil(course.start_date);
    bucket = days <= 7 ? 'soon' : days <= 14 ? 'upcoming' : 'later';
    statusLabel = 'הצעה מוכנה';
  }

  return { course, id, result, isAssigned, hasDraft, meetingsCompleted, meetingStateLoaded, stage, bucket, statusLabel };
}

const LIST_GROUPS = [
  { key: 'soon', label: 'מתחילים בתוך 7 ימים' },
  { key: 'upcoming', label: 'מתחילים בתוך 8–14 ימים' },
  { key: 'later', label: 'מתחילים בהמשך' },
  { key: 'draft', label: 'שמורים בטיוטה' },
  { key: 'missing', label: 'חסר מידע' },
  { key: 'recruit', label: 'נדרש גיוס' },
  { key: 'treatment', label: 'נדרש טיפול' }
];

function courseListCardHtml(row, selectedId) {
  const c = row.course;
  return `<button type="button" class="course-list__card${row.id === selectedId ? ' is-selected' : ''}" data-course-card="${escapeHtml(row.id)}">
    <strong>${escapeHtml(c.activity_name || '—')}</strong>
    <span class="course-list__card-meta">${escapeHtml(c.school || '—')} · ${escapeHtml(c.authority || '—')}</span>
    <span class="course-list__card-meta"><bdi dir="ltr">${escapeHtml(formatDateHe(c.start_date))}</bdi> · ${compactMeetingsHtml(c)}</span>
    <span class="ds-status-chip">${escapeHtml(row.statusLabel)}</span>
  </button>`;
}

function courseListHtml(rowModels, selectedId) {
  const groups = LIST_GROUPS.map((group) => ({ ...group, rows: rowModels.filter((row) => row.bucket === group.key) })).filter((group) => group.rows.length);
  if (!groups.length) return dsEmptyState('אין קורסים הדורשים פעולה כרגע.');
  return groups.map((group) => `<section class="course-list__group"><h3>${escapeHtml(group.label)} <span class="ds-badge">${group.rows.length}</span></h3>${group.rows.map((row) => courseListCardHtml(row, selectedId)).join('')}</section>`).join('');
}

function meetingStageMessage(stage, meetingsCompleted, meetingStateLoaded = true) {
  if (!meetingStateLoaded || meetingsCompleted == null) {
    return 'מידע על מפגשים שהתקיימו או בוטלו לא נטען במלואו — לא מוצג סטטוס מפגשים חלקי.';
  }
  if (stage === 'locked') return `התקיימו ${meetingsCompleted} מפגשים. הקורס פעיל ונעול — החלפת מדריך אפשרית רק כפעולה חריגה עקב צורך תפעולי.`;
  if (stage === 'one_completed') return 'התקיים כבר מפגש אחד. ניתן להציע החלפה רק עם שיפור משמעותי, אזהרה ואישור מפורש.';
  return 'הקורס טרם התחיל. ניתן להציע שינוי רגיל של המדריך.';
}

function exceptionalPickerHtml(result, canEdit) {
  if (!canEdit) return '';
  const rejected = (result.checked || []).filter((candidate) => !candidate.eligible && !candidate.missingProfileData.length);
  if (!rejected.length) return '';
  return `<details class="course-scheduling__exceptional"><summary>שיבוץ חריג</summary>
    <p class="scheduling-warning">בחירת מדריך שאינו עומד בתנאי ההתאמה. יוצג נימוק ותידרש הרשאה ואישור מפורש.</p>
    <select class="ds-input" data-exceptional-select>${rejected.map((candidate) => `<option value="${escapeHtml(emp(candidate))}">${escapeHtml(candidate.instructor.full_name || emp(candidate))} — ${escapeHtml(candidate.failures.join(' · '))}</option>`).join('')}</select>
    <button type="button" class="ds-btn ds-btn--sm" data-exceptional-assign>שבץ בכל זאת</button>
  </details>`;
}

function pendingPanelHtml(result, canEdit) {
  const c = result.course;
  const header = `<header class="course-panel__header"><h2>${escapeHtml(c.activity_name || '—')}</h2><p>${escapeHtml(c.school || '—')} · ${escapeHtml(c.authority || '—')}</p><p>${compactMeetingsHtml(c)}</p></header>`;
  const actions = result.recommended
    ? `<div class="course-panel__actions"><button class="ds-btn ds-btn--primary" data-assign-course>שבץ</button>${canEdit ? '<button class="ds-btn" data-save-draft>שמור בטיוטה</button>' : ''}<button class="ds-btn" data-reject-course-suggestion>דחה הצעה</button><button class="ds-btn ds-btn--ghost" data-open-missing-course>פתח פעילות</button></div>`
    : `<div class="course-panel__actions">${result.status === 'חסר מידע' || result.status === 'נדרש גיוס' ? '<button class="ds-btn" data-open-missing-course>פתח פעילות</button>' : ''}</div>`;
  return `${header}<p class="ds-status-chip">${escapeHtml(result.status)}</p>${detailsHtml(result)}${actions}${exceptionalPickerHtml(result, canEdit)}`;
}

function draftPanelHtml(course) {
  return `<header class="course-panel__header"><h2>${escapeHtml(course.activity_name || '—')}</h2><p>${escapeHtml(course.school || '—')} · ${escapeHtml(course.authority || '—')}</p></header>
    <p class="ds-status-chip">שמור בטיוטה</p>
    <p>מדריכה/ה בטיוטה: <b>${escapeHtml(course.draft_instructor_name || course.draft_emp_id)}</b></p>
    <p class="ds-muted">הטיוטה שומרת את מועדי המדריך/ה ולא מעדכנת את הפעילות עד לאישור.</p>
    <div class="course-panel__actions"><button class="ds-btn ds-btn--primary" data-confirm-draft>שבץ (אישור טיוטה)</button><button class="ds-btn" data-cancel-draft>ביטול טיוטה</button><button class="ds-btn ds-btn--ghost" data-open-missing-course>פתח פעילות</button></div>`;
}

// Per-meeting instructor list (spec section 29): always reads from
// scheduling_course_meeting_instructors() rather than assuming activities.emp_id taught
// every meeting, so a past meeting still shows whoever actually delivered it even after
// an operational replacement changed the course's current instructor going forward.
export function meetingInstructorHistoryHtml(meetingRows, replacements) {
  if (!meetingRows?.length) return '';
  const effectiveDates = new Set((replacements || []).map((row) => text(row.effective_from)));
  const rows = meetingRows.map((row) => {
    const isEffectiveFrom = effectiveDates.has(text(row.meeting_date));
    const marker = isEffectiveFrom ? ' <span class="ds-status-chip ds-status-chip--warning">מכאן ואילך — החלפה נכנסה לתוקף</span>' : '';
    return `<tr><td><bdi dir="ltr">${escapeHtml(formatDateHe(row.meeting_date))}</bdi></td><td>${escapeHtml(row.instructor_name || row.emp_id || '—')}${marker}</td></tr>`;
  }).join('');
  return `<details class="course-scheduling__meeting-history"><summary>מדריך לפי מפגש</summary>${dsTableWrap(`<table class="ds-table"><thead><tr><th>תאריך</th><th>מדריך</th></tr></thead><tbody>${rows}</tbody></table>`)}</details>`;
}

function lockedPanelHtml(row, canEdit, instructors, meetingRows, replacements) {
  const c = row.course;
  const activeInstructors = (instructors || []).filter((instructor) => text(instructor.active).toLowerCase() === 'yes' && text(instructor.emp_id) !== text(c.emp_id));
  const replaceForm = canEdit ? `<details class="course-scheduling__replace"><summary>החלפת מדריך עקב צורך תפעולי</summary>
    <p class="scheduling-warning">פעולה חריגה ונפרדת — לשימוש כאשר המדריך/ה הנוכחי/ת אינו/ה יכול/ה להמשיך או קיימת סיבה תפעולית ממשית.</p>
    <select class="ds-input" data-replace-select>${activeInstructors.map((instructor) => `<option value="${escapeHtml(instructor.emp_id)}" data-name="${escapeHtml(instructor.full_name)}">${escapeHtml(instructor.full_name)}</option>`).join('')}</select>
    <label>תאריך כניסת השינוי לתוקף<input class="ds-input" type="date" data-replace-effective-from value="${escapeHtml(today())}"></label>
    <label>סיבת ההחלפה<textarea class="ds-input" rows="2" data-replace-reason></textarea></label>
    <button type="button" class="ds-btn ds-btn--sm" data-replace-instructor>ביצוע החלפה</button>
  </details>` : '';
  return `<header class="course-panel__header"><h2>${escapeHtml(c.activity_name || '—')}</h2><p>${escapeHtml(c.school || '—')} · ${escapeHtml(c.authority || '—')}</p></header>
    <p class="ds-status-chip">${escapeHtml(row.statusLabel)}</p>
    <p>מדריך/ה: <b>${escapeHtml(c.instructor_name || c.emp_id)}</b></p>
    <p>${escapeHtml(meetingStageMessage(row.stage, row.meetingsCompleted, row.meetingStateLoaded))}</p>
    ${meetingInstructorHistoryHtml(meetingRows, replacements)}
    <div class="course-panel__actions"><button class="ds-btn ds-btn--ghost" data-open-missing-course>פתח פעילות</button></div>
    ${replaceForm}`;
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

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling, meetingState] = await Promise.all([
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true }),
      api.instructorContacts(),
      loadInstructorSchedulingData(),
      loadCourseMeetingState()
    ]);
    return { activities: activities?.rows || [], instructors: contacts?.rows || [], scheduling, meetingState };
  },

  render(data, { state }) {
    if (!['admin', 'operation_manager'].includes(text(state?.user?.role))) return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בשיבוץ קורסים.'));
    // Reaching this point already means the role check above passed; every RPC re-checks
    // the role and active-user status server-side regardless of this client-side gate.
    const canEdit = true;

    const results = state.courseSchedulingResults || [];
    const hasCalculated = !!state.courseSchedulingCalculatedAt;
    const counts = courseSchedulingCounts(results);
    const resultByCourseId = new Map(results.map((result) => [idOf(result.course), result]));
    const interfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
    const rowModels = interfaceCourses.map((course) => courseRowModel(course, resultByCourseId, data.meetingState));
    const selectedId = state.courseSchedulingSelectedId || '';
    const readiness = courseSchedulingDataReadiness(data.activities || []);
    const meetingStateError = data.meetingState && data.meetingState.loaded === false
      ? (data.meetingState.error || 'unknown')
      : '';

    const anchor = state.courseSchedulingWeek || (interfaceCourses.find((c) => idOf(c) === selectedId)?.start_date) || today();
    const { start, end, days } = weekRange(anchor);
    const view = state.courseSchedulingCalendarView === 'fixed' ? 'fixed' : 'week';
    const weekRows = buildWeekRows(interfaceCourses, days);
    const calendarBody = view === 'fixed' ? fixedScheduleHtml(interfaceCourses, selectedId) : weekCalendarHtml({ days, rows: weekRows, selectedCourseId: selectedId });
    const distanceBusy = !!state.courseSchedulingDistanceLoading;
    const summaryHtml = hasCalculated
      ? `<span>חישוב אחרון: ${escapeHtml(state.courseSchedulingCalculatedAt)}</span><b>${results.length} קורסים נבדקו</b><b>${counts.ready} הצעה מוכנה</b><b>${counts.treatment} נדרש טיפול</b><b>${counts.recruit} נדרש גיוס</b><b>${counts.missing} חסר מידע</b>`
      : `<span>חישוב אחרון: טרם בוצע</span><b>${interfaceCourses.length} קורסים בממשק</b><b>טרם בוצע חישוב</b>`;
    const readinessHtml = readiness.missingScheduleCount
      ? `<p class="scheduling-warning course-scheduling__readiness" role="alert">${readiness.openCount} קורסים פתוחים · ${readiness.readyForInterface} מוכנים להצגה בממשק · ${readiness.missingStartDate} חסרים תאריך התחלה · ${readiness.missingStartTime} חסרים שעת התחלה. <button type="button" class="ds-link-btn" data-open-missing-schedule-courses>פתח את רשימת הפעילויות החסרות</button></p>`
      : '';
    const meetingWarningHtml = meetingStateError
      ? '<p class="scheduling-warning" role="alert">אזהרה: מידע על מפגשים שהתקיימו או בוטלו לא נטען. נתוני מפגשים חלקיים אינם מוצגים כמלאים.</p>'
      : '';
    const distanceSummaryClass = state.courseSchedulingDistanceError
      ? 'scheduling-warning'
      : (distanceBusy ? 'course-scheduling__distance-progress' : 'ds-muted');

    return dsScreenStack(`<style>
      .course-scheduling-layout{display:grid;grid-template-columns:300px 1fr;gap:12px;align-items:start}
      @media (max-width:1100px){.course-scheduling-layout{grid-template-columns:1fr}}
      .course-scheduling .ds-page-header{margin-bottom:8px;padding-bottom:6px}
      .course-scheduling .ds-page-header__subtitle{margin:2px 0 0;font-size:.85rem}
      .course-scheduling__summary{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:0 0 8px;font-size:.9rem}
      .course-scheduling__summary b{font-weight:600}
      .course-scheduling__readiness,.course-scheduling [data-course-scheduling-error],.course-scheduling [data-course-scheduling-distance-summary].scheduling-warning{margin:0 0 8px;padding:8px 10px;border:1px solid #f0c2c2;border-radius:8px;background:#fff5f5;color:#8a1f1f}
      .course-scheduling__distance-progress{margin:0 0 8px;color:#334155}
      .course-list__group{margin-bottom:12px}
      .course-list__group h3{font-size:.85rem;color:#536278;margin:0 0 6px}
      .course-list__card{display:grid;gap:3px;width:100%;text-align:right;padding:8px 10px;margin-bottom:6px;border:1px solid #e1e8f1;border-radius:8px;background:#fff;cursor:pointer}
      .course-list__card.is-selected{border-color:#3d6bd6;box-shadow:0 0 0 1px #3d6bd6 inset}
      .course-list__card-meta{font-size:.78rem;color:#69778b}
      .course-calendar__toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
      .course-calendar__scroll{overflow:auto;max-height:70vh}
      .course-calendar__table{border-collapse:collapse;width:100%;min-width:760px}
      .course-calendar__table th,.course-calendar__table td{border:1px solid #e6ecf3;padding:6px;vertical-align:top;font-size:.8rem}
      .course-calendar__table thead th{background:#f7f9fc;position:sticky;top:0}
      .course-calendar__instructor{white-space:nowrap;background:#f7f9fc;position:sticky;right:0}
      .course-calendar__cell{min-width:130px}
      .course-calendar__cell.is-selected-day{background:#eef4ff}
      .course-calendar__block{display:block;width:100%;text-align:right;border:1px solid #cfe0fb;background:#eef4ff;border-radius:6px;padding:4px 6px;margin-bottom:4px;cursor:pointer;font-size:.75rem}
      .course-calendar__block--draft{border-style:dashed;background:#fff8ea;border-color:#e8c976}
      .course-calendar__block-name{display:block;font-weight:600}
      .course-calendar__block-school{display:block;color:#69778b}
      .course-panel__header{margin-bottom:8px}
      .course-panel__actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
      .course-scheduling__exceptional,.course-scheduling__replace{margin-top:10px;border:1px solid #f0d6d6;border-radius:8px;padding:8px}
      .course-scheduling__exceptional summary,.course-scheduling__replace summary{cursor:pointer;color:#a33}
      .course-scheduling__exceptional select,.course-scheduling__replace select,.course-scheduling__replace input,.course-scheduling__replace textarea{margin:6px 0;width:100%}
      .course-calendar__fixed-row--draft{opacity:.8}
    </style>
    <div class="course-scheduling">
    <header class="ds-page-header"><div><h1 class="ds-page-header__title">שיבוצים</h1><p class="ds-page-header__subtitle">קורסים פתוחים של 2027 שעדיין לא שובצו</p></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="ds-btn" data-update-distances ${distanceBusy ? 'disabled' : ''}>${distanceBusy ? 'בונה מאגר מרחקים…' : 'בניית ועדכון מאגר מרחקים'}</button>${distanceBusy ? '<button type="button" class="ds-btn" data-stop-distance-build>עצור</button>' : ''}<button class="ds-btn ds-btn--primary" data-calculate-course-schedule ${state.courseSchedulingLoading ? 'disabled' : ''}>${state.courseSchedulingLoading ? 'מחשב…' : 'חשב הצעות שיבוץ מחדש'}</button></div></header>
    <section class="course-scheduling__summary">${summaryHtml}</section>
    ${readinessHtml}
    ${meetingWarningHtml}
    <p data-course-scheduling-error class="scheduling-warning"${state.courseSchedulingError ? '' : ' hidden'}>${escapeHtml(state.courseSchedulingError || '')}</p>
    <p data-course-scheduling-distance-summary class="${distanceSummaryClass}"${state.courseSchedulingDistanceSummary ? '' : ' hidden'}>${escapeHtml(state.courseSchedulingDistanceSummary || '')}</p>
    <div class="course-scheduling-layout">
      <aside class="course-list">${courseListHtml(rowModels, selectedId)}</aside>
      <section class="course-calendar">
        <div class="course-calendar__toolbar">
          <button type="button" class="ds-btn ds-btn--sm" data-week-nav="prev">◀ השבוע הקודם</button>
          <button type="button" class="ds-btn ds-btn--sm" data-week-nav="today">היום</button>
          <button type="button" class="ds-btn ds-btn--sm" data-week-nav="next">השבוע הבא ▶</button>
          <input class="ds-input ds-input--sm" type="date" data-week-pick value="${escapeHtml(start)}">
          <span>${weekNavLabel({ start, end })}</span>
          <span style="margin-inline-start:auto;display:flex;gap:6px">
            <button type="button" class="ds-btn ds-btn--sm${view === 'week' ? ' ds-btn--primary' : ''}" data-calendar-view="week">שבוע</button>
            <button type="button" class="ds-btn ds-btn--sm${view === 'fixed' ? ' ds-btn--primary' : ''}" data-calendar-view="fixed">מערכת קבועה</button>
          </span>
        </div>
        ${calendarBody}
      </section>
    </div>
    </div>`);
  },

  bind({ root, data, state, rerender, api, ui, clearScreenDataCache }) {
    const canEdit = ['admin', 'operation_manager'].includes(text(state?.user?.role));
    const resultByCourseId = new Map((state.courseSchedulingResults || []).map((result) => [idOf(result.course), result]));
    const interfaceCourses = (data.activities || []).filter(isCourseSchedulingInterfaceEligible);
    const courseById = new Map(interfaceCourses.map((course) => [idOf(course), course]));
    const rowModels = interfaceCourses.map((course) => courseRowModel(course, resultByCourseId, data.meetingState));

    if (!state.courseSchedulingSelectedId) {
      const nearest = pickNearestActionableCourse(rowModels, today());
      if (nearest) {
        state.courseSchedulingSelectedId = nearest.id;
        state.courseSchedulingWeek = nearest.course.start_date || state.courseSchedulingWeek;
        rerender();
        return;
      }
    } else if (!state.courseSchedulingWeek) {
      const selected = courseById.get(state.courseSchedulingSelectedId);
      if (selected?.start_date) {
        state.courseSchedulingWeek = selected.start_date;
        rerender();
        return;
      }
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

    const openCoursePanel = async (courseId) => {
      const course = courseById.get(courseId);
      if (!course || !ui) return;
      state.courseSchedulingSelectedId = courseId;
      state.courseSchedulingWeek = course.start_date || state.courseSchedulingWeek;
      const isAssigned = !!text(course.emp_id);
      const hasDraft = !isAssigned && !!text(course.draft_emp_id);
      let content;
      if (isAssigned) {
        const row = courseRowModel(course, resultByCourseId, data.meetingState);
        const [meetingInstructors, replacements] = await Promise.all([
          supabase.rpc('scheduling_course_meeting_instructors', { p_activity_id: courseId }),
          supabase.from('instructor_assignment_audit').select('effective_from').eq('activity_id', courseId).eq('decision_type', 'operational_replacement')
        ]);
        content = lockedPanelHtml(row, canEdit, data.instructors, meetingInstructors.data || [], replacements.data || []);
      } else if (hasDraft) {
        content = draftPanelHtml(course);
      } else {
        const result = resultByCourseId.get(courseId) || { course, status: 'ממתין לשיבוץ', recommended: null, alternatives: [], checked: [] };
        content = pendingPanelHtml(result, canEdit);
      }
      ui.openDrawer({ title: '', content: `<div dir="rtl" class="course-panel">${content}</div>` });
      bindPanel(courseId);
      rerender();
    };

    const bindPanel = (courseId) => {
      requestAnimationFrame(() => {
        const panelRoot = document.querySelector('.course-panel');
        if (!panelRoot) return;
        panelRoot.querySelectorAll('[data-open-missing-course]').forEach((button) => button.addEventListener('click', () => openMissingCourse(courseId)));

        panelRoot.querySelector('[data-assign-course]')?.addEventListener('click', async (event) => {
          const result = resultByCourseId.get(courseId);
          if (!result?.recommended) return;
          const optionsRoot = panelRoot.querySelector('[data-course-options]');
          const selectedId = text(optionsRoot?.querySelector('input[type="radio"]:checked')?.value) || emp(result.recommended);
          const selected = [result.recommended, ...result.alternatives].find((item) => emp(item) === selectedId);
          if (!selected) return;
          let reason = null;
          if (selectedId !== emp(result.recommended)) {
            reason = window.prompt('יש להזין נימוק קצר לבחירת החלופה:')?.trim();
            if (!reason) return;
          }
          if (!window.confirm(`לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name} בבית הספר ${result.course.school}?`)) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('assign_activity_instructor', {
            p_activity_id: courseId, p_emp_id: Number(selectedId), p_instructor_name: selected.instructor.full_name,
            p_top_emp_id: Number(emp(result.recommended)), p_selected_score: selected.score, p_top_score: result.recommended.score,
            p_decision_type: selectedId === emp(result.recommended) ? 'approved' : 'overridden', p_reason: reason
          });
          if (error) { showToast(`השיבוץ נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
          state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((item) => idOf(item.course) !== courseId);
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('השיבוץ נשמר וננעל', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-save-draft]')?.addEventListener('click', async (event) => {
          const result = resultByCourseId.get(courseId);
          if (!result?.recommended) return;
          const optionsRoot = panelRoot.querySelector('[data-course-options]');
          const selectedId = text(optionsRoot?.querySelector('input[type="radio"]:checked')?.value) || emp(result.recommended);
          const selected = [result.recommended, ...result.alternatives].find((item) => emp(item) === selectedId);
          if (!selected) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('save_course_assignment_draft', {
            p_activity_id: courseId, p_emp_id: Number(selectedId), p_instructor_name: selected.instructor.full_name,
            p_top_emp_id: Number(emp(result.recommended)), p_selected_score: selected.score, p_top_score: result.recommended.score
          });
          if (error) { showToast(`שמירת הטיוטה נכשלה: ${error.message}`, 'error'); event.target.disabled = false; return; }
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('הטיוטה נשמרה', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-reject-course-suggestion]')?.addEventListener('click', async (event) => {
          const result = resultByCourseId.get(courseId);
          if (!result?.recommended) return;
          const reason = window.prompt('יש להזין סיבה לדחיית הצעת השיבוץ:')?.trim();
          if (!reason) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('reject_activity_instructor_suggestion', {
            p_activity_id: courseId, p_top_emp_id: Number(emp(result.recommended)), p_top_score: result.recommended.score, p_reason: reason
          });
          if (error) { showToast(`דחיית ההצעה נכשלה: ${error.message}`, 'error'); event.target.disabled = false; return; }
          result.status = 'נדרש טיפול';
          result.treatmentReason = `הצעת השיבוץ נדחתה: ${reason}`;
          result.recommended = null; result.alternatives = []; result.incompleteProfiles = [];
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('ההצעה נדחתה והסיבה נשמרה', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-exceptional-assign]')?.addEventListener('click', async (event) => {
          const result = resultByCourseId.get(courseId);
          const select = panelRoot.querySelector('[data-exceptional-select]');
          const selectedId = text(select?.value);
          const candidate = (result?.checked || []).find((item) => emp(item) === selectedId);
          if (!candidate) return;
          const reason = window.prompt(`שיבוץ חריג — ${candidate.instructor.full_name}\nאי־ההתאמות: ${candidate.failures.join(' · ')}\nיש להזין נימוק חובה לשיבוץ חריג:`)?.trim();
          if (!reason) return;
          if (!window.confirm('לאשר שיבוץ חריג על אף אי־ההתאמות שהוצגו?')) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('assign_activity_instructor', {
            p_activity_id: courseId, p_emp_id: Number(selectedId), p_instructor_name: candidate.instructor.full_name,
            p_top_emp_id: Number(emp(result.recommended)) || Number(selectedId), p_selected_score: candidate.score, p_top_score: result.recommended?.score ?? null,
            p_decision_type: 'exception_approved', p_reason: reason
          });
          if (error) { showToast(`השיבוץ החריג נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
          state.courseSchedulingResults = (state.courseSchedulingResults || []).filter((item) => idOf(item.course) !== courseId);
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('השיבוץ החריג נשמר', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-confirm-draft]')?.addEventListener('click', async (event) => {
          const course = courseById.get(courseId);
          if (!course) return;
          if (!window.confirm(`לאשר את שיבוץ ${course.draft_instructor_name} לקורס ${course.activity_name}?`)) return;
          event.target.disabled = true;
          const empId = Number(course.draft_emp_id);
          const { error } = await supabase.rpc('assign_activity_instructor', {
            p_activity_id: courseId, p_emp_id: empId, p_instructor_name: course.draft_instructor_name,
            p_top_emp_id: empId, p_selected_score: null, p_top_score: null, p_decision_type: 'approved', p_reason: null
          });
          if (error) { showToast(`אישור הטיוטה נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('השיבוץ אושר וננעל', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-cancel-draft]')?.addEventListener('click', async (event) => {
          if (!window.confirm('לבטל את הטיוטה?')) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('cancel_course_assignment_draft', { p_activity_id: courseId });
          if (error) { showToast(`ביטול הטיוטה נכשל: ${error.message}`, 'error'); event.target.disabled = false; return; }
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('הטיוטה בוטלה', 'success');
          rerender();
        });

        panelRoot.querySelector('[data-replace-instructor]')?.addEventListener('click', async (event) => {
          const select = panelRoot.querySelector('[data-replace-select]');
          const empId = Number(select?.value);
          const name = select?.selectedOptions?.[0]?.dataset?.name || '';
          const effectiveFrom = text(panelRoot.querySelector('[data-replace-effective-from]')?.value);
          const reason = text(panelRoot.querySelector('[data-replace-reason]')?.value);
          if (!empId || !effectiveFrom || !reason) { showToast('יש למלא מדריך, תאריך תוקף ונימוק.', 'error'); return; }
          if (!window.confirm(`לבצע החלפת מדריך עקב צורך תפעולי אל ${name}?`)) return;
          event.target.disabled = true;
          const { error } = await supabase.rpc('replace_locked_course_instructor', {
            p_activity_id: courseId, p_new_emp_id: empId, p_new_instructor_name: name, p_effective_from: effectiveFrom, p_reason: reason
          });
          if (error) { showToast(`ההחלפה נכשלה: ${error.message}`, 'error'); event.target.disabled = false; return; }
          clearScreenDataCache?.();
          ui.closeDrawer?.();
          showToast('המדריך הוחלף ונשמרה היסטוריה מלאה', 'success');
          rerender();
        });
      });
    };

    root.querySelectorAll('[data-course-card]').forEach((button) => button.addEventListener('click', () => openCoursePanel(button.dataset.courseCard)));
    root.querySelectorAll('[data-calendar-course]').forEach((button) => button.addEventListener('click', () => openCoursePanel(button.dataset.calendarCourse)));
    root.querySelector('[data-open-missing-schedule-courses]')?.addEventListener('click', openMissingScheduleCourses);

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

    root.querySelector('[data-calculate-course-schedule]')?.addEventListener('click', async () => {
      if (state.courseSchedulingLoading) return;
      state.courseSchedulingLoading = true;
      state.courseSchedulingError = '';
      rerender();
      try {
        const scheduling = data.scheduling || {};
        const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        const input = {
          activities: data.activities,
          instructors: data.instructors,
          profiles,
          rules: group(scheduling.rules || [], 'emp_id'),
          exceptions: group(scheduling.exceptions || [], 'emp_id')
        };
        const preliminary = preliminaryCourseCandidates(input);
        const routed = await calculateCandidateTravel(preliminary, data.activities);
        state.courseSchedulingResults = calculateCourseSchedule({ ...input, travel: routed.travel, routeMatrix: routed.routeMatrix });
        if (routed.unavailableReason === 'google_key_not_configured') {
          state.courseSchedulingError = translateSchedulingRouteError('google_key_not_configured');
        } else if (routed.unavailableReason) {
          state.courseSchedulingError = translateSchedulingRouteError(routed.unavailableReason, 'לא ניתן היה לחשב חלק מהמסלולים. מעברים בין בתי ספר שלא אומתו נפסלו באופן בטוח.');
        }
        state.courseSchedulingCalculatedAt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
      } catch (error) {
        state.courseSchedulingError = `החישוב נכשל: ${translateSchedulingRouteError(error.message, error.message)}`;
      } finally {
        state.courseSchedulingLoading = false;
        rerender();
      }
    });

    root.querySelector('[data-stop-distance-build]')?.addEventListener('click', () => {
      state.courseSchedulingDistanceStopRequested = true;
      state.courseSchedulingDistanceSummary = formatDistanceBuildProgress(state.courseSchedulingDistanceStats || {}, { stopped: true, done: false });
      rerender();
    });

    root.querySelector('[data-update-distances]')?.addEventListener('click', async () => {
      if (state.courseSchedulingDistanceLoading) return;
      state.courseSchedulingDistanceLoading = true;
      state.courseSchedulingDistanceStopRequested = false;
      state.courseSchedulingDistanceError = false;
      state.courseSchedulingDistanceStats = null;
      state.courseSchedulingDistanceSummary = 'מתחיל בניית מאגר מרחקים…';
      rerender();
      try {
        const result = await runDistanceBuildLoop({
          invoke: (body) => supabase.functions.invoke('scheduling-route', { body }),
          scope: 'all',
          limit: 25,
          shouldStop: () => !!state.courseSchedulingDistanceStopRequested,
          onProgress: async ({ stats, done, stopped }) => {
            state.courseSchedulingDistanceStats = stats;
            state.courseSchedulingDistanceSummary = formatDistanceBuildProgress(stats, { done, stopped });
            rerender();
          }
        });
        state.courseSchedulingDistanceStats = result.stats;
        state.courseSchedulingDistanceSummary = formatDistanceBuildProgress(result.stats, {
          done: result.done,
          stopped: result.stopped
        });
        state.courseSchedulingDistanceError = (result.stats.failed_count || 0) > 0 && !result.done;
      } catch (error) {
        state.courseSchedulingDistanceError = true;
        state.courseSchedulingDistanceSummary = translateSchedulingRouteError(error.code || error.message, error.message);
      } finally {
        state.courseSchedulingDistanceLoading = false;
        state.courseSchedulingDistanceStopRequested = false;
        rerender();
      }
    });
  }
};
