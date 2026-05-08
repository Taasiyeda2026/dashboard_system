import { state, setSession, clearScreenDataCache } from './state.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
import { supabase, supabaseConfig } from './supabase-client.js';

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
  reviewEditRequest: true,
  savePermission: true,
  addUser: true,
  deactivateUser: true,
  reactivateUser: true,
  deleteUser: true,
  savePrivateNote: true,
  saveSheetMapping: true
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
  adminSettings: true,
  adminLists: true,
  listSheets: true,
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
    if (!activityHasDateInRange(row, monthStart, monthEnd)) return false;
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
      .filter((row) => !isActivityClosed(row))
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

function normalizeActivityRow(row = {}) {
  const rowId = String(row?.row_id ?? row?.RowID ?? '').trim();
  const normalized = {
    ...row,
    row_id: rowId,
    RowID: rowId,
    source_sheet: 'activities',
    source_table: ACTIVITIES_TABLE,
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


function normalizeActivityTypeValue(value) {
  const raw = String(value || '').trim();
  const lower = raw.toLowerCase();
  const compact = lower.replace(/[\s_-]+/g, '');
  if (compact === 'course' || raw === 'קורס' || raw === 'קורסים') return 'course';
  if (compact === 'workshop' || raw === 'סדנה' || raw === 'סדנאות') return 'workshop';
  if (compact === 'tour' || raw === 'סיור' || raw === 'סיורים') return 'tour';
  if (compact === 'afterschool' || raw === 'חוג אפטרסקול' || raw === 'אפטרסקול') return 'after_school';
  if (compact === 'escaperoom' || raw === 'חדר בריחה') return 'escape_room';
  return lower || raw;
}

function rowActivityType(row = {}) {
  return normalizeActivityTypeValue(row?.activity_type || row?.type || row?.kind);
}

function isActivityClosed(row) {
  return String(row?.status || '').trim() === CLOSED_STATUS;
}

function isProgramActivity(row) {
  return String(row?.activity_family || '').trim() === 'program';
}

function isOneDayActivity(row) {
  return String(row?.activity_family || '').trim() === 'one_day';
}

function getActivityDateColumns(row = {}) {
  const dates = [];
  for (let i = 1; i <= 35; i++) {
    const dateKey = normalizeSupabaseDate(row?.[`date_${i}`] ?? row?.[`Date${i}`]);
    if (dateKey) dates.push(dateKey);
  }
  return [...new Set(dates)].sort();
}

function activityHasDateInRange(row, startDate, endDate) {
  return getActivityDateColumns(row).some((dateKey) => dateKey >= startDate && dateKey <= endDate);
}

function activityHasDateInMonth(row, monthPrefix) {
  const dates = getActivityDateColumns(row);
  if (dates.some((dateKey) => dateKey.startsWith(monthPrefix))) return true;
  // start_date is only a fallback when the activity has no meeting date columns.
  return dates.length === 0 && String(row?.start_date || '').slice(0, 7) === monthPrefix;
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
    const result = await supabase.from('lists').select('*').order('category').order('value');
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
      catMap.get(cat).push({ label, value, _row: row });
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

  const managerItems    = getItems('activity_manager', 'activity_managers', 'manager', 'managers');
  const instructorItems = getItems('instructor_users', 'instructor_name', 'instructor', 'instructors', 'instructor_names');
  const activityNameItems = getItems('activity_names', 'activity_name', 'activities', 'activity');
  const fundingValues   = getValues('funding', 'fundings');
  const gradeValues     = getValues('grade', 'grades', 'class');
  const schoolValues    = getValues('school', 'schools');
  const authorityValues = getValues('authority', 'authorities');

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
    label:        i.label || i.value,
    value:        i.value,
    activity_no:  String(i._row?.activity_no  || i._row?.number      || '').trim(),
    activity_type: String(i._row?.activity_type || i._row?.parent_value || i._row?.type || '').trim(),
    parent_value:  String(i._row?.parent_value  || i._row?.activity_type || i._row?.type || '').trim()
  }));

  const managerNames = managerItems.map((i) => i.value || i.label).filter(Boolean);

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
      activities_manager_users: managerNames.map((name) => ({ name })),
      instructor_name:          instructorUsers.map((u) => u.name),
      instructor_names:         instructorUsers.map((u) => u.name),
      instructor_users:         instructorUsers,
      activity_names:           activityNames,
    },
    one_day_activity_types: shortTypes,
    program_activity_types: longTypes,
    ...(accentColor ? { accent_color: accentColor, theme_accent: accentColor } : {}),
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

    const activeRows = activityRows.filter((row) => !isActivityClosed(row));
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
    return { rows, activities_loaded: true, _source: 'supabase' };
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
    { id: 'instructors', action: 'kpi|instructors', title: String(uniqueInstructorCount), subtitle: 'מדריכים פעילים', value: uniqueInstructorCount },
    { id: 'endings',     action: 'kpi|endings',     title: String(courseEndings),         subtitle: 'סיומי קורסים',   value: courseEndings },
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
  if (val === null || val === undefined) return '';
  const s = String(val).trim();
  const u = s.toUpperCase();
  if (u === 'NULL' || u === 'NONE' || u === 'UNDEFINED' || u === 'N/A' || u === '-') return '';
  return s;
}

