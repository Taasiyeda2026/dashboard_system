const QUARTER_HOUR_TIMES = Object.freeze(Array.from({ length: 96 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  const minute = String((index % 4) * 15).padStart(2, '0');
  return `${hour}:${minute}`;
}));

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

/**
 * Activity times used to be rendered as fixed select lists (30-minute slots in
 * the create modal and 15-minute slots in the edit drawer). Upgrade those
 * controls to native minute-precision time inputs so any HH:MM value can be
 * entered while keeping the existing field names and save flow unchanged.
 */
export function upgradeActivityTimeControl(control) {
  if (!control) return null;
  const name = String(control.getAttribute?.('name') || '').trim();
  if (name !== 'start_time' && name !== 'end_time') return control;
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
