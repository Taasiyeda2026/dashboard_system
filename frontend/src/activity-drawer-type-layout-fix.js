const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const FIXED_ATTR = 'data-activity-drawer-type-layout-fixed';
const TOP_SUMMARY_ATTR = 'data-activity-drawer-top-summary';
const NOTES_HYDRATION_ATTR = 'data-activity-meeting-notes-hydration';
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

function formatIsoDateHe(value) {
  const raw = String(value || '').trim().slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return '';
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function resolveBoundaryDates(row = {}) {
  const dateColumns = [];
  for (let index = 1; index <= 35; index += 1) {
    const value = String(row?.[`date_${index}`] || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) dateColumns.push(value);
  }
  const start = String(row?.start_date || '').trim().slice(0, 10) || dateColumns[0] || '';
  const end = String(row?.end_date || '').trim().slice(0, 10) || dateColumns[dateColumns.length - 1] || '';
  return { start, end };
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

function makeTopDateBoundary(doc, label, value, targetAttr) {
  const boundary = doc.createElement('div');
  boundary.className = 'activity-drawer-type-fix__top-date';

  const labelEl = doc.createElement('span');
  labelEl.className = 'activity-drawer-type-fix__top-date-label';
  labelEl.textContent = label;

  const valueEl = doc.createElement('strong');
  valueEl.className = 'activity-drawer-type-fix__top-date-value';
  valueEl.setAttribute(targetAttr, '');
  if (targetAttr === 'data-top-start-display') valueEl.setAttribute('data-computed-start-display', '');
  if (targetAttr === 'data-top-end-display') valueEl.setAttribute('data-computed-end-display', '');
  valueEl.textContent = value || '—';

  boundary.append(labelEl, valueEl);
  return boundary;
}

function syncCourseTopSummary(form, row = {}) {
  const top = form.querySelector(`[${TOP_SUMMARY_ATTR}]`);
  if (!top) return false;

  const source = form.querySelector('[data-dates-section] .activity-drawer__date-summary');
  const sourceStart = clean(source?.querySelector('[data-computed-start-display]')?.textContent);
  const sourceEnd = clean(source?.querySelector('[data-computed-end-display]')?.textContent);
  const boundaries = resolveBoundaryDates(row);

  const startValue = top.querySelector('[data-top-start-display]');
  const endValue = top.querySelector('[data-top-end-display]');
  if (startValue) startValue.textContent = sourceStart || formatIsoDateHe(boundaries.start) || '—';
  if (endValue) endValue.textContent = sourceEnd || formatIsoDateHe(boundaries.end) || '—';
  return true;
}

function ensureCourseTopSummary(form, row, activityType) {
  if (activityType !== 'course') return false;
  const body = form.querySelector('.activity-drawer-inline__body, .activity-drawer__body');
  const core = form.querySelector('.activity-drawer-inline__core');
  const sourceSummary = form.querySelector('[data-dates-section] .activity-drawer__date-summary');
  if (!body || !core || !sourceSummary) return false;

  let top = form.querySelector(`[${TOP_SUMMARY_ATTR}]`);
  if (!top) {
    top = form.ownerDocument.createElement('div');
    top.className = 'activity-drawer-type-fix__top-summary';
    top.setAttribute(TOP_SUMMARY_ATTR, 'true');
    top.setAttribute('data-view-only', '');

    const dates = form.ownerDocument.createElement('div');
    dates.className = 'activity-drawer-type-fix__top-dates';
    const boundaries = resolveBoundaryDates(row);
    dates.append(
      makeTopDateBoundary(form.ownerDocument, 'תאריך התחלה', formatIsoDateHe(boundaries.start), 'data-top-start-display'),
      makeTopDateBoundary(form.ownerDocument, 'תאריך סיום', formatIsoDateHe(boundaries.end), 'data-top-end-display')
    );
    top.append(dates);
    core.before(top);
  }

  sourceSummary.dataset.typeFixDateSummarySource = 'true';
  sourceSummary.hidden = true;

  const actions = form.querySelector('[data-activity-actions]');
  if (actions && actions.parentElement !== top) {
    top.append(actions);
  }

  syncCourseTopSummary(form, row);
  return true;
}

function meetingNoteMap(rows = []) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const index = Number(row?.meeting_no) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= 35) return;
    map.set(index, String(row?.notes || '').trim());
  });
  return map;
}

