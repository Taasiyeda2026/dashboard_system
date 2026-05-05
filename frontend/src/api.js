import { state, setSession, clearScreenDataCache } from './state.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
import { supabase } from './supabase-client.js';

/**
 * Actions that modify server-side data.
 *
 * After mutating actions succeed, cache invalidation runs automatically
 * (see bottom of request()).
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
  readModelManifest: true,
  readModelGet: true,
  readModelHealth: true,
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 45000;
const READ_MODEL_TIMEOUT_MS = 14000;
const PERF_MAX_REQUESTS = 150;
const MONTH_READ_MODEL_TTL_MS = 5 * 60 * 1000;
const monthReadModelCache = new Map();
const READ_MODEL_CACHE_STORAGE_KEY = 'ds_read_model_cache_v2';
const MANIFEST_TTL_MS = 5 * 60 * 1000;
let manifestCache = { t: 0, data: null };
/** Deduplicates concurrent readModelManifest network calls — any call while one is in-flight joins the same Promise. */
let manifestInflight = null;

/** When true, allowed screens may use readModelGet + local manifest cache instead of legacy actions. */
const READ_MODELS_ENABLED = true;

/** Explicit allow-list: only these read-model keys use the read-model path; all others use legacy only. */
const READ_MODEL_ENABLED_KEY_LIST = ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'];
const READ_MODEL_ENABLED_KEYS = new Set(READ_MODEL_ENABLED_KEY_LIST);

/**
 * Heavy screen reads that must go through requestReadModel (or pass legacy_intentional in perfMeta).
 * Direct request() otherwise logs [legacy-guard] for visibility.
 */
const HEAVY_LEGACY_GUARDED_READ_ACTIONS = new Set([
  'dashboardSnapshot',
  'activities',
  'week',
  'month',
  'exceptions',
  'endDates'
]);

