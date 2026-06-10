import { state, setSession, clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
import { cleanActivityManagerName, NO_ACTIVITY_MANAGER_LABEL, normalizeOneDayActivityType, resolveActivityInstructorName } from './screens/shared/activity-options.js';
import { EXCEPTION_TYPE_ORDER, normalizedExceptionTypes } from './screens/shared/exceptions-metrics.js';
import { isSummerActivity, normalizeActivitySeason } from './screens/shared/summer-activity.js';
import { supabase, supabaseConfig, waitForSupabaseAuthSession } from './supabase-client.js';
import { isEmptyValue, nonEmptyString } from './utils/empty-value.js';

/**
 * Actions that modify server-side data.
 *
 * After mutating actions succeed, route cache invalidation runs automatically.
 *
 * Mutations clear only related route caches (not full wipe), so navigation
 * stays fast while still showing fresh data where needed.
 *
 * Screens that expose their own save forms (activities.js, permissions.js)
 * additionally call the bind-injected clearScreenDataCache?.() right before
 * rerender() as a belt-and-suspenders guard for their targeted route cache keys.
 * Read-only screens (exceptions, end-dates, instructors, my-data, week, month,
 * contacts, instructor-contacts) have no save handlers and rely solely on this
 * centralised clear, which is sufficient.
 */
const MUTATING_ACTIONS = {
  saveActivity: true,
  addActivity: true,
  addContact: true,
  saveContact: true,
  submitEditRequest: true,
  submitCreateActivityRequest: true,
  reviewEditRequest: true,
  savePermission: true,
  addUser: true,
  deactivateUser: true,
  reactivateUser: true,
  deleteUser: true,
  savePrivateNote: true,
  saveSheetMapping: true,
  saveClientSetting: true,
  addProposalAgreement: true,
  updateProposalAgreement: true,
  updateProposalAgreementStatus: true,
  deleteProposalAgreement: true,
  saveProposalAgreementItems: true
  ,saveActivityLayoutStatus: true
  ,deleteActivity: true
};

const READ_ACTIONS = {
  bootstrap: true,
  dashboard: true,
  dashboardSnapshot: true,
  dashboardSheet: true,
  activities: true,
  activityDetail: true,
  activityDates: true,
  week: true,
  month: true,
  exceptions: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  proposalsAgreements: true,
  activityLayoutStatuses: true,
  adminSettings: true,
  adminLists: true,
  listSheets: true,
  israaProgramTracking: true,
  israaSimulatorEntries: true,
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 45000;
const PERF_MAX_REQUESTS = 150;
/** Logs direct heavy reads for performance diagnostics. */
const HEAVY_GUARDED_READ_ACTIONS = new Set([
  'dashboardSnapshot',
  'activities',
  'week',
  'month',
  'exceptions',
  'endDates'
]);

function warnHeavyLegacyReadWithoutIntentionalFlag(action, perfMeta) {
  if (!READ_ACTIONS[action]) return;
  if (!HEAVY_GUARDED_READ_ACTIONS.has(action)) return;
  if (perfMeta?.direct_intentional === true) return;
  let caller = '';
  try {
    caller = String(new Error().stack || '')
      .split('\n')
      .slice(2, 6)
      .map((s) => s.trim())
      .join(' | ');
  } catch {
    /* ignore */
  }
  try {
    console.warn('[heavy-read-guard]', JSON.stringify({
      screen: String(action),
      action: String(action),
      reason: 'heavy_read_without_intentional_flag',
      caller
    }));
  } catch {
    /* ignore */
  }
}


function rowMatchesActivitiesFilters(row, filters = {}) {
  const activityType = String(filters?.activity_type || '').trim();
  const month = String(filters?.month || '').trim();

  if (activityType && activityType !== 'all' && String(row?.activity_type || '').trim() !== activityType) return false;

  if (/^\d{4}-\d{2}$/.test(month)) {
    const [y, mo] = month.split('-').map(Number);
    const monthStart = `${month}-01`;
    const lastDay = new Date(y, mo, 0).getDate();
    const monthEnd = `${month}-${String(lastDay).padStart(2, '0')}`;
    if (!activityHasDateInRange(row, monthStart, monthEnd) && hasAnyActivityDate(row)) return false;
  }

  return true;
}

async function readArchiveActivitiesFromSupabase() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('activities')
      .select('*')
      .eq('status', CLOSED_STATUS);
    if (error) throw new Error(error.message || 'archive_read_failed');
    const rows = (Array.isArray(data) ? data : [])
      .map(normalizeActivityRow)
      .sort((a, b) => String(b?.end_date || b?.start_date || '').localeCompare(String(a?.end_date || a?.start_date || '')));
    return { rows, _source: 'supabase' };
  } catch (err) {
    console.error('[supabase] archive fetch error:', err);
    return null;
  }
}

async function readActivitiesFromSupabase(filters = {}) {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.from('activities').select('*');
    if (error) throw new Error(error.message || 'activities_read_failed');
    const rows = (Array.isArray(data) ? data : [])
      .map(normalizeActivityRow)
      .filter((row) => filters?.include_inactive ? true : !isActivityInactive(row))
      .filter((row) => rowMatchesActivitiesFilters(row, filters));
    return { rows, _source: 'supabase' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected activities fetch error:', error);
    return null;
  }
}

function buildSupabaseErrorPayload(base, error, extra = {}) {
  const message = String(error?.message || error || 'supabase_read_failed');
  return {
    ...(base && typeof base === 'object' ? base : {}),
    _source: 'supabase',
    _debug: { error: message, ...extra },
    error: message
  };
}


const ACTIVITIES_TABLE = 'activities';
const CLOSED_STATUS = 'סגור';
const OPEN_STATUS = 'פתוח';
const LEGACY_ACTIVE_STATUS = 'פעיל';
const DELETED_STATUS = 'נמחק';
const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);

function oneDayTypeFromActivityFields(activityType, itemType) {
  return canonicalOneDayActivityType(activityType) || canonicalOneDayActivityType(itemType);
}

function normalizeActivityRow(row = {}) {
  const canonicalOneDayType = oneDayTypeFromActivityFields(row?.activity_type, row?.item_type);
  const isLegacyOneDay = canonicalOneDayType && (String(row?.activity_family || '').trim() === 'one_day' || !String(row?.item_type || '').trim());
  const rowId = String(row?.row_id ?? row?.RowID ?? '').trim();
  const activitySeason = normalizeActivitySeason(row?.activity_season ?? row?.activitySeason);
  const normalized = {
    ...row,
    row_id: rowId,
    RowID: rowId,
    source_sheet: 'activities',
    source_table: ACTIVITIES_TABLE,
    activity_season: activitySeason,
    activitySeason,
    activity_family: isLegacyOneDay ? 'one_day' : row?.activity_family,
    activity_type: canonicalOneDayType || row?.activity_type,
    item_type: canonicalOneDayType || row?.item_type || row?.activity_type || '',
    status: isLegacyOneDay && String(row?.status || '').trim() === LEGACY_ACTIVE_STATUS ? OPEN_STATUS : row?.status,
    date_start: row?.start_date ?? row?.date_start ?? '',
    date_end: row?.end_date ?? row?.date_end ?? ''
  };
  for (let i = 1; i <= 35; i++) {
    const lower = `date_${i}`;
    const oldDateKey = `Date${i}`;
    const value = String(row?.[lower] ?? row?.[oldDateKey] ?? '').trim().slice(0, 10);
    normalized[lower] = value;
    normalized[oldDateKey] = value;
  }
  normalized.meeting_dates = getActivityDateColumns(normalized);
  normalized.date_cols = normalized.meeting_dates;
  normalized.meeting_schedule = normalized.meeting_dates.map((d) => ({ date: d, performed: 'no' }));
  return normalized;
}


function canonicalActivityTypeToken(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  return lower.replace(/[\u2010-\u2015]/g, '_').replace(/[\s_-]+/g, '_');
}

function canonicalOneDayActivityType(value) {
  return normalizeOneDayActivityType(value);
}

function normalizeActivityTypeValue(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  const compact = canonicalActivityTypeToken(raw).replace(/_/g, '');
  const oneDayType = canonicalOneDayActivityType(raw);
  if (oneDayType) return oneDayType;
  if (compact === 'course' || raw === 'קורס' || raw === 'קורסים') return 'course';
  if (compact === 'afterschool' || raw === 'חוג אפטרסקול' || raw === 'אפטרסקול') return 'after_school';
  return lower || raw;
}

function rowActivityType(row = {}) {
  return normalizeActivityTypeValue(row?.activity_type || row?.type || row?.kind);
}

function isActivityClosed(row) {
  return String(row?.status || '').trim() === CLOSED_STATUS;
}
function isActivityDeleted(row) {
  return String(row?.status || '').trim() === DELETED_STATUS;
}
function isActivityInactive(row) {
  return isActivityClosed(row) || isActivityDeleted(row);
}

function isProgramActivity(row) {
  return String(row?.activity_family || '').trim() === 'program';
}

function isOneDayActivity(row) {
  return String(row?.activity_family || '').trim() === 'one_day' || Boolean(oneDayTypeFromActivityFields(row?.activity_type, row?.item_type));
}

function getActivityDateColumns(row = {}) {
  const dates = [];
  for (let i = 1; i <= 35; i++) {
    const dateKey = normalizeSupabaseDate(row?.[`date_${i}`] ?? row?.[`Date${i}`]);
    if (dateKey) dates.push(dateKey);
  }
  return dates;
}

function calculatedEndDateFromActivityDates(row = {}) {
  const dates = getActivityDateColumns(row);
  return dates.length ? dates.reduce((max, dateKey) => (dateKey > max ? dateKey : max), '') : '';
}

function nextMeetingDateFromActivity(row = {}, today = todayLocalIsoDate()) {
  const dates = getActivityDateColumns(row).sort();
  return dates.find((dateKey) => dateKey >= today) || '';
}

function latestMeetingDateFromActivity(row = {}) {
  return calculatedEndDateFromActivityDates(row);
}

function todayLocalIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isOperationallyActive(row = {}) {
  const status = String(row?.status || '').trim();
  return !isActivityInactive(row) && (!status || status === 'פעיל' || status === 'פתוח' || status === 'active' || status === 'open');
}

function isOpenStatus(row = {}) {
  return isOperationallyActive(row);
}

function districtDisplayKey(row = {}) {
  return nullStr(row?.district) || 'ללא מחוז / לא משויך';
}
function hasAnyActivityDate(row = {}) {
  if (normalizeSupabaseDate(row?.start_date ?? row?.date_start)) return true;
  if (normalizeSupabaseDate(row?.end_date ?? row?.date_end)) return true;
  return getActivityDateColumns(row).length > 0;
}

function firstNormalizedDate(...values) {
  for (const value of values) {
    const normalized = normalizeSupabaseDate(value);
    if (normalized) return normalized;
  }
  return '';
}

function activityHasDateInRange(row, startDate, endDate) {
  const dates = getActivityDateColumns(row);
  if (dates.length > 0) {
    return dates.some((dateKey) => dateKey >= startDate && dateKey <= endDate);
  }

  const start = firstNormalizedDate(row?.start_date, row?.date_start);
  if (!start) return false;
  const end = firstNormalizedDate(row?.end_date, row?.date_end) || start;
  return start <= endDate && end >= startDate;
}

function activityHasDateInMonth(row, monthPrefix) {
  const range = monthDateRange(monthPrefix);
  if (!range) return false;
  return activityHasDateInRange(row, range.startDate, range.endDate);
}

async function selectActivitiesFromSupabase(select = '*') {
  const result = await supabase.from('activities').select(select);
  if (result.error) throw new Error(result.error.message || 'activities_read_failed');
  return (Array.isArray(result.data) ? result.data : []).map(normalizeActivityRow);
}

function monthDateRange(ym) {
  const monthPrefix = String(ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthPrefix)) return null;
  const [yStr, mStr] = monthPrefix.split('-');
  const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
  return {
    month: monthPrefix,
    startDate: `${monthPrefix}-01`,
    endDate: `${monthPrefix}-${String(lastDay).padStart(2, '0')}`
  };
}

function buildDateRangeOrFilter(startDate, endDate, { includeStartDate = true, includeEndDate = false } = {}) {
  const clauses = [];
  for (let i = 1; i <= 35; i++) {
    clauses.push(`and(date_${i}.gte.${startDate},date_${i}.lte.${endDate})`);
  }
  if (includeStartDate) clauses.push(`and(start_date.gte.${startDate},start_date.lte.${endDate})`);
  if (includeEndDate) clauses.push(`and(end_date.gte.${startDate},end_date.lte.${endDate})`);
  return clauses.join(',');
}

async function selectActivitiesByDateRangeFromSupabase({
  startDate,
  endDate,
  activityType = '',
  includeEndDate = false,
  select = '*'
} = {}) {
  if (!supabase) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) {
    throw new Error('invalid_activity_date_range');
  }
  let query = supabase
    .from('activities')
    .select(select)
    .or(buildDateRangeOrFilter(startDate, endDate, { includeEndDate }));
  const normalizedType = normalizeActivityTypeValue(activityType);
  if (normalizedType && normalizedType !== 'all') {
    query = normalizedType === 'course'
      ? query.in('activity_type', ['course', 'קורס', 'קורסים'])
      : query.eq('activity_type', normalizedType);
  }
  const result = await query;
  if (result.error) throw new Error(result.error.message || 'activities_date_range_read_failed');
  return (Array.isArray(result.data) ? result.data : []).map(normalizeActivityRow);
}

/**
 * Reads contacts_instructors + contacts_schools from Supabase.
 * Returns { instructor_rows, school_rows, can_view_instructors, can_view_schools, _source }
 * or null on any failure.
 *
 * ⚠️ permissions table is intentionally excluded — login credentials must never be read client-side.
 */
async function readContactsFromSupabase() {
  if (!supabase) return null;
  try {
    const [instrResult, schoolResult] = await Promise.all([
      supabase.from('contacts_instructors').select('*'),
      supabase.from('contacts_schools').select('*')
    ]);
    if (instrResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_instructors:', instrResult.error);
      return null;
    }
    if (schoolResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_schools:', schoolResult.error);
      return null;
    }
    const instructor_rows = Array.isArray(instrResult.data) ? instrResult.data : [];
    const school_rows = Array.isArray(schoolResult.data) ? schoolResult.data : [];
    return {
      instructor_rows,
      school_rows,
      can_view_instructors: true,
      can_view_schools: true,
      _source: 'supabase'
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected contacts fetch error:', error);
    return null;
  }
}

/**
 * Reads contacts_instructors from Supabase for the instructor-contacts screen.
 * Returns { rows, _source } or null on failure.
 */
async function readInstructorContactsFromSupabase() {
  if (!supabase) return null;
  try {
    const result = await supabase.from('contacts_instructors').select('*');
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_instructors:', result.error);
      return null;
    }
    return {
      rows: Array.isArray(result.data) ? result.data : [],
      _source: 'supabase'
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected contacts_instructors fetch error:', error);
    return null;
  }
}

/**
 * Reads the lists table from Supabase and groups rows into categories.
 * Expected columns: category, value, label (label optional — falls back to value).
 * Returns { categories: [{ category, items: [{ label, value }] }], _source } or null.
 */
async function readListsFromSupabase() {
  if (!supabase) return null;
  try {
    const result = await supabase
      .from('lists')
      .select('*')
      .order('category_order', { ascending: true, nullsFirst: false })
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('category', { ascending: true })
      .order('value', { ascending: true });
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load lists:', result.error);
      return null;
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    const catMap = new Map();
    for (const row of rows) {
      const cat = String(row.category || row.group || '').trim();
      if (!cat) continue;
      const value = String(row.value ?? row.item_value ?? row.val ?? '').trim();
      const label = String(row.label ?? row.item_label ?? row.display ?? value).trim() || value;
      if (!value) continue;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push({ label, value, _row: row, is_active: row.is_active, active: row.active });
    }
    const categories = [...catMap.entries()].map(([category, items]) => ({ category, items }));
    return { categories, _source: 'supabase' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected lists fetch error:', error);
    return null;
  }
}

/**
 * Converts the lists table data into the clientSettings shape expected by
 * activity-options.js and the add-activity form.
 * Handles many category name variants so the lists table can use any naming.
 */
function buildClientSettingsFromLists(listsData, settingsRows = []) {
  const categories = Array.isArray(listsData?.categories) ? listsData.categories : [];
  const settingValue = (key) => {
    const row = (Array.isArray(settingsRows) ? settingsRows : []).find((item) => String(item?.key || '').trim() === key);
    return String(row?.value || '').trim();
  };
  const accentColor = settingValue('accent_color') || settingValue('theme_accent') || settingValue('ui_accent_color');
  const byCategory = {};
  categories.forEach(({ category, items }) => {
    byCategory[String(category).toLowerCase()] = Array.isArray(items) ? items : [];
  });

  function getItems(...keys) {
    for (const k of keys) {
      const hit = byCategory[String(k).toLowerCase()];
      if (hit && hit.length) return hit;
    }
    return [];
  }
  function getValues(...keys) {
    return getItems(...keys).map((i) => i.value).filter(Boolean);
  }

  const managerItems    = getItems('activity_manager', 'activity_managers', 'activities_manager_users', 'activity_manager_users', 'manager', 'managers');
  const instructorItems = getItems('instructor_users', 'instructor_name', 'instructor', 'instructors', 'instructor_names');
  const activityNameItems = getItems('activity_names', 'activity_name', 'activities', 'activity');
  const fundingValues   = getValues('funding', 'fundings');
  const gradeValues     = getValues('grade', 'grades', 'class');
  const schoolValues    = getValues('school', 'schools');
  const authorityValues = getValues('authority', 'authorities');
  const activitySeasonItems = getItems('activity_season');

  const shortTypes = getValues('one_day_activity_type', 'one_day_types', 'short_activity_type', 'short_activity_types');
  let   longTypes  = getValues('program_activity_type', 'program_types', 'long_activity_type', 'long_activity_types', 'program_activity_types');
  if (!shortTypes.length && !longTypes.length) {
    longTypes = getValues('activity_type', 'activity_types');
  }

  const instructorUsers = instructorItems.map((i) => ({
    name:   i.label || i.value,
    emp_id: String(i._row?.emp_id || i._row?.employee_id || '').trim()
  }));

  const activityNames = activityNameItems.map((i) => ({
    label:         i.label || i.value,
    label_he:      String(i._row?.label_he || i.label || i.value || '').trim(),
    value:         i.value || String(i._row?.activity_name || i.label || '').trim(),
    activity_name: String(i._row?.activity_name || i.value || i.label || '').trim(),
    activity_no:   String(i._row?.activity_no  || i._row?.number      || '').trim(),
    activity_type: String(i._row?.activity_type || i._row?.parent_value || i._row?.type || '').trim(),
    parent_value:  String(i._row?.parent_value  || i._row?.activity_type || i._row?.type || '').trim(),
    type:          String(i._row?.type || i._row?.activity_type || i._row?.parent_value || '').trim(),
    active:        i._row?.active ?? i._row?.is_active ?? i.active,
    sort_order:    Number.isFinite(Number(i._row?.sort_order)) ? Number(i._row?.sort_order) : null
  }));
  const activityTypes = [...new Set(activityNames.map((row) => String(row.activity_type || row.parent_value || row.type || '').trim()).filter(Boolean))];

  const managerIsActive = (item) => {
    const row = item?._row && typeof item._row === 'object' ? item._row : item;
    const raw = row && Object.prototype.hasOwnProperty.call(row, 'is_active') ? row.is_active : row?.active;
    if (raw === false || raw === 0) return false;
    const clean = String(raw ?? '').trim().toLowerCase();
    return !['false', '0', 'no', 'n', 'inactive', 'לא', 'לא פעיל', 'כבוי'].includes(clean);
  };
  const managerNames = managerItems
    .filter(managerIsActive)
    .map((i) => cleanActivityManagerName(i.value || i.label))
    .filter(Boolean);
  const managerUsers = managerItems.map((i) => {
    const row = i?._row && typeof i._row === 'object' ? i._row : {};
    return {
      name: cleanActivityManagerName(i.value || i.label),
      value: i.value,
      label: i.label,
      is_active: managerIsActive(i),
      active: i.active,
      district: row.district,
      region: row.region,
      area: row.area,
      group: row.group,
      parent_value: row.parent_value,
      metadata: row.metadata,
      zone: row.zone,
      manager_district: row.manager_district,
      activity_manager_district: row.activity_manager_district,
      manager_region: row.manager_region,
      activity_manager_region: row.activity_manager_region,
    };
  }).filter((user) => user.name);

  return {
    dropdown_options: {
      funding:                  fundingValues,
      fundings:                 fundingValues,
      grade:                    gradeValues,
      grades:                   gradeValues,
      school:                   schoolValues,
      schools:                  schoolValues,
      authority:                authorityValues,
      authorities:              authorityValues,
      activity_manager:         managerNames,
      activity_managers:        managerNames,
      activities_manager_users: managerUsers,
      instructor_name:          instructorUsers.map((u) => u.name),
      instructor_names:         instructorUsers.map((u) => u.name),
      instructor_users:         instructorUsers,
      activity_names:           activityNames,
      activity_season:          activitySeasonItems.map((item) => ({
        value: normalizeActivitySeason(item.value),
        label: item.label || item.value
      })),
    },
    one_day_activity_types: shortTypes,
    program_activity_types: longTypes.length ? longTypes : activityTypes,
    activity_types: activityTypes,
    ...(accentColor ? { accent_color: accentColor, theme_accent: accentColor, ui_accent_color: accentColor } : {}),
  };
}

/**
 * Computes per-instructor activity stats from public.activities only.
 * Returns { rows, _source: 'supabase' } or null on any failure.
 */
async function readInstructorsFromSupabase() {
  if (!supabase) return null;
  try {
    const [activityRows, contactsResult] = await Promise.all([
      selectActivitiesFromSupabase('*'),
      supabase.from('contacts_instructors').select('*')
    ]);

    if (contactsResult.error) {
      // eslint-disable-next-line no-console
      console.warn('[supabase] contacts_instructors unavailable for instructors stats:', contactsResult.error);
    }

    const activeRows = activityRows.filter((row) => !isActivityInactive(row));
    const statsMap = new Map();
    const aliases = new Map();

    function normalizeName(value) {
      return String(value || '').trim().replace(/\s+/g, ' ');
    }

    function addAlias(alias, key) {
      const a = normalizeName(alias).toLowerCase();
      const k = String(key || '').trim();
      if (a && k && !aliases.has(a)) aliases.set(a, k);
    }

    function ensureStats(id, name) {
      const rawId = String(id || '').trim();
      const cleanName = normalizeName(name);
      const aliasKey = aliases.get(cleanName.toLowerCase()) || '';
      const k = rawId || aliasKey || cleanName;
      if (!k) return null;
      if (!statsMap.has(k)) {
        statsMap.set(k, {
          emp_id: k,
          full_name: cleanName || k,
          instructor_name: cleanName || k,
          programs_count: 0,
          one_day_count: 0,
          earliest_start_date: '',
          latest_end_date: '',
          managers: new Set(),
          authorities: new Set(),
          schools: new Set(),
          activity_names: new Set(),
          activity_type_counts: {}
        });
      }
      const stats = statsMap.get(k);
      if (cleanName && (!stats.full_name || stats.full_name === stats.emp_id)) {
        stats.full_name = cleanName;
        stats.instructor_name = cleanName;
      }
      if (rawId) addAlias(rawId, k);
      if (cleanName) addAlias(cleanName, k);
      return stats;
    }

    const contacts = Array.isArray(contactsResult.data) ? contactsResult.data : [];
    contacts.forEach((contact) => {
      const empId = String(contact?.emp_id || contact?.employee_id || contact?.id || '').trim();
      const name = normalizeName(contact?.full_name || contact?.name || contact?.instructor_name || contact?.guide);
      const stats = ensureStats(empId || name, name || empId);
      if (stats) {
        if (empId) addAlias(empId, stats.emp_id);
        if (name) addAlias(name, stats.emp_id);
      }
    });

    for (const row of activeRows) {
      const pairs = [
        [row.emp_id, row.instructor_name || row.instructor || row.guide],
        [row.emp_id_2, row.instructor_name_2]
      ];
      const startDate = normalizeSupabaseDate(row.start_date);
      const endDate = normalizeSupabaseDate(row.end_date);
      const manager = String(row.activity_manager || '').trim();
      const authority = String(row.authority || '').trim();
      const school = String(row.school || '').trim();
      const activityName = String(row.activity_name || '').trim();
      const actType = rowActivityType(row);
      for (const [id, name] of pairs) {
        const stats = ensureStats(id || name, name || id);
        if (!stats) continue;
        if (isProgramActivity(row)) stats.programs_count += 1;
        if (isOneDayActivity(row)) stats.one_day_count += 1;
        if (startDate && (!stats.earliest_start_date || startDate < stats.earliest_start_date)) stats.earliest_start_date = startDate;
        if (endDate && (!stats.latest_end_date || endDate > stats.latest_end_date)) stats.latest_end_date = endDate;
        if (manager) stats.managers.add(manager);
        if (authority) stats.authorities.add(authority);
        if (school) stats.schools.add(school);
        if (activityName) stats.activity_names.add(activityName);
        if (actType) stats.activity_type_counts[actType] = (stats.activity_type_counts[actType] || 0) + 1;
      }
    }

    const rows = [...statsMap.values()].map((stats) => ({
      emp_id: stats.emp_id,
      full_name: stats.full_name || stats.emp_id,
      instructor_name: stats.instructor_name || stats.full_name || stats.emp_id,
      programs_count: stats.programs_count,
      one_day_count: stats.one_day_count,
      earliest_start_date: stats.earliest_start_date || '',
      latest_end_date: stats.latest_end_date || '',
      activity_managers: [...stats.managers],
      authorities: [...stats.authorities],
      schools: [...stats.schools],
      activity_names: [...stats.activity_names],
      activity_type_counts: stats.activity_type_counts,
      has_activity_stats: (stats.programs_count + stats.one_day_count) > 0 || Object.values(stats.activity_type_counts).some((n) => Number(n) > 0)
    }));

    rows.sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || ''), 'he'));
    return { rows, detail_rows: activeRows, activities_loaded: true, _source: 'supabase' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected instructors fetch error:', error);
    return null;
  }
}

