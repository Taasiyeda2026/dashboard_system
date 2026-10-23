import { supabase } from './api/client.js';
import { reconcileTravelCompensation, reportTravelTime } from './services/attendance.service.js';
import { reconcileChangedTravelContext, instructorTravelReportStatusLabel } from './services/time-cancellation.helpers.js';
import { formatCancellationDuration } from './services/cancellation-segments.js';

const ENHANCED_HEADER = 'av2TimeCancelHeader';
const ENHANCED_ROW = 'av2TimeCancelRow';
const BOUND_OPERATION = 'av2OperationLocationBound';
const applyingOverrides = new Set();
let operationLocationsPromise = null;

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function formatMinutes(value) {
  return formatCancellationDuration(value);
}

function parseClockMinutes(value) {
  const match = text(value).match(/^(\d{1,3}):([0-5]\d)$/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
}

function routeContextSnapshot(form) {
  return ['#edit-type', '#edit-activity-name', '#edit-authority', '#edit-school', '#edit-training-mode']
    .map((selector) => text(form.querySelector(selector)?.value))
    .join('|');
}

function showAttendanceNotice(message, kind = 'error') {
  let notice = document.querySelector('[data-av2-travel-notice]');
  if (!notice) {
    notice = document.createElement('div');
    notice.dataset.av2TravelNotice = '1';
    notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    notice.style.cssText = 'position:fixed;inset:auto 16px 16px;z-index:10000;padding:12px 16px;border-radius:10px;background:#fff;border:2px solid currentColor;color:#b91c1c;box-shadow:0 8px 28px #0003';
    document.body.append(notice);
  }
  notice.style.color = kind === 'error' ? '#b91c1c' : '#166534';
  notice.textContent = message;
  window.setTimeout(() => notice.remove(), 8000);
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
  form.querySelector('#av2-operation-choice')?.closest('.av2-field')?.insertAdjacentElement('afterend', wrap);
  return wrap;
}

async function syncOperationAddress(form) {
  if (!form.isConnected) return;
  const typeSelect = form.querySelector('#av2-activity-type');
  const choiceSelect = form.querySelector('#av2-operation-choice');
  if (!typeSelect || !choiceSelect) return;

  const wrap = operationAddressField(form);
  const input = wrap.querySelector('input');
  if (text(typeSelect.value) !== 'תפעול') {
    wrap.hidden = true;
    if (input && input.value) input.value = '';
    return;
  }

  const locations = await loadOperationLocations();
  if (!form.isConnected) return;
  const selectedOption = choiceSelect.selectedOptions?.[0];
  const option = locations.byId.get(text(choiceSelect.value))
    || locations.byLabel.get(text(selectedOption?.textContent));
  const address = text(option?.address);

  wrap.hidden = !address;
  if (input && input.value !== address) input.value = address;
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
    void syncOperationAddress(form);
  }
}

function cancellationState(row) {
  const detail = row.querySelector('.av2-rr__travel-compensation');
  if (!detail) return { label: '—', minutes: null, resolved: false, pending: false, status: 'none' };
  if (detail.classList.contains('av2-rr__travel-compensation--pending')) {
    return { label: 'ממתין', minutes: null, resolved: false, pending: true, status: 'pending' };
  }

  const strongText = text(detail.querySelector('strong')?.textContent || detail.textContent);
  const valueMatch = strongText.match(/(\d{1,3}:[0-5]\d)/);
  const label = valueMatch?.[1] || text(strongText) || '—';
  const minutes = parseClockMinutes(label);
  const audit = text(detail.querySelector('.av2-rr__travel-audit')?.textContent);
  return {
    label,
    minutes,
    resolved: true,
    pending: /ממתין|תזכורת|לבקרת/.test(audit),
    status: audit,
  };
}

