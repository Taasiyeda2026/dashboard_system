Warning: truncated output (original token count: 109921)
Total output lines: 9349

import { state, setSession, clearScreenDataCache } from './state.js';
import { deletePersistedCacheByPrefixes } from './cache-persist.js';
import { hebrewRole } from './screens/shared/ui-hebrew.js';
import { getActivityAuthorityName, getActivityContactName, getActivityContactPhone, getActivitySchoolNames } from './screens/shared/operations-activity-helpers.js';
import { cleanActivityManagerName, getContactsInstructorUsers, getRosterUsers, NO_ACTIVITY_MANAGER_LABEL, normalizeOneDayActivityType, resolveActivityInstructorName, buildContactsInstructorLookup, resolveCanonicalInstructorPair, validateInstructorIdentityPayload, normalizeActivityMeetingsCount } from './screens/shared/activity-options.js';
import { EXCEPTION_TYPE_ORDER, normalizedExceptionTypes } from './screens/shared/exceptions-metrics.js';
import { ACTIVITY_SEASON_REGULAR, ACTIVITY_SEASON_SUMMER_2026, ACTIVITY_SEASON_SCHOOL_2027, activityMatchesPeriodKey, activitySeasonQueryValues, isSummerActivity, normalizeActivitySeason, normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import { assertActivityMutationAllowed } from './screens/shared/activity-readonly-period.js';
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
import { isPrivateIsraaActivity, withResolvedSchool2027Contact } from './screens/shared/school-2027-contact.js';
import { normalizeOperationalDistrict } from './screens/shared/district-normalization.js';
import { permissionFlagYes, canEditDirect, canAddActivityDirect, canRequestEdit, canRequestCreateActivity, canReviewRequests } from './permissions.js';
import { mapWithConcurrency } from './bounded-concurrency.js';
import { config } from './config.js';
import { catalogActivityChangesFromRows, catalogText } from './activity-catalog-identity.js';
import { enforceManagedRoutes, hasPermission } from './permission-policy.js';
import { ALL_PERMISSION_KEYS, ROLE_PERMISSION_TEMPLATES } from './capability-registry.js';
import { endDateExceptionThresholdForPeriod } from './exception-end-date-threshold-by-period.js';
import { activityBelongsToCourseSchedulingPeriod, resolveCourseSchedulingPeriod } from './screens/course-scheduling-periods.js';
import {
  activitySchedulingFieldsChanged,
  invalidatePlanningAfterActivitySchedulingSave
} from './screens/course-scheduling-planning-store.js';

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
  updateProposalAgreementGfenSignedOrOrdered: true,
  updateProposalAgreementStatus: true,
  lockAndSendProposalAgreement: true,
  uploadProposalFinalPdf: true,
  requestProposalFinalPdf: true,
  uploadGefenApprovalDocument: true,
  deleteProposalAgreement: true,
  saveProposalAgreementItems: true,
  uploadCompletionApproval: true,
  replaceCompletionApprovalUpload: true,
  deleteCompletionApprovalUpload: true,
  reviewCompletionApprovalUpload: true,
  saveSchoolContactResponsible: true
  ,saveActivityLayoutStatus: true
  ,deleteActivity: true
  ,shareIsraaActivity: true
  ,shareIsraaActivityGroup: true
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
  workshopInventoryOpeningBalances: true,
  instructorSchedulePrintContacts: true,
  listSheets: true,
  israaProgramTracking: true,
  israaSimulatorEntries: true,
};

const API_TIMEOUT_MS_READ = 20000;
const API_TIMEOUT_MS_WRITE = 45000;
const PERF_MAX_REQUESTS = 150;

function currentUserIdentityValues() {
  const user = state?.user || {};
  return [user.emp_id, user.employee_id, user.user_id].map((v) => String(v || '').trim()).filter(Boolean);
}


