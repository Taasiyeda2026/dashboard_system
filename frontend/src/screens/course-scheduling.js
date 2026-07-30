import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { dsEmptyState, dsScreenStack, dsTableWrap } from './shared/layout.js';
import { showToast } from './shared/toast.js';
import { loadInstructorSchedulingData } from './instructor-scheduling-data.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { calculateCourseSchedule, schedulingCourses } from './course-scheduling-engine.js';

const text = (value) => String(value ?? '').trim();
const emp = (candidate) => text(candidate?.instructor?.emp_id);
const group = (rows, key) => rows.reduce((out, row) => { const id = text(row[key]); if (id) (out[id] ||= []).push(row); return out; }, {});
const idOf = (row) => text(row.row_id || row.RowID || row.id);

function compactMeetings(activity) {
  const meetings = activityMeetings(activity); if (!meetings.length) return '—';
  const dates = meetings.map((m) => text(m.date)).sort();
  const weekdays = [...new Set(dates.map((date) => new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${date}T12:00:00`))))];
  return `${meetings.length} מפגשים · ${dates[0]}–${dates.at(-1)} · ${weekdays.join(', ')} · ${text(meetings[0].start_time || activity.start_time)}–${text(meetings[0].end_time || activity.end_time)}`;
}

function optionHtml(candidate, recommended) {
  return `<label class="course-scheduling__option"><input type="radio" name="candidate" value="${escapeHtml(emp(candidate))}"${emp(candidate) === emp(recommended) ? ' checked' : ''}><span><b>${escapeHtml(candidate.instructor.full_name || emp(candidate))}</b> · ציון ${candidate.score}<small>${escapeHtml(candidate.explanation)}</small></span></label>`;
}

function detailsHtml(result) {
  if (result.status === 'חסר מידע') return `<details><summary>מה חסר?</summary><p>${escapeHtml(result.missing.join(' · '))}</p></details>`;
  if (result.status === 'נדרש גיוס') {
    const reasons = result.checked.flatMap((item) => item.failures).reduce((counts, reason) => counts.set(reason, (counts.get(reason) || 0) + 1), new Map());
    return `<details><summary>דרישות וסיבות פסילה</summary><p>שפה: ${escapeHtml(result.course.instruction_language)} · שכבה: ${escapeHtml(result.course.education_level || result.course.grade)} · מגדר: ${escapeHtml(result.course.required_instructor_gender || 'ללא')}</p><ul>${[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>`<li>${escapeHtml(reason)} (${count})</li>`).join('')}</ul><p>${result.checked.length} מדריכים נבדקו</p></details>`;
  }
  return `<details data-course-options><summary>הצג חלופות</summary>${[result.recommended, ...result.alternatives].map((item) => optionHtml(item, result.recommended)).join('')}<details><summary>הצג את כל המדריכים שנבדקו</summary>${result.checked.map((item) => `<p><b>${escapeHtml(item.instructor.full_name || emp(item))}</b>: ${item.eligible ? `ציון ${item.score} · ${escapeHtml(item.explanation)}` : `לא מתאים · ${escapeHtml(item.failures.join(' · '))}`}</p>`).join('')}</details></details>`;
}

function rowsHtml(results) {
  return results.map((result) => { const course = result.course, candidate = result.recommended; return `<tr data-course-result="${escapeHtml(idOf(course))}"><td><b>${escapeHtml(course.activity_name || '—')}</b></td><td>${escapeHtml(course.school || '—')}<small>${escapeHtml(course.authority || '')}</small></td><td><details><summary>${escapeHtml(compactMeetings(course))}</summary>${activityMeetings(course).map((m) => `<div>${escapeHtml(m.date)} · ${escapeHtml(m.start_time || course.start_time)}–${escapeHtml(m.end_time || course.end_time)}</div>`).join('')}</details></td><td>${candidate ? escapeHtml(candidate.instructor.full_name || emp(candidate)) : '—'}</td><td>${candidate ? candidate.score : '—'}</td><td>${candidate ? escapeHtml(candidate.explanation) : detailsHtml(result)}</td><td><span class="ds-status-chip">${escapeHtml(result.status)}</span></td><td>${candidate ? `${detailsHtml(result)}<button class="ds-btn ds-btn--primary ds-btn--sm" data-assign-course>שבץ</button>` : ''}</td></tr>`; }).join('');
}

export const courseSchedulingScreen = {
  async load({ api }) {
    const [activities, contacts, scheduling] = await Promise.all([api.activities({ activity_type: 'all', include_inactive: true }), api.instructorContacts(), loadInstructorSchedulingData()]);
    return { activities: activities?.rows || [], instructors: contacts?.rows || [], scheduling };
  },
  render(data, { state }) {
    if (!['admin', 'operation_manager'].includes(text(state?.user?.role))) return dsScreenStack(dsEmptyState('אין הרשאה לצפייה בשיבוץ קורסים.'));
    const results = state.courseSchedulingResults || [];
    const counts = { ready: results.filter((r) => ['הצעה מוכנה','נדרש טיפול'].includes(r.status)).length, recruit: results.filter((r) => r.status === 'נדרש גיוס').length, missing: results.filter((r) => r.status === 'חסר מידע').length };
    const table = results.length ? dsTableWrap(`<table class="ds-table course-scheduling__table"><thead><tr><th>קורס</th><th>בית ספר</th><th>תאריכים ושעות</th><th>מדריך מוצע</th><th>ציון</th><th>הסבר</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${rowsHtml(results)}</tbody></table>`) : dsEmptyState('לחצו על חישוב כדי לבנות טיוטת שיבוץ כוללת.');
    return dsScreenStack(`<header class="ds-page-header"><div><h1 class="ds-page-header__title">שיבוץ קורסים</h1><p class="ds-page-header__subtitle">קורסים פתוחים של 2027 שעדיין לא שובצו</p></div><button class="ds-btn ds-btn--primary" data-calculate-course-schedule ${state.courseSchedulingLoading ? 'disabled' : ''}>${state.courseSchedulingLoading ? 'מחשב…' : 'חשב הצעות שיבוץ מחדש'}</button></header><section class="course-scheduling__summary"><span>חישוב אחרון: ${escapeHtml(state.courseSchedulingCalculatedAt || 'טרם בוצע')}</span><b>${results.length} קורסים נבדקו</b><b>${counts.ready} עם הצעה</b><b>${counts.recruit} נדרש גיוס</b><b>${counts.missing} חסר מידע</b></section><p data-course-scheduling-error class="scheduling-warning">${escapeHtml(state.courseSchedulingError || '')}</p>${table}`);
  },
  bind({ root, data, state, rerender, clearScreenDataCache }) {
    root.querySelector('[data-calculate-course-schedule]')?.addEventListener('click', async () => {
      if (state.courseSchedulingLoading) return; state.courseSchedulingLoading = true; state.courseSchedulingError = ''; rerender();
      try {
        const scheduling = data.scheduling || {}; const profiles = Object.fromEntries((scheduling.profiles || []).map((row) => [text(row.emp_id), row]));
        state.courseSchedulingResults = calculateCourseSchedule({ activities: data.activities, instructors: data.instructors, profiles, rules: group(scheduling.rules || [], 'emp_id'), exceptions: group(scheduling.exceptions || [], 'emp_id') });
        state.courseSchedulingCalculatedAt = new Intl.DateTimeFormat('he-IL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date());
      } catch (error) { state.courseSchedulingError = `החישוב נכשל: ${error.message}`; } finally { state.courseSchedulingLoading = false; rerender(); }
    });
    root.querySelectorAll('[data-assign-course]').forEach((button) => button.addEventListener('click', async () => {
      const result = (state.courseSchedulingResults || []).find((item) => idOf(item.course) === button.closest('[data-course-result]')?.dataset.courseResult); if (!result) return;
      const selectedId = text(button.closest('tr').querySelector('[name="candidate"]:checked')?.value) || emp(result.recommended);
      const selected = [result.recommended, ...result.alternatives].find((item) => emp(item) === selectedId); if (!selected) return;
      let reason = null; if (selectedId !== emp(result.recommended)) { reason = window.prompt('יש להזין נימוק קצר לבחירת החלופה:')?.trim(); if (!reason) return; }
      if (!window.confirm(`לשבץ את ${selected.instructor.full_name} לקורס ${result.course.activity_name} בבית הספר ${result.course.school}?`)) return;
      button.disabled = true;
      const { error } = await supabase.rpc('assign_activity_instructor', { p_activity_id: idOf(result.course), p_emp_id: Number(selectedId), p_instructor_name: selected.instructor.full_name, p_top_emp_id: Number(emp(result.recommended)), p_selected_score: selected.score, p_top_score: result.recommended.score, p_decision_type: selectedId === emp(result.recommended) ? 'approved' : 'overridden', p_reason: reason });
      if (error) { showToast(`השיבוץ נכשל: ${error.message}`, 'error'); button.disabled = false; return; }
      state.courseSchedulingResults = state.courseSchedulingResults.filter((item) => idOf(item.course) !== idOf(result.course)); clearScreenDataCache?.(); showToast('השיבוץ נשמר וננעל', 'success'); rerender();
    }));
  }
};
