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
  dsStatusChip,
  dsKpiGrid
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';

const TABLE_COLUMNS = ['RowID', 'activity_name', 'activity_manager', 'school', 'funding', 'end_date', 'finance_status'];

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name || '').toLowerCase().includes(lq) ||
      String(r.RowID || '').toLowerCase().includes(lq) ||
      String(r.school || '').toLowerCase().includes(lq) ||
      String(r.activity_manager || '').toLowerCase().includes(lq) ||
      hebrewFinanceStatus(r.finance_status).toLowerCase().includes(lq)
  );
}

function buildManagerBreakdown(rows) {
  const map = {};
  rows.forEach((r) => {
    const mgr = String(r.activity_manager || '').trim() || '—';
    if (!map[mgr]) map[mgr] = { total: 0, open: 0, closed: 0, other: 0, amountOpen: 0, amountClosed: 0, amountOther: 0, amountTotal: 0 };
    map[mgr].total += 1;
    const price = parseFloat(r.price) || 0;
    const sessions = parseFloat(r.sessions) || 0;
    const amount = sessions > 0 ? price * sessions : price;
    map[mgr].amountTotal += amount;
    const st = String(r.finance_status || '').toLowerCase();
    if (st === 'open') { map[mgr].open += 1; map[mgr].amountOpen += amount; }
    else if (st === 'closed') { map[mgr].closed += 1; map[mgr].amountClosed += amount; }
    else { map[mgr].other += 1; map[mgr].amountOther += amount; }
  });
  return Object.entries(map)
    .map(([mgr, counts]) => ({ mgr, ...counts }))
    .sort((a, b) => b.total - a.total);
}

function formatILS(amount) {
  if (!amount && amount !== 0) return '—';
  return '₪' + Number(amount).toLocaleString('he-IL', { maximumFractionDigits: 0 });
}

function exportToCsv(rows) {
  const cols = ['RowID', 'activity_name', 'activity_manager', 'school', 'funding', 'start_date', 'end_date', 'finance_status', 'finance_notes', 'status'];
  const headers = cols.map((c) => hebrewColumn(c));
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const vals = cols.map((c) => {
      let v = String(row[c] ?? '');
      if (c === 'finance_status') v = hebrewFinanceStatus(v);
      v = v.replace(/"/g, '""');
      return `"${v}"`;
    });
    lines.push(vals.join(','));
  });
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'כספים.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

const LS_DATE_FROM = 'finance_date_from';
const LS_DATE_TO = 'finance_date_to';

function loadDatesFromStorage(state) {
  if (!state.financeDateFrom) {
    const storedFrom = localStorage.getItem(LS_DATE_FROM);
    if (storedFrom) state.financeDateFrom = storedFrom;
  }
  if (!state.financeDateTo) {
    const storedTo = localStorage.getItem(LS_DATE_TO);
    if (storedTo) state.financeDateTo = storedTo;
  }
}

function saveDatesToStorage(dateFrom, dateTo) {
  if (dateFrom) {
    localStorage.setItem(LS_DATE_FROM, dateFrom);
  } else {
    localStorage.removeItem(LS_DATE_FROM);
  }
  if (dateTo) {
    localStorage.setItem(LS_DATE_TO, dateTo);
  } else {
    localStorage.removeItem(LS_DATE_TO);
  }
}

