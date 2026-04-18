import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewFinanceStatus } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'finance_status', 'status'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'finance_status') val = hebrewFinanceStatus(val);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `);

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      ${dsPageHeader('כספים', 'מעקב אחר סטטוס כספי בפעילויות')}
      ${dsCard({
        title: 'רשימת כספים',
        badge: `${rows.length} שורות`,
        body: tableBlock,
        padded: rows.length === 0
      })}
    `);
  }
};
