import { api } from './api.js';
import './summer-feedback-admin-integration.js';
import './summer-feedback-instructor-card.js';

const TYPE_DEFINITIONS = [
  { key: 'course', id: 'active_courses', action: 'kpi|active_courses', subtitle: 'קורסים' },
  { key: 'workshop', id: 'active_workshops', action: 'kpi|active_workshops', subtitle: 'סדנאות' },
  { key: 'escape_room', id: 'active_escape_room', action: 'kpi|active_escape_room', subtitle: 'חדר בריחה' },
  { key: 'tour', id: 'active_tours', action: 'kpi|active_tours', subtitle: 'סיורים' },
  { key: 'after_school', id: 'active_after_school', action: 'kpi|active_after_school', subtitle: 'אפטרסקול' }
];

const EXCLUDED_MONTHLY_STATUSES = new Set([
  'נמחק',
  'בוטל',
  'deleted',
  'cancelled',
  'canceled'
]);

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeDate(value) {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(cleanText(value));
  return match ? match[1] : '';
}

function normalizeActivityType(row = {}) {
  const raw = cleanText(row.activity_type || row.type || row.kind);
  const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (compact === 'course' || raw === 'קורס' || raw === 'קורסים') return 'course';
  if (compact === 'workshop' || raw === 'סדנה' || raw === 'סדנאות') return 'workshop';
  if (compact === 'escaperoom' || raw === 'חדר בריחה' || raw === 'חדרי בריחה') return 'escape_room';
  if (compact === 'tour' || raw === 'סיור' || raw === 'סיורים') return 'tour';
  if (compact === 'afterschool' || raw === 'אפטרסקול' || raw === 'חוג אפטרסקול') return 'after_school';
  return raw.toLowerCase();
}

function isExcludedMonthlyRow(row = {}) {
  return EXCLUDED_MONTHLY_STATUSES.has(cleanText(row.status).toLowerCase());
}

function rowHasDatePointInMonth(row = {}, month = '') {
  if (!/^\d{4}-\d{2}$/.test(month)) return false;
  if (normalizeDate(row.start_date || row.date_start).startsWith(month)) return true;
  if (normalizeDate(row.end_date || row.date_end).startsWith(month)) return true;
  for (let index = 1; index <= 35; index += 1) {
    const value = row[`date_${index}`] ?? row[`Date${index}`];
    if (normalizeDate(value).startsWith(month)) return true;
  }
  return false;
}

function isProgramRow(row = {}, type = normalizeActivityType(row)) {
  const family = cleanText(row.activity_family).toLowerCase();
  return family === 'program' || type === 'course' || type === 'after_school';
}

function isOneDayRow(row = {}, type = normalizeActivityType(row)) {
  const family = cleanText(row.activity_family).toLowerCase();
  return family === 'one_day' || type === 'workshop' || type === 'escape_room' || type === 'tour';
}

function addInstructor(identitySet, nameSet, empId, name) {
  const normalizedName = cleanText(name);
  const normalizedId = cleanText(empId);
  const identity = normalizedName
    ? `name:${normalizedName.toLocaleLowerCase('he')}`
    : (normalizedId ? `id:${normalizedId}` : '');
  if (!identity) return;
  identitySet.add(identity);
  nameSet?.add(normalizedName || normalizedId);
}

function emptyDistrictStats(name) {
  return {
    activity_manager: name,
    total_long: 0,
    total_short: 0,
    total_activities: 0,
    num_instructors: 0,
    _instructors: new Set(),
    exceptions: 0,
    course_endings: 0
  };
}

function districtNameFromRow(row = {}) {
  return cleanText(row.district || row.activity_manager) || 'ללא מחוז';
}

function buildKpiCards(typeCounts, uniqueInstructorCount, courseEndings, payload = {}) {
  const exceptionsUnavailable = payload.exceptionsUnavailable === true || payload.summary?.exceptions_unavailable === true;
  const exceptionValue = exceptionsUnavailable
    ? 'לא זמין'
    : asNumber(
      payload.summary?.operational_gaps_unique_count ??
      payload.summary?.totalExceptionRows ??
      payload.summary?.total_exception_rows ??
      payload.summary?.exceptions_count ??
      payload.totals?.exceptions_count ??
      payload.exceptionCount ??
      payload.summary?.totalExceptionInstances ??
      0
    );

  const typeCards = TYPE_DEFINITIONS.map(({ key, id, action, subtitle }) => {
    const value = asNumber(typeCounts[key]);
    return { id, action, subtitle, title: String(value), value };
  });

  return [
    ...typeCards,
    { id: 'endings', action: 'kpi|endings', subtitle: 'סיומי קורסים', title: String(courseEndings), value: courseEndings },
    { id: 'instructors', action: 'kpi|instructors', subtitle: 'מדריכים משובצים', title: String(uniqueInstructorCount), value: uniqueInstructorCount },
    { id: 'exceptions', action: 'kpi|exceptions', subtitle: 'חריגות פתוחות', title: String(exceptionValue), value: exceptionValue }
  ];
}

