import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import {
  buildPrintKitSummary,
  isActiveInstructor,
  resolveCourseForActivity,
  resolveWorkshopStockKey,
  trainingCellState
} from './shared/operations-2027-domain.js';
import { operationsManagementScreen } from './operations-management.js';

const SCHOOL_2027 = 'school_2027';
const TAB_WORKSHOP_TRAINING = 'summer_training_matrix';
const TAB_COURSE_TRAINING = 'course_training_matrix';
const TAB_PRINT_KITS = 'course_print_kits';
const COURSE_TABLE = 'proposal_gefen_courses';
const INSTRUCTOR_TABLE = 'contacts_instructors';
const ACTIVITY_TABLE = 'activities';
const WORKSHOP_CATALOG_TABLE = 'lists';
const WORKSHOP_TRAINING_TABLE = 'summer_workshop_trainings';
const COURSE_TRAINING_TABLE = 'course_instructor_trainings';
const KIT_INVENTORY_TABLE = 'course_print_kit_inventory';
const KIT_DISTRIBUTION_TABLE = 'course_print_kit_distributions';
const BIOMIMICRY_ESCAPE_ROOM_KIT = 'ביומימיקרי חדר בריחה';
const INSTALL_MARKER = '__operations2027LoadingControllerInstalled';
const WORKSHOP_STOCK_ALIASES = Object.freeze({
  'פרוגי המקפצת': 'froggy',
  'ציפור שיווי משקל': 'bird-balance',
  'קלידוסקופ': 'kaleidoscope',
  'שעון רובוט - הזמן שלנו': 'robot-clock'
});
const KIT_LOCATIONS = Object.freeze([
  { key: 'warehouse', field: 'warehouse_quantity', label: 'מחסן' },
  { key: 'hila', field: 'hila_quantity', label: 'הילה' },
  { key: 'idan', field: 'idan_quantity', label: 'עידן' },
  { key: 'gil', field: 'gil_quantity', label: 'גיל' }
]);

export const TAB_LOAD_STATES = Object.freeze({
  NOT_LOADED: 'not_loaded',
  LOADING: 'loading',
  LOADED: 'loaded',
  ERROR: 'error'
});

export function createOperations2027Store() {
  return {
    tabStates: new Map(),
    tabCache: new Map(),
    tabPromises: new Map(),
    sourceCache: new Map(),
    sourcePromises: new Map()
  };
}

let store = createOperations2027Store();
let activeCustomTab = '';
let renderToken = 0;

export function getOperations2027Store() {
  return store;
}

export function disposeOperations2027LoadingCache() {
  store = createOperations2027Store();
  activeCustomTab = '';
  renderToken += 1;
}

export function loadOperations2027Source(key, loader) {
  if (store.sourceCache.has(key)) return Promise.resolve(store.sourceCache.get(key));
  if (store.sourcePromises.has(key)) return store.sourcePromises.get(key);
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      store.sourceCache.set(key, value);
      return value;
    })
    .catch((error) => {
      store.sourceCache.delete(key);
      throw error;
    })
    .finally(() => store.sourcePromises.delete(key));
  store.sourcePromises.set(key, promise);
  return promise;
}

export function loadOperations2027Tab(tabKey, loader) {
  if (store.tabStates.get(tabKey) === TAB_LOAD_STATES.LOADED && store.tabCache.has(tabKey)) {
    return Promise.resolve(store.tabCache.get(tabKey));
  }
  if (store.tabPromises.has(tabKey)) return store.tabPromises.get(tabKey);
  store.tabStates.set(tabKey, TAB_LOAD_STATES.LOADING);
  const promise = Promise.resolve()
    .then(loader)
    .then((value) => {
      store.tabCache.set(tabKey, value);
      store.tabStates.set(tabKey, TAB_LOAD_STATES.LOADED);
      return value;
    })
    .catch((error) => {
      store.tabStates.set(tabKey, TAB_LOAD_STATES.ERROR);
      throw error;
    })
    .finally(() => store.tabPromises.delete(tabKey));
  store.tabPromises.set(tabKey, promise);
  return promise;
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return cleanText(value)
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[\u200e\u200f]/g, '')
    .toLowerCase();
}

function pairKey(courseId, instructorName) {
  return `${String(courseId || '')}::${normalize(instructorName)}`;
}

function courseLabel(course) {
  return cleanText(course?.short_name || course?.full_name || course?.gefen_number || 'קורס');
}

function isValidInstructorName(value) {
  const normalized = normalize(value);
  return Boolean(normalized)
    && normalized !== 'טרם שובץ'
    && normalized !== 'לא שובץ'
    && normalized !== 'ללא מדריך'
    && normalized !== '-';
}

function activityInstructorNames(row = {}) {
  return Array.from(new Set([
    row?.instructor_name,
    row?.instructorName,
    row?.instructor,
    row?.guide_name,
    row?.guide,
    row?.instructor_name_2,
    row?.instructor_2,
    row?.guide_name_2,
    row?.guide_2
  ].map(cleanText).filter(isValidInstructorName)));
}

function isInactiveActivity(row = {}) {
  const status = normalize(row?.status);
  return Boolean(row?.deleted_at || row?.is_deleted === true || row?.cancelled_at || row?.is_cancelled === true)
    || ['נמחק', 'מחוק', 'בוטל', 'מבוטל', 'deleted', 'cancelled', 'canceled'].includes(status);
}

