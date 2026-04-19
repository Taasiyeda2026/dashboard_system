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

const TABLE_COLUMNS = ['RowID', 'activity_name', 'emp_id', 'emp_id_2', 'school', 'funding', 'end_date', 'finance_status', 'status'];

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name || '').toLowerCase().includes(lq) ||
      String(r.RowID || '').toLowerCase().includes(lq) ||
      String(r.school || '').toLowerCase().includes(lq) ||
      hebrewFinanceStatus(r.finance_status).toLowerCase().includes(lq)
  );
}

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();
    const searchQ = state?.financeSearch || '';
    const statusFilter = state?.financeStatusFilter || '';

    let rows = applySearch(allRows, searchQ);
    if (statusFilter) {
      rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
    }

    const statuses = [...new Set(allRows.map((r) => String(r.finance_status || '')).filter(Boolean))];
    const statusChips = [{ val: '', label: 'הכל' }, ...statuses.map((s) => ({ val: s, label: hebrewFinanceStatus(s) }))]
      .map(
        (c) =>
          `<button type="button" class="ds-chip ${c.val === statusFilter ? 'is-active' : ''}" data-status-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      )
      .join('');

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
              const searchHay = [
                row.RowID,
                row.activity_name,
                row.emp_id,
                row.emp_id_2,
                row.school,
                row.funding,
                row.end_date,
                row.finance_status,
                row.status
              ]
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
      <div class="ds-screen-top-row">
        <input
          id="finance-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      <div class="ds-filter-bar" role="toolbar">${statusChips}</div>
      ${dsCard({
        title: 'רשימת כספים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, api, state, rerender }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const canEdit = state?.user?.display_role !== 'instructor';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    root.querySelector('#finance-search')?.addEventListener('input', (ev) => {
      state.financeSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('[data-status-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeStatusFilter = btn.dataset.statusFilter || '';
        rerender();
      });
    });

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
        const hit = allRows.find((r) => String(r.RowID) === String(rowId));
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
      const hit = allRows.find((r) => String(r.RowID) === String(rowId));
      openDrawer(hit);
    });
  }
};
