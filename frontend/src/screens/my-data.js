import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityRowDetailHtml } from './shared/activity-detail-html.js';

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const typeFilters = [...new Set(rows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewActivityType(t)
    }));

    const body = rows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const searchHay = columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'activity_type') val = hebrewActivityType(val);
          return String(val);
        })
        .join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${columns
        .map((column) => {
          let val = row?.[column] ?? '';
          if (column === 'activity_type') val = hebrewActivityType(val);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compactCards =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const rawType = String(row.activity_type || '').trim();
              const searchHay = [row.RowID, row.activity_name, row.start_date, row.end_date, hebrewActivityType(row.activity_type)]
                .filter(Boolean)
                .join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `mydata:${row.RowID}`,
                title: `${row.RowID} · ${row.activity_name || 'פעילות'}`,
                subtitle: `${row.start_date || '—'} → ${row.end_date || '—'}`,
                meta: hebrewActivityType(row.activity_type)
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('הנתונים שלי', 'הפעילויות המשויכות אליך')}
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפעילויות שלי…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      ${dsCard({
        title: 'הפעילויות שלי',
        body: narrow ? compactCards : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, state, rerender, clearScreenDataCache }) {
    bindPageListTools(root);
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rows.find((r) => String(r.RowID) === String(rowId));
        if (!hit || !ui) return;
        const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
        ui.openDrawer({
          title: `פירוט ${hit.RowID}`,
          content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds })
        });
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('mydata:')) return;
      const rowId = action.slice('mydata:'.length);
      const hit = rows.find((r) => String(r.RowID) === String(rowId));
      if (!hit) return;
      const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
      ui.openDrawer({
        title: `פירוט ${hit.RowID}`,
        content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds })
      });
    });
  }
};
