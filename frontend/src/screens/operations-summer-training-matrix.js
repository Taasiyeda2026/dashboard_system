import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';
import { isActiveInstructor, resolveWorkshopStockKey, trainingCellState } from './shared/operations-2027-domain.js';

const SCHOOL_2027 = 'school_2027';
const TAB_WORKSHOP_TRAINING = 'summer_training_matrix';
const TAB_COURSE_TRAINING = 'course_training_matrix';
const TAB_PRINT_KITS = 'course_print_kits';
const COURSE_TRAINING_TABLE = 'course_instructor_trainings';
const KIT_INVENTORY_TABLE = 'course_print_kit_inventory';
const KIT_DISTRIBUTION_TABLE = 'course_print_kit_distributions';
const COURSE_TABLE = 'proposal_gefen_courses';
const ACTIVITY_TABLE = 'activities';
const WORKSHOP_TRAINING_TABLE = 'summer_workshop_trainings';
const INSTRUCTOR_TABLE = 'contacts_instructors';
const LISTS_TABLE = 'lists';
const WORKSHOP_STOCK_ALIASES = Object.freeze({
  'פרוגי המקפצת': 'froggy',
  'ציפור שיווי משקל': 'bird-balance',
  'קלידוסקופ': 'kaleidoscope',
  'שעון רובוט - הזמן שלנו': 'robot-clock'
});
const KIT_LOCATIONS = [
  { key: 'warehouse', field: 'warehouse_quantity', label: 'מחסן' },
  { key: 'hila', field: 'hila_quantity', label: 'הילה' },
  { key: 'idan', field: 'idan_quantity', label: 'עידן' },
  { key: 'gil', field: 'gil_quantity', label: 'גיל' }
];

let observer = null;
let queued = false;
let customTab = '';
let renderToken = 0;

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

function isValidInstructor(name) {
  const value = normalize(name);
  return Boolean(value)
    && value !== 'טרם שובץ'
    && value !== 'לא שובץ'
    && value !== 'ללא מדריך'
    && value !== '-';
}

function activityInstructorNames(row) {
  const candidates = [
    row?.instructor_name,
    row?.instructorName,
    row?.instructor,
    row?.guide_name,
    row?.guide,
    row?.instructor_name_2,
    row?.instructor_2,
    row?.guide_name_2,
    row?.guide_2
  ];
  return Array.from(new Set(candidates.map(cleanText).filter(isValidInstructor)));
}

function activityCourseNumber(row) {
  return cleanText(row?.activity_no || row?.activityNo || row?.gefen_number || row?.course_number);
}

function activityCourseName(row) {
  return cleanText(row?.activity_name || row?.activityName || row?.course_name || row?.program_name);
}

function courseDisplayName(course) {
  return cleanText(course?.short_name || course?.full_name || course?.gefen_number || 'קורס');
}

function courseAliases(course) {
  return [course?.short_name, course?.full_name, course?.gefen_number]
    .map(normalize)
    .filter(Boolean);
}

function findCourseForActivity(row, courses) {
  const number = normalize(activityCourseNumber(row));
  if (number) {
    const byNumber = courses.find((course) => normalize(course?.gefen_number) === number);
    if (byNumber) return byNumber;
  }
  const activityName = normalize(activityCourseName(row));
  if (!activityName) return null;
  return courses.find((course) => courseAliases(course).some((alias) => (
    alias === activityName || alias.includes(activityName) || activityName.includes(alias)
  ))) || null;
}

function rootElement() {
  return document.querySelector('.ds-ops-mgmt-screen');
}

function tabsElement(root = rootElement()) {
  return root?.querySelector?.('.ds-ops-mgmt-tabs') || null;
}

function contentElement(root = rootElement()) {
  return root?.querySelector?.('.ds-ops-mgmt-content') || null;
}

function findPeriodControl(root) {
  const selects = Array.from(root?.querySelectorAll?.('select') || []);
  return selects.find((select) => Array.from(select.options || []).some((option) => (
    option.value === SCHOOL_2027 || cleanText(option.textContent) === '2027'
  ))) || null;
}

function is2027(root = rootElement()) {
  const periodControl = findPeriodControl(root);
  if (periodControl) {
    const selectedText = cleanText(periodControl.selectedOptions?.[0]?.textContent);
    return periodControl.value === SCHOOL_2027 || selectedText === '2027';
  }
  const selected = document.querySelector([
    '[data-activity-period="school_2027"].is-active',
    '[data-period="school_2027"].is-active',
    '[data-period-key="school_2027"].is-active',
    '[aria-pressed="true"][data-activity-period="school_2027"]'
  ].join(','));
  if (selected) return true;
  const active2027 = Array.from(document.querySelectorAll('.is-active, [aria-selected="true"], [aria-pressed="true"]'))
    .some((node) => cleanText(node.textContent) === '2027');
  return active2027;
}

