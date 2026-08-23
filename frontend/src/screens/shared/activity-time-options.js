const QUARTER_HOUR_TIMES = Object.freeze(Array.from({ length: 96 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  const minute = String((index % 4) * 15).padStart(2, '0');
  return `${hour}:${minute}`;
}));

const INLINE_TIME_SELECT_ATTR = 'data-activity-time-select';
const INLINE_TIME_EDITOR_ATTR = 'data-activity-time-editor-enhanced';
const INLINE_TIME_STYLE_ID = 'activity-inline-time-editor-styles';

export function normalizeActivityTime(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function activityTimeOptions({ minimum = '', selected = '' } = {}) {
  const floor = normalizeActivityTime(minimum);
  const current = normalizeActivityTime(selected);
  return [...new Set([...QUARTER_HOUR_TIMES, current].filter(Boolean))]
    .sort()
    .filter((time) => !floor || time >= floor);
}

function timeToMinutes(value) {
  const normalized = normalizeActivityTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return (hour * 60) + minute;
}

function durationText(startValue, endValue) {
  const start = timeToMinutes(startValue);
  const end = timeToMinutes(endValue);
  if (start == null || end == null || end <= start) return '';
  const total = end - start;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const parts = [];
  if (hours === 1) parts.push('שעה');
  else if (hours === 2) parts.push('שעתיים');
  else if (hours > 2) parts.push(`${hours} שעות`);
  if (minutes) parts.push(`${minutes} דקות`);
  return parts.length ? `משך: ${parts.join(' ו־')}` : '';
}

function ensureInlineTimeEditorStyles(doc) {
  if (!doc?.head || doc.getElementById(INLINE_TIME_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = INLINE_TIME_STYLE_ID;
  style.textContent = `
    .activity-drawer-inline__field.activity-drawer-inline__field--time-editor {
      grid-column: span 2;
    }
    .activity-inline-time-editor__host {
      display: block !important;
      min-inline-size: 0;
    }
    .activity-inline-time-editor {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      gap: 8px;
      align-items: end;
      min-inline-size: 0;
    }
    .activity-inline-time-editor__control {
      display: grid;
      gap: 4px;
      min-inline-size: 0;
    }
    .activity-inline-time-editor__label {
      color: #667085;
      font-size: 0.7rem;
      font-weight: 700;
      line-height: 1.2;
    }
    .activity-inline-time-editor__control .ds-input {
      inline-size: 100%;
      min-inline-size: 86px;
      min-block-size: 40px;
      padding-inline: 10px 30px;
      font-variant-numeric: tabular-nums;
    }
    .activity-inline-time-editor__arrow {
      align-self: end;
      min-block-size: 40px;
      display: grid;
      place-items: center;
      color: #7a8495;
      font-size: 1rem;
      font-weight: 800;
    }
    .activity-inline-time-editor__duration {
      margin-block-start: 6px;
      min-block-size: 1.1em;
      color: #667085;
      font-size: 0.72rem;
      font-weight: 650;
    }
    @media (max-width: 640px) {
      .activity-drawer-inline__field.activity-drawer-inline__field--time-editor {
        grid-column: 1 / -1;
      }
    }
  `;
  doc.head.append(style);
}

function createInlineTimeSelect(control) {
  if (!control) return null;
  if (String(control.tagName || '').toLowerCase() === 'select' && control.getAttribute(INLINE_TIME_SELECT_ATTR) === 'true') {
    return control;
  }
  const doc = control.ownerDocument;
  if (!doc) return control;
  const selected = normalizeActivityTime(control.value);
  const select = doc.createElement('select');
  Array.from(control.attributes || []).forEach((attribute) => {
    if (['type', 'step', 'min', 'max', 'autocomplete'].includes(attribute.name)) return;
    select.setAttribute(attribute.name, attribute.value);
  });
  select.setAttribute(INLINE_TIME_SELECT_ATTR, 'true');
  select.classList.add('ds-input');
  select.setAttribute('aria-label', String(control.getAttribute?.('name') || '') === 'start_time' ? 'שעת התחלה' : 'שעת סיום');

  const placeholder = doc.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '—';
  select.append(placeholder);

  [...new Set([...QUARTER_HOUR_TIMES, selected].filter(Boolean))].sort().forEach((time) => {
    const option = doc.createElement('option');
    option.value = time;
    option.textContent = time;
    if (time === selected) option.selected = true;
    select.append(option);
  });
  select.value = selected;
  control.replaceWith(select);
  return select;
}

function updateInlineDuration(startControl, endControl) {
  const field = startControl?.closest?.(`.activity-drawer-inline__field[${INLINE_TIME_EDITOR_ATTR}="true"]`);
  const duration = field?.querySelector?.('[data-activity-time-duration]');
  if (!duration) return;
  duration.textContent = durationText(startControl.value, endControl.value);
}

function syncInlineEndTimeSelect(startControl, endControl) {
  const start = normalizeActivityTime(startControl?.value);
  const previousEnd = normalizeActivityTime(endControl?.value);
  const startMinutes = timeToMinutes(start);
  let firstValid = '';

  Array.from(endControl?.options || []).forEach((option) => {
    const optionTime = normalizeActivityTime(option.value);
    if (!optionTime) {
      option.hidden = false;
      option.disabled = false;
      return;
    }
    const optionMinutes = timeToMinutes(optionTime);
    const invalid = startMinutes != null && optionMinutes != null && optionMinutes <= startMinutes;
    option.hidden = invalid;
    option.disabled = invalid;
    if (!invalid && !firstValid) firstValid = optionTime;
  });

  if (start && (!previousEnd || timeToMinutes(previousEnd) <= startMinutes)) {
    endControl.value = firstValid;
  }
  updateInlineDuration(startControl, endControl);
  return endControl.value;
}

function labelWrap(doc, labelText, control) {
  const label = doc.createElement('label');
  label.className = 'activity-inline-time-editor__control';
  const caption = doc.createElement('span');
  caption.className = 'activity-inline-time-editor__label';
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function inlineTimeFieldsInside(root) {
  if (!root) return [];
  const fields = [];
  const closestField = root.closest?.('.activity-drawer-inline__field');
  if (closestField) fields.push(closestField);
  if (root.matches?.('.activity-drawer-inline__field')) fields.push(root);
  if (root.querySelectorAll) fields.push(...root.querySelectorAll('.activity-drawer-inline__field'));
  return [...new Set(fields)].filter((field) => {
    if (field.getAttribute(INLINE_TIME_EDITOR_ATTR) === 'true') return false;
    const label = String(field.querySelector?.(':scope > .activity-drawer-inline__label')?.textContent || '').trim();
    return field.dataset?.fieldKey === 'hours' || label === 'שעות';
  });
}

export function enhanceInlineActivityTimeEditors(root = globalThis.document) {
  inlineTimeFieldsInside(root).forEach((field) => {
    const startExisting = field.querySelector('[name="start_time"]');
    const endExisting = field.querySelector('[name="end_time"]');
    if (!startExisting || !endExisting) return;

    const doc = field.ownerDocument;
    ensureInlineTimeEditorStyles(doc);
    const startSelect = createInlineTimeSelect(startExisting);
    const endSelect = createInlineTimeSelect(endExisting);
    const sharedParent = startSelect.parentElement === endSelect.parentElement
      ? startSelect.parentElement
      : (startSelect.closest('.activity-drawer-inline__controls') || field);

    startSelect.remove();
    endSelect.remove();
    sharedParent.textContent = '';
    sharedParent.classList.remove('activity-drawer__field-controls--inline');
    sharedParent.classList.add('activity-inline-time-editor__host');

    const editor = doc.createElement('div');
    editor.className = 'activity-inline-time-editor';
    const arrow = doc.createElement('span');
    arrow.className = 'activity-inline-time-editor__arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '←';
    editor.append(
      labelWrap(doc, 'התחלה', startSelect),
      arrow,
      labelWrap(doc, 'סיום', endSelect)
    );

    const duration = doc.createElement('div');
    duration.className = 'activity-inline-time-editor__duration';
    duration.setAttribute('data-activity-time-duration', 'true');
    sharedParent.append(editor, duration);

    field.classList.add('activity-drawer-inline__field--time-editor');
    field.setAttribute(INLINE_TIME_EDITOR_ATTR, 'true');
    syncInlineEndTimeSelect(startSelect, endSelect);

    startSelect.addEventListener('change', () => syncInlineEndTimeSelect(startSelect, endSelect));
    endSelect.addEventListener('change', () => updateInlineDuration(startSelect, endSelect));
  });
}

/**
 * Activity times outside the compact activity drawer use native minute-precision
 * inputs. Inside the drawer we intentionally keep compact 15-minute selects so
 * the start/end values remain fully visible and easy to understand.
 */
export function upgradeActivityTimeControl(control) {
  if (!control) return null;
  const name = String(control.getAttribute?.('name') || '').trim();
  if (name !== 'start_time' && name !== 'end_time') return control;
  if (control.getAttribute?.(INLINE_TIME_SELECT_ATTR) === 'true') return control;
  if (String(control.tagName || '').toLowerCase() === 'input' && control.type === 'time') {
    control.step = '60';
    return control;
  }
  if (String(control.tagName || '').toLowerCase() !== 'select') return control;

  const doc = control.ownerDocument;
  const input = doc.createElement('input');
  Array.from(control.attributes || []).forEach((attribute) => {
    input.setAttribute(attribute.name, attribute.value);
  });
  input.setAttribute('type', 'time');
  input.setAttribute('step', '60');
  input.setAttribute('autocomplete', 'off');
  input.value = normalizeActivityTime(control.value);
  control.replaceWith(input);
  return input;
}

export function syncActivityEndTimeOptions(startControl, endControl) {
  if (startControl?.getAttribute?.(INLINE_TIME_SELECT_ATTR) === 'true' || endControl?.getAttribute?.(INLINE_TIME_SELECT_ATTR) === 'true') {
    return syncInlineEndTimeSelect(startControl, endControl);
  }

  const startInput = upgradeActivityTimeControl(startControl);
  const endInput = upgradeActivityTimeControl(endControl);
  if (!startInput || !endInput) return '';

  const start = normalizeActivityTime(startInput.value);
  const previousEnd = normalizeActivityTime(endInput.value);
  const nextEnd = previousEnd && (!start || previousEnd >= start) ? previousEnd : start;

  if (start) endInput.min = start;
  else endInput.removeAttribute?.('min');
  if (nextEnd !== previousEnd) endInput.value = nextEnd;
  return endInput.value;
}

function timeControlsInside(root) {
  if (!root?.querySelectorAll) return [];
  const controls = [];
  if (root.matches?.('select[name="start_time"], select[name="end_time"], input[name="start_time"], input[name="end_time"]')) {
    controls.push(root);
  }
  controls.push(...root.querySelectorAll('select[name="start_time"], select[name="end_time"], input[name="start_time"], input[name="end_time"]'));
  return controls;
}

export function upgradeActivityTimeControls(root = globalThis.document) {
  if (!root) return;
  const upgraded = timeControlsInside(root).map(upgradeActivityTimeControl).filter(Boolean);
  const scopes = new Set(upgraded.map((control) => control.closest?.('form') || control.parentElement).filter(Boolean));

  scopes.forEach((scope) => {
    const startInput = scope.querySelector?.('[name="start_time"]');
    const endInput = scope.querySelector?.('[name="end_time"]');
    if (!startInput || !endInput) return;
    syncActivityEndTimeOptions(startInput, endInput);
    if (startInput.dataset?.activityTimeSyncBound === 'yes') return;
    startInput.dataset.activityTimeSyncBound = 'yes';
    const sync = () => syncActivityEndTimeOptions(startInput, endInput);
    startInput.addEventListener?.('input', sync);
    startInput.addEventListener?.('change', sync);
  });

  enhanceInlineActivityTimeEditors(root);
}

function installActivityTimeInputUpgrade() {
  if (typeof document === 'undefined') return;
  upgradeActivityTimeControls(document);
  if (typeof MutationObserver === 'undefined') return;
  if (globalThis.__activityTimeInputUpgradeObserver) return;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node?.nodeType === 1) upgradeActivityTimeControls(node);
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.__activityTimeInputUpgradeObserver = observer;
}

installActivityTimeInputUpgrade();
