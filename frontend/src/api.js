import { state, setSession, clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
import { getActivityAuthorityName, getActivityContactName, getActivityContactPhone, getActivitySchoolNames } from './screens/shared/operations-activity-helpers.js';
import { cleanActivityManagerName, getContactsInstructorUsers, getRosterUsers, NO_ACTIVITY_MANAGER_LABEL, normalizeOneDayActivityType, resolveActivityInstructorName, buildContactsInstructorLookup, resolveCanonicalInstructorPair, validateInstructorIdentityPayload } from './screens/shared/activity-options.js';
import { EXCEPTION_TYPE_ORDER, normalizedExceptionTypes } from './screens/shared/exceptions-metrics.js';
import { ACTIVITY_SEASON_SCHOOL_2027, activityMatchesPeriodKey, isSummerActivity, normalizeActivitySeason, normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import {
  normalizeContactMatchText,
  buildContactResponsibleIndex,
  findContactResponsibleGroup,
  contactResponsibleGroupsArray,
  buildSummerContactIndex,
  buildContactsSchoolsIndex,
  buildSchoolsCatalogContactIndex,
  resolveSchoolContact
} from './screens/shared/contact-responsible.js';
import { resolveActiveUserRowAfterAuth } from './auth-user-resolve.js';
import { supabase, supabaseConfig, waitForSupabaseAuthSession, resetSupabaseAuthSessionWait } from './supabase-client.js';
import { isEmptyValue, nonEmptyString } from './utils/empty-value.js';
import { withResolvedSchool2027Contact } from './screens/shared/school-2027-contact.js';
import { permissionFlagYes, canEditDirect, canAddActivityDirect, canRequestEdit, canRequestCreateActivity, canReviewRequests } from './permissions.js';

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
  deleteSchoolContact: true,
  updateUnifiedContactRecord: true,
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
  saveProposalAgreementItems: true,
  uploadCompletionApproval: true,
  replaceCompletionApprovalUpload: true,
  deleteCompletionApprovalUpload: true,
  reviewCompletionApprovalUpload: true,
  saveSchoolContactResponsible: true
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
  completionApprovalUploads: true,
  completionApprovalSignedUrl: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  proposalsAgreements: true,
  activityLayoutStatuses: true,
  adminSettings: true,
  adminLists: true,
  workshopStockDistributions: true,
  instructorSchedulePrintContacts: true,
  listSheets: true,
  israaProgramTracking: true,
  israaSimulatorEntries: true,
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 45000;
const PERF_MAX_REQUESTS = 150;
const ACTIVITY_DIRECT_MANAGE_ROLES = new Set(['admin', 'operation_manager']);
const ACTIVE_INSTRUCTOR_EMP_IDS = new Set(['1525', '1506', '1527', '1502', '1507', '1509', '1515', '1500', '1503', '1511']);

function currentUserIdentityValues() {
  const user = state?.user || {};
  return [user.emp_id, user.employee_id, user.user_id].map((v) => String(v || '').trim()).filter(Boolean);
}

function isActiveInstructorPilotUser(user = state?.user || {}) {
  return [user.emp_id, user.employee_id, user.user_id].map((v) => String(v || '').trim()).some((id) => ACTIVE_INSTRUCTOR_EMP_IDS.has(id));
}

const ACTIVITY_REQUEST_ROLES = new Set(['activities_manager', 'instructor_manager', 'business_development_manager']);
const COMPLETION_APPROVAL_MANAGER_ROLES = new Set(['admin', 'operation_manager', 'domain_manager', 'activities_manager', 'instructor_manager']);

const DASHBOARD_ACTIVITY_COLUMNS = [
  'row_id', 'activity_family', 'activity_manager', 'activity_name', 'authority', 'school',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2', 'start_date', 'end_date',
  'status', 'activity_type', 'district', ...Array.from({ length: 35 }, (_, index) => `date_${index + 1}`)
].join(',');
const DASHBOARD_ACTIVITY_MIN_COLUMNS = 'row_id,activity_family,activity_manager,activity_name,authority,school,instructor_name,instructor_name_2,emp_id,emp_id_2,start_date,end_date,status,activity_type';
const SETTINGS_BOOTSTRAP_COLUMNS = 'key,value,description';
const LISTS_BOOTSTRAP_COLUMNS = 'list_id,category,value,label,active,is_active,category_order,sort_order,activity_no,activity_name,activity_type,type,stock_quantity,stock_group_key,stock_group_name,stock_item_name,stock_label,parent_value';
let settingsRowsCache = null;
let settingsRowsPromise = null;
let listsRowsCache = null;
let listsRowsPromise = null;
let instructorContactsCache = null;
let instructorContactsPromise = null;

function assertAdminApi() {
  const role = String(state?.user?.role || state?.user?.display_role || '').trim();
  if (role !== 'admin') throw new Error('admin_only');
}

function normalizeWorkshopStockQuantity(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function buildListStockQuantityPatch(existingRow = {}, stockQuantity) {
  const patch = { stock_quantity: stockQuantity };
  const rawMeta = existingRow?.metadata;
  if (rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)) {
    patch.metadata = { ...rawMeta, stock_quantity: stockQuantity };
  } else if (typeof rawMeta === 'string' && rawMeta.trim()) {
    try {
      const parsed = JSON.parse(rawMeta);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        patch.metadata = { ...parsed, stock_quantity: stockQuantity };
      }
    } catch {
      // keep column-only update
    }
  }
  return patch;
}

async function updateWorkshopStockItemsInSupabase(updates = []) {
  assertAdminApi();
  if (!supabase) throw new Error('no_supabase_client');
  const rows = Array.isArray(updates) ? updates : [];
  const saved = [];
  const editableCategories = ['workshop_stock', 'activity_names'];
  for (const item of rows) {
    const stockQuantity = normalizeWorkshopStockQuantity(item?.stock_quantity ?? item?.stockQuantity);
    if (stockQuantity == null) continue;
    const stockGroupKey = String(item?.stock_group_key || item?.stockGroupKey || '').trim();
    if (!stockGroupKey) throw new Error('workshop_stock_group_key_required');
    const listId = String(item?.list_id || item?.listId || '').trim();
    const source = String(item?.source || '').trim();

    if (listId && editableCategories.includes(source)) {
      const { data, error } = await supabase
        .from('lists')
        .update(buildListStockQuantityPatch(item?._row || item, stockQuantity))
        .eq('list_id', listId)
        .eq('category', source)
        .eq('stock_group_key', stockGroupKey)
        .select('list_id,category,value,label,stock_quantity,stock_group_key,stock_group_name,metadata')
        .single();
      if (error) throw new Error(error.message || 'workshop_stock_update_failed');
      saved.push(data);
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from('lists')
      .select('list_id,category,value,label,stock_quantity,stock_group_key,stock_group_name,metadata')
      .in('category', editableCategories)
      .eq('stock_group_key', stockGroupKey)
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message || 'workshop_stock_lookup_failed');
    if (!existing?.list_id) throw new Error('workshop_stock_mapping_not_found');

    const { data, error } = await supabase
      .from('lists')
      .update(buildListStockQuantityPatch(existing, stockQuantity))
      .eq('list_id', existing.list_id)
      .eq('category', existing.category)
      .eq('stock_group_key', stockGroupKey)
      .select('list_id,category,value,label,stock_quantity,stock_group_key,stock_group_name,metadata')
      .single();
    if (error) throw new Error(error.message || 'workshop_stock_update_failed');
    saved.push(data);
  }
  clearBootstrapReadCaches();
  return { ok: true, rows: saved };
}


function clearBootstrapReadCaches() {
  settingsRowsCache = null;
  settingsRowsPromise = null;
  listsRowsCache = null;
  listsRowsPromise = null;
}

async function readInstructorContactsRowsForBootstrap() {
  if (!supabase) return [];
  if (instructorContactsCache) return instructorContactsCache;
  if (instructorContactsPromise) return instructorContactsPromise;
  instructorContactsPromise = (async () => {
    const { data, error } = await supabase.from('contacts_instructors').select('emp_id,full_name,active');
    if (error) {
      console.error('[contacts][contacts_instructors] read failed', { columns: 'emp_id,full_name,active', code: error?.code, message: error?.message, error });
      return [];
    }
    instructorContactsCache = Array.isArray(data) ? data : [];
    return instructorContactsCache;
  })().finally(() => { instructorContactsPromise = null; });
  return instructorContactsPromise;
}
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
    const rawRows = Array.isArray(data) ? data : [];
    const rows = filterRowsByGlobalActivityPeriod(rawRows.map(normalizeActivityRow))
      .sort((a, b) => String(b?.end_date || b?.start_date || '').localeCompare(String(a?.end_date || a?.start_date || '')));
    return { rows, _source: 'supabase', _debug: { activities_loaded_from_supabase: rawRows.length, source_table: 'public.activities' } };
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
    const rawRows = Array.isArray(data) ? data : [];
    const normalizedRows = rawRows.map(normalizeActivityRow);
    const contactRows = await readContactsForSchool2027Activities(normalizedRows);
    const rows = normalizedRows
      .map((row) => withResolvedSchool2027Contact(row, contactRows))
      .filter((row) => filters?.include_all_periods ? true : activityMatchesPeriodKey(row, filters?.activity_period || currentGlobalActivityPeriod()))
      .filter((row) => filters?.include_inactive ? true : !isActivityInactive(row))
      .filter((row) => rowMatchesActivitiesFilters(row, filters));
    return { rows, _source: 'supabase', _debug: { activities_loaded_from_supabase: rawRows.length, source_table: 'public.activities' } };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected activities fetch error:', error);
    return null;
  }
}


function currentGlobalActivityPeriod() {
  return normalizeGlobalActivityPeriod(state?.activityPeriodTab || 'regular');
}

function filterRowsByGlobalActivityPeriod(rows = [], period = currentGlobalActivityPeriod()) {
  return (Array.isArray(rows) ? rows : []).filter((row) => activityMatchesPeriodKey(row, period));
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
const APPROVED_PENDING_PLACEMENT_STATUS = 'מאושר - ממתין לשיבוץ';
const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);

function oneDayTypeFromActivityFields(activityType, itemType) {
  return canonicalOneDayActivityType(activityType) || canonicalOneDayActivityType(itemType);
}

/**
 * Normalizes a human-readable name field by replacing underscores with spaces.
 * Used to guard against underscore-encoded names (e.g. from the lists table value field).
 * Safe to apply to any display name — does NOT touch technical IDs or slugs.
 */
function normalizeHumanName(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeActivityRow(row = {}) {
  const canonicalOneDayType = oneDayTypeFromActivityFields(row?.activity_type, row?.item_type);
  const isLegacyOneDay = canonicalOneDayType && (String(row?.activity_family || '').trim() === 'one_day' || !String(row?.item_type || '').trim());
  const rowId = String(row?.row_id ?? row?.RowID ?? '').trim();
  const activitySeason = normalizeActivitySeason(row?.activity_season ?? row?.activitySeason);
  const authorityName = String(row?.authority_name || row?.legacy_authority || row?.authority || '').trim();
  const schoolName = String(
    row?.single_school_name ||
    row?.linked_school_names ||
    row?.linked_school_name_list ||
    row?.legacy_school ||
    row?.school ||
    ''
  ).trim();
  const normalized = {
    ...row,
    row_id: rowId,
    RowID: rowId,
    source_sheet: 'activities',
    source_table: ACTIVITIES_TABLE,
    authority: authorityName,
    school: schoolName,
    activity_season: activitySeason,
    activitySeason,
    activity_name: nonEmptyString(row?.activity_name) || nonEmptyString(row?.title) || nonEmptyString(row?.name) || nonEmptyString(row?.program_name) || 'ללא שם פעילות',
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
function isActivityCancelled(row) {
  return String(row?.status || '').trim() === 'בוטל';
}
function isActivityInactive(row) {
  return isActivityClosed(row) || isActivityDeleted(row) || isActivityCancelled(row);
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

/**
 * Dashboard-specific: returns true only if start_date, end_date, or any meeting date (date_1..date_35)
 * falls within the month. Does NOT use overlap fallback — matches the logic of activityOccursInSelectedMonth
 * in activities.js so dashboard counts agree with the activities screen.
 */
function activityHasDatePointInMonth(row, monthPrefix) {
  const range = monthDateRange(monthPrefix);
  if (!range) return false;
  const { startDate, endDate } = range;
  const meetingDates = getActivityDateColumns(row);
  const start = firstNormalizedDate(row?.start_date, row?.date_start);
  const end   = firstNormalizedDate(row?.end_date,   row?.date_end);
  const allDates = [...meetingDates];
  if (start) allDates.push(start);
  if (end)   allDates.push(end);
  return allDates.length > 0 && allDates.some((d) => d >= startDate && d <= endDate);
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
  select = '*',
  overlapByStartEnd = false,
  fallbackSelect = ''
} = {}) {
  if (!supabase) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) {
    throw new Error('invalid_activity_date_range');
  }
  let query = supabase
    .from('activities')
    .select(select);
  if (overlapByStartEnd) {
    query = query.lte('start_date', endDate).gte('end_date', startDate);
  } else {
    query = query.or(buildDateRangeOrFilter(startDate, endDate, { includeEndDate }));
  }
  const normalizedType = normalizeActivityTypeValue(activityType);
  if (normalizedType && normalizedType !== 'all') {
    query = normalizedType === 'course'
      ? query.in('activity_type', ['course', 'קורס', 'קורסים'])
      : query.eq('activity_type', normalizedType);
  }
  const result = await query;
  if (result.error && fallbackSelect && isMissingSupabaseColumnError(result.error)) {
    logDashboardSupabaseReadError('[supabase][dashboard] activities select failed; retrying minimal select', result.error, {
      table: 'public.activities',
      columns: select,
      operation: 'select.activities_by_date_range'
    });
    return selectActivitiesByDateRangeFromSupabase({
      startDate,
      endDate,
      activityType,
      includeEndDate,
      select: fallbackSelect,
      overlapByStartEnd
    });
  }
  if (result.error) {
    const diagnostic = logDashboardSupabaseReadError('[supabase][dashboard] activities read failed', result.error, {
      table: 'public.activities',
      columns: select,
      operation: 'select.activities_by_date_range'
    });
    throw new Error(`activities_date_range_read_failed: ${diagnostic.message}`);
  }
  return (Array.isArray(result.data) ? result.data : []).map(normalizeActivityRow);
}

const AUTHORITIES_CATALOG_COLUMNS = 'id,authority_name,authority_code,authority_type,hp_number,long_name,district,active';
const SCHOOLS_CATALOG_COLUMNS = 'id,semel_mosad,school_name,authority,authority_id,district,city,principal_name,school_phone,institution_address,active';
const CONTACTS_INSTRUCTORS_SCREEN_COLUMNS = 'emp_id,full_name,mobile,email,address,employment_type,direct_manager,active';
const CONTACTS_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
let authoritySchoolCatalogCache = null;
let authoritySchoolCatalogInflight = null;

const CONTACTS_UNIFIED_VIEW_COLUMNS = [
  'contact_domain', 'client_type', 'client_name', 'authority_id', 'school_id', 'semel_mosad',
  'authority_name', 'authority', 'school_name', 'school', 'contact_name', 'contact_role',
  'phone', 'mobile', 'email', 'address', 'notes', 'authority_code', 'district', 'city',
  'source_table', 'source_id'
].join(',');

function isCatalogActive(value) {
  if (value === false || value === 'no' || value === 0 || value === '0') return false;
  return true;
}

function normalizeCatalogText(value) {
  return String(value == null ? '' : value).trim();
}

const SUPABASE_CATALOG_PAGE_SIZE = 1000;

async function readSupabaseCatalogPages({ table, columns, applyFilter, applyOrder, pageSize = SUPABASE_CATALOG_PAGE_SIZE }) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = supabase
      .from(table)
      .select(columns);
    if (typeof applyFilter === 'function') query = applyFilter(query);
    if (typeof applyOrder === 'function') query = applyOrder(query);
    const { data, error } = await query.range(from, to);
    if (error) return { data: rows, error, pageIndex: Math.floor(from / pageSize) };
    const pageRows = Array.isArray(data) ? data : [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null, pageIndex: Math.floor(from / pageSize) };
  }
}

async function readAuthoritiesCatalogFromSupabase() {
  if (!supabase) return [];
  const columnSets = [
    AUTHORITIES_CATALOG_COLUMNS,
    'id,authority_name,authority_code,authority_type,hp_number,long_name,active',
    'id,authority_name,authority_code,authority_type,hp_number,district,active',
    'id,authority_name,authority_code'
  ];
  for (const columns of columnSets) {
    try {
      const { data, error, pageIndex } = await readSupabaseCatalogPages({
        table: 'authorities',
        columns,
        applyOrder: (query) => query.order('authority_name', { ascending: true })
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[supabase] Failed to load authorities with columns', columns, { pageIndex, error });
        continue;
      }
      // eslint-disable-next-line no-console
      console.info('[supabase][catalog]', { authorities_count_loaded: Array.isArray(data) ? data.length : 0 });
      return Array.isArray(data) ? data : [];
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[supabase] Unexpected authorities fetch error:', error);
    }
  }
  return [];
}

async function readSchoolsCatalogFromSupabase() {
  if (!supabase) return [];
  const columnSets = [
    SCHOOLS_CATALOG_COLUMNS,
    'id,semel_mosad,school_name,authority,authority_id,district,city,active',
    'id,semel_mosad,school_name,authority,authority_id,active'
  ];
  for (const columns of columnSets) {
    try {
      const { data, error, pageIndex } = await readSupabaseCatalogPages({
        table: 'schools',
        columns,
        applyOrder: (query) => query
          .order('authority', { ascending: true })
          .order('school_name', { ascending: true })
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn('[supabase] Failed to load schools with columns', columns, { pageIndex, error });
        continue;
      }
      // eslint-disable-next-line no-console
      console.info('[supabase][catalog]', { schools_count_loaded: Array.isArray(data) ? data.length : 0 });
      return Array.isArray(data) ? data : [];
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[supabase] Unexpected schools fetch error:', error);
    }
  }
  return [];
}

async function readAuthoritySchoolCatalog({ forceRefresh = false, perf = null } = {}) {
  const now = Date.now();
  if (!forceRefresh && authoritySchoolCatalogCache && now - authoritySchoolCatalogCache.t < CONTACTS_CATALOG_CACHE_TTL_MS) {
    if (perf) {
      perf.authorities_count = authoritySchoolCatalogCache.data.authorities.length;
      perf.schools_count = authoritySchoolCatalogCache.data.schools.length;
      perf.catalog_cache_hit = true;
      perf.authorities_ms = 0;
      perf.schools_ms = 0;
    }
    return authoritySchoolCatalogCache.data;
  }
  if (!forceRefresh && authoritySchoolCatalogInflight) return authoritySchoolCatalogInflight;
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  authoritySchoolCatalogInflight = (async () => {
    const authorityStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const authoritiesPromise = readAuthoritiesCatalogFromSupabase().then((rows) => {
      if (perf) perf.authorities_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - authorityStarted);
      return rows;
    });
    const schoolStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const schoolsPromise = readSchoolsCatalogFromSupabase().then((rows) => {
      if (perf) perf.schools_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - schoolStarted);
      return rows;
    });
    const [authorities, schools] = await Promise.all([authoritiesPromise, schoolsPromise]);
    const data = {
      authorities,
      schools,
      authorityLookup: buildAuthorityCatalogLookup(authorities),
      schoolLookup: buildSchoolCatalogLookup(schools)
    };
    authoritySchoolCatalogCache = { data, t: Date.now() };
    if (perf) {
      perf.authorities_count = authorities.length;
      perf.schools_count = schools.length;
      perf.catalog_cache_hit = false;
      perf.catalog_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    }
    return data;
  })().finally(() => { authoritySchoolCatalogInflight = null; });
  return authoritySchoolCatalogInflight;
}

function buildAuthorityCatalogLookup(authorities = []) {
  const byId = new Map();
  const byName = new Map();
  const list = [];
  for (const row of authorities) {
    const id = normalizeCatalogText(row.id);
    const authority_name = normalizeCatalogText(row.authority_name);
    const authority_code = normalizeCatalogText(row.authority_code);
    const authority_type = normalizeCatalogText(row.authority_type);
    const long_name = normalizeCatalogText(row.long_name);
    const entry = {
      id: id || null,
      authority_name,
      authority_code,
      authority_type,
      long_name,
      hp_number: normalizeCatalogText(row.hp_number),
      district: normalizeCatalogText(row.district),
      active: normalizeCatalogText(row.active) || 'yes'
    };
    if (!authority_name && !id) continue;
    list.push(entry);
    if (id) byId.set(id, entry);
    if (authority_name) byName.set(authority_name.toLowerCase(), entry);
  }
  return { byId, byName, list };
}

function buildSchoolCatalogLookup(schools = []) {
  const byId = new Map();
  const bySemel = new Map();
  const byAuthoritySchool = new Map();
  const list = [];
  for (const row of schools) {
    const id = normalizeCatalogText(row.id);
    const school_name = normalizeCatalogText(row.school_name);
    const authority = normalizeCatalogText(row.authority);
    const semel_mosad = normalizeCatalogText(row.semel_mosad);
    const authority_id = normalizeCatalogText(row.authority_id);
    const entry = {
      id: id || null,
      school_name,
      authority,
      semel_mosad,
      authority_id: authority_id || null,
      district: normalizeCatalogText(row.district),
      city: normalizeCatalogText(row.city),
      principal_name: normalizeCatalogText(row.principal_name),
      school_phone: normalizeCatalogText(row.school_phone),
      institution_address: normalizeCatalogText(row.institution_address),
      active: normalizeCatalogText(row.active) || 'yes'
    };
    if (!school_name && !id) continue;
    list.push(entry);
    if (id) byId.set(id, entry);
    if (semel_mosad) bySemel.set(semel_mosad, entry);
    if (school_name) {
      byAuthoritySchool.set(`${authority.toLowerCase()}|${school_name.toLowerCase()}`, entry);
      if (!authority) byAuthoritySchool.set(`|${school_name.toLowerCase()}`, entry);
    }
  }
  return { byId, bySemel, byAuthoritySchool, list };
}

function resolveAuthorityCatalogEntry(lookup, { authority_id, authority } = {}) {
  const id = normalizeCatalogText(authority_id);
  const name = normalizeCatalogText(authority);
  if (id && lookup.byId.has(id)) return lookup.byId.get(id);
  if (name && lookup.byName.has(name.toLowerCase())) return lookup.byName.get(name.toLowerCase());
  return null;
}

function resolveSchoolCatalogEntry(lookup, { school_id, semel_mosad, school, authority } = {}) {
  const id = normalizeCatalogText(school_id);
  const semel = normalizeCatalogText(semel_mosad);
  const schoolName = normalizeCatalogText(school);
  const authName = normalizeCatalogText(authority);
  if (id && lookup.byId.has(id)) return lookup.byId.get(id);
  if (semel && lookup.bySemel.has(semel)) return lookup.bySemel.get(semel);
  if (schoolName) {
    const key = `${authName.toLowerCase()}|${schoolName.toLowerCase()}`;
    if (lookup.byAuthoritySchool.has(key)) return lookup.byAuthoritySchool.get(key);
    if (lookup.byAuthoritySchool.has(`|${schoolName.toLowerCase()}`)) return lookup.byAuthoritySchool.get(`|${schoolName.toLowerCase()}`);
  }
  return null;
}

function enrichSchoolContactRow(row, authorityLookup, schoolLookup) {
  if (!row || typeof row !== 'object') return row;
  const authorityName = normalizeCatalogText(row.authority_name || row.authority || row.client_name);
  const schoolName = normalizeCatalogText(row.school_name || row.school);
  const schoolMeta = resolveSchoolCatalogEntry(schoolLookup, {
    school_id: row.school_id,
    semel_mosad: row.semel_mosad,
    school: schoolName,
    authority: authorityName
  });
  const authorityMeta = resolveAuthorityCatalogEntry(authorityLookup, {
    authority_id: row.authority_id || schoolMeta?.authority_id,
    authority: authorityName || schoolMeta?.authority
  }) || (schoolMeta?.authority_id
    ? authorityLookup.byId.get(normalizeCatalogText(schoolMeta.authority_id))
    : null);

  return {
    ...row,
    authority_id: row.authority_id ?? authorityMeta?.id ?? schoolMeta?.authority_id ?? null,
    school_id: row.school_id ?? schoolMeta?.id ?? null,
    semel_mosad: normalizeCatalogText(row.semel_mosad) || schoolMeta?.semel_mosad || null,
    authority_code: normalizeCatalogText(row.authority_code) || authorityMeta?.authority_code || null,
    authority_type: normalizeCatalogText(row.authority_type) || authorityMeta?.authority_type || null,
    district: normalizeCatalogText(row.district || row.authority_district || row.school_district) || authorityMeta?.district || schoolMeta?.district || null,
    city: normalizeCatalogText(row.city) || schoolMeta?.city || null,
    principal_name: normalizeCatalogText(row.principal_name) || schoolMeta?.principal_name || null,
    school_phone: normalizeCatalogText(row.school_phone || row.phone) || schoolMeta?.school_phone || null,
    school_address: normalizeCatalogText(row.school_address || row.address || row.institution_address) || schoolMeta?.institution_address || null,
    authority_name: authorityName || authorityMeta?.authority_name || schoolMeta?.authority || row.authority_name || null,
    school_name: schoolName || schoolMeta?.school_name || row.school_name || null,
    authority: authorityName || authorityMeta?.authority_name || schoolMeta?.authority || row.authority,
    school: schoolName || schoolMeta?.school_name || row.school
  };
}


