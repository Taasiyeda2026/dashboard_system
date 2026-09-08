import { supabase } from './api/client.js';
import { reconcileTravelCompensation, overrideTravelCompensation } from './services/attendance.service.js';

const ENHANCED_HEADER = 'av2TimeCancelHeader';
const ENHANCED_ROW = 'av2TimeCancelRow';
const BOUND_OPERATION = 'av2OperationLocationBound';
const applyingOverrides = new Set();

let operationLocationsPromise = null;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function formatMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function parseClockMinutes(value) {
  const match = text(value).match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

async function loadOperationLocations() {
  if (operationLocationsPromise) return operationLocationsPromise;
  operationLocationsPromise = (async () => {
    const { data, error } = await supabase
      .from('attendance_operation_options')
      .select('id,label,address,is_other')
      .eq('active', true)
      .order('is_other')
      .order('sort_order');
    if (error) return { byId: new Map(), byLabel: new Map() };
    const rows = Array.isArray(data) ? data : [];
    return {
      byId: new Map(rows.map((row) => [text(row.id), row])),
      byLabel: new Map(rows.map((row) => [text(row.label), row])),
    };
  })();
  return operationLocationsPromise;
}

function operationAddressField(form) {
  let wrap = form.querySelector('[data-av2-operation-address]');
  if (wrap) return wrap;

  wrap = document.createElement('div');
  wrap.className = 'av2-field av2-operation-address';
  wrap.dataset.av2OperationAddress = '1';
  wrap.hidden = true;

  const label = document.createElement('label');
  label.className = 'av2-field__label';
  label.textContent = 'כתובת';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'av2-field__input';
  input.readOnly = true;
  input.setAttribute('aria-label', 'כתובת הפעילות');

  wrap.append(label, input);
  const choice = form.querySelector('#av2-operation-choice');
  choice?.closest('.av2-field')?.insertAdjacentElement('afterend', wrap);
  return wrap;
}

async function syncOperationAddress(form) {
  const typeSelect = form.querySelector('#av2-activity-type');
  const choiceSelect = form.querySelector('#av2-operation-choice');
  if (!typeSelect || !choiceSelect) return;

  const wrap = operationAddressField(form);
  const input = wrap.querySelector('input');
  if (text(typeSelect.value) !== 'תפעול') {
    wrap.hidden = true;
    if (input) input.value = '';
    return;
  }

  const locations = await loadOperationLocations();
  const selectedOption = choiceSelect.selectedOptions?.[0];
  const option = locations.byId.get(text(choiceSelect.value))
    || locations.byLabel.get(text(selectedOption?.textContent));
  const address = text(option?.address);

  wrap.hidden = !address;
  if (input) input.value = address;
}

function enhanceOperationForm(form) {
  if (!(form instanceof HTMLFormElement)) return;
  const typeSelect = form.querySelector('#av2-activity-type');
  const choiceSelect = form.querySelector('#av2-operation-choice');
  if (!typeSelect || !choiceSelect) return;

  if (form.dataset[BOUND_OPERATION] !== '1') {
    form.dataset[BOUND_OPERATION] = '1';
    typeSelect.addEventListener('change', () => void syncOperationAddress(form));
    choiceSelect.addEventListener('change', () => void syncOperationAddress(form));
  }
  void syncOperationAddress(form);
}

function cancellationState(row) {
  const detail = row.querySelector('.av2-rr__travel-compensation');
  if (!detail) return { label: '—', minutes: null, resolved: false, original: null, pending: false };

  const pending = detail.classList.contains('av2-rr__travel-compensation--pending');
  if (pending) return { label: 'ממתין', minutes: null, resolved: false, original: null, pending: true };

  const strongText = text(detail.querySelector('strong')?.textContent || detail.textContent);
  const valueMatch = strongText.match(/(\d{1,3}:[0-5]\d)/);
  const label = valueMatch?.[1] || '—';
  const minutes = parseClockMinutes(label);
  const audit = text(detail.querySelector('.av2-rr__travel-audit')?.textContent);
  const originalMatch = audit.match(/מחושב במקור:\s*(\d{1,3}:[0-5]\d)/);

  return {
    label,
    minutes,
    resolved: minutes != null,
    original: originalMatch?.[1] || null,
    pending: false,
  };
}

function enhanceReportHeader(head) {
  if (!(head instanceof HTMLElement) || head.dataset[ENHANCED_HEADER] === '1') return;
  const cells = [...head.children];
  const hours = cells.find((cell) => ['שעות', 'סה״כ שעות'].includes(text(cell.textContent)));
  if (!hours) return;

  const cancel = document.createElement('span');
  cancel.className = 'av2-rr__time-cancel-head';
  cancel.textContent = 'ביטול זמן';
  hours.insertAdjacentElement('afterend', cancel);
  head.dataset[ENHANCED_HEADER] = '1';
}

function updateTimeCancelCell(row) {
  const hours = row.querySelector('.av2-rr__hours');
  if (!hours) return null;
  let cell = row.querySelector('.av2-rr__time-cancel');
  if (!cell) {
    cell = document.createElement('div');
    cell.className = 'av2-rr__time-cancel';
    cell.dataset.mobileLabel = 'ביטול זמן';
    hours.insertAdjacentElement('afterend', cell);
  }

  const state = cancellationState(row);
  cell.textContent = state.label;
  cell.classList.toggle('is-pending', state.pending);
  cell.title = state.pending
    ? 'חישוב ביטול הזמן עדיין מתבצע'
    : state.resolved
      ? (state.original ? `נערך ידנית · מחושב במקור: ${state.original}` : 'מחושב אוטומטית לפי זמן הנסיעה')
      : '';
  cell.dataset.minutes = state.minutes == null ? '' : String(state.minutes);
  if (state.original) cell.dataset.original = state.original;
  else delete cell.dataset.original;

  const oldDetail = row.querySelector('.av2-rr__travel-compensation');
  if (oldDetail) {
    oldDetail.hidden = true;
    oldDetail.style.display = 'none';
    oldDetail.setAttribute('aria-hidden', 'true');
  }
  return cell;
}

function showTimeCancelEditField(row) {
  const state = cancellationState(row);
  if (!state.resolved) return;

  window.setTimeout(() => {
    const modal = document.querySelector('.av2-modal-overlay .av2-modal--form');
    const form = modal?.querySelector('form');
    if (!form || form.querySelector('[data-av2-time-cancel-edit]')) return;

    const hoursDisplay = form.querySelector('.av2-report__hours-display');
    if (!hoursDisplay) return;

    const wrap = document.createElement('div');
    wrap.className = 'av2-field av2-time-cancel-edit';
    wrap.dataset.av2TimeCancelEdit = '1';

    const label = document.createElement('label');
    label.className = 'av2-field__label';
    label.textContent = 'ביטול זמן';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'av2-field__input';
    input.inputMode = 'numeric';
    input.value = state.label;
    input.placeholder = '0:00';
    input.setAttribute('aria-label', 'ביטול זמן בשעות ודקות');

    const note = document.createElement('small');
    note.className = 'av2-time-cancel-edit__note';
    note.textContent = state.original
      ? `נערך ידנית · מחושב במקור: ${state.original}`
      : 'מחושב אוטומטית לפי זמן הנסיעה';

    const error = document.createElement('small');
    error.className = 'av2-time-cancel-edit__error';
    error.hidden = true;

    wrap.append(label, input, note, error);
    hoursDisplay.insertAdjacentElement('afterend', wrap);

    const recordId = text(row.dataset.recordId);
    const oldRow = row;

    form.addEventListener('submit', (event) => {
      const desired = parseClockMinutes(input.value);
      if (desired == null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        error.textContent = 'יש להזין ביטול זמן בפורמט שעות:דקות, לדוגמה 1:45.';
        error.hidden = false;
        input.focus();
        return;
      }
      error.hidden = true;
      if (!recordId || desired === state.minutes) return;
      waitForSavedRowAndOverride(oldRow, recordId, desired);
    }, { capture: true });
  }, 0);
}

function waitForSavedRowAndOverride(oldRow, recordId, desiredMinutes) {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (Date.now() - startedAt > 15000) {
      window.clearInterval(timer);
      return;
    }
    const currentRow = document.querySelector(`.av2-report-row[data-record-id="${CSS.escape(recordId)}"]`);
    if (oldRow.isConnected || !currentRow || currentRow === oldRow) return;
    window.clearInterval(timer);
    void applyOverride(currentRow, recordId, desiredMinutes);
  }, 180);
}

