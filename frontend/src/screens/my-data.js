import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'activity_type') val = hebrewActivityType(val);
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
      ${dsPageHeader('הנתונים שלי', 'הפעילויות המשויכות אליך')}
      ${dsCard({
        title: 'הפעילויות שלי',
        badge: `${rows.length} שורות`,
        body: tableBlock,
        padded: rows.length === 0
      })}
    `);
  }
};
