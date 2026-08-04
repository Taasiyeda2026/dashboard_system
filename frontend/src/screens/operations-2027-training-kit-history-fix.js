import { supabase } from '../supabase-client.js';
import { escapeHtml } from './shared/html.js';

const TAB_COURSE_TRAINING = 'course_training_matrix';
const TAB_PRINT_KITS = 'course_print_kits';
const COURSE_TABLE = 'proposal_gefen_courses';
const INSTRUCTOR_TABLE = 'contacts_instructors';
const TRAINING_TABLE = 'course_instructor_trainings';
const KIT_INVENTORY_TABLE = 'course_print_kit_inventory';
const KIT_DISTRIBUTION_TABLE = 'course_print_kit_distributions';
const KIT_LOCATIONS = [
  { key: 'warehouse', field: 'warehouse_quantity', label: 'מחסן' },
  { key: 'hila', field: 'hila_quantity', label: 'הילה' },
  { key: 'idan', field: 'idan_quantity', label: 'עידן' },
  { key: 'gil', field: 'gil_quantity', label: 'גיל' }
];

let observer = null;
let queued = false;
let renderSequence = 0;
let editPermissionPromise = null;

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

function rootElement() {
  return document.querySelector('.ds-ops-mgmt-screen');
}

function contentElement() {
  return rootElement()?.querySelector?.('.ds-ops-mgmt-content') || null;
}

function activeCustomTab() {
  return rootElement()
    ?.querySelector?.('.ds-ops-mgmt-tab.is-active[data-ops-custom-tab]')
    ?.dataset?.opsCustomTab || '';
}

