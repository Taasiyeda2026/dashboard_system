import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { isActivitySchedulingEligible } from './shared/activity-scheduling-eligibility.js';
import { showToast } from './shared/toast.js';
import { formatDateDots, formatTimeRangeShort } from './shared/format-date.js';
import { resolveInstructionLanguage } from './shared/instruction-language.js';
import { hasPermission } from '../permission-policy.js';

const txt = (value) => String(value ?? '').trim();
function datesText(activity) {
  return activityMeetings(activity).map((meeting) => formatDateDots(meeting.date)).filter(Boolean).join(', ') || '—';
}

export function schedulingActivitySummaryHtml(activity) {
  return `<header class="scheduling-workspace__activity"><h3>${escapeHtml(activity.activity_name || 'פעילות')}</h3><p><b>בית ספר:</b> ${escapeHtml(activity.school || '—')} · <b>רשות:</b> ${escapeHtml(activity.authority || '—')}</p><p class="scheduling-workspace__schedule"><span><b>תאריכים:</b> <bdi class="scheduling-workspace__dates" dir="ltr">${escapeHtml(datesText(activity))}</bdi></span><span><b>שעות:</b> <bdi class="scheduling-time-range" dir="ltr">${escapeHtml(formatTimeRangeShort(activity.start_time, activity.end_time))}</bdi></span></p></header>`;
}

function genderSelectValue(activity) {
  const value = txt(activity?.required_instructor_gender);
  return ['any', 'female', 'male'].includes(value) ? value : 'any';
}

function languageSelectValue(activity) {
  return resolveInstructionLanguage(activity);
}

function modalHtml(activity) {
  const gender = genderSelectValue(activity);
  const language = languageSelectValue(activity);
  return `<div class="scheduling-workspace" dir="rtl" data-scheduling-workspace>
    ${schedulingActivitySummaryHtml(activity)}
    <section class="scheduling-workspace__requirements">
      <div class="scheduling-workspace__fields">
        <label>מגדר המדריך
          <select class="ds-input" name="required_instructor_gender">
            <option value="any"${gender === 'any' ? ' selected' : ''}>כולם</option>
            <option value="female"${gender === 'female' ? ' selected' : ''}>מדריכה</option>
            <option value="male"${gender === 'male' ? ' selected' : ''}>מדריך</option>
          </select>
        </label>
        <label>שפת הדרכה
          <select class="ds-input" name="instruction_language">
            <option value="he"${language === 'he' ? ' selected' : ''}>עברית</option>
            <option value="ar"${language === 'ar' ? ' selected' : ''}>ערבית</option>
          </select>
        </label>
      </div>
    </section>
    <p class="scheduling-workspace__status" data-scheduling-status role="alert"></p>
  </div>`;
}

function readRequirements(workspace) {
  return {
    required_instructor_gender: txt(workspace.querySelector('[name="required_instructor_gender"]')?.value) || 'any',
    instruction_language: txt(workspace.querySelector('[name="instruction_language"]')?.value) || 'he'
  };
}

function patchLocalActivity(form, activity, requirements) {
  if (!form) return { ...activity, ...requirements };
  const next = { ...activity, ...requirements };
  form.dataset.exportRow = JSON.stringify(next);
  return next;
}

function patchActivityCaches(state, activitiesRows, activity, requirements) {
  const activityId = txt(activity?.row_id || activity?.RowID);
  if (!activityId || !state?.screenDataCache) return;
  const patch = {
    required_instructor_gender: requirements.required_instructor_gender ?? activity.required_instructor_gender,
    instruction_language: requirements.instruction_language ?? activity.instruction_language
  };
  const detailKey = `activityDetail:${activity.source_sheet || ''}:${activityId}`;
  const detailEntry = state.screenDataCache[detailKey];
  const detailBase = detailEntry?.data && typeof detailEntry.data === 'object'
    ? detailEntry.data
    : activity;
  state.screenDataCache[detailKey] = { data: { ...detailBase, ...patch }, t: Date.now() };
  if (Array.isArray(activitiesRows)) {
    for (const row of activitiesRows) {
      const rowId = txt(row?.row_id || row?.RowID);
      if (rowId === activityId) Object.assign(row, patch);
    }
  }
  const periodsEntry = state.screenDataCache['activities:periods'];
  if (periodsEntry?.data && Array.isArray(periodsEntry.data.rows)) {
    periodsEntry.data.rows = periodsEntry.data.rows.map((row) => {
      const rowId = txt(row?.row_id || row?.RowID);
      return rowId === activityId ? { ...row, ...patch } : row;
    });
    periodsEntry.t = Date.now();
  }
}