function enhanceReportHeader(head) {
  if (!(head instanceof HTMLElement) || head.dataset[ENHANCED_HEADER] === '1') return;
  const hours = [...head.children].find((cell) => ['שעות', 'סה״כ שעות'].includes(text(cell.textContent)));
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
  if (text(cell.textContent) !== state.label) cell.textContent = state.label;
  cell.classList.toggle('is-pending', state.pending);

  const nextTitle = state.pending
    ? instructorTravelReportStatusLabel({ review_status: 'pending_review' })
    : state.status || 'דיווח זמני נסיעה';
  if (cell.title !== nextTitle) cell.title = nextTitle;

  const nextMinutes = state.minutes == null ? '' : String(state.minutes);
  if (cell.dataset.minutes !== nextMinutes) cell.dataset.minutes = nextMinutes;

  // Keep the travel report controls visible in the row (do not hide the detail).
  return cell;
}

function showTimeCancelEditField(row, preferredForm = null) {
  window.setTimeout(() => {
    const form = preferredForm
      || document.querySelector('.av2-modal-overlay .av2-modal--form form')
      || document.querySelector('.av2-report__form[data-av2-edit-record-id]');
    if (!form || form.querySelector('[data-av2-time-cancel-edit]') || form.querySelector('#edit-has-cancellation') || form.querySelector('#av2-has-cancellation')) return;
    const hoursDisplay = form.querySelector('.av2-report__hours-display')
      || form.querySelector('.av2-report__time-cancellation');
    if (!hoursDisplay) return;

    const wrap = document.createElement('div');
    wrap.className = 'av2-field av2-time-cancel-edit';
    wrap.dataset.av2TimeCancelEdit = '1';

    const out = document.createElement('input');
    out.type = 'number'; out.min = '0'; out.step = '1';
    out.className = 'av2-rr__travel-minutes';
    out.setAttribute('aria-label', 'דקות נסיעה הלוך');
    out.placeholder = 'הלוך (דקות)';

    const ret = document.createElement('input');
    ret.type = 'number'; ret.min = '0'; ret.step = '1';
    ret.className = 'av2-rr__travel-minutes';
    ret.setAttribute('aria-label', 'דקות נסיעה חזור');
    ret.placeholder = 'חזור (דקות)';

    const note = document.createElement('small');
    note.className = 'av2-time-cancel-edit__note';
    note.textContent = 'דווחו זמני נסיעה בפועל. חישוב המערכת אינו מוצג למדריך.';

    const error = document.createElement('small');
    error.className = 'av2-time-cancel-edit__error';
    error.hidden = true;

    wrap.append(out, ret, note, error);
    hoursDisplay.insertAdjacentElement('afterend', wrap);

    const readonlyPreview = form.querySelector('.av2-report__time-cancellation:not(.av2-report__base-training-route)');
    if (readonlyPreview && readonlyPreview !== hoursDisplay) readonlyPreview.hidden = true;

    const recordId = text(row.dataset.recordId) || text(form.dataset.av2EditRecordId);
    const oldRow = row;
    const initialRouteContext = routeContextSnapshot(form);
    form.addEventListener('submit', () => {
      const outbound = Number(out.value);
      const returning = Number(ret.value);
      if (!Number.isFinite(outbound) || !Number.isFinite(returning) || out.value === '' || ret.value === '') {
        return;
      }
      const routeContextChanged = initialRouteContext !== routeContextSnapshot(form);
      if (recordId) waitForSavedRowAndReport(oldRow, recordId, outbound, returning, routeContextChanged);
    }, { capture: true });
  }, 0);
}

function attachEditFormTimeCancellation(form) {
  if (!(form instanceof HTMLElement)) return;
  const recordId = text(form.dataset.av2EditRecordId);
  if (!recordId || form.querySelector('[data-av2-time-cancel-edit]') || form.querySelector('#edit-has-cancellation') || form.querySelector('#av2-has-cancellation')) return;
  const row = document.querySelector(`.av2-report-row[data-record-id="${CSS.escape(recordId)}"]`);
  showTimeCancelEditField(row || Object.assign(document.createElement('div'), { dataset: { recordId } }), form);
}

