import { isActiveSchedulingInstructor } from './shared/course-scheduling-instructors.js';
import { escapeHtml } from './shared/html.js';

const text = value => String(value ?? '').trim();
const iso = value => text(value).slice(0, 10);
const time = value => text(value).slice(0, 5);
const editorKey = 'courseSchedulingManualOperation';

export function manualOperationError(code) {
  const labels = {
    scheduling_official_schedule_read_only: 'נתוני המפגשים נקבעים בכל הפעילויות בלבד. יש לפתוח את השיבוץ מחדש.',
    scheduling_permission_denied: 'אין הרשאה לשיבוץ ידני.',
    scheduling_manager_instructor_admin_approval_required: 'שיבוץ מנהל/ת מחייב אישור אדמין. שמרו טיוטה והעבירו לאדמין לאישור סופי.',
    scheduling_activity_revision_conflict: 'הפעילות השתנתה. יש לעיין בנתונים העדכניים ולבדוק שוב לפני שמירה.',
    scheduling_manual_preview_changed: 'הנתונים השתנו מאז הבדיקה. יש לבדוק שוב לפני שמירה.',
    scheduling_manual_acknowledgement_required: 'יש לאשר את האזהרות לפני השמירה.',
    scheduling_reason_required: 'יש להזין סיבה לשינוי או לאישור האזהרות.',
    scheduling_conflict_detected: 'למדריך יש פעילות חופפת באחד המועדים.',
    scheduling_full_day_tour_conflict: 'סיור תופס יום עבודה מלא בתאריך זה.',
    scheduling_transition_insufficient: 'אין זמן נסיעה מספיק בין הפעילויות.',
    scheduling_historical_meetings_protected: 'אי אפשר לשנות מועדים או שעות של מפגשים מוגנים. יש לשמור את המפגשים הקודמים כפי שהם.',
    scheduling_new_past_date_forbidden: 'אי אפשר להוסיף מועד חדש בעבר.',
    scheduling_no_future_meetings: 'אין מפגשים מתאריך התחולה שנבחר.',
    scheduling_effective_date_required: 'יש לבחור תאריך תחולה מהיום והלאה.',
    scheduling_activity_hours_missing: 'חסרות שעות תקינות. יש לתקן את הפעילות בכל הפעילויות.',
    scheduling_activity_sessions_invalid: 'יש להשלים בפעילות מספר מפגשים תקין.',
    scheduling_proposed_meeting_count_mismatch: 'מספר המועדים חייב להתאים למספר המפגשים בפעילות.',
    scheduling_existing_official_meeting_count_conflict: 'מספר המועדים הקיימים אינו תואם. יש לתקן את נתוני הפעילות.',
    scheduling_proposed_dates_invalid: 'מועדי הפעילות חסרים או אינם תקינים. יש לתקן אותם בכל הפעילויות.',
    scheduling_school_calendar_blocked: 'אחד המועדים חסום בלוח החופשות.',
    scheduling_saturday_blocked: 'שבת חסומה לפעילות במגזר זה.',
    scheduling_school_sector_missing: 'יש להשלים את שיוך בית הספר למגזר.',
    scheduling_instructor_profile_incomplete: 'חסרים בפרופיל המדריך נתוני שפה או מגדר.',
    scheduling_language_mismatch: 'שפת המדריך אינה תואמת לפעילות.',
    scheduling_gender_mismatch: 'המדריך אינו תואם לדרישת המגדר של הפעילות.',
    scheduling_course_blocked: 'המדריך חסם את התוכנית הזו.',
    scheduling_authority_blocked: 'המדריך חסם את הרשות הזו.',
    scheduling_availability_missing: 'לא הוגדרה זמינות למדריך ביום שנבחר.',
    scheduling_instructor_unavailable: 'המועדים אינם תואמים לזמינות המדריך.',
    scheduling_friday_not_allowed: 'יום שישי אינו מאושר למדריך.',
    instructor_inactive: 'המדריך אינו פעיל.',
    instructor_not_found: 'המדריך לא נמצא.',
    planning_intent_protected: 'יש לפעילות מדריך מיועד שמור אחר. יש לבטל את הבחירה השמורה לפני שינוי.',
    scheduling_tour_operational_hours_required: 'שעות סיור הן 09:00–14:00.',
    scheduling_duplicate_instructor: 'המדריך הנבחר כבר מוגדר כמדריך נוסף בפעילות.',
    scheduling_activity_not_open: 'אפשר לשבץ רק פעילות פתוחה.',
    scheduling_assignment_locked: 'שיבוץ קיים שומרים כשיבוץ סופי, ולא כטיוטה.'
  };
  return labels[code] || 'הפעולה לא הושלמה. יש לרענן את הנתונים ולנסות שוב.';
}

