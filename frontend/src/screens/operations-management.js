import { escapeHtml } from './shared/html.js';
import { supabase } from '../supabase-client.js';
import { formatDateHe, formatDateHeWithWeekday, formatTimeRangeShort } from './shared/format-date.js';
import {
  dsPageHeader,
  dsCard,
  dsTableWrap,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  collectDependentFilterOptions
} from './shared/activity-list-filters.js';
import {
  ACTIVITY_SEASON_SUMMER_2026,
  ACTIVITY_SEASON_SCHOOL_2027,
  isSummerActivity
} from './shared/summer-activity.js';
import {
  parseLinkedSchoolsJson,
  getActivitySchoolNames,
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  isValidInstructorName,
  getActivityPrimaryDate,
  getActivityScheduleDates,
  getActivityAuthorityName,
  getActivityDistrict,
  getActivityName,
  getActivityTimeRange,
  getActivityGroupsCount,
  getActivityGradeLabel,
  getActivityAddress,
  getActivityContactName,
  getActivityContactPhone,
  getActivityOperationalNotes,
  activityMatchesPeriod,
  isActivityDeleted,
  activityDatesInRange,
  activityOverlapsDateRange,
  isSummerOperationsException,
  schoolGroupKey,
  buildActivitySearchText,
  buildWorkshopStockMapFromLists,
  buildWorkshopQuantityMetrics,
  getActivityActualParticipantCount,
  WORKSHOP_ESTIMATE_PER_ACTIVITY
} from './shared/operations-activity-helpers.js';

const SCOPE = 'operations-management';
const TAB_INSTRUCTORS = 'instructors';
const TAB_SUMMER = 'summer';
const TAB_WORKSHOPS = 'workshops';
const TAB_SCHOOLS = 'schools';

const PERIOD_OPTIONS = [
  { value: ACTIVITY_SEASON_SUMMER_2026, label: 'קיץ 2026' },
  { value: 'school_2026', label: 'תשפ״ו / 2026' },
  { value: ACTIVITY_SEASON_SCHOOL_2027, label: 'תשפ״ז / 2027' },
  { value: 'all', label: 'כל הפעילויות' }
];

const STATUS_OPTIONS = ['פתוח', 'סגור', 'בוטל', 'נמחק'];

const SORT_DEFAULTS = {
  [TAB_INSTRUCTORS]: { key: 'date', dir: 'asc' },
  [TAB_SUMMER]: { key: 'district', dir: 'asc' },
  [TAB_WORKSHOPS]: { key: 'activityCount', dir: 'desc' },
  [TAB_SCHOOLS]: { key: 'authority', dir: 'asc' }
};


const FILTER_FIELDS = [
  { key: 'district', label: 'מחוז / אזור', getValues: (row) => [getActivityDistrict(row)] },
  { key: 'authority', label: 'רשות', getValues: (row) => [getActivityAuthorityName(row)] },
  { key: 'school', label: 'בית ספר / מסגרת', getValues: getActivitySchoolNames },
  { key: 'instructor', label: 'מדריך', getValues: (row) => {
    const names = [row?.instructor_name, row?.instructor, row?.guide_name, row?.guide]
      .map((v) => String(v || '').trim())
      .filter(isValidInstructorName);
    return names.length ? names : [];
  } },
  { key: 'activity_name', label: 'שם סדנה / פעילות', getValues: (row) => [getActivityName(row)] },
  { key: 'status', label: 'סטטוס', getValues: (row) => [String(row?.status || '').trim()].filter(Boolean) }
];

const SEARCH_FIELDS = [
  (row) => buildActivitySearchText(row)
];

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultPeriodKey() {
  const month = isoToday().slice(0, 7);
  if (month >= '2026-06' && month <= '2026-08') return ACTIVITY_SEASON_SUMMER_2026;
  return 'school_2026';
}

function defaultDateRange(periodKey) {
  if (periodKey === ACTIVITY_SEASON_SUMMER_2026) {
    return { from: '2026-07-01', to: '2026-08-31' };
  }
  const from = isoToday();
  return { from, to: addDaysIso(from, 30) };
}

function ensureOpsState(state) {
  state.operationsManagement = state.operationsManagement || {};
  const ops = state.operationsManagement;
  if (!ops.tab) ops.tab = TAB_INSTRUCTORS;
  if (!ops.period) ops.period = defaultPeriodKey();
  if (!ops.dateFrom || !ops.dateTo) {
    const range = defaultDateRange(ops.period);
    ops.dateFrom = ops.dateFrom || range.from;
    ops.dateTo = ops.dateTo || range.to;
  }
  if (!ops.instructor) ops.instructor = '__all__';
  if (!ops.expandedWorkshop) ops.expandedWorkshop = '';
  if (!ops.expandedSchool) ops.expandedSchool = '';
  ops.selectedContactKeys = ops.selectedContactKeys || {};
  ops.sorts = ops.sorts || {};
  Object.entries(SORT_DEFAULTS).forEach(([tab, sort]) => {
    if (!ops.sorts[tab]) ops.sorts[tab] = { ...sort };
  });
  const filters = ensureActivityListFilters(state, SCOPE);
  if (!filters.status) filters.status = 'פתוח';
  return ops;
}

function prepareRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  list.forEach((row) => {
    if (!row || typeof row !== 'object') return;
    row.__searchText = buildActivitySearchText(row);
  });
  return prepareRowsForSearch(list, SEARCH_FIELDS);
}

function applyBaseFilters(rows, state) {
  const ops = ensureOpsState(state);
  const filters = ensureActivityListFilters(state, SCOPE);
  return rows.filter((row) => {
    if (isActivityDeleted(row) && String(filters.status || '').trim() !== 'נמחק') return false;
    if (!activityMatchesPeriod(row, ops.period)) return false;
    if (!activityOverlapsDateRange(row, ops.dateFrom, ops.dateTo)) return false;
    const status = String(row?.status || '').trim();
    const selectedStatus = String(filters.status || '').trim();
    if (selectedStatus && status !== selectedStatus) return false;
    return true;
  });
}

function applyAllFilters(rows, state) {
  const base = applyBaseFilters(rows, state);
  const filters = ensureActivityListFilters(state, SCOPE);
  return applyLocalFilters(base, filters, { filterFields: FILTER_FIELDS });
}