function activityType(row = {}) {
  return normalize(row?.activity_type || row?.item_type || row?.type);
}

function is2027Root(root) {
  return Boolean(root?.matches?.('[data-ops-year="2027"], .ops-year-2027'));
}

function resolveOperations2027ScreenRoot(container) {
  if (!container) return null;
  if (is2027Root(container)) return container;
  return container.querySelector?.(
    '.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027'
  ) || null;
}

function activeInstructorRows(rows = []) {
  return rows
    .map((row) => ({
      name: cleanText(row?.full_name || row?.instructor_name || row?.name),
      active: row?.active ?? row?.is_active
    }))
    .filter((row) => row.name && isActiveInstructor(row.active))
    .sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true }));
}

async function queryInstructors() {
  const result = await supabase
    .from(INSTRUCTOR_TABLE)
    .select('emp_id, full_name, active')
    .order('full_name', { ascending: true });
  if (result.error) throw result.error;
  return result.data || [];
}

async function queryCourses() {
  const result = await supabase
    .from(COURSE_TABLE)
    .select('id, short_name, full_name, gefen_number, sort_order, is_active, requires_print_kit')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (result.error) throw result.error;
  return result.data || [];
}

async function querySchool2027Activities() {
  const result = await supabase
    .from(ACTIVITY_TABLE)
    .select('*')
    .eq('activity_season', SCHOOL_2027);
  if (result.error) throw result.error;
  return result.data || [];
}

async function queryWorkshopCatalog() {
  const result = await supabase
    .from(WORKSHOP_CATALOG_TABLE)
    .select('list_id,category,value,label,active,is_active,sort_order,activity_no,activity_name,activity_type,type,stock_group_key,stock_group_name,stock_item_name,stock_label,parent_value')
    .eq('category', 'activity_names')
    .order('sort_order', { ascending: true, nullsFirst: false });
  if (result.error) throw result.error;
  return result.data || [];
}

async function queryEditPermission() {
  const result = await supabase.rpc('app_is_admin_or_operation_manager');
  return !result.error && result.data === true;
}

function sharedInstructors() {
  return loadOperations2027Source('instructors', queryInstructors);
}

function sharedCourses() {
  return loadOperations2027Source('courses', queryCourses);
}

function sharedActivities() {
  return loadOperations2027Source('school-2027-activities', querySchool2027Activities);
}

function sharedWorkshopCatalog() {
  return loadOperations2027Source('workshop-catalog', queryWorkshopCatalog);
}

function sharedEditPermission() {
  return loadOperations2027Source('edit-permission', queryEditPermission);
}

function isInactiveListValue(value) {
  if (value === false) return true;
  return ['false', '0', 'no', 'inactive', 'לא פעיל'].includes(normalize(value));
}

function workshopDisplayName(row = {}) {
  return cleanText(
    row?.stock_group_name
    || row?.stock_item_name
    || row?.stock_label
    || row?.activity_name
    || row?.short_name
    || row?.full_name
    || row?.name
    || row?.label
    || row?.workshop_name
  );
}

function isActiveWorkshopCatalogRow(row = {}) {
  const category = normalize(row?.category);
  const type = normalize(row?.activity_type || row?.type || row?.item_type || row?.parent_value);
  return category === 'activity_names' && type === 'workshop' && !isInactiveListValue(row?.active ?? row?.is_active);
}

function addWorkshop(workshops, row = {}, fallbackName = '') {
  const name = workshopDisplayName(row) || cleanText(fallbackName);
  const key = resolveWorkshopStockKey(
    { ...row, short_name: name, activity_name: row?.activity_name || name, name },
    { aliases: WORKSHOP_STOCK_ALIASES }
  );
  if (!key) return null;
  if (!workshops.has(key)) workshops.set(key, { key, name });
  return key;
}

export function buildWorkshopTrainingMatrix({ instructors = [], catalogRows = [], trainings = [], activities = [] } = {}) {
  const activeNames = new Map(activeInstructorRows(instructors).map((row) => [normalize(row.name), row.name]));
  const workshops = new Map();
  const catalogActivityNoToKey = new Map();
  const catalogNameToKey = new Map();

  for (const row of catalogRows) {
    if (!isActiveWorkshopCatalogRow(row)) continue;
    const key = addWorkshop(workshops, row);
    const activityNo = cleanText(row?.activity_no);
    const nameKey = normalize(workshopDisplayName(row));
    if (key && activityNo && !catalogActivityNoToKey.has(activityNo)) catalogActivityNoToKey.set(activityNo, key);
    if (key && nameKey && !catalogNameToKey.has(nameKey)) catalogNameToKey.set(nameKey, key);
  }

  const trainingMap = new Map();
  for (const row of trainings) {
    const instructorKey = normalize(row?.instructor_name);
    if (!activeNames.has(instructorKey)) continue;
    const workshopName = cleanText(row?.workshop_name);
    if (!workshopName) continue;
    const workshopKey = catalogNameToKey.get(normalize(workshopName))
      || addWorkshop(workshops, { workshop_name: workshopName, name: workshopName }, workshopName);
    if (workshopKey && row?.is_trained === true) trainingMap.set(`${workshopKey}::${instructorKey}`, true);
  }

  const assignedPairs = new Set();
  for (const row of activities) {
    if (isInactiveActivity(row) || activityType(row) !== 'workshop') continue;
    const resolved = resolveWorkshopStockKey(row, { aliases: WORKSHOP_STOCK_ALIASES });
    const workshopKey = workshops.has(resolved) ? resolved : catalogActivityNoToKey.get(cleanText(row?.activity_no));
    if (!workshopKey || !workshops.has(workshopKey)) continue;
    activityInstructorNames(row).forEach((name) => {
      const instructorKey = normalize(name);
      if (activeNames.has(instructorKey)) assignedPairs.add(`${workshopKey}::${instructorKey}`);
    });
  }

  return {
    instructors: Array.from(activeNames.values()).sort((a, b) => a.localeCompare(b, 'he', { numeric: true })),
    workshops: Array.from(workshops.values()).sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true })),
    trainingMap,
    assignedPairs
  };
}

