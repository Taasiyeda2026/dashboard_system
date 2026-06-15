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
  [TAB_WORKSHOPS]: { key: 'activityCount', dir: 'desc' },
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

function tabsHtml(activeTab) {
  const tabs = [
    [TAB_INSTRUCTORS, 'סידור מדריכים'],
    [TAB_WORKSHOPS, 'כמויות סדנאות'],
    [TAB_SCHOOLS, 'לפי בתי ספר']
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
    activity: getActivityName(activity),
    grade: getActivityGradeLabel(activity) || '',
    address: getActivityAddressResolved(activity, directory) || '',
    contact: '',
    phone: ''
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
        time: getActivityTimeRange(activity) || formatTimeRangeShort(activity?.start_time, activity?.end_time),
        hasTime: Boolean(getActivityTimeRange(activity) || activity?.start_time || activity?.StartTime)
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

function formatStockCell(value) {
  if (value === null || value === undefined || value === '') return '<span class="ds-ops-mgmt-cell-muted">לא הוזן</span>';
  return escapeHtml(String(value));
}

function formatGapCell(gap, hasStock) {
  if (!hasStock || gap === null || gap === undefined) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const value = Number(gap);
  if (!Number.isFinite(value)) return '<span class="ds-ops-mgmt-cell-muted">—</span>';
  const tone = value < 0 ? 'ds-ops-gap--shortage' : 'ds-ops-gap--ok';
  return `<span class="ds-ops-gap ${tone}">${escapeHtml(String(value))}</span>`;
}

function workshopMetricsRows(rows, stockMap) {
  const groups = new Map();
  rows.forEach((row) => {
    const name = getActivityName(row);
    if (!groups.has(name)) groups.set(name, { name, activities: 0, items: [] });
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
    }));
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
  return getActivityTimeRange(row) || formatTimeRangeShort(row?.start_time, row?.end_time) || '';
}

function opsManagementStylesHtml() {
  return `<style>
    .ds-ops-mgmt-screen .ds-ops-col--date,
    .ds-ops-mgmt-screen .ds-ops-col--weekday,
    .ds-ops-mgmt-screen .ds-ops-col--time,
    .ds-ops-mgmt-screen .ds-ops-col--phone { white-space: nowrap; }
    .ds-ops-mgmt-screen .ds-ops-sortable-th { cursor:pointer; user-select:none; white-space:nowrap; background:#e6f6fb; color:#0f172a; font-weight:700; border:0; }
    .ds-ops-mgmt-screen .ds-ops-col--school,
    .ds-ops-mgmt-screen .ds-ops-col--activity,
    .ds-ops-mgmt-screen .ds-ops-col--address { max-width:220px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ds-ops-mgmt-screen .ds-ops-col--address { max-width:260px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-summary-line { display:block; margin:0 0 10px; padding:7px 10px; border:1px solid #d8e5ee; border-radius:10px; background:#f8fbfd; color:#334155; font-weight:700; font-size:13px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters { padding:10px 12px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters .ds-filter-panel__title { margin:0 0 6px; font-size:14px; }
    .ds-ops-mgmt-screen .ds-ops-mgmt-filters__grid { gap:8px; grid-template-columns:repeat(5,minmax(140px,1fr)); align-items:end; }
    .ds-ops-mgmt-screen .ds-filter-field__label { font-size:11px; margin-bottom:2px; }
    .ds-ops-mgmt-screen .ds-ops-contact-select { min-width:104px; max-width:150px; padding-block:3px; font-size:12px; }
    .ds-ops-mgmt-screen .ds-sort-indicator { display:inline-block; margin-inline-start:4px; font-size:10px; color:#0f8fa8; }
    .ds-ops-mgmt-screen .ds-ops-workshops-table-wrap { width:100%; }
    .ds-ops-mgmt-screen .ds-ops-workshops-card { width:min(900px, 65%); margin-inline-start:auto; margin-inline-end:0; }
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
  </style>`;
}

function openOpsPrintWindow({ title = 'הדפסה', bodyHtml = '' } = {}) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('הדפדפן חסם פתיחת חלון הדפסה. יש לאפשר חלונות קופצים לאתר.');
    return;
  }
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:18px;color:#111827;background:#fff;font-size:12px;line-height:1.45}
    h1,h2,h3{margin:0 0 8px;color:#0f172a} p{margin:0 0 10px}
    table{width:100%;border-collapse:collapse;margin-top:10px;table-layout:auto} th,td{border:1px solid #cbd5e1;padding:6px 7px;vertical-align:top;text-align:right} th{background:#e6f6fb;color:#0f172a;font-weight:700} tr:nth-child(even) td{background:#f8fafc}.ds-ops-col--date,.ds-ops-col--weekday,.ds-ops-col--time,.ds-ops-col--phone{white-space:nowrap}.ds-ops-col--school,.ds-ops-col--activity,.ds-ops-col--address{max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .no-print,button,.ds-link-btn,.ds-sort-indicator{display:none!important}.only-print{display:block!important}.ds-ops-mgmt-print-footer{margin-top:14px;font-weight:600}
    @page{size:A4 landscape;margin:12mm}@media print{body{margin:0}tr{break-inside:avoid}}
  </style></head><body>${bodyHtml}</body></html>`;
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
  openOpsPrintWindow({ title: 'סידור עבודה', bodyHtml: `<section>${header}${summary}${table.outerHTML}${footer}</section>` });
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

function instructorsTabHtml(rows, state, data = {}, directory = buildSchoolsDirectory([]), contactsIndex = new Map()) {
  const ops = ensureOpsState(state);
  const instructors = instructorOptions(rows);
  if (ops.instructor === '__all__' && instructors.length === 1) ops.instructor = instructors[0];
  const scheduleRows = buildScheduleRows(rows, state, directory);
  const selected = String(ops.instructor || '__all__').trim();
  const printTitle = selected === '__all__' ? 'כל המדריכים' : selected;

  const tableRows = scheduleRows.map((entry) => {
    const activity = entry.activity;
    return `<tr>
      <td class="ds-ops-col--date"><strong>${escapeHtml(formatDateHe(entry.date) || '—')}</strong></td>
      <td class="ds-ops-col--weekday">${escapeHtml(entry.date ? formatDateHeWithWeekday(entry.date).split(' · ')[0] : '—')}</td>
      <td class="ds-ops-col--time">${escapeHtml(entry.time || '—')}</td>
      <td>${escapeHtml(getActivityAuthorityName(activity))}</td>
      <td class="ds-ops-col--school"><strong>${escapeHtml(getActivitySchoolDisplayNameClean(activity))}</strong></td>
      <td class="ds-ops-col--activity">${escapeHtml(getActivityName(activity))}</td>
      <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(activity) || '—')}</td>
      <td class="ds-ops-col--address">${mutedOrText(getActivityAddressResolved(activity, directory))}</td>
      <td class="ds-ops-col--contact">${contactSelectHtml(state, activity, entry.date, directory, contactsIndex)}</td>
      <td class="ds-ops-col--phone">${mutedOrText(getSelectedContact(state, activity, entry.date, directory, contactsIndex)?.phone)}</td>
    </tr>`;
  }).join('');

  const table = scheduleRows.length
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-schedule"><thead><tr>
        ${sortableTh(state, TAB_INSTRUCTORS, 'date', 'תאריך', 'ds-ops-col--date')}${sortableTh(state, TAB_INSTRUCTORS, 'weekday', 'יום', 'ds-ops-col--weekday')}${sortableTh(state, TAB_INSTRUCTORS, 'time', 'שעה', 'ds-ops-col--time')}${sortableTh(state, TAB_INSTRUCTORS, 'authority', 'רשות')}${sortableTh(state, TAB_INSTRUCTORS, 'school', 'בית ספר / מסגרת', 'ds-ops-col--school')}${sortableTh(state, TAB_INSTRUCTORS, 'activity', 'פעילות', 'ds-ops-col--activity')}${sortableTh(state, TAB_INSTRUCTORS, 'grade', 'שכבה / כיתה', 'ds-ops-col--grade')}${sortableTh(state, TAB_INSTRUCTORS, 'address', 'כתובת', 'ds-ops-col--address')}${sortableTh(state, TAB_INSTRUCTORS, 'contact', 'איש קשר', 'ds-ops-col--contact')}${sortableTh(state, TAB_INSTRUCTORS, 'phone', 'טלפון', 'ds-ops-col--phone')}
      </tr></thead><tbody>${tableRows}</tbody></table>`)
    : dsEmptyState('לא נמצאו פעילויות בטווח הנבחר');

  const instructorRows = selected === '__all__' ? rows : rows.filter((row) => getActivityInstructorName(row) === selected);
  const activeSummary = selected === '__all__' ? tabOverviewSummary(rows, scheduleRows) : instructorSummary(instructorRows, state, scheduleRows);
  const directoryNote = Array.isArray(data?.schoolsDirectoryRows) && data.schoolsDirectoryRows.length
    ? '<p class="ds-ops-mgmt-note ds-ops-mgmt-note--contacts no-print" dir="rtl">כתובת, איש קשר וטלפון מושלמים מטבלת schools לפי רשות ובית ספר.</p>'
    : '';

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
    ${directoryNote}
    ${dsCard({ title: 'טבלת סידור עבודה', badge: String(scheduleRows.length), body: table, padded: false })}
    <p class="ds-ops-mgmt-print-footer only-print">יש לבדוק את פרטי הפעילות לפני הגעה. במקרה של שינוי, יש לעדכן את התפעול.</p>
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
    ? dsTableWrap(`<table class="ds-table ds-table--compact ds-table--interactive ds-ops-mgmt-data-table ds-ops-workshops-table"><thead><tr>
        ${sortableTh(state, TAB_WORKSHOPS, 'workshopName', 'שם סדנה')}
        ${sortableTh(state, TAB_WORKSHOPS, 'activityCount', 'מספר סדנאות')}
        ${sortableTh(state, TAB_WORKSHOPS, 'estimatedQuantity', `כמות משוערת לפי ${WORKSHOP_ESTIMATE_PER_ACTIVITY}`)}
        ${sortableTh(state, TAB_WORKSHOPS, 'actualQuantity', 'כמות בפועל')}
        ${sortableTh(state, TAB_WORKSHOPS, 'stockQuantity', 'כמות במלאי')}
        ${sortableTh(state, TAB_WORKSHOPS, 'gap', 'פער מול מלאי')}
      </tr></thead><tbody>${metrics.map((row) => `<tr>
        <td><button type="button" class="ds-link-btn" data-ops-workshop="${escapeHtml(row.workshopName)}">${escapeHtml(row.workshopName)}</button></td>
        <td>${row.activityCount}</td>
        <td>${row.estimatedQuantity}</td>
        <td>${formatQuantityCell(row.actualQuantity)}</td>
        <td>${formatStockCell(row.stockQuantity)}</td>
        <td>${formatGapCell(row.gap, row.stockQuantity !== null)}</td>
      </tr>`).join('')}</tbody></table>`)
    : dsEmptyState('לא נמצאו סדנאות');

  const expanded = metrics.find((row) => row.workshopName === ops.expandedWorkshop);
  const expandedItems = expanded ? (groupsByName.get(expanded.workshopName) || []) : [];
  const detail = expanded ? dsCard({
    title: `פירוט: ${expanded.workshopName}`,
    body: dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table"><thead><tr><th>רשות</th><th>בית ספר</th><th>מדריך</th><th>תאריך</th><th>כמות בפועל</th></tr></thead><tbody>${expandedItems.map((row) => `<tr>
      <td>${escapeHtml(getActivityAuthorityName(row))}</td>
      <td class="ds-ops-col--school">${escapeHtml(getActivitySchoolDisplayNameClean(row))}</td>
      <td class="ds-ops-col--instructor">${escapeHtml(getActivityInstructorName(row))}</td>
      <td class="ds-ops-col--date">${escapeHtml(formatDateHe(getActivityPrimaryDate(row)) || '—')}</td>
      <td>${formatQuantityCell(getActivityActualParticipantCount(row))}</td>
    </tr>`).join('')}</tbody></table>`),
    padded: false
  }) : '';

  const stockCount = metrics.filter((row) => row.stockQuantity !== null).length;
  const shortageCount = metrics.filter((row) => row.stockQuantity !== null && Number(row.gap) < 0).length;
  return `<section class="ds-ops-mgmt-panel ds-ops-workshops-panel" dir="rtl">
    ${compactSummaryLineHtml([
      { label: 'סדנאות שונות', value: metrics.length },
      { label: 'פעילויות', value: rows.length },
      { label: 'עם נתון מלאי', value: stockCount },
      { label: 'חוסר במלאי', value: shortageCount }
    ])}
    <div class="ds-ops-mgmt-panel__toolbar no-print">
      <p class="ds-ops-mgmt-note">כמות משוערת = מספר סדנאות × ${WORKSHOP_ESTIMATE_PER_ACTIVITY}. מלאי לפי שם תוצר/סדנה מרשימות המערכת, אם קיים.</p>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-ops-print-workshops>הדפס כמויות סדנאות</button>
    </div>
    <div class="ds-ops-mgmt-print-header only-print"><h2>כמויות סדנאות ומלאי</h2><p>טווח תאריכים: ${escapeHtml(formatDateHe(ops.dateFrom))}–${escapeHtml(formatDateHe(ops.dateTo))}</p></div>
    <div class="ds-ops-workshops-card">${dsCard({ title: 'סיכום לפי שם סדנה', badge: String(metrics.length), body: `<div class="ds-ops-workshops-table-wrap">${table}</div>`, padded: false })}</div>
    ${detail}
  </section>`;
}