function filterOptionsHtml(fieldKey, label, options, selected) {
  return `<label class="ds-filter-field">
    <span class="ds-filter-field__label">${escapeHtml(label)}</span>
    <select class="ds-input ds-input--sm" data-ops-filter="${escapeHtml(fieldKey)}">
      <option value="">הכל</option>
      ${options.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`).join('')}
    </select>
  </label>`;
}

function topFiltersHtml(rows, state) {
  const ops = ensureOpsState(state);
  const filters = ensureActivityListFilters(state, SCOPE);
  const optionsMap = collectDependentFilterOptions(rows, FILTER_FIELDS, filters, filters.appliedQ || filters.q || '');
  FILTER_FIELDS.forEach((field) => {
    const selected = String(filters[field.key] || '').trim();
    if (selected && !(optionsMap[field.key] || []).includes(selected)) filters[field.key] = '';
  });

  return `<section class="ds-filter-panel ds-ops-mgmt-filters no-print" dir="rtl">
    <h2 class="ds-filter-panel__title">סינון וחיפוש</h2>
    <div class="ds-filter-panel__grid ds-ops-mgmt-filters__grid">
      <label class="ds-filter-field"><span class="ds-filter-field__label">מתאריך</span><input class="ds-input ds-input--sm" type="date" data-ops-date="from" value="${escapeHtml(ops.dateFrom || '')}"></label>
      <label class="ds-filter-field"><span class="ds-filter-field__label">עד תאריך</span><input class="ds-input ds-input--sm" type="date" data-ops-date="to" value="${escapeHtml(ops.dateTo || '')}"></label>
      <label class="ds-filter-field"><span class="ds-filter-field__label">תקופה</span>
        <select class="ds-input ds-input--sm" data-ops-period>
          ${PERIOD_OPTIONS.map((opt) => `<option value="${escapeHtml(opt.value)}"${opt.value === ops.period ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
        </select>
      </label>
      ${filterFieldsHtml(optionsMap, filters)}
      <label class="ds-filter-field ds-filter-field--search"><span class="ds-filter-field__label">חיפוש חופשי</span><input class="ds-input ds-input--sm" type="search" data-ops-search value="${escapeHtml(filters.q || '')}" placeholder="שם, רשות, בית ספר, מדריך…"></label>
      <div class="ds-filter-panel__actions ds-ops-mgmt-filters__actions">
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-ops-clear-filters">ניקוי פילטרים</button>
      </div>
    </div>
  </section>`;
}

function filterFieldsHtml(optionsMap, filters) {
  return FILTER_FIELDS.map((field) => filterOptionsHtml(
    field.key,
    field.label,
    optionsMap[field.key] || [],
    String(filters[field.key] || '').trim()
  )).join('');
}

function tabsHtml(activeTab) {
  const tabs = [
    [TAB_INSTRUCTORS, 'סידור מדריכים'],
    [TAB_SUMMER, 'תכנון קיץ'],
    [TAB_WORKSHOPS, 'כמויות סדנאות'],
    [TAB_SCHOOLS, 'לפי בתי ספר']
  ];
  return `<nav class="ds-exceptions-tabs ds-ops-mgmt-tabs no-print" aria-label="לשוניות ניהול תפעול" dir="rtl">
    ${tabs.map(([key, label]) => `<button type="button" class="ds-exceptions-tab ds-ops-mgmt-tab${activeTab === key ? ' is-active' : ''}" data-ops-tab="${escapeHtml(key)}" aria-pressed="${activeTab === key ? 'true' : 'false'}">${escapeHtml(label)}</button>`).join('')}
  </nav>`;
}

function summaryKpiHtml(items = []) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return '';
  return `<div class="ds-ops-mgmt-summary" dir="rtl">${list.map((item) => {
    const tone = item.tone === 'alert' ? ' ds-ops-mgmt-summary__card--alert' : (item.tone === 'ok' ? ' ds-ops-mgmt-summary__card--ok' : '');
    return `<article class="ds-ops-mgmt-summary__card${tone}">
      <span class="ds-ops-mgmt-summary__icon" aria-hidden="true">${escapeHtml(item.icon || '•')}</span>
      <span class="ds-ops-mgmt-summary__label">${escapeHtml(item.label)}</span>
      <strong class="ds-ops-mgmt-summary__value">${escapeHtml(String(item.value ?? ''))}</strong>
    </article>`;
  }).join('')}</div>`;
}

function getSummerExceptionTags(activity) {
  if (!isSummerActivity(activity)) return [];
  const tags = [];
  if (getActivityInstructorName(activity) === 'לא משויך') tags.push({ label: 'ללא מדריך', kind: 'warning' });
  if (!getActivityPrimaryDate(activity) && getActivityScheduleDates(activity).length === 0) {
    tags.push({ label: 'ללא תאריך', kind: 'danger' });
  }
  return tags;
}

function exceptionTagsHtml(activity) {
  const tags = getSummerExceptionTags(activity);
  if (!tags.length) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  return `<span class="ds-ops-mgmt-tags">${tags.map((tag) => dsStatusChip(tag.label, tag.kind)).join('')}</span>`;
}

function exceptionCountCell(count) {
  const value = Number(count || 0);
  if (!value) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  return dsStatusChip(String(value), 'warning');
}

function formatQuantityCell(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  }
  return escapeHtml(String(value));
}

function formatStockCell(value) {
  if (value === null || value === undefined || value === '') {
    return '<span class="ds-ops-mgmt-cell-muted">לא הוזן</span>';
  }
  return escapeHtml(String(value));
}

function formatGapCell(gap, hasStock) {
  if (!hasStock || gap === null || gap === undefined) {
    return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  }
  const value = Number(gap);
  if (!Number.isFinite(value)) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const tone = value < 0 ? 'ds-ops-gap--shortage' : 'ds-ops-gap--ok';
  return `<span class="ds-ops-gap ${tone}">${escapeHtml(String(value))}</span>`;
}

function workshopMetricsRows(rows, stockMap) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = getActivityName(row);
    if (!groups.has(name)) {
      groups.set(name, { name, activities: 0, items: [] });
    }
    const bucket = groups.get(name);
    bucket.activities += 1;
    bucket.items.push(row);
  });
  return Array.from(groups.values())
    .map((group) => buildWorkshopQuantityMetrics({
      workshopName: group.name,
      activityCount: group.activities,
      activities: group.items,
      stockMap
    }))
    .sort((a, b) => b.activityCount - a.activityCount);
}

function tabOverviewSummary(rows) {
  const instructors = instructorOptions(rows);
  const schools = uniqueSorted(rows.map(getActivitySchoolDisplayName).filter((name) => name !== 'לא משויך'));
  const authorities = uniqueSorted(rows.map(getActivityAuthorityName));
  const exceptions = rows.filter(isSummerOperationsException).length;
  const items = [
    { icon: '📋', label: 'פעילויות', value: rows.length },
    { icon: '👥', label: 'מדריכים', value: instructors.length },
    { icon: '🏫', label: 'בתי ספר / מסגרות', value: schools.length },
    { icon: '🏛️', label: 'רשויות', value: authorities.length }
  ];
  if (exceptions > 0) items.push({ icon: '⚠️', label: 'חריגות קיץ', value: exceptions, tone: 'alert' });
  return summaryKpiHtml(items);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.map((v) => String(v || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'he'));
}

function getTabSort(state, tabKey) {
  const ops = ensureOpsState(state);
  const tab = tabKey || ops.tab || TAB_INSTRUCTORS;
  ops.sorts = ops.sorts || {};
  if (!ops.sorts[tab]) ops.sorts[tab] = { ...(SORT_DEFAULTS[tab] || { key: '', dir: 'asc' }) };
  return ops.sorts[tab];
}

function sortIndicatorHtml(state, tabKey, key) {
  const sort = getTabSort(state, tabKey);
  if (sort.key !== key) return '';
  return `<span class="ds-sort-indicator" aria-hidden="true">${sort.dir === 'desc' ? '▼' : '▲'}</span>`;
}

function sortableTh(state, tabKey, key, label, className = '') {
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  return `<th${classAttr}><button type="button" class="ds-sort-button" data-ops-sort="${escapeHtml(key)}" data-ops-sort-tab="${escapeHtml(tabKey)}">${escapeHtml(label)} ${sortIndicatorHtml(state, tabKey, key)}</button></th>`;
}