function warnHeavyLegacyReadWithoutIntentionalFlag(action, perfMeta) {
  if (!READ_ACTIONS[action]) return;
  if (!HEAVY_LEGACY_GUARDED_READ_ACTIONS.has(action)) return;
  if (perfMeta?.legacy_intentional === true) return;
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
    console.warn('[legacy-guard]', JSON.stringify({
      screen: String(action),
      action: String(action),
      reason: 'heavy_legacy_read_without_read_model_path',
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
    const start = String(row?.date_start || row?.start_date || '').trim();
    const end = String(row?.end_date || row?.date_end || start).trim();
    if (start || end) {
      const rowStart = start || end;
      const rowEnd = end || start;
      if (rowStart > monthEnd || rowEnd < monthStart) return false;
    }
  }

  return true;
}

async function readArchiveActivitiesFromSupabase() {
  if (!supabase) return null;
  try {
    const [longResult, shortResult] = await Promise.all([
      supabase.from('data_long').select('*').eq('status', 'סגור'),
      supabase.from('data_short').select('*').eq('status', 'סגור')
    ]);
    if (longResult.error) {
      console.error('[supabase] archive data_long failed:', longResult.error);
      return null;
    }
    if (shortResult.error) {
      console.error('[supabase] archive data_short failed:', shortResult.error);
      return null;
    }
    const longRows = (Array.isArray(longResult.data) ? longResult.data : []).map((r) => ({ ...r, source_sheet: 'data_long' }));
    const shortRows = (Array.isArray(shortResult.data) ? shortResult.data : []).map((r) => ({ ...r, source_sheet: 'data_short' }));
    const rows = [...longRows, ...shortRows].sort((a, b) => {
      const da = String(b?.end_date || b?.start_date || '').trim();
      const db = String(a?.end_date || a?.start_date || '').trim();
      return da.localeCompare(db);
    });
    return { rows };
  } catch (err) {
    console.error('[supabase] archive fetch error:', err);
    return null;
  }
}

async function readActivitiesFromSupabase(filters = {}) {
  if (!supabase) return null;

  try {
    const [longResult, shortResult] = await Promise.all([
      supabase.from('data_long').select('*'),
      supabase.from('data_short').select('*')
    ]);

    if (longResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_long:', longResult.error);
      return null;
    }
    if (shortResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_short:', shortResult.error);
      return null;
    }

    const longRows = Array.isArray(longResult.data)
      ? longResult.data.map((row) => ({ ...row, source_sheet: row?.source_sheet || 'data_long' }))
      : [];
    const shortRows = Array.isArray(shortResult.data)
      ? shortResult.data.map((row) => ({ ...row, source_sheet: row?.source_sheet || 'data_short' }))
      : [];

    const rows = [...longRows, ...shortRows].filter((row) => rowMatchesActivitiesFilters(row, filters));
    return { rows };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected data_long/data_short fetch error:', error);
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

/**
 * Reads contacts_instructors + contacts_schools from Supabase.
 * Returns { instructor_rows, school_rows, can_view_instructors, can_view_schools, _source }
 * or null on any failure (caller falls back to GAS).
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
      catMap.get(cat).push({ label, value });
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
 * Reads contacts_instructors and computes per-instructor activity stats
 * (programs_count, one_day_count, latest_end_date, activity_managers) from
 * data_long + data_short — all client-side, no schema changes.
 * Returns { rows, _source: 'supabase' } or null on any failure.
 */
async function readInstructorsFromSupabase() {
  if (!supabase) return null;
  try {
    const [instrResult, longResult, shortResult] = await Promise.all([
      supabase.from('contacts_instructors').select('*'),
      supabase.from('data_long').select('emp_id,emp_id_2,instructor_name,instructor_name_2,end_date,date_end,activity_manager,status'),
      supabase.from('data_short').select('emp_id,emp_id_2,instructor_name,instructor_name_2,end_date,date_end,activity_manager,status')
    ]);

    if (instrResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load contacts_instructors (instructors screen):', instrResult.error);
      return null;
    }
    if (longResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_long (instructors screen):', longResult.error);
      return null;
    }
    if (shortResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Failed to load data_short (instructors screen):', shortResult.error);
      return null;
    }

    const instrRows = Array.isArray(instrResult.data) ? instrResult.data : [];
    const longRows = Array.isArray(longResult.data) ? longResult.data : [];
    const shortRows = Array.isArray(shortResult.data) ? shortResult.data : [];

    const statsMap = new Map();
    function ensureStats(id, name) {
      const k = String(id || '').trim();
      if (!k) return null;
      if (!statsMap.has(k)) statsMap.set(k, { programs_count: 0, one_day_count: 0, latest_end_date: '', managers: new Set(), name: String(name || '').trim() });
      return statsMap.get(k);
    }

    function applyRow(row, isLong) {
      if (String(row.status || '').trim() === 'סגור') return;
      const pairs = [
        [String(row.emp_id || '').trim(), String(row.instructor_name || '').trim()],
        [String(row.emp_id_2 || '').trim(), String(row.instructor_name_2 || '').trim()]
      ].filter(([id]) => id);
      const d = String(row.end_date || row.date_end || '').trim().slice(0, 10);
      const mgr = String(row.activity_manager || '').trim();
      for (const [id, name] of pairs) {
        const s = ensureStats(id, name);
        if (!s) continue;
        if (!s.name && name) s.name = name;
        if (isLong) s.programs_count += 1;
        else s.one_day_count += 1;
        if (d && (!s.latest_end_date || d > s.latest_end_date)) s.latest_end_date = d;
        if (mgr) s.managers.add(mgr);
      }
    }

    for (const row of longRows) applyRow(row, true);
    for (const row of shortRows) applyRow(row, false);

    const knownIds = new Set(instrRows.map((r) => String(r.emp_id || '').trim()).filter(Boolean));

    const rows = instrRows.map((instr) => {
      const id = String(instr.emp_id || '').trim();
      const s = statsMap.get(id) || { programs_count: 0, one_day_count: 0, latest_end_date: '', managers: new Set() };
      return {
        ...instr,
        programs_count: s.programs_count,
        one_day_count: s.one_day_count,
        latest_end_date: s.latest_end_date || '',
        activity_managers: [...s.managers]
      };
    });

    for (const [id, s] of statsMap.entries()) {
      if (knownIds.has(id)) continue;
      if ((s.programs_count + s.one_day_count) === 0) continue;
      rows.push({
        emp_id: id,
        full_name: s.name || id,
        programs_count: s.programs_count,
        one_day_count: s.one_day_count,
        latest_end_date: s.latest_end_date || '',
        activity_managers: [...s.managers],
        _synthetic: true
      });
    }

    return { rows, _source: 'supabase' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected instructors fetch error:', error);
    return null;
  }
}

/**
 * Builds KPI card array for the dashboard from computed Supabase values.
 * KPIs that cannot be computed from Supabase columns are set to 0 and noted as GAS-only.
 */
function buildDashboardKpiCardsFromSupabase(totals, activeTypeCounts, exceptionCount, uniqueInstructorCount, courseEndings) {
  return [
    { id: 'short', action: 'kpi|short', title: String(totals.total_short_activities), subtitle: 'חד-יומי', value: totals.total_short_activities },
    { id: 'long', action: 'kpi|long', title: String(totals.total_long_activities), subtitle: 'תוכניות', value: totals.total_long_activities },
    { id: 'active_courses', action: 'kpi|active_courses', title: String(activeTypeCounts.course || 0), subtitle: 'קורסים פעילים', value: activeTypeCounts.course || 0 },
    { id: 'active_workshops', action: 'kpi|active_workshops', title: String(activeTypeCounts.workshop || 0), subtitle: 'סדנאות פעילות', value: activeTypeCounts.workshop || 0 },
    { id: 'active_tours', action: 'kpi|active_tours', title: String(activeTypeCounts.tour || 0), subtitle: 'סיורים פעילים', value: activeTypeCounts.tour || 0 },
    { id: 'active_after_school', action: 'kpi|active_after_school', title: String(activeTypeCounts.after_school || 0), subtitle: 'אפטרסקול פעיל', value: activeTypeCounts.after_school || 0 },
    { id: 'active_escape_room', action: 'kpi|active_escape_room', title: String(activeTypeCounts.escape_room || 0), subtitle: 'חדרי בריחה פעילים', value: activeTypeCounts.escape_room || 0 },
    { id: 'exceptions', action: 'kpi|exceptions', title: String(exceptionCount), subtitle: 'חריגות (קורסים)', value: exceptionCount },
    { id: 'instructors', action: 'kpi|instructors', title: String(uniqueInstructorCount), subtitle: 'מדריכים פעילים', value: uniqueInstructorCount },
    { id: 'endings', action: 'kpi|endings', title: String(courseEndings), subtitle: 'סיומי קורסים', value: courseEndings }
  ];
}

// ─── Supabase helpers for week/month calendar views ──────────────────────────

const SUPABASE_DATE_CANDIDATE_FIELDS = [
  'meeting_date', 'date', 'start_date', 'date_start',
  'activity_date', 'end_date', 'date_end'
];

const HEBREW_WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

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
 * Find the first valid date from candidate fields in an activity_meetings row.
 * Returns { field, dateKey } — dateKey is normalized YYYY-MM-DD, or '' if none found.
 */
function activityMeetingDateFromCandidates(row) {
  if (!row || typeof row !== 'object') return { field: null, dateKey: '' };
  for (const field of SUPABASE_DATE_CANDIDATE_FIELDS) {
    const raw = row[field];
    if (raw == null || raw === '') continue;
    const dateKey = normalizeSupabaseDate(raw);
    if (dateKey) return { field, dateKey };
  }
  return { field: null, dateKey: '' };
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
 * Detect which date field is actually used in activity_meetings rows.
 * Logs the raw row count and detected field names for diagnostics.
 * Returns the field name string, or null if none found.
 */
function detectActivityMeetingsDateField(rows) {
  if (!rows.length) return null;
  const firstRow = rows[0];
  const detectedFields = Object.keys(firstRow);
  // eslint-disable-next-line no-console
  console.info('[supabase][activity_meetings] detected fields', detectedFields);
  for (const field of SUPABASE_DATE_CANDIDATE_FIELDS) {
    const hasField = rows.some((r) => r[field] != null && r[field] !== '');
    if (hasField) return field;
  }
  return null;
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
 * Core mapping: given activity_meetings rows + data_long rows + data_short rows,
 * build itemsById and dayMap for the calendar.
 *
 * Strategy:
 *   1. data_short rows: start_date is the meeting date (one session per row).
 *   2. activity_meetings rows: flexible date field → join source_row_id → data_long.
 *
 * Returns { itemsById, dayMap, detectedDateField, stats }
 */
function buildCalendarMapping(meetingRows, shortRows, longById, startDate, endDate) {
  // eslint-disable-next-line no-console
  console.info('[supabase][activity_meetings] raw rows count', { meetings: meetingRows.length, short: shortRows.length });

  const detectedDateField = detectActivityMeetingsDateField(meetingRows);

  const itemsById = { ...buildItemsById(shortRows) };
  const dayMap = {};
  const addToDay = (dateKey, rowId) => {
    if (!dayMap[dateKey]) dayMap[dateKey] = new Set();
    dayMap[dateKey].add(rowId);
  };

  let shortFiltered = 0;
  for (const row of shortRows) {
    const dateKey = normalizeSupabaseDate(row.start_date);
    if (!dateKey || dateKey < startDate || dateKey > endDate) continue;
    if (row.RowID) { addToDay(dateKey, row.RowID); shortFiltered++; }
  }

  let meetFiltered = 0;
  let meetMapped = 0;
  let meetMissingLong = 0;

  for (const meetRow of meetingRows) {
    const { dateKey } = activityMeetingDateFromCandidates(meetRow);
    if (!dateKey || dateKey < startDate || dateKey > endDate) continue;
    meetFiltered++;

    const actRow = longById[meetRow.source_row_id];
    if (!actRow) { meetMissingLong++; continue; }
    meetMapped++;
    if (actRow.RowID) {
      itemsById[actRow.RowID] = actRow;
      addToDay(dateKey, actRow.RowID);
    }
  }

  const stats = {
    shortRawCount: shortRows.length,
    shortFilteredCount: shortFiltered,
    meetingsRawCount: meetingRows.length,
    meetingsFilteredCount: meetFiltered,
    meetingsMappedCount: meetMapped,
    meetingsMissingLongCount: meetMissingLong,
    detectedDateField,
    totalMappedItems: Object.keys(itemsById).length
  };

  return { itemsById, dayMap, detectedDateField, stats };
}

/**
 * Read week calendar data from Supabase ONLY — no GAS fallback.
 *
 *   Short activities → data_short where start_date is in [startDate, endDate].
 *   Long activities  → activity_meetings where meeting_date is in range → join data_long.
 *
 * Always returns a valid payload (may be empty). Never throws.
 */
async function readWeekFromSupabase(weekOffset) {
  const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
  const { startDate, endDate } = buildWeekDateRange(offset);

  // eslint-disable-next-line no-console
  console.info('[supabase][week] week_start', startDate, 'week_end', endDate);

  if (!supabase) {
    // eslint-disable-next-line no-console
    console.error('[supabase][week] supabase client not available');
    return emptyWeekPayload(startDate, endDate, { error: 'no_supabase_client' });
  }

  try {
    const [shortRes, meetingsRes] = await Promise.all([
      supabase.from('data_short').select('*').gte('start_date', startDate).lte('start_date', endDate),
      supabase.from('activity_meetings').select('*').gte('meeting_date', startDate).lte('meeting_date', endDate)
    ]);

    if (shortRes.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][week] data_short query failed', shortRes.error);
    }
    if (meetingsRes.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][week] activity_meetings query failed', meetingsRes.error);
    }

    const shortRows = Array.isArray(shortRes.data) ? shortRes.data : [];
    const meetingRows = Array.isArray(meetingsRes.data) ? meetingsRes.data : [];

    const longRowIds = [...new Set(meetingRows.map((r) => r.source_row_id).filter(Boolean))];
    let longRows = [];
    if (longRowIds.length > 0) {
      const longRes = await supabase.from('data_long').select('*').in('RowID', longRowIds);
      if (longRes.error) {
        // eslint-disable-next-line no-console
        console.error('[supabase][week] data_long query failed', longRes.error);
      }
      longRows = Array.isArray(longRes.data) ? longRes.data : [];
    }

    const longById = buildItemsById(longRows);
    const { itemsById, dayMap, stats } = buildCalendarMapping(
      meetingRows, shortRows, longById, startDate, endDate
    );

    // eslint-disable-next-line no-console
    console.info('[supabase][week] filtered rows count', stats.meetingsFilteredCount + stats.shortFilteredCount,
      'mapped items count', stats.totalMappedItems, stats);

    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate + 'T00:00:00');
      d.setDate(d.getDate() + i);
      const dateKey =
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        date: dateKey,
        weekday_label: HEBREW_WEEKDAY_LABELS[d.getDay()],
        item_ids: [...(dayMap[dateKey] || new Set())]
      });
    }

    return { days, items_by_id: itemsById, week_start: startDate, week_end: endDate, _source: 'supabase' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[supabase][week] unexpected error:', err);
    return emptyWeekPayload(startDate, endDate, { error: String(err?.message || err) });
  }
}

/**
 * Read month calendar data from Supabase ONLY — no GAS fallback.
 * Always returns a valid payload (may be empty). Never throws.
 */
async function readMonthFromSupabase(ym) {
  const monthPrefix = String(ym || '').slice(0, 7);

  // eslint-disable-next-line no-console
  console.info('[supabase][month] month', monthPrefix);

  if (!supabase) {
    // eslint-disable-next-line no-console
    console.error('[supabase][month] supabase client not available');
    return emptyMonthPayload(monthPrefix || 'unknown', { error: 'no_supabase_client' });
  }

  if (!/^\d{4}-\d{2}$/.test(monthPrefix)) {
    // eslint-disable-next-line no-console
    console.error('[supabase][month] invalid month format', ym);
    return emptyMonthPayload(monthPrefix || 'unknown', { error: 'invalid_month', ym });
  }

  try {
    const [yStr, mStr] = monthPrefix.split('-');
    const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
    const startDate = `${monthPrefix}-01`;
    const endDate = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

    const [shortRes, meetingsRes] = await Promise.all([
      supabase.from('data_short').select('*').gte('start_date', startDate).lte('start_date', endDate),
      supabase.from('activity_meetings').select('*').gte('meeting_date', startDate).lte('meeting_date', endDate)
    ]);

    if (shortRes.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][month] data_short query failed', shortRes.error);
    }
    if (meetingsRes.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][month] activity_meetings query failed', meetingsRes.error);
    }

    const shortRows = Array.isArray(shortRes.data) ? shortRes.data : [];
    const meetingRows = Array.isArray(meetingsRes.data) ? meetingsRes.data : [];

    const longRowIds = [...new Set(meetingRows.map((r) => r.source_row_id).filter(Boolean))];
    let longRows = [];
    if (longRowIds.length > 0) {
      const longRes = await supabase.from('data_long').select('*').in('RowID', longRowIds);
      if (longRes.error) {
        // eslint-disable-next-line no-console
        console.error('[supabase][month] data_long query failed', longRes.error);
      }
      longRows = Array.isArray(longRes.data) ? longRes.data : [];
    }

    const longById = buildItemsById(longRows);
    const { itemsById, dayMap, stats } = buildCalendarMapping(
      meetingRows, shortRows, longById, startDate, endDate
    );

    // eslint-disable-next-line no-console
    console.info('[supabase][month] filtered rows count', stats.meetingsFilteredCount + stats.shortFilteredCount,
      'mapped items count', stats.totalMappedItems, stats);

    const cells = [];
    for (let dayNum = 1; dayNum <= lastDay; dayNum++) {
      const dateKey = `${monthPrefix}-${String(dayNum).padStart(2, '0')}`;
      cells.push({ date: dateKey, day: dayNum, item_ids: [...(dayMap[dateKey] || new Set())] });
    }

    return { month: monthPrefix, cells, items_by_id: itemsById, _source: 'supabase' };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[supabase][month] unexpected error:', err);
    return emptyMonthPayload(monthPrefix, { error: String(err?.message || err) });
  }
}