function schoolsTabHtml(rows, state, directory = buildSchoolsDirectory([]), contactsIndex = new Map()) {
  const ops = ensureOpsState(state);
  const groups = new Map();
  rows.forEach((row) => {
    const authority = getActivityAuthorityName(row);
    const school = getActivitySchoolDisplayNameClean(row);
    const key = schoolGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, { key, authority, school, activities: 0, workshops: new Set(), instructors: new Set(), dates: new Set(), exceptions: 0, items: [] });
    }
    const bucket = groups.get(key);
    bucket.activities += 1;
    bucket.workshops.add(getActivityName(row));
    const instructor = getActivityInstructorName(row);
    if (instructor !== 'לא משויך') bucket.instructors.add(instructor);
    getActivityScheduleDates(row).forEach((date) => bucket.dates.add(date));
    const primaryDate = getActivityPrimaryDate(row);
    if (primaryDate) bucket.dates.add(primaryDate);
    if (isSummerOperationsException(row)) bucket.exceptions += 1;
    bucket.items.push(row);
  });

  const schoolList = Array.from(groups.values()).sort((a, b) => {
    const authorityCmp = a.authority.localeCompare(b.authority, 'he');
    if (authorityCmp !== 0) return authorityCmp;
    const countCmp = b.activities - a.activities;
    if (countCmp !== 0) return countCmp;
    return a.school.localeCompare(b.school, 'he');
  });

  const byAuthority = new Map();
  schoolList.forEach((school) => {
    if (!byAuthority.has(school.authority)) byAuthority.set(school.authority, []);
    byAuthority.get(school.authority).push(school);
  });

  const authoritySections = Array.from(byAuthority.entries()).map(([authority, schools]) => {
    const activityCount = schools.reduce((sum, school) => sum + school.activities, 0);
    const instructors = new Set();
    schools.forEach((school) => school.instructors.forEach((name) => instructors.add(name)));
    const cards = schools.map((school) => {
      const isOpen = ops.expandedSchool === school.key;
      const sortedItems = school.items.slice().sort((a, b) => {
        const dateCmp = compareValues(getDetailDateForActivity(a) || '9999-99-99', getDetailDateForActivity(b) || '9999-99-99', 'asc');
        if (dateCmp !== 0) return dateCmp;
        const timeCmp = compareValues(getDetailTimeForActivity(a) || '99:99', getDetailTimeForActivity(b) || '99:99', 'asc');
        if (timeCmp !== 0) return timeCmp;
        const workshopCmp = getActivityName(a).localeCompare(getActivityName(b), 'he');
        if (workshopCmp !== 0) return workshopCmp;
        return getActivityInstructorName(a).localeCompare(getActivityInstructorName(b), 'he');
      });
      const detailRows = sortedItems.map((row) => {
        const date = getDetailDateForActivity(row);
        return `<tr>
          <td class="ds-ops-col--date">${escapeHtml(formatDateHe(date) || '—')}</td>
          <td class="ds-ops-col--weekday">${escapeHtml(date ? formatDateHeWithWeekday(date).split(' · ')[0] : '—')}</td>
          <td class="ds-ops-col--time">${escapeHtml(getDetailTimeForActivity(row) || '—')}</td>
          <td class="ds-ops-col--activity">${escapeHtml(getActivityName(row))}</td>
          <td class="ds-ops-col--instructor">${escapeHtml(getActivityInstructorName(row))}</td>
          <td class="ds-ops-col--grade">${escapeHtml(getActivityGradeLabel(row) || '—')}</td>
          <td class="ds-ops-col--address">${mutedOrText(getActivityAddressResolved(row, directory))}</td>
          <td class="ds-ops-col--contact">${contactSelectHtml(state, row, date, directory, contactsIndex)}</td>
          <td class="ds-ops-col--phone">${mutedOrText(getSelectedContact(state, row, date, directory, contactsIndex)?.phone)}</td>
        </tr>`;
      }).join('');
      const detail = isOpen
        ? `<div class="ds-ops-school-detail">${dsTableWrap(`<table class="ds-table ds-table--compact ds-ops-mgmt-data-table"><thead><tr><th>תאריך</th><th>יום</th><th>שעה</th><th>סדנה / פעילות</th><th>מדריך</th><th>שכבה / כיתה</th><th>כתובת</th><th>איש קשר</th><th>טלפון</th></tr></thead><tbody>${detailRows}</tbody></table>`)}</div>`
        : '';
      const instructorsList = Array.from(school.instructors);
      const workshopList = Array.from(school.workshops);
      return `<article class="ds-ops-school-card">
        <div class="ds-ops-school-card__top"><div>
          <div class="ds-ops-school-card__title">${escapeHtml(school.school)}</div>
          <div class="ds-ops-school-card__meta">
            <span class="ds-ops-pill">${escapeHtml(school.authority)}</span><span class="ds-ops-pill">${school.activities} פעילויות</span><span class="ds-ops-pill">${school.workshops.size} סדנאות</span><span class="ds-ops-pill">${school.instructors.size} מדריכים</span>${school.exceptions ? `<span class="ds-ops-pill">${school.exceptions} חריגות</span>` : ''}
          </div>
          <div class="ds-ops-school-card__meta" style="margin-top:6px"><span class="ds-ops-pill">${escapeHtml(formatSchoolDateRange(Array.from(school.dates)))}</span></div>
        </div><button type="button" class="ds-ops-school-card__toggle no-print" data-ops-school="${escapeHtml(school.key)}">${isOpen ? 'סגור' : 'פירוט'}</button></div>
        ${detail}
      </article>`;
    }).join('');
    return `<section class="ds-ops-schools-authority"><header class="ds-ops-schools-authority__header"><strong>${escapeHtml(authority)}</strong><span class="ds-ops-schools-authority__stats"><span class="ds-ops-pill">${schools.length} בתי ספר / מסגרות</span><span class="ds-ops-pill">${activityCount} פעילויות</span><span class="ds-ops-pill">${instructors.size} מדריכים</span></span></header><div class="ds-ops-schools-grid">${cards}</div></section>`;
  }).join('');

  return `<section class="ds-ops-mgmt-panel" dir="rtl">
    ${compactSummaryLineHtml([
      { label: 'רשויות', value: byAuthority.size },
      { label: 'בתי ספר / מסגרות', value: schoolList.length },
      { label: 'פעילויות', value: rows.length },
      { label: 'מדריכים', value: instructorOptions(rows).length }
    ])}
    ${authoritySections || dsEmptyState('לא נמצאו בתי ספר / מסגרות')}
  </section>`;
}