function compareValues(a, b, dir = 'asc') {
  const multiplier = dir === 'desc' ? -1 : 1;
  const emptyA = a === null || a === undefined || a === '';
  const emptyB = b === null || b === undefined || b === '';
  if (emptyA && emptyB) return 0;
  if (emptyA) return 1;
  if (emptyB) return -1;
  const numA = Number(a);
  const numB = Number(b);
  if (Number.isFinite(numA) && Number.isFinite(numB)) {
    return (numA - numB) * multiplier;
  }
  return String(a).localeCompare(String(b), 'he', { numeric: true }) * multiplier;
}

function sortByConfig(list, state, tabKey, valueGetters = {}) {
  const sort = getTabSort(state, tabKey);
  const getter = valueGetters[sort.key];
  if (!getter) return list;
  return list.sort((a, b) => compareValues(getter(a), getter(b), sort.dir));
}

function scheduleSortValue(entry, key) {
  const activity = entry.activity || {};
  const map = {
    date: entry.date || '',
    weekday: entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '',
    time: entry.time || '',
    authority: getActivityAuthorityName(activity),
    school: getActivitySchoolDisplayName(activity),
    activity: getActivityName(activity),
    groups: getActivityGroupsCount(activity) || '',
    grade: getActivityGradeLabel(activity) || '',
    address: getActivityAddress(activity) || '',
    contact: getActivityContactName(activity) || '',
    phone: getActivityContactPhone(activity) || '',
    notes: getActivityOperationalNotes(activity) || ''
  };
  return map[key] ?? '';
}

function sortScheduleRows(schedule, state) {
  const sort = getTabSort(state, TAB_INSTRUCTORS);
  schedule.sort((a, b) => {
    const primary = compareValues(scheduleSortValue(a, sort.key), scheduleSortValue(b, sort.key), sort.dir);
    if (primary !== 0) return primary;
    const dateCmp = compareValues(a.date || '9999-99-99', b.date || '9999-99-99', 'asc');
    if (dateCmp !== 0) return dateCmp;
    if (a.hasTime && !b.hasTime) return -1;
    if (!a.hasTime && b.hasTime) return 1;
    return getActivityName(a.activity).localeCompare(getActivityName(b.activity), 'he');
  });
  return schedule;
}

