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
import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';


function displayCellValue(row, column) {
  let val = row?.[column] ?? '';
  if (column === 'activity_type') val = hebrewActivityType(val);
  if (column === 'start_date' || column === 'end_date') val = formatDateHe(String(val || '')) || val;
  if (column === 'start_time' || column === 'end_time' || column === 'StartTime' || column === 'EndTime') val = formatTimeShort(val);
  return val;
}

export const operationsScreen = {
  load: ({ api, state }) => api.operations({
    search: state?.operationsSearch || '',
    activity_type: state?.operationsActivityType || ''
  }),
  render(data, { state } = {}) {
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const columns = hideRowId
      ? ['activity_name', 'start_date', 'end_date', 'activity_type']
      : ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const typeFilters = [...new Set(rows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewActivityType(t)
    }));

    const body = rows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const searchHay = columns
        .map((col) => {
          const val = displayCellValue(row, col);
          return String(val);
        })
        .join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}" data-row-id="${escapeHtml(row.RowID)}" data-source-sheet="${escapeHtml(row.source_sheet || '')}" role="button" tabindex="0">${columns
        .map((col) => {
          const val = displayCellValue(row, col);
          return `<td>${escapeHtml(val)}</td>`;
        })
        .join('')}</tr>
    `;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--ops">
            <thead><tr>${columns.map((col) => `<th data-col="${escapeHtml(col)}">${escapeHtml(hebrewColumn(col))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    return dsScreenStack(`
      ${dsPageHeader('תפעול', `כל הפעילויות במערכת (${rows.length})`)}
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש פעילות…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      ${dsCard({
        title: 'פעילויות',
        padded: rows.length === 0,
        body: tableBlock
      })}
    `);
  },
  bind({ root, data, state, ui, api, rerender, clearScreenDataCache }) {
    if (!root) return;
    bindPageListTools(root);
    root.querySelector('[data-page-q]')?.addEventListener('input', (ev) => {
      state.operationsSearch = ev.target.value || '';
      clearTimeout(root._opsSearchTimer);
      root._opsSearchTimer = setTimeout(() => {
        rerender?.();
      }, 220);
    });
    root.querySelector('[data-page-f]')?.addEventListener('change', (ev) => {
      state.operationsActivityType = ev.target.value || '';
      rerender?.();
    });

    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const rowById = new Map(rows.map((row) => [String(row.RowID), row]));
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const canSeePrivateNotes = ['operation_manager', 'admin'].includes(state?.user?.display_role);
    const canEditActivity   = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const canDirectEdit     = !!state?.user?.can_edit_direct;
    const settings = state?.clientSettings || {};

    const detailCache = new Map();
    const loadingDetailMarkup = '<div class="ds-loading-card" dir="rtl"><p>טוען פירוט פעילות…</p></div>';

    function makeOnOpen(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
      bindActivityEditFormShared(contentRoot, {
        api,
        ui,
        clearScreenDataCache,
        rerender,
        onRowSaved: ({ sourceRowId, changes }) => {
          const cached = detailCache.get(sourceRowId);
          if (cached) Object.assign(cached, changes || {});
          const hit = rowById.get(String(sourceRowId));
          if (hit) Object.assign(hit, changes || {});
        }
      });
    }

    async function openOperationDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      ui.openDrawer({
        title: '',
        content: loadingDetailMarkup
      });

      const cacheKey = String(summaryRow.RowID || '');
      let hit = detailCache.get(cacheKey);
      if (!hit) {
        const rsp = await api.operationsDetail(summaryRow.RowID, summaryRow.source_sheet);
        hit = rsp?.row || summaryRow;
        detailCache.set(cacheKey, hit);
      }

      const privateNote = canSeePrivateNotes ? (hit.private_note ?? '—') : null;

      ui.openDrawer({
        title: '',
        content: activityWorkDrawerHtml(hit, {
          privateNote,
          canEdit: canEditActivity,
          canDirectEdit,
          canRequestEdit: !!state?.user?.can_request_edit,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          settings,
          datesLoading: false
        }),
        onOpen: makeOnOpen,
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });
    }

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rowById.get(String(rowId));
        if (!hit || !ui) return;
        openOperationDetail(hit).catch(() => {});
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
      const rest = action.slice('operations:'.length);
      const colonIdx = rest.indexOf(':');
      const rowId = colonIdx >= 0 ? rest.slice(colonIdx + 1) : rest;
      const hit = rowById.get(String(rowId));
      if (!hit) return;
      openOperationDetail(hit).catch(() => {});
    });
  }
};