function groupedMeetingIndexes(form) {
  const inputs = [...form.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')]
    .sort((a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx));
  const groups = [];
  const byKey = new Map();
  inputs.forEach((input) => {
    const index = Number(input.dataset.meetingIdx);
    if (!Number.isInteger(index) || index < 0) return;
    const date = String(input.value || '').trim();
    const key = date || '__empty__';
    if (!byKey.has(key)) {
      const group = { key, date, indexes: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    byKey.get(key).indexes.push(index);
  });
  return groups;
}

function ensureMeetingNoteFields(form, row = {}) {
  const is2027 = clean(row?.activity_season) === 'school_2027';
  const grid = form?.querySelector?.('[data-meeting-dates-edit]');
  if (!grid || (!is2027 && !grid.querySelector('textarea[data-meeting-note-idx]'))) return false;

  const cards = [...grid.querySelectorAll(':scope > .activity-drawer__date-card')];
  cards.forEach((card, index) => {
    let note = card.querySelector('textarea[data-meeting-note-idx], textarea[name^="meeting_note_"]');
    if (!note && is2027) {
      note = card.ownerDocument.createElement('textarea');
      note.className = 'ds-input';
      note.rows = 1;
      note.placeholder = 'הערה למפגש זה';
      note.style.marginTop = '4px';
      note.style.fontSize = '0.85em';
      note.style.resize = 'vertical';
      card.append(note);
    }
    if (!note) return;
    note.name = `meeting_note_${index}`;
    note.dataset.meetingNoteIdx = String(index);
  });
  return cards.length > 0;
}

function setNoteIcon(chip, notes = []) {
  if (!chip) return;
  chip.querySelectorAll('.activity-drawer__date-note-icon').forEach((icon) => icon.remove());
  const distinct = [...new Set(notes.map((note) => String(note || '').trim()).filter(Boolean))];
  if (!distinct.length) return;

  const noteText = distinct.join('\n');
  const icon = chip.ownerDocument.createElement('span');
  icon.className = 'activity-drawer__date-note-icon';
  icon.setAttribute('role', 'img');
  icon.setAttribute('tabindex', '0');
  icon.setAttribute('title', noteText);
  icon.setAttribute('aria-label', `הערה למפגש: ${distinct.join(' | ')}`);
  icon.textContent = '💬';
  chip.append(icon);
}

export function applyActivityMeetingNotesToForm(form, rows = []) {
  if (!form) return false;
  const notes = meetingNoteMap(rows);
  const noteFields = [...form.querySelectorAll('textarea[data-meeting-note-idx]')];
  if (!noteFields.length) return false;

  noteFields.forEach((field) => {
    const index = Number(field.dataset.meetingNoteIdx);
    field.value = Number.isInteger(index) ? (notes.get(index) || '') : '';
  });

  const groups = groupedMeetingIndexes(form);
  const chipsHost = form.querySelector('[data-dates-view-chips]');
  const chips = chipsHost
    ? [...chipsHost.querySelectorAll('.activity-drawer__date-chip')].filter((chip) => !chip.hasAttribute('aria-busy'))
    : [];
  if (groups.length && chips.length === groups.length) {
    groups.forEach((group, groupIndex) => {
      setNoteIcon(chips[groupIndex], group.indexes.map((index) => notes.get(index) || ''));
    });
  }

  if (typeof form._refreshInitialValues === 'function') form._refreshInitialValues();
  return true;
}

async function hydrateActivityMeetingNotes(form, row = {}) {
  if (!form || globalThis[TEST_FLAG] === true) return false;
  if (!form.querySelector('textarea[data-meeting-note-idx]')) return false;
  const state = String(form.getAttribute(NOTES_HYDRATION_ATTR) || '');
  if (state === 'loading' || state === 'yes' || state === 'error') return false;

  const rowId = String(row?.row_id || row?.RowID || row?.source_row_id || '').trim();
  if (!rowId) return false;

  form.setAttribute(NOTES_HYDRATION_ATTR, 'loading');
  try {
    const { supabase } = await import('./supabase-client.js');
    if (!supabase) throw new Error('supabase_unavailable');
    const { data, error } = await supabase
      .from('activity_meetings')
      .select('meeting_no,notes')
      .eq('source_row_id', rowId);
    if (error) throw error;
    if (!form.isConnected) return false;
    applyActivityMeetingNotesToForm(form, data || []);
    form.setAttribute(NOTES_HYDRATION_ATTR, 'yes');
    return true;
  } catch (error) {
    if (form.isConnected) form.setAttribute(NOTES_HYDRATION_ATTR, 'error');
    console.warn('[activity-drawer] meeting-note hydration failed', error);
    return false;
  }
}

export function applyActivityDrawerTypeLayoutFix(form) {
  if (!form || !form.hasAttribute(ENHANCED_ATTR)) return false;

  const actionMoved = moveArchiveAction(form);
  const row = parseExportRow(form);
  const activityType = normalizeType(row.activity_type || row.item_type || form.querySelector('[name="activity_type"]')?.value);

  if (form.hasAttribute(FIXED_ATTR)) {
    syncCourseTopSummary(form, row);
    ensureMeetingNoteFields(form, row);
    void hydrateActivityMeetingNotes(form, row);
    return actionMoved;
  }

  moveSeasonToHeader(form, row);
  splitInstructorField(form, row, activityType);
  markFieldKeys(form);
  applyTypeGrid(form, activityType);
  ensureCourseTopSummary(form, row, activityType);
  ensureMeetingNoteFields(form, row);

  form.setAttribute(FIXED_ATTR, 'true');
  void hydrateActivityMeetingNotes(form, row);
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
