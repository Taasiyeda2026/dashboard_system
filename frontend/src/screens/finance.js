import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewFinanceStatus } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';

function financeDrawerHtml(row) {
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>
      <p><strong>${escapeHtml(hebrewColumn('activity_name'))}:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>${escapeHtml(hebrewColumn('finance_status'))}:</strong> ${escapeHtml(hebrewFinanceStatus(row.finance_status || 'open'))}</p>
      <p><strong>${escapeHtml(hebrewColumn('status'))}:</strong> ${escapeHtml(row.status || '—')}</p>
    </div>`;
}

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'finance_status', 'status'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const body = rows.map(
      (row) => `
      <tr class="ds-data-row" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'finance_status') val = hebrewFinanceStatus(val);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `
    );

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row) =>
              dsInteractiveCard({
                variant: 'session',
                action: `finance:${row.RowID}`,
                title: `${row.RowID} · ${row.activity_name || '—'}`,
                subtitle: hebrewFinanceStatus(row.finance_status || 'open'),
                meta: row.status ? `סטטוס: ${row.status}` : ''
              })
            )
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('כספים', 'מעקב אחר סטטוס כספי בפעילויות')}
      ${dsCard({
        title: 'רשימת כספים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui }) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rows.find((r) => String(r.RowID) === String(rowId));
        if (!hit || !ui) return;
        ui.openDrawer({ title: `כספים · ${hit.RowID}`, content: financeDrawerHtml(hit) });
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('finance:')) return;
      const rowId = action.slice('finance:'.length);
      const hit = rows.find((r) => String(r.RowID) === String(rowId));
      if (!hit) return;
      ui.openDrawer({ title: `כספים · ${hit.RowID}`, content: financeDrawerHtml(hit) });
    });
  }
};
