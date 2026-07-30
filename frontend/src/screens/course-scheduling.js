import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { loadInstructorSchedulingData } from './instructor-scheduling-data.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { calculateCourseSchedule, preliminaryCourseCandidates } from './course-scheduling-engine.js';
import { calculateCandidateTravel } from './course-scheduling-travel.js';

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((output, row) => {
  const id = text(row[key]);
  if (id) (output[id] ||= []).push(row);
  return output;
}, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);
const STATUS_FILTERS = ['', 'הצעה מוכנה', 'נדרש טיפול', 'נדרש גיוס', 'חסר מידע'];
export const PENDING_ACTIVITY_STORAGE_KEY = 'dashboard:pending-course-activity-id';

function compactMeetings(activity) {
  const meetings = activityMeetings(activity);
  if (!meetings.length) return '—';
  const dates = meetings.map((meeting) => text(meeting.date)).sort();
  const weekdays = [...new Set(dates.map((date) => new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))))];
  return `${meetings.length} מפגשים · ${dates[0]}–${dates.at(-1)} · ${weekdays.join(', ')} · ${text(meetings[0].start_time || activity.start_time)}–${text(meetings[0].end_time || activity.end_time)}`;
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

function rowActions(result) {
  if (result.recommended) {
    return `${detailsHtml(result)}<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button class="ds-btn ds-btn--primary ds-btn--sm" data-assign-course>שבץ</button><button class="ds-btn ds-btn--sm" data-reject-course-suggestion>דחה הצעה</button></div>`;
  }
  if (result.status === 'חסר מידע') return `<button class="ds-btn ds-btn--sm" data-open-missing-course>השלמת מידע</button>`;
  return detailsHtml(result);
}

function rowsHtml(results) {
  return results.map((result) => {
    const course = result.course;
    const candidate = result.recommended;
    return `<tr data-course-result="${escapeHtml(idOf(course))}"><td><b>${escapeHtml(course.activity_name || '—')}</b></td><td>${escapeHtml(course.school || '—')}<small>${escapeHtml(course.authority || '')}</small></td><td><details><summary>${escapeHtml(compactMeetings(course))}</summary>${activityMeetings(course).map((meeting) => `<div>${escapeHtml(meeting.date)} · ${escapeHtml(meeting.start_time || course.start_time)}–${escapeHtml(meeting.end_time || course.end_time)}</div>`).join('')}</details></td><td>${candidate ? escapeHtml(candidate.instructor.full_name || emp(candidate)) : '—'}</td><td>${candidate ? candidate.score : '—'}</td><td>${candidate ? escapeHtml(candidate.explanation) : detailsHtml(result)}</td><td><span class="ds-status-chip">${escapeHtml(result.status)}</span></td><td>${rowActions(result)}</td></tr>`;
  }).join('');
}