function openOpsPrintWindow({ title = 'הדפסה', bodyHtml = '' } = {}) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.');
    return;
  }
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      direction: rtl;
      font-family: Assistant, Arial, sans-serif;
      margin: 18px;
      color: #111827;
      background: #fff;
      font-size: 12px;
      line-height: 1.45;
    }
    h1, h2, h3 { margin: 0 0 8px; color: #0f172a; }
    p { margin: 0 0 10px; }
    .ds-ops-mgmt-summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(120px, 1fr));
      gap: 8px;
      margin: 12px 0;
    }
    .ds-ops-mgmt-summary__card {
      border: 1px solid #dbe4ef;
      border-radius: 10px;
      padding: 8px;
      background: #f8fafc;
    }
    .ds-ops-mgmt-summary__icon { display: none; }
    .ds-ops-mgmt-summary__label { display: block; color: #64748b; font-size: 11px; }
    .ds-ops-mgmt-summary__value { display: block; font-size: 16px; margin-top: 2px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      table-layout: auto;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 6px 7px;
      vertical-align: top;
      text-align: right;
    }
    th {
      background: #e6f6fb;
      color: #0f172a;
      font-weight: 700;
    }
    tr:nth-child(even) td { background: #f8fafc; }
    .ds-sort-button {
      border: 0;
      background: transparent;
      padding: 0;
      font: inherit;
      color: inherit;
    }
    .ds-sort-indicator,
    .no-print,
    button,
    .ds-link-btn {
      display: none !important;
    }
    .only-print { display: block !important; }
    .ds-ops-mgmt-print-footer {
      margin-top: 14px;
      font-weight: 600;
    }
    @page {
      size: A4 landscape;
      margin: 12mm;
    }
    @media print {
      body { margin: 0; }
      tr { break-inside: avoid; }
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function printScheduleFromDom(root) {
  const table = root.querySelector('.ds-ops-mgmt-schedule');
  if (!table || !table.querySelector('tbody tr')) {
    alert('אין פעילויות להדפסה בטווח הנבחר');
    return;
  }
  const panel = root.querySelector('.ds-ops-mgmt-panel');
  const header = panel?.querySelector('.ds-ops-mgmt-print-header')?.innerHTML || '<h2>סידור עבודה</h2>';
  const summary = panel?.querySelector('.ds-ops-mgmt-summary')?.outerHTML || '';
  const footer = panel?.querySelector('.ds-ops-mgmt-print-footer')?.outerHTML || '';
  openOpsPrintWindow({
    title: 'סידור עבודה',
    bodyHtml: `<section>${header}${summary}${table.outerHTML}${footer}</section>`
  });
}

function printWorkshopsFromDom(root) {
  const table = root.querySelector('.ds-ops-workshops-table');
  if (!table || !table.querySelector('tbody tr')) {
    alert('אין כמויות סדנאות להדפסה בטווח הנבחר');
    return;
  }
  const panel = root.querySelector('.ds-ops-workshops-panel');
  const header = panel?.querySelector('.ds-ops-mgmt-print-header')?.innerHTML || '<h2>כמויות סדנאות</h2>';
  const summary = panel?.querySelector('.ds-ops-mgmt-summary')?.outerHTML || '';
  openOpsPrintWindow({
    title: 'כמויות סדנאות',
    bodyHtml: `<section>${header}${summary}${table.outerHTML}</section>`
  });
}


function normalizeOpsText(value) {
  return String(value || '')
    .trim()
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function nonEmptyOpsValue(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function normalizeDirectoryRow(row = {}) {
  // מקור ההשלמה לעמוד ניהול תפעול הוא טבלת schools.
  // השדות העיקריים שם: school_name, authority, institution_address, city,
  // principal_name, school_phone, semel_mosad.
  const authorityName = nonEmptyOpsValue(row.authority_name, row.authority, row.client_authority, row.client_name);
  const schoolName = nonEmptyOpsValue(row.school_name, row.school, row.school_framework);
  const city = nonEmptyOpsValue(row.city);
  const rawAddress = nonEmptyOpsValue(row.institution_address, row.school_address, row.address);
  const address = rawAddress && city && !normalizeOpsText(rawAddress).includes(normalizeOpsText(city))
    ? `${rawAddress}, ${city}`
    : nonEmptyOpsValue(rawAddress, city);
  const principalName = nonEmptyOpsValue(row.principal_name, row.contact_name, row.contact, row.client_name);
  const phone = nonEmptyOpsValue(row.school_phone, row.mobile, row.phone);
  return {
    ...row,
    authority_id: row.authority_id ?? row.AuthorityID ?? '',
    school_id: row.school_id ?? row.id ?? row.SchoolID ?? '',
    semel_mosad: row.semel_mosad ?? row.semel ?? '',
    authority_name: authorityName,
    authority: authorityName,
    school_name: schoolName,
    school: schoolName,
    school_address: address,
    institution_address: rawAddress,
    city,
    principal_name: principalName,
    contact_name: principalName,
    contact_role: principalName ? nonEmptyOpsValue(row.contact_role, row.role, row.title, 'מנהל/ת בית הספר') : nonEmptyOpsValue(row.contact_role, row.role, row.title),
    phone,
    mobile: phone,
    email: nonEmptyOpsValue(row.email, row.mail)
  };
}

function contactHasDetails(contact = {}) {
  return Boolean(
    String(contact.contact_name || '').trim()
    || String(contact.phone || contact.mobile || '').trim()
    || String(contact.email || '').trim()
  );
}

function contactKey(contact = {}) {
  return [
    contact.contact_name,
    contact.contact_role,
    contact.phone || contact.mobile,
    contact.email
  ].map((value) => normalizeOpsText(value)).join('|');
}

function contactLabel(contact = {}) {
  const parts = [
    contact.school_name || contact.school,
    contact.contact_name,
    contact.contact_role,
    contact.phone || contact.mobile,
    contact.email
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' — ') : '—';
}

function buildOperationsDirectory(rows = []) {
  const normalized = (Array.isArray(rows) ? rows : []).map(normalizeDirectoryRow);
  const byAuthority = new Map();
  const bySchoolId = new Map();
  const bySchoolKey = new Map();
  const contactsByAuthority = new Map();
  const contactsBySchoolId = new Map();
  const contactsBySchoolKey = new Map();

  const add = (map, key, row) => {
    const safeKey = String(key || '').trim();
    if (!safeKey) return;
    if (!map.has(safeKey)) map.set(safeKey, []);
    map.get(safeKey).push(row);
  };

  normalized.forEach((row) => {
    const authorityKey = normalizeOpsText(row.authority_name || row.authority);
    const schoolKey = `${authorityKey}|${normalizeOpsText(row.school_name || row.school)}`;
    const schoolId = String(row.school_id || '').trim();
    add(byAuthority, authorityKey, row);
    if (schoolId) add(bySchoolId, schoolId, row);
    if (row.school_name || row.school) add(bySchoolKey, schoolKey, row);
    if (contactHasDetails(row)) {
      add(contactsByAuthority, authorityKey, row);
      if (schoolId) add(contactsBySchoolId, schoolId, row);
      if (row.school_name || row.school) add(contactsBySchoolKey, schoolKey, row);
    }
  });

  return {
    rows: normalized,
    byAuthority,
    bySchoolId,
    bySchoolKey,
    contactsByAuthority,
    contactsBySchoolId,
    contactsBySchoolKey
  };
}

async function readOperationsSchoolsDirectory() {
  if (!supabase) return { rows: [], source: 'none' };
  try {
    const { data, error } = await supabase
      .from('schools')
      .select('id, semel_mosad, school_name, authority, authority_id, district, principal_name, school_phone, institution_address, city')
      .limit(10000);
    if (error) throw error;
    return { rows: Array.isArray(data) ? data : [], source: 'schools' };
  } catch (error) {
    console.warn('[operations-management] schools directory read failed', error?.message || error);
    return { rows: [], source: 'error' };
  }
}

function getActivitySchoolId(activity = {}) {
  return String(activity.school_id || activity.single_school_id || '').trim();
}

function getActivityAuthorityKey(activity = {}) {
  return normalizeOpsText(getActivityAuthorityName(activity) || activity.authority_name || activity.legacy_authority || activity.authority);
}

function getActivityDirectorySchoolKeys(activity = {}) {
  const authorityKey = getActivityAuthorityKey(activity);
  const names = getActivitySchoolNames(activity);
  return names.map((name) => `${authorityKey}|${normalizeOpsText(name)}`).filter((key) => key !== `${authorityKey}|`);
}

function uniqueRowsByDirectoryKey(rows = []) {
  const seen = new Set();
  const result = [];
  rows.forEach((row) => {
    const key = [row.school_id, row.school_name, row.school_address, row.contact_name, row.phone || row.mobile, row.email]
      .map((value) => String(value || '').trim()).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function findDirectorySchoolsForActivity(activity, directory) {
  const found = [];
  const schoolId = getActivitySchoolId(activity);
  if (schoolId && directory?.bySchoolId?.has(schoolId)) found.push(...directory.bySchoolId.get(schoolId));
  getActivityDirectorySchoolKeys(activity).forEach((key) => {
    if (directory?.bySchoolKey?.has(key)) found.push(...directory.bySchoolKey.get(key));
  });
  return uniqueRowsByDirectoryKey(found);
}

function getActivityAddressResolved(activity, directory) {
  const direct = nonEmptyOpsValue(getActivityAddress(activity));
  if (direct) return direct;
  const schoolRows = findDirectorySchoolsForActivity(activity, directory);
  const addresses = uniqueSorted(schoolRows.map((row) => nonEmptyOpsValue(row.school_address, row.institution_address, row.address, row.city)));
  return addresses.join('; ');
}

function getActivityContactOptions(activity, directory) {
  const options = [];
  const add = (rows = []) => {
    rows.forEach((row) => {
      const contact = normalizeDirectoryRow(row);
      if (contactHasDetails(contact)) options.push(contact);
    });
  };

  const directName = nonEmptyOpsValue(getActivityContactName(activity));
  const directPhone = nonEmptyOpsValue(getActivityContactPhone(activity));
  if (directName || directPhone) {
    options.push({
      contact_name: directName,
      contact_role: nonEmptyOpsValue(activity?.contact_role, activity?.contactRole),
      phone: directPhone,
      mobile: directPhone,
      email: nonEmptyOpsValue(activity?.contact_email, activity?.email)
    });
  }

  const schoolId = getActivitySchoolId(activity);
  if (schoolId && directory?.contactsBySchoolId?.has(schoolId)) add(directory.contactsBySchoolId.get(schoolId));
  getActivityDirectorySchoolKeys(activity).forEach((key) => {
    if (directory?.contactsBySchoolKey?.has(key)) add(directory.contactsBySchoolKey.get(key));
  });
  const authorityKey = getActivityAuthorityKey(activity);
  if (authorityKey && directory?.contactsByAuthority?.has(authorityKey)) add(directory.contactsByAuthority.get(authorityKey));

  const seen = new Set();
  return options.filter((contact) => {
    const key = contactKey(contact);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scheduleEntryKey(entry = {}) {
  return [String(entry.activity?.row_id || entry.activity?.id || ''), String(entry.date || '')].join('|');
}

function selectedContactForEntry(entry, directory, ops) {
  const options = getActivityContactOptions(entry.activity, directory);
  if (!options.length) return { options, selected: null, selectedKey: '' };
  const entryKey = scheduleEntryKey(entry);
  const requested = String(ops?.selectedContactKeys?.[entryKey] || '').trim();
  let selected = requested ? options.find((contact) => contactKey(contact) === requested) : null;
  if (!selected) selected = options[0];
  return { options, selected, selectedKey: contactKey(selected), entryKey };
}

function contactSelectCellHtml(entry, directory, ops) {
  const { options, selected, selectedKey, entryKey } = selectedContactForEntry(entry, directory, ops);
  if (!options.length || !selected) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const label = contactLabel(selected);
  if (options.length === 1) {
    return `<span class="ds-ops-contact-label">${escapeHtml(label)}</span>`;
  }
  return `<span class="ds-ops-contact-picker">
    <select class="ds-input ds-input--xs no-print" data-ops-row-contact="${escapeHtml(entryKey)}" title="בחירת איש קשר">
      ${options.map((contact) => {
        const key = contactKey(contact);
        return `<option value="${escapeHtml(key)}"${key === selectedKey ? ' selected' : ''}>${escapeHtml(contactLabel(contact))}</option>`;
      }).join('')}
    </select>
    <span class="only-print">${escapeHtml(label)}</span>
  </span>`;
}

function contactPhoneCellHtml(entry, directory, ops) {
  const { selected } = selectedContactForEntry(entry, directory, ops);
  const phone = nonEmptyOpsValue(selected?.phone, selected?.mobile, getActivityContactPhone(entry.activity));
  return phone ? escapeHtml(phone) : '<span class="ds-ops-mgmt-cell-muted">—</span>';
}

function directorySourceNoteHtml(data = {}) {
  const count = Array.isArray(data?.schoolsDirectoryRows) ? data.schoolsDirectoryRows.length : 0;
  if (!count) return '';
  return `<p class="ds-ops-mgmt-note ds-ops-mgmt-note--contacts no-print" dir="rtl">כתובת, סמל מוסד, מנהל/ת וטלפון משלימים נטענים מטבלת schools לפי רשות ובית ספר.</p>`;
}

function instructorOptions(rows) {
  const names = new Set();
  rows.forEach((row) => {
    [row?.instructor_name, row?.instructor, row?.guide_name, row?.guide].forEach((value) => {
      const name = String(value || '').trim();
      if (isValidInstructorName(name)) names.add(name);
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'he'));
}

function buildScheduleRows(rows, state) {
  const ops = ensureOpsState(state);
  const selectedInstructor = String(ops.instructor || '__all__').trim();
  const schedule = [];

  rows.forEach((activity) => {
    const instructor = getActivityInstructorName(activity);
    if (selectedInstructor !== '__all__' && instructor !== selectedInstructor) return;
    const dates = activityDatesInRange(activity, ops.dateFrom, ops.dateTo);
    const targetDates = dates.length ? dates : (getActivityPrimaryDate(activity) ? [getActivityPrimaryDate(activity)] : ['']);
    targetDates.forEach((date) => {
      schedule.push({
        date,
        activity,
        instructor,
        time: getActivityTimeRange(activity) || formatTimeRangeShort(activity?.start_time, activity?.end_time),
        hasTime: Boolean(getActivityTimeRange(activity) || activity?.start_time || activity?.StartTime)
      });
    });
  });

  return sortScheduleRows(schedule, state);
}

function instructorSummary(rows, state, scheduleRows) {
  const ops = ensureOpsState(state);
  const selected = String(ops.instructor || '__all__').trim();
  if (selected === '__all__') return '';
  const workDays = uniqueSorted(scheduleRows.map((row) => row.date).filter(Boolean)).length;
  const authorities = uniqueSorted(rows.map(getActivityAuthorityName));
  const schools = uniqueSorted(rows.map(getActivitySchoolDisplayName).filter((name) => name !== 'לא משויך'));
  return summaryKpiHtml([
    { icon: '👤', label: 'מדריך', value: selected },
    { icon: '📅', label: 'ימי עבודה', value: workDays },
    { icon: '📋', label: 'פעילויות', value: rows.length },
    { icon: '🏫', label: 'בתי ספר / מסגרות', value: schools.length },
    { icon: '🏛️', label: 'רשויות', value: authorities.length }
  ]);
}

function instructorsTabHtml(rows, state, data = {}, directory = buildOperationsDirectory([])) {
  const ops = ensureOpsState(state);
  const instructors = instructorOptions(rows);
  if (ops.instructor === '__all__' && instructors.length === 1) ops.instructor = instructors[0];
  const scheduleRows = buildScheduleRows(rows, state);
  const selected = String(ops.instructor || '__all__').trim();
  const printTitle = selected === '__all__' ? 'כל המדריכים' : selected;

  const tableRows = scheduleRows.map((entry) => {
    const activity = entry.activity;
    return `<tr>
      <td class="ds-ops-col--date"><strong>${escapeHtml(formatDateHe(entry.date) || '—')}</strong></td>
      <td class="ds-ops-col--weekday">${escapeHtml(entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '—')}</td>
      <td class="ds-ops-col--time">${escapeHtml(entry.time || '—')}</td>
      <td>${escapeHtml(getActivityAuthorityName(activity))}</td>
      <td class="ds-ops-col--school"><strong>${escapeHtml(getActivitySchoolDisplayName(activity))}</strong></td>
      <td>${escapeHtml(getActivityName(activity))}</td>
      <td class="ds-ops-col--groups">${escapeHtml(getActivityGroupsCount(activity) || '—')}</td>
      <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
      <td class="ds-ops-col--address">${escapeHtml(getActivityAddressResolved(activity, directory) || '—')}</td>
      <td class="ds-ops-col--contact">${contactSelectCellHtml(entry, directory, ops)}</td>
      <td class="ds-ops-col--phone">${contactPhoneCellHtml(entry, directory, ops)}</td>
      <td class="ds-ops-col--notes">${escapeHtml(getActivityOperationalNotes(activity) || '—')}</td>
    </tr>`;
  }).join('');

  const table = scheduleRows.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-schedule">
      <thead><tr>
        ${sortableTh(state, TAB_INSTRUCTORS, 'date', 'תאריך', 'ds-ops-col--date')}${sortableTh(state, TAB_INSTRUCTORS, 'weekday', 'יום', 'ds-ops-col--weekday')}${sortableTh(state, TAB_INSTRUCTORS, 'time', 'שעה', 'ds-ops-col--time')}${sortableTh(state, TAB_INSTRUCTORS, 'authority', 'רשות')}${sortableTh(state, TAB_INSTRUCTORS, 'school', 'בית ספר / מסגרת')}${sortableTh(state, TAB_INSTRUCTORS, 'activity', 'פעילות')}
        ${sortableTh(state, TAB_INSTRUCTORS, 'groups', 'קבוצות', 'ds-ops-col--groups')}${sortableTh(state, TAB_INSTRUCTORS, 'grade', 'שכבה / כיתה', 'ds-ops-col--grade')}${sortableTh(state, TAB_INSTRUCTORS, 'address', 'כתובת', 'ds-ops-col--address')}${sortableTh(state, TAB_INSTRUCTORS, 'contact', 'איש קשר', 'ds-ops-col--contact')}${sortableTh(state, TAB_INSTRUCTORS, 'phone', 'טלפון', 'ds-ops-col--phone')}${sortableTh(state, TAB_INSTRUCTORS, 'notes', 'הערות', 'ds-ops-col--notes')}
      </tr></thead><tbody>${tableRows}</tbody></table>`)
    : dsEmptyState('לא נמצאו פעילויות בטווח הנבחר');

  const instructorRows = selected === '__all__'
    ? rows
    : rows.filter((row) => getActivityInstructorName(row) === selected);

  const activeSummary = selected === '__all__'
    ? tabOverviewSummary(rows)
    : instructorSummary(instructorRows, state, scheduleRows);

  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    ${activeSummary}
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <label class="ds-filter-field ds-ops-mgmt-instructor-field"><span class="ds-filter-field__label">מדריך לסידור</span>
        <select class="ds-input ds-input--sm" data-ops-instructor>
          <option value="__all__"${selected === '__all__' ? ' selected' : ''}>כל המדריכים</option>
          ${instructors.map((name) => `<option value="${escapeHtml(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
        </select>
      </label>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print>הדפס סידור מדריך</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print">
      <h2>סידור עבודה למדריך: ${escapeHtml(printTitle)}</h2>
      <p>טווח תאריכים: ${escapeHtml(formatDateHe(ops.dateFrom))}–${escapeHtml(formatDateHe(ops.dateTo))}</p>
    </div>
    ${directorySourceNoteHtml(data)}
    ${dsCard({ title: 'טבלת סידור עבודה', badge: String(scheduleRows.length), body: table, padded: false })}
    <p class="ds-ops-mgmt-print-footer only-print">יש לבדוק את פרטי הפעילות לפני הגעה. במקרה של שינוי, יש לעדכן את התפעול.</p>
  </section>`;
}

function summerTabHtml(rows, state) {
  const summerRows = rows.filter(isSummerActivity);
  const instructors = uniqueSorted(summerRows.map(getActivityInstructorName).filter((name) => name !== 'לא משויך'));
  const authorities = uniqueSorted(summerRows.map(getActivityAuthorityName));
  const schools = uniqueSorted(summerRows.map(getActivitySchoolDisplayName).filter((name) => name !== 'לא משויך'));
  const workshops = uniqueSorted(summerRows.map(getActivityName));
  const exceptions = summerRows.filter(isSummerOperationsException).length;

  const byDistrict = new Map();
  summerRows.forEach((row) => {
    const key = getActivityDistrict(row);
    if (!byDistrict.has(key)) {
      byDistrict.set(key, { district: key, authorities: new Set(), schools: new Set(), activities: 0, instructors: new Set(), exceptions: 0 });
    }
    const bucket = byDistrict.get(key);
    bucket.activities += 1;
    bucket.authorities.add(getActivityAuthorityName(row));
    bucket.schools.add(getActivitySchoolDisplayName(row));
    const instructor = getActivityInstructorName(row);
    if (instructor !== 'לא משויך') bucket.instructors.add(instructor);
    if (isSummerOperationsException(row)) bucket.exceptions += 1;
  });

  const districtRows = sortByConfig(Array.from(byDistrict.values()), state, TAB_SUMMER, {
    district: (row) => row.district,
    authorities: (row) => row.authorities.size,
    schools: (row) => row.schools.size,
    activities: (row) => row.activities,
    instructors: (row) => row.instructors.size,
    exceptions: (row) => row.exceptions
  });
  const districtTable = districtRows.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-table--interactive ds-ops-mgmt-data-table">
      <thead><tr>${sortableTh(state, TAB_SUMMER, 'district', 'מחוז / אזור')}${sortableTh(state, TAB_SUMMER, 'authorities', 'רשויות')}${sortableTh(state, TAB_SUMMER, 'schools', 'בתי ספר')}${sortableTh(state, TAB_SUMMER, 'activities', 'פעילויות')}${sortableTh(state, TAB_SUMMER, 'instructors', 'מדריכים')}${sortableTh(state, TAB_SUMMER, 'exceptions', 'חריגות')}</tr></thead>
      <tbody>${districtRows.map((row) => `<tr data-ops-district="${escapeHtml(row.district)}"><td><button type="button" class="ds-link-btn" data-ops-district="${escapeHtml(row.district)}">${escapeHtml(row.district)}</button></td><td>${row.authorities.size}</td><td>${row.schools.size}</td><td>${row.activities}</td><td>${row.instructors.size}</td><td>${exceptionCountCell(row.exceptions)}</td></tr>`).join('')}</tbody>
    </table>`)
    : dsEmptyState('אין פעילויות קיץ בטווח הנבחר');

  const byInstructor = new Map();
  summerRows.forEach((row) => {
    const instructor = getActivityInstructorName(row);
    if (!byInstructor.has(instructor)) {
      byInstructor.set(instructor, { instructor, activities: 0, days: new Set(), authorities: new Set(), schools: new Set(), exceptions: 0 });
    }
    const bucket = byInstructor.get(instructor);
    bucket.activities += 1;
    activityDatesInRange(row, state.operationsManagement.dateFrom, state.operationsManagement.dateTo).forEach((date) => bucket.days.add(date));
    bucket.authorities.add(getActivityAuthorityName(row));
    bucket.schools.add(getActivitySchoolDisplayName(row));
    if (isSummerOperationsException(row)) bucket.exceptions += 1;
  });
  const instructorRows = Array.from(byInstructor.values()).sort((a, b) => a.instructor.localeCompare(b.instructor, 'he'));

  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    ${summaryKpiHtml([
      { icon: '☀️', label: 'פעילויות קיץ', value: summerRows.length },
      { icon: '👥', label: 'מדריכים פעילים', value: instructors.length },
      { icon: '🏛️', label: 'רשויות', value: authorities.length },
      { icon: '🏫', label: 'בתי ספר / מסגרות', value: schools.length },
      { icon: '🎨', label: 'סדנאות שונות', value: workshops.length },
      { icon: '⚠️', label: 'חריגות קיץ', value: exceptions, tone: exceptions ? 'alert' : 'ok' }
    ])}
    ${dsCard({ title: 'לפי אזורים / מחוזות', body: districtTable, padded: false })}
    ${instructorRows.length ? dsCard({
      title: 'לפי מדריכים בקיץ',
      body: dsTableWrap(`<table class="ds-table ds-table--compact ds-table--interactive ds-ops-mgmt-data-table">
      <thead><tr><th>מדריך</th><th>פעילויות</th><th>ימי עבודה</th><th>רשויות</th><th>בתי ספר</th><th>חריגות</th></tr></thead>
      <tbody>${instructorRows.map((row) => `<tr><td class="ds-ops-col--instructor"><button type="button" class="ds-link-btn" data-ops-instructor-jump="${escapeHtml(row.instructor)}">${escapeHtml(row.instructor)}</button></td><td>${row.activities}</td><td>${row.days.size}</td><td>${escapeHtml(Array.from(row.authorities).join(' · '))}</td><td>${escapeHtml(Array.from(row.schools).join(' · '))}</td><td>${exceptionCountCell(row.exceptions)}</td></tr>`).join('')}</tbody>
    </table>`),
      padded: false
    }) : dsCard({ title: 'לפי מדריכים בקיץ', body: dsEmptyState('אין מדריכים בקיץ'), padded: true })}
  </section>`;
}

function workshopsTabHtml(rows, state, stockMap) {
  const ops = ensureOpsState(state);
  const metrics = sortByConfig(workshopMetricsRows(rows, stockMap), state, TAB_WORKSHOPS, {
    workshopName: (row) => row.workshopName,
    activityCount: (row) => row.activityCount,
    estimatedQuantity: (row) => row.estimatedQuantity,
    actualQuantity: (row) => row.actualQuantity ?? '',
    stockQuantity: (row) => row.stockQuantity ?? '',
    gap: (row) => row.gap ?? ''
  });
  const groupsByName = new Map();
  rows.forEach((row) => {
    const name = getActivityName(row);
    if (!groupsByName.has(name)) groupsByName.set(name, []);
    groupsByName.get(name).push(row);
  });

  const table = metrics.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-table--interactive ds-ops-mgmt-data-table ds-ops-workshops-table">
      <thead><tr>
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopName', 'שם סדנה')}
        ${sortableTh(state, TAB_WORKSHOPS, 'activityCount', 'מספר סדנאות')}
        ${sortableTh(state, TAB_WORKSHOPS, 'estimatedQuantity', `כמות משוערת לפי ${WORKSHOP_ESTIMATE_PER_ACTIVITY}`)}
        ${sortableTh(state, TAB_WORKSHOPS, 'actualQuantity', 'כמות בפועל')}
        ${sortableTh(state, TAB_WORKSHOPS, 'stockQuantity', 'כמות במלאי')}
        ${sortableTh(state, TAB_WORKSHOPS, 'gap', 'פער מול מלאי')}
      </tr></thead>
      <tbody>${metrics.map((row) => `<tr>
        <td><button type="button" class="ds-link-btn" data-ops-workshop="${escapeHtml(row.workshopName)}">${escapeHtml(row.workshopName)}</button></td>
        <td>${row.activityCount}</td>
        <td>${row.estimatedQuantity}</td>
        <td>${formatQuantityCell(row.actualQuantity)}</td>
        <td>${formatStockCell(row.stockQuantity)}</td>
        <td>${formatGapCell(row.gap, row.stockQuantity !== null)}</td>
      </tr>`).join('')}</tbody>
    </table>`)
    : dsEmptyState('לא נמצאו סדנאות');

  const expanded = metrics.find((row) => row.workshopName === ops.expandedWorkshop);
  const expandedItems = expanded ? (groupsByName.get(expanded.workshopName) || []) : [];
  const detail = expanded
    ? dsCard({
      title: `פירוט: ${expanded.workshopName}`,
      body: dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table"><thead><tr><th>רשות</th><th>בית ספר</th><th>מדריך</th><th>תאריך</th><th>כמות בפועל</th><th>הערות</th></tr></thead><tbody>${expandedItems.map((row) => `<tr>
        <td>${escapeHtml(getActivityAuthorityName(row))}</td>
        <td class="ds-ops-col--school">${escapeHtml(getActivitySchoolDisplayName(row))}</td>
        <td class="ds-ops-col--instructor">${escapeHtml(getActivityInstructorName(row))}</td>
        <td class="ds-ops-col--date">${escapeHtml(formatDateHe(getActivityPrimaryDate(row)) || '—')}</td>
        <td>${formatQuantityCell(getActivityActualParticipantCount(row))}</td>
        <td>${escapeHtml(getActivityOperationalNotes(row) || '—')}</td>
      </tr>`).join('')}</tbody></table>`),
      padded: false
    })
    : '';

  const stockCount = metrics.filter((row) => row.stockQuantity !== null).length;
  const shortageCount = metrics.filter((row) => row.stockQuantity !== null && Number(row.gap) < 0).length;

  return `<section class="ds-ops-mgmt-panel ds-ops-workshops-panel" dir="rtl">
    ${summaryKpiHtml([
      { icon: '🎨', label: 'סדנאות שונות', value: metrics.length },
      { icon: '📋', label: 'פעילויות', value: rows.length },
      { icon: '📦', label: 'עם נתון מלאי', value: stockCount },
      { icon: '⚠️', label: 'חוסר במלאי', value: shortageCount, tone: shortageCount ? 'alert' : 'ok' }
    ])}
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <p class="ds-ops-mgmt-note">כמות משוערת = מספר סדנאות × ${WORKSHOP_ESTIMATE_PER_ACTIVITY}. מלאי לפי שם תוצר/סדנה מרשימות המערכת, אם קיים.</p>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print-workshops>הדפס כמויות סדנאות</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print">
      <h2>כמויות סדנאות ומלאי</h2>
      <p>טווח תאריכים: ${escapeHtml(formatDateHe(ops.dateFrom))}–${escapeHtml(formatDateHe(ops.dateTo))}</p>
    </div>
    ${dsCard({ title: 'סיכום לפי שם סדנה', badge: String(metrics.length), body: table, padded: false })}
    ${detail}
  </section>`;
}

function schoolsTabHtml(rows, state) {
  const ops = ensureOpsState(state);
  const groups = new Map();
  rows.forEach((row) => {
    const key = schoolGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        authority: getActivityAuthorityName(row),
        school: getActivitySchoolDisplayName(row),
        activities: 0,
        workshops: new Set(),
        instructors: new Set(),
        dates: new Set(),
        exceptions: 0,
        items: []
      });
    }
    const bucket = groups.get(key);
    bucket.activities += 1;
    bucket.workshops.add(getActivityName(row));
    const instructor = getActivityInstructorName(row);
    if (instructor !== 'לא משויך') bucket.instructors.add(instructor);
    getActivityScheduleDates(row).forEach((date) => bucket.dates.add(date));
    if (isSummerOperationsException(row)) bucket.exceptions += 1;
    bucket.items.push(row);
  });

  const list = sortByConfig(Array.from(groups.values()), state, TAB_SCHOOLS, {
    authority: (row) => row.authority,
    school: (row) => row.school,
    activities: (row) => row.activities,
    workshops: (row) => row.workshops.size,
    instructors: (row) => row.instructors.size,
    dates: (row) => Array.from(row.dates).sort()[0] || '',
    exceptions: (row) => row.exceptions
  });
  const table = list.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-table--interactive ds-ops-mgmt-data-table">
      <thead><tr>${sortableTh(state, TAB_SCHOOLS, 'authority', 'רשות')}${sortableTh(state, TAB_SCHOOLS, 'school', 'בית ספר / מסגרת')}${sortableTh(state, TAB_SCHOOLS, 'activities', 'פעילויות')}${sortableTh(state, TAB_SCHOOLS, 'workshops', 'סדנאות')}${sortableTh(state, TAB_SCHOOLS, 'instructors', 'מדריכים')}${sortableTh(state, TAB_SCHOOLS, 'dates', 'תאריכים')}${sortableTh(state, TAB_SCHOOLS, 'exceptions', 'חריגות')}</tr></thead>
      <tbody>${list.map((row) => `<tr><td>${escapeHtml(row.authority)}</td><td class="ds-ops-col--school"><button type="button" class="ds-link-btn" data-ops-school="${escapeHtml(row.key)}">${escapeHtml(row.school)}</button></td><td>${row.activities}</td><td>${escapeHtml(Array.from(row.workshops).join(' · '))}</td><td>${escapeHtml(Array.from(row.instructors).join(' · '))}</td><td>${escapeHtml(Array.from(row.dates).slice(0, 4).map(formatDateHe).join(' · '))}</td><td>${exceptionCountCell(row.exceptions)}</td></tr>`).join('')}</tbody>
    </table>`)
    : dsEmptyState('לא נמצאו בתי ספר / מסגרות');

  const expanded = list.find((row) => row.key === ops.expandedSchool);
  const detail = expanded
    ? dsCard({
      title: `פירוט: ${expanded.school}`,
      body: dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table"><thead><tr><th>תאריך</th><th>מדריך</th><th>סדנה</th><th>קבוצות</th><th>שכבה</th><th>חריגות</th><th>הערות</th></tr></thead><tbody>${expanded.items.map((row) => `<tr>
        <td class="ds-ops-col--date">${escapeHtml(formatDateHe(getActivityPrimaryDate(row)) || '—')}</td>
        <td class="ds-ops-col--instructor">${escapeHtml(getActivityInstructorName(row))}</td>
        <td>${escapeHtml(getActivityName(row))}</td>
        <td>${escapeHtml(getActivityGroupsCount(row) || '—')}</td>
        <td>${escapeHtml(getActivityGradeLabel(row) || '—')}</td>
        <td>${exceptionTagsHtml(row)}</td>
        <td>${escapeHtml(getActivityOperationalNotes(row) || '—')}</td>
      </tr>`).join('')}</tbody></table>`),
      padded: false
    })
    : '';

  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    ${tabOverviewSummary(rows)}
    ${dsCard({ title: 'פעילויות לפי בית ספר / מסגרת', badge: String(list.length), body: table, padded: false })}
    ${detail}
  </section>`;
}

function renderTab(rows, state, data) {
  const ops = ensureOpsState(state);
  const stockMap = data?.workshopStockMap instanceof Map ? data.workshopStockMap : new Map();
  const directory = buildOperationsDirectory(data?.schoolsDirectoryRows || []);
  if (ops.tab === TAB_SUMMER) return summerTabHtml(rows, state);
  if (ops.tab === TAB_WORKSHOPS) return workshopsTabHtml(rows, state, stockMap);
  if (ops.tab === TAB_SCHOOLS) return schoolsTabHtml(rows, state);
  return instructorsTabHtml(rows, state, data, directory);
}

export const operationsManagementScreen = {
  load: async ({ api }) => {
    const [activities, lists, schoolsDirectory] = await Promise.all([
      api.allActivities(),
      api.adminLists().catch(() => ({ categories: [] })),
      readOperationsSchoolsDirectory()
    ]);
    return {
      ...activities,
      schoolsDirectoryRows: schoolsDirectory.rows,
      schoolsDirectorySource: schoolsDirectory.source,
      workshopStockMap: buildWorkshopStockMapFromLists(lists)
    };
  },
  render(data, { state } = {}) {
    state = state || {};
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const prepared = prepareRows(allRows);
    const baseRows = applyBaseFilters(prepared, state);
    const filteredRows = applyAllFilters(baseRows, state);
    const ops = ensureOpsState(state);

    return `<div class="ds-screen-stack ds-ops-mgmt-screen">${dsPageHeader('ניהול תפעול', 'עמוד תפעולי להצגת סידור עבודה למדריכים, תכנון קיץ, כמויות סדנאות ופירוט לפי בתי ספר.')}
      ${topFiltersHtml(baseRows, state)}
      ${tabsHtml(ops.tab)}
      <div class="ds-ops-mgmt-content">${renderTab(filteredRows, state, data)}</div>
      <p class="ds-muted ds-ops-mgmt-count no-print" dir="rtl">מציג ${filteredRows.length} פעילויות מתוך ${allRows.length}</p>
    </div>`;
  },
  bind({ root, state, rerender }) {
    if (!root) return;
    state = state || {};
    const ops = ensureOpsState(state);
    const filters = ensureActivityListFilters(state, SCOPE);

    root.querySelectorAll('[data-ops-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ops.tab = btn.getAttribute('data-ops-tab') || TAB_INSTRUCTORS;
        rerender?.();
      });
    });

    root.querySelector('[data-ops-period]')?.addEventListener('change', (ev) => {
      ops.period = ev.target.value || 'all';
      const range = defaultDateRange(ops.period);
      ops.dateFrom = range.from;
      ops.dateTo = range.to;
      rerender?.();
    });

    root.querySelector('[data-ops-date="from"]')?.addEventListener('change', (ev) => {
      ops.dateFrom = ev.target.value || '';
      rerender?.();
    });
    root.querySelector('[data-ops-date="to"]')?.addEventListener('change', (ev) => {
      ops.dateTo = ev.target.value || '';
      rerender?.();
    });

    let searchTimer;
    root.querySelector('[data-ops-search]')?.addEventListener('input', (ev) => {
      filters.q = ev.target.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        filters.appliedQ = filters.q;
        rerender?.();
      }, 180);
    });

    root.querySelectorAll('[data-ops-filter]').forEach((select) => {
      select.addEventListener('change', (ev) => {
        const key = ev.target.getAttribute('data-ops-filter');
        if (!key) return;
        filters[key] = ev.target.value || '';
        rerender?.();
      });
    });

    root.querySelector('[data-ops-clear-filters]')?.addEventListener('click', () => {
      Object.keys(filters).forEach((key) => {
        if (key === 'visibleCount') return;
        filters[key] = '';
      });
      filters.status = 'פתוח';
      filters.q = '';
      filters.appliedQ = '';
      rerender?.();
    });

    root.querySelectorAll('[data-ops-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-ops-sort') || '';
        const tab = btn.getAttribute('data-ops-sort-tab') || ops.tab || TAB_INSTRUCTORS;
        if (!key) return;
        ops.sorts = ops.sorts || {};
        const current = ops.sorts[tab] || SORT_DEFAULTS[tab] || { key: '', dir: 'asc' };
        ops.sorts[tab] = {
          key,
          dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc'
        };
        rerender?.();
      });
    });

    root.querySelector('[data-ops-instructor]')?.addEventListener('change', (ev) => {
      ops.instructor = ev.target.value || '__all__';
      rerender?.();
    });

    root.querySelectorAll('[data-ops-row-contact]').forEach((select) => {
      select.addEventListener('change', (ev) => {
        const key = ev.target.getAttribute('data-ops-row-contact') || '';
        if (!key) return;
        ops.selectedContactKeys = ops.selectedContactKeys || {};
        ops.selectedContactKeys[key] = ev.target.value || '';
        rerender?.();
      });
    });

    root.querySelector('[data-ops-print]')?.addEventListener('click', () => {
      printScheduleFromDom(root);
    });

    root.querySelector('[data-ops-print-workshops]')?.addEventListener('click', () => {
      printWorkshopsFromDom(root);
    });

    root.querySelectorAll('[data-ops-district]').forEach((btn) => {
      btn.addEventListener('click', () => {
        filters.district = btn.getAttribute('data-ops-district') || '';
        rerender?.();
      });
    });

    root.querySelectorAll('[data-ops-instructor-jump]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const instructor = btn.getAttribute('data-ops-instructor-jump') || '';
        if (!isValidInstructorName(instructor)) return;
        ops.tab = TAB_INSTRUCTORS;
        ops.instructor = instructor;
        rerender?.();
      });
    });

    root.querySelectorAll('[data-ops-workshop]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-ops-workshop') || '';
        ops.expandedWorkshop = ops.expandedWorkshop === name ? '' : name;
        rerender?.();
      });
    });

    root.querySelectorAll('[data-ops-school]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-ops-school') || '';
        ops.expandedSchool = ops.expandedSchool === key ? '' : key;
        rerender?.();
      });
    });
  }
};

export {
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  getActivityPrimaryDate,
  getActivitySchoolNames,
  parseLinkedSchoolsJson
};