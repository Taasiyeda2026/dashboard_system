const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const APPLIED_ATTR = 'data-approved-drawer-fixes';
const TIME_ENHANCED_ATTR = 'data-activity-time-editor-enhanced';
const STYLE_ID = 'activity-approved-drawer-fixes-style';

const HEADER_ORDER = [
  'activity_type',
  'activity_name',
  'status',
  'activity_domain',
  'authority',
  'school'
];

export function normalizeTypedTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  let hour;
  let minute;
  const colonMatch = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colonMatch) {
    hour = Number(colonMatch[1]);
    minute = Number(colonMatch[2]);
  } else if (/^\d{1,4}$/.test(raw)) {
    if (raw.length <= 2) {
      hour = Number(raw);
      minute = 0;
    } else if (raw.length === 3) {
      hour = Number(raw.slice(0, 1));
      minute = Number(raw.slice(1));
    } else {
      hour = Number(raw.slice(0, 2));
      minute = Number(raw.slice(2));
    }
  } else {
    return '';
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return '';
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function minutes(value) {
  const normalized = normalizeTypedTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return (hour * 60) + minute;
}

function ensureStyles(doc) {
  if (!doc?.head || doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-grid {
      grid-template-columns:
        minmax(78px, .70fr)
        minmax(150px, 1.45fr)
        minmax(86px, .72fr)
        minmax(58px, .45fr)
        minmax(105px, .90fr)
        minmax(130px, 1.05fr) !important;
      gap: 8px !important;
      align-items: end;
    }
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field--name {
      grid-column: auto !important;
    }
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field {
      min-inline-size: 0;
    }
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-label {
      margin-block-end: 4px !important;
      font-size: .70rem !important;
    }
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field .ds-input,
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field select,
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field input {
      min-block-size: 36px !important;
      block-size: 36px !important;
      padding-block: 5px !important;
      padding-inline: 9px 26px !important;
      font-size: .86rem !important;
    }
    .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__field.activity-drawer-inline__field--approved-time {
      grid-column: auto !important;
    }
    .activity-approved-time-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 5px;
      min-inline-size: 0;
    }
    .activity-approved-time-input {
      inline-size: 100% !important;
      min-inline-size: 0 !important;
      min-block-size: 36px !important;
      block-size: 36px !important;
      padding: 5px 7px !important;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    .activity-approved-time-separator {
      color: #7a8495;
      font-weight: 800;
    }
    .activity-approved-time-error {
      margin-block-start: 4px;
      color: #b42318;
      font-size: .68rem;
      font-weight: 650;
      line-height: 1.25;
    }
    @media (max-width: 900px) {
      .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      }
      .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field--name {
        grid-column: span 2 !important;
      }
    }
    @media (max-width: 640px) {
      .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .ds-drawer.ds-drawer--activity-inline .activity-drawer-inline__header-field--name {
        grid-column: 1 / -1 !important;
      }
    }
  `;
  doc.head.append(style);
}

function makeHeaderField(doc, control) {
  const field = doc.createElement('div');
  field.className = 'activity-drawer-inline__header-field activity-drawer-inline__header-field--domain';
  field.dataset.approvedHeaderField = 'activity_domain';

  const label = doc.createElement('div');
  label.className = 'activity-drawer-inline__header-label';
  label.textContent = 'תחום';
  field.append(label, control);
  return field;
}

function compactHeader(form) {
  const grid = form.querySelector('.activity-drawer-inline__header-grid');
  if (!grid) return false;

  const domainControl = form.querySelector('[name="activity_domain"]');
  if (domainControl && !grid.contains(domainControl)) {
    const oldField = domainControl.closest('.activity-drawer-inline__field, .activity-drawer__field');
    grid.append(makeHeaderField(form.ownerDocument, domainControl));
    oldField?.remove();
  }

  const fields = [...grid.querySelectorAll(':scope > .activity-drawer-inline__header-field')];
  fields.forEach((field) => {
    const control = field.querySelector('[name]');
    if (!control) return;
    field.dataset.approvedHeaderField = String(control.getAttribute('name') || '');
  });

  HEADER_ORDER.forEach((name) => {
    const field = fields.find((candidate) => candidate.dataset.approvedHeaderField === name)
      || grid.querySelector(`[data-approved-header-field="${name}"]`);
    if (field) grid.append(field);
  });
  return true;
}

function createTimeInput(doc, name, value, ariaLabel) {
  const input = doc.createElement('input');
  input.type = 'text';
  input.name = name;
  input.className = 'ds-input activity-approved-time-input';
  input.inputMode = 'numeric';
  input.autocomplete = 'off';
  input.maxLength = 5;
  input.placeholder = '08:30';
  input.setAttribute('aria-label', ariaLabel);
  const normalized = normalizeTypedTime(value);
  input.value = normalized || String(value || '').trim();
  input.defaultValue = input.value;
  return input;
}

function setTimeError(field, message = '') {
  const error = field?.querySelector?.('[data-approved-time-error]');
  if (!error) return;
  error.textContent = message;
  error.hidden = !message;
}

function validateTimePair(field, { normalize = true } = {}) {
  const start = field?.querySelector?.('[name="start_time"]');
  const end = field?.querySelector?.('[name="end_time"]');
  if (!start || !end) return true;

  start.setCustomValidity('');
  end.setCustomValidity('');
  setTimeError(field, '');

  const rawStart = String(start.value || '').trim();
  const rawEnd = String(end.value || '').trim();
  const normalizedStart = rawStart ? normalizeTypedTime(rawStart) : '';
  const normalizedEnd = rawEnd ? normalizeTypedTime(rawEnd) : '';

  if (rawStart && !normalizedStart) {
    const message = 'שעת התחלה לא תקינה';
    start.setCustomValidity(message);
    setTimeError(field, 'יש להזין שעה, למשל 830 או 08:30');
    return false;
  }
  if (rawEnd && !normalizedEnd) {
    const message = 'שעת סיום לא תקינה';
    end.setCustomValidity(message);
    setTimeError(field, 'יש להזין שעה, למשל 945 או 09:45');
    return false;
  }

  if (normalize) {
    if (normalizedStart) start.value = normalizedStart;
    if (normalizedEnd) end.value = normalizedEnd;
  }

  if (normalizedStart && normalizedEnd && minutes(normalizedEnd) <= minutes(normalizedStart)) {
    const message = 'שעת הסיום חייבת להיות מאוחרת משעת ההתחלה';
    end.setCustomValidity(message);
    setTimeError(field, message);
    return false;
  }
  return true;
}

function compactTimeField(form) {
  const startExisting = form.querySelector('[name="start_time"]');
  const endExisting = form.querySelector('[name="end_time"]');
  if (!startExisting || !endExisting) return false;

  const field = startExisting.closest('.activity-drawer-inline__field');
  if (!field || !field.contains(endExisting)) return false;
  if (field.dataset.approvedTimeEditor === 'true') return true;

  const editHost = field.querySelector('.activity-drawer-inline__edit');
  if (!editHost) return false;

  const doc = form.ownerDocument;
  const start = createTimeInput(doc, 'start_time', startExisting.value, 'שעת התחלה');
  const end = createTimeInput(doc, 'end_time', endExisting.value, 'שעת סיום');
  const row = doc.createElement('div');
  row.className = 'activity-approved-time-row';
  const separator = doc.createElement('span');
  separator.className = 'activity-approved-time-separator';
  separator.textContent = '–';
  separator.setAttribute('aria-hidden', 'true');
  row.append(start, separator, end);

  const error = doc.createElement('div');
  error.className = 'activity-approved-time-error';
  error.dataset.approvedTimeError = 'true';
  error.hidden = true;

  editHost.replaceChildren(row, error);
  field.classList.remove('activity-drawer-inline__field--time-editor');
  field.classList.add('activity-drawer-inline__field--approved-time');
  field.setAttribute(TIME_ENHANCED_ATTR, 'true');
  field.dataset.approvedTimeEditor = 'true';

  [start, end].forEach((input) => {
    input.addEventListener('input', () => {
      input.setCustomValidity('');
      setTimeError(field, '');
    });
    input.addEventListener('change', (event) => {
      // The legacy change handler auto-adjusted end times. The approved editor
      // validates instead and never changes a user's end time automatically.
      event.stopPropagation();
      validateTimePair(field, { normalize: true });
    });
    input.addEventListener('blur', () => validateTimePair(field, { normalize: true }));
  });

  form.addEventListener('click', (event) => {
    if (!event.target?.closest?.('[data-action="save-edit"]')) return;
    if (validateTimePair(field, { normalize: true })) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const invalid = [start, end].find((input) => !input.checkValidity());
    invalid?.focus?.();
  }, true);

  validateTimePair(field, { normalize: true });
  return true;
}

export function applyApprovedDrawerFixes(form) {
  if (!form?.hasAttribute?.(ENHANCED_ATTR)) return false;
  ensureStyles(form.ownerDocument);
  compactHeader(form);
  compactTimeField(form);
  form.setAttribute(APPLIED_ATTR, 'true');
  return true;
}

function applyAll(root = document) {
  const forms = [];
  if (root?.matches?.(`[data-drawer-form][${ENHANCED_ATTR}]`)) forms.push(root);
  root?.querySelectorAll?.(`[data-drawer-form][${ENHANCED_ATTR}]`).forEach((form) => forms.push(form));
  forms.forEach((form) => applyApprovedDrawerFixes(form));
}

function initialize() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyAll(document);
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ENHANCED_ATTR]
  });
  schedule();
}

initialize();
