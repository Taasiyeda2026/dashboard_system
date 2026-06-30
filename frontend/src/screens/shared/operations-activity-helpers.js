import { getActivityDateColumns, formatTimeRangeShort } from './format-date.js';
import { isSummerActivity, normalizeActivitySeason, ACTIVITY_SEASON_SUMMER_2026, ACTIVITY_SEASON_SCHOOL_2027 } from './summer-activity.js';

const INVALID_INSTRUCTOR_NAMES = new Set(['-', 'לא משויך', 'ללא שיוך']);

export const KIRYAT_MOSHE_REHOVOT_AUTHORITY = 'קריית משה (רחובות)';

export function parseLinkedSchoolsJson(row) {
  const raw = row?.linked_schools_json;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch (_) { return []; }
  }
  return [];
}

export function getActivitySchoolNames(row) {
  const names = new Set();
  parseLinkedSchoolsJson(row).forEach((s) => {
    const n = String(s?.school_name || '').trim();
    if (n) names.add(n);
  });
  const lsn = String(row?.linked_school_names || '').trim();
  if (lsn) lsn.split(/\s*\+\s*|\s*[,،]\s*/).forEach((n) => { const t = n.trim(); if (t) names.add(t); });
  const ssn = String(row?.single_school_name || '').trim();
  if (ssn) names.add(ssn);
  const school = String(row?.school || '').trim();
  if (school) names.add(school);
  const legacy = String(row?.legacy_school || '').trim();
  if (legacy) names.add(legacy);
  return Array.from(names);
}

export function getActivitySchoolDisplayName(activity) {
  const lsn = String(activity?.linked_school_names || '').trim();
  if (lsn) return lsn;
  const ssn = String(activity?.single_school_name || '').trim();
  if (ssn) return ssn;
  const school = String(activity?.school || '').trim();
  if (school) return school;
  const legacy = String(activity?.legacy_school || '').trim();
  if (legacy) return legacy;
  return 'לא משויך';
}

export function hasActivitySchoolOrFrame(activity) {
  if (activity?.school_id) return true;
  if (activity?.single_school_id) return true;
  if (Number(activity?.linked_schools_count || 0) > 0) return true;
  if (parseLinkedSchoolsJson(activity).length > 0) return true;
  if (String(activity?.school || '').trim()) return true;
  if (String(activity?.legacy_school || '').trim()) return true;
  return false;
}

const ACTIVITY_INSTRUCTOR_FIELDS = ['instructor_name', 'instructor', 'guide_name', 'guide', 'instructor_name_2', 'instructor_2', 'guide_name_2', 'guide_2'];

export function getActivityInstructorNames(activity) {
  const names = [];
  const seen = new Set();
  ACTIVITY_INSTRUCTOR_FIELDS.forEach((field) => {
    const value = String(activity?.[field] || '').trim();
    if (!value || INVALID_INSTRUCTOR_NAMES.has(value) || seen.has(value)) return;
    seen.add(value);
    names.push(value);
  });
  return names;
}

export function getActivityInstructorName(activity) {
  return getActivityInstructorNames(activity)[0] || 'לא משויך';
}

export function isValidInstructorName(name) {
  const value = String(name || '').trim();
  return Boolean(value) && !INVALID_INSTRUCTOR_NAMES.has(value);
}

function normalizeIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

export function getActivityPrimaryDate(activity) {
  for (const field of ['start_date', 'activity_date', 'date', 'date_1']) {
    const value = normalizeIsoDate(activity?.[field]);
    if (value) return value;
  }
  const meetingDates = Array.isArray(activity?.meeting_dates) && activity.meeting_dates.length
    ? activity.meeting_dates
    : getActivityDateColumns(activity);
  if (meetingDates.length) return normalizeIsoDate(meetingDates[0]);
  return '';
}

export function getActivityScheduleDates(activity) {
  const meetingDates = getActivityDateColumns(activity).map(normalizeIsoDate).filter(Boolean);
  if (meetingDates.length) return meetingDates;
  const primary = getActivityPrimaryDate(activity);
  return primary ? [primary] : [];
}