/**
 * Queries Supabase to build a dashboard payload for the given month (YYYY-MM).
 *
 * KPIs computable from Supabase: short, long, active_courses, active_workshops,
 * active_tours, active_after_school, active_escape_room, instructors, endings.
 *
 * KPIs that cannot yet be computed (no equivalent column): exceptions,
 * operational_gaps_count, late_end_date_count, active_courses_next_month.
 * These are set to 0 — GAS fallback is authoritative for them.
 *
 * Returns null on any failure so the caller can fall through to GAS.
 */
async function dashboardReadModelFromSupabase(month) {
  if (!supabase) return buildSupabaseErrorPayload({ month, requested_month: month }, 'no_supabase_client');
  try {
    const monthPrefix = String(month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(monthPrefix)) {
      return buildSupabaseErrorPayload({ month, requested_month: month }, 'invalid_month_format', { month });
    }

    const monthStart = `${monthPrefix}-01`;
    const [yStr, mStr] = monthPrefix.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

    const [longResult, shortResult, longEndingsResult] = await Promise.all([
      supabase.from('data_long')
        .select('activity_type,activity_manager,start_date,end_date,emp_id,status')
        .lte('start_date', monthEnd)
        .gte('end_date', monthStart)
        .neq('status', 'סגור'),
      supabase.from('data_short')
        .select('activity_type,activity_manager,start_date,emp_id,emp_id_2,status')
        .gte('start_date', monthStart)
        .lte('start_date', monthEnd)
        .neq('status', 'סגור'),
      supabase.from('data_long')
        .select('activity_type,activity_manager,end_date,status')
        .gte('end_date', monthStart)
        .lte('end_date', monthEnd)
        .neq('status', 'סגור')
    ]);

    if (longResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][dashboard] data_long fetch failed:', longResult.error);
      return null;
    }
    if (shortResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][dashboard] data_short fetch failed:', shortResult.error);
      return null;
    }
    if (longEndingsResult.error) {
      // eslint-disable-next-line no-console
      console.error('[supabase][dashboard] data_long endings fetch failed:', longEndingsResult.error);
      return null;
    }

    const longRows = Array.isArray(longResult.data) ? longResult.data : [];
    const shortRows = Array.isArray(shortResult.data) ? shortResult.data : [];
    const courseEndingRows = Array.isArray(longEndingsResult.data) ? longEndingsResult.data : [];

    const total_long_activities = longRows.length;
    const total_short_activities = shortRows.length;
    const course_endings = courseEndingRows.length;

    const activeTypeCounts = { course: 0, after_school: 0, workshop: 0, tour: 0, escape_room: 0 };
    for (const r of longRows) {
      const t = String(r.activity_type || '').trim();
      if (Object.prototype.hasOwnProperty.call(activeTypeCounts, t)) activeTypeCounts[t] += 1;
    }
    for (const r of shortRows) {
      const t = String(r.activity_type || '').trim();
      if (Object.prototype.hasOwnProperty.call(activeTypeCounts, t)) activeTypeCounts[t] += 1;
    }

    const instructorIds = new Set();
    for (const r of longRows) {
      const id = String(r.emp_id || '').trim();
      if (id) instructorIds.add(id);
    }
    for (const r of shortRows) {
      const id1 = String(r.emp_id || '').trim();
      const id2 = String(r.emp_id_2 || '').trim();
      if (id1) instructorIds.add(id1);
      if (id2) instructorIds.add(id2);
    }
    const active_instructors_count = instructorIds.size;

    const managerMap = new Map();
    function ensureManager(name) {
      const k = String(name || '').trim();
      if (!k) return null;
      if (!managerMap.has(k)) managerMap.set(k, { total_long: 0, total_short: 0, instructors: new Set(), endings: 0 });
      return managerMap.get(k);
    }
    for (const r of longRows) {
      const mg = ensureManager(r.activity_manager);
      if (!mg) continue;
      mg.total_long += 1;
      const id = String(r.emp_id || '').trim();
      if (id) mg.instructors.add(id);
    }
    for (const r of shortRows) {
      const mg = ensureManager(r.activity_manager);
      if (!mg) continue;
      mg.total_short += 1;
      const id1 = String(r.emp_id || '').trim();
      const id2 = String(r.emp_id_2 || '').trim();
      if (id1) mg.instructors.add(id1);
      if (id2) mg.instructors.add(id2);
    }
    for (const r of courseEndingRows) {
      const mg = ensureManager(r.activity_manager);
      if (!mg) continue;
      mg.endings += 1;
    }

    const by_activity_manager = [...managerMap.entries()].map(([activity_manager, s]) => ({
      activity_manager,
      total_long: s.total_long,
      total_short: s.total_short,
      total: s.total_long + s.total_short,
      num_instructors: s.instructors.size,
      course_endings: s.endings,
      exceptions: 0
    }));

    const totals = {
      total_short_activities,
      total_long_activities,
      total_instructors: active_instructors_count,
      total_course_endings_current_month: course_endings,
      exceptions_count: 0,
      short: total_short_activities,
      long: total_long_activities
    };

    const kpi_cards = buildDashboardKpiCardsFromSupabase(
      totals,
      activeTypeCounts,
      0,
      active_instructors_count,
      course_endings
    );

    return {
      month,
      requested_month: month,
      month_fallback_used: false,
      totals,
      by_activity_manager,
      summary: {
        active_courses_current_month: activeTypeCounts.course,
        ending_courses_current_month: course_endings,
        active_courses_next_month: 0,
        exceptions_count: 0,
        active_instructors: [],
        operational_gaps_count: 0,
        missing_instructor_count: 0,
        missing_start_date_count: 0,
        late_end_date_count: 0,
        short_activities: [],
        active_type_counts: { ...activeTypeCounts }
      },
      kpi_cards,
      show_only_nonzero_kpis: false,
      _source: 'supabase'
    };
  } catch (err) {
    return buildSupabaseErrorPayload({
      month,
      requested_month: month,
      totals: {
        total_short_activities: 0,
        total_long_activities: 0,
        total_instructors: 0,
        total_course_endings_current_month: 0,
        exceptions_count: 0,
        short: 0,
        long: 0
      },
      by_activity_manager: [],
      summary: {
        active_courses_current_month: 0,
        ending_courses_current_month: 0,
        active_courses_next_month: 0,
        exceptions_count: 0,
        active_instructors: [],
        operational_gaps_count: 0,
        missing_instructor_count: 0,
        missing_start_date_count: 0,
        late_end_date_count: 0,
        short_activities: []
      },
      kpi_cards: buildDashboardKpiCardsFromSupabase(
        { total_short_activities: 0, total_long_activities: 0 },
        { course: 0, after_school: 0, workshop: 0, tour: 0, escape_room: 0 },
        0,
        0,
        0
      ),
      show_only_nonzero_kpis: false
    }, err);
  }
}