function renderTab(rows, state, data) {
  const ops = ensureOpsState(state);
  const stockMap = data?.workshopStockMap instanceof Map ? data.workshopStockMap : new Map();
  const directory = buildSchoolsDirectory(data?.schoolsDirectoryRows || []);
  const contactsIndex = buildContactsSchoolsIndex(data?.contactsSchoolsRows || []);
  if (ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
  if (ops.tab === TAB_WORKSHOPS) return workshopsTabHtml(rows, state, stockMap);
  if (ops.tab === TAB_SCHOOLS) return schoolsTabHtml(rows, state, directory, contactsIndex);
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
    return `<div class="ds-screen-stack ds-ops-mgmt-screen">${opsManagementStylesHtml()}${dsPageHeader('ניהול תפעול', 'עמוד תפעולי להצגת סידור עבודה למדריכים, כמויות סדנאות ופירוט מסודר לפי בתי ספר.')}
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
        if (ops.tab === TAB_SUMMER) ops.tab = TAB_INSTRUCTORS;
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

    root.querySelector('[data-ops-instructor]')?.addEventListener('change', (ev) => { ops.instructor = ev.target.value || '__all__'; rerender?.(); });
    root.querySelectorAll('[data-ops-contact-key]').forEach((select) => {
      select.addEventListener('change', (ev) => {
        ops.selectedContacts = ops.selectedContacts || {};
        const key = ev.target.getAttribute('data-ops-contact-key') || '';
        if (!key) return;
        if (ev.target.value) ops.selectedContacts[key] = ev.target.value;
        else delete ops.selectedContacts[key];
        rerender?.();
      });
    });
    root.querySelector('[data-ops-print]')?.addEventListener('click', () => printScheduleFromDom(root));
    root.querySelector('[data-ops-print-workshops]')?.addEventListener('click', () => printWorkshopsFromDom(root));

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