function normalizeOpsAuthorityText(value) {
  return String(value || '')
    .trim()
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function isShavitSchool(activity) {
  return getActivitySchoolNames(activity).some((name) => normalizeOpsAuthorityText(name) === normalizeOpsAuthorityText('שביט'));
}

export function getActivityAuthorityName(activity) {
  const authority = String(
    activity?.authority_name ||
    activity?.legacy_authority ||
    activity?.authority ||
    ''
  ).trim();
  if (isShavitSchool(activity)) return KIRYAT_MOSHE_REHOVOT_AUTHORITY;
  return authority || 'לא משויך';
}

export function getActivityDistrict(activity) {
  return String(activity?.authority_district || activity?.district || '').trim() || 'ללא מחוז / לא משויך';
}

export function getActivityName(activity) {
  return String(activity?.activity_name || activity?.name || activity?.title || activity?.program_name || '').trim() || 'ללא שם';
}

export function getActivityTimeRange(activity) {
  const start = activity?.start_time ?? activity?.StartTime;
  const end = activity?.end_time ?? activity?.EndTime;
  const formatted = formatTimeRangeShort(start, end);
  return formatted === '—' ? '' : formatted;
}

export const WORKSHOP_ESTIMATE_PER_ACTIVITY = 25;

function parsePositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeWorkshopProductKey(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseStockQuantityFromRow(row = {}) {
  const candidates = [
    row.stock_quantity,
    row.stock_qty,
    row.inventory_quantity,
    row.inventory_qty,
    row.stock,
    row.inventory,
    row.quantity,
    row.amount,
    row.qty
  ];
  for (const candidate of candidates) {
    const n = parsePositiveNumber(candidate);
    if (n !== null) return n;
  }
  const metadata = parseJsonObject(row.metadata);
  if (metadata) {
    for (const key of ['stock_quantity', 'stock_qty', 'inventory_quantity', 'inventory', 'stock', 'quantity']) {
      const n = parsePositiveNumber(metadata[key]);
      if (n !== null) return n;
    }
  }
  return null;
}

const WORKSHOP_STOCK_LIST_CATEGORIES = new Set([
  'workshop_stock'
]);

function isActivityNameWorkshopListRow(row = {}, category = '') {
  const cat = String(category || row?.category || '').trim().toLowerCase();
  if (cat !== 'activity_names') return false;
  const type = String(row?.type || '').trim().toLowerCase();
  const activityType = String(row?.activity_type || '').trim().toLowerCase();
  if (type && type !== 'workshop') return false;
  if (activityType && activityType !== 'workshop') return false;
  return true;
}


function addStockToMap(map, names, stock) {
  if (stock === null) return;
  names.map((name) => String(name || '').trim()).filter(Boolean).forEach((name) => {
    map.set(normalizeWorkshopProductKey(name), stock);
  });
}

export function buildWorkshopStockMapFromLists(listsData) {
  const map = new Map();
  const categories = Array.isArray(listsData?.categories) ? listsData.categories : [];
  let sawWorkshopStock = false;
  categories.forEach(({ category, items }) => {
    const cat = String(category || '').trim().toLowerCase();
    if (!WORKSHOP_STOCK_LIST_CATEGORIES.has(cat)) return;
    sawWorkshopStock = true;
    const list = Array.isArray(items) ? items : [];
    list.forEach((item) => {
      const row = item?._row && typeof item._row === 'object' ? item._row : item;
      if (row?.active === false) return;
      const stock = parseStockQuantityFromRow(row);
      if (stock === null) return;
      addStockToMap(map, [row?.label, row?.value, item?.label, item?.value], stock);
    });
  });
  if (!sawWorkshopStock) {
    categories.forEach(({ category, items }) => {
      const cat = String(category || '').trim().toLowerCase();
      if (cat !== 'activity_names') return;
      const list = Array.isArray(items) ? items : [];
      list.forEach((item) => {
        const row = item?._row && typeof item._row === 'object' ? item._row : item;
        if (!isActivityNameWorkshopListRow(row, cat) || row?.active === false) return;
        const stock = parseStockQuantityFromRow(row);
        if (stock === null) return;
        addStockToMap(map, [row?.activity_name, row?.label, row?.value, item?.label, item?.value], stock);
      });
    });
  }
  return map;
}

export function getWorkshopStockQuantity(productName, stockMap) {
  if (!(stockMap instanceof Map)) return null;
  const key = normalizeWorkshopProductKey(productName);
  if (!key || !stockMap.has(key)) return null;
  return stockMap.get(key);
}

export function getActivityActualParticipantCount(activity) {
  const n = parsePositiveNumber(activity?.participants_count);
  if (n !== null && n > 0) return n;
  return null;
}

export function getActivityOperationalQuantity(activity) {
  const count = getActivityActualParticipantCount(activity);
  return count !== null ? count : WORKSHOP_ESTIMATE_PER_ACTIVITY;
}

export function getActivityRequiredInventoryQuantity(activity) {
  const count = getActivityActualParticipantCount(activity);
  return count !== null ? count : 0;
}

export function sumRequiredInventoryQuantitiesFromActivities(activities = []) {
  return (Array.isArray(activities) ? activities : []).reduce((total, activity) => {
    return total + getActivityRequiredInventoryQuantity(activity);
  }, 0);
}

export function sumOperationalQuantitiesFromActivities(activities = []) {
  return (Array.isArray(activities) ? activities : []).reduce((total, activity) => {
    return total + getActivityOperationalQuantity(activity);
  }, 0);
}

export function sumActivityParticipantCounts(activities = []) {
  let total = 0;
  let hasAny = false;
  (Array.isArray(activities) ? activities : []).forEach((activity) => {
    const count = getActivityActualParticipantCount(activity);
    if (count === null) return;
    total += count;
    hasAny = true;
  });
  return hasAny ? total : null;
}

export function buildWorkshopQuantityMetrics({ workshopName, activityCount, activities = [], stockMap } = {}) {
  const count = Number(activityCount || 0);
  const estimatedQuantity = count * WORKSHOP_ESTIMATE_PER_ACTIVITY;
  const actualQuantity = sumActivityParticipantCounts(activities);
  const stockQuantity = getWorkshopStockQuantity(workshopName, stockMap);
  let gap = null;
  if (stockQuantity !== null) {
    gap = stockQuantity - estimatedQuantity;
  }
  return {
    workshopName: String(workshopName || '').trim(),
    activityCount: count,
    estimatedQuantity,
    actualQuantity,
    stockQuantity,
    gap
  };
}

export function getActivityGroupsCount(activity) {
  const raw = activity?.groups_count ?? activity?.group_count ?? activity?.num_groups ?? activity?.groups ?? '';
  const text = String(raw || '').trim();
  return text || '';
}

export function getActivityGradeLabel(activity) {
  return String(activity?.grade || activity?.class_group || activity?.group || activity?.class || '').trim();
}

export function getActivityAddress(activity) {
  return String(activity?.address || activity?.school_address || '').trim();
}

export function getActivityContactName(activity) {
  return String(activity?.contact_name || activity?.school_contact_name || '').trim();
}

export function getActivityContactPhone(activity) {
  return String(activity?.contact_phone || activity?.phone || activity?.mobile || '').trim();
}

export function getActivityOperationalNotes(activity) {
  return String(activity?.operations_private_notes || activity?.private_note || activity?.notes || '').trim();
}

export function activityMatchesPeriod(activity, periodKey) {
  const key = String(periodKey || 'all').trim();
  if (!key || key === 'all') return true;
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);
  if (key === ACTIVITY_SEASON_SUMMER_2026) return season === ACTIVITY_SEASON_SUMMER_2026 || isSummerActivity(activity);
  if (key === ACTIVITY_SEASON_SCHOOL_2027) return season === ACTIVITY_SEASON_SCHOOL_2027;
  if (key === 'school_2026') return season !== ACTIVITY_SEASON_SUMMER_2026 && season !== ACTIVITY_SEASON_SCHOOL_2027;
  return true;
}

export function isActivityDeleted(activity) {
  return String(activity?.status || '').trim() === 'נמחק';
}

export function activityDatesInRange(activity, fromDate, toDate) {
  const from = normalizeIsoDate(fromDate);
  const to = normalizeIsoDate(toDate);
  return getActivityScheduleDates(activity).filter((date) => {
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}

export function activityOverlapsDateRange(activity, fromDate, toDate) {
  const datesInRange = activityDatesInRange(activity, fromDate, toDate);
  if (datesInRange.length) return true;
  const start = normalizeIsoDate(activity?.start_date || activity?.date_start || '');
  const end = normalizeIsoDate(activity?.end_date || activity?.date_end || '') || start;
  const from = normalizeIsoDate(fromDate);
  const to = normalizeIsoDate(toDate);
  if (!start && !end) return !from && !to;
  const rowStart = start || end;
  const rowEnd = end || start;
  if (to && rowStart > to) return false;
  if (from && rowEnd < from) return false;
  return true;
}

export function isSummerOperationsException(activity) {
  const season = normalizeActivitySeason(activity?.activity_season ?? activity?.activitySeason);
  if (season !== ACTIVITY_SEASON_SUMMER_2026 && !isSummerActivity(activity)) return false;
  const instructor = getActivityInstructorName(activity);
  const missingInstructor = instructor === 'לא משויך';
  const missingDate = !getActivityPrimaryDate(activity) && getActivityScheduleDates(activity).length === 0;
  return missingInstructor || missingDate;
}

export function schoolGroupKey(activity) {
  return `${getActivityAuthorityName(activity)}::${getActivitySchoolDisplayName(activity)}`;
}

export function buildActivitySearchText(activity) {
  const parts = [
    activity?.RowID,
    activity?.row_id,
    activity?.activity_no,
    getActivityName(activity),
    getActivityAuthorityName(activity),
    getActivityDistrict(activity),
    ...getActivityInstructorNames(activity),
    activity?.instructor_name,
    activity?.instructor,
    activity?.guide_name,
    activity?.guide,
    activity?.instructor_name_2,
    activity?.instructor_2,
    activity?.guide_name_2,
    activity?.guide_2,
    activity?.authority,
    activity?.legacy_authority,
    activity?.authority_name,
    activity?.school,
    activity?.legacy_school,
    activity?.single_school_name,
    activity?.linked_school_names,
    activity?.single_semel_mosad,
    activity?.linked_semel_mosad_list,
    activity?.status,
    getActivityPrimaryDate(activity),
    ...getActivityScheduleDates(activity),
    ...getActivitySchoolNames(activity)
  ];
  return parts.map((v) => String(v || '').trim()).filter(Boolean).join(' ').toLowerCase();
}