async function readEndDatesFromSupabase() {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [] }, 'no_supabase_client');
  try {
    const [longRes, meetingsRes] = await Promise.all([
      supabase.from('data_long').select('*'),
      supabase.from('activity_meetings').select('source_row_id,meeting_date,date,start_date,date_start,activity_date,end_date,date_end')
    ]);
    if (longRes.error) return buildSupabaseErrorPayload({ rows: [] }, longRes.error);
    if (meetingsRes.error) return buildSupabaseErrorPayload({ rows: [] }, meetingsRes.error);
    const meetingsByRow = new Map();
    for (const m of (Array.isArray(meetingsRes.data) ? meetingsRes.data : [])) {
      const rowId = String(m?.source_row_id || '').trim();
      if (!rowId) continue;
      const { dateKey } = activityMeetingDateFromCandidates(m);
      if (!dateKey) continue;
      if (!meetingsByRow.has(rowId)) meetingsByRow.set(rowId, []);
      meetingsByRow.get(rowId).push(dateKey);
    }
    const rows = (Array.isArray(longRes.data) ? longRes.data : []).map((row) => {
      const rowId = String(row?.RowID || '').trim();
      const meeting_dates = (meetingsByRow.get(rowId) || []).sort();
      return {
        ...row,
        source_sheet: 'data_long',
        meeting_dates,
        date_cols: meeting_dates
      };
    });
    return { rows, _source: 'supabase' };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [] }, error);
  }
}

function buildExceptionsFromRows(longRows, shortRows, meetingsRows = []) {
  const rows = [];
  const meetingsByRow = new Map();
  for (const meet of meetingsRows) {
    const rowId = String(meet?.source_row_id || '').trim();
    if (!rowId) continue;
    if (!meetingsByRow.has(rowId)) meetingsByRow.set(rowId, []);
    meetingsByRow.get(rowId).push(meet);
  }
  const addException = (row, source_sheet, types) => {
    if (!types.length) return;
    rows.push({
      ...row,
      source_sheet,
      exception_type: types[0],
      exception_types: [...new Set(types)]
    });
  };
  const checkRow = (row, source_sheet) => {
    const types = [];
    const emp1 = String(row?.emp_id || '').trim();
    const emp2 = String(row?.emp_id_2 || '').trim();
    const start = String(row?.start_date || '').trim();
    const end = String(row?.end_date || row?.date_end || '').trim();
    if (!emp1 && !emp2) types.push('missing_instructor');
    if (!start) types.push('missing_start_date');
    if (start && end && end < start) types.push('late_end_date');
    if (!String(row?.activity_manager || '').trim()) types.push('missing_activity_manager');
    if (!String(row?.school || '').trim()) types.push('missing_school');
    if (!String(row?.authority || '').trim()) types.push('missing_authority');
    if (!String(row?.activity_name || '').trim()) types.push('missing_activity_name');
    if (source_sheet === 'data_long' && !(meetingsByRow.get(String(row?.RowID || '').trim()) || []).length) {
      types.push('missing_meetings');
    }
    addException(row, source_sheet, types);
  };
  longRows.forEach((r) => checkRow(r, 'data_long'));
  shortRows.forEach((r) => checkRow(r, 'data_short'));
  return rows;
}

async function readExceptionsFromSupabase(params = {}) {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [], totalExceptionRows: 0 }, 'no_supabase_client');
  const candidate = String(params?.month || params?.ym || '').trim();
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
  const start = `${month}-01`;
  const lastDay = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  try {
    const [longRes, shortRes, meetRes] = await Promise.all([
      supabase.from('data_long').select('*').lte('start_date', end).or(`end_date.gte.${start},date_end.gte.${start}`),
      supabase.from('data_short').select('*').gte('start_date', start).lte('start_date', end),
      supabase.from('activity_meetings').select('*').gte('meeting_date', start).lte('meeting_date', end)
    ]);
    if (longRes.error) return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0 }, longRes.error);
    if (shortRes.error) return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0 }, shortRes.error);
    if (meetRes.error) return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0 }, meetRes.error);
    const longRows = Array.isArray(longRes.data) ? longRes.data : [];
    const shortRows = Array.isArray(shortRes.data) ? shortRes.data : [];
    const meetingsRows = Array.isArray(meetRes.data) ? meetRes.data : [];
    const rows = buildExceptionsFromRows(longRows, shortRows, meetingsRows);
    return { month, rows, totalExceptionRows: rows.length, _source: 'supabase' };
  } catch (error) {
    return buildSupabaseErrorPayload({ rows: [], month, totalExceptionRows: 0 }, error);
  }
}