/**
 * Builds KPI card array for the dashboard from computed Supabase values.
 * Only metrics computed from the same Supabase dashboard path are emitted.
 */
function buildDashboardKpiCardsFromSupabase(totals, activeTypeCounts, exceptionCount, uniqueInstructorCount, courseEndings) {
  void totals;
  const typeCards = [
    { id: 'active_courses',      action: 'kpi|active_courses',      subtitle: 'קורסים',    key: 'course' },
    { id: 'active_workshops',    action: 'kpi|active_workshops',    subtitle: 'סדנאות',    key: 'workshop' },
    { id: 'active_tours',        action: 'kpi|active_tours',        subtitle: 'סיורים',    key: 'tour' },
    { id: 'active_after_school', action: 'kpi|active_after_school', subtitle: 'אפטרסקול', key: 'after_school' },
  ].map(({ id, action, subtitle, key }) => ({
    id, action, subtitle,
    title: String(activeTypeCounts[key] || 0),
    value: activeTypeCounts[key] || 0
  }));
  return [
    ...typeCards,
    { id: 'summer',      action: 'kpi|summer',      title: String(activeTypeCounts.summer || 0), subtitle: 'קיץ',            value: activeTypeCounts.summer || 0 },
    { id: 'endings',     action: 'kpi|endings',     title: String(courseEndings),         subtitle: 'סיומי קורסים',   value: courseEndings },
    { id: 'instructors', action: 'kpi|instructors', title: String(uniqueInstructorCount), subtitle: 'מדריכים פעילים', value: uniqueInstructorCount },
    { id: 'exceptions',  action: 'kpi|exceptions',  title: String(exceptionCount),        subtitle: 'חריגות',          value: exceptionCount }
  ];
}

// ─── Supabase helpers for week/month calendar views ──────────────────────────

const HEBREW_WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * מחזיר מחרוזת ריקה עבור null / undefined / "NULL" / "NONE" / "N/A".
 * מונע מהמחרוזת הטקסטואלית "NULL" להיחשב כערך תקין.
 */
function nullStr(val) {
  if (isEmptyValue(val)) return '';
  const s = nonEmptyString(val);
  const u = s.toUpperCase();
  if (u === 'NONE' || u === 'N/A' || u === '-') return '';
  return s;
}

/**
 * Normalize a date value to YYYY-MM-DD string, or '' if invalid.
 */
function normalizeSupabaseDate(val) {
  if (isEmptyValue(val)) return '';
  const s = nonEmptyString(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : '';
}

/**
 * Build the ISO date range [startDate, endDate] (inclusive, YYYY-MM-DD) for a week
 * given weekOffset (0 = current Sun–Sat, -1 = prev week, +1 = next week).
 */
function buildWeekDateRange(weekOffset) {
  const today = new Date();
  const sunday = new Date(today);
  sunday.setDate(today.getDate() - today.getDay() + weekOffset * 7);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startDate: fmt(sunday), endDate: fmt(saturday) };
}

/** Build a RowID → row map from an array of rows. */
function buildItemsById(rows) {
  const map = {};
  for (const row of rows) {
    const id = row?.RowID;
    if (id) map[id] = row;
  }
  return map;
}

/**
 * Build an empty but valid week payload for diagnostic/error cases.
 * Always returns a usable structure so the screen renders (empty, not broken).
 */
function emptyWeekPayload(startDate, endDate, debugInfo) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startDate + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const dateKey =
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    days.push({ date: dateKey, weekday_label: HEBREW_WEEKDAY_LABELS[d.getDay()], item_ids: [] });
  }
  return { days, items_by_id: {}, week_start: startDate, week_end: endDate, _source: 'supabase', _debug: debugInfo };
}

/**
 * Build an empty but valid month payload for diagnostic/error cases.
 */
function emptyMonthPayload(monthPrefix, debugInfo) {
  const [yStr, mStr] = monthPrefix.split('-');
  const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
  const cells = [];
  for (let dayNum = 1; dayNum <= lastDay; dayNum++) {
    cells.push({ date: `${monthPrefix}-${String(dayNum).padStart(2, '0')}`, day: dayNum, item_ids: [] });
  }
  return { month: monthPrefix, cells, items_by_id: {}, _source: 'supabase', _debug: debugInfo };
}

/**
 * Read week calendar data from Supabase only.
 *
 *   Activities → any date_1..date_35 in [startDate, endDate].
 *   Archive is status-based only.
 *
 * Always returns a valid payload (may be empty). Never throws.
 */
async function readWeekFromSupabase(weekOffset) {
  const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
  const { startDate, endDate } = buildWeekDateRange(offset);
  if (!supabase) return emptyWeekPayload(startDate, endDate, { error: 'no_supabase_client' });

  try {
    const rows = (await selectActivitiesByDateRangeFromSupabase({ startDate, endDate }))
      .filter((row) => !isActivityInactive(row));
    const matchingRows = rows.filter((row) => activityHasDateInRange(row, startDate, endDate));
    const itemsById = buildItemsById(matchingRows);
    const dayMap = {};
    for (const row of matchingRows) {
      for (const dateKey of getActivityDateColumns(row)) {
        if (dateKey < startDate || dateKey > endDate) continue;
        if (!dayMap[dateKey]) dayMap[dateKey] = new Set();
        if (row.RowID) dayMap[dateKey].add(row.RowID);
      }
    }

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate + 'T00:00:00');
      d.setDate(d.getDate() + i);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({ date: dateKey, weekday_label: HEBREW_WEEKDAY_LABELS[d.getDay()], item_ids: [...(dayMap[dateKey] || new Set())] });
    }

    return { days, items_by_id: itemsById, week_start: startDate, week_end: endDate, _source: 'supabase' };
  } catch (err) {
    console.error('[supabase][week] unexpected error:', err);
    return emptyWeekPayload(startDate, endDate, { error: String(err?.message || err) });
  }
}

async function readMonthFromSupabase(ym) {
  const monthPrefix = String(ym || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(monthPrefix)) return emptyMonthPayload(monthPrefix || 'unknown', { error: 'invalid_month', ym });
  if (!supabase) return emptyMonthPayload(monthPrefix, { error: 'no_supabase_client' });

  try {
    const range = monthDateRange(monthPrefix);
    const [yStr, mStr] = monthPrefix.split('-');
    const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
    const rows = (await selectActivitiesByDateRangeFromSupabase({
      startDate: range.startDate,
      endDate: range.endDate
    })).filter((row) => !isActivityInactive(row));
    const matchingRows = rows.filter((row) => activityHasDateInMonth(row, monthPrefix));
    const itemsById = buildItemsById(matchingRows);
    const dayMap = {};
    for (const row of matchingRows) {
      for (const dateKey of getActivityDateColumns(row)) {
        if (!dateKey.startsWith(monthPrefix)) continue;
        if (!dayMap[dateKey]) dayMap[dateKey] = new Set();
        if (row.RowID) dayMap[dateKey].add(row.RowID);
      }
    }

    const cells = [];
    for (let dayNum = 1; dayNum <= lastDay; dayNum++) {
      const dateKey = `${monthPrefix}-${String(dayNum).padStart(2, '0')}`;
      cells.push({ date: dateKey, day: dayNum, item_ids: [...(dayMap[dateKey] || new Set())] });
    }

    return { month: monthPrefix, cells, items_by_id: itemsById, _source: 'supabase' };
  } catch (err) {
    console.error('[supabase][month] unexpected error:', err);
    return emptyMonthPayload(monthPrefix, { error: String(err?.message || err) });
  }
}

/**
 * Queries Supabase to build a dashboard payload for the given month (YYYY-MM).
 *
 * Reads the dashboard source-of-truth table populated by the trusted backend/sync job.
 * Supabase errors, missing rows, invalid months, and payload debug errors return null so
 * callers never treat fabricated KPI=0 values as real dashboard data.
 */
function warnDashboardSupabasePathFailed(reason, extra = {}) {
  try {
    console.warn('[supabase][dashboard] path failed', { reason: String(reason || 'unknown'), ...extra });
  } catch { /* ignore */ }
}

async function dashboardReadModelFromSupabase(month) {
  if (!supabase) return null;
  try {
    const monthPrefix = String(month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthPrefix)) return null;
    const range = monthDateRange(monthPrefix);
    // Fetch all rows for the date range (open + closed) — no status filter here
    const allRangeRows = await selectActivitiesByDateRangeFromSupabase({
      startDate: range.startDate,
      endDate: range.endDate,
      includeEndDate: true
    });
    // Open-only rows (not closed) — used for summary, instructor/manager stats, exceptions
    const openRows = allRangeRows.filter((row) => !isActivityInactive(row));
    // Open-only rows that have a date in this month — for summary data
    const monthRows = openRows.filter((row) => activityHasDateInMonth(row, monthPrefix));
    // All rows (open + closed) in this month — for KPI type counts
    const allMonthRows = allRangeRows.filter((row) => activityHasDateInMonth(row, monthPrefix));
    // Course endings: courses whose end_date is this month (open + closed = completed courses)
    const endingRows = allRangeRows.filter((row) => rowActivityType(row) === 'course' && String(row?.end_date || '').slice(0, 7) === monthPrefix);

    // KPI type counts — includes all activities (open + closed) for the full monthly picture
    const totalTypeCounts = {};
    for (const row of allMonthRows) {
      const activityType = rowActivityType(row);
      if (activityType) totalTypeCounts[activityType] = (totalTypeCounts[activityType] || 0) + 1;
    }
    const summerKpiRows = (await selectActivitiesFromSupabase('*'))
      .filter((row) => !isActivityInactive(row))
      .filter(isSummerActivity);
    totalTypeCounts.summer = new Set(summerKpiRows.map((row, index) => String(row?.RowID || row?.row_id || '').trim() || `summer:${index}`)).size;

    const exceptionSummary = await readExceptionsFromSupabase({ month: monthPrefix });
    const exceptionError = exceptionSummary?.error || exceptionSummary?._debug?.error;
    if (!exceptionSummary || exceptionError) {
      warnDashboardSupabasePathFailed(exceptionError || 'exceptions_model_failed', { month: monthPrefix });
      throw new Error('dashboard_exceptions_model_failed');
    }
    const exceptionCounts = exceptionSummary.counts || {};
    const exceptionsByDistrict = exceptionSummary.byDistrict || exceptionSummary.byManager || {};

    // Active (open-only) summary data
    const instructorIds = new Set();
    const instructorNames = new Set();
    const activeTypeCounts = {};
    const byManagerMap = new Map();

    function managerStats(manager) {
      const key = String(manager || '').trim() || 'ללא מחוז';
      if (!byManagerMap.has(key)) {
        byManagerMap.set(key, {
          activity_manager: key,
          total_long: 0,
          total_short: 0,
          total_activities: 0,
          num_instructors: 0,
          _instructors: new Set(),
          exceptions: 0,
          course_endings: 0
        });
      }
      return byManagerMap.get(key);
    }

    for (const row of monthRows) {
      const activityType = rowActivityType(row);
      if (activityType) activeTypeCounts[activityType] = (activeTypeCounts[activityType] || 0) + 1;
      if (isSummerActivity(row)) activeTypeCounts.summer = (activeTypeCounts.summer || 0) + 1;
      const emp1        = nullStr(row?.emp_id);
      const emp2        = nullStr(row?.emp_id_2);
      const instructor1 = nullStr(row?.instructor_name);
      const instructor2 = nullStr(row?.instructor_name_2);
      if (emp1) instructorIds.add(emp1);
      if (emp2) instructorIds.add(emp2);
      if (instructor1 || emp1) instructorNames.add(instructor1 || emp1);
      if (instructor2 || emp2) instructorNames.add(instructor2 || emp2);

      const stats = managerStats(row?.district);
      stats.total_activities += 1;
      if (isProgramActivity(row)) stats.total_long += 1;
      if (isOneDayActivity(row)) stats.total_short += 1;
      if (emp1) stats._instructors.add(emp1);
      if (emp2) stats._instructors.add(emp2);

    }

    for (const row of endingRows) {
      managerStats(row?.district).course_endings += 1;
    }
    for (const [district, count] of Object.entries(exceptionsByDistrict)) {
      managerStats(district).exceptions = Number(count || 0);
    }

    const by_activity_manager = [...byManagerMap.values()].map((stats) => {
      stats.num_instructors = stats._instructors.size;
      delete stats._instructors;
      return stats;
    });
    const exceptionsCount = Number(exceptionSummary.uniqueExceptionActivities || exceptionSummary.totalExceptionRows || 0);
    const totals = {
      total_short_activities: allMonthRows.filter(isOneDayActivity).length,
      total_long_activities: allMonthRows.filter(isProgramActivity).length,
      total_activities: allMonthRows.length,
      total_instructors: instructorIds.size,
      total_course_endings_current_month: endingRows.length,
      exceptions_count: exceptionsCount
    };
    const summary = {
      active_type_counts: activeTypeCounts,
      active_instructors: [...instructorNames].sort((a, b) => a.localeCompare(b, 'he')),
      active_instructors_count: instructorIds.size,
      ending_courses_current_month: endingRows.length,
      missing_instructor_count: Number(exceptionCounts.missing_instructor || 0),
      missing_district_count: Number(exceptionCounts.missing_district || 0),
      missing_start_date_count: Number(exceptionCounts.missing_start_date || 0),
      missing_end_date_count: Number(exceptionCounts.missing_end_date || 0),
      missing_date_count: Number(exceptionCounts.missing_start_date || 0),
      end_date_after_cutoff_count: Number(exceptionCounts.end_date_after_cutoff || 0),
      end_date_passed_count: Number(exceptionCounts.end_date_passed || 0),
      operational_gaps_count: exceptionsCount,
      operational_gaps_unique_count: Number(exceptionSummary.uniqueExceptionActivities || exceptionSummary.totalExceptionRows || 0),
      operationalTotal: exceptionsCount,
      exceptions_count: exceptionsCount,
      totalExceptionRows: Number(exceptionSummary.totalExceptionRows || 0),
      total_exception_rows: Number(exceptionSummary.totalExceptionRows || 0),
      totalExceptionInstances: exceptionsCount,
      counts: exceptionCounts
    };
    // KPI cards use totalTypeCounts (all month rows including closed)
    const kpi_cards = buildDashboardKpiCardsFromSupabase(totals, totalTypeCounts, exceptionsCount, instructorIds.size, endingRows.length);
    const noData = allMonthRows.length === 0;
    return {
      month: monthPrefix,
      requested_month: month,
      totals,
      summary,
      by_activity_manager,
      activeTypeCounts,
      totalTypeCounts,
      exceptionCount: exceptionsCount,
      uniqueInstructorCount: instructorIds.size,
      courseEndings: endingRows.length,
      kpi_cards,
      cards: kpi_cards,
      rows: monthRows,
      no_data_message: noData ? 'אין נתונים לחודש זה' : '',
      _source: 'supabase'
    };
  } catch (err) {
    console.error('[supabase][dashboard] unexpected error:', err);
    return null;
  }
}

