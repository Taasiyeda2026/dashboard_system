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

function selectedExistingProposalContactSource(form, { hydrate = false } = {}) {
  const directId = namedValue(form, 'contact_source_id');
  const directTable = namedValue(form, 'contact_source_table');
  if (directId) {
    return { source_id: directId, source_table: directTable || 'contacts_schools' };
  }

  const payload = readContactOption(selectedContactOption(form));
  const sourceId = clean(payload?.source_id ?? payload?.id);
  const sourceTable = clean(payload?.source_table);
  if (!sourceId || sourceTable !== 'contacts_schools') return null;

  if (hydrate) {
    setNamedValue(form, 'contact_source_id', sourceId);
    setNamedValue(form, 'contact_source_table', sourceTable);
  }
  return { source_id: sourceId, source_table: sourceTable };
}

export function isManualProposalContact(form) {
  if (!form?.querySelector?.('[data-pa-contact-channels-fields]')) return false;
  if (namedValue(form, 'contact_selection_mode') !== 'other') return false;
  return !namedValue(form, 'contact_source_id');
}

export function isExistingProposalContact(form) {
  if (!form?.querySelector?.('[data-pa-contact-channels-fields]')) return false;
  return Boolean(selectedExistingProposalContactSource(form));
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

export function proposalExistingContactFields(form) {
  const fields = form?.querySelector?.('[data-pa-contact-channels-fields]');
  return {
    contact_name: namedValue(form, 'contact_name'),
    contact_role: namedValue(form, 'contact_role'),
    mobile: clean(fields?.querySelector?.('input[name="phone"]')?.value || namedValue(form, 'phone')),
    email: clean(fields?.querySelector?.('input[name="email"]')?.value || namedValue(form, 'email'))
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

function validateExistingProposalContact(fields) {
  if (!fields.contact_name) return 'יש להזין שם איש קשר';
  return '';
}

function setNamedValue(form, name, value) {
  const input = namedField(form, name);
  if (input) input.value = value == null ? '' : String(value);
}

function selectedContactOption(form) {
  return form?.querySelector?.('[data-pa-contact-select] option:checked[data-pa-contact-option]')
    || form?.querySelector?.('[data-pa-contact-select]')?.selectedOptions?.[0]
    || null;
}

function readContactOption(option) {
  const encoded = clean(option?.dataset?.paContactOption);
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function writeContactOption(option, row) {
  if (!option || !row) return;
  option.dataset.paContactOption = encodeURIComponent(JSON.stringify(row));
}

function syncExistingContactToForm(form, fields) {
  setNamedValue(form, 'contact_source_name', fields.contact_name);
  setNamedValue(form, 'contact_source_role', fields.contact_role);
  setNamedValue(form, 'contact_source_mobile', fields.mobile);
  setNamedValue(form, 'contact_source_email', fields.email);

  const option = selectedContactOption(form);
  const payload = readContactOption(option);
  if (payload) {
    writeContactOption(option, {
      ...payload,
      contact_name: fields.contact_name,
      contact_role: fields.contact_role,
      mobile: fields.mobile,
      email: fields.email
    });
  }
}

function restoreSelectedContactPayload(form) {
  const option = selectedContactOption(form);
  const payload = readContactOption(option);
  if (!payload) return;
  const sourceId = namedValue(form, 'contact_source_id');
  const optionId = clean(payload.source_id ?? payload.id);
  if (sourceId && optionId && sourceId !== optionId) return;

  const values = {
    contact_name: clean(payload.contact_name),
    contact_role: clean(payload.contact_role),
    phone: clean(payload.mobile),
    email: clean(payload.email)
  };
  Object.entries(values).forEach(([name, value]) => setNamedValue(form, name, value));
  syncExistingContactToForm(form, {
    contact_name: values.contact_name,
    contact_role: values.contact_role,
    mobile: values.phone,
    email: values.email
  });
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

export async function saveExistingProposalContact(form, dependencies = {}) {
  const source = selectedExistingProposalContactSource(form, { hydrate: true });
  if (!source) return null;
  const fields = proposalExistingContactFields(form);
  const validationError = validateExistingProposalContact(fields);
  if (validationError) {
    const error = new Error(validationError);
    error.code = 'proposal_existing_contact_validation';
    throw error;
  }

  const sourceId = source.source_id;
  const sourceTable = source.source_table;
  const targetApi = dependencies.api || (await import('./api.js')).api;
  if (typeof targetApi?.updateUnifiedContactRecord !== 'function') {
    throw new Error('contact_update_unavailable');
  }

  await targetApi.updateUnifiedContactRecord({
    source_table: sourceTable,
    source_id: sourceId,
    fields: {
      contact_name: fields.contact_name,
      contact_role: fields.contact_role,
      mobile: fields.mobile,
      email: fields.email
    }
  });
  syncExistingContactToForm(form, fields);
  return { source_id: sourceId, source_table: sourceTable, ...fields };
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

function proposalExistingUpdateButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-btn ds-btn--sm ds-btn--primary';
  button.dataset.paExistingContactSave = 'true';
  button.textContent = 'שמירת עדכון';
  button.setAttribute('aria-label', 'שמירת עדכון פרטי איש הקשר');
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

export function ensureProposalExistingContactUpdate(form) {
  const fields = form?.querySelector?.('[data-pa-contact-channels-fields]');
  if (!fields) return null;
  let button = fields.querySelector('[data-pa-existing-contact-save]');
  const source = selectedExistingProposalContactSource(form, { hydrate: true });
  if (!source) {
    button?.remove();
    return null;
  }
  if (!button) {
    button = proposalExistingUpdateButton();
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

function ensureProposalContactActions(form) {
  ensureProposalManualContactSave(form);
  ensureProposalExistingContactUpdate(form);
}

/** Completes a contact modal created by a previously cached screen renderer and
 * restores explicit save actions for new and existing contacts inside a proposal. */
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

  if (root.matches?.('[data-pa-form]')) ensureProposalContactActions(root);
  root.querySelectorAll?.('[data-pa-form]').forEach(ensureProposalContactActions);
}

if (typeof document !== 'undefined' && !globalThis.__proposalManualContactSaveBound) {
  globalThis.__proposalManualContactSaveBound = true;

  // Existing contacts are edited explicitly. Suppress the old partial auto-save
  // that wrote mobile/email immediately on field blur before the user pressed save.
  document.addEventListener('change', (event) => {
    const target = event.target;
    const form = target?.closest?.('[data-pa-form]');
    if (!form) return;

    if (target?.matches?.('[data-pa-contact-select]')) {
      setTimeout(() => {
        restoreSelectedContactPayload(form);
        ensureProposalContactActions(form);
      }, 0);
      return;
    }

    if (!isExistingProposalContact(form)) return;
    if (!target?.closest?.('[data-pa-contact-channels-fields]')) return;
    if (target.name !== 'phone' && target.name !== 'email') return;
    event.stopImmediatePropagation();
  }, true);

  document.addEventListener('click', async (event) => {
    const contactToggle = event.target?.closest?.('[data-pa-contact-channels-toggle]');
    if (contactToggle) {
      const form = contactToggle.closest?.('[data-pa-form]');
      if (form && isExistingProposalContact(form)) {
        form.querySelectorAll('[data-pa-contact-manual-fields]').forEach((el) => { el.hidden = false; });
        ensureProposalExistingContactUpdate(form);
      }
      return;
    }

    const manualButton = event.target?.closest?.('[data-pa-manual-contact-save]');
    if (manualButton) {
      event.preventDefault();
      event.stopPropagation();
      const form = manualButton.closest?.('[data-pa-form]');
      if (!form || manualButton.disabled) return;

      manualButton.disabled = true;
      manualButton.textContent = 'שומר...';
      setProposalContactMessage(form, '');
      try {
        const saved = await saveManualProposalContact(form);
        if (!saved) return;
        manualButton.remove();
        ensureProposalExistingContactUpdate(form);
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
        if (manualButton.isConnected) {
          manualButton.disabled = false;
          manualButton.textContent = 'שמירה';
        }
      }
      return;
    }

    const updateButton = event.target?.closest?.('[data-pa-existing-contact-save]');
    if (!updateButton) return;
    event.preventDefault();
    event.stopPropagation();
    const form = updateButton.closest?.('[data-pa-form]');
    if (!form || updateButton.disabled) return;

    updateButton.disabled = true;
    updateButton.textContent = 'שומר...';
    setProposalContactMessage(form, '');
    try {
      const saved = await saveExistingProposalContact(form);
      if (!saved) return;
      setProposalContactMessage(form, 'פרטי איש הקשר עודכנו ונשמרו');
      try {
        const { showToast } = await import('./screens/shared/toast.js');
        showToast('פרטי איש הקשר עודכנו ונשמרו', 'success', 2200);
      } catch { /* inline confirmation remains visible */ }
    } catch (error) {
      console.error('[proposal existing contact save failed]', error);
      const message = clean(error?.message) || 'לא ניתן היה לשמור את עדכון איש הקשר';
      setProposalContactMessage(form, message, true);
      try {
        const { showToast } = await import('./screens/shared/toast.js');
        showToast(message, 'error', 3200);
      } catch { /* inline error remains visible */ }
    } finally {
      if (updateButton.isConnected) {
        updateButton.disabled = false;
        updateButton.textContent = 'שמירת עדכון';
      }
    }
  }, true);
}
