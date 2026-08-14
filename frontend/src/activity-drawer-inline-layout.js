const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const DRAWER_CLASS = 'ds-drawer--activity-inline';
const TEST_FLAG = '__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__';

const TYPE_LABELS = {
  course: 'קורס',
  after_school: 'אפטרסקול',
  workshop: 'סדנה',
  tour: 'סיור',
  escape_room: 'חדר בריחה'
};

const ACTIVITY_NAME_LABELS = {
  course: 'שם קורס',
  after_school: 'שם חוג אפטרסקול',
  workshop: 'שם סדנה',
  tour: 'שם סיור',
  escape_room: 'שם פעילות'
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

function formatMoney(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return clean(value) || '—';
  return `₪${new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 }).format(number)}`;
}

function displayValue(value, fallback = '—') {
  return clean(value) || fallback;
}

function collectExistingViewValues(form) {
  const values = new Map();
  form.querySelectorAll('.activity-view-field').forEach((field) => {
    const label = clean(field.querySelector('.activity-view-field__label')?.textContent);
    if (!label) return;
    const valueNodes = [...field.querySelectorAll('.activity-view-field__value')];
    const value = clean(valueNodes.map((node) => node.textContent).filter(Boolean).join(' / '));
    values.set(label, value);
  });
  return values;
}

function findNamedControl(form, names) {
  for (const name of names) {
    const control = form.querySelector(`[name="${name}"]`);
    if (control) return control;
  }
  return null;
}

function extractFieldControls(form, names) {
  const control = findNamedControl(form, names);
  const field = control?.closest('.activity-drawer__field');
  if (!field) return null;

  const controls = form.ownerDocument.createElement('div');
  controls.className = 'activity-drawer-inline__controls';
  [...field.childNodes].forEach((node) => {
    if (node.nodeType === 1 && node.classList?.contains('activity-drawer__label')) return;
    controls.append(node);
  });
  field.remove();
  return controls;
}

function makeField(doc, { label, viewValue = '—', editControls = null, className = '' }) {
  const field = doc.createElement('div');
  field.className = ['activity-drawer-inline__field', className].filter(Boolean).join(' ');

  const labelEl = doc.createElement('div');
  labelEl.className = 'activity-drawer-inline__label';
  labelEl.textContent = label;
  field.append(labelEl);

  const view = doc.createElement('div');
  view.className = 'activity-drawer-inline__value';
  view.setAttribute('data-mode', 'view');
  view.textContent = displayValue(viewValue);
  field.append(view);

  if (editControls) {
    const edit = doc.createElement('div');
    edit.className = 'activity-drawer-inline__edit';
    edit.setAttribute('data-mode', 'edit');
    edit.hidden = true;
    edit.append(editControls);
    field.append(edit);
  }

  return field;
}

function makeEditOnlyField(doc, { label, editControls, className = '' }) {
  if (!editControls) return null;
  const field = doc.createElement('div');
  field.className = ['activity-drawer-inline__header-field', className].filter(Boolean).join(' ');

  const labelEl = doc.createElement('div');
  labelEl.className = 'activity-drawer-inline__header-label';
  labelEl.textContent = label;
  field.append(labelEl, editControls);
  return field;
}

function wrapFormAroundDrawer(form) {
  const body = form.parentElement?.classList?.contains('activity-drawer__body') ? form.parentElement : null;
  const header = body?.previousElementSibling?.classList?.contains('activity-drawer__header')
    ? body.previousElementSibling
    : null;
  const content = body?.parentElement;
  if (!body || !header || !content) return { body, header, content };

  [...form.childNodes].forEach((node) => body.insertBefore(node, form));
  form.remove();
  content.insertBefore(form, header);
  form.append(header, body);
  return { body, header, content };
}

function headerEditor(form, header, row) {
  if (!header) return;
  const doc = form.ownerDocument;
  const headerTop = header.querySelector('.activity-drawer__header-top') || header;
  const heading = header.querySelector('.activity-drawer__heading');
  if (heading) heading.setAttribute('data-mode', 'view');

  const typeControls = extractFieldControls(form, ['activity_type']);
  const nameControls = extractFieldControls(form, ['activity_name']);
  const statusControls = extractFieldControls(form, ['status']);
  const authorityControls = extractFieldControls(form, ['authority']);
  const schoolControls = extractFieldControls(form, ['school']);

  const editor = doc.createElement('div');
  editor.className = 'activity-drawer-inline__header-edit';
  editor.setAttribute('data-mode', 'edit');
  editor.hidden = true;

  const grid = doc.createElement('div');
  grid.className = 'activity-drawer-inline__header-grid';

  const type = normalizeType(row.activity_type || row.item_type || form.querySelector('[name="activity_type"]')?.value);
  const nameField = makeEditOnlyField(doc, {
    label: ACTIVITY_NAME_LABELS[type] || 'שם פעילות',
    editControls: nameControls,
    className: 'activity-drawer-inline__header-field--name'
  });
  if (nameField) nameField.dataset.activityNameLabel = 'true';

  [
    makeEditOnlyField(doc, { label: 'סוג פעילות', editControls: typeControls }),
    nameField,
    makeEditOnlyField(doc, { label: 'סטטוס', editControls: statusControls }),
    makeEditOnlyField(doc, { label: 'רשות', editControls: authorityControls }),
    makeEditOnlyField(doc, { label: 'בית ספר', editControls: schoolControls })
  ].filter(Boolean).forEach((field) => grid.append(field));

  editor.append(grid);
  const actions = headerTop.querySelector('.activity-drawer__header-actions');
  headerTop.insertBefore(editor, actions || null);

  const typeSelect = editor.querySelector('[name="activity_type"]');
  typeSelect?.addEventListener('change', () => {
    const label = editor.querySelector('[data-activity-name-label] .activity-drawer-inline__header-label');
    if (label) label.textContent = ACTIVITY_NAME_LABELS[normalizeType(typeSelect.value)] || 'שם פעילות';
  });
}

function addRemainingEditFields(form, coreGrid, row) {
  form.querySelectorAll('.activity-drawer__section--edit-group').forEach((section) => {
    [...section.querySelectorAll('.activity-drawer__field')].forEach((field) => {
      const label = clean(field.querySelector('.activity-drawer__label')?.textContent) || 'פרט נוסף';
      const control = field.querySelector('[name]:not([type="hidden"])');
      if (!control) {
        field.remove();
        return;
      }
      const name = clean(control.getAttribute('name'));
      const controls = form.ownerDocument.createElement('div');
      controls.className = 'activity-drawer-inline__controls';
      [...field.childNodes].forEach((node) => {
        if (node.nodeType === 1 && node.classList?.contains('activity-drawer__label')) return;
        controls.append(node);
      });
      const selectedText = control.tagName === 'SELECT'
        ? clean(control.selectedOptions?.[0]?.textContent)
        : '';
      const rawView = selectedText || row[name] || control.value;
      coreGrid.append(makeField(form.ownerDocument, {
        label,
        viewValue: name === 'price' ? formatMoney(rawView) : displayValue(rawView),
        editControls: controls
      }));
      field.remove();
    });
    section.remove();
  });
}

function coreDetails(form, body, row, existingValues) {
  const doc = form.ownerDocument;
  const activityType = normalizeType(row.activity_type || row.item_type);
  const twoInstructors = activityType === 'workshop' || activityType === 'escape_room';

  const managerControls = extractFieldControls(form, ['activity_manager']);
  const instructorControls = extractFieldControls(form, ['emp_id']);
  const classControls = extractFieldControls(form, ['grade', 'class_group']);
  const timeControls = extractFieldControls(form, ['start_time', 'end_time']);
  // The central association picker is the only funding UI. Keep the legacy
  // activities.funding value intact, but never render its edit control.
  const fundingControls = extractFieldControls(form, ['funding_sources']);
  extractFieldControls(form, ['funding']);
  const priceControls = extractFieldControls(form, ['price']);
  // Operations screens inject their own participants section; never show two of them.
  const hasOwnParticipantsSection = Boolean(form.querySelector('[data-participants-count-section]'));
  const participantsControls = hasOwnParticipantsSection ? null : extractFieldControls(form, ['participants_count']);
  // activity_season remains available through the row/form dataset for internal
  // behavior, but is intentionally not user-editable in the drawer.
  extractFieldControls(form, ['activity_season']);

  const core = doc.createElement('section');
  core.className = 'activity-drawer-inline__core';
  core.setAttribute('data-activity-inline-core', 'true');
  const grid = doc.createElement('div');
  grid.className = 'activity-drawer-inline__grid';

  const managerView = existingValues.get('מנהל פעילות') || row.activity_manager || 'ללא';
  const instructorView = twoInstructors
    ? [existingValues.get('מדריך/ה 1') || row.instructor_name, existingValues.get('מדריך/ה 2') || row.instructor_name_2].filter(clean).join(' / ')
    : (existingValues.get('מדריך/ה') || row.instructor_name || '—');
  const classView = existingValues.get('כיתה / קבוצה') || [row.grade, row.class_group].filter(clean).join(' / ');
  const timeView = existingValues.get('שעות') || (
    clean(row.start_time) && clean(row.end_time) ? `${clean(row.start_time).slice(0, 5)}–${clean(row.end_time).slice(0, 5)}` : ''
  );

  [
    makeField(doc, { label: 'מנהל פעילות', viewValue: managerView, editControls: managerControls }),
    makeField(doc, { label: twoInstructors ? 'מדריכים' : 'מדריך/ה', viewValue: instructorView, editControls: instructorControls }),
    makeField(doc, { label: 'כיתה / קבוצה', viewValue: classView, editControls: classControls }),
    makeField(doc, { label: 'שעות', viewValue: timeView, editControls: timeControls }),
    makeField(doc, {
      label: 'גורם מימון',
      viewValue: (row.funding_sources || []).map((source) => source?.name).filter(clean).join(' + ') || row.funding,
      editControls: fundingControls
    }),
    makeField(doc, { label: 'מחיר', viewValue: formatMoney(row.price), editControls: priceControls }),
    hasOwnParticipantsSection ? null : makeField(doc, {
      label: 'מספר משתתפים',
      viewValue: existingValues.get('מספר משתתפים') || row.participants_count,
      editControls: participantsControls,
      className: 'activity-drawer-inline__field--participants'
    })
  ].filter(Boolean).forEach((field) => grid.append(field));

  addRemainingEditFields(form, grid, row);

  const typeSelect = form.querySelector('[name="activity_type"]');
  const syncParticipantsVisibility = () => {
    const supportsParticipants = ['workshop', 'escape_room'].includes(normalizeType(typeSelect?.value || activityType));
    grid.querySelector('.activity-drawer-inline__field--participants')?.toggleAttribute('hidden', !supportsParticipants);
    form.querySelector('[data-participants-count-section]')?.toggleAttribute('hidden', !supportsParticipants);
  };
  typeSelect?.addEventListener('change', syncParticipantsVisibility);
  syncParticipantsVisibility();
  core.append(grid);

  const central = form.querySelector('[data-central-info-section]');
  central?.remove();
  // The base drawer lists period/funding/price/participants for screens without this
  // layout; the inline grid supersedes it, so drop it instead of showing both.
  form.querySelectorAll('[data-record-details-section]').forEach((section) => section.remove());

  const firstVisible = [...body.children].find((element) => {
    if (element.matches('input[type="hidden"]')) return false;
    if (element.classList.contains('ds-chip')) return false;
    return true;
  });
  body.insertBefore(core, firstVisible || null);
}

function simplifyContact(form) {
  const section = form.querySelector('[data-contact-2027-section]');
  if (!section) return null;
  section.classList.add('activity-drawer-inline__embedded');
  section.querySelector(':scope > .activity-drawer__section-title')?.remove();
  section.querySelector('.activity-view-field__label')?.remove();
  section.querySelector('[data-mode="edit"] label')?.remove();

  const wrapper = form.ownerDocument.createElement('div');
  wrapper.className = 'activity-drawer-inline__field activity-drawer-inline__field--support';
  const label = form.ownerDocument.createElement('div');
  label.className = 'activity-drawer-inline__label';
  label.textContent = 'איש קשר';
  wrapper.append(label, section);
  return wrapper;
}

function simplifyNotes(form) {
  const doc = form.ownerDocument;
  const stack = doc.createElement('div');
  stack.className = 'activity-drawer-inline__notes-stack';

  const notes = form.querySelector('[data-notes-section]');
  if (notes) {
    notes.classList.add('activity-drawer-inline__embedded');
    notes.querySelectorAll('.activity-view-notes__label').forEach((label) => label.remove());
    let view = notes.querySelector('[data-mode="view"]');
    if (!view) {
      view = doc.createElement('div');
      view.className = 'activity-view-notes__text';
      view.setAttribute('data-mode', 'view');
      notes.prepend(view);
    }
    if (!clean(view.textContent)) view.textContent = '—';

    const wrapper = doc.createElement('div');
    wrapper.className = 'activity-drawer-inline__field activity-drawer-inline__field--note';
    const label = doc.createElement('div');
    label.className = 'activity-drawer-inline__label';
    label.textContent = 'הערות';
    wrapper.append(label, notes);
    stack.append(wrapper);
  }

  const privateView = form.querySelector('[data-private-note-section]');
  const privateTextarea = form.querySelector('[name="operations_private_notes"]');
  const privateEdit = privateTextarea?.closest('.activity-drawer__edit');
  if (privateView || privateEdit) {
    privateView?.classList?.add('activity-drawer-inline__embedded');
    privateView?.querySelectorAll?.('.activity-view-notes__label').forEach((label) => label.remove());
    privateEdit?.querySelectorAll?.('.activity-drawer__label').forEach((label) => label.remove());

    if (privateView && !clean(privateView.textContent)) {
      privateView.innerHTML = '<div class="activity-view-notes__text" data-mode="view">—</div>';
    }

    const wrapper = doc.createElement('div');
    wrapper.className = 'activity-drawer-inline__field activity-drawer-inline__field--note';
    const label = doc.createElement('div');
    label.className = 'activity-drawer-inline__label';
    label.textContent = 'הערה תפעולית';
    wrapper.append(label);
    if (privateView) wrapper.append(privateView);
    if (privateEdit) wrapper.append(privateEdit);
    stack.append(wrapper);
  }

  return stack.childElementCount ? stack : null;
}

function supportDetails(form, body) {
  const contact = simplifyContact(form);
  const notes = simplifyNotes(form);
  if (!contact && !notes) return;

  const support = form.ownerDocument.createElement('section');
  support.className = 'activity-drawer-inline__support';
  if (contact) support.append(contact);
  if (notes) support.append(notes);

  const actions = body.querySelector('.activity-drawer__section--actions, .activity-drawer__view-footer');
  body.insertBefore(support, actions || null);
}

function compactDates(form) {
  const dates = form.querySelector('[data-dates-section]');
  if (!dates) return;
  dates.classList.add('activity-drawer-inline__dates');
  dates.querySelectorAll('.activity-drawer__progress-row[data-mode="view"]').forEach((row) => {
    row.removeAttribute('data-mode');
    row.hidden = false;
  });
}

function syncDrawerClasses(root = document) {
  root.querySelectorAll?.('.ds-drawer').forEach((drawer) => {
    drawer.classList.toggle(DRAWER_CLASS, Boolean(drawer.querySelector(`[${ENHANCED_ATTR}]`)));
  });
}

export function enhanceActivityDrawerForm(form) {
  if (!form || form.hasAttribute(ENHANCED_ATTR)) return false;
  if (form.closest('.activity-drawer__summary-item')) return false;

  form.setAttribute(ENHANCED_ATTR, 'true');
  form.classList.add('activity-drawer-inline-layout');

  const row = parseExportRow(form);
  const existingValues = collectExistingViewValues(form);
  const { body, header } = wrapFormAroundDrawer(form);
  if (!body || !header) {
    form.removeAttribute(ENHANCED_ATTR);
    form.classList.remove('activity-drawer-inline-layout');
    return false;
  }

  body.classList.add('activity-drawer-inline__body');
  header.classList.add('activity-drawer-inline__header');
  headerEditor(form, header, row);
  coreDetails(form, body, row, existingValues);
  compactDates(form);
  supportDetails(form, body);

  const editActions = body.querySelector('.activity-drawer__section--actions');
  const viewFooter = body.querySelector('.activity-drawer__view-footer');
  if (editActions) body.append(editActions);
  if (viewFooter) body.append(viewFooter);

  syncDrawerClasses(form.ownerDocument || document);
  return true;
}

export function enhanceActivityDrawers(root = document) {
  root.querySelectorAll?.('[data-drawer-form]').forEach((form) => enhanceActivityDrawerForm(form));
  syncDrawerClasses(root);
}

function initialize() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceActivityDrawers(document);
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
}

if (globalThis[TEST_FLAG] !== true) initialize();