async function readEndDatesFromSupabase() {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [] }, 'no_supabase_client');
  try {
    const rows = (await selectActivitiesFromSupabase('*'))
      .filter((row) => !isActivityInactive(row))
      .map((row) => ({ ...row, meeting_dates: getActivityDateColumns(row), date_cols: getActivityDateColumns(row) }));
    return { rows, _source: 'supabase' };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [] }, error);
  }
}


function activityOverlapsMonthForExceptions(row, month) {
  void row;
  void month;
  // Exceptions are intentionally computed from the current activity record, not
  // from the selected dashboard month. This keeps end-date-passed and data-sync
  // anomalies visible until they are fixed or the activity is closed/deleted.
  return true;
}

let lateEndDateThresholdWarned = false;

function warnLateEndDateThreshold(message, value = '') {
  if (lateEndDateThresholdWarned) return;
  lateEndDateThresholdWarned = true;
  console.warn('[exceptions] late_end_date_threshold disabled:', message, value || '');
}

function settingValueFromRows(settingsRows = [], key) {
  const row = (Array.isArray(settingsRows) ? settingsRows : []).find((item) => String(item?.key || '').trim() === key);
  return String(row?.value || '').trim();
}

function rowExceptionTypesFromActivity(row, opts = {}) {
  const types = [];
  const knownIds    = opts.knownInstructorIds; // Set<string> | undefined
  const emp1        = nullStr(row?.emp_id);
  const emp2        = nullStr(row?.emp_id_2);
  const instructorName = resolveActivityInstructorName(row);
  const secondaryInstructorName = resolveActivityInstructorName(row, { secondary: true });
  const start       = firstNormalizedDate(row?.start_date, row?.date_start);
  const end         = firstNormalizedDate(row?.end_date, row?.date_end);
  const rawLateEndDateThreshold = String(opts.lateEndDateThreshold || '').trim();
  const lateEndDateThreshold = rawLateEndDateThreshold ? firstNormalizedDate(rawLateEndDateThreshold) : '';
  const todayLocalIso = todayLocalIsoDate();
  const inactive = isActivityInactive(row);
  const active = isOperationallyActive(row);

  // Instructor check uses the same normalized name source used by the UI.
  // A valid displayed instructor name is sufficient even when guideId/emp_id is
  // missing or not present in the contacts table. Technical ids are a fallback.
  const isValidId = (id) => !!id && (!knownIds || knownIds.has(id));
  const hasValidInstructor = !!instructorName || !!secondaryInstructorName || isValidId(emp1) || isValidId(emp2);
  if (!inactive && !hasValidInstructor) types.push('missing_instructor');
  if (!inactive && !nullStr(row?.school)) types.push('missing_school');
  if (!inactive && !nullStr(row?.authority)) types.push('missing_authority');
  if (!inactive && districtDisplayKey(row) === 'ללא מחוז / לא משויך') types.push('missing_district');

  // Missing start date is based only on start_date; meeting dates do not replace
  // the dedicated start date field for this exception.
  if (!inactive && !start) types.push('missing_start_date');
  if (!inactive && !end) types.push('missing_end_date');
  if (!inactive && start && end && end < start) types.push('invalid_date_range');

  // Ended but still active: real end_date before today. It is not based on
  // month-end or on meeting dates.
  if (isOpenStatus(row) && end && end < todayLocalIso) {
    types.push('end_date_passed');
  }
  if (active && end && lateEndDateThreshold && end > lateEndDateThreshold) {
    types.push('end_date_after_cutoff');
  }
  if (rawLateEndDateThreshold && !lateEndDateThreshold) {
    warnLateEndDateThreshold('invalid date value', rawLateEndDateThreshold);
  }

  const nextMeetingDate = nextMeetingDateFromActivity(row, todayLocalIso);
  const latestMeetingDate = latestMeetingDateFromActivity(row);
  row._next_meeting_date = nextMeetingDate || '';
  if (active && !nextMeetingDate) {
    if (latestMeetingDate && latestMeetingDate < todayLocalIso) {
      types.push('next_meeting_passed');
    } else {
      types.push('missing_next_meeting');
    }
  }

  // Data synchronization gap: end_date must exactly match the latest meeting date.
  // This replaces the old late_end_date / meeting-after-end labels.
  const calculatedEndDate = latestMeetingDate;
  row._calculated_end_date = calculatedEndDate || '';
  if (end && calculatedEndDate && end !== calculatedEndDate) {
    types.push('end_date_out_of_sync');
  }
  row._late_end_date_threshold = lateEndDateThreshold || '';
  row._late_end_date_hits = [];
  return types;
}

function getActivityExceptions(activityRows = [], month = '', opts = {}) {
  const knownInstructorIds = opts.knownInstructorIds; // Set<string> | undefined
  const rows = [];
  const instances = [];
  for (const row of activityRows) {
    if (isActivityInactive(row)) continue;
    if (!activityOverlapsMonthForExceptions(row, month)) continue;
    const types = normalizedExceptionTypes({
      ...row,
      exception_types: rowExceptionTypesFromActivity(row, {
        knownInstructorIds,
        lateEndDateThreshold: opts.lateEndDateThreshold
      })
    });
    if (!types.length) continue;
    const uniqueTypes = [...new Set(types)];
    rows.push({
      ...row,
      exception_type: uniqueTypes[0],
      exception_types: uniqueTypes,
      exception_count: uniqueTypes.length,
      has_multiple_exceptions: uniqueTypes.length > 1 ? 'yes' : 'no'
    });
    for (const type of uniqueTypes) {
      instances.push({
        ...row,
        exception_type: type,
        exception_types: uniqueTypes,
        exception_count: uniqueTypes.length,
        has_multiple_exceptions: uniqueTypes.length > 1 ? 'yes' : 'no',
        exception_instance_key: `${String(row?.RowID || row?.row_id || '').trim() || rows.length}:${type}`
      });
    }
  }
  return { rows, instances };
}

function buildExceptionsModelFromRows(activityRows = [], month = '', opts = {}) {
  const includeRows = opts.include_rows !== false;
  const { rows: allRows, instances } = getActivityExceptions(activityRows, month, opts);
  const rows = includeRows ? allRows : [];
  const counts = Object.fromEntries(EXCEPTION_TYPE_ORDER.map((type) => [type, 0]));
  const byDistrict = {};
  const uniqueActivityIds = new Set();
  for (const row of allRows) {
    const district = districtDisplayKey(row);
    byDistrict[district] = (byDistrict[district] || 0) + 1;
    for (const type of row.exception_types || []) counts[type] = (counts[type] || 0) + 1;
    const activityKey = String(row?.RowID || row?.row_id || '').trim() || [row?.activity_name, row?.school, row?.authority].map((v) => String(v || '').trim()).join('|');
    if (activityKey) uniqueActivityIds.add(activityKey);
  }
  const totalExceptionRows = uniqueActivityIds.size;
  const totalExceptionInstances = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  return {
    rows,
    exceptionInstances: includeRows ? instances : [],
    totalExceptionRows,
    totalExceptionInstances,
    uniqueExceptionActivities: totalExceptionRows,
    operationalUniqueCount: totalExceptionRows,
    counts,
    byManager: byDistrict,
    byDistrict
  };
}

function buildExceptionsFromRows(activityRows = [], month = '') {
  return buildExceptionsModelFromRows(activityRows, month, { include_rows: true }).rows;
}

async function readExceptionsFromSupabase(params = {}) {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [], totalExceptionRows: 0, totalExceptionInstances: 0 }, 'no_supabase_client');
  const candidate = String(params?.month || params?.ym || '').trim();
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
  try {
    const [activitiesResult, instrListResult, settingsRows] = await Promise.all([
      supabase.from('activities').select('*'),
      supabase.from('contacts_instructors').select('emp_id'),
      readSettingsRowsFromSupabase().catch((error) => {
        warnLateEndDateThreshold('settings read failed', error?.message || error);
        return [];
      })
    ]);
    if (activitiesResult.error) throw new Error(activitiesResult.error.message || 'activities_read_failed');
    const lateEndDateThreshold = firstNormalizedDate(settingValueFromRows(settingsRows, 'late_end_date_threshold'));
    if (!lateEndDateThreshold) {
      warnLateEndDateThreshold('missing or empty settings value');
    }

    const knownInstructorIds = new Set(
      (Array.isArray(instrListResult.data) ? instrListResult.data : [])
        .map((r) => nullStr(r?.emp_id))
        .filter(Boolean)
    );
    const allRows = (Array.isArray(activitiesResult.data) ? activitiesResult.data : []).map(normalizeActivityRow);
    const exceptionSummary = buildExceptionsModelFromRows(allRows, month, {
      include_rows: true,
      knownInstructorIds: knownInstructorIds.size > 0 ? knownInstructorIds : undefined,
      lateEndDateThreshold
    });
    const undatedRows = allRows
      .filter((row) => !isActivityInactive(row))
      .filter((row) => !hasAnyActivityDate(row));
    return {
      month,
      ...exceptionSummary,
      undatedRows,
      undatedCount: undatedRows.length,
      _source: 'supabase'
    };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0, totalExceptionInstances: 0, undatedRows: [], undatedCount: 0 }, error);
  }
}

/** Syncs contact rows into Supabase contact tables. */
async function syncContactToSupabase(kind, row, origIdentity) {
  if (!supabase || !row || typeof row !== 'object') return;
  try {
    if (kind === 'instructor') {
      if (!row.emp_id) return;
      const { _row_index: _ri, _supabase_orig: _so, ...cleanRow } = row;
      const { error } = await supabase
        .from('contacts_instructors')
        .upsert(cleanRow, { onConflict: 'emp_id' });
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] contacts_instructors upsert failed:', error);
      }
    } else if (kind === 'school') {
      if (!row.authority || !row.school || !row.contact_name) return;
      const { _row_index: _ri, _supabase_orig: _so, role: formRole, ...cleanRow } = row;
      if (formRole !== undefined && cleanRow.contact_role === undefined) {
        cleanRow.contact_role = formRole;
      }

      const orig = origIdentity && typeof origIdentity === 'object' ? origIdentity : null;
      const keyChanged = orig && (
        orig.authority !== row.authority ||
        orig.school !== row.school ||
        orig.contact_name !== row.contact_name
      );

      if (keyChanged) {
        const { error: delErr } = await supabase
          .from('contacts_schools')
          .delete()
          .eq('authority', orig.authority)
          .eq('school', orig.school)
          .eq('contact_name', orig.contact_name);
        if (delErr) {
          // eslint-disable-next-line no-console
          console.error('[supabase] contacts_schools delete (key-change) failed:', delErr);
        }
        const { error: insErr } = await supabase
          .from('contacts_schools')
          .insert(cleanRow);
        if (insErr) {
          // eslint-disable-next-line no-console
          console.error('[supabase] contacts_schools insert (after key-change) failed:', insErr);
        }
      } else {
        const { error } = await supabase
          .from('contacts_schools')
          .upsert(cleanRow, { onConflict: 'authority,school,contact_name' });
        if (error) {
          // eslint-disable-next-line no-console
          console.error('[supabase] contacts_schools upsert failed:', error);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected contact sync error:', err);
  }
}

function invalidateScreenDataByAction(action) {
  const targetedMutations = {
    saveActivity: ['activities:', 'activityDetail:', 'activityDates:', 'archive', 'archiveDetail:', 'archiveDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    addActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    deleteActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'archive', 'end-dates', 'exceptions:'],
    submitEditRequest: ['activities:', 'edit-requests'],
    submitCreateActivityRequest: ['activities:', 'edit-requests'],
    reviewEditRequest: ['edit-requests', 'activities:', 'activityDetail:', 'dashboard:', 'exceptions:', 'activityDates:', 'archive', 'archiveDetail:', 'archiveDates:', 'week:', 'month:'],
    addUser: ['permissions', 'dashboard:'],
    deactivateUser: ['permissions', 'dashboard:'],
    reactivateUser: ['permissions', 'dashboard:'],
    deleteUser: ['permissions', 'dashboard:'],
    savePrivateNote: ['activities:', 'operations:'],
    savePermission: ['permissions'],
    addContact: ['contacts', 'instructor-contacts'],
    saveContact: ['contacts', 'instructor-contacts'],
    saveSheetMapping: ['adminSettings', 'listSheets', 'dashboard:', 'activities:', 'week:', 'month:'],
    saveClientSetting: ['adminSettings', 'dashboard:', 'activities:', 'week:', 'month:'],
    addProposalAgreement: ['proposals-agreements'],
    updateProposalAgreement: ['proposals-agreements'],
    updateProposalAgreementStatus: ['proposals-agreements'],
    deleteProposalAgreement: ['proposals-agreements'],
    saveProposalAgreementItems: ['proposals-agreements']
  };
  const prefixes = targetedMutations[action];
  if (!prefixes || !prefixes.length) return;
  if (prefixes.includes('*')) {
    clearScreenDataCache();
    return;
  }
  const deletedKeys = [];
  Object.keys(state.screenDataCache || {}).forEach((key) => {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      delete state.screenDataCache[key];
      deletedKeys.push(key);
    }
  });
  deletePersistedCacheByPrefixes(prefixes);
  try {
    console.info('[cache-invalidate]', { action, prefixes, deletedKeys });
  } catch { /* ignore */ }
}


function isPerfDebugEnabled() {
  try {
    if (typeof window !== 'undefined' && window.__DEBUG_PERF__ === true) return true;
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem('ds_debug_perf') === '1') return true;
      if (localStorage.getItem('debug_perf') === '1') return true;
    }
    if (typeof window !== 'undefined' && window.location?.search) {
      const q = new URLSearchParams(window.location.search).get('debug_perf');
      if (q === '1' || (q && q.toLowerCase() === 'true')) return true;
    }
  } catch { /* ignore */ }
  return false;
}

function getPerfStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__dsPerf) {
    window.__dsPerf = { requests: [], renders: [], screens: {} };
    window.__resetDsPerf = () => {
      window.__dsPerf = { requests: [], renders: [], screens: {} };
    };
  }
  return window.__dsPerf;
}

function pushPerfRequest(entry) {
  const store = getPerfStore();
  if (!store) return;
  store.requests.push(entry);
  if (store.requests.length > PERF_MAX_REQUESTS) store.requests.splice(0, store.requests.length - PERF_MAX_REQUESTS);
  const stats = store.screens[entry.action] || { count: 0, total_ms: 0, max_ms: 0 };
  stats.count += 1;
  stats.total_ms += entry.duration_ms || 0;
  stats.max_ms = Math.max(stats.max_ms, entry.duration_ms || 0);
  store.screens[entry.action] = stats;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeData(data) {
  if (Array.isArray(data)) return data.map(normalizeData);
  if (!data || typeof data !== 'object') return data;

  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => [key, normalizeData(value)])
  );

  normalized.StartTime = normalized.StartTime ?? normalized.start_time ?? normalized.startTime ?? '';
  normalized.EndTime = normalized.EndTime ?? normalized.end_time ?? normalized.endTime ?? '';
  normalized.End = normalized.End ?? normalized.end_date ?? normalized.endDate ?? normalized.DateEnd ?? '';
  normalized.EmployeeID = normalized.EmployeeID ?? normalized.emp_id ?? normalized.employee_id ?? '';
  normalized.Employee = normalized.Employee ?? normalized.instructor_name ?? normalized.employee_name ?? '';
  normalized.Program = normalized.Program ?? normalized.activity_name ?? '';
  normalized.ActivityNo = normalized.ActivityNo ?? normalized.activity_no ?? '';

  return normalized;
}


const PROPOSALS_AGREEMENTS_ALLOWED_ROLES = new Set(['domain_manager', 'operation_manager', 'admin', 'business_development_manager']);
const PROPOSALS_AGREEMENTS_MANAGE_ROLES = new Set(['domain_manager', 'operation_manager', 'admin']);
const PROPOSALS_AGREEMENTS_COLUMNS = 'id,client_authority,school_framework,document_type,activity_type_group,proposal_date,activity_names,contact_name,contact_role,phone,email,notes,status,approval_note,total_amount,custom_document_sections,contact_school_id,created_at,updated_at';
const PA_ACTIVITY_NAMES_MARKER = '\u001ePA_ACTIVITY_NAMES:';

function parseActivityNamesFromNotes(notes) {
  const raw = String(notes ?? '');
  const idx = raw.indexOf(PA_ACTIVITY_NAMES_MARKER);
  if (idx < 0) {
    return { notes: raw.trim(), activity_names: [] };
  }
  const cleanNotes = raw.slice(0, idx).trimEnd();
  const jsonPart = raw.slice(idx + PA_ACTIVITY_NAMES_MARKER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    const activity_names = Array.isArray(parsed)
      ? parsed.map(cleanProposalAgreementText).filter(Boolean)
      : [];
    return { notes: cleanNotes, activity_names };
  } catch {
    return { notes: cleanNotes, activity_names: [] };
  }
}

function notesWithActivityNames(notes, activity_names) {
  const { notes: cleanNotes } = parseActivityNamesFromNotes(notes);
  const names = Array.isArray(activity_names)
    ? activity_names.map(cleanProposalAgreementText).filter(Boolean)
    : [];
  if (!names.length) return cleanNotes;
  return `${cleanNotes}${cleanNotes ? '\n' : ''}${PA_ACTIVITY_NAMES_MARKER}${JSON.stringify(names)}`;
}

function canUseProposalsAgreementsApi() {
  const role = String(state?.user?.display_role || state?.user?.role || '').trim();
  return PROPOSALS_AGREEMENTS_ALLOWED_ROLES.has(role)
    || permissionFlagYes(state?.user?.view_proposals_agreements)
    || permissionFlagYes(state?.user?.manage_proposals_agreements);
}

function canManageProposalsAgreementsApi() {
  const role = String(state?.user?.display_role || state?.user?.role || '').trim();
  return PROPOSALS_AGREEMENTS_MANAGE_ROLES.has(role)
    || permissionFlagYes(state?.user?.manage_proposals_agreements);
}

function assertCanUseProposalsAgreementsApi() {
  if (!canUseProposalsAgreementsApi()) throw new Error('proposals_agreements_forbidden');
}

function assertCanManageProposalsAgreementsApi() {
  if (!canManageProposalsAgreementsApi()) throw new Error('proposals_agreements_forbidden');
}

