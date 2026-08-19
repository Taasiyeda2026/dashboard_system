import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsScreenStack,
  dsEmptyState,
  dsTableWrap
} from './shared/layout.js';
import { attendanceMonthLabel } from './attendance-control.js';
import {
  FINANCE_ATTENDANCE_EXPORT_OPTIONS,
  FINANCE_HOUR_CATEGORIES,
  currentFinanceMonthKey,
  downloadFinanceAttendanceExcel,
  normalizeFinanceAttendanceExportType,
  summarizeFinanceAttendance
} from './finance-attendance-summary.js';
import {
  FINANCE_COLLECTION_CLOSED,
  FINANCE_COLLECTION_OPEN,
  FINANCE_COLLECTION_TAB_ALL,
  FINANCE_COLLECTION_TAB_CLOSED,
  FINANCE_COLLECTION_TAB_OPEN,
  FINANCE_NO_END_DATE_MONTH_KEY,
  FINANCE_NO_END_DATE_MONTH_LABEL,
  activityRowId,
  activityStatusLabel,
  attachCollectionTracking,
  groupFinanceCollectionByEndMonth,
  groupFinanceCollectionPayers,
  money,
  normalizeCollectionStatus,
  normalizeFinanceCollectionTab,
  summarizeFinanceCollectionTotals
} from './finance-collection.js';
import { ACTIVITY_SEASON_SCHOOL_2027, getActivityPeriodKey } from './shared/summer-activity.js';

export const FINANCE_COLLECTION_ACTIVITY_PERIOD = ACTIVITY_SEASON_SCHOOL_2027;

export {
  FINANCE_ATTENDANCE_COLUMNS,
  FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS,
  FINANCE_ATTENDANCE_EXPORT_FULL,
  FINANCE_ATTENDANCE_EXPORT_MAOF,
  FINANCE_ATTENDANCE_EXPORT_OPTIONS,
  FINANCE_ATTENDANCE_EXPORT_TAASIYEDA,
  FINANCE_ATTENDANCE_GENERAL_SHEET,
  FINANCE_HOUR_CATEGORIES,
  FINANCE_MAOF_DAILY_COLUMNS,
  FINANCE_MAOF_SHEET,
  buildEmployeeTeamMap,
  buildFinanceAttendanceExcelRows,
  buildFinanceAttendanceWorkbook,
  buildMaofDailyExcelRows,
  currentFinanceMonthKey,
  financeAttendanceDisplayRow,
  financeAttendanceExportFilename,
  financeEmploymentSheetName,
  financeHourCategory,
  formatFinanceReportedHourRanges,
  isFinalPayrollApproval,
  mergeFinanceReportedTimeRanges,
  normalizeFinanceAttendanceExportType,
  normalizeFinanceEmploymentType,
  summarizeFinanceAttendance,
  unmappedFinanceActivityTypes
} from './finance-attendance-summary.js';

export {
  FINANCE_UNFUNDED_PAYER_LABEL,
  FINANCE_COLLECTION_TAB_ALL,
  FINANCE_COLLECTION_TAB_CLOSED,
  FINANCE_COLLECTION_TAB_OPEN,
  FINANCE_NO_END_DATE_MONTH_KEY,
  FINANCE_NO_END_DATE_MONTH_LABEL,
  activityRowId,
  attachCollectionTracking,
  filterFinanceCollectionActivities,
  financeActivityEndDate,
  financeActivityEndMonthKey,
  financeCollectionSearchHaystack,
  financePayerKey,
  groupFinanceCollectionByEndMonth,
  groupFinanceCollectionPayers,
  isAuthorityFunding,
  isGefenFunding,
  mapLegacyPaymentCollected,
  normalizeCollectionStatus,
  normalizeFinanceCollectionTab,
  summarizeFinanceCollectionTotals
} from './finance-collection.js';