export function manualWarningLabel(warning) {
  const km = Number(warning.km);
  const labels = {
    manual_draft_schedule_changed: 'מועדי הטיוטה שונים מנתוני הפעילות העדכניים. נבדקו הנתונים הרשמיים; המשך השמירה דורש אישור מחודש.',
    manual_intended_instructor_changed: 'קיים מדריך מיועד שמור אחר. השמירה תחליף את הבחירה השמורה ותתעד את השינוי.',
    manual_home_route_unknown: 'אין מסלול בית–בית ספר מאומת. אפשר לאשר ידנית באחריותכם.',
    manual_home_distance: 'מרחק הנסיעה לבית הספר הוא ' + (Number.isFinite(km) ? km.toFixed(1) : '—') + ' ק״מ.',
    manual_transition_unknown: 'אין מסלול מאומת בין הפעילויות' + (warning.date ? ' בתאריך ' + warning.date : '') + '. הפער: ' + (warning.gapMinutes ?? '—') + ' דקות.',
    manual_transition_distance: 'מרחק המעבר בין בתי הספר הוא ' + (Number.isFinite(km) ? km.toFixed(1) : '—') + ' ק״מ' + (warning.date ? ' בתאריך ' + warning.date : '') + '.'
  };
  const business = {
    instructor_inactive: 'המדריך אינו פעיל במערכת.',
    scheduling_instructor_profile_incomplete: 'חסרים בפרופיל המדריך נתוני התאמה.',
    scheduling_language_mismatch: 'שפת ההדרכה של המדריך אינה תואמת לפעילות.',
    scheduling_gender_mismatch: 'המדריך אינו תואם לדרישת המגדר שהוגדרה.',
    scheduling_course_blocked: 'התוכנית חסומה בפרופיל המדריך.',
    scheduling_authority_blocked: 'הרשות חסומה בפרופיל המדריך.',
    scheduling_availability_missing: 'אין זמינות מוגדרת למדריך ביום זה.',
    scheduling_instructor_unavailable: 'המפגש מחוץ לזמינות שהמדריך הגדיר.',
    scheduling_friday_not_allowed: 'יום שישי אינו מאושר בפרופיל המדריך.',
    scheduling_saturday_blocked: 'שבת אינה יום פעילות במגזר שהוגדר.',
    scheduling_conflict_detected: 'יש חפיפה עם פעילות אחרת.',
    scheduling_full_day_tour_conflict: 'יש סיור התופס יום עבודה מלא בתאריך זה.',
    scheduling_transition_insufficient: 'זמן המעבר הידוע אינו מספיק: נדרשות ' + (warning.requiredMinutes ?? '—') + ' דקות והפער הוא ' + (warning.gapMinutes ?? '—') + ' דקות.',
    scheduling_school_calendar_blocked: 'המועד חל ביום חסום בלוח החופשות.',
    scheduling_school_sector_missing: 'חסר שיוך מגזר לבית הספר.',
    scheduling_activity_not_open: 'הפעילות אינה בסטטוס פתוח.',
    scheduling_new_past_date_forbidden: 'זהו מועד חדש בעבר.',
    scheduling_tour_operational_hours_required: 'שעות הסיור שונות מ־09:00–14:00.',
    manual_unstaffed_pending: 'יש מפגש ללא מדריך שאושר בעבר כלא זמין. מפגש שבתחולת השיבוץ ייוחס למדריך הנבחר; ההחלטה הקודמת תישמר בתיעוד.',
    manual_short_school_day: 'המפגש מסתיים אחרי סיום יום הלימודים (' + (warning.schoolEndTime || '—') + ').'
  };
  const label = labels[warning.code] || business[warning.code] || 'נדרשת בדיקה של מגבלת השיבוץ.';
  return label + (warning.date && !labels[warning.code] ? ' תאריך: ' + warning.date + '.' : '')
    + (warning.school ? ' בית ספר: ' + warning.school + '.' : '')
    + (warning.otherActivity ? ' פעילות: ' + warning.otherActivity + '.' : '')
    + (warning.startTime || warning.endTime ? ' שעות: ' + (warning.startTime || '—') + '–' + (warning.endTime || '—') + '.' : '');
}