function cleanProposalAgreementText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalizeProposalAgreementMultilineText(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeProposalContactText(value) {
  return cleanProposalAgreementText(value)
    .toLowerCase()
    .replace(/[ךםןףץ]/g, (ch) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' }[ch] || ch))
    .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
    .trim();
}

function normalizeProposalContactPhone(value) {
  let digits = cleanProposalAgreementText(value).replace(/\D+/g, '');
  if (digits.startsWith('972') && digits.length >= 11) digits = `0${digits.slice(3)}`;
  return digits;
}

const PA_STATUS_LABELS = {
  draft:                'טיוטה',
  pending_approval:     'ממתין לאישור',
  returned_for_changes: 'הוחזר לתיקון',
  approved:             'מאושר',
  cancelled:            'בוטל'
};

function buildProposalAgreementSearchText(row = {}) {
  const activityNames = Array.isArray(row.activity_names) ? row.activity_names.join(' ') : '';
  const statusLabel = PA_STATUS_LABELS[cleanProposalAgreementText(row.status)] || cleanProposalAgreementText(row.status);
  return [
    row.id,
    row.client_authority,
    row.school_framework,
    row.document_type,
    row.activity_type_group,
    activityNames,
    row.notes,
    row.contact_name,
    row.contact_role,
    row.phone,
    row.email,
    statusLabel
  ].map(cleanProposalAgreementText).filter(Boolean).join(' ').toLowerCase();
}

function normalizeProposalAgreementActivityNames(value) {
  if (Array.isArray(value)) return value.map(cleanProposalAgreementText).filter(Boolean);
  return cleanProposalAgreementText(value).split(',').map(cleanProposalAgreementText).filter(Boolean);
}

function normalizeProposalAgreementRow(row = {}) {
  const parsedNotes = parseActivityNamesFromNotes(row.notes);
  const PA_VALID_STATUSES = new Set(['draft', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled']);
  const rawStatus = cleanProposalAgreementText(row.status);
  const normalized = {
    id:                  cleanProposalAgreementText(row.id),
    client_authority:    cleanProposalAgreementText(row.client_authority),
    school_framework:    cleanProposalAgreementText(row.school_framework),
    document_type:       cleanProposalAgreementText(row.document_type),
    activity_type_group: cleanProposalAgreementText(row.activity_type_group),
    proposal_date:       cleanProposalAgreementText(row.proposal_date),
    activity_names:      normalizeProposalAgreementActivityNames(
      Array.isArray(row.activity_names) && row.activity_names.length
        ? row.activity_names
        : parsedNotes.activity_names
    ),
    contact_name:        cleanProposalAgreementText(row.contact_name),
    contact_role:        cleanProposalAgreementText(row.contact_role),
    phone:               cleanProposalAgreementText(row.phone),
    email:               cleanProposalAgreementText(row.email),
    notes:               parsedNotes.notes,
    status:              PA_VALID_STATUSES.has(rawStatus) ? rawStatus : 'draft',
    approval_note:       cleanProposalAgreementText(row.approval_note),
    total_amount:        row.total_amount != null ? Number(row.total_amount) || null : null,
    custom_document_sections: Array.isArray(row.custom_document_sections)
      ? row.custom_document_sections.map((section) => ({
        ...section,
        section_body: normalizeProposalAgreementMultilineText(section?.section_body)
      }))
      : [],
    created_at:          cleanProposalAgreementText(row.created_at),
    updated_at:          cleanProposalAgreementText(row.updated_at)
  };
  normalized._searchText = buildProposalAgreementSearchText(normalized);
  return normalized;
}

const PA_VALID_STATUSES_SET = new Set(['draft', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled']);

const PROPOSAL_GROUP_CANONICAL_MAP = {
  'קיץ תשפ״ו':                       'פעילויות קיץ',
  'שנת הלימודים תשפ״ז':              'שנה הבאה',
  'תוכניות תשפ״ז':                   'שנה הבאה',
  'קיץ תשפ״ו ושנת הלימודים תשפ״ז': 'הצעה משולבת',
  'קיץ תשפ״ו + תשפ״ז':              'הצעה משולבת'
};

function sanitizeProposalAgreementPayload(payload = {}) {
  const activity_names = normalizeProposalAgreementActivityNames(payload.activity_names);
  const rawStatus = cleanProposalAgreementText(payload.status);
  const rawGroup = cleanProposalAgreementText(payload.activity_type_group);
  const clientAuthority = cleanProposalAgreementText(payload.client_authority);
  const schoolFramework = cleanProposalAgreementText(payload.school_framework) || clientAuthority;
  const row = {
    client_authority:    clientAuthority,
    school_framework:    schoolFramework,
    document_type:       cleanProposalAgreementText(payload.document_type) || 'הצעת מחיר',
    activity_type_group: PROPOSAL_GROUP_CANONICAL_MAP[rawGroup] || rawGroup,
    proposal_date:       cleanProposalAgreementText(payload.proposal_date) || null,
    activity_names:      activity_names,
    contact_name:        cleanProposalAgreementText(payload.contact_name),
    contact_role:        cleanProposalAgreementText(payload.contact_role),
    phone:               cleanProposalAgreementText(payload.phone),
    email:               cleanProposalAgreementText(payload.email),
    notes:               parseActivityNamesFromNotes(payload.notes).notes,
    status:              PA_VALID_STATUSES_SET.has(rawStatus) ? rawStatus : 'draft',
    approval_note:       cleanProposalAgreementText(payload.approval_note),
    total_amount:        payload.total_amount != null ? Number(payload.total_amount) || null : null,
    custom_document_sections: Array.isArray(payload.custom_document_sections) ? payload.custom_document_sections : []
  };
  const missing = ['client_authority', 'document_type', 'activity_type_group'].filter((key) => !row[key]);
  if (missing.length) throw new Error(`missing_required_fields:${missing.join(',')}`);
  return row;
}


function proposalContactMatches(existing = {}, next = {}, original = {}) {
  const existingId = cleanProposalAgreementText(existing.id);
  if (cleanProposalAgreementText(original.id) && existingId === cleanProposalAgreementText(original.id)) return true;

  const originalAuthority = normalizeProposalContactText(original.authority);
  const originalSchool = normalizeProposalContactText(original.school);
  const originalName = normalizeProposalContactText(original.contact_name);
  if (originalName && originalAuthority === normalizeProposalContactText(existing.authority) &&
      originalSchool === normalizeProposalContactText(existing.school) &&
      originalName === normalizeProposalContactText(existing.contact_name)) {
    return true;
  }

  const existingEmail = normalizeProposalContactText(existing.email);
  const nextEmail = normalizeProposalContactText(next.email);
  if (existingEmail && nextEmail && existingEmail === nextEmail) return true;

  const existingPhone = normalizeProposalContactPhone(existing.phone || existing.mobile);
  const nextPhone = normalizeProposalContactPhone(next.phone);
  if (existingPhone && nextPhone && existingPhone === nextPhone) return true;

  const existingName = normalizeProposalContactText(existing.contact_name);
  const nextName = normalizeProposalContactText(next.contact_name);
  if (!existingName || !nextName || existingName !== nextName) return false;

  const existingSchool = normalizeProposalContactText(existing.school);
  const nextSchool = normalizeProposalContactText(next.school);
  if (existingSchool && nextSchool && existingSchool === nextSchool) return true;

  const existingAuthority = normalizeProposalContactText(existing.authority);
  const nextAuthority = normalizeProposalContactText(next.authority);
  return Boolean(existingAuthority && nextAuthority && existingAuthority === nextAuthority);
}

async function ensureContactSchoolFromProposal(payload = {}) {
  const orig = (payload?._contact_original && typeof payload._contact_original === 'object')
    ? payload._contact_original
    : {};
  const authority = cleanProposalAgreementText(payload.client_authority);
  const school = cleanProposalAgreementText(payload.school_framework);
  if (!authority) return null;
  const clientType = cleanProposalAgreementText(orig.client_type) || (school && school !== authority ? 'school' : 'authority');
  const clientName = cleanProposalAgreementText(orig.client_name) || (clientType === 'school' ? school : authority);
  const { data: contactSchoolId, error } = await supabase.rpc(
    'ensure_contact_school_from_proposal',
    {
      p_client_type:   clientType,
      p_client_name:   clientName || authority,
      p_authority:     authority,
      p_school:        school || null,
      p_contact_name:  cleanProposalAgreementText(payload.contact_name) || null,
      p_contact_role:  cleanProposalAgreementText(payload.contact_role) || null,
      p_phone:         cleanProposalAgreementText(payload.phone) || null,
      p_mobile:        cleanProposalAgreementText(orig.mobile) || null,
      p_email:         cleanProposalAgreementText(payload.email) || null,
      p_address:       null,
      p_notes:         cleanProposalAgreementText(payload.notes) || null
    }
  );
  if (error) throw new Error(error.message || 'ensure_contact_school_failed');
  return contactSchoolId ?? null;
}


function isProposalTestHoursItem(item = {}) {
  const identity = [item.item_name, item.item_type, item.activity_name, item.description]
    .map((value) => cleanProposalAgreementText(value))
    .join(' ');
  return /(?:שעות\s*)?בדיק(?:ה|ות)?/i.test(identity);
}

async function readProposalActivityNamesFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('lists')
      .select('activity_name,label_he,label')
      .eq('category', 'activity_names')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (!error && Array.isArray(data)) {
      return Array.from(new Set(data.map((row) => cleanProposalAgreementText(row?.activity_name || row?.label_he || row?.label)).filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'he'));
    }
  } catch {
    // fallback below
  }
  const pricingRows = await readProposalActivityPricingFromSupabase();
  return Array.from(new Set(
    pricingRows
      .map((row) => cleanProposalAgreementText(row?.activity_name))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b, 'he'));
}

async function readProposalActivityPricingFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('proposal_activity_pricing')
      .select('activity_no,activity_name,proposal_group,item_type,catalog_group,gefen_number,hours_count,meetings_count,unit_duration,unit_price,hourly_price,description_for_proposal,sort_order,pricing_key,parent_pricing_key,proposal_display_mode,is_bundle_parent')
      .eq('is_active_for_proposals', true)
      .order('sort_order', { ascending: true });
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((row) => ({
      activity_no:             cleanProposalAgreementText(row?.activity_no),
      activity_name:           cleanProposalAgreementText(row?.activity_name),
      proposal_group:          cleanProposalAgreementText(row?.proposal_group),
      item_type:               cleanProposalAgreementText(row?.item_type),
      catalog_group:           cleanProposalAgreementText(row?.catalog_group),
      gefen_number:            cleanProposalAgreementText(row?.gefen_number),
      hours_count:             row?.hours_count != null ? Number(row.hours_count) || null : null,
      meetings_count:          row?.meetings_count != null ? Number(row.meetings_count) || null : null,
      unit_duration:           cleanProposalAgreementText(row?.unit_duration),
      unit_price:              row?.unit_price != null ? Number(row.unit_price) || null : null,
      hourly_price:            row?.hourly_price != null ? Number(row.hourly_price) : null,
      description_for_proposal: cleanProposalAgreementText(row?.description_for_proposal),
      sort_order:              Number(row?.sort_order) || 0,
      pricing_key:             cleanProposalAgreementText(row?.pricing_key),
      parent_pricing_key:      cleanProposalAgreementText(row?.parent_pricing_key),
      proposal_display_mode:   cleanProposalAgreementText(row?.proposal_display_mode) || 'single',
      is_bundle_parent:        Boolean(row?.is_bundle_parent)
    }));
  } catch {
    return [];
  }
}

async function readProposalTemplateSectionsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('proposal_template_sections')
      .select('template_key,template_name,activity_type_group,section_key,section_title,section_body,sort_order')
      .eq('is_active', true)
      .order('template_key', { ascending: true })
      .order('sort_order', { ascending: true });
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((row) => ({
      template_key: cleanProposalAgreementText(row?.template_key),
      template_name: cleanProposalAgreementText(row?.template_name),
      activity_type_group: cleanProposalAgreementText(row?.activity_type_group),
      section_key: cleanProposalAgreementText(row?.section_key),
      section_title: cleanProposalAgreementText(row?.section_title),
      section_body: normalizeProposalAgreementMultilineText(row?.section_body),
      sort_order: Number(row?.sort_order) || 0
    }));
  } catch {
    return [];
  }
}

async function readContactsSchoolsForProposals() {
  try {
    const { data, error } = await supabase
      .from('contacts_schools')
      .select('id,authority,school,contact_name,contact_role,phone,email,mobile')
      .order('authority', { ascending: true });
    if (error) return [];
    return (Array.isArray(data) ? data : []).map((c) => ({
      id:           cleanProposalAgreementText(c.id),
      authority:    cleanProposalAgreementText(c.authority),
      school:       cleanProposalAgreementText(c.school),
      contact_name: cleanProposalAgreementText(c.contact_name),
      contact_role: cleanProposalAgreementText(c.contact_role),
      phone:        cleanProposalAgreementText(c.phone || c.mobile || ''),
      email:        cleanProposalAgreementText(c.email || '')
    })).filter((c) => c.authority);
  } catch {
    return [];
  }
}

async function readProposalsAgreementsFromSupabase() {
  assertCanUseProposalsAgreementsApi();
  const [paResult, contactOptions, proposalActivityPricing, proposalTemplateSections] = await Promise.all([
    supabase
      .from('proposals_agreements')
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .order('client_authority', { ascending: true })
      .order('school_framework', { ascending: true })
      .order('document_type', { ascending: true })
      .order('activity_type_group', { ascending: true }),
    readContactsSchoolsForProposals(),
    readProposalActivityPricingFromSupabase(),
    readProposalTemplateSectionsFromSupabase()
  ]);
  if (paResult.error) throw new Error(paResult.error.message || 'proposals_agreements_read_failed');
  const activityNameOptions = await readProposalActivityNamesFromSupabase();
  return {
    rows: (Array.isArray(paResult.data) ? paResult.data : []).map(normalizeProposalAgreementRow),
    activityNameOptions,
    contactOptions,
    proposalActivityPricing,
    proposalTemplateSections,
    _source: 'supabase'
  };
}

const USER_PUBLIC_COLUMNS = 'user_id,email,name,role,display_role,is_active,permissions,auth_user_id,view_proposals_agreements,manage_proposals_agreements';
const PROFILE_PERSONAL_REPORTS_COLUMNS = 'id,is_active,can_access_personal_reports';
const VALID_SUPABASE_ROLES = new Set(['admin', 'operation_manager', 'authorized_user', 'instructor', 'finance', 'activities_manager', 'domain_manager', 'instructor_manager', 'business_development_manager']);
const ROLES_WITH_DIRECT_EDIT = new Set(['admin', 'operation_manager']);

const SUPABASE_ROLE_ROUTES = {
  admin: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'permissions', 'admin-lists', 'certificates'],
  operation_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  authorized_user: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'certificates'],
  finance: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  activities_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  domain_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'certificates'],
  business_development_manager: ['dashboard', 'activities', 'archive', 'proposals-agreements', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  instructor_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  instructor: ['my-data', 'week', 'month']
};

function normalizeSupabaseRole(role) {
  const normalized = String(role || 'authorized_user').trim();
  return VALID_SUPABASE_ROLES.has(normalized) ? normalized : 'authorized_user';
}

function permissionFlagYes(value) {
  return ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

function canManagePersonalReportsUser(user = {}) {
  const role = String(user?.display_role || user?.role || '').trim().toLowerCase();
  if (role === 'admin') return true;
  return permissionFlagYes(user?.personal_reports_manager);
}

function personalReportsProfileFlagYes(value) {
  if (value === true) return true;
  if (value === false) return false;
  return permissionFlagYes(value);
}

function profileCanAccessPersonalReports(profileRow) {
  if (!profileRow || profileRow.can_access_personal_reports === undefined) return false;
  if (profileRow.is_active === false) return false;
  return personalReportsProfileFlagYes(profileRow.can_access_personal_reports);
}

async function readPersonalReportsProfile(authUserId) {
  const id = String(authUserId || '').trim();
  if (!supabase || !id) return null;
  const session = await waitForSupabaseAuthSession();
  if (!session?.user?.id) {
    try { console.warn('[personal-reports-profile] skipped: no supabase auth session'); } catch { /* ignore */ }
    return null;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_PERSONAL_REPORTS_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) {
    try { console.warn('[personal-reports-profile]', error.message); } catch { /* ignore */ }
    return null;
  }
  return data;
}

async function readPersonalReportsProfilesByAuthIds(authUserIds = []) {
  const ids = [...new Set(authUserIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!supabase || !ids.length) return new Map();
  const session = await waitForSupabaseAuthSession();
  if (!session?.user?.id) {
    try { console.warn('[personal-reports-profiles] skipped: no supabase auth session'); } catch { /* ignore */ }
    return new Map();
  }
  const { data, error } = await supabase
    .from('profiles')
    .select(`${PROFILE_PERSONAL_REPORTS_COLUMNS},email`)
    .in('id', ids);
  if (error) {
    try { console.warn('[personal-reports-profiles]', error.message); } catch { /* ignore */ }
    return new Map();
  }
  const map = new Map();
  (Array.isArray(data) ? data : []).forEach((row) => {
    if (row?.id) map.set(String(row.id), row);
  });
  return map;
}

function mergePersonalReportsProfileIntoFlatUser(flat, profileRow) {
  if (!flat || !profileRow) return flat;
  return {
    ...flat,
    can_access_personal_reports: profileCanAccessPersonalReports(profileRow) ? 'yes' : 'no'
  };
}

const ACTIVITY_DIRECT_MANAGE_ROLES = new Set(['admin', 'operation_manager']);
const ACTIVITY_REQUEST_ROLES = new Set(['activities_manager', 'instructor_manager', 'business_development_manager']);

function currentActivityRole(user = state?.user || {}) {
  return String(user?.display_role || user?.role || '').trim();
}

function canDirectManageActivitiesUser(user = state?.user || {}) {
  return ACTIVITY_DIRECT_MANAGE_ROLES.has(currentActivityRole(user));
}

function canSubmitActivityRequestsUser(user = state?.user || {}) {
  return canDirectManageActivitiesUser(user) || ACTIVITY_REQUEST_ROLES.has(currentActivityRole(user));
}

function canReviewEditRequestsUser(user = state?.user || {}) {
  // Legacy permissionFlagYes(user?.can_review_requests) is intentionally not enough for activity request review.
  return canDirectManageActivitiesUser(user);
}

function getLoginStatus(row) {
  return String(row?.status || '').trim();
}

function throwLoginError(code, details = {}) {
  const message = String(code || 'login_failed').trim() || 'login_failed';
  try {
    console.warn('[login-diagnostic]', { code: message, ...details });
  } catch {
    /* ignore */
  }
  const error = new Error(message);
  error.code = message;
  error.details = details;
  throw error;
}

function assertValidLoginUserRow(userRow) {
  const role = String(userRow?.role || '').trim();
  if (!VALID_SUPABASE_ROLES.has(role)) {
    throwLoginError('invalid_role', { role, user_id: String(userRow?.user_id || '') });
  }
  if (!String(userRow?.user_id || '').trim()) {
    throwLoginError('user_not_found', { reason: 'missing_returned_user_id' });
  }
}

function parsePermissions(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch { return {}; }
  }
  return {};
}

function flattenUserRow(userRow = {}) {
  const permissions = parsePermissions(userRow?.permissions);
  const role = normalizeSupabaseRole(userRow.role);
  const customDisplayRole = String(userRow.display_role || '').trim();
  const flat = {
    user_id: String(userRow.user_id || ''),
    full_name: String(userRow.name || ''),
    role,
    display_role: role,
    display_role_label: customDisplayRole || hebrewRole(role),
    display_role2: String(permissions.display_role2 || ''),
    emp_id: String(userRow.user_id || ''),
    auth_user_id: String(userRow.auth_user_id || ''),
    active: userRow.is_active ? 'yes' : 'no',
    ...permissions
  };
  if (userRow.view_proposals_agreements != null) flat.view_proposals_agreements = userRow.view_proposals_agreements;
  if (userRow.manage_proposals_agreements != null) flat.manage_proposals_agreements = userRow.manage_proposals_agreements;
  return flat;
}

function buildBootstrapFromUser(userRow, profileRow = null) {
  const flat = flattenUserRow(userRow);
  const role = normalizeSupabaseRole(flat.role);
  const allowedRoutes = [...(SUPABASE_ROLE_ROUTES[role] || SUPABASE_ROLE_ROUTES.authorized_user)];
  const isBusinessDevelopmentManager = role === 'business_development_manager';
  const canDirectManageActivities = ACTIVITY_DIRECT_MANAGE_ROLES.has(role);
  const canRequestActivities = ACTIVITY_REQUEST_ROLES.has(role);
  const hasFinanceAccess = isBusinessDevelopmentManager ? false : (role === 'finance' || permissionFlagYes(parsePermissions(userRow?.permissions).finance_access) || permissionFlagYes(parsePermissions(userRow?.permissions).view_finance));
  const financeIdx = allowedRoutes.indexOf('finance');
  if (hasFinanceAccess && financeIdx === -1) allowedRoutes.push('finance');
  if (!hasFinanceAccess && financeIdx >= 0) allowedRoutes.splice(financeIdx, 1);
  if (permissionFlagYes(flat.view_catalog) && !allowedRoutes.includes('catalog')) allowedRoutes.push('catalog');
  if ((permissionFlagYes(flat.view_orders) || permissionFlagYes(flat.view_invitations)) && !allowedRoutes.includes('orders')) allowedRoutes.push('orders');
  if (
    PROPOSALS_AGREEMENTS_ALLOWED_ROLES.has(role) ||
    permissionFlagYes(flat.view_proposals) ||
    permissionFlagYes(flat.view_proposals_agreements) ||
    permissionFlagYes(flat.manage_proposals_agreements)
  ) { if (!allowedRoutes.includes('proposals-agreements')) allowedRoutes.push('proposals-agreements'); }
  const canEditDirect = canDirectManageActivities;
  const canRequestEdit = canDirectManageActivities || canRequestActivities;
  const canReviewRequests = canDirectManageActivities;
  const canViewEditRequests = canReviewRequests || canRequestEdit || permissionFlagYes(flat.view_edit_requests) || allowedRoutes.includes('edit-requests');
  if (canViewEditRequests && !allowedRoutes.includes('edit-requests')) {
    allowedRoutes.push('edit-requests');
  }
  const hasPersonalReportsAccess = profileCanAccessPersonalReports(profileRow);
  const hasPersonalReportsManager = canManagePersonalReportsUser(flat);
  const personalReportsIdx = allowedRoutes.indexOf('personal-reports');
  if (hasPersonalReportsAccess && personalReportsIdx === -1) allowedRoutes.push('personal-reports');
  if (!hasPersonalReportsAccess && personalReportsIdx >= 0) allowedRoutes.splice(personalReportsIdx, 1);
  // Israa management tab — requires view_israa_management=yes AND (israa user or admin role)
  const ISRAA_USER_ID = '3030';
  const ISRAA_AUTH_USER_ID = '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
  const isIsraaUser = String(flat.user_id || '') === ISRAA_USER_ID || String(flat.auth_user_id || '') === ISRAA_AUTH_USER_ID;
  const isAdminRole = role === 'admin';
  if ((isIsraaUser || isAdminRole) && permissionFlagYes(flat.view_israa_management)) {
    if (!allowedRoutes.includes('israa-management')) allowedRoutes.push('israa-management');
  }
  return {
    routes: [...allowedRoutes],
    default_route: allowedRoutes[0] || 'my-data',
    has_finance_access: hasFinanceAccess,
    has_personal_reports_access: hasPersonalReportsAccess,
    has_personal_reports_manager: hasPersonalReportsManager,
    profile_is_active: profileRow?.is_active !== false,
    profile: {
      full_name: flat.full_name,
      display_role2: flat.display_role2 || '',
      display_role_label: flat.display_role_label || hebrewRole(role)
    },
    can_add_activity: canDirectManageActivities || canRequestActivities,
    can_edit_direct: canEditDirect,
    can_request_edit: canRequestEdit,
    can_review_requests: canReviewRequests,
    client_settings: {}
  };
}

function getInstructorIdentitySet() {
  const user = state?.user || {};
  const values = [user.emp_id, user.user_id].map((v) => String(v || '').trim()).filter(Boolean);
  return new Set(values);
}

function isInstructorAssignedRow(row, idsSet) {
  if (!idsSet || idsSet.size === 0) return false;
  const emp1 = String(row?.emp_id || '').trim();
  const emp2 = String(row?.emp_id_2 || '').trim();
  return idsSet.has(emp1) || idsSet.has(emp2);
}

function filterCalendarPayloadForInstructor(payload) {
  const idsSet = getInstructorIdentitySet();
  if (idsSet.size === 0) return payload;
  const srcItemsById = payload?.items_by_id && typeof payload.items_by_id === 'object' ? payload.items_by_id : {};
  const allowedItemsById = {};
  for (const [rowId, row] of Object.entries(srcItemsById)) {
    if (isInstructorAssignedRow(row, idsSet)) allowedItemsById[rowId] = row;
  }
  const hasItem = (id) => Object.prototype.hasOwnProperty.call(allowedItemsById, id);
  if (Array.isArray(payload?.days)) {
    return {
      ...payload,
      items_by_id: allowedItemsById,
      days: payload.days.map((day) => ({
        ...day,
        item_ids: (Array.isArray(day?.item_ids) ? day.item_ids : []).filter((id) => hasItem(String(id || '')))
      }))
    };
  }
  if (Array.isArray(payload?.cells)) {
    return {
      ...payload,
      items_by_id: allowedItemsById,
      cells: payload.cells.map((cell) => ({
        ...cell,
        item_ids: (Array.isArray(cell?.item_ids) ? cell.item_ids : []).filter((id) => hasItem(String(id || '')))
      }))
    };
  }
  return payload;
}

async function loginWithSupabaseAuth(user_id, entry_code) {
  if (!supabase) throwLoginError('no_supabase_client');
  const uid = String(user_id || '').trim();
  const code = String(entry_code || '').trim();
  if (!uid || !code) throwLoginError('missing_user_id_or_entry_code');

  const authEmail = uid.includes('@') ? uid : `${uid}@think.org.il`;

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password: code
  });

  if (authError || !authData?.user) {
    throwLoginError('invalid_credentials', { login: uid, message: String(authError?.message || '') });
  }

  const authUserId = authData.user.id;

  const { data: userRow, error: profileError } = await supabase
    .from('users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .single();

  if (profileError || !userRow) {
    throwLoginError('invalid_credentials', { auth_user_id: authUserId, message: String(profileError?.message || '') });
  }

  assertValidLoginUserRow(userRow);
  const profileRow = await readPersonalReportsProfile(authUserId);
  return { userRow, profileRow };
}

