import { escapeHtml } from './html.js';
import { visibleActivityCategoryLabel, hebrewFinanceStatus, financeStatusVariant } from './ui-hebrew.js';
import { dsStatusChip } from './layout.js';

/** Detail block for a raw activity row (week/month/my-data style fields). */
export function activityRowDetailHtml(row, { privateNote = null, hideEmpIds = false } = {}) {
  const id1 = String(row.emp_id || '').trim();
  const id2 = String(row.emp_id_2 || '').trim();
  const ids = [id1, id2].filter(Boolean).join(' · ') || '—';
  const names = [row.instructor_name, row.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const instLine = hideEmpIds ? names || '—' : names ? `${ids} (${names})` : ids;
  const noteLine =
    privateNote === null ? '' : `<p><strong>הערה פרטית:</strong> ${escapeHtml(privateNote)}</p>`;
  const finChip = dsStatusChip(
    hebrewFinanceStatus(row.finance_status || 'open'),
    financeStatusVariant(row.finance_status)
  );
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>RowID:</strong> ${escapeHtml(String(row.RowID || ''))}</p>
      <p><strong>סוג פעילות:</strong> ${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</p>
      <p><strong>מנהל פעילויות:</strong> ${escapeHtml(row.activity_manager || '—')}</p>
      <p><strong>תאריכים:</strong> ${escapeHtml(row.start_date || '—')} עד ${escapeHtml(row.end_date || '—')}</p>
      <p><strong>מדריכים:</strong> ${escapeHtml(instLine)}</p>
      <p><strong>סטטוס כספי:</strong> ${finChip}</p>
      ${noteLine}
    </div>`;
}

/**
 * פירוט פעילות + טופס עריכה למשתמשים שאינם מדריכים (הרשאות נאכפות בשרת).
 */
export function activityWorkDrawerHtml(row, { privateNote = null, canEdit = false, hideEmpIds = false } = {}) {
  const base = activityRowDetailHtml(row, { privateNote, hideEmpIds });
  if (!canEdit) return base;
  const src = escapeHtml(String(row.source_sheet || '').trim());
  const rid = escapeHtml(String(row.RowID || '').trim());
  const st = escapeHtml(String(row.status ?? ''));
  const notes = escapeHtml(String(row.notes ?? ''));
  const fin = escapeHtml(String(row.finance_status || 'open'));
  const finNotes = escapeHtml(String(row.finance_notes ?? ''));
  const sd = escapeHtml(String(row.start_date ?? ''));
  const ed = escapeHtml(String(row.end_date ?? ''));
  return `${base}
    <form class="ds-stack ds-activity-editor" data-edit-activity data-source-sheet="${src}" data-row-id="${rid}" style="margin-top:1rem;padding-top:1rem;border-top:1px solid rgba(0,0,0,.08)">
      <h3 class="ds-muted" style="margin:0 0 .5rem">עריכה</h3>
      <label class="ds-field" style="display:block;margin:.35rem 0">סטטוס<br/><input name="status" class="ds-input" type="text" value="${st}" /></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">הערות<br/><textarea name="notes" class="ds-input" rows="2">${notes}</textarea></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">סטטוס כספים (open/closed)<br/><input name="finance_status" class="ds-input" type="text" value="${fin}" /></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">הערות כספים<br/><textarea name="finance_notes" class="ds-input" rows="2">${finNotes}</textarea></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">תאריך התחלה<br/><input name="start_date" class="ds-input" type="text" value="${sd}" /></label>
      <label class="ds-field" style="display:block;margin:.35rem 0">תאריך סיום<br/><input name="end_date" class="ds-input" type="text" value="${ed}" /></label>
      <button type="submit" class="ds-btn ds-btn--primary" style="margin-top:.5rem">שמירה</button>
      <p class="ds-muted ds-activity-edit-status" role="status"></p>
    </form>`;
}
