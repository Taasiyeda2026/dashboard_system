import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityRowDetailHtml } from './shared/activity-detail-html.js';


function displayCellValue(row, column) {
  let val = row?.[column] ?? '';
  if (column === 'activity_type') val = hebrewActivityType(val);
  if (column === 'start_date' || column === 'end_date') val = formatDateHe(String(val || '')) || val;
  if (column === 'start_time' || column === 'end_time' || column === 'StartTime' || column === 'EndTime') val = formatTimeShort(val);
  if (column === 'peer_instructor') val = row?.peer_instructor || 'אין מדריך נוסף';
  return val;
}

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data, { state } = {}) {
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const userEmpId = String(state?.user?.emp_id || state?.user?.employee_id || '').trim();
    const rowsAll = Array.isArray(data?.rows) ? data.rows : [];
    const rows = rowsAll.filter((row) => {
      const e1 = String(row?.emp_id || '').trim();
      const e2 = String(row?.emp_id_2 || '').trim();
      if (!userEmpId) return true;
      return e1 === userEmpId || e2 === userEmpId;
    });
    const columns = hideRowId
      ? ['activity_name', 'activity_type', 'start_date', 'end_date', 'peer_instructor']
      : ['RowID', 'activity_name', 'activity_type', 'start_date', 'end_date', 'peer_instructor'];
    const preparedRows = rows.map((row) => {
      const isPrimary = userEmpId && String(row?.emp_id || '').trim() === userEmpId;
      const peer = isPrimary ? String(row?.instructor_name_2 || '').trim() : String(row?.instructor_name || '').trim();
      return { ...row, peer_instructor: peer || 'אין מדריך נוסף' };
    });
    const typeFilters = [...new Set(preparedRows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewActivityType(t)
    }));

    const body = preparedRows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const searchHay = columns
        .map((column) => {
          const val = displayCellValue(row, column);
          return String(val);
        })
        .join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${columns
        .map((column) => {
          const val = displayCellValue(row, column);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `;
    });

    const tableBlock =
      preparedRows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--ops">
            <thead><tr>${columns.map((column) => `<th data-col="${escapeHtml(column)}">${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      ${dsPageHeader('הנתונים שלי', 'הפעילויות המשויכות אליך')}
      ${preparedRows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפעילויות שלי…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      ${dsCard({
        title: 'הפעילויות שלי',
        body: tableBlock,
        padded: preparedRows.length === 0
      })}
    `);
  },
  bind({ root, data, ui, state, rerender, clearScreenDataCache }) {
    bindPageListTools(root);
    const userEmpId = String(state?.user?.emp_id || state?.user?.employee_id || '').trim();
    const rows = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => {
      if (!userEmpId) return true;
      const e1 = String(row?.emp_id || '').trim();
      const e2 = String(row?.emp_id_2 || '').trim();
      return e1 === userEmpId || e2 === userEmpId;
    });
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
          content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds, hideRowId, hideActivityNo, hideFunding: true, hideNotes: true })
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
      const hit = rowById.get(String(rowId));
      if (!hit) return;
      const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
      const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
      const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
      ui.openDrawer({
        title: hideRowId ? 'פירוט פעילות' : `פירוט ${hit.RowID}`,
        content: activityRowDetailHtml(hit, { privateNote: null, hideEmpIds, hideRowId, hideActivityNo, hideFunding: true, hideNotes: true })
      });
    });
  }
};