function makeSessionToken(userRow) {
  const claims = {
    uid: String(userRow.user_id || ''),
    role: normalizeSupabaseRole(userRow.role),
    emp_id: String(userRow.user_id || ''),
    name: String(userRow.name || '')
  };
  return `sb.${btoa(unescape(encodeURIComponent(JSON.stringify(claims))))}.session`;
}

async function readCurrentUserBySession() {
  if (!supabase) throw new Error('no_supabase_client');
  const userId = String(state?.user?.user_id || '').trim();
  if (!userId) throw new Error('unauthorized');
  const session = await waitForSupabaseAuthSession();
  if (!session?.user?.id) throw new Error('unauthorized');
  const { data, error } = await supabase
    .from('users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('unauthorized');
  if (!data.is_active) throw new Error('unauthorized');
  const profileRow = await readPersonalReportsProfile(data.auth_user_id);
  return { userRow: data, profileRow };
}

function buildSupabaseMutationError(operation, error, fallback = 'server_error') {
  const status = error?.status || error?.code || '';
  const message = String(error?.message || fallback).trim();
  const details = String(error?.details || '').trim();
  const hint = String(error?.hint || '').trim();
  const parts = [status, message, details, hint].filter(Boolean);
  const apiError = new Error(parts.join(' | ') || fallback);
  apiError.name = 'SupabaseMutationError';
  apiError.operation = operation;
  apiError.status = error?.status;
  apiError.code = error?.code;
  apiError.details = error?.details;
  apiError.hint = error?.hint;
  return apiError;
}

async function buildActivityMutationAuthContext() {
  const context = {
    auth_uid: '',
    user_id: '',
    role: '',
    can_edit_direct: null,
    can_add_activity: null
  };
  if (!supabase) return context;
  try {
    const { data: authData } = await supabase.auth.getUser();
    context.auth_uid = String(authData?.user?.id || '').trim();
  } catch {
    /* ignore */
  }
  if (!context.auth_uid) return context;
  try {
    const [{ data: roleData }, { data: canEditData }, { data: canAddData }] = await Promise.all([
      supabase.rpc('app_current_role'),
      supabase.rpc('app_can_edit_direct'),
      supabase.rpc('app_can_add_activity')
    ]);
    context.role = typeof roleData === 'string' ? roleData : '';
    context.can_edit_direct = typeof canEditData === 'boolean' ? canEditData : null;
    context.can_add_activity = typeof canAddData === 'boolean' ? canAddData : null;
  } catch {
    /* ignore */
  }
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('user_id')
      .eq('auth_user_id', context.auth_uid)
      .maybeSingle();
    context.user_id = String(userRow?.user_id || '').trim();
  } catch {
    /* ignore */
  }
  return context;
}

function logActivityMutationDebug(stage, operation, payload, extra = {}) {
  // eslint-disable-next-line no-console
  console.info(`[activity-save:${stage}]`, {
    operation,
    apiUrl: supabaseConfig?.url || '',
    hasSupabaseKey: Boolean(supabaseConfig?.hasAnonKey),
    usesFallbackUrl: Boolean(supabaseConfig?.usesFallbackUrl),
    source_sheet: payload?.source_sheet || '',
    source_row_id: payload?.source_row_id || payload?.row_id || payload?.RowID || '',
    changed_fields: Object.keys(payload?.changes || {}),
    changes: payload?.changes || {},
    ...extra
  });
}

function assertValidOneDayActivityRow(row = {}) {
  const canonicalType = canonicalOneDayActivityType(row.activity_type || row.item_type);
  if (!canonicalType) return row;
  row.activity_type = canonicalType;
  row.item_type = canonicalType;
  row.activity_family = 'one_day';
  const name = String(row.activity_name || '').trim();
  if (!name || GENERIC_ONE_DAY_ACTIVITY_NAMES.has(name)) throw new Error('יש לבחור שם פעילות מתוך הרשימה');
  const selectedDate = normalizeDateFieldForSupabase(row.date_1 || row.start_date || row.end_date);
  if (!selectedDate) throw new Error('יש לבחור תאריך תקין לפעילות חד־יומית לפני השמירה');
  row.start_date = selectedDate;
  row.end_date = selectedDate;
  row.date_1 = selectedDate;
  if (String(row.status || '').trim() === LEGACY_ACTIVE_STATUS) row.status = OPEN_STATUS;
  if (![OPEN_STATUS, CLOSED_STATUS, DELETED_STATUS].includes(String(row.status || '').trim())) row.status = OPEN_STATUS;
  return row;
}

function normalizeOneDayActivityForSave(act = {}) {
  const row = { ...act };
  const canonicalType = oneDayTypeFromActivityFields(row.activity_type, row.item_type);
  if (!canonicalType) return row;
  row.activity_family = 'one_day';
  row.activity_type = canonicalType;
  row.item_type = canonicalType;
  if (String(row.status || '').trim() === LEGACY_ACTIVE_STATUS) row.status = OPEN_STATUS;
  if (!String(row.status || '').trim()) row.status = OPEN_STATUS;
  const selectedDate = normalizeDateFieldForSupabase(row.date_1 || row.Date1 || row.one_day_date || row.start_date || row.end_date);
  if (selectedDate) {
    row.start_date = selectedDate;
    row.end_date = selectedDate;
    row.date_1 = selectedDate;
    row.Date1 = selectedDate;
  }
  return row;
}

function sanitizeActivityPayload(act = {}) {
  const row = normalizeOneDayActivityForSave({ ...act });
  delete row.source;
  delete row.source_sheet;
  delete row.source_table;
  delete row.RowID;
  if (!row.row_id) row.row_id = String(act.row_id || act.RowID || `ACT-${crypto.randomUUID?.() || Date.now()}`).trim();
  const normalizedType = oneDayTypeFromActivityFields(row.activity_type || act.activity_type, row.item_type || act.item_type);
  if (normalizedType) {
    row.activity_family = 'one_day';
    row.activity_type = normalizedType;
    row.item_type = normalizedType;
  } else {
    const normalizedFamily = String(row.activity_family || '').trim();
    if (normalizedFamily === 'one_day' || normalizedFamily === 'program') {
      row.activity_family = normalizedFamily;
    } else {
      row.activity_family = String(act.source || '').trim() === 'short' ? 'one_day' : 'program';
    }
  }
  row.status = String(row.status || (normalizedType ? OPEN_STATUS : LEGACY_ACTIVE_STATUS));
  if (normalizedType && row.status === LEGACY_ACTIVE_STATUS) row.status = OPEN_STATUS;
  row.activity_season = normalizeActivitySeason(row.activity_season ?? act.activitySeason);
  for (let i = 1; i <= 35; i++) {
    const lower = `date_${i}`;
    const oldDateKey = `Date${i}`;
    if (row[lower] === undefined && act[oldDateKey] !== undefined) row[lower] = act[oldDateKey];
  }
  return assertValidOneDayActivityRow(row);
}

const ALLOWED_ACTIVITY_COLUMNS = new Set([
  'row_id',
  'activity_family',
  'activity_manager',
  'district',
  'authority',
  'school',
  'grade',
  'class_group',
  'activity_type',
  'item_type',
  'activity_season',
  'activity_no',
  'activity_name',
  'sessions',
  'price',
  'funding',
  'start_time',
  'end_time',
  'emp_id',
  'instructor_name',
  'emp_id_2',
  'instructor_name_2',
  'start_date',
  'end_date',
  'status',
  'notes',
  'finance_status',
  'finance_notes',
  'operations_private_notes'
]);
for (let i = 1; i <= 35; i++) ALLOWED_ACTIVITY_COLUMNS.add(`date_${i}`);

/**
 * Drawer forms use input names `meeting_date_0`, `meeting_date_1`, … (0-based).
 * public.activities stores them as `date_1` … `date_35`. Map before sanitizing.
 * Drops `meeting_performed_*` (not a DB column).
 */
function mapMeetingDateFieldNamesToSupabase(changes = {}) {
  if (!changes || typeof changes !== 'object') return {};
  const out = { ...changes };
  for (const key of Object.keys(out)) {
    const m = /^meeting_date_(\d+)$/.exec(key);
    if (m) {
      const idx0 = Number(m[1]);
      if (Number.isFinite(idx0) && idx0 >= 0 && idx0 < 35) {
        const dateKey = `date_${idx0 + 1}`;
        out[dateKey] = out[key];
      }
      delete out[key];
      continue;
    }
    if (/^meeting_performed_\d+$/.test(key)) {
      delete out[key];
    }
  }
  return out;
}

function normalizeDateFieldForSupabase(value) {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  const normalized = normalizeSupabaseDate(clean);
  return normalized || null;
}

function normalizeBigintFieldForSupabase(value) {
  if (value === null || value === undefined) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTimeFieldForSupabase(value) {
  const clean = String(value ?? '').trim();
  if (!clean) return null;
  return /^\d{2}:\d{2}$/.test(clean) ? clean : null;
}

/**
 * Given a sanitized payload that may contain date_1..date_35,
 * returns the latest non-empty YYYY-MM-DD value, or null if none found.
 */
function deriveEndDateFromDates(sanitized = {}) {
  let last = '';
  for (let i = 1; i <= 35; i++) {
    const v = String(sanitized[`date_${i}`] || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v > last) last = v;
  }
  return last || null;
}


function synchronizeStartDateAndFirstMeeting(payload = {}, existing = {}) {
  const out = { ...(payload || {}) };
  const hasStart = Object.prototype.hasOwnProperty.call(out, 'start_date');
  const hasDate1 = Object.prototype.hasOwnProperty.call(out, 'date_1');
  const nextStart = normalizeDateFieldForSupabase(out.start_date);
  const nextDate1 = normalizeDateFieldForSupabase(out.date_1);
  const existingStart = normalizeDateFieldForSupabase(existing?.start_date);
  const existingDate1 = normalizeDateFieldForSupabase(existing?.date_1);

  if (hasStart && !hasDate1) {
    out.date_1 = nextStart;
  } else if (hasDate1 && !hasStart) {
    out.start_date = nextDate1;
  } else if (hasStart && hasDate1) {
    if (nextStart && nextStart !== nextDate1 && nextDate1 === existingDate1 && nextStart !== existingStart) {
      out.date_1 = nextStart;
    } else if (nextDate1 && nextStart !== nextDate1 && nextStart === existingStart && nextDate1 !== existingDate1) {
      out.start_date = nextDate1;
    } else if (nextStart || nextDate1) {
      const canonical = nextStart || nextDate1;
      out.start_date = canonical;
      out.date_1 = canonical;
    }
  }
  return out;
}

function sanitizeActivityPayloadForSupabase(payload = {}, { includeRowId = true } = {}) {
  const sanitized = {};
  const source = payload && typeof payload === 'object' ? payload : {};
  const bigintFields = new Set(['activity_no', 'sessions', 'price', 'emp_id']);
  const timeFields = new Set(['start_time', 'end_time']);
  for (const [key, rawValue] of Object.entries(source)) {
    if (!ALLOWED_ACTIVITY_COLUMNS.has(key)) continue;
    if (!includeRowId && key === 'row_id') continue;
    let nextValue = rawValue;
    if (key === 'start_date' || key === 'end_date' || /^date_\d+$/.test(key)) {
      nextValue = normalizeDateFieldForSupabase(rawValue);
    } else if (key === 'activity_season') {
      nextValue = normalizeActivitySeason(rawValue);
    } else if (bigintFields.has(key)) {
      nextValue = normalizeBigintFieldForSupabase(rawValue);
    } else if (timeFields.has(key)) {
      nextValue = normalizeTimeFieldForSupabase(rawValue);
    }
    sanitized[key] = nextValue === undefined ? null : nextValue;
  }
  return sanitized;
}

async function upsertActivityToSupabase(payload = {}) {
  const act = payload?.activity || payload || {};
  const row = sanitizeActivityPayloadForSupabase(synchronizeStartDateAndFirstMeeting(sanitizeActivityPayload(act)), { includeRowId: true });
  const derivedEnd = deriveEndDateFromDates(row);
  const existingEndDate = normalizeDateFieldForSupabase(row.end_date);
  const startDate = normalizeDateFieldForSupabase(row.start_date);
  row.end_date = derivedEnd || existingEndDate || startDate || null;
  logActivityMutationDebug('request', 'addActivity', { source_sheet: 'activities', source_row_id: row.row_id, changes: row });
  const { data, error } = await supabase.from('activities').insert(row).select().single();
  if (error) {
    const authContext = await buildActivityMutationAuthContext();
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', {
      action: 'addActivity',
      table: 'activities',
      row_id: row.row_id,
      auth_uid: authContext.auth_uid,
      user_id: authContext.user_id,
      role: authContext.role,
      can_edit_direct: authContext.can_edit_direct,
      can_add_activity: authContext.can_add_activity,
      supabase_error_code: error?.code || error?.status || '',
      supabase_error_message: String(error?.message || 'save_failed'),
      supabase_error_details: String(error?.details || ''),
      payload: row,
      error
    });
    throw buildSupabaseMutationError('addActivity', error, 'save_failed');
  }
  const normalized = normalizeActivityRow(data || row);
  logActivityMutationDebug('success', 'addActivity', { source_sheet: 'activities', source_row_id: normalized.row_id, changes: row });
  return { RowID: normalized.RowID, row_id: normalized.row_id, source_sheet: 'activities', row: normalized };
}

async function updateActivityInSupabase(payload = {}) {
  const rowId = String(payload?.source_row_id || payload?.row_id || payload?.RowID || '').trim();
  const sourceSheet = String(payload?.source_sheet || 'activities').trim() || 'activities';
  if (!rowId) throw new Error('missing_row_id');
  const rawChanges = mapMeetingDateFieldNamesToSupabase({ ...(payload?.changes || {}) });
  let existingForNormalization = null;
  const needsExisting = Object.keys(rawChanges).some((key) => ['activity_type', 'item_type', 'activity_family', 'activity_name', 'start_date', 'end_date', 'date_1', 'status'].includes(key) || /^date_\d+$/.test(key));
  if (needsExisting) {
    const { data: existingRow, error: existingError } = await supabase
      .from('activities')
      .select('*')
      .eq('row_id', rowId)
      .maybeSingle();
    if (existingError) throw buildSupabaseMutationError('saveActivity', existingError, 'save_failed');
    existingForNormalization = existingRow || {};
  }
  let normalizedChangesSource = synchronizeStartDateAndFirstMeeting(rawChanges, existingForNormalization || {});
  if (existingForNormalization && oneDayTypeFromActivityFields(rawChanges.activity_type || existingForNormalization.activity_type, rawChanges.item_type || existingForNormalization.item_type)) {
    const normalizedFullRow = assertValidOneDayActivityRow(normalizeOneDayActivityForSave({ ...existingForNormalization, ...rawChanges }));
    normalizedChangesSource = { ...normalizedChangesSource };
    ['activity_family', 'activity_type', 'item_type', 'status', 'start_date', 'end_date', 'date_1'].forEach((key) => {
      normalizedChangesSource[key] = normalizedFullRow[key];
    });
    if (Object.prototype.hasOwnProperty.call(rawChanges, 'activity_name')) {
      normalizedChangesSource.activity_name = normalizedFullRow.activity_name;
    }
  }
  const changes = sanitizeActivityPayloadForSupabase(normalizedChangesSource, { includeRowId: false });
  const hasMeetingDateChange = Object.keys(changes).some((k) => /^date_\d+$/.test(k));
  const hasExplicitEndDate = Object.prototype.hasOwnProperty.call(changes, 'end_date');
  if (hasMeetingDateChange && !hasExplicitEndDate) {
    const { data: existingRow, error: existingError } = await supabase
      .from('activities')
      .select(Array.from({ length: 35 }, (_, idx) => `date_${idx + 1}`).join(','))
      .eq('row_id', rowId)
      .maybeSingle();
    if (existingError) throw buildSupabaseMutationError('saveActivity', existingError, 'save_failed');
    const mergedDates = { ...(existingRow || {}), ...changes };
    const derivedEnd = deriveEndDateFromDates(mergedDates);
    if (derivedEnd) changes.end_date = derivedEnd;
  }
  if (!Object.keys(changes).length) throw new Error('No changes to submit');
  const debugPayload = { source_sheet: sourceSheet, source_row_id: rowId, changes };
  logActivityMutationDebug('request', 'saveActivity', debugPayload, { table: 'activities' });
  const { data, error } = await supabase
    .from('activities')
    .update(changes)
    .eq('row_id', rowId)
    .select('row_id')
    .maybeSingle();
  if (error) {
    const authContext = await buildActivityMutationAuthContext();
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', {
      action: 'saveActivity',
      table: 'activities',
      row_id: rowId,
      auth_uid: authContext.auth_uid,
      user_id: authContext.user_id,
      role: authContext.role,
      can_edit_direct: authContext.can_edit_direct,
      can_add_activity: authContext.can_add_activity,
      supabase_error_code: error?.code || error?.status || '',
      supabase_error_message: String(error?.message || 'save_failed'),
      supabase_error_details: String(error?.details || ''),
      payload: debugPayload,
      error
    });
    throw buildSupabaseMutationError('saveActivity', error, 'save_failed');
  }
  if (!data) {
    const notFound = new Error('activity_not_found_or_forbidden');
    notFound.status = 404;
    notFound.operation = 'saveActivity';
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', { operation: 'saveActivity', table: 'activities', payload: debugPayload, error: notFound });
    throw notFound;
  }
  logActivityMutationDebug('success', 'saveActivity', debugPayload, { table: 'activities' });
  return { ok: true, RowID: rowId, row_id: rowId, source_sheet: 'activities' };
}

