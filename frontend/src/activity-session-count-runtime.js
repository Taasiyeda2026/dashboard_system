const FORM_SELECTOR = '[data-drawer-form]';
const FIELD_SELECTOR = '[data-session-count-override-field]';
const INPUT_SELECTOR = '[data-session-count-override]';
const MULTI_SESSION_TYPES = new Set(['course', 'after_school']);
const MAX_SESSIONS = 35;

function normalizeActivityType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'course' || raw === 'קורס') return 'course';
  if (raw === 'after_school' || raw === 'afterschool' || raw === 'אפטרסקול') return 'after_school';
  if (raw === 'workshop' || raw === 'סדנה') return 'workshop';
  if (raw === 'tour' || raw === 'סיור') return 'tour';
  if (raw === 'escape_room' || raw === 'חדר בריחה') return 'escape_room';
  return raw;
}

function validSessionCount(value) {
  const count = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(count) && count >= 1 && count <= MAX_SESSIONS ? count : null;
}

function activityTypeForForm(form) {
  return normalizeActivityType(form?.querySelector?.('[name="activity_type"]')?.value || '');
}

function isMultiSessionForm(form) {
  return MULTI_SESSION_TYPES.has(activityTypeForForm(form));
}

function meetingCards(form) {
  return Array.from(form?.querySelectorAll?.('[data-meeting-dates-edit] > .activity-drawer__date-card') || []);
}

function drawerRow(form) {
  try {
    return JSON.parse(form?.dataset?.exportRow || '{}') || {};
  } catch {
    return {};
  }
}

function selectedCatalogMeetings(form) {
  const option = form?.querySelector?.('[data-role="activity-name-select"] option:checked');
  return validSessionCount(option?.dataset?.meetingsCount);
}

function initialSessionCount(form) {
  const datesSection = form?.querySelector?.('[data-dates-section]');
  const row = drawerRow(form);
  return validSessionCount(row?.sessions)
    ?? validSessionCount(row?.meetings_total)
    ?? validSessionCount(datesSection?.dataset?.sessionTotal)
    ?? selectedCatalogMeetings(form)
    ?? validSessionCount(meetingCards(form).length)
    ?? 1;
}

function setFieldVisibility(form) {
  const field = form?.querySelector?.(FIELD_SELECTOR);
  const input = field?.querySelector?.(INPUT_SELECTOR);
  if (!field || !input) return;

  const supported = isMultiSessionForm(form);
  input.disabled = !supported;
  const editing = String(form.dataset.editing || '') === 'yes';
  field.hidden = !supported || !editing;
}

function setSessionFieldValue(form, count, { manual = false } = {}) {
  const normalized = validSessionCount(count);
  const input = form?.querySelector?.(INPUT_SELECTOR);
  if (!input || normalized == null) return false;

  input.value = String(normalized);
  input.setCustomValidity('');
  input.dataset.manualOverride = manual ? 'yes' : 'no';

  const datesSection = form.querySelector('[data-dates-section]');
  if (datesSection) datesSection.dataset.sessionTotal = String(normalized);
  return true;
}

function clickAddMeeting(form) {
  const button = form?.querySelector?.('[data-action="add-meeting"]');
  if (!button) return false;
  const before = meetingCards(form).length;
  button.click();
  return meetingCards(form).length > before;
}

function clickRemoveMeeting(form) {
  const cards = meetingCards(form);
  if (cards.length <= 1) return false;
  const button = cards[cards.length - 1]?.querySelector?.('[data-action="remove-meeting"]');
  if (!button) return false;
  const before = cards.length;
  button.click();
  return meetingCards(form).length < before;
}

export function applyManualSessionCount(form, requestedCount) {
  if (!(form instanceof HTMLElement) || !isMultiSessionForm(form)) return false;
  const target = validSessionCount(requestedCount);
  const input = form.querySelector(INPUT_SELECTOR);
  if (target == null) {
    input?.setCustomValidity?.(`יש להזין מספר מפגשים בין 1 ל-${MAX_SESSIONS}`);
    return false;
  }

  let guard = 0;
  while (meetingCards(form).length < target && guard < MAX_SESSIONS) {
    if (!clickAddMeeting(form)) break;
    guard += 1;
  }
  while (meetingCards(form).length > target && guard < MAX_SESSIONS * 2) {
    if (!clickRemoveMeeting(form)) break;
    guard += 1;
  }

  const actual = meetingCards(form).length;
  setSessionFieldValue(form, actual || target, { manual: true });
  return actual === target;
}

function syncFieldFromMeetingCards(form, { manual = false } = {}) {
  if (!isMultiSessionForm(form)) return;
  const count = meetingCards(form).length;
  if (count > 0) setSessionFieldValue(form, count, { manual });
}