function statusFiltersHtml(activeFilter, counts) {
  const labels = {
    '': `הכול`,
    'הצעה מוכנה': `הצעה מוכנה (${counts.ready})`,
    'נדרש טיפול': `נדרש טיפול (${counts.treatment})`,
    'נדרש גיוס': `נדרש גיוס (${counts.recruit})`,
    'חסר מידע': `חסר מידע (${counts.missing})`
  };
  return `<div style="display:flex;gap:7px;flex-wrap:wrap" aria-label="סינון לפי סטטוס">${STATUS_FILTERS.map((status) => `<button type="button" class="ds-btn ds-btn--sm${status === activeFilter ? ' ds-btn--primary' : ''}" data-course-status-filter="${escapeHtml(status)}" aria-pressed="${status === activeFilter ? 'true' : 'false'}">${escapeHtml(labels[status])}</button>`).join('')}</div>`;
}

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling] = await Promise.all([
      api.activities({ activity_period: 'school_2027', activity_type: 'all', include_inactive: true }),
      api.instructorContacts(),
      loadInstructorSchedulingData()
    ]);
    return { activities: activities?.rows || [], instructors: contacts?.rows || [], scheduling };
  },

  render(data, { state }) {
    if (!['admin', 'operation_manager'].includes(text(state?.user?.role))) return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בשיבוץ קורסים.'));
    state.courseSchedulingStatusFilter = STATUS_FILTERS.includes(state.courseSchedulingStatusFilter) ? state.courseSchedulingStatusFilter : '';
    const results = state.courseSchedulingResults || [];
    const counts = courseSchedulingCounts(results);
    const visibleResults = state.courseSchedulingStatusFilter
      ? results.filter((result) => result.status === state.courseSchedulingStatusFilter)
      : results;
    const table = visibleResults.length
      ? dsTableWrap(`<table class="ds-table course-scheduling__table"><thead><tr><th>קורס</th><th>בית ספר</th><th>תאריכים ושעות</th><th>מדריך מוצע</th><th>ציון</th><th>הסבר</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${rowsHtml(visibleResults)}</tbody></table>`)
      : results.length ? dsEmptyState('אין קורסים התואמים לסינון שנבחר.') : dsEmptyState('לחצו על חישוב כדי לבנות טיוטת שיבוץ כוללת.');
    return dsScreenStack(`<header class="ds-page-header"><div><h1 class="ds-page-header__title">שיבוץ קורסים</h1><p class="ds-page-header__subtitle">קורסים פתוחים של 2027 שעדיין לא שובצו</p></div><button class="ds-btn ds-btn--primary" data-calculate-course-schedule ${state.courseSchedulingLoading ? 'disabled' : ''}>${state.courseSchedulingLoading ? 'מחשב…' : 'חשב הצעות שיבוץ מחדש'}</button></header><section class="course-scheduling__summary"><span>חישוב אחרון: ${escapeHtml(state.courseSchedulingCalculatedAt || 'טרם בוצע')}</span><b>${results.length} קורסים נבדקו</b><b>${counts.ready} הצעה מוכנה</b><b>${counts.treatment} נדרש טיפול</b><b>${counts.recruit} נדרש גיוס</b><b>${counts.missing} חסר מידע</b></section>${statusFiltersHtml(state.courseSchedulingStatusFilter, counts)}<p data-course-scheduling-error class="scheduling-warning">${escapeHtml(state.courseSchedulingError || '')}</p>${table}`);
  },

  bind({ root, data, state, rerender, clearScreenDataCache }) {
    root.querySelectorAll('[data-course-status-filter]').forEach((button) => button.addEventListener('click', () => {
      state.courseSchedulingStatusFilter = button.dataset.courseStatusFilter || '';
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
        if (routed.unavailableReason === 'google_key_not_configured') state.courseSchedulingError = 'מפתח Google Maps אינו מוגדר. מרחקים שלא דורשים אימות מעבר סומנו כלא מחושבים; מעבר בין בתי ספר לא יאושר ללא אימות.';
        else if (routed.unavailableReason) state.courseSchedulingError = 'לא ניתן היה לחשב חלק מהמסלולים. מעברים בין בתי ספר שלא אומתו נפסלו באופן בטוח.';
        state.courseSchedulingCalculatedAt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
      } catch (error) {
        state.courseSchedulingError = `החישוב נכשל: ${error.message}`;
      } finally {
        state.courseSchedulingLoading = false;
        rerender();
      }
    });

    root.querySelectorAll('[data-assign-course]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-course-result]');
      const result = (state.courseSchedulingResults || []).find((item) => idOf(item.course) === row?.dataset.courseResult);
      if (!result) return;
      const selectedId = text(row.querySelector(`[name="candidate-${CSS.escape(idOf(result.course))}"]:checked`)?.value) || emp(result.recommended);
      const selected = [result.recommended, ...result.alternatives].find((item) => emp(item) === selectedId);
      if (!selected) return;
      let reason = null;
      if (selectedId !== emp(result.recommended)) {
        reason = window.prompt('יש להזין נימוק קצר לבחירת החלופה:')?.trim();
        if (!reason) return;
      }
      if (!window.confirm(`לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name} בבית הספר ${result.course.school}?`)) return;
      button.disabled = true;
      const { error } = await supabase.rpc('assign_activity_instructor', {
        p_activity_id: idOf(result.course),
        p_emp_id: Number(selectedId),
        p_instructor_name: selected.instructor.full_name,
        p_top_emp_id: Number(emp(result.recommended)),
        p_selected_score: selected.score,
        p_top_score: result.recommended.score,
        p_decision_type: selectedId === emp(result.recommended) ? 'approved' : 'overridden',
        p_reason: reason
      });
      if (error) {
        showToast(`השיבוץ נכשל: ${error.message}`, 'error');
        button.disabled = false;
        return;
      }
      state.courseSchedulingResults = state.courseSchedulingResults.filter((item) => idOf(item.course) !== idOf(result.course));
      clearScreenDataCache?.();
      showToast('השיבוץ נשמר וננעל', 'success');
      rerender();
    }));

    root.querySelectorAll('[data-reject-course-suggestion]').forEach((button) => button.addEventListener('click', async () => {
      const row = button.closest('[data-course-result]');
      const result = (state.courseSchedulingResults || []).find((item) => idOf(item.course) === row?.dataset.courseResult);
      if (!result?.recommended) return;
      const reason = window.prompt('יש להזין סיבה לדחיית הצעת השיבוץ:')?.trim();
      if (!reason) return;
      button.disabled = true;
      const { error } = await supabase.rpc('reject_activity_instructor_suggestion', {
        p_activity_id: idOf(result.course),
        p_top_emp_id: Number(emp(result.recommended)),
        p_top_score: result.recommended.score,
        p_reason: reason
      });
      if (error) {
        showToast(`דחיית ההצעה נכשלה: ${error.message}`, 'error');
        button.disabled = false;
        return;
      }
      result.status = 'נדרש טיפול';
      result.treatmentReason = `הצעת השיבוץ נדחתה: ${reason}`;
      result.recommended = null;
      result.alternatives = [];
      result.incompleteProfiles = [];
      clearScreenDataCache?.();
      showToast('ההצעה נדחתה והסיבה נשמרה', 'success');
      rerender();
    }));

    root.querySelectorAll('[data-open-missing-course]').forEach((button) => button.addEventListener('click', () => {
      const result = (state.courseSchedulingResults || []).find((item) => idOf(item.course) === button.closest('[data-course-result]')?.dataset.courseResult);
      if (!result) return;
      try { sessionStorage.setItem(PENDING_ACTIVITY_STORAGE_KEY, idOf(result.course)); } catch { /* storage may be unavailable */ }
      state.activityPeriodTab = 'school_2027';
      state.activitiesInnerTab = 'year_all';
      state.activitiesMonthYm = '';
      state.allActivitiesStatusFilter = 'all';
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'activities' } }));
    }));
  }
};
