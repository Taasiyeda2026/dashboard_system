import { escapeHtml } from './html.js';
import { visibleActivityCategoryLabel } from './ui-hebrew.js';

function statusLabel(status) {
  const v = String(status || '').trim().toLowerCase();
  if (v === 'open') return 'פתוח';
  if (v === 'closed') return 'סגור';
  return v ? status : '—';
}

function activityHoursLabel(row) {
  const s = String(row.start_time || '').trim();
  const e = String(row.end_time || '').trim();
  if (s && e) return `${s} - ${e}`;
  return s || e || '—';
}

function meetingScheduleHtml(row) {
  const schedule = Array.isArray(row?.meeting_schedule) ? row.meeting_schedule : [];
  if (!schedule.length) {
    return '<p><strong>כל התאריכים:</strong> —</p>';
  }
  const items = schedule
    .map((item) => {
      const d = escapeHtml(String(item?.date || ''));
      const done = String(item?.performed || '').toLowerCase() === 'yes';
      return `<li>${d} <span class="ds-muted">(${done ? 'בוצע' : 'טרם בוצע'})</span></li>`;
    })
    .join('');
  return `
    <div>
      <p><strong>כל התאריכים:</strong></p>
      <ul class="ds-stack" style="margin:.25rem 0 0;padding-inline-start:1.1rem">${items}</ul>
    </div>`;
}

/** Detail block for a raw activity row (week/month/my-data style fields). */
export function activityRowDetailHtml(row, { privateNote = null, hideEmpIds = false, showFinance = true } = {}) {
  const id1 = String(row.emp_id || '').trim();
  const id2 = String(row.emp_id_2 || '').trim();
  const ids = [id1, id2].filter(Boolean).join(' · ') || '—';
  const names = [row.instructor_name, row.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const instLine = hideEmpIds ? names || '—' : names ? `${ids} (${names})` : ids;
  const operationNoteLine =
    privateNote === null ? '' : `<p><strong>הערות תפעול:</strong> ${escapeHtml(privateNote)}</p>`;
  const financeLine = showFinance ? `<p><strong>סטטוס כספי:</strong> ${escapeHtml(String(row.finance_status || '—'))}</p>` : '';
  const scheduleLine = meetingScheduleHtml(row);
  const done = Number(row.meetings_done || 0);
  const total = Number(row.meetings_total || 0);
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>RowID:</strong> ${escapeHtml(String(row.RowID || ''))}</p>
      <p><strong>סוג פעילות:</strong> ${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</p>
      <p><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</p>
      <p><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</p>
      <p><strong>מנהל פעילויות:</strong> ${escapeHtml(row.activity_manager || '—')}</p>
      <p><strong>שעות:</strong> ${escapeHtml(activityHoursLabel(row))}</p>
      <p><strong>תאריכים:</strong> ${escapeHtml(row.start_date || '—')} עד ${escapeHtml(row.end_date || '—')}</p>
      <p><strong>בוצעו מפגשים:</strong> ${escapeHtml(`${done}/${total}`)}</p>
      ${scheduleLine}
      <p><strong>סטטוס פעילות:</strong> ${escapeHtml(statusLabel(row.status))}</p>
      <p><strong>מדריכים:</strong> ${escapeHtml(instLine)}</p>
      <p><strong>הערות מדריך:</strong> ${escapeHtml(row.notes || '—')}</p>
      ${financeLine}
      ${operationNoteLine}
    </div>`;
}

/**
 * פירוט פעילות + טופס עריכה למשתמשים שאינם מדריכים (הרשאות נאכפות בשרת).
 */
export function activityWorkDrawerHtml(
  row,
  { privateNote = null, canEdit = false, hideEmpIds = false, showFinance = true, statusSelect = false, showFinanceFields = true } = {}
) {
  const base = activityRowDetailHtml(row, { privateNote, hideEmpIds, showFinance });
  if (!canEdit) return base;
  const src = escapeHtml(String(row.source_sheet || '').trim());
  const rid = escapeHtml(String(row.RowID || '').trim());
  const stRaw = String(row.status ?? '').trim().toLowerCase();
  const st = escapeHtml(stRaw === 'closed' ? 'closed' : 'open');
  const notes = escapeHtml(String(row.notes ?? ''));
  const sd = escapeHtml(String(row.start_date ?? ''));
  const ed = escapeHtml(String(row.end_date ?? ''));
  const fin = escapeHtml(String(row.finance_status || 'open'));
  const finNotes = escapeHtml(String(row.finance_notes ?? ''));
  const statusInputHtml = statusSelect
    ? `<select name="status" class="ds-input">
          <option value="open" ${st === 'open' ? 'selected' : ''}>פתוח</option>
          <option value="closed" ${st === 'closed' ? 'selected' : ''}>סגור</option>
        </select>`
    : `<input name="status" class="ds-input" type="text" value="${escapeHtml(String(row.status ?? ''))}" />`;
  const financeEditHtml = showFinanceFields
    ? `<label class="ds-field" style="display:block;margin:.35rem 0">סטטוס כספים (open/closed)<br/><input name="finance_status" class="ds-input" type="text" value="${fin}" /></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">הערות כספים<br/><textarea name="finance_notes" class="ds-input" rows="2">${finNotes}</textarea></label>`
    : '';
  return `${base}
    <form class="ds-stack ds-activity-editor" data-edit-activity data-source-sheet="${src}" data-row-id="${rid}" style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(0,0,0,.08)">
      <h3 class="ds-muted" style="margin:0 0 .5rem">עריכה</h3>
      <label class="ds-field" style="display:block;margin:.35rem 0">סטטוס<br/>${statusInputHtml}</label>
      <label class="ds-field" style="display:block;margin:.35rem 0">הערות<br/><textarea name="notes" class="ds-input" rows="2">${notes}</textarea></label>
      ${financeEditHtml}
      <label class="ds-field" style="display:block;margin:.35rem 0">תאריך התחלה<br/><input name="start_date" class="ds-input" type="text" value="${sd}" /></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">תאריך סיום<br/><input name="end_date" class="ds-input" type="text" value="${ed}" /></label>
      <button type="submit" class="ds-btn ds-btn--primary" style="margin-top:.5rem">שמירה</button>
      <p class="ds-muted ds-activity-edit-status" role="status"></p>
    </form>`;
}