/**
 * Normalize a date value to YYYY-MM-DD string, or '' if invalid.
 */
function normalizeSupabaseDate(val) {
  if (!val) return '';
  const s = String(val).trim();
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
      .filter((row) => !isActivityClosed(row));
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
    })).filter((row) => !isActivityClosed(row));
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
    const openRows = (await selectActivitiesByDateRangeFromSupabase({
      startDate: range.startDate,
      endDate: range.endDate,
      includeEndDate: true
    })).filter((row) => !isActivityClosed(row));
    const monthRows = openRows.filter((row) => activityHasDateInMonth(row, monthPrefix));
    const endingRows = openRows.filter((row) => rowActivityType(row) === 'course' && String(row?.end_date || '').slice(0, 7) === monthPrefix);
    const instructorIds = new Set();
    const instructorNames = new Set();
    const activeTypeCounts = {};
    const byManagerMap = new Map();
    let missingInstructorCount = 0;
    let missingDateCount = 0;
    let dangerousEndDateCount = 0;
    let operationalGapsCount = 0;
    let totalExceptionsActivityCount = 0;

    function managerStats(manager) {
      const key = String(manager || 'unassigned').trim() || 'unassigned';
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
      const emp1        = nullStr(row?.emp_id);
      const emp2        = nullStr(row?.emp_id_2);
      const instructor1 = nullStr(row?.instructor_name);
      const instructor2 = nullStr(row?.instructor_name_2);
      if (emp1) instructorIds.add(emp1);
      if (emp2) instructorIds.add(emp2);
      if (instructor1 || emp1) instructorNames.add(instructor1 || emp1);
      if (instructor2 || emp2) instructorNames.add(instructor2 || emp2);

      const stats = managerStats(row?.activity_manager);
      stats.total_activities += 1;
      if (isProgramActivity(row)) stats.total_long += 1;
      if (isOneDayActivity(row)) stats.total_short += 1;
      if (emp1) stats._instructors.add(emp1);
      if (emp2) stats._instructors.add(emp2);

      if (rowActivityType(row) !== 'course') continue;
      const hasMeetingDates = getActivityDateColumns(row).length > 0;
      const hasAnyDate = hasMeetingDates || nullStr(row?.start_date);
      const missingInstructor = !emp1 && !emp2 && !instructor1 && !instructor2;
      const missingDate = !hasAnyDate;
      const end = nullStr(row?.end_date);
      const isDangerousEnd = end && end > '2026-06-15';
      if (missingInstructor) missingInstructorCount += 1;
      if (missingDate) missingDateCount += 1;
      if (isDangerousEnd) dangerousEndDateCount += 1;
      if (missingInstructor || missingDate) operationalGapsCount += 1;
      if (missingInstructor || missingDate || isDangerousEnd) {
        totalExceptionsActivityCount += 1;
        stats.exceptions += 1;
      }
    }

    for (const row of endingRows) {
      managerStats(row?.activity_manager).course_endings += 1;
    }

    const by_activity_manager = [...byManagerMap.values()].map((stats) => {
      stats.num_instructors = stats._instructors.size;
      delete stats._instructors;
      return stats;
    });
    const exceptionsCount = totalExceptionsActivityCount;
    const totals = {
      total_short_activities: monthRows.filter(isOneDayActivity).length,
      total_long_activities: monthRows.filter(isProgramActivity).length,
      total_activities: monthRows.length,
      total_instructors: instructorIds.size,
      total_course_endings_current_month: endingRows.length,
      exceptions_count: exceptionsCount
    };
    const summary = {
      active_type_counts: activeTypeCounts,
      active_instructors: [...instructorNames].sort((a, b) => a.localeCompare(b, 'he')),
      active_instructors_count: instructorIds.size,
      ending_courses_current_month: endingRows.length,
      missing_instructor_count: missingInstructorCount,
      missing_date_count: missingDateCount,
      late_end_date_count: dangerousEndDateCount,
      operational_gaps_count: operationalGapsCount,
      exceptions_count: exceptionsCount
    };
    const kpi_cards = buildDashboardKpiCardsFromSupabase(totals, activeTypeCounts, exceptionsCount, instructorIds.size, endingRows.length);
    const noData = monthRows.length === 0;
    return {
      month: monthPrefix,
      requested_month: month,
      totals,
      summary,
      by_activity_manager,
      activeTypeCounts,
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
      .filter((row) => !isActivityClosed(row))
      .map((row) => ({ ...row, meeting_dates: getActivityDateColumns(row), date_cols: getActivityDateColumns(row) }));
    return { rows, _source: 'supabase' };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [] }, error);
  }
}

