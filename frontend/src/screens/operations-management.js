import { escapeHtml } from './shared/html.js';
import { supabase } from '../supabase-client.js';
import { formatDateHe, formatDateHeWithWeekday } from './shared/format-date.js';
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
  normalizeActivitySeason
} from './shared/summer-activity.js';
import {
  parseLinkedSchoolsJson,
  getActivitySchoolNames,
  getActivitySchoolDisplayName,
  hasActivitySchoolOrFrame,
  getActivityInstructorName,
  getActivityInstructorNames,
  isValidInstructorName,
  getActivityPrimaryDate,
  getActivityScheduleDates,
  getActivityAuthorityName,
  getActivityName,
  getActivityTimeRange,
  getActivityGradeLabel,
  getActivityAddress,
  getActivityContactName,
  getActivityContactPhone,
  activityMatchesPeriod,
  isActivityDeleted,
  activityDatesInRange,
  activityOverlapsDateRange,
  isSummerOperationsException,
  schoolGroupKey,
  buildActivitySearchText,
  buildWorkshopStockMapFromLists,
  getActivityActualParticipantCount,
  getActivityOperationalQuantity,
  getActivityRequiredInventoryQuantity,
  sumRequiredInventoryQuantitiesFromActivities
} from './shared/operations-activity-helpers.js';
import {
  approvalFileTitle,
  approvalsBatchTitle,
  buildCompletionApprovals,
  completionApprovalInstructorOptions,
  completionApprovalPrintCss,
  completionApprovalsPrintHtml
} from './shared/activity-completion-approval-print.js';

const SCOPE = 'operations-management';
const TAB_INSTRUCTORS = 'instructors';
const TAB_SUMMER = 'summer';
const TAB_COMPLETION_APPROVAL = 'completion_approval';
const TAB_WORKSHOPS = 'workshops';
const TAB_AUTHORITIES = 'authorities';
const TAB_SCHOOLS = 'schools';
const SUMMER_TRAINING_SESSION_KEY = 'opsSummerTrainingActive';
const COMPLETION_APPROVAL_SUMMER_FROM = '2026-06-20';
const COMPLETION_APPROVAL_SUMMER_TO = '2026-08-31';
const COMPLETION_APPROVAL_MANAGER_ROLES = new Set(['admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager']);


let _opsNeedsEntryReset = false;

function resetOperationsManagementEntry(state) {
  const ops = ensureOpsState(state);
  ops.tab = TAB_INSTRUCTORS;
  try { sessionStorage.removeItem(SUMMER_TRAINING_SESSION_KEY); } catch { /* ignore */ }
}

function bindOperationsManagementEntryReset() {
  if (typeof document === 'undefined' || document.documentElement.dataset.opsMgmtEntryBound) return;
  document.documentElement.dataset.opsMgmtEntryBound = '1';
  document.addEventListener('click', (event) => {
    const nav = event.target?.closest?.('[data-route]');
    if (!nav) return;
    if (nav.getAttribute('data-route') === 'operations-management') _opsNeedsEntryReset = true;
  }, true);
  document.addEventListener('app:navigate', (event) => {
    if (event?.detail?.route === 'operations-management') _opsNeedsEntryReset = true;
  });
}

bindOperationsManagementEntryReset();

const SUMMER_2026_FROM = '2026-06-15';
const SUMMER_2026_TO = '2026-09-01';

const WORKSHOPS_SUMMER_FROM = '2026-06-15';
const WORKSHOPS_SUMMER_TO = '2026-08-30';

const PERIOD_OPTIONS = [
  { value: ACTIVITY_SEASON_SUMMER_2026, label: 'קיץ 2026' },
  { value: 'school_2026', label: 'תשפ״ו / 2026' },
  { value: ACTIVITY_SEASON_SCHOOL_2027, label: 'תשפ״ז / 2027' },
  { value: 'all', label: 'כל הפעילויות' }
];

const FILTER_FIELDS = [
  { key: 'authority', label: 'רשות', getValues: (row) => [getActivityAuthorityName(row)] },
  { key: 'school', label: 'בית ספר / מסגרת', getValues: getActivitySchoolNames },
  { key: 'instructor', label: 'מדריך', getValues: (row) => {
    const names = getActivityInstructorNames(row).filter(isValidInstructorName);
    return names.length ? names : [];
  } },
  { key: 'activity_name', label: 'שם סדנה / פעילות', getValues: (row) => [getActivityName(row)] },
  { key: 'status', label: 'סטטוס', getValues: (row) => [String(row?.status || '').trim()].filter(Boolean) }
];

const SEARCH_FIELDS = [
  (row) => buildActivitySearchText(row)
];

const SORT_DEFAULTS = {
  [TAB_INSTRUCTORS]: { key: 'date', dir: 'asc' },
  [TAB_WORKSHOPS]: { key: 'workshopNo', dir: 'asc' },
  [TAB_AUTHORITIES]: { key: 'authority', dir: 'asc' },
  [TAB_SCHOOLS]: { key: 'authority', dir: 'asc' }
};

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function localTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function ensureOpsState(state = {}) {
  state.operationsManagement = state.operationsManagement || {};
  const ops = state.operationsManagement;
  if (!ops.tab || ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
  if (!ops.period) ops.period = defaultPeriodKey();
  if (!ops.dateFrom || !ops.dateTo) {
    const range = defaultDateRange(ops.period);
    ops.dateFrom = ops.dateFrom || range.from;
    ops.dateTo = ops.dateTo || range.to;
  }
  if (!ops.instructor) ops.instructor = '__all__';
  if (!ops.expandedWorkshop) ops.expandedWorkshop = '';
  if (!ops.workshopStockOverrides) {
    try { ops.workshopStockOverrides = JSON.parse(localStorage.getItem('operationsWorkshopStockOverrides') || '{}'); } catch { ops.workshopStockOverrides = {}; }
  }
  if (!ops.expandedSchool) ops.expandedSchool = '';
  ops.completionApproval = ops.completionApproval || {};
  if (!ops.completionApproval.instructor) ops.completionApproval.instructor = '';
  if (!ops.completionApproval.dateMode) ops.completionApproval.dateMode = 'all';
  if (!ops.completionApproval.date) ops.completionApproval.date = '';
  if (!ops.completionApproval.dateFrom) ops.completionApproval.dateFrom = '';
  if (!ops.completionApproval.dateTo) ops.completionApproval.dateTo = '';
  if (!ops.completionApproval.preview) ops.completionApproval.preview = false;
  if (!ops.completionApproval.subtab) ops.completionApproval.subtab = 'approvals';
  if (!ops.completionApproval.printInstructor) ops.completionApproval.printInstructor = '';
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

function uniqueSorted(values) {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
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

function cleanRepeatedSuffix(value, repeated) {
  const text = String(value || '').trim();
  const suffix = String(repeated || '').trim();
  if (!text || !suffix) return text;
  if (!normalizeOpsText(text).endsWith(normalizeOpsText(suffix))) return text;
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cleaned = text.replace(new RegExp(`\\s*[-–,]?\\s*${escaped}\\s*$`), '').trim();
  return cleaned.length >= 2 ? cleaned : text;
}

function getActivitySchoolDisplayNameClean(activity) {
  const authority = getActivityAuthorityName(activity);
  return cleanRepeatedSuffix(getActivitySchoolDisplayName(activity), authority);
}

function formatAddressFromSchool(row = {}) {
  const address = nonEmptyOpsValue(row.institution_address);
  const city = nonEmptyOpsValue(row.city);
  if (address && city && !normalizeOpsText(address).includes(normalizeOpsText(city))) return `${address}, ${city}`;
  return nonEmptyOpsValue(address, city);
}

function normalizeSchoolRow(row = {}) {
  const schoolName = nonEmptyOpsValue(row.school_name, row.school, row.single_school_name, row.school_framework);
  const authority = nonEmptyOpsValue(row.authority, row.authority_name, row.legacy_authority);
  return {
    ...row,
    school_id: row.id ?? row.school_id ?? row.single_school_id ?? '',
    school_name: schoolName,
    authority,
    authority_id: row.authority_id ?? '',
    semel_mosad: row.semel_mosad ?? row.semel ?? '',
    district: nonEmptyOpsValue(row.district, row.authority_district),
    address: formatAddressFromSchool(row),
    principal_name: nonEmptyOpsValue(row.principal_name),
    school_phone: nonEmptyOpsValue(row.school_phone)
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

async function readContactsSchools() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('contacts_schools')
      .select('authority, school, school_id, contact_name, contact_role, phone')
      .limit(10000);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[operations-management] contacts_schools read failed', err?.message || err);
    return [];
  }
}

function buildContactsSchoolsIndex(rows = []) {
  const index = new Map();
  rows.forEach((row) => {
    const name = String(row.contact_name || '').trim();
    if (!name) return;
    const key = `${normalizeOpsText(row.authority || '')}|${normalizeOpsText(row.school || '')}`;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ name, phone: String(row.phone || '').trim(), role: String(row.contact_role || '').trim() });
  });
  return index;
}

function buildSummerPrintContactsIndex(rows = []) {
  const index = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (String(row?.season || '').trim() !== 'summer_2026' || row?.active === false) return;
    const name = String(row?.contact_name || '').trim();
    const phone = String(row?.contact_phone || '').trim();
    if (!name && !phone) return;
    const key = `${normalizeOpsText(row?.authority || '')}|${normalizeOpsText(row?.school || '')}`;
    if (key === '|') return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ name, phone, contact_name: name, contact_phone: phone, school_address: String(row?.school_address || '').trim(), city_or_authority: String(row?.city_or_authority || '').trim() });
  });
  return index;
}

function buildSchoolsDirectory(rows = []) {
  const list = (Array.isArray(rows) ? rows : []).map(normalizeSchoolRow);
  const byId = new Map();
  const byAuthorityAndName = new Map();
  const add = (map, key, row) => {
    const safeKey = String(key || '').trim();
    if (!safeKey) return;
    if (!map.has(safeKey)) map.set(safeKey, []);
    map.get(safeKey).push(row);
  };
  list.forEach((row) => {
    const schoolId = String(row.school_id || '').trim();
    if (schoolId) add(byId, schoolId, row);
    const authorityKey = normalizeOpsText(row.authority);
    const schoolKey = normalizeOpsText(row.school_name);
    add(byAuthorityAndName, `${authorityKey}|${schoolKey}`, row);
  });
  return { rows: list, byId, byAuthorityAndName };
}

function getActivitySchoolId(activity = {}) {
  return String(activity.school_id || activity.single_school_id || '').trim();
}

function getActivityAuthorityKey(activity = {}) {
  return normalizeOpsText(getActivityAuthorityName(activity) || activity.authority_name || activity.legacy_authority || activity.authority);
}

function getActivitySchoolLookupKeys(activity = {}) {
  const authorityKey = getActivityAuthorityKey(activity);
  return getActivitySchoolNames(activity)
    .map((name) => `${authorityKey}|${normalizeOpsText(name)}`)
    .filter((key) => key !== `${authorityKey}|`);
}