async function readActivityDetailFromSupabase(source_row_id, source_sheet) {
  void source_sheet;
  const rowId = String(source_row_id || '').trim();
  const { data, error } = await supabase.from('activities').select('*').eq('row_id', rowId).single();
  if (error) throw new Error(error.message || 'detail_failed');
  const normalized = normalizeActivityRow(data || {});
  return { row: { ...normalized, private_note: normalized.operations_private_notes || '' } };
}

async function readActivityDatesFromSupabase(source_row_id, source_sheet) {
  void source_sheet;
  const rowId = String(source_row_id || '').trim();
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .eq('row_id', rowId)
    .maybeSingle();
  if (error) throw new Error(error.message || 'dates_failed');
  const row = normalizeActivityRow(data || {});
  const meeting_dates = getActivityDateColumns(row);
  const meeting_schedule = meeting_dates.map((d) => ({ date: d, performed: 'no' }));
  return {
    meeting_dates,
    date_cols: meeting_dates,
    meeting_schedule,
    rows: meeting_dates.map((dateKey, index) => ({ source_row_id: rowId, meeting_no: String(index + 1), meeting_date: dateKey })),
    source_row_id: rowId,
    source_sheet: 'activities'
  };
}

async function readAllActivitiesRowsSupabase() {
  return selectActivitiesFromSupabase('*');
}

function filterOperationsRows(rows, params = {}) {
  const q = String(params?.search || '').trim().toLowerCase();
  const activityType = String(params?.activity_type || '').trim();
  return rows.filter((row) => {
    if (String(row?.status || '').trim() === 'סגור') return false;
    if (activityType && String(row?.activity_type || '').trim() !== activityType) return false;
    if (!q) return true;
    const hay = [
      row?.RowID,
      row?.activity_name,
      row?.activity_type,
      row?.authority,
      row?.school,
      row?.activity_manager,
      row?.instructor_name,
      row?.instructor_name_2,
      row?.emp_id,
      row?.emp_id_2
    ].map((v) => String(v || '').toLowerCase());
    return hay.some((v) => v.includes(q));
  });
}

function parseJsonishObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function parseJsonishArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeEditRequestType(value) {
  const type = String(value || '').trim();
  return type === 'create_activity' ? 'create_activity' : 'edit_activity';
}

function buildEditRequestGroups(rows = [], canReview = false, activityByRowId = {}) {
  const groups = rows.map((row) => {
    const requestType = normalizeEditRequestType(row?.request_type);
    const sourceRowId = String(row?.source_row_id || '').trim();
    const activityRow = sourceRowId && activityByRowId[sourceRowId] ? activityByRowId[sourceRowId] : null;

    const changedFields = parseJsonishArray(row?.changed_fields);
    const requestedValues = parseJsonishObject(row?.requested_values);
    const originalValues = parseJsonishObject(row?.original_values);
    const requestedPayload = sanitizeActivityPayloadForSupabase(
      synchronizeStartDateAndFirstMeeting(parseJsonishObject(row?.requested_payload)),
      { includeRowId: true }
    );

    const fields = requestType === 'create_activity'
      ? Object.keys(requestedPayload).map((fieldName) => ({
          field_name: fieldName,
          old_value: '',
          new_value: requestedPayload[fieldName]
        }))
      : (Array.isArray(changedFields) ? changedFields : []).map((fieldName) => {
          const fn = String(fieldName || '');
          if (!fn) return null;
          const hasOriginalKey = Object.prototype.hasOwnProperty.call(originalValues, fn);
          const oldFromSnapshot = hasOriginalKey
            ? String(originalValues[fn] ?? '').trim()
            : (activityRow ? String(activityRow[fn] ?? '').trim() : '');
          const newVal = String(requestedValues?.[fn] ?? '').trim();
          return {
            field_name: fn,
            old_value: oldFromSnapshot,
            new_value: newVal
          };
        }).filter(Boolean);

    const activityName =
      String(row?.activity_name || '').trim() ||
      String(requestedPayload?.activity_name || '').trim() ||
      String(activityRow?.activity_name || '').trim();
    const authority =
      String(row?.authority || '').trim() ||
      String(requestedPayload?.authority || '').trim() ||
      String(activityRow?.authority || '').trim();
    const school =
      String(row?.school || '').trim() ||
      String(requestedPayload?.school || '').trim() ||
      String(activityRow?.school || '').trim();

    return {
      request_id: String(row?.request_id || ''),
      status: String(row?.status || 'pending'),
      requested_by_name: String(row?.requested_by_name || ''),
      requested_by_user_id: String(row?.requested_by_user_id || ''),
      requested_at: String(row?.requested_at || ''),
      review_note: String(row?.review_note || ''),
      source_row_id: sourceRowId,
      source_sheet: String(row?.source_sheet || 'activities'),
      request_type: requestType,
      requested_payload: requestedPayload,
      activity_name: activityName,
      authority,
      school,
      activity: activityRow,
      can_approve: requestType === 'create_activity' ? Object.keys(requestedPayload).length > 0 : Boolean(activityRow),
      fields
    };
  });
  return { groups, canReview };
}

async function readSettingsRowsFromSupabase() {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .order('key', { ascending: true });
  if (error) throw new Error(error.message || 'settings_read_failed');
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r) => ({
    key: String(r?.key || ''),
    value: String(r?.value || ''),
    description: String(r?.description || '')
  }));
}