export function buildCourseTrainingAssignedPairs(activities = [], courses = []) {
  const pairs = new Set();
  for (const row of activities) {
    if (isInactiveActivity(row) || activityType(row) !== 'course') continue;
    const course = resolveCourseForActivity(row, courses);
    if (!course) continue;
    activityInstructorNames(row).forEach((name) => pairs.add(pairKey(course.id, name)));
  }
  return pairs;
}

function isAutomaticNeedKit(course) {
  return courseLabel(course) !== BIOMIMICRY_ESCAPE_ROOM_KIT;
}

export function buildPrintKitAssignedMap(activities = [], courses = []) {
  const assigned = new Map();
  for (const row of activities) {
    if (isInactiveActivity(row) || activityType(row) !== 'course') continue;
    const course = resolveCourseForActivity(row, courses);
    if (!course || !isAutomaticNeedKit(course)) continue;
    const courseId = String(course.id || '');
    if (!courseId) continue;
    if (!assigned.has(courseId)) assigned.set(courseId, new Set());
    activityInstructorNames(row).forEach((name) => assigned.get(courseId).add(normalize(name)));
  }
  return assigned;
}

function loadWorkshopTrainingData() {
  return loadOperations2027Tab(TAB_WORKSHOP_TRAINING, async () => {
    const [instructors, catalogRows, activities, trainingResult] = await Promise.all([
      sharedInstructors(),
      sharedWorkshopCatalog(),
      sharedActivities(),
      supabase.from(WORKSHOP_TRAINING_TABLE).select('workshop_name, instructor_name, is_trained')
    ]);
    if (trainingResult.error) throw trainingResult.error;
    return buildWorkshopTrainingMatrix({
      instructors,
      catalogRows,
      activities,
      trainings: trainingResult.data || []
    });
  });
}

function loadCourseTrainingData() {
  return loadOperations2027Tab(TAB_COURSE_TRAINING, async () => {
    const [instructors, courses, activities, editable, trainingResult] = await Promise.all([
      sharedInstructors(),
      sharedCourses(),
      sharedActivities(),
      sharedEditPermission(),
      supabase.from(COURSE_TRAINING_TABLE).select('course_id, instructor_name, is_trained')
    ]);
    if (trainingResult.error) throw trainingResult.error;
    return {
      instructors: activeInstructorRows(instructors).map((row) => row.name),
      courses,
      assignedPairs: buildCourseTrainingAssignedPairs(activities, courses),
      trainingRows: trainingResult.data || [],
      editable
    };
  });
}