/**
 * Fire-and-forget Supabase upsert/update after a successful GAS write.
 * Never throws — errors are logged only. Does not block the caller.
 *
 * For instructors: upsert on emp_id.
 * For schools (create / no-key-change edit): upsert on (authority, school, contact_name).
 * For schools (key-change edit): delete old row by origIdentity, then insert new row.
 *   This preserves 1:1 update semantics even when key fields are renamed.
 *
 * origIdentity — original {authority, school, contact_name} from the pre-edit row.
 *   Pass null for addContact (no prior row).
 *
 * GAS-only fields (_row_index, _supabase_orig) are stripped before sending to Supabase.
 *
 * ⚠️ Requires UNIQUE constraint on conflict columns. Without it, upsert inserts
 *   duplicates and this function logs the error — GAS remains source of truth.
 */
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

/**
 * Fire-and-forget Supabase sync after a successful GAS write for activities.
 * Never throws — errors are logged only. Does not block the caller.
 *
 * kind: 'add' | 'save' | 'submit_edit_request' | 'review_edit_request' | 'private_note'
 * payload: the object sent to GAS (before token stripping)
 * gasResponse: the normalized response returned by GAS
 *
 * Tables written:
 *   add                  → data_long / data_short (upsert on RowID)
 *   save                 → data_long / data_short (update by RowID)
 *   submit_edit_request  → edit_requests (upsert on request_id)
 *   review_edit_request  → edit_requests (update status by request_id)
 *                          + data_long/data_short (update by RowID) if approved
 *   private_note         → operations_private_notes (upsert on source_sheet,source_row_id)
 *
 * ⚠️ Requires UNIQUE constraints — see supabase/migrations/20260505_activities_write_sync.sql
 */
async function syncActivityToSupabase(kind, payload, gasResponse) {
  if (!supabase) return;
  try {
    if (kind === 'add') {
      const rowId = gasResponse?.RowID;
      const sourceSheet = gasResponse?.source_sheet;
      if (!rowId || !sourceSheet) return;
      const act = payload?.activity || payload || {};
      const isLong = rowId.startsWith('LONG-');
      const tableName = isLong ? 'data_long' : 'data_short';
      const row = {
        RowID: rowId,
        activity_manager: String(act.activity_manager || ''),
        authority: String(act.authority || ''),
        school: String(act.school || ''),
        grade: String(act.grade || ''),
        class_group: String(act.class_group || ''),
        activity_type: String(act.activity_type || ''),
        activity_no: String(act.activity_no || ''),
        activity_name: String(act.activity_name || ''),
        sessions: String(act.sessions || ''),
        price: String(act.price || ''),
        funding: String(act.funding || ''),
        start_time: String(act.start_time || ''),
        end_time: String(act.end_time || ''),
        emp_id: String(act.emp_id || ''),
        instructor_name: String(act.instructor_name || ''),
        start_date: String(act.start_date || ''),
        end_date: String(act.end_date || act.start_date || ''),
        status: 'פעיל',
        notes: String(act.notes || ''),
        finance_status: String(act.finance_status || ''),
        finance_notes: String(act.finance_notes || ''),
        source_sheet: sourceSheet
      };
      if (!isLong) {
        row.emp_id_2 = String(act.emp_id_2 || '');
        row.instructor_name_2 = String(act.instructor_name_2 || '');
      }
      for (let i = 1; i <= 35; i++) {
        const k = `Date${i}`;
        if (act[k] !== undefined) row[k] = String(act[k] || '');
      }
      const { error } = await supabase.from(tableName).upsert(row, { onConflict: 'RowID' });
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] activity upsert (add) failed:', error);
      }

    } else if (kind === 'save') {
      const sourceRowId = String(payload?.source_row_id || payload?.RowID || '');
      const changes = payload?.changes || {};
      if (!sourceRowId || !Object.keys(changes).length) return;
      const isLong = sourceRowId.startsWith('LONG-');
      const tableName = isLong ? 'data_long' : 'data_short';
      const { error } = await supabase.from(tableName).update(changes).eq('RowID', sourceRowId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] activity update (save) failed:', error);
      }

    } else if (kind === 'submit_edit_request') {
      const requestId = gasResponse?.request_id;
      if (!requestId) return;
      const sourceRowId = String(payload?.source_row_id || '');
      const isLong = sourceRowId.startsWith('LONG-');
      const row = {
        request_id: requestId,
        source_sheet: isLong ? 'data_long' : 'data_short',
        source_row_id: sourceRowId,
        changed_fields: JSON.stringify(Object.keys(payload?.changes || {})),
        original_values: JSON.stringify({}),
        requested_values: JSON.stringify(payload?.changes || {}),
        requested_at: new Date().toISOString(),
        status: 'pending',
        active: 'yes'
      };
      const { error } = await supabase.from('edit_requests').upsert(row, { onConflict: 'request_id' });
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] edit_requests upsert (submit) failed:', error);
      }

    } else if (kind === 'review_edit_request') {
      const requestId = String(payload?.request_id || '');
      const finalStatus = gasResponse?.status || payload?.status || '';
      if (!requestId) return;
      const { error } = await supabase
        .from('edit_requests')
        .update({ status: finalStatus, reviewed_at: new Date().toISOString() })
        .eq('request_id', requestId);
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] edit_requests update (review) failed:', error);
      }

    } else if (kind === 'private_note') {
      const sourceSheet = String(payload?.source_sheet || '');
      const sourceRowId = String(payload?.source_row_id || '');
      if (!sourceSheet || !sourceRowId) return;
      const row = {
        source_sheet: sourceSheet,
        source_row_id: sourceRowId,
        note_text: String(payload?.note || payload?.note_text || ''),
        updated_at: new Date().toISOString(),
        active: 'yes'
      };
      const { error } = await supabase
        .from('operations_private_notes')
        .upsert(row, { onConflict: 'source_sheet,source_row_id' });
      if (error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] operations_private_notes upsert failed:', error);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[supabase] syncActivityToSupabase unexpected error:', err);
  }
}

const RETRYABLE_SERVER_ERRORS = new Set([
  'network_error',
  'server_error',
  'service_unavailable',
  'timeout',
  'temporarily_unavailable',
  'internal_error'
]);

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

function invalidateReadModelLocalCacheByAction(action) {
  const targeted = {
    saveActivity: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    addActivity: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    submitEditRequest: ['dashboard', 'activities', 'week', 'month', 'exceptions', 'end-dates'],
    reviewEditRequest: ['dashboard', 'activities', 'week', 'month', 'exceptions'],
    savePermission: ['dashboard']
  };
  const keys = targeted[action];
  if (!keys?.length) return;
  const allCache = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
  Object.keys(allCache).forEach((cacheKey) => {
    if (keys.some((key) => cacheKey === key || cacheKey.startsWith(`${key}?`))) {
      delete allCache[cacheKey];
    }
  });
  safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, allCache);
  manifestCache = { t: 0, data: null };
}

function monthReadModelKey(payload = {}) {
  const ym = String(payload?.ym || payload?.month || '').trim();
  return /^\d{4}-\d{2}$/.test(ym) ? ym : '__current__';
}

function clearMonthReadModelCache() {
  monthReadModelCache.clear();
}

