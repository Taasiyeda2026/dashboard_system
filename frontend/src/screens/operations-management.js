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
  ACTIVITY_SEASON_SCHOOL_2027
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
  WORKSHOP_ESTIMATE_PER_ACTIVITY
} from './shared/operations-activity-helpers.js';

const SCOPE = 'operations-management';
const TAB_INSTRUCTORS = 'instructors';
const TAB_SUMMER = 'summer';
const TAB_WORKSHOPS = 'workshops';
const TAB_AUTHORITIES = 'authorities';
const TAB_SCHOOLS = 'schools';
const SUMMER_TRAINING_SESSION_KEY = 'opsSummerTrainingActive';

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
    const names = [row?.instructor_name, row?.instructor, row?.guide_name, row?.guide]
      .map((value) => String(value || '').trim())
      .filter(isValidInstructorName);
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
  // 1. מהפעילות עצמה
  add(getActivityContactName(activity), getActivityContactPhone(activity));
  // 2. מספריית בתי הספר (מנהל + טלפון)
  findSchoolsForActivity(activity, directory).forEach((row) => add(row.principal_name, row.school_phone));
  // 3. מ-contacts_schools — לפי רשות + בית ספר
  if (contactsIndex instanceof Map) {
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
    [row?.instructor_name, row?.instructor, row?.guide_name, row?.guide].forEach((value) => {
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
    const instructor = getActivityInstructorName(activity);
    if (selectedInstructor !== '__all__' && instructor !== selectedInstructor) return;
    const dates = activityDatesInRange(activity, ops.dateFrom, ops.dateTo);
    const targetDates = dates.length ? dates : (getActivityPrimaryDate(activity) ? [getActivityPrimaryDate(activity)] : ['']);
    targetDates.forEach((date) => {
      schedule.push({
        date,
        activity,
        instructor,
        time: getActivityTimeRange(activity),
        hasTime: Boolean(getActivityTimeRange(activity))
      });
    });
  });
  return sortScheduleRows(schedule, state, directory);
}

function compactSummaryLineHtml(items = []) {
  const text = items.filter((item) => item?.value !== undefined && item?.value !== null).map((item) => `${item.value} ${item.label}`).join(' · ');
  return text ? `<div class="ds-ops-mgmt-summary-line" dir="rtl">${escapeHtml(text)}</div>` : '';
}

function tabOverviewSummary(rows, scheduleRows = []) {
  const workDays = uniqueSorted(scheduleRows.map((row) => row.date).filter(Boolean)).length;
  const schools = uniqueSorted(rows.map(getActivitySchoolDisplayNameClean).filter((name) => name !== 'לא משויך'));
  const authorities = uniqueSorted(rows.map(getActivityAuthorityName));
  return compactSummaryLineHtml([
    { label: 'פעילויות', value: rows.length },
    { label: 'ימי עבודה', value: workDays },
    { label: 'בתי ספר', value: schools.length },
    { label: 'רשויות', value: authorities.length }
  ]);
}

