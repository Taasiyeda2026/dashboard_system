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
import { showToast } from './shared/toast.js';

const HE_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

/* ————————————————————————————————
   Filtering helpers
———————————————————————————————— */
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
      String(r.authority || '').toLowerCase().includes(lq) ||
      hebrewFinanceStatus(r.finance_status).toLowerCase().includes(lq)
  );
}

function applyMonthFilter(rows, ymStr) {
  if (!ymStr) return rows;
  return rows.filter((r) => String(r.end_date || '').startsWith(ymStr));
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

/* Sort: open first → closed → other; within group by end_date asc */
function sortRows(rows) {
  const order = { open: 0, closed: 1 };
  return [...rows].sort((a, b) => {
    const aO = order[String(a.finance_status || '').toLowerCase()] ?? 2;
    const bO = order[String(b.finance_status || '').toLowerCase()] ?? 2;
    if (aO !== bO) return aO - bO;
    return String(a.end_date || '').localeCompare(String(b.end_date || ''));
  });
}

/* ————————————————————————————————
   Grouping: גפן funding → by school; else by funding
———————————————————————————————— */
function isGafenFunding(fundingVal) {
  const f = String(fundingVal || '').trim();
  return f.includes('גפ') || f.toLowerCase().includes('gafan') || f.toLowerCase().includes('gafn') || f.toLowerCase().includes('gafen');
}

function getGroupKey(row) {
  if (isGafenFunding(row.funding)) {
    return `בי"ס: ${String(row.school || '').trim() || 'לא מוגדר'}`;
  }
  return String(row.funding || '').trim() || 'לא מוגדר';
}

function getGroupSortKey(key) {
  if (key.startsWith('בי"ס:')) return 'ב' + key;
  return key;
}

/* ————————————————————————————————
   Formatting
———————————————————————————————— */
function formatILS(amount) {
  if (!amount && amount !== 0) return '—';
  return '₪' + Number(amount).toLocaleString('he-IL', { maximumFractionDigits: 0 });
}

function formatDateIL(isoDate) {
  if (!isoDate) return '';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return String(isoDate);
  return `${d}/${m}/${y}`;
}

/* Row amount: prefer explicit Payment field if present (future-proof);
   otherwise compute from price × sessions — matches backend/actions.gs:488. */
function rowAmount(row) {
  const explicit = parseFloat(row.Payment || row.payment_amount || row.payment) || 0;
  if (explicit > 0) return explicit;
  const price = parseFloat(row.price) || 0;
  const sessions = parseFloat(row.sessions) || 0;
  return sessions > 0 ? price * sessions : price;
}

function ymToMonthLabel(ymStr) {
  if (!ymStr || !/^\d{4}-\d{2}$/.test(ymStr)) return '';
  const [y, m] = ymStr.split('-');
  return `${HE_MONTHS[parseInt(m, 10) - 1]} ${y}`;
}

function prevMonth(ymStr) {
  const base = ymStr && /^\d{4}-\d{2}$/.test(ymStr) ? ymStr : currentYm();
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function nextMonth(ymStr) {
  const base = ymStr && /^\d{4}-\d{2}$/.test(ymStr) ? ymStr : currentYm();
  const [y, m] = base.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function currentYm() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/* ————————————————————————————————
   Manager breakdown (for summary card)
———————————————————————————————— */
function buildManagerBreakdown(rows) {
  const map = {};
  rows.forEach((r) => {
    const mgr = String(r.activity_manager || '').trim() || '—';
    if (!map[mgr]) map[mgr] = { total: 0, open: 0, closed: 0, other: 0, amountOpen: 0, amountClosed: 0, amountOther: 0, amountTotal: 0 };
    const amt = rowAmount(r);
    map[mgr].total += 1;
    map[mgr].amountTotal += amt;
    const st = String(r.finance_status || '').toLowerCase();
    if (st === 'open') { map[mgr].open += 1; map[mgr].amountOpen += amt; }
    else if (st === 'closed') { map[mgr].closed += 1; map[mgr].amountClosed += amt; }
    else { map[mgr].other += 1; map[mgr].amountOther += amt; }
  });
  return Object.entries(map).map(([mgr, counts]) => ({ mgr, ...counts })).sort((a, b) => b.total - a.total);
}

/* ————————————————————————————————
   Meetings date panel (Date1–Date35)
———————————————————————————————— */
function buildMeetingsDatesHtml(row) {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [];
  for (let i = 1; i <= 35; i++) {
    const val = String(row[`Date${i}`] || '').trim();
    if (val) dates.push({ num: i, val });
  }
  if (dates.length === 0) return '';

  const chips = dates.map(({ num, val }) => {
    const parts = val.split('/');
    const isoVal = parts.length === 3
      ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      : val;
    const kind = isoVal < today ? 'past' : 'future';
    return `<span class="ds-date-chip ds-date-chip--${kind}" title="פגישה ${num}">${escapeHtml(val)}</span>`;
  }).join('');

  const past = dates.filter(({ val }) => {
    const parts = val.split('/');
    const iso = parts.length === 3 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : val;
    return iso < today;
  }).length;
  const future = dates.length - past;

  return `<div class="ds-meetings-panel">
    <div class="ds-meetings-panel__summary">
      <span>תאריכי פגישות (${dates.length})</span>
      <span class="ds-meetings-panel__counts">
        ${past > 0 ? `<span class="ds-date-count ds-date-count--past">${past} עברו</span>` : ''}
        ${future > 0 ? `<span class="ds-date-count ds-date-count--future">${future} עתידיות</span>` : ''}
      </span>
    </div>
    <div class="ds-meetings-panel__body">${chips}</div>
  </div>`;
}

/* ————————————————————————————————
   Dates-only expand row (beneath data row)
———————————————————————————————— */
function buildDatesExpandRowHtml(row, colCount) {
  const uid = escapeHtml(row.RowID);
  const meetingsHtml = buildMeetingsDatesHtml(row);
  if (!meetingsHtml) return '';
  return `<tr class="ds-finance-dates-row" data-dates-row="${uid}" style="display:none;">
    <td colspan="${colCount}" class="ds-finance-inline-edit-cell">
      ${meetingsHtml}
    </td>
  </tr>`;
}

/* ————————————————————————————————
   Grouped table rendering
———————————————————————————————— */
function buildGroupedTable(rows, canEdit) {
  if (rows.length === 0) return dsEmptyState('לא נמצאו רשומות');

  const sorted = sortRows(rows);
  const groups = {};
  sorted.forEach((r) => {
    const key = getGroupKey(r);
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const sortedKeys = Object.keys(groups).sort((a, b) =>
    getGroupSortKey(a).localeCompare(getGroupSortKey(b), 'he')
  );

  const hasAuthority = rows.some((r) => r.authority);

  const tbody = sortedKeys.map((key) => {
    const gRows = groups[key];
    const gOpen = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open').length;
    const gClosed = gRows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed').length;
    const gTotal = gRows.reduce((s, r) => s + rowAmount(r), 0);

    const statusMini = [
      gOpen > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--open">${gOpen} פתוח</span>` : '',
      gClosed > 0 ? `<span class="ds-finance-group-chip ds-finance-group-chip--closed">${gClosed} סגור</span>` : ''
    ].filter(Boolean).join('');

    const colSpan = 8 + (hasAuthority ? 1 : 0) + (canEdit ? 1 : 0);
    const groupHeader = `<tr class="ds-finance-group-header">
      <td colspan="${colSpan}">
        <span class="ds-finance-group-title">${escapeHtml(key)}</span>
        <span class="ds-finance-group-meta">${gRows.length} פעילויות · ${formatILS(gTotal)}</span>
        <span class="ds-finance-group-chips">${statusMini}</span>
      </td>
    </tr>`;

    const colCount = 9 + (hasAuthority ? 1 : 0) + (canEdit ? 1 : 0);
    const dataRows = gRows.map((row) => {
      const uid = escapeHtml(row.RowID);
      const authCol = hasAuthority ? `<td>${escapeHtml(row.authority || '—')}</td>` : '';
      const hasDates = Array.from({ length: 35 }, (_, i) => row[`Date${i + 1}`]).some(Boolean);

      /* Status cell: editable select or read-only chip */
      const statusOpts = ['', 'open', 'closed'].map((v) =>
        `<option value="${v}" ${String(row.finance_status || '') === v ? 'selected' : ''}>${v === '' ? '— ללא —' : hebrewFinanceStatus(v)}</option>`
      ).join('');
      const statusCell = canEdit
        ? `<td class="ds-finance-status-cell"><select class="ds-input ds-input--sm ds-finance-status-select" data-inline-status="${uid}">${statusOpts}</select></td>`
        : `<td>${dsStatusChip(hebrewFinanceStatus(row.finance_status), financeStatusVariant(row.finance_status))}</td>`;

      /* Actions cell: notes input + save + dates + export (editors only) */
      const actionsCell = canEdit ? `<td class="ds-finance-actions-cell">
        <div class="ds-finance-row-actions">
          <input type="text" class="ds-input ds-input--sm ds-finance-notes-input" data-inline-notes="${uid}"
            value="${escapeHtml(String(row.finance_notes || ''))}" placeholder="הערות..." title="הערות כספים" />
          <button type="button" class="ds-btn ds-btn--sm ds-btn--primary ds-finance-save-btn" data-inline-save="${uid}" title="שמור">💾</button>
          ${hasDates ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-dates-toggle="${uid}" title="תאריכי פגישות">תאריכים ▾</button>` : ''}
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-export-row="${uid}" title="ייצוא שורה">↓</button>
          <span class="ds-finance-inline-status ds-muted" data-inline-msg="${uid}" role="status" aria-live="polite"></span>
        </div>
      </td>` : '';

      const datesExpandRow = buildDatesExpandRowHtml(row, colCount);

      return `<tr class="ds-data-row" data-row-id="${uid}">
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.activity_manager || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        ${authCol}
        <td>${escapeHtml(row.funding || '—')}</td>
        <td>${formatDateIL(row.end_date)}</td>
        <td>${formatILS(parseFloat(row.price) || 0)}</td>
        <td style="text-align:center;">${parseFloat(row.sessions) > 0 ? row.sessions : '—'}</td>
        ${statusCell}
        ${actionsCell}
      </tr>${datesExpandRow}`;
    }).join('');

    return groupHeader + dataRows;
  }).join('');

  const authHead = hasAuthority ? '<th>גורם מממן</th>' : '';
  const actionsHead = canEdit ? '<th class="ds-finance-actions-head">פעולות / הערות</th>' : '';

  return dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--grouped">
    <thead><tr>
      <th>שם פעילות</th>
      <th>מנהל פעילות</th>
      <th>בית ספר</th>
      ${authHead}
      <th>מימון</th>
      <th>תאריך סיום</th>
      <th>מחיר</th>
      <th>מפגשים</th>
      <th>סטטוס</th>
      ${actionsHead}
    </tr></thead>
    <tbody>${tbody}</tbody>
  </table>`);
}

/* ————————————————————————————————
   Cards view (mobile / toggle)
———————————————————————————————— */
function buildCardsView(rows) {
  if (rows.length === 0) return dsEmptyState('לא נמצאו רשומות');
  const sorted = sortRows(rows);
  return `<div class="ds-compact-list">${sorted.map((row) => {
    const fst = String(row.finance_status || '').trim();
    const amt = rowAmount(row);
    return `<div data-list-item data-filter="${escapeHtml(fst)}">
      ${dsInteractiveCard({
        variant: 'session',
        action: `finance:${row.RowID}`,
        title: row.activity_name || '—',
        subtitle: `${hebrewFinanceStatus(row.finance_status)} · ${row.school || ''}`,
        meta: [
          row.end_date ? `סיום: ${formatDateIL(row.end_date)}` : '',
          amt > 0 ? formatILS(amt) : ''
        ].filter(Boolean).join(' · ')
      })}
    </div>`;
  }).join('')}</div>`;
}

/* ————————————————————————————————
   CSV export
———————————————————————————————— */
function exportToCsv(rows, label) {
  const cols = ['RowID', 'activity_name', 'activity_manager', 'school', 'authority', 'funding', 'price', 'sessions', 'amount', 'start_date', 'end_date', 'finance_status', 'finance_notes', 'status'];
  const headers = cols.map((c) => hebrewColumn(c) || c);
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const vals = cols.map((c) => {
      let v;
      if (c === 'amount') {
        v = String(rowAmount(row));
      } else {
        v = String(row[c] ?? '');
        if (c === 'finance_status') v = hebrewFinanceStatus(v);
      }
      return `"${v.replace(/"/g, '""')}"`;
    });
    lines.push(vals.join(','));
  });
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `כספים${label ? '-' + label : ''}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
}

/* ————————————————————————————————
   LocalStorage persistence
———————————————————————————————— */
const LS = {
  dateFrom: 'finance_date_from',
  dateTo: 'finance_date_to',
  search: 'finance_search',
  statusFilter: 'finance_status_filter',
  monthYm: 'finance_month_ym',
  tab: 'finance_tab',
  viewMode: 'finance_view_mode'
};

function loadStateFromStorage(state) {
  const map = {
    financeDateFrom: LS.dateFrom,
    financeDateTo: LS.dateTo,
    financeSearch: LS.search,
    financeStatusFilter: LS.statusFilter,
    financeMonthYm: LS.monthYm,
    financeTab: LS.tab,
    financeViewMode: LS.viewMode
  };
  Object.entries(map).forEach(([stateKey, lsKey]) => {
    if (!state[stateKey]) {
      const v = localStorage.getItem(lsKey);
      if (v) state[stateKey] = v;
    }
  });
}

function save(key, val) {
  val ? localStorage.setItem(key, val) : localStorage.removeItem(key);
}

/* ————————————————————————————————
   Screen export
———————————————————————————————— */
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
    const viewMode = state?.financeViewMode || (narrow ? 'cards' : 'table');
    const canEdit = state?.user?.display_role !== 'instructor';
    const isAdmin = state?.user?.display_role === 'admin';

    /* Non-admins never see archived rows; admins use the tab filter */
    let rows = isAdmin ? applyTabFilter(allRows, activeTab) : applyTabFilter(allRows, 'active');
    rows = applyMonthFilter(rows, monthYm);
    rows = applySearch(rows, searchQ);
    if (statusFilter) {
      rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
    }

    /* KPIs */
    const visibleOpen = rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'open');
    const visibleClosed = rows.filter((r) => String(r.finance_status || '').toLowerCase() === 'closed');
    const amountOpen = visibleOpen.reduce((s, r) => s + rowAmount(r), 0);
    const amountClosed = visibleClosed.reduce((s, r) => s + rowAmount(r), 0);
    const amountTotal = rows.reduce((s, r) => s + rowAmount(r), 0);

    const kpis = [
      { label: 'סה"כ פעילויות', value: String(rows.length) },
      { label: 'סל גבייה פתוח', value: formatILS(amountOpen), hint: `${visibleOpen.length} פעילויות` },
      { label: 'סל גבייה סגור', value: formatILS(amountClosed), hint: `${visibleClosed.length} פעילויות` },
      { label: 'סה"כ סל גבייה', value: formatILS(amountTotal) }
    ];

    /* Status filter chips */
    const statuses = [...new Set(rows.map((r) => String(r.finance_status || '')).filter(Boolean))];
    const statusChips = [{ val: '', label: 'הכל' }, ...statuses.map((s) => ({ val: s, label: hebrewFinanceStatus(s) }))]
      .map((c) =>
        `<button type="button" class="ds-chip ${c.val === statusFilter ? 'is-active' : ''}" data-status-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      ).join('');

    /* Manager breakdown */
    const agg = data?.aggregates;
    const mgrSortCol = state?.managerBreakdownSortCol || 'total';
    const mgrSortDir = state?.managerBreakdownSortDir || 'desc';
    const rawMgr = agg?.byManager || buildManagerBreakdown(rows);
    const managerBreakdown = [...rawMgr].sort((a, b) => {
      const av = mgrSortCol === 'mgr' ? String(a.mgr || '') : Number(a[mgrSortCol]) || 0;
      const bv = mgrSortCol === 'mgr' ? String(b.mgr || '') : Number(b[mgrSortCol]) || 0;
      if (mgrSortCol === 'mgr') return mgrSortDir === 'asc' ? av.localeCompare(bv, 'he') : bv.localeCompare(av, 'he');
      return mgrSortDir === 'asc' ? av - bv : bv - av;
    });

    function mgrTh(label, col, center) {
      const active = mgrSortCol === col;
      const style = `cursor:pointer;user-select:none;white-space:nowrap;${center ? 'text-align:center;' : ''}${active ? 'text-decoration:underline dotted;' : ''}`;
      const ind = active ? (mgrSortDir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th data-mgr-sort-col="${escapeHtml(col)}" style="${style}">${escapeHtml(label)}${ind}</th>`;
    }

    const mgrTableRows = managerBreakdown.map((m) => `<tr>
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
          ${mgrTh('מנהל פעילות','mgr',false)}
          ${mgrTh('סה"כ','total',true)}
          ${mgrTh('פתוח','open',true)}
          ${mgrTh('סכום פתוח','amountOpen',true)}
          ${mgrTh('סגור','closed',true)}
          ${mgrTh('סכום סגור','amountClosed',true)}
          ${mgrTh('סה"כ סכום','amountTotal',true)}
        </tr></thead>
        <tbody>${mgrTableRows}</tbody>
      </table>`),
      padded: false
    });

    /* Tabs — show ארכיון if user is admin (regardless of current data) */
    const showArchiveTab = isAdmin;
    const tabsHtml = showArchiveTab ? `<div class="ds-finance-tabs" dir="rtl">
      <button type="button" class="ds-finance-tab ${activeTab === 'active' ? 'is-active' : ''}" data-finance-tab="active">פעילות</button>
      <button type="button" class="ds-finance-tab ${activeTab === 'archive' ? 'is-active' : ''}" data-finance-tab="archive">ארכיון</button>
    </div>` : '';

    /* Month nav */
    const isCurrentMonth = monthYm === currentYm();
    const monthNavHtml = `<div class="ds-month-nav" dir="rtl">
      <button type="button" class="ds-month-nav__btn" data-month-prev title="חודש קודם">◀</button>
      <span class="ds-month-nav__label">${monthYm ? ymToMonthLabel(monthYm) : 'כל התקופה'}</span>
      <button type="button" class="ds-month-nav__btn" data-month-next title="חודש הבא">▶</button>
      ${!isCurrentMonth ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-month-today>החודש</button>` : ''}
      ${monthYm ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-month-clear>כל התקופה</button>` : ''}
    </div>`;

    /* View toggle */
    const viewToggleHtml = `<div class="ds-view-toggle" dir="rtl">
      <button type="button" class="ds-view-toggle__btn ${viewMode === 'table' ? 'is-active' : ''}" data-view-mode="table" title="תצוגת טבלה">☰ טבלה</button>
      <button type="button" class="ds-view-toggle__btn ${viewMode === 'cards' ? 'is-active' : ''}" data-view-mode="cards" title="תצוגת כרטיסיות">⊞ כרטיסיות</button>
    </div>`;

    /* Header subtitle */
    let headerSubtitle;
    if (monthYm) headerSubtitle = `מציג: ${ymToMonthLabel(monthYm)}`;
    else if (dateFrom && dateTo) headerSubtitle = `מציג: ${formatDateIL(dateFrom)} – ${formatDateIL(dateTo)}`;
    else if (dateFrom) headerSubtitle = `מציג: מתאריך ${formatDateIL(dateFrom)}`;
    else if (dateTo) headerSubtitle = `מציג: עד ${formatDateIL(dateTo)}`;
    else headerSubtitle = 'פעילויות לפי תאריך סיום';

    const exportBtn = `<button type="button" class="ds-btn ds-btn--sm" data-export-csv>ייצוא CSV</button>`;
    const syncBtn = isAdmin ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-sync-finance title="סנכרון נתוני כספים">↻ סנכרון</button>` : '';

    const dataBody = viewMode === 'cards'
      ? buildCardsView(rows)
      : buildGroupedTable(rows, canEdit);

    return dsScreenStack(`
      ${dsPageHeader('כספים', headerSubtitle)}
      ${tabsHtml}
      ${monthNavHtml}
      ${dsKpiGrid(kpis)}
      ${managerTable}
      <div class="ds-screen-top-row" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <input id="finance-search" type="search" class="ds-search-input"
          placeholder="חיפוש..." value="${escapeHtml(searchQ)}" dir="rtl" style="flex:1;min-width:160px;" />
        ${viewToggleHtml}
        ${exportBtn}
        ${syncBtn}
      </div>
      <div class="ds-filter-bar" role="toolbar" style="flex-wrap:wrap;gap:8px;">
        ${statusChips}
        <span style="display:flex;align-items:center;gap:4px;margin-right:8px;">
          <label for="finance-date-from" style="font-size:0.85rem;white-space:nowrap;">מתאריך</label>
          <input id="finance-date-from" type="date" class="ds-input" value="${escapeHtml(dateFrom)}" style="font-size:0.85rem;padding:4px 6px;" />
        </span>
        <span style="display:flex;align-items:center;gap:4px;">
          <label for="finance-date-to" style="font-size:0.85rem;white-space:nowrap;">עד תאריך</label>
          <input id="finance-date-to" type="date" class="ds-input" value="${escapeHtml(dateTo)}" style="font-size:0.85rem;padding:4px 6px;" />
        </span>
        ${(dateFrom || dateTo) ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-clear-dates>נקה תאריכים</button>` : ''}
      </div>
      <div data-finance-data-area>
        ${dsCard({
          title: 'רשימת כספים',
          badge: `${rows.length} רשומות`,
          body: dataBody,
          padded: rows.length === 0 || viewMode === 'cards'
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
        area.innerHTML = '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען נתונים...</p></div>';
      }
      root.querySelectorAll('.ds-kpi__value').forEach((el) => { el.style.opacity = '0.35'; });
    }

    /* Tabs */
    root.querySelectorAll('[data-finance-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeTab = btn.dataset.financeTab || 'active';
        save(LS.tab, state.financeTab);
        rerender();
      });
    });

    /* Month nav */
    root.querySelector('[data-month-prev]')?.addEventListener('click', () => {
      state.financeMonthYm = prevMonth(state.financeMonthYm);
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-next]')?.addEventListener('click', () => {
      state.financeMonthYm = nextMonth(state.financeMonthYm);
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-today]')?.addEventListener('click', () => {
      state.financeMonthYm = currentYm();
      save(LS.monthYm, state.financeMonthYm);
      rerender();
    });
    root.querySelector('[data-month-clear]')?.addEventListener('click', () => {
      state.financeMonthYm = '';
      save(LS.monthYm, '');
      rerender();
    });

    /* View toggle */
    root.querySelectorAll('[data-view-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeViewMode = btn.dataset.viewMode;
        save(LS.viewMode, state.financeViewMode);
        rerender();
      });
    });

    /* Search */
    root.querySelector('#finance-search')?.addEventListener('input', (ev) => {
      state.financeSearch = ev.target.value || '';
      save(LS.search, state.financeSearch);
      rerender();
    });

    /* Status filter chips */
    root.querySelectorAll('[data-status-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.financeStatusFilter = btn.dataset.statusFilter || '';
        save(LS.statusFilter, state.financeStatusFilter);
        rerender();
      });
    });

    /* Date filters */
    root.querySelector('#finance-date-from')?.addEventListener('change', (ev) => {
      state.financeDateFrom = ev.target.value || '';
      state.financeMonthYm = '';
      save(LS.dateFrom, state.financeDateFrom);
      save(LS.monthYm, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });
    root.querySelector('#finance-date-to')?.addEventListener('change', (ev) => {
      state.financeDateTo = ev.target.value || '';
      state.financeMonthYm = '';
      save(LS.dateTo, state.financeDateTo);
      save(LS.monthYm, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });
    root.querySelector('[data-clear-dates]')?.addEventListener('click', () => {
      state.financeDateFrom = '';
      state.financeDateTo = '';
      save(LS.dateFrom, '');
      save(LS.dateTo, '');
      showDataAreaLoading();
      clearScreenDataCache();
      rerender();
    });

    /* Manager sort */
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

    /* CSV export */
    root.querySelector('[data-export-csv]')?.addEventListener('click', () => {
      const searchQ = state?.financeSearch || '';
      const statusFilter = state?.financeStatusFilter || '';
      const monthYm = state?.financeMonthYm || '';
      const activeTab = state?.financeTab || 'active';
      const isAdminExport = state?.user?.display_role === 'admin';
      let rows = isAdminExport ? applyTabFilter(allRows, activeTab) : allRows.filter((r) => {
        const arch = String(r.is_archived || r.archive || '').toLowerCase();
        return arch !== 'yes' && arch !== 'true' && arch !== '1';
      });
      rows = applyMonthFilter(rows, monthYm);
      rows = applySearch(rows, searchQ);
      if (statusFilter) rows = rows.filter((r) => String(r.finance_status || '') === statusFilter);
      exportToCsv(rows, monthYm ? ymToMonthLabel(monthYm) : '');
    });

    /* Sync button (admin only — shows toast since API action may not exist) */
    root.querySelector('[data-sync-finance]')?.addEventListener('click', async () => {
      const btn = root.querySelector('[data-sync-finance]');
      if (btn) { btn.disabled = true; btn.textContent = '↻ מסנכרן...'; }
      try {
        if (typeof api.syncFinance === 'function') {
          await api.syncFinance();
          showToast('הנתונים סונכרנו בהצלחה', 'success');
        } else {
          showToast('סנכרון כספים — לא מוגדר ב-API עדיין', 'info', 3000);
        }
        clearScreenDataCache();
        rerender();
      } catch (err) {
        showToast(translateApiErrorForUser(err?.message), 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '↻ סנכרון'; }
      }
    });

    /* Dates-panel toggle */
    root.querySelectorAll('[data-dates-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.datesToggle;
        const datesRow = root.querySelector(`[data-dates-row="${uid}"]`);
        if (!datesRow) return;
        const isOpen = datesRow.style.display !== 'none';
        datesRow.style.display = isOpen ? 'none' : '';
        btn.textContent = isOpen ? 'תאריכים ▾' : 'תאריכים ▴';
      });
    });

    /* Per-row CSV export */
    root.querySelectorAll('[data-export-row]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const uid = btn.dataset.exportRow;
        const hit = allRows.find((r) => String(r.RowID) === String(uid));
        if (hit) exportToCsv([hit], String(hit.activity_name || hit.RowID).slice(0, 20));
      });
    });

    /* Inline save */
    root.querySelectorAll('[data-inline-save]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const uid = btn.dataset.inlineSave;
        const row = allRows.find((r) => String(r.RowID) === String(uid));
        if (!row) return;
        const statusEl = root.querySelector(`[data-inline-msg="${uid}"]`);
        const statusVal = root.querySelector(`[data-inline-status="${uid}"]`)?.value ?? '';
        const notesVal = root.querySelector(`[data-inline-notes="${uid}"]`)?.value ?? '';

        btn.disabled = true;
        if (statusEl) statusEl.textContent = '';
        try {
          await api.saveActivity({
            source_sheet: row.source_sheet || '',
            source_row_id: String(uid),
            changes: { finance_status: statusVal, finance_notes: notesVal }
          });
          if (statusEl) statusEl.textContent = 'נשמר ✓';
          showToast('הנתונים נשמרו', 'success', 2000);
          clearScreenDataCache();
          setTimeout(() => rerender(), 600);
        } catch (err) {
          if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
        } finally {
          btn.disabled = false;
        }
      });
    });

    /* Row click → drawer */
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
      const meetingsHtml = buildMeetingsDatesHtml(hit);
      const baseHtml = activityWorkDrawerHtml(hit, { privateNote: null, canEdit, hideEmpIds });
      ui.openDrawer({
        title: `כספים · ${hit.activity_name || hit.RowID}`,
        content: baseHtml + (meetingsHtml ? `<div style="padding:var(--ds-space-3)">${meetingsHtml}</div>` : ''),
        onOpen: canEdit ? bindFinanceEditForm : undefined
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', (e) => {
        if (e.target.closest('[data-inline-save],[data-dates-toggle],[data-export-row],[data-inline-status],[data-inline-notes]')) return;
        const rowId = rowNode.dataset.rowId;
        const hit = allRows.find((r) => String(r.RowID) === String(rowId));
        openDrawer(hit);
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); rowNode.click(); }
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
