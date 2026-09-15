import { showToast } from './screens/shared/toast.js';

export const SCHOOL_2027_DATE_MIN = '2026-09-01';
export const SCHOOL_2027_DATE_MAX = '2027-08-31';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function parseExportRow(form) {
  try {
    return JSON.parse(String(form?.dataset?.exportRow || '{}')) || {};
  } catch {
    return {};
  }
}

export function activitySeasonForForm(form) {
  const fieldValue = clean(form?.querySelector?.('[name="activity_season"]')?.value);
  if (fieldValue) return fieldValue;
  const datasetValue = clean(form?.dataset?.activitySeason);
  if (datasetValue) return datasetValue;
  return clean(parseExportRow(form)?.activity_season);
}

export function isSchool2027Form(form) {
  return activitySeasonForForm(form) === 'school_2027';
}

function activityForms(root = document) {
  if (!root?.querySelectorAll) return [];
  const forms = [];
  if (root.matches?.('[data-add-activity-form], [data-drawer-form]')) forms.push(root);
  root.querySelectorAll('[data-add-activity-form], [data-drawer-form]').forEach((form) => forms.push(form));
  return forms;
}

function dateInputs(form) {
  return Array.from(form?.querySelectorAll?.('input[type="date"]') || []);
}

function setRangeValidity(input, active) {
  if (!input) return;
  const value = clean(input.value);
  const invalid = active && value && (value < SCHOOL_2027_DATE_MIN || value > SCHOOL_2027_DATE_MAX);
  if (invalid) {
    input.dataset.activityDateRangeInvalid = 'yes';
    input.setCustomValidity?.('בתשפ״ז ניתן להזין תאריכים רק בין 01.09.2026 ל־31.08.2027.');
  } else if (input.dataset.activityDateRangeInvalid === 'yes') {
    delete input.dataset.activityDateRangeInvalid;
    input.setCustomValidity?.('');
  }
}

function rememberExistingBound(input, attr, dataKey) {
  if (Object.prototype.hasOwnProperty.call(input.dataset, dataKey)) return;
  input.dataset[dataKey] = input.getAttribute(attr) ?? '';
}

function restoreExistingBound(input, attr, dataKey) {
  if (!Object.prototype.hasOwnProperty.call(input.dataset, dataKey)) return;
  const previous = input.dataset[dataKey];
  delete input.dataset[dataKey];
  if (previous) input.setAttribute(attr, previous);
  else input.removeAttribute(attr);
}

export function applySchool2027DateBounds(root = document) {
  for (const form of activityForms(root)) {
    const active = isSchool2027Form(form);
    for (const input of dateInputs(form)) {
      if (active) {
        rememberExistingBound(input, 'min', 'activityDateOriginalMin');
        rememberExistingBound(input, 'max', 'activityDateOriginalMax');
        if (input.min !== SCHOOL_2027_DATE_MIN) input.min = SCHOOL_2027_DATE_MIN;
        if (input.max !== SCHOOL_2027_DATE_MAX) input.max = SCHOOL_2027_DATE_MAX;
        input.dataset.activityDateRangeBound = 'school_2027';
      } else if (input.dataset.activityDateRangeBound === 'school_2027') {
        delete input.dataset.activityDateRangeBound;
        restoreExistingBound(input, 'min', 'activityDateOriginalMin');
        restoreExistingBound(input, 'max', 'activityDateOriginalMax');
      }
      setRangeValidity(input, active);
    }
  }
}

function inputLabel(input) {
  const index = Number(input?.dataset?.meetingIdx);
  if (Number.isInteger(index) && index >= 0) return `מפגש ${index + 1}`;
  const label = clean(input?.closest?.('label')?.querySelector?.('span')?.textContent);
  if (label) return label;
  if (input?.name === 'start_date') return 'תאריך התחלה';
  if (input?.name === 'end_date') return 'תאריך סיום';
  if (input?.name === 'one_day_date') return 'תאריך הפעילות';
  return 'תאריך';
}

export function validateSchool2027FormDates(form) {
  if (!form || !isSchool2027Form(form)) return { valid: true, input: null, message: '' };
  for (const input of dateInputs(form)) {
    const value = clean(input.value);
    if (!value) continue;
    if (value < SCHOOL_2027_DATE_MIN || value > SCHOOL_2027_DATE_MAX) {
      return {
        valid: false,
        input,
        message: `${inputLabel(input)} אינו בטווח תשפ״ז. ניתן להזין תאריכים רק בין 01.09.2026 ל־31.08.2027.`
      };
    }
  }
  return { valid: true, input: null, message: '' };
}

function showFormError(form, result) {
  const message = result?.message || 'תאריך הפעילות אינו תקין.';
  const status = form?.querySelector?.('[data-add-activity-status], .ds-activity-edit-status');
  if (status) {
    status.textContent = message;
    status.setAttribute('role', 'alert');
    status.classList.add('ds-error-text', 'is-error');
    status.classList.remove('is-success', 'is-pending');
  }
  showToast(message, 'error', 5000);
  result?.input?.focus?.();
  result?.input?.reportValidity?.();
}

function guardFormEvent(event, form) {
  applySchool2027DateBounds(form);
  const result = validateSchool2027FormDates(form);
  if (result.valid) return false;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
  showFormError(form, result);
  return true;
}

let started = false;
let observer = null;

export function startActivityRoutineStabilityRuntime() {
  if (started || typeof document === 'undefined') return;
  started = true;

  applySchool2027DateBounds(document);

  document.addEventListener('input', (event) => {
    const form = event.target?.closest?.('[data-add-activity-form], [data-drawer-form]');
    if (!form) return;
    if (event.target?.matches?.('[name="activity_season"]')) {
      applySchool2027DateBounds(form);
      return;
    }
    if (event.target?.matches?.('input[type="date"]')) {
      setRangeValidity(event.target, isSchool2027Form(form));
    }
  }, true);

  document.addEventListener('change', (event) => {
    const form = event.target?.closest?.('[data-add-activity-form], [data-drawer-form]');
    if (!form) return;
    if (event.target?.matches?.('[name="activity_season"]')) {
      applySchool2027DateBounds(form);
      return;
    }
    if (event.target?.matches?.('input[type="date"]')) {
      setRangeValidity(event.target, isSchool2027Form(form));
    }
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target?.closest?.('[data-add-activity-form]');
    if (!form) return;
    guardFormEvent(event, form);
  }, true);

  document.addEventListener('click', (event) => {
    const saveEdit = event.target?.closest?.('[data-action="save-edit"]');
    if (saveEdit) {
      const form = saveEdit.closest('[data-drawer-form]');
      if (form) guardFormEvent(event, form);
      return;
    }

    const add = event.target?.closest?.('[data-add-activity-submit]');
    if (!add) return;
    const form = document.querySelector('.ds-modal__content [data-add-activity-form]')
      || document.querySelector('[data-add-activity-form]');
    if (form) guardFormEvent(event, form);
  }, true);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes || []) {
        if (node?.nodeType === 1) applySchool2027DateBounds(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

export function stopActivityRoutineStabilityRuntimeForTests() {
  observer?.disconnect?.();
  observer = null;
  started = false;
}

if (typeof document !== 'undefined') startActivityRoutineStabilityRuntime();