function ensureStyle() {
  if (document.getElementById('ops-2027-training-kit-history-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-training-kit-history-style';
  style.textContent = `
    .ops2027-history-note { margin: 0 0 12px; color: #64748b; text-align: center; }
    .ops2027-history-group + .ops2027-history-group { margin-top: 24px; }
    .ops2027-history-group-title { margin: 0 0 8px; text-align: center; font-size: 1rem; font-weight: 800; }
    .ops2027-history-status { display: inline-block; min-width: 30px; min-height: 28px; padding: 5px 8px; border-radius: 7px; box-sizing: border-box; font-weight: 900; }
    .ops2027-history-status.is-yes { color: #166534; background: #dcfce7; }
    .ops2027-history-status.is-no { color: #b91c1c; background: #fee2e2; }
  `;
  document.head.appendChild(style);
}

async function canEditOperations() {
  if (!editPermissionPromise) {
    editPermissionPromise = supabase
      .rpc('app_is_admin_or_operation_manager')
      .then(({ data, error }) => !error && data === true)
      .catch(() => false);
  }
  return editPermissionPromise;
}

async function loadInstructors() {
  const result = await supabase
    .from(INSTRUCTOR_TABLE)
    .select('full_name, active')
    .order('full_name', { ascending: true });
  if (result.error) throw result.error;
  return (result.data || [])
    .map((row) => ({ name: cleanText(row?.full_name), active: normalize(row?.active) === 'yes' }))
    .filter((row) => row.name);
}

async function loadTrainingData() {
  const [coursesResult, instructors, trainingResult, editable] = await Promise.all([
    supabase
      .from(COURSE_TABLE)
      .select('id, short_name, full_name, gefen_number, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    loadInstructors(),
    supabase.from(TRAINING_TABLE).select('course_id, instructor_name, is_trained'),
    canEditOperations()
  ]);
  if (coursesResult.error) throw coursesResult.error;
  if (trainingResult.error) throw trainingResult.error;
  return {
    courses: coursesResult.data || [],
    instructors: instructors.filter((row) => row.active).map((row) => row.name),
    trainingMap: new Map((trainingResult.data || []).map((row) => [pairKey(row.course_id, row.instructor_name), row.is_trained === true])),
    editable
  };
}

function statusControl({ yes, editable, attributes = '' }) {
  const label = yes ? 'עבר הכשרה' : 'לא עבר הכשרה';
  const symbol = yes ? '✓' : '✕';
  const className = yes ? 'is-yes' : 'is-no';
  if (!editable) {
    return `<span class="ops2027-history-status ${className}" aria-label="${label}">${symbol}</span>`;
  }
  return `<button type="button" class="ops2027-cell-button ${className}" ${attributes} aria-label="${label}">${symbol}</button>`;
}

function matrixHtml({ rows, instructors, cellHtml, firstColumnLabel = 'שם קורס', emptyMessage }) {
  if (!rows.length || !instructors.length) return `<div class="ops2027-empty">${escapeHtml(emptyMessage)}</div>`;
  const head = instructors
    .map((name) => `<th class="ops2027-instructor-col"><span class="ops2027-instructor-name">${escapeHtml(name)}</span></th>`)
    .join('');
  const body = rows.map((row) => `<tr>
    <td class="ops2027-course-col">${escapeHtml(courseLabel(row))}</td>
    ${instructors.map((name) => `<td class="ops2027-instructor-col">${cellHtml(row, name)}</td>`).join('')}
  </tr>`).join('');
  return `<div class="ops2027-table-shell"><table class="ops2027-table"><thead><tr>
    <th class="ops2027-course-col">${escapeHtml(firstColumnLabel)}</th>${head}
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function loadingView(tab, title) {
  const content = contentElement();
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view" data-ops-history-fix="${tab}">
    <div class="ops2027-header"><h2 class="ops2027-title">${escapeHtml(title)}</h2></div>
    <div class="ops2027-loading">טוען נתונים...</div>
  </div>`;
}

function errorView(tab, title, error) {
  const content = contentElement();
  if (!content) return;
  const message = cleanText(error?.message || error || 'אירעה שגיאה בטעינת הנתונים');
  content.innerHTML = `<div class="ops2027-view" data-ops-history-fix="${tab}">
    <div class="ops2027-header"><h2 class="ops2027-title">${escapeHtml(title)}</h2></div>
    <div class="ops2027-error">${escapeHtml(message)}</div>
  </div>`;
}

async function renderCourseTraining(sequence) {
  const data = await loadTrainingData();
  if (sequence !== renderSequence || activeCustomTab() !== TAB_COURSE_TRAINING) return;
  const table = matrixHtml({
    rows: data.courses,
    instructors: data.instructors,
    emptyMessage: 'אין מדריכים פעילים או קורסים פעילים להצגה.',
    cellHtml: (course, instructor) => {
      const trained = data.trainingMap.get(pairKey(course.id, instructor)) === true;
      return statusControl({
        yes: trained,
        editable: data.editable,
        attributes: `data-history-training-toggle data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" data-trained="${trained ? '1' : '0'}"`
      });
    }
  });
  const content = contentElement();
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view" data-ops-history-fix="${TAB_COURSE_TRAINING}">
    <div class="ops2027-header"><h2 class="ops2027-title">הכשרות קורסים</h2></div>
    <p class="ops2027-history-note">כל המדריכים הפעילים מול כל הקורסים הפעילים, ללא תלות בשיבוץ נוכחי.</p>
    ${table}
  </div>`;
  content.querySelectorAll('[data-history-training-toggle]').forEach((button) => {
    button.addEventListener('click', () => toggleTraining(button));
  });
}

async function toggleTraining(button) {
  const next = button.dataset.trained !== '1';
  button.disabled = true;
  const result = await supabase.from(TRAINING_TABLE).upsert({
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
  button.dataset.trained = next ? '1' : '0';
  button.classList.toggle('is-yes', next);
  button.classList.toggle('is-no', !next);
  button.textContent = next ? '✓' : '✕';
  button.setAttribute('aria-label', next ? 'עבר הכשרה' : 'לא עבר הכשרה');
  button.disabled = false;
}

function inventoryTotal(row) {
  return KIT_LOCATIONS.reduce((sum, location) => sum + Math.max(0, Number(row?.[location.field] || 0)), 0);
}

async function loadKitData() {
  const [coursesResult, instructors, inventoryResult, distributionResult, editable] = await Promise.all([
    supabase
      .from(COURSE_TABLE)
      .select('id, short_name, full_name, gefen_number, sort_order, is_active, requires_print_kit')
      .eq('requires_print_kit', true)
      .order('sort_order', { ascending: true }),
    loadInstructors(),
    supabase.from(KIT_INVENTORY_TABLE).select('course_id, warehouse_quantity, hila_quantity, idan_quantity, gil_quantity'),
    supabase.from(KIT_DISTRIBUTION_TABLE).select('course_id, instructor_name, source_location'),
    canEditOperations()
  ]);
  if (coursesResult.error) throw coursesResult.error;
  if (inventoryResult.error) throw inventoryResult.error;
  if (distributionResult.error) throw distributionResult.error;

  const activeNames = instructors.filter((row) => row.active).map((row) => row.name);
  const activeKeys = new Set(activeNames.map(normalize));
  const distributions = distributionResult.data || [];
  const inactiveHolders = Array.from(new Set(
    distributions
      .map((row) => cleanText(row?.instructor_name))
      .filter((name) => name && !activeKeys.has(normalize(name)))
  )).sort((a, b) => a.localeCompare(b, 'he', { numeric: true }));

  return {
    courses: coursesResult.data || [],
    activeNames,
    inactiveHolders,
    inventoryMap: new Map((inventoryResult.data || []).map((row) => [String(row.course_id), row])),
    distributionMap: new Map(distributions.map((row) => [pairKey(row.course_id, row.instructor_name), row])),
    editable
  };
}

function stockTableHtml(data) {
  if (!data.courses.length) return '<div class="ops2027-empty">אין ערכות להצגה.</div>';
  const body = data.courses.map((course) => {
    const stock = data.inventoryMap.get(String(course.id)) || {};
    const total = inventoryTotal(stock);
    const locations = KIT_LOCATIONS.map((location) => {
      const value = Math.max(0, Number(stock?.[location.field] || 0));
      const control = data.editable
        ? `<input type="number" min="0" step="1" class="ds-input ops2027-stock-input" data-history-kit-stock data-course-id="${escapeHtml(course.id)}" data-location="${escapeHtml(location.key)}" value="${value}">`
        : `<span class="ops2027-stock-text">${value}</span>`;
      return `<td class="ops2027-number-col">${control}</td>`;
    }).join('');
    return `<tr><td class="ops2027-course-col">${escapeHtml(courseLabel(course))}</td>${locations}
      <td class="ops2027-number-col"><span class="ops2027-stock-total ${total === 0 ? 'is-empty' : ''}">${total}</span></td></tr>`;
  }).join('');
  return `<div class="ops2027-table-shell"><table class="ops2027-table"><thead><tr>
    <th class="ops2027-course-col">שם ערכה</th>
    ${KIT_LOCATIONS.map((location) => `<th class="ops2027-number-col">${escapeHtml(location.label)}</th>`).join('')}
    <th class="ops2027-number-col">סה״כ</th>
  </tr></thead><tbody>${body}</tbody></table></div>`;
}

function kitCellHtml(data, course, instructor, allowDelivery) {
  const key = pairKey(course.id, instructor);
  const distribution = data.distributionMap.get(key);
  if (distribution) {
    if (!data.editable) return '<span class="ops2027-history-status is-yes" aria-label="יש ערכה">✓</span>';
    return `<button type="button" class="ops2027-cell-button is-yes" data-history-kit-return data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="יש ערכה">✓</button>`;
  }
  if (!allowDelivery) return '';
  const available = inventoryTotal(data.inventoryMap.get(String(course.id)) || {});
  if (available <= 0) return '<span class="ops2027-out">אין מלאי</span>';
  if (!data.editable) return '<span class="ops2027-history-status is-no" aria-label="אין ערכה">✕</span>';
  return `<button type="button" class="ops2027-cell-button is-no" data-history-kit-deliver data-course-id="${escapeHtml(course.id)}" data-instructor="${escapeHtml(instructor)}" aria-label="אין ערכה">✕</button>`;
}

async function renderPrintKits(sequence) {
  const data = await loadKitData();
  if (sequence !== renderSequence || activeCustomTab() !== TAB_PRINT_KITS) return;
  const activeMatrix = matrixHtml({
    rows: data.courses,
    instructors: data.activeNames,
    emptyMessage: 'אין מדריכים פעילים להצגה.',
    firstColumnLabel: 'שם ערכה',
    cellHtml: (course, instructor) => kitCellHtml(data, course, instructor, true)
  });
  const inactiveMatrix = matrixHtml({
    rows: data.courses,
    instructors: data.inactiveHolders,
    emptyMessage: 'אין ערכות אצל מדריכים לא פעילים.',
    firstColumnLabel: 'שם ערכה',
    cellHtml: (course, instructor) => kitCellHtml(data, course, instructor, false)
  });
  const content = contentElement();
  if (!content) return;
  content.innerHTML = `<div class="ops2027-view" data-ops-history-fix="${TAB_PRINT_KITS}">
    <div class="ops2027-header"><h2 class="ops2027-title">ערכות דפוס</h2></div>
    <section class="ops2027-section ops2027-history-group"><h3 class="ops2027-history-group-title">מלאי ערכות</h3>${stockTableHtml(data)}</section>
    <section class="ops2027-section ops2027-history-group"><h3 class="ops2027-history-group-title">מדריכים פעילים</h3>${activeMatrix}</section>
    <section class="ops2027-section ops2027-history-group"><h3 class="ops2027-history-group-title">מדריכים לא פעילים שמחזיקים ערכה</h3>${inactiveMatrix}</section>
  </div>`;
  bindKitEvents(content);
}

function bindKitEvents(content) {
  content.querySelectorAll('[data-history-kit-stock]').forEach((input) => {
    input.addEventListener('change', () => saveStock(input));
  });
  content.querySelectorAll('[data-history-kit-deliver]').forEach((button) => {
    button.addEventListener('click', () => openLocationPicker(button.dataset.courseId, button.dataset.instructor));
  });
  content.querySelectorAll('[data-history-kit-return]').forEach((button) => {
    button.addEventListener('click', () => returnKit(button));
  });
}

async function saveStock(input) {
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
  renderOverride(TAB_PRINT_KITS);
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
      return;
    }
    document.querySelector('.ops2027-history-modal')?.remove?.();
    const backdrop = document.createElement('div');
    backdrop.className = 'ops2027-modal-backdrop ops2027-history-modal';
    backdrop.innerHTML = `<div class="ops2027-modal" role="dialog" aria-modal="true">
      <h3>מסירת ערכה</h3><p>מאיפה נמסרה הערכה ל-${escapeHtml(instructorName)}?</p>
      <div class="ops2027-modal-actions">
        ${locations.map((location) => `<button type="button" data-history-location="${escapeHtml(location.key)}">${escapeHtml(location.label)}</button>`).join('')}
        <button type="button" data-history-cancel>ביטול</button>
      </div></div>`;
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('[data-history-cancel]')) backdrop.remove();
    });
    backdrop.querySelectorAll('[data-history-location]').forEach((button) => {
      button.addEventListener('click', async () => {
        backdrop.querySelectorAll('button').forEach((item) => { item.disabled = true; });
        const result = await supabase.rpc('deliver_course_print_kit', {
          p_course_id: courseId,
          p_instructor_name: instructorName,
          p_source_location: button.dataset.historyLocation
        });
        if (result.error) {
          window.alert(result.error.message || 'מסירת הערכה נכשלה');
          backdrop.remove();
          return;
        }
        backdrop.remove();
        renderOverride(TAB_PRINT_KITS);
      });
    });
    document.body.appendChild(backdrop);
  } catch (error) {
    window.alert(error?.message || 'טעינת המלאי נכשלה');
  }
}

async function returnKit(button) {
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
  renderOverride(TAB_PRINT_KITS);
}

function renderOverride(tab) {
  if (tab !== TAB_COURSE_TRAINING && tab !== TAB_PRINT_KITS) return;
  const sequence = ++renderSequence;
  const title = tab === TAB_COURSE_TRAINING ? 'הכשרות קורסים' : 'ערכות דפוס';
  loadingView(tab, title);
  const renderer = tab === TAB_COURSE_TRAINING ? renderCourseTraining : renderPrintKits;
  renderer(sequence).catch((error) => {
    if (sequence === renderSequence && activeCustomTab() === tab) errorView(tab, title, error);
  });
}

function sync() {
  const tab = activeCustomTab();
  if (tab !== TAB_COURSE_TRAINING && tab !== TAB_PRINT_KITS) return;
  const content = contentElement();
  if (!content) return;
  const marker = content.querySelector(`[data-ops-history-fix="${tab}"]`);
  if (!marker) renderOverride(tab);
}

function queueSync(delay = 40) {
  if (queued) return;
  queued = true;
  window.setTimeout(() => {
    queued = false;
    sync();
  }, delay);
}

function observe() {
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  observer?.disconnect?.();
  observer = new MutationObserver(() => queueSync());
  observer.observe(app, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  ensureStyle();
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-ops-custom-tab="course_training_matrix"], [data-ops-custom-tab="course_print_kits"]')) {
      queueSync(0);
      window.setTimeout(() => queueSync(0), 250);
    }
  }, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueSync(0);
      observe();
    }, { once: true });
  } else {
    queueSync(0);
    observe();
  }
}
