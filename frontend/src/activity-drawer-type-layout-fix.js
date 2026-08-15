const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const FIXED_ATTR = 'data-activity-drawer-type-layout-fixed';
const TEST_FLAG = '__ACTIVITY_DRAWER_TYPE_LAYOUT_FIX_TEST__';

const MULTI_INSTRUCTOR_TYPES = new Set(['workshop', 'escape_room']);
const SEASON_LABELS = {
  regular: '2026',
  summer_2026: 'קיץ 2026',
  school_2027: '2027'
};

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function parseExportRow(form) {
  try {
    return JSON.parse(form?.dataset?.exportRow || '{}') || {};
  } catch {
    return {};
  }
}

function normalizeType(value) {
  const raw = clean(value).toLowerCase();
  if (raw === 'קורס') return 'course';
  if (raw === 'אפטרסקול' || raw === 'חוג אפטרסקול') return 'after_school';
  if (raw === 'סדנה') return 'workshop';
  if (raw === 'סיור') return 'tour';
  if (raw === 'חדר בריחה') return 'escape_room';
  return raw;
}

function seasonLabel(value) {
  const key = clean(value);
  return SEASON_LABELS[key] || key || '—';
}

function fieldByLabel(form, label) {
  return [...form.querySelectorAll('.activity-drawer-inline__field')].find((field) => (
    clean(field.querySelector(':scope > .activity-drawer-inline__label')?.textContent) === label
  )) || null;
}

function makeInlineField(doc, { label, value, editNodes = [], fieldKey = '' }) {
  const field = doc.createElement('div');
  field.className = 'activity-drawer-inline__field';
  if (fieldKey) field.dataset.fieldKey = fieldKey;

  const labelEl = doc.createElement('div');
  labelEl.className = 'activity-drawer-inline__label';
  labelEl.textContent = label;

  const view = doc.createElement('div');
  view.className = 'activity-drawer-inline__value';
  view.setAttribute('data-mode', 'view');
  view.textContent = clean(value) || '—';

  field.append(labelEl, view);

  if (editNodes.length) {
    const edit = doc.createElement('div');
    edit.className = 'activity-drawer-inline__edit';
    edit.setAttribute('data-mode', 'edit');
    edit.hidden = true;

    const controls = doc.createElement('div');
    controls.className = 'activity-drawer-inline__controls';
    editNodes.forEach((node) => node && controls.append(node));
    edit.append(controls);
    field.append(edit);
  }

  return field;
}

function moveSeasonToHeader(form, row) {
  const seasonField = fieldByLabel(form, 'עונת פעילות');
  const headerGrid = form.querySelector('.activity-drawer-inline__header-grid');
  const meta = form.querySelector('.activity-drawer__meta--tags');
  if (!seasonField || !headerGrid) return false;

  const editWrapper = seasonField.querySelector('[data-mode="edit"]');
  const controls = editWrapper?.querySelector('.activity-drawer-inline__controls') || editWrapper;
  if (controls) {
    controls.removeAttribute('data-mode');
    controls.hidden = false;

    const headerField = form.ownerDocument.createElement('div');
    headerField.className = 'activity-drawer-inline__header-field activity-drawer-type-fix__season-edit';
    headerField.setAttribute('data-mode', 'edit');
    headerField.hidden = true;

    const label = form.ownerDocument.createElement('div');
    label.className = 'activity-drawer-inline__header-label';
    label.textContent = 'עונת פעילות';
    headerField.append(label, controls);
    headerGrid.append(headerField);
  }

  if (meta && !meta.querySelector('[data-activity-season-tag]')) {
    const tag = form.ownerDocument.createElement('span');
    tag.className = 'activity-drawer__meta-tag activity-drawer-type-fix__season-tag';
    tag.dataset.activitySeasonTag = 'true';
    tag.textContent = seasonLabel(row.activity_season || form.querySelector('[name="activity_season"]')?.value);
    meta.append(tag);
  }

  seasonField.remove();
  return true;
}