function hidePeriodFor2027(root) {
  const control = findPeriodControl(root);
  const in2027 = is2027(root);
  if (!control) return;
  const field = control.closest('.ds-filter-field, .ds-ops-mgmt-field, label, .ds-form-field') || control.parentElement;
  if (field) field.hidden = in2027;
}

function currentStoredUser() {
  try { return JSON.parse(localStorage.getItem('dashboard_user') || '{}') || {}; } catch { return {}; }
}

function canEditOperationsQuantities() {
  const user = currentStoredUser();
  const roles = [user.role, user.display_role].map((role) => normalize(role));
  return roles.includes('admin') || roles.includes('operation_manager');
}

function setNativeTabVisibility(root) {
  const in2027 = is2027(root);
  ['authorities', 'completion_approval'].forEach((key) => {
    const button = root.querySelector(`[data-ops-tab="${key}"]`);
    if (button) button.hidden = in2027;
  });

  const workshopTab = root.querySelector('[data-ops-tab="workshops"]');
  if (workshopTab && cleanText(workshopTab.textContent) !== 'מלאי סדנאות') workshopTab.textContent = 'מלאי סדנאות';

  const activeHidden = root.querySelector('.ds-ops-mgmt-tab.is-active[hidden]');
  if (activeHidden) root.querySelector('[data-ops-tab="instructors"]')?.click?.();
}