export function manualActivityIssues(activity) {
  const issues = [];
  const count = Number(activity.sessions);
  if (!/^[0-9]{1,2}$/.test(text(activity.sessions)) || count < 1 || count > 35) issues.push('scheduling_activity_sessions_invalid');
  const dates = Array.from({ length: 35 }, (_, index) => iso(activity['date_' + (index + 1)]));
  if (!dates.some(Boolean) || (count > 0 && count <= 35 && dates.slice(0, count).some(date => !date))) issues.push('scheduling_proposed_dates_invalid');
  if (count > 0 && count <= 35 && dates.filter(Boolean).length !== count) issues.push('scheduling_existing_official_meeting_count_conflict');
  const official = dates.filter(Boolean);
  if (official.some((date, index) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2026-09-01' || date > '2027-08-31' || (index > 0 && date <= official[index - 1]))) issues.push('scheduling_proposed_dates_invalid');
  if (!time(activity.start_time) || !time(activity.end_time) || time(activity.start_time) >= time(activity.end_time)) issues.push('scheduling_activity_hours_missing');
  return [...new Set(issues)];
}

export function createManualOperation(activity, instructors = []) {
  const count = /^[0-9]+$/.test(text(activity.sessions)) && Number(activity.sessions) <= 35 ? Number(activity.sessions) : 0;
  return {
    activity: { ...activity }, instructors, empId: text(activity.draft_emp_id || activity.emp_id),
    dates: Array.from({ length: count }, (_, index) => iso(activity['date_' + (index + 1)])),
    startTime: time(activity.start_time), endTime: time(activity.end_time),
    effectiveFrom: '', action: activity.emp_id || activity.draft_emp_id ? 'confirm' : 'draft', reason: '',
    acknowledged: false, preview: null, revision: 0, busy: '', error: ''
  };
}

export function manualOperationPayload(editor) {
  if (!editor?.activity?.row_id || !editor.activity.updated_at) throw Error('scheduling_activity_revision_conflict');
  const issue = manualActivityIssues(editor.activity)[0];
  if (issue) throw Error(issue);
  if (!/^[0-9]+$/.test(text(editor.empId))) throw Error('instructor_not_found');
  if (!editor.dates.length) throw Error('scheduling_activity_sessions_invalid');
  if (!editor.startTime || !editor.endTime || editor.startTime >= editor.endTime) throw Error('scheduling_activity_hours_missing');
  if (editor.dates.some((date, index) => !/^\d{4}-\d{2}-\d{2}$/.test(date) || (index > 0 && date <= editor.dates[index - 1]))) {
    throw Error('scheduling_proposed_dates_invalid');
  }
  return {
    p_activity_id: editor.activity.row_id, p_emp_id: Number(editor.empId),
    p_meetings: null,
    p_start_time: null, p_end_time: null, p_action: editor.action,
    p_effective_from: editor.effectiveFrom || null, p_expected_updated_at: editor.activity.updated_at
  };
}

export function canCommitManualOperation(editor) {
  return !!editor?.preview?.previewHash && !editor.busy
    && !(editor.preview.blockers || []).length
    && (!(editor.preview.warnings || []).length || editor.acknowledged)
    && (!editor.preview.reasonRequired || !!text(editor.reason));
}

export function createManualOperationsController({ state, rpc, onChange = () => {}, onSaved = () => {}, onEditActivity = () => {}, reloadActivity = null }) {
  return {
    refresh() { onChange(); },
    editActivity() { const editor = state[editorKey]; if (editor && !editor.busy) { this.close(); onEditActivity(editor.activity.row_id); } },
    back() { const editor = state[editorKey]; if (editor && !editor.busy) { editor.preview = null; editor.acknowledged = false; onChange(); } },
    open(activity, instructors, initial = {}) {
      const editor = createManualOperation(activity, instructors);
      for (const field of ['empId','action','effectiveFrom']) {
        if (initial[field] != null) editor[field] = initial[field];
      }
      state[editorKey] = editor;
      onChange();
    },
    close() {
      if (state[editorKey]?.busy) return;
      state[editorKey] = null;
      onChange();
    },
    edit(field, value, index = null) {
      const editor = state[editorKey];
      if (!editor || editor.busy) return false;
      if (['empId', 'effectiveFrom', 'action'].includes(field)) editor[field] = value;
      else if (field === 'reason' || field === 'acknowledged') {
        editor[field] = value;
        return true;
      } else return false;
      editor.revision++;
      editor.reason = '';
      editor.preview = null;
      editor.acknowledged = false;
      editor.error = '';
      return true;
    },
    async preview(retryRevision = true) {
      const editor = state[editorKey];
      if (!editor || editor.busy) return;
      const revision = editor.revision;
      let stale = false;
      try {
        const args = manualOperationPayload(editor);
        editor.busy = 'checking'; editor.error = ''; editor.preview = null; editor.acknowledged = false;
        onChange();
        const { data, error } = await rpc('get_scheduling_manual_assignment_preview', args);
        if (state[editorKey] !== editor || editor.revision !== revision) return;
        if (error) throw error;
        if (!data?.previewHash || !Array.isArray(data.blockers) || !Array.isArray(data.warnings)) throw Error('invalid_manual_preview');
        editor.preview = data;
      } catch (error) {
        if (state[editorKey] === editor && editor.revision === revision) {
          editor.error = manualOperationError(error.message);
          stale = error.message === 'scheduling_activity_revision_conflict';
        }
      } finally {
        if (state[editorKey] === editor) { editor.busy = ''; onChange(); }
      }
      if (stale && reloadActivity && retryRevision && state[editorKey] === editor) {
        await this.recheck('scheduling_activity_revision_conflict');
      }
    },
    async recheck(code) {
      const editor = state[editorKey];
      if (!editor || editor.busy) return;
      editor.preview = null; editor.acknowledged = false; editor.reason = '';
      if (code === 'scheduling_activity_revision_conflict') {
        if (!reloadActivity) return;
        editor.busy = 'checking'; onChange();
        try {
          const activity = await reloadActivity(editor.activity.row_id);
          if (state[editorKey] !== editor) return;
          if (!activity?.updated_at || text(activity.row_id) !== text(editor.activity.row_id)) throw Error('invalid_activity');
          const current = createManualOperation(activity, editor.instructors);
          for (const field of ['activity', 'dates', 'startTime', 'endTime']) editor[field] = current[field];
          editor.revision++;
        } catch {
          editor.error = 'טעינת נתוני הפעילות העדכניים נכשלה. יש לרענן לפני שמירה.';
          return;
        } finally { editor.busy = ''; onChange(); }
      }
      await this.preview(false);
      // A fresh result always needs an explicit click; old consent is never reused.
      if (state[editorKey] === editor) {
        editor.error = manualOperationError(code); onChange();
      }
    },
    async submit() {
      const editor = state[editorKey];
      if (!editor || editor.busy) return;
      const revision = editor.revision;
      if (!editor.preview) await this.preview();
      if (editor.revision !== revision) return;
      if (state[editorKey] === editor && canCommitManualOperation(editor)) return this.commit();
    },
    async commit() {
      const editor = state[editorKey];
      if (!canCommitManualOperation(editor)) return;
      let row, staleCode;
      try {
        const args = {
          ...manualOperationPayload(editor), p_preview_hash: editor.preview.previewHash,
          p_acknowledge_warnings: editor.acknowledged === true, p_reason: text(editor.reason) || null
        };
        editor.busy = 'saving'; editor.error = ''; onChange();
        const { data, error } = await rpc('commit_scheduling_manual_assignment', args);
        if (error) throw error;
        const saved = Array.isArray(data) ? data[0] : data;
        if (text(saved?.row_id) !== text(editor.activity.row_id) || !saved?.updated_at) throw Error('invalid_saved_activity');
        row = saved;
      } catch (error) {
        staleCode = ['scheduling_manual_preview_changed', 'scheduling_activity_revision_conflict'].includes(error.message) ? error.message : null;
        editor.error = manualOperationError(error.message);
        editor.preview = null; editor.acknowledged = false;
      } finally {
        editor.busy = '';
        if (!row) onChange();
      }
      if (staleCode && state[editorKey] === editor) {
        await this.recheck(staleCode);
      }
      if (row) {
        state[editorKey] = null;
        // The server has committed. A UI refresh failure must never offer a duplicate save.
        try { onSaved(row); }
        catch { state.courseSchedulingError = 'השמירה הצליחה. יש לרענן כדי להציג את העדכון.'; }
        finally { onChange(); }
      }
      return row;
    }
  };
}

export function manualOperationsDialogHtml(state) {
  const editor = state?.[editorKey];
  if (!editor) return '';
  const activity = editor.activity, preview = editor.preview;
  const activityIssues = manualActivityIssues(activity);
  const officialDates = Array.from({ length: 35 }, (_, index) => iso(activity['date_' + (index + 1)])).filter(Boolean);
  const saving = editor.busy === 'saving';
  const reviewing = !!preview?.warnings?.length && !(preview.blockers || []).length;
  const disabled = editor.busy ? ' disabled' : '';
  const changingInstructor = !!activity.emp_id && text(activity.emp_id) !== text(editor.empId);
  const options = editor.instructors.map(instructor => {
    // The approval rule is explained separately, never appended to a person's name.
    return '<option value="' + escapeHtml(instructor.emp_id) + '"' + (text(instructor.emp_id) === editor.empId ? ' selected' : '') + '>' + escapeHtml(instructor.full_name) + (instructor.isManagementEmployee ? ' · מנהל/ת' : '') + (!isActiveSchedulingInstructor(instructor) ? ' · לא פעיל/ה' : '') + '</option>';
  }).join('');
  return `<div class="course-scheduling-overlay" data-manual-operations-overlay>
    <section class="course-scheduling-modal course-scheduling-manual-dialog" role="${reviewing ? 'alertdialog' : 'dialog'}" aria-modal="true" aria-labelledby="manual-operations-title" dir="rtl" style="text-align:right;max-height:90dvh;overflow:auto;width:min(720px,calc(100vw - 24px))">
      <h2 id="manual-operations-title">${reviewing ? 'התראה: קיימות מגבלות בשיבוץ' : 'שיבוץ מדריך'}</h2>
      <p>${escapeHtml(activity.activity_name)} · ${escapeHtml(activity.school)} · ${escapeHtml(activity.authority)}</p>
      <p>שיבוץ מנהל/ת יאושר סופית בידי אדמין בלבד.</p>
      <dl style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0">
        <div><dt>יום הפעילות</dt><dd>${escapeHtml([...new Set(officialDates.filter(date => Number.isFinite(Date.parse(date))).map(date => new Date(date + 'T12:00:00Z').toLocaleDateString('he-IL', { weekday: 'long', timeZone: 'UTC' })))].join(' · ') || 'חסרים מועדים')}</dd></div>
        <div><dt>שעות</dt><dd><bdi dir="ltr">${escapeHtml(editor.startTime || 'חסר')}–${escapeHtml(editor.endTime || 'חסר')}</bdi></dd></div>
        <div><dt>תחילת הפעילות</dt><dd>${escapeHtml(iso(activity.start_date) || 'חסר')}</dd></div>
        <div><dt>מספר מפגשים</dt><dd>${escapeHtml(activity.sessions || 'חסר')}</dd></div>
      </dl>
      <details><summary>פירוט מועדי המפגשים</summary><ol>${officialDates.map(date => `<li>${escapeHtml(date || 'חסר מועד')}${activity.cancelled_meeting_dates?.includes(date) ? ' · בוטל' : ''} · <bdi dir="ltr">${escapeHtml(editor.startTime)}–${escapeHtml(editor.endTime)}</bdi></li>`).join('') || '<li>לא הוגדרו מועדים</li>'}</ol></details>
      ${activityIssues.length ? '<ul role="alert">' + activityIssues.map(code => '<li>' + escapeHtml(manualOperationError(code)) + '</li>').join('') + '</ul>' : ''}
      <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-manual-operation-activities>לתיקון נתוני הפעילות בכל הפעילויות</button>
      <div data-manual-operation-fields${reviewing ? ' hidden' : ''}>
      <label>חיפוש מדריך<input class="course-scheduling-input" type="search" data-manual-instructor-search placeholder="חיפוש לפי שם"${disabled}></label>
      <label>מדריך<select class="course-scheduling-input" data-manual-operation-field="empId"${disabled}><option value="">בחרו מדריך</option>${options}</select></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-block:12px">
        <label>שמירה<select class="course-scheduling-input" data-manual-operation-field="action"${disabled}>
          ${activity.emp_id ? '' : '<option value="draft"' + (editor.action === 'draft' ? ' selected' : '') + '>טיוטה</option>'}
          <option value="confirm"${editor.action === 'confirm' ? ' selected' : ''}>שיבוץ סופי</option>
        </select></label>
      </div>
      ${changingInstructor ? `<label>תחולת החלפת מדריך<input class="course-scheduling-input" type="date" value="${escapeHtml(editor.effectiveFrom)}" data-manual-operation-field="effectiveFrom"${disabled}><small>מפגשים קודמים יישארו משויכים למדריך הקודם.</small></label>` : ''}
      </div>
      ${reviewing ? '<p>קראו את כל החריגות. אפשר להמשיך בהתאם להחלטה העסקית או לאישור שקיבלתם מראש; ההחלטה תתועד.</p>' : ''}
      ${preview?.reasonRequired ? `<label>סיבה להחלטה / אישור שניתן מראש<textarea class="course-scheduling-input" data-manual-operation-field="reason"${disabled}>${escapeHtml(editor.reason)}</textarea></label>` : ''}
      <p role="alert" data-manual-operation-error>${escapeHtml(editor.error)}</p>
      <div data-manual-operation-preview${preview ? '' : ' hidden'}>
        ${preview ? `
          <p>מדריך קודם: ${escapeHtml(preview.previousInstructorName || 'ללא שיבוץ')} ← מדריך נבחר: ${escapeHtml(preview.instructorName)}</p>
          ${preview.managementInstructor ? '<p><b>מדריך/ה בתפקיד ניהולי:</b> אישור סופי מותר לאדמין בלבד. בחירה של מנהל/ת אינה משנה את תפקיד העובד.</p>' : ''}
          ${preview.blockers.length ? '<ul role="alert">' + preview.blockers.map(code => '<li>' + escapeHtml(manualOperationError(code)) + '</li>').join('') + '</ul>' : preview.warnings.length ? '' : '<p>הבדיקה הושלמה. השמירה תבדוק שוב את הנתונים העדכניים.</p>'}
          ${preview.warnings.length ? '<ul>' + preview.warnings.map(warning => '<li>' + escapeHtml(manualWarningLabel(warning)) + '</li>').join('') + '</ul><label><input type="checkbox" data-manual-operation-field="acknowledged"' + (editor.acknowledged ? ' checked' : '') + disabled + '> בדקתי את האזהרות ואני מאשר/ת לשמור את הבחירה.</label>' : ''}
          ${preview.reasonRequired ? '<p>יש להזין סיבה לפני השמירה.</p>' : ''}
        ` : ''}
      </div>
      <div class="course-scheduling-detail-actions course-scheduling-manual-dialog__actions">
        <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" ${reviewing ? 'data-manual-operation-back' : 'data-manual-operation-close'}${disabled}>חזרה</button>
        <button type="button" class="course-scheduling-btn course-scheduling-btn--primary" data-manual-operation-save${editor.busy || activityIssues.length || (preview && !canCommitManualOperation(editor)) ? ' disabled' : ''}>${saving ? 'שומר…' : editor.busy ? 'בודק…' : reviewing ? 'מאשר/ת את החריגות ושומר/ת' : editor.action === 'draft' ? 'בדיקה ושמירת טיוטה' : 'בדיקה ושמירת שיבוץ'}</button>
      </div>
    </section>
  </div>`;
}

export function bindManualOperationsEditor(root, state, controller) {
  const host = root.querySelector('[data-manual-operations-overlay]');
  if (!host) return;
  const sync = () => {
    const editor = state[editorKey];
    if (!editor) return;
    const preview = host.querySelector('[data-manual-operation-preview]');
    if (preview && !editor.preview) preview.hidden = true;
    host.querySelector('[data-manual-operation-field="reason"]')?.closest('label')?.toggleAttribute('hidden', !editor.preview?.reasonRequired);
    const save = host.querySelector('[data-manual-operation-save]');
    if (save) save.disabled = !!editor.busy || !!manualActivityIssues(editor.activity).length || (!!editor.preview && !canCommitManualOperation(editor));
    const error = host.querySelector('[data-manual-operation-error]');
    if (error) error.textContent = editor.error;
  };
  host.querySelectorAll('[data-manual-operation-field]').forEach(input => input.addEventListener(
    input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
      controller.edit(input.dataset.manualOperationField, input.type === 'checkbox' ? input.checked : input.value);
      sync();
      if (input.dataset.manualOperationField === 'action') controller.refresh();
      // The replacement date control depends on the selected instructor.
      if (input.dataset.manualOperationField === 'empId') {
        const editor = state[editorKey];
        const changing = !!editor.activity.emp_id && text(editor.activity.emp_id) !== text(editor.empId);
        const effective = host.querySelector('[data-manual-operation-field="effectiveFrom"]');
        if (changing && !effective) {
          // Preserve typed values before asking the screen to render the additional control.
          controller.refresh();
        }
      }
    }));
  host.querySelector('[data-manual-instructor-search]')?.addEventListener('input', event => {
    const query = event.target.value.trim();
    host.querySelectorAll('select[data-manual-operation-field="empId"] option').forEach(option => {
      option.hidden = !!option.value && !option.textContent.includes(query);
    });
  });
  host.querySelector('[data-manual-operation-activities]')?.addEventListener('click', () => {
    controller.editActivity();
  });
  host.querySelector('[data-manual-operation-back]')?.addEventListener('click', () => controller.back());
  host.querySelector('[data-manual-operation-close]')?.addEventListener('click', () => controller.close());
  host.querySelector('[data-manual-operation-save]')?.addEventListener('click', () => { void controller.submit(); });
  host.querySelector('[data-manual-instructor-search]')?.focus();
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); controller.close(); }
    if (event.key === 'Tab') {
      const fields = [...host.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')]
        .filter(field => !field.closest('[hidden]') && field.getClientRects().length);
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
}