async function applyOverride(row, recordId, desiredMinutes) {
  if (applyingOverrides.has(recordId)) return;
  applyingOverrides.add(recordId);
  try {
    await reconcileTravelCompensation(recordId);
    await overrideTravelCompensation(recordId, desiredMinutes);
    const cell = row.querySelector('.av2-rr__time-cancel') || updateTimeCancelCell(row);
    if (cell) {
      cell.textContent = formatMinutes(desiredMinutes);
      cell.dataset.minutes = String(desiredMinutes);
      cell.title = 'נערך ידנית';
    }
  } catch (error) {
    console.warn('time cancellation override failed:', error?.message || error);
  } finally {
    applyingOverrides.delete(recordId);
  }
}

function enhanceReportRow(row) {
  if (!(row instanceof HTMLElement)) return;
  updateTimeCancelCell(row);

  if (row.dataset[ENHANCED_ROW] === '1') return;
  row.dataset[ENHANCED_ROW] = '1';
  const editButton = [...row.querySelectorAll('.av2-rr__actions button')]
    .find((button) => text(button.getAttribute('aria-label')) === 'עריכה');
  editButton?.addEventListener('click', () => showTimeCancelEditField(row));
}

function enhanceAll(root = document) {
  root.querySelectorAll?.('.av2-report-list__head').forEach(enhanceReportHeader);
  root.querySelectorAll?.('.av2-report-row').forEach(enhanceReportRow);
  root.querySelectorAll?.('.av2-report__form').forEach(enhanceOperationForm);
}

function boot() {
  enhanceAll();
  const observer = new MutationObserver((mutations) => {
    let needsPass = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length) {
        needsPass = true;
        break;
      }
    }
    if (needsPass) enhanceAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
