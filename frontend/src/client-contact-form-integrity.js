function addLabeledInput(form, before, labelText, inputName) {
  const label = document.createElement('label');
  label.append(document.createTextNode(labelText));
  const input = document.createElement('input');
  input.className = 'ds-input';
  input.name = inputName;
  input.inputMode = 'tel';
  input.autocomplete = 'tel';
  label.append(input);
  form.insertBefore(label, before);
}

function addContactActions(form) {
  const actions = document.createElement('div');
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'ds-btn ds-btn--primary';
  submit.textContent = 'שמירה';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ds-btn';
  cancel.dataset.paClientContactClose = '';
  cancel.textContent = 'ביטול';
  actions.append(submit, cancel);
  form.append(actions);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function namedField(form, name) {
  return form?.querySelector?.(`[name="${name}"]`) || null;
}

function namedValue(form, name) {
  return clean(namedField(form, name)?.value);
}

function proposalContactClientType(form) {
  return namedValue(form, 'contact_source_client_type')
    || clean(form?.querySelector?.('input[name="client_type_selector"]:checked')?.value)
    || 'school';
}

export function isManualProposalContact(form) {
  if (!form?.querySelector?.('[data-pa-contact-channels-fields]')) return false;
  if (namedValue(form, 'contact_selection_mode') !== 'other') return false;
  return !namedValue(form, 'contact_source_id');
}

export function proposalManualContactCandidate(form) {
  const fields = form?.querySelector?.('[data-pa-contact-channels-fields]');
  const clientType = proposalContactClientType(form);
  const authority = namedValue(form, 'contact_source_authority');
  const school = namedValue(form, 'contact_source_school');
  const mobile = clean(fields?.querySelector?.('input[name="phone"]')?.value || namedValue(form, 'phone'));
  const email = clean(fields?.querySelector?.('input[name="email"]')?.value || namedValue(form, 'email'));
  return {
    client_type: clientType,
    client_name: namedValue(form, 'contact_source_client_name') || school || authority,
    authority_id: namedValue(form, 'contact_source_authority_id') || null,
    school_id: namedValue(form, 'contact_source_school_id') || null,
    semel_mosad: namedValue(form, 'contact_source_semel_mosad') || null,
    authority_code: namedValue(form, 'contact_source_authority_code') || null,
    authority,
    school,
    contact_name: namedValue(form, 'contact_name'),
    contact_role: namedValue(form, 'contact_role'),
    mobile,
    phone: '',
    email
  };
}

function validateProposalContactCandidate(row) {
  if (!row.contact_name) return 'יש להזין שם איש קשר';
  if (row.client_type === 'school' && (!row.authority_id || !row.school_id)) {
    return 'יש לבחור רשות ובית ספר לפני שמירת איש הקשר';
  }
  if (row.client_type === 'authority' && !row.authority_id) {
    return 'יש לבחור רשות לפני שמירת איש הקשר';
  }
  return '';
}

function setNamedValue(form, name, value) {
  const input = namedField(form, name);
  if (input) input.value = value == null ? '' : String(value);
}

function syncSavedProposalContact(form, saved, candidate) {
  const sourceId = saved?.source_id ?? saved?.id;
  setNamedValue(form, 'contact_source_table', 'contacts_schools');
  setNamedValue(form, 'contact_source_id', sourceId);
  setNamedValue(form, 'contact_source_client_type', saved?.client_type || candidate.client_type);
  setNamedValue(form, 'contact_source_client_name', saved?.client_name || candidate.client_name);
  setNamedValue(form, 'contact_source_authority_id', saved?.authority_id ?? candidate.authority_id);
  setNamedValue(form, 'contact_source_school_id', saved?.school_id ?? candidate.school_id);
  setNamedValue(form, 'contact_source_authority_code', saved?.authority_code ?? candidate.authority_code);
  setNamedValue(form, 'contact_source_semel_mosad', saved?.semel_mosad ?? candidate.semel_mosad);
  setNamedValue(form, 'contact_source_authority', saved?.authority || candidate.authority);
  setNamedValue(form, 'contact_source_school', saved?.school || candidate.school);
  setNamedValue(form, 'contact_source_name', saved?.contact_name || candidate.contact_name);
  setNamedValue(form, 'contact_source_role', saved?.contact_role || candidate.contact_role);
  setNamedValue(form, 'contact_source_mobile', saved?.mobile || candidate.mobile);
  setNamedValue(form, 'contact_source_phone', saved?.phone || candidate.phone);
  setNamedValue(form, 'contact_source_email', saved?.email || candidate.email);

  const sourceIdInput = namedField(form, 'contact_source_id');
  if (sourceIdInput && typeof Event !== 'undefined') {
    sourceIdInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

export async function saveManualProposalContact(form, dependencies = {}) {
  if (!isManualProposalContact(form)) return null;
  const candidate = proposalManualContactCandidate(form);
  const validationError = validateProposalContactCandidate(candidate);
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
  syncSavedProposalContact(form, saved, candidate);
  return saved;
}

function proposalManualSaveButton() {
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

export function ensureProposalManualContactSave(form) {
  const fields = form?.querySelector?.('[data-pa-contact-channels-fields]');
  if (!fields) return null;
  let button = fields.querySelector('[data-pa-manual-contact-save]');
  if (!isManualProposalContact(form)) {
    button?.remove();
    return null;
  }
  if (!button) {
    button = proposalManualSaveButton();
    fields.appendChild(button);
  }
  return button;
}

function setProposalContactMessage(form, message, isError = false) {
  const host = form?.querySelector?.('[data-pa-form-error]');
  if (!host) return;
  host.textContent = message || '';
  host.hidden = !message;
  if (message) host.dataset.paManualContactMessage = isError ? 'error' : 'success';
  else delete host.dataset.paManualContactMessage;
}

/** Completes a contact modal created by a previously cached screen renderer and
 * restores the explicit save action for a new manual contact inside a proposal. */
export function ensureClientContactFormIntegrity(root = document) {
  root.querySelectorAll?.('[data-pa-client-contact-form]').forEach((form) => {
    const emailLabel = form.querySelector('[name="email"]')?.closest('label') || null;
    if (!form.querySelector('[name="phone"]')) {
      addLabeledInput(form, emailLabel, 'טלפון נוסף', 'phone');
    }
    if (!form.querySelector('[data-pa-client-contact-error]')) {
      const error = document.createElement('p');
      error.dataset.paClientContactError = '';
      error.setAttribute('role', 'alert');
      form.append(error);
    }
    if (!form.querySelector('button[type="submit"]')) addContactActions(form);
  });

  if (root.matches?.('[data-pa-form]')) ensureProposalManualContactSave(root);
  root.querySelectorAll?.('[data-pa-form]').forEach(ensureProposalManualContactSave);
}

if (typeof document !== 'undefined' && !globalThis.__proposalManualContactSaveBound) {
  globalThis.__proposalManualContactSaveBound = true;
  document.addEventListener('click', async (event) => {
    const button = event.target?.closest?.('[data-pa-manual-contact-save]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const form = button.closest?.('[data-pa-form]');
    if (!form || button.disabled) return;

    button.disabled = true;
    button.textContent = 'שומר...';
    setProposalContactMessage(form, '');
    try {
      const saved = await saveManualProposalContact(form);
      if (!saved) return;
      button.remove();
      setProposalContactMessage(form, 'איש הקשר נשמר ונבחר להצעה');
      try {
        const { showToast } = await import('./screens/shared/toast.js');
        showToast(saved.already_existed ? 'איש הקשר כבר קיים ונבחר' : 'איש הקשר נשמר בהצלחה', 'success', 2200);
      } catch { /* inline confirmation remains visible */ }
    } catch (error) {
      console.error('[proposal manual contact save failed]', error);
      const message = clean(error?.message) || 'לא ניתן היה לשמור את איש הקשר';
      setProposalContactMessage(form, message, true);
      try {
        const { showToast } = await import('./screens/shared/toast.js');
        showToast(message, 'error', 3200);
      } catch { /* inline error remains visible */ }
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'שמירה';
      }
    }
  }, true);
}