function safeLocalStorageGetJson(key, fallback) {
  if (!READ_MODELS_ENABLED) return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSetJson(key, value) {
  if (!READ_MODELS_ENABLED) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

async function getReadModelManifestCached() {
  if (!READ_MODELS_ENABLED) return {};
  const now = Date.now();
  if (manifestCache.data && now - manifestCache.t < MANIFEST_TTL_MS) return manifestCache.data;
  if (manifestInflight) return manifestInflight;
  manifestInflight = request('readModelManifest', {})
    .then((fresh) => {
      manifestCache = { t: Date.now(), data: fresh || {} };
      manifestInflight = null;
      return manifestCache.data;
    })
    .catch((err) => {
      manifestInflight = null;
      throw err;
    });
  return manifestInflight;
}

function readModelLocalCacheKey(key, params = {}) {
  const normalized = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  const suffix = normalized.map(([k, v]) => `${k}=${String(v).trim()}`).join('&');
  return suffix ? `${key}?${suffix}` : key;
}

function manifestEntryForReadModel(key, params = {}) {
  if (key === 'week' || key === 'month' || key === 'exceptions') {
    return readModelLocalCacheKey(key, params);
  }
  if (key === 'dashboard') return 'dashboard';
  if (key === 'activities') return 'activities';
  if (key === 'end-dates') return 'end-dates';
  if (key === 'instructors') return 'instructors';
  return null;
}

function warnReadModelClientLegacy(screenKey, legacyAction, reason, extra = {}) {
  try {
    console.warn('[readModel][client] legacy action', JSON.stringify({
      screen: String(screenKey),
      legacy_action: String(legacyAction),
      reason: String(reason),
      ...extra
    }));
  } catch {
    /* ignore */
  }
}

async function requestReadModel(key, params = {}, fallbackAction, fallbackPayload = {}, options = {}) {
  const perfBase = {
    action: fallbackAction,
    used_read_model: false,
    fallback_used: false,
    cache_hit: false,
    sheet_reads_count: null
  };
  if (!READ_MODELS_ENABLED || !READ_MODEL_ENABLED_KEYS.has(key)) {
    if (READ_MODEL_ENABLED_KEYS.has(key) && !READ_MODELS_ENABLED) {
      warnReadModelClientLegacy(key, fallbackAction, 'read_models_client_disabled', { params });
      return request(fallbackAction, fallbackPayload, {
        ...perfBase,
        fallback_used: true,
        legacy_fallback_reason: 'read_models_client_disabled',
        legacy_intentional: true,
        read_model_screen_key: key,
        ...options
      });
    }
    return request(fallbackAction, fallbackPayload, {
      ...perfBase,
      fallback_used: true,
      used_read_model: false,
      legacy_fallback_reason: 'read_model_not_enabled_for_screen',
      legacy_intentional: true,
      read_model_screen_key: key,
      ...options
    });
  }

  const manifestKey = manifestEntryForReadModel(key, params);
  const localKey = readModelLocalCacheKey(key, params);

  async function fetchReadModelFresh_() {
    const envelope = await request('readModelGet', { key, params }, {
      action: fallbackAction,
      used_read_model: true,
      fallback_used: false,
      cache_hit: false,
      ...options
    });
    const data = envelope?.data ?? envelope ?? {};
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    const nextCache = {
      ...cachedModels,
      [localKey]: {
        key,
        version: envelope?.version || '',
        hash: envelope?.hash || '',
        updated_at: envelope?.updated_at || '',
        data
      }
    };
    safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, nextCache);
    return data;
  }

  try {
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    const hit = cachedModels?.[localKey];

    if (hit && hit.data) {
      let cacheFresh = false;
      try {
        const manifest = await getReadModelManifestCached();
        const manifestMeta = manifestKey ? manifest?.[manifestKey] : null;
        cacheFresh =
          !!manifestMeta &&
          !!hit.version &&
          !!hit.hash &&
          hit.version === manifestMeta.version &&
          hit.hash === manifestMeta.hash;
      } catch (_manifestErr) {
        cacheFresh = false;
      }

      if (cacheFresh) {
        refreshReadModelInBackground_(key, params, localKey, manifestKey, hit);
        pushPerfRequest({
          action: fallbackAction,
          duration_ms: 0,
          slow: false,
          payload_size: JSON.stringify(hit.data || {}).length,
          used_read_model: true,
          fallback_used: false,
          cache_hit: true,
          sheet_reads_count: null
        });
        return hit.data;
      }

      try {
        return await fetchReadModelFresh_();
      } catch (_refreshErr) {
        warnReadModelClientLegacy(key, fallbackAction, 'read_model_refresh_failed', {
          params,
          error: _refreshErr?.message || String(_refreshErr)
        });
        const staleData = hit?.data && typeof hit.data === 'object' ? { ...hit.data, _read_model_stale: true } : hit?.data;
        if (staleData) {
          pushPerfRequest({
            action: fallbackAction,
            duration_ms: 0,
            slow: false,
            payload_size: JSON.stringify(staleData || {}).length,
            used_read_model: true,
            fallback_used: false,
            cache_hit: true,
            stale_cache_used: true,
            sheet_reads_count: null
          });
          return staleData;
        }
        throw _refreshErr;
      }
    }

    return await fetchReadModelFresh_();
  } catch (err) {
    warnReadModelClientLegacy(key, fallbackAction, 'read_model_get_failed', {
      params,
      error: err?.message || String(err)
    });
    const explicitLegacy = options?.forceLegacy === true || params?.force_legacy === true || String(params?.force_legacy || '').toLowerCase() === 'yes' || options?.debug === true;
    const legacyReason = explicitLegacy ? 'read_model_get_failed_explicit' : 'read_model_get_failed_auto_fallback';
    if (fallbackAction) {
      return request(fallbackAction, { ...(fallbackPayload || {}), force_legacy: true }, {
        ...perfBase,
        fallback_used: true,
        legacy_fallback_reason: legacyReason,
        legacy_intentional: true,
        read_model_screen_key: key,
        ...options
      });
    }
    throw new Error('הנתונים מתעדכנים כעת. נסו שוב בעוד מספר רגעים.');
  }
}

async function refreshReadModelInBackground_(key, params, localKey, manifestKey, hit) {
  if (!READ_MODELS_ENABLED) return;
  try {
    const manifest = await getReadModelManifestCached();
    const manifestMeta = manifestKey ? manifest?.[manifestKey] : null;
    if (
      manifestMeta &&
      hit.version &&
      hit.hash &&
      hit.version === manifestMeta.version &&
      hit.hash === manifestMeta.hash
    ) return;
    const envelope = await request('readModelGet', { key, params });
    const data = envelope?.data ?? envelope ?? {};
    const cachedModels = safeLocalStorageGetJson(READ_MODEL_CACHE_STORAGE_KEY, {});
    cachedModels[localKey] = {
      key,
      version: envelope?.version || '',
      hash: envelope?.hash || '',
      updated_at: envelope?.updated_at || '',
      data
    };
    safeLocalStorageSetJson(READ_MODEL_CACHE_STORAGE_KEY, cachedModels);
  } catch (_err) {}
}

/**
 * When true, requests include debug_perf and console logs [perf] lines with server metrics.
 * Enable any of:
 *   localStorage.setItem('ds_debug_perf', '1')
 *   localStorage.setItem('debug_perf', '1')   // legacy
 *   window.__DEBUG_PERF__ = true
 *   ?debug_perf=1 on the app URL
 * Server: set script property DEBUG_PERF=1 for all requests without client flags.
 */
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

async function postWithTimeout(action, requestBody, timeoutOverrideMs) {
  void action;
  void requestBody;
  void timeoutOverrideMs;
  throw new Error('legacy_gas_api_disabled');
}

function emitPerfEntry(entry) {
  pushPerfRequest({
    ...entry,
    slow: Number(entry?.duration_ms || 0) > 3000
  });
  if (isPerfDebugEnabled()) {
    const line = {
      action: entry.action,
      duration_ms: entry.duration_ms,
      server_duration_ms: entry.server_duration_ms,
      sheet_reads_count: entry.sheet_reads_count,
      payload_size: entry.payload_size,
      server_payload_size: entry.server_payload_size,
      fallback_used: entry.fallback_used,
      legacy_fallback_reason: entry.legacy_fallback_reason,
      cache_hit: entry.cache_hit,
      background_refresh: entry.background_refresh
    };
    // eslint-disable-next-line no-console
    console.info('[perf]', line, entry.backend_debug || '');
  }
}

function buildPerfRequestEntry(action, requestStart, lastResponseText, perfMeta = {}, sheetReads = null, backendDebug = null) {
  const durationMs = Math.round(performance.now() - requestStart);
  const dbg = backendDebug && typeof backendDebug === 'object' ? backendDebug : null;
  const fromServerCount = dbg?.sheet_reads_count;
  const fromServerArray = Array.isArray(dbg?.sheet_reads) ? dbg.sheet_reads.length : null;
  const mergedSheetReads =
    sheetReads != null && sheetReads !== ''
      ? sheetReads
      : (fromServerCount != null ? fromServerCount : fromServerArray);
  const serverDuration = dbg?.duration_ms ?? dbg?.total_ms ?? null;
  const serverPayloadSize = dbg?.payload_size ?? dbg?.response_size_bytes ?? null;
  const serverFallback = dbg?.fallback_used;
  const legacyReason =
    perfMeta.legacy_fallback_reason ?? dbg?.read_model_legacy_reason ?? null;
  const bg =
    perfMeta.background_refresh ??
    (typeof globalThis !== 'undefined' && globalThis.__DS_BG_SCREEN_REFRESH__);
  const mergedFallback =
    serverFallback !== undefined && serverFallback !== null
      ? Boolean(serverFallback)
      : Boolean(perfMeta.fallback_used) || Boolean(dbg?.read_model_legacy_fallback) || Boolean(legacyReason);
  return {
    action: perfMeta.action || action,
    duration_ms: durationMs,
    server_duration_ms: serverDuration,
    slow: durationMs > 3000,
    payload_size: typeof lastResponseText === 'string' ? lastResponseText.length : null,
    server_payload_size: serverPayloadSize,
    used_read_model: Boolean(perfMeta.used_read_model || action === 'readModelGet'),
    fallback_used: mergedFallback,
    legacy_fallback_reason: legacyReason,
    cache_hit: Boolean(perfMeta.cache_hit || dbg?.cache_hit),
    sheet_reads_count: mergedSheetReads,
    background_refresh: Boolean(bg),
    backend_debug: dbg
  };
}

async function request(action, payload = {}, perfMeta = {}) {
  void action;
  void payload;
  void perfMeta;
  throw new Error('legacy_gas_api_disabled');
}

const SUPABASE_ROLE_ROUTES = {
  admin: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'permissions', 'admin-lists'],
  operation_manager: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  authorized_user: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates'],
  instructor: ['dashboard', 'activities', 'archive', 'week', 'month', 'instructor-contacts', 'my-data']
};