function ensureStyle() {
  if (document.getElementById('ops-2027-workflows-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-workflows-style';
  style.textContent = `
    .ds-ops-mgmt-screen .ops2027-view { text-align: right; }
    .ds-ops-mgmt-screen .ops2027-view > .ops2027-header,
    .ds-ops-mgmt-screen .ops2027-section { width: fit-content; max-width: 100%; margin-inline: auto; box-sizing: border-box; }
    .ds-ops-mgmt-screen .ops2027-header { margin-block: 0 12px; }
    .ds-ops-mgmt-screen .ops2027-title { margin: 0; font-size: 1.12rem; font-weight: 800; }
    .ds-ops-mgmt-screen .ops2027-note { margin: 4px 0 0; color: var(--ds-text-muted, #64748b); font-size: .86rem; }
    .ds-ops-mgmt-screen .ops2027-section + .ops2027-section { margin-top: 22px; }
    .ds-ops-mgmt-screen .ops2027-section-title { margin: 0 0 8px; font-size: 1rem; font-weight: 800; }
    .ds-ops-mgmt-screen .ops2027-table-shell {
      display: block;
      width: fit-content;
      max-width: 100%;
      overflow-x: auto;
      margin-inline: auto;
      border: 1px solid var(--ds-border, #dbe3ec);
      border-radius: 10px;
      background: var(--ds-surface, #fff);
    }
    .ds-ops-mgmt-screen .ops2027-table {
      width: max-content !important;
      min-width: 0 !important;
      max-width: none !important;
      table-layout: auto !important;
      border-collapse: collapse;
      margin: 0;
    }
    .ds-ops-mgmt-screen .ops2027-table th,
    .ds-ops-mgmt-screen .ops2027-table td {
      min-width: 0 !important;
      height: 36px;
      padding: 5px 8px !important;
      border-inline-start: 1px solid var(--ds-border, #e2e8f0);
      border-bottom: 1px solid var(--ds-border, #e2e8f0);
      text-align: center;
      vertical-align: middle;
      white-space: nowrap;
    }
    .ds-ops-mgmt-screen .ops2027-table th:first-child,
    .ds-ops-mgmt-screen .ops2027-table td:first-child { border-inline-start: 0; }
    .ds-ops-mgmt-screen .ops2027-table tbody tr:last-child td { border-bottom: 0; }
    .ds-ops-mgmt-screen .ops2027-course-col {
      width: 180px;
      max-width: 240px;
      text-align: right !important;
      white-space: normal !important;
      line-height: 1.25;
      font-weight: 700;
    }
    .ds-ops-mgmt-screen .ops2027-instructor-col { width: 90px; max-width: 110px; }
    .ds-ops-mgmt-screen .ops2027-instructor-name {
      display: block;
      max-width: 100px;
      white-space: normal;
      line-height: 1.15;
    }
    .ds-ops-mgmt-screen .ops2027-number-col { width: 68px; }
    .ds-ops-mgmt-screen .ops2027-toggle-col { width: 78px; }
    .ds-ops-mgmt-screen .ops2027-cell-button,
    .ds-ops-mgmt-screen .ops2027-toggle-button {
      min-width: 30px;
      min-height: 28px;
      border: 0;
      border-radius: 7px;
      font-weight: 900;
      cursor: pointer;
    }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-yes { color: #166534; background: #dcfce7; }
    .ds-ops-mgmt-screen .ops2027-cell-button.is-no { color: #b91c1c; background: #fee2e2; }
    .ds-ops-mgmt-screen .ops2027-cell-button:disabled { cursor: not-allowed; opacity: .8; }
    .ds-ops-mgmt-screen .ops2027-toggle-button.is-yes { color: #166534; background: #dcfce7; }
    .ds-ops-mgmt-screen .ops2027-toggle-button.is-no { color: #475569; background: #e2e8f0; }
    .ds-ops-mgmt-screen .ops2027-stock-input {
      width: 58px !important;
      min-width: 58px !important;
      max-width: 58px !important;
      padding: 4px 5px !important;
      text-align: center;
    }
    .ds-ops-mgmt-screen .ops2027-stock-total { font-weight: 900; }
    .ds-ops-mgmt-screen .ops2027-stock-total.is-empty { color: #b91c1c; }
    .ds-ops-mgmt-screen .ops2027-waiting { display: block; margin-top: 2px; color: #b91c1c; font-size: .72rem; }
    .ds-ops-mgmt-screen .ops2027-out { display: inline-block; padding: 4px 6px; border-radius: 6px; color: #b91c1c; background: #fee2e2; font-size: .72rem; font-weight: 800; }
    .ds-ops-mgmt-screen .ops2027-empty,
    .ds-ops-mgmt-screen .ops2027-error,
    .ds-ops-mgmt-screen .ops2027-loading { width: fit-content; max-width: 100%; margin-inline: auto; padding: 18px; border: 1px solid var(--ds-border, #e2e8f0); border-radius: 10px; background: #fff; box-sizing: border-box; }
    .ops2027-modal-backdrop {
      position: fixed; inset: 0; z-index: 9999; display: grid; place-items: center;
      padding: 20px; background: rgba(15, 23, 42, .42);
    }
    .ops2027-modal { width: min(360px, 100%); padding: 18px; border-radius: 14px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.24); text-align: right; }
    .ops2027-modal h3 { margin: 0 0 6px; }
    .ops2027-modal p { margin: 0 0 14px; color: #475569; }
    .ops2027-modal-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .ops2027-modal-actions button { padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; cursor: pointer; }
    .ops2027-modal-actions button[data-cancel] { margin-inline-start: auto; }
  `;
  document.head.appendChild(style);
}

function setCustomActive(root, tabKey) {
  root.querySelectorAll('.ds-ops-mgmt-tab').forEach((button) => {
    button.classList.remove('is-active');
    button.setAttribute('aria-pressed', 'false');
  });
  const active = root.querySelector(`[data-ops-custom-tab="${tabKey}"]`);
  active?.classList.add('is-active');
  active?.setAttribute('aria-pressed', 'true');
}

function createCustomButton(tabKey, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-exceptions-tab ds-ops-mgmt-tab';
  button.dataset.opsCustomTab = tabKey;
  button.setAttribute('aria-pressed', 'false');
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const root = rootElement();
    if (!root) return;
    customTab = tabKey;
    setCustomActive(root, tabKey);
    renderCustomTab(root, tabKey);
  });
  return button;
}

function ensureTabs(root) {
  const tabs = tabsElement(root);
  if (!tabs) return;
  const definitions = [
    [TAB_WORKSHOP_TRAINING, 'הכשרות סדנאות'],
    [TAB_COURSE_TRAINING, 'הכשרות קורסים'],
    [TAB_PRINT_KITS, 'ערכות דפוס']
  ];
  definitions.forEach(([key, label]) => {
    let button = tabs.querySelector(`[data-ops-custom-tab="${key}"]`);
    if (!button) {
      button = createCustomButton(key, label);
      tabs.appendChild(button);
    }
    if (cleanText(button.textContent) !== label) button.textContent = label;
    button.hidden = !is2027(root);
  });
}