function buildExceptionsFromRows(activityRows = []) {
  const rows = [];
  for (const row of activityRows) {
    if (isActivityClosed(row)) continue;
    if (rowActivityType(row) !== 'course') continue;
    const types = [];
    const emp1        = nullStr(row?.emp_id);
    const instructor1 = nullStr(row?.instructor_name);
    const start       = nullStr(row?.start_date);
    const end         = nullStr(row?.end_date);
    if (!emp1 && !instructor1) types.push('missing_instructor');
    if (!start) types.push('missing_start_date');
    if (start && end && end < start) types.push('late_end_date');
    if (end && end > '2026-06-15') types.push('dangerous_end_date');
    if (!nullStr(row?.activity_manager)) types.push('missing_activity_manager');
    if (!nullStr(row?.school)) types.push('missing_school');
    if (!nullStr(row?.authority)) types.push('missing_authority');
    if (!nullStr(row?.activity_name)) types.push('missing_activity_name');
    if (types.length) rows.push({ ...row, exception_type: types[0], exception_types: [...new Set(types)] });
  }
  return rows;
}

async function readExceptionsFromSupabase(params = {}) {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [], totalExceptionRows: 0 }, 'no_supabase_client');
  const candidate = String(params?.month || params?.ym || '').trim();
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
  const COURSE_TYPE_VALUES = ['course', 'קורס', 'קורסים'];
  try {
    const range = monthDateRange(month);

    // Query 1: courses active in the chosen month (date-range based)
    const dateRangeRowsRaw = await selectActivitiesByDateRangeFromSupabase({
      startDate: range.startDate,
      endDate: range.endDate,
      activityType: 'course',
      includeEndDate: true
    });
    const dateRangeRows = dateRangeRowsRaw.filter((row) => {
      if (rowActivityType(row) !== 'course') return false;
      return activityHasDateInMonth(row, month)
        || String(row?.end_date || '').startsWith(month);
    });

    // Query 2 + 3 (parallel): open courses with missing start_date OR missing primary instructor
    // These won't appear in the date-range query if they have no dates at all.
    const [missingStartResult, missingInstructorResult] = await Promise.all([
      supabase
        .from('activities')
        .select('*')
        .in('activity_type', COURSE_TYPE_VALUES)
        .neq('status', CLOSED_STATUS)
        .is('start_date', null),
      supabase
        .from('activities')
        .select('*')
        .in('activity_type', COURSE_TYPE_VALUES)
        .neq('status', CLOSED_STATUS)
        .is('emp_id', null)
        .is('instructor_name', null)
    ]);

    const missingStartRows  = (Array.isArray(missingStartResult.data)      ? missingStartResult.data      : []).map(normalizeActivityRow);
    const missingInstructorRows = (Array.isArray(missingInstructorResult.data) ? missingInstructorResult.data : []).map(normalizeActivityRow);

    // Deduplicate by RowID across all three result sets
    const seenIds = new Set();
    const allRows = [];
    for (const row of [...dateRangeRows, ...missingStartRows, ...missingInstructorRows]) {
      const id = row?.RowID;
      if (id != null && seenIds.has(id)) continue;
      if (id != null) seenIds.add(id);
      allRows.push(row);
    }

    const rows = buildExceptionsFromRows(allRows);
    return { month, rows, totalExceptionRows: rows.length, _source: 'supabase' };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0 }, error);
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
    saveActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    addActivity: ['activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates'],
    submitEditRequest: ['activities:', 'activityDetail:', 'activityDates:', 'edit-requests', 'week:', 'month:', 'dashboard:', 'end-dates'],
    reviewEditRequest: ['edit-requests', 'activities:', 'activityDetail:', 'activityDates:', 'week:', 'month:', 'dashboard:', 'exceptions:'],
    addUser: ['permissions', 'dashboard:'],
    deactivateUser: ['permissions', 'dashboard:'],
    reactivateUser: ['permissions', 'dashboard:'],
    deleteUser: ['permissions', 'dashboard:'],
    savePrivateNote: ['activities:', 'operations:'],
    savePermission: ['permissions'],
    addContact: ['contacts', 'instructor-contacts'],
    saveContact: ['contacts', 'instructor-contacts'],
    saveSheetMapping: ['adminSettings', 'listSheets']
  };
  const prefixes = targetedMutations[action];
  if (!prefixes || !prefixes.length) return;
  if (prefixes.includes('*')) {
    clearScreenDataCache();
    return;
  }
  Object.keys(state.screenDataCache || {}).forEach((key) => {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      delete state.screenDataCache[key];
    }
  });
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