function normalizeContactMergeKeyPart(value) {
  return normalizeCatalogText(value).toLowerCase().normalize('NFKC').replace(/[\u05F3\u05F4'"`´”“„״׳]/g, '').replace(/[\u2010-\u2015\u2212\-_/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function activitySchoolContactKey(row) {
  return [
    normalizeContactMergeKeyPart(row?.authority || row?.client_name),
    normalizeContactMergeKeyPart(row?.school)
  ].join('|');
}

function activityAuthorityContactKey(row) {
  return normalizeContactMergeKeyPart(row?.authority || row?.client_name);
}

function isContactRowUsable(row) {
  return Boolean(
    normalizeCatalogText(row?.contact_name)
    || normalizeCatalogText(row?.mobile || row?.phone)
    || normalizeCatalogText(row?.email)
  );
}

function makeActivityContactPlaceholder(activity, authorityLookup, schoolLookup) {
  const schoolName = normalizeCatalogText(activity?.school);
  const authorityName = normalizeCatalogText(activity?.authority);
  if (!schoolName && !authorityName) return null;
  const schoolMeta = resolveSchoolCatalogEntry(schoolLookup, {
    school_id: activity?.school_id,
    semel_mosad: activity?.semel_mosad,
    school: schoolName,
    authority: authorityName
  });
  const authorityMeta = resolveAuthorityCatalogEntry(authorityLookup, {
    authority_id: activity?.authority_id || schoolMeta?.authority_id,
    authority: authorityName || schoolMeta?.authority
  }) || (schoolMeta?.authority_id ? authorityLookup.byId.get(normalizeCatalogText(schoolMeta.authority_id)) : null);
  const resolvedAuthority = authorityName || schoolMeta?.authority || authorityMeta?.authority_name || '';
  const resolvedSchool = schoolName || schoolMeta?.school_name || '';
  return {
    client_type: resolvedSchool ? 'school' : 'authority',
    client_name: resolvedSchool || resolvedAuthority,
    authority_id: activity?.authority_id || authorityMeta?.id || schoolMeta?.authority_id || null,
    school_id: resolvedSchool ? (activity?.school_id || schoolMeta?.id || null) : null,
    semel_mosad: resolvedSchool ? (normalizeCatalogText(activity?.semel_mosad) || schoolMeta?.semel_mosad || null) : null,
    authority_code: authorityMeta?.authority_code || null,
    authority: resolvedAuthority,
    school: resolvedSchool || null,
    contact_name: '',
    contact_role: '',
    phone: '',
    mobile: '',
    email: '',
    _source: 'activity_without_contact',
    _activity_row_id: activity?.RowID || activity?.row_id || activity?.id || null
  };
}

function mergeActivityPlaceholdersIntoSchoolRows(contactRows, activityRows, authorityLookup, schoolLookup) {
  const rows = (Array.isArray(contactRows) ? contactRows : []).map((row) => enrichSchoolContactRow(row, authorityLookup, schoolLookup));
  const contactSchoolKeys = new Set();
  const contactAuthorityKeys = new Set();
  rows.forEach((row) => {
    if (!isContactRowUsable(row)) return;
    const schoolKey = activitySchoolContactKey(row);
    if (schoolKey !== '|') contactSchoolKeys.add(schoolKey);
    const authorityKey = activityAuthorityContactKey(row);
    if (authorityKey) contactAuthorityKeys.add(authorityKey);
  });
  const addedSchoolKeys = new Set();
  const addedAuthorityKeys = new Set();
  (Array.isArray(activityRows) ? activityRows : []).forEach((activity) => {
    const placeholder = makeActivityContactPlaceholder(activity, authorityLookup, schoolLookup);
    if (!placeholder) return;
    if (placeholder.school) {
      const key = activitySchoolContactKey(placeholder);
      if (!key || key === '|' || contactSchoolKeys.has(key) || addedSchoolKeys.has(key)) return;
      addedSchoolKeys.add(key);
      rows.push(placeholder);
      return;
    }
    const key = activityAuthorityContactKey(placeholder);
    if (!key || contactAuthorityKeys.has(key) || addedAuthorityKeys.has(key)) return;
    addedAuthorityKeys.add(key);
    rows.push(placeholder);
  });
  return rows;
}

function buildAuthoritySchoolCatalogClientSettings(authorityLookup, schoolLookup) {
  const activeSchools = schoolLookup.list.filter((school) => isCatalogActive(school.active));
  const activeAuthorities = authorityLookup.list.filter((authority) => isCatalogActive(authority.active));
  const authorities = activeAuthorities.map((authority) => authority.authority_name).filter(Boolean);
  const schools = activeSchools.map((school) => school.school_name).filter(Boolean);
  const school_records = activeSchools.map((school) => ({
    name: school.school_name,
    value: school.school_name,
    school_id: school.id,
    authority_id: school.authority_id,
    authority: school.authority,
    semel_mosad: school.semel_mosad
  })).filter((school) => school.name);
  const authority_records = activeAuthorities.map((authority) => ({
    id: authority.id,
    name: authority.authority_name,
    value: authority.authority_name,
    authority_code: authority.authority_code
  })).filter((authority) => authority.name);

  return {
    dropdown_options: {
      authority: authorities,
      authorities,
      school: schools,
      schools,
      school_records,
      authority_records
    }
  };
}

function mergeClientSettingsWithAuthoritySchoolCatalog(baseSettings, catalogOverlay) {
  if (!catalogOverlay?.dropdown_options) return baseSettings;
  const base = baseSettings && typeof baseSettings === 'object' ? baseSettings : {};
  const baseDropdown = base.dropdown_options && typeof base.dropdown_options === 'object' ? base.dropdown_options : {};
  const overlay = catalogOverlay.dropdown_options;
  const preferCatalog = (catalogValues, fallbackValues) => (
    Array.isArray(catalogValues) && catalogValues.length ? catalogValues : fallbackValues
  );
  return {
    ...base,
    dropdown_options: {
      ...baseDropdown,
      authority: preferCatalog(overlay.authority, baseDropdown.authority),
      authorities: preferCatalog(overlay.authorities, baseDropdown.authorities),
      school: preferCatalog(overlay.school, baseDropdown.school),
      schools: preferCatalog(overlay.schools, baseDropdown.schools),
      school_records: preferCatalog(overlay.school_records, baseDropdown.school_records),
      authority_records: preferCatalog(overlay.authority_records, baseDropdown.authority_records)
    }
  };
}

function buildProposalClientSearchOptions(contactRows, authorityLookup, schoolLookup) {
  const options = (Array.isArray(contactRows) ? contactRows : [])
    .map((row) => enrichSchoolContactRow(row, authorityLookup, schoolLookup));
  const seen = new Set();

  const addOption = (opt) => {
    const key = [
      normalizeCatalogText(opt.authority),
      normalizeCatalogText(opt.school),
      normalizeCatalogText(opt.contact_name),
      normalizeCatalogText(opt.phone || opt.mobile),
      normalizeCatalogText(opt.email),
      normalizeCatalogText(opt._catalog_source || 'contact')
    ].join('||');
    if (seen.has(key)) return;
    seen.add(key);
    options.push(opt);
  };

  for (const auth of authorityLookup.list) {
    if (!isCatalogActive(auth.active) || !auth.authority_name) continue;
    addOption({
      client_type: 'authority',
      client_name: auth.authority_name,
      authority_id: auth.id,
      school_id: null,
      semel_mosad: '',
      authority_name: auth.authority_name,
      authority: auth.authority_name,
      school_name: '',
      school: '',
      authority_code: auth.authority_code,
      authority_type: auth.authority_type,
      long_name: auth.long_name,
      district: auth.district,
      contact_name: '',
      contact_role: '',
      phone: '',
      email: '',
      mobile: '',
      _catalog_source: 'authorities'
    });
  }

  for (const school of schoolLookup.list) {
    if (!isCatalogActive(school.active) || !school.school_name) continue;
    const authorityMeta = resolveAuthorityCatalogEntry(authorityLookup, {
      authority_id: school.authority_id,
      authority: school.authority
    });
    const authorityName = school.authority || authorityMeta?.authority_name || '';
    addOption({
      client_type: 'school',
      client_name: school.school_name,
      authority_id: school.authority_id || authorityMeta?.id || null,
      school_id: school.id,
      semel_mosad: school.semel_mosad,
      authority_name: authorityName,
      authority: authorityName,
      school_name: school.school_name,
      school: school.school_name,
      authority_code: authorityMeta?.authority_code || '',
      district: school.district || authorityMeta?.district || '',
      city: school.city || '',
      principal_name: school.principal_name || '',
      school_phone: school.school_phone || '',
      school_address: school.institution_address || '',
      contact_name: school.principal_name || '',
      contact_role: school.principal_name ? 'מנהל/ת' : '',
      phone: school.school_phone || '',
      email: '',
      mobile: '',
      _catalog_source: 'schools'
    });
  }

  return options;
}

function normalizeUnifiedContactRow(row) {
  if (!row || typeof row !== 'object') return row;
  const authorityName = normalizeCatalogText(row.authority_name || row.authority || row.client_name);
  const schoolName = normalizeCatalogText(row.school_name || row.school);
  return {
    ...row,
    authority_name: authorityName || null,
    authority: authorityName || normalizeCatalogText(row.authority) || null,
    school_name: schoolName || null,
    school: schoolName || normalizeCatalogText(row.school) || null,
    source_table: normalizeCatalogText(row.source_table) || null,
    source_id: row.source_id != null ? String(row.source_id) : null,
    contact_domain: normalizeCatalogText(row.contact_domain || row.client_type) || null
  };
}

function compareUnifiedContactRows(a, b) {
  const authCmp = normalizeCatalogText(a?.authority_name || a?.authority).localeCompare(
    normalizeCatalogText(b?.authority_name || b?.authority),
    'he'
  );
  if (authCmp !== 0) return authCmp;
  const schoolCmp = normalizeCatalogText(a?.school_name || a?.school).localeCompare(
    normalizeCatalogText(b?.school_name || b?.school),
    'he'
  );
  if (schoolCmp !== 0) return schoolCmp;
  const domainOrder = { school: 0, authority: 1, other: 2 };
  const domainA = domainOrder[normalizeCatalogText(a?.contact_domain)] ?? 3;
  const domainB = domainOrder[normalizeCatalogText(b?.contact_domain)] ?? 3;
  if (domainA !== domainB) return domainA - domainB;
  const sourceOrder = { schools: 0, contacts_schools: 1 };
  const sourceA = sourceOrder[normalizeCatalogText(a?.source_table)] ?? 2;
  const sourceB = sourceOrder[normalizeCatalogText(b?.source_table)] ?? 2;
  if (sourceA !== sourceB) return sourceA - sourceB;
  return normalizeCatalogText(a?.contact_name).localeCompare(normalizeCatalogText(b?.contact_name), 'he');
}

/**
 * Reads general contacts from contacts_unified_view (contacts_schools + schools).
 * Instructors are loaded separately via contacts_instructors.
 *
 * ⚠️ permissions table is intentionally excluded — login credentials must never be read client-side.
 */
function isSupabasePermissionDeniedError(error) {
  const haystack = [
    error?.code,
    error?.message,
    error?.details,
    error?.hint,
    error?.name
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  return haystack.includes('42501')
    || haystack.includes('permission denied')
    || haystack.includes('insufficient_privilege');
}

async function readUnifiedContactsFromSupabase({ requireAuth = false, letter = '', search = '' } = {}) {
  if (!supabase) return [];
  if (requireAuth) {
    const session = await waitForSupabaseAuthSession({ timeoutMs: 6000 });
    if (!session?.user?.id) throw new Error('contacts_unified_view_requires_auth_session');
  }
  try {
    const safeLetter = String(letter || '').trim().replace(/[%,()]/g, '');
    const safeSearch = String(search || '').trim().replace(/[%,()]/g, '');
    const { data, error, pageIndex } = await readSupabaseCatalogPages({
      table: 'contacts_unified_view',
      columns: CONTACTS_UNIFIED_VIEW_COLUMNS,
      applyFilter: (baseQuery) => {
        let query = baseQuery;
        if (safeLetter) {
          query = query.or(`authority_name.ilike.${safeLetter}%,authority.ilike.${safeLetter}%,client_name.ilike.${safeLetter}%`);
        }
        if (safeSearch) {
          const term = `%${safeSearch}%`;
          query = query.or([
            `client_name.ilike.${term}`,
            `authority_name.ilike.${term}`,
            `authority.ilike.${term}`,
            `school_name.ilike.${term}`,
            `school.ilike.${term}`,
            `contact_name.ilike.${term}`,
            `contact_role.ilike.${term}`,
            `phone.ilike.${term}`,
            `mobile.ilike.${term}`,
            `email.ilike.${term}`,
            `authority_code.ilike.${term}`,
            `semel_mosad.ilike.${term}`
          ].join(','));
        }
        return query;
      },
      applyOrder: (query) => query
        .order('authority_name', { ascending: true })
        .order('school_name', { ascending: true })
        .order('contact_domain', { ascending: true })
        .order('contact_name', { ascending: true })
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.warn('[supabase] Failed to load contacts_unified_view:', { pageIndex, error });
      if (requireAuth && isSupabasePermissionDeniedError(error)) {
        throw new Error('contacts_unified_view_permission_denied');
      }
      if (requireAuth) throw new Error(error.message || 'contacts_unified_view_read_failed');
      return [];
    }
    return (Array.isArray(data) ? data : [])
      .map(normalizeUnifiedContactRow)
      .sort(compareUnifiedContactRows);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[supabase] Unexpected contacts_unified_view fetch error:', error);
    if (requireAuth) {
      if (error?.message === 'contacts_unified_view_permission_denied') throw error;
      if (isSupabasePermissionDeniedError(error)) throw new Error('contacts_unified_view_permission_denied');
      throw error;
    }
    return [];
  }
}

/**
 * Reads contacts_instructors + contacts_unified_view from Supabase.
 *
 * ⚠️ permissions table is intentionally excluded — login credentials must never be read client-side.
 */

// Single column list for every read of public.instructor_schedule_print_contacts -
// admin (operations-management) and instructor (my-data) must select the exact same
// columns so they can never resolve a different summer contact for the same row.
// contact_status/status are NOT real columns on this table; selecting them makes
// Supabase reject the whole query, which silently drops the dedicated summer
// contact and falls back to contacts_schools/schools catalog for everyone.
const INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT = 'id,season,external_key,authority,school,contact_name,contact_phone,school_address,city_or_authority,active,source_note,notes';

async function readMyDataSummerPrintContactRows() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('instructor_schedule_print_contacts')
      .select(INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT)
      .eq('season', 'summer_2026')
      .eq('active', true)
      .limit(10000);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[my-data] instructor_schedule_print_contacts read failed', err?.message || err);
    return [];
  }
}

async function readMyDataContactsSchoolsRows() {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('contacts_schools')
      .select('authority, school, school_id, contact_name, contact_role, phone')
      .limit(10000);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[my-data] contacts_schools read failed', err?.message || err);
    return [];
  }
}


// Index builders now live in screens/shared/contact-responsible.js (buildSummerContactIndex,
// buildContactsSchoolsIndex, buildSchoolsCatalogContactIndex) so the instructor data path and
// the operations-management admin path resolve school contacts from the exact same logic.

function firstMyDataContact(options = []) {
  const seen = new Set();
  for (const option of options) {
    const name = String(option?.name || '').trim();
    const phone = String(option?.phone || '').trim();
    if (!name && !phone) continue;
    const key = `${normalizeContactMatchText(name)}|${normalizeContactMatchText(phone)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    return { name, phone, role: String(option?.role || '').trim() };
  }
  return { name: '', phone: '', role: '' };
}

function enrichRowsWithSchoolContact(rows = [], contactsIndex = new Map(), schoolsIndex = new Map(), summerPrintContactsIndex = new Map()) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const isSummerRow = String(row?.activity_season ?? row?.activitySeason ?? '').trim() === 'summer_2026';
    const authority = getActivityAuthorityName(row);
    const schoolNames = getActivitySchoolNames(row);
    const schoolId = String(row?.school_id || row?.single_school_id || '').trim();

    if (isSummerRow) {
      // Single source of truth for summer contacts: dedicated summer contact first,
      // then contacts_schools, then the school catalog - only for fields the
      // higher-priority source left empty. Identical resolver used by the admin
      // operations-management screen and its printed schedule.
      const resolved = resolveSchoolContact(
        { authority, schoolNames, schoolCatalogId: schoolId },
        { summerIndex: summerPrintContactsIndex, contactsSchoolsIndex: contactsIndex, schoolsCatalogIndex: schoolsIndex }
      );
      return {
        ...row,
        contact_name: resolved.name,
        contact_phone: resolved.phone,
        school_contact_name: resolved.name,
        school_contact_phone: resolved.phone,
        school_contact_role: resolved.role,
        school_address: resolved.address,
        city_or_authority: resolved.cityOrAuthority,
        summer_contact_name: resolved.name,
        summer_contact_phone: resolved.phone,
        summer_school_address: resolved.address,
        summer_contact_city_or_authority: resolved.cityOrAuthority,
        summer_contact_status: resolved.status
      };
    }

    const options = [];
    const add = (name, phone = '', role = '') => {
      if (!String(name || '').trim() && !String(phone || '').trim()) return;
      options.push({ name: String(name || '').trim(), phone: String(phone || '').trim(), role: String(role || '').trim() });
    };
    const authorityKey = normalizeContactMatchText(authority);
    add(getActivityContactName(row), getActivityContactPhone(row));
    schoolNames.forEach((schoolName) => {
      const key = `${authorityKey}|${normalizeContactMatchText(schoolName)}`;
      (contactsIndex.get(key) || []).forEach((c) => add(c.name, c.phone, c.role));
    });
    if (schoolId) (schoolsIndex.get(`id:${schoolId}`) || []).forEach((c) => add(c.name, c.phone, c.role));
    schoolNames.forEach((schoolName) => {
      const key = `${authorityKey}|${normalizeContactMatchText(schoolName)}`;
      (schoolsIndex.get(key) || []).forEach((c) => add(c.name, c.phone, c.role));
    });
    if (authorityKey) (contactsIndex.get(`${authorityKey}|`) || []).forEach((c) => add(c.name, c.phone, c.role));

    const contact = firstMyDataContact(options);
    return {
      ...row,
      school_contact_name: contact.name,
      school_contact_phone: contact.phone,
      school_contact_role: contact.role
    };
  });
}

async function readContactsFromSupabase({ includeUnified = false, letter = '', search = '' } = {}) {
  if (!supabase) return null;

  const perfStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const perf = {
    instructors_count: 0,
    unified_count: 0,
    authorities_count: 0,
    schools_count: 0,
    instructors_ms: 0,
    unified_ms: 0,
    authorities_ms: 0,
    schools_ms: 0,
    catalog_ms: 0,
    catalog_cache_hit: false,
    read_ms: 0
  };

  const readInstructors = async () => {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = await supabase.from('contacts_instructors').select(CONTACTS_INSTRUCTORS_SCREEN_COLUMNS);
    perf.instructors_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    if (result.error) {
      // eslint-disable-next-line no-console
      console.error('[contacts][contacts_instructors] read failed', {
        columns: CONTACTS_INSTRUCTORS_SCREEN_COLUMNS,
        code: result.error?.code,
        message: result.error?.message,
        error: result.error
      });
      throw new Error(result.error.message || 'contacts_instructors_read_failed');
    }
    const rows = Array.isArray(result.data) ? result.data : [];
    perf.instructors_count = rows.length;
    return rows;
  };

  const readUnified = async () => {
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rows = await readUnifiedContactsFromSupabase({ letter, search });
    perf.unified_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - started);
    perf.unified_count = Array.isArray(rows) ? rows.length : 0;
    return rows;
  };

  try {
    const [instructor_rows, schoolRowsRaw, catalog] = await Promise.all([
      readInstructors(),
      includeUnified ? readUnified() : Promise.resolve([]),
      includeUnified ? readAuthoritySchoolCatalog({ perf }) : Promise.resolve({ authorities: [], schools: [], authorityLookup: new Map(), schoolLookup: new Map() })
    ]);
    const school_rows = (Array.isArray(schoolRowsRaw) ? schoolRowsRaw : [])
      .map((row) => enrichSchoolContactRow(row, catalog.authorityLookup, catalog.schoolLookup));
    perf.read_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - perfStarted);
    // eslint-disable-next-line no-console
    console.info('[contacts-perf]', perf);
    return {
      instructor_rows,
      school_rows,
      authority_catalog: catalog.authorities,
      school_catalog: catalog.schools,
      can_view_instructors: true,
      can_view_schools: true,
      _source: 'supabase',
      _contacts_perf: perf
    };
  } catch (error) {
    perf.read_ms = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - perfStarted);
    // eslint-disable-next-line no-console
    console.info('[contacts-perf]', perf);
    // eslint-disable-next-line no-console
    console.warn('[supabase] Unexpected contacts fetch error:', error);
    return {
      instructor_rows: [],
      school_rows: [],
      can_view_instructors: true,
      can_view_schools: true,
      instructors_load_error: true,
      _source: 'supabase',
      _contacts_perf: perf
    };
  }
}

/**
 * Reads contacts_instructors from Supabase for the instructor-contacts screen.
 * Returns { rows, _source } or null on failure.
 */
async function readInstructorContactsFromSupabase() {
  if (!supabase) return null;
  try {
    const result = await supabase.from('contacts_instructors').select(CONTACTS_INSTRUCTORS_SCREEN_COLUMNS);
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
  if (listsRowsCache) return listsRowsCache;
  if (listsRowsPromise) return listsRowsPromise;
  listsRowsPromise = (async () => {
  try {
    const result = await supabase
      .from('lists')
      .select(LISTS_BOOTSTRAP_COLUMNS)
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
      const cat = String(row.category || '').trim();
      if (!cat) continue;
      const value = String(row.value ?? '').trim();
      const label = String(row.label ?? value).trim() || value;
      if (!value) continue;
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push({ label, value, _row: row, active: row.active });
    }
    const categories = [...catMap.entries()].map(([category, items]) => ({ category, items }));
    listsRowsCache = { categories, _source: 'supabase' };
    return listsRowsCache;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected lists fetch error:', error);
    return null;
  } finally {
    listsRowsPromise = null;
  }
  })();
  return listsRowsPromise;
}

/**
 * Converts the lists table data into the clientSettings shape expected by
 * activity-options.js and the add-activity form.
 * Handles many category name variants so the lists table can use any naming.
 */
function buildClientSettingsFromLists(listsData, settingsRows = [], instructorContactsRows = []) {
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
  const schoolItems     = getItems('school', 'schools');
  const schoolValues    = schoolItems.map((i) => i.value).filter(Boolean);
  const authorityValues = getValues('authority', 'authorities');
  const activitySeasonItems = getItems('activity_season');

  const shortTypes = getValues('one_day_activity_type', 'one_day_types', 'short_activity_type', 'short_activity_types');
  let   longTypes  = getValues('program_activity_type', 'program_types', 'long_activity_type', 'long_activity_types', 'program_activity_types');
  if (!shortTypes.length && !longTypes.length) {
    longTypes = getValues('activity_type', 'activity_types');
  }

  const instructorUsers = instructorItems.map((i) => ({
    name:   normalizeHumanName(i.label || i.value),
    emp_id: String(i._row?.emp_id || i._row?.employee_id || '').trim()
  }));
  const contactsInstructorUsers = (Array.isArray(instructorContactsRows) ? instructorContactsRows : [])
    .filter((row) => isCatalogActive(row?.active))
    .map((row) => {
      const fullName = normalizeHumanName(row?.full_name);
      return {
        full_name: fullName,
        name: fullName,
        emp_id: String(row?.emp_id || '').trim(),
        active: isCatalogActive(row?.active)
      };
    })
    .filter((user) => user.full_name && user.emp_id);

  const activityNames = activityNameItems.map((i) => ({
    label:         i.label || i.value,
    label_he:      String(i._row?.label_he || i.label || i.value || '').trim(),
    value:         i.value || String(i._row?.activity_name || i.label || '').trim(),
    activity_name: String(i._row?.activity_name || i.value || i.label || '').trim(),
    activity_no:   String(i._row?.activity_no  || i._row?.number      || '').trim(),
    activity_type: String(i._row?.activity_type || i._row?.parent_value || i._row?.type || '').trim(),
    parent_value:  String(i._row?.parent_value  || i._row?.activity_type || i._row?.type || '').trim(),
    type:          String(i._row?.type || i._row?.activity_type || i._row?.parent_value || '').trim(),
    active:        (typeof i._row?.is_active === 'boolean') ? i._row?.is_active : (i._row?.active ?? i.active),
    sort_order:    Number.isFinite(Number(i._row?.sort_order)) ? Number(i._row?.sort_order) : null
  }));
  const activityTypes = [...new Set(activityNames.map((row) => String(row.activity_type || row.parent_value || row.type || '').trim()).filter(Boolean))];
  const schoolRecords = schoolItems.map((i) => ({
    name:        String(i._row?.school || i._row?.school_name || i.label || i.value || '').trim(),
    value:       String(i.value || i._row?.school || i._row?.school_name || '').trim(),
    school_id:   String(i._row?.school_id || i._row?.id || '').trim(),
    authority_id:String(i._row?.authority_id || '').trim(),
    authority:   String(i._row?.authority || '').trim()
  })).filter((school) => school.name || school.value);

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
      school_records:           schoolRecords,
      authority:                authorityValues,
      authorities:              authorityValues,
      activity_manager:         managerNames,
      activity_managers:        managerNames,
      activities_manager_users: managerUsers,
      instructor_name:          instructorUsers.map((u) => u.name),
      instructor_names:         instructorUsers.map((u) => u.name),
      instructor_users:         instructorUsers,
      contacts_instructor_users: contactsInstructorUsers,
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
      supabase.from('contacts_instructors').select(CONTACTS_INSTRUCTORS_SCREEN_COLUMNS)
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
    const contactsLookup = buildContactsInstructorLookup(contacts);
    contacts.forEach((contact) => {
      const empId = String(contact?.emp_id || contact?.employee_id || '').trim();
      const name = normalizeName(contact?.full_name || contact?.instructor_name || contact?.guide);
      const stats = ensureStats(empId || name, name || empId);
      if (stats) {
        if (empId) addAlias(empId, stats.emp_id);
        if (name) addAlias(name, stats.emp_id);
      }
    });

    for (const row of activeRows) {
      const pairs = [
        resolveCanonicalInstructorPair(row.instructor_name || row.instructor || row.guide, row.emp_id, contactsLookup),
        resolveCanonicalInstructorPair(row.instructor_name_2, row.emp_id_2, contactsLookup)
      ];
      const startDate = normalizeSupabaseDate(row.start_date);
      const endDate = normalizeSupabaseDate(row.end_date);
      const manager = String(row.activity_manager || '').trim();
      const authority = String(row.authority || '').trim();
      const school = String(row.school || '').trim();
      const activityName = String(row.activity_name || '').trim();
      const actType = rowActivityType(row);
      for (const pair of pairs) {
        if (!pair) continue;
        const stats = ensureStats(pair.emp_id || pair.name, pair.name || pair.emp_id);
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
    { id: 'active_escape_room',  action: 'kpi|active_escape_room',  subtitle: 'חדר בריחה', key: 'escape_room' },
    { id: 'active_tours',        action: 'kpi|active_tours',        subtitle: 'סיורים',    key: 'tour' },
    { id: 'active_after_school', action: 'kpi|active_after_school', subtitle: 'אפטרסקול', key: 'after_school' },
  ].map(({ id, action, subtitle, key }) => ({
    id, action, subtitle,
    title: String(activeTypeCounts[key] || 0),
    value: activeTypeCounts[key] || 0
  }));
  return [
    ...typeCards,
    { id: 'endings',     action: 'kpi|endings',     title: String(courseEndings),         subtitle: 'סיומי קורסים',   value: courseEndings },
    { id: 'instructors', action: 'kpi|instructors', title: String(uniqueInstructorCount), subtitle: 'מדריכים משובצים', value: uniqueInstructorCount },
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
    const rows = filterRowsByGlobalActivityPeriod(await selectActivitiesByDateRangeFromSupabase({ startDate, endDate }))
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
    const rows = filterRowsByGlobalActivityPeriod(await selectActivitiesByDateRangeFromSupabase({
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
function isMissingSupabaseColumnError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
}


function describeSupabaseReadError(error, context = {}) {
  const table = context.table || 'unknown_table';
  const columns = context.columns || context.select || '*';
  const operation = context.operation || 'select';
  const message = String(error?.message || error || 'supabase_read_failed');
  const details = String(error?.details || '').trim();
  const hint = String(error?.hint || '').trim();
  const code = String(error?.code || '').trim();
  return {
    table,
    columns,
    operation,
    code: code || null,
    message,
    details: details || null,
    hint: hint || null,
    permission_hint: /permission|policy|rls|not authorized|denied/i.test(`${message} ${details} ${hint}`),
    missing_column_hint: isMissingSupabaseColumnError(error)
  };
}

function logDashboardSupabaseReadError(label, error, context = {}) {
  const diagnostic = describeSupabaseReadError(error, context);
  try {
    console.error(label || '[supabase][dashboard] read failed', diagnostic);
  } catch { /* ignore */ }
  return diagnostic;
}

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
      includeEndDate: true,
      select: DASHBOARD_ACTIVITY_COLUMNS,
      overlapByStartEnd: true,
      fallbackSelect: DASHBOARD_ACTIVITY_MIN_COLUMNS
    });
    // Open-only rows (not closed) — used for summary, instructor/manager stats, exceptions
    const scopedRangeRows = filterRowsByGlobalActivityPeriod(allRangeRows);
    const openRows = scopedRangeRows.filter((row) => !isActivityInactive(row));
    // Open-only rows that have a specific date (start/end/meeting) in this month — matches activities screen
    const monthRows = openRows.filter((row) => activityHasDatePointInMonth(row, monthPrefix));
    // All rows (open + closed) with a specific date in this month — for KPI base counts
    const allMonthRows = scopedRangeRows.filter((row) => activityHasDatePointInMonth(row, monthPrefix));
    // Course/afterschool endings: open activities of that type whose end_date falls in this month
    const endingRows = openRows.filter((row) => (rowActivityType(row) === 'course' || rowActivityType(row) === 'after_school') && String(row?.end_date || '').slice(0, 7) === monthPrefix);

    // KPI type counts — includes all activities (open + closed) for the full monthly picture
    const totalTypeCounts = {};
    for (const row of allMonthRows) {
      const activityType = rowActivityType(row);
      if (activityType) totalTypeCounts[activityType] = (totalTypeCounts[activityType] || 0) + 1;
    }
    totalTypeCounts.summer = new Set(allMonthRows
      .filter((row) => !isActivityInactive(row))
      .filter(isSummerActivity)
      .map((row, index) => String(row?.RowID || row?.row_id || '').trim() || `summer:${index}`)).size;

    const exceptionSummary = await readExceptionsFromSupabase({ month: monthPrefix, activityRows: scopedRangeRows });
    const exceptionError = exceptionSummary?.error || exceptionSummary?._debug?.error;
    const exceptionsUnavailable = !exceptionSummary || !!exceptionError;
    if (exceptionsUnavailable) {
      warnDashboardSupabasePathFailed(exceptionError || 'exceptions_model_failed', {
        month: monthPrefix,
        path: 'readExceptionsFromSupabase',
        impact: 'dashboard_continues_without_exceptions'
      });
    }
    const exceptionCounts = exceptionsUnavailable ? {} : (exceptionSummary.counts || {});
    const exceptionsByDistrict = exceptionsUnavailable ? {} : (exceptionSummary.byDistrict || exceptionSummary.byManager || {});

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
    const exceptionsCount = exceptionsUnavailable ? null : Number(exceptionSummary.uniqueExceptionActivities || exceptionSummary.totalExceptionRows || 0);
    const totals = {
      total_short_activities: allMonthRows.filter(isOneDayActivity).length,
      total_long_activities: allMonthRows.filter(isProgramActivity).length,
      total_activities: allMonthRows.length,
      total_instructors: instructorIds.size,
      total_course_endings_current_month: endingRows.length,
      exceptions_count: exceptionsUnavailable ? null : exceptionsCount
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
      operational_gaps_count: exceptionsUnavailable ? null : exceptionsCount,
      operational_gaps_unique_count: exceptionsUnavailable ? null : Number(exceptionSummary.uniqueExceptionActivities || exceptionSummary.totalExceptionRows || 0),
      operationalTotal: exceptionsUnavailable ? null : exceptionsCount,
      exceptions_count: exceptionsUnavailable ? null : exceptionsCount,
      totalExceptionRows: exceptionsUnavailable ? null : Number(exceptionSummary.totalExceptionRows || 0),
      total_exception_rows: exceptionsUnavailable ? null : Number(exceptionSummary.totalExceptionRows || 0),
      totalExceptionInstances: exceptionsUnavailable ? null : exceptionsCount,
      counts: exceptionCounts,
      exceptions_unavailable: exceptionsUnavailable
    };
    // KPI cards use activeTypeCounts (open-only rows with a specific date in this month)
    const kpi_cards = buildDashboardKpiCardsFromSupabase(totals, activeTypeCounts, exceptionsUnavailable ? 'לא זמין' : exceptionsCount, instructorIds.size, endingRows.length);
    const noData = allMonthRows.length === 0;
    return {
      month: monthPrefix,
      requested_month: month,
      totals,
      summary,
      by_activity_manager,
      activeTypeCounts,
      totalTypeCounts,
      exceptionCount: exceptionsUnavailable ? null : exceptionsCount,
      exceptionsUnavailable,
      uniqueInstructorCount: instructorIds.size,
      courseEndings: endingRows.length,
      kpi_cards,
      cards: kpi_cards,
      rows: monthRows,
      no_data_message: noData ? 'אין נתונים לחודש זה' : '',
      _source: 'supabase'
    };
  } catch (err) {
    console.error('[supabase][dashboard] unexpected error:', {
      message: String(err?.message || err),
      month,
      required_activity_columns: DASHBOARD_ACTIVITY_COLUMNS,
      source_tables: ['public.activities', 'public.contacts_instructors', 'public.settings']
    });
    return emptyDashboardPayload(month, { error: String(err?.message || err) });
  }
}

function emptyDashboardPayload(month, debug = {}) {
  const monthPrefix = String(month || '').slice(0, 7);
  const totals = {
    total_short_activities: 0,
    total_long_activities: 0,
    total_activities: 0,
    total_instructors: 0,
    total_course_endings_current_month: 0,
    exceptions_count: 0
  };
  const summary = {
    active_type_counts: {},
    active_instructors: [],
    active_instructors_count: 0,
    ending_courses_current_month: 0,
    missing_instructor_count: 0,
    missing_district_count: 0,
    missing_start_date_count: 0,
    missing_end_date_count: 0,
    missing_date_count: 0,
    end_date_after_cutoff_count: 0,
    end_date_passed_count: 0,
    operational_gaps_count: 0,
    operational_gaps_unique_count: 0,
    operationalTotal: 0,
    exceptions_count: 0,
    totalExceptionRows: 0,
    total_exception_rows: 0,
    totalExceptionInstances: 0,
    counts: {}
  };
  return {
    month: /^\d{4}-\d{2}$/.test(monthPrefix) ? monthPrefix : '',
    requested_month: month,
    totals,
    summary,
    by_activity_manager: [],
    activeTypeCounts: {},
    totalTypeCounts: {},
    exceptionCount: 0,
    uniqueInstructorCount: 0,
    courseEndings: 0,
    kpi_cards: buildDashboardKpiCardsFromSupabase(totals, {}, 0, 0, 0),
    cards: buildDashboardKpiCardsFromSupabase(totals, {}, 0, 0, 0),
    rows: [],
    no_data_message: 'אין נתונים לחודש זה',
    _source: 'supabase',
    _debug: { dashboard_partial_fallback: true, ...debug }
  };
}

async function readEndDatesFromSupabase() {
  if (!supabase) throw new Error('no_supabase_client');
  try {
    const rows = (await selectActivitiesFromSupabase('*'))
      .filter((row) => !isActivityInactive(row))
      .map((row) => ({ ...row, meeting_dates: getActivityDateColumns(row), date_cols: getActivityDateColumns(row) }));
    return { rows, _source: 'supabase' };
  } catch (error) {
    throw new Error(error?.message || 'end_dates_supabase_failed');
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


function isSummerCompletionTrackedActivity(row = {}) {
  const season = String(row?.activity_season || row?.activitySeason || '').trim();
  if (season !== 'summer_2026') return false;
  const type = normalizeActivityTypeValue(row?.activity_type || row?.item_type || '');
  return type === 'workshop' || type === 'escape_room';
}

function latestActivityDateForSummer(row = {}) {
  const dates = [
    firstNormalizedDate(row?.end_date, row?.date_end),
    firstNormalizedDate(row?.start_date, row?.date_start),
    firstNormalizedDate(row?.date_1, row?.Date1),
    latestMeetingDateFromActivity(row)
  ].filter(Boolean);
  return dates.length ? dates.reduce((max, value) => (value > max ? value : max), '') : '';
}

function isSummerActivityEnded(row = {}, today = todayLocalIsoDate()) {
  const latest = latestActivityDateForSummer(row);
  return !!latest && latest < today;
}

function isSummerActivityClosedStatus(row = {}) {
  const status = String(row?.status || '').trim().toLowerCase();
  return ['בוצע', 'הושלם', 'סגור', 'נסגר', 'done', 'completed', 'closed'].includes(status);
}

function normalizeApprovalText(value) {
  return String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function approvalUploadMatchesActivity(upload = {}, row = {}) {
  const rowId = String(row?.RowID || row?.row_id || row?.id || '').trim();
  const uploadRowIds = String(upload?.activity_row_id || upload?.activity_id || '').split(',').map((value) => value.trim()).filter(Boolean);
  // An upload that carries row ids is scoped to those specific activities: never fall
  // through to the looser date+school match below, or two activities on the same
  // day/school (with different row ids) could get mixed up.
  if (uploadRowIds.length) return !!rowId && uploadRowIds.includes(rowId);

  const rowDate = firstNormalizedDate(row?.start_date, row?.activity_date, row?.date, row?.date_1, row?.Date1);
  const uploadDate = firstNormalizedDate(upload?.activity_date, upload?.date);
  if (rowDate && uploadDate && rowDate !== uploadDate) return false;

  const rowSchool = normalizeApprovalText(row?.school || row?.single_school_name || row?.legacy_school);
  const uploadSchool = normalizeApprovalText(upload?.school);
  if (rowSchool && uploadSchool && rowSchool !== uploadSchool && !rowSchool.endsWith(uploadSchool) && !uploadSchool.endsWith(rowSchool)) return false;

  const uploadInstructor = normalizeApprovalText(upload?.instructor_name);
  if (uploadInstructor) {
    const rowInstructors = [
      resolveActivityInstructorName(row),
      resolveActivityInstructorName(row, { secondary: true }),
      row?.instructor_name,
      row?.instructor_name_2,
      row?.instructor,
      row?.instructor_2,
      row?.guide_name,
      row?.guide_name_2
    ].map(normalizeApprovalText).filter(Boolean);
    if (rowInstructors.length && !rowInstructors.includes(uploadInstructor)) return false;
  }

  return !!(rowDate && uploadDate && rowSchool && uploadSchool);
}

function completionApprovalStorageExists(upload = {}) {
  return !!(upload?.file_path || upload?.file_name || upload?.file_ref_exists);
}

function hasCompletionApprovalForActivity(row = {}, approvalUploads = []) {
  if ((row?.has_completion_approval === true || row?.has_completion_approval === 'true' || row?.has_completion_approval === 'yes') && row?.completion_approval_storage_exists !== false) return true;
  const uploads = Array.isArray(approvalUploads) ? approvalUploads : [];
  const status = String(row?.completion_approval_status || '').trim().toLowerCase();
  if (!uploads.length && ['approved', 'uploaded', 'אושר', 'הועלה'].includes(status) && row?.completion_approval_storage_exists !== false) return true;
  return uploads.some((upload) => {
    const uploadStatus = String(upload?.status || '').trim().toLowerCase();
    if (uploadStatus === 'rejected' || uploadStatus === 'נדחה') return false;
    return completionApprovalStorageExists(upload) && approvalUploadMatchesActivity(upload, row);
  });
}

function summerCompletionExceptionTypes(row = {}, opts = {}) {
  if (!isSummerCompletionTrackedActivity(row)) return [];
  if (isActivityDeleted(row) || isActivityCancelled(row)) return [];
  if (!isSummerActivityEnded(row)) return [];
  const types = [];
  if (!isSummerActivityClosedStatus(row)) types.push('summer_ended_open');
  if (!hasCompletionApprovalForActivity(row, opts.completionApprovalUploads)) types.push('missing_completion_approval');
  return types;
}

function isActivityInPreparation(row = {}) {
  return String(row?.status || '').trim() === 'היערכות';
}

function getActivityExceptions(activityRows = [], month = '', opts = {}) {
  const knownInstructorIds = opts.knownInstructorIds; // Set<string> | undefined
  const rows = [];
  const instances = [];
  for (const row of activityRows) {
    if (isActivityInPreparation(row)) continue;
    if (isActivityDeleted(row) || isActivityCancelled(row)) continue;
    if (isActivityInactive(row) && !isSummerCompletionTrackedActivity(row)) continue;
    if (!activityOverlapsMonthForExceptions(row, month)) continue;
    const rawTypes = [
      ...(isActivityClosed(row) ? [] : rowExceptionTypesFromActivity(row, {
        knownInstructorIds,
        lateEndDateThreshold: opts.lateEndDateThreshold
      })),
      ...summerCompletionExceptionTypes(row, opts)
    ];
    const types = normalizedExceptionTypes({
      ...row,
      exception_types: rawTypes
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


async function readInstructorEmpIdsFromSupabase() {
  if (!supabase) return [];
  const columns = 'emp_id,active';
  const { data, error } = await supabase
    .from('contacts_instructors')
    .select(columns);
  if (error) {
    const diagnostic = logDashboardSupabaseReadError('[supabase][dashboard] contacts_instructors read failed', error, {
      table: 'public.contacts_instructors',
      columns,
      operation: 'select.instructor_emp_ids_for_exceptions'
    });
    throw new Error(`contacts_instructors_read_failed: ${diagnostic.message}`);
  }
  return (Array.isArray(data) ? data : [])
    .filter((row) => row?.active !== false && row?.active !== 'false' && row?.active !== 0 && row?.active !== '0')
    .map((row) => ({ emp_id: nullStr(row?.emp_id) }))
    .filter((row) => row.emp_id);
}

async function readExceptionsFromSupabase(params = {}) {
  if (!supabase) return buildSupabaseErrorPayload({ rows: [], totalExceptionRows: 0, totalExceptionInstances: 0 }, 'no_supabase_client');
  const candidate = String(params?.month || params?.ym || '').trim();
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const month = /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm;
  const activityPeriod = normalizeGlobalActivityPeriod(params?.activity_period || currentGlobalActivityPeriod());
  try {
    const suppliedActivityRows = Array.isArray(params?.activityRows) ? params.activityRows : null;
    const [activitiesResult, instrListResult, approvalsResult, settingsRows] = await Promise.all([
      suppliedActivityRows ? Promise.resolve({ data: suppliedActivityRows, error: null }) : supabase.from('activities').select('*'),
      readInstructorEmpIdsFromSupabase().then((data) => ({ data, error: null })),
      supabase.from('activity_completion_approval_uploads').select('*').then(({ data, error }) => ({ data: error ? [] : data, error })),
      readSettingsRowsFromSupabase().catch((error) => {
        logDashboardSupabaseReadError('[supabase][dashboard] settings read failed', error, {
          table: 'public.settings',
          columns: SETTINGS_BOOTSTRAP_COLUMNS,
          operation: 'select.settings_for_exceptions'
        });
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
    const periodRows = filterRowsByGlobalActivityPeriod(allRows, activityPeriod);
    const exceptionSummary = buildExceptionsModelFromRows(periodRows, month, {
      include_rows: true,
      knownInstructorIds: knownInstructorIds.size > 0 ? knownInstructorIds : undefined,
      lateEndDateThreshold,
      completionApprovalUploads: Array.isArray(approvalsResult.data) ? approvalsResult.data : []
    });
    const undatedRows = periodRows
      .filter((row) => !isActivityInPreparation(row))
      .filter((row) => !isActivityInactive(row))
      .filter((row) => !hasAnyActivityDate(row));
    return {
      month,
      activity_period: activityPeriod,
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
    saveActivity: ['activities:', 'activityDetail:', 'activityDates:', 'archive', 'archiveDetail:', 'archiveDates:', 'week:', 'month:', 'dashboard:', 'exceptions:', 'end-dates', 'operations-management'],
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
    deleteSchoolContact: ['contacts', 'instructor-contacts', 'proposals-agreements'],
    updateUnifiedContactRecord: ['contacts', 'instructor-contacts'],
    saveSheetMapping: ['adminSettings', 'listSheets', 'dashboard:', 'activities:', 'week:', 'month:'],
    saveClientSetting: ['adminSettings', 'dashboard:', 'activities:', 'week:', 'month:'],
    addProposalAgreement: ['proposals-agreements'],
    updateProposalAgreement: ['proposals-agreements'],
    updateProposalAgreementStatus: ['proposals-agreements'],
    lockAndSendProposalAgreement: ['proposals-agreements'],
    uploadProposalFinalPdf: ['proposals-agreements'],
    getProposalFinalPdfSignedUrl: ['proposals-agreements'],
    deleteProposalAgreement: ['proposals-agreements'],
    saveProposalAgreementItems: ['proposals-agreements'],
    uploadCompletionApproval: ['instructor-completion-approvals', 'my-data', 'instructor-calendar'],
    replaceCompletionApprovalUpload: ['instructor-completion-approvals', 'my-data', 'instructor-calendar'],
    deleteCompletionApprovalUpload: ['instructor-completion-approvals', 'my-data', 'instructor-calendar'],
    reviewCompletionApprovalUpload: ['instructor-completion-approvals', 'my-data', 'instructor-calendar'],
    uploadPhotoApproval: ['my-data', 'instructor-calendar', 'operations-management'],
    replacePhotoApproval: ['my-data', 'instructor-calendar', 'operations-management'],
    // Contact responsible overrides affect every screen that shows the resolved
    // responsible/school contact for a date+school - not just operations-management,
    // which was the only one cleared before (see saveSchoolContactResponsible below).
    saveSchoolContactResponsible: ['my-data', 'instructor-calendar', 'instructor-completion-approvals', 'operations-management']
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
const PROPOSALS_AGREEMENTS_COLUMNS = 'id,authority_id,school_id,contact_school_id,client_authority,school_framework,document_type,activity_type_group,proposal_domain,proposal_date,activity_names,contact_name,contact_role,phone,email,contact_phone,contact_email,notes,status,approval_note,total_amount,custom_document_sections,include_catalog,signature_meta,approved_by,approved_at,sent_by,sent_at,locked_at,locked_by,locked_reason,final_pdf_path,final_pdf_file_name,final_pdf_created_at,final_pdf_created_by,document_snapshot,document_html_snapshot,proposal_series_id,version_number,supersedes_proposal_id,archived_at,created_at,updated_at';
const PROPOSALS_AGREEMENTS_DIRECTORY_COLUMNS = 'id,authority_id,authority_code,school_id,contact_school_id,semel_mosad,authority_name,legacy_client_authority,contact_client_type,contact_client_name,school_name,legacy_school_framework,document_type,activity_type_group,proposal_domain,proposal_date,activity_names,contact_name,contact_role,phone,email,notes,status,approval_note,total_amount,custom_document_sections,include_catalog,signature_meta,approved_by,approved_at,sent_by,sent_at,locked_at,locked_by,locked_reason,final_pdf_path,final_pdf_file_name,final_pdf_created_at,final_pdf_created_by,document_snapshot,document_html_snapshot,proposal_series_id,version_number,supersedes_proposal_id,archived_at,created_at,updated_at';
const PROPOSAL_FINAL_PDF_BUCKET = 'proposal-final-pdfs';
const PROPOSALS_AGREEMENTS_WRITABLE_COLUMNS = new Set([
  'authority_id', 'school_id', 'contact_school_id', 'client_authority', 'school_framework',
  'document_type', 'activity_type_group', 'proposal_date', 'activity_names', 'contact_name',
  'contact_role', 'phone', 'email', 'contact_phone', 'contact_email', 'notes', 'status', 'approval_note', 'total_amount',
  'custom_document_sections', 'include_catalog', 'proposal_domain', 'supersedes_proposal_id'
]);
const PROPOSALS_AGREEMENTS_APPROVAL_COLUMNS = new Set(['approved_by', 'approved_at', 'signature_position', 'signature_meta']);
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

function canApproveProposalsAgreementsApi() {
  const role = String(state?.user?.display_role || state?.user?.role || '').trim();
  return role === 'admin' || permissionFlagYes(state?.user?.approve_proposals_agreements);
}

function assertCanManageProposalsAgreementsApi() {
  if (!canManageProposalsAgreementsApi()) throw new Error('proposals_agreements_forbidden');
}

function cleanProposalAgreementText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function firstNameOnly(value) {
  const clean = cleanProposalAgreementText(value);
  return clean.split(/\s+/).filter(Boolean)[0] || clean;
}

function normalizeProposalAgreementStatusForDb(status) {
  const raw = cleanProposalAgreementText(status);
  const aliases = {
    draft: 'draft', 'טיוטה': 'draft',
    cancelled: 'cancelled', canceled: 'cancelled', 'בוטל': 'cancelled', 'מבוטל': 'cancelled',
    sent: 'sent', 'נשלח': 'sent',
    pending_approval: 'pending_approval', 'ממתין לאישור': 'pending_approval',
    returned_for_changes: 'returned_for_changes', 'הוחזר לתיקון': 'returned_for_changes',
    approved: 'approved', 'מאושר': 'approved', 'מאושר וחתום': 'approved',
  };
  return aliases[raw] ?? raw;
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
  sent:                 'נשלח',
  pending_approval:     'ממתין לאישור',
  returned_for_changes: 'הוחזר לתיקון',
  approved:             'מאושר',
  cancelled:            'בוטל'
};

function statusForDb(status) {
  const value = String(status || '').trim();
  return value || 'draft';
}

function proposalDomainForCurrentUser() {
  const user = state?.user || {};
  const userId = cleanProposalAgreementText(user.user_id || user.emp_id || user.employee_id);
  const username = cleanProposalAgreementText(user.username_for_login || user.username || user.username_display).toLowerCase();
  return userId === '3030' || username === 'esraaa' ? 'E' : 'Y';
}

function normalizeProposalDomain(value, fallback = proposalDomainForCurrentUser()) {
  const domain = cleanProposalAgreementText(value).toUpperCase();
  if (domain === 'E' || domain === 'N') return 'E';
  if (domain === 'Y' || domain === 'A') return 'Y';
  return fallback;
}

function buildProposalAgreementSearchText(row = {}) {
  const activityNames = Array.isArray(row.activity_names) ? row.activity_names.join(' ') : '';
  const statusLabel = PA_STATUS_LABELS[cleanProposalAgreementText(row.status)] || cleanProposalAgreementText(row.status);
  return [
    row.id,
    row.client_authority,
    row.school_framework,
    row.authority_code,
    row.semel_mosad,
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
  const PA_VALID_STATUSES = new Set(['draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled']);
  let rawStatus = cleanProposalAgreementText(row.status);
  // proposals_agreements_directory_view exposes both the raw saved values (client_authority direct
  // on base-table reads, legacy_client_authority/legacy_school_framework on the view) and catalog-joined
  // convenience columns (authority_name/school_name, coalesced from authorities/contacts_schools/schools).
  // The saved proposal row is always the source of truth, so raw/legacy fields must be checked first —
  // otherwise a stale or coincidentally-colliding catalog join could override the proposal's own client.
  const authorityName = cleanProposalAgreementText(row.client_authority || row.legacy_client_authority || row.authority_name || row.authority);
  const schoolFramework = cleanProposalAgreementText(row.school_framework || row.legacy_school_framework || row.school_name || row.contact_client_name || row.school);
  const normalized = {
    id:                  cleanProposalAgreementText(row.id),
    client_type:         cleanProposalAgreementText(row.contact_client_type) || (row.school_id ? 'school' : 'authority'),
    authority_id:        row.authority_id ?? null,
    school_id:           row.school_id ?? null,
    contact_school_id:   row.contact_school_id ?? null,
    authority_code:      cleanProposalAgreementText(row.authority_code),
    semel_mosad:         cleanProposalAgreementText(row.semel_mosad),
    authority:           authorityName,
    school:              schoolFramework,
    client_authority:    authorityName,
    school_framework:    schoolFramework || authorityName,
    document_type:       cleanProposalAgreementText(row.document_type),
    activity_type_group: normalizeProposalGroupValue(row.activity_type_group),
    proposal_domain:     normalizeProposalDomain(row.proposal_domain, 'Y'),
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
    include_catalog:     row.include_catalog === true || row.include_catalog === 'yes',
    proposal_series_id:  cleanProposalAgreementText(row.proposal_series_id),
    version_number:      Math.max(1, Number(row.version_number) || 1),
    supersedes_proposal_id: cleanProposalAgreementText(row.supersedes_proposal_id),
    archived_at:         cleanProposalAgreementText(row.archived_at),
    signature_meta:      (row.signature_meta && typeof row.signature_meta === 'object' && !Array.isArray(row.signature_meta)) ? row.signature_meta : {},
    approved_by:         cleanProposalAgreementText(row.approved_by),
    approved_at:         cleanProposalAgreementText(row.approved_at),
    sent_by:             cleanProposalAgreementText(row.sent_by),
    sent_at:             cleanProposalAgreementText(row.sent_at),
    locked_at:           cleanProposalAgreementText(row.locked_at),
    locked_by:           cleanProposalAgreementText(row.locked_by),
    locked_reason:       cleanProposalAgreementText(row.locked_reason),
    final_pdf_path:      cleanProposalAgreementText(row.final_pdf_path),
    final_pdf_file_name: cleanProposalAgreementText(row.final_pdf_file_name),
    final_pdf_created_at: cleanProposalAgreementText(row.final_pdf_created_at),
    final_pdf_created_by: cleanProposalAgreementText(row.final_pdf_created_by),
    document_snapshot:   (row.document_snapshot && typeof row.document_snapshot === 'object' && !Array.isArray(row.document_snapshot)) ? row.document_snapshot : null,
    document_html_snapshot: cleanProposalAgreementText(row.document_html_snapshot),
    created_at:          cleanProposalAgreementText(row.created_at),
    updated_at:          cleanProposalAgreementText(row.updated_at)
  };
  normalized._searchText = buildProposalAgreementSearchText(normalized);
  return normalized;
}

function proposalFinalPdfAllowedFile(file) {
  if (!file || typeof file !== 'object') return false;
  const mime = String(file.type || '').trim().toLowerCase();
  const name = String(file.name || '').trim().toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

function proposalFinalPdfStoragePath(proposalId, fileName = 'proposal.pdf') {
  const rowId = cleanProposalAgreementText(proposalId);
  if (!rowId) throw new Error('missing_proposal_agreement_id');
  const now = new Date();
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
    '-',
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0')
  ].join('');
  const safeName = String(fileName || 'proposal.pdf').replace(/[^\w.\-א-ת]+/g, '_').slice(0, 120) || 'proposal.pdf';
  return `proposals/${rowId}/${stamp}-${Date.now()}/${safeName}`;
}

function proposalLockActorName() {
  return firstNameOnly(
    state?.user?.full_name ||
    state?.user?.name ||
    state?.user?.username ||
    state?.user?.user_id ||
    ''
  );
}


function hasProposalAgreementSignature(row = {}) {
  const meta = row.signature_meta && typeof row.signature_meta === 'object' ? row.signature_meta : {};
  return Boolean(cleanProposalAgreementText(meta?.signature?.image || meta?.image));
}

function canTransitionProposalAgreementStatus(currentRow = {}, cleanStatus = '') {
  const currentStatus = normalizeProposalAgreementStatusForDb(currentRow.status || 'draft');
  const targetStatus = normalizeProposalAgreementStatusForDb(cleanStatus);
  if (currentStatus === 'sent') throw new Error('הצעה שנשלחה נעולה ולא ניתן לשנות את סטטוסה.');
  if (currentStatus === 'cancelled') throw new Error('הצעה שבוטלה נעולה. ניתן למחוק אותה או לשכפל להצעה חדשה.');
  if (targetStatus === currentStatus) return true;
  if (targetStatus === 'approved') {
    if (!canApproveProposalsAgreementsApi()) throw new Error('proposals_agreements_approval_forbidden');
    const needsResign = currentStatus === 'approved' && (!hasProposalAgreementSignature(currentRow) || !cleanProposalAgreementText(currentRow.approved_at));
    if (currentStatus !== 'pending_approval' && !needsResign) throw new Error('ניתן לאשר רק הצעה שממתינה לאישור או הצעה מאושרת ללא חתימה.');
    return true;
  }
  if (targetStatus === 'returned_for_changes') {
    if (!canApproveProposalsAgreementsApi()) throw new Error('proposals_agreements_approval_forbidden');
    if (currentStatus !== 'pending_approval') throw new Error('ניתן להחזיר לתיקון רק הצעה שממתינה לאישור.');
    return true;
  }
  if (targetStatus === 'sent') {
    throw new Error('שליחת הצעה דורשת נעילת מסמך והעלאת PDF סופי. השתמשו בפעולת "סימון כנשלח".');
  }
  if (targetStatus === 'cancelled') {
    if (!canApproveProposalsAgreementsApi()) throw new Error('proposals_agreements_approval_forbidden');
    if (!['draft', 'pending_approval', 'returned_for_changes'].includes(currentStatus)) throw new Error('לא ניתן לבטל הצעה בסטטוס הנוכחי.');
    return true;
  }
  if (targetStatus === 'pending_approval') {
    if (!['draft', 'returned_for_changes'].includes(currentStatus)) throw new Error('ניתן לשלוח לאישור רק טיוטה או הצעה שהוחזרה לתיקון.');
    return true;
  }
  if (targetStatus === 'draft') {
    if (currentStatus !== 'returned_for_changes') throw new Error('ניתן להחזיר לטיוטה רק הצעה שהוחזרה לתיקון.');
    return true;
  }
  throw new Error('invalid_proposal_agreement_status_transition');
}

const PA_VALID_STATUSES_SET = new Set(['draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled']);

// Proposal group definitions and legacy-name aliases are business data and live in Supabase
// (proposal_activity_groups / proposal_group_aliases). The lookup below is loaded from there
// and used to normalize any group value (legacy Hebrew label, display name) to its group_key.
let proposalGroupLookupCache = null;

async function readProposalActivityGroupsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('proposal_activity_groups')
      .select('group_key,display_name,template_key,included_group_keys,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throwProposalLoadError('activityGroupsError', 'proposal_activity_groups', error);
    const rows = (Array.isArray(data) ? data : []).map((row) => {
      const groupKey = cleanProposalAgreementText(row?.group_key);
      const displayName = cleanProposalAgreementText(row?.display_name);
      const templateKey = cleanProposalAgreementText(row?.template_key) || groupKey;
      const includedGroupKeys = Array.isArray(row?.included_group_keys)
        ? row.included_group_keys.map(cleanProposalAgreementText).filter(Boolean)
        : [];
      const sortOrder = Number(row?.sort_order) || 0;
      const isActive = row?.is_active !== false;
      return {
        ...row,
        group_key: groupKey,
        display_name: displayName,
        template_key: templateKey,
        included_group_keys: includedGroupKeys,
        sort_order: sortOrder,
        is_active: isActive,
        groupKey,
        displayName,
        templateKey,
        includedGroupKeys,
        sortOrder,
        isActive
      };
    }).filter((row) => row.group_key);
    noteProposalRead('proposalActivityGroups', rows, null);
    return rows;
  } catch (error) {
    throwProposalLoadError('activityGroupsError', 'proposal_activity_groups', error);
  }
}

async function readProposalGroupAliasesFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('proposal_group_aliases')
      .select('alias_name,group_key,is_active')
      .eq('is_active', true);
    if (error) throwProposalLoadError('groupAliasesError', 'proposal_group_aliases', error);
    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      alias_name: cleanProposalAgreementText(row?.alias_name),
      group_key:  cleanProposalAgreementText(row?.group_key),
      is_active:  row?.is_active !== false
    })).filter((row) => row.alias_name && row.group_key);
    noteProposalRead('proposalGroupAliases', rows, null);
    return rows;
  } catch (error) {
    throwProposalLoadError('groupAliasesError', 'proposal_group_aliases', error);
  }
}

function buildProposalGroupLookup(groups = [], aliases = []) {
  const aliasToKey = new Map();
  const groupByKey = new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    if (!group?.group_key) return;
    groupByKey.set(group.group_key, group);
    aliasToKey.set(group.group_key, group.group_key);
    if (group.display_name) aliasToKey.set(group.display_name, group.group_key);
  });
  (Array.isArray(aliases) ? aliases : []).forEach((alias) => {
    if (alias?.alias_name && alias?.group_key) aliasToKey.set(alias.alias_name, alias.group_key);
  });
  return { groups, aliases, aliasToKey, groupByKey };
}

const COMBINED_PROPOSAL_GROUP_KEYS = Object.freeze(['summer', 'next_year']);
let lastProposalLoaderDebug = {};


function numericListIdOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const listId = Number(value);
  return Number.isSafeInteger(listId) && listId > 0 ? listId : null;
}

function withSafeNumericListId(payload = {}) {
  const row = { ...payload };
  const raw = row.list_id ?? row.listId;
  const listId = numericListIdOrNull(raw);
  // Temporary diagnostics for the list_id bigint save issue.
  // eslint-disable-next-line no-console
  console.info('[list-id-save-debug]', { list_id: raw, type: typeof raw, numeric_list_id: listId });
  delete row.listId;
  if (raw == null || raw === '') {
    delete row.list_id;
  } else if (listId != null) {
    row.list_id = listId;
  } else {
    delete row.list_id;
  }
  delete row.id;
  delete row.label;
  delete row.value;
  return row;
}

function proposalSupabaseErrorDetails(error) {
  if (!error) return null;
  return {
    code: error?.code || null,
    message: String(error?.message || error || 'unknown_error'),
    details: error?.details || null,
    hint: error?.hint || null
  };
}

function logProposalLoadError(label, table, error) {
  const details = proposalSupabaseErrorDetails(error);
  if (!details) return;
  // eslint-disable-next-line no-console
  console.error('[proposal-load-error]', { label, table, ...details });
  if (isSupabasePermissionDeniedError(error)) {
    // eslint-disable-next-line no-console
    console.error('[proposal-permission-error]', { label, table, ...details });
  }
}

function noteProposalRead(name, rows, error) {
  const details = proposalSupabaseErrorDetails(error);
  lastProposalLoaderDebug[name] = {
    count: Array.isArray(rows) ? rows.length : 0,
    error: details ? details.message : null,
    errorDetails: details
  };
}

function throwProposalLoadError(label, table, error) {
  logProposalLoadError(label, table, error);
  noteProposalRead(label, null, error);
  const details = proposalSupabaseErrorDetails(error);
  const wrapped = new Error(details?.message || `${table}_read_failed`);
  wrapped.code = details?.code || error?.code;
  wrapped.details = details?.details || error?.details;
  wrapped.hint = details?.hint || error?.hint;
  wrapped.table = table;
  wrapped.label = label;
  wrapped.isPermissionError = isSupabasePermissionDeniedError(error);
  throw wrapped;
}

function buildProposalGroupHintsFromTemplateSections(sections = []) {
  const aliasToKey = new Map();
  const groupByKey = new Map();
  const groups = [];
  (Array.isArray(sections) ? sections : []).forEach((section) => {
    const templateKey = cleanProposalAgreementText(section?.template_key);
    const activityGroup = cleanProposalAgreementText(section?.activity_type_group);
    const templateName = cleanProposalAgreementText(section?.template_name);
    if (!templateKey) return;
    if (!groupByKey.has(templateKey)) {
      const group = {
        group_key: templateKey,
        display_name: templateName || activityGroup || templateKey,
        template_key: templateKey,
        included_group_keys: templateKey === 'combined' ? [...COMBINED_PROPOSAL_GROUP_KEYS] : [],
        sort_order: 0,
        is_active: true
      };
      groupByKey.set(templateKey, group);
      groups.push(group);
      aliasToKey.set(templateKey, templateKey);
    }
    if (activityGroup) aliasToKey.set(activityGroup, templateKey);
    if (templateName) aliasToKey.set(templateName, templateKey);
  });
  return { groups, aliases: [], aliasToKey, groupByKey };
}

function mergeProposalGroupLookups(primary = {}, hints = {}) {
  const aliasToKey = new Map(hints.aliasToKey || []);
  for (const [key, value] of (primary.aliasToKey || new Map())) aliasToKey.set(key, value);
  const groupByKey = new Map(hints.groupByKey || []);
  for (const [key, value] of (primary.groupByKey || new Map())) groupByKey.set(key, value);
  return {
    groups: [...groupByKey.values()],
    aliases: Array.isArray(primary.aliases) ? primary.aliases : [],
    aliasToKey,
    groupByKey
  };
}

function normalizeProposalGroupValue(value, groupLookup = proposalGroupLookupCache) {
  const raw = cleanProposalAgreementText(value);
  if (!raw) return '';
  return groupLookup?.aliasToKey?.get(raw) || raw;
}

function normalizeProposalActivityGroupForSave(value = '', groupLookup = proposalGroupLookupCache) {
  const raw = cleanProposalAgreementText(value);
  const normalized = normalizeProposalGroupValue(raw, groupLookup);

  const haystack = `${raw} ${normalized}`;
  if (
    normalized === 'tour' ||
    /(?:^|\s)tour(?:\s|$)/i.test(haystack) ||
    /סיור|סיורים|סיור בתעשייה|התנסות בתעשייה|13990/u.test(haystack)
  ) {
    return 'tour';
  }

  return normalized;
}

async function getProposalGroupLookup() {
  if (proposalGroupLookupCache) return proposalGroupLookupCache;
  const [groups, aliases, templateSections] = await Promise.all([
    readProposalActivityGroupsFromSupabase(),
    readProposalGroupAliasesFromSupabase(),
    readProposalTemplateSectionsFromSupabase()
  ]);
  proposalGroupLookupCache = mergeProposalGroupLookups(
    buildProposalGroupLookup(groups, aliases),
    buildProposalGroupHintsFromTemplateSections(templateSections)
  );
  return proposalGroupLookupCache;
}

function enrichProposalPricingRows(rows = [], groupLookup = proposalGroupLookupCache) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const groupKey = normalizeProposalGroupValue(row?.proposal_group, groupLookup);
    const groupMeta = groupLookup?.groupByKey?.get(groupKey) || null;
    return {
      ...row,
      group_key:    groupKey,
      template_key: cleanProposalAgreementText(groupMeta?.template_key) || groupKey
    };
  });
}


export function isValidUuid(value) {
  const raw = cleanProposalAgreementText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
}

export function uuidOrNull(value) {
  const raw = cleanProposalAgreementText(value);
  return isValidUuid(raw) ? raw : null;
}

export function bigintIdOrNull(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function assertProposalAgreementApprovalPayloadAllowed(payload = {}) {
  const requestedStatus = cleanProposalAgreementText(payload.status);
  const touchesApprovalField = Object.keys(payload || {}).some((key) => PROPOSALS_AGREEMENTS_APPROVAL_COLUMNS.has(key));
  if (requestedStatus === 'approved') {
    throw new Error('יש לאשר הצעות רק דרך updateProposalAgreementStatus.');
  }
  if (touchesApprovalField) {
    throw new Error('יש לעדכן שדות אישור רק דרך updateProposalAgreementStatus.');
  }
}

function sanitizeProposalAgreementPayload(payload = {}, groupLookup = proposalGroupLookupCache) {
  assertProposalAgreementApprovalPayloadAllowed(payload);
  const activity_names = normalizeProposalAgreementActivityNames(payload.activity_names);
  const rawStatus = cleanProposalAgreementText(payload.status);
  const rawGroup = cleanProposalAgreementText(payload.activity_type_group);
  const clientType = cleanProposalAgreementText(payload.client_type) || (payload.school_id ? 'school' : 'authority');
  const clientAuthority = cleanProposalAgreementText(payload.client_authority || payload.authority_name || payload.authority);
  const schoolFramework = cleanProposalAgreementText(payload.school_framework || payload.school_name || payload.school) || (clientType === 'other' ? cleanProposalAgreementText(payload.client_name) : clientAuthority);
  const row = {
    authority_id:        bigintIdOrNull(payload.authority_id),
    school_id:           clientType === 'school' ? bigintIdOrNull(payload.school_id) : null,
    contact_school_id:   bigintIdOrNull(payload.contact_school_id),
    client_authority:    clientAuthority,
    school_framework:    schoolFramework,
    document_type:       cleanProposalAgreementText(payload.document_type) || 'הצעת מחיר',
    activity_type_group: normalizeProposalActivityGroupForSave(rawGroup, groupLookup),
    proposal_domain:     normalizeProposalDomain(payload.proposal_domain),
    proposal_date:       cleanProposalAgreementText(payload.proposal_date) || null,
    activity_names:      activity_names,
    contact_name:        cleanProposalAgreementText(payload.contact_name),
    contact_role:        cleanProposalAgreementText(payload.contact_role),
    phone:               cleanProposalAgreementText(payload.phone),
    email:               cleanProposalAgreementText(payload.email),
    contact_phone:       cleanProposalAgreementText(payload.contact_phone) || cleanProposalAgreementText(payload.phone),
    contact_email:       cleanProposalAgreementText(payload.contact_email) || cleanProposalAgreementText(payload.email),
    notes:               parseActivityNamesFromNotes(payload.notes).notes,
    status:              statusForDb(PA_VALID_STATUSES_SET.has(rawStatus) ? rawStatus : 'draft'),
    approval_note:       cleanProposalAgreementText(payload.approval_note),
    total_amount:        payload.total_amount != null ? Number(payload.total_amount) || null : null,
    custom_document_sections: Array.isArray(payload.custom_document_sections) ? payload.custom_document_sections : [],
    include_catalog:     payload.include_catalog === true || payload.include_catalog === 'yes'
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'supersedes_proposal_id')) {
    row.supersedes_proposal_id = cleanProposalAgreementText(payload.supersedes_proposal_id) || null;
  }
  const requiredKeys = clientType === 'other'
    ? ['school_framework', 'document_type', 'activity_type_group']
    : ['client_authority', 'document_type', 'activity_type_group'];
  if (row.status === 'draft') {
    row.approval_note = '';
  }
  const missing = requiredKeys.filter((key) => !row[key]);
  if (missing.length) throw new Error(`missing_required_fields:${missing.join(',')}`);
  return Object.fromEntries(
    Object.entries(row).filter(([key]) => PROPOSALS_AGREEMENTS_WRITABLE_COLUMNS.has(key))
  );
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

async function resolveProposalSchoolCatalogIds(payload = {}, catalog = null) {
  const clientType = cleanProposalAgreementText(payload.client_type) || (payload.school_id ? 'school' : 'authority');
  if (clientType !== 'school') {
    return {
      authority_id: bigintIdOrNull(payload.authority_id),
      school_id: null,
      semel_mosad: null
    };
  }
  let authority_id = bigintIdOrNull(payload.authority_id);
  let school_id = bigintIdOrNull(payload.school_id);
  let semel_mosad = bigintIdOrNull(payload.semel_mosad) || (!bigintIdOrNull(payload.school_id) ? bigintIdOrNull(payload.school_id) : null) || null;
  const schoolLookup = catalog?.schoolLookup || (await readAuthoritySchoolCatalog()).schoolLookup;
  const schoolMeta = resolveSchoolCatalogEntry(schoolLookup, {
    school_id,
    semel_mosad,
    school: cleanProposalAgreementText(payload.school_framework || payload.school_name || payload.school),
    authority: cleanProposalAgreementText(payload.client_authority || payload.authority_name || payload.authority)
  });
  if (schoolMeta) {
    school_id = school_id || bigintIdOrNull(schoolMeta.id);
    authority_id = authority_id || bigintIdOrNull(schoolMeta.authority_id);
    semel_mosad = semel_mosad || bigintIdOrNull(schoolMeta.semel_mosad) || null;
  }
  return { authority_id, school_id, semel_mosad };
}

function enrichProposalAgreementRowFromCatalog(row = {}, catalog = null) {
  if (!row || typeof row !== 'object') return row;
  const schoolLookup = catalog?.schoolLookup;
  if (!schoolLookup) return row;
  const schoolMeta = resolveSchoolCatalogEntry(schoolLookup, {
    school_id: row.school_id,
    semel_mosad: row.semel_mosad,
    school: cleanProposalAgreementText(row.school_framework || row.school_name || row.school),
    authority: cleanProposalAgreementText(row.client_authority || row.authority_name || row.authority)
  });
  if (!schoolMeta) return row;
  return {
    ...row,
    client_type: cleanProposalAgreementText(row.client_type) || (row.school_id || schoolMeta.id ? 'school' : row.client_type),
    authority_id: row.authority_id ?? schoolMeta.authority_id ?? null,
    school_id: row.school_id ?? schoolMeta.id ?? null,
    semel_mosad: cleanProposalAgreementText(row.semel_mosad) || schoolMeta.semel_mosad || null,
    principal_name: cleanProposalAgreementText(row.principal_name) || schoolMeta.principal_name || null,
    school_phone: cleanProposalAgreementText(row.school_phone) || schoolMeta.school_phone || null,
    school_address: cleanProposalAgreementText(row.school_address || row.institution_address) || schoolMeta.institution_address || null,
    city: cleanProposalAgreementText(row.city) || schoolMeta.city || null
  };
}

async function ensureContactSchoolFromProposal(payload = {}) {
  const orig = (payload?._contact_original && typeof payload._contact_original === 'object')
    ? payload._contact_original
    : {};
  const authority = cleanProposalAgreementText(payload.client_authority);
  const school = cleanProposalAgreementText(payload.client_type) === 'other' ? '' : cleanProposalAgreementText(payload.school_framework);
  if (!authority) return null;
  const resolvedSchool = await resolveProposalSchoolCatalogIds(payload);
  const clientType = cleanProposalAgreementText(orig.client_type) || cleanProposalAgreementText(payload.client_type) || (resolvedSchool.school_id || school ? 'school' : 'authority');
  const clientName = cleanProposalAgreementText(orig.client_name) || cleanProposalAgreementText(payload.client_name) || (clientType === 'school' ? school : authority);
  const rpcArgs = {
    p_client_type:   clientType,
    p_client_name:   clientName || authority,
    p_authority:     authority,
    p_school:        school || null,
    p_contact_name:  cleanProposalAgreementText(payload.contact_name) || null,
    p_contact_role:  cleanProposalAgreementText(payload.contact_role) || null,
    p_phone:         cleanProposalAgreementText(payload.phone) || null,
    p_mobile:        cleanProposalAgreementText(orig.mobile) || cleanProposalAgreementText(payload.phone) || null,
    p_email:         cleanProposalAgreementText(payload.email) || null,
    p_address:       null,
    p_notes:         cleanProposalAgreementText(payload.notes) || null
  };
  const rpcSchoolId = bigintIdOrNull(resolvedSchool.school_id);
  const rpcAuthorityId = bigintIdOrNull(resolvedSchool.authority_id);
  const rpcSemelMosad = bigintIdOrNull(resolvedSchool.semel_mosad);
  if (rpcSchoolId) rpcArgs.p_school_id = rpcSchoolId;
  if (rpcAuthorityId) rpcArgs.p_authority_id = rpcAuthorityId;
  if (rpcSemelMosad) rpcArgs.p_semel_mosad = rpcSemelMosad;
  const { data: contactSchoolId, error } = await supabase.rpc(
    'ensure_contact_school_from_proposal',
    rpcArgs
  );
  if (error) throw new Error(error.message || 'ensure_contact_school_failed');
  return contactSchoolId ?? null;
}

async function resolveValidProposalContactSchoolId(value) {
  const id = bigintIdOrNull(value);
  if (!id) return null;
  const { data, error } = await supabase
    .from('contacts_schools')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message || 'contact_school_validation_failed');
  return data?.id != null ? Number(data.id) : null;
}

function proposalRequiresValidContactSchool(payload = {}) {
  const status = statusForDb(cleanProposalAgreementText(payload.status));
  const clientType = cleanProposalAgreementText(payload.client_type);
  return clientType !== 'other' && (status === 'pending_approval' || status === 'sent' || status === 'approved');
}

async function ensureValidProposalContactSchoolId(payload = {}) {
  const existingId = await resolveValidProposalContactSchoolId(payload.contact_school_id);
  if (existingId != null) return existingId;
  const ensuredId = await ensureContactSchoolFromProposal(payload);
  const validEnsuredId = await resolveValidProposalContactSchoolId(ensuredId);
  if (validEnsuredId != null) return validEnsuredId;
  if (proposalRequiresValidContactSchool(payload)) {
    throw new Error('לא ניתן לשלוח לאישור לפני בחירת איש קשר/מוסד תקף.');
  }
  return null;
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
      .select('activity_name,activity_no,proposal_group,item_type,gefen_number,hours_count,meetings_count,unit_duration,unit_price,hourly_price,description_short,description_for_proposal,is_active_for_proposals,sort_order,pricing_key,parent_pricing_key,proposal_display_mode,proposal_bundle_label,is_bundle_parent')
      .eq('is_active_for_proposals', true)
      .order('sort_order', { ascending: true });
    if (error) throwProposalLoadError('activityPricingError', 'proposal_activity_pricing', error);
    const rows = (Array.isArray(data) ? data : []).map((row) => ({
      activity_no:             cleanProposalAgreementText(row?.activity_no),
      activity_name:           cleanProposalAgreementText(row?.activity_name),
      proposal_group:          cleanProposalAgreementText(row?.proposal_group),
      item_type:               cleanProposalAgreementText(row?.item_type),
      gefen_number:            cleanProposalAgreementText(row?.gefen_number),
      hours_count:             row?.hours_count != null ? Number(row.hours_count) || null : null,
      meetings_count:          row?.meetings_count != null ? Number(row.meetings_count) || null : null,
      unit_duration:           cleanProposalAgreementText(row?.unit_duration),
      unit_price:              row?.unit_price != null ? Number(row.unit_price) || null : null,
      hourly_price:            row?.hourly_price != null ? Number(row.hourly_price) : null,
      description_short:        cleanProposalAgreementText(row?.description_short),
      description_for_proposal: cleanProposalAgreementText(row?.description_for_proposal),
      is_active_for_proposals:  row?.is_active_for_proposals !== false,
      sort_order:              Number(row?.sort_order) || 0,
      pricing_key:             cleanProposalAgreementText(row?.pricing_key),
      parent_pricing_key:      cleanProposalAgreementText(row?.parent_pricing_key),
      proposal_display_mode:   cleanProposalAgreementText(row?.proposal_display_mode) || 'single',
      proposal_bundle_label:   cleanProposalAgreementText(row?.proposal_bundle_label),
      is_bundle_parent:        Boolean(row?.is_bundle_parent)
    }));
    noteProposalRead('proposalActivityPricing', rows, null);
    return rows;
  } catch (error) {
    throwProposalLoadError('activityPricingError', 'proposal_activity_pricing', error);
  }
}

function mapProposalTemplateSectionRow(row = {}) {
  const templateKey = cleanProposalAgreementText(row?.template_key ?? row?.templateKey);
  const templateName = cleanProposalAgreementText(row?.template_name ?? row?.templateName);
  const activityTypeGroup = cleanProposalAgreementText(row?.activity_type_group ?? row?.activityTypeGroup);
  const sectionKey = cleanProposalAgreementText(row?.section_key ?? row?.sectionKey);
  const sectionTitle = cleanProposalAgreementText(row?.section_title ?? row?.sectionTitle);
  const sectionBody = normalizeProposalAgreementMultilineText(row?.section_body ?? row?.sectionBody);
  const sortOrder = Number(row?.sort_order ?? row?.sortOrder) || 0;
  const isActive = row?.is_active ?? row?.isActive;
  return {
    templateKey,
    templateName,
    activityTypeGroup,
    sectionKey,
    sectionTitle,
    sectionBody,
    sortOrder,
    isActive: isActive !== false,
    template_key: templateKey,
    template_name: templateName,
    activity_type_group: activityTypeGroup,
    section_key: sectionKey,
    section_title: sectionTitle,
    section_body: sectionBody,
    sort_order: sortOrder,
    is_active: isActive !== false
  };
}

async function readProposalTemplateSectionsFromSupabase() {
  try {
    const { data, error } = await supabase
      .from('proposal_template_sections')
      .select('template_key,template_name,activity_type_group,section_key,section_title,section_body,sort_order,is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throwProposalLoadError('templateSectionsError', 'proposal_template_sections', error);
    const rows = (Array.isArray(data) ? data : []).map(mapProposalTemplateSectionRow);
    noteProposalRead('proposalTemplateSections', rows, null);
    return rows;
  } catch (error) {
    throwProposalLoadError('templateSectionsError', 'proposal_template_sections', error);
  }
}

function mapUnifiedContactsForProposals(unifiedRows) {
  return (Array.isArray(unifiedRows) ? unifiedRows : []).map((c) => {
    const authorityName = cleanProposalAgreementText(c.authority_name || c.authority || c.client_name);
    const schoolName = cleanProposalAgreementText(c.school_name || c.school);
    return {
      id:           cleanProposalAgreementText(c.source_id || c.id),
      client_type:  cleanProposalAgreementText(c.client_type),
      client_name:  cleanProposalAgreementText(c.client_name) || schoolName || authorityName,
      authority_id: c.authority_id ?? null,
      school_id:    c.school_id ?? null,
      semel_mosad:  cleanProposalAgreementText(c.semel_mosad),
      authority_code: cleanProposalAgreementText(c.authority_code),
      authority_type: cleanProposalAgreementText(c.authority_type),
      authority_name: authorityName,
      school_name:  schoolName,
      district:     cleanProposalAgreementText(c.district),
      authority:    authorityName,
      school:       schoolName,
      contact_name: cleanProposalAgreementText(c.contact_name),
      contact_role: cleanProposalAgreementText(c.contact_role),
      phone:        cleanProposalAgreementText(c.phone || ''),
      mobile:       cleanProposalAgreementText(c.mobile || ''),
      email:        cleanProposalAgreementText(c.email || ''),
      source_table: cleanProposalAgreementText(c.source_table),
      source_id:    cleanProposalAgreementText(c.source_id || c.id),
      active:       'yes'
    };
  }).filter((c) => c.authority_name || c.school_name || c.authority || c.school);
}

function resolveProposalContactsLoadError(error) {
  const message = cleanProposalAgreementText(error?.message) || 'contacts_load_error';
  return message === 'contacts_unified_view_requires_auth_session' || message === 'contacts_unified_view_permission_denied'
    ? message
    : 'contacts_load_error';
}

function hasActiveProposalCatalogSchools(catalog) {
  return Array.isArray(catalog?.schoolLookup?.list)
    && catalog.schoolLookup.list.some((school) => isCatalogActive(school.active) && school.school_name);
}

async function readContactsSchoolsForProposals() {
  let catalog = {
    authorities: [],
    schools: [],
    authorityLookup: { list: [], byId: new Map(), byName: new Map() },
    schoolLookup: { list: [], byId: new Map(), bySemel: new Map(), byAuthoritySchool: new Map() }
  };
  let catalogError = null;
  try {
    catalog = await readAuthoritySchoolCatalog();
  } catch (error) {
    catalogError = error;
    // eslint-disable-next-line no-console
    console.warn('[supabase] Failed to load proposal authority/school catalog:', error);
  }

  let unifiedRows = [];
  let contactsLoadError = null;
  try {
    unifiedRows = await readUnifiedContactsFromSupabase({ requireAuth: true });
  } catch (error) {
    contactsLoadError = resolveProposalContactsLoadError(error);
    // eslint-disable-next-line no-console
    console.warn('[supabase] Failed to load proposal unified contacts:', error);
  }

  const contactsResult = mapUnifiedContactsForProposals(unifiedRows);
  const catalogHasSchools = hasActiveProposalCatalogSchools(catalog);
  const contactOptions = buildProposalClientSearchOptions(
    contactsResult,
    catalog.authorityLookup,
    catalog.schoolLookup
  );

  // eslint-disable-next-line no-console
  console.info('[proposal-catalog-authorities]', {
    count: catalog.authorities?.length,
    sample: catalog.authorities?.slice(0, 5)
  });
  // eslint-disable-next-line no-console
  console.info('[proposal-catalog-schools]', {
    count: catalog.schools?.length,
    sample: catalog.schools?.slice(0, 5)
  });
  // eslint-disable-next-line no-console
  console.info('[proposal-contact-options]', {
    count: contactsResult?.length,
    catalog_options_count: contactOptions.length,
    sample: contactsResult?.slice(0, 5)
  });

  if (contactsLoadError) {
    if (catalogHasSchools) {
      // eslint-disable-next-line no-console
      console.warn('[supabase] Proposal contacts failed; continuing with schools catalog only:', contactsLoadError);
      return {
        contactOptions,
        contactOptionsError: null,
        _debug: {
          contacts_error: contactsLoadError,
          contacts_count: contactsResult.length,
          catalog_schools_count: catalog.schools?.length ?? 0,
          catalog_fallback: 'schools_only'
        }
      };
    }
    return {
      contactOptions: contactOptions.length ? contactOptions : [],
      contactOptionsError: contactsLoadError,
      _debug: {
        contacts_error: contactsLoadError,
        catalog_error: cleanProposalAgreementText(catalogError?.message) || null
      }
    };
  }

  if (catalogError && !catalogHasSchools) {
    const catalogMessage = cleanProposalAgreementText(catalogError?.message) || 'catalog_load_error';
    // eslint-disable-next-line no-console
    console.warn('[supabase] Proposal catalog failed; using contacts only:', catalogError);
    return {
      contactOptions,
      contactOptionsError: contactsResult.length ? null : catalogMessage,
      _debug: {
        contacts_count: contactsResult.length,
        catalog_error: catalogMessage
      }
    };
  }

  return {
    contactOptions,
    contactOptionsError: null,
    _debug: { contacts_count: contactsResult.length }
  };
}

async function readProposalsAgreementsFromSupabase() {
  assertCanUseProposalsAgreementsApi();
  await waitForSupabaseAuthSession();
  lastProposalLoaderDebug = {};
  const [paResult, contactsResult, rawProposalActivityPricing, proposalTemplateSections, proposalActivityGroups, proposalGroupAliases] = await Promise.all([
    supabase
      .from('proposals_agreements_directory_view')
      .select(PROPOSALS_AGREEMENTS_DIRECTORY_COLUMNS)
      .order('authority_name', { ascending: true })
      .order('school_name', { ascending: true })
      .order('document_type', { ascending: true })
      .order('activity_type_group', { ascending: true }),
    readContactsSchoolsForProposals(),
    readProposalActivityPricingFromSupabase(),
    readProposalTemplateSectionsFromSupabase(),
    readProposalActivityGroupsFromSupabase(),
    readProposalGroupAliasesFromSupabase()
  ]);
  if (paResult.error) throw new Error(paResult.error.message || 'proposals_agreements_read_failed');
  noteProposalRead('rows', Array.isArray(paResult.data) ? paResult.data : [], null);
  const contactOptions = Array.isArray(contactsResult?.contactOptions) ? contactsResult.contactOptions : [];
  const contactOptionsError = contactsResult?.contactOptionsError || null;
  let proposalCatalog = null;
  try {
    proposalCatalog = await readAuthoritySchoolCatalog();
  } catch {
    proposalCatalog = null;
  }
  // Group/alias normalization happens here in the loader so the frontend receives
  // logical group keys (e.g. summer/next_year/combined) instead of legacy Hebrew labels.
  proposalGroupLookupCache = mergeProposalGroupLookups(
    buildProposalGroupLookup(proposalActivityGroups, proposalGroupAliases),
    buildProposalGroupHintsFromTemplateSections(proposalTemplateSections)
  );
  const proposalActivityPricing = enrichProposalPricingRows(rawProposalActivityPricing, proposalGroupLookupCache);
  const activityNameOptions = await readProposalActivityNamesFromSupabase();
  return {
    rows: (Array.isArray(paResult.data) ? paResult.data : [])
      .map(normalizeProposalAgreementRow)
      .map((row) => enrichProposalAgreementRowFromCatalog(row, proposalCatalog)),
    activityNameOptions,
    contactOptions,
    contactOptionsError,
    proposalActivityGroups,
    proposalGroupAliases,
    proposalActivityPricing,
    proposalTemplateSections,
    _debug: {
      ...(contactsResult?._debug || {}),
      ...(contactOptionsError ? { contacts_error: contactOptionsError } : {}),
      proposal_loader: { ...lastProposalLoaderDebug }
    },
    _source: 'supabase'
  };
}

const USER_PUBLIC_COLUMNS = 'user_id,username,email,name,full_name,role,display_role,display_role2,emp_id,is_active,permissions';
const USER_PUBLIC_COLUMNS_EXTENDED = `${USER_PUBLIC_COLUMNS},auth_user_id,auth_email,can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`;
const PROFILE_PERSONAL_REPORTS_COLUMNS = 'id,is_active,can_access_personal_reports';
const VALID_SUPABASE_ROLES = new Set(['admin', 'operation_manager', 'authorized_user', 'instructor', 'finance', 'activities_manager', 'domain_manager', 'instructor_manager', 'business_development_manager']);


const KNOWN_INSTRUCTOR_EMP_IDS = new Set(['1525', '1506', '1527', '1502', '1507', '1509', '1515', '1503', '1511']);
function isKnownInstructorIdentity(user = {}) {
  const role = normalizeRoleAlias(user?.role || user?.display_role).toLowerCase();
  if (role !== 'instructor') return false;
  return [user.emp_id, user.employee_id, user.user_id, user.username]
    .map((value) => String(value || '').trim())
    .some((id) => KNOWN_INSTRUCTOR_EMP_IDS.has(id));
}

const SUPABASE_ROLE_ROUTES = {
  admin: ['dashboard', 'activities', 'archive', 'catalog', 'invitations', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'permissions', 'admin-home', 'admin-settings', 'admin-lists', 'finance', 'operations-management', 'certificates'],
  operation_manager: ['dashboard', 'activities', 'archive', 'catalog', 'invitations', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'permissions', 'operations-management', 'certificates'],
  authorized_user: ['dashboard', 'activities', 'archive', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'certificates'],
  finance: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  activities_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'operations-management', 'certificates'],
  domain_manager: ['dashboard', 'activities', 'archive', 'catalog', 'invitations', 'proposals-agreements', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'certificates'],
  business_development_manager: ['dashboard', 'activities', 'archive', 'proposals-agreements', 'catalog', 'invitations', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  instructor_manager: ['dashboard', 'activities', 'archive', 'catalog', 'orders', 'week', 'month', 'exceptions', 'instructors', 'instructor-contacts', 'contacts', 'end-dates', 'edit-requests', 'certificates'],
  instructor: ['instructor-calendar', 'my-data', 'instructor-completion-approvals', 'instructor-guidelines']
};

function normalizeRoleAlias(role) {
  const normalized = String(role || 'authorized_user').trim();
  return normalized === 'activity_manager' ? 'activities_manager' : normalized;
}

function normalizeSupabaseRole(role) {
  const normalized = normalizeRoleAlias(role);
  return VALID_SUPABASE_ROLES.has(normalized) ? normalized : 'authorized_user';
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

function userCanAccessPersonalReportsFromPermissions(flat = {}) {
  return permissionFlagYes(flat.can_access_personal_reports);
}

async function readPersonalReportsProfile(authUserId, options = {}) {
  const id = String(authUserId || '').trim();
  if (!supabase || !id) return null;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 250;
  const session = await waitForSupabaseAuthSession({ timeoutMs: options.timeoutMs || 6000 });
  if (!session?.user?.id) {
    try { console.warn('[personal-reports-profile] skipped: no supabase auth session'); } catch { /* ignore */ }
    return null;
  }

  const readProfileById = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_PERSONAL_REPORTS_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      try { console.warn('[personal-reports-profile]', error.message); } catch { /* ignore */ }
      return null;
    }
    return data || null;
  };

  const firstRow = await readProfileById();
  if (firstRow || options.retryIfMissing === false) return firstRow;

  // Supabase Auth session restoration can lag immediately after sign-in.
  // Retry once before treating a missing profile as genuinely absent, so a
  // transient empty RLS result does not persist can_access_personal_reports=false.
  await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  return readProfileById();
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

function canDirectManageActivitiesUser(user = state?.user || {}) {
  return canEditDirect(user);
}

function canAddActivitiesUser(user = state?.user || {}) {
  return canAddActivityDirect(user);
}

function canSubmitActivityRequestsUser(user = state?.user || {}) {
  return canRequestEdit(user);
}

function canSubmitCreateActivityRequestsUser(user = state?.user || {}) {
  return canRequestCreateActivity(user);
}

function canReviewEditRequestsUser(user = state?.user || {}) {
  return canReviewRequests(user);
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
  const role = normalizeRoleAlias(userRow?.role);
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
  const usernameDisplay = String(userRow.username || '').trim().toLowerCase() || 'לא הוגדר';
  const usernameForLogin = String(userRow.username || '').trim().toLowerCase() || String(userRow.user_id || '').trim().toLowerCase();
  const customDisplayRole = String(userRow.display_role || '').trim();
  const displayRoleLabel = String(userRow.display_role_label || customDisplayRole || '').trim();
  const displayRole2 = String(userRow.display_role2 || permissions.display_role2 || '').trim();
  const flat = {
    user_id: String(userRow.user_id || ''),
    username: usernameDisplay,
    username_display: usernameDisplay,
    username_for_login: usernameForLogin,
    email: String(userRow.email || '').trim(),
    auth_email: String(userRow.auth_email || '').trim(),
    name: String(userRow.name || '').trim(),
    full_name: String(userRow.full_name || userRow.name || ''),
    role,
    display_role: role,
    display_role_label: displayRoleLabel || hebrewRole(role),
    display_role2: displayRole2,
    emp_id: String(userRow.emp_id || userRow.user_id || ''),
    auth_user_id: String(userRow.auth_user_id || ''),
    active: userRow.is_active ? 'yes' : 'no',
    ...permissions
  };
  if (userRow.can_request_edit != null) flat.can_request_edit = userRow.can_request_edit;
  if (userRow.can_request_edit_2 != null) flat.can_request_edit_2 = userRow.can_request_edit_2;
  if (userRow.can_request_create_activity != null) flat.can_request_create_activity = userRow.can_request_create_activity;
  if (userRow.can_edit_direct != null) flat.can_edit_direct = userRow.can_edit_direct;
  if (userRow.can_add_activity != null) flat.can_add_activity = userRow.can_add_activity;
  if (userRow.can_review_requests != null) flat.can_review_requests = userRow.can_review_requests;
  if (userRow.view_proposals_agreements != null) flat.view_proposals_agreements = userRow.view_proposals_agreements;
  if (userRow.manage_proposals_agreements != null) flat.manage_proposals_agreements = userRow.manage_proposals_agreements;
  if (userRow.approve_proposals_agreements != null) flat.approve_proposals_agreements = userRow.approve_proposals_agreements;
  return flat;
}

function proposalPermissionFlagsFromFlatUser(flat = {}) {
  return {
    view_proposals_agreements: permissionFlagYes(flat.view_proposals_agreements) ? 'yes' : undefined,
    manage_proposals_agreements: permissionFlagYes(flat.manage_proposals_agreements) ? 'yes' : undefined,
    approve_proposals_agreements: permissionFlagYes(flat.approve_proposals_agreements) ? 'yes' : undefined
  };
}

function proposalSessionUserFlagsFromFlatUser(flat = {}) {
  const view = permissionFlagYes(flat.view_proposals_agreements) || permissionFlagYes(flat.manage_proposals_agreements);
  const manage = permissionFlagYes(flat.manage_proposals_agreements);
  return {
    view_proposals_agreements: view || undefined,
    manage_proposals_agreements: manage || undefined
  };
}

function buildBootstrapFromUser(userRow, profileRow = null) {
  const flat = flattenUserRow(userRow);
  const role = normalizeSupabaseRole(flat.role);
  const allowedRoutes = [...(SUPABASE_ROLE_ROUTES[role] || SUPABASE_ROLE_ROUTES.authorized_user)];
  const isBusinessDevelopmentManager = role === 'business_development_manager';
  const canDirectManageActivities = canEditDirect(flat);
  const canAddActivities = canAddActivityDirect(flat);
  const canRequestEdit = canSubmitActivityRequestsUser(flat);
  const hasFinanceAccess = isBusinessDevelopmentManager ? false : (role === 'finance' || permissionFlagYes(parsePermissions(userRow?.permissions).finance_access) || permissionFlagYes(parsePermissions(userRow?.permissions).view_finance));
  const financeIdx = allowedRoutes.indexOf('finance');
  if (hasFinanceAccess && financeIdx === -1) allowedRoutes.push('finance');
  if (!hasFinanceAccess && financeIdx >= 0) allowedRoutes.splice(financeIdx, 1);
  if (permissionFlagYes(flat.view_activities) && !allowedRoutes.includes('activities')) allowedRoutes.push('activities');
  if (permissionFlagYes(flat.view_catalog) && !allowedRoutes.includes('catalog')) allowedRoutes.push('catalog');
  if ((permissionFlagYes(flat.view_orders) || permissionFlagYes(flat.view_invitations)) && !allowedRoutes.includes('invitations')) allowedRoutes.push('invitations');
  if (
    PROPOSALS_AGREEMENTS_ALLOWED_ROLES.has(role) ||
    permissionFlagYes(flat.view_proposals) ||
    permissionFlagYes(flat.view_proposals_agreements) ||
    permissionFlagYes(flat.manage_proposals_agreements)
  ) { if (!allowedRoutes.includes('proposals-agreements')) allowedRoutes.push('proposals-agreements'); }
  const canReviewRequests = canDirectManageActivities;
  const canViewEditRequests = canReviewRequests || canRequestEdit || permissionFlagYes(flat.view_edit_requests) || allowedRoutes.includes('edit-requests');
  if (canViewEditRequests && !allowedRoutes.includes('edit-requests')) {
    allowedRoutes.push('edit-requests');
  }
  const hasPersonalReportsAccess =
    profileCanAccessPersonalReports(profileRow) ||
    userCanAccessPersonalReportsFromPermissions(flat);
  const hasPersonalReportsManager = canManagePersonalReportsUser(flat);
  const personalReportsIdx = allowedRoutes.indexOf('personal-reports');
  if (hasPersonalReportsAccess && personalReportsIdx === -1) allowedRoutes.push('personal-reports');
  if (!hasPersonalReportsAccess && personalReportsIdx >= 0) allowedRoutes.splice(personalReportsIdx, 1);
  // General admin routes are only for role=admin, never for feature-specific flags.
  // operation_manager retains access to the permissions screen for user management.
  if (role !== 'admin') {
    const adminOnlyRoutes = role === 'operation_manager'
      ? ['admin-home', 'admin-settings', 'admin-lists']
      : ['admin-home', 'admin-settings', 'admin-lists', 'permissions'];
    adminOnlyRoutes.forEach((route) => {
      const idx = allowedRoutes.indexOf(route);
      if (idx >= 0) allowedRoutes.splice(idx, 1);
    });
  }
  // Israa management tab — requires view_israa_management=yes AND (the esraaa username or admin role).
  const isIsraaUser = String(flat.username_for_login || '').trim().toLowerCase() === 'esraaa';
  const isAdminRole = role === 'admin';
  if ((isIsraaUser || isAdminRole) && permissionFlagYes(flat.view_israa_management)) {
    if (!allowedRoutes.includes('israa-management')) allowedRoutes.push('israa-management');
  }
  if (permissionFlagYes(flat.view_operations_management) && !allowedRoutes.includes('operations-management')) {
    allowedRoutes.push('operations-management');
  }
  if (isKnownInstructorIdentity(flat)) {
    for (const route of ['instructor-calendar', 'my-data', 'instructor-completion-approvals', 'instructor-guidelines']) {
      if (!allowedRoutes.includes(route)) allowedRoutes.push(route);
    }
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
      username: flat.username,
      display_role2: flat.display_role2 || '',
      display_role_label: flat.display_role_label || hebrewRole(role)
    },
    can_add_activity: canAddActivities,
    can_edit_direct: canDirectManageActivities,
    can_request_edit: canRequestEdit,
    can_request_create_activity: canRequestCreateActivity(flat),
    can_review_requests: canReviewRequests,
    client_settings: {}
  };
}

function getInstructorIdentitySet() {
  const user = state?.user || {};
  const values = currentUserIdentityValues();
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

async function loginWithSupabaseAuth(username, password) {
  if (!supabase) throwLoginError('no_supabase_client');
  const submittedUsername = String(username || '').trim();
  const submittedPassword = String(password || '').trim();
  if (!submittedUsername || !submittedPassword) throwLoginError('missing_user_id_or_entry_code');

  const loginUsername = submittedUsername.toLowerCase();
  const { data: loginLookupRows, error: userLookupError } = await supabase
    .rpc('lookup_login_user_by_username', { p_username: loginUsername });

  if (userLookupError) {
    throwLoginError('users_query_failed', {
      username: loginUsername,
      message: String(userLookupError?.message || '')
    });
  }

  const loginLookupList = Array.isArray(loginLookupRows)
    ? loginLookupRows
    : loginLookupRows
      ? [loginLookupRows]
      : [];
  const loginUser = loginLookupList[0] || null;

  if (!loginUser) {
    throwLoginError('inactive_or_missing_username', { username: loginUsername });
  }

  const loginAuthEmail = String(loginUser.auth_email || '').trim().toLowerCase();
  if (!loginAuthEmail) {
    throwLoginError('auth_ok_user_row_not_found', { username: loginUsername, reason: 'missing_auth_email' });
  }

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: loginAuthEmail,
    password: submittedPassword
  });

  if (authError || !authData?.user) {
    throwLoginError('invalid_credentials', { login: submittedUsername, message: String(authError?.message || '') });
  }

  resetSupabaseAuthSessionWait();
  const postSignInSession = await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  if (!postSignInSession?.user?.id) {
    resetSupabaseAuthSessionWait();
  }

  const authUserId = String(authData.user.id || '').trim();
  const rowAuthUserId = String(loginUser.auth_user_id || '').trim();
  if (!authUserId || !rowAuthUserId || authUserId !== rowAuthUserId) {
    throwLoginError('auth_ok_user_row_not_found', {
      username: loginUsername,
      auth_user_id: authUserId,
      row_auth_user_id: rowAuthUserId,
      reason: 'auth_user_id_mismatch'
    });
  }

  const { userRow, matchedBy, status } = await resolveActiveUserRowAfterAuth({
    supabase,
    baseColumns: USER_PUBLIC_COLUMNS,
    extendedColumns: USER_PUBLIC_COLUMNS_EXTENDED,
    username: loginUsername,
    authEmail: loginAuthEmail,
    authUserId,
    loginMode: true,
    requireAuthUserMatch: true
  });

  if (!userRow) {
    const postAuthProfileError = status === 'permission_denied'
      ? 'auth_ok_user_row_permission_denied'
      : status === 'query_error'
        ? 'auth_ok_user_row_query_error'
        : status === 'multiple_matches'
          ? 'auth_ok_user_row_multiple_matches'
          : 'auth_ok_user_row_not_found';
    throwLoginError(postAuthProfileError, {
      username: loginUsername,
      auth_user_id: authUserId,
      reason: 'post_auth_user_row_not_found',
      status
    });
  }

  try {
    console.info('[login-auth-success]', { authEmail: loginAuthEmail, loginUsername, authUserId });
    console.info('[login-user-resolve]', { matchedBy, username: loginUsername, user_id: userRow.user_id, auth_email: loginAuthEmail });
  } catch {
    /* ignore */
  }

  userRow.auth_user_id = authUserId;
  assertValidLoginUserRow(userRow);
  resetSupabaseAuthSessionWait();
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  const profileRow = await readPersonalReportsProfile(authUserId, { retryIfMissing: true, retryDelayMs: 300 });
  return { userRow, profileRow };
}

function makeSessionToken(userRow) {
  const claims = {
    uid: String(userRow.user_id || ''),
    role: normalizeSupabaseRole(userRow.role),
    emp_id: String(userRow.emp_id || userRow.user_id || ''),
    name: String(userRow.name || '')
  };
  return `sb.${btoa(unescape(encodeURIComponent(JSON.stringify(claims))))}.session`;
}

async function readCurrentUserBySession() {
  if (!supabase) throw new Error('no_supabase_client');
  const session = await waitForSupabaseAuthSession();
  if (!session?.user?.id) throw new Error('unauthorized');
  const authUserId = session.user.id;
  const sessionUserId = String(state?.user?.user_id || '').trim();
  const sessionUsername = String(state?.user?.username || '').trim();
  if (!sessionUserId && !sessionUsername) throw new Error('unauthorized');
  const { userRow } = await resolveActiveUserRowAfterAuth({
    supabase,
    baseColumns: USER_PUBLIC_COLUMNS,
    extendedColumns: USER_PUBLIC_COLUMNS_EXTENDED,
    sessionUserId,
    username: sessionUsername,
    authUserId,
    requireAuthUserMatch: true
  });
  if (!userRow) throw new Error('unauthorized');
  userRow.auth_user_id = String(userRow.auth_user_id || authUserId || '').trim();
  resetSupabaseAuthSessionWait();
  await waitForSupabaseAuthSession({ timeoutMs: 6000 });
  const profileRow = await readPersonalReportsProfile(authUserId, { retryIfMissing: true, retryDelayMs: 300 });
  return { userRow, profileRow };
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
    state_user_id: String(state?.user?.user_id || '').trim(),
    requested_by_user_id: String(state?.user?.user_id || '').trim(),
    role: String(state?.user?.role || '').trim(),
    can_request_edit: state?.user?.can_request_edit ?? null,
    can_edit_direct: state?.user?.can_edit_direct ?? null,
    can_add_activity: state?.user?.can_add_activity ?? null
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
    context.role = typeof roleData === 'string' && roleData ? roleData : context.role;
    context.can_edit_direct = typeof canEditData === 'boolean' ? canEditData : context.can_edit_direct;
    context.can_add_activity = typeof canAddData === 'boolean' ? canAddData : context.can_add_activity;
  } catch {
    /* ignore */
  }
  try {
    const { data: userRow } = await supabase
      .from('users')
      .select('user_id,role,can_request_edit,can_request_edit_2,can_edit_direct,can_add_activity')
      .eq('auth_user_id', context.auth_uid)
      .maybeSingle();
    context.user_id = String(userRow?.user_id || '').trim();
    context.role = String(userRow?.role || context.role || '').trim();
    context.can_request_edit = permissionFlagYes(userRow?.can_request_edit) || permissionFlagYes(userRow?.can_request_edit_2) || context.can_request_edit;
    context.can_edit_direct = userRow?.can_edit_direct == null ? context.can_edit_direct : permissionFlagYes(userRow.can_edit_direct);
    context.can_add_activity = userRow?.can_add_activity == null ? context.can_add_activity : permissionFlagYes(userRow.can_add_activity);
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
  const isSchool2027 = normalizeActivitySeason(row.activity_season) === ACTIVITY_SEASON_SCHOOL_2027;
  if (!selectedDate && !isSchool2027) throw new Error('יש לבחור תאריך תקין לפעילות חד־יומית לפני השמירה');
  if (selectedDate) {
    row.start_date = selectedDate;
    row.end_date = selectedDate;
    row.date_1 = selectedDate;
  }
  if (String(row.status || '').trim() === LEGACY_ACTIVE_STATUS) row.status = OPEN_STATUS;
  if (![OPEN_STATUS, APPROVED_PENDING_PLACEMENT_STATUS, CLOSED_STATUS, DELETED_STATUS].includes(String(row.status || '').trim())) row.status = OPEN_STATUS;
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
  if (!String(row.activity_season ?? act.activitySeason ?? '').trim() && currentGlobalActivityPeriod() === ACTIVITY_SEASON_SCHOOL_2027) row.activity_season = ACTIVITY_SEASON_SCHOOL_2027;
  else row.activity_season = normalizeActivitySeason(row.activity_season ?? act.activitySeason);
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
  'authority_id',
  'school_id',
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
  'operations_private_notes',
  'participants_count',
  'school_contact_id',
  'contact_name',
  'contact_phone',
  'contact_email'
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
      continue;
    }
    if (/^meeting_note_\d+$/.test(key)) {
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
  const bigintFields = new Set(['activity_no', 'sessions', 'price', 'emp_id', 'emp_id_2', 'school_contact_id']);
  const timeFields = new Set(['start_time', 'end_time']);
  const humanNameFields = new Set(['instructor_name', 'instructor_name_2', 'activity_manager', 'previous_activity_manager']);
  for (const [key, rawValue] of Object.entries(source)) {
    if (!ALLOWED_ACTIVITY_COLUMNS.has(key)) continue;
    if (!includeRowId && key === 'row_id') continue;
    let nextValue = rawValue;
    if (key === 'start_date' || key === 'end_date' || /^date_\d+$/.test(key)) {
      nextValue = normalizeDateFieldForSupabase(rawValue);
    } else if (key === 'activity_season') {
      nextValue = normalizeActivitySeason(rawValue);
    } else if (key === 'participants_count') {
      if (rawValue === '' || rawValue === null || rawValue === undefined) {
        nextValue = null;
      } else {
        const n = Number(rawValue);
        nextValue = Number.isInteger(n) && n > 0 ? n : null;
      }
    } else if (bigintFields.has(key)) {
      nextValue = normalizeBigintFieldForSupabase(rawValue);
    } else if (timeFields.has(key)) {
      nextValue = normalizeTimeFieldForSupabase(rawValue);
    } else if (humanNameFields.has(key)) {
      nextValue = normalizeHumanName(rawValue);
    }
    sanitized[key] = nextValue === undefined ? null : nextValue;
  }
  return sanitized;
}

async function validateActivityInstructorBindingsOrThrow(payload = {}) {
  const contactsRows = await readInstructorContactsRowsForBootstrap();
  const contactsUsers = contactsRows
    .map((row) => ({ emp_id: String(row?.emp_id || '').trim(), name: normalizeHumanName(row?.full_name) }))
    .filter((user) => user.emp_id && user.name);
  const result = validateInstructorIdentityPayload(payload, contactsUsers);
  if (!result.valid) {
    const err = new Error('activity_instructor_not_in_contacts');
    err.code = result.errors[0]?.code || 'activity_instructor_not_in_contacts';
    err.field = result.errors[0]?.field || '';
    throw err;
  }
}

function applyInstructorEmpSync(source = {}, { strict = true } = {}) {
  void strict;
  const payload = { ...(source || {}) };
  const pairs = [
    { nameKey: 'instructor_name', empKey: 'emp_id' },
    { nameKey: 'instructor_name_2', empKey: 'emp_id_2' }
  ];
  for (const { nameKey, empKey } of pairs) {
    if (!Object.prototype.hasOwnProperty.call(payload, nameKey)) continue;
    const nameValue = normalizeHumanName(payload[nameKey]);
    const empId = String(payload[empKey] || '').trim();
    if (!nameValue) {
      payload[empKey] = null;
      continue;
    }
    if (!empId) {
      const err = new Error('instructor_missing_emp_id');
      err.code = 'instructor_missing_emp_id';
      err.field = nameKey;
      throw err;
    }
  }
  return payload;
}

async function saveActivitySchoolsForActivity(activityRow = {}, source = {}) {
  const activityId = activityRow?.id || activityRow?.activity_id || null;
  if (!activityId) return;
  const rawSchools = Array.isArray(source?.school_ids) ? source.school_ids : (Array.isArray(source?.schools) ? source.schools : []);
  const schoolIds = rawSchools
    .map((item) => (item && typeof item === 'object') ? (item.school_id || item.id) : item)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const singleSchoolId = String(source?.school_id || activityRow?.school_id || '').trim();
  if (singleSchoolId && !schoolIds.includes(singleSchoolId)) schoolIds.push(singleSchoolId);
  const uniqueSchoolIds = [...new Set(schoolIds)];
  if (!uniqueSchoolIds.length) return;
  const rows = uniqueSchoolIds.map((schoolId) => ({ activity_id: activityId, school_id: schoolId }));
  const { error } = await supabase.from('activity_schools').upsert(rows, { onConflict: 'activity_id,school_id' });
  if (error) throw new Error(error.message || 'activity_schools_save_failed');
}

async function upsertActivityToSupabase(payload = {}) {
  const act = applyInstructorEmpSync(payload?.activity || payload || {});
  await validateActivityInstructorBindingsOrThrow(act);
  const row = sanitizeActivityPayloadForSupabase(synchronizeStartDateAndFirstMeeting(sanitizeActivityPayload(act)), { includeRowId: true });
  const rawSchoolIds = Array.isArray(act.school_ids) ? act.school_ids.map((id) => String(id || '').trim()).filter(Boolean) : [];
  if (rawSchoolIds.length > 1 && !act.school_id) row.school_id = null;
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
  await saveActivitySchoolsForActivity(data || row, act);
  const normalized = normalizeActivityRow(data || row);
  invalidateAllActivitiesRowsCache();
  logActivityMutationDebug('success', 'addActivity', { source_sheet: 'activities', source_row_id: normalized.row_id, changes: row });
  return { RowID: normalized.RowID, row_id: normalized.row_id, source_sheet: 'activities', row: normalized };
}


function activityDateSelectColumns() {
  return ['row_id', 'start_date', 'end_date', ...Array.from({ length: 35 }, (_, idx) => `date_${idx + 1}`)].join(',');
}

function pickActivityDateProofRow(row = {}) {
  const out = { row_id: row?.row_id || '', start_date: row?.start_date || '', end_date: row?.end_date || '' };
  for (let i = 1; i <= 35; i++) out[`date_${i}`] = row?.[`date_${i}`] || '';
  return out;
}

function assertSupabaseActivityUpdateApplied(operation, requestedChanges = {}, returnedRow = {}) {
  if (!returnedRow || typeof returnedRow !== 'object') {
    const err = new Error('activity_update_no_row_returned');
    err.operation = operation;
    throw err;
  }
  for (const [key, expectedRaw] of Object.entries(requestedChanges || {})) {
    if (!(key === 'start_date' || key === 'end_date' || /^date_\d+$/.test(key))) continue;
    const expected = normalizeDateFieldForSupabase(expectedRaw) || '';
    const actual = normalizeDateFieldForSupabase(returnedRow[key]) || '';
    if (expected !== actual) {
      const err = new Error(`activity_date_update_not_applied:${key}`);
      err.operation = operation;
      err.field = key;
      err.expected = expected;
      err.actual = actual;
      throw err;
    }
  }
}


async function readContactsForSchool2027Activities(rows = []) {
  if (!supabase) return [];
  const school2027Rows = (Array.isArray(rows) ? rows : []).filter((row) => normalizeActivitySeason(row?.activity_season) === ACTIVITY_SEASON_SCHOOL_2027);
  if (!school2027Rows.length) return [];
  try {
    const schoolIds = [...new Set(school2027Rows.map((row) => String(row?.school_id || '').trim()).filter(Boolean))];
    const contactIds = [...new Set(school2027Rows.map((row) => String(row?.school_contact_id || '').trim()).filter(Boolean))];
    const pairs = school2027Rows
      .filter((row) => !String(row?.school_id || '').trim())
      .map((row) => ({ authority: String(row?.authority || '').trim(), school: String(row?.school || '').trim() }))
      .filter((pair) => pair.authority && pair.school);
    const requests = [];
    if (contactIds.length) {
      requests.push(
        supabase
          .from('contacts_schools')
          .select('id,school_id,authority,school,contact_name,contact_role,phone,mobile,email,active')
          .in('id', contactIds)
          .neq('active', 'לא פעיל')
          .limit(1000)
      );
    }
    if (schoolIds.length) {
      requests.push(
        supabase
          .from('contacts_schools')
          .select('id,school_id,authority,school,contact_name,contact_role,phone,mobile,email,active')
          .in('school_id', schoolIds)
          .neq('active', 'לא פעיל')
          .limit(1000)
      );
    }
    for (const pair of pairs) {
      requests.push(
        supabase
          .from('contacts_schools')
          .select('id,school_id,authority,school,contact_name,contact_role,phone,mobile,email,active')
          .eq('authority', pair.authority)
          .eq('school', pair.school)
          .neq('active', 'לא פעיל')
          .limit(200)
      );
    }
    if (!requests.length) return [];
    const results = await Promise.all(requests);
    const byId = new Map();
    for (const result of results) {
      if (result?.error) throw result.error;
      for (const contact of (Array.isArray(result?.data) ? result.data : [])) byId.set(String(contact.id), contact);
    }
    return [...byId.values()];
  } catch (err) {
    console.warn('[contacts] readContactsForSchool2027Activities failed', err?.message || err);
    return [];
  }
}

async function readContactsForSchoolActivity(schoolId, school, authority) {
  if (!supabase) return [];
  try {
    let query = supabase
      .from('contacts_schools')
      .select('id,contact_name,contact_role,phone,mobile,email')
      .neq('active', 'לא פעיל')
      .order('contact_name', { ascending: true })
      .limit(200);
    if (schoolId && String(schoolId).trim()) {
      query = query.eq('school_id', String(schoolId).trim());
    } else if (school && String(school).trim()) {
      query = query.eq('school', String(school).trim());
      if (authority && String(authority).trim()) query = query.eq('authority', String(authority).trim());
    } else {
      return [];
    }
    const { data, error } = await query;
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[contacts] readContactsForSchoolActivity failed', err?.message || err);
    return [];
  }
}

async function createSchoolContactForActivity({ school_id, school, authority, contact_name, contact_role, phone, email } = {}) {
  if (!supabase) throw new Error('supabase_not_initialized');
  const row = {
    school_id: school_id || null,
    school: String(school || '').trim(),
    authority: String(authority || '').trim(),
    contact_name: String(contact_name || '').trim(),
    contact_role: String(contact_role || '').trim(),
    phone: String(phone || '').trim(),
    mobile: String(phone || '').trim(),
    email: String(email || '').trim(),
    active: 'פעיל'
  };
  const { data, error } = await supabase
    .from('contacts_schools')
    .insert(row)
    .select('id,contact_name,contact_role,phone,mobile,email')
    .single();
  if (error) throw new Error(error.message || 'create_contact_failed');
  return data;
}

async function upsertMeetingNotesToSupabase(rowId, notesMap = {}) {
  const entries = Object.entries(notesMap);
  if (!entries.length) return;
  const rows = entries.map(([idx0, note]) => ({
    source_row_id: rowId,
    meeting_no: String(Number(idx0) + 1),
    notes: String(note || '')
  }));
  try {
    await supabase
      .from('activity_meetings')
      .upsert(rows, { onConflict: 'source_row_id,meeting_no' });
  } catch (e) {
    console.warn('[activity-meetings] upsertMeetingNotesToSupabase failed', e?.message || e);
  }
}

function extractMeetingNotes(changes = {}) {
  const notes = {};
  for (const [key, val] of Object.entries(changes)) {
    const m = /^meeting_note_(\d+)$/.exec(key);
    if (m) {
      const idx0 = Number(m[1]);
      if (Number.isFinite(idx0) && idx0 >= 0 && idx0 < 35) notes[idx0] = String(val || '');
    }
  }
  return notes;
}

async function updateActivityInSupabase(payload = {}) {
  const rowId = String(payload?.source_row_id || payload?.row_id || payload?.RowID || '').trim();
  const sourceSheet = String(payload?.source_sheet || 'activities').trim() || 'activities';
  if (!rowId) throw new Error('missing_row_id');
  const rawChanges = applyInstructorEmpSync({ ...(payload?.changes || {}) });
  const meetingNotes = extractMeetingNotes(rawChanges);
  const mappedChanges = mapMeetingDateFieldNamesToSupabase(rawChanges);
  const { data: existingInstructorRow, error: existingInstructorError } = await supabase
    .from('activities')
    .select('instructor_name,instructor_name_2,emp_id,emp_id_2')
    .eq('row_id', rowId)
    .maybeSingle();
  if (existingInstructorError) throw buildSupabaseMutationError('saveActivity', existingInstructorError, 'save_failed');
  await validateActivityInstructorBindingsOrThrow({ ...(existingInstructorRow || {}), ...rawChanges });
  let existingForNormalization = null;
  const needsExisting = Object.keys(mappedChanges).some((key) => ['activity_type', 'item_type', 'activity_family', 'activity_name', 'start_date', 'end_date', 'date_1', 'status'].includes(key) || /^date_\d+$/.test(key));
  if (needsExisting) {
    const { data: existingRow, error: existingError } = await supabase
      .from('activities')
      .select('*')
      .eq('row_id', rowId)
      .maybeSingle();
    if (existingError) throw buildSupabaseMutationError('saveActivity', existingError, 'save_failed');
    existingForNormalization = existingRow || {};
  }
  let normalizedChangesSource = synchronizeStartDateAndFirstMeeting(mappedChanges, existingForNormalization || {});
  if (existingForNormalization && oneDayTypeFromActivityFields(mappedChanges.activity_type || existingForNormalization.activity_type, mappedChanges.item_type || existingForNormalization.item_type)) {
    const normalizedFullRow = assertValidOneDayActivityRow(normalizeOneDayActivityForSave({ ...existingForNormalization, ...mappedChanges }));
    normalizedChangesSource = { ...normalizedChangesSource };
    ['activity_family', 'activity_type', 'item_type', 'status', 'start_date', 'end_date', 'date_1'].forEach((key) => {
      normalizedChangesSource[key] = normalizedFullRow[key];
    });
    if (Object.prototype.hasOwnProperty.call(mappedChanges, 'activity_name')) {
      normalizedChangesSource.activity_name = normalizedFullRow.activity_name;
    }
  }
  const sanitizedChanges = sanitizeActivityPayloadForSupabase(normalizedChangesSource, { includeRowId: false });
  console.info('[activity-date-save-proof:mapped]', {
    rowId,
    rawChanges,
    mappedChanges,
    sanitizedChanges
  });
  const changes = sanitizedChanges;
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
  const hasMeetingNotes = Object.keys(meetingNotes).length > 0;
  if (!Object.keys(changes).length && !hasMeetingNotes) throw new Error('No changes to submit');
  if (!Object.keys(changes).length) {
    await upsertMeetingNotesToSupabase(rowId, meetingNotes);
    const { data: notesOnlyRow } = await supabase.from('activities').select('*').eq('row_id', rowId).maybeSingle();
    const notesOnlyNormalized = normalizeActivityRow(notesOnlyRow || {});
    return { ok: true, RowID: rowId, row_id: rowId, source_sheet: 'activities', row: notesOnlyNormalized };
  }
  const debugPayload = { source_sheet: sourceSheet, source_row_id: rowId, changes };
  const { data: rowIdMatches, error: rowIdMatchesError } = await supabase
    .from('activities')
    .select('row_id')
    .eq('row_id', rowId)
    .limit(2);
  if (rowIdMatchesError) throw buildSupabaseMutationError('saveActivity', rowIdMatchesError, 'save_failed');
  if (Array.isArray(rowIdMatches) && rowIdMatches.length > 1) {
    const duplicateRowIdError = new Error(`duplicate key value violates unique constraint "activities_row_id_key" | Key (row_id)=(${rowId}) appears more than once`);
    duplicateRowIdError.name = 'SupabaseMutationError';
    duplicateRowIdError.operation = 'saveActivity';
    duplicateRowIdError.code = '23505';
    duplicateRowIdError.details = `row_id ${rowId} matched ${rowIdMatches.length} activities rows before update`;
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', {
      action: 'saveActivity',
      table: 'activities',
      row_id: rowId,
      source_sheet: sourceSheet,
      changed_fields: Object.keys(changes),
      supabase_error_code: duplicateRowIdError.code,
      supabase_error_message: duplicateRowIdError.message,
      supabase_error_details: duplicateRowIdError.details,
      supabase_error_hint: 'Fix duplicate activities.row_id rows before saving this activity.',
      payload: debugPayload,
      error: duplicateRowIdError
    });
    throw duplicateRowIdError;
  }
  logActivityMutationDebug('request', 'saveActivity', debugPayload, { table: 'activities' });
  console.info('[activity-date-save-proof:before-update]', { rowId, changes });
  const { data, error } = await supabase
    .from('activities')
    .update(changes)
    .eq('row_id', rowId)
    .select('*')
    .maybeSingle();
  if (error) {
    const authContext = await buildActivityMutationAuthContext();
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', {
      action: 'saveActivity',
      table: 'activities',
      row_id: rowId,
      source_sheet: sourceSheet,
      changed_fields: Object.keys(changes),
      auth_uid: authContext.auth_uid,
      user_id: authContext.user_id,
      role: authContext.role,
      can_edit_direct: authContext.can_edit_direct,
      can_add_activity: authContext.can_add_activity,
      supabase_error_code: error?.code || error?.status || '',
      supabase_error_message: String(error?.message || 'save_failed'),
      supabase_error_details: String(error?.details || ''),
      supabase_error_hint: String(error?.hint || ''),
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
  const { data: freshDbRow, error: freshDbError } = await supabase
    .from('activities')
    .select(activityDateSelectColumns())
    .eq('row_id', rowId)
    .maybeSingle();
  if (freshDbError) throw buildSupabaseMutationError('saveActivity', freshDbError, 'save_failed');
  const proofRow = pickActivityDateProofRow(freshDbRow || {});
  console.info('[activity-date-save-proof:final-db-row]', proofRow);
  try {
    assertSupabaseActivityUpdateApplied('saveActivity', changes, freshDbRow || {});
  } catch (verifyError) {
    const dbVerifyError = new Error('activity_date_db_verify_failed');
    dbVerifyError.code = 'activity_date_db_verify_failed';
    dbVerifyError.cause = verifyError;
    // eslint-disable-next-line no-console
    console.error('[activity-save-error]', { operation: 'saveActivity', table: 'activities', payload: debugPayload, returned_row: data, final_db_row: proofRow, error: dbVerifyError });
    throw dbVerifyError;
  }
  const normalized = normalizeActivityRow({ ...(data || {}), ...(freshDbRow || {}) });
  if (hasMeetingNotes) {
    await upsertMeetingNotesToSupabase(rowId, meetingNotes);
  }
  invalidateAllActivitiesRowsCache();
  logActivityMutationDebug('success', 'saveActivity', debugPayload, { table: 'activities', returned_row_id: normalized.row_id });
  return { ok: true, RowID: rowId, row_id: rowId, source_sheet: 'activities', row: normalized };
}

async function readActivityDetailFromSupabase(source_row_id, source_sheet) {
  void source_sheet;
  const rowId = String(source_row_id || '').trim();
  const { data, error } = await supabase.from('activities').select('*').eq('row_id', rowId).single();
  if (error) throw new Error(error.message || 'detail_failed');
  const normalized = normalizeActivityRow(data || {});
  const contactRows = await readContactsForSchool2027Activities([normalized]);
  const resolved = withResolvedSchool2027Contact(normalized, contactRows);
  return { row: { ...resolved, private_note: resolved.operations_private_notes || '' } };
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
  const notesMap = {};
  try {
    const { data: meetingNoteRows } = await supabase
      .from('activity_meetings')
      .select('meeting_no,notes')
      .eq('source_row_id', rowId);
    if (Array.isArray(meetingNoteRows)) {
      meetingNoteRows.forEach((m) => {
        const idx = Number(m.meeting_no) - 1;
        if (Number.isFinite(idx) && idx >= 0 && m.notes) notesMap[idx] = String(m.notes);
      });
    }
  } catch (_) { /* notes are optional — do not fail dates load */ }
  const meeting_schedule = meeting_dates.map((d, i) => ({ date: d, performed: 'no', note: notesMap[i] || '' }));
  return {
    meeting_dates,
    date_cols: meeting_dates,
    meeting_schedule,
    rows: meeting_dates.map((dateKey, index) => ({ source_row_id: rowId, meeting_no: String(index + 1), meeting_date: dateKey })),
    source_row_id: rowId,
    source_sheet: 'activities'
  };
}


async function readSchoolContactResponsiblesRows() {
  const { data, error } = await supabase.from('activity_school_contact_responsibles').select('*');
  if (error) return [];
  return Array.isArray(data) ? data : [];
}
async function readInstructorSchedulePrintContactsRows() {
  // Dedicated source for Summer 2026 workshop print/schedule contact details.
  const { data, error } = await supabase
    .from('instructor_schedule_print_contacts')
    .select(INSTRUCTOR_SCHEDULE_PRINT_CONTACTS_SELECT)
    .eq('active', true);
  if (error) return [];
  return Array.isArray(data) ? data : [];
}

// Single source of truth for "who confirms the activity with the school" (אחראי קשר):
// grouping, fallback and override resolution all live in screens/shared/contact-responsible.js
// and are shared verbatim with operations-management.js's admin screen and printed schedule.
// `allRows` (the FULL activities dataset) decides who the responsible is; `ownRows` only
// decides which of those groups this instructor gets to see.
function buildInstructorTeamGroups(allRows, ownRows, overrides = []) {
  const index = buildContactResponsibleIndex(allRows, overrides);
  const visibleKeys = new Set();
  (Array.isArray(ownRows) ? ownRows : []).forEach((row) => {
    const group = findContactResponsibleGroup(row, index);
    if (group) visibleKeys.add(group.key);
  });
  return contactResponsibleGroupsArray(index)
    .filter((group) => visibleKeys.has(group.key))
    .map((group) => ({
      key: group.key,
      activity_date: group.date,
      school_id: group.schoolId,
      school: group.school,
      schoolAliases: group.schoolAliases,
      instructors: group.instructors,
      responsibleEmpId: group.responsibleEmpId,
      responsibleName: group.responsibleName,
      responsibleSource: group.responsibleSource
    }));
}

let _allActivitiesRowsCache = null;
let _allActivitiesRowsCacheAt = 0;
const _ALL_ACTIVITIES_ROWS_CACHE_TTL_MS = 2 * 60 * 1000; // 2 דקות

async function readAllActivitiesRowsSupabase({ forceRefresh = false } = {}) {
  const now = Date.now();
  if (!forceRefresh && _allActivitiesRowsCache && (now - _allActivitiesRowsCacheAt) < _ALL_ACTIVITIES_ROWS_CACHE_TTL_MS) {
    return _allActivitiesRowsCache;
  }
  const rows = await selectActivitiesFromSupabase('*');
  _allActivitiesRowsCache = rows;
  _allActivitiesRowsCacheAt = Date.now();
  return rows;
}

export function invalidateAllActivitiesRowsCache() {
  _allActivitiesRowsCache = null;
  _allActivitiesRowsCacheAt = 0;
}


function completionApprovalUploadAllowedFile(file) {
  const name = String(file?.name || '').toLowerCase();
  const type = String(file?.type || '').toLowerCase();
  return ['application/pdf', 'image/jpeg', 'image/png'].includes(type) || /\.(pdf|jpe?g|png)$/.test(name);
}

function completionApprovalUploadPath({ approval, file, instructorEmpId }) {
  const userId = String(instructorEmpId || 'u').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'u';
  const rowId = String((Array.isArray(approval?.activities) ? approval.activities : []).map((a) => a?.rowId).filter(Boolean)[0] || '').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const date = String(approval?.date || '').slice(0, 10).replace(/[^0-9]/g, '') || 'nd';
  const segment = rowId ? `row-${rowId}` : `d-${date}`;
  const ext = (String(file?.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 5);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${userId}/${segment}/${ts}-${rand}.${ext}`;
}

function photoApprovalUploadPath({ instructorEmpId, school, file }) {
  const userId = String(instructorEmpId || 'u').replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'u';
  const schoolKey = String(school || 'school').replace(/[^a-zA-Z0-9\u0590-\u05FF]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'school';
  const ext = (String(file?.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 5);
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${userId}/${schoolKey}/${ts}-${rand}.${ext}`;
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
  if (settingsRowsCache) return settingsRowsCache;
  if (settingsRowsPromise) return settingsRowsPromise;
  settingsRowsPromise = (async () => {
  const { data, error } = await supabase
    .from('settings')
    .select(SETTINGS_BOOTSTRAP_COLUMNS)
    .order('key', { ascending: true });
  if (error) throw new Error(error.message || 'settings_read_failed');
  const rows = Array.isArray(data) ? data : [];
  settingsRowsCache = rows.map((r) => ({
    key: String(r?.key || ''),
    value: String(r?.value || ''),
    description: String(r?.description || '')
  }));
  settingsRowsPromise = null;
  return settingsRowsCache;
  })().catch((error) => { settingsRowsPromise = null; throw error; });
  return settingsRowsPromise;
}



async function readCatalogProgramsFromSupabase() {
  if (!supabase) throw new Error('no_supabase_client');
  const [listsRes, detailsRes, pricingRes, syllabusRes] = await Promise.all([
    supabase
      .from('lists')
      .select('list_id,activity_no,activity_name,label_he,label,type,activity_type,audience_level,target_grades,gefen_number,sort_order,category,active')
      .eq('category', 'activity_names')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('catalog_program_details')
      .select('list_id,activity_no,gefen_number,catalog_title,catalog_subtitle,opening_line,domain,target_grades,grades,audience_level,catalog_section,scope,session_duration,item_type,core_idea,short_description,goals,program_flow,participants_receive,student_develops,school_value,final_outcome,is_active_for_catalog')
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
    const listId = numericListIdOrNull(details.list_id ?? row.list_id);
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
      list_id: listId,
      listId,
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
    const [{ userRow: user, profileRow }, listsData, settingsRows, instructorContactsRows] = await Promise.all([
      loginWithSupabaseAuth(user_id, entry_code),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => []),
      readInstructorContactsRowsForBootstrap().catch(() => [])
    ]);
    const token = makeSessionToken(user);
    const flat = flattenUserRow(user);
    const hasPersonalReportsAccess =
      profileCanAccessPersonalReports(profileRow) ||
      userCanAccessPersonalReportsFromPermissions(flat);
    const proposalFlags = proposalSessionUserFlagsFromFlatUser(flat);
    return {
      token,
      user: {
        user_id: flat.user_id,
        username: flat.username_display,
        username_display: flat.username_display,
        username_for_login: flat.username_for_login,
        email: String(flat.email || user.email || '').trim(),
        auth_email: String(flat.auth_email || '').trim(),
        role: flat.role,
        display_role: flat.role,
        display_role_label: flat.display_role_label,
        display_role2: flat.display_role2,
        full_name: flat.full_name,
        emp_id: flat.emp_id,
        auth_user_id: flat.auth_user_id,
        personal_reports_user_id: flat.auth_user_id,
        can_add_activity: canAddActivitiesUser(flat),
        can_edit_direct: canDirectManageActivitiesUser(flat),
        can_request_edit: canSubmitActivityRequestsUser(flat),
        can_review_requests: canReviewEditRequestsUser(flat),
        finance_access: (flat.role === 'finance' || permissionFlagYes(flat.finance_access) || permissionFlagYes(flat.view_finance)),
        profile_is_active: profileRow?.is_active !== false,
        can_access_personal_reports: hasPersonalReportsAccess,
        personal_reports_manager: permissionFlagYes(flat.personal_reports_manager) ? 'yes' : 'no',
        ...proposalFlags
      },
      ...buildBootstrapFromUser(user, profileRow),
      client_settings: buildClientSettingsFromLists(listsData, settingsRows, instructorContactsRows)
    };
  },
  bootstrap: async () => {
    await waitForSupabaseAuthSession();
    const [{ userRow: user, profileRow }, listsData, settingsRows, instructorContactsRows] = await Promise.all([
      readCurrentUserBySession(),
      readListsFromSupabase().catch(() => null),
      readSettingsRowsFromSupabase().catch(() => []),
      readInstructorContactsRowsForBootstrap().catch(() => [])
    ]);
    return {
      ...buildBootstrapFromUser(user, profileRow),
      client_settings: buildClientSettingsFromLists(listsData, settingsRows, instructorContactsRows)
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
    throw new Error('archive_supabase_failed');
  },
  allActivities: async (params = {}) => {
    const rows = await readAllActivitiesRowsSupabase();
    return { rows: params?.include_all_periods ? rows : filterRowsByGlobalActivityPeriod(rows, params?.activity_period || currentGlobalActivityPeriod()), _source: 'supabase' };
  },
  activities: async (filters, options) => {
    const resolvedFilters = filters || {};
    const supabaseData = await readActivitiesFromSupabase(resolvedFilters);
    if (supabaseData) return normalizeData(supabaseData);
    throw new Error('activities_supabase_failed');
  },
  activityLayoutStatuses: async (payload = {}) => {
    const role = String(state?.user?.role || '').trim();
    if (!ACTIVITY_DIRECT_MANAGE_ROLES.has(role)) throw new Error('activity_layout_forbidden');
    const season = String(payload?.season || 'summer_2026').trim() || 'summer_2026';
    const { data, error } = await supabase
      .from('activity_layout_statuses')
      .select('season,authority,school,sent,sent_at,sent_by')
      .eq('season', season);
    if (error) throw new Error(error.message || 'activity_layout_statuses_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  saveActivityLayoutStatus: async (payload = {}) => {
    const role = String(state?.user?.role || '').trim();
    if (!ACTIVITY_DIRECT_MANAGE_ROLES.has(role)) throw new Error('activity_layout_forbidden');
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
  contactsForSchool: (schoolId, school, authority) => readContactsForSchoolActivity(schoolId, school, authority),
  createSchoolContact: (params) => createSchoolContactForActivity(params),
  week: async (params) => {
    const resolved = (params && typeof params === 'object') ? params : {};
    const weekOffset = Number.parseInt(resolved.week_offset, 10);
    const offset = Number.isFinite(weekOffset) ? weekOffset : 0;
    const payload = await readWeekFromSupabase(offset);
    return String(state?.user?.role || '') === 'instructor'
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
    return String(state?.user?.role || '') === 'instructor'
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
  contacts: async (params = {}) => {
    const supabaseData = await readContactsFromSupabase(params || {});
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ instructor_rows: [], school_rows: [], can_view_instructors: true, can_view_schools: true }, 'contacts_supabase_failed');
  },
  endDates: () => readEndDatesFromSupabase(),
  getCatalogPrograms: () => readCatalogProgramsFromSupabase(),
  myData: async (params = {}) => {
    const [allRows, contactResponsibles, summerPrintContactRows, contactsSchoolsRows, schoolsRows] = await Promise.all([
      readAllActivitiesRowsSupabase(),
      readSchoolContactResponsiblesRows(),
      readMyDataSummerPrintContactRows(),
      readMyDataContactsSchoolsRows(),
      readSchoolsCatalogFromSupabase()
    ]);
    const idsSet = getInstructorIdentitySet();
    const includeClosedForApprovals = Boolean(params?.includeClosedForApprovals);
    const periodRows = filterRowsByGlobalActivityPeriod(allRows);
    const openRows = includeClosedForApprovals
      ? periodRows.filter((row) => !isActivityDeleted(row) && !isActivityCancelled(row))
      : periodRows.filter((row) => !isActivityClosed(row));
    const summerPrintContactsIndex = buildSummerContactIndex(summerPrintContactRows);
    const contactsIndex = buildContactsSchoolsIndex(contactsSchoolsRows);
    const schoolsIndex = buildSchoolsCatalogContactIndex(schoolsRows);
    const rows = enrichRowsWithSchoolContact(openRows.filter((row) => isInstructorAssignedRow(row, idsSet)), contactsIndex, schoolsIndex, summerPrintContactsIndex);
    return { rows, teamGroups: buildInstructorTeamGroups(openRows, rows, contactResponsibles), summerContacts: summerPrintContactRows, contactRows: summerPrintContactRows, _source: 'supabase' };
  },


  schoolContactResponsibles: async () => {
    const rows = await readSchoolContactResponsiblesRows();
    return { rows, _source: 'supabase' };
  },
  instructorSchedulePrintContacts: async () => {
    const rows = await readInstructorSchedulePrintContactsRows();
    return { rows, _source: 'supabase' };
  },
  saveSchoolContactResponsible: async ({ activityDate, schoolId = '', school = '', responsibleEmpId = '', responsibleName = '' } = {}) => {
    const role = String(state?.user?.role || '').trim();
    if (!['admin', 'operation_manager', 'domain_manager'].includes(role)) throw new Error('school_contact_responsible_forbidden');
    const row = {
      activity_date: String(activityDate || '').slice(0, 10),
      school_id: String(schoolId || '').trim(),
      school: String(school || '').trim(),
      responsible_emp_id: String(responsibleEmpId || '').trim(),
      responsible_name: String(responsibleName || '').trim(),
      updated_by: String(state?.user?.user_id || state?.user?.username || '').trim(),
      updated_at: new Date().toISOString()
    };
    // Match an existing override by school_id OR by normalized school text (whichever
    // side has it), not both at once - a strict AND match let the same school accumulate
    // duplicate override rows whenever one save carried a school_id and another didn't.
    const existingRows = await supabase.from('activity_school_contact_responsibles').select('id, school_id, school').eq('activity_date', row.activity_date);
    if (existingRows.error) throw new Error(existingRows.error.message || 'school_contact_responsible_read_failed');
    const normalizedSchool = normalizeContactMatchText(row.school);
    const existingMatch = (existingRows.data || []).find((candidate) => {
      const candidateId = String(candidate?.school_id || '').trim();
      if (row.school_id && candidateId && candidateId === row.school_id) return true;
      return Boolean(normalizedSchool) && normalizeContactMatchText(candidate?.school) === normalizedSchool;
    });
    const request = existingMatch?.id
      ? supabase.from('activity_school_contact_responsibles').update(row).eq('id', existingMatch.id).select('*').single()
      : supabase.from('activity_school_contact_responsibles').insert(row).select('*').single();
    const { data, error } = await request;
    if (error) throw new Error(error.message || 'school_contact_responsible_save_failed');
    return { row: data, _source: 'supabase' };
  },
  completionApprovalUploads: async () => {
    const role = String(state?.user?.role || '').trim();
    const query = supabase
      .from('activity_completion_approval_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (role === 'instructor') {
      if (!isActiveInstructorPilotUser()) return { rows: [], _source: 'supabase' };
      query.in('instructor_emp_id', currentUserIdentityValues());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'completion_approval_uploads_read_failed');
    const rows = Array.isArray(data) ? data : [];
    const rowsWithStorage = await Promise.all(rows.map(async (row) => {
      const filePath = String(row?.file_path || '').trim();
      if (!filePath) return { ...row, file_ref_exists: false, storage_exists: false, storage_status: 'missing' };
      const signed = await supabase.storage.from('completion-approvals').createSignedUrl(filePath, 30);
      const signedUrlOk = !signed.error && !!signed.data?.signedUrl;
      return {
        ...row,
        file_ref_exists: true,
        storage_exists: signedUrlOk,
        storage_status: signedUrlOk ? 'exists' : 'signed_url_failed',
        storage_access_status: signedUrlOk ? 'ok' : 'failed',
        ...(signed.error ? { storage_error: String(signed.error.message || 'completion_approval_signed_url_failed') } : {})
      };
    }));
    return { rows: rowsWithStorage, _source: 'supabase' };
  },
  completionApprovalSignedUrl: async ({ filePath, download = false } = {}) => {
    const path = String(filePath || '').trim();
    if (!path) throw new Error('missing_file_path');
    const { data, error } = await supabase.storage
      .from('completion-approvals')
      .createSignedUrl(path, 60 * 5, download ? { download: true } : undefined);
    if (error) {
      const message = String(error.message || '').trim();
      if (/object not found/i.test(message)) {
        throw new Error('הקובץ לא נמצא באחסון. יש לבדוק את נתיב הקובץ מול הרשומה.');
      }
      throw new Error(message || 'completion_approval_signed_url_failed');
    }
    return { signedUrl: data?.signedUrl || '' };
  },
  reviewCompletionApprovalUpload: async ({ id, status, reviewNote = '' } = {}) => {
    const role = String(state?.user?.role || '').trim();
    if (!['admin', 'operation_manager', 'domain_manager'].includes(role)) throw new Error('completion_approval_review_forbidden');
    const nextStatus = String(status || '').trim();
    if (!['approved', 'rejected'].includes(nextStatus)) throw new Error('invalid_completion_approval_status');
    const reviewer = String(state?.user?.full_name || state?.user?.username || state?.user?.user_id || '').trim();
    const payload = { status: nextStatus, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), review_note: String(reviewNote || '').trim() };
    const { data, error } = await supabase.from('activity_completion_approval_uploads').update(payload).eq('id', id).select('*').single();
    if (error) throw new Error(error.message || 'completion_approval_review_failed');
    return { row: data, _source: 'supabase' };
  },
  deleteCompletionApprovalUpload: async ({ id } = {}) => {
    const uploadId = String(id || '').trim();
    if (!uploadId) throw new Error('missing_upload_id');
    const existing = await supabase.from('activity_completion_approval_uploads').select('*').eq('id', uploadId).single();
    if (existing.error) throw new Error(existing.error.message || 'completion_approval_upload_read_failed');
    const filePath = String(existing.data?.file_path || '').trim();
    if (filePath) {
      const removed = await supabase.storage.from('completion-approvals').remove([filePath]);
      if (removed.error) throw new Error(removed.error.message || 'completion_approval_storage_delete_failed');
    }
    const { error } = await supabase.from('activity_completion_approval_uploads').delete().eq('id', uploadId);
    if (error) throw new Error(error.message || 'completion_approval_delete_failed');
    return { ok: true, _source: 'supabase' };
  },
  replaceCompletionApprovalUpload: async ({ id, uploadId, file } = {}) => {
    const targetId = String(uploadId || id || '').trim();
    if (!targetId) throw new Error('missing_upload_id');
    if (!completionApprovalUploadAllowedFile(file)) throw new Error('ניתן להעלות PDF, JPG, JPEG או PNG בלבד.');
    const existing = await supabase.from('activity_completion_approval_uploads').select('*').eq('id', targetId).single();
    if (existing.error) throw new Error(existing.error.message || 'completion_approval_upload_read_failed');
    const oldPath = String(existing.data?.file_path || '').trim();
    const approval = {
      date: existing.data?.activity_date,
      activities: String(existing.data?.activity_row_id || '').split(',').filter(Boolean).map((rowId) => ({ rowId }))
    };
    const filePath = completionApprovalUploadPath({ approval, file, instructorEmpId: existing.data?.instructor_emp_id });
    const uploaded = await supabase.storage.from('completion-approvals').upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (uploaded.error) throw new Error(uploaded.error.message || 'completion_approval_storage_upload_failed');
    const patch = {
      file_path: filePath,
      file_name: String(file?.name || '').trim(),
      mime_type: String(file?.type || '').trim(),
      file_size: Number(file?.size || 0),
      uploaded_at: new Date().toISOString(),
      uploaded_by_user_id: String(state?.user?.user_id || state?.user?.auth_user_id || '').trim(),
      status: 'uploaded',
      reviewed_by: null,
      reviewed_at: null,
      review_note: null
    };
    const { data, error } = await supabase.from('activity_completion_approval_uploads').update(patch).eq('id', targetId).select('*').single();
    if (error) throw new Error(error.message || 'completion_approval_replace_record_failed');
    if (oldPath && oldPath !== filePath) {
      const removed = await supabase.storage.from('completion-approvals').remove([oldPath]);
      if (removed.error) console.warn('[completion-approval-replace] failed to delete old file', removed.error);
    }
    return { row: { ...data, storage_exists: true, storage_status: 'exists' }, _source: 'supabase' };
  },
  uploadCompletionApproval: async ({ approval, file, instructorEmpId, instructorName } = {}) => {
    const role = String(state?.user?.role || '').trim();
    const ownEmpIds = currentUserIdentityValues();
    const requestedEmpId = String(instructorEmpId || approval?.instructorEmpId || '').trim();
    const fallbackOwnEmpId = String(state?.user?.emp_id || state?.user?.user_id || '').trim();
    let empId = requestedEmpId || fallbackOwnEmpId;
    if (!empId) throw new Error('חסר מזהה עובד למדריך.');
    if (role === 'instructor') {
      if (!isActiveInstructorPilotUser()) throw new Error('תצוגת מדריך אינה פעילה למשתמש זה.');
      if (!ownEmpIds.includes(empId)) throw new Error('מדריך יכול להעלות אישור ביצוע רק עבור עצמו.');
    } else if (requestedEmpId && !COMPLETION_APPROVAL_MANAGER_ROLES.has(role)) {
      throw new Error('אין הרשאה להעלות אישור ביצוע עבור מדריך אחר.');
    }
    if (!completionApprovalUploadAllowedFile(file)) throw new Error('ניתן להעלות PDF, JPG, JPEG או PNG בלבד.');
    const filePath = completionApprovalUploadPath({ approval, file, instructorEmpId: empId });
    const upload = await supabase.storage.from('completion-approvals').upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (upload.error) throw new Error(upload.error.message || 'completion_approval_storage_upload_failed');
    const row = {
      activity_row_id: String((approval?.activities || []).map((a) => a.rowId).filter(Boolean).join(',') || approval?.id || ''),
      activity_date: approval?.date || null,
      instructor_emp_id: empId,
      instructor_name: String(instructorName || approval?.instructorName || '').trim(),
      authority: String(approval?.authority || '').trim(),
      school: String(approval?.school || '').trim(),
      file_path: filePath,
      file_name: String(file?.name || '').trim(),
      mime_type: String(file?.type || '').trim(),
      file_size: Number(file?.size || 0),
      uploaded_by_user_id: String(state?.user?.user_id || state?.user?.auth_user_id || '').trim(),
      status: 'uploaded'
    };
    const { data, error } = await supabase.from('activity_completion_approval_uploads').insert(row).select('*').single();
    if (error) throw new Error(error.message || 'completion_approval_upload_record_failed');
    return { row: data, _source: 'supabase' };
  },
  photoApprovalUploads: async () => {
    const role = String(state?.user?.role || '').trim();
    const query = supabase
      .from('photo_approval_uploads')
      .select('*')
      .order('uploaded_at', { ascending: false });
    if (role === 'instructor') {
      if (!isActiveInstructorPilotUser()) return { rows: [], _source: 'supabase' };
      query.in('instructor_emp_id', currentUserIdentityValues());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'photo_approval_uploads_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  photoApprovalSignedUrl: async ({ filePath } = {}) => {
    const path = String(filePath || '').trim();
    if (!path) throw new Error('missing_file_path');
    const { data, error } = await supabase.storage
      .from('photo-approvals')
      .createSignedUrl(path, 60 * 5);
    if (error) throw new Error(error.message || 'photo_approval_signed_url_failed');
    return { signedUrl: data?.signedUrl || '' };
  },
  uploadPhotoApproval: async ({ instructorEmpId, instructorName, school, authority, schoolId, file } = {}) => {
    const role = String(state?.user?.role || '').trim();
    const ownEmpIds = currentUserIdentityValues();
    const empId = String(instructorEmpId || '').trim();
    if (!empId) throw new Error('חסר מזהה עובד למדריך.');
    if (role === 'instructor') {
      if (!isActiveInstructorPilotUser()) throw new Error('תצוגת מדריך אינה פעילה למשתמש זה.');
      if (!ownEmpIds.includes(empId)) throw new Error('מדריך יכול להעלות אישור צילום רק עבור עצמו.');
    } else if (!COMPLETION_APPROVAL_MANAGER_ROLES.has(role)) {
      throw new Error('אין הרשאה להעלות אישור צילום.');
    }
    if (!completionApprovalUploadAllowedFile(file)) throw new Error('ניתן להעלות PDF, JPG, JPEG או PNG בלבד.');
    const schoolVal = String(school || '').trim();
    if (!schoolVal) throw new Error('חסר שם בית ספר לאישור הצילום.');
    const filePath = photoApprovalUploadPath({ instructorEmpId: empId, school: schoolVal, file });
    const upload = await supabase.storage.from('photo-approvals').upload(filePath, file, { contentType: file.type || undefined, upsert: false });
    if (upload.error) throw new Error(upload.error.message || 'photo_approval_storage_upload_failed');
    const row = {
      instructor_emp_id: empId,
      instructor_name: String(instructorName || '').trim(),
      school_id: String(schoolId || '').trim(),
      authority: String(authority || '').trim(),
      school: schoolVal,
      file_path: filePath,
      mime_type: String(file?.type || '').trim(),
      file_size: Number(file?.size || 0),
      uploaded_by_user_id: String(state?.user?.user_id || state?.user?.auth_user_id || '').trim(),
      status: 'uploaded'
    };
    const { data, error } = await supabase.from('photo_approval_uploads').insert(row).select('*').single();
    if (error) {
      await supabase.storage.from('photo-approvals').remove([filePath]).catch(() => {});
      throw new Error(error.message || 'photo_approval_upload_record_failed');
    }
    return { row: data, _source: 'supabase' };
  },
  replacePhotoApproval: async ({ id, file } = {}) => {
    const uploadId = String(id || '').trim();
    if (!uploadId) throw new Error('missing_photo_approval_id');
    if (!completionApprovalUploadAllowedFile(file)) throw new Error('ניתן להעלות PDF, JPG, JPEG או PNG בלבד.');
    const existing = await supabase.from('photo_approval_uploads').select('*').eq('id', uploadId).single();
    if (existing.error || !existing.data) throw new Error('photo_approval_not_found');
    const role = String(state?.user?.role || '').trim();
    const ownEmpIds = currentUserIdentityValues();
    if (role === 'instructor' && !ownEmpIds.includes(String(existing.data?.instructor_emp_id || ''))) {
      throw new Error('אין הרשאה להחליף אישור צילום של מדריך אחר.');
    }
    const oldPath = String(existing.data?.file_path || '').trim();
    const newPath = photoApprovalUploadPath({ instructorEmpId: existing.data?.instructor_emp_id, school: existing.data?.school, file });
    const upload = await supabase.storage.from('photo-approvals').upload(newPath, file, { contentType: file.type || undefined, upsert: false });
    if (upload.error) throw new Error(upload.error.message || 'photo_approval_storage_replace_failed');
    const { data, error } = await supabase.from('photo_approval_uploads').update({
      file_path: newPath,
      mime_type: String(file?.type || '').trim(),
      file_size: Number(file?.size || 0),
      uploaded_at: new Date().toISOString(),
      status: 'uploaded'
    }).eq('id', uploadId).select('*').single();
    if (error) {
      await supabase.storage.from('photo-approvals').remove([newPath]).catch(() => {});
      throw new Error(error.message || 'photo_approval_replace_record_failed');
    }
    if (oldPath) await supabase.storage.from('photo-approvals').remove([oldPath]).catch(() => {});
    return { row: data, _source: 'supabase' };
  },
  operations: async (params = {}) => {
    const allRows = await readAllActivitiesRowsSupabase();
    const periodRows = filterRowsByGlobalActivityPeriod(allRows, params?.activity_period || currentGlobalActivityPeriod());
    const rows = filterOperationsRows(periodRows, params || {});
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
    clearBootstrapReadCaches();
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
      clearBootstrapReadCaches();
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

  workshopStockDistributions: async () => {
    const { data, error } = await supabase
      .from('workshop_stock_distributions')
      .select('*');
    if (error) throw new Error(error.message || 'workshop_stock_distributions_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  updateWorkshopStockItems: updateWorkshopStockItemsInSupabase,
  addProposalAgreement: async (payload) => {
    assertCanManageProposalsAgreementsApi();
    const groupLookup = await getProposalGroupLookup();
    const catalog = await readAuthoritySchoolCatalog();
    const resolvedSchool = await resolveProposalSchoolCatalogIds(payload, catalog);
    const enrichedPayload = {
      ...payload,
      ...resolvedSchool,
      client_type: cleanProposalAgreementText(payload.client_type) || (resolvedSchool.school_id ? 'school' : 'authority')
    };
    const insert = sanitizeProposalAgreementPayload(enrichedPayload, groupLookup);
    if (cleanProposalAgreementText(enrichedPayload.contact_name) && cleanProposalAgreementText(enrichedPayload.client_authority)) {
      insert.contact_school_id = await ensureValidProposalContactSchoolId({ ...enrichedPayload, ...insert, _contact_original: enrichedPayload?._contact_original });
    }
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
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements').select('status').eq('id', rowId).single();
    if (!currentRowError && currentRow) {
      const cs = cleanProposalAgreementText(currentRow.status);
      if (cs === 'sent') throw new Error('הצעה שנשלחה נעולה ולא ניתן לערוך אותה.');
    }
    const groupLookup = await getProposalGroupLookup();
    const catalog = await readAuthoritySchoolCatalog();
    const resolvedSchool = await resolveProposalSchoolCatalogIds(payload, catalog);
    const enrichedPayload = {
      ...payload,
      ...resolvedSchool,
      client_type: cleanProposalAgreementText(payload.client_type) || (resolvedSchool.school_id ? 'school' : 'authority')
    };
    const patch = sanitizeProposalAgreementPayload(enrichedPayload, groupLookup);
    patch.updated_at = new Date().toISOString();
    if (cleanProposalAgreementText(enrichedPayload.contact_name) && cleanProposalAgreementText(enrichedPayload.client_authority)) {
      patch.contact_school_id = await ensureValidProposalContactSchoolId({ ...enrichedPayload, ...patch, _contact_original: enrichedPayload?._contact_original });
    }
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
    const { data: current, error: fetchError } = await supabase
      .from('proposals_agreements')
      .select('status')
      .eq('id', rowId)
      .single();
    if (fetchError || !current) throw new Error('proposals_agreement_not_found');
    if (!['draft', 'cancelled'].includes(normalizeProposalAgreementStatusForDb(current.status))) {
      throw new Error('ניתן למחוק רק הצעה בטיוטה או הצעה שבוטלה');
    }
    const { error } = await supabase
      .from('proposals_agreements')
      .delete()
      .eq('id', rowId);
    if (error) throw new Error(error.message || 'proposals_agreement_delete_failed');
    return { ok: true, id: rowId };
  },
  updateProposalAgreementStatus: async (id, status, approvalNote = '', signatureMeta = null) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    const cleanStatus = cleanProposalAgreementText(status);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    if (!PA_VALID_STATUSES_SET.has(cleanStatus)) throw new Error('invalid_proposal_agreement_status');
    if (cleanStatus === 'approved' && !canApproveProposalsAgreementsApi()) throw new Error('proposals_agreements_approval_forbidden');
    if (cleanStatus === 'approved' && !(signatureMeta && typeof signatureMeta === 'object' && !Array.isArray(signatureMeta) && Object.keys(signatureMeta).length)) throw new Error('נדרשת חתימה לפני אישור ההצעה.');
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements').select('status,signature_meta,approved_by,approved_at').eq('id', rowId).single();
    if (currentRowError || !currentRow) throw new Error('proposals_agreement_not_found');
    canTransitionProposalAgreementStatus(currentRow, cleanStatus);
    const patch = { status: statusForDb(cleanStatus), approval_note: cleanProposalAgreementText(approvalNote), updated_at: new Date().toISOString() };
    if (cleanStatus === 'approved') {
      patch.status = 'approved';
      let approvedByUuid = uuidOrNull(state?.user?.auth_user_id);
      if (!approvedByUuid && supabase) {
        try {
          const { data: authData } = await supabase.auth.getUser();
          approvedByUuid = uuidOrNull(authData?.user?.id);
        } catch {
          /* ignore — approved_by is an audit field, not a gate on approval */
        }
      }
      if (approvedByUuid) patch.approved_by = approvedByUuid;
      patch.approved_at = new Date().toISOString();
      patch.signature_meta = (signatureMeta && typeof signatureMeta === 'object' && !Array.isArray(signatureMeta)) ? signatureMeta : {};
    }
    if (cleanStatus === 'sent') {
      throw new Error('שליחת הצעה דורשת נעילת מסמך והעלאת PDF סופי. השתמשו בפעולת "סימון כנשלח".');
    }
    if (cleanStatus === 'draft') {
      patch.signature_meta = {};
      patch.approved_by = null;
      patch.approved_at = null;
      patch.approval_note = '';
    }
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_status_update_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  lockAndSendProposalAgreement: async (id, payload = {}) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const pdfFile = payload?.pdfFile || payload?.file || null;
    const documentSnapshot = payload?.documentSnapshot ?? payload?.document_snapshot ?? null;
    const documentHtmlSnapshot = cleanProposalAgreementText(payload?.documentHtmlSnapshot ?? payload?.document_html_snapshot);
    if (!documentSnapshot || typeof documentSnapshot !== 'object' || Array.isArray(documentSnapshot)) {
      throw new Error('חסר snapshot מסמך לנעילה.');
    }
    if (!documentHtmlSnapshot) throw new Error('חסר HTML snapshot לנעילה.');
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements')
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .eq('id', rowId)
      .single();
    if (currentRowError) {
      console.error('[proposals_agreements] lockAndSendProposalAgreement fetch failed', {
        code: currentRowError.code,
        message: currentRowError.message,
        details: currentRowError.details,
        hint: currentRowError.hint
      });
      throw new Error('proposals_agreement_not_found');
    }
    if (!currentRow) throw new Error('proposals_agreement_not_found');
    const currentStatus = normalizeProposalAgreementStatusForDb(currentRow.status || 'draft');
    if (currentStatus === 'sent') throw new Error('הצעה שנשלחה נעולה ולא ניתן לשנות את סטטוסה.');
    const existingFinalPdfPath = cleanProposalAgreementText(currentRow.final_pdf_path);
    if (currentStatus !== 'approved' || !hasProposalAgreementSignature(currentRow) || !cleanProposalAgreementText(currentRow.approved_at)) {
      throw new Error('ניתן לסמן כנשלח רק הצעה מאושרת וחתומה.');
    }
    if (!existingFinalPdfPath && !proposalFinalPdfAllowedFile(pdfFile)) {
      throw new Error('יש להעלות קובץ PDF סופי לפני שליחת ההצעה.');
    }
    const nowIso = new Date().toISOString();
    const actorName = proposalLockActorName();
    const patch = {
      status: 'sent',
      sent_by: actorName,
      sent_at: nowIso,
      locked_at: nowIso,
      locked_by: actorName,
      locked_reason: 'sent',
      document_snapshot: documentSnapshot,
      document_html_snapshot: documentHtmlSnapshot,
      updated_at: nowIso
    };
    if (!existingFinalPdfPath) {
      const filePath = proposalFinalPdfStoragePath(rowId, pdfFile?.name);
      const uploaded = await supabase.storage
        .from(PROPOSAL_FINAL_PDF_BUCKET)
        .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: false });
      if (uploaded.error) throw new Error(uploaded.error.message || 'proposal_final_pdf_upload_failed');
      patch.final_pdf_path = filePath;
      patch.final_pdf_file_name = String(pdfFile?.name || 'proposal.pdf').trim();
      patch.final_pdf_created_at = nowIso;
      patch.final_pdf_created_by = actorName;
    }
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposal_lock_and_send_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  uploadProposalFinalPdf: async (id, payload = {}) => {
    const rowId = cleanProposalAgreementText(id);
    let pdfStage = 'start';
    try {
      assertCanManageProposalsAgreementsApi();
      const pdfFile = payload?.pdfFile || payload?.file || null;
      const documentSnapshot = payload?.documentSnapshot ?? payload?.document_snapshot ?? null;
      const documentHtmlSnapshot = cleanProposalAgreementText(payload?.documentHtmlSnapshot ?? payload?.document_html_snapshot);
      if (!rowId) throw new Error('missing_proposal_agreement_id');
      if (!proposalFinalPdfAllowedFile(pdfFile)) throw new Error('invalid_proposal_final_pdf');
      if (!documentSnapshot || typeof documentSnapshot !== 'object' || Array.isArray(documentSnapshot)) throw new Error('missing_document_snapshot');
      if (!documentHtmlSnapshot) throw new Error('missing_document_html_snapshot');
      const { data: currentRow, error: currentRowError } = await supabase.from('proposals_agreements').select(PROPOSALS_AGREEMENTS_COLUMNS).eq('id', rowId).single();
      if (currentRowError || !currentRow) throw new Error('proposals_agreement_not_found');
      const isHistoricalSnapshotBackfill = normalizeProposalAgreementStatusForDb(currentRow.status) === 'sent'
        && !cleanProposalAgreementText(currentRow.final_pdf_path)
        && Boolean(cleanProposalAgreementText(currentRow.document_html_snapshot) || currentRow.document_snapshot);
      if (!isHistoricalSnapshotBackfill && (normalizeProposalAgreementStatusForDb(currentRow.status) === 'sent' || cleanProposalAgreementText(currentRow.locked_at))) throw new Error('proposal_is_locked');
      const filePath = proposalFinalPdfStoragePath(rowId, pdfFile.name);
      pdfStage = 'storage-upload';
      const uploaded = await supabase.storage.from(PROPOSAL_FINAL_PDF_BUCKET).upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: false });
      if (uploaded.error) throw new Error(uploaded.error.message || 'proposal_final_pdf_upload_failed');
      const nowIso = new Date().toISOString();
      const patch = {
        final_pdf_path: filePath, final_pdf_file_name: String(pdfFile.name || 'proposal.pdf').trim(),
        final_pdf_created_at: nowIso, final_pdf_created_by: proposalLockActorName(),
        document_snapshot: documentSnapshot, document_html_snapshot: documentHtmlSnapshot, updated_at: nowIso
      };
      pdfStage = 'proposal-row-update';
      const { data, error } = await supabase.from('proposals_agreements').update(patch).eq('id', rowId).select(PROPOSALS_AGREEMENTS_COLUMNS).single();
      if (error) throw new Error(error.message || 'proposal_final_pdf_save_failed');
      return { ok: true, row: normalizeProposalAgreementRow(data) };
    } catch (error) {
      console.error('[proposal-pdf-failed]', { stage: pdfStage, proposalId: rowId, name: error?.name, message: error?.message, stack: error?.stack, error });
      throw error;
    }
  },
  getProposalFinalPdfSignedUrl: async (id) => {
    assertCanUseProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements')
      .select('final_pdf_path,final_pdf_file_name,status')
      .eq('id', rowId)
      .single();
    if (currentRowError || !currentRow) throw new Error('proposals_agreement_not_found');
    const filePath = cleanProposalAgreementText(currentRow.final_pdf_path);
    if (!filePath) throw new Error('proposal_final_pdf_missing');
    const { data, error } = await supabase.storage
      .from(PROPOSAL_FINAL_PDF_BUCKET)
      .createSignedUrl(filePath, 60 * 5, { download: false });
    if (error) throw new Error(error.message || 'proposal_final_pdf_signed_url_failed');
    return {
      signedUrl: data?.signedUrl || '',
      fileName: cleanProposalAgreementText(currentRow.final_pdf_file_name) || 'proposal.pdf'
    };
  },
  readProposalAgreementItems: async (proposalId) => {
    assertCanUseProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) return [];
    const groupLookup = await getProposalGroupLookup();
    const { data, error } = await supabase
      .from('proposal_agreement_items')
      .select('id,proposal_agreement_id,item_name,item_type,gefen_number,meetings_count,hours_count,quantity,unit_price,total_price,description,course_note,hourly_price,source_pricing_key,proposal_display_mode,selected_bundle_items,activity_no,unit_duration,proposal_group,sort_order')
      .eq('proposal_agreement_id', rowId)
      .order('sort_order', { ascending: true });
    if (error) throwProposalLoadError('agreementItemsError', 'proposal_agreement_items', error);
    return (Array.isArray(data) ? data : []).map((item) => {
      let selectedBundleItems = [];
      try { const parsed = Array.isArray(item.selected_bundle_items ?? item.selectedBundleItems) ? (item.selected_bundle_items ?? item.selectedBundleItems) : JSON.parse(item.selected_bundle_items ?? item.selectedBundleItems ?? '[]'); selectedBundleItems = Array.isArray(parsed) ? parsed : []; } catch { selectedBundleItems = []; }
      const proposalAgreementId = cleanProposalAgreementText(item.proposal_agreement_id ?? item.proposalAgreementId ?? rowId);
      const activityNo = cleanProposalAgreementText(item.activity_no ?? item.activityNo);
      const itemName = cleanProposalAgreementText(item.item_name ?? item.itemName);
      const itemType = cleanProposalAgreementText(item.item_type ?? item.itemType);
      const gefenNumber = cleanProposalAgreementText(item.gefen_number ?? item.gefenNumber);
      const meetingsCount = item.meetings_count != null ? Number(item.meetings_count) : (item.meetingsCount != null ? Number(item.meetingsCount) : null);
      const hoursCount = item.hours_count != null ? Number(item.hours_count) : (item.hoursCount != null ? Number(item.hoursCount) : null);
      const quantity = item.quantity != null ? Number(item.quantity) || 1 : 1;
      const unitPrice = item.unit_price != null ? Number(item.unit_price) : (item.unitPrice != null ? Number(item.unitPrice) : null);
      const hourlyPrice = item.hourly_price != null ? Number(item.hourly_price) : (item.hourlyPrice != null ? Number(item.hourlyPrice) : null);
      const totalPrice = item.total_price != null ? Number(item.total_price) : (item.totalPrice != null ? Number(item.totalPrice) : null);
      const description = cleanProposalAgreementText(item.description);
      const courseNote = cleanProposalAgreementText(item.course_note ?? item.courseNote ?? item.manual_note ?? item.manualNote);
      const unitDuration = cleanProposalAgreementText(item.unit_duration ?? item.unitDuration);
      const proposalGroup = normalizeProposalGroupValue(item.proposal_group ?? item.proposalGroup, groupLookup);
      const sortOrder = Number(item.sort_order ?? item.sortOrder) || 0;
      const proposalDisplayMode = cleanProposalAgreementText(item.proposal_display_mode ?? item.proposalDisplayMode) || 'single';
      const sourcePricingKey = cleanProposalAgreementText(item.source_pricing_key ?? item.sourcePricingKey);
      return {
        id:                    cleanProposalAgreementText(item.id),
        proposalAgreementId,
        activityNo,
        itemName,
        itemType,
        gefenNumber,
        meetingsCount,
        hoursCount,
        unitDuration,
        unitPrice,
        hourlyPrice,
        totalPrice,
        courseNote,
        manualNote: courseNote,
        proposalGroup,
        sortOrder,
        proposalDisplayMode,
        sourcePricingKey,
        selectedBundleItems,
        proposal_agreement_id: proposalAgreementId,
        activity_no:           activityNo,
        pricing_activity_no:   activityNo,
        item_name:             itemName,
        item_type:             itemType,
        gefen_number:          gefenNumber,
        meetings_count:        meetingsCount,
        hours_count:           hoursCount,
        quantity,
        unit_price:            unitPrice,
        hourly_price:          hourlyPrice,
        total_price:           totalPrice,
        description,
        course_note:           courseNote,
        manual_note:           courseNote,
        unit_duration:         unitDuration,
        proposal_group:        proposalGroup,
        group_key:             proposalGroup,
        sort_order:            sortOrder,
        proposal_display_mode: proposalDisplayMode,
        source_pricing_key:    sourcePricingKey,
        pricing_key:           sourcePricingKey,
        selected_bundle_items: selectedBundleItems
      };
    });
  },
  readProposalActivityPricing: async () => {
    assertCanUseProposalsAgreementsApi();
    const groupLookup = await getProposalGroupLookup();
    return enrichProposalPricingRows(await readProposalActivityPricingFromSupabase(), groupLookup);
  },
  readProposalActivityGroups: async () => {
    assertCanUseProposalsAgreementsApi();
    return readProposalActivityGroupsFromSupabase();
  },
  readProposalGroupAliases: async () => {
    assertCanUseProposalsAgreementsApi();
    return readProposalGroupAliasesFromSupabase();
  },
  readProposalTemplateSections: async () => {
    assertCanUseProposalsAgreementsApi();
    return readProposalTemplateSectionsFromSupabase();
  },

  saveProposalAgreementCustomDocumentSections: async (proposalId, sections) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements').select('status').eq('id', rowId).single();
    if (!currentRowError && currentRow) {
      const cs = cleanProposalAgreementText(currentRow.status);
      if (cs === 'sent') throw new Error('הצעה שנשלחה נעולה ולא ניתן לערוך אותה.');
    }
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
    const { data: currentRow, error: currentRowError } = await supabase
      .from('proposals_agreements').select('status').eq('id', rowId).single();
    if (!currentRowError && currentRow) {
      const cs = cleanProposalAgreementText(currentRow.status);
      if (cs === 'sent') throw new Error('הצעה שנשלחה נעולה ולא ניתן לערוך את פריטיה.');
    }
    const groupLookup = await getProposalGroupLookup();
    const hasMeaningfulProposalItemValue = (item = {}) => Boolean(
      cleanProposalAgreementText(item.item_name ?? item.itemName) ||
      cleanProposalAgreementText(item.source_pricing_key ?? item.sourcePricingKey) ||
      cleanProposalAgreementText(item.pricing_key ?? item.pricingKey) ||
      cleanProposalAgreementText(item.activity_no ?? item.activityNo) ||
      cleanProposalAgreementText(item.proposal_group ?? item.proposalGroup ?? item.group_key ?? item.groupKey) ||
      Number(item.quantity) || Number(item.unit_price ?? item.unitPrice) || Number(item.total_price ?? item.totalPrice)
    );
    const validItems = (Array.isArray(items) ? items : [])
      .filter((i) => hasMeaningfulProposalItemValue(i) && !isProposalTestHoursItem(i))
      .map((item, idx) => {
        let selectedBundleItems = [];
        try { const parsed = Array.isArray(item.selected_bundle_items ?? item.selectedBundleItems) ? (item.selected_bundle_items ?? item.selectedBundleItems) : JSON.parse(item.selected_bundle_items ?? item.selectedBundleItems ?? '[]'); selectedBundleItems = Array.isArray(parsed) ? parsed : []; } catch { selectedBundleItems = []; }
        const rawListId = item.list_id ?? item.listId;
        const safeListId = numericListIdOrNull(rawListId);
        const itemName = cleanProposalAgreementText(item.item_name ?? item.itemName);
        const proposalGroup = normalizeProposalGroupValue(
          item.proposal_group ?? item.proposalGroup ?? item.group_key ?? item.groupKey,
          groupLookup
        );
        const rawItemType = cleanProposalAgreementText(item.item_type ?? item.itemType);
        const safeItemType =
          rawItemType
          || (/(סיור|tour)/i.test(`${proposalGroup} ${itemName}`) ? 'סיור' : '')
          || 'פעילות';
        const row = withSafeNumericListId({
          proposal_agreement_id: rowId,
          activity_no:           cleanProposalAgreementText(item.activity_no ?? item.activityNo ?? item.pricing_activity_no ?? item.pricingActivityNo),
          item_name:             itemName,
          item_type:             safeItemType,
          gefen_number:          cleanProposalAgreementText(item.gefen_number ?? item.gefenNumber),
          meetings_count:        item.meetings_count != null ? Number(item.meetings_count) || null : (item.meetingsCount != null ? Number(item.meetingsCount) || null : null),
          hours_count:           item.hours_count != null ? Number(item.hours_count) || null : (item.hoursCount != null ? Number(item.hoursCount) || null : null),
          quantity:              Number(item.quantity) || 1,
          unit_price:            item.unit_price != null ? Number(item.unit_price) || null : (item.unitPrice != null ? Number(item.unitPrice) || null : null),
          hourly_price:          item.hourly_price != null ? Number(item.hourly_price) || null : (item.hourlyPrice != null ? Number(item.hourlyPrice) || null : null),
          total_price:           item.total_price != null ? Number(item.total_price) || null : (item.totalPrice != null ? Number(item.totalPrice) || null : null),
          description:           cleanProposalAgreementText(item.description),
          course_note:           cleanProposalAgreementText(item.course_note ?? item.courseNote ?? item.manual_note ?? item.manualNote) || null,
          unit_duration:         cleanProposalAgreementText(item.unit_duration ?? item.unitDuration),
          proposal_group:        proposalGroup,
          sort_order:            idx,
          proposal_display_mode: cleanProposalAgreementText(item.proposal_display_mode ?? item.proposalDisplayMode) || 'single',
          source_pricing_key:    cleanProposalAgreementText(item.source_pricing_key ?? item.sourcePricingKey ?? item.pricing_key ?? item.pricingKey) || null,
          selected_bundle_items: selectedBundleItems,
          list_id: rawListId
        });
        if (rawListId != null && rawListId !== '' && safeListId == null) {
          throw new Error('list_id חייב להיות מספר תקין');
        }
        return row;
      });
    const { data, error } = await supabase.rpc('save_proposal_agreement_items_atomic', {
      p_proposal_id: rowId,
      p_items: validItems
    });
    if (error) throw new Error(error.message || 'items_atomic_save_failed');
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
      if (nextRow.id == null || nextRow.id === '') delete nextRow.id;
      delete nextRow.source_id;
      delete nextRow.source_table;
      if (nextRow.role !== undefined && nextRow.contact_role === undefined) nextRow.contact_role = nextRow.role;
      delete nextRow.role;
      if (!nextRow.client_type) nextRow.client_type = 'school';
      if (nextRow.client_type === 'authority') nextRow.school_id = null;
      if (nextRow.client_type !== 'school') nextRow.semel_mosad = nextRow.semel_mosad || null;
      if (!nextRow.client_name) {
        nextRow.client_name = nextRow.client_type === 'authority'
          ? (nextRow.authority || null)
          : (nextRow.school || nextRow.authority || null);
      }
      if (!nextRow.active) nextRow.active = 'פעיל';
      const { data, error } = await supabase.from('contacts_schools').insert(nextRow).select().single();
      if (error) throw new Error(error.message || 'add_contact_failed');
      return { ok: true, row: data };
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
        authority_id: row.authority_id || null,
        school_id:    clientType === 'school' ? (row.school_id || null) : null,
        semel_mosad:  clientType === 'school' ? (String(row.semel_mosad || '').trim() || null) : null,
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
  deleteSchoolContact: async (contactId) => {
    const id = cleanProposalAgreementText(contactId);
    if (!id) throw new Error('missing_school_contact_id');
    const { error } = await supabase.from('contacts_schools').delete().eq('id', id);
    if (error) throw new Error(error.message || 'delete_school_contact_failed');
    return { ok: true, id };
  },
  updateUnifiedContactRecord: async (payload) => {
    const sourceTable = String(payload?.source_table || '').trim();
    const sourceId = payload?.source_id != null ? String(payload.source_id).trim() : '';
    const fields = payload?.fields && typeof payload.fields === 'object' ? payload.fields : {};
    if (!sourceTable || !sourceId) throw new Error('missing_unified_contact_source');

    const pickFields = (allowed) => {
      const body = {};
      for (const key of allowed) {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
        const value = fields[key];
        if (value === undefined) continue;
        body[key] = typeof value === 'string' ? (value.trim() || null) : value;
      }
      return body;
    };

    if (sourceTable === 'contacts_schools') {
      const updateBody = pickFields([
        'client_type', 'client_name', 'authority_id', 'school_id', 'semel_mosad',
        'authority', 'school', 'contact_name', 'contact_role',
        'phone', 'mobile', 'email', 'address', 'notes'
      ]);
      if (!Object.keys(updateBody).length) throw new Error('no_fields_to_update');
      const { data, error } = await supabase
        .from('contacts_schools')
        .update(updateBody)
        .eq('id', sourceId)
        .select()
        .single();
      if (error) throw new Error(error.message || 'update_unified_contact_failed');
      return { ok: true, row: data, source_table: sourceTable, source_id: sourceId };
    }

    if (sourceTable === 'schools') {
      const updateBody = pickFields([
        'principal_name', 'school_phone', 'institution_address', 'city', 'district'
      ]);
      if (!Object.keys(updateBody).length) throw new Error('no_fields_to_update');
      const { data, error } = await supabase
        .from('schools')
        .update(updateBody)
        .eq('id', sourceId)
        .select()
        .single();
      if (error) throw new Error(error.message || 'update_unified_contact_failed');
      return { ok: true, row: data, source_table: sourceTable, source_id: sourceId };
    }

    throw new Error('invalid_unified_contact_source');
  },
  addProposalClient: async (payload) => {
    const clientType = String(payload.client_type || 'school').trim();
    const row = {
      client_type:  clientType,
      client_name:  String(payload.client_name || (clientType === 'authority' ? payload.authority : payload.school) || '').trim() || null,
      authority_id: payload.authority_id || null,
      school_id:    clientType === 'school' ? (payload.school_id || null) : null,
      semel_mosad:  clientType === 'school' ? (String(payload.semel_mosad || '').trim() || null) : null,
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
    if (!canAddActivitiesUser()) throw new Error('forbidden_add_activity');
    const payload = (typeof target === 'object' && target !== null && data === undefined)
      ? { activity: target }
      : { activity: { ...(data || {}), source: target } };
    return upsertActivityToSupabase(payload);
  },
  submitCreateActivityRequest: async (activity) => {
    if (!canSubmitCreateActivityRequestsUser()) throw new Error('forbidden_create_activity_request');
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
    const userRole = String(state?.user?.role || '').trim();
    const canEditDirect = canDirectManageActivitiesUser();
    if (!canEditDirect && canSubmitActivityRequestsUser()) {
      // eslint-disable-next-line no-console
      console.warn('wrong_flow: request-only user attempted saveActivity; using submitEditRequest instead', {
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
    const role = String(state?.user?.role || '').trim();
    if (!ACTIVITY_DIRECT_MANAGE_ROLES.has(role)) throw new Error('forbidden_delete_activity');
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
    const syncedChanges = applyInstructorEmpSync(rawChanges);
    const { data: existingInstructorRow, error: existingInstructorError } = await supabase
      .from('activities')
      .select('instructor_name,instructor_name_2,emp_id,emp_id_2')
      .eq('row_id', rowId)
      .maybeSingle();
    if (existingInstructorError) throw buildSupabaseMutationError('submitEditRequest', existingInstructorError, 'submit_edit_request_failed');
    await validateActivityInstructorBindingsOrThrow({ ...(existingInstructorRow || {}), ...syncedChanges });
    const reducedChanges = Object.entries(syncedChanges).reduce((acc, [key, value]) => {
      if (value === undefined) return acc;
      const isDateField = key === 'start_date' || key === 'end_date' || /^date_\d+$/.test(key) || /^meeting_date_\d+$/.test(key);
      if (value === null) {
        if (isDateField) acc[key] = null;
        return acc;
      }
      const normalizedValue = String(value).trim();
      if (!normalizedValue && isDateField) {
        acc[key] = null;
        return acc;
      }
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
        state_user_id: authContext.state_user_id,
        user_id: authContext.user_id,
        requested_by_user_id: row.requested_by_user_id,
        role: authContext.role,
        can_request_edit: authContext.can_request_edit,
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
          synchronizeStartDateAndFirstMeeting(applyInstructorEmpSync(parseJsonishObject(reqRow?.requested_payload))),
          { includeRowId: true }
        );
        if (!Object.keys(requestedPayload).length) throw new Error('missing_create_activity_payload');
        await upsertActivityToSupabase({ activity: requestedPayload });
      } else {
        const requestedValues = applyInstructorEmpSync(parseJsonishObject(reqRow?.requested_values));
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
  isActivityInPreparation,
  buildExceptionsModelFromRows,
  normalizeActivityRow,
  sanitizeActivityPayload,
  sanitizeActivityPayloadForSupabase,
  normalizeOneDayActivityForSave,
  canonicalOneDayActivityType,
  flattenUserRow,
  buildBootstrapFromUser,
  buildProposalGroupLookup,
  buildProposalGroupHintsFromTemplateSections,
  mergeProposalGroupLookups,
  proposalPermissionFlagsFromFlatUser,
  proposalSessionUserFlagsFromFlatUser,
  canUseProposalsAgreementsApi,
  canManageProposalsAgreementsApi,
  canApproveProposalsAgreementsApi,
  statusForDb,
  sanitizeProposalAgreementPayload,
  USER_PUBLIC_COLUMNS,
  USER_PUBLIC_COLUMNS_EXTENDED
};