async function readCatalogProgramsFromSupabase() {
  if (!supabase) throw new Error('no_supabase_client');
  const [listsRes, detailsRes, pricingRes, syllabusRes] = await Promise.all([
    supabase
      .from('lists')
      .select('activity_no,activity_name,label_he,label,type,activity_type,audience_level,target_grades,gefen_number,sort_order,category,active')
      .eq('category', 'activity_names')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('catalog_program_details')
      .select('activity_no,gefen_number,catalog_title,catalog_subtitle,opening_line,domain,target_grades,grades,audience_level,catalog_section,scope,session_duration,item_type,core_idea,short_description,goals,program_flow,participants_receive,student_develops,school_value,final_outcome,is_active_for_catalog')
      .eq('is_active_for_catalog', true),
    supabase
      .from('proposal_activity_pricing')
      .select('activity_no,activity_name,proposal_group,item_type,catalog_group,gefen_number,meetings_count,hours_count,unit_duration,unit_price,hourly_price,description_for_proposal,sort_order,is_active_for_proposals,is_active_for_catalog')
      .eq('is_active_for_proposals', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('catalog_program_syllabus')
      .select('program_number,meeting_label,meeting_order,title,description,is_active')
      .eq('is_active', true)
      .order('meeting_order', { ascending: true })
  ]);

  const logReadError = (source, table, error) => {
    if (!error) return;
    console.error('[catalog-load-error]', {
      source,
      table,
      operation: 'select',
      message: String(error?.message || error || 'unknown_error')
    });
  };

  logReadError('catalog', 'lists', listsRes?.error);
  logReadError('catalog', 'catalog_program_details', detailsRes?.error);
  logReadError('catalog', 'proposal_activity_pricing', pricingRes?.error);
  logReadError('catalog', 'catalog_program_syllabus', syllabusRes?.error);

  if (listsRes?.error && detailsRes?.error && pricingRes?.error) {
    return {
      programs: [],
      error: 'לא ניתן לטעון את נתוני הקטלוג. בדקו חיבור והרשאות.'
    };
  }

  const listRows = Array.isArray(listsRes?.data) ? listsRes.data : [];
  const detailRows = Array.isArray(detailsRes?.data) ? detailsRes.data : [];
  const pricingRows = Array.isArray(pricingRes?.data) ? pricingRes.data : [];
  const syllabusRows = Array.isArray(syllabusRes?.data) ? syllabusRes.data : [];
  const cleanCatalogText = (value) => String(value ?? '').trim();
  const listByNo = new Map(listRows.map((row) => [String(row?.activity_no || '').trim(), row]).filter(([key]) => key));
  const listByGefen = new Map(listRows.map((row) => [String(row?.gefen_number || '').trim(), row]).filter(([key]) => key));
  const detailsByNo = new Map();
  const registerDetailRow = (row) => {
    const activityNo = cleanCatalogText(row?.activity_no);
    const gefenNumber = cleanCatalogText(row?.gefen_number);
    if (activityNo) detailsByNo.set(activityNo, row);
    if (gefenNumber) detailsByNo.set(gefenNumber, row);
  };
  detailRows.forEach(registerDetailRow);
  const lookupListRow = (activityNo, gefenNumber) => {
    const no = cleanCatalogText(activityNo);
    const gefen = cleanCatalogText(gefenNumber);
    return (no && listByNo.get(no)) || (gefen && listByGefen.get(gefen)) || (no && listByGefen.get(no)) || {};
  };
  const hasDetailForKey = (key) => {
    const normalized = cleanCatalogText(key);
    return Boolean(normalized && detailsByNo.has(normalized));
  };
  const syllabusByProgramNumber = syllabusRows.reduce((acc, row) => {
    const key = cleanCatalogText(row?.program_number);
    if (!key) return acc;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push({
      meeting_label: cleanCatalogText(row?.meeting_label),
      meeting_order: row?.meeting_order,
      title: cleanCatalogText(row?.title),
      description: cleanCatalogText(row?.description)
    });
    return acc;
  }, new Map());
  const pricingByNo = pricingRows.reduce((acc, row) => {
    const key = String(row?.activity_no || '').trim();
    if (!key) return acc;
    if (!acc.has(key)) acc.set(key, []);
    acc.get(key).push(row);
    return acc;
  }, new Map());

  const normalizeCatalogGroup = (value) => {
    const raw = cleanCatalogText(value);
    const normalized = raw.toLowerCase().replace(/[\s-]+/g, '_');
    if (!raw) return '';
    if (['after_school', 'afterschool', 'classes', 'class', 'club', 'clubs'].includes(normalized) || raw.includes('אפטרסקול') || raw.includes('חוג')) return 'after_school';
    if (['makers', 'maker', 'workshop_makers'].includes(normalized) || raw.includes('מייקרים')) return 'makers';
    if (['space', 'workshop_space'].includes(normalized) || raw.includes('חלל')) return 'space';
    if (['escape', 'escape_room', 'digital_escape_room'].includes(normalized) || raw.includes('חדר בריחה')) return 'escape';
    if (['tour', 'tours'].includes(normalized) || raw.includes('סיור')) return 'tours';
    if (['program', 'programs', 'course', 'courses'].includes(normalized) || raw.includes('תוכנית')) return 'programs';
    return normalized;
  };
  const hasExplicitCatalogGroup = (row) => Boolean(cleanCatalogText(row?.catalog_group));
  const isTamirCatalogPricingRow = (row) => [row?.activity_name, row?.item_type, row?.description_for_proposal]
    .map((value) => cleanCatalogText(value).toLowerCase())
    .join(' ')
    .includes('תמיר');
  const catalogPricingGroup = (row) => {
    if (row?.is_active_for_catalog !== true) return '';
    const explicitGroup = normalizeCatalogGroup(row?.catalog_group);
    if (explicitGroup) return explicitGroup;
    if (isTamirCatalogPricingRow(row)) return '';
    const itemTypeGroup = normalizeCatalogGroup(row?.item_type);
    if (itemTypeGroup && itemTypeGroup !== 'programs') return itemTypeGroup;
    const name = cleanCatalogText(row?.activity_name);
    if (name === 'תלמידים להייטק' || name === 'חוג מייקרים') return 'after_school';
    if (name === 'סדנת מייקרים') return 'makers';
    if (name === 'סדנת חלל') return 'space';
    if (name === 'חדר בריחה דיגיטלי') return 'escape';
    return '';
  };
  const catalogGroupToProductType = (group, row = {}) => {
    const itemType = cleanCatalogText(row?.item_type);
    const normalized = itemType.toLowerCase();
    if (itemType === 'חוג אפטרסקול') return 'חוג';
    if (group === 'after_school') return 'חוג';
    if (group === 'tours') return 'סיור';
    if (group === 'makers' || group === 'space' || group === 'escape') return 'סדנה';
    if (group === 'programs' || normalized === 'course' || normalized === 'program' || itemType === 'קורס' || itemType === 'תוכנית') return 'תוכנית';
    return itemType || 'תוכנית';
  };

  const syllabusForProgram = (...candidates) => {
    for (const candidate of candidates) {
      const key = cleanCatalogText(candidate);
      if (key && syllabusByProgramNumber.has(key)) return syllabusByProgramNumber.get(key);
    }
    return [];
  };

  const detailKeys = Array.from(new Set(detailRows.map((row) => cleanCatalogText(row?.activity_no) || cleanCatalogText(row?.gefen_number)).filter(Boolean)));

  const detailPrograms = detailKeys.map((key) => {
    const details = detailsByNo.get(key) || {};
    const activityNo = cleanCatalogText(details.activity_no) || key;
    const gefenNumber = cleanCatalogText(details.gefen_number) || activityNo;
    const row = lookupListRow(activityNo, gefenNumber);
    const pricingRowsForProgram = pricingByNo.get(activityNo) || pricingByNo.get(gefenNumber) || [];
    const primaryPricing = pricingRowsForProgram[0] || {};
    const targetGrades = details.target_grades || details.grades || row.target_grades || '';
    const sessionDuration = details.session_duration || primaryPricing.unit_duration || '';
    const scope = details.scope || '';
    const shortDescription = details.short_description || '';
    const participantsReceive = details.participants_receive || '';
    const audienceLevel = details.audience_level || details.catalog_section || row.audience_level || '';
    return {
      ...row,
      ...primaryPricing,
      ...details,
      activity_no: activityNo,
      pricing_options: pricingRowsForProgram,
      proposal_pricing_rows: pricingRowsForProgram,
      catalog_source: 'catalog_program_details',
      catalog_group: 'programs',
      catalog_section: details.catalog_section || '',
      // Normalize detail fields to the naming contract expected by catalog screen.
      catalog_title: details.catalog_title || '',
      catalog_subtitle: details.catalog_subtitle || '',
      target_grades: targetGrades,
      targetGrades,
      audience_level: audienceLevel,
      audienceLevel,
      domain: details.domain || '',
      scope,
      session_duration: sessionDuration,
      unit_duration: sessionDuration,
      gefen_number: gefenNumber,
      gefenNumber,
      opening_line: details.opening_line || '',
      short_description: details.short_description || '',
      item_type: catalogGroupToProductType('programs', { item_type: details.item_type || primaryPricing.item_type || row.activity_type || '' }),
      core_idea: details.core_idea || '',
      goals: details.goals || '',
      program_flow: details.program_flow || '',
      student_develops: details.student_develops || '',
      participants_receive: details.participants_receive || '',
      school_value: details.school_value || '',
      final_outcome: details.final_outcome || '',
      catalog_short_description: shortDescription,
      catalog_core_idea: details.core_idea || '',
      catalog_goals: details.goals || '',
      catalog_program_flow: details.program_flow || '',
      catalog_participants_receive: participantsReceive,
      catalog_school_value: details.school_value || '',
      catalog_syllabus: syllabusForProgram(gefenNumber)
    };
  });

  const explicitCatalogPricingRows = pricingRows
    .map((row, idx) => ({ row, idx, catalogGroup: catalogPricingGroup(row) }))
    .filter(({ row, catalogGroup }) => {
      if (!catalogGroup) return false;
      const activityNo = cleanCatalogText(row?.activity_no);
      const gefenNo = cleanCatalogText(row?.gefen_number);
      if (!activityNo && !gefenNo) return true;
      return !hasDetailForKey(activityNo) && !hasDetailForKey(gefenNo);
    });

  const pricingPrograms = explicitCatalogPricingRows.map(({ row, idx, catalogGroup }) => {
    const key = cleanCatalogText(row.activity_no) || `pricing-${idx + 1}`;
    const listRow = listByNo.get(key) || {};
    const targetGrades = listRow.target_grades || '';
    const scopeParts = [];
    if (row.meetings_count != null) scopeParts.push(`${row.meetings_count} מפגשים`);
    if (row.hours_count != null) scopeParts.push(`${row.hours_count} שעות`);
    const scope = scopeParts.join(' / ');
    const title = row.activity_name || listRow.activity_name || listRow.label_he || listRow.label || '';
    return {
      ...listRow,
      ...row,
      id: `pricing-${key}-${idx + 1}`,
      activity_no: key,
      pricing_options: [row],
      proposal_pricing_rows: [row],
      catalog_source: 'proposal_activity_pricing',
      catalog_group: catalogGroup,
      catalog_group_explicit: hasExplicitCatalogGroup(row),
      catalog_title: title,
      catalog_subtitle: row.item_type || '',
      audience_level: listRow.audience_level || '',
      target_grades: targetGrades,
      targetGrades,
      domain: catalogGroup === 'after_school' ? 'חוגי אפטרסקול' : '',
      scope,
      session_duration: row.unit_duration || '',
      meetings_count: row.meetings_count,
      hours_count: row.hours_count,
      unit_duration: row.unit_duration || '',
      gefen_number: row.gefen_number || listRow.gefen_number || '',
      gefenNumber: row.gefen_number || listRow.gefen_number || '',
      item_type: catalogGroupToProductType(catalogGroup, row),
      opening_line: row.description_for_proposal || '',
      core_idea: row.description_for_proposal || '',
      program_flow: '',
      student_develops: '',
      participants_receive: '',
      school_value: '',
      final_outcome: '',
      page_template: catalogGroup,
      catalog_short_description: row.description_for_proposal || '',
      catalog_core_idea: row.description_for_proposal || '',
      catalog_goals: '',
      catalog_program_flow: '',
      catalog_participants_receive: '',
      catalog_school_value: '',
      catalog_syllabus: syllabusForProgram(row.gefen_number, listRow.gefen_number, key),
      catalog_page_template: catalogGroup
    };
  });

  const programs = [...detailPrograms, ...pricingPrograms];

  return {
    programs,
    error: (detailsRes?.error || pricingRes?.error || syllabusRes?.error) ? 'לא ניתן לטעון את נתוני הקטלוג. בדקו חיבור והרשאות.' : ''
  };
}
export const api = {
  login: async (user_id, entry_code) => {
    const [{ userRow: user, profileRow }, listsData, settingsRows] = await Promise.all([
      loginWithSupabaseAuth(user_id, entry_code),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => [])
    ]);
    const token = makeSessionToken(user);
    const flat = flattenUserRow(user);
    const hasPersonalReportsAccess = profileCanAccessPersonalReports(profileRow);
    return {
      token,
      user: {
        user_id: flat.user_id,
        email: String(user.email || '').trim(),
        display_role: flat.role,
        display_role_label: flat.display_role_label,
        display_role2: flat.display_role2,
        full_name: flat.full_name,
        emp_id: flat.emp_id,
        auth_user_id: flat.auth_user_id,
        personal_reports_user_id: flat.auth_user_id,
        can_add_activity: canDirectManageActivitiesUser(flat) || ACTIVITY_REQUEST_ROLES.has(String(flat.role || '').trim()),
        can_edit_direct: canDirectManageActivitiesUser(flat),
        can_request_edit: canSubmitActivityRequestsUser(flat),
        can_review_requests: canDirectManageActivitiesUser(flat),
        finance_access: (flat.role === 'finance' || permissionFlagYes(flat.finance_access) || permissionFlagYes(flat.view_finance)),
        profile_is_active: profileRow?.is_active !== false,
        can_access_personal_reports: hasPersonalReportsAccess,
        personal_reports_manager: permissionFlagYes(flat.personal_reports_manager) ? 'yes' : 'no',
        view_proposals_agreements: permissionFlagYes(flat.view_proposals_agreements) || permissionFlagYes(flat.manage_proposals_agreements) || undefined,
        manage_proposals_agreements: permissionFlagYes(flat.manage_proposals_agreements) || undefined
      },
      ...buildBootstrapFromUser(user, profileRow),
      client_settings: buildClientSettingsFromLists(listsData, settingsRows)
    };
  },
  bootstrap: async () => {
    await waitForSupabaseAuthSession();
    const [{ userRow: user, profileRow }, listsData, settingsRows] = await Promise.all([
      readCurrentUserBySession(),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => [])
    ]);
    return {
      ...buildBootstrapFromUser(user, profileRow),
      client_settings: buildClientSettingsFromLists(listsData, settingsRows)
    };
  },
  dashboard: (filters) => api.dashboardReadModel(filters || {}),
  dashboardSnapshot: (filters) => api.dashboardReadModel(filters || {}),
  dashboardSheet: (filters) => api.dashboardReadModel(filters || {}),
  dashboardReadModel: async (filters, options) => {
    void options;
    const resolved = (filters && typeof filters === 'object') ? filters : {};
    const candidate = String(resolved.month || resolved.ym || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    let month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    if (candidate && candidate !== month) {
      console.warn('[dashboard] fallback month returned', { requested_month: candidate, fallback_month: month, reason: 'invalid_month_format' });
    }
    const canonical = { ...resolved, month };
    const supabasePayload = await dashboardReadModelFromSupabase(month);
    const supabaseError = supabasePayload?.error || supabasePayload?._debug?.error;
    if (!supabasePayload || typeof supabasePayload !== 'object' || supabaseError) {
      warnDashboardSupabasePathFailed(supabaseError || 'dashboard_null_payload', { month, requested_month: candidate || month });
      // Supabase-only client: do not fabricate KPI=0 payloads when source reads fail.
      throw new Error('טעינת נתוני לוח הבקרה נכשלה. מקור Supabase לא החזיר נתונים תקינים ואין fallback פעיל.');
    }
    if (supabasePayload.month && supabasePayload.month !== month) {
      console.warn('[dashboard] fallback month returned', { requested_month: month, returned_month: supabasePayload.month });
      month = supabasePayload.month;
    }
    return { ...supabasePayload, ...canonical, month };
  },
  archiveActivities: async () => {
    const data = await readArchiveActivitiesFromSupabase();
    if (data) return data;
    return buildSupabaseErrorPayload({ rows: [] }, 'archive_supabase_failed');
  },
  allActivities: async () => {
    const rows = await readAllActivitiesRowsSupabase();
    return { rows, _source: 'supabase' };
  },
  activities: async (filters, options) => {
    const resolvedFilters = filters || {};
    const supabaseData = await readActivitiesFromSupabase(resolvedFilters);
    if (supabaseData) return normalizeData(supabaseData);
    return normalizeData(buildSupabaseErrorPayload({ rows: [] }, 'activities_supabase_failed', { filters: resolvedFilters }));
  },
  activityLayoutStatuses: async (payload = {}) => {
    const role = String(state?.user?.display_role || state?.user?.role || '').trim();
    if (!['admin', 'operation_manager'].includes(role)) throw new Error('activity_layout_forbidden');
    const season = String(payload?.season || 'summer_2026').trim() || 'summer_2026';
    const { data, error } = await supabase
      .from('activity_layout_statuses')
      .select('season,authority,school,sent,sent_at,sent_by')
      .eq('season', season);
    if (error) throw new Error(error.message || 'activity_layout_statuses_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  saveActivityLayoutStatus: async (payload = {}) => {
    const role = String(state?.user?.display_role || state?.user?.role || '').trim();
    if (!['admin', 'operation_manager'].includes(role)) throw new Error('activity_layout_forbidden');
    const row = {
      season: String(payload?.season || 'summer_2026').trim() || 'summer_2026',
      authority: String(payload?.authority || '').trim(),
      school: String(payload?.school || '').trim(),
      sent: payload?.sent === true || String(payload?.sent || '').trim().toLowerCase() === 'yes',
      sent_at: payload?.sent_at || new Date().toISOString(),
      sent_by: String(payload?.sent_by || state?.user?.full_name || state?.user?.user_id || '').trim()
    };
    if (!row.authority || !row.school) throw new Error('missing_activity_layout_status_fields');
    const { data, error } = await supabase
      .from('activity_layout_statuses')
      .upsert(row, { onConflict: 'season,authority,school' })
      .select('season,authority,school,sent,sent_at,sent_by')
      .single();
    if (error) throw new Error(error.message || 'activity_layout_status_save_failed');
    clearScreenDataCache();
    deletePersistedCacheByPrefixes(['activities:']);
    return { ok: true, row: data || row };
  },
  activityDetail: (source_row_id, source_sheet) => readActivityDetailFromSupabase(source_row_id, source_sheet),
  activityDates: (source_row_id, source_sheet) => readActivityDatesFromSupabase(source_row_id, source_sheet),
  week: async (params) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const weekOffset = Number.parseInt(resolved.week_offset, 10);
    const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
    const payload = await readWeekFromSupabase(offset);
    return String(state?.user?.display_role || '') === 'instructor'
      ? filterCalendarPayloadForInstructor(payload)
      : payload;
  },
  month: async (params) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const candidate = String(resolved.ym || resolved.month || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ym = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    const payload = await readMonthFromSupabase(ym);
    return String(state?.user?.display_role || '') === 'instructor'
      ? filterCalendarPayloadForInstructor(payload)
      : payload;
  },
  exceptions: (params, options) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    return readExceptionsFromSupabase(resolved);
  },
  instructors: async () => {
    const supabaseData = await readInstructorsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ rows: [] }, 'instructors_supabase_failed');
  },
  instructorContacts: async () => {
    const supabaseData = await readInstructorContactsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ rows: [] }, 'instructor_contacts_supabase_failed');
  },
  contacts: async () => {
    const supabaseData = await readContactsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ instructor_rows: [], school_rows: [], can_view_instructors: true, can_view_schools: true }, 'contacts_supabase_failed');
  },
  endDates: () => readEndDatesFromSupabase(),
  getCatalogPrograms: () => readCatalogProgramsFromSupabase(),
  myData: async () => {
    const allRows = await readAllActivitiesRowsSupabase();
    const idsSet = getInstructorIdentitySet();
    const rows = allRows.filter((row) => {
      if (isActivityClosed(row)) return false;
      return isInstructorAssignedRow(row, idsSet);
    });
    return { rows, _source: 'supabase' };
  },
  operations: async (params = {}) => {
    const allRows = await readAllActivitiesRowsSupabase();
    const rows = filterOperationsRows(allRows, params || {});
    return { rows, _source: 'supabase' };
  },
  operationsDetail: async (source_row_id, source_sheet) => readActivityDetailFromSupabase(source_row_id, source_sheet),
  editRequests: async () => {
    const { data, error } = await supabase
      .from('edit_requests')
      .select('*')
      .order('requested_at', { ascending: false });
    if (error) throw new Error(error.message || 'edit_requests_read_failed');
    const currentUserId = String(state?.user?.user_id || '').trim();
    const canReview = canReviewEditRequestsUser();
    const rows = (Array.isArray(data) ? data : []).filter((row) => {
      if (canReview) return true;
      return currentUserId && String(row?.requested_by_user_id || '').trim() === currentUserId;
    });
    const uniqueIds = [...new Set(
      rows
        .map((r) => String(r?.source_row_id || '').trim())
        .filter((id) => id.length > 0)
    )];
    const activityByRowId = {};
    await Promise.all(uniqueIds.map(async (id) => {
      try {
        const rsp = await readActivityDetailFromSupabase(id, 'activities');
        activityByRowId[id] = rsp?.row || null;
      } catch {
        activityByRowId[id] = null;
      }
    }));
    return buildEditRequestGroups(rows, canReview, activityByRowId);
  },
  editRequestsOpenCount: async () => {
    const openStatuses = ['pending', 'open', 'awaiting approval', 'awaiting_approval'];
    let query = supabase
      .from('edit_requests')
      .select('request_id', { count: 'exact', head: true })
      .in('status', openStatuses);
    if (!canReviewEditRequestsUser()) {
      const currentUserId = String(state?.user?.user_id || '').trim();
      if (!currentUserId) return 0;
      query = query.eq('requested_by_user_id', currentUserId);
    }
    const { count, error } = await query;
    if (error) throw new Error(error.message || 'edit_requests_open_count_failed');
    return Number.isFinite(count) ? Number(count) : 0;
  },
  proposalsAgreements: async () => readProposalsAgreementsFromSupabase(),
  permissions: async () => {
    if (!supabase) throw new Error('no_supabase_client');
    const { data, error } = await supabase.from('users').select(USER_PUBLIC_COLUMNS).order('created_at', { ascending: false });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[permissions] Supabase error:', error.code, error.message, error.details, error.hint);
      throw new Error(error.message || 'permissions_read_failed');
    }
    const profileMap = await readPersonalReportsProfilesByAuthIds(
      (Array.isArray(data) ? data : []).map((row) => row?.auth_user_id)
    );
    const rows = (Array.isArray(data) ? data : []).map((row) => {
      const flat = flattenUserRow(row);
      const profileRow = profileMap.get(String(row?.auth_user_id || '').trim()) || null;
      return mergePersonalReportsProfileIntoFlatUser(flat, profileRow);
    });
    return {
      rows,
      roleDefaults: {
        admin: { can_add_activity: 'yes', can_edit_direct: 'yes', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'yes', view_permissions: 'yes', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'yes', view_israa_management: 'yes', can_access_personal_reports: 'yes' },
        operation_manager: { can_add_activity: 'yes', can_edit_direct: 'yes', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'yes', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        authorized_user: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_proposals: 'no', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        finance: { can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', finance_access: 'yes', view_finance: 'yes', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'no', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        activities_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'no', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        domain_manager: { can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'yes', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        business_development_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'yes', view_israa_management: 'no', finance_access: 'no', can_access_personal_reports: 'yes' },
        instructor_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', view_proposals: 'no', view_israa_management: 'no', can_access_personal_reports: 'yes' },
        instructor: { can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'no', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_proposals: 'no', view_israa_management: 'no', can_access_personal_reports: 'yes' }
      }
    };
  },
  saveClientSetting: async (payload) => {
    const key = String(payload?.key || '').trim();
    const value = String(payload?.value || '').trim();
    if (!key) throw new Error('missing_setting_key');
    const allowedKeys = new Set(['accent_color', 'theme_accent', 'ui_accent_color']);
    if (!allowedKeys.has(key)) throw new Error('unsupported_setting_key');
    const { error } = await supabase
      .from('settings')
      .upsert({ key, value, description: 'UI accent color' }, { onConflict: 'key' });
    if (error) throw new Error(error.message || 'client_setting_save_failed');
    return { ok: true, key, value };
  },
  adminSettings: async (payload) => {
    if (payload && typeof payload === 'object' && String(payload.key || '').trim()) {
      const key = String(payload.key || '').trim();
      const value = String(payload.value || '');
      const description = String(payload.description || '');
      const { error: writeErr } = await supabase
        .from('settings')
        .upsert({ key, value, description }, { onConflict: 'key' });
      if (writeErr) throw new Error(writeErr.message || 'admin_settings_save_failed');
      clearScreenDataCache();
      deletePersistedCacheByPrefixes(['adminSettings', 'dashboard:', 'activities:', 'week:', 'month:']);
    }
    const rows = await readSettingsRowsFromSupabase();
    return { rows, _source: 'supabase' };
  },
  adminLists: async () => {
    const supabaseData = await readListsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ categories: [] }, 'admin_lists_supabase_failed');
  },
  addProposalAgreement: async (payload) => {
    assertCanManageProposalsAgreementsApi();
    const insert = sanitizeProposalAgreementPayload(payload);
    const contactSchoolId = await ensureContactSchoolFromProposal({ ...insert, _contact_original: payload?._contact_original });
    if (contactSchoolId != null) insert.contact_school_id = contactSchoolId;
    const { data, error } = await supabase
      .from('proposals_agreements')
      .insert(insert)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_add_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  updateProposalAgreement: async (id, payload) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const patch = sanitizeProposalAgreementPayload(payload);
    const contactSchoolId = await ensureContactSchoolFromProposal({ ...patch, _contact_original: payload?._contact_original });
    if (contactSchoolId != null) patch.contact_school_id = contactSchoolId;
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_update_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },

  deleteProposalAgreement: async (id) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const { error } = await supabase
      .from('proposals_agreements')
      .delete()
      .eq('id', rowId);
    if (error) throw new Error(error.message || 'proposals_agreement_delete_failed');
    return { ok: true, id: rowId };
  },
  updateProposalAgreementStatus: async (id, status, approvalNote = '') => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    const cleanStatus = cleanProposalAgreementText(status);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    if (!PA_VALID_STATUSES_SET.has(cleanStatus)) throw new Error('invalid_proposal_agreement_status');
    const patch = { status: cleanStatus, approval_note: cleanProposalAgreementText(approvalNote) };
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_status_update_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  readProposalAgreementItems: async (proposalId) => {
    assertCanUseProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) return [];
    const { data, error } = await supabase
      .from('proposal_agreement_items')
      .select('id,activity_no,item_name,item_type,gefen_number,meetings_count,hours_count,quantity,unit_duration,unit_price,hourly_price,total_price,description,proposal_group,sort_order')
      .eq('proposal_agreement_id', rowId)
      .order('sort_order', { ascending: true });
    if (error) throw new Error(error.message || 'items_read_failed');
    return (Array.isArray(data) ? data : []).map((item) => ({
      id:             cleanProposalAgreementText(item.id),
      activity_no:    cleanProposalAgreementText(item.activity_no),
      pricing_activity_no: cleanProposalAgreementText(item.activity_no),
      item_name:      cleanProposalAgreementText(item.item_name),
      item_type:      cleanProposalAgreementText(item.item_type),
      gefen_number:   cleanProposalAgreementText(item.gefen_number),
      meetings_count: item.meetings_count != null ? Number(item.meetings_count) : null,
      hours_count:    item.hours_count != null ? Number(item.hours_count) : null,
      quantity:       item.quantity != null ? Number(item.quantity) || 1 : 1,
      unit_price:     item.unit_price != null ? Number(item.unit_price) : null,
      hourly_price:   item.hourly_price != null ? Number(item.hourly_price) : null,
      total_price:    item.total_price != null ? Number(item.total_price) : null,
      description:    cleanProposalAgreementText(item.description),
      unit_duration:  cleanProposalAgreementText(item.unit_duration),
      proposal_group: cleanProposalAgreementText(item.proposal_group),
      sort_order:     Number(item.sort_order) || 0
    }));
  },
  readProposalActivityPricing: async () => {
    assertCanUseProposalsAgreementsApi();
    return readProposalActivityPricingFromSupabase();
  },
  readProposalTemplateSections: async () => {
    assertCanUseProposalsAgreementsApi();
    return readProposalTemplateSectionsFromSupabase();
  },

  saveProposalAgreementCustomDocumentSections: async (proposalId, sections) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const cleanSections = (Array.isArray(sections) ? sections : []).map((section) => ({
      section_key: cleanProposalAgreementText(section?.section_key),
      section_title: cleanProposalAgreementText(section?.section_title),
      section_body: normalizeProposalAgreementMultilineText(section?.section_body)
    })).filter((section) => section.section_key);
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update({ custom_document_sections: cleanSections })
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_custom_document_sections_update_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  saveProposalAgreementItems: async (proposalId, items) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const { error: delError } = await supabase
      .from('proposal_agreement_items')
      .delete()
      .eq('proposal_agreement_id', rowId);
    if (delError) throw new Error(delError.message || 'items_delete_failed');
    const validItems = (Array.isArray(items) ? items : [])
      .filter((i) => cleanProposalAgreementText(i.item_name) && !isProposalTestHoursItem(i))
      .map((item, idx) => ({
        proposal_agreement_id: rowId,
        activity_no:    cleanProposalAgreementText(item.activity_no || item.pricing_activity_no),
        item_name:      cleanProposalAgreementText(item.item_name),
        item_type:      cleanProposalAgreementText(item.item_type),
        gefen_number:   cleanProposalAgreementText(item.gefen_number),
        meetings_count: item.meetings_count != null ? Number(item.meetings_count) || null : null,
        hours_count:    item.hours_count != null ? Number(item.hours_count) || null : null,
        quantity:       Number(item.quantity) || 1,
        unit_price:     item.unit_price != null ? Number(item.unit_price) || null : null,
        hourly_price:   item.hourly_price != null ? Number(item.hourly_price) || null : null,
        total_price:    item.total_price != null ? Number(item.total_price) || null : null,
        description:    cleanProposalAgreementText(item.description),
        unit_duration:  cleanProposalAgreementText(item.unit_duration),
        proposal_group: cleanProposalAgreementText(item.proposal_group),
        sort_order:     idx
      }));
    if (!validItems.length) return { ok: true, items: [] };
    const { data, error } = await supabase
      .from('proposal_agreement_items')
      .insert(validItems)
      .select('id,item_name,sort_order');
    if (error) throw new Error(error.message || 'items_insert_failed');
    return { ok: true, items: Array.isArray(data) ? data : [] };
  },
  addContact: async (payload) => {
    const kind = String(payload?.kind || '').trim();
    const row = payload?.row || {};
    if (kind === 'instructor') {
      const { error } = await supabase.from('contacts_instructors').upsert(row, { onConflict: 'emp_id' });
      if (error) throw new Error(error.message || 'add_contact_failed');
      return { ok: true };
    }
    if (kind === 'school') {
      const nextRow = { ...row };
      if (nextRow.role !== undefined && nextRow.contact_role === undefined) nextRow.contact_role = nextRow.role;
      delete nextRow.role;
      if (!nextRow.client_type) nextRow.client_type = 'school';
      if (!nextRow.client_name) {
        nextRow.client_name = nextRow.client_type === 'authority'
          ? (nextRow.authority || null)
          : (nextRow.school || nextRow.authority || null);
      }
      if (!nextRow.active) nextRow.active = 'פעיל';
      const { error } = await supabase.from('contacts_schools').upsert(nextRow, { onConflict: 'authority,school,contact_name' });
      if (error) throw new Error(error.message || 'add_contact_failed');
      return { ok: true };
    }
    throw new Error('invalid_contact_kind');
  },
  saveContact: async (payload) => {
    const kind = String(payload?.kind || '').trim();
    const row = payload?.row || {};
    if (kind === 'instructor') {
      const empId = String(row.emp_id || '').trim();
      if (!empId) throw new Error('missing_instructor_key:emp_id');
      const updateBody = {
        full_name:        String(row.full_name        || '').trim() || null,
        mobile:           String(row.mobile           || '').trim() || null,
        email:            String(row.email            || '').trim() || null,
        address:          String(row.address          || '').trim() || null,
        employment_type:  String(row.employment_type  || '').trim() || null,
        direct_manager:   String(row.direct_manager   || '').trim() || null,
        active:           String(row.active           || 'yes').trim()
      };
      const { error } = await supabase
        .from('contacts_instructors')
        .update(updateBody)
        .eq('emp_id', empId)
        .select()
        .single();
      if (error) throw new Error(error.message || 'save_contact_failed');
      return { ok: true };
    }
    if (kind === 'school') {
      const id = row.id != null ? row.id : null;
      if (id == null) throw new Error('missing_school_key:id');
      const clientType = String(row.client_type || 'school').trim();
      const updateBody = {
        client_type:  clientType,
        client_name:  String(row.client_name || (clientType === 'authority' ? row.authority : row.school) || '').trim() || null,
        authority:    String(row.authority    || '').trim() || null,
        school:       String(row.school       || '').trim() || null,
        contact_name: String(row.contact_name || '').trim() || null,
        contact_role: String(row.contact_role ?? row.role ?? '').trim() || null,
        phone:        String(row.phone        || '').trim() || null,
        mobile:       String(row.mobile       || '').trim() || null,
        email:        String(row.email        || '').trim() || null,
        address:      String(row.address      || '').trim() || null,
        notes:        String(row.notes        || '').trim() || null
      };
      const { error } = await supabase
        .from('contacts_schools')
        .update(updateBody)
        .eq('id', id)
        .select()
        .single();
      if (error) throw new Error(error.message || 'save_contact_failed');
      return { ok: true };
    }
    throw new Error('invalid_contact_kind');
  },
  addProposalClient: async (payload) => {
    const clientType = String(payload.client_type || 'school').trim();
    const row = {
      client_type:  clientType,
      client_name:  String(payload.client_name || (clientType === 'authority' ? payload.authority : payload.school) || '').trim() || null,
      authority:    String(payload.authority    || '').trim() || null,
      school:       String(payload.school       || '').trim() || null,
      contact_name: String(payload.contact_name || '').trim() || null,
      contact_role: String(payload.contact_role || '').trim() || null,
      phone:        String(payload.phone        || '').trim() || null,
      mobile:       String(payload.mobile       || '').trim() || null,
      email:        String(payload.email        || '').trim() || null,
      address:      String(payload.address      || '').trim() || null,
      notes:        String(payload.notes        || '').trim() || null,
      active:       String(payload.active       || 'פעיל').trim()
    };
    const { data, error } = await supabase
      .from('contacts_schools')
      .insert(row)
      .select()
      .single();
    if (error) throw new Error(error.message || 'add_proposal_client_failed');
    return { ok: true, row: data };
  },
  addActivity: async (target, data) => {
    if (!canDirectManageActivitiesUser()) throw new Error('forbidden_add_activity');
    const payload = (typeof target === 'object' && target !== null && data === undefined)
      ? { activity: target }
      : { activity: { ...(data || {}), source: target } };
    return upsertActivityToSupabase(payload);
  },
  submitCreateActivityRequest: async (activity) => {
    if (!canSubmitActivityRequestsUser()) throw new Error('forbidden_create_activity_request');
    const currentUser = state?.user || {};
    const requestedPayload = sanitizeActivityPayloadForSupabase(
      synchronizeStartDateAndFirstMeeting(sanitizeActivityPayload(activity || {})),
      { includeRowId: true }
    );
    if (!Object.keys(requestedPayload).length) throw new Error('missing_activity_request_payload');
    const row = {
      request_id: `REQ-${Date.now()}`,
      source_row_id: '',
      source_sheet: 'activities',
      request_type: 'create_activity',
      requested_payload: requestedPayload,
      activity_name: String(requestedPayload.activity_name || '').trim(),
      school: String(requestedPayload.school || '').trim(),
      authority: String(requestedPayload.authority || '').trim(),
      changed_fields: JSON.stringify([]),
      original_values: JSON.stringify({}),
      requested_values: JSON.stringify({}),
      status: 'pending',
      active: 'yes',
      requested_by_user_id: String(currentUser?.user_id || '').trim(),
      requested_by_name: String(currentUser?.full_name || currentUser?.profile?.full_name || '').trim(),
      requested_at: new Date().toISOString()
    };
    const { error } = await supabase.from('edit_requests').insert(row);
    if (error) throw buildSupabaseMutationError('submitCreateActivityRequest', error, 'submit_create_activity_request_failed');
    logActivityMutationDebug('success', 'submitCreateActivityRequest', { source_sheet: 'activities', source_row_id: '', changes: requestedPayload }, { table: 'edit_requests', request_id: row.request_id });
    return { request_id: row.request_id, status: 'pending', request_type: 'create_activity' };
  },
  /** מקבל אובייקט מלא (כולל source_sheet, changes) או חתימה ישנה (id, changes). */
  saveActivity: async (a, b) => {
    const payload = (b !== undefined && b !== null)
      ? { source_row_id: a, changes: b }
      : a;
    const userRole = String(state?.user?.display_role || state?.user?.role || '').trim();
    const canEditDirect = canDirectManageActivitiesUser();
    if (!canEditDirect && canSubmitActivityRequestsUser()) {
      // eslint-disable-next-line no-console
      console.warn('wrong_flow: activities_manager attempted saveActivity; using submitEditRequest instead', {
        action: 'saveActivity',
        row_id: String(payload?.source_row_id || payload?.row_id || payload?.RowID || '').trim(),
        role: userRole
      });
      return api.submitEditRequest(payload);
    }
    if (!canEditDirect) throw new Error('forbidden_save_activity');
    return updateActivityInSupabase(payload);
  },
  deleteActivity: async (source_row_id) => {
    const rowId = String(source_row_id || '').trim();
    if (!rowId) throw new Error('missing_row_id');
    const role = String(state?.user?.display_role || state?.user?.role || '').trim();
    if (!['admin', 'operation_manager'].includes(role)) throw new Error('forbidden_delete_activity');
    const { data, error } = await supabase
      .from('activities')
      .update({ status: DELETED_STATUS })
      .eq('row_id', rowId)
      .select('row_id,status')
      .maybeSingle();
    if (error) throw new Error(error.message || 'delete_activity_failed');
    if (!data) throw new Error('activity_not_found_or_forbidden');
    if (String(data?.status || '').trim() !== DELETED_STATUS) throw new Error('delete_activity_not_confirmed');
    return { ok: true, row_id: rowId, status: DELETED_STATUS };
  },
  submitEditRequest: async (source_row_id, changes, source_sheet = 'activities') => {
    const requestPayload = (source_row_id && typeof source_row_id === 'object') ? source_row_id : null;
    if (!canSubmitActivityRequestsUser()) throw new Error('forbidden_submit_edit_request');
    const rowId = String(requestPayload?.source_row_id || source_row_id || '').trim();
    const sourceSheet = String(requestPayload?.source_sheet || source_sheet || 'activities').trim() || 'activities';
    const rawChanges = requestPayload?.changes || changes || {};
    const reducedChanges = Object.entries(rawChanges).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) return acc;
      const normalizedValue = String(value).trim();
      acc[key] = normalizedValue;
      return acc;
    }, {});
    const normalizedChanges = sanitizeActivityPayloadForSupabase(
      synchronizeStartDateAndFirstMeeting(mapMeetingDateFieldNamesToSupabase(reducedChanges)),
      { includeRowId: false }
    );
    const debugPayload = { source_sheet: sourceSheet, source_row_id: rowId, changes: normalizedChanges };
    logActivityMutationDebug('request', 'submitEditRequest', debugPayload, { table: 'edit_requests' });
    if (!rowId || !Object.keys(normalizedChanges).length) {
      throw new Error('No changes to submit');
    }
    const currentUser = state?.user || {};
    const changedKeys = Object.keys(normalizedChanges);
    let originalValuesMap = {};
    let snapshotName = '';
    let snapshotSchool = '';
    let snapshotAuthority = '';
    try {
      const { row: liveRow } = await readActivityDetailFromSupabase(rowId, sourceSheet);
      if (liveRow) {
        snapshotName = String(liveRow.activity_name || '').trim();
        snapshotSchool = String(liveRow.school || '').trim();
        snapshotAuthority = String(liveRow.authority || '').trim();
        for (const key of changedKeys) {
          originalValuesMap[key] = String(liveRow[key] ?? '').trim();
        }
      }
    } catch {
      originalValuesMap = {};
    }
    const row = {
      request_id: `REQ-${Date.now()}`,
      source_row_id: rowId,
      source_sheet: sourceSheet,
      activity_name: snapshotName,
      school: snapshotSchool,
      authority: snapshotAuthority,
      changed_fields: JSON.stringify(changedKeys),
      original_values: JSON.stringify(originalValuesMap),
      requested_values: JSON.stringify(normalizedChanges),
      request_type: 'edit_activity',
      status: 'pending',
      active: 'yes',
      requested_by_user_id: String(currentUser?.user_id || '').trim(),
      requested_by_name: String(currentUser?.full_name || currentUser?.profile?.full_name || '').trim(),
      requested_at: new Date().toISOString()
    };
    const { error } = await supabase.from('edit_requests').insert(row);
    if (error) {
      const authContext = await buildActivityMutationAuthContext();
      // eslint-disable-next-line no-console
      console.error('[activity-save-error]', {
        action: 'submitEditRequest',
        table: 'edit_requests',
        row_id: rowId,
        auth_uid: authContext.auth_uid,
        user_id: authContext.user_id,
        role: authContext.role,
        can_edit_direct: authContext.can_edit_direct,
        can_add_activity: authContext.can_add_activity,
        supabase_error_code: error?.code || error?.status || '',
        supabase_error_message: String(error?.message || 'submit_edit_request_failed'),
        supabase_error_details: String(error?.details || ''),
        payload: row,
        error
      });
      throw buildSupabaseMutationError('submitEditRequest', error, 'submit_edit_request_failed');
    }
    logActivityMutationDebug('success', 'submitEditRequest', debugPayload, { table: 'edit_requests', request_id: row.request_id });
    return { request_id: row.request_id, status: 'pending' };
  },
  reviewEditRequest: async (request_id, status) => {
    const requestId = String(request_id || '').trim();
    const nextStatus = String(status || '').trim();
    if (!requestId) throw new Error('missing_request_id');
    if (!['approved', 'rejected'].includes(nextStatus)) throw new Error('invalid_review_status');
    if (!canReviewEditRequestsUser()) throw new Error('forbidden_review_edit_request');
    const reqRes = await supabase
      .from('edit_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();
    if (reqRes.error || !reqRes.data) throw new Error(reqRes.error?.message || 'review_edit_request_failed');
    const reqRow = reqRes.data;
    if (String(reqRow?.status || '').trim() !== 'pending') throw new Error('edit_request_already_reviewed');
    if (nextStatus === 'approved') {
      const requestType = normalizeEditRequestType(reqRow?.request_type);
      const sourceRowId = String(reqRow?.source_row_id || '').trim();
      if (requestType === 'create_activity') {
        const requestedPayload = sanitizeActivityPayloadForSupabase(
          synchronizeStartDateAndFirstMeeting(parseJsonishObject(reqRow?.requested_payload)),
          { includeRowId: true }
        );
        if (!Object.keys(requestedPayload).length) throw new Error('missing_create_activity_payload');
        await upsertActivityToSupabase({ activity: requestedPayload });
      } else {
        const requestedValues = parseJsonishObject(reqRow?.requested_values);
        if (sourceRowId && requestedValues && Object.keys(requestedValues).length) {
          const sanitizedRequestedValues = sanitizeActivityPayloadForSupabase(
            mapMeetingDateFieldNamesToSupabase(requestedValues),
            { includeRowId: false }
          );
          const { data: appliedRow, error: applyErr } = await supabase
            .from('activities')
            .update(sanitizedRequestedValues)
            .eq('row_id', sourceRowId)
            .select('row_id')
            .maybeSingle();
          if (applyErr || !appliedRow) {
          const authContext = await buildActivityMutationAuthContext();
          // eslint-disable-next-line no-console
          console.error('[activity-save-error]', {
            action: 'reviewEditRequest',
            table: 'activities',
            row_id: sourceRowId,
            auth_uid: authContext.auth_uid,
            user_id: authContext.user_id,
            role: authContext.role,
            can_edit_direct: authContext.can_edit_direct,
            can_add_activity: authContext.can_add_activity,
            supabase_error_code: applyErr?.code || applyErr?.status || '',
            supabase_error_message: String(applyErr?.message || (!appliedRow ? 'activity_not_found_or_forbidden' : 'review_edit_request_apply_failed')),
            supabase_error_details: String(applyErr?.details || ''),
            payload: {
              request_id: requestId,
              source_row_id: sourceRowId,
              requested_values: sanitizedRequestedValues
            },
            error: applyErr
          });
          throw buildSupabaseMutationError('reviewEditRequest', applyErr || new Error('activity_not_found_or_forbidden'), 'review_edit_request_apply_failed');
          }
        }
      }
    }
    const reviewer = state?.user || {};
    const { error } = await supabase
      .from('edit_requests')
      .update({
        status: nextStatus,
        reviewed_at: new Date().toISOString(),
        reviewer_user_id: String(reviewer?.user_id || '').trim(),
        reviewed_by: String(reviewer?.full_name || reviewer?.profile?.full_name || '').trim()
      })
      .eq('request_id', requestId);
    if (error) throw new Error(error.message || 'review_edit_request_failed');
    return { request_id: requestId, status: nextStatus };
  },
  savePermission: async (row) => {
    const userId = String(row?.user_id || '').trim();
    if (!userId) throw new Error('missing_user_id');
    const existing = await supabase.from('users').select(USER_PUBLIC_COLUMNS).eq('user_id', userId).single();
    if (existing.error || !existing.data) throw new Error('user_not_found');
    const permissions = { ...(existing.data.permissions || {}) };
    Object.entries(row || {}).forEach(([k, v]) => {
      if (['user_id', 'role', 'active', 'full_name', 'entry_code', 'emp_id', 'display_role2', 'can_access_personal_reports'].includes(k)) return;
      permissions[k] = v;
    });
    const nextRole = row.role || existing.data.role;
    if (nextRole === 'business_development_manager') {
      Object.assign(permissions, {
        can_add_activity: 'yes',
        can_edit_direct: 'no',
        can_request_edit: 'yes',
        can_review_requests: 'no',
        view_admin: 'no',
        view_permissions: 'no',
        finance_access: 'no',
        view_catalog: 'yes',
        view_orders: 'yes'
      });
    }
    const patch = {
      role: nextRole,
      is_active: String(row.active || '').toLowerCase() !== 'no',
      name: row.full_name ?? existing.data.name,
      emp_id: row.emp_id ?? existing.data.emp_id,
      permissions: {
        ...permissions,
        display_role2: row.display_role2 ?? permissions.display_role2 ?? ''
      }
    };
    const { error } = await supabase.from('users').update(patch).eq('user_id', userId);
    if (error) throw new Error(error.message || 'save_permission_failed');
    const authUserId = String(existing.data.auth_user_id || '').trim();
    if (authUserId && Object.prototype.hasOwnProperty.call(row || {}, 'can_access_personal_reports')) {
      const profilePatch = {
        can_access_personal_reports: personalReportsProfileFlagYes(row.can_access_personal_reports)
      };
      const { error: profileError } = await supabase
        .from('profiles')
        .update(profilePatch)
        .eq('id', authUserId);
      if (profileError) throw new Error(profileError.message || 'save_personal_reports_profile_failed');
    }
    return { ok: true };
  },
  addUser: async (row) => {
    const role = String(row?.role || 'instructor').trim();
    const permissions = role === 'business_development_manager'
      ? { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no', view_catalog: 'yes', view_orders: 'yes', finance_access: 'no' }
      : { can_request_edit: 'yes' };
    const insert = {
      user_id: String(row?.user_id || '').trim(),
      email: null,
      name: String(row?.full_name || '').trim(),
      role,
      emp_id: String(row?.user_id || '').trim(),
      is_active: true,
      entry_code: String(row?.entry_code || '').trim(),
      permissions
    };
    const { error } = await supabase.from('users').insert(insert);
    if (error) throw new Error(error.message || 'add_user_failed');
    return { ok: true };
  },
  deactivateUser: async (user_id) => {
    const { error } = await supabase.from('users').update({ is_active: false }).eq('user_id', user_id);
    if (error) throw new Error(error.message || 'deactivate_user_failed');
    return { ok: true };
  },
  reactivateUser: async (user_id) => {
    const { error } = await supabase.from('users').update({ is_active: true }).eq('user_id', user_id);
    if (error) throw new Error(error.message || 'reactivate_user_failed');
    return { ok: true };
  },
  deleteUser: async (user_id) => {
    const { error } = await supabase.from('users').delete().eq('user_id', user_id);
    if (error) throw new Error(error.message || 'delete_user_failed');
    return { ok: true };
  },
  savePrivateNote: async (a, b, c) => {
    const payload = (typeof a === 'object' && a !== null)
      ? { source_row_id: a.source_row_id || a.row_id || a.RowID, note: a.note ?? a.note_text ?? '' }
      : { source_row_id: b, note: c };
    const rowId = String(payload.source_row_id || '').trim();
    if (!rowId) throw new Error('missing_row_id');
    const { error } = await supabase
      .from('activities')
      .update({ operations_private_notes: String(payload.note || '') })
      .eq('row_id', rowId);
    if (error) throw new Error(error.message || 'save_private_note_failed');
    return { ok: true };
  },
  listSheets: async () => {
    const rows = await readSettingsRowsFromSupabase();
    const map = new Map(rows.map((r) => [String(r.key || ''), String(r.value || '')]));
    const available = map.get('available_sheets');
    const sheets = (() => {
      try {
        const parsed = JSON.parse(String(available || '[]'));
        if (Array.isArray(parsed) && parsed.length) return parsed.map((name) => ({ name: String(name) }));
      } catch {
        /* ignore */
      }
      return [
        { name: 'activities' },
        { name: 'contacts_instructors' },
        { name: 'contacts_schools' },
        { name: 'lists' }
      ];
    })();
    return {
      sheets,
      sheet_roles: {
        sheet_activities: map.get('sheet_activities') || 'activities'
      },
      _source: 'supabase'
    };
  },
  saveSheetMapping: async (payload) => {
    const role = String(payload?.role || '').trim();
    const sheetName = String(payload?.sheet_name || '').trim();
    if (!role || !sheetName) throw new Error('missing_sheet_mapping_fields');
    const row = {
      key: role,
      value: sheetName,
      description: role === 'sheet_activities' ? 'Supabase source for activities' : 'Sheet mapping'
    };
    const { error } = await supabase.from('settings').upsert(row, { onConflict: 'key' });
    if (error) throw new Error(error.message || 'save_sheet_mapping_failed');
    return { ok: true };
  },
  israaProgramTracking: async () => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_program_tracking')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message || 'israa_program_tracking_read_failed');
    return { rows: Array.isArray(data) ? data : [] };
  },
  israaInsertRow: async (row) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_program_tracking')
      .insert([row])
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'israa_insert_failed');
    return { row: data };
  },
  israaUpdateRow: async (id, changes) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_program_tracking')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'israa_update_failed');
    return { row: data };
  },
  israaDeleteRow: async (id) => {
    await waitForSupabaseAuthSession();
    const { error } = await supabase
      .from('israa_program_tracking')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message || 'israa_delete_failed');
    return { ok: true };
  },
  israaSimulatorEntries: async () => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_revenue_simulator_entries')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message || 'israa_simulator_read_failed');
    return { rows: Array.isArray(data) ? data : [] };
  },
  israaSimInsertRow: async (row) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_revenue_simulator_entries')
      .insert([row])
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'israa_sim_insert_failed');
    return { row: data };
  },
  israaSimUpdateRow: async (id, changes) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase
      .from('israa_revenue_simulator_entries')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message || 'israa_sim_update_failed');
    return { row: data };
  },
  israaSimDeleteRow: async (id) => {
    await waitForSupabaseAuthSession();
    const { error } = await supabase
      .from('israa_revenue_simulator_entries')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message || 'israa_sim_delete_failed');
    return { ok: true };
  },
};

for (const action of Object.keys(MUTATING_ACTIONS)) {
  const original = api[action];
  if (typeof original !== 'function') continue;
  api[action] = async (...args) => {
    const result = await original(...args);
    invalidateScreenDataByAction(action);
    return result;
  };
}

export {
  isPerfDebugEnabled,
  getPerfStore,
  activityHasDateInRange,
  rowMatchesActivitiesFilters,
  rowExceptionTypesFromActivity,
  getActivityExceptions,
  buildExceptionsModelFromRows,
  normalizeActivityRow,
  sanitizeActivityPayload,
  sanitizeActivityPayloadForSupabase,
  normalizeOneDayActivityForSave,
  canonicalOneDayActivityType
};
