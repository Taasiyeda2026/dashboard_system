import { escapeHtml } from './shared/html.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState, dsFilterBar } from './shared/layout.js';

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const rows = safeRows.map(
      (row) => `
      <tr><td>${escapeHtml(row.RowID)}</td><td>${escapeHtml(hebrewExceptionType(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>`
    );

    const summaryChips = `
      <span class="ds-chip ds-chip--warn">חסר מדריך: ${counts.missing_instructor}</span>
      <span class="ds-chip ds-chip--warn">חסר תאריך התחלה: ${counts.missing_start_date}</span>
      <span class="ds-chip ds-chip--danger">תאריך סיום מאוחר: ${counts.late_end_date}</span>
    `;

    const tableBlock =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr><th>${hebrewColumn('RowID')}</th><th>${hebrewColumn('exception_type')}</th><th>${hebrewColumn('activity_name')}</th><th>${hebrewColumn('end_date')}</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      ${dsPageHeader('חריגות', 'נתונים הדורשים טיפול')}
      ${dsFilterBar(summaryChips)}
      ${dsCard({
        title: 'רשימת חריגות',
        badge: `${safeRows.length} שורות`,
        body: tableBlock,
        padded: safeRows.length === 0
      })}
    `);
  }
};
