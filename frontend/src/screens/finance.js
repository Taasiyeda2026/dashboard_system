import { escapeHtml } from './shared/html.js';
import {
  hebrewColumn,
  hebrewFinanceStatus,
  financeStatusVariant,
  translateApiErrorForUser
} from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard,
  dsStatusChip
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

const TABLE_COLUMNS = ['RowID', 'activity_name', 'school', 'funding', 'end_date', 'finance_status', 'status'];

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const finOpts = [...new Set(rows.map((r) => String(r.finance_status || '').trim()).filter(Boolean))].map((st) => ({
      value: st,
      label: hebrewFinanceStatus(st)
    }));

    const body = rows.map((row) => {
      const searchHay = TABLE_COLUMNS.map((c) => String(row?.[c] ?? '')).join(' ');
      const fst = String(row.finance_status || '').trim();
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(
        fst
      )}" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">${TABLE_COLUMNS.map((column) => {
        if (column === 'finance_status') {
          const label = hebrewFinanceStatus(row.finance_status);
          return `<td>${dsStatusChip(label, financeStatusVariant(row.finance_status))}</td>`;
        }
        const val = row?.[column] ?? '';
        return `<td>${escapeHtml(String(val))}</td>`;
      }).join('')}</tr>
    `;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${TABLE_COLUMNS.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const fst = String(row.finance_status || '').trim();
              const searchHay = [row.RowID, row.activity_name, row.school, row.funding, row.end_date, row.finance_status, row.status]
                .filter(Boolean)
                .join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(fst)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `finance:${row.RowID}`,
                title: `${row.RowID} · ${row.activity_name || '—'}`,
                subtitle: hebrewFinanceStatus(row.finance_status || 'open'),
                meta: row.end_date ? `סיום: ${row.end_date}` : ''
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('כספים', 'פעילויות שהסתיימו עד היום — לפי הגדרות המערכת')}
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש ברשימה…', filterLabel: 'סטטוס כספים', filters: finOpts }) : ''}
      ${dsCard({
        title: 'רשימת כספים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, api, state, rerender }) {
    bindPageListTools(root);
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const canEdit = state?.user?.display_role !== 'instructor';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    function bindFinanceEditForm(contentRoot) {
      const form = contentRoot.querySelector('[data-edit-activity]');
      if (!form || !api) return;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const statusEl = form.querySelector('.ds-activity-edit-status');
        const sourceSheet = form.getAttribute('data-source-sheet') || '';
        const sourceRowId = form.getAttribute('data-row-id') || '';
        const fd = new FormData(form);
        const changes = {
          status: String(fd.get('status') ?? '').trim(),
          notes: String(fd.get('notes') ?? '').trim(),
          finance_status: String(fd.get('finance_status') ?? '').trim(),
          finance_notes: String(fd.get('finance_notes') ?? '').trim(),
          start_date: String(fd.get('start_date') ?? '').trim(),
          end_date: String(fd.get('end_date') ?? '').trim()
        };
        try {
          await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
          if (statusEl) statusEl.textContent = 'נשמר';
          ui?.closeAll();
          if (typeof rerender === 'function') await rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
        }
      });
    }

    const openDrawer = (hit) => {
      if (!hit || !ui) return;
      ui.openDrawer({
        title: `כספים · ${hit.RowID}`,
        content: activityWorkDrawerHtml(hit, { privateNote: null, canEdit, hideEmpIds }),
        onOpen: canEdit ? bindFinanceEditForm : undefined
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = rows.find((r) => String(r.RowID) === String(rowId));
        openDrawer(hit);
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
      openDrawer(hit);
    });
  }
};