function resetCustomOnNativeClick(event) {
  const nativeButton = event.target?.closest?.('.ds-ops-mgmt-tab[data-ops-tab]');
  if (!nativeButton) return;
  customTab = '';
}

function headerHtml(title, note = '') {
  return `<div class="ops2027-header"><h2 class="ops2027-title">${escapeHtml(title)}</h2>${note ? `<p class="ops2027-note">${escapeHtml(note)}</p>` : ''}</div>`;
}

function loadingHtml() {
  return '<div class="ops2027-loading">טוען נתונים...</div>';
}

function errorHtml(error) {
  const message = cleanText(error?.message || error || 'אירעה שגיאה בטעינת הנתונים');
  return `<div class="ops2027-error">${escapeHtml(message)}</div>`;
}

function emptyHtml(message) {
  return `<div class="ops2027-empty">${escapeHtml(message)}</div>`;
}

async function loadCoursesAndAssignments() {
  const [coursesResult, activitiesResult] = await Promise.all([
    supabase
      .from(COURSE_TABLE)
      .select('id, short_name, full_name, gefen_number, sort_order, is_active, requires_print_kit')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('activity_season', SCHOOL_2027)
      .eq('activity_type', 'course')
  ]);
  if (coursesResult.error) throw coursesResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  const courses = coursesResult.data || [];
  const assignments = new Map();
  const instructors = new Set();

  (activitiesResult.data || []).forEach((row) => {
    if (row?.deleted_at || row?.is_deleted === true) return;
    const course = findCourseForActivity(row, courses);
    if (!course) return;
    activityInstructorNames(row).forEach((name) => {
      instructors.add(name);
      assignments.set(pairKey(course.id, name), { courseId: course.id, instructorName: name });
    });
  });

  return {
    courses,
    assignments,
    instructors: Array.from(instructors).sort((a, b) => a.localeCompare(b, 'he', { numeric: true }))
  };
}

function isInactiveListValue(value) {
  if (value === false) return true;
  const text = normalize(value);
  return ['false', '0', 'no', 'inactive', 'לא פעיל'].includes(text);
}

function isOpenSchool2027WorkshopActivity(row = {}) {
  const type = normalize(row?.activity_type || row?.item_type || row?.type);
  const status = normalize(row?.status);
  if (row?.deleted_at || row?.is_deleted === true || row?.deleted === true) return false;
  if (['נמחק', 'מחוק', 'deleted', 'בוטל', 'מבוטל', 'cancelled', 'canceled'].includes(status)) return false;
  return type === 'workshop' || type === 'סדנה';
}

function workshopDisplayName(row = {}) {
  return cleanText(row?.stock_group_name || row?.stock_item_name || row?.stock_label || row?.activity_name || row?.short_name || row?.full_name || row?.name || row?.label || row?.workshop_name);
}

function addWorkshopColumn(columns, row = {}, fallbackName = '') {
  const name = workshopDisplayName(row) || cleanText(fallbackName);
  const key = resolveWorkshopStockKey({ ...row, short_name: name, activity_name: row?.activity_name || name, name }, { aliases: WORKSHOP_STOCK_ALIASES });
  if (!key || columns.has(key)) return key || null;
  columns.set(key, { key, name });
  return key;
}

function isActiveWorkshopCatalogRow(row = {}) {
  const category = normalize(row?.category);
  const type = normalize(row?.activity_type || row?.type || row?.item_type || row?.parent_value);
  return category === 'activity_names' && type === 'workshop' && !isInactiveListValue(row?.active ?? row?.is_active);
}