const FINANCE_COLLECTION_MEETING_DATE_COLUMNS = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`);

export const FINANCE_COLLECTION_ACTIVITY_COLUMNS = [
  'id', 'row_id', 'activity_name', 'activity_type', 'authority', 'school',
  'school_id', 'authority_id', 'funding', 'price', 'status', 'activity_season',
  'start_date', 'end_date', ...FINANCE_COLLECTION_MEETING_DATE_COLUMNS
].join(',');

function permissionYes(value) {
  return value === true || ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

export function canAccessFinance(user = {}) {
  const role = String(user?.role || user?.display_role || '').trim().toLowerCase();
  if (role === 'admin' || role === 'finance') return true;
  return permissionYes(user?.finance_access) || permissionYes(user?.view_finance);
}

export function createFinanceVisitState(now = new Date()) {
  return {
    view: 'hub',
    attendanceMonth: currentFinanceMonthKey(now),
    attendanceExportType: 'full',
    attendanceByMonth: {},
    attendanceLoading: false,
    attendanceError: '',
    employees: null,
    collectionPeriod: '',
    collectionActivities: null,
    collectionTracking: null,
    collectionTab: 'open',
    collectionSearch: '',
    collectionLoading: false,
    collectionError: '',
    collectionSaveState: {}
  };
}

function hubIcon(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  if (name === 'attendance') {
    return `<svg ${common}><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 9h16"/><path d="M9 14l2 2 4-4"/></svg>`;
  }
  if (name === 'file') {
    return `<svg ${common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`;
  }
  return `<svg ${common}><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M16 15h2"/><path d="M7 6V4h10v2"/></svg>`;
}

function hubCardsHtml() {
  const cards = [
    {
      view: 'attendance',
      icon: 'attendance',
      title: 'דיווח נוכחות',
      description: 'ריכוז נתוני נוכחות ושכר לאחר אישור סופי'
    },
    {
      view: 'collection',
      icon: 'collection',
      title: 'מעקב גבייה',
      description: 'מעקב גבייה מרוכז לפי הגורם המשלם'
    }
  ];
  return `<div class="ds-fin-hub" dir="rtl">
    ${cards.map((card) => `
      <button type="button" class="ds-fin-hub-card" data-finance-open="${card.view}">
        <span class="ds-fin-hub-card__icon">${hubIcon(card.icon)}</span>
        <span class="ds-fin-hub-card__body">
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(card.description)}</small>
        </span>
      </button>
    `).join('')}
  </div>`;
}

function backBarHtml(title) {
  return `<div class="ds-fin-backbar" dir="rtl">
    <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-finance-open="hub">חזרה לכספים</button>
    <strong>${escapeHtml(title)}</strong>
  </div>`;
}

function formatHours(value) {
  const n = Number(value) || 0;
  if (!n) return '0';
  return String(Number(n.toFixed(2)));
}

function attendanceTableHtml(entries = []) {
  if (!entries.length) return dsEmptyState('אין דיווחי נוכחות מאושרים להעברה לשכר בחודש זה.');
  const hourHeaders = FINANCE_HOUR_CATEGORIES.map((item) => `<th class="ds-fin-num">${escapeHtml(item.label)}</th>`).join('');
  const body = entries.map((entry) => {
    const hourCells = FINANCE_HOUR_CATEGORIES.map((item) => `<td class="ds-fin-num">${escapeHtml(formatHours(entry.hours?.[item.key]))}</td>`).join('');
    const fileCell = entry.hasFile
      ? `<button type="button" class="ds-fin-file" data-finance-file="${escapeHtml(entry.employeeId)}" title="פתיחת קובץ" aria-label="פתיחת קובץ">${hubIcon('file')}</button>`
      : '';
    return `<tr>
      <td>${escapeHtml(entry.team || '—')}</td>
      <td>${escapeHtml(entry.employeeName || '—')}</td>
      <td>${escapeHtml(entry.employmentType || '—')}</td>
      <td class="ds-fin-num">${entry.workDays || 0}</td>
      ${hourCells}
      <td class="ds-fin-num">${escapeHtml(formatHours(entry.kilometers))}</td>
      <td class="ds-fin-file-cell">${fileCell}</td>
      <td>${escapeHtml(entry.notes || '')}</td>
    </tr>`;
  }).join('');
  return dsTableWrap(`<table class="ds-table ds-fin-att-table" dir="rtl">
    <thead>
      <tr>
        <th rowspan="2">צוות</th>
        <th rowspan="2">שם העובד</th>
        <th rowspan="2">סוג העסקה</th>
        <th rowspan="2" class="ds-fin-num">ימי עבודה</th>
        <th colspan="6">סה״כ שעות</th>
        <th rowspan="2" class="ds-fin-num">סה״כ ק״מ</th>
        <th rowspan="2">קובץ</th>
        <th rowspan="2">הערות</th>
      </tr>
      <tr>${hourHeaders}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`);
}

