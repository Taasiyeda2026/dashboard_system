import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsFilterBar,
  dsKpiGrid,
  dsStatusChip
} from './shared/layout.js';
import {
  financeStatusVariant,
  hebrewActivityType,
  hebrewFinanceStatus,
  hebrewExceptionType
} from './shared/ui-hebrew.js';
import { normalizedExceptionTypes } from './shared/exceptions-metrics.js';

const FINANCE_TAB_ACTIVE = 'active';
const FINANCE_TAB_ARCHIVE = 'archive';
const FINANCE_TABS = new Set([FINANCE_TAB_ACTIVE, FINANCE_TAB_ARCHIVE]);
const FINANCE_STATUS_OPEN = 'open';
const FINANCE_STATUS_CLOSED = 'closed';
const FINANCE_GROUP_UNASSIGNED = 'ללא מימון';
const FINANCE_UNASSIGNED = '—';
const FINANCE_EDIT_FIELDS = new Set(['price', 'Payment', 'finance_status', 'finance_notes']);

function permissionYes(value) {
  return value === true || ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function canAccessFinance(user = {}) {
  const role = String(user?.display_role || user?.role || '').trim();
  if (role === 'business_development_manager') return false;
  return permissionYes(user?.finance_access) || role === 'finance';
}

function normalizeFinanceStatus(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  if (lower === 'open' || raw === 'פתוח') return FINANCE_STATUS_OPEN;
  if (lower === 'closed' || raw === 'סגור') return FINANCE_STATUS_CLOSED;
  return lower || FINANCE_STATUS_OPEN;
}

function isFinanceClosed(value) {
  return normalizeFinanceStatus(value) === FINANCE_STATUS_CLOSED;
}

function num(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v ?? '').replace(/[₪,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function money(v) {
  return `₪${num(v).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function roundedSessionCount(row = {}) {
  const raw = num(row.sessions || row.session_count || row.meetings_count);
  return raw > 0 ? Math.ceil(raw) : 0;
}

function recordedPayment(row = {}) {
  return num(row.Payment ?? row.payment ?? row.paid_amount ?? row.amount_paid);
}

function rowAmount(row = {}) {
  const price = num(row.price ?? row.amount ?? row.activity_price);
  const roundedSessions = roundedSessionCount(row);
  const recorded = recordedPayment(row);
  const pendingRaw = roundedSessions - recorded;
  const pending = pendingRaw > 0 ? pendingRaw : 0;
  if (price > 0 && roundedSessions > 0 && recorded > 0 && recorded <= roundedSessions) return price * pending;
  if (recorded > 0 && price > recorded) return price - recorded;
  return price;
}

function activityRowId(row = {}) {
  return String(row.RowID || row.row_id || row.source_row_id || '').trim();
}

function rowDate(row = {}, key, fallbackKey) {
  return row[key] || row[fallbackKey] || '';
}

function groupMeta(row = {}) {
  const funding = String(row.funding || '').trim() || FINANCE_GROUP_UNASSIGNED;
  const authority = String(row.authority || '').trim() || FINANCE_UNASSIGNED;
  const school = String(row.school || '').trim() || FINANCE_UNASSIGNED;
  const cluster = funding === 'גפ״ן' ? school : (funding === 'רשות' ? authority : funding);
  return { funding, authority, school, cluster };
}

function groupActivities(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const meta = groupMeta(row);
    const key = `${meta.funding}__${meta.cluster}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        ...meta,
        authorities: new Set(),
        schools: new Set(),
        activities: [],
        total: 0,
        exceptions: 0,
        open: 0,
        closed: 0
      });
    }
    const g = map.get(key);
    g.authorities.add(meta.authority);
    g.schools.add(meta.school);
    g.activities.push(row);
    g.total += rowAmount(row);
    g.exceptions += financeExceptions(row).length;
    if (isFinanceClosed(row.finance_status)) g.closed += 1;
    else g.open += 1;
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      authorityDisplay: g.authorities.size === 1 ? [...g.authorities][0] : 'מרובה',
      schoolDisplay: g.schools.size === 1 ? [...g.schools][0] : 'מרובה'
    }))
    .sort((a, b) => b.total - a.total || b.activities.length - a.activities.length || a.key.localeCompare(b.key, 'he'));
}