export function buildWorkshopTrainingMatrix({ instructors = [], catalogRows = [], trainings = [], activities = [] } = {}) {
  const activeInstructorNames = new Map();
  for (const instructor of instructors || []) {
    const name = cleanText(instructor?.full_name || instructor?.instructor_name || instructor?.name);
    if (!name || !isActiveInstructor(instructor?.active ?? instructor?.is_active)) continue;
    activeInstructorNames.set(normalize(name), name);
  }

  const workshopColumns = new Map();
  const catalogActivityNoToKey = new Map();
  const catalogNameToKey = new Map();
  for (const row of catalogRows || []) {
    if (!isActiveWorkshopCatalogRow(row)) continue;
    const key = addWorkshopColumn(workshopColumns, row);
    const activityNo = cleanText(row?.activity_no);
    const nameKey = normalize(workshopDisplayName(row));
    if (key && activityNo && !catalogActivityNoToKey.has(activityNo)) catalogActivityNoToKey.set(activityNo, key);
    if (key && nameKey && !catalogNameToKey.has(nameKey)) catalogNameToKey.set(nameKey, key);
  }

  const trainingMap = new Map();
  for (const row of trainings || []) {
    const instructor = cleanText(row?.instructor_name);
    const instructorKey = normalize(instructor);
    if (!activeInstructorNames.has(instructorKey)) continue;
    const workshopName = cleanText(row?.workshop_name);
    if (!workshopName) continue;
    const workshopKey = catalogNameToKey.get(normalize(workshopName)) || addWorkshopColumn(workshopColumns, { workshop_name: workshopName, name: workshopName }, workshopName);
    if (workshopKey && row?.is_trained === true) trainingMap.set(`${workshopKey}::${instructorKey}`, true);
  }

  const assignedPairs = new Set();
  for (const row of activities || []) {
    if (!isOpenSchool2027WorkshopActivity(row)) continue;
    const resolvedKey = resolveWorkshopStockKey(row, { aliases: WORKSHOP_STOCK_ALIASES });
    const workshopKey = workshopColumns.has(resolvedKey) ? resolvedKey : catalogActivityNoToKey.get(cleanText(row?.activity_no));
    if (!workshopKey || !workshopColumns.has(workshopKey)) continue;
    activityInstructorNames(row).forEach((name) => {
      const instructorKey = normalize(name);
      if (!activeInstructorNames.has(instructorKey)) return;
      assignedPairs.add(`${workshopKey}::${instructorKey}`);
    });
  }

  const rows = Array.from(activeInstructorNames.values()).sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));
  const workshops = Array.from(workshopColumns.values()).sort((a, b) => a.name.localeCompare(b.name, 'he', { numeric: true }));

  return { rows, workshops, assignedPairs, trainingMap };
}

async function loadWorkshopMatrixData() {
  const [trainingResult, activitiesResult, instructorsResult, catalogResult] = await Promise.all([
    supabase.from(WORKSHOP_TRAINING_TABLE).select('workshop_name, instructor_name, is_trained'),
    supabase
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('activity_season', SCHOOL_2027)
      .eq('activity_type', 'workshop'),
    supabase.from(INSTRUCTOR_TABLE).select('emp_id, full_name, active'),
    supabase
      .from(LISTS_TABLE)
      .select('list_id,category,value,label,active,is_active,sort_order,activity_no,activity_name,activity_type,type,stock_group_key,stock_group_name,stock_item_name,stock_label,parent_value')
      .eq('category', 'activity_names')
      .order('sort_order', { ascending: true, nullsFirst: false })
  ]);
  if (trainingResult.error) throw trainingResult.error;
  if (activitiesResult.error) throw activitiesResult.error;
  if (instructorsResult.error) throw instructorsResult.error;
  if (catalogResult.error) throw catalogResult.error;

  return buildWorkshopTrainingMatrix({
    instructors: instructorsResult.data || [],
    catalogRows: catalogResult.data || [],
    trainings: trainingResult.data || [],
    activities: activitiesResult.data || []
  });
}
function matrixTableHtml({ rows, instructors, rowLabel, cellHtml, firstColumnLabel = 'שם קורס', orientation = 'rows-first', columnLabel = (name) => name }) {
  if (!instructors.length) return emptyHtml('עדיין אין מדריכים משובצים.');
  if (!rows.length) return emptyHtml('עדיין אין נתונים להצגה.');
  const head = instructors.map((name) => `<th class="ops2027-instructor-col"><span class="ops2027-instructor-name">${escapeHtml(columnLabel(name))}</span></th>`).join('');
  const body = rows.map((row) => `<tr><td class="ops2027-course-col">${escapeHtml(rowLabel(row))}</td>${instructors.map((name) => `<td class="ops2027-instructor-col">${cellHtml(row, name)}</td>`).join('')}</tr>`).join('');
  const firstClass = orientation === 'instructors-first' ? 'ops2027-instructor-col' : 'ops2027-course-col';
  return `<div class="ops2027-table-shell"><table class="ops2027-table"><thead><tr><th class="${firstClass}">${escapeHtml(firstColumnLabel)}</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function renderWorkshopTraining(root, token) {
  const content = contentElement(root);
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות סדנאות')}${loadingHtml()}</div>`;
  try {
    const data = await loadWorkshopMatrixData();
    if (token !== renderToken || customTab !== TAB_WORKSHOP_TRAINING) return;
    const table = matrixTableHtml({
      rows: data.rows,
      instructors: data.workshops,
      rowLabel: (name) => name,
      firstColumnLabel: 'שם מדריך',
      orientation: 'instructors-first',
      columnLabel: (workshop) => workshop.name,
      cellHtml: (instructor, workshop) => {
        const key = `${workshop.key}::${normalize(instructor)}`;
        const state = trainingCellState({ trained: data.trainingMap.get(key) === true, assigned: data.assignedPairs.has(key) });
        if (state.state === 'empty') return '';
        const className = state.tone === 'green' ? 'is-yes' : 'is-no';
        const label = state.state === 'trained' ? 'עבר הכשרה' : 'טרם עבר הכשרה';
        return `<span class="ops2027-cell-button ${className}" aria-label="${label}">${state.text}</span>`;
      }
    });
    content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות סדנאות')}${table}</div>`;
  } catch (error) {
    if (token !== renderToken) return;
    content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות סדנאות')}${errorHtml(error)}</div>`;
  }
}