function attendanceViewHtml(data, { state } = {}) {
  const month = data.attendanceMonth || currentFinanceMonthKey();
  const monthCache = data.attendanceByMonth?.[month];
  const exportType = normalizeFinanceAttendanceExportType(data.attendanceExportType);
  const summarized = summarizeFinanceAttendance(monthCache?.approvals || [], {
    employees: data.employees || []
  });
  const loading = data.attendanceLoading;
  const error = data.attendanceError;
  const body = error
    ? dsEmptyState(error)
    : loading && !monthCache
      ? dsEmptyState('טוען נתוני נוכחות…')
      : attendanceTableHtml(summarized.rows);
  const exportOptions = FINANCE_ATTENDANCE_EXPORT_OPTIONS.map((option) => `
    <option value="${escapeHtml(option.value)}"${exportType === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>
  `).join('');
  return dsScreenStack(`
    ${backBarHtml('דיווח נוכחות')}
    <div class="ds-fin-att-shell" dir="rtl">
      <div class="ds-fin-att-toolbar">
        <label class="ds-fin-att-field">חודש שכר
          <input class="ds-input" type="month" data-finance-month value="${escapeHtml(month)}">
        </label>
        <label class="ds-fin-att-field">סוג קובץ
          <select class="ds-input" data-finance-attendance-export-type>${exportOptions}</select>
        </label>
        <button type="button" class="ds-btn ds-btn--primary" data-finance-attendance-export>ייצוא לאקסל</button>
      </div>
      ${body}
    </div>
  `);
}

function saveStatusHtml(rowId, saveState = {}) {
  const status = saveState[rowId];
  if (status === 'saved') return '<span class="ds-fin-save is-saved">נשמר</span>';
  if (status === 'saving') return '<span class="ds-fin-save">שומר…</span>';
  if (status && status !== 'saved' && status !== 'saving') {
    return `<span class="ds-fin-save is-error">${escapeHtml(status)}</span>`;
  }
  return '<span class="ds-fin-save"></span>';
}

function collectionActivityRowHtml(activity, saveState = {}) {
  const id = escapeHtml(activityRowId(activity));
  const status = normalizeCollectionStatus(activity.collection_status);
  const expected = String(activity.expected_collection_date || '').slice(0, 10);
  return `<tr data-fin-activity-id="${id}">
    <td>${escapeHtml(activity.activity_name || '—')}</td>
    <td>${escapeHtml(activity.authority || '—')}</td>
    <td>${escapeHtml(activity.school || '—')}</td>
    <td>${escapeHtml(activity.funding || '—')}</td>
    <td class="ds-fin-num">${escapeHtml(money(activity.price))}</td>
    <td>${escapeHtml(activityStatusLabel(activity))}</td>
    <td>
      <select class="ds-input ds-fin-inline" data-fin-collect-field="collection_status" data-fin-activity-id="${id}">
        <option value="${FINANCE_COLLECTION_OPEN}"${status === FINANCE_COLLECTION_OPEN ? ' selected' : ''}>פתוח</option>
        <option value="${FINANCE_COLLECTION_CLOSED}"${status === FINANCE_COLLECTION_CLOSED ? ' selected' : ''}>סגור</option>
      </select>
    </td>
    <td>
      <input class="ds-input ds-fin-inline" type="date" data-fin-collect-field="expected_collection_date" data-fin-activity-id="${id}" value="${escapeHtml(expected)}">
    </td>
    <td>
      <input class="ds-input ds-fin-inline" type="text" data-fin-collect-field="finance_note" data-fin-activity-id="${id}" value="${escapeHtml(activity.finance_note || '')}" placeholder="הערה">
      ${saveStatusHtml(activityRowId(activity), saveState)}
    </td>
  </tr>`;
}