function instructorSummary(rows, state, scheduleRows) {
  const selected = String(ensureOpsState(state).instructor || '__all__').trim();
  if (selected === '__all__') return '';
  const workDays = uniqueSorted(scheduleRows.map((row) => row.date).filter(Boolean)).length;
  const authorities = uniqueSorted(rows.map(getActivityAuthorityName));
  const schools = uniqueSorted(rows.map(getActivitySchoolDisplayNameClean).filter((name) => name !== 'לא משויך'));
  return compactSummaryLineHtml([
    { label: `מדריך: ${selected}`, value: '' },
    { label: 'ימי עבודה', value: workDays },
    { label: 'פעילויות', value: rows.length },
    { label: 'בתי ספר', value: schools.length },
    { label: 'רשויות', value: authorities.length }
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
  if (rawGroup) return rawGroup;
  const activityNo = String(row?.activity_no || '').trim();
  return activityNo ? `activity_${activityNo}` : normalizeWorkshopKey(row?.activity_name);
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
    const key = `${String(stockGroupKey || '').trim()}|${String(no || '').trim()}|${normalizeWorkshopKey(cleanName)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      workshopNo: String(no || '').trim(),
      workshopName: cleanName,
      stockQuantity: stock,
      stockGroupKey: String(stockGroupKey || '').trim(),
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

function activityMatchesOfficialWorkshop(activity = {}, workshop = {}) {
  const activityNo = String(activity?.activity_no || activity?.workshop_no || '').trim();
  if (activityNo && workshop.workshopNo && activityNo === workshop.workshopNo) return true;
  return normalizeWorkshopKey(getActivityName(activity)) === normalizeWorkshopKey(workshop.workshopName);
}

function activityMatchesAnyOfficialWorkshop(activity = {}, catalogRows = []) {
  return catalogRows.some((workshop) => activityMatchesOfficialWorkshop(activity, workshop));
}

function workshopMetricsRows(rows, stockMap, catalogRows = []) {
  const groups = new Map();
  catalogRows.forEach((catalog) => {
    const key = catalog.stockGroupKey || `activity_${catalog.workshopNo || normalizeWorkshopKey(catalog.workshopName)}`;
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

  rows.forEach((row) => {
    groups.forEach((group) => {
      if (!group.linkedWorkshops.some((workshop) => activityMatchesOfficialWorkshop(row, workshop))) return;
      group.activities.push(row);
    });
  });

  return Array.from(groups.values()).map((group) => {
    const activityCount = group.activities.length;
    const estimatedQuantity = activityCount * WORKSHOP_ESTIMATE_PER_ACTIVITY;
    let actualQuantity = 0;
    group.activities.forEach((activity) => {
      const count = getActivityActualParticipantCount(activity);
      actualQuantity += count !== null ? count : 0;
    });
    const stock = group.stockQuantity !== null && group.stockQuantity !== undefined && Number.isFinite(Number(group.stockQuantity))
      ? Number(group.stockQuantity)
      : null;
    return {
      stockGroupKey: group.stockGroupKey,
      workshopNo: group.linkedWorkshops.map((workshop) => workshop.workshopNo).filter(Boolean).join(', '),
      workshopNoDisplay: group.linkedWorkshops.map((workshop) => workshop.workshopNo).filter(Boolean).join(', '),
      workshopName: group.workshopName,
      linkedWorkshops: group.linkedWorkshops,
      activities: group.activities,
      activityCount,
      estimatedQuantity,
      actualQuantity,
      stockQuantity: stock,
      gap: stock === null ? null : stock - estimatedQuantity
    };
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
    .ds-ops-mgmt-screen .ds-ops-col--time,
    .ds-ops-mgmt-screen .ds-ops-col--time th { text-align: center; }
    .ds-ops-mgmt-screen .ds-ops-sortable-th { cursor:pointer; user-select:none; white-space:nowrap; background:#e6f6fb; color:#0f172a; font-weight:700; border:0; }
    .ds-ops-mgmt-screen .ds-ops-sortable-th.ds-ops-col--time { text-align: center; }
    .ds-ops-mgmt-screen .ds-ops-col--school,
    .ds-ops-mgmt-screen .ds-ops-col--activity { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-col--grade { width:70px; max-width:70px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:center; }
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
    .ds-ops-mgmt-screen .ds-ops-workshops-table-wrap { width:100%; }
    .ds-ops-mgmt-screen .ds-ops-workshops-card { width:min(790px, 85%); margin-inline-start:auto; margin-inline-end:auto; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table { table-layout:fixed; width:100%; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th,.ds-ops-mgmt-screen .ds-ops-workshops-table td { border:1px solid #94a3b8 !important; padding:4px 6px; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table tbody tr:hover td,
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
    .ds-ops-mgmt-screen .ds-ops-workshops-table th { background:#dbeafe; color:#1e3a8a; font-weight:800; font-size:12px; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th:nth-child(1),
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:nth-child(1) { width:76px; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th:nth-child(2),
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:nth-child(2) { text-align:right; white-space:normal; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table th:nth-child(n+3),
    .ds-ops-mgmt-screen .ds-ops-workshops-table td:nth-child(n+3) { width:80px; text-align:center; }
    .ds-ops-mgmt-screen .ds-ops-row--expanded td { background:color-mix(in srgb,#dbeafe 25%,#fff)!important; }
    .ds-ops-mgmt-screen .ds-ops-dist-input { width:72px; text-align:center; font-size:12px; padding:2px 4px; border:1px solid #94a3b8; border-radius:4px; background:#fff; }
    .ds-ops-mgmt-screen .ds-ops-dist-table th:nth-child(n+2),.ds-ops-mgmt-screen .ds-ops-dist-table td:nth-child(n+2) { text-align:center; width:90px; }
    .ds-ops-mgmt-screen .ds-ops-dist-table th:last-child,.ds-ops-mgmt-screen .ds-ops-dist-table td:last-child { width:60px; }
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
    @media print { .ds-ops-mgmt-screen .ds-ops-schools-authority:not(:first-child) { break-before:page; page-break-before:always; } .ds-ops-mgmt-screen .ds-ops-authority-date .ds-table-wrap { width:55%!important; max-width:55%!important; } .ds-ops-mgmt-screen .ds-ops-authority-date__title { width:55%!important; max-width:55%!important; } }
  </style>`;
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

function buildGroupedScheduleHtml({ scheduleRows, state, selectedInstructorFilter, directory, contactsIndex }) {
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

  const blocks = groups.map((group) => {
    const dateLabel = group.date
      ? `${formatDateHeWithWeekday(group.date).split(' · ')[0]} · ${formatDateHe(group.date)}`
      : '—';
    const metaParts = [
      group.authority ? `רשות: ${group.authority}` : '',
      group.school ? `בית ספר: ${group.school}` : ''
    ].filter(Boolean);
    const instructorHeader = showInstructor ? '<th>מדריך</th>' : '';
    const activityRows = group.entries.map((entry) => {
      const a = entry.activity;
      const instrCell = showInstructor ? `<td>${escapeHtml(entry.instructor || '—')}</td>` : '';
      return `<tr><td>${escapeHtml(entry.time || '—')}</td><td>${escapeHtml(getActivityName(a))}</td><td>${escapeHtml(getActivityGradeLabel(a) || '—')}</td>${instrCell}</tr>`;
    }).join('');
    const tableClass = showInstructor ? 'pb-act has-instructor' : 'pb-act';
    return `<div class="pb">
      <div class="pb-hdr">
        <span class="pb-date">${escapeHtml(dateLabel)}</span>
        <span class="pb-meta">${metaParts.map(escapeHtml).join(' | ')}</span>
      </div>
      <table class="${tableClass}"><thead><tr><th>שעות</th><th>פעילות</th><th>כיתה</th>${instructorHeader}</tr></thead>
      <tbody>${activityRows}</tbody></table>
    </div>`;
  }).join('');

  return `<div class="ops-print-page"><h1>שיבוץ פעילויות קיץ</h1><p class="subtitle">${escapeHtml(instructorLine)} | טווח תאריכים: ${escapeHtml(dateRange)}</p><div class="ops-print-grid">${blocks}</div><p class="footer">יש לוודא את קיום הפעילות מול איש הקשר בבית הספר לפחות 48 שעות לפני כל יום פעילות.</p></div>`;
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
    .pb-hdr{margin-bottom:3px;break-after:avoid;page-break-after:avoid}
    .pb-date{font-weight:700;font-size:11px;color:#0369a1;margin-left:4px}
    .pb-meta{font-size:11px;font-weight:700;color:#1e293b;display:block;line-height:1.3;margin-top:1px;text-align:center}
    table{border-collapse:collapse;margin:0}
    .pb-act{width:100%;border-collapse:collapse;table-layout:fixed;break-before:avoid;page-break-before:avoid;break-inside:auto;page-break-inside:auto}
    .pb-act th,.pb-act td{border:1px solid #cbd5e1;padding:2px 4px;text-align:right;font-size:10px;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .pb-act th{background:#e6f6fb;font-weight:700}
    .pb-act tr:nth-child(even) td{background:#f8fafc}
    .pb-act th:nth-child(1),.pb-act td:nth-child(1){width:28%;text-align:center}
    .pb-act th:nth-child(2),.pb-act td:nth-child(2){width:52%}
    .pb-act th:nth-child(3),.pb-act td:nth-child(3){width:20%;text-align:center}
    .pb-act.has-instructor th:nth-child(1),.pb-act.has-instructor td:nth-child(1){width:24%;text-align:center}
    .pb-act.has-instructor th:nth-child(2),.pb-act.has-instructor td:nth-child(2){width:42%}
    .pb-act.has-instructor th:nth-child(3),.pb-act.has-instructor td:nth-child(3){width:14%;text-align:center}
    .pb-act.has-instructor th:nth-child(4),.pb-act.has-instructor td:nth-child(4){width:20%}
    .footer{margin-top:10px;font-size:12px;font-weight:700;color:#0f172a;text-align:center;border-top:1px solid #cbd5e1;padding-top:6px}
    @page{size:A4 portrait;margin:8mm}
    @media print{body{margin:0}.pb{page-break-inside:avoid;break-inside:avoid}.pb-hdr{break-after:avoid;page-break-after:avoid}.pb-act{break-before:avoid;page-break-before:avoid;break-inside:auto;page-break-inside:auto}tr{break-inside:avoid;page-break-inside:avoid}}
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
    const schools = Array.from(authorityGroup.schools.values()).sort((a, b) => a.school.localeCompare(b.school, 'he'));
    const schoolsHtml = schools.map((schoolGroup) => {
      const dates = Array.from(schoolGroup.dates.entries()).sort(([a], [b]) => compareValues(a || '9999', b || '9999', 'asc'));
      const datesHtml = dates.map(([date, entries]) => {
        const sorted = entries.slice().sort((a, b) => compareValues(a.time || '99:99', b.time || '99:99', 'asc'));
        const rowsHtml = sorted.map((entry) => {
          const activity = entry.activity;
          return `<tr>
            <td class="col-time">${escapeHtml(entry.time || '—')}</td>
            <td class="col-instructor">${escapeHtml(entry.instructor || '—')}</td>
            <td class="col-class">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
            <td class="col-activity">${escapeHtml(getActivityName(activity))}</td>
          </tr>`;
        }).join('');
        const dayLabel = date ? formatDateHeWithWeekday(date).split(' · ')[0] : '—';
        return `<div class="date-block authorities-title-table-block">
          <div class="date-title authorities-group-title">${escapeHtml(formatDateHe(date) || date)} · ${escapeHtml(dayLabel)}</div>
          <table class="authorities-table"><colgroup><col class="col-time"><col class="col-instructor"><col class="col-class"><col class="col-activity"></colgroup><thead><tr><th class="col-time">שעות</th><th class="col-instructor">מדריך</th><th class="col-class">כיתה</th><th class="col-activity">פעילות / סדנה</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        </div>`;
      }).join('');
      return `<div class="school-block">
        <div class="school-title authorities-group-title">${escapeHtml(schoolHeaderTitle(schoolGroup.school, schoolGroup.activities))}</div>
        ${datesHtml}
      </div>`;
    }).join('');
    return `<div class="authority-section">
      <div class="authority-header">${escapeHtml(authorityHeaderTitle(authorityGroup.authority, schools.length, authorityGroup.activities))}</div>
      ${schoolsHtml}
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
    .school-block{margin-bottom:8px;}
    .school-title{font-size:11px;font-weight:700;color:#1e293b;margin:0 auto 3px;padding:2px 8px;background:#f1f5f9;border-right:3px solid #94a3b8;width:55%;max-width:55%;break-after:avoid-page;page-break-after:avoid}
    .date-block{display:block;width:55%;max-width:55%;margin:0 auto 6px;}
    .date-title{font-size:10px;color:#475569;font-weight:700;margin-bottom:2px;text-align:right;break-after:avoid-page;page-break-after:avoid;}
    .date-title+.authorities-table{break-before:avoid-page;page-break-before:avoid;}
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
    @media print{body{margin:0}.authority-section:not(:first-child){break-before:page;page-break-before:always;}.date-block{width:55%!important;max-width:55%!important;margin:0 auto 6px!important;display:block!important;}.authorities-table{width:100%!important;table-layout:fixed!important}.authorities-table .col-time{width:20%!important}.authorities-table .col-instructor{width:27%!important}.authorities-table .col-class{width:20%!important}.authorities-table .col-activity{width:33%!important}.authorities-table th,.authorities-table td{white-space:normal!important;word-break:break-word!important;overflow-wrap:anywhere!important;font-size:9px;padding:2px 4px;line-height:1.15}.date-title{break-after:avoid-page;page-break-after:avoid}.date-title+.authorities-table{break-before:avoid-page;page-break-before:avoid}.authorities-title-table-block{break-inside:avoid-page;page-break-inside:avoid}.authorities-table tr{break-inside:avoid-page;page-break-inside:avoid}.school-title{break-after:avoid-page;page-break-after:avoid}}
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

function instructorsTabHtml(rows, state, data = {}, directory = buildSchoolsDirectory([]), contactsIndex = new Map()) {
  const ops = ensureOpsState(state);
  const filters = ensureActivityListFilters(state, SCOPE);
  const scheduleRows = buildScheduleRows(rows, state, directory);
  const selectedInstructorFilter = String(filters.instructor || '').trim();
  const printTitle = selectedInstructorFilter ? selectedInstructorFilter : 'כל המדריכים';
  _schedulePrintContext = { scheduleRows, state, selectedInstructorFilter, directory, contactsIndex };

  const tableRows = scheduleRows.map((entry) => {
    const activity = entry.activity;
    return `<tr>
      <td class="ds-ops-col--date"><strong>${escapeHtml(formatDateHe(entry.date) || '—')}</strong></td>
      <td class="ds-ops-col--weekday">${escapeHtml(entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '—')}</td>
      <td class="ds-ops-col--time">${escapeHtml(entry.time || '—')}</td>
      <td>${escapeHtml(getActivityAuthorityName(activity))}</td>
      <td class="ds-ops-col--school"><strong>${escapeHtml(getActivitySchoolDisplayNameClean(activity))}</strong></td>
      <td class="ds-ops-col--instructor">${escapeHtml(entry.instructor || '—')}</td>
      <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
      <td class="ds-ops-col--activity">${escapeHtml(getActivityName(activity))}</td>
    </tr>`;
  }).join('');

  const table = scheduleRows.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-schedule"><thead><tr>
        ${sortableTh(state, TAB_INSTRUCTORS, 'date', 'תאריך', 'ds-ops-col--date')}${sortableTh(state, TAB_INSTRUCTORS, 'weekday', 'יום', 'ds-ops-col--weekday')}${sortableTh(state, TAB_INSTRUCTORS, 'time', 'שעות', 'ds-ops-col--time')}${sortableTh(state, TAB_INSTRUCTORS, 'authority', 'רשות')}${sortableTh(state, TAB_INSTRUCTORS, 'school', 'בית ספר / מסגרת', 'ds-ops-col--school')}${sortableTh(state, TAB_INSTRUCTORS, 'instructor', 'מדריך', 'ds-ops-col--instructor')}${sortableTh(state, TAB_INSTRUCTORS, 'grade', 'כיתה', 'ds-ops-col--grade')}${sortableTh(state, TAB_INSTRUCTORS, 'activity', 'פעילות', 'ds-ops-col--activity')}
      </tr></thead><tbody>${tableRows}</tbody></table>`)
    : dsEmptyState('לא נמצאו פעילויות בטווח הנבחר');

  const instructorRows = selectedInstructorFilter ? rows.filter((row) => getActivityInstructorName(row) === selectedInstructorFilter) : rows;
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

function workshopsTabHtml(rows, state, stockMap, catalogRows = []) {
  const ops = ensureOpsState(state);
  const allMetrics = sortByConfig(workshopMetricsRows(rows, stockMap, catalogRows), state, TAB_WORKSHOPS, {
    workshopNo: (row) => row.workshopNo || row.workshopName,
    workshopName: (row) => row.workshopName,
    activityCount: (row) => row.activityCount,
    estimatedQuantity: (row) => row.estimatedQuantity,
  });
  const metrics = allMetrics.filter((row) => row.activityCount !== 0 || row.estimatedQuantity !== 0 || row.actualQuantity !== 0);

  const table = metrics.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table ds-ops-workshops-table"><thead><tr>
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopNo', 'מס׳ / קבוצה')}
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopName', 'שם פריט מלאי')}
        ${sortableTh(state, TAB_WORKSHOPS, 'activityCount', 'כמות סדנאות')}
        ${sortableTh(state, TAB_WORKSHOPS, 'estimatedQuantity', 'כמות נדרשת')}
        <th>מלאי קיים</th>
        <th>שימוש מלאי</th>
        <th>יתרת מלאי</th>
      </tr></thead><tbody>${metrics.map((row) => {
        const defaultStock = row.stockQuantity ?? row.catalogStock;
        const hasDefaultStock = defaultStock !== null && defaultStock !== undefined && Number.isFinite(Number(defaultStock));
        const shownStock = hasDefaultStock ? Number(defaultStock) : '';
        const stockDisplay = shownStock !== '' ? String(shownStock) : '—';
        const requiredQuantity = row.estimatedQuantity;
        const usage = normalizeInventoryUsage(row.actualQuantity);
        const usageHtml = `<span class="ds-ops-usage-display">${usage}</span>`;
        const stockValue = Number.isFinite(Number(shownStock)) ? Number(shownStock) : 0;
        const usageValue = normalizeInventoryUsage(row.actualQuantity);
        const remainderHtml = formatInventoryRemainder(stockValue, usageValue);
        const stockAttr = hasDefaultStock ? ` value="${escapeHtml(String(shownStock))}"` : '';
        return `<tr data-ops-stock-group="${escapeHtml(row.stockGroupKey || '')}">
          <td>${escapeHtml(row.workshopNoDisplay || row.workshopNo || '—')}</td>
          <td>${escapeHtml(row.workshopName)}</td>
          <td>${row.activityCount}</td>
          <td>${requiredQuantity}</td>
          <td><span${stockAttr}>${escapeHtml(stockDisplay)}</span></td>
          <td class="ds-ops-usage-cell">${usageHtml}</td>
          <td>${remainderHtml}</td>
        </tr>`;
      }).join('')}</tbody></table>`)
    : dsEmptyState('לא נמצאו סדנאות בתקופת הקיץ');

  return `<section class="ds-ops-mgmt-panel ds-ops-workshops-panel" dir="rtl">
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print-workshops>הדפס כמויות סדנאות</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print"><h2>מלאי סדנאות — קיץ 2026</h2><p>טווח: ${SUMMER_2026_FROM} – ${SUMMER_2026_TO}</p></div>
    <div class="ds-ops-workshops-card">${dsCard({ title: `מלאי סדנאות — קיץ 2026`, badge: String(metrics.length), body: `<div class="ds-ops-workshops-table-wrap">${table}</div>`, padded: false })}</div>
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

function sortAuthorityScheduleRows(scheduleRows = []) {
  return scheduleRows.slice().sort((a, b) => {
    const authorityCmp = getActivityAuthorityName(a.activity).localeCompare(getActivityAuthorityName(b.activity), 'he');
    if (authorityCmp !== 0) return authorityCmp;
    const schoolCmp = getActivitySchoolDisplayNameClean(a.activity).localeCompare(getActivitySchoolDisplayNameClean(b.activity), 'he');
    if (schoolCmp !== 0) return schoolCmp;
    const dateCmp = compareValues(a.date || '9999-99-99', b.date || '9999-99-99', 'asc');
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
      byAuthority.set(authority, { authority, schools: new Map(), activities: 0, instructors: new Set() });
    }
    const authorityGroup = byAuthority.get(authority);
    authorityGroup.activities += 1;
    const instructor = getActivityInstructorName(activity);
    if (instructor !== 'לא משויך') authorityGroup.instructors.add(instructor);

    if (!authorityGroup.schools.has(school)) {
      authorityGroup.schools.set(school, { school, dates: new Map(), activities: 0, workshops: new Set(), instructors: new Set() });
    }
    const schoolGroup = authorityGroup.schools.get(school);
    schoolGroup.activities += 1;
    schoolGroup.workshops.add(getActivityName(activity));
    if (instructor !== 'לא משויך') schoolGroup.instructors.add(instructor);

    if (!schoolGroup.dates.has(date)) schoolGroup.dates.set(date, []);
    schoolGroup.dates.get(date).push(entry);
  });

  const authoritySections = Array.from(byAuthority.values()).map((authorityGroup) => {
    const schools = Array.from(authorityGroup.schools.values()).sort((a, b) => a.school.localeCompare(b.school, 'he'));
    const schoolBlocks = schools.map((schoolGroup) => {
      const dateBlocks = Array.from(schoolGroup.dates.entries()).sort(([a], [b]) => compareValues(a || '9999-99-99', b || '9999-99-99', 'asc')).map(([date, entries]) => {
        const sortedEntries = entries.slice().sort((a, b) => {
          const timeCmp = compareValues(a.time || '99:99', b.time || '99:99', 'asc');
          if (timeCmp !== 0) return timeCmp;
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
          <strong class="ds-ops-school-card__title">${escapeHtml(schoolHeaderTitle(schoolGroup.school, schoolGroup.activities))}</strong>
        </header>
        ${dateBlocks}
      </article>`;
    }).join('');
    return `<section class="ds-ops-schools-authority"><header class="ds-ops-schools-authority__header"><strong>${escapeHtml(authorityHeaderTitle(authorityGroup.authority, schools.length, authorityGroup.activities))}</strong></header>${schoolBlocks}</section>`;
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

function renderTab(rows, state, data, allPreparedRows = []) {
  const ops = ensureOpsState(state);
  const stockMap = data?.workshopStockMap instanceof Map ? data.workshopStockMap : new Map();
  const directory = buildSchoolsDirectory(data?.schoolsDirectoryRows || []);
  const contactsIndex = buildContactsSchoolsIndex(data?.contactsSchoolsRows || []);
  if (ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
  if (ops.tab === TAB_AUTHORITIES || ops.tab === TAB_SCHOOLS) return schoolsTabHtml(rows, state, directory, contactsIndex);
  if (ops.tab === TAB_WORKSHOPS) {
    const catalogRows = extractWorkshopCatalogRows(data?.adminListsData, allPreparedRows);
    const summerRows = allPreparedRows.filter((row) =>
      activityMatchesPeriod(row, ACTIVITY_SEASON_SUMMER_2026) &&
      activityOverlapsDateRange(row, SUMMER_2026_FROM, SUMMER_2026_TO) &&
      activityMatchesAnyOfficialWorkshop(row, catalogRows)
    );
    return workshopsTabHtml(summerRows, state, stockMap, catalogRows);
  }
  return instructorsTabHtml(rows, state, data, directory, contactsIndex);
}

export const operationsManagementScreen = {
  load: async ({ api }) => {
    const [activities, lists, schoolsDirectory, contactsSchoolsRows] = await Promise.all([
      api.allActivities(),
      api.adminLists().catch(() => ({ categories: [] })),
      readOperationsSchoolsDirectory(),
      readContactsSchools()
    ]);
    return {
      ...activities,
      schoolsDirectoryRows: schoolsDirectory.rows,
      schoolsDirectorySource: schoolsDirectory.source,
      workshopStockMap: buildWorkshopStockMapFromLists(lists),
      adminListsData: lists,
      contactsSchoolsRows
    };
  },
  render(data, { state } = {}) {
    state = state || {};
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const prepared = prepareRows(allRows);
    const baseRows = applyBaseFilters(prepared, state);
    const filteredRows = applyAllFilters(baseRows, state);
    const ops = ensureOpsState(state);
    const filterRows = ops.tab === TAB_WORKSHOPS
      ? baseRows.filter((row) => activityMatchesAnyOfficialWorkshop(row, extractWorkshopCatalogRows(data?.adminListsData, prepared)))
      : baseRows;
    return `<div class="ds-screen-stack ds-ops-mgmt-screen">${opsManagementStylesHtml()}${dsPageHeader('ניהול תפעול')}
      ${topFiltersHtml(filterRows, state)}
      ${tabsHtml(ops.tab)}
      <div class="ds-ops-mgmt-content">${renderTab(filteredRows, state, data, prepared)}</div>
      <p class="ds-muted ds-ops-mgmt-count no-print" dir="rtl">מציג ${filteredRows.length} פעילויות מתוך ${allRows.length}</p>
    </div>`;
  },
  bind({ root, state, rerender }) {
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