function splitInstructorField(form, row, activityType) {
  if (!MULTI_INSTRUCTOR_TYPES.has(activityType)) return false;
  const combinedField = fieldByLabel(form, 'מדריכים');
  if (!combinedField) return false;

  const oldValue = clean(combinedField.querySelector('[data-mode="view"]')?.textContent);
  const fallbackNames = oldValue.split('/').map(clean).filter(Boolean);
  const firstName = clean(row.instructor_name) || fallbackNames[0] || '—';
  const secondName = clean(row.instructor_name_2) || fallbackNames[1] || '—';

  const firstNodes = [
    combinedField.querySelector('[name="instructor_name"]'),
    combinedField.querySelector('[name="emp_id"]')
  ].filter(Boolean);
  const secondNodes = [
    combinedField.querySelector('[name="instructor_name_2"]'),
    combinedField.querySelector('[name="emp_id_2"]')
  ].filter(Boolean);
  const warning = combinedField.querySelector('.ds-error-text');
  if (warning) firstNodes.push(warning);

  const firstField = makeInlineField(form.ownerDocument, {
    label: 'מדריך/ה 1',
    value: firstName,
    editNodes: firstNodes,
    fieldKey: 'instructor-1'
  });
  const secondField = makeInlineField(form.ownerDocument, {
    label: 'מדריך/ה 2',
    value: secondName,
    editNodes: secondNodes,
    fieldKey: 'instructor-2'
  });

  combinedField.before(firstField, secondField);
  combinedField.remove();
  return true;
}

function markFieldKeys(form) {
  const map = new Map([
    ['מנהל פעילות', 'manager'],
    ['מדריך/ה', 'instructor'],
    ['מדריך/ה 1', 'instructor-1'],
    ['מדריך/ה 2', 'instructor-2'],
    ['כיתה / קבוצה', 'class-group'],
    ['שעות', 'hours'],
    ['מימון', 'funding'],
    ['גורם מימון', 'funding'],
    ['מחיר', 'price'],
    ['מספר משתתפים', 'participants']
  ]);

  form.querySelectorAll('.activity-drawer-inline__field').forEach((field) => {
    const label = clean(field.querySelector(':scope > .activity-drawer-inline__label')?.textContent);
    const key = map.get(label);
    if (key) field.dataset.fieldKey = key;
  });
}

function applyTypeGrid(form, activityType) {
  const grid = form.querySelector('.activity-drawer-inline__grid');
  if (!grid) return;
  grid.dataset.activityLayout = activityType || 'other';
  form.dataset.activityLayoutType = activityType || 'other';
}

function moveArchiveAction(form) {
  const content = form.closest('.ds-drawer__content');
  const actions = form.querySelector('.activity-drawer__header-actions');
  if (!content || !actions) return false;

  const button = [...content.querySelectorAll('[data-archive-reopen]')].find((candidate) => !form.contains(candidate));
  if (!button) return false;

  const wrapper = button.parentElement;
  button.classList.add('activity-drawer-type-fix__archive-action');
  const closeButton = actions.querySelector('[data-action="close-drawer"], [data-ui-close-drawer]');
  actions.insertBefore(button, closeButton || actions.firstChild || null);

  if (wrapper && wrapper !== content && wrapper.childElementCount === 0 && !clean(wrapper.textContent)) {
    wrapper.remove();
  }
  return true;
}

export function applyActivityDrawerTypeLayoutFix(form) {
  if (!form || !form.hasAttribute(ENHANCED_ATTR)) return false;

  const actionMoved = moveArchiveAction(form);
  if (form.hasAttribute(FIXED_ATTR)) return actionMoved;

  const row = parseExportRow(form);
  const activityType = normalizeType(row.activity_type || row.item_type || form.querySelector('[name="activity_type"]')?.value);

  moveSeasonToHeader(form, row);
  splitInstructorField(form, row, activityType);
  markFieldKeys(form);
  applyTypeGrid(form, activityType);

  form.setAttribute(FIXED_ATTR, 'true');
  return true;
}

export function applyActivityDrawerTypeLayoutFixes(root = document) {
  root.querySelectorAll?.(`[data-drawer-form][${ENHANCED_ATTR}]`).forEach((form) => {
    applyActivityDrawerTypeLayoutFix(form);
  });
}

function initialize() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyActivityDrawerTypeLayoutFixes(document);
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ENHANCED_ATTR]
  });
  schedule();
}

if (globalThis[TEST_FLAG] !== true) initialize();