function payerCardHtml(group, tab, saveState = {}) {
  const openMeta = tab === 'all'
    ? `${group.activityCount} פעילויות · ${money(group.totalAmount)} · ${group.openCount} פתוחות`
    : `${group.activityCount} פעילויות · ${money(group.totalAmount)}`;
  const rows = group.activities.map((activity) => collectionActivityRowHtml(activity, saveState)).join('');
  return `<details class="ds-fin-payer">
    <summary>
      <span class="ds-fin-payer__title">${escapeHtml(group.label)}</span>
      <span class="ds-fin-payer__meta">${escapeHtml(openMeta)}</span>
    </summary>
    ${dsTableWrap(`<table class="ds-table ds-fin-pay-table" dir="rtl">
      <thead><tr>
        <th>פעילות</th>
        <th>רשות</th>
        <th>בית ספר</th>
        <th>גורם מימון</th>
        <th class="ds-fin-num">מחיר</th>
        <th>סטטוס פעילות</th>
        <th>סטטוס גבייה</th>
        <th>צפי לגבייה</th>
        <th>הערה</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`)}
  </details>`;
}

function collectionMonthLabel(monthKey) {
  if (monthKey === FINANCE_NO_END_DATE_MONTH_KEY) return FINANCE_NO_END_DATE_MONTH_LABEL;
  return attendanceMonthLabel(monthKey) || monthKey;
}

function collectionSummaryCardsHtml(totals = {}) {
  const cards = [
    { label: 'סכום כל הפעילויות', value: money(totals.totalAmount) },
    { label: 'סה״כ לגבייה', value: money(totals.openAmount) },
    { label: 'סה״כ גבייה שבוצעה', value: money(totals.closedAmount) }
  ];
  return `<div class="ds-fin-collect-summary" dir="rtl">
    ${cards.map((card) => `
      <article class="ds-fin-collect-summary-card">
        <span class="ds-fin-collect-summary-card__label">${escapeHtml(card.label)}</span>
        <strong class="ds-fin-collect-summary-card__value">${escapeHtml(card.value)}</strong>
      </article>
    `).join('')}
  </div>`;
}

function collectionMonthSectionHtml(month, tab, saveState = {}) {
  const payers = month.payers || [];
  if (!payers.length) return '';
  const body = payers.map((group) => payerCardHtml(group, tab, saveState)).join('');
  return `<section class="ds-fin-collect-month">
    <header class="ds-fin-collect-month__head">
      <h3 class="ds-fin-collect-month__title">${escapeHtml(collectionMonthLabel(month.monthKey))}</h3>
      <span class="ds-fin-collect-month__meta">${escapeHtml(`${month.activityCount} פעילויות · ${money(month.totalAmount)}`)}</span>
    </header>
    <div class="ds-fin-payers">${body}</div>
  </section>`;
}

function buildFinanceCollectionActivities(data) {
  return attachCollectionTracking(
    (data.collectionActivities || []).filter(isFinanceCollectionActivity),
    data.collectionTracking || []
  );
}

export function buildFinanceCollectionBodyHtml(data) {
  const tab = normalizeFinanceCollectionTab(data.collectionTab);
  const search = data.collectionSearch || '';
  const activities = buildFinanceCollectionActivities(data);
  const months = groupFinanceCollectionByEndMonth(activities, { tab, search });
  const emptyMessage = tab === FINANCE_COLLECTION_TAB_CLOSED
    ? 'אין פעילויות סגורות לגבייה.'
    : tab === FINANCE_COLLECTION_TAB_OPEN
      ? 'אין פעילויות פתוחות לגבייה.'
      : 'אין פעילויות לתצוגה.';
  if (data.collectionError) return dsEmptyState(data.collectionError);
  if (data.collectionLoading && data.collectionActivities == null) return dsEmptyState('טוען מעקב גבייה…');
  if (!months.length) return dsEmptyState(search ? 'לא נמצאו פעילויות התואמות לחיפוש.' : emptyMessage);
  return months.map((month) => collectionMonthSectionHtml(month, tab, data.collectionSaveState || {})).join('');
}