const ACTIVITY_MEETING_DATE_COLUMNS = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`);
const DASHBOARD_ACTIVITY_COLUMNS = [
  'row_id', 'activity_season', 'activity_family', 'activity_manager', 'activity_name', 'authority', 'school',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2', 'start_date', 'end_date',
  'status', 'activity_type', 'district', ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
const DASHBOARD_ACTIVITY_MIN_COLUMNS = 'row_id,activity_season,activity_family,activity_manager,activity_name,authority,school,instructor_name,instructor_name_2,emp_id,emp_id_2,start_date,end_date,status,activity_type';
// Explicit list/read-model projections. Full activity rows are fetched only by activityDetail.
const ACTIVITY_LIST_COLUMNS = [
  'id', 'row_id', 'activity_family', 'activity_manager', 'district', 'authority_id', 'school_id',
  'authority', 'school', 'grade', 'class_group', 'activity_type', 'item_type',
  'activity_season', 'activity_domain', 'activity_no', 'activity_name', 'sessions', 'funding',
  'start_time', 'end_time', 'emp_id', 'instructor_name', 'emp_id_2', 'instructor_name_2',
  'start_date', 'end_date', 'status', 'participants_count', 'school_contact_id',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
// Activities table / list: fields shown or used for month/status filters (no finance/contact blobs).
const ACTIVITY_TABLE_COLUMNS = [
  'id', 'row_id', 'activity_family', 'activity_manager', 'authority', 'authority_id', 'school', 'school_id',
  'grade', 'class_group', 'activity_type', 'item_type', 'activity_season', 'activity_domain', 'activity_no', 'activity_name',
  'sessions', 'funding', 'start_time', 'end_time', 'emp_id', 'instructor_name', 'emp_id_2', 'instructor_name_2',
  'draft_emp_id', 'draft_instructor_name',
  'start_date', 'end_date', 'status', 'notes', 'israa_shared',
  'school_contact_id', 'contact_name', 'contact_phone', 'contact_email',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
const ACTIVITY_CALENDAR_COLUMNS = [
  'row_id', 'activity_name', 'activity_type', 'activity_family', 'activity_season',
  'activity_manager', 'funding',
  'authority', 'school', 'school_id', 'grade', 'class_group',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
  'start_time', 'end_time', 'start_date', 'end_date', 'status',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
// End-dates screen: only columns required for the ending-dates table.
const ACTIVITY_END_DATES_COLUMNS = [
  'row_id', 'activity_name', 'authority', 'school',
  'instructor_name', 'instructor_name_2', 'end_date', 'status', 'activity_season'
].join(',');
const ACTIVITY_EXCEPTIONS_COLUMNS = [
  'row_id', 'activity_manager', 'district', 'authority', 'school', 'grade', 'class_group',
  'activity_type', 'item_type', 'activity_season', 'activity_name', 'sessions',
  'emp_id', 'instructor_name', 'emp_id_2', 'instructor_name_2',
  'start_date', 'end_date', 'status',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
const ACTIVITY_OPERATIONS_COLUMNS = [
  'row_id', 'activity_name', 'activity_type', 'item_type', 'activity_season',
  'authority', 'school', 'school_id', 'grade', 'class_group',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
  'start_time', 'end_time', 'start_date', 'end_date', 'status', 'participants_count', 'sessions',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
const INSTRUCTOR_PORTAL_ACTIVITY_COLUMNS = `${ACTIVITY_OPERATIONS_COLUMNS},activity_manager,school_contact_id,contact_name,contact_phone,contact_email`;
// Work-schedule filter controls need only descriptive fields. Keep this projection
// separate from the substantially wider results payload (notably meeting dates).
const ACTIVITY_SCHEDULE_FILTER_OPTION_COLUMNS = [
  'row_id', 'activity_name', 'activity_season', 'authority', 'school',
  'instructor_name', 'instructor_name_2', 'status'
].join(',');
const ACTIVITY_ARCHIVE_COLUMNS = [
  'row_id', 'activity_name', 'activity_type', 'activity_family', 'activity_season',
  'authority', 'school', 'instructor_name', 'instructor_name_2', 'activity_manager',
  'start_date', 'end_date', 'status',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
// List cards: assignment stats without meeting-date payload.
const ACTIVITY_INSTRUCTOR_STATS_COLUMNS = [
  'row_id', 'activity_name', 'activity_type', 'item_type', 'activity_season',
  'authority', 'school', 'activity_manager',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
  'start_date', 'end_date', 'status'
].join(',');
// Instructor profile history: include meeting dates for month filtering.
const ACTIVITY_INSTRUCTOR_HISTORY_COLUMNS = [
  'row_id', 'activity_name', 'activity_type', 'item_type', 'activity_season',
  'authority', 'school', 'activity_manager',
  'instructor_name', 'instructor_name_2', 'emp_id', 'emp_id_2',
  'start_date', 'end_date', 'status',
  ...ACTIVITY_MEETING_DATE_COLUMNS
].join(',');
const ACTIVITY_DATES_ONLY_COLUMNS = ['row_id', 'start_date', 'end_date', ...ACTIVITY_MEETING_DATE_COLUMNS].join(',');
const COMPLETION_APPROVAL_METADATA_COLUMNS = 'id,activity_row_id,activity_date,instructor_emp_id,instructor_name,authority,school,file_path,file_name,mime_type,file_size,uploaded_by_user_id,uploaded_at,status,reviewed_by,reviewed_at,review_note';
const COMPLETION_APPROVAL_EXCEPTIONS_COLUMNS = 'id,activity_row_id,activity_date,instructor_name,school,file_path,file_name,status';
const PHOTO_APPROVAL_METADATA_COLUMNS = 'id,instructor_emp_id,instructor_name,authority,school,school_id,file_path,file_name,mime_type,file_size,uploaded_at,status';
const SCHOOL_CONTACT_RESPONSIBLES_COLUMNS = 'id,activity_date,school_id,school,authority,responsible_emp_id,responsible_name';
const ARCHIVE_PAGE_SIZE = 200;
/** Safety ceiling for the staged archive load (200 * 40 = 8000 closed activities). */
const ARCHIVE_MAX_PAGES = 40;
const PROPOSALS_LIST_PAGE_SIZE = 50;
const COMPLETION_APPROVALS_PAGE_SIZE = 50;
const SETTINGS_BOOTSTRAP_COLUMNS = 'key,value,description';
const LISTS_BOOTSTRAP_COLUMNS = 'list_id,category,value,label,active,is_active,category_order,sort_order,activity_no,activity_name,activity_type,type,stock_quantity,stock_group_key,stock_group_name,stock_item_name,stock_label,parent_value';
const COURSE_MEETINGS_BOOTSTRAP_COLUMNS = 'gefen_number,meetings_count';
/**
 * Categories loaded from `lists` at login/bootstrap.
 * school, authority, workshop_stock and other large/unused categories are excluded:
 * school (~599 rows) and authority (~159 rows) are loaded on-demand from dedicated tables.
 * workshop_stock, view_type, activity_status, finance_status are not needed at startup.
 */
const BOOTSTRAP_LIST_CATEGORIES = [
  'grade', 'activity_names', 'funding', 'instructor_users',
  'activity_manager', 'activity_season', 'one_day_activity_type',
  'program_activity_type', 'activity_type'
];
/** Categories loaded for the workshop inventory tab (replaces full adminLists fetch). */
const WORKSHOP_LIST_CATEGORIES = ['activity_names', 'workshop_stock'];
let settingsRowsCache = null;
let settingsRowsPromise = null;
let listsRowsCache = null;
let listsRowsPromise = null;
let bootstrapListsCache = null;
let bootstrapListsPromise = null;
let workshopListsCache = null;
let workshopListsPromise = null;
let courseMeetingsRowsCache = null;
let courseMeetingsRowsPromise = null;
let instructorContactsCache = null;
let instructorContactsPromise = null;
let instructorEmpIdsCache = null;
let instructorEmpIdsPromise = null;

function assertAdminApi() {
  const role = String(state?.user?.role || '').trim();
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
  const editableCategories = ['workshop_stock', 'activity_names'];
  const saved = await mapWithConcurrency(rows, 4, async (item) => {
    const stockQuantity = normalizeWorkshopStockQuantity(item?.stock_quantity ?? item?.stockQuantity);
    if (stockQuantity == null) return null;
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
      return data;
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
    return data;
  });
  clearBootstrapReadCaches();
  return { ok: true, rows: saved.filter(Boolean) };
}


function clearBootstrapReadCaches() {
  settingsRowsCache = null;
  settingsRowsPromise = null;
  listsRowsCache = null;
  listsRowsPromise = null;
  bootstrapListsCache = null;
  bootstrapListsPromise = null;
  workshopListsCache = null;
  workshopListsPromise = null;
  courseMeetingsRowsCache = null;
  courseMeetingsRowsPromise = null;
  instructorEmpIdsCache = null;
  instructorEmpIdsPromise = null;
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

async function readArchiveActivitiesFromSupabase(activityPeriod = currentGlobalActivityPeriod(), { limit = ARCHIVE_PAGE_SIZE, offset = 0 } = {}) {
  if (!supabase) return null;
  try {
    const pageSize = Math.max(1, Number(limit) || ARCHIVE_PAGE_SIZE);
    const pageOffset = Math.max(0, Number(offset) || 0);
    const { data, error } = await supabase
      .from('activities')
      .select(ACTIVITY_ARCHIVE_COLUMNS)
      .in('activity_season', activitySeasonQueryValues(activityPeriod))
      .eq('status', CLOSED_STATUS)
      .order('end_date', { ascending: false, nullsFirst: false })
      .order('start_date', { ascending: false, nullsFirst: false })
      .range(pageOffset, pageOffset + pageSize - 1);
    if (error) throw new Error(error.message || 'archive_read_failed');
    const rawRows = Array.isArray(data) ? data : [];
    const rows = filterRowsByGlobalActivityPeriod(rawRows.map(normalizeActivityRow), activityPeriod);
    return {
      rows,
      _source: 'supabase',
      _hasMore: rawRows.length >= pageSize,
      _offset: pageOffset,
      _limit: pageSize,
      _debug: { activities_loaded_from_supabase: rawRows.length, source_table: 'public.activities', projection: 'ACTIVITY_ARCHIVE_COLUMNS' }
    };
  } catch (err) {
    console.error('[supabase] archive fetch error:', err);
    return null;
  }
}

/**
 * Archive KPI cards, filters and counts must describe the whole period, not the
 * first page. Pages through the existing archive reader until the period is fully
 * loaded, keeping one projection and one API path.
 */
async function readAllArchiveActivitiesFromSupabase(activityPeriod = currentGlobalActivityPeriod(), { pageSize = ARCHIVE_PAGE_SIZE, maxPages = ARCHIVE_MAX_PAGES } = {}) {
  const size = Math.max(1, Number(pageSize) || ARCHIVE_PAGE_SIZE);
  const pageLimit = Math.max(1, Number(maxPages) || ARCHIVE_MAX_PAGES);
  const rows = [];
  const seenRowIds = new Set();
  let loadedRawRows = 0;
  let pages = 0;
  let truncated = false;

  for (let page = 0; page < pageLimit; page += 1) {
    const result = await readArchiveActivitiesFromSupabase(activityPeriod, { limit: size, offset: page * size });
    if (!result) return page === 0 ? null : finishArchivePages();
    pages += 1;
    loadedRawRows += Number(result?._debug?.activities_loaded_from_supabase || 0);
    (Array.isArray(result.rows) ? result.rows : []).forEach((row) => {
      const rowId = String(row?.RowID || row?.row_id || '').trim();
      if (rowId && seenRowIds.has(rowId)) return;
      if (rowId) seenRowIds.add(rowId);
      rows.push(row);
    });
    if (!result._hasMore) return finishArchivePages();
    truncated = page === pageLimit - 1;
  }

  return finishArchivePages();

  function finishArchivePages() {
    return {
      rows,
      _source: 'supabase',
      _hasMore: truncated,
      _offset: 0,
      _limit: rows.length,
      _debug: {
        activities_loaded_from_supabase: loadedRawRows,
        source_table: 'public.activities',
        projection: 'ACTIVITY_ARCHIVE_COLUMNS',
        archive_pages_loaded: pages,
        archive_fully_loaded: !truncated
      }
    };
  }
}

async function enrichActivitiesWithFundingSources(rows = []) {
  const activityIds = [...new Set(rows.map((row) => String(row?.id || '').trim()).filter(Boolean))];
  if (!activityIds.length) return rows;
  const { data, error } = await supabase.from('activity_funding_sources')
    .select('activity_id,funding_source_id,amount,funding_sources(id,name,is_active,sort_order)')
    .in('activity_id', activityIds);
  if (error) {
    // Supports a rolling deployment where frontend can precede the migration.
    console.warn('[funding] association read unavailable; using activities.funding fallback', error.message || error);
    return rows;
  }
  const byActivity = new Map();
  for (const link of (data || [])) {
    const source = link.funding_sources;
    if (!source?.id || !source?.name) continue;
    const list = byActivity.get(String(link.activity_id)) || [];
    list.push({ id: source.id, name: source.name, is_active: source.is_active, sort_order: source.sort_order, amount: link.amount });
    byActivity.set(String(link.activity_id), list);
  }
  return rows.map((row) => {
    const fundingSources = (byActivity.get(String(row.id)) || []).sort((a, b) => (a.sort_order ?? 2147483647) - (b.sort_order ?? 2147483647) || a.name.localeCompare(b.name, 'he'));
    return fundingSources.length ? { ...row, funding_sources: fundingSources, funding: fundingSources.map((item) => item.name).join(' + ') } : row;
  });
}

async function saveActivityFundingSources(activityRow = {}, source = {}) {
  if (!Object.prototype.hasOwnProperty.call(source, 'funding_sources')) return;
  const activityId = String(activityRow?.id || '').trim();
  if (!activityId) throw new Error('activity_funding_missing_activity_id');
  const requested = (Array.isArray(source.funding_sources) ? source.funding_sources : [])
    .map((item) => typeof item === 'string' ? { funding_source_id: item, amount: null } : item)
    .map((item) => ({ funding_source_id: String(item?.funding_source_id || item?.id || '').trim(), amount: item?.amount === '' || item?.amount == null ? null : Number(item.amount) }))
    .filter((item) => item.funding_source_id);
  if (new Set(requested.map((item) => item.funding_source_id)).size !== requested.length) throw new Error('duplicate_activity_funding_source');
  const ids = requested.map((item) => item.funding_source_id);
  if (ids.length) {
    const { data: sources, error: sourceError } = await supabase.from('funding_sources').select('id,name,is_active').in('id', ids);
    if (sourceError) throw new Error(sourceError.message || 'funding_sources_read_failed');
    if ((sources || []).length !== ids.length) throw new Error('funding_source_not_found');
    const display = ids.map((id) => sources.find((row) => String(row.id) === id)?.name).filter(Boolean).join(' + ');
    const { error: compatibilityError } = await supabase.from('activities').update({ funding: display }).eq('id', activityId);
    if (compatibilityError) throw new Error(compatibilityError.message || 'activity_funding_compatibility_save_failed');
  } else {
    const { error: compatibilityError } = await supabase.from('activities').update({ funding: null }).eq('id', activityId);
    if (compatibilityError) throw new Error(compatibilityError.message || 'activity_funding_compatibility_save_failed');
  }
  const { error: deleteError } = await supabase.from('activity_funding_sources').delete().eq('activity_id', activityId);
  if (deleteError) throw new Error(deleteError.message || 'activity_funding_replace_failed');
  if (requested.length) {
    const { error: insertError } = await supabase.from('activity_funding_sources').insert(requested.map((item) => ({ activity_id: activityId, ...item })));
    if (insertError) throw new Error(insertError.message || 'activity_funding_save_failed');
  }
}

async function readActivitiesFromSupabase(filters = {}) {
  if (!supabase) return null;

  try {
    const selectedSeason = normalizeGlobalActivityPeriod(filters?.activity_period || currentGlobalActivityPeriod());
    const select = filters?.select || ACTIVITY_TABLE_COLUMNS;
    const { data, error } = await supabase.from('activities').select(select).in('activity_season', activitySeasonQueryValues(selectedSeason));
    if (error) throw new Error(error.message || 'activities_read_failed');
    const rawRows = Array.isArray(data) ? data : [];
    const normalizedRows = await enrichActivitiesWithFundingSources(rawRows.map(normalizeActivityRow));
    const rows = filterCoreActivitiesRows(normalizedRows, filters);
    return { rows, _source: 'supabase', _debug: { activities_loaded_from_supabase: rawRows.length, source_table: 'public.activities', projection: 'ACTIVITY_TABLE_COLUMNS' } };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[supabase] Unexpected activities fetch error:', error);
    return null;
  }
}

export function filterCoreActivitiesRows(rows = [], filters = {}) {
  return (Array.isArray(rows) ? rows : [])
      .filter((row) => !isPrivateIsraaActivity(row))
      .filter((row) => filters?.include_all_periods ? true : activityMatchesPeriodKey(row, filters?.activity_period || currentGlobalActivityPeriod()))
      .filter((row) => filters?.include_inactive ? true : !isActivityInactive(row))
      .filter((row) => rowMatchesActivitiesFilters(row, filters));
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
  const fundingRaw = row?.funding;
  const funding = fundingRaw == null ? '' : String(fundingRaw).trim();
  const normalized = {
    ...row,
    row_id: rowId,
    RowID: rowId,
    source_sheet: 'activities',
    source_table: ACTIVITIES_TABLE,
    authority: authorityName,
    school: schoolName,
    funding,
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
  if (compact === 'course' || raw === 'קורס' || raw === 'קורסים' || raw === 'תוכנית' || raw === 'תכנית' || compact === 'program' || compact === 'programs') return 'course';
  if (compact === 'afterschool' || raw === 'חוג אפטרסקול' || raw === 'אפטרסקול') return 'after_school';
  const canonical = ['course', 'workshop', 'escape_room', 'tour', 'after_school'];
  if (canonical.includes(lower)) return lower;
  return '';
}

function rowActivityType(row = {}) {
  return normalizeActivityTypeValue(row?.activity_type || row?.type || row?.kind);
}

export function isDashboardEndingActivity(row = {}, month = '') {
  const type = rowActivityType(row);
  return (type === 'course' || type === 'after_school')
    && normalizeSupabaseDate(row?.end_date || row?.date_end).startsWith(String(month || '').slice(0, 7));
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

const PENDING_DISTRICT_ASSIGNMENT = 'ממתין לשיוך מחוזי';

function isPendingDistrictAssignment(value) {
  return nullStr(value) === PENDING_DISTRICT_ASSIGNMENT;
}

function hasActivityAuthority(row = {}) {
  if (row?.authority_id != null && String(row.authority_id).trim() !== '') return true;
  return Boolean(nullStr(row?.authority));
}

function isMissingDistrictValue(value) {
  const district = nullStr(value);
  return !district || isPendingDistrictAssignment(district);
}

function districtDisplayKey(row = {}) {
  if (isMissingDistrictValue(row?.district)) return 'ללא מחוז / לא משויך';
  return nullStr(row?.district);
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

async function selectActivitiesFromSupabase(select = ACTIVITY_LIST_COLUMNS, activitySeason = currentGlobalActivityPeriod()) {
  const result = await supabase.from('activities').select(select).in('activity_season', activitySeasonQueryValues(activitySeason));
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
  activityPeriod = currentGlobalActivityPeriod(),
  activityType = '',
  includeEndDate = false,
  select = ACTIVITY_LIST_COLUMNS,
  overlapByStartEnd = false,
  fallbackSelect = '',
  employeeIds = []
} = {}) {
  if (!supabase) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || ''))) {
    throw new Error('invalid_activity_date_range');
  }
  let query = supabase
    .from('activities')
    .select(select)
    .in('activity_season', activitySeasonQueryValues(activityPeriod));
  const employeeScope = [...new Set((employeeIds || [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d+$/.test(value)))];
  if (employeeScope.length) {
    const values = employeeScope.join(',');
    query = query.or(`emp_id.in.(${values}),emp_id_2.in.(${values})`);
  }
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
      activityPeriod,
      activityType,
      includeEndDate,
      select: fallbackSelect,
      overlapByStartEnd,
      employeeIds
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
const SCHOOLS_CATALOG_COLUMNS = 'id,semel_mosad,school_name,authority,authority_id,district,city,sector,principal_name,school_phone,institution_address,active';
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
      sector: normalizeCatalogText(row.sector),
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
    semel_mosad: school.semel_mosad,
    sector: school.sector
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
  const options = [];
  const optionIndexByKey = new Map();

  const addOption = (opt) => {
    const contactName = normalizeCatalogText(opt.contact_name);
    const key = contactName
      ? [
        String(opt.authority_id ?? normalizeCatalogText(opt.authority)),
        String(opt.school_id ?? normalizeCatalogText(opt.school)),
        contactName.toLocaleLowerCase('he')
      ].join('||')
      : [
        normalizeCatalogText(opt._catalog_source || opt.source_table || 'contact'),
        String(opt.authority_id ?? normalizeCatalogText(opt.authority)),
        String(opt.school_id ?? normalizeCatalogText(opt.school))
      ].join('||');
    const existingIndex = optionIndexByKey.get(key);
    if (existingIndex != null) {
      const existing = options[existingIndex];
      const optIsExplicit = normalizeCatalogText(opt.source_table) === 'contacts_schools';
      const existingIsExplicit = normalizeCatalogText(existing.source_table) === 'contacts_schools';
      const preferred = optIsExplicit && !existingIsExplicit ? opt : existing;
      const fallback = preferred === opt ? existing : opt;
      options[existingIndex] = {
        ...fallback,
        ...preferred,
        contact_role: normalizeCatalogText(preferred.contact_role) || normalizeCatalogText(fallback.contact_role),
        phone: normalizeCatalogText(preferred.phone) || normalizeCatalogText(fallback.phone),
        mobile: normalizeCatalogText(preferred.mobile) || normalizeCatalogText(fallback.mobile),
        email: normalizeCatalogText(preferred.email) || normalizeCatalogText(fallback.email)
      };
      return;
    }
    optionIndexByKey.set(key, options.length);
    options.push(opt);
  };

  (Array.isArray(contactRows) ? contactRows : [])
    .map((row) => enrichSchoolContactRow(row, authorityLookup, schoolLookup))
    .forEach(addOption);

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
 * Filtered lists fetch for login/bootstrap — only the 9 categories needed for
 * buildClientSettingsFromLists. Reduces ~997 → ~184 rows at startup.
 * school/authority are loaded separately from dedicated tables via readAuthoritySchoolCatalog().
 */
async function readBootstrapListsFromSupabase() {
  if (!supabase) return null;
  if (bootstrapListsCache) return bootstrapListsCache;
  if (bootstrapListsPromise) return bootstrapListsPromise;
  bootstrapListsPromise = (async () => {
    try {
      const result = await supabase
        .from('lists')
        .select(LISTS_BOOTSTRAP_COLUMNS)
        .in('category', BOOTSTRAP_LIST_CATEGORIES)
        .order('category_order', { ascending: true, nullsFirst: false })
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('category', { ascending: true })
        .order('value', { ascending: true });
      if (result.error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] Failed to load bootstrap lists:', result.error);
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
      bootstrapListsCache = { categories, _source: 'supabase' };
      return bootstrapListsCache;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Unexpected bootstrap lists fetch error:', error);
      return null;
    } finally {
      bootstrapListsPromise = null;
    }
  })();
  return bootstrapListsPromise;
}

/**
 * Focused lists fetch for the workshop inventory tab (ציוד ומלאי).
 * Queries only activity_names + workshop_stock — ~79 rows instead of ~997.
 */
async function readWorkshopListsFromSupabase() {
  if (!supabase) return null;
  if (workshopListsCache) return workshopListsCache;
  if (workshopListsPromise) return workshopListsPromise;
  workshopListsPromise = (async () => {
    try {
      const result = await supabase
        .from('lists')
        .select(LISTS_BOOTSTRAP_COLUMNS)
        .in('category', WORKSHOP_LIST_CATEGORIES)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('value', { ascending: true });
      if (result.error) {
        // eslint-disable-next-line no-console
        console.error('[supabase] Failed to load workshop lists:', result.error);
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
      workshopListsCache = { categories, _source: 'supabase' };
      return workshopListsCache;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[supabase] Unexpected workshop lists fetch error:', error);
      return null;
    } finally {
      workshopListsPromise = null;
    }
  })();
  return workshopListsPromise;
}

/**
 * Builds school/authority dropdown values from the dedicated catalog tables
 * (schools, authorities) rather than from the lists table.
 * Used to populate client_settings.dropdown_options.school/authority after bootstrap.
 */
function buildSchoolAuthorityFromCatalog(catalog) {
  const schools = Array.isArray(catalog?.schools) ? catalog.schools : [];
  const authorities = Array.isArray(catalog?.authorities) ? catalog.authorities : [];
  const activeSchools = schools.filter((s) => isCatalogActive(s?.active));
  const activeAuthorities = authorities.filter((a) => isCatalogActive(a?.active));
  const schoolValues = activeSchools.map((s) => normalizeCatalogText(s.school_name)).filter(Boolean);
  const schoolRecords = activeSchools.map((s) => ({
    name: normalizeCatalogText(s.school_name),
    value: normalizeCatalogText(s.school_name),
    school_id: normalizeCatalogText(s.id || s.semel_mosad || ''),
    authority_id: normalizeCatalogText(s.authority_id || ''),
    authority: normalizeCatalogText(s.authority || '')
  })).filter((s) => s.name);
  const authorityValues = activeAuthorities.map((a) => normalizeCatalogText(a.authority_name)).filter(Boolean);
  return { schoolValues, schoolRecords, authorityValues };
}


async function readCourseMeetingsRowsForBootstrap() {
  if (!supabase) return [];
  if (courseMeetingsRowsCache) return courseMeetingsRowsCache;
  if (courseMeetingsRowsPromise) return courseMeetingsRowsPromise;
  courseMeetingsRowsPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('proposal_gefen_courses')
        .select(COURSE_MEETINGS_BOOTSTRAP_COLUMNS)
        .eq('is_active', true);
      if (error) {
        console.error('[supabase] proposal_gefen_courses meetings fetch failed:', error);
        return [];
      }
      courseMeetingsRowsCache = Array.isArray(data) ? data : [];
      return courseMeetingsRowsCache;
    } catch (error) {
      console.error('[supabase] Unexpected proposal_gefen_courses meetings fetch error:', error);
      return [];
    } finally {
      courseMeetingsRowsPromise = null;
    }
  })();
  return courseMeetingsRowsPromise;
}

/**
 * Converts the lists table data into the clientSettings shape expected by
 * activity-options.js and the add-activity form.
 * Handles many category name variants so the lists table can use any naming.
 */
/**
 * @param {object|null} catalogData - Optional result from readAuthoritySchoolCatalog().
 *   When provided, school/authority values come from dedicated tables instead of lists.
 */
function buildClientSettingsFromLists(listsData, settingsRows = [], instructorContactsRows = [], courseMeetingsRows = [], catalogData = null) {
  const categories = Array.isArray(listsData?.categories) ? listsData.categories : [];
  const courseMeetingsByStableId = new Map(
    (Array.isArray(courseMeetingsRows) ? courseMeetingsRows : [])
      .map((row) => [
        String(row?.gefen_number || '').trim(),
        normalizeActivityMeetingsCount(row?.meetings_count)
      ])
      .filter(([gefenNumber, meetingsCount]) => gefenNumber && meetingsCount != null)
  );
  const settingValue = (key) => {
    const row = (Array.isArray(settingsRows) ? settingsRows : []).find((item) => String(item?.key || '').trim() === key);
    return String(row?.value || '').trim();
  };
  const accentColor = settingValue('accent_color') || settingValue('theme_accent') || settingValue('ui_accent_color');
  let activityManagerContacts = [];
  try {
    const parsed = JSON.parse(settingValue('activity_manager_contacts') || '[]');
    activityManagerContacts = parsed && typeof parsed === 'object' ? parsed : [];
  } catch { activityManagerContacts = []; }
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
  // school/authority — prefer dedicated catalog (from schools/authorities tables) when provided;
  // fall back to lists data for backwards-compatibility when catalogData is not available.
  const schoolItems     = getItems('school', 'schools');
  let schoolValues    = schoolItems.map((i) => i.value).filter(Boolean);
  let authorityValues = getValues('authority', 'authorities');
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

  const activityNames = activityNameItems.map((i) => {
    const gefenNumber = String(i._row?.gefen_number || '').trim();
    const activityNo = String(i._row?.activity_no || i._row?.number || '').trim();
    const canonicalName = String(i._row?.activity_name || i._row?.label_he || i.label || i.value || '').trim();
    const meetingsCount = [gefenNumber, activityNo]
      .filter(Boolean)
      .map((stableId) => courseMeetingsByStableId.get(stableId))
      .find((count) => count != null) ?? null;
    return {
      label:         canonicalName,
      label_he:      canonicalName,
      value:         canonicalName,
      activity_name: canonicalName,
      gefen_number:  gefenNumber,
      activity_no:   activityNo || gefenNumber,
      meetings_count: meetingsCount,
      activity_type: String(i._row?.activity_type || i._row?.parent_value || i._row?.type || '').trim(),
      parent_value:  String(i._row?.parent_value || i._row?.activity_type || i._row?.type || '').trim(),
      type:          String(i._row?.type || i._row?.activity_type || i._row?.parent_value || '').trim(),
      active:        (typeof i._row?.is_active === 'boolean') ? i._row?.is_active : (i._row?.active ?? i.active),
      sort_order:    Number.isFinite(Number(i._row?.sort_order)) ? Number(i._row?.sort_order) : null
    };
  });
  const activityTypes = [...new Set(activityNames.map((row) => String(row.activity_type || row.parent_value || row.type || '').trim()).filter(Boolean))];
  // Use dedicated catalog tables (schools/authorities) when provided — avoids large lists rows.
  // Fall back to lists-derived values for backwards-compatibility when catalog is unavailable.
  let schoolRecords = schoolItems.map((i) => ({
    name:        String(i._row?.school || i._row?.school_name || i.label || i.value || '').trim(),
    value:       String(i.value || i._row?.school || i._row?.school_name || '').trim(),
    school_id:   String(i._row?.school_id || i._row?.id || '').trim(),
    authority_id:String(i._row?.authority_id || '').trim(),
    authority:   String(i._row?.authority || '').trim()
  })).filter((school) => school.name || school.value);
  if (catalogData) {
    const fromCatalog = buildSchoolAuthorityFromCatalog(catalogData);
    schoolValues    = fromCatalog.schoolValues;
    schoolRecords   = fromCatalog.schoolRecords;
    authorityValues = fromCatalog.authorityValues;
  }

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
    activity_manager_contacts: activityManagerContacts,
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
async function readInstructorActivityHistoryFromSupabase({ empId = '', instructorName = '' } = {}) {
  if (!supabase) return [];
  const selectedSeason = currentGlobalActivityPeriod();
  const emp = String(empId || '').trim();
  const name = String(instructorName || '').trim().toLowerCase();
  let query = supabase
    .from('activities')
    .select(ACTIVITY_INSTRUCTOR_HISTORY_COLUMNS)
    .in('activity_season', activitySeasonQueryValues(selectedSeason));
  if (emp) {
    // Prefer emp_id filter; names may contain characters unsafe for PostgREST .or() literals.
    query = query.or(`emp_id.eq.${emp},emp_id_2.eq.${emp}`);
  }
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'instructor_activity_history_failed');
  const rows = (Array.isArray(data) ? data : []).map(normalizeActivityRow).filter((row) => !isActivityInactive(row));
  if (!emp && name) {
    return rows.filter((row) => [row?.instructor_name, row?.instructor_name_2]
      .map((value) => String(value || '').trim().toLowerCase())
      .some((value) => value === name));
  }
  if (emp && name) {
    // Keep emp matches; also include name-only matches from a second pass if needed later.
    return rows;
  }
  return rows;
}

async function readInstructorsFromSupabase() {
  if (!supabase) return null;
  try {
    // List entry: contacts + thin season stats (no meeting-date payload / no scheduling).
    const [activityRows, contactsResult] = await Promise.all([
      selectActivitiesFromSupabase(ACTIVITY_INSTRUCTOR_STATS_COLUMNS),
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
        if (!stats) co…59921 tokens truncated…)
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
  instructorEmployeeFile: async ({ empId, schoolYear = '2027' } = {}) => {
    const numericEmpId = Number(String(empId || '').trim());
    if (!Number.isSafeInteger(numericEmpId) || numericEmpId <= 0) throw new Error('invalid_employee_file_emp_id');
    const { data, error } = await supabase.rpc('get_instructor_employee_file_snapshot', {
      p_emp_id: numericEmpId,
      p_school_year: String(schoolYear || '2027').trim()
    });
    if (error) throw new Error(error.message || 'employee_file_snapshot_failed');
    return data || { mapped: false, components: [] };
  },
  updateInstructorEmployeeFileComponent: async ({ empId, schoolYear = '2027', componentKey, completed = false, itemCount = 0 } = {}) => {
    const { data, error } = await supabase.rpc('update_instructor_employee_file_component', {
      p_emp_id: Number(empId), p_school_year: String(schoolYear), p_component_key: String(componentKey),
      p_completed: completed === true, p_item_count: Math.max(0, Number(itemCount) || 0)
    });
    if (error) throw new Error(error.message || 'employee_file_component_update_failed');
    return data;
  },
  updateInstructorEmployeeFolderUrl: async ({ empId, schoolYear = '2027', folderWebUrl = '' } = {}) => {
    const { data, error } = await supabase.rpc('update_instructor_employee_folder_url', {
      p_emp_id: Number(empId), p_school_year: String(schoolYear), p_folder_web_url: String(folderWebUrl || '').trim()
    });
    if (error) throw new Error(error.message || 'employee_file_folder_url_update_failed');
    return data;
  },
  contacts: async (params = {}) => {
    const supabaseData = await readContactsFromSupabase(params || {});
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ instructor_rows: [], school_rows: [], can_view_instructors: true, can_view_schools: true }, 'contacts_supabase_failed');
  },
  endDates: () => readEndDatesFromSupabase(),
  getCatalogPrograms: () => readCatalogProgramsFromSupabase(),
  myData: async (params = {}) => {
    const [allRows, contactResponsibles, summerPrintContactRows] = await Promise.all([
      readAllActivitiesRowsSupabase({ select: INSTRUCTOR_PORTAL_ACTIVITY_COLUMNS }),
      readSchoolContactResponsiblesRows(),
      readMyDataSummerPrintContactRows()
    ]);
    const idsSet = getInstructorIdentitySet();
    const includeClosedForApprovals = Boolean(params?.includeClosedForApprovals);
    const periodRows = filterRowsByGlobalActivityPeriod(allRows);
    const openRows = includeClosedForApprovals
      ? periodRows.filter((row) => !isActivityDeleted(row) && !isActivityCancelled(row))
      : periodRows.filter((row) => !isActivityClosed(row));
    const instructorRows = openRows.filter((row) => isInstructorAssignedRow(row, idsSet));
    const contactRows = await readContactsForSchool2027Activities(instructorRows);
    const rows = instructorRows.map((row) => withResolvedSchool2027Contact(row, contactRows));
    return { rows, teamGroups: buildInstructorTeamGroups(openRows, rows, contactResponsibles), summerContacts: summerPrintContactRows, contactRows: summerPrintContactRows, _source: 'supabase' };
  },


  schoolContactResponsibles: async (params = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const rows = await readSchoolContactResponsiblesRows({
      fromDate: params?.fromDate || params?.dateFrom || '',
      toDate: params?.toDate || params?.dateTo || '',
      schoolIds: params?.schoolIds || []
    });
    return { rows, _source: 'supabase' };
  },
  instructorSchedulePrintContacts: async () => {
    const rows = await readInstructorSchedulePrintContactsRows();
    return { rows, _source: 'supabase' };
  },
  saveSchoolContactResponsible: async ({ activityDate, schoolId = '', school = '', responsibleEmpId = '', responsibleName = '' } = {}) => {
    assertPermission('view_activity_approvals', 'activity_approvals_forbidden');
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
  completionApprovalUploads: async ({ limit = null, offset = 0, fromDate = '', toDate = '' } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const role = String(state?.user?.role || '').trim();
    let query = supabase
      .from('activity_completion_approval_uploads')
      .select(COMPLETION_APPROVAL_METADATA_COLUMNS)
      .order('activity_date', { ascending: false, nullsFirst: false })
      .order('uploaded_at', { ascending: false });
    if (fromDate) query = query.gte('activity_date', fromDate);
    if (toDate) query = query.lte('activity_date', toDate);
    // null/undefined limit = full metadata set for the filtered window (ops matching).
    if (limit != null) {
      const pageSize = Math.max(1, Number(limit) || COMPLETION_APPROVALS_PAGE_SIZE);
      const pageOffset = Math.max(0, Number(offset) || 0);
      query = query.range(pageOffset, pageOffset + pageSize - 1);
    }
    if (role === 'instructor') {
      query = query.in('instructor_emp_id', currentUserIdentityValues());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'completion_approval_uploads_read_failed');
    // Metadata only — signed URLs are created on explicit open/download.
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  completionApprovalSignedUrl: async ({ filePath, download = false } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
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
    assertPermission('view_activity_approvals', 'activity_approvals_forbidden');
    const nextStatus = String(status || '').trim();
    if (!['approved', 'rejected'].includes(nextStatus)) throw new Error('invalid_completion_approval_status');
    const reviewer = String(state?.user?.full_name || state?.user?.username || state?.user?.user_id || '').trim();
    const payload = { status: nextStatus, reviewed_by: reviewer, reviewed_at: new Date().toISOString(), review_note: String(reviewNote || '').trim() };
    const { data, error } = await supabase.from('activity_completion_approval_uploads').update(payload).eq('id', id).select('*').single();
    if (error) throw new Error(error.message || 'completion_approval_review_failed');
    return { row: data, _source: 'supabase' };
  },
  deleteCompletionApprovalUpload: async ({ id } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
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
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
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
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const role = String(state?.user?.role || '').trim();
    const ownEmpIds = currentUserIdentityValues();
    const requestedEmpId = String(instructorEmpId || approval?.instructorEmpId || '').trim();
    const fallbackOwnEmpId = String(state?.user?.emp_id || state?.user?.user_id || '').trim();
    let empId = requestedEmpId || fallbackOwnEmpId;
    if (!empId) throw new Error('חסר מזהה עובד למדריך.');
    if (role === 'instructor') {
      if (!ownEmpIds.includes(empId)) throw new Error('מדריך יכול להעלות אישור ביצוע רק עבור עצמו.');
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
  photoApprovalUploads: async ({ schoolIds = [], limit = null, offset = 0 } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const role = String(state?.user?.role || '').trim();
    let query = supabase
      .from('photo_approval_uploads')
      .select(PHOTO_APPROVAL_METADATA_COLUMNS)
      .order('uploaded_at', { ascending: false });
    const ids = (Array.isArray(schoolIds) ? schoolIds : []).map((id) => String(id || '').trim()).filter(Boolean);
    if (ids.length && ids.length <= 80) query = query.in('school_id', ids);
    if (limit != null) {
      const pageSize = Math.max(1, Number(limit) || COMPLETION_APPROVALS_PAGE_SIZE);
      const pageOffset = Math.max(0, Number(offset) || 0);
      query = query.range(pageOffset, pageOffset + pageSize - 1);
    }
    if (role === 'instructor') {
      query = query.in('instructor_emp_id', currentUserIdentityValues());
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'photo_approval_uploads_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  photoApprovalSignedUrl: async ({ filePath } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const path = String(filePath || '').trim();
    if (!path) throw new Error('missing_file_path');
    const { data, error } = await supabase.storage
      .from('photo-approvals')
      .createSignedUrl(path, 60 * 5);
    if (error) throw new Error(error.message || 'photo_approval_signed_url_failed');
    return { signedUrl: data?.signedUrl || '' };
  },
  uploadPhotoApproval: async ({ instructorEmpId, instructorName, school, authority, schoolId, file } = {}) => {
    assertAnyPermission(['view_activity_approvals', 'view_instructor_completion_approvals'], 'activity_approvals_forbidden');
    const role = String(state?.user?.role || '').trim();
    const ownEmpIds = currentUserIdentityValues();
    const empId = String(instructorEmpId || '').trim();
    if (!empId) throw new Error('חסר מזהה עובד למדריך.');
    if (role === 'instructor') {
      if (!ownEmpIds.includes(empId)) throw new Error('מדריך יכול להעלות אישור צילום רק עבור עצמו.');
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
    const allRows = await readAllActivitiesRowsSupabase({ activityPeriod: params?.activity_period || currentGlobalActivityPeriod() });
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
  proposalsAgreements: async (params = {}) => readProposalsAgreementsFromSupabase(params || {}),
  proposalsAgreementsEditorDeps: async () => readProposalsAgreementsEditorDepsFromSupabase(),
  proposalsAgreementsContacts: async () => readContactsSchoolsForProposals(),
  proposalAgreementDetail: async (proposalId) => {
    const row = await readProposalAgreementDetailFromSupabase(proposalId);
    if (!row) return null;
    const linked = await readProposalLinkedDocumentsFromSupabase({ proposalIds: [row.id] });
    const first = linked[0] || null;
    return {
      ...row,
      has_document_snapshot: Boolean(row?.document_snapshot && typeof row.document_snapshot === 'object'),
      has_document_html_snapshot: Boolean(String(row?.document_html_snapshot || '').trim()),
      gefen_approval_status: cleanProposalAgreementText(first?.status) || row.gefen_approval_status || 'missing',
      gefen_approval_path: cleanProposalAgreementText(first?.file_path) || row.gefen_approval_path || '',
      gefen_approval_file_name: cleanProposalAgreementText(first?.file_name) || row.gefen_approval_file_name || '',
      gefen_approval_combined: first ? first.combined_with_proposal === true : row.gefen_approval_combined === true,
      proposalLinkedDocuments: linked
    };
  },
  instructorActivityHistory: async (params = {}) => {
    const rows = await readInstructorActivityHistoryFromSupabase(params || {});
    return { rows, _source: 'supabase' };
  },
  proposalsPendingApprovedCount: async () => readProposalsPendingApprovedCountFromSupabase(),
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
      roleDefaults: ROLE_PERMISSION_TEMPLATES
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
  fundingSources: async ({ includeInactive = false } = {}) => {
    let query = supabase.from('funding_sources').select('id,name,is_active,sort_order,created_at,updated_at').order('sort_order', { ascending: true, nullsFirst: false }).order('name');
    if (!includeInactive) query = query.eq('is_active', true);
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'funding_sources_read_failed');
    return { rows: data || [] };
  },
  addFundingSource: async ({ name, sort_order = null } = {}) => {
    if (String(state?.user?.role || '') !== 'admin') throw new Error('forbidden_funding_catalog');
    const cleanName = String(name || '').trim();
    if (!cleanName) throw new Error('funding_source_name_required');
    const { data, error } = await supabase.from('funding_sources').insert({ name: cleanName, sort_order }).select().single();
    if (error) throw new Error(error.code === '23505' ? 'funding_source_duplicate' : (error.message || 'funding_source_save_failed'));
    return data;
  },
  updateFundingSource: async ({ id, name, is_active } = {}) => {
    if (String(state?.user?.role || '') !== 'admin') throw new Error('forbidden_funding_catalog');
    const changes = {};
    if (name !== undefined) changes.name = String(name || '').trim();
    if (is_active !== undefined) changes.is_active = Boolean(is_active);
    const { data, error } = await supabase.from('funding_sources').update(changes).eq('id', id).select().single();
    if (error) throw new Error(error.code === '23505' ? 'funding_source_duplicate' : (error.message || 'funding_source_save_failed'));
    return data;
  },
  adminLists: async () => {
    const supabaseData = await readListsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ categories: [] }, 'admin_lists_supabase_failed');
  },
  /**
   * Focused lists fetch for the workshop inventory tab.
   * Queries only activity_names + workshop_stock (~79 rows vs ~997 for adminLists).
   */
  workshopLists: async () => {
    assertPermission('view_workshop_stock', 'workshop_stock_forbidden');
    const supabaseData = await readWorkshopListsFromSupabase();
    if (supabaseData) return supabaseData;
    return buildSupabaseErrorPayload({ categories: [] }, 'workshop_lists_supabase_failed');
  },

  workshopStockDistributions: async () => {
    if (!hasPermission(state?.user, 'view_workshop_stock_distributions')) throw new Error('workshop_stock_distributions_forbidden');
    const { data, error } = await supabase
      .from('workshop_stock_distributions')
      .select('*');
    if (error) throw new Error(error.message || 'workshop_stock_distributions_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  workshopInventoryOpeningBalances: async ({ inventoryYear } = {}) => {
    assertPermission('view_workshop_stock', 'workshop_stock_forbidden');
    const year = Number(inventoryYear);
    let query = supabase
      .from('workshop_inventory_opening_balances')
      .select('inventory_year,activity_season,stock_group_key,workshop_numbers,workshop_name,holder_name,holder_type,opening_quantity');
    if (Number.isFinite(year) && year > 0) query = query.eq('inventory_year', year);
    const { data, error } = await query;
    if (error) throw new Error(error.message || 'workshop_inventory_opening_balances_read_failed');
    return { rows: Array.isArray(data) ? data : [], _source: 'supabase' };
  },
  updateWorkshopStockItems: updateWorkshopStockItemsInSupabase,
  addProposalAgreement: async (payload) => {
    assertCanManageProposalsAgreementsApi();
    assertCompleteProposalClientSnapshot(payload);
    const groupLookup = await getProposalGroupLookup();
    const insert = sanitizeProposalAgreementPayload(payload, groupLookup);
    const submissionId = uuidOrNull(payload?._submission_id);
    if (submissionId) insert.id = submissionId;
    const { data, error } = await supabase
      .from('proposals_agreements')
      .insert(insert)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    const recovered = await recoverIdempotentProposalInsert(error, submissionId, (id) => supabase
        .from('proposals_agreements')
        .select(PROPOSALS_AGREEMENTS_COLUMNS)
        .eq('id', id)
        .single());
    if (recovered) return recovered;
    if (error) throw new Error(error.message || 'proposals_agreement_add_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },

  updateProposalAgreement: async (id, payload) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    assertCompleteProposalClientSnapshot(payload);
    const groupLookup = await getProposalGroupLookup();
    const patch = sanitizeProposalAgreementPayload(payload, groupLookup);
    patch.updated_at = new Date().toISOString();
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposals_agreement_update_failed');
    return { ok: true, row: normalizeProposalAgreementRow(data) };
  },
  updateProposalAgreementGfenSignedOrOrdered: async (id, value) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const patch = {
      gfen_signed_or_ordered: value === true,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('proposals_agreements')
      .update(patch)
      .eq('id', rowId)
      .select(PROPOSALS_AGREEMENTS_COLUMNS)
      .single();
    if (error) throw new Error(error.message || 'proposal_gfen_signed_or_ordered_update_failed');
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
    const rowId = cleanProposalAgreementText(id);
    const cleanStatus = cleanProposalAgreementText(status);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    if (!PA_VALID_STATUSES_SET.has(cleanStatus)) throw new Error('invalid_proposal_agreement_status');
    if (['approved', 'returned_for_changes', 'cancelled'].includes(cleanStatus)) {
      if (!canApproveProposalsAgreementsApi()) throw new Error('proposals_agreements_approval_forbidden');
    } else {
      assertCanManageProposalsAgreementsApi();
    }
    if (cleanStatus === 'approved' && !(signatureMeta && typeof signatureMeta === 'object' && !Array.isArray(signatureMeta) && Object.keys(signatureMeta).length)) throw new Error('נדרשת חתימה לפני אישור ההצעה.');
    const patch = { status: statusForDb(cleanStatus), approval_note: cleanProposalAgreementText(approvalNote), updated_at: new Date().toISOString() };
    if (cleanStatus === 'approved') {
      patch.status = 'approved';
      const approvedByUuid = uuidOrNull(state?.user?.auth_user_id);
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
  requestProposalFinalPdf: async (id, payload = {}) => {
    const proposalId = cleanProposalAgreementText(id);
    if (!proposalId) throw new Error('missing_proposal_agreement_id');
    const documentSnapshot = payload?.documentSnapshot ?? payload?.document_snapshot;
    const documentHtmlSnapshot = cleanProposalAgreementText(payload?.documentHtmlSnapshot ?? payload?.document_html_snapshot);
    if (!documentSnapshot || typeof documentSnapshot !== 'object' || Array.isArray(documentSnapshot)) {
      throw new Error('missing_document_snapshot');
    }
    if (!documentHtmlSnapshot) throw new Error('missing_document_html_snapshot');
    const { data, error } = await supabase.functions.invoke('proposal-final-pdf', {
      body: { proposalId, documentSnapshot, documentHtmlSnapshot }
    });
    if (error) throw new Error(error.message || 'proposal_final_pdf_request_failed');
    return data || { ok: true, queued: true };
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
      if (!error?.__proposalPdfLogged) console.error('[proposal-pdf-failed]', { stage: pdfStage, proposalId: rowId, name: error?.name, message: error?.message });
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
  uploadGefenApprovalDocument: async (id, payload = {}) => {
    assertCanManageProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    const pdfFile = payload?.pdfFile || payload?.file || null;
    const documentSnapshot = payload?.documentSnapshot ?? payload?.document_snapshot ?? null;
    const documentHtmlSnapshot = String(payload?.documentHtmlSnapshot ?? payload?.document_html_snapshot ?? '').trim();
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    if (!proposalFinalPdfAllowedFile(pdfFile)) throw new Error('invalid_gefen_approval_pdf');
    if (!documentSnapshot || typeof documentSnapshot !== 'object' || Array.isArray(documentSnapshot)) {
      throw new Error('missing_gefen_approval_snapshot');
    }
    if (!documentHtmlSnapshot) throw new Error('missing_gefen_approval_html_snapshot');

    const [{ data: proposalRow, error: proposalError }, { data: itemRows, error: itemsError }] = await Promise.all([
      supabase
        .from('proposals_agreements_directory_view')
        .select('id,quote_number,semel_mosad,activity_type_group,final_pdf_path')
        .eq('id', rowId)
        .single(),
      supabase
        .from('proposal_agreement_items')
        .select('id,gefen_number,proposal_group,item_type,item_name')
        .eq('proposal_agreement_id', rowId)
    ]);
    if (proposalError || !proposalRow) throw new Error('proposals_agreement_not_found');
    if (itemsError) throw new Error(itemsError.message || 'proposal_items_read_failed');
    if (!cleanProposalAgreementText(proposalRow.semel_mosad)) {
      throw new Error('חסר מספר מוסד. יש להשלים אותו לפני הפקת אישור גפ״ן.');
    }
    const eligibleItems = (Array.isArray(itemRows) ? itemRows : []).filter((item) => {
      const group = normalizeProposalGroupValue(item?.proposal_group);
      return group !== 'summer'
        && Boolean(cleanProposalAgreementText(item?.gefen_number))
        && !isProposalTestHoursItem(item);
    });
    if (!eligibleItems.length) {
      throw new Error('חסר פירוט קורסים עם מספר גפ״ן. לא ניתן להפיק את האישור.');
    }

    const filePath = gefenApprovalPdfStoragePath(rowId);
    const uploaded = await supabase.storage
      .from(PROPOSAL_FINAL_PDF_BUCKET)
      .upload(filePath, pdfFile, { contentType: 'application/pdf', upsert: false });
    if (uploaded.error) throw new Error(uploaded.error.message || 'gefen_approval_pdf_upload_failed');
    const nowIso = new Date().toISOString();
    const linkedPayload = {
      proposal_agreement_id: rowId,
      document_type: GEFEN_APPROVAL_DOCUMENT_TYPE,
      status: 'generated',
      combined_with_proposal: false,
      file_path: filePath,
      file_name: String(pdfFile.name || 'gefen-approval.pdf').trim(),
      document_snapshot: documentSnapshot,
      document_html_snapshot: documentHtmlSnapshot,
      created_by: proposalLockActorName(),
      updated_at: nowIso
    };
    const { data, error } = await supabase
      .from('proposal_linked_documents')
      .upsert(linkedPayload, { onConflict: 'proposal_agreement_id,document_type' })
      .select('id,proposal_agreement_id,document_type,status,combined_with_proposal,file_path,file_name,created_at,updated_at')
      .single();
    if (error) throw new Error(error.message || 'gefen_approval_save_failed');
    return { ok: true, row: data };
  },
  getGefenApprovalSignedUrl: async (id) => {
    assertCanUseProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(id);
    if (!rowId) throw new Error('missing_proposal_agreement_id');
    const { data: linkedRow, error: linkedError } = await supabase
      .from('proposal_linked_documents')
      .select('file_path,file_name,status')
      .eq('proposal_agreement_id', rowId)
      .eq('document_type', GEFEN_APPROVAL_DOCUMENT_TYPE)
      .single();
    if (linkedError || !linkedRow) throw new Error('gefen_approval_missing');
    const filePath = cleanProposalAgreementText(linkedRow.file_path);
    if (cleanProposalAgreementText(linkedRow.status) !== 'generated' || !filePath) {
      throw new Error('gefen_approval_missing');
    }
    const { data, error } = await supabase.storage
      .from(PROPOSAL_FINAL_PDF_BUCKET)
      .createSignedUrl(filePath, 60 * 5, { download: false });
    if (error) throw new Error(error.message || 'gefen_approval_signed_url_failed');
    return {
      signedUrl: data?.signedUrl || '',
      fileName: cleanProposalAgreementText(linkedRow.file_name) || 'gefen-approval.pdf'
    };
  },
  readProposalAgreementItems: async (proposalId) => {
    assertCanUseProposalsAgreementsApi();
    const rowId = cleanProposalAgreementText(proposalId);
    if (!rowId) return [];
    // Display/read path: use an already-warmed lookup if present, but never fetch the
    // proposal catalog (groups/aliases/templates) just to show proposal/client-file items.
    const groupLookup = proposalGroupLookupCache || {
      groups: [],
      aliases: [],
      aliasToKey: new Map(),
      groupByKey: new Map()
    };
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
  readCurrentGefenCourses: async (gefenNumbers = []) => {
    assertCanUseProposalsAgreementsApi();
    const requested = Array.from(new Set((Array.isArray(gefenNumbers) ? gefenNumbers : [])
      .map(cleanProposalAgreementText).filter(Boolean)));
    if (!requested.length) return [];
    const { data, error } = await supabase
      .from('proposal_gefen_courses')
      .select('gefen_number,meetings_count,hours_count,hourly_price,total_price,is_active')
      .eq('is_active', true)
      .in('gefen_number', requested);
    if (error) throwProposalLoadError('gefenCoursesError', 'proposal_gefen_courses', error);
    return (Array.isArray(data) ? data : []).map((course) => ({
      gefen_number: cleanProposalAgreementText(course?.gefen_number),
      meetings_count: course?.meetings_count != null ? Number(course.meetings_count) : null,
      hours_count: course?.hours_count != null ? Number(course.hours_count) : null,
      hourly_price: course?.hourly_price != null ? Number(course.hourly_price) : null,
      total_price: course?.total_price != null ? Number(course.total_price) : null
    }));
  },
  readProposalActivityPricing: async () => {
    assertCanUseProposalsAgreementsApi();
    const groupLookup = await getProposalGroupLookup();
    const [generalRows, gefenRows] = await Promise.all([
      readProposalActivityPricingFromSupabase(),
      readProposalGefenCoursesFromSupabase()
    ]);
    return enrichProposalPricingRows([
      ...generalRows.filter((row) => normalizeProposalGroupValue(row?.proposal_group, groupLookup) !== 'gefen'),
      ...gefenRows
    ], groupLookup);
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
    const missingItemNameIndex = validItems.findIndex((item) => !cleanProposalAgreementText(item.item_name));
    if (missingItemNameIndex >= 0) {
      throw new Error(`חסר שם פעילות בשורה ${missingItemNameIndex + 1}. שמירת פריטי ההצעה לא בוצעה.`);
    }
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
      if (error) {
        const insertError = new Error(error.message || 'add_contact_failed');
        Object.assign(insertError, {
          code: error.code,
          details: error.details,
          hint: error.hint,
          constraint: error.constraint,
          status: error.status
        });
        throw insertError;
      }
      return { ok: true, row: data };
    }
    throw new Error('invalid_contact_kind');
  },
  findSchoolContactByUniqueIdentity: async ({ authority, school, contact_name: contactName }) => {
    const { data, error } = await supabase
      .from('contacts_schools')
      .select('*')
      .eq('authority', String(authority || '').trim())
      .eq('school', String(school || '').trim())
      .eq('contact_name', String(contactName || '').trim())
      .limit(2);
    if (error) throw new Error(error.message || 'school_contact_duplicate_lookup_failed');
    return { ok: true, rows: Array.isArray(data) ? data : [] };
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
    assertActivityPeriodEditable({ activity: payload.activity, changes: payload.activity });
    return upsertActivityToSupabase(payload);
  },
  submitCreateActivityRequest: async (activity) => {
    if (!canSubmitCreateActivityRequestsUser()) throw new Error('forbidden_create_activity_request');
    assertActivityPeriodEditable({ activity: activity || {}, changes: activity || {} });
    assertNewActivityHasNoInstructors(activity || {});
    await assertSchoolAuthorityLink(activity || {});
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
    assertPermission('can_edit_direct', 'forbidden_delete_activity');
    assertActivityPeriodEditable({ activity: await activityRowSeasonSnapshot(rowId) });
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
    const catalogAwareChanges = { ...(requestPayload?.changes || changes || {}) };
    if (catalogAwareChanges.activity_name_override === false && (
      catalogText(catalogAwareChanges.activity_no) || catalogText(catalogAwareChanges.gefen_number)
    )) {
      // Keep the request path identical to direct save so approvers see the
      // canonical catalog identity, while preserving an explicit price edit.
      Object.assign(catalogAwareChanges, await resolveCatalogActivityChanges(catalogAwareChanges));
    }
    const syncedChanges = applyInstructorEmpSync(catalogAwareChanges);
    const { data: existingInstructorRow, error: existingInstructorError } = await supabase
      .from('activities')
      .select('instructor_name,instructor_name_2,emp_id,emp_id_2,activity_season,start_date')
      .eq('row_id', rowId)
      .maybeSingle();
    if (existingInstructorError) throw buildSupabaseMutationError('submitEditRequest', existingInstructorError, 'submit_edit_request_failed');
    assertActivityPeriodEditable({ activity: existingInstructorRow, changes: syncedChanges });
    await validateActivityInstructorBindingsOrThrow({ ...(existingInstructorRow || {}), ...syncedChanges });
    const reducedChanges = Object.entries(syncedChanges).reduce((acc, [key, value]) => {
      if (value === undefined) return acc;
      if (key === 'exists_in_gefen' && typeof value === 'boolean') {
        acc[key] = value;
        return acc;
      }
      const isDateField = key === 'start_date' || key === 'end_date' || /^date_\d+$/.test(key) || /^meeting_date_\d+$/.test(key);
      if (value === null) {
        // A non-Gefen catalog selection must be able to clear a previously
        // saved Gefen number through an edit request, not only direct save.
        if (isDateField || key === 'gefen_number') acc[key] = null;
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
        const requestedValues = { ...parseJsonishObject(reqRow?.requested_values) };
        if (requestedValues.activity_name_override === false && (
          catalogText(requestedValues.activity_no) || catalogText(requestedValues.gefen_number)
        )) {
          Object.assign(requestedValues, await resolveCatalogActivityChanges(requestedValues));
        }
        const syncedRequestedValues = applyInstructorEmpSync(requestedValues);
        if (sourceRowId && syncedRequestedValues && Object.keys(syncedRequestedValues).length) {
          const sanitizedRequestedValues = sanitizeActivityPayloadForSupabase(
            mapMeetingDateFieldNamesToSupabase(syncedRequestedValues),
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
      if (['user_id', 'role', 'display_role', 'default_view', 'active', 'full_name', 'entry_code', 'emp_id', 'display_role2'].includes(k)) return;
      permissions[k] = v;
    });
    const nextRole = row.role || existing.data.role;
    const patch = {
      role: nextRole,
      display_role: row.display_role ?? existing.data.display_role,
      default_view: row.default_view ?? existing.data.default_view,
      is_active: String(row.active || '').toLowerCase() !== 'no',
      name: row.full_name ?? existing.data.name,
      emp_id: row.emp_id ?? existing.data.emp_id,
      permissions: {
        ...permissions,
        display_role2: row.display_role2 ?? permissions.display_role2 ?? ''
      }
    };
    for (const key of ['can_review_requests', 'view_proposals_agreements', 'manage_proposals_agreements', 'approve_proposals_agreements']) {
      if (Object.prototype.hasOwnProperty.call(row || {}, key)) patch[key] = row[key];
    }
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
    const permissions = { ...(ROLE_PERMISSION_TEMPLATES[role] || {}) };
    const insert = {
      user_id: String(row?.user_id || '').trim(),
      email: null,
      name: String(row?.full_name || '').trim(),
      role,
      display_role: String(row?.display_role || '').trim(),
      default_view: String(row?.default_view || '').trim(),
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
  israaSharedActivities: async () => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.from('activities').select('*').not('israa_tracking_id', 'is', null);
    if (error) throw new Error(error.message || 'israa_shared_activities_read_failed');
    return { rows: Array.isArray(data) ? data : [] };
  },
  saveIsraaActivityDraft: async (trackingId, proposalItemId, draft) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.rpc('save_israa_activity_draft', { p_tracking_id: trackingId, p_proposal_item_id: proposalItemId, p_draft: draft });
    if (error) throw new Error(error.message || 'israa_draft_save_failed');
    return { draft: data };
  },
  saveIsraaActivityGroupDraft: async (trackingId, proposalItemId, groupNumber, draft) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.rpc('save_israa_activity_group_draft', {
      p_tracking_id: trackingId,
      p_proposal_item_id: proposalItemId,
      p_group_number: groupNumber,
      p_draft: draft
    });
    if (error) throw new Error(error.message || 'israa_group_draft_save_failed');
    return { draft: data };
  },
  shareIsraaActivityGroup: async (trackingId, proposalItemId, groupNumber) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.rpc('share_israa_activity_group', {
      p_tracking_id: trackingId,
      p_proposal_item_id: proposalItemId,
      p_group_number: groupNumber
    });
    if (error) throw new Error(error.message || 'israa_activity_group_share_failed');
    return data;
  },
  shareIsraaActivity: async (trackingId, proposalItemId) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.rpc('share_israa_activity', { p_tracking_id: trackingId, p_proposal_item_id: proposalItemId });
    if (error) throw new Error(error.message || 'israa_activity_share_failed');
    return data;
  },
  updateIsraaSharedActivity: async (rowId, changes) => {
    await waitForSupabaseAuthSession();
    const { data, error } = await supabase.rpc('update_israa_shared_activity', { p_row_id: rowId, p_changes: changes });
    if (error) throw new Error(error.message || 'israa_shared_activity_update_failed');
    return { row: data };
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
  canonicalOneDayActivityType,
  flattenUserRow,
  buildBootstrapFromUser,
  mergeBootstrapPermissionsIntoUser,
  buildProposalGroupLookup,
  buildProposalGroupHintsFromTemplateSections,
  mergeProposalGroupLookups,
  proposalPermissionFlagsFromFlatUser,
  proposalSessionUserFlagsFromFlatUser,
  canUseProposalsAgreementsApi,
  canManageProposalsAgreementsApi,
  canApproveProposalsAgreementsApi,
  statusForDb,
  normalizeProposalAgreementRow,
  sanitizeProposalAgreementPayload,
  USER_PUBLIC_COLUMNS,
  USER_PUBLIC_COLUMNS_EXTENDED
};