const USER_PUBLIC_COLUMNS = 'user_id,email,name,role,display_role,emp_id,is_active,permissions,auth_user_id,created_at,updated_at';
const VALID_SUPABASE_ROLES = new Set(['admin', 'operation_manager', 'authorized_user', 'instructor', 'finance', 'activities_manager', 'domain_manager', 'instructor_manager']);
const ROLES_WITH_DIRECT_EDIT = new Set(['admin', 'operation_manager']);

const SUPABASE_ROLE_ROUTES = {
  admin: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'permissions', 'admin-lists'],
  operation_manager: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests'],
  authorized_user: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  finance: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  activities_manager: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  domain_manager: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  instructor_manager: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  instructor: ['dashboard', 'activities', 'archive', 'week', 'month', 'instructor-contacts', 'my-data']
};

function normalizeSupabaseRole(role) {
  const normalized = String(role || 'authorized_user').trim();
  return VALID_SUPABASE_ROLES.has(normalized) ? normalized : 'authorized_user';
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

function flattenUserRow(userRow = {}) {
  const permissions = userRow?.permissions && typeof userRow.permissions === 'object' ? userRow.permissions : {};
  const role = normalizeSupabaseRole(userRow.role);
  const customDisplayRole = String(userRow.display_role || '').trim();
  return {
    user_id: String(userRow.user_id || ''),
    full_name: String(userRow.name || ''),
    role,
    display_role: role,
    display_role_label: customDisplayRole || hebrewRole(role),
    display_role2: String(permissions.display_role2 || ''),
    emp_id: String(userRow.emp_id || ''),
    active: userRow.is_active ? 'yes' : 'no',
    ...permissions
  };
}

function buildBootstrapFromUser(userRow) {
  const flat = flattenUserRow(userRow);
  const role = normalizeSupabaseRole(flat.role);
  const allowedRoutes = SUPABASE_ROLE_ROUTES[role] || SUPABASE_ROLE_ROUTES.authorized_user;
  return {
    routes: [...allowedRoutes],
    default_route: allowedRoutes[0] || 'dashboard',
    profile: {
      full_name: flat.full_name,
      display_role2: flat.display_role2 || '',
      display_role_label: flat.display_role_label || hebrewRole(role)
    },
    can_add_activity: String(flat.can_add_activity || '').toLowerCase() === 'yes' || role === 'admin' || role === 'operation_manager',
    can_edit_direct: ROLES_WITH_DIRECT_EDIT.has(role),
    can_request_edit: String(flat.can_request_edit || '').toLowerCase() !== 'no',
    client_settings: {}
  };
}

async function loginWithSupabaseAuth(user_id, entry_code) {
  if (!supabase) throwLoginError('no_supabase_client');
  const uid = String(user_id || '').trim();
  const code = String(entry_code || '').trim();
  if (!uid || !code) throwLoginError('missing_user_id_or_entry_code');

  const authEmail = `${uid}@taasiyeda.local`;

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
    .select('*')
    .eq('auth_user_id', authUserId)
    .eq('is_active', true)
    .single();

  if (profileError || !userRow) {
    throwLoginError('invalid_credentials', { auth_user_id: authUserId, message: String(profileError?.message || '') });
  }

  assertValidLoginUserRow(userRow);
  return userRow;
}

function makeSessionToken(userRow) {
  const claims = {
    uid: String(userRow.user_id || ''),
    role: normalizeSupabaseRole(userRow.role),
    emp_id: String(userRow.emp_id || ''),
    name: String(userRow.name || '')
  };
  return `sb.${btoa(unescape(encodeURIComponent(JSON.stringify(claims))))}.session`;
}

async function readCurrentUserBySession() {
  if (!supabase) throw new Error('no_supabase_client');
  const userId = String(state?.user?.user_id || '').trim();
  if (!userId) throw new Error('unauthorized');
  const { data, error } = await supabase
    .from('users')
    .select(USER_PUBLIC_COLUMNS)
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('unauthorized');
  if (!data.is_active) throw new Error('unauthorized');
  return data;
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

function sanitizeActivityPayload(act = {}) {
  const row = { ...act };
  delete row.source;
  delete row.source_sheet;
  delete row.source_table;
  delete row.RowID;
  if (!row.row_id) row.row_id = String(act.row_id || act.RowID || `ACT-${crypto.randomUUID?.() || Date.now()}`).trim();
  row.activity_family = String(row.activity_family || (String(act.source || '').trim() === 'short' ? 'one_day' : 'program')).trim();
  row.status = String(row.status || 'פעיל');
  for (let i = 1; i <= 35; i++) {
    const lower = `date_${i}`;
    const oldDateKey = `Date${i}`;
    if (row[lower] === undefined && act[oldDateKey] !== undefined) row[lower] = act[oldDateKey];
  }
  return row;
}

async function upsertActivityToSupabase(payload = {}) {
  const act = payload?.activity || payload || {};
  const row = sanitizeActivityPayload(act);
  logActivityMutationDebug('request', 'addActivity', { source_sheet: 'activities', source_row_id: row.row_id, changes: row });
  const { data, error } = await supabase.from('activities').upsert(row, { onConflict: 'row_id' }).select().single();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', { operation: 'addActivity', table: 'activities', error });
    throw buildSupabaseMutationError('addActivity', error, 'save_failed');
  }
  const normalized = normalizeActivityRow(data || row);
  logActivityMutationDebug('success', 'addActivity', { source_sheet: 'activities', source_row_id: normalized.row_id, changes: row });
  return { RowID: normalized.RowID, row_id: normalized.row_id, source_sheet: 'activities', row: normalized };
}

async function updateActivityInSupabase(payload = {}) {
  const rowId = String(payload?.source_row_id || payload?.row_id || payload?.RowID || '').trim();
  const sourceSheet = String(payload?.source_sheet || 'activities').trim() || 'activities';
  const changes = { ...(payload?.changes || {}) };
  if (!rowId) throw new Error('missing_row_id');
  if (!Object.keys(changes).length) throw new Error('No changes to submit');
  delete changes.RowID;
  delete changes.row_id;
  delete changes.source_sheet;
  delete changes.source_table;
  const debugPayload = { source_sheet: sourceSheet, source_row_id: rowId, changes };
  logActivityMutationDebug('request', 'saveActivity', debugPayload, { table: 'activities' });
  const { data, error } = await supabase
    .from('activities')
    .update(changes)
    .eq('row_id', rowId)
    .select('row_id')
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', { operation: 'saveActivity', table: 'activities', payload: debugPayload, error });
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

function buildEditRequestGroups(rows = [], canReview = false) {
  const groups = rows.map((row) => {
    const changedFields =
      Array.isArray(row?.changed_fields) ? row.changed_fields
        : (() => {
            try { return JSON.parse(String(row?.changed_fields || '[]')); } catch { return []; }
          })();
    const requestedValues =
      row?.requested_values && typeof row.requested_values === 'object'
        ? row.requested_values
        : (() => {
            try { return JSON.parse(String(row?.requested_values || '{}')); } catch { return {}; }
          })();
    const originalValues =
      row?.original_values && typeof row.original_values === 'object'
        ? row.original_values
        : (() => {
            try { return JSON.parse(String(row?.original_values || '{}')); } catch { return {}; }
          })();
    const fields = (Array.isArray(changedFields) ? changedFields : []).map((fieldName) => ({
      field_name: String(fieldName || ''),
      old_value: String(originalValues?.[fieldName] ?? ''),
      new_value: String(requestedValues?.[fieldName] ?? '')
    })).filter((f) => f.field_name);
    return {
      request_id: String(row?.request_id || ''),
      status: String(row?.status || 'pending'),
      requested_by_name: String(row?.requested_by_name || ''),
      requested_by_user_id: String(row?.requested_by_user_id || ''),
      requested_at: String(row?.requested_at || ''),
      review_note: String(row?.review_note || ''),
      source_row_id: String(row?.source_row_id || ''),
      activity_name: String(row?.activity_name || ''),
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

export const api = {
  login: async (user_id, entry_code) => {
    const [user, listsData, settingsRows] = await Promise.all([
      loginWithSupabaseAuth(user_id, entry_code),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => [])
    ]);
    const token = makeSessionToken(user);
    const flat = flattenUserRow(user);
    return {
      token,
      user: {
        user_id: flat.user_id,
        display_role: flat.role,
        display_role_label: flat.display_role_label,
        display_role2: flat.display_role2,
        full_name: flat.full_name,
        emp_id: flat.emp_id,
        can_add_activity: String(flat.can_add_activity || '').toLowerCase() === 'yes' || flat.role === 'admin' || flat.role === 'operation_manager',
        can_edit_direct: ROLES_WITH_DIRECT_EDIT.has(flat.role),
        can_request_edit: String(flat.can_request_edit || '').toLowerCase() !== 'no'
      },
      ...buildBootstrapFromUser(user),
      client_settings: buildClientSettingsFromLists(listsData, settingsRows)
    };
  },
  bootstrap: async () => {
    const [user, listsData, settingsRows] = await Promise.all([
      readCurrentUserBySession(),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => [])
    ]);
    return {
      ...buildBootstrapFromUser(user),
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
  activityDetail: (source_row_id, source_sheet) => readActivityDetailFromSupabase(source_row_id, source_sheet),
  activityDates: (source_row_id, source_sheet) => readActivityDatesFromSupabase(source_row_id, source_sheet),
  week: async (params) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const weekOffset = Number.parseInt(resolved.week_offset, 10);
    const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
    return readWeekFromSupabase(offset);
  },
  month: async (params) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const candidate = String(resolved.ym || resolved.month || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const ym = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    return readMonthFromSupabase(ym);
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
  myData: async () => {
    const allRows = await readAllActivitiesRowsSupabase();
    const empId = String(state?.user?.emp_id || state?.user?.user_id || '').trim();
    const rows = allRows.filter((row) => {
      if (isActivityClosed(row)) return false;
      const emp1 = String(row?.emp_id || '').trim();
      const emp2 = String(row?.emp_id_2 || '').trim();
      return !!empId && (emp1 === empId || emp2 === empId);
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
    const rows = Array.isArray(data) ? data : [];
    const canReview = ['admin', 'operation_manager'].includes(String(state?.user?.display_role || ''));
    return buildEditRequestGroups(rows, canReview);
  },
  permissions: async () => {
    const { data, error } = await supabase.from('users').select(USER_PUBLIC_COLUMNS).order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'permissions_read_failed');
    const rows = (Array.isArray(data) ? data : []).map(flattenUserRow);
    return {
      rows,
      roleDefaults: {
        admin: { can_add_activity: 'yes', can_edit_direct: 'yes', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'yes', view_permissions: 'yes' },
        operation_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'yes', view_permissions: 'no' },
        authorized_user: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        finance: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        activities_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        domain_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        instructor_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        instructor: { can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' }
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
    }
    const rows = await readSettingsRowsFromSupabase();
    return { rows, _source: 'supabase' };
  },
  adminLists: async () => {
    const supabaseData = await readListsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ categories: [] }, 'admin_lists_supabase_failed');
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
      return api.addContact(payload);
    }
    if (kind === 'school') {
      const nextRow = { ...row };
      if (nextRow.role !== undefined && nextRow.contact_role === undefined) nextRow.contact_role = nextRow.role;
      const orig = payload?._supabase_orig && typeof payload._supabase_orig === 'object' ? payload._supabase_orig : null;
      const keyChanged = !!orig && (
        String(orig.authority || '') !== String(nextRow.authority || '') ||
        String(orig.school || '') !== String(nextRow.school || '') ||
        String(orig.contact_name || '') !== String(nextRow.contact_name || '')
      );
      if (keyChanged) {
        const { error: delErr } = await supabase
          .from('contacts_schools')
          .delete()
          .eq('authority', String(orig.authority || ''))
          .eq('school', String(orig.school || ''))
          .eq('contact_name', String(orig.contact_name || ''));
        if (delErr) throw new Error(delErr.message || 'save_contact_failed');
        const { error: insErr } = await supabase
          .from('contacts_schools')
          .insert(nextRow);
        if (insErr) throw new Error(insErr.message || 'save_contact_failed');
        return { ok: true };
      }
      return api.addContact({ kind: 'school', row: nextRow });
    }
    throw new Error('invalid_contact_kind');
  },
  addActivity: async (target, data) => {
    const payload = (typeof target === 'object' && target !== null && data === undefined)
      ? { activity: target }
      : { activity: { ...(data || {}), source: target } };
    return upsertActivityToSupabase(payload);
  },
  /** מקבל אובייקט מלא (כולל source_sheet, changes) או חתימה ישנה (id, changes). */
  saveActivity: async (a, b) => {
    const payload = (b !== undefined && b !== null)
      ? { source_row_id: a, changes: b }
      : a;
    return updateActivityInSupabase(payload);
  },
  submitEditRequest: async (source_row_id, changes, source_sheet = 'activities') => {
    const requestPayload = (source_row_id && typeof source_row_id === 'object') ? source_row_id : null;
    const rowId = String(requestPayload?.source_row_id || source_row_id || '').trim();
    const sourceSheet = String(requestPayload?.source_sheet || source_sheet || 'activities').trim() || 'activities';
    const rawChanges = requestPayload?.changes || changes || {};
    const normalizedChanges = Object.entries(rawChanges).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) return acc;
      const normalizedValue = String(value).trim();
      acc[key] = normalizedValue;
      return acc;
    }, {});
    const debugPayload = { source_sheet: sourceSheet, source_row_id: rowId, changes: normalizedChanges };
    logActivityMutationDebug('request', 'submitEditRequest', debugPayload, { table: 'edit_requests' });
    if (!rowId || !Object.keys(normalizedChanges).length) {
      throw new Error('No changes to submit');
    }
    const currentUser = state?.user || {};
    const row = {
      request_id: `REQ-${Date.now()}`,
      source_row_id: rowId,
      source_sheet: sourceSheet,
      changed_fields: Object.keys(normalizedChanges),
      requested_values: normalizedChanges,
      status: 'pending',
      active: 'yes',
      requested_by_user_id: String(currentUser?.user_id || '').trim(),
      requested_by_name: String(currentUser?.full_name || currentUser?.profile?.full_name || '').trim(),
      requested_at: new Date().toISOString()
    };
    const { error } = await supabase.from('edit_requests').insert(row);
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[activity-save-error]', { operation: 'submitEditRequest', table: 'edit_requests', payload: row, error });
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
    const reqRes = await supabase
      .from('edit_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();
    if (reqRes.error || !reqRes.data) throw new Error(reqRes.error?.message || 'review_edit_request_failed');
    const reqRow = reqRes.data;
    if (nextStatus === 'approved') {
      const sourceRowId = String(reqRow?.source_row_id || '').trim();
      const requestedValues =
        reqRow?.requested_values && typeof reqRow.requested_values === 'object'
          ? reqRow.requested_values
          : (() => {
              try { return JSON.parse(String(reqRow?.requested_values || '{}')); } catch { return {}; }
            })();
      if (sourceRowId && requestedValues && Object.keys(requestedValues).length) {
        const { error: applyErr } = await supabase
          .from('activities')
          .update(requestedValues)
          .eq('row_id', sourceRowId);
        if (applyErr) throw new Error(applyErr.message || 'review_edit_request_apply_failed');
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
      if (['user_id', 'role', 'active', 'full_name', 'entry_code', 'emp_id', 'display_role2'].includes(k)) return;
      permissions[k] = v;
    });
    const patch = {
      role: row.role || existing.data.role,
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
    return { ok: true };
  },
  addUser: async (row) => {
    const permissions = { can_request_edit: 'yes' };
    const insert = {
      user_id: String(row?.user_id || '').trim(),
      email: null,
      name: String(row?.full_name || '').trim(),
      role: String(row?.role || 'instructor').trim(),
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
};

export { isPerfDebugEnabled, getPerfStore };
