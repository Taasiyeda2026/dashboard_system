import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewContactKind } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data) {
    const columns = ['kind', 'emp_id', 'full_name', 'authority', 'school', 'contact_name', 'phone', 'mobile', 'email'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'kind') val = hebrewContactKind(val);
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
      ${dsPageHeader('אנשי קשר', 'גורמים ורשתות')}
      ${dsCard({
        title: 'רשימת אנשי קשר',
        badge: `${rows.length} שורות`,
        body: tableBlock,
        padded: rows.length === 0
      })}
    `);
  }
};
