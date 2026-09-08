const FORM_SELECTOR = '[data-pa-form]';
const FIELDS_SELECTOR = '[data-pa-contact-channels-fields]';
const CREATE_BUTTON_SELECTOR = '[data-pa-manual-contact-save]';

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function field(form, name) {
  return form?.querySelector?.(`[name="${name}"]`) || null;
}

function value(form, name) {
  return clean(field(form, name)?.value);
}

function selectedClientType(form) {
  return value(form, 'contact_source_client_type')
    || clean(form?.querySelector?.('input[name="client_type_selector"]:checked')?.value)
    || 'school';
}

export function isManualContactCreateState(form) {
  if (!form?.querySelector?.(FIELDS_SELECTOR)) return false;
  if (value(form, 'contact_selection_mode') !== 'other') return false;
  return !value(form, 'contact_source_id');
}

export function proposalManualContactCandidate(form) {
  const clientType = selectedClientType(form);
  const authority = value(form, 'contact_source_authority');
  const school = value(form, 'contact_source_school');
  const mobile = clean(form?.querySelector?.(`${FIELDS_SELECTOR} input[name="phone"]`)?.value || field(form, 'phone')?.value);
  const email = clean(form?.querySelector?.(`${FIELDS_SELECTOR} input[name="email"]`)?.value || field(form, 'email')?.value);

  return {
    client_type: clientType,
    client_name: value(form, 'contact_source_client_name') || school || authority,
    authority_id: value(form, 'contact_source_authority_id') || null,
    school_id: value(form, 'contact_source_school_id') || null,
    semel_mosad: value(form, 'contact_source_semel_mosad') || null,
    authority_code: value(form, 'contact_source_authority_code') || null,
    authority,
    school,
    contact_name: value(form, 'contact_name'),
    contact_role: value(form, 'contact_role'),
    mobile,
    phone: '',
    email
  };
}

function validateCandidate(row) {
  if (!row.contact_name) return 'יש להזין שם איש קשר';
  if (row.client_type === 'school' && (!row.authority_id || !row.school_id)) {
    return 'יש לבחור רשות ובית ספר לפני שמירת איש הקשר';
  }
  if (row.client_type === 'authority' && !row.authority_id) {
    return 'יש לבחור רשות לפני שמירת איש הקשר';
  }
  return '';
}

function setHidden(form, name, nextValue) {
  const input = field(form, name);
  if (!input) return;
  input.value = nextValue == null ? '' : String(nextValue);
}

function setFormMessage(form, message, isError = false) {
  const host = form?.querySelector?.('[data-pa-form-error]');
  if (!host) return;
  host.textContent = message || '';
  host.hidden = !message;
  if (message) host.dataset.paManualContactMessage = isError ? 'error' : 'success';
  else delete host.dataset.paManualContactMessage;
}

function syncSavedContactIdentity(form, saved, candidate) {
  const sourceId = saved?.source_id ?? saved?.id;
  setHidden(form, 'contact_source_table', 'contacts_schools');
  setHidden(form, 'contact_source_id', sourceId);
  setHidden(form, 'contact_source_client_type', saved?.client_type || candidate.client_type);
  setHidden(form, 'contact_source_client_name', saved?.client_name || candidate.client_name);
  setHidden(form, 'contact_source_authority_id', saved?.authority_id ?? candidate.authority_id);
  setHidden(form, 'contact_source_school_id', saved?.school_id ?? candidate.school_id);
  setHidden(form, 'contact_source_authority_code', saved?.authority_code ?? candidate.authority_code);
  setHidden(form, 'contact_source_semel_mosad', saved?.semel_mosad ?? candidate.semel_mosad);
  setHidden(form, 'contact_source_authority', saved?.authority || candidate.authority);
  setHidden(form, 'contact_source_school', saved?.school || candidate.school);
  setHidden(form, 'contact_source_name', saved?.contact_name || candidate.contact_name);
  setHidden(form, 'contact_source_role', saved?.contact_role || candidate.contact_role);
  setHidden(form, 'contact_source_mobile', saved?.mobile || candidate.mobile);
  setHidden(form, 'contact_source_phone', saved?.phone || candidate.phone);
  setHidden(form, 'contact_source_email', saved?.email || candidate.email);

  const sourceIdInput = field(form, 'contact_source_id');
  sourceIdInput?.dispatchEvent?.(new Event('change', { bubbles: true }));
}