async function renderCourseTraining(root, token) {
  const content = contentElement(root);
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות קורסים')}${loadingHtml()}</div>`;
  try {
    const base = await loadCoursesAndAssignments();
    const trainingResult = await supabase.from(COURSE_TRAINING_TABLE).select('course_id, instructor_name, is_trained');
    if (trainingResult.error) throw trainingResult.error;
    if (token !== renderToken || customTab !== TAB_COURSE_TRAINING) return;
    const trainingMap = new Map((trainingResult.data || []).map((row) => [pairKey(row.course_id, row.instructor_name), row.is_trained === true]));
    const assignedCourseIds = new Set(Array.from(base.assignments.values()).map((item) => String(item.courseId)));
    const rows = base.courses.filter((course) => assignedCourseIds.has(String(course.id)));
    const table = matrixTableHtml({
      rows,
      instructors: base.instructors,
      rowLabel: courseDisplayName,
      cellHtml: (course, instructor) => {
        const key = pairKey(course.id, instructor);
        if (!base.assignments.has(key)) return '';
        const trained = trainingMap.get(key) === true;
        return `<button type="button" class="ops2027-cell-button ${trained ? 'is-yes' : 'is-no'}" data-course-training-toggle data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" data-trained="${trained ? '1' : '0'}" aria-label="${trained ? 'עבר הכשרה' : 'טרם עבר הכשרה'}">${trained ? '✓' : '✕'}</button>`;
      }
    });
    content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות קורסים')}${table}</div>`;
    content.querySelectorAll('[data-course-training-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggleCourseTraining(button));
    });
  } catch (error) {
    if (token !== renderToken) return;
    content.innerHTML = `<div class="ops2027-view">${headerHtml('הכשרות קורסים')}${errorHtml(error)}</div>`;
  }
}

async function toggleCourseTraining(button) {
  const next = button.dataset.trained !== '1';
  button.disabled = true;
  const payload = {
    course_id: button.dataset.courseId,
    instructor_name: cleanText(button.dataset.instructor),
    is_trained: next,
    updated_at: new Date().toISOString()
  };
  const result = await supabase.from(COURSE_TRAINING_TABLE).upsert(payload, { onConflict: 'course_id,instructor_name' });
  if (result.error) {
    button.disabled = false;
    window.alert(result.error.message || 'שמירת ההכשרה נכשלה');
    return;
  }
  button.dataset.trained = next ? '1' : '0';
  button.classList.toggle('is-yes', next);
  button.classList.toggle('is-no', !next);
  button.textContent = next ? '✓' : '✕';
  button.setAttribute('aria-label', next ? 'עבר הכשרה' : 'טרם עבר הכשרה');
  button.disabled = false;
}

function inventoryTotal(row) {
  return KIT_LOCATIONS.reduce((sum, location) => sum + Math.max(0, Number(row?.[location.field] || 0)), 0);
}

function inventoryMap(rows) {
  return new Map((rows || []).map((row) => [String(row.course_id), row]));
}

function waitingCounts(base, distributions) {
  const distributed = new Set((distributions || []).map((row) => pairKey(row.course_id, row.instructor_name)));
  const counts = new Map();
  base.assignments.forEach((assignment, key) => {
    if (distributed.has(key)) return;
    counts.set(String(assignment.courseId), (counts.get(String(assignment.courseId)) || 0) + 1);
  });
  return counts;
}