function fallbackNormalize(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const typeCounts = {
    ...(payload.activeTypeCounts || payload.summary?.active_type_counts || {})
  };
  delete typeCounts.summer;
  const uniqueInstructorCount = asNumber(
    payload.uniqueInstructorCount ??
    payload.summary?.active_instructors_count ??
    payload.totals?.total_instructors
  );
  const courseEndings = asNumber(
    payload.courseEndings ??
    payload.summary?.ending_courses_current_month ??
    payload.totals?.total_course_endings_current_month
  );
  const kpiCards = buildKpiCards(typeCounts, uniqueInstructorCount, courseEndings, payload);
  return {
    ...payload,
    activeTypeCounts: typeCounts,
    totalTypeCounts: typeCounts,
    summary: payload.summary && typeof payload.summary === 'object'
      ? { ...payload.summary, active_type_counts: typeCounts }
      : payload.summary,
    kpi_cards: kpiCards,
    cards: kpiCards
  };
}

function buildFullMonthPayload(payload, rows, month) {
  const monthlyRows = (Array.isArray(rows) ? rows : [])
    .filter((row) => !isExcludedMonthlyRow(row))
    .filter((row) => rowHasDatePointInMonth(row, month));

  const typeCounts = {};
  const instructorIdentities = new Set();
  const instructorNames = new Set();
  const districtMap = new Map();

  function districtStats(name) {
    const key = cleanText(name) || 'ללא מחוז';
    if (!districtMap.has(key)) districtMap.set(key, emptyDistrictStats(key));
    return districtMap.get(key);
  }

  for (const row of monthlyRows) {
    const type = normalizeActivityType(row);
    if (type) typeCounts[type] = asNumber(typeCounts[type]) + 1;

    addInstructor(instructorIdentities, instructorNames, row.emp_id, row.instructor_name);
    addInstructor(instructorIdentities, instructorNames, row.emp_id_2, row.instructor_name_2);

    const stats = districtStats(districtNameFromRow(row));
    stats.total_activities += 1;
    if (isProgramRow(row, type)) stats.total_long += 1;
    if (isOneDayRow(row, type)) stats.total_short += 1;
    addInstructor(stats._instructors, null, row.emp_id, row.instructor_name);
    addInstructor(stats._instructors, null, row.emp_id_2, row.instructor_name_2);
  }

  const endingRows = monthlyRows.filter((row) => {
    const type = normalizeActivityType(row);
    return (type === 'course' || type === 'after_school') && normalizeDate(row.end_date || row.date_end).startsWith(month);
  });

  for (const row of endingRows) {
    districtStats(districtNameFromRow(row)).course_endings += 1;
  }

  const originalDistrictOrder = [];
  for (const original of Array.isArray(payload.by_activity_manager) ? payload.by_activity_manager : []) {
    const name = cleanText(original.activity_manager);
    if (!name) continue;
    originalDistrictOrder.push(name);
    districtStats(name).exceptions = asNumber(original.exceptions);
  }

  const orderIndex = new Map(originalDistrictOrder.map((name, index) => [name, index]));
  const byActivityManager = [...districtMap.values()]
    .map((stats) => {
      stats.num_instructors = stats._instructors.size;
      delete stats._instructors;
      return stats;
    })
    .sort((a, b) => {
      const aIndex = orderIndex.has(a.activity_manager) ? orderIndex.get(a.activity_manager) : Number.MAX_SAFE_INTEGER;
      const bIndex = orderIndex.has(b.activity_manager) ? orderIndex.get(b.activity_manager) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex || a.activity_manager.localeCompare(b.activity_manager, 'he');
    });

  const uniqueInstructorCount = instructorIdentities.size;
  const courseEndings = endingRows.length;
  const kpiCards = buildKpiCards(typeCounts, uniqueInstructorCount, courseEndings, payload);
  const totals = {
    ...(payload.totals || {}),
    total_short_activities: monthlyRows.filter((row) => isOneDayRow(row)).length,
    total_long_activities: monthlyRows.filter((row) => isProgramRow(row)).length,
    total_activities: monthlyRows.length,
    total_instructors: uniqueInstructorCount,
    total_course_endings_current_month: courseEndings
  };
  const summary = {
    ...(payload.summary || {}),
    active_type_counts: typeCounts,
    active_instructors: [...instructorNames].sort((a, b) => a.localeCompare(b, 'he')),
    active_instructors_count: uniqueInstructorCount,
    ending_courses_current_month: courseEndings,
    monthly_scope: 'full_month_excluding_deleted_cancelled'
  };

  return {
    ...payload,
    totals,
    summary,
    by_activity_manager: byActivityManager,
    activeTypeCounts: typeCounts,
    totalTypeCounts: typeCounts,
    uniqueInstructorCount,
    courseEndings,
    kpi_cards: kpiCards,
    cards: kpiCards,
    rows: monthlyRows,
    no_data_message: monthlyRows.length === 0 ? 'אין נתונים לחודש זה' : '',
    monthly_scope: 'full_month_excluding_deleted_cancelled'
  };
}