function flattenUserRow(userRow = {}) {
  const permissions = userRow?.permissions && typeof userRow.permissions === 'object' ? userRow.permissions : {};
  return {
    user_id: String(userRow.user_id || ''),
    full_name: String(userRow.name || ''),
    role: String(userRow.role || 'authorized_user'),
    display_role: String(userRow.role || 'authorized_user'),
    display_role_label: hebrewRole(String(userRow.role || 'authorized_user')),
    display_role2: String(permissions.display_role2 || ''),
    emp_id: String(userRow.emp_id || ''),
    entry_code: String(userRow.entry_code || ''),
    active: userRow.is_active ? 'yes' : 'no',
    ...permissions
  };
}

function buildBootstrapFromUser(userRow) {
  const flat = flattenUserRow(userRow);
  const role = String(flat.role || 'authorized_user');
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
    can_edit_direct: String(flat.can_edit_direct || '').toLowerCase() === 'yes' || role === 'admin',
    can_request_edit: String(flat.can_request_edit || '').toLowerCase() !== 'no',
    client_settings: {}
  };
}

async function getActiveUserByLogin(user_id, entry_code) {
  if (!supabase) throw new Error('no_supabase_client');
  const uid = String(user_id || '').trim();
  const code = String(entry_code || '').trim();
  if (!uid || !code) throw new Error('invalid_credentials');
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
    .or(`user_id.eq.${uid},email.eq.${uid},emp_id.eq.${uid}`)
    .limit(20);
  if (error) throw new Error(error.message || 'auth_query_failed');
  const hit = (Array.isArray(data) ? data : []).find((r) => String(r.entry_code || '').trim() === code);
  if (!hit) throw new Error('invalid_credentials');
  return hit;
}

function makeSessionToken(userRow) {
  const claims = {
    uid: String(userRow.user_id || ''),
    role: String(userRow.role || 'authorized_user'),
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
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) throw new Error('unauthorized');
  if (!data.is_active) throw new Error('unauthorized');
  return data;
}

async function upsertActivityToSupabase(payload = {}) {
  const act = payload?.activity || payload || {};
  const source = String(act.source || '').trim() === 'short' ? 'short' : 'long';
  const tableName = source === 'short' ? 'data_short' : 'data_long';
  const rowId = String(act.RowID || `${source === 'short' ? 'SHORT' : 'LONG'}-${crypto.randomUUID?.() || Date.now()}`).trim();
  const row = { ...act, RowID: rowId, source_sheet: tableName, status: String(act.status || 'פעיל') };
  const { data, error } = await supabase.from(tableName).upsert(row, { onConflict: 'RowID' }).select().single();
  if (error) throw new Error(error.message || 'save_failed');
  return { RowID: rowId, source_sheet: tableName, row: data || row };
}

async function updateActivityInSupabase(payload = {}) {
  const sourceRowId = String(payload?.source_row_id || payload?.RowID || '').trim();
  const changes = payload?.changes || {};
  if (!sourceRowId) throw new Error('missing_row_id');
  const tableName = sourceRowId.startsWith('SHORT-') ? 'data_short' : 'data_long';
  const { error } = await supabase.from(tableName).update(changes).eq('RowID', sourceRowId);
  if (error) throw new Error(error.message || 'save_failed');
  return { ok: true, RowID: sourceRowId, source_sheet: tableName };
}

async function readActivityDetailFromSupabase(source_row_id, source_sheet) {
  const rowId = String(source_row_id || '').trim();
  const sheet = String(source_sheet || '').trim();
  const tableName = sheet === 'data_short' || rowId.startsWith('SHORT-') ? 'data_short' : 'data_long';
  const [{ data, error }, { data: noteData }] = await Promise.all([
    supabase.from(tableName).select('*').eq('RowID', rowId).single(),
    supabase.from('operations_private_notes').select('note_text').eq('source_row_id', rowId).maybeSingle()
  ]);
  if (error) throw new Error(error.message || 'detail_failed');
  return { row: { ...(data || {}), source_sheet: tableName, private_note: noteData?.note_text ?? '' } };
}

async function readActivityDatesFromSupabase(source_row_id, source_sheet) {
  const rowId = String(source_row_id || '').trim();
  const sheet = String(source_sheet || '').trim();
  const isShort = sheet === 'data_short' || rowId.startsWith('SHORT-');

  if (isShort) {
    const { data, error } = await supabase
      .from('data_short')
      .select('start_date,RowID')
      .eq('RowID', rowId)
      .maybeSingle();
    if (error) throw new Error(error.message || 'dates_failed');
    const dateKey = String(data?.start_date || '').trim().slice(0, 10);
    const meeting_dates = dateKey ? [dateKey] : [];
    return {
      meeting_dates,
      date_cols: meeting_dates,
      rows: dateKey ? [{ source_row_id: rowId, meeting_date: dateKey }] : [],
      source_row_id: rowId,
      source_sheet: 'data_short'
    };
  }

  const { data, error } = await supabase
    .from('activity_meetings')
    .select('*')
    .eq('source_row_id', rowId)
    .order('meeting_date', { ascending: true });
  if (error) throw new Error(error.message || 'dates_failed');
  const rows = Array.isArray(data) ? data : [];
  const meeting_dates = rows
    .map((r) => activityMeetingDateFromCandidates(r).dateKey)
    .filter(Boolean)
    .sort();
  return {
    meeting_dates,
    date_cols: meeting_dates,
    rows,
    source_row_id: rowId,
    source_sheet: sheet
  };
}