function loadPrintKitData() {
  return loadOperations2027Tab(TAB_PRINT_KITS, async () => {
    const [instructors, courses, activities, editable, inventoryResult, distributionResult] = await Promise.all([
      sharedInstructors(),
      sharedCourses(),
      sharedActivities(),
      sharedEditPermission(),
      supabase.from(KIT_INVENTORY_TABLE).select('course_id, warehouse_quantity, hila_quantity, idan_quantity, gil_quantity'),
      supabase.from(KIT_DISTRIBUTION_TABLE).select('course_id, instructor_name, source_location')
    ]);
    if (inventoryResult.error) throw inventoryResult.error;
    if (distributionResult.error) throw distributionResult.error;
    const kitCourses = courses.filter((course) => course?.requires_print_kit === true);
    return {
      instructors,
      courses: kitCourses,
      activities,
      inventoryRows: inventoryResult.data || [],
      distributionRows: distributionResult.data || [],
      editable
    };
  });
}

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById('ops-2027-loading-controller-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-loading-controller-style';
  style.textContent = `
    .ds-ops-mgmt-screen .ops2027-view { text-align: right; }
    .ds-ops-mgmt-screen .ops2027-section { width: fit-content; max-width: 100%; margin-inline: auto; box-sizing: border-box; }
    .ds-ops-mgmt-screen .ops2027-section + .ops2027-section { margin-top: 22px; }
    .ds-ops-mgmt-screen .ops2027-section-title { margin: 0 0 8px; text-align: center; font-size: 1rem; font-weight: 800; }
    .ds-ops-mgmt-screen .ops2027-table-shell { display: block; width: fit-content; max-width: 100%; overflow-x: auto; margin-inline: auto; border: 1px solid var(--ds-border,#dbe3ec); border-radius: 10px; background: #fff; }
    .ds-ops-mgmt-screen .ops2027-table { width: max-content !important; min-width: 0 !important; table-layout: fixed !important; border-collapse: collapse; margin: 0; }
    .ds-ops-mgmt-screen .ops2027-table th,
    .ds-ops-mgmt-screen .ops2027-table td { height: 34px; padding: 4px 6px !important; border-inline-start: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; text-align: center; vertical-align: middle; font-size: 11px; line-height: 1.2; }
    .ds-ops-mgmt-screen .ops2027-table th:first-child,
    .ds-ops-mgmt-screen .ops2027-table td:first-child { border-inline-start: 0; }
    .ds-ops-mgmt-screen .ops2027-row-label { box-sizing: border-box; width: 170px; min-width: 170px; max-width: 170px; padding-inline: 8px !important; text-align: right !important; white-space: normal; overflow-wrap: anywhere; font-weight: 700; }
    .ds-ops-mgmt-screen .ops2027-matrix-col { box-sizing: border-box; width: 78px; min-width: 78px; max-width: 78px; text-align: center !important; }
    .ds-ops-mgmt-screen th.ops2027-matrix-col { height: 54px; white-space: normal; overflow-wrap: anywhere; font-size: 10px; }
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-row-label { width: 154px; min-width: 154px; max-width: 154px; }
    .ds-ops-mgmt-screen .ops2027-print-kit-matrix .ops2027-matrix-col { width: 72px; min-width: 72px; max-width: 72px; }
    .ds-ops-mgmt-screen .ops2027-print-kit-stock .ops2027-summary-col { box-sizing: border-box; width: 118px; min-width: 118px; max-width: 118px; white-space: normal; }
    .ds-ops-mgmt-screen .ops2027-number-col { box-sizing: border-box; width: 72px; min-width: 72px; max-width: 72px; }
    .ds-ops-mgmt-screen .ops2027-cell-button,
    .ds-ops-mgmt-screen .ops2027-status { display: inline-grid; place-items: center; width: 22px; min-width: 22px; height: 22px; min-height: 22px; margin-inline: auto; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; font-size: 18px; font-weight: 900; line-height: 1; }
    .ds-ops-mgmt-screen .ops2027-cell-button { cursor: pointer; }
    .ds-ops-mgmt-screen .ops2027-cell-button:disabled { cursor: wait; opacity: .65; }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-yes,
    .ds-ops-mgmt-screen .ops2027-status.is-yes { color: #15803d; }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-no,
    .ds-ops-mgmt-screen .ops2027-status.is-no { color: #dc2626; }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-empty { color: transparent; }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-empty:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .ds-ops-mgmt-screen .ops2027-stock-input { width: 58px !important; min-width: 58px !important; max-width: 58px !important; padding: 4px 5px !important; text-align: center; }
    .ds-ops-mgmt-screen .ops2027-empty,
    .ds-ops-mgmt-screen .ops2027-error,
    .ds-ops-mgmt-screen .ops2027-loading { width: fit-content; max-width: 100%; margin-inline: auto; padding: 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
    .ops2027-modal-backdrop { position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center; padding: 20px; background: rgba(15,23,42,.42); }
    .ops2027-modal { width: min(360px,100%); padding: 18px; border-radius: 14px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.24); text-align: right; }
    .ops2027-modal h3 { margin: 0 0 6px; }
    .ops2027-modal p { margin: 0 0 14px; color: #475569; }
    .ops2027-modal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .ops2027-modal-actions button { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; }
    .ops2027-modal-actions button[data-cancel] { margin-inline-start: auto; }
  `;
  document.head.appendChild(style);
}

function emptyHtml(message) {
  return `<div class="ops2027-empty">${escapeHtml(message)}</div>`;
}

function errorHtml(error) {
  return `<div class="ops2027-error">${escapeHtml(cleanText(error?.message || error || 'אירעה שגיאה בטעינת הנתונים'))}</div>`;
}

function loadingHtml() {
  return '<div class="ops2027-loading">טוען נתונים...</div>';
}

function matrixHtml({ rows, columns, rowLabel, columnLabel, cellHtml, emptyMessage }) {
  if (!rows.length || !columns.length) return emptyHtml(emptyMessage);
  const head = columns.map((column) => `<th class="ops2027-matrix-col">${escapeHtml(columnLabel(column))}</th>`).join('');
  const body = rows.map((row) => `<tr><td class="ops2027-row-label">${escapeHtml(rowLabel(row))}</td>${columns.map((column) => `<td class="ops2027-matrix-col">${cellHtml(row, column)}</td>`).join('')}</tr>`).join('');
  return `<div class="ops2027-table-shell"><table class="ops2027-table"><thead><tr><th class="ops2027-row-label">שם</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderWorkshopTrainingContent(data) {
  return `<div class="ops2027-view" data-ops-controller-tab="${TAB_WORKSHOP_TRAINING}">
    ${matrixHtml({
      rows: data.workshops,
      columns: data.instructors,
      rowLabel: (workshop) => workshop.name,
      columnLabel: (name) => name,
      emptyMessage: 'אין מדריכים פעילים או סדנאות להצגה.',
      cellHtml: (workshop, instructor) => {
        const key = `${workshop.key}::${normalize(instructor)}`;
        const state = trainingCellState({
          trained: data.trainingMap.get(key) === true,
          assigned: data.assignedPairs.has(key)
        });
        if (state.state === 'empty') return '';
        const className = state.state === 'trained' ? 'is-yes' : 'is-no';
        const label = state.state === 'trained' ? 'עבר הכשרה' : 'משובץ וטרם עבר הכשרה';
        return `<span class="ops2027-status ${className}" aria-label="${label}">${state.text}</span>`;
      }
    })}
  </div>`;
}

function trainingMap(rows = []) {
  return new Map(rows.map((row) => [pairKey(row?.course_id, row?.instructor_name), row?.is_trained === true]));
}

function courseTrainingCellHtml(data, instructor, course) {
  const key = pairKey(course.id, instructor);
  const trained = trainingMap(data.trainingRows).get(key) === true;
  const assigned = data.assignedPairs.has(key);
  const state = trainingCellState({ trained, assigned });
  const className = state.state === 'trained' ? 'is-yes' : (state.state === 'assigned_untrained' ? 'is-no' : 'is-empty');
  const label = state.state === 'trained'
    ? 'עבר הכשרה'
    : (state.state === 'assigned_untrained' ? 'משובץ וטרם עבר הכשרה' : 'לא משובץ ולא עבר הכשרה');
  if (!data.editable) {
    return state.state === 'empty' ? '' : `<span class="ops2027-status ${className}" aria-label="${label}">${state.text}</span>`;
  }
  return `<button type="button" class="ops2027-cell-button ${className}" data-ops-course-training-toggle data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" data-trained="${trained ? '1' : '0'}" data-assigned="${assigned ? '1' : '0'}" aria-label="${label}">${state.text}</button>`;
}

