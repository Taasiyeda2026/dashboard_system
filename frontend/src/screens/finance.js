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

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

const TABLE_COLUMNS = ['activity_name', 'activity_manager', 'school', 'funding', 'end_date', 'finance_status'];

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name || '').toLowerCase().includes(lq) ||
      String(r.RowID || '').toLowerCase().includes(lq) ||
      String(r.school || '').toLowerCase().includes(lq) ||
      String(r.activity_manager || '').toLowerCase().includes(lq) ||
      String(r.funding || '').toLowerCase().includes(lq) ||
      hebrewFinanceStatus(r.finance_status).toLowerCase().includes(lq)
  );
}

function applyMonthFilter(rows, ymStr) {
  if (!ymStr) return rows;
  return rows.filter((r) => {
    const d = String(r.end_date || '');
    return d.startsWith(ymStr);
  });
}

function applyTabFilter(rows, tab) {
  if (!tab || tab === 'active') {
    return rows.filter((r) => {
      const arch = String(r.is_archived || r.archive || '').toLowerCase();
      return arch !== 'yes' && arch !== 'true' && arch !== '1';
    });
  }
  if (tab === 'archive') {
    return rows.filter((r) => {
      const arch = String(r.is_archived || r.archive || '').toLowerCase();
      return arch === 'yes' || arch === 'true' || arch === '1';
    });
  }
  return rows;
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

function formatDateIL(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}/${m}/${y}`;
}

function ymToMonthLabel(ymStr) {
  if (!ymStr || !/^\d{4}-\d{2}$/.test(ymStr)) return '';
  const [y, m] = ymStr.split('-');
  return `${HE_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonth(ymStr) {
  if (!ymStr) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ymStr) {
  if (!ymStr) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [y, m] = ymStr.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function exportToCsv(rows, label) {
  const cols = ['RowID', 'activity_name', 'activity_manager', 'school', 'funding', 'price', 'sessions', 'amount', 'start_date', 'end_date', 'finance_status', 'finance_notes', 'status'];
  const headers = cols.map((c) => hebrewColumn(c));
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const vals = cols.map((c) => {
      let v;
      if (c === 'amount') {
        const price = parseFloat(row.price) || 0;
        const sessions = parseFloat(row.sessions) || 0;
        v = String(sessions > 0 ? price * sessions : price);
      } else {
        v = String(row[c] ?? '');
        if (c === 'finance_status') v = hebrewFinanceStatus(v);
      }
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
  a.download = `כספים${label ? '-' + label : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

const LS_DATE_FROM = 'finance_date_from';
const LS_DATE_TO = 'finance_date_to';
const LS_SEARCH = 'finance_search';
const LS_STATUS_FILTER = 'finance_status_filter';
const LS_MONTH_YM = 'finance_month_ym';
const LS_TAB = 'finance_tab';

function loadStateFromStorage(state) {
  if (!state.financeDateFrom) {
    const v = localStorage.getItem(LS_DATE_FROM);
    if (v) state.financeDateFrom = v;
  }
  if (!state.financeDateTo) {
    const v = localStorage.getItem(LS_DATE_TO);
    if (v) state.financeDateTo = v;
  }
  if (!state.financeSearch) {
    const v = localStorage.getItem(LS_SEARCH);
    if (v) state.financeSearch = v;
  }
  if (!state.financeStatusFilter) {
    const v = localStorage.getItem(LS_STATUS_FILTER);
    if (v) state.financeStatusFilter = v;
  }
  if (!state.financeMonthYm) {
    const v = localStorage.getItem(LS_MONTH_YM);
    if (v) state.financeMonthYm = v;
  }
  if (!state.financeTab) {
    const v = localStorage.getItem(LS_TAB);
    if (v) state.financeTab = v;
  }
}

function saveDatesToStorage(from, to) {
  from ? localStorage.setItem(LS_DATE_FROM, from) : localStorage.removeItem(LS_DATE_FROM);
  to ? localStorage.setItem(LS_DATE_TO, to) : localStorage.removeItem(LS_DATE_TO);
}

function saveToStorage(key, val) {
  val ? localStorage.setItem(key, val) : localStorage.removeItem(key);
}

function buildGroupedTable(rows, statusFilter) {
  const todayStr = new Date().toISOString().slice(0, 10);

  function rowHtml(row) {
    const fst = String(row.finance_status || '').trim();
    if (statusFilter && fst !== statusFilter) return '';
    const price = parseFloat(row.price) || 0;
    const sessions = parseFloat(row.sessions) || 0;
    const amount = sessions > 0 ? price * sessions : price;
    return `<tr class="ds-data-row" data-row-id="${escapeHtml(row.RowID)}" role="button" tabindex="0">
      <td>${escapeHtml(row.activity_name || '—')}</td>
      <td>${escapeHtml(row.activity_manager || '—')}</td>
      <td>${escapeHtml(row.school || '—')}</td>
      <td>${formatDateIL(row.end_date)}</td>
      <td>${formatILS(price)}</td>
      <td style="text-align:center;">${sessions > 0 ? sessions : '—'}</td>
      <td>${formatILS(amount)}</td>
      <td>${dsStatusChip(hebrewFinanceStatus(row.finance_status), financeStatusVariant(row.finance_status))}</td>
    </tr>`;
  }

  const groups = {};
  rows.forEach((r) => {
    const funding = String(r.funding || '').trim() || 'לא מוגדר';
    if (!groups[funding]) groups[funding] = [];
    groups[funding].push(r);
  });

  const sortedFundings = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'he'));

  const tbody = sortedFundings.map((funding) => {
    const gRows = groups[funding];
    const visibleRows = statusFilter ? gRows.filter((r) => String(r.finance_status || '') === statusFilter) : gRows;
    if (visibleRows.length === 0) return '';

    const gOpen = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const gClosed = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const gTotal = gRows.reduce((s, r) => {
      const price = parseFloat(r.price) || 0;
      const sessions = parseFloat(r.sessions) || 0;
      return s + (sessions > 0 ? price * sessions : price);
    }, 0);

    const statusMini = [
      gOpen > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--open">${gOpen} פתוח</span>` : '',
      gClosed > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--closed">${gClosed} סגור</span>` : ''
    ].filter(Boolean).join('');

    const groupHeader = `<tr class="ds-finance-group-header">
      <td colspan="8">
        <span class="ds-finance-group-title">${escapeHtml(funding)}</span>
        <span class="ds-finance-group-meta">${visibleRows.length} פעילויות · ${formatILS(gTotal)}</span>
        <span class="ds-finance-group-chips">${statusMini}</span>
      </td>
    </tr>`;

    const dataRows = visibleRows.map(rowHtml).join('');
    return groupHeader + dataRows;
  }).join('');

  if (!tbody.trim()) return dsEmptyState('לא נמצאו רשומות');

  return dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--grouped">
    <thead><tr>
      <th>${hebrewColumn('activity_name')}</th>
      <th>${hebrewColumn('activity_manager')}</th>
      <th>${hebrewColumn('school')}</th>
      <th>${hebrewColumn('end_date')}</th>
      <th>${hebrewColumn('price')}</th>
      <th>${hebrewColumn('sessions')}</th>
      <th>${hebrewColumn('amount')}</th>
      <th>${hebrewColumn('finance_status')}</th>
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`);
}

function buildMeetingsPanel(row) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  for (let i = 1; i <= 35; i++) {
    const key = `Date${i}`;
    const val = String(row[key] || '').trim();
    if (val) dates.push({ num: i, val });
  }
  if (dates.length === 0) return '';

  const chips = dates.map(({ num, val }) => {
    let kind = '';
    let isoVal = val;
    const parts = val.split('/');
    if (parts.length === 3) {
      isoVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    const isPast = isoVal < today;
    kind = isPast ? 'past' : 'future';
    return `<span class="ds-date-chip ds-date-chip--${kind}" title="פגישה ${num}">${escapeHtml(val)}</span>`;
  }).join('');

  const past = dates.filter(({ val }) => {
    const parts = val.split('/');
    const isoVal = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : val;
    return isoVal < today;
  }).length;
  const future = dates.length - past;

  return `<details class="ds-meetings-panel" open>
    <summary class="ds-meetings-panel__summary">
      תאריכי פגישות
      <span class="ds-meetings-panel__counts">
        ${past > 0 ? `<span class="ds-date-count ds-date-count--past">${past} עברו</span>` : ''}
        ${future > 0 ? `<span class="ds-date-count ds-date-count--future">${future} עתידיות</span>` : ''}
      </span>
    </summary>
    <div class="ds-meetings-panel__body">${chips}</div>
  </details>`;
}

export const financeScreen = {
  load: ({ api, state }) => {
    loadStateFromStorage(state);
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
    const activeTab = state?.financeTab || 'active';
    const monthYm = state?.financeMonthYm || '';

    const hasArchived = allRows.some((r) => {
      const arch = String(r.is_archived || r.archive || '').toLowerCase();
      return arch === 'yes' || arch === 'true' || arch === '1';
    });

    let rows = hasArchived ? applyTabFilter(allRows, activeTab) : allRows;
    rows = applyMonthFilter(rows, monthYm);
    rows = applySearch(rows, searchQ);
    if (statusFilter) {
      rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
    }

    const agg = data?.aggregates;
    const visibleOpen = rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const visibleClosed = rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const totalOpen = agg ? agg.totalOpen : allRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const totalClosed = agg ? agg.totalClosed : allRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const totalOther = agg ? agg.totalOther : allRows.length - totalOpen - totalClosed;

    const amountOpen = rows.reduce((s, r) => {
      const price = parseFloat(r.price) || 0;
      const sessions = parseFloat(r.sessions) || 0;
      const amt = sessions > 0 ? price * sessions : price;
      return String(r.finance_status || '').toLowerCase() === 'open' ? s + amt : s;
    }, 0);
    const amountClosed = rows.reduce((s, r) => {
      const price = parseFloat(r.price) || 0;
      const sessions = parseFloat(r.sessions) || 0;
      const amt = sessions > 0 ? price * sessions : price;
      return String(r.finance_status || '').toLowerCase() === 'closed' ? s + amt : s;
    }, 0);
    const amountTotal = rows.reduce((s, r) => {
      const price = parseFloat(r.price) || 0;
      const sessions = parseFloat(r.sessions) || 0;
      return s + (sessions > 0 ? price * sessions : price);
    }, 0);

    const kpis = [
      { label: 'סה"כ פעילויות', value: String(rows.length) },
      { label: 'פתוח', value: String(visibleOpen), hint: formatILS(amountOpen) },
      { label: 'סגור', value: String(visibleClosed), hint: formatILS(amountClosed) },
      { label: 'סה"כ סכום', value: formatILS(amountTotal) }
    ];

    const statuses = [...new Set(rows.map((r) => String(r.finance_status || '')).filter(Boolean))];
    const statusChips = [{ val: '', label: 'הכל' }, ...statuses.map((s) => ({ val: s, label: hebrewFinanceStatus(s) }))]
      .map(
        (c) =>
          `<button type="button" class="ds-chip ${c.val === statusFilter ? 'is-active' : ''}" data-status-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      )
      .join('');

    const mgrSortCol = state?.managerBreakdownSortCol || 'total';
    const mgrSortDir = state?.managerBreakdownSortDir || 'desc';

    const rawManagerBreakdown = (agg?.byManager) ? agg.byManager : buildManagerBreakdown(rows);
    const managerBreakdown = [...rawManagerBreakdown].sort((a, b) => {
      let av = a[mgrSortCol];
      let bv = b[mgrSortCol];
      if (mgrSortCol === 'mgr') {
        av = String(av || '');
        bv = String(bv || '');
        return mgrSortDir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he');
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      return mgrSortDir === 'asc' ? av - bv : bv - av;
    });

    function mgrTh(label, col, centerAlign) {
      const isActive = mgrSortCol === col;
      const indicator = isActive ? (mgrSortDir === 'asc' ? ' ▲' : ' ▼') : '';
      const style = `cursor:pointer;user-select:none;white-space:nowrap;${centerAlign ? 'text-align:center;' : ''}${isActive ? 'text-decoration:underline dotted;' : ''}`;
      return `<th data-mgr-sort-col="${escapeHtml(col)}" style="${style}" title="מיין לפי ${escapeHtml(label)}">${escapeHtml(label)}${indicator}</th>`;
    }

    const managerTableRows = managerBreakdown.map((m) => `
      <tr>
        <td>${escapeHtml(m.mgr)}</td>
        <td style="text-align:center;">${m.total}</td>
        <td style="text-align:center;">${dsStatusChip(String(m.open), 'warning')}</td>
        <td style="text-align:center;">${formatILS(m.amountOpen)}</td>
        <td style="text-align:center;">${dsStatusChip(String(m.closed), 'success')}</td>
        <td style="text-align:center;">${formatILS(m.amountClosed)}</td>
        <td style="text-align:center;">${formatILS(m.amountTotal)}</td>
      </tr>`).join('');

    const managerTable = managerBreakdown.length === 0 ? '' : dsCard({
      title: 'פירוט לפי מנהל פעילות',
      badge: `${managerBreakdown.length} מנהלים`,
      body: dsTableWrap(`<table class="ds-table">
        <thead><tr>
          ${mgrTh('מנהל פעילות', 'mgr', false)}
          ${mgrTh('סה"כ', 'total', true)}
          ${mgrTh('פתוח', 'open', true)}
          ${mgrTh('סכום פתוח', 'amountOpen', true)}
          ${mgrTh('סגור', 'closed', true)}
          ${mgrTh('סכום סגור', 'amountClosed', true)}
          ${mgrTh('סה"כ סכום', 'amountTotal', true)}
        </tr></thead>
        <tbody>${managerTableRows}</tbody>
      </table>`),
      padded: false
    });

    const groupedTable = buildGroupedTable(rows, '');

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const fst = String(row.finance_status || '').trim();
              return `<div data-list-item data-filter="${escapeHtml(fst)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `finance:${row.RowID}`,
                title: `${row.activity_name || '—'}`,
                subtitle: `${hebrewFinanceStatus(row.finance_status || 'open')} · ${row.school || ''}`,
                meta: row.end_date ? `סיום: ${formatDateIL(row.end_date)}` : ''
              })}
            </div>`;
            })
            .join('')}</div>`;

    const exportBtn = `<button type="button" class="ds-btn ds-btn--sm" data-export-csv>ייצוא CSV</button>`;

    let headerSubtitle;
    if (monthYm) {
      headerSubtitle = `מציג: ${ymToMonthLabel(monthYm)}`;
    } else if (dateFrom && dateTo) {
      headerSubtitle = `מציג: ${formatDateIL(dateFrom)} – ${formatDateIL(dateTo)}`;
    } else if (dateFrom) {
      headerSubtitle = `מציג: מתאריך ${formatDateIL(dateFrom)}`;
    } else if (dateTo) {
      headerSubtitle = `מציג: עד ${formatDateIL(dateTo)}`;
    } else {
      headerSubtitle = 'פעילויות לפי תאריך סיום — לפי הגדרות המערכת';
    }

    const tabsHtml = hasArchived ? `<div class="ds-finance-tabs" dir="rtl">
      <button type="button" class="ds-finance-tab ${activeTab === 'active' ? 'is-active' : ''}" data-finance-tab="active">פעילות</button>
      <button type="button" class="ds-finance-tab ${activeTab === 'archive' ? 'is-active' : ''}" data-finance-tab="archive">ארכיון</button>
      <button type="button" class="ds-finance-tab ${activeTab === 'all' ? 'is-active' : ''}" data-finance-tab="all">הכל</button>
    </div>` : '';

    const monthNavHtml = `<div class="ds-month-nav" dir="rtl">
      <button type="button" class="ds-month-nav__btn" data-month-prev title="חודש קודם">◀</button>
      <span class="ds-month-nav__label" data-month-label>${monthYm ? ymToMonthLabel(monthYm) : 'כל התקופה'}</span>
      <button type="button" class="ds-month-nav__btn" data-month-next title="חודש הבא">▶</button>
      ${monthYm ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-month-clear>כל התקופה</button>` : ''}
    </div>`;

    return dsScreenStack(`
      ${dsPageHeader('כספים', headerSubtitle)}
      ${tabsHtml}
      ${monthNavHtml}
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
      <div data-finance-data-area>
        ${dsCard({
          title: 'רשימת כספים',
          body: narrow ? compact : groupedTable,
          padded: rows.length === 0 || narrow
        })}
      </div>
    `);
  },
  bind({ root, data, ui, api, state, rerender, clearScreenDataCache = () => {} }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const canEdit = state?.user?.display_role !== 'instructor';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    function showDataAreaLoading() {
      const area = root.querySelector('[data-finance-data-area]');
      if (area) {
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status" aria-live="polite"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתונים...</p></div>';
      }
      root.querySelectorAll('.ds-kpi__value').forEach((el) => {
        el.style.opacity = '0.35';
      });
    }

    root.querySelectorAll('[data-finance-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeTab = btn.dataset.financeTab || 'active';
        saveToStorage(LS_TAB, state.financeTab);
        rerender();
      });
    });

    root.querySelector('[data-month-prev]')?.addEventListener('click', () => {
      state.financeMonthYm = prevMonth(state.financeMonthYm || '');
      saveToStorage(LS_MONTH_YM, state.financeMonthYm);
      rerender();
    });

    root.querySelector('[data-month-next]')?.addEventListener('click', () => {
      state.financeMonthYm = nextMonth(state.financeMonthYm || '');
      saveToStorage(LS_MONTH_YM, state.financeMonthYm);
      rerender();
    });

    root.querySelector('[data-month-clear]')?.addEventListener('click', () => {
      state.financeMonthYm = '';
      saveToStorage(LS_MONTH_YM, '');
      rerender();
    });

    root.querySelector('#finance-search')?.addEventListener('input', (ev) => {
      state.financeSearch = ev.target.value || '';
      saveToStorage(LS_SEARCH, state.financeSearch);
      rerender();
    });

    root.querySelectorAll('[data-status-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeStatusFilter = btn.dataset.statusFilter || '';
        saveToStorage(LS_STATUS_FILTER, state.financeStatusFilter);
        rerender();
      });
    });

    root.querySelector('#finance-date-from')?.addEventListener('change', (ev) => {
      state.financeDateFrom = ev.target.value || '';
      state.financeMonthYm = '';
      saveDatesToStorage(state.financeDateFrom, state.financeDateTo);
      saveToStorage(LS_MONTH_YM, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });

    root.querySelector('#finance-date-to')?.addEventListener('change', (ev) => {
      state.financeDateTo = ev.target.value || '';
      state.financeMonthYm = '';
      saveDatesToStorage(state.financeDateFrom, state.financeDateTo);
      saveToStorage(LS_MONTH_YM, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });

    root.querySelector('[data-clear-dates]')?.addEventListener('click', () => {
      state.financeDateFrom = '';
      state.financeDateTo = '';
      saveDatesToStorage('', '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });

    root.querySelectorAll('[data-mgr-sort-col]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.mgrSortCol;
        if (state.managerBreakdownSortCol === col) {
          state.managerBreakdownSortDir = state.managerBreakdownSortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.managerBreakdownSortCol = col;
          state.managerBreakdownSortDir = 'desc';
        }
        rerender();
      });
    });

    root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
      const searchQ = state?.financeSearch || '';
      const statusFilter = state?.financeStatusFilter || '';
      const monthYm = state?.financeMonthYm || '';
      const activeTab = state?.financeTab || 'active';
      const hasArchived = allRows.some((r) => {
        const arch = String(r.is_archived || r.archive || '').toLowerCase();
        return arch === 'yes' || arch === 'true' || arch === '1';
      });
      let rows = hasArchived ? applyTabFilter(allRows, activeTab) : allRows;
      rows = applyMonthFilter(rows, monthYm);
      rows = applySearch(rows, searchQ);
      if (statusFilter) rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
      const label = monthYm ? ymToMonthLabel(monthYm) : '';
      exportToCsv(rows, label);
    });

    function buildFinanceMeetingsSection(row) {
      return buildMeetingsPanel(row);
    }

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
      const meetingsHtml = buildFinanceMeetingsSection(hit);
      const baseHtml = activityWorkDrawerHtml(hit, { privateNote: null, canEdit, hideEmpIds });
      const fullHtml = meetingsHtml ? baseHtml + meetingsHtml : baseHtml;
      ui.openDrawer({
        title: `כספים · ${hit.activity_name || hit.RowID}`,
        content: fullHtml,
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