export function bindInstructorScheduling(root, { ui, state, activitiesRows, onRequirementsSaved } = {}) {
  const button = root?.querySelector('[data-find-instructor]');
  if (!button || button.dataset.bound) return;
  button.dataset.bound = 'yes';
  if (txt(button.textContent) && txt(button.textContent) !== 'דרישות שיבוץ') {
    button.textContent = 'דרישות שיבוץ';
  }

  button.addEventListener('click', async () => {
    const form = button.closest('[data-drawer-form]');
    let activity = {};
    try { activity = JSON.parse(form?.dataset.exportRow || '{}'); } catch { activity = {}; }

    if (!isActivitySchedulingEligible(activity)) {
      showToast('דרישות שיבוץ זמינות רק לפעילות פתוחה בשנת תשפ״ז', 'error');
      return;
    }
    if (!hasPermission(state?.user, 'view_operations_scheduling')) {
      showToast('אין הרשאה לשמור דרישות שיבוץ', 'error');
      return;
    }

    ui.openModal({
      title: 'דרישות שיבוץ',
      modalClass: 'ds-modal--scheduling',
      keepDrawerOpen: true,
      content: modalHtml(activity),
      actions: '<button type="button" class="ds-btn" data-ui-close-modal>סגירה</button><button type="button" class="ds-btn ds-btn--primary" data-save-scheduling-requirements>שמירת דרישות השיבוץ</button>'
    });

    const workspace = document.querySelector('[data-scheduling-workspace]');
    const saveButton = document.querySelector('[data-save-scheduling-requirements]');
    if (!workspace || !saveButton) return;

    saveButton.addEventListener('click', async () => {
      const status = workspace.querySelector('[data-scheduling-status]');
      const requirements = readRequirements(workspace);
      if (status) status.textContent = '';

      if (!['any', 'female', 'male'].includes(requirements.required_instructor_gender)) {
        if (status) status.textContent = 'ערך מגדר המדריך אינו תקין';
        return;
      }
      if (!['he', 'ar'].includes(requirements.instruction_language)) {
        if (status) status.textContent = 'ערך שפת ההדרכה אינו תקין';
        return;
      }

      const activityId = txt(activity.row_id || activity.RowID);
      if (!activityId) {
        if (status) status.textContent = 'לא נמצא מזהה פעילות לשמירה';
        return;
      }

      saveButton.disabled = true;
      if (status) status.textContent = 'שומר דרישות שיבוץ…';
      try {
        const save = await supabase.rpc('save_activity_scheduling_requirements', {
          p_activity_id: activityId,
          p_instruction_language: requirements.instruction_language,
          p_required_instructor_gender: requirements.required_instructor_gender
        });
        if (save.error) throw new Error(`שמירת דרישות השיבוץ נכשלה: ${save.error.message}`);

        const saved = save.data && typeof save.data === 'object' ? save.data : {};
        const nextRequirements = {
          required_instructor_gender: txt(saved.required_instructor_gender) || requirements.required_instructor_gender,
          instruction_language: txt(saved.instruction_language) || requirements.instruction_language
        };
        activity = patchLocalActivity(form, activity, nextRequirements);
        patchActivityCaches(state, activitiesRows, activity, nextRequirements);
        onRequirementsSaved?.(activity, nextRequirements);
        ui.closeModal();
        showToast('דרישות השיבוץ נשמרו בהצלחה', 'success');
      } catch (error) {
        const message = error?.message || 'שמירת דרישות השיבוץ נכשלה';
        if (status) status.textContent = message;
        showToast(message, 'error');
      } finally {
        saveButton.disabled = false;
      }
    });
  });
}
