import { escapeHtml } from './html.js';
import { visibleActivityCategoryLabel, hebrewFinanceStatus, financeStatusVariant } from './ui-hebrew.js';
import { dsStatusChip } from './layout.js';

/** Detail block for a raw activity row (week/month/my-data style fields). */
export function activityRowDetailHtml(row, { privateNote = null } = {}) {
  const names = [row.instructor_name, row.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const ids = `${row.emp_id || '—'} · ${row.emp_id_2 || '—'}`;
  const instLine = names || ids;
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
      <p><strong>אחראי פעילות:</strong> ${escapeHtml(row.activity_manager || '—')}</p>
      <p><strong>תאריכים:</strong> ${escapeHtml(row.start_date || '—')} עד ${escapeHtml(row.end_date || '—')}</p>
      <p><strong>מדריכים:</strong> ${escapeHtml(instLine)}</p>
      <p><strong>סטטוס כספי:</strong> ${finChip}</p>
      ${noteLine}
    </div>`;
}