function syncFinanceCollectionTabs(root, tab) {
  root.querySelectorAll('[data-finance-collection-tab]').forEach((btn) => {
    const active = normalizeFinanceCollectionTab(btn.dataset.financeCollectionTab) === tab;
    btn.classList.toggle('is-active', active);
  });
}

function updateFinanceCollectionBody(root, visit) {
  const body = root.querySelector('[data-finance-collection-body]');
  if (!body) return;
  body.innerHTML = buildFinanceCollectionBodyHtml(visit);
}

function collectionViewHtml(data) {
  const tab = normalizeFinanceCollectionTab(data.collectionTab);
  const search = data.collectionSearch || '';
  const activities = buildFinanceCollectionActivities(data);
  const totals = summarizeFinanceCollectionTotals(activities);
  const body = buildFinanceCollectionBodyHtml(data);
  return dsScreenStack(`
    <div class="ds-fin-collect-shell" dir="rtl">
      ${backBarHtml('מעקב גבייה')}
      ${collectionSummaryCardsHtml(totals)}
      <div class="ds-fin-collect-toolbar">
        <label class="ds-fin-collect-search">
          <span class="ds-fin-collect-search__label">חיפוש</span>
          <input class="ds-input" type="search" data-finance-collection-search value="${escapeHtml(search)}" placeholder="שם פעילות, רשות, בית ספר או גורם משלם" autocomplete="off">
        </label>
        <div class="ds-fin-tabs" role="tablist">
          <button type="button" class="ds-fin-tab${tab === FINANCE_COLLECTION_TAB_OPEN ? ' is-active' : ''}" data-finance-collection-tab="${FINANCE_COLLECTION_TAB_OPEN}">פתוח</button>
          <button type="button" class="ds-fin-tab${tab === FINANCE_COLLECTION_TAB_CLOSED ? ' is-active' : ''}" data-finance-collection-tab="${FINANCE_COLLECTION_TAB_CLOSED}">סגור</button>
          <button type="button" class="ds-fin-tab${tab === FINANCE_COLLECTION_TAB_ALL ? ' is-active' : ''}" data-finance-collection-tab="${FINANCE_COLLECTION_TAB_ALL}">הכול</button>
        </div>
      </div>
      <div class="ds-fin-collect-body" data-finance-collection-body>${body}</div>
    </div>
  `);
}

function hubViewHtml() {
  return dsScreenStack(`
    ${dsPageHeader('כספים')}
    ${hubCardsHtml()}
  `);
}

function isFinanceCollectionActivity(row = {}) {
  return getActivityPeriodKey(row) === FINANCE_COLLECTION_ACTIVITY_PERIOD;
}

async function ensureAttendanceLoaded(data, api, monthKey) {
  const month = String(monthKey || data.attendanceMonth || currentFinanceMonthKey()).trim();
  data.attendanceMonth = month;
  if (data.attendanceByMonth?.[month]) return data.attendanceByMonth[month];
  data.attendanceLoading = true;
  data.attendanceError = '';
  const employeesPromise = data.employees
    ? Promise.resolve(data.employees)
    : (typeof api?.attendanceControlTeams === 'function'
      ? api.attendanceControlTeams().catch(() => [])
      : Promise.resolve([]));
  try {
    const [approvals, employees] = await Promise.all([
      api.listPayrollControlApprovals({ monthKey: month, statuses: ['approved_for_payroll'] }),
      employeesPromise
    ]);
    if (!data.employees) data.employees = Array.isArray(employees) ? employees : [];
    const payload = { approvals: Array.isArray(approvals) ? approvals : [] };
    data.attendanceByMonth = { ...(data.attendanceByMonth || {}), [month]: payload };
    return payload;
  } catch (error) {
    data.attendanceError = error?.message || 'טעינת נתוני הנוכחות נכשלה.';
    throw error;
  } finally {
    data.attendanceLoading = false;
  }
}