export async function saveManualContactFromProposal(form, dependencies = {}) {
  if (!isManualContactCreateState(form)) return null;
  const candidate = proposalManualContactCandidate(form);
  const validationError = validateCandidate(candidate);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'proposal_manual_contact_validation';
    throw error;
  }

  const targetApi = dependencies.api || (await import('./api.js')).api;
  const persist = dependencies.persistNewClientContact
    || (await import('./client-contact-persistence.js')).persistNewClientContact;
  const saved = await persist(targetApi, candidate);
  const sourceId = saved?.source_id ?? saved?.id;
  if (sourceId == null || clean(sourceId) === '') throw new Error('client_contact_insert_verification_failed');

  syncSavedContactIdentity(form, saved, candidate);
  return saved;
}

function createButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-btn ds-btn--sm ds-btn--primary';
  button.dataset.paManualContactSave = 'true';
  button.textContent = 'שמירה';
  button.setAttribute('aria-label', 'שמירת איש הקשר החדש');
  button.style.alignSelf = 'end';
  button.style.whiteSpace = 'nowrap';
  button.style.marginInlineStart = '8px';
  return button;
}

export function ensureManualContactSaveButton(form) {
  const fieldsBlock = form?.querySelector?.(FIELDS_SELECTOR);
  if (!fieldsBlock) return null;
  let button = fieldsBlock.querySelector(CREATE_BUTTON_SELECTOR);
  if (!isManualContactCreateState(form)) {
    button?.remove();
    return null;
  }
  if (button) return button;
  button = createButton();
  fieldsBlock.appendChild(button);
  return button;
}

export function ensureManualContactSaveButtons(root = document) {
  const direct = root?.matches?.(FORM_SELECTOR) ? root : null;
  if (direct) ensureManualContactSaveButton(direct);
  root?.querySelectorAll?.(FORM_SELECTOR).forEach(ensureManualContactSaveButton);
}

let observer = null;
let queued = false;
function schedule(root = document) {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    ensureManualContactSaveButtons(root || document);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => schedule(document), { once: true });
  else schedule(document);

  document.addEventListener('change', (event) => {
    const form = event.target?.closest?.(FORM_SELECTOR);
    if (form) schedule(form);
  });

  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.(CREATE_BUTTON_SELECTOR);
    if (!button) return;
    event.preventDefault();
    const form = button.closest(FORM_SELECTOR);
    if (!form || button.disabled) return;

    button.disabled = true;
    button.textContent = 'שומר...';
    setFormMessage(form, '');
    try {
      const saved = await saveManualContactFromProposal(form);
      if (!saved) return;
      const { showToast } = await import('./screens/shared/toast.js');
      showToast(saved.already_existed ? 'איש הקשר כבר קיים ונבחר' : 'איש הקשר נשמר בהצלחה', 'success', 2200);
      setFormMessage(form, 'איש הקשר נשמר ונבחר להצעה');
      button.remove();
      schedule(form);
    } catch (error) {
      console.error('[proposal manual contact save failed]', error);
      const message = clean(error?.message) || 'לא ניתן היה לשמור את איש הקשר';
      setFormMessage(form, message, true);
      try {
        const { showToast } = await import('./screens/shared/toast.js');
        showToast(message, 'error', 3200);
      } catch { /* UI fallback is the form error message */ }
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'שמירה';
      }
    }
  }, true);

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(FORM_SELECTOR) || node.querySelector?.(FORM_SELECTOR)) {
          schedule(node);
          return;
        }
      }
    }
  });
  observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
}