async function readAllActivitiesRowsSupabase() {
  const [longRes, shortRes] = await Promise.all([
    supabase.from('data_long').select('*'),
    supabase.from('data_short').select('*')
  ]);
  if (longRes.error) throw new Error(longRes.error.message || 'data_long_read_failed');
  if (shortRes.error) throw new Error(shortRes.error.message || 'data_short_read_failed');
  const longRows = (Array.isArray(longRes.data) ? longRes.data : []).map((r) => ({ ...r, source_sheet: 'data_long' }));
  const shortRows = (Array.isArray(shortRes.data) ? shortRes.data : []).map((r) => ({ ...r, source_sheet: 'data_short' }));
  return [...longRows, ...shortRows];
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
    const user = await getActiveUserByLogin(user_id, entry_code);
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
        can_edit_direct: String(flat.can_edit_direct || '').toLowerCase() === 'yes' || flat.role === 'admin',
        can_request_edit: String(flat.can_request_edit || '').toLowerCase() !== 'no'
      },
      ...buildBootstrapFromUser(user)
    };
  },
  bootstrap: async () => {
    const user = await readCurrentUserBySession();
    return buildBootstrapFromUser(user);
  },
  dashboard: (filters) => api.dashboardReadModel(filters || {}),
  dashboardSnapshot: (filters) => api.dashboardReadModel(filters || {}),
  dashboardSheet: (filters) => api.dashboardReadModel(filters || {}),
  dashboardReadModel: async (filters, options) => {
    const resolved = (filters && typeof filters === 'object') ? filters : {};
    const candidate = String(resolved.month || resolved.ym || '').trim();
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
    const canonical = { ...resolved, month };
    const supabasePayload = await dashboardReadModelFromSupabase(month);
    return { ...supabasePayload, ...canonical };
  },
  archiveActivities: async () => {
    const data = await readArchiveActivitiesFromSupabase();
    if (data) return data;
    return buildSupabaseErrorPayload({ rows: [] }, 'archive_supabase_failed');
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
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message || 'permissions_read_failed');
    const rows = (Array.isArray(data) ? data : []).map(flattenUserRow);
    return {
      rows,
      roleDefaults: {
        admin: { can_add_activity: 'yes', can_edit_direct: 'yes', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'yes', view_permissions: 'yes' },
        operation_manager: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'yes', view_admin: 'yes', view_permissions: 'no' },
        authorized_user: { can_add_activity: 'yes', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' },
        instructor: { can_add_activity: 'no', can_edit_direct: 'no', can_request_edit: 'yes', can_review_requests: 'no', view_admin: 'no', view_permissions: 'no' }
      }
    };
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
  submitEditRequest: async (source_row_id, changes) => {
    const normalizedChanges = Object.entries(changes || {}).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) return acc;
      const normalizedValue = String(value).trim();
      acc[key] = normalizedValue;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.info('[submitEditRequest] source_row_id', source_row_id);
    // eslint-disable-next-line no-console
    console.info('[submitEditRequest] changes', normalizedChanges);
    if (!source_row_id || !Object.keys(normalizedChanges).length) {
      throw new Error('No changes to submit');
    }
    const row = {
      request_id: `REQ-${Date.now()}`,
      source_row_id,
      source_sheet: source_row_id.startsWith('SHORT-') ? 'data_short' : 'data_long',
      changed_fields: Object.keys(normalizedChanges),
      requested_values: normalizedChanges,
      status: 'pending',
      active: 'yes',
      requested_at: new Date().toISOString()
    };
    const { error } = await supabase.from('edit_requests').insert(row);
    if (error) throw new Error(error.message || 'submit_edit_request_failed');
    return { request_id: row.request_id, status: 'pending' };
  },
  reviewEditRequest: async (request_id, status) => {
    const requestId = String(request_id || '').trim();
    const nextStatus = String(status || '').trim();
    if (!requestId) throw new Error('missing_request_id');
    const reqRes = await supabase
      .from('edit_requests')
      .select('*')
      .eq('request_id', requestId)
      .single();
    if (reqRes.error || !reqRes.data) throw new Error(reqRes.error?.message || 'review_edit_request_failed');
    const reqRow = reqRes.data;
    if (nextStatus === 'approved') {
      const sourceSheet = String(reqRow?.source_sheet || '').trim();
      const sourceRowId = String(reqRow?.source_row_id || '').trim();
      const tableName = sourceSheet === 'data_short' || sourceRowId.startsWith('SHORT-') ? 'data_short' : 'data_long';
      const requestedValues =
        reqRow?.requested_values && typeof reqRow.requested_values === 'object'
          ? reqRow.requested_values
          : (() => {
              try { return JSON.parse(String(reqRow?.requested_values || '{}')); } catch { return {}; }
            })();
      if (sourceRowId && requestedValues && Object.keys(requestedValues).length) {
        const { error: applyErr } = await supabase
          .from(tableName)
          .update(requestedValues)
          .eq('RowID', sourceRowId);
        if (applyErr) throw new Error(applyErr.message || 'review_edit_request_apply_failed');
      }
    }
    const { error } = await supabase
      .from('edit_requests')
      .update({ status: nextStatus, reviewed_at: new Date().toISOString() })
      .eq('request_id', requestId);
    if (error) throw new Error(error.message || 'review_edit_request_failed');
    return { request_id: requestId, status: nextStatus };
  },
  savePermission: async (row) => {
    const userId = String(row?.user_id || '').trim();
    if (!userId) throw new Error('missing_user_id');
    const existing = await supabase.from('users').select('*').eq('user_id', userId).single();
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
      entry_code: row.entry_code ?? existing.data.entry_code,
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
      ? { source_sheet: a.source_sheet, source_row_id: a.source_row_id, note: a.note ?? a.note_text ?? '' }
      : { source_sheet: a, source_row_id: b, note: c };
    const row = {
      source_sheet: payload.source_sheet,
      source_row_id: payload.source_row_id,
      note_text: payload.note,
      updated_at: new Date().toISOString(),
      active: 'yes'
    };
    const { error } = await supabase.from('operations_private_notes').upsert(row, { onConflict: 'source_sheet,source_row_id' });
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
        { name: 'data_short' },
        { name: 'data_long' },
        { name: 'activity_meetings' },
        { name: 'contacts_instructors' },
        { name: 'contacts_schools' },
        { name: 'lists' }
      ];
    })();
    return {
      sheets,
      sheet_roles: {
        sheet_short_activities: map.get('sheet_short_activities') || 'data_short',
        sheet_long_activities: map.get('sheet_long_activities') || 'data_long'
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
      description: role === 'sheet_short_activities'
        ? 'Supabase source for short activities'
        : (role === 'sheet_long_activities' ? 'Supabase source for long activities' : 'Sheet mapping')
    };
    const { error } = await supabase.from('settings').upsert(row, { onConflict: 'key' });
    if (error) throw new Error(error.message || 'save_sheet_mapping_failed');
    return { ok: true };
  },
  readModelManifest: async () => ({ _source: 'supabase', manifest: {} }),
  readModelGet: async () => ({ _source: 'supabase', data: {} }),
  readModelHealth: async () => ({ _source: 'supabase', ok: true }),
};

export { isPerfDebugEnabled, getPerfStore, READ_MODELS_ENABLED, READ_MODEL_ENABLED_KEY_LIST };
