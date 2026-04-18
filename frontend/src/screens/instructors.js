import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';

function cellDisplay(column, value) {
  if (column === 'active') {
    const v = String(value || '').toLowerCase();
    if (v === 'yes') return 'כן';
    if (v === 'no') return 'לא';
  }
  if (column === 'employment_type') return hebrewEmploymentType(value);
  return value ?? '';
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data) {
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'employment_type', 'direct_manager', 'active'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map(
      (row) => `
      <tr>${columns.map((column) => `<td>${escapeHtml(cellDisplay(column, row?.[column]))}</td>`).join('')}</tr>`
    );

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      ${dsPageHeader('מדריכים', 'פרטי העסקה וקשר')}
      ${dsCard({
        title: 'רשימת מדריכים',
        badge: `${rows.length} שורות`,
        body: tableBlock,
        padded: rows.length === 0
      })}
    `);
  }
};