function uniqueOptions(rows, key) {
  return [...new Set((Array.isArray(rows) ? rows : [])
    .map((row) => String(row?.[key] || '').trim())
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
}

function selectHtml(name, label, value, options, allLabel = 'הכול') {
  const opts = [`<option value="">${escapeHtml(allLabel)}</option>`]
    .concat(options.map((opt) => `<option value="${escapeHtml(opt)}" ${String(value || '') === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`));
  return `<label class="ds-field"><span>${escapeHtml(label)}</span><select class="ds-input ds-input--sm" data-finance-filter="${escapeHtml(name)}">${opts.join('')}</select></label>`;
}

function financeExceptions(row = {}) {
  const out = [];
  if (!String(row.funding || '').trim()) out.push('missing_funding');
  if (!String(row.finance_status || '').trim()) out.push('missing_finance_status');
  if (rowAmount(row) > 0 && isFinanceClosed(row.finance_status) && recordedPayment(row) <= 0) out.push('closed_without_payment');
  if (!isFinanceClosed(row.finance_status) && rowDate(row, 'end_date', 'date_end')) {
    const end = new Date(rowDate(row, 'end_date', 'date_end'));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (!Number.isNaN(end.getTime()) && end < today) out.push('ended_open_finance');
  }
  for (const type of normalizedExceptionTypes(row)) out.push(type);
  return [...new Set(out)];
}

function financeExceptionLabel(type) {
  const map = {
    missing_funding: 'חסר מקור מימון',
    missing_finance_status: 'חסר סטטוס כספים',
    closed_without_payment: 'נסגר ללא תשלום מתועד',
    ended_open_finance: 'פעילות הסתיימה וגבייה פתוחה'
  };
  return map[type] || hebrewExceptionType(type);
}

function applyFinanceFilters(rows = [], state = {}) {
  const query = String(state.financeSearch || '').trim().toLowerCase();
  const status = String(state.financeStatusFilter || '').trim();
  const funding = String(state.financeFundingFilter || '').trim();
  const authority = String(state.financeAuthorityFilter || '').trim();
  const school = String(state.financeSchoolFilter || '').trim();
  const exceptionsOnly = !!state.financeExceptionsOnly;
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (status && normalizeFinanceStatus(row.finance_status) !== status) return false;
    if (funding && String(row.funding || '').trim() !== funding) return false;
    if (authority && String(row.authority || '').trim() !== authority) return false;
    if (school && String(row.school || '').trim() !== school) return false;
    const exceptions = financeExceptions(row);
    if (exceptionsOnly && !exceptions.length) return false;
    if (query) {
      const haystack = [
        row.activity_name, row.activity_type, row.authority, row.school, row.instructor_name,
        row.activity_manager, row.finance_status, row.finance_notes, row.funding, activityRowId(row)
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function kpiHtml(rows = [], filteredRows = rows) {
  const kpiOpen = rows.filter((r) => normalizeFinanceStatus(r.finance_status) === FINANCE_STATUS_OPEN || String(r.finance_status || '').toLowerCase() === 'open');
  const kpiClosed = rows.filter((r) => normalizeFinanceStatus(r.finance_status) === FINANCE_STATUS_CLOSED || String(r.finance_status || '').toLowerCase() === 'closed');
  const amountOpen = kpiOpen.reduce((s, r) => s + rowAmount(r), 0);
  const amountClosed = kpiClosed.reduce((s, r) => s + rowAmount(r), 0);
  const exceptionCount = rows.reduce((sum, row) => sum + financeExceptions(row).length, 0);
  return dsKpiGrid([
    { label: 'פתוחות', value: kpiOpen.length, hint: money(amountOpen) },
    { label: 'סגורות', value: kpiClosed.length, hint: money(amountClosed) },
    { label: 'חריגות כספיות', value: exceptionCount, hint: 'לפי activities בלבד' },
    { label: 'מוצגות לאחר סינון', value: filteredRows.length, hint: money(filteredRows.reduce((s, r) => s + rowAmount(r), 0)) }
  ]);
}

function filtersHtml(allRows, state) {
  const statusOptions = [
    [FINANCE_STATUS_OPEN, 'פתוח'],
    [FINANCE_STATUS_CLOSED, 'סגור']
  ];
  return dsFilterBar(`
    <input type="search" class="ds-input ds-input--sm" data-finance-filter="search" value="${escapeHtml(state.financeSearch || '')}" placeholder="חיפוש פעילות / רשות / מדריך" aria-label="חיפוש כספים" />
    <label class="ds-field"><span>סטטוס</span><select class="ds-input ds-input--sm" data-finance-filter="status"><option value="">הכול</option>${statusOptions.map(([value, label]) => `<option value="${value}" ${String(state.financeStatusFilter || '') === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    ${selectHtml('funding', 'מימון', state.financeFundingFilter, uniqueOptions(allRows, 'funding'))}
    ${selectHtml('authority', 'רשות', state.financeAuthorityFilter, uniqueOptions(allRows, 'authority'))}
    ${selectHtml('school', 'בית ספר', state.financeSchoolFilter, uniqueOptions(allRows, 'school'))}
    <label class="ds-field ds-field--checkbox"><input type="checkbox" data-finance-filter="exceptions" ${state.financeExceptionsOnly ? 'checked' : ''} /> חריגות בלבד</label>
    <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-finance-clear>ניקוי</button>
  `);
}

function tabsHtml(tab) {
  return `<div class="ds-tabs" style="display:flex;gap:6px" role="tablist" aria-label="מצב גבייה">
    <button type="button" class="ds-btn ds-btn--sm ${tab === FINANCE_TAB_ACTIVE ? 'ds-btn--primary' : ''}" data-finance-tab="${FINANCE_TAB_ACTIVE}">גבייה פעילה</button>
    <button type="button" class="ds-btn ds-btn--sm ${tab === FINANCE_TAB_ARCHIVE ? 'ds-btn--primary' : ''}" data-finance-tab="${FINANCE_TAB_ARCHIVE}">ארכיון כספים</button>
  </div>`;
}

function activityViewDetails(row) {
  const exceptionChips = financeExceptions(row)
    .map((type) => dsStatusChip(financeExceptionLabel(type), 'warning'))
    .join(' ') || dsStatusChip('ללא חריגה', 'success');
  return `<div style="margin-top:8px;font-size:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <div><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '')}</div>
    <div><strong>סוג פעילות:</strong> ${escapeHtml(hebrewActivityType(row.activity_type))}</div>
    <div><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</div>
    <div><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</div>
    <div><strong>מימון:</strong> ${escapeHtml(row.funding || '—')}</div>
    <div><strong>מדריך:</strong> ${escapeHtml(row.instructor_name || '—')}</div>
    <div><strong>מנהל / אחראי:</strong> ${escapeHtml(row.activity_manager || '—')}</div>
    <div><strong>תאריך התחלה:</strong> ${escapeHtml(formatDateHe(rowDate(row, 'start_date', 'date_start')) || '—')}</div>
    <div><strong>תאריך סיום:</strong> ${escapeHtml(formatDateHe(rowDate(row, 'end_date', 'date_end')) || '—')}</div>
    <div><strong>מספר מפגשים:</strong> ${escapeHtml(String(row.sessions || '—'))}</div>
    <div><strong>סכום לגבייה:</strong> ${escapeHtml(money(rowAmount(row)))}</div>
    <div><strong>סטטוס פעילות:</strong> ${escapeHtml(row.status || '—')}</div>
    <div><strong>סטטוס כספים:</strong> ${dsStatusChip(hebrewFinanceStatus(row.finance_status), financeStatusVariant(row.finance_status))}</div>
    <div style="grid-column:1/-1"><strong>חריגות:</strong> ${exceptionChips}</div>
    <div style="grid-column:1/-1"><strong>הערות כספים:</strong> ${escapeHtml(String(row.finance_notes || '—'))}</div>
  </div>`;
}

function activityEditDetails(row) {
  const rowId = activityRowId(row);
  return `<div style="margin-top:8px;font-size:12px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <div><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '')}</div>
    <div><strong>סוג פעילות:</strong> ${escapeHtml(hebrewActivityType(row.activity_type))}</div>
    <div><strong>בית ספר:</strong> ${escapeHtml(row.school || '—')}</div>
    <div><strong>רשות:</strong> ${escapeHtml(row.authority || '—')}</div>
    <div><strong>מימון:</strong> ${escapeHtml(row.funding || '—')}</div>
    <div><strong>מדריך:</strong> ${escapeHtml(row.instructor_name || '—')}</div>
    <div><strong>מספר מפגשים:</strong> ${escapeHtml(String(row.sessions || '—'))}</div>
    <div><strong>סכום פעילות:</strong> <input class="ds-input ds-input--sm" data-finance-field="price" data-row-id="${escapeHtml(rowId)}" value="${escapeHtml(String(row.price ?? ''))}" /></div>
    <div><strong>תשלום מתועד:</strong> <input class="ds-input ds-input--sm" data-finance-field="Payment" data-row-id="${escapeHtml(rowId)}" value="${escapeHtml(String(row.Payment ?? ''))}" /></div>
    <div><strong>סטטוס כספים:</strong> <select class="ds-input ds-input--sm" data-finance-field="finance_status" data-row-id="${escapeHtml(rowId)}"><option value="open" ${normalizeFinanceStatus(row.finance_status) === 'open' ? 'selected' : ''}>פתוח</option><option value="closed" ${normalizeFinanceStatus(row.finance_status) === 'closed' ? 'selected' : ''}>סגור</option></select></div>
    <div style="grid-column:1/-1"><strong>הערות כספים:</strong> <textarea class="ds-input" rows="2" data-finance-field="finance_notes" data-row-id="${escapeHtml(rowId)}">${escapeHtml(String(row.finance_notes || ''))}</textarea></div>
    <div style="grid-column:1/-1"><button class="ds-btn ds-btn--sm ds-btn--primary" data-finance-save="${escapeHtml(rowId)}">שמירה</button></div>
  </div>`;
}

function exportFinanceCsv(rows = []) {
  const columns = ['RowID', 'activity_name', 'activity_type', 'authority', 'school', 'funding', 'finance_status', 'price', 'Payment', 'finance_notes'];
  const csv = [columns.join(',')].concat(rows.map((row) => columns.map((c) => {
    let v = row[c] ?? '';
    if (c === 'Payment') v = String(rowAmount(row));
    return `"${String(v).replace(/"/g, '""')}"`;
  }).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'finance-activities.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const financeScreen = {
  load: ({ api }) => api.allActivities(),
  render(data, { state } = {}) {
    if (!canAccessFinance(state?.user)) {
      return dsScreenStack(`${dsPageHeader('כספים / גבייה', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לעמוד כספים (finance_access).')}`);
    }

    const tab = FINANCE_TABS.has(String(state?.financeTab || '')) ? String(state.financeTab) : FINANCE_TAB_ACTIVE;
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const tabRows = allRows.filter((r) => tab === FINANCE_TAB_ARCHIVE ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const rows = applyFinanceFilters(tabRows, state || {});
    const groups = groupActivities(rows);

    const body = groups.map((g) => `<tr class="ds-data-row" data-finance-group="${escapeHtml(g.key)}" role="button" tabindex="0"><td>${escapeHtml(g.funding)}</td><td>${escapeHtml(g.authorityDisplay)}</td><td>${escapeHtml(g.cluster)}</td><td>${g.activities.length}</td><td>${escapeHtml(money(g.total))}</td><td>${g.exceptions ? dsStatusChip(String(g.exceptions), 'warning') : dsStatusChip('0', 'success')}</td></tr>`).join('');
    const table = groups.length
      ? dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--compact"><thead><tr><th>גורם מימון</th><th>רשות</th><th>גורם ריכוז</th><th>כמות פעילויות</th><th>סה״כ לגבייה</th><th>חריגות</th></tr></thead><tbody>${body}</tbody></table>`)
      : dsEmptyState('אין רשומות בלשונית זו');
    return dsScreenStack(`${dsPageHeader('כספים / גבייה', `עמוד פנימי מבוסס activities בלבד · ריכוזי גבייה (${groups.length})`)} ${tabsHtml(tab)} ${kpiHtml(tabRows, rows)} ${filtersHtml(tabRows, state || {})} <div style="display:flex;justify-content:flex-end"><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-finance-export>ייצוא CSV</button></div> ${dsCard({ title: 'ריכוז גבייה לפי מימון ורשות', body: table, padded: groups.length === 0 })}`);
  },
  bind({ root, data, state, ui, api, rerender, clearScreenDataCache }) {
    if (!canAccessFinance(state?.user)) return;
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const tab = FINANCE_TABS.has(String(state?.financeTab || '')) ? String(state.financeTab) : FINANCE_TAB_ACTIVE;
    const tabRows = allRows.filter((r) => tab === FINANCE_TAB_ARCHIVE ? isFinanceClosed(r.finance_status) : !isFinanceClosed(r.finance_status));
    const filtered = applyFinanceFilters(tabRows, state || {});
    const groups = groupActivities(filtered);
    const byKey = new Map(groups.map((g) => [g.key, g]));

    root.querySelectorAll('[data-finance-tab]').forEach((b) => b.addEventListener('click', () => { state.financeTab = b.dataset.financeTab; rerender?.(); }));
    root.querySelectorAll('[data-finance-filter]').forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
      const key = el.dataset.financeFilter;
      if (key === 'search') state.financeSearch = el.value;
      if (key === 'status') state.financeStatusFilter = el.value;
      if (key === 'funding') state.financeFundingFilter = el.value;
      if (key === 'authority') state.financeAuthorityFilter = el.value;
      if (key === 'school') state.financeSchoolFilter = el.value;
      if (key === 'exceptions') state.financeExceptionsOnly = !!el.checked;
      rerender?.();
    }));
    root.querySelector('[data-finance-clear]')?.addEventListener('click', () => {
      state.financeSearch = '';
      state.financeStatusFilter = '';
      state.financeFundingFilter = '';
      state.financeAuthorityFilter = '';
      state.financeSchoolFilter = '';
      state.financeExceptionsOnly = false;
      rerender?.();
    });
    root.querySelector('[data-finance-export]')?.addEventListener('click', () => exportFinanceCsv(filtered));

    const openGroup = (g) => {
      const summary = `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;font-size:12px"><div><strong>גורם מימון:</strong> ${escapeHtml(g.funding)}</div><div><strong>רשות:</strong> ${escapeHtml(g.authorityDisplay)}</div><div><strong>גורם ריכוז:</strong> ${escapeHtml(g.cluster)}</div><div><strong>כמות פעילויות:</strong> ${g.activities.length}</div><div><strong>סה״כ לגבייה:</strong> ${escapeHtml(money(g.total))}</div><div><strong>חריגות:</strong> ${escapeHtml(String(g.exceptions))}</div></div>`;
      const activities = g.activities.map((row) => {
        const rowId = activityRowId(row);
        const exceptions = financeExceptions(row).length;
        return `<details class="ds-acc" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px">
          <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px;font-size:12px"><span>${escapeHtml(row.activity_name || 'ללא שם')}</span><span>${escapeHtml(hebrewActivityType(row.activity_type))}</span><span>${escapeHtml(formatDateHe(rowDate(row, 'end_date', 'date_end')) || '—')}</span><span>${escapeHtml(money(rowAmount(row)))}</span><span>${exceptions ? `חריגות: ${escapeHtml(String(exceptions))}` : 'תקין'}</span></summary>
          <div style="margin-top:8px;display:flex;gap:6px"><button class="ds-btn ds-btn--sm" data-finance-mode="view" data-row-id="${escapeHtml(rowId)}">צפייה</button><button class="ds-btn ds-btn--sm" data-finance-mode="edit" data-row-id="${escapeHtml(rowId)}">עריכה</button></div>
          <div data-finance-panel="${escapeHtml(rowId)}">${activityViewDetails(row)}</div>
        </details>`;
      }).join('');
      ui.openDrawer({ title: 'פירוט גבייה', content: `<div style="display:grid;gap:10px">${summary}<div style="display:grid;gap:6px">${activities}</div></div>` });

      const rowLookup = new Map(g.activities.map((r) => [activityRowId(r), r]));
      document.querySelectorAll('[data-finance-mode]').forEach((btn) => btn.addEventListener('click', () => {
        const rowId = String(btn.dataset.rowId || '');
        const mode = String(btn.dataset.financeMode || 'view');
        const row = rowLookup.get(rowId);
        const panel = document.querySelector(`[data-finance-panel="${CSS.escape(rowId)}"]`);
        if (!row || !panel) return;
        panel.innerHTML = mode === 'edit' ? activityEditDetails(row) : activityViewDetails(row);
      }));

      document.querySelectorAll('[data-finance-save]').forEach((btn) => btn.addEventListener('click', async () => {
        const rowId = String(btn.dataset.financeSave || '');
        const changes = {};
        document.querySelectorAll(`[data-row-id="${CSS.escape(rowId)}"]`).forEach((el) => {
          const field = el.dataset.financeField;
          if (FINANCE_EDIT_FIELDS.has(field)) changes[field] = el.value;
        });
        await api.saveActivity({ source_row_id: rowId, source_sheet: 'activities', changes });
        clearScreenDataCache?.();
        rerender?.();
      }));
    };

    root.querySelectorAll('[data-finance-group]').forEach((rowEl) => rowEl.addEventListener('click', () => {
      const g = byKey.get(rowEl.dataset.financeGroup);
      if (g) openGroup(g);
    }));
  }
};