function createSessionField(form) {
  const section = form?.querySelector?.('[data-dates-section]');
  if (!section || section.querySelector(FIELD_SELECTOR)) return section?.querySelector?.(FIELD_SELECTOR) || null;

  const field = document.createElement('label');
  field.className = 'activity-drawer__field activity-drawer__session-count-field';
  field.dataset.sessionCountOverrideField = 'yes';
  field.dataset.mode = 'edit';
  field.hidden = true;

  const label = document.createElement('span');
  label.className = 'activity-drawer__label';
  label.textContent = 'מספר מפגשים';

  const controls = document.createElement('span');
  controls.className = 'activity-drawer__session-count-controls';

  const input = document.createElement('input');
  input.type = 'number';
  input.name = 'sessions';
  input.min = '1';
  input.max = String(MAX_SESSIONS);
  input.step = '1';
  input.inputMode = 'numeric';
  input.className = 'ds-input';
  input.dataset.sessionCountOverride = 'yes';
  input.value = String(initialSessionCount(form));

  const help = document.createElement('small');
  help.className = 'activity-drawer__session-count-help';
  help.textContent = 'מתעדכן אוטומטית לפי התוכנית, וניתן לשינוי ידני.';

  controls.append(input, help);
  field.append(label, controls);

  const sectionHead = section.querySelector('.activity-drawer__section-head');
  if (sectionHead) sectionHead.insertAdjacentElement('afterend', field);
  else section.prepend(field);

  if (form._initialValues && form._initialValues.sessions == null) {
    form._initialValues.sessions = String(input.value);
  }
  return field;
}

function ensureStyles() {
  if (document.getElementById('activity-session-count-runtime-style')) return;
  const style = document.createElement('style');
  style.id = 'activity-session-count-runtime-style';
  style.textContent = `
    .activity-drawer__session-count-field {
      max-width: 260px;
      margin: 10px 0 8px;
      padding: 10px 12px;
      border: 1px solid var(--color-border, #dbe3ec);
      border-radius: 10px;
      background: var(--color-surface-muted, #f8fafc);
    }
    .activity-drawer__session-count-field[hidden] { display: none !important; }
    .activity-drawer__session-count-controls {
      display: flex;
      align-items: center;
      gap: 9px;
      margin-top: 5px;
    }
    .activity-drawer__session-count-field input {
      width: 82px;
      min-width: 82px;
      text-align: center;
    }
    .activity-drawer__session-count-help {
      color: var(--color-text-secondary, #64748b);
      font-size: 11px;
      line-height: 1.35;
    }
    @media (max-width: 640px) {
      .activity-drawer__session-count-field { max-width: none; width: 100%; }
      .activity-drawer__session-count-controls { align-items: flex-start; }
    }
  `;
  document.head.append(style);
}

export function ensureEditableSessionCount(form) {
  if (!(form instanceof HTMLElement)) return;
  const section = form.querySelector('[data-dates-section]');
  if (!section) return;

  createSessionField(form);
  setFieldVisibility(form);

  if (form.dataset.sessionCountRuntimeBound === 'yes') return;
  form.dataset.sessionCountRuntimeBound = 'yes';

  form.addEventListener('input', (event) => {
    const input = event.target.closest?.(INPUT_SELECTOR);
    if (!input) return;
    input.setCustomValidity('');
  });

  form.addEventListener('change', (event) => {
    const input = event.target.closest?.(INPUT_SELECTOR);
    if (input) {
      applyManualSessionCount(form, input.value);
      return;
    }

    if (event.target.closest?.('[name="activity_type"]')) {
      const current = validSessionCount(meetingCards(form).length) ?? initialSessionCount(form);
      setSessionFieldValue(form, current, { manual: false });
      setFieldVisibility(form);
      return;
    }

    const nameSelect = event.target.closest?.('[data-role="activity-name-select"]');
    if (nameSelect) {
      const catalogCount = selectedCatalogMeetings(form);
      if (catalogCount != null && isMultiSessionForm(form)) {
        setSessionFieldValue(form, catalogCount, { manual: false });
      }
    }
  });
}

function enhanceAll() {
  ensureStyles();
  document.querySelectorAll(FORM_SELECTOR).forEach(ensureEditableSessionCount);
}

function installGlobalSync() {
  document.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-action="add-meeting"], [data-action="remove-meeting"], [data-action="start-edit"], [data-action="cancel-edit"]');
    if (!action) return;
    const form = action.closest(FORM_SELECTOR);
    if (!form) return;

    queueMicrotask(() => {
      ensureEditableSessionCount(form);
      if (action.matches('[data-action="add-meeting"], [data-action="remove-meeting"]')) {
        syncFieldFromMeetingCards(form, { manual: true });
      }
      setFieldVisibility(form);
    });
  });
}

if (typeof document !== 'undefined') {
  enhanceAll();
  installGlobalSync();
  const observer = new MutationObserver(() => enhanceAll());
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
