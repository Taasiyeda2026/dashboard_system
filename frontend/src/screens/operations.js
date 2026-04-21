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

export const operationsScreen = {
  load: ({ api }) => api.operations(),
  render(data, { state } = {}) {
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const columns = hideRowId
      ? ['activity_name', 'start_date', 'end_date', 'activity_type']
      : ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const typeFilters = [...new Set(rows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewActivityType(t)
    }));

    const body = rows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const searchHay = columns
        .map((col) => {
          let val = row?.[col] ?? '';
          if (col === 'activity_type') val = hebrewActivityType(val);
          return String(val);
        })
        .join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${columns
        .map((col) => {
          let val = row?.[col] ?? '';
          if (col === 'activity_type') val = hebrewActivityType(val);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${columns.map((col) => `<th>${escapeHtml(hebrewColumn(col))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compactCards =
      rows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const rawType = String(row.activity_type || '').trim();
              const searchHay = [row.RowID, row.activity_name, row.start_date, row.end_date, hebrewActivityType(row.activity_type)]
                .filter(Boolean)
                .join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `operations:${row.RowID}`,
                title: hideRowId ? `${row.activity_name || 'פעילות'}` : `${row.RowID} · ${row.activity_name || 'פעילות'}`,
                subtitle: `${row.start_date || '—'} → ${row.end_date || '—'}`,
                meta: hebrewActivityType(row.activity_type)
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('תפעול', `כל הפעילויות במערכת (${rows.length})`)}
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש פעילות…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      ${dsCard({
        title: 'פעילויות',
        padded: rows.length === 0 || narrow,
        body: narrow ? compactCards : tableBlock
      })}
    `);
  },
  bind({ root, data, state, ui }) {
    if (!root) return;
    bindPageListTools(root);

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const rowById = new Map(rows.map((row) => [String(row.RowID), row]));

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rowById.get(String(rowId));
        if (!hit || !ui) return;
        const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
        const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
        const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
        ui.openDrawer({
          title: hideRowId ? 'פירוט פעילות' : `פירוט ${hit.RowID}`,
          content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds, hideRowId, hideActivityNo })
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
      if (!action.startsWith('operations:')) return;
      const rowId = action.slice('operations:'.length);
      const hit = rowById.get(String(rowId));
      if (!hit) return;
      const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
      const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
      const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
      ui.openDrawer({
        title: hideRowId ? 'פירוט פעילות' : `פירוט ${hit.RowID}`,
        content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds, hideRowId, hideActivityNo })
      });
    });
  }
};