async function ensureCollectionLoaded(data, api) {
  if (data.collectionActivities && data.collectionPeriod === FINANCE_COLLECTION_ACTIVITY_PERIOD) return;
  data.collectionLoading = true;
  data.collectionError = '';
  try {
    const [activities, tracking] = await Promise.all([
      api.allActivities({
        select: FINANCE_COLLECTION_ACTIVITY_COLUMNS,
        activity_period: FINANCE_COLLECTION_ACTIVITY_PERIOD
      }),
      typeof api.listFinanceCollectionTracking === 'function'
        ? api.listFinanceCollectionTracking()
        : Promise.resolve([])
    ]);
    data.collectionPeriod = FINANCE_COLLECTION_ACTIVITY_PERIOD;
    data.collectionActivities = (Array.isArray(activities?.rows) ? activities.rows : [])
      .filter(isFinanceCollectionActivity);
    data.collectionTracking = Array.isArray(tracking) ? tracking : [];
  } catch (error) {
    data.collectionError = error?.message || 'טעינת מעקב הגבייה נכשלה.';
    throw error;
  } finally {
    data.collectionLoading = false;
  }
}

function findActivity(data, rowId) {
  return (data.collectionActivities || []).find((row) => activityRowId(row) === String(rowId || '').trim());
}

function findTracking(data, rowId) {
  const id = String(rowId || '').trim();
  return (data.collectionTracking || []).find((row) => String(row.activity_row_id || activityRowId(row)).trim() === id);
}