async function normalizeDashboardKpis(payload, args) {
  if (!payload || typeof payload !== 'object') return payload;
  const filters = args?.[0] && typeof args[0] === 'object' ? args[0] : {};
  const month = cleanText(payload.month || filters.month || filters.ym).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || typeof api.allActivities !== 'function') {
    return fallbackNormalize(payload);
  }

  try {
    const allActivities = await api.allActivities({});
    return buildFullMonthPayload(payload, allActivities?.rows, month);
  } catch (error) {
    console.warn('[dashboard-monthly-scope] full-month calculation failed; using consistent open-row fallback', {
      month,
      error: error?.message || String(error)
    });
    return fallbackNormalize(payload);
  }
}

const originalDashboardReadModel = api.dashboardReadModel?.bind(api);
if (typeof originalDashboardReadModel === 'function') {
  api.dashboardReadModel = async (...args) => normalizeDashboardKpis(await originalDashboardReadModel(...args), args);
}

const DASHBOARD_INFO_TEXT = 'לוח הבקרה מציג את מלוא היקף הפעילויות בחודש שנבחר. פעילויות סגורות נכללות, פעילויות שנמחקו או בוטלו אינן נספרות. החריגות מוצגות לפי המצב הפתוח כעת.';
const MANAGER_LABEL_REPLACEMENTS = new Map([
  ['פעילויות פעילות', 'פעילויות בחודש'],
  ['מדריכים פעילים', 'מדריכים משובצים'],
  ['סה"כ חריגות', 'חריגות פתוחות'],
  ['סה״כ חריגות', 'חריגות פתוחות']
]);
const SUMMARY_TITLE_REPLACEMENTS = new Map([
  ['פעילויות פעילות החודש:', 'היקף הפעילויות בחודש:'],
  ['המדריכים הפעילים החודש:', 'המדריכים המשובצים בחודש:'],
  ['חריגות החודש:', 'חריגות פתוחות כעת:']
]);

function replaceExactText(element, replacements) {
  const current = cleanText(element?.textContent);
  const next = replacements.get(current);
  if (next && current !== next) element.textContent = next;
}

function correctDashboardCopy() {
  const dashboard = document.querySelector('#app .ds-dashboard-wrap');
  if (!dashboard) return;

  dashboard.querySelectorAll('.ds-dash-info-tooltip').forEach((element) => {
    if (element.textContent !== DASHBOARD_INFO_TEXT) element.textContent = DASHBOARD_INFO_TEXT;
  });
  dashboard.querySelectorAll('.ds-manager-stat__label').forEach((element) => replaceExactText(element, MANAGER_LABEL_REPLACEMENTS));
  dashboard.querySelectorAll('.ds-summary-panel__inner-title strong').forEach((element) => replaceExactText(element, SUMMARY_TITLE_REPLACEMENTS));
  dashboard.querySelectorAll('.ds-summary-panel__text.ds-muted').forEach((element) => {
    if (cleanText(element.textContent) === 'אין פעילויות פעילות') element.textContent = 'אין פעילויות בחודש';
  });
  dashboard.querySelectorAll('.ds-summary-panel__text strong').forEach((element) => {
    const current = cleanText(element.textContent);
    if (current.startsWith('סה״כ חריגות:')) {
      element.textContent = current.replace(/^סה״כ חריגות:/, 'סה״כ חריגות פתוחות:');
    }
  });
}

let correctionQueued = false;
function scheduleDashboardCopyCorrection() {
  if (correctionQueued) return;
  correctionQueued = true;
  queueMicrotask(() => {
    correctionQueued = false;
    correctDashboardCopy();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleDashboardCopyCorrection, { once: true });
  } else {
    scheduleDashboardCopyCorrection();
  }
  new MutationObserver(scheduleDashboardCopyCorrection).observe(document.documentElement, { childList: true, subtree: true });
}