function renderCourseTrainingContent(data) {
  return `<div class="ops2027-view" data-ops-controller-tab="${TAB_COURSE_TRAINING}">
    ${matrixHtml({
      rows: data.instructors,
      columns: data.courses,
      rowLabel: (name) => name,
      columnLabel: courseLabel,
      emptyMessage: 'אין מדריכים פעילים או קורסים פעילים להצגה.',
      cellHtml: (instructor, course) => courseTrainingCellHtml(data, instructor, course)
    })}
  </div>`;
}

function inventoryMap(rows = []) {
  return new Map(rows.map((row) => [String(row?.course_id || ''), row]));
}

function distributionMap(rows = []) {
  return new Map(rows.map((row) => [pairKey(row?.course_id, row?.instructor_name), row]));
}

function printKitViewModel(data) {
  const activeNames = activeInstructorRows(data.instructors).map((row) => row.name);
  const activeKeys = new Set(activeNames.map(normalize));
  const displayedIds = new Set(data.courses.map((course) => String(course.id || '')));
  const distributions = data.distributionRows.filter((row) => displayedIds.has(String(row?.course_id || '')));
  const inactiveNames = Array.from(new Set(distributions
    .map((row) => cleanText(row?.instructor_name))
    .filter((name) => name && !activeKeys.has(normalize(name)))))
    .sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
  return {
    ...data,
    activeNames,
    inactiveNames,
    inventory: inventoryMap(data.inventoryRows),
    distributions,
    distributionByPair: distributionMap(distributions),
    assignedByCourse: buildPrintKitAssignedMap(data.activities, data.courses)
  };
}