export const financeScreen = {
  load: async () => createFinanceVisitState(),

  render(data, { state } = {}) {
    if (!canAccessFinance(state?.user)) {
      return dsScreenStack(`${dsPageHeader('כספים', 'גישה מוגבלת')} ${dsEmptyState('אין הרשאה לצפייה בעמוד כספים.')}`);
    }
    const view = data?.view || 'hub';
    if (view === 'attendance') return attendanceViewHtml(data, { state });
    if (view === 'collection') return collectionViewHtml(data);
    return hubViewHtml();
  },

  bind({ root, data, state, api, rerender }) {
    if (!canAccessFinance(state?.user) || !root) return;
    const visit = data || {};
    if (typeof root._financeUnbind === 'function') root._financeUnbind();

    const refresh = () => rerender?.();
    const onClick = async (ev) => {
      const openBtn = ev.target.closest('[data-finance-open]');
      if (openBtn) {
        const nextView = String(openBtn.dataset.financeOpen || 'hub');
        visit.view = nextView;
        if (nextView === 'attendance') {
          refresh();
          try { await ensureAttendanceLoaded(visit, api, visit.attendanceMonth); }
          catch { /* shown via visit.attendanceError */ }
          refresh();
          return;
        }
        if (nextView === 'collection') {
          refresh();
          try { await ensureCollectionLoaded(visit, api); }
          catch { /* shown via visit.collectionError */ }
          refresh();
          return;
        }
        refresh();
        return;
      }

      const tabBtn = ev.target.closest('[data-finance-collection-tab]');
      if (tabBtn) {
        visit.collectionTab = normalizeFinanceCollectionTab(tabBtn.dataset.financeCollectionTab);
        syncFinanceCollectionTabs(root, visit.collectionTab);
        updateFinanceCollectionBody(root, visit);
        return;
      }

      const exportBtn = ev.target.closest('[data-finance-attendance-export]');
      if (exportBtn) {
        const month = visit.attendanceMonth || currentFinanceMonthKey();
        const monthCache = visit.attendanceByMonth?.[month];
        const summarized = summarizeFinanceAttendance(monthCache?.approvals || [], {
          employees: visit.employees || []
        });
        try {
          downloadFinanceAttendanceExcel(summarized.rows, month, {
            approvals: monthCache?.approvals || [],
            exportType: normalizeFinanceAttendanceExportType(visit.attendanceExportType)
          });
        }
        catch (error) { window.alert(error?.message || 'ייצוא Excel נכשל.'); }
        return;
      }

      const fileBtn = ev.target.closest('[data-finance-file]');
      if (fileBtn) {
        const month = visit.attendanceMonth || currentFinanceMonthKey();
        const summarized = summarizeFinanceAttendance(visit.attendanceByMonth?.[month]?.approvals || [], {
          employees: visit.employees || []
        });
        const entry = summarized.rows.find((row) => row.employeeId === String(fileBtn.dataset.financeFile || ''));
        if (!entry?.hasFile) return;
        let url = entry.fileUrl;
        if (!url) {
          const approval = (visit.attendanceByMonth?.[month]?.approvals || []).find((row) => String(row.employee_id || '') === entry.employeeId);
          if (approval?.pdf_path && api?.payrollControlApprovalSignedUrl && !/^https?:\/\//i.test(String(approval.pdf_path))) {
            try { url = (await api.payrollControlApprovalSignedUrl(approval.pdf_path)).signedUrl || ''; } catch { url = ''; }
          }
        }
        if (url) window.open(url, '_blank', 'noopener');
      }
    };

    const onChange = async (ev) => {
      const exportTypeSelect = ev.target.closest('[data-finance-attendance-export-type]');
      if (exportTypeSelect) {
        visit.attendanceExportType = normalizeFinanceAttendanceExportType(exportTypeSelect.value);
        return;
      }

      const monthInput = ev.target.closest('[data-finance-month]');
      if (monthInput) {
        visit.attendanceMonth = String(monthInput.value || '').trim() || currentFinanceMonthKey();
        refresh();
        try { await ensureAttendanceLoaded(visit, api, visit.attendanceMonth); }
        catch { /* shown via visit.attendanceError */ }
        refresh();
        return;
      }

      const field = ev.target.closest('[data-fin-collect-field]');
      if (!field) return;
      const rowId = String(field.dataset.finActivityId || '');
      const key = String(field.dataset.finCollectField || '');
      const activity = findActivity(visit, rowId);
      if (!activity || !key) return;
      const previous = {
        collection_status: normalizeCollectionStatus(activity.collection_status),
        expected_collection_date: String(activity.expected_collection_date || '').slice(0, 10) || null,
        finance_note: String(activity.finance_note || '')
      };
      const next = { ...previous };
      if (key === 'collection_status') next.collection_status = normalizeCollectionStatus(field.value);
      if (key === 'expected_collection_date') next.expected_collection_date = String(field.value || '').slice(0, 10) || null;
      if (key === 'finance_note') next.finance_note = String(field.value || '');
      try {
        const saved = await api.upsertFinanceCollectionTracking({
          activity_row_id: rowId,
          ...next
        });
        activity.collection_status = next.collection_status;
        activity.expected_collection_date = next.expected_collection_date || '';
        activity.finance_note = next.finance_note;
        const existing = findTracking(visit, rowId);
        const merged = {
          ...(existing || {}),
          ...(saved || {}),
          activity_row_id: rowId,
          collection_status: next.collection_status,
          expected_collection_date: next.expected_collection_date,
          finance_note: next.finance_note
        };
        if (existing) Object.assign(existing, merged);
        else visit.collectionTracking = [...(visit.collectionTracking || []), merged];
        visit.collectionSaveState = { ...(visit.collectionSaveState || {}), [rowId]: 'saved' };
      } catch (error) {
        activity.collection_status = previous.collection_status;
        activity.expected_collection_date = previous.expected_collection_date || '';
        activity.finance_note = previous.finance_note;
        visit.collectionSaveState = {
          ...(visit.collectionSaveState || {}),
          [rowId]: error?.message || 'השמירה נכשלה'
        };
      }
      refresh();
    };

    const onInput = (ev) => {
      if (ev.target.matches('[data-finance-collection-search]')) {
        clearTimeout(root._financeCollectionSearchTimer);
        root._financeCollectionSearchTimer = setTimeout(() => {
          visit.collectionSearch = ev.target.value || '';
          updateFinanceCollectionBody(root, visit);
        }, 250);
      }
    };

    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('input', onInput);
    root._financeUnbind = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('input', onInput);
      clearTimeout(root._financeCollectionSearchTimer);
    };
  }
};