function waitForSavedRowAndReport(oldRow, recordId, outbound, returning, routeContextChanged = false) {
  const startedAt = Date.now();
  const timer = window.setInterval(() => {
    if (Date.now() - startedAt > 15000) {
      window.clearInterval(timer);
      showAttendanceNotice('הדיווח נשמר, אך עדכון זמני הנסיעה לא הושלם. נסו לערוך שוב.');
      return;
    }
    const currentRow = document.querySelector(`.av2-report-row[data-record-id="${CSS.escape(recordId)}"]`);
    if (oldRow?.isConnected || !currentRow || currentRow === oldRow) return;
    window.clearInterval(timer);
    if (routeContextChanged) void applyRouteContextReset(recordId);
    void applyTravelReport(currentRow, recordId, outbound, returning);
  }, 180);
}

async function applyRouteContextReset(recordId) {
  if (applyingOverrides.has(recordId)) return;
  applyingOverrides.add(recordId);
  try {
    await reconcileChangedTravelContext(reconcileTravelCompensation, recordId);
    showAttendanceNotice('היעד או הפעילות השתנו; חישוב המערכת עודכן לבקרה בלי לדרוס את דיווח הנסיעה.', 'success');
  } catch (error) {
    console.warn('time cancellation recalculation failed:', error?.message || error);
    showAttendanceNotice(`הדיווח נשמר, אך חישוב ביטול הזמן נכשל: ${error?.message || 'נסו שוב'}`);
  } finally {
    applyingOverrides.delete(recordId);
  }
}

async function applyTravelReport(row, recordId, outbound, returning) {
  if (applyingOverrides.has(recordId)) return;
  applyingOverrides.add(recordId);
  try {
    await reconcileTravelCompensation(recordId);
    const saved = await reportTravelTime(recordId, outbound, returning);
    const cell = row.querySelector('.av2-rr__time-cancel') || updateTimeCancelCell(row);
    if (cell && saved?.requested_cancellation_minutes != null) {
      cell.textContent = formatMinutes(saved.requested_cancellation_minutes);
      cell.dataset.minutes = String(saved.requested_cancellation_minutes);
      cell.title = instructorTravelReportStatusLabel(saved);
    }
    showAttendanceNotice(instructorTravelReportStatusLabel(saved), 'success');
  } catch (error) {
    console.warn('travel time report failed:', error?.message || error);
    showAttendanceNotice(`הדיווח נשמר, אך עדכון זמני הנסיעה נכשל: ${error?.message || 'נסו שוב'}`);
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

function enhanceElement(node) {
  if (!(node instanceof Element)) return;
  if (node.matches('.av2-report-list__head')) enhanceReportHeader(node);
  if (node.matches('.av2-report-row')) enhanceReportRow(node);
  if (node.matches('.av2-report__form')) {
    enhanceOperationForm(node);
    attachEditFormTimeCancellation(node);
  }
  node.querySelectorAll('.av2-report-list__head').forEach(enhanceReportHeader);
  node.querySelectorAll('.av2-report-row').forEach(enhanceReportRow);
  node.querySelectorAll('.av2-report__form').forEach((form) => {
    enhanceOperationForm(form);
    attachEditFormTimeCancellation(form);
  });
}

function enhanceAll() {
  document.querySelectorAll('.av2-report-list__head').forEach(enhanceReportHeader);
  document.querySelectorAll('.av2-report-row').forEach(enhanceReportRow);
  document.querySelectorAll('.av2-report__form').forEach((form) => {
    enhanceOperationForm(form);
    attachEditFormTimeCancellation(form);
  });
}

function boot() {
  enhanceAll();
  const observer = new MutationObserver((mutations) => {
    const rowsToRefresh = new Set();
    for (const mutation of mutations) {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const row = target?.closest?.('.av2-report-row');
      if (row && !target?.closest?.('.av2-rr__time-cancel')) rowsToRefresh.add(row);
      mutation.addedNodes.forEach(enhanceElement);
      if (mutation.type === 'attributes' && target?.matches?.('.av2-report__form')) {
        attachEditFormTimeCancellation(target);
      }
    }
    rowsToRefresh.forEach(enhanceReportRow);
    document.querySelectorAll('.av2-report__form[data-av2-edit-record-id]').forEach(attachEditFormTimeCancellation);
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-av2-edit-record-id'],
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