function stockTableHtml(base, inventoryRows, distributionRows) {
  const stockMap = inventoryMap(inventoryRows);
  const waits = waitingCounts(base, distributionRows);
  const editable = canEditOperationsQuantities();
  const requiredCourses = base.courses.filter((course) => course.requires_print_kit === true);
  if (!requiredCourses.length) return emptyHtml('אין קורסים שמוגדרים כבעלי ערכת דפוס.');
  const body = requiredCourses.map((course) => {
    const stock = stockMap.get(String(course.id)) || {};
    const total = inventoryTotal(stock);
    const waiting = waits.get(String(course.id)) || 0;
    const locationCells = KIT_LOCATIONS.map((location) => {
      const value = Math.max(0, Number(stock?.[location.field] || 0));
      const content = editable
        ? `<input type="number" min="0" step="1" class="ds-input ops2027-stock-input" data-kit-stock-input data-course-id="${escapeHtml(course.id)}" data-location="${escapeHtml(location.key)}" value="${value}">`
        : `<span class="ops2027-stock-text">${value}</span>`;
      return `<td class="ops2027-number-col">${content}</td>`;
    }).join('');
    return `<tr>
      <td class="ops2027-course-col">${escapeHtml(courseDisplayName(course))}</td>
      ${locationCells}
      <td class="ops2027-number-col"><span class="ops2027-stock-total ${total === 0 ? 'is-empty' : ''}">${total === 0 ? 'נגמר' : total}</span>${total === 0 && waiting > 0 ? `<span class="ops2027-waiting">ממתינים: ${waiting}</span>` : ''}</td>
    </tr>`;
  }).join('');
  return `<div class="ops2027-table-shell"><table class="ops2027-table"><thead><tr><th class="ops2027-course-col">שם קורס</th>${KIT_LOCATIONS.map((location) => `<th class="ops2027-number-col">${escapeHtml(location.label)}</th>`).join('')}<th class="ops2027-number-col">סה״כ</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function kitMatrixHtml(base, inventoryRows, distributionRows) {
  const editable = canEditOperationsQuantities();
  const requiredCourses = base.courses.filter((course) => course.requires_print_kit === true);
  const requiredCourseIds = new Set(requiredCourses.map((course) => String(course.id)));
  const relevantAssignments = new Map(Array.from(base.assignments.entries()).filter(([, item]) => requiredCourseIds.has(String(item.courseId))));
  const relevantInstructors = base.instructors.filter((name) => Array.from(relevantAssignments.values()).some((item) => normalize(item.instructorName) === normalize(name)));
  const stockMap = inventoryMap(inventoryRows);
  const distributed = new Map((distributionRows || []).map((row) => [pairKey(row.course_id, row.instructor_name), row]));
  return matrixTableHtml({
    rows: requiredCourses.filter((course) => Array.from(relevantAssignments.values()).some((item) => String(item.courseId) === String(course.id))),
    instructors: relevantInstructors,
    rowLabel: courseDisplayName,
    cellHtml: (course, instructor) => {
      const key = pairKey(course.id, instructor);
      if (!relevantAssignments.has(key)) return '';
      const delivery = distributed.get(key);
      if (delivery) {
        return editable ? `<button type="button" class="ops2027-cell-button is-yes" data-kit-return data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="הערכה נמסרה">✓</button>` : '<span class="ops2027-cell-button is-yes" aria-label="הערכה נמסרה">✓</span>';
      }
      const total = inventoryTotal(stockMap.get(String(course.id)) || {});
      if (total <= 0) return '<span class="ops2027-out">אין מלאי</span>';
      return editable ? `<button type="button" class="ops2027-cell-button is-no" data-kit-deliver data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="טרם קיבל ערכה">✕</button>` : '<span class="ops2027-cell-button is-no" aria-label="טרם קיבל ערכה">✕</span>';
    }
  });
}

async function renderPrintKits(root, token) {
  const content = contentElement(root);
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view">${headerHtml('ערכות דפוס')}${loadingHtml()}</div>`;
  try {
    const base = await loadCoursesAndAssignments();
    const [inventoryResult, distributionResult] = await Promise.all([
      supabase.from(KIT_INVENTORY_TABLE).select('course_id, warehouse_quantity, hila_quantity, idan_quantity, gil_quantity'),
      supabase.from(KIT_DISTRIBUTION_TABLE).select('course_id, instructor_name, source_location')
    ]);
    if (inventoryResult.error) throw inventoryResult.error;
    if (distributionResult.error) throw distributionResult.error;
    if (token !== renderToken || customTab !== TAB_PRINT_KITS) return;
    const stockTable = stockTableHtml(base, inventoryResult.data || [], distributionResult.data || []);
    const kitMatrix = kitMatrixHtml(base, inventoryResult.data || [], distributionResult.data || []);
    content.innerHTML = `<div class="ops2027-view">
      ${headerHtml('ערכות דפוס')}
      <section class="ops2027-section"><h3 class="ops2027-section-title">מלאי ערכות</h3>${stockTable}</section>
      <section class="ops2027-section"><h3 class="ops2027-section-title">ערכות למדריכים</h3>${kitMatrix}</section>
    </div>`;
    bindKitEvents(content);
  } catch (error) {
    if (token !== renderToken) return;
    content.innerHTML = `<div class="ops2027-view">${headerHtml('ערכות דפוס')}${errorHtml(error)}</div>`;
  }
}