function printKitStockTableHtml(view) {
  if (!view.courses.length) return emptyHtml('אין ערכות להצגה.');
  const body = view.courses.map((course) => {
    const stock = view.inventory.get(String(course.id)) || {};
    const holders = view.distributions.filter((row) => String(row?.course_id) === String(course.id));
    const summary = buildPrintKitSummary({
      warehouse: stock?.warehouse_quantity,
      hila: stock?.hila_quantity,
      idan: stock?.idan_quantity,
      gil: stock?.gil_quantity,
      holders,
      activeInstructors: view.instructors
    });
    const locations = KIT_LOCATIONS.map((location) => {
      const value = Math.max(0, Number(stock?.[location.field] || 0));
      const control = view.editable
        ? `<input type="number" min="0" step="1" class="ds-input ops2027-stock-input" data-ops-kit-stock data-course-id="${escapeHtml(course.id)}" data-location="${escapeHtml(location.key)}" value="${value}">`
        : `<span>${value}</span>`;
      return `<td class="ops2027-number-col">${control}</td>`;
    }).join('');
    return `<tr><td class="ops2027-row-label">${escapeHtml(courseLabel(course))}</td>${locations}<td class="ops2027-summary-col">${summary.activeInstructorKits}</td><td class="ops2027-summary-col">${summary.inactiveInstructorKits}</td><td class="ops2027-summary-col">${summary.totalUnique}</td></tr>`;
  }).join('');
  return `<div class="ops2027-table-shell ops2027-print-kit-stock"><table class="ops2027-table"><thead><tr><th class="ops2027-row-label">שם ערכה</th>${KIT_LOCATIONS.map((location) => `<th class="ops2027-number-col">${escapeHtml(location.label)}</th>`).join('')}<th class="ops2027-summary-col">אצל מדריכים פעילים</th><th class="ops2027-summary-col">אצל מדריכים לא פעילים</th><th class="ops2027-summary-col">סה״כ</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function printKitCellHtml(view, instructor, course, inactive = false) {
  const key = pairKey(course.id, instructor);
  const delivery = view.distributionByPair.get(key);
  if (delivery) {
    if (!view.editable) return '<span class="ops2027-status is-yes" aria-label="יש ערכה">✓</span>';
    return `<button type="button" class="ops2027-cell-button is-yes" data-ops-kit-return data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="יש ערכה">✓</button>`;
  }
  if (inactive) return '';
  const assigned = view.assignedByCourse.get(String(course.id))?.has(normalize(instructor)) === true;
  if (!view.editable) return assigned ? '<span class="ops2027-status is-no" aria-label="משובץ וחסרה ערכה">✕</span>' : '';
  if (assigned) {
    return `<button type="button" class="ops2027-cell-button is-no" data-ops-kit-deliver data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="משובץ וחסרה ערכה">✕</button>`;
  }
  return `<button type="button" class="ops2027-cell-button is-empty" data-ops-kit-deliver data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="מסירת ערכה למדריך שאינו משובץ"></button>`;
}

function printKitMatrixHtml(view, instructors, inactive, emptyMessage) {
  return `<div class="ops2027-print-kit-matrix">${matrixHtml({
    rows: instructors,
    columns: view.courses,
    rowLabel: (name) => name,
    columnLabel: courseLabel,
    emptyMessage,
    cellHtml: (instructor, course) => printKitCellHtml(view, instructor, course, inactive)
  })}</div>`;
}

function renderPrintKitContent(data) {
  const view = printKitViewModel(data);
  return `<div class="ops2027-view" data-ops-controller-tab="${TAB_PRINT_KITS}" data-ops-history-fix="${TAB_PRINT_KITS}">
    <section class="ops2027-section"><h3 class="ops2027-section-title">מלאי ערכות</h3>${printKitStockTableHtml(view)}</section>
    <section class="ops2027-section"><h3 class="ops2027-section-title">מדריכים פעילים</h3>${printKitMatrixHtml(view, view.activeNames, false, 'אין מדריכים פעילים להצגה.')}</section>
    <section class="ops2027-section"><h3 class="ops2027-section-title">מדריכים לא פעילים שמחזיקים ערכה</h3>${printKitMatrixHtml(view, view.inactiveNames, true, 'אין ערכות אצל מדריכים לא פעילים.')}</section>
  </div>`;
}

function setActiveTab(root, tabKey) {
  root.querySelectorAll('.ds-ops-mgmt-tab').forEach((button) => {
    const active = button.dataset.opsCustomTab === tabKey;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function customTabButton(tabKey, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-exceptions-tab ds-ops-mgmt-tab';
  button.dataset.opsCustomTab = tabKey;
  button.setAttribute('aria-pressed', 'false');
  button.textContent = label;
  return button;
}

function renderTabValue(root, tabKey, data) {
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (!content) return;
  if (tabKey === TAB_WORKSHOP_TRAINING) content.innerHTML = renderWorkshopTrainingContent(data);
  if (tabKey === TAB_COURSE_TRAINING) content.innerHTML = renderCourseTrainingContent(data);
  if (tabKey === TAB_PRINT_KITS) content.innerHTML = renderPrintKitContent(data);
  bindRenderedTab(root, tabKey);
}

async function renderCustomTab(root, tabKey) {
  if (!is2027Root(root)) return;
  activeCustomTab = tabKey;
  setActiveTab(root, tabKey);
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (!content) return;
  const token = ++renderToken;
  const cached = store.tabStates.get(tabKey) === TAB_LOAD_STATES.LOADED ? store.tabCache.get(tabKey) : null;
  if (cached) {
    renderTabValue(root, tabKey, cached);
    return;
  }
  content.innerHTML = `<div class="ops2027-view">${loadingHtml()}</div>`;
  try {
    const data = tabKey === TAB_WORKSHOP_TRAINING
      ? await loadWorkshopTrainingData()
      : tabKey === TAB_COURSE_TRAINING
        ? await loadCourseTrainingData()
        : await loadPrintKitData();
    if (token !== renderToken || activeCustomTab !== tabKey || !root.isConnected) return;
    renderTabValue(root, tabKey, data);
  } catch (error) {
    if (token !== renderToken || activeCustomTab !== tabKey) return;
    content.innerHTML = `<div class="ops2027-view">${errorHtml(error)}</div>`;
  }
}

function patchCourseTrainingCache(courseId, instructorName, isTrained) {
  const data = store.tabCache.get(TAB_COURSE_TRAINING);
  if (!data) return;
  const key = pairKey(courseId, instructorName);
  const existing = data.trainingRows.find((row) => pairKey(row?.course_id, row?.instructor_name) === key);
  if (existing) existing.is_trained = isTrained;
  else data.trainingRows.push({ course_id: courseId, instructor_name: cleanText(instructorName), is_trained: isTrained });
}

function applyTrainingButtonState(button, trained) {
  const assigned = button.dataset.assigned === '1';
  const state = trainingCellState({ trained, assigned });
  button.dataset.trained = trained ? '1' : '0';
  button.classList.toggle('is-yes', state.state === 'trained');
  button.classList.toggle('is-no', state.state === 'assigned_untrained');
  button.classList.toggle('is-empty', state.state === 'empty');
  button.textContent = state.text;
  button.setAttribute('aria-label', state.state === 'trained'
    ? 'עבר הכשרה'
    : (state.state === 'assigned_untrained' ? 'משובץ וטרם עבר הכשרה' : 'לא משובץ ולא עבר הכשרה'));
}

async function toggleCourseTraining(button) {
  const next = button.dataset.trained !== '1';
  button.disabled = true;
  const result = await supabase.from(COURSE_TRAINING_TABLE).upsert({
    course_id: button.dataset.courseId,
    instructor_name: cleanText(button.dataset.instructor),
    is_trained: next,
    updated_at: new Date().toISOString()
  }, { onConflict: 'course_id,instructor_name' });
  if (result.error) {
    button.disabled = false;
    window.alert(result.error.message || 'שמירת ההכשרה נכשלה');
    return;
  }
  patchCourseTrainingCache(button.dataset.courseId, button.dataset.instructor, next);
  applyTrainingButtonState(button, next);
  button.disabled = false;
}

function ensureInventoryRow(data, courseId) {
  let row = data.inventoryRows.find((item) => String(item?.course_id) === String(courseId));
  if (!row) {
    row = { course_id: courseId, warehouse_quantity: 0, hila_quantity: 0, idan_quantity: 0, gil_quantity: 0 };
    data.inventoryRows.push(row);
  }
  return row;
}

export function patchPrintKitStock(data, courseId, location, quantity) {
  const config = KIT_LOCATIONS.find((item) => item.key === location);
  if (!config) return false;
  const row = ensureInventoryRow(data, courseId);
  row[config.field] = Math.max(0, Number(quantity) || 0);
  return true;
}

export function patchPrintKitDelivery(data, courseId, instructorName, location) {
  const config = KIT_LOCATIONS.find((item) => item.key === location);
  if (!config) return false;
  const key = pairKey(courseId, instructorName);
  if (data.distributionRows.some((row) => pairKey(row?.course_id, row?.instructor_name) === key)) return true;
  const stock = ensureInventoryRow(data, courseId);
  if (Number(stock[config.field] || 0) <= 0) return false;
  stock[config.field] = Number(stock[config.field] || 0) - 1;
  data.distributionRows.push({ course_id: courseId, instructor_name: cleanText(instructorName), source_location: location });
  return true;
}

export function patchPrintKitReturn(data, courseId, instructorName) {
  const key = pairKey(courseId, instructorName);
  const index = data.distributionRows.findIndex((row) => pairKey(row?.course_id, row?.instructor_name) === key);
  if (index < 0) return false;
  const [distribution] = data.distributionRows.splice(index, 1);
  const config = KIT_LOCATIONS.find((item) => item.key === distribution?.source_location);
  if (config) {
    const stock = ensureInventoryRow(data, courseId);
    stock[config.field] = Math.max(0, Number(stock[config.field] || 0)) + 1;
  }
  return true;
}

function renderPrintKitCache(root) {
  const data = store.tabCache.get(TAB_PRINT_KITS);
  if (data && activeCustomTab === TAB_PRINT_KITS) renderTabValue(root, TAB_PRINT_KITS, data);
}

async function saveStock(input, root) {
  const quantity = Math.max(0, Math.floor(Number(input.value || 0)));
  input.value = String(quantity);
  input.disabled = true;
  const result = await supabase.rpc('set_course_print_kit_stock', {
    p_course_id: input.dataset.courseId,
    p_location: input.dataset.location,
    p_quantity: quantity
  });
  input.disabled = false;
  if (result.error) {
    window.alert(result.error.message || 'עדכון המלאי נכשל');
    return;
  }
  const data = store.tabCache.get(TAB_PRINT_KITS);
  if (data) patchPrintKitStock(data, input.dataset.courseId, input.dataset.location, quantity);
  renderPrintKitCache(root);
}

function availableLocations(data, courseId) {
  const stock = inventoryMap(data.inventoryRows).get(String(courseId)) || {};
  return KIT_LOCATIONS.filter((location) => Number(stock?.[location.field] || 0) > 0);
}

function openLocationPicker(root, courseId, instructorName) {
  const data = store.tabCache.get(TAB_PRINT_KITS);
  if (!data) return;
  const locations = availableLocations(data, courseId);
  if (!locations.length) {
    window.alert('אין מלאי זמין למסירה.');
    return;
  }
  document.querySelector('.ops2027-modal-backdrop')?.remove?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'ops2027-modal-backdrop';
  backdrop.innerHTML = `<div class="ops2027-modal" role="dialog" aria-modal="true"><h3>מסירת ערכה</h3><p>מאיפה נמסרה הערכה ל-${escapeHtml(instructorName)}?</p><div class="ops2027-modal-actions">${locations.map((location) => `<button type="button" data-location="${escapeHtml(location.key)}">${escapeHtml(location.label)}</button>`).join('')}<button type="button" data-cancel>ביטול</button></div></div>`;
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-cancel]')) backdrop.remove();
  });
  backdrop.querySelectorAll('[data-location]').forEach((button) => {
    button.addEventListener('click', async () => {
      backdrop.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      const result = await supabase.rpc('deliver_course_print_kit', {
        p_course_id: courseId,
        p_instructor_name: instructorName,
        p_source_location: button.dataset.location
      });
      if (result.error) {
        window.alert(result.error.message || 'מסירת הערכה נכשלה');
        backdrop.remove();
        return;
      }
      patchPrintKitDelivery(data, courseId, instructorName, button.dataset.location);
      backdrop.remove();
      renderPrintKitCache(root);
    });
  });
  document.body.appendChild(backdrop);
}

async function returnKit(button, root) {
  if (!window.confirm('להחזיר את הערכה למלאי?')) return;
  button.disabled = true;
  const result = await supabase.rpc('return_course_print_kit', {
    p_course_id: button.dataset.courseId,
    p_instructor_name: button.dataset.instructor
  });
  if (result.error) {
    button.disabled = false;
    window.alert(result.error.message || 'החזרת הערכה נכשלה');
    return;
  }
  const data = store.tabCache.get(TAB_PRINT_KITS);
  if (data) patchPrintKitReturn(data, button.dataset.courseId, button.dataset.instructor);
  renderPrintKitCache(root);
}

function bindRenderedTab(root, tabKey) {
  const content = root.querySelector('.ds-ops-mgmt-content');
  if (!content) return;
  if (tabKey === TAB_COURSE_TRAINING) {
    content.querySelectorAll('[data-ops-course-training-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggleCourseTraining(button));
    });
  }
  if (tabKey === TAB_PRINT_KITS) {
    content.querySelectorAll('[data-ops-kit-stock]').forEach((input) => {
      input.addEventListener('change', () => saveStock(input, root));
    });
    content.querySelectorAll('[data-ops-kit-deliver]').forEach((button) => {
      button.addEventListener('click', () => openLocationPicker(root, button.dataset.courseId, button.dataset.instructor));
    });
    content.querySelectorAll('[data-ops-kit-return]').forEach((button) => {
      button.addEventListener('click', () => returnKit(button, root));
    });
  }
}

function applyOperations2027Labels(root) {
  if (!is2027Root(root)) return;
  const workshopsTab = root.querySelector('[data-ops-tab="workshops"]');
  if (workshopsTab) workshopsTab.textContent = 'מלאי סדנאות';
}

function bindCustomTabs(root, state = {}) {
  if (!is2027Root(root)) return;
  ensureStyle();
  const tabs = root.querySelector('.ds-ops-mgmt-tabs');
  if (!tabs) return;
  const definitions = [
    [TAB_WORKSHOP_TRAINING, 'הכשרות סדנאות'],
    [TAB_COURSE_TRAINING, 'הכשרות קורסים'],
    [TAB_PRINT_KITS, 'ערכות דפוס']
  ];
  definitions.forEach(([tabKey, label]) => {
    let button = tabs.querySelector(`[data-ops-custom-tab="${tabKey}"]`);
    if (!button) {
      button = customTabButton(tabKey, label);
      tabs.appendChild(button);
    }
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state?.operationsManagement) state.operationsManagement.customTab = tabKey;
      renderCustomTab(root, tabKey);
    });
  });
  root.querySelectorAll('[data-ops-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCustomTab = '';
      if (state?.operationsManagement) state.operationsManagement.customTab = '';
      renderToken += 1;
      setActiveTab(root, '');
    });
  });
  root.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => {
      activeCustomTab = '';
      if (state?.operationsManagement) state.operationsManagement.customTab = '';
    });
  });
  const pendingCustomTab = String(state?.operationsManagement?.customTab || activeCustomTab || '').trim();
  if (pendingCustomTab) renderCustomTab(root, pendingCustomTab);
}

function installController() {
  if (operationsManagementScreen[INSTALL_MARKER]) return;
  operationsManagementScreen[INSTALL_MARKER] = true;
  const originalLoad = operationsManagementScreen.load;
  operationsManagementScreen.load = async function wrappedOperations2027Load(context = {}) {
    disposeOperations2027LoadingCache();
    return originalLoad.call(this, context);
  };
  const originalBind = operationsManagementScreen.bind;
  operationsManagementScreen.bind = function wrappedOperations2027Bind(context = {}) {
    originalBind.call(this, context);

    const screenRoot = resolveOperations2027ScreenRoot(context.root);
    if (!screenRoot) return;

    applyOperations2027Labels(screenRoot);
    bindCustomTabs(screenRoot, context.state || {});
  };

  // Used by main.js to add 2027 tabs to the ops sub-route wrapper (invitations/catalog/certificates).
  // Tabs click → set activeCustomTab so ops-management restores it, then call navigateCallback.
  operationsManagementScreen.applyOps2027ToWrapper = function applyOps2027ToWrapper(wrapperRoot, navigateCallback, state = {}) {
    if (!is2027Root(wrapperRoot)) return;
    applyOperations2027Labels(wrapperRoot);
    const tabs = wrapperRoot.querySelector('.ds-ops-mgmt-tabs');
    if (!tabs) return;
    const definitions = [
      [TAB_WORKSHOP_TRAINING, 'הכשרות סדנאות'],
      [TAB_COURSE_TRAINING, 'הכשרות קורסים'],
      [TAB_PRINT_KITS, 'ערכות דפוס']
    ];
    definitions.forEach(([tabKey, label]) => {
      if (tabs.querySelector(`[data-ops-custom-tab="${tabKey}"]`)) return;
      const button = customTabButton(tabKey, label);
      tabs.appendChild(button);
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        activeCustomTab = tabKey;
        if (state?.operationsManagement) {
          state.operationsManagement.customTab = tabKey;
          state.operationsManagement.tab = 'workshops';
        }
        navigateCallback?.();
      });
    });
  };
}

// Routes that are visually owned by ops-management — do NOT dispose 2027 cache when navigating among them.
const OPS_OWNED_ROUTES = new Set(['operations-management', 'invitations', 'catalog', 'certificates']);

function bindRouteDisposal() {
  if (typeof document === 'undefined' || document.documentElement.dataset.ops2027CacheDisposeBound) return;
  document.documentElement.dataset.ops2027CacheDisposeBound = '1';
  document.addEventListener('app:navigate', (event) => {
    if (!OPS_OWNED_ROUTES.has(String(event?.detail?.route || ''))) disposeOperations2027LoadingCache();
  });
  document.addEventListener('click', (event) => {
    const route = event.target?.closest?.('[data-route]')?.getAttribute?.('data-route');
    if (route && !OPS_OWNED_ROUTES.has(route)) disposeOperations2027LoadingCache();
  }, true);
}

installController();
bindRouteDisposal();