export const financeScreen = {
  load: ({ api, state }) => {
    loadDatesFromStorage(state);
    return api.finance({
      date_from: state?.financeDateFrom || '',
      date_to: state?.financeDateTo || ''
    });
  },
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();
    const searchQ = state?.financeSearch || '';
    const statusFilter = state?.financeStatusFilter || '';
    const dateFrom = state?.financeDateFrom || '';
    const dateTo = state?.financeDateTo || '';

    let rows = applySearch(allRows, searchQ);
    if (statusFilter) {
      rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
    }

    const agg = data?.aggregates;
    const totalOpen = agg ? agg.totalOpen : allRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const totalClosed = agg ? agg.totalClosed : allRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const totalOther = agg ? agg.totalOther : allRows.length - totalOpen - totalClosed;

    const amountOpen = agg?.amountOpen ?? null;
    const amountClosed = agg?.amountClosed ?? null;
    const amountTotal = agg?.amountTotal ?? null;

    const kpis = [
      { label: 'סה"כ פעילויות', value: String(agg ? agg.total : allRows.length) },
      { label: 'פתוח (מספר)', value: String(totalOpen) },
      { label: 'פתוח (סכום)', value: amountOpen !== null ? formatILS(amountOpen) : '—' },
      { label: 'סגור (מספר)', value: String(totalClosed) },
      { label: 'סגור (סכום)', value: amountClosed !== null ? formatILS(amountClosed) : '—' },
      { label: 'סה"כ סכום', value: amountTotal !== null ? formatILS(amountTotal) : '—' },
      ...(totalOther > 0 ? [{ label: 'אחר', value: String(totalOther) }] : [])
    ];

    const statuses = [...new Set(allRows.map((r) => String(r.finance_status || '')).filter(Boolean))];
    const statusChips = [{ val: '', label: 'הכל' }, ...statuses.map((s) => ({ val: s, label: hebrewFinanceStatus(s) }))]
      .map(
        (c) =>
          `<button type="button" class="ds-chip ${c.val === statusFilter ? 'is-active' : ''}" data-status-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      )
      .join('');

    const managerBreakdown = (agg?.byManager) ? agg.byManager : buildManagerBreakdown(allRows);
    const managerTableRows = managerBreakdown.map((m) => `
      <tr>
        <td>${escapeHtml(m.mgr)}</td>
        <td style="text-align:center;">${m.total}</td>
        <td style="text-align:center;">${dsStatusChip(String(m.open), 'warning')}</td>
        <td style="text-align:center;">${formatILS(m.amountOpen)}</td>
        <td style="text-align:center;">${dsStatusChip(String(m.closed), 'success')}</td>
        <td style="text-align:center;">${formatILS(m.amountClosed)}</td>
        <td style="text-align:center;">${formatILS(m.amountTotal)}</td>
        ${totalOther > 0 ? `<td style="text-align:center;">${m.other > 0 ? m.other : '—'}</td>` : ''}
      </tr>`).join('');

    const managerTable = managerBreakdown.length === 0 ? '' : dsCard({
      title: 'פירוט לפי מנהל פעילות',
      badge: `${managerBreakdown.length} מנהלים`,
      body: dsTableWrap(`<table class="ds-table">
        <thead><tr>
          <th>מנהל פעילות</th>
          <th style="text-align:center;">סה"כ</th>
          <th style="text-align:center;">פתוח</th>
          <th style="text-align:center;">סכום פתוח</th>
          <th style="text-align:center;">סגור</th>
          <th style="text-align:center;">סכום סגור</th>
          <th style="text-align:center;">סה"כ סכום</th>
          ${totalOther > 0 ? '<th style="text-align:center;">אחר</th>' : ''}
        </tr></thead>
        <tbody>${managerTableRows}</tbody>
      </table>`),
      padded: false
    });

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
              const searchHay = TABLE_COLUMNS.map((c) => String(row?.[c] ?? '')).join(' ');
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

    const exportBtn = `<button type="button" class="ds-btn ds-btn--sm" data-export-csv>ייצוא CSV</button>`;

    return dsScreenStack(`
      ${dsPageHeader('כספים', 'פעילויות שהסתיימו עד היום — לפי הגדרות המערכת')}
      ${dsKpiGrid(kpis)}
      ${managerTable}
      <div class="ds-screen-top-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input
          id="finance-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
          style="flex:1;min-width:160px;"
        />
        ${exportBtn}
      </div>
      <div class="ds-filter-bar" role="toolbar" style="flex-wrap:wrap;gap:8px;">
        ${statusChips}
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;">
          <label for="finance-date-from" style="font-size:0.85rem;white-space:nowrap;">מתאריך</label>
          <input
            id="finance-date-from"
            type="date"
            class="ds-input"
            value="${escapeHtml(dateFrom)}"
            style="font-size:0.85rem;padding:4px 6px;"
          />
        </span>
        <span style="display:flex;align-items:center;gap:4px;">
          <label for="finance-date-to" style="font-size:0.85rem;white-space:nowrap;">עד תאריך</label>
          <input
            id="finance-date-to"
            type="date"
            class="ds-input"
            value="${escapeHtml(dateTo)}"
            style="font-size:0.85rem;padding:4px 6px;"
          />
        </span>
        ${(dateFrom || dateTo) ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-clear-dates style="white-space:nowrap;">נקה תאריכים</button>` : ''}
      </div>
      ${dsCard({
        title: 'רשימת כספים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, api, state, rerender, clearScreenDataCache = () => {} }) {
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

    root.querySelector('#finance-date-from')?.addEventListener('change', (ev) => {
      state.financeDateFrom = ev.target.value || '';
      saveDatesToStorage(state.financeDateFrom, state.financeDateTo);
      clearScreenDataCache();
      rerender();
    });

    root.querySelector('#finance-date-to')?.addEventListener('change', (ev) => {
      state.financeDateTo = ev.target.value || '';
      saveDatesToStorage(state.financeDateFrom, state.financeDateTo);
      clearScreenDataCache();
      rerender();
    });

    root.querySelector('[data-clear-dates]')?.addEventListener('click', () => {
      state.financeDateFrom = '';
      state.financeDateTo = '';
      saveDatesToStorage('', '');
      clearScreenDataCache();
      rerender();
    });

    root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
      const searchQ = state?.financeSearch || '';
      const statusFilter = state?.financeStatusFilter || '';
      let rows = applySearch(allRows, searchQ);
      if (statusFilter) rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
      exportToCsv(rows);
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
          clearScreenDataCache?.();
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