function bindKitEvents(content) {
  content.querySelectorAll('[data-kit-stock-input]').forEach((input) => {
    input.addEventListener('change', () => saveStockInput(input));
  });
  content.querySelectorAll('[data-kit-deliver]').forEach((button) => {
    button.addEventListener('click', () => openLocationPicker(button.dataset.courseId, button.dataset.instructor));
  });
  content.querySelectorAll('[data-kit-return]').forEach((button) => {
    button.addEventListener('click', () => returnKit(button));
  });
}

async function saveStockInput(input) {
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
    renderCustomTab(rootElement(), TAB_PRINT_KITS);
    return;
  }
  renderCustomTab(rootElement(), TAB_PRINT_KITS);
}

async function availableLocations(courseId) {
  const result = await supabase
    .from(KIT_INVENTORY_TABLE)
    .select('warehouse_quantity, hila_quantity, idan_quantity, gil_quantity')
    .eq('course_id', courseId)
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data || {};
  return KIT_LOCATIONS.filter((location) => Number(row?.[location.field] || 0) > 0);
}

async function openLocationPicker(courseId, instructorName) {
  try {
    const locations = await availableLocations(courseId);
    if (!locations.length) {
      window.alert('אין מלאי זמין למסירה.');
      renderCustomTab(rootElement(), TAB_PRINT_KITS);
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
          renderCustomTab(rootElement(), TAB_PRINT_KITS);
          return;
        }
        backdrop.remove();
        renderCustomTab(rootElement(), TAB_PRINT_KITS);
      });
    });
    document.body.appendChild(backdrop);
  } catch (error) {
    window.alert(error?.message || 'טעינת המלאי נכשלה');
  }
}

async function returnKit(button) {
  if (!window.confirm('להחזיר את הערכה למלאי ולסמן שהמדריך טרם קיבל?')) return;
  button.disabled = true;
  const result = await supabase.rpc('return_course_print_kit', {
    p_course_id: button.dataset.courseId,
    p_instructor_name: button.dataset.instructor
  });
  if (result.error) {
    button.disabled = false;
    window.alert(result.error.message || 'החזרת הערכה למלאי נכשלה');
    return;
  }
  renderCustomTab(rootElement(), TAB_PRINT_KITS);
}

function renderCustomTab(root, tabKey) {
  if (!root || !is2027(root)) return;
  customTab = tabKey;
  setCustomActive(root, tabKey);
  const token = ++renderToken;
  if (tabKey === TAB_WORKSHOP_TRAINING) renderWorkshopTraining(root, token);
  if (tabKey === TAB_COURSE_TRAINING) renderCourseTraining(root, token);
  if (tabKey === TAB_PRINT_KITS) renderPrintKits(root, token);
}

function syncOperationsUi() {
  const root = rootElement();
  if (!root) return;
  ensureStyle();
  hidePeriodFor2027(root);
  setNativeTabVisibility(root);
  ensureTabs(root);
  if (!is2027(root) && customTab) {
    customTab = '';
    root.querySelector('[data-ops-tab="instructors"]')?.click?.();
    return;
  }
  if (customTab) {
    const button = root.querySelector(`[data-ops-custom-tab="${customTab}"]`);
    if (button && !button.classList.contains('is-active')) setCustomActive(root, customTab);
  }
}

function queueSync() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    syncOperationsUi();
  });
}

function observe() {
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  observer?.disconnect?.();
  observer = new MutationObserver(() => queueSync());
  observer.observe(app, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', resetCustomOnNativeClick, true);
  document.addEventListener('change', (event) => {
    const root = rootElement();
    if (root && event.target === findPeriodControl(root)) queueSync();
  }, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueSync();
      observe();
    }, { once: true });
  } else {
    queueSync();
    observe();
  }
}