function uniqueSchoolRows(rows = []) {
  const seen = new Set();
  const result = [];
  rows.forEach((row) => {
    const key = [row.school_id, row.school_name, row.authority, row.address, row.principal_name, row.school_phone]
      .map((value) => String(value || '').trim()).join('|');
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function findSchoolsForActivity(activity, directory) {
  const found = [];
  const schoolId = getActivitySchoolId(activity);
  if (schoolId && directory?.byId?.has(schoolId)) found.push(...directory.byId.get(schoolId));
  getActivitySchoolLookupKeys(activity).forEach((key) => {
    if (directory?.byAuthorityAndName?.has(key)) found.push(...directory.byAuthorityAndName.get(key));
  });
  return uniqueSchoolRows(found);
}

function getActivityAddressResolved(activity, directory) {
  const addresses = uniqueSorted(findSchoolsForActivity(activity, directory).map((row) => row.address));
  return addresses.join('; ');
}

function getActivityContactOptions(activity, directory, contactsIndex) {
  const isSummerAct = String(activity?.activity_season ?? activity?.activitySeason ?? '').trim() === 'summer_2026';
  const options = [];
  const add = (name, phone = '', role = '') => {
    const cleanName = String(name || '').trim();
    if (!cleanName) return;
    const cleanPhone = String(phone || '').trim();
    const cleanRole = String(role || '').trim();
    const key = `${normalizeOpsText(cleanName)}|${normalizeOpsText(cleanPhone)}`;
    if (options.some((option) => option.key === key)) return;
    const roleSuffix = cleanRole ? ` (${cleanRole})` : '';
    const label = cleanPhone ? `${cleanName}${roleSuffix} — ${cleanPhone}` : `${cleanName}${roleSuffix}`;
    options.push({ key, name: cleanName, phone: cleanPhone, role: cleanRole, label });
  };
  // 1. מהפעילות עצמה (לא לפעילות קיץ)
  if (!isSummerAct) add(getActivityContactName(activity), getActivityContactPhone(activity));
  // 2. מספריית בתי הספר (מנהל + טלפון) — לא לפעילות קיץ
  if (!isSummerAct) findSchoolsForActivity(activity, directory).forEach((row) => add(row.principal_name, row.school_phone));
  // 3. מ-contacts_schools — לפי רשות + בית ספר (לא לפעילות קיץ)
  if (!isSummerAct && contactsIndex instanceof Map) {
    const authorityKey = getActivityAuthorityKey(activity);
    getActivitySchoolNames(activity).forEach((schoolName) => {
      const key = `${authorityKey}|${normalizeOpsText(schoolName)}`;
      (contactsIndex.get(key) || []).forEach((c) => add(c.name, c.phone, c.role));
    });
    // גם ניסיון ללא שם בית ספר (רק רשות)
    if (authorityKey) {
      (contactsIndex.get(`${authorityKey}|`) || []).forEach((c) => add(c.name, c.phone, c.role));
    }
  }
  return options;
}

function getOpsActivityKey(activity = {}, date = '') {
  return [activity.id, activity.activity_id, activity.uuid, date, getActivityName(activity), getActivitySchoolDisplayNameClean(activity)]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('|');
}

function getSelectedContact(state, activity, date, directory, contactsIndex) {
  const ops = ensureOpsState(state);
  ops.selectedContacts = ops.selectedContacts || {};
  const selectedKey = ops.selectedContacts[getOpsActivityKey(activity, date)] || '';
  if (!selectedKey) return null;
  return getActivityContactOptions(activity, directory, contactsIndex).find((option) => option.key === selectedKey) || null;
}

function contactSelectHtml(state, activity, date, directory, contactsIndex) {
  const key = getOpsActivityKey(activity, date);
  const selected = getSelectedContact(state, activity, date, directory, contactsIndex);
  const options = getActivityContactOptions(activity, directory, contactsIndex);
  return `<select class="ds-input ds-input--xs ds-ops-contact-select no-print" data-ops-contact-key="${escapeHtml(key)}">
    <option value="">ללא</option>
    ${options.map((option) => `<option value="${escapeHtml(option.key)}"${selected?.key === option.key ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
  </select><span class="only-print">${selected ? escapeHtml(selected.name) : '—'}</span>`;
}

function mutedOrText(value) {
  const text = String(value || '').trim();
  return text ? escapeHtml(text) : '<span class="ds-ops-mgmt-cell-muted">—</span>';
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

function filterFieldsHtml(optionsMap, filters) {
  return FILTER_FIELDS.map((field) => filterOptionsHtml(
    field.key,
    field.label,
    optionsMap[field.key] || [],
    String(filters[field.key] || '').trim()
  )).join('');
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
        <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-ops-clear-filters>ניקוי פילטרים</button>
      </div>
    </div>
  </section>`;
}

function authorityHeaderTitle(authority, schoolCount, activityCount) {
  const schools = Number.isFinite(Number(schoolCount)) ? Number(schoolCount) : 0;
  const activities = Number.isFinite(Number(activityCount)) ? Number(activityCount) : 0;
  return `${authority} | ${schools} בתי ספר | ${activities} פעילויות`;
}

function schoolHeaderTitle(school, activityCount) {
  const activities = Number.isFinite(Number(activityCount)) ? Number(activityCount) : 0;
  return `${school} | ${activities} פעילויות`;
}

function normalizeInventoryUsage(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function tabsHtml(activeTab) {
  const tabs = [
    [TAB_INSTRUCTORS, 'סידור עבודה'],
    [TAB_COMPLETION_APPROVAL, 'אישורי ביצוע'],
    [TAB_AUTHORITIES, 'רשויות'],
    [TAB_WORKSHOPS, 'ציוד ומלאי']
  ];
  return `<nav class="ds-exceptions-tabs ds-ops-mgmt-tabs no-print" aria-label="לשוניות ניהול תפעול" dir="rtl">
    ${tabs.map(([key, label]) => `<button type="button" class="ds-exceptions-tab ds-ops-mgmt-tab${activeTab === key ? ' is-active' : ''}" data-ops-tab="${escapeHtml(key)}" aria-pressed="${activeTab === key ? 'true' : 'false'}">${escapeHtml(label)}</button>`).join('')}
  </nav>`;
}

function summaryKpiHtml(items = []) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<div class="ds-ops-mgmt-summary" dir="rtl">${items.map((item) => {
    const tone = item.tone === 'alert' ? ' ds-ops-mgmt-summary__card--alert' : (item.tone === 'ok' ? ' ds-ops-mgmt-summary__card--ok' : '');
    return `<article class="ds-ops-mgmt-summary__card${tone}">
      <span class="ds-ops-mgmt-summary__icon" aria-hidden="true">${escapeHtml(item.icon || '•')}</span>
      <span class="ds-ops-mgmt-summary__label">${escapeHtml(item.label)}</span>
      <strong class="ds-ops-mgmt-summary__value">${escapeHtml(String(item.value ?? ''))}</strong>
    </article>`;
  }).join('')}</div>`;
}

function instructorOptions(rows) {
  const names = new Set();
  rows.forEach((row) => {
    [row?.instructor_name, row?.instructor, row?.guide_name, row?.guide, row?.instructor_name_2, row?.instructor_2, row?.guide_name_2, row?.guide_2].forEach((value) => {
      const name = String(value || '').trim();
      if (isValidInstructorName(name)) names.add(name);
    });
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'he'));
}

function getTabSort(state, tabKey) {
  const ops = ensureOpsState(state);
  ops.sorts = ops.sorts || {};
  if (!ops.sorts[tabKey]) ops.sorts[tabKey] = { ...(SORT_DEFAULTS[tabKey] || { key: '', dir: 'asc' }) };
  return ops.sorts[tabKey];
}

function sortIndicatorHtml(state, tabKey, key) {
  const sort = getTabSort(state, tabKey);
  if (sort.key !== key) return '';
  return `<span class="ds-sort-indicator" aria-hidden="true">${sort.dir === 'desc' ? '▼' : '▲'}</span>`;
}

function sortableTh(state, tabKey, key, label, className = '') {
  return `<th class="ds-ops-sortable-th ${escapeHtml(className)}" data-ops-sort="${escapeHtml(key)}" data-ops-sort-tab="${escapeHtml(tabKey)}">${escapeHtml(label)} ${sortIndicatorHtml(state, tabKey, key)}</th>`;
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
  if (Number.isFinite(numA) && Number.isFinite(numB)) return (numA - numB) * multiplier;
  return String(a).localeCompare(String(b), 'he', { numeric: true }) * multiplier;
}

function sortByConfig(list, state, tabKey, valueGetters = {}) {
  const sort = getTabSort(state, tabKey);
  const getter = valueGetters[sort.key];
  if (!getter) return list;
  return list.sort((a, b) => compareValues(getter(a), getter(b), sort.dir));
}

function scheduleSortValue(entry, key, directory) {
  const activity = entry.activity || {};
  const map = {
    date: entry.date || '',
    weekday: entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '',
    time: entry.time || '',
    quantity: getActivityOperationalQuantity(activity),
    studentCount: entry.studentCount ?? getActivityActualParticipantCount(activity),
    authority: getActivityAuthorityName(activity),
    school: getActivitySchoolDisplayNameClean(activity),
    instructor: entry.instructor || '',
    grade: getActivityGradeLabel(activity) || '',
    activity: getActivityName(activity)
  };
  return map[key] ?? '';
}

function sortScheduleRows(schedule, state, directory) {
  const sort = getTabSort(state, TAB_INSTRUCTORS);
  return schedule.sort((a, b) => {
    const primary = compareValues(scheduleSortValue(a, sort.key, directory), scheduleSortValue(b, sort.key, directory), sort.dir);
    if (primary !== 0) return primary;
    const dateCmp = compareValues(a.date || '9999-99-99', b.date || '9999-99-99', 'asc');
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = compareValues(a.time || '99:99', b.time || '99:99', 'asc');
    if (timeCmp !== 0) return timeCmp;
    return getActivityName(a.activity).localeCompare(getActivityName(b.activity), 'he');
  });
}

function buildScheduleRows(rows, state, directory) {
  const ops = ensureOpsState(state);
  const selectedInstructor = String(ops.instructor || '__all__').trim();
  const schedule = [];
  rows.forEach((activity) => {
    const instructors = getActivityInstructorNames(activity);
    const targetInstructors = instructors.length ? instructors : ['לא משויך'];
    targetInstructors.forEach((instructor) => {
      if (selectedInstructor !== '__all__' && instructor !== selectedInstructor) return;
      const dates = activityDatesInRange(activity, ops.dateFrom, ops.dateTo);
      const targetDates = dates.length ? dates : (getActivityPrimaryDate(activity) ? [getActivityPrimaryDate(activity)] : ['']);
      targetDates.forEach((date) => {
        schedule.push({
          date,
          activity,
          instructor,
          time: getActivityTimeRange(activity),
          hasTime: Boolean(getActivityTimeRange(activity)),
          quantity: getActivityOperationalQuantity(activity),
          studentCount: getActivityActualParticipantCount(activity)
        });
      });
    });
  });
  return sortScheduleRows(schedule, state, directory);
}


function normalizePrintContactMatchText(value) {
  return String(value || '')
    .trim()
    .replace(/[״"]/g, '"')
    .replace(/[׳']/g, "'")
    .replace(/[\u2010-\u2015־]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function loosePrintContactMatchText(value) {
  return normalizePrintContactMatchText(value)
    .replace(/["'`´]/g, '')
    .replace(/[-–—־]/g, '')
    .replace(/\b(בית ספר|ביהס|בי"ס|מקיף|חטיבת ביניים|חטיבה|יסודי)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function activitySchoolIdForPrint(activity = {}) {
  return String(activity?.school_id || activity?.single_school_id || activity?.single_semel_mosad || '').trim();
}

function buildPrintContactRowsForGroup(group, printContacts = [], contactResponsibles = []) {
  const authority = group?.authority || '';
  const schools = uniqueSorted((group?.entries || []).map((entry) => getActivitySchoolDisplayNameClean(entry.activity)).filter(Boolean));
  return schools.map((school) => {
    const contact = findInstructorSchedulePrintContact(printContacts, { authority, school });
    const responsible = findPrintContactResponsible(contactResponsibles, group?.entries || [], group?.date || '', school);
    return {
      school,
      address: contact?.school_address || '',
      contactName: contact?.contact_name || '',
      contactPhone: contact?.contact_phone || '',
      responsibleName: responsible?.responsible_name || ''
    };
  });
}

function findInstructorSchedulePrintContact(printContacts = [], { authority = '', school = '' } = {}) {
  const authNorm = normalizePrintContactMatchText(authority);
  const schoolNorm = normalizePrintContactMatchText(school);
  const schoolLoose = loosePrintContactMatchText(school);
  const activeRows = (Array.isArray(printContacts) ? printContacts : []).filter((row) => row?.active !== false);
  return activeRows.find((row) => normalizePrintContactMatchText(row?.authority) === authNorm && normalizePrintContactMatchText(row?.school) === schoolNorm)
    || activeRows.find((row) => normalizePrintContactMatchText(row?.authority) === authNorm && loosePrintContactMatchText(row?.school) === schoolLoose)
    || activeRows.find((row) => loosePrintContactMatchText(row?.school) === schoolLoose)
    || null;
}

function findPrintContactResponsible(contactResponsibles = [], entries = [], date = '', school = '') {
  const activityDate = String(date || '').slice(0, 10);
  const schoolNorm = normalizePrintContactMatchText(school);
  const schoolLoose = loosePrintContactMatchText(school);
  const ids = new Set((entries || []).map((entry) => activitySchoolIdForPrint(entry.activity)).filter(Boolean));
  const rows = (Array.isArray(contactResponsibles) ? contactResponsibles : []).filter((row) => String(row?.activity_date || '').slice(0, 10) === activityDate);
  return rows.find((row) => ids.has(String(row?.school_id || '').trim()))
    || rows.find((row) => normalizePrintContactMatchText(row?.school) === schoolNorm)
    || rows.find((row) => loosePrintContactMatchText(row?.school) === schoolLoose)
    || null;
}

function printContactFallback(value) {
  const text = String(value || '').trim();
  return text || '—';
}

function compactSummaryLineHtml(items = []) {
  const text = items.filter((item) => item?.value !== undefined && item?.value !== null).map((item) => `${item.value} ${item.label}`).join(' · ');
  return text ? `<div class="ds-ops-mgmt-summary-line" dir="rtl">${escapeHtml(text)}</div>` : '';
}

function tabOverviewSummary(rows, scheduleRows = []) {
  const workDays = uniqueSorted(scheduleRows.map((row) => row.date).filter(Boolean)).length;
  const schools = uniqueSorted(scheduleRows.map((row) => getActivitySchoolDisplayNameClean(row.activity)).filter((name) => name !== 'לא משויך'));
  const authorities = uniqueSorted(scheduleRows.map((row) => getActivityAuthorityName(row.activity)));
  const studentTotal = sumScheduleStudentCounts(scheduleRows);
  return compactSummaryLineHtml([
    { label: 'פעילויות', value: scheduleRows.length },
    { label: 'סה״כ תלמידים', value: studentTotal },
    { label: 'בתי ספר', value: schools.length },
    { label: 'רשויות', value: authorities.length },
    { label: 'ימי עבודה', value: workDays }
  ]);
}

function instructorSummary(rows, state, scheduleRows) {
  const selected = String(ensureOpsState(state).instructor || '__all__').trim();
  if (selected === '__all__') return '';
  const workDays = uniqueSorted(scheduleRows.map((row) => row.date).filter(Boolean)).length;
  const authorities = uniqueSorted(scheduleRows.map((row) => getActivityAuthorityName(row.activity)));
  const schools = uniqueSorted(scheduleRows.map((row) => getActivitySchoolDisplayNameClean(row.activity)).filter((name) => name !== 'לא משויך'));
  const studentTotal = sumScheduleStudentCounts(scheduleRows);
  return compactSummaryLineHtml([
    { label: `מדריך: ${selected}`, value: '' },
    { label: 'פעילויות', value: scheduleRows.length },
    { label: 'סה״כ תלמידים', value: studentTotal },
    { label: 'בתי ספר', value: schools.length },
    { label: 'רשויות', value: authorities.length },
    { label: 'ימי עבודה', value: workDays }
  ]);
}

function formatQuantityCell(value) {
  if (value === null || value === undefined || value === '') return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  return escapeHtml(String(value));
}

function normalizeWorkshopKey(name) {
  return String(name || '').trim().toLowerCase();
}

function isTruthyListValue(value) {
  if (value === true || value === 1) return true;
  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'active', 'פעיל', 'כן'].includes(normalized);
}

function isWorkshopInventoryRequired(workshopName) {
  const name = String(workshopName || '').trim();
  if (!name) return false;
  const excluded = ['תמיר', 'עולם הביומימיקרי', 'עולם הביומימיקרי הקסום'];
  return !excluded.some((term) => name.includes(term));
}

function isTamirActivity(row) {
  const fields = [
    row?.authority_name, row?.legacy_authority, row?.authority,
    row?.single_school_name, row?.school, row?.legacy_school, row?.linked_school_names,
    row?.activity_name, row?.name, row?.title, row?.program_name,
    row?.notes, row?.project, row?.source, row?.customer, row?.client
  ];
  return fields.some((f) => String(f || '').includes('תמיר'));
}

function isOpenOrClosedActivity(row) {
  const status = String(row?.status || '').trim();
  return status === 'פתוח' || status === 'סגור';
}

function isOfficialWorkshopListRow(row = {}, category = '') {
  const cat = String(category || row?.category || '').trim().toLowerCase();
  if (cat !== 'activity_names') return false;
  const type = String(row?.type || '').trim().toLowerCase();
  const activityType = String(row?.activity_type || '').trim().toLowerCase();
  if (type && type !== 'workshop') return false;
  if (activityType && activityType !== 'workshop') return false;
  return true;
}

function officialWorkshopStockGroupKey(row = {}) {
  const rawGroup = String(row?.stock_group_key || '').trim();
  if (rawGroup) return canonicalStockGroupKey(rawGroup);
  const activityNo = String(row?.activity_no || '').trim();
  return activityNo ? canonicalStockGroupKey(`activity_${activityNo}`) : normalizeWorkshopKey(row?.activity_name);
}

function canonicalStockGroupKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const activityMatch = raw.match(/^activity_0*(\d+)$/i);
  if (activityMatch) return `activity_${Number(activityMatch[1])}`;
  const numericMatch = raw.match(/^0*(\d+)$/);
  if (numericMatch) return `activity_${Number(numericMatch[1])}`;
  return raw;
}

function officialWorkshopStockGroupName(row = {}) {
  return String(row?.stock_group_name || row?.stock_item_name || row?.stock_label || row?.activity_name || '').trim();
}

function formatSignedNumberForRtl(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (n < 0) return `<span dir="ltr">-${Math.abs(n)}</span>`;
  return escapeHtml(String(n));
}

function formatGapCell(gap, hasStock) {
  if (!hasStock || gap === null || gap === undefined) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const value = Number(gap);
  if (!Number.isFinite(value)) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const tone = value < 0 ? 'ds-ops-gap--shortage' : 'ds-ops-gap--ok';
  return `<span class="ds-ops-gap ${tone}">${formatSignedNumberForRtl(value)}</span>`;
}

function formatDeliveryGapCell(gap) {
  const value = Number(gap);
  if (!Number.isFinite(value)) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const tone = value > 0 ? 'ds-ops-gap--shortage' : value === 0 ? 'ds-ops-gap--ok' : 'ds-ops-gap--over';
  return `<span class="ds-ops-gap ${tone}">${formatSignedNumberForRtl(value)}</span>`;
}

function formatInventoryRemainder(stockValue, usageValue) {
  const stock = Number.isFinite(Number(stockValue)) ? Number(stockValue) : 0;
  const usage = Number.isFinite(Number(usageValue)) ? Number(usageValue) : 0;
  const remainder = stock - usage;
  const tone = remainder < 0 ? 'ds-ops-gap--shortage' : 'ds-ops-gap--ok';
  return `<span class="ds-ops-gap ${tone}">${formatSignedNumberForRtl(remainder)}</span>`;
}

function extractWorkshopCatalogRows(listsData, activityRows = []) {
  const rows = [];
  const seen = new Set();
  const categories = Array.isArray(listsData?.categories) ? listsData.categories : [];
  const workshopStockLookup = new Map();
  categories.forEach(({ category, items }) => {
    const cat = String(category || '').trim().toLowerCase();
    if (cat !== 'workshop_stock') return;
    (Array.isArray(items) ? items : []).forEach((item) => {
      const row = item?._row && typeof item._row === 'object' ? item._row : item;
      if (row?.active === false || !isTruthyListValue(row?.active)) return;
      const name = String(row?.label || item?.label || row?.value || item?.value || '').trim();
      const key = normalizeWorkshopKey(name);
      if (key && !workshopStockLookup.has(key)) workshopStockLookup.set(key, stockMapValue(row));
    });
  });
  const add = ({ no = '', name = '', stock = null, stockGroupKey = '', stockGroupName = '' } = {}) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || !isWorkshopInventoryRequired(cleanName)) return;
    const canonicalGroupKey = canonicalStockGroupKey(stockGroupKey);
    const key = `${canonicalGroupKey}|${String(no || '').trim()}|${normalizeWorkshopKey(cleanName)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      workshopNo: String(no || '').trim(),
      workshopName: cleanName,
      stockQuantity: stock,
      stockGroupKey: canonicalGroupKey,
      stockGroupName: String(stockGroupName || cleanName).trim()
    });
  };
  categories.forEach(({ category, items }) => {
    const cat = String(category || '').trim().toLowerCase();
    if (cat !== 'activity_names') return;
    (Array.isArray(items) ? items : []).forEach((item) => {
      const row = item?._row && typeof item._row === 'object' ? item._row : item;
      if (!isOfficialWorkshopListRow(row, cat) || row?.active === false || !isTruthyListValue(row?.active)) return;
      const name = row?.activity_name || row?.label || item?.label || row?.value || item?.value || '';
      const stockKey = normalizeWorkshopKey(name);
      const stock = workshopStockLookup.has(stockKey) ? workshopStockLookup.get(stockKey) : stockMapValue(row);
      add({
        no: row?.activity_no || row?.value || item?.value,
        name,
        stock,
        stockGroupKey: officialWorkshopStockGroupKey(row),
        stockGroupName: officialWorkshopStockGroupName(row)
      });
    });
  });
  return rows.sort((a, b) => compareValues(a.workshopNo || a.workshopName, b.workshopNo || b.workshopName, 'asc'));
}

function stockMapValue(row = {}) {
  for (const field of ['stock_quantity', 'stock', 'inventory', 'quantity', 'qty']) {
    const value = row?.[field];
    if (value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return null;
}

function normalizeActivityNo(no) {
  const s = String(no || '').trim();
  if (!s) return '';
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? String(n) : s;
}

function activityMatchesOfficialWorkshop(activity = {}, workshop = {}) {
  const activityNo = String(activity?.activity_no || activity?.workshop_no || '').trim();
  const workshopNo = String(workshop.workshopNo || '').trim();
  if (activityNo && workshopNo) {
    if (activityNo === workshopNo) return true;
    const normA = normalizeActivityNo(activityNo);
    const normW = normalizeActivityNo(workshopNo);
    if (normA && normA === normW) return true;
  }
  return normalizeWorkshopKey(getActivityName(activity)) === normalizeWorkshopKey(workshop.workshopName);
}

function activityMatchesAnyOfficialWorkshop(activity = {}, catalogRows = []) {
  return catalogRows.some((workshop) => activityMatchesOfficialWorkshop(activity, workshop));
}

function distributionStockGroupKey(row = {}) {
  return canonicalStockGroupKey(row?.stock_group_key || row?.stockGroupKey || row?.workshop_stock_group_key || row?.activity_no || '');
}

function distributionInstructorName(row = {}) {
  return String(row?.instructor_name || row?.instructor || row?.guide_name || row?.guide || row?.recipient_name || row?.employee_name || '').trim() || 'לא משויך';
}


function distributionDate(row = {}) {
  for (const field of ['distribution_date', 'received_date', 'date', 'created_at']) {
    const raw = String(row?.[field] || '').trim();
    const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
  }
  return '';
}

function distributionInDateRange(row = {}, dateFrom = '', dateTo = '') {
  const date = distributionDate(row);
  if (!date) return true;
  if (dateFrom && date < dateFrom) return false;
  if (dateTo && date > dateTo) return false;
  return true;
}

function distributionQuantity(row = {}) {
  for (const field of ['quantity_received', 'quantity', 'qty', 'amount']) {
    const value = row?.[field];
    if (value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function workshopDistributionRowsForGroup(distributions = [], groupKey = '') {
  const key = canonicalStockGroupKey(groupKey);
  return (Array.isArray(distributions) ? distributions : []).filter((row) => distributionStockGroupKey(row) === key);
}

function workshopInstructorStatus({ received, required }) {
  if (required > 0 && received <= 0) return { label: 'לא קיבל מלאי', tone: 'danger' };
  if (received > 0 && required <= 0) return { label: 'קיבל ללא פעילות', tone: 'warning' };
  if (received < required) return { label: 'חסר אצל מדריך', tone: 'danger' };
  if (received > required) return { label: 'עודף אצל מדריך', tone: 'info' };
  return { label: 'תקין', tone: 'success' };
}

function workshopMainStatus(row) {
  if (row.stockQuantity === null || row.stockQuantity === undefined) return { label: 'חסר נתון', tone: 'muted' };
  if (row.warehouseBalance < 0) return { label: 'נדרש תיקון מלאי', tone: 'inventory-fix' };
  if (row.requiredQuantity > row.stockQuantity) return { label: 'נדרש להזמין', tone: 'danger' };
  const hasShortage = row.instructorRows.some((item) => item.balance < 0);
  if (hasShortage && row.warehouseBalance > 0) return { label: 'להעביר מהמחסן', tone: 'info' };
  if (hasShortage && row.instructorRows.some((item) => item.balance > 0)) return { label: 'נדרש ניוד', tone: 'warning' };
  if (hasShortage) return { label: 'חסר נתון', tone: 'muted' };
  return { label: 'תקין', tone: 'success' };
}

function isWorkshopStockLocationName(name) {
  const value = String(name || '').trim();
  return value === 'מלאי עידן' || value === 'מלאי הילה';
}

function workshopMetricsRows(activitiesRowsForRequiredInventory, stockMap, catalogRows = [], workshopStockDistributions = [], dateRange = {}) {
  const groups = new Map();
  catalogRows.forEach((catalog) => {
    const key = canonicalStockGroupKey(catalog.stockGroupKey || `activity_${catalog.workshopNo || normalizeWorkshopKey(catalog.workshopName)}`);
    if (!groups.has(key)) {
      groups.set(key, {
        stockGroupKey: key,
        workshopName: catalog.stockGroupName || catalog.workshopName,
        linkedWorkshops: [],
        stockQuantity: catalog.stockQuantity,
        activities: []
      });
    }
    const group = groups.get(key);
    group.linkedWorkshops.push(catalog);
    if (group.stockQuantity === null || group.stockQuantity === undefined) group.stockQuantity = catalog.stockQuantity;
  });

  const activityRows = Array.isArray(activitiesRowsForRequiredInventory) ? activitiesRowsForRequiredInventory : [];
  activityRows.forEach((row) => {
    groups.forEach((group) => {
      if (!group.linkedWorkshops.some((workshop) => activityMatchesOfficialWorkshop(row, workshop))) return;
      group.activities.push(row);
    });
  });

  return Array.from(groups.values()).map((group) => {
    const activityCount = group.activities.length;
    const requiredQuantity = sumRequiredInventoryQuantitiesFromActivities(group.activities);
    const activitiesWithoutParticipants = group.activities.filter((activity) => getActivityActualParticipantCount(activity) === null).length;
    const stock = group.stockQuantity !== null && group.stockQuantity !== undefined && Number.isFinite(Number(group.stockQuantity))
      ? Number(group.stockQuantity)
      : null;
    const groupDistributions = workshopDistributionRowsForGroup(workshopStockDistributions, group.stockGroupKey)
      .filter((dist) => distributionInDateRange(dist, dateRange.from, dateRange.to));
    const stockLocationRows = ['מלאי עידן', 'מלאי הילה'].map((location) => ({ location, quantity: 0 }));
    const stockLocationMap = new Map(stockLocationRows.map((item) => [item.location, item]));
    const instructorDistributions = [];
    groupDistributions.forEach((dist) => {
      const instructorName = distributionInstructorName(dist);
      const quantity = distributionQuantity(dist);
      if (isWorkshopStockLocationName(instructorName)) {
        stockLocationMap.get(instructorName).quantity += quantity;
        return;
      }
      instructorDistributions.push(dist);
    });
    const stockLocationsTotal = stockLocationRows.reduce((total, item) => total + item.quantity, 0);
    const stockLocationSummaryRows = [
      ...stockLocationRows,
      { location: 'סה״כ במיקומים', quantity: stockLocationsTotal }
    ];
    const instructorMap = new Map();
    const ensureInstructor = (name) => {
      const key = String(name || '').trim() || 'לא משויך';
      if (!instructorMap.has(key)) instructorMap.set(key, { instructor: key, received: 0, required: 0 });
      return instructorMap.get(key);
    };
    instructorDistributions.forEach((dist) => {
      ensureInstructor(distributionInstructorName(dist)).received += distributionQuantity(dist);
    });
    group.activities.forEach((activity) => {
      const requiredQuantity = getActivityRequiredInventoryQuantity(activity);
      const instructors = getActivityInstructorNames(activity);
      const names = instructors.length ? instructors : ['לא משויך'];
      names.forEach((name) => {
        ensureInstructor(name).required += requiredQuantity;
      });
    });
    const instructorRows = Array.from(instructorMap.values()).map((item) => {
      const balance = item.received - item.required;
      return { ...item, balance, status: workshopInstructorStatus(item) };
    }).sort((a, b) => a.instructor.localeCompare(b.instructor, 'he'));
    const deliveredQuantity = instructorDistributions.reduce((total, dist) => total + distributionQuantity(dist), 0);
    const warehouseBalance = stock === null ? null : stock - deliveredQuantity;
    const expectedBalance = stock === null ? null : stock - requiredQuantity;
    const deliveryGap = requiredQuantity - deliveredQuantity;
    const row = {
      stockGroupKey: group.stockGroupKey,
      workshopNo: group.linkedWorkshops.map((workshop) => workshop.workshopNo).filter(Boolean).join(', '),
      workshopNoDisplay: group.linkedWorkshops.map((workshop) => workshop.workshopNo).filter(Boolean).join(', '),
      workshopName: group.workshopName,
      linkedWorkshops: group.linkedWorkshops,
      activities: group.activities,
      activityCount,
      estimatedQuantity: requiredQuantity,
      requiredQuantity,
      actualQuantity: requiredQuantity,
      stockQuantity: stock,
      deliveredQuantity,
      warehouseBalance,
      expectedBalance,
      deliveryGap,
      activitiesWithoutParticipants,
      instructorRows,
      stockLocationRows: stockLocationSummaryRows,
      stockLocationsTotal,
      gap: expectedBalance
    };
    row.status = workshopMainStatus(row);
    return row;
  });
}

function exceptionCountCell(count) {
  const value = Number(count || 0);
  if (!value) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  return dsStatusChip(String(value), 'warning');
}

function exceptionTagsHtml(activity) {
  const tags = [];
  if (getActivityInstructorName(activity) === 'לא משויך') tags.push(dsStatusChip('ללא מדריך', 'warning'));
  if (isSummerOperationsException(activity)) tags.push(dsStatusChip('חריגת קיץ', 'warning'));
  return tags.length ? tags.join('') : '<span class="ds-ops-mgmt-cell-muted">—</span>';
}

function compactTagListHtml(values = [], className = '', limit = 4) {
  const unique = uniqueSorted(values).filter(Boolean);
  const visible = unique.slice(0, limit);
  const rest = unique.length - visible.length;
  return `<div class="ds-ops-tag-list">${visible.map((value) => `<span class="ds-ops-tag ${escapeHtml(className)}">${escapeHtml(value)}</span>`).join('')}${rest > 0 ? `<span class="ds-ops-tag">+ עוד ${rest}</span>` : ''}</div>`;
}

function formatSchoolDateRange(dates = []) {
  const clean = uniqueSorted(dates).filter(Boolean).sort();
  if (!clean.length) return '—';
  const first = formatDateHe(clean[0]) || clean[0];
  const last = formatDateHe(clean[clean.length - 1]) || clean[clean.length - 1];
  if (first === last) return `${first} · יום פעילות אחד`;
  return `${first}–${last} · ${clean.length} ימי פעילות`;
}

function getDetailDateForActivity(row) {
  return getActivityPrimaryDate(row) || getActivityScheduleDates(row)[0] || '';
}

function getDetailTimeForActivity(row) {
  return getActivityTimeRange(row) || '';
}

function opsManagementStylesHtml() {
  return `<style>
    .ds-ops-mgmt-screen .ds-ops-col--date,
    .ds-ops-mgmt-screen .ds-ops-col--weekday,
    .ds-ops-mgmt-screen .ds-ops-col--time { white-space: nowrap; }
    /* semantic column alignment — numeric/short → center; named text → right */
    .ds-ops-mgmt-screen .ds-ops-col--date,
    .ds-ops-mgmt-screen .ds-ops-col--weekday,
    .ds-ops-mgmt-screen .ds-ops-col--time,
    .ds-ops-mgmt-screen .ds-ops-col--grade,
    .ds-ops-mgmt-screen .ds-ops-col--student-count { text-align: center; }
    .ds-ops-mgmt-screen .ds-ops-col--school,
    .ds-ops-mgmt-screen .ds-ops-col--instructor,
    .ds-ops-mgmt-screen .ds-ops-col--activity { text-align: right; }
    .ds-ops-mgmt-screen .ds-ops-sortable-th { cursor:pointer; user-select:none; white-space:nowrap; background:#e6f6fb; color:#0f172a; font-weight:700; border:0; }
    .ds-ops-mgmt-screen .ds-ops-col--school,
    .ds-ops-mgmt-screen .ds-ops-col--activity { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-col--grade { width:70px; max-width:70px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .ds-ops-mgmt-screen .ds-ops-col--student-count { width:68px; max-width:80px; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-schedule-wrap,
    .ds-ops-mgmt-screen .ds-ops-schedule-wrap .ds-table-wrap,
    .ds-ops-mgmt-screen .ds-ops-mgmt-schedule { width:100%; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-summary-line { display:block; margin:0 0 10px; padding:7px 10px; border:1px solid #d8e5ee; border-radius:10px; background:#f8fbfd; color:#334155; font-weight:700; font-size:13px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters { padding:8px 10px; border-radius:12px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters .ds-filter-panel__title { margin:0 0 4px; font-size:13px; line-height:1.2; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters__grid { gap:6px; grid-template-columns:repeat(auto-fit,minmax(126px,1fr)); align-items:end; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters .ds-input { min-height:30px; height:30px; padding-block:3px; font-size:12px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters .ds-btn { min-height:30px; padding:4px 10px; }
    .ds-ops-mgmt-screen .ds-filter-field__label { font-size:11px; margin-bottom:1px; line-height:1.15; }
    .ds-ops-mgmt-screen .ds-filter-field { min-width:0; }
    .ds-ops-mgmt-screen .ds-filter-field--search { grid-column:span 2; }
    @media (max-width: 720px) { .ds-ops-mgmt-screen .ds-ops-mgmt-filters__grid { grid-template-columns:repeat(2,minmax(0,1fr)); } .ds-ops-mgmt-screen .ds-filter-field--search { grid-column:1 / -1; } }
    @media (max-width: 460px) { .ds-ops-mgmt-screen .ds-ops-mgmt-filters__grid { grid-template-columns:1fr; } }
    .ds-ops-mgmt-screen .ds-sort-indicator { display:inline-block; margin-inline-start:4px; font-size:10px; color:#0f8fa8; }
    .ds-ops-mgmt-screen .ds-ops-workshops-card { width:70%; max-width:70%; margin:0 auto; box-sizing:border-box; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table-wrap { width:100%; max-width:100%; overflow-x:hidden; box-sizing:border-box; }
    .ds-ops-mgmt-screen .ds-ops-workshops-card .ds-card__body { width:100%; max-width:100%; box-sizing:border-box; overflow-x:hidden; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table { width:100%; table-layout:fixed; border-collapse:collapse; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th,.ds-ops-mgmt-screen .ds-ops-workshops-table td { border:1px solid #94a3b8 !important; padding:5px 6px; font-size:12px; text-align:center; vertical-align:middle; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr { cursor:pointer; transition:background 0.12s ease; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr.ds-ops-workshop-detail-row { cursor:default; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:hover td { background:color-mix(in srgb,#dbeafe 18%,#fff) !important; border:1px solid #94a3b8 !important; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr.ds-ops-workshop-detail-row:hover td { background:transparent !important; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:hover td:nth-child(2) { text-decoration:underline; text-underline-offset:2px; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:active td,
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:focus-visible td,
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:hover,
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:focus,
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:focus-within,
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:active { border:1px solid #94a3b8 !important; outline:none; box-shadow:none; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-usage-cell:hover,
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-usage-cell:focus,
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-usage-cell:focus-within,
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-usage-cell:active { border:1px solid #94a3b8 !important; box-shadow:none; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th { background:#fff; color:#1e3a8a; font-weight:800; font-size:12px; border-bottom:2px solid #3b82f6 !important; }
    /* workshops table — semantic column classes (set on both th and td) */
    .ds-ops-mgmt-screen .ds-ops-workshop-col--no { width:75px !important; max-width:75px !important; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-workshop-col--name { width:160px !important; max-width:160px !important; text-align:right !important; line-height:1.35; overflow:hidden; text-overflow:ellipsis; }
    .ds-ops-mgmt-screen .ds-ops-workshop-col--metric { width:70px !important; max-width:70px !important; text-align:center !important; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table col:nth-child(6) { width:70px !important; }
    /* hover underline on name col via semantic class */
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:hover td.ds-ops-workshop-col--name { text-decoration:underline; text-underline-offset:2px; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text { font-weight:700; background:transparent; border:0; padding:0; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--success { color:#15803d; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--danger { color:#b91c1c; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--info { color:#1d4ed8; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--warning { color:#c2410c; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--inventory-fix { color:#9a3412; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text--muted { color:#64748b; }
    .ds-ops-mgmt-screen .ds-ops-row--expanded td { background:color-mix(in srgb,#dbeafe 25%,#fff)!important; }
    .ds-ops-mgmt-screen .ds-ops-dist-input { width:72px; text-align:center; font-size:12px; padding:2px 4px; border:1px solid #94a3b8; border-radius:4px; background:#fff; }
    /* === detail row TD — ביטול מוחלט של כל מגבלות הטבלה החיצונית === */
    .ds-ops-mgmt-screen .ds-ops-workshops-table tr.ds-ops-workshop-detail-row > td { padding:0 !important; border:none !important; border-top:1px solid #dbeafe !important; background:transparent !important; overflow:visible !important; white-space:normal !important; height:auto !important; text-align:right !important; vertical-align:top !important; box-sizing:border-box !important; }
    /* detail container */
    .ds-ops-mgmt-screen .ds-ops-workshop-detail { display:block; background:#f1f5f9; border:1.5px solid #bfdbfe; border-radius:12px; padding:12px 16px; margin:4px 2px 6px; box-sizing:border-box; overflow:visible; }
    .ds-ops-mgmt-screen .ds-ops-workshop-detail > strong { display:block; font-size:13px; font-weight:800; color:#1e3a8a; margin-bottom:8px; padding-bottom:6px; border-bottom:1px solid #bfdbfe; white-space:normal; }
    /* שורת מיקומים — טקסט בשורה אחת */
    .ds-ops-mgmt-screen .ds-ops-workshop-detail__locations-line { font-size:12px; color:#334155; margin-bottom:10px; white-space:normal; line-height:1.5; }
    .ds-ops-mgmt-screen .ds-ops-workshop-detail__loc-label { font-weight:700; color:#1e3a8a; }
    /* טבלת מדריכים — wrapper ותוכן */
    .ds-ops-mgmt-screen .ds-ops-workshop-detail__instructors-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:8px; padding:8px; box-sizing:border-box; overflow:visible; }
    .ds-ops-mgmt-screen .ds-ops-workshop-detail__table-title { display:block; font-weight:800; color:#1e3a8a; font-size:12px; margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid #dbeafe; white-space:normal; }
    /* dist-table — ביטול cascade מהטבלה החיצונית */
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-dist-table { table-layout:fixed !important; width:100% !important; font-size:11px !important; direction:rtl; box-sizing:border-box; border-collapse:collapse; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-dist-table th,
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-dist-table td { overflow:visible !important; white-space:normal !important; text-overflow:clip !important; padding:3px 4px !important; font-size:11px !important; vertical-align:middle !important; border:1px solid #e2e8f0 !important; box-sizing:border-box !important; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table .ds-ops-dist-table th { background:#f8fafc !important; font-weight:700 !important; color:#1e3a8a !important; border-bottom:2px solid #93c5fd !important; text-align:center !important; }
    /* dist-table instructors — עמודת מדריך: auto; שאר: פיקסלים קבועים */
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors { width:50% !important; margin:0 auto !important; }
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors .ds-ops-dist-col--instructor { text-align:right !important; width:auto !important; }
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors .ds-ops-dist-col--number { text-align:center !important; width:70px !important; }
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors .ds-ops-dist-col--status { text-align:center !important; width:150px !important; white-space:normal !important; overflow-wrap:anywhere !important; word-break:normal !important; line-height:1.3; }
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors td.ds-ops-dist-col--status,
    .ds-ops-mgmt-screen .ds-ops-dist-table--instructors th.ds-ops-dist-col--status { white-space:normal !important; overflow:visible !important; text-overflow:clip !important; }
    .ds-ops-mgmt-screen .ds-ops-workshop-status-text { white-space:normal !important; overflow-wrap:anywhere; word-break:normal; }
    .ds-ops-mgmt-screen .ds-ops-estimate-mark { color:#9a3412; font-weight:800; }
    .ds-ops-mgmt-screen .ds-ops-stock-cell { white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-stock-input { width:64px; text-align:center; font-size:12px; padding:2px 4px; border:1px solid #94a3b8; border-radius:4px; background:#fff; }
    .ds-ops-mgmt-screen .ds-ops-stock-save-btn { background:#0369a1; color:#fff; border:none; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:11px; margin-inline-start:2px; }
    .ds-ops-mgmt-screen .ds-ops-stock-cancel-btn { background:#94a3b8; color:#fff; border:none; border-radius:4px; padding:2px 6px; cursor:pointer; font-size:11px; margin-inline-start:2px; }
    .ds-ops-mgmt-screen .ds-ops-schools-authority { margin-block:14px; border:1px solid #d8e5ee; border-radius:16px; background:#fff; overflow:hidden; }
    .ds-ops-mgmt-screen .ds-ops-schools-authority__header { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:12px 16px; background:#eefaff; border-bottom:1px solid #d8e5ee; font-weight:700; }
    .ds-ops-mgmt-screen .ds-ops-schools-authority__stats,
    .ds-ops-mgmt-screen .ds-ops-school-card__meta,
    .ds-ops-mgmt-screen .ds-ops-tag-list { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
    .ds-ops-mgmt-screen .ds-ops-pill { display:inline-flex; align-items:center; border:1px solid #dbe7ef; background:#f8fbfd; color:#475569; border-radius:999px; padding:2px 8px; font-size:12px; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-schools-grid { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:12px; padding:12px; }
    .ds-ops-mgmt-screen .ds-ops-school-card { border:1px solid #d8e5ee; border-radius:12px; background:#fff; padding:10px; box-shadow:none; }
    .ds-ops-mgmt-screen .ds-ops-school-card__top { display:flex; justify-content:space-between; gap:10px; align-items:start; margin-bottom:8px; }
    .ds-ops-mgmt-screen .ds-ops-school-card__title { font-size:15px; font-weight:800; color:#0f172a; line-height:1.35; }
    .ds-ops-mgmt-screen .ds-ops-school-card__toggle { border:1px solid #cfe1ec; background:#f8fbfd; color:#0f8fa8; border-radius:999px; padding:5px 10px; font-weight:700; cursor:pointer; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-tag { border-radius:999px; padding:3px 8px; font-size:12px; background:#eef6ff; border:1px solid #d5e8ff; color:#1e3a8a; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-tag--guide { background:#f5f3ff; border-color:#ddd6fe; color:#5b21b6; }
    .ds-ops-mgmt-screen .ds-ops-tag--warn { background:#fff7ed; border-color:#fed7aa; color:#9a3412; }
    .ds-ops-mgmt-screen .ds-ops-school-detail { margin-top:12px; border-top:1px solid #e2e8f0; padding-top:10px; }
    .ds-ops-mgmt-screen .ds-ops-authority-school { border:1px solid #d8e5ee; border-radius:12px; background:#fff; margin:10px 12px; overflow:hidden; }
    .ds-ops-mgmt-screen .ds-ops-authority-school__header { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; padding:9px 12px; background:#f8fbfd; border-bottom:1px solid #e2e8f0; }
    .ds-ops-mgmt-screen .ds-ops-authority-date { padding:10px 12px 14px; border-top:1px solid #eef2f7; display:flex; flex-direction:column; align-items:center; }
    .ds-ops-mgmt-screen .ds-ops-authority-date:first-of-type { border-top:0; }
    .ds-ops-mgmt-screen .ds-ops-authority-date__title { display:block; width:55%; max-width:55%; margin:0 0 6px; padding:4px 10px; border-radius:8px; background:#eef6ff; color:#1e3a8a; font-size:12px; font-weight:800; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-authority-date .ds-table-wrap { width:55%; max-width:55%; margin-top:0; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table { width:100%; margin:0; table-layout:fixed; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table .ds-ops-col--time { width:20%; white-space:nowrap; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table .ds-ops-col--instructor { width:27%; white-space:normal; word-break:break-word; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table .ds-ops-col--grade { width:20%; text-align:center; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table .ds-ops-col--activity { width:33%; white-space:normal; word-break:break-word; }
    .ds-ops-mgmt-screen .ds-ops-authorities-table th,.ds-ops-mgmt-screen .ds-ops-authorities-table td { padding-top:0.25rem; padding-bottom:0.25rem; padding-inline:0.35rem; }
    .ds-ops-mgmt-screen .ds-ops-completion-panel { display:flex; justify-content:center; width:100%; }
    .ds-ops-mgmt-screen .ds-ops-completion-workspace { width:min(100%,1280px); max-width:100%; margin-inline:auto; display:flex; flex-direction:column; gap:8px; align-items:stretch; box-sizing:border-box; padding-inline:12px; }
    .ds-ops-mgmt-screen .ds-ops-completion-control-card { width:100%; box-sizing:border-box; display:flex; flex-direction:column; align-items:flex-start; gap:6px; padding:8px 14px 8px; border:1px solid #d8e5ee; border-radius:14px; background:#f8fbfd; box-shadow:0 1px 2px rgba(15,23,42,0.04); }
    .ds-ops-mgmt-screen .ds-ops-completion-title-bar { display:flex; flex-direction:row; align-items:center; gap:10px; flex-wrap:nowrap; width:100%; min-width:0; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary { position:relative; flex:0 0 auto; text-align:right; color:#0f172a; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary__title { appearance:none; border:0; background:transparent; color:#0f172a; margin:0; padding:0 0 1px; font:inherit; font-size:17px; line-height:1.25; font-weight:800; cursor:pointer; border-bottom:1px dashed transparent; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary__title:hover,
    .ds-ops-mgmt-screen .ds-ops-completion-summary__title:focus-visible { color:#0f8fa8; border-bottom-color:#8bd3df; outline:none; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary-popover { position:absolute; inset-block-start:calc(100% + 8px); inset-inline-start:0; inset-inline-end:auto; z-index:5; width:320px; max-width:min(90vw, 320px); box-sizing:border-box; padding:10px 14px; border:1px solid #d8e5ee; border-radius:14px; background:#fff; box-shadow:0 14px 30px rgba(15,23,42,0.14); color:#334155; font-size:13px; line-height:1.45; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary-popover p { margin:0; }
    .ds-ops-mgmt-screen .ds-ops-completion-summary-popover p + p { margin-top:4px; }
    .ds-ops-mgmt-screen .ds-ops-completion-control-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:6px; width:100%; }
    .ds-ops-mgmt-screen .ds-ops-completion-control-row label,
    .ds-ops-mgmt-screen .ds-ops-approval-print-filter { display:flex; flex-wrap:nowrap; align-items:center; justify-content:flex-start; gap:6px; margin:0; font-weight:700; color:#334155; }
    .ds-ops-mgmt-screen .ds-ops-completion-date-filter input[type="date"] { width:140px; min-width:130px; }
    .ds-ops-mgmt-screen .ds-ops-approval-print-filter select { width:130px; min-width:110px; max-width:160px; }
    .ds-ops-mgmt-screen .ds-ops-completion-control-row .ds-btn { flex:0 0 auto; width:auto; min-width:0; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-filter-toolbar { flex:1 1 auto; flex-wrap:nowrap; min-width:0; }
    .ds-ops-mgmt-screen .ds-ops-completion-selected-date { width:100%; margin:0; padding:8px 10px; border:1px solid #dbeafe; border-radius:10px; background:#eff6ff; color:#1e3a8a; font-size:13px; line-height:1.45; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-subtabs { display:flex; flex-wrap:wrap; justify-content:flex-start; gap:6px; width:100%; padding-top:4px; border-top:1px solid #e2e8f0; }
    .ds-ops-mgmt-screen .ds-ops-completion-subtabs .ds-btn { border-radius:999px; }
    .ds-ops-mgmt-screen .ds-ops-completion-approvals-card { width:100%; margin:0; box-sizing:border-box; }
    .ds-ops-mgmt-screen .ds-ops-completion-approvals-card .ds-card { width:100%; margin:0; box-sizing:border-box; overflow:hidden; border-radius:16px; }
    .ds-ops-mgmt-screen .ds-ops-completion-approvals-card .ds-card__body { padding:8px 10px 10px; }
    .ds-ops-mgmt-screen .ds-ops-completion-approvals-card .ds-table-wrap { width:100%; max-width:100%; box-sizing:border-box; overflow-x:hidden; }
    .ds-ops-mgmt-screen .ds-ops-completion-preview { width:100%; min-width:0; table-layout:fixed; }
    .ds-ops-mgmt-screen .ds-ops-completion-preview th { white-space:nowrap; vertical-align:middle; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-preview th,.ds-ops-mgmt-screen .ds-ops-completion-preview td { padding:5px 8px; line-height:1.25; vertical-align:middle; }
    .ds-ops-mgmt-screen .ds-ops-completion-preview th:first-child,.ds-ops-mgmt-screen .ds-ops-completion-preview td:first-child { padding-inline-start:10px; padding-inline-end:10px; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-preview tbody tr { height:42px; }
    /* completion approvals — semantic column alignment */
    .ds-ops-mgmt-screen .ds-ops-completion-col--status { width:9%; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--date { width:9%; text-align:center; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--authority { width:10%; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--instructor { width:10%; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--school { width:12%; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--who { width:20%; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--contact { width:12%; text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col--actions { width:14%; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-completion-col-contact-cell { text-align:right; }
    .ds-ops-mgmt-screen .ds-ops-completion-col-contact-cell select { width:100%; max-width:100%; box-sizing:border-box; text-align:right; direction:rtl; height:30px; min-height:30px; padding-top:3px; padding-bottom:3px; }
    .ds-ops-mgmt-screen .ds-ops-completion-col-who-cell { white-space:normal; line-height:1.35; }
    .ds-ops-mgmt-screen .ds-ops-completion-actions-cell { text-align:center; vertical-align:middle; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-actions { display:inline-flex; align-items:center; justify-content:center; gap:4px; flex-wrap:nowrap; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-completion-actions .ds-ops-icon-btn { flex:0 0 24px; width:24px; height:24px; font-size:12px; }
    .ds-ops-mgmt-screen .ds-ops-status-approved { display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:3px 8px; border-radius:999px; background:#dcfce7; border:1px solid #86efac; color:#166534; font-weight:800; font-size:12px; line-height:1.2; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-status-rejected { display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:3px 8px; border-radius:999px; background:#fee2e2; border:1px solid #fca5a5; color:#991b1b; font-weight:700; font-size:12px; line-height:1.2; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-status-uploaded { display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:3px 8px; border-radius:999px; background:#dbeafe; border:1px solid #93c5fd; color:#1e40af; font-weight:600; font-size:12px; line-height:1.2; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-btn--success{background:#16a34a;color:#fff;border-color:#15803d}
    .ds-ops-mgmt-screen .ds-btn--success:hover{background:#15803d}
    .ds-ops-mgmt-screen .ds-ops-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer;font-size:13px;line-height:1;color:#334155;vertical-align:middle}
    .ds-ops-mgmt-screen .ds-ops-icon-btn:hover{background:#e2e8f0;border-color:#94a3b8}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--muted{cursor:default;opacity:0.45;border-style:dashed;pointer-events:none}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--approve{background:#dcfce7;border-color:#86efac;color:#166534}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--approve:hover{background:#bbf7d0}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--reject{background:#fee2e2;border-color:#fca5a5;color:#991b1b}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--reject:hover{background:#fecaca}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--add{background:#dcfce7;border-color:#86efac;color:#166534;font-weight:700}
    .ds-ops-mgmt-screen .ds-ops-icon-btn--add:hover{background:#bbf7d0}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog{padding:0;border:1px solid #d8e5ee;border-radius:16px;box-shadow:0 14px 40px rgba(15,23,42,0.18);max-width:520px;width:92vw}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog::backdrop{background:rgba(0,0,0,0.35)}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__inner{padding:20px 22px 18px;display:flex;flex-direction:column;gap:14px;direction:rtl}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__title{margin:0;font-size:17px;font-weight:800;color:#0f172a}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__hint{margin:0;font-size:13px;color:#475569}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:#334155}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__label select{width:100%}
    .ds-ops-mgmt-screen .ds-ops-approval-add-dialog__actions{display:flex;gap:8px;justify-content:flex-start}
    @media (max-width: 700px) {
      .ds-ops-mgmt-screen .ds-ops-completion-workspace { width:100%; }
      .ds-ops-mgmt-screen .ds-ops-completion-control-card { padding:8px 10px; }
      .ds-ops-mgmt-screen .ds-ops-completion-title-bar { flex-wrap:wrap; }
      .ds-ops-mgmt-screen .ds-ops-completion-filter-toolbar { flex:1 1 100%; flex-wrap:wrap; }
      .ds-ops-mgmt-screen .ds-ops-completion-control-row { align-items:stretch; }
      .ds-ops-mgmt-screen .ds-ops-completion-control-row label,
      .ds-ops-mgmt-screen .ds-ops-approval-print-filter { width:100%; align-items:flex-start; }
      .ds-ops-mgmt-screen .ds-ops-completion-date-filter input[type="date"],
      .ds-ops-mgmt-screen .ds-ops-approval-print-filter select { width:min(100%, 220px); }
      .ds-ops-mgmt-screen .ds-ops-completion-approvals-card .ds-table-wrap { overflow-x:auto; }
    }
    @media print {
      .ds-ops-mgmt-screen .ds-ops-schools-authority:not(:first-child) { break-before:page; page-break-before:always; }
      .ds-ops-mgmt-screen .ds-ops-authority-date .ds-table-wrap { width:55%!important; max-width:55%!important; }
      .ds-ops-mgmt-screen .ds-ops-authority-date__title { width:55%!important; max-width:55%!important; }
      /* print — preserve semantic column alignment */
      .ds-ops-mgmt-screen .ds-ops-col--date,
      .ds-ops-mgmt-screen .ds-ops-col--weekday,
      .ds-ops-mgmt-screen .ds-ops-col--time,
      .ds-ops-mgmt-screen .ds-ops-col--grade,
      .ds-ops-mgmt-screen .ds-ops-col--student-count,
      .ds-ops-mgmt-screen .ds-ops-workshop-col--no,
      .ds-ops-mgmt-screen .ds-ops-workshop-col--metric,
      .ds-ops-mgmt-screen .ds-ops-dist-col--number,
      .ds-ops-mgmt-screen .ds-ops-dist-col--status,
      .ds-ops-mgmt-screen .ds-ops-completion-col--status,
      .ds-ops-mgmt-screen .ds-ops-completion-col--date,
      .ds-ops-mgmt-screen .ds-ops-completion-col--actions { text-align:center !important; }
      .ds-ops-mgmt-screen .ds-ops-col--school,
      .ds-ops-mgmt-screen .ds-ops-col--instructor,
      .ds-ops-mgmt-screen .ds-ops-col--activity,
      .ds-ops-mgmt-screen .ds-ops-workshop-col--name,
      .ds-ops-mgmt-screen .ds-ops-dist-col--instructor,
      .ds-ops-mgmt-screen .ds-ops-completion-col--authority,
      .ds-ops-mgmt-screen .ds-ops-completion-col--instructor,
      .ds-ops-mgmt-screen .ds-ops-completion-col--school,
      .ds-ops-mgmt-screen .ds-ops-completion-col--who,
      .ds-ops-mgmt-screen .ds-ops-completion-col--contact { text-align:right !important; }
      /* print — no row break inside table rows */
      .ds-ops-mgmt-screen table tr { break-inside:avoid; page-break-inside:avoid; }
      /* print — hide action buttons */
      .ds-ops-mgmt-screen .ds-ops-completion-col--actions,
      .ds-ops-mgmt-screen .ds-ops-completion-actions-cell { display:none !important; }
      /* print — compact table widths */
      .ds-ops-mgmt-screen .ds-ops-dist-table { width:100% !important; }
      .ds-ops-mgmt-screen .ds-ops-workshops-card { width:100% !important; }
    }
  </style>`;
}

function showOpsToast(msg, durationMs = 2500) {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.style.cssText = 'position:fixed;inset-block-end:28px;inset-inline-start:50%;transform:translateX(-50%);z-index:9999;background:#1e293b;color:#f1f5f9;padding:10px 22px;border-radius:999px;font-size:14px;font-weight:600;box-shadow:0 6px 24px rgba(15,23,42,0.22);white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .18s';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.remove(); }, 200);
  }, durationMs);
}

let _schedulePrintContext = null;
let _schoolsPrintContext = null;

function openOpsPrintWindow({ title = 'הדפסה', bodyHtml = '' } = {}) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.');
    return;
  }
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:18px;color:#111827;background:#fff;font-size:12px;line-height:1.45}
    h1,h2,h3{margin:0 0 8px;color:#0f172a} p{margin:0 0 10px}
    table{width:100%;border-collapse:collapse;margin-top:10px;table-layout:auto} th,td{border:1px solid #cbd5e1;padding:6px 7px;vertical-align:top;text-align:right} th{background:#e6f6fb;color:#0f172a;font-weight:700} tr:nth-child(even) td{background:#f8fafc}.ds-ops-col--date,.ds-ops-col--weekday,.ds-ops-col--time,.ds-ops-col--phone{white-space:nowrap}.ds-ops-col--school,.ds-ops-col--activity,.ds-ops-col--address{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ds-ops-stock-edit-btn,.ds-ops-stock-save-btn,.ds-ops-stock-cancel-btn{display:none}
    .no-print,button,.ds-link-btn,.ds-sort-indicator{display:none!important}.only-print{display:block!important}.ds-ops-mgmt-print-footer{margin-top:14px;font-weight:600}
    @page{size:A4 landscape;margin:12mm}@media print{body{margin:0}tr{break-inside:avoid}}
  </style></head><body>${bodyHtml}</body></html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function sumScheduleStudentCounts(scheduleRows = []) {
  return scheduleRows.reduce((total, entry) => {
    const count = entry?.studentCount ?? null;
    return count !== null && Number.isFinite(Number(count)) ? total + Number(count) : total;
  }, 0);
}

function buildGroupedScheduleHtml({ scheduleRows, state, selectedInstructorFilter, directory, contactsIndex, printContacts = [], contactResponsiblesRows = [], allRows = [] }) {
  if (!scheduleRows || !scheduleRows.length) return '<p>אין פעילויות להדפסה.</p>';
  const ops = ensureOpsState(state);
  const showInstructor = !selectedInstructorFilter;

  const groups = [];
  const groupMap = new Map();
  scheduleRows.forEach((entry) => {
    const activity = entry.activity;
    const date = entry.date || '';
    const authority = getActivityAuthorityName(activity);
    const school = getActivitySchoolDisplayNameClean(activity);
    const groupKey = `${date}|${normalizeOpsText(authority)}|${normalizeOpsText(school)}`;
    if (!groupMap.has(groupKey)) {
      const group = { date, authority, school, entries: [] };
      groupMap.set(groupKey, group);
      groups.push(group);
    }
    groupMap.get(groupKey).entries.push(entry);
  });

  const instructorLine = selectedInstructorFilter
    ? `מדריך: ${selectedInstructorFilter}`
    : 'מדריך: כל המדריכים';
  const dateRange = `${formatDateHe(ops.dateFrom) || '—'}–${formatDateHe(ops.dateTo) || '—'}`;
  const studentTotal = sumScheduleStudentCounts(scheduleRows);

  const blocks = groups.map((group) => {
    const dateLabel = group.date
      ? `${formatDateHeWithWeekday(group.date).split(' · ')[0]} · ${formatDateHe(group.date)}`
      : '—';
    const metaParts = [
      group.authority ? `רשות: ${group.authority}` : '',
      group.school ? `בית ספר: ${group.school}` : ''
    ].filter(Boolean);
    const metaHtml = [
      group.authority ? `<strong>רשות:</strong> ${escapeHtml(group.authority)}` : '',
      group.school ? `<strong>בית ספר:</strong> ${escapeHtml(group.school)}` : ''
    ].filter(Boolean).join(' | ');
    const instructorHeader = showInstructor ? '<th>מדריך</th>' : '';
    const activityRows = group.entries.map((entry) => {
      const a = entry.activity;
      const instrCell = showInstructor ? `<td>${escapeHtml(entry.instructor || '—')}</td>` : '';
      const studentCountLabel = entry.studentCount !== null ? String(entry.studentCount) : '—';
      return `<tr><td>${escapeHtml(entry.time || '—')}</td><td>${escapeHtml(getActivityName(a))}</td><td>${escapeHtml(studentCountLabel)}</td><td>${escapeHtml(getActivityGradeLabel(a) || '—')}</td>${instrCell}</tr>`;
    }).join('');
    const tableClass = showInstructor ? 'pb-act has-instructor' : 'pb-act';
    const contactRows = buildPrintContactRowsForGroup(group, printContacts, contactResponsiblesRows);
    const contactRowsHtml = contactRows.map((row) => `<tr><td>${escapeHtml(printContactFallback(row.school))}</td><td>${escapeHtml(printContactFallback(row.address))}</td><td>${escapeHtml(printContactFallback(row.contactName))}</td><td>${escapeHtml(printContactFallback(row.contactPhone))}</td></tr>`).join('');
    const contactsHtml = contactRowsHtml ? `<section class="pb-contacts"><h3>פרטי קשר ואימות פעילות</h3><table><thead><tr><th>בית ספר</th><th>כתובת</th><th>איש קשר</th><th>טלפון</th></tr></thead><tbody>${contactRowsHtml}</tbody></table></section>` : '';
    const groupDateStr = group.date || '';
    const groupSchoolNorm = normalizePrintContactMatchText(group.school);
    const groupSchoolIds = new Set((group.entries || []).map((entry) => activitySchoolIdForPrint(entry.activity)).filter(Boolean));
    const teamSet = new Set();
    (allRows || []).forEach((activity) => {
      const actSchoolId = activitySchoolIdForPrint(activity);
      const schoolMatch = (actSchoolId && groupSchoolIds.has(actSchoolId))
        || normalizePrintContactMatchText(getActivitySchoolDisplayNameClean(activity)) === groupSchoolNorm;
      if (!schoolMatch) return;
      const dates = activityDatesInRange(activity, ops.dateFrom, ops.dateTo);
      const primary = getActivityPrimaryDate(activity);
      const actDates = dates.length ? dates : (primary ? [primary] : []);
      if (!actDates.includes(groupDateStr)) return;
      getActivityInstructorNames(activity).forEach((name) => { if (name) teamSet.add(name); });
    });
    const teamList = [...teamSet].filter(Boolean);
    const teamText = teamList.length ? teamList.join(', ') : 'ללא מדריכים';
    const overrideMap = opsContactOverrideMap(contactResponsiblesRows);
    const overrideKey = [...groupSchoolIds].map((id) => overrideMap.get(`${groupDateStr}|${id}`)).find(Boolean)
      || overrideMap.get(`${groupDateStr}|${normalizePrintContactMatchText(group.school).replace(/[״"׳']/g, '').replace(/\s+/g, ' ').toLowerCase()}`);
    const responsibleName = String(overrideKey?.responsible_name || (contactRows.length && contactRows[0].responsibleName) || teamList[0] || '').trim() || 'לא הוגדר';
    const teamHtml = `<div class="pb-team-block"><div class="pb-team"><strong>מי איתי היום:</strong> ${escapeHtml(teamText)}</div><div class="pb-team"><strong>האחראי לאישור קיום הפעילות מול איש הקשר בבית הספר הוא:</strong> ${escapeHtml(responsibleName)}</div></div>`;
    return `<div class="pb">
      <div class="pb-hdr">
        <span class="pb-date">${escapeHtml(dateLabel)}</span>
        <span class="pb-meta">${metaHtml}</span>
      </div>
      <table class="${tableClass}"><thead><tr><th>שעות</th><th>פעילות</th><th>משתתפים</th><th>כיתה</th>${instructorHeader}</tr></thead>
      <tbody>${activityRows}</tbody></table>
      ${contactsHtml}
      ${teamHtml}
    </div>`;
  }).join('');

  const contactNotice = `<div class="contact-notice">
  <h2 class="contact-notice__title">אחראי קשר מול בית הספר</h2>
  <p>במקרים שבהם מוגדר אחראי קשר לבית הספר, תפקידו הוא לוודא את קיום הפעילות מול איש הקשר בבית הספר לפחות 48 שעות לפני יום הפעילות.</p>
  <p>אחראי הקשר ישלח תזכורת לאיש הקשר בבית הספר ויברר האם חלו שינויים מהעדכון האחרון שנמסר בתיאום, כגון שינוי בשעות, במיקום, במספר המשתתפים או בצרכים לוגיסטיים.</p>
  <p>לאחר האימות, אחראי הקשר יעדכן את כלל המדריכים המשובצים לאותו יום פעילות בפרטים המעודכנים.</p>
  <p class="contact-notice__emphasis">חשוב להדגיש: תפקיד אחראי הקשר אינו מחליף את אישור הביצוע.<br>כל מדריך נדרש להחתים אישור ביצוע ספציפי עבור הפעילות שביצע, בהתאם לשיבוץ ולנהלי הדיווח.</p>
</div>`;
  return `<div class="ops-print-page"><h1>שיבוץ פעילויות קיץ</h1><p class="subtitle">${escapeHtml(instructorLine)}</p>${contactNotice}<div class="ops-print-grid">${blocks}</div><p class="footer">יש לוודא את קיום הפעילות מול איש הקשר בבית הספר לפחות 48 שעות לפני כל יום פעילות.</p></div>`;
}

function printInstructorSchedule() {
  const ctx = _schedulePrintContext;
  if (!ctx || !ctx.scheduleRows || !ctx.scheduleRows.length) {
    alert('אין פעילויות להדפסה בטווח הנבחר');
    return;
  }
  const title = ctx.selectedInstructorFilter
    ? ctx.selectedInstructorFilter
    : 'שיבוץ פעילויות קיץ - כל המדריכים';
  const css = `
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:10px 14px;color:#111;background:#fff;font-size:11px;line-height:1.3}
    .ops-print-page{width:96%;margin:0 auto}
    h1{margin:0 0 2px;font-size:14px;color:#0f172a}.subtitle{margin:0 0 14px;color:#475569;font-size:10.5px}
    .ops-print-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 8px;align-items:start}
    .pb{border:1px solid #cfd8dc;padding:5px 6px;page-break-inside:avoid;break-inside:avoid}
    .pb-hdr{margin-bottom:5px;break-after:avoid;page-break-after:avoid;text-align:right}
    .pb-date{font-weight:800;font-size:13px;color:#1d4ed8;display:block;text-align:right;margin-bottom:2px}
    .pb-meta{font-size:10px;font-weight:400;color:#334155;display:block;line-height:1.4;margin-top:2px;text-align:right}
    .pb-meta strong{font-weight:700;color:#0f172a}
    table{border-collapse:collapse;margin:0}
    .pb-act{width:100%;border-collapse:collapse;table-layout:fixed;break-before:avoid;page-break-before:avoid;break-inside:auto;page-break-inside:auto}
    .pb-act th,.pb-act td{border:1px solid #cbd5e1;padding:2px 4px;text-align:right;font-size:10px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb-act th{background:#e6f6fb;font-weight:700}
    .pb-contacts{margin-top:5px;break-before:avoid;page-break-before:avoid}
    .pb-contacts h3{margin:0 0 3px;font-size:10px;font-weight:800;color:#0f172a}
    .pb-contacts table{width:100%;table-layout:fixed;border-collapse:collapse}
    .pb-contacts th,.pb-contacts td{border:1px solid #d7dee8;padding:2px 5px;text-align:right;font-size:9px;line-height:1.25;white-space:normal;overflow-wrap:anywhere}
    .pb-contacts th{background:#f1f5f9;font-weight:700}
    .pb-contacts th:nth-child(1),.pb-contacts td:nth-child(1){width:19%}
    .pb-contacts th:nth-child(2),.pb-contacts td:nth-child(2){width:35.5%}
    .pb-contacts th:nth-child(3),.pb-contacts td:nth-child(3){width:23.5%}
    .pb-contacts th:nth-child(4),.pb-contacts td:nth-child(4){width:22%}
    .pb-act tr:nth-child(even) td{background:#f8fafc}
    .pb-act th:nth-child(1),.pb-act td:nth-child(1){width:23%;text-align:center}
    .pb-act th:nth-child(2),.pb-act td:nth-child(2){width:40.5%}
    .pb-act th:nth-child(3),.pb-act td:nth-child(3){width:16.5%;text-align:center}
    .pb-act th:nth-child(4),.pb-act td:nth-child(4){width:20%;text-align:center}
    .pb-act.has-instructor th:nth-child(1),.pb-act.has-instructor td:nth-child(1){width:19%;text-align:center}
    .pb-act.has-instructor th:nth-child(2),.pb-act.has-instructor td:nth-child(2){width:32.5%}
    .pb-act.has-instructor th:nth-child(3),.pb-act.has-instructor td:nth-child(3){width:15.5%;text-align:center}
    .pb-act.has-instructor th:nth-child(4),.pb-act.has-instructor td:nth-child(4){width:13%;text-align:center}
    .pb-act.has-instructor th:nth-child(5),.pb-act.has-instructor td:nth-child(5){width:20%}
    .footer{margin-top:10px;font-size:12px;font-weight:700;color:#0f172a;text-align:center;border-top:1px solid #cbd5e1;padding-top:6px}
    .contact-notice{direction:rtl;text-align:right;border:1px solid #b6c7d4;border-radius:4px;background:#f7fafc;padding:8px 12px;margin:8px 0 14px;break-inside:avoid;page-break-inside:avoid}
    .contact-notice__title{margin:0 0 6px;font-size:12px;font-weight:800;color:#0f172a}
    .contact-notice p{margin:0 0 5px;font-size:10.5px;line-height:1.5;color:#1e293b}
    .contact-notice p:last-child{margin-bottom:0}
    .contact-notice__emphasis{font-weight:700;color:#0f172a!important}
    .pb-team-block{margin-top:6px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:4px;padding:4px 7px;break-before:avoid;page-break-before:avoid}
    .pb-team{font-size:9px;line-height:1.6;color:#1e293b}
    .pb-team+.pb-team{margin-top:1px}
    .pb-team strong{font-weight:700;color:#0f172a}
    @page{size:A4 portrait;margin:8mm}
    @media print{body{margin:0}.pb{page-break-inside:avoid;break-inside:avoid}.pb-hdr{break-after:avoid;page-break-after:avoid}.pb-act,.pb-contacts,.pb-team-block{break-before:avoid;page-break-before:avoid;break-inside:auto;page-break-inside:auto}tr{break-inside:avoid;page-break-inside:avoid}}
  `;
  const bodyHtml = buildGroupedScheduleHtml(ctx);
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.'); return; }
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
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
  openOpsPrintWindow({ title: 'כמויות סדנאות', bodyHtml: `<section>${header}${summary}${table.outerHTML}</section>` });
}

function printSchoolsSchedule() {
  const ctx = _schoolsPrintContext;
  if (!ctx || !ctx.byAuthority || ctx.byAuthority.size === 0) {
    alert('אין רשויות להדפסה בטווח הנבחר');
    return;
  }
  const { byAuthority, ops } = ctx;
  const title = 'רשויות — פעילויות קיץ';
  const dateRange = (ops?.dateFrom && ops?.dateTo)
    ? `טווח תאריכים: ${formatDateHe(ops.dateFrom)}–${formatDateHe(ops.dateTo)}`
    : '';
  const sectionsHtml = Array.from(byAuthority.values()).map((authorityGroup) => {
    // Build date → school → entries (new order: authority > date > school > entries)
    const dateMap = new Map();
    for (const schoolGroup of authorityGroup.schools.values()) {
      for (const [date, entries] of schoolGroup.dates.entries()) {
        if (!dateMap.has(date)) dateMap.set(date, new Map());
        const schoolMap = dateMap.get(date);
        if (!schoolMap.has(schoolGroup.school)) schoolMap.set(schoolGroup.school, []);
        schoolMap.get(schoolGroup.school).push(...entries);
      }
    }
    const sortedDates = Array.from(dateMap.entries()).sort(([a], [b]) => compareDatesAsc(a, b));
    const datesHtml = sortedDates.map(([date, schoolMap]) => {
      const sortedSchools = Array.from(schoolMap.entries()).sort(([a], [b]) => a.localeCompare(b, 'he'));
      const schoolBlocksHtml = sortedSchools.map(([school, entries]) => {
        const sorted = entries.slice().sort((a, b) => {
          const timeCmp = compareValues(a.time || '99:99', b.time || '99:99', 'asc');
          if (timeCmp !== 0) return timeCmp;
          const instrCmp = (a.instructor || '').localeCompare(b.instructor || '', 'he');
          if (instrCmp !== 0) return instrCmp;
          return getActivityName(a.activity).localeCompare(getActivityName(b.activity), 'he');
        });
        const rowsHtml = sorted.map((entry) => {
          const activity = entry.activity;
          return `<tr>
            <td class="col-time">${escapeHtml(entry.time || '—')}</td>
            <td class="col-instructor">${escapeHtml(entry.instructor || '—')}</td>
            <td class="col-class">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
            <td class="col-activity">${escapeHtml(getActivityName(activity))}</td>
          </tr>`;
        }).join('');
        const schoolActivityCount = sorted.length;
        const schoolLabel = schoolActivityCount === 1 ? `${school} | פעילות אחת` : `${school} | ${schoolActivityCount} פעילויות`;
        return `<div class="school-block">
          <div class="school-title authorities-group-title">${escapeHtml(schoolLabel)}</div>
          <div class="date-block authorities-title-table-block">
            <table class="authorities-table"><colgroup><col class="col-time"><col class="col-instructor"><col class="col-class"><col class="col-activity"></colgroup><thead><tr><th class="col-time">שעות</th><th class="col-instructor">מדריך</th><th class="col-class">כיתה</th><th class="col-activity">פעילות / סדנה</th></tr></thead><tbody>${rowsHtml}</tbody></table>
          </div>
        </div>`;
      }).join('');
      const dayLabel = date ? formatDateHeWithWeekday(date).split(' · ')[0] : '—';
      return `<div class="date-section">
        <div class="date-title authorities-group-title">${escapeHtml(formatDateHe(date) || date)} · ${escapeHtml(dayLabel)}</div>
        ${schoolBlocksHtml}
      </div>`;
    }).join('');
    const schools = Array.from(authorityGroup.schools.values());
    return `<div class="authority-section">
      <div class="authority-header">${escapeHtml(authorityHeaderTitle(authorityGroup.authority, schools.length, authorityGroup.activities, authorityGroup.quantityTotal))}</div>
      ${datesHtml}
    </div>`;
  }).join('');

  const css = `
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:10px 14px;color:#111;background:#fff;font-size:11px;line-height:1.3}
    h1{margin:0 0 2px;font-size:14px;color:#0f172a}
    .subtitle{margin:0 0 10px;color:#475569;font-size:10.5px}
    .authority-section{margin-bottom:8px;}
    .authority-section:not(:first-child){break-before:page;page-break-before:always;}
    .authority-header{font-size:13px;font-weight:800;color:#0369a1;margin:0 auto 6px;padding:4px 10px;width:55%;max-width:55%;background:#eef6ff;border-right:4px solid #0369a1;border-radius:6px;}
    .authority-stats{font-size:10px;font-weight:400;color:#64748b;margin-right:8px}
    .date-section{margin-bottom:10px;}
    .date-title{font-size:11.5px;font-weight:800;color:#0369a1;margin:0 auto 5px;padding:3px 10px;background:#dbeafe;border-right:4px solid #2563eb;border-radius:4px;width:70%;max-width:70%;text-align:right;break-after:avoid-page;page-break-after:avoid;}
    .school-block{margin-bottom:6px;}
    .school-title{font-size:10.5px;font-weight:700;color:#1e293b;margin:0 auto 2px;padding:2px 8px;background:#f1f5f9;border-right:3px solid #94a3b8;width:70%;max-width:70%;break-after:avoid-page;page-break-after:avoid}
    .date-block{display:block;width:70%;max-width:70%;margin:0 auto 4px;}
    .authorities-title-table-block{break-inside:avoid-page;page-break-inside:avoid}
    .authorities-table{border-collapse:collapse;width:100%;table-layout:fixed}
    .authorities-table .col-time{width:20%;text-align:center}
    .authorities-table .col-instructor{width:27%}
    .authorities-table .col-class{width:20%;text-align:center}
    .authorities-table .col-activity{width:33%}
    .authorities-table th,.authorities-table td{border:1px solid #cbd5e1;padding:2px 4px;text-align:right;font-size:9px;line-height:1.15;white-space:normal;word-break:break-word;overflow-wrap:anywhere}
    .authorities-table th{background:#e6f6fb;font-weight:700}
    .authorities-table tr:nth-child(even) td{background:#f8fafc}
    .authorities-table tr{break-inside:avoid-page;page-break-inside:avoid}
    .footer{margin-top:10px;font-size:11px;font-weight:700;color:#0f172a;text-align:center;border-top:1px solid #cbd5e1;padding-top:5px}
    @page{size:A4 portrait;margin:8mm}
    @media print{body{margin:0}.authority-section:not(:first-child){break-before:page;page-break-before:always;}.date-section{margin-bottom:8px!important;}.date-title{width:70%!important;max-width:70%!important;break-after:avoid-page;page-break-after:avoid}.school-title{width:70%!important;max-width:70%!important;break-after:avoid-page;page-break-after:avoid}.date-block{width:70%!important;max-width:70%!important;margin:0 auto 4px!important;display:block!important;}.authorities-table{width:100%!important;table-layout:fixed!important}.authorities-table .col-time{width:20%!important}.authorities-table .col-instructor{width:27%!important}.authorities-table .col-class{width:20%!important}.authorities-table .col-activity{width:33%!important}.authorities-table th,.authorities-table td{white-space:normal!important;word-break:break-word!important;overflow-wrap:anywhere!important;font-size:9px;padding:2px 4px;line-height:1.15}.authorities-title-table-block{break-inside:avoid-page;page-break-inside:avoid}.authorities-table tr{break-inside:avoid-page;page-break-inside:avoid}}
  `;
  const bodyHtml = `
    <h1>${escapeHtml(title)}</h1>
    ${dateRange ? `<p class="subtitle">${escapeHtml(dateRange)}</p>` : ''}
    ${sectionsHtml}
    <div class="footer">הופק ממערכת ניהול הפעילויות</div>
  `;
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.'); return; }
  const fullHtml = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${bodyHtml}</body></html>`;
  printWindow.document.open();
  printWindow.document.write(fullHtml);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function instructorsTabHtml(rows, state, data = {}, directory = buildSchoolsDirectory([]), contactsIndex = new Map(), allPreparedRows = []) {
  const ops = ensureOpsState(state);
  const filters = ensureActivityListFilters(state, SCOPE);
  const scheduleRows = buildScheduleRows(rows, state, directory);
  const selectedInstructorFilter = String(filters.instructor || '').trim();
  const printTitle = selectedInstructorFilter ? selectedInstructorFilter : 'כל המדריכים';
  _schedulePrintContext = { scheduleRows, state, selectedInstructorFilter, directory, contactsIndex, printContacts: data?.instructorSchedulePrintContactsRows || [], contactResponsiblesRows: data?.contactResponsiblesRows || [], allRows: allPreparedRows.length ? allPreparedRows : rows };

  const tableRows = scheduleRows.map((entry) => {
    const activity = entry.activity;
    return `<tr>
      <td class="ds-ops-col--date"><strong>${escapeHtml(formatDateHe(entry.date) || '—')}</strong></td>
      <td class="ds-ops-col--weekday">${escapeHtml(entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '—')}</td>
      <td class="ds-ops-col--time">${escapeHtml(entry.time || '—')}</td>
      <td class="ds-ops-col--student-count">${escapeHtml(entry.studentCount !== null ? String(entry.studentCount) : '—')}</td>
      <td>${escapeHtml(getActivityAuthorityName(activity))}</td>
      <td class="ds-ops-col--school"><strong>${escapeHtml(getActivitySchoolDisplayNameClean(activity))}</strong></td>
      <td class="ds-ops-col--instructor">${escapeHtml(entry.instructor || '—')}</td>
      <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
      <td class="ds-ops-col--activity">${escapeHtml(getActivityName(activity))}</td>
    </tr>`;
  }).join('');

  const table = scheduleRows.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-schedule"><thead><tr>
        ${sortableTh(state, TAB_INSTRUCTORS, 'date', 'תאריך', 'ds-ops-col--date')}${sortableTh(state, TAB_INSTRUCTORS, 'weekday', 'יום', 'ds-ops-col--weekday')}${sortableTh(state, TAB_INSTRUCTORS, 'time', 'שעות', 'ds-ops-col--time')}${sortableTh(state, TAB_INSTRUCTORS, 'studentCount', 'מס׳ תלמידים', 'ds-ops-col--student-count')}${sortableTh(state, TAB_INSTRUCTORS, 'authority', 'רשות')}${sortableTh(state, TAB_INSTRUCTORS, 'school', 'בית ספר / מסגרת', 'ds-ops-col--school')}${sortableTh(state, TAB_INSTRUCTORS, 'instructor', 'מדריך', 'ds-ops-col--instructor')}${sortableTh(state, TAB_INSTRUCTORS, 'grade', 'כיתה', 'ds-ops-col--grade')}${sortableTh(state, TAB_INSTRUCTORS, 'activity', 'פעילות', 'ds-ops-col--activity')}
      </tr></thead><tbody>${tableRows}</tbody></table>`)
    : dsEmptyState('לא נמצאו פעילויות בטווח הנבחר');

  const instructorRows = selectedInstructorFilter ? rows.filter((row) => getActivityInstructorNames(row).includes(selectedInstructorFilter)) : rows;
  const activeSummary = selectedInstructorFilter ? instructorSummary(instructorRows, state, scheduleRows) : tabOverviewSummary(rows, scheduleRows);
  const directoryNote = '';

  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    ${activeSummary}
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print>הדפס סידור עבודה</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print">
      <h2>סידור עבודה — ${escapeHtml(printTitle)}</h2>
      <p>טווח תאריכים: ${escapeHtml(formatDateHe(ops.dateFrom))}–${escapeHtml(formatDateHe(ops.dateTo))}</p>
    </div>
    ${directoryNote}
    <div class="ds-ops-schedule-wrap">${dsCard({ title: 'טבלת סידור עבודה', badge: String(scheduleRows.length), body: table, padded: false })}</div>
    <p class="ds-ops-mgmt-print-footer only-print">יש לבדוק את פרטי הפעילות לפני הגעה. במקרה של שינוי, יש לעדכן את התפעול.</p>
  </section>`;
}

function workshopStatusText(status) {
  const label = status?.label || '—';
  const tone = String(status?.tone || 'muted').replace(/[^a-z0-9_-]/gi, '');
  return `<span class="ds-ops-workshop-status-text ds-ops-workshop-status-text--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function workshopInstructorDetailHtml(row) {
  const locationItems = (row.stockLocationRows || []).filter((item) => !/סה.?כ/.test(item.location || '') && Number(item.quantity) > 0);
  const locationLine = locationItems.length
    ? locationItems.map((item) => `${escapeHtml(item.location)} (${formatSignedNumberForRtl(item.quantity)})`).join(', ')
    : '';
  const instructorsBody = row.instructorRows.length
    ? row.instructorRows.map((item) => `<tr>
      <td class="ds-ops-dist-col--instructor">${escapeHtml(item.instructor)}</td>
      <td class="ds-ops-dist-col--number">${formatSignedNumberForRtl(item.received)}</td>
      <td class="ds-ops-dist-col--number">${formatSignedNumberForRtl(item.required)}</td>
      <td class="ds-ops-dist-col--number">${formatGapCell(item.balance, true)}</td>
      <td class="ds-ops-dist-col--status">${workshopStatusText(item.status)}</td>
    </tr>`).join('')
    : `<tr><td colspan="5">${dsEmptyState('אין נתוני מדריכים או חלוקות בטווח הנוכחי')}</td></tr>`;
  return `<tr class="ds-ops-workshop-detail-row"><td colspan="6"><div class="ds-ops-workshop-detail">
    <strong>פירוט סדנה — ${escapeHtml(row.workshopName)}</strong>
    ${locationLine ? `<div class="ds-ops-workshop-detail__locations-line"><span class="ds-ops-workshop-detail__loc-label">מיקום:</span> ${locationLine}</div>` : ''}
    <div class="ds-ops-workshop-detail__instructors-wrap">
      <span class="ds-ops-workshop-detail__table-title">חלוקה למדריכים</span>
      <table class="ds-table ds-table--compact ds-ops-dist-table ds-ops-dist-table--instructors"><colgroup><col class="ds-ops-dist-col--instructor"><col class="ds-ops-dist-col--number"><col class="ds-ops-dist-col--number"><col class="ds-ops-dist-col--number"><col class="ds-ops-dist-col--status"></colgroup><thead><tr><th class="ds-ops-dist-col--instructor">מדריך</th><th class="ds-ops-dist-col--number">קיבל</th><th class="ds-ops-dist-col--number">נדרש</th><th class="ds-ops-dist-col--number">יתרה</th><th class="ds-ops-dist-col--status">סטטוס</th></tr></thead><tbody>${instructorsBody}</tbody></table>
    </div>
  </div></td></tr>`;
}

function workshopsTabHtml(activitiesRowsForRequiredInventory, state, stockMap, catalogRows = [], workshopStockDistributions = []) {
  const ops = ensureOpsState(state);
  const allMetrics = sortByConfig(workshopMetricsRows(activitiesRowsForRequiredInventory, stockMap, catalogRows, workshopStockDistributions, { from: WORKSHOPS_SUMMER_FROM, to: WORKSHOPS_SUMMER_TO }), state, TAB_WORKSHOPS, {
    workshopNo: (row) => row.workshopNo || row.workshopName,
    workshopName: (row) => row.workshopName,
    activityCount: (row) => row.activityCount,
    estimatedQuantity: (row) => row.requiredQuantity,
  });
  const metrics = allMetrics.filter((row) => (row.stockQuantity !== null && Number(row.stockQuantity) > 0) || row.requiredQuantity !== 0 || row.deliveredQuantity !== 0);
  const table = metrics.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"><colgroup><col class="ds-ops-workshop-col--no"><col class="ds-ops-workshop-col--name"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"><col class="ds-ops-workshop-col--metric"></colgroup><thead><tr>
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopNo', 'מספר סדנה', 'ds-ops-workshop-col--no')}
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopName', 'שם הפעילות', 'ds-ops-workshop-col--name')}
        <th class="ds-ops-workshop-col--metric">מלאי כולל</th>
        ${sortableTh(state, TAB_WORKSHOPS, 'estimatedQuantity', 'מלאי נדרש', 'ds-ops-workshop-col--metric')}
        <th class="ds-ops-workshop-col--metric">פער</th>
        <th class="ds-ops-workshop-col--metric">נמסר למדריכים</th>
      </tr></thead><tbody>${metrics.map((row) => {
        const isExpanded = ops.expandedWorkshop === row.stockGroupKey;
        const mainRow = `<tr class="${isExpanded ? 'ds-ops-row--expanded' : ''}" data-ops-workshop-toggle="${escapeHtml(row.stockGroupKey || '')}" data-ops-stock-group="${escapeHtml(row.stockGroupKey || '')}" tabindex="0" role="button" aria-expanded="${isExpanded ? 'true' : 'false'}">
          <td class="ds-ops-workshop-col--no">${escapeHtml(row.workshopNoDisplay || row.workshopNo || row.stockGroupKey || '—')}</td>
          <td class="ds-ops-workshop-col--name">${escapeHtml(row.workshopName)}${row.activitiesWithoutParticipants ? ` <span class="ds-ops-estimate-mark" title="חסר מספר משתתפים ב-${row.activitiesWithoutParticipants} פעילויות; הן חושבו כ-0 במלאי נדרש">!</span>` : ''}</td>
          <td class="ds-ops-workshop-col--metric">${row.stockQuantity === null ? '<span class="ds-ops-mgmt-cell-muted">—</span>' : formatSignedNumberForRtl(row.stockQuantity)}</td>
          <td class="ds-ops-workshop-col--metric">${formatSignedNumberForRtl(row.requiredQuantity)}</td>
          <td class="ds-ops-workshop-col--metric">${row.expectedBalance === null ? '<span class="ds-ops-mgmt-cell-muted">—</span>' : formatGapCell(row.expectedBalance, true)}</td>
          <td class="ds-ops-workshop-col--metric">${formatSignedNumberForRtl(row.deliveredQuantity)}</td>
        </tr>`;
        const detailHtml = workshopInstructorDetailHtml(row).replace(
          'class="ds-ops-workshop-detail-row"',
          `class="ds-ops-workshop-detail-row" data-workshop-detail="${escapeHtml(row.stockGroupKey || '')}"${isExpanded ? '' : ' hidden'}`
        );
        return mainRow + detailHtml;
      }).join('')}</tbody></table>`)
    : dsEmptyState('לא נמצאו סדנאות בטווח הנבחר');

  return `<section class="ds-ops-mgmt-panel ds-ops-workshops-panel" dir="rtl">
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print-workshops>הדפס מלאי סדנאות</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print"><h2>מלאי סדנאות</h2><p>טווח קיץ: ${escapeHtml(formatDateHe(WORKSHOPS_SUMMER_FROM))} – ${escapeHtml(formatDateHe(WORKSHOPS_SUMMER_TO))}</p></div>
    <div class="ds-ops-workshops-card">${dsCard({ title: 'מלאי סדנאות', badge: String(metrics.length), body: `<div class="ds-ops-workshops-table-wrap">${table}</div>`, padded: false })}</div>
  </section>`;
}

function authorityScheduleEntryKey(entry = {}) {
  const activity = entry.activity || {};
  return [
    activity.RowID, activity.row_id, activity.id, activity.activity_id, activity.uuid,
    entry.date, entry.time, getActivityAuthorityName(activity), getActivitySchoolDisplayNameClean(activity),
    getActivityInstructorName(activity), getActivityGradeLabel(activity), getActivityName(activity)
  ].map((value) => String(value || '').trim()).filter(Boolean).join('|');
}

function compareDatesAsc(a, b) {
  const da = (a && String(a).slice(0, 10)) || '9999-99-99';
  const db = (b && String(b).slice(0, 10)) || '9999-99-99';
  return da < db ? -1 : da > db ? 1 : 0;
}

function sortAuthorityScheduleRows(scheduleRows = []) {
  return scheduleRows.slice().sort((a, b) => {
    const authorityCmp = getActivityAuthorityName(a.activity).localeCompare(getActivityAuthorityName(b.activity), 'he');
    if (authorityCmp !== 0) return authorityCmp;
    const schoolCmp = getActivitySchoolDisplayNameClean(a.activity).localeCompare(getActivitySchoolDisplayNameClean(b.activity), 'he');
    if (schoolCmp !== 0) return schoolCmp;
    const dateCmp = compareDatesAsc(a.date, b.date);
    if (dateCmp !== 0) return dateCmp;
    const timeCmp = compareValues(a.time || '99:99', b.time || '99:99', 'asc');
    if (timeCmp !== 0) return timeCmp;
    const workshopCmp = getActivityName(a.activity).localeCompare(getActivityName(b.activity), 'he');
    if (workshopCmp !== 0) return workshopCmp;
    return getActivityInstructorName(a.activity).localeCompare(getActivityInstructorName(b.activity), 'he');
  });
}

function schoolsTabHtml(rows, state, directory = buildSchoolsDirectory([]), contactsIndex = new Map()) {
  const ops = ensureOpsState(state);
  const scheduleRows = sortAuthorityScheduleRows(buildScheduleRows(rows, state, directory));
  const seenEntries = new Set();
  const byAuthority = new Map();

  scheduleRows.forEach((entry) => {
    const key = authorityScheduleEntryKey(entry);
    if (seenEntries.has(key)) return;
    seenEntries.add(key);

    const activity = entry.activity;
    const authority = getActivityAuthorityName(activity);
    const school = getActivitySchoolDisplayNameClean(activity);
    const date = entry.date || '';
    if (!byAuthority.has(authority)) {
      byAuthority.set(authority, { authority, schools: new Map(), activities: 0, quantityTotal: 0, instructors: new Set() });
    }
    const authorityGroup = byAuthority.get(authority);
    authorityGroup.activities += 1;
    authorityGroup.quantityTotal += entry.quantity;
    const instructor = entry.instructor || getActivityInstructorName(activity);
    if (instructor !== 'לא משויך') authorityGroup.instructors.add(instructor);

    if (!authorityGroup.schools.has(school)) {
      authorityGroup.schools.set(school, { school, dates: new Map(), activities: 0, quantityTotal: 0, workshops: new Set(), instructors: new Set() });
    }
    const schoolGroup = authorityGroup.schools.get(school);
    schoolGroup.activities += 1;
    schoolGroup.quantityTotal += entry.quantity;
    schoolGroup.workshops.add(getActivityName(activity));
    if (instructor !== 'לא משויך') schoolGroup.instructors.add(instructor);

    if (!schoolGroup.dates.has(date)) schoolGroup.dates.set(date, []);
    schoolGroup.dates.get(date).push(entry);
  });

  const authoritySections = Array.from(byAuthority.values()).map((authorityGroup) => {
    const schools = Array.from(authorityGroup.schools.values()).sort((a, b) => a.school.localeCompare(b.school, 'he'));
    const schoolBlocks = schools.map((schoolGroup) => {
      const dateBlocks = Array.from(schoolGroup.dates.entries()).sort(([a], [b]) => compareDatesAsc(a, b)).map(([date, entries]) => {
        const sortedEntries = entries.slice().sort((a, b) => {
          const timeCmp = compareValues(a.time || '99:99', b.time || '99:99', 'asc');
          if (timeCmp !== 0) return timeCmp;
          const schoolCmp = getActivitySchoolDisplayNameClean(a.activity).localeCompare(getActivitySchoolDisplayNameClean(b.activity), 'he');
          if (schoolCmp !== 0) return schoolCmp;
          const instrCmp = (a.instructor || '').localeCompare(b.instructor || '', 'he');
          if (instrCmp !== 0) return instrCmp;
          return getActivityName(a.activity).localeCompare(getActivityName(b.activity), 'he');
        });
        const rowsHtml = sortedEntries.map((entry) => {
          const activity = entry.activity;
          return `<tr>
            <td class="ds-ops-col--time">${escapeHtml(entry.time || '—')}</td>
            <td class="ds-ops-col--instructor">${escapeHtml(entry.instructor || '—')}</td>
            <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
            <td class="ds-ops-col--activity">${escapeHtml(getActivityName(activity))}</td>
          </tr>`;
        }).join('');
        const dayLabel = date ? formatDateHeWithWeekday(date).split(' · ')[0] : '—';
        return `<section class="ds-ops-authority-date">
          <h4 class="ds-ops-authority-date__title">${escapeHtml(dayLabel)} · ${escapeHtml(formatDateHe(date) || 'ללא תאריך')}</h4>
          ${dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-authorities-table"><colgroup><col class="ds-ops-col--time"><col class="ds-ops-col--instructor"><col class="ds-ops-col--grade"><col class="ds-ops-col--activity"></colgroup><thead><tr><th class="ds-ops-col--time">שעות</th><th class="ds-ops-col--instructor">מדריך</th><th class="ds-ops-col--grade">כיתה</th><th class="ds-ops-col--activity">פעילות / סדנה</th></tr></thead><tbody>${rowsHtml}</tbody></table>`)}
        </section>`;
      }).join('');
      return `<article class="ds-ops-authority-school">
        <header class="ds-ops-authority-school__header">
          <strong class="ds-ops-school-card__title">${escapeHtml(schoolHeaderTitle(schoolGroup.school, schoolGroup.activities, schoolGroup.quantityTotal))}</strong>
        </header>
        ${dateBlocks}
      </article>`;
    }).join('');
    return `<section class="ds-ops-schools-authority"><header class="ds-ops-schools-authority__header"><strong>${escapeHtml(authorityHeaderTitle(authorityGroup.authority, schools.length, authorityGroup.activities, authorityGroup.quantityTotal))}</strong></header>${schoolBlocks}</section>`;
  }).join('');

  const schoolCount = Array.from(byAuthority.values()).reduce((sum, group) => sum + group.schools.size, 0);
  _schoolsPrintContext = { byAuthority, ops };
  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print-schools>הדפס רשויות</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print"><h2>רשויות — פעילויות קיץ</h2><p>טווח תאריכים: ${escapeHtml(formatDateHe(ops.dateFrom))}–${escapeHtml(formatDateHe(ops.dateTo))}</p></div>
    ${compactSummaryLineHtml([
      { label: 'רשויות', value: byAuthority.size },
      { label: 'בתי ספר', value: schoolCount },
      { label: 'פעילויות', value: seenEntries.size },
      { label: 'מדריכים', value: instructorOptions(rows).length }
    ])}
    ${authoritySections || dsEmptyState('לא נמצאו בתי ספר')}
  </section>`;
}


let _completionApprovalPrintContext = null;

function printCompletionApprovals(approvals = [], title = 'אישור ביצוע פעילות') {
  if (!approvals.length) {
    alert('לא נמצאו פעילויות להפקת אישור ביצוע לפי הבחירה הנוכחית.');
    return;
  }
  const safeTitle = title || 'אישור ביצוע פעילות';
  try { document.title = safeTitle; } catch { /* ignore */ }
  const printWindow = window.open('', '_blank');
  if (!printWindow) { alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.'); return; }
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(safeTitle)}</title><style>${completionApprovalPrintCss}</style></head><body>${completionApprovalsPrintHtml(approvals)}</body></html>`;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 250);
}

function completionApprovalsForState(rows, state, directory, contactsIndex, summerPrintContactsIndex = new Map()) {
  const approvalState = ensureOpsState(state).completionApproval || {};
  return buildCompletionApprovals(rows, {
    instructor: approvalState.instructor,
    dateMode: approvalState.dateMode,
    date: approvalState.date,
    dateFrom: approvalState.dateFrom,
    dateTo: approvalState.dateTo,
    directory,
    contactsIndex,
    summerPrintContactsIndex
  });
}



function completionApprovalIsHandled(upload) {
  const status = String(upload?.status || '').trim();
  return !!upload?.file_path || status === 'uploaded' || status === 'approved';
}

function completionApprovalSortBucket(dateIso, handled, todayIso = localTodayIso()) {
  const date = String(dateIso || '').slice(0, 10);
  if (!handled && date === todayIso) return 0;
  if (!handled && date > todayIso) return 1;
  if (handled) return 2;
  return 3;
}

function compareCompletionApprovalWorkItems(a, b, todayIso = localTodayIso()) {
  const dateA = String(a?.approval?.date || '').slice(0, 10);
  const dateB = String(b?.approval?.date || '').slice(0, 10);
  const handledA = completionApprovalIsHandled(a?.upload);
  const handledB = completionApprovalIsHandled(b?.upload);
  const bucketA = completionApprovalSortBucket(dateA, handledA, todayIso);
  const bucketB = completionApprovalSortBucket(dateB, handledB, todayIso);
  if (bucketA !== bucketB) return bucketA - bucketB;
  const dateCompare = dateA.localeCompare(dateB);
  if (dateCompare) return dateCompare;
  return String(a?.approval?.instructorName || '').localeCompare(String(b?.approval?.instructorName || ''), 'he', { numeric: true })
    || String(a?.approval?.school || '').localeCompare(String(b?.approval?.school || ''), 'he', { numeric: true });
}

function completionApprovalPrintInstructorOptions(approvals = []) {
  return uniqueSorted((Array.isArray(approvals) ? approvals : []).map((approval) => approval?.instructorName).filter(isValidInstructorName));
}

function completionApprovalUploadKey(approval) {
  const normalize = (value) => String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
  return `${String(approval?.date || '').trim()}|${normalize(approval?.authority)}|${normalize(approval?.school)}|${normalize(approval?.instructorName)}`;
}
function completionApprovalUploadMap(rows = []) {
  const normalize = (value) => String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = `${String(row?.activity_date || '').trim()}|${normalize(row?.authority)}|${normalize(row?.school)}|${normalize(row?.instructor_name)}`;
    if (!map.has(key)) map.set(key, row);
  });
  return map;
}
function completionApprovalUploadStatusLabel(upload) {
  const status = String(upload?.status || '').trim();
  if (status === 'approved') return 'אושר';
  if (status === 'rejected') return 'נדחה';
  if (status === 'uploaded' || upload?.file_path) return 'הועלה';
  return 'טרם הועלה';
}

function completionApprovalUploadStatusChip(upload) {
  const status = String(upload?.status || '').trim();
  if (status === 'approved') return '<span class="ds-ops-status-approved">✓ אושר</span>';
  if (status === 'rejected') return '<span class="ds-ops-status-rejected">✕ נדחה</span>';
  if (status === 'uploaded' || upload?.file_path) return '<span class="ds-ops-status-uploaded">↑ הועלה</span>';
  return '<span class="ds-muted">טרם הועלה</span>';
}


const _crc32Table = (() => { const t = new Uint32Array(256); for (let i = 0; i < 256; i++) { let c = i; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[i] = c; } return t; })();
function _crc32(data) { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = _crc32Table[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function buildStoreZip(files) {
  const enc = new TextEncoder();
  const entries = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = enc.encode(name);
    const crc = _crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    entries.push({ nameBytes, crc, size: data.length, offset, lh, data });
    offset += lh.length + data.length;
  }
  const cdEntries = entries.map(({ nameBytes, crc, size, offset: off }) => {
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, off, true);
    cd.set(nameBytes, 46);
    return cd;
  });
  const cdSize = cdEntries.reduce((s, e) => s + e.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const parts = [];
  entries.forEach(({ lh, data }) => { parts.push(lh); parts.push(data); });
  cdEntries.forEach((cd) => parts.push(cd));
  parts.push(eocd);
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}
function safeZipName(str) { return String(str || '').replace(/[^ -~-￿]/g, '').replace(/[/\\:*?"<>|]/g, '-').trim() || 'file'; }
function completionApprovalZipFileName(approval, upload, index) {
  const date = String(approval?.date || '').slice(0, 10) || 'unknown';
  const instructor = safeZipName(approval?.instructorName || '');
  const school = safeZipName(approval?.school || '');
  const ext = String(upload?.file_path || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'pdf';
  const base = [date, instructor, school].filter(Boolean).join('-');
  return `${base || index}-${index + 1}.${ext}`;
}

function opsContactGroupKey(row) {
  const normalize = (value) => String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
  const date = String(row?.start_date || row?.activity_date || row?.date || '').trim().slice(0, 10);
  const schoolId = String(row?.school_id || row?.single_school_id || '').trim();
  const school = schoolId || normalize(row?.school || row?.single_school_name || row?.legacy_school || '');
  return date && school ? `${date}|${school}` : '';
}
function opsInstructorEntries(row) {
  const entries = [];
  [[row?.instructor_name || row?.instructor, row?.emp_id], [row?.instructor_name_2 || row?.instructor_2, row?.emp_id_2]].forEach(([name, empId]) => {
    const cleanName = String(name || '').trim();
    const cleanId = String(empId || '').trim();
    if (!cleanName && !cleanId) return;
    if (!entries.some((entry) => entry.empId === cleanId && entry.name === cleanName)) entries.push({ name: cleanName || cleanId, empId: cleanId });
  });
  return entries;
}
function opsContactOverrideMap(rows = []) {
  const normalize = (value) => String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = `${String(row?.activity_date || '').trim().slice(0, 10)}|${String(row?.school_id || '').trim() || normalize(row?.school)}`;
    if (key && key !== '|') map.set(key, row);
  });
  return map;
}
function buildContactContextMap(allRows, overrides) {
  const grouped = new Map();
  (Array.isArray(allRows) ? allRows : []).forEach((row) => {
    const date = String(row?.start_date || row?.activity_date || '').trim().slice(0, 10);
    const rawSchool = String(row?.school || row?.single_school_name || row?.legacy_school || '').trim();
    if (!date || !rawSchool) return;
    const key = `${date}|${normalizeOpsText(rawSchool)}`;
    if (!grouped.has(key)) grouped.set(key, { rows: [], schoolId: String(row?.school_id || row?.single_school_id || '').trim(), school: rawSchool });
    grouped.get(key).rows.push(row);
  });
  const overrideMap = opsContactOverrideMap(overrides);
  const instrKey = (entry) => entry.empId || entry.name;

  // Pass 1: collect group metadata and instructors, sorted stably by key
  const groupData = [];
  grouped.forEach(({ rows: groupRows, schoolId, school }, key) => {
    const first = groupRows.slice().sort((a, b) => String(a?.start_time || a?.StartTime || '').localeCompare(String(b?.start_time || b?.StartTime || '')))[0] || groupRows[0];
    const instructors = [];
    groupRows.forEach((row) => opsInstructorEntries(row).forEach((entry) => {
      if (!instructors.some((item) => (item.empId && item.empId === entry.empId) || (!item.empId && item.name === entry.name))) instructors.push(entry);
    }));
    const date = String(first?.start_date || first?.activity_date || '').slice(0, 10);
    const overrideKey = schoolId ? `${date}|${schoolId}` : `${date}|${normalizeOpsText(school)}`;
    const override = overrideMap.get(overrideKey) || overrideMap.get(`${date}|${normalizeOpsText(school)}`);
    groupData.push({ key, date, schoolId, school, instructors, override });
  });
  groupData.sort((a, b) => a.key.localeCompare(b.key));

  // Pass 2: init load counter for all known instructors
  const loadCounter = new Map();
  const incr = (k) => loadCounter.set(k, (loadCounter.get(k) || 0) + 1);
  groupData.forEach(({ instructors }) => instructors.forEach((e) => { if (!loadCounter.has(instrKey(e))) loadCounter.set(instrKey(e), 0); }));

  // Pass 3: count manual overrides into load, then auto-assign the rest (stable, lowest-load)
  const assignments = new Map();
  groupData.forEach(({ key, instructors, override }) => {
    if (override) {
      const responsibleEmpId = String(override.responsible_emp_id || '').trim();
      const responsibleName = String(override.responsible_name || responsibleEmpId || '').trim();
      const matched = instructors.find((e) => (e.empId && e.empId === responsibleEmpId) || e.name === responsibleName || e.name === responsibleEmpId);
      incr(matched ? instrKey(matched) : (responsibleEmpId || responsibleName));
      assignments.set(key, { responsibleEmpId, responsibleName });
      return;
    }
    if (!instructors.length) { assignments.set(key, { responsibleEmpId: '', responsibleName: '' }); return; }
    let best = instructors[0];
    for (let i = 1; i < instructors.length; i++) {
      if ((loadCounter.get(instrKey(instructors[i])) || 0) < (loadCounter.get(instrKey(best)) || 0)) best = instructors[i];
    }
    incr(instrKey(best));
    assignments.set(key, { responsibleEmpId: best.empId || '', responsibleName: best.name || best.empId || '' });
  });

  // Pass 4: build result — options show final load count per instructor
  const result = new Map();
  groupData.forEach(({ key, date, schoolId, school, instructors }) => {
    const { responsibleEmpId, responsibleName } = assignments.get(key);
    const options = instructors.map((entry) => {
      const cnt = loadCounter.get(instrKey(entry)) || 0;
      const label = cnt > 0 ? `${entry.name} (${cnt})` : entry.name;
      const isSelected = (entry.empId && entry.empId === responsibleEmpId) || entry.name === responsibleName;
      return `<option value="${escapeHtml(entry.empId || entry.name)}" data-name="${escapeHtml(entry.name)}"${isSelected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    const ctx = { instructors, responsibleEmpId, responsibleName, date, schoolId, school, options };
    result.set(key, ctx);
    if (schoolId && !result.has(`${date}|${schoolId}`)) result.set(`${date}|${schoolId}`, ctx);
  });
  return result;
}
function opsContactGroupsHtml(rows = [], overrides = [], uploadMap = new Map()) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = opsContactGroupKey(row);
    if (!key) return;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  });
  const todayIso = localTodayIso();
  const ctxMap = buildContactContextMap(rows, overrides);
  const body = Array.from(grouped.entries()).map(([key, groupRows]) => {
    const first = groupRows.slice().sort((a, b) => String(a?.start_time || a?.StartTime || '').localeCompare(String(b?.start_time || b?.StartTime || '')))[0] || groupRows[0];
    const date = String(first?.start_date || first?.activity_date || '').slice(0, 10);
    const school = String(first?.school || first?.single_school_name || first?.legacy_school || '').trim();
    const schoolId = String(first?.school_id || first?.single_school_id || '').trim();
    const ctxKey = `${date}|${normalizeOpsText(school)}`;
    const ctx = ctxMap.get(ctxKey) || ctxMap.get(`${date}|${schoolId}`);
    const instructors = ctx?.instructors || [];
    const responsibleEmpId = ctx?.responsibleEmpId || '';
    const responsibleName = ctx?.responsibleName || '';
    const options = ctx?.options || '';
    const handled = groupRows.some((row) => opsInstructorEntries(row).some((entry) => Array.from(uploadMap.values()).some((upload) => String(upload?.activity_date || '').trim().slice(0, 10) === date && normalizeOpsText(upload?.school) === normalizeOpsText(school) && normalizeOpsText(upload?.instructor_name) === normalizeOpsText(entry.name) && completionApprovalIsHandled(upload))));
    const highlightToday = date === todayIso && !handled;
    const rowClass = highlightToday ? ' class="ds-ops-work-today-row"' : '';
    const todayChip = highlightToday ? ' <span class="ds-chip ds-chip--info ds-ops-today-chip">TODAY</span>' : '';
    return { date, school, html: `<tr${rowClass}><td class="ds-table-cell-truncate">${escapeHtml(formatDateHe(date) || date)}${todayChip}</td><td class="ds-table-cell-wrap">${escapeHtml(school)}</td><td class="ds-table-cell-wrap">${escapeHtml(instructors.map((i) => i.name).join(', '))}</td><td><select class="ds-input ds-input--sm ds-ops-contact-responsible-select" data-contact-responsible-select data-date="${escapeHtml(date)}" data-school-id="${escapeHtml(schoolId)}" data-school="${escapeHtml(school)}"><option value="">בחרו אחראי קשר</option>${options}</select></td></tr>`, bucket: completionApprovalSortBucket(date, handled, todayIso) };
  }).sort((a, b) => (a.bucket - b.bucket) || a.date.localeCompare(b.date) || a.school.localeCompare(b.school, 'he', { numeric: true })).map((item) => item.html).join('');
  if (!body) return '';
  return `<div class="ds-ops-contact-responsible-card">${dsCard({ title: 'אחראי קשר מול בית הספר', body: dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-contact-responsible-table"><colgroup><col class="ds-ops-contact-col--date"><col class="ds-ops-contact-col--school"><col class="ds-ops-contact-col--team"><col class="ds-ops-contact-col--responsible"></colgroup><thead><tr><th>תאריך</th><th>בית ספר / מסגרת</th><th>מי איתי היום</th><th>אחראי קשר</th></tr></thead><tbody>${body}</tbody></table>`), padded: false })}</div>`;
}


function normalizeCompletionApprovalType(value) {
  return String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/[\s_-]+/g, ' ').toLowerCase();
}

function isCompletionApprovalIncludedActivityType(row) {
  const values = [row?.activity_type, row?.item_type, row?.type, row?.activityType, row?.activity_name, row?.activityName];
  return values.some((value) => {
    const normalized = normalizeCompletionApprovalType(value);
    return normalized === 'workshop'
      || normalized === 'escape room'
      || normalized === 'סדנה'
      || normalized === 'סדנאות'
      || normalized === 'חדר בריחה'
      || normalized === 'חדרי בריחה';
  });
}

function clampCompletionApprovalDate(value) {
  const date = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  if (date < COMPLETION_APPROVAL_SUMMER_FROM || date > COMPLETION_APPROVAL_SUMMER_TO) return '';
  return date;
}

function completionApprovalCountUploaded(items = []) {
  return items.filter((item) => item.upload?.status === 'uploaded' || item.upload?.status === 'approved' || item.upload?.file_path).length;
}

function hasActivitySeasonColumn(rows = []) {
  return (Array.isArray(rows) ? rows : []).some((row) => (
    row && Object.prototype.hasOwnProperty.call(row, 'activity_season')
  ) || (
    row && Object.prototype.hasOwnProperty.call(row, 'activitySeason')
  ));
}

function isCompletionApprovalSummerActivity(row) {
  const season = normalizeActivitySeason(row?.activity_season ?? row?.activitySeason);
  if (isActivityDeleted(row)) return false;
  if (season !== ACTIVITY_SEASON_SUMMER_2026) return false;
  if (!isCompletionApprovalIncludedActivityType(row)) return false;
  return activityDatesInRange(row, COMPLETION_APPROVAL_SUMMER_FROM, COMPLETION_APPROVAL_SUMMER_TO).length > 0;
}

function completionApprovalSummerRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter((row) => isCompletionApprovalSummerActivity(row));
}

function completionApprovalTabHtml(rows, state, data = {}, directory = buildSchoolsDirectory([]), contactsIndex = new Map(), summerPrintContactsIndex = new Map()) {
  const approvalState = ensureOpsState(state).completionApproval || {};
  const userRole = String(state?.user?.role || '').trim();
  const isManager = COMPLETION_APPROVAL_MANAGER_ROLES.has(userRole);
  const summerRows = completionApprovalSummerRows(rows);
  const selectedDate = clampCompletionApprovalDate(approvalState.selectedDate || approvalState.date);
  const instructors = completionApprovalInstructorOptions(summerRows);
  const scopedInstructors = approvalState.instructor ? instructors.filter((name) => name === approvalState.instructor) : instructors;
  const approvals = scopedInstructors.flatMap((instructor) => buildCompletionApprovals(summerRows, { instructor, dateMode: 'range', dateFrom: COMPLETION_APPROVAL_SUMMER_FROM, dateTo: COMPLETION_APPROVAL_SUMMER_TO, directory, contactsIndex, summerPrintContactsIndex }));
  const uploadMap = completionApprovalUploadMap(data?.completionApprovalUploads || []);
  const todayIso = localTodayIso();
  const allItems = approvals.map((approval, originalIndex) => ({ approval, upload: uploadMap.get(completionApprovalUploadKey(approval)), originalIndex })).sort((a, b) => compareCompletionApprovalWorkItems(a, b, todayIso));
  const selectedPrintInstructor = String(approvalState.printInstructor || '').trim();
  const selectedAuthority = String(approvalState.selectedAuthority || '').trim();
  const dateFilteredItems = selectedDate ? allItems.filter((item) => String(item.approval?.date || '').slice(0, 10) === selectedDate) : allItems;
  const authorityFilteredItems = selectedAuthority ? dateFilteredItems.filter((item) => (item.approval?.authority || '') === selectedAuthority) : dateFilteredItems;
  const items = selectedPrintInstructor ? authorityFilteredItems.filter((item) => item.approval?.instructorName === selectedPrintInstructor) : authorityFilteredItems;
  const effectiveTodayIso = todayIso < COMPLETION_APPROVAL_SUMMER_FROM ? '' : (todayIso > COMPLETION_APPROVAL_SUMMER_TO ? COMPLETION_APPROVAL_SUMMER_TO : todayIso);
  const throughTodayItems = effectiveTodayIso ? allItems.filter((item) => String(item.approval?.date || '').slice(0, 10) <= effectiveTodayIso) : [];
  const selectedDateItems = selectedDate ? dateFilteredItems : [];
  const summaryPopoverHtml = approvalState.summaryOpen ? `<div class="ds-ops-completion-summary-popover" role="dialog" aria-label="סיכום אישורי ביצוע" data-ops-completion-summary-popover><p><strong>עד היום:</strong> הועלו ${completionApprovalCountUploaded(throughTodayItems)} מתוך ${throughTodayItems.length} אישורים נדרשים</p><p><strong>לכל תקופת הקיץ:</strong> הועלו ${completionApprovalCountUploaded(allItems)} מתוך ${allItems.length} אישורים</p></div>` : '';
  const selectedDateHtml = selectedDate ? `<div class="ds-ops-completion-selected-date" dir="rtl"><strong>מסונן לתאריך: ${escapeHtml(formatDateHe(selectedDate) || selectedDate)}</strong><br><span>בתאריך זה: הועלו ${completionApprovalCountUploaded(selectedDateItems)} מתוך ${selectedDateItems.length} אישורים נדרשים</span></div>` : '';
  const dateFilterHtml = `<label class="ds-ops-completion-date-filter"><input class="ds-input ds-input--sm" type="date" min="${COMPLETION_APPROVAL_SUMMER_FROM}" max="${COMPLETION_APPROVAL_SUMMER_TO}" value="${escapeHtml(selectedDate)}" data-ops-completion-date-filter></label><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ops-completion-date-clear>כל התאריכים</button>`;
  const authorityOptions = [...new Set(allItems.map((item) => item.approval?.authority || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  const authoritySelectHtml = `<label class="ds-ops-approval-print-filter"><select class="ds-input ds-input--sm" aria-label="סינון רשות" data-ops-completion-authority-filter><option value="">כל הרשויות</option>${authorityOptions.map((a) => `<option value="${escapeHtml(a)}"${selectedAuthority === a ? ' selected' : ''}>${escapeHtml(a)}</option>`).join('')}</select></label>`;
  const activeSubtab = approvalState.subtab === 'contacts' ? 'contacts' : 'approvals';
  const printInstructorOptions = completionApprovalPrintInstructorOptions(approvals);
  const printInstructorSelect = `<label class="ds-ops-approval-print-filter"><select class="ds-input ds-input--sm" aria-label="סינון מדריך" data-ops-approval-print-instructor><option value="">כל המדריכים</option>${printInstructorOptions.map((name) => `<option value="${escapeHtml(name)}"${approvalState.printInstructor === name ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label>`;
  const downloadBtnHtml = isManager
    ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ops-approval-download-zip${selectedAuthority ? '' : ' disabled'} title="${selectedAuthority ? `הורדת כל האישורים החתומים לרשות: ${escapeHtml(selectedAuthority)}` : 'יש לבחור רשות לפני הורדת אישורים'}" style="${selectedAuthority ? '' : 'opacity:0.45;cursor:default;'}">⬇ הורדת אישורים</button>`
    : '';
  const titleBar = `<div class="ds-ops-completion-title-bar no-print" dir="rtl">
    <header class="ds-ops-completion-summary"><button type="button" class="ds-ops-completion-summary__title" aria-haspopup="dialog" aria-expanded="${approvalState.summaryOpen ? 'true' : 'false'}" data-ops-completion-summary-toggle>אישורי ביצוע</button>${summaryPopoverHtml}</header>
    <div class="ds-ops-completion-control-row ds-ops-completion-filter-toolbar ds-ops-approval-print-toolbar">${dateFilterHtml}${authoritySelectHtml}${printInstructorSelect}<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-ops-completion-clear-filters title="ניקוי סינונים">✕ ניקוי</button><button type="button" class="ds-btn ds-btn--sm ds-btn--primary ds-ops-approval-print-btn" data-ops-approval-print-all>הדפסה</button>${downloadBtnHtml}</div>
  </div>`;
  const contactContextMap = buildContactContextMap(summerRows, data?.contactResponsiblesRows || []);
  const body = items.map(({ approval, upload }, displayIndex) => {
    const hasFile = !!upload?.file_path;
    const uploadStatus = String(upload?.status || '').trim();
    const isApproved = uploadStatus === 'approved';
    const isRejected = uploadStatus === 'rejected';
    const canReview = hasFile && !isApproved && !isRejected;
    const highlightToday = String(approval.date || '').slice(0, 10) === todayIso && !completionApprovalIsHandled(upload);
    const todayChip = highlightToday ? ' <span class="ds-chip ds-chip--info ds-ops-today-chip">TODAY</span>' : '';
    const approvalDate = String(approval.date || '').slice(0, 10);
    const approvalSchoolId = String(approval.schoolId || '').trim();
    const contactKey = approvalSchoolId
      ? (`${approvalDate}|${approvalSchoolId}`)
      : (`${approvalDate}|${normalizeOpsText(approval.school || '')}`);
    const contactCtx = contactContextMap.get(contactKey) || contactContextMap.get(`${approvalDate}|${normalizeOpsText(approval.school || '')}`);
    const whoIsWithMe = contactCtx && contactCtx.instructors.length ? escapeHtml(contactCtx.instructors.map((i) => i.name).join(', ')) : '—';
    const contactDropdown = contactCtx
      ? `<select class="ds-input ds-input--sm ds-ops-contact-responsible-select" data-contact-responsible-select data-date="${escapeHtml(contactCtx.date)}" data-school-id="${escapeHtml(contactCtx.schoolId)}" data-school="${escapeHtml(contactCtx.school)}"><option value="">בחרו</option>${contactCtx.options}</select>`
      : '<span class="ds-muted">—</span>';
    return `<tr${highlightToday ? ' class="ds-ops-work-today-row"' : ''}>
      <td class="ds-ops-completion-col--status ds-table-cell-truncate">${completionApprovalUploadStatusChip(upload)}</td>
      <td class="ds-ops-completion-col--date ds-table-cell-truncate">${escapeHtml(formatDateHe(approval.date) || approval.date || '')}${todayChip}</td>
      <td class="ds-ops-completion-col--authority ds-table-cell-truncate">${escapeHtml(approval.authority || '—')}</td>
      <td class="ds-ops-completion-col--instructor ds-table-cell-truncate">${escapeHtml(approval.instructorName || '')}</td>
      <td class="ds-ops-completion-col--school ds-table-cell-wrap">${escapeHtml(approval.school || '')}</td>
      <td class="ds-ops-completion-col--who ds-ops-completion-col-who-cell ds-table-cell-wrap">${whoIsWithMe}</td>
      <td class="ds-ops-completion-col--contact ds-ops-completion-col-contact-cell">${contactDropdown}</td>
      <td class="ds-ops-completion-col--actions ds-ops-completion-actions-cell no-print"><div class="ds-ops-completion-actions"><button type="button" class="ds-ops-icon-btn" data-ops-approval-view="${displayIndex}" title="צפייה באישור" aria-label="צפייה באישור">👁</button>${!hasFile
        ? ` <button type="button" class="ds-ops-icon-btn ds-ops-icon-btn--add" data-ops-approval-upload="${displayIndex}" title="הוספת אישור פעילות חתום" aria-label="הוספת אישור פעילות חתום">＋</button>`
        : ` <button type="button" class="ds-ops-icon-btn" data-ops-upload-view="${escapeHtml(upload.id)}" title="צפייה בקובץ חתום" aria-label="צפייה בקובץ חתום">📋</button> <button type="button" class="ds-ops-icon-btn" data-ops-upload-download="${escapeHtml(upload.id)}" title="הורדה" aria-label="הורדה">⬇</button>${canReview
          ? ` <button type="button" class="ds-ops-icon-btn ds-ops-icon-btn--approve" data-ops-upload-approve="${escapeHtml(upload.id)}" title="אישור קבלה" aria-label="אישור קבלה">✓</button> <button type="button" class="ds-ops-icon-btn ds-ops-icon-btn--reject" data-ops-upload-reject="${escapeHtml(upload.id)}" title="דחייה" aria-label="דחייה">✕</button>`
          : ''}`}</div></td>
    </tr>`;
  }).join('');
  _completionApprovalPrintContext = { approvals: items.map((item) => item.approval), uploads: data?.completionApprovalUploads || [] };
  const contactRows = (selectedDate || selectedPrintInstructor || approvalState.instructor || selectedAuthority) ? summerRows.filter((row) => items.some((item) => String(item.approval.date || '').slice(0, 10) === String(row.start_date || row.activity_date || '').slice(0, 10) && String(item.approval.school || '').trim() === String(row.school || row.single_school_name || row.legacy_school || '').trim())) : summerRows;
  const table = items.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-completion-preview"><colgroup><col class="ds-ops-completion-col--status"><col class="ds-ops-completion-col--date"><col class="ds-ops-completion-col--authority"><col class="ds-ops-completion-col--instructor"><col class="ds-ops-completion-col--school"><col class="ds-ops-completion-col--who"><col class="ds-ops-completion-col--contact"><col class="ds-ops-completion-col--actions no-print"></colgroup><thead><tr><th class="ds-ops-completion-col--status">סטטוס אישור</th><th class="ds-ops-completion-col--date">תאריך</th><th class="ds-ops-completion-col--authority">רשות</th><th class="ds-ops-completion-col--instructor">מדריך</th><th class="ds-ops-completion-col--school">בית ספר</th><th class="ds-ops-completion-col--who">מי איתי היום</th><th class="ds-ops-completion-col--contact">אחראי קשר</th><th class="ds-ops-completion-col--actions no-print">פעולות</th></tr></thead><tbody>${body}</tbody></table>`)
    : dsEmptyState('לא נמצאו אישורי ביצוע בטווח הנוכחי');
  const activePanel = `<div class="ds-ops-completion-approvals-card">${dsCard({ body: table, padded: false })}</div>`;
  return `<section class="ds-ops-mgmt-panel ds-ops-completion-panel" dir="rtl">
    <div class="ds-ops-completion-workspace">
      <div class="ds-ops-completion-control-card no-print">
        ${titleBar}
        ${selectedDateHtml}
      </div>
      ${activePanel}
    </div>
  </section>`;
}

function renderTab(rows, state, data, allPreparedRows = []) {
  const ops = ensureOpsState(state);
  const stockMap = data?.workshopStockMap instanceof Map ? data.workshopStockMap : new Map();
  const directory = buildSchoolsDirectory(data?.schoolsDirectoryRows || []);
  const contactsIndex = buildContactsSchoolsIndex(data?.contactsSchoolsRows || []);
  const summerPrintContactsIndex = buildSummerPrintContactsIndex(data?.instructorSchedulePrintContactsRows || []);
  if (ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
  if (ops.tab === TAB_AUTHORITIES || ops.tab === TAB_SCHOOLS) return schoolsTabHtml(rows, state, directory, contactsIndex);
  if (ops.tab === TAB_COMPLETION_APPROVAL) {
    const approvalRows = allPreparedRows.filter((row) => !isActivityDeleted(row));
    return completionApprovalTabHtml(approvalRows, state, data, directory, contactsIndex, summerPrintContactsIndex);
  }
  if (ops.tab === TAB_WORKSHOPS) {
    const catalogRows = extractWorkshopCatalogRows(data?.adminListsData, allPreparedRows);
    const activitiesRowsForRequiredInventory = allPreparedRows.filter((row) =>
      isOpenOrClosedActivity(row) &&
      !isTamirActivity(row) &&
      activityMatchesAnyOfficialWorkshop(row, catalogRows) &&
      activityOverlapsDateRange(row, WORKSHOPS_SUMMER_FROM, WORKSHOPS_SUMMER_TO)
    );
    const workshopStockDistributions = data?.workshopStockDistributions || [];
    return workshopsTabHtml(activitiesRowsForRequiredInventory, state, stockMap, catalogRows, workshopStockDistributions);
  }
  return instructorsTabHtml(rows, state, data, directory, contactsIndex, allPreparedRows);
}

export const operationsManagementScreen = {
  load: async ({ api }) => {
    const [activities, lists, schoolsDirectory, contactsSchoolsRows, completionApprovalUploads, contactResponsibles, workshopStockDistributions, instructorSchedulePrintContacts] = await Promise.all([
      api.allActivities(),
      api.adminLists().catch(() => ({ categories: [] })),
      readOperationsSchoolsDirectory(),
      readContactsSchools(),
      api.completionApprovalUploads().catch(() => ({ rows: [] })),
      api.schoolContactResponsibles().catch(() => ({ rows: [] })),
      api.workshopStockDistributions ? api.workshopStockDistributions().catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] }),
      api.instructorSchedulePrintContacts ? api.instructorSchedulePrintContacts().catch(() => ({ rows: [] })) : Promise.resolve({ rows: [] })
    ]);
    return {
      ...activities,
      schoolsDirectoryRows: schoolsDirectory.rows,
      schoolsDirectorySource: schoolsDirectory.source,
      workshopStockMap: buildWorkshopStockMapFromLists(lists),
      adminListsData: lists,
      contactsSchoolsRows,
      completionApprovalUploads: completionApprovalUploads?.rows || [],
      contactResponsiblesRows: contactResponsibles?.rows || [],
      workshopStockDistributions: workshopStockDistributions?.rows || [],
      instructorSchedulePrintContactsRows: instructorSchedulePrintContacts?.rows || []
    };
  },
  render(data, { state } = {}) {
    state = state || {};
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const prepared = prepareRows(allRows);
    const ops = ensureOpsState(state);
    const isCompletionApprovalTab = ops.tab === TAB_COMPLETION_APPROVAL;
    const baseRows = applyBaseFilters(prepared, state);
    const filteredRows = isCompletionApprovalTab ? baseRows : applyAllFilters(baseRows, state);
    const filterRows = ops.tab === TAB_WORKSHOPS
      ? baseRows.filter((row) => activityMatchesAnyOfficialWorkshop(row, extractWorkshopCatalogRows(data?.adminListsData, prepared)))
      : baseRows;
    const activeRows = isCompletionApprovalTab ? baseRows : filteredRows;
    return `<div class="ds-screen-stack ds-ops-mgmt-screen">${opsManagementStylesHtml()}${dsPageHeader(isCompletionApprovalTab ? 'בקרת אישורי ביצוע לקיץ 2026' : 'ניהול תפעול')}
      ${isCompletionApprovalTab ? '' : topFiltersHtml(filterRows, state)}
      ${tabsHtml(ops.tab)}
      <div class="ds-ops-mgmt-content">${renderTab(activeRows, state, data, prepared)}</div>
      ${isCompletionApprovalTab ? '' : `<p class="ds-muted ds-ops-mgmt-count no-print" dir="rtl">מציג ${filteredRows.length} פעילויות מתוך ${allRows.length}</p>`}
    </div>`;
  },
  bind({ root, api, state, rerender, clearScreenDataCache }) {
    if (!root) return;
    state = state || {};
    const ops = ensureOpsState(state);
    const filters = ensureActivityListFilters(state, SCOPE);

    if (_opsNeedsEntryReset) {
      _opsNeedsEntryReset = false;
      resetOperationsManagementEntry(state);
    }

    root.querySelectorAll('[data-ops-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ops.tab = btn.getAttribute('data-ops-tab') || TAB_INSTRUCTORS;
        if (ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
        try { sessionStorage.removeItem(SUMMER_TRAINING_SESSION_KEY); } catch { /* ignore */ }
        document.dispatchEvent(new CustomEvent('ops-mgmt-standard-tab', { detail: { tab: ops.tab } }));
        rerender?.();
      });
    });

    root.querySelectorAll('[data-ops-completion-subtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ops.completionApproval.subtab = btn.getAttribute('data-ops-completion-subtab') || 'approvals';
        rerender?.();
      });
    });

    root.querySelector('[data-ops-completion-date-filter]')?.addEventListener('change', (ev) => {
      ops.completionApproval.selectedDate = clampCompletionApprovalDate(ev.target.value || '');
      rerender?.();
    });
    root.querySelector('[data-ops-completion-date-clear]')?.addEventListener('click', () => {
      ops.completionApproval.selectedDate = '';
      rerender?.();
    });
    root.querySelector('[data-ops-completion-clear-filters]')?.addEventListener('click', () => {
      ops.completionApproval.selectedDate = '';
      ops.completionApproval.date = '';
      ops.completionApproval.selectedAuthority = '';
      ops.completionApproval.printInstructor = '';
      rerender?.();
    });

    root.querySelector('[data-ops-completion-summary-toggle]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      ops.completionApproval.summaryOpen = !ops.completionApproval.summaryOpen;
      rerender?.();
    });
    root.querySelector('[data-ops-completion-summary-popover]')?.addEventListener('click', (event) => event.stopPropagation());
    if (ops.completionApproval.summaryOpen) {
      const closeSummary = (event) => {
        if (event?.target?.closest?.('[data-ops-completion-summary-toggle],[data-ops-completion-summary-popover]')) return;
        ops.completionApproval.summaryOpen = false;
        document.removeEventListener('click', closeSummary, true);
        document.removeEventListener('keydown', closeOnEscape, true);
        rerender?.();
      };
      const closeOnEscape = (event) => {
        if (event.key !== 'Escape') return;
        ops.completionApproval.summaryOpen = false;
        document.removeEventListener('click', closeSummary, true);
        document.removeEventListener('keydown', closeOnEscape, true);
        rerender?.();
      };
      setTimeout(() => {
        document.addEventListener('click', closeSummary, true);
        document.addEventListener('keydown', closeOnEscape, true);
      }, 0);
    }

    root.querySelector('[data-ops-period]')?.addEventListener('change', (ev) => {
      ops.period = ev.target.value || 'all';
      const range = defaultDateRange(ops.period);
      ops.dateFrom = range.from;
      ops.dateTo = range.to;
      rerender?.();
    });

    root.querySelector('[data-ops-date="from"]')?.addEventListener('change', (ev) => { ops.dateFrom = ev.target.value || ''; rerender?.(); });
    root.querySelector('[data-ops-date="to"]')?.addEventListener('change', (ev) => { ops.dateTo = ev.target.value || ''; rerender?.(); });

    let searchTimer;
    root.querySelector('[data-ops-search]')?.addEventListener('input', (ev) => {
      filters.q = ev.target.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { filters.appliedQ = filters.q; rerender?.(); }, 180);
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
      Object.keys(filters).forEach((key) => { if (key !== 'visibleCount') filters[key] = ''; });
      filters.status = 'פתוח';
      filters.q = '';
      filters.appliedQ = '';
      rerender?.();
    });

    root.querySelectorAll('[data-ops-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-ops-sort') || '';
        const tab = th.getAttribute('data-ops-sort-tab') || ops.tab || TAB_INSTRUCTORS;
        if (!key) return;
        const current = ops.sorts?.[tab] || SORT_DEFAULTS[tab] || { key: '', dir: 'asc' };
        ops.sorts = ops.sorts || {};
        ops.sorts[tab] = { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
        rerender?.();
      });
    });

    root.querySelector('[data-ops-print]')?.addEventListener('click', () => printInstructorSchedule());
    root.querySelector('[data-ops-print-workshops]')?.addEventListener('click', () => printWorkshopsFromDom(root));
    root.querySelector('[data-ops-print-schools]')?.addEventListener('click', () => printSchoolsSchedule());

    const workshopsWrap = root.querySelector('.ds-ops-workshops-table-wrap');
    if (workshopsWrap) {
      const handleWorkshopToggle = (toggleRow) => {
        const key = toggleRow.getAttribute('data-ops-workshop-toggle') || '';
        const tbody = toggleRow.closest('tbody');
        if (!tbody) return;
        const isExpanded = toggleRow.getAttribute('aria-expanded') === 'true';
        const newExpanded = !isExpanded;
        // Close other expanded rows
        if (newExpanded) {
          Array.from(tbody.querySelectorAll('[data-ops-workshop-toggle][aria-expanded="true"]')).forEach((r) => {
            if (r === toggleRow) return;
            r.classList.remove('ds-ops-row--expanded');
            r.setAttribute('aria-expanded', 'false');
            const prevKey = r.getAttribute('data-ops-workshop-toggle') || '';
            Array.from(tbody.querySelectorAll('[data-workshop-detail]')).forEach((d) => {
              if (d.getAttribute('data-workshop-detail') === prevKey) d.hidden = true;
            });
          });
        }
        toggleRow.classList.toggle('ds-ops-row--expanded', newExpanded);
        toggleRow.setAttribute('aria-expanded', String(newExpanded));
        ops.expandedWorkshop = newExpanded ? key : '';
        Array.from(tbody.querySelectorAll('[data-workshop-detail]')).forEach((d) => {
          if (d.getAttribute('data-workshop-detail') === key) d.hidden = !newExpanded;
        });
      };
      workshopsWrap.addEventListener('click', (event) => {
        const toggleRow = event.target.closest('[data-ops-workshop-toggle]');
        if (toggleRow) handleWorkshopToggle(toggleRow);
      });
      workshopsWrap.addEventListener('keydown', (event) => {
        const toggleRow = event.target.closest('[data-ops-workshop-toggle]');
        if (!toggleRow) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleWorkshopToggle(toggleRow);
      });
    }

    root.querySelector('[data-ops-approval-instructor]')?.addEventListener('change', (ev) => {
      ops.completionApproval.instructor = ev.target.value || '';
      ops.completionApproval.preview = false;
      rerender?.();
    });
    root.querySelector('[data-ops-approval-date-mode]')?.addEventListener('change', (ev) => {
      ops.completionApproval.dateMode = ev.target.value || 'all';
      ops.completionApproval.preview = false;
      rerender?.();
    });
    root.querySelector('[data-ops-approval-date]')?.addEventListener('change', (ev) => { ops.completionApproval.date = ev.target.value || ''; ops.completionApproval.preview = false; rerender?.(); });
    root.querySelector('[data-ops-approval-date-from]')?.addEventListener('change', (ev) => { ops.completionApproval.dateFrom = ev.target.value || ''; ops.completionApproval.preview = false; rerender?.(); });
    root.querySelector('[data-ops-approval-date-to]')?.addEventListener('change', (ev) => { ops.completionApproval.dateTo = ev.target.value || ''; ops.completionApproval.preview = false; rerender?.(); });
    root.querySelector('[data-ops-approval-show]')?.addEventListener('click', () => {
      if (!ops.completionApproval.instructor) { alert('יש לבחור מדריך/ה.'); return; }
      ops.completionApproval.preview = true;
      rerender?.();
    });
    root.querySelector('[data-ops-approval-print-instructor]')?.addEventListener('change', (ev) => {
      ops.completionApproval.printInstructor = ev.target.value || '';
      rerender?.();
    });
    root.querySelector('[data-ops-completion-authority-filter]')?.addEventListener('change', (ev) => {
      ops.completionApproval.selectedAuthority = ev.target.value || '';
      rerender?.();
    });
    root.querySelector('[data-ops-approval-download-zip]')?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget;
      if (btn.disabled) return;
      const approvals = _completionApprovalPrintContext?.approvals || [];
      const uploads = _completionApprovalPrintContext?.uploads || [];
      const uploadById = new Map(uploads.map((u) => [String(u.id), u]));
      const authorityName = ops.completionApproval.selectedAuthority || '';
      if (!authorityName) { alert('יש לבחור רשות לפני הורדת אישורים'); return; }
      const itemsWithFile = approvals.map((approval, i) => {
        const key = completionApprovalUploadKey(approval);
        const uploadMap2 = completionApprovalUploadMap(uploads);
        const upload = uploadMap2.get(key);
        return upload?.file_path ? { approval, upload, index: i } : null;
      }).filter(Boolean);
      if (!itemsWithFile.length) { alert('לא נמצאו אישורים חתומים להורדה עבור הבחירה הנוכחית'); return; }
      btn.disabled = true;
      const origText = btn.textContent;
      btn.textContent = '…';
      try {
        const fileEntries = [];
        for (const { approval, upload, index } of itemsWithFile) {
          try {
            const result = await api.completionApprovalSignedUrl({ filePath: upload.file_path, download: true });
            if (!result?.signedUrl) continue;
            const resp = await fetch(result.signedUrl);
            if (!resp.ok) continue;
            const buf = await resp.arrayBuffer();
            const name = completionApprovalZipFileName(approval, upload, index);
            fileEntries.push({ name, data: new Uint8Array(buf) });
          } catch { /* skip failed file */ }
        }
        if (!fileEntries.length) { alert('לא הצליח להוריד אף קובץ'); return; }
        const todayStr = localTodayIso();
        const zipName = `אישורי-ביצוע-${authorityName}-${todayStr}.zip`;
        const zipData = buildStoreZip(fileEntries);
        const blob = new Blob([zipData], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = zipName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } catch (error) {
        alert(`הורדת האישורים נכשלה: ${error?.message || error}`);
      } finally {
        btn.disabled = false;
        btn.textContent = origText;
      }
    });
    root.querySelectorAll('[data-ops-approval-print-all]').forEach((btn) => btn.addEventListener('click', () => {
      const selectedInstructor = ops.completionApproval.printInstructor || root.querySelector('[data-ops-approval-print-instructor]')?.value || '';
      const approvals = _completionApprovalPrintContext?.approvals || [];
      printCompletionApprovals(approvals, approvalsBatchTitle(approvals, selectedInstructor || 'כל המדריכים'));
    }));
    root.querySelectorAll('[data-ops-approval-upload]').forEach((btn) => btn.addEventListener('click', () => {
      const index = Number(btn.getAttribute('data-ops-approval-upload'));
      const approval = (_completionApprovalPrintContext?.approvals || [])[index];
      if (!approval) return;
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.jpg,.jpeg,.png';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) return;
        btn.disabled = true;
        const origText = btn.textContent;
        btn.textContent = '…';
        try {
          await api.uploadCompletionApproval({
            approval,
            file,
            instructorName: approval.instructorName,
            instructorEmpId: approval.instructorEmpId
          });
          showOpsToast('הקובץ הועלה בהצלחה ✓');
          clearScreenDataCache?.('operations-management');
          rerender?.();
        } catch (error) {
          alert(`העלאת האישור נכשלה: ${error?.message || error}`);
          btn.disabled = false;
          btn.textContent = origText;
        }
      });
      input.click();
    }));
    root.querySelectorAll('[data-ops-approval-print-one],[data-ops-approval-view]').forEach((btn) => btn.addEventListener('click', () => {
      const index = Number(btn.getAttribute('data-ops-approval-print-one') ?? btn.getAttribute('data-ops-approval-view'));
      const approval = (_completionApprovalPrintContext?.approvals || [])[index];
      if (!approval) return;
      printCompletionApprovals([approval], approvalFileTitle(approval));
    }));



    root.querySelectorAll('[data-contact-responsible-select]').forEach((select) => {
      select.addEventListener('change', async () => {
        const selected = select.selectedOptions?.[0];
        try {
          await api.saveSchoolContactResponsible({
            activityDate: select.getAttribute('data-date') || '',
            schoolId: select.getAttribute('data-school-id') || '',
            school: select.getAttribute('data-school') || '',
            responsibleEmpId: select.value || '',
            responsibleName: selected?.getAttribute('data-name') || selected?.textContent || ''
          });
          clearScreenDataCache?.('operations-management');
          rerender?.();
        } catch (error) {
          alert(`שמירת אחראי הקשר נכשלה: ${error?.message || error}`);
        }
      });
    });

    const uploadById = new Map((Array.isArray(_completionApprovalPrintContext?.uploads) ? _completionApprovalPrintContext.uploads : []).map((upload) => [String(upload.id), upload]));
    const openSignedUpload = async (id, download = false) => {
      const upload = uploadById.get(String(id));
      if (!upload?.file_path) return;
      try {
        const result = await api.completionApprovalSignedUrl({ filePath: upload.file_path, download });
        if (result?.signedUrl) window.open(result.signedUrl, '_blank', 'noopener,noreferrer');
      } catch (error) {
        alert(`פתיחת הקובץ נכשלה: ${error?.message || error}`);
      }
    };
    root.querySelectorAll('[data-ops-upload-view]').forEach((btn) => btn.addEventListener('click', () => openSignedUpload(btn.getAttribute('data-ops-upload-view'), false)));
    root.querySelectorAll('[data-ops-upload-download]').forEach((btn) => btn.addEventListener('click', () => openSignedUpload(btn.getAttribute('data-ops-upload-download'), true)));
    root.querySelectorAll('[data-ops-upload-approve]').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await api.reviewCompletionApprovalUpload({ id: btn.getAttribute('data-ops-upload-approve'), status: 'approved' });
        showOpsToast('האישור סומן כמאושר ✓');
        clearScreenDataCache?.('operations-management');
        rerender?.();
      } catch (error) { alert(`עדכון האישור נכשל: ${error?.message || error}`); }
    }));
    root.querySelectorAll('[data-ops-upload-reject]').forEach((btn) => btn.addEventListener('click', async () => {
      const reviewNote = prompt('הערת דחייה', '') || '';
      try {
        await api.reviewCompletionApprovalUpload({ id: btn.getAttribute('data-ops-upload-reject'), status: 'rejected', reviewNote });
        showOpsToast('האישור נדחה');
        clearScreenDataCache?.('operations-management');
        rerender?.();
      } catch (error) { alert(`דחיית האישור נכשלה: ${error?.message || error}`); }
    }));

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
  getActivityInstructorNames,
  getActivityPrimaryDate,
  getActivitySchoolNames,
  parseLinkedSchoolsJson
};
