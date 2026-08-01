function editorFormFromNode(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches?.('[data-pa-form]')) return node;
  return node.closest?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]') || null;
}

function recipientReadyState(form, locked = form.querySelector('.ds-pa-client-locked')) {
  if (locked) return true;

  const selectedType = String(
    form.querySelector('input[name="client_type_selector"]:checked')?.value
    || form.querySelector('input[name="contact_source_client_type"]')?.value
    || 'school'
  ).trim();
  const authorityId = String(form.querySelector('input[name="contact_source_authority_id"]')?.value || '').trim();
  const schoolId = String(form.querySelector('input[name="contact_source_school_id"]')?.value || '').trim();
  const otherName = String(form.querySelector('[name="other_client_name"]')?.value || '').trim();

  if (selectedType === 'authority') return Boolean(authorityId);
  if (selectedType === 'other') return Boolean(otherName);
  return Boolean(authorityId && schoolId);
}

function markRecipientMode(form) {
  const locked = form.querySelector('.ds-pa-client-locked');
  const recipientReady = recipientReadyState(form, locked);
  form.classList.toggle('has-locked-client', Boolean(locked));
  form.classList.toggle('has-recipient-selection', recipientReady);

  const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
  if (contactPanel) contactPanel.hidden = !recipientReady;

  if (!locked) return;
  const type = String(locked.querySelector('.ds-pa-client-locked-type strong')?.textContent || '').trim();
  locked.classList.toggle('is-authority', type === 'רשות');
  locked.classList.toggle('is-school', type === 'בית ספר');
  locked.classList.toggle('is-other', type === 'אחר');
}

function recipientTypeFieldForRow(recipientType) {
  const existingField = recipientType.closest('.ds-pa-form-field');
  if (existingField && existingField !== recipientType) return existingField;

  const field = document.createElement('div');
  field.className = 'ds-pa-form-field ds-pa-recipient-type-field';
  const label = document.createElement('span');
  label.textContent = 'סוג נמען';
  recipientType.insertAdjacentElement('beforebegin', field);
  field.append(label, recipientType);
  return field;
}

function arrangeRecipientDateDomainRow(form) {
  const metaPanel = form.querySelector('.ds-pa-form-meta-panel');
  const typePanel = form.querySelector('.ds-pa-form-type-panel');
  const recipientType = form.querySelector('.ds-pa-recipient-type');
  const dateField = typePanel?.querySelector('input[name="proposal_date"]')?.closest('label');
  const domainField = typePanel?.querySelector('select[name="proposal_domain"]')?.closest('label');
  if (!metaPanel || !recipientType || !dateField || !domainField) return;

  const recipientField = recipientTypeFieldForRow(recipientType);
  recipientField.classList.add('ds-pa-recipient-type-field');
  let recipientLabel = recipientField.querySelector(':scope > span');
  if (!recipientLabel) {
    recipientLabel = document.createElement('span');
    recipientLabel.textContent = 'סוג נמען';
    recipientField.insertBefore(recipientLabel, recipientField.firstChild);
  }

  let row = metaPanel.querySelector(':scope > [data-pa-recipient-meta-row]');
  if (!row) {
    row = document.createElement('div');
    row.dataset.paRecipientMetaRow = 'true';
    row.className = 'ds-pa-recipient-meta-row';
    const title = metaPanel.querySelector(':scope > .pa-sidebar-section-title');
    title?.insertAdjacentElement('afterend', row);
  }

  [dateField, domainField, recipientField].forEach((element) => {
    if (element.parentElement !== row) row.appendChild(element);
  });

  row.style.setProperty('display', 'grid', 'important');
  row.style.setProperty('grid-template-columns', '160px 120px max-content', 'important');
  row.style.setProperty('align-items', 'end', 'important');
  row.style.setProperty('justify-content', 'start', 'important');
  row.style.setProperty('gap', '10px', 'important');
  row.style.setProperty('inline-size', 'max-content', 'important');
  row.style.setProperty('max-inline-size', '100%', 'important');
  row.style.setProperty('margin', '0 0 6px', 'important');

  dateField.style.setProperty('inline-size', '160px', 'important');
  domainField.style.setProperty('inline-size', '120px', 'important');
  recipientField.style.setProperty('display', 'grid', 'important');
  recipientField.style.setProperty('gap', '3px', 'important');
  recipientField.style.setProperty('inline-size', 'max-content', 'important');
  recipientField.style.setProperty('margin', '0', 'important');
  recipientType.hidden = false;
  recipientField.hidden = form.classList.contains('has-locked-client');

  const searchBlock = form.querySelector('[data-pa-client-search-row]');
  if (searchBlock) {
    searchBlock.classList.add('is-recipient-selector-relocated');
    searchBlock.style.setProperty('display', searchBlock.hidden ? 'none' : 'grid', 'important');
    searchBlock.style.setProperty('grid-template-columns', '262px', 'important');
    searchBlock.style.setProperty('align-items', 'start', 'important');
    searchBlock.style.setProperty('justify-content', 'start', 'important');
    searchBlock.style.setProperty('gap', '6px', 'important');
    searchBlock.style.setProperty('inline-size', 'fit-content', 'important');
    searchBlock.style.setProperty('margin', '0', 'important');
  }
}

function relocateProgramNotes(form) {
  form.querySelectorAll('[data-pa-item-row]').forEach((row) => {
    const noteDetails = row.querySelector(':scope > .ds-pa-note-details');
    const extraBody = row.querySelector('[data-pa-item-details] > .ds-pa-item-extra-body');
    if (!noteDetails || !extraBody || extraBody.contains(noteDetails)) return;
    noteDetails.dataset.paCompactRelocated = 'true';
    extraBody.appendChild(noteDetails);
  });
}

function mergeGeneralNotesIntoDiscount(form) {
  const notesDetails = form.querySelector('.ds-pa-form-bottom-panel > .ds-pa-notes-details');
  const discountDetails = form.querySelector('[data-pa-discount-details]');
  const notesField = notesDetails?.querySelector('.ds-pa-form-field');
  if (!notesDetails || !discountDetails || !notesField) return;

  if (!discountDetails.contains(notesField)) {
    notesField.classList.add('ds-pa-compact-notes-field');
    discountDetails.appendChild(notesField);
  }
  notesDetails.classList.add('is-compact-relocated');
  if (!notesDetails.hidden) notesDetails.hidden = true;
}

function restoreLegacyMovedNodes(form) {
  const panel = form.querySelector('.ds-pa-form-activities-panel');
  if (!panel) return;

  const legacyHeading = panel.querySelector(':scope > .ds-pa-compact-activities-heading');
  if (legacyHeading) {
    const title = legacyHeading.querySelector(':scope > .pa-sidebar-section-title');
    if (title) panel.insertBefore(title, legacyHeading);

    const movedButton = legacyHeading.querySelector('[data-pa-compact-heading-button]');
    if (movedButton) {
      movedButton.removeAttribute('data-pa-compact-heading-button');
      const currentHeader = panel.querySelector('.ds-pa-items-header');
      if (currentHeader) currentHeader.appendChild(movedButton);
      else movedButton.remove();
    }

    legacyHeading.remove();
  }

  const bottomPanel = form.querySelector('.ds-pa-form-bottom-panel');
  const movedSummary = panel.querySelector(':scope > .ds-pa-summary.is-compact-relocated');
  if (bottomPanel && movedSummary) bottomPanel.insertBefore(movedSummary, bottomPanel.firstChild);
}

function markActivitiesLayout(form) {
  const panel = form.querySelector('.ds-pa-form-activities-panel');
  if (!panel) return;

  const addButtons = Array.from(panel.querySelectorAll('button'))
    .filter((button) => /הוסף\s+שורה/.test(String(button.textContent || '').trim()));
  panel.classList.toggle('has-single-add-row', addButtons.length === 1);
  panel.classList.toggle('has-multiple-add-rows', addButtons.length > 1);
}

function normalizeNextYearWorkshopRows(form) {
  form.querySelectorAll('[data-pa-items-group="next_year_workshops"] [data-pa-item-row]').forEach((row) => {
    const quickRow = row.querySelector(':scope > .ds-pa-item-quick-row');
    if (!quickRow) return;

    row.style.setProperty('inline-size', 'max-content', 'important');
    row.style.setProperty('max-inline-size', '100%', 'important');
    row.style.setProperty('min-block-size', '0', 'important');

    quickRow.style.setProperty('display', 'grid', 'important');
    quickRow.style.setProperty('grid-template-columns', '400px 72px max-content 34px', 'important');
    quickRow.style.setProperty('grid-template-rows', '36px', 'important');
    quickRow.style.setProperty('grid-auto-flow', 'column', 'important');
    quickRow.style.setProperty('align-items', 'center', 'important');
    quickRow.style.setProperty('justify-content', 'start', 'important');
    quickRow.style.setProperty('inline-size', 'max-content', 'important');
    quickRow.style.setProperty('max-inline-size', '100%', 'important');
    quickRow.style.setProperty('gap', '8px', 'important');

    const controls = [
      quickRow.querySelector('.ds-pa-item-field--select'),
      quickRow.querySelector('.ds-pa-item-field--qty'),
      quickRow.querySelector('.ds-pa-item-edit'),
      quickRow.querySelector('.ds-pa-item-remove--quick')
    ];
    controls.forEach((control, index) => {
      if (!control) return;
      control.style.setProperty('grid-column', String(index + 1), 'important');
      control.style.setProperty('grid-row', '1', 'important');
      control.style.setProperty('align-self', 'center', 'important');
      control.style.setProperty('margin', '0', 'important');
    });

    const select = quickRow.querySelector('.ds-pa-item-field--select select');
    const quantity = quickRow.querySelector('.ds-pa-item-field--qty input');
    if (select) {
      select.style.setProperty('inline-size', '400px', 'important');
      select.style.setProperty('max-inline-size', '400px', 'important');
    }
    if (quantity) {
      quantity.style.setProperty('inline-size', '72px', 'important');
      quantity.style.setProperty('max-inline-size', '72px', 'important');
    }
  });
}

function markSummaryLayout(form) {
  const bottomPanel = form.querySelector('.ds-pa-form-bottom-panel');
  const summary = bottomPanel?.querySelector(':scope > .ds-pa-summary');
  if (!bottomPanel || !summary) return;
  summary.classList.add('is-compact-relocated');
  bottomPanel.classList.add('is-summary-relocated');
}

function markDuplicateEditorTotals(form) {
  form.querySelectorAll('.ds-pa-items-total-row, .ds-pa-tour-grand-total-field')
    .forEach((element) => element.classList.add('is-duplicate-editor-total'));
}

function selectedContactPayload(form) {
  const option = form.querySelector('[data-pa-contact-select] option:checked[data-pa-contact-option]');
  const encoded = String(option?.dataset?.paContactOption || '').trim();
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hydrateContactSourceFromPicker(form) {
  const sourceIdInput = form.querySelector('input[name="contact_source_id"]');
  if (!sourceIdInput || String(sourceIdInput.value || '').trim()) return;

  const contact = selectedContactPayload(form);
  const sourceId = String(contact?.id || contact?.source_id || '').trim();
  if (!sourceId) return;

  const setValue = (name, value) => {
    const input = form.querySelector(`input[name="${name}"]`);
    if (input && !String(input.value || '').trim()) input.value = value == null ? '' : String(value);
  };

  sourceIdInput.value = sourceId;
  setValue('contact_source_table', contact.source_table || 'contacts_schools');
  setValue('contact_source_authority_id', contact.authority_id);
  setValue('contact_source_school_id', contact.school_id);
  setValue('contact_source_semel_mosad', contact.semel_mosad);
  setValue('contact_source_authority', contact.authority || contact.authority_name);
  setValue('contact_source_school', contact.school || contact.school_name);
  setValue('contact_source_name', contact.contact_name);
  setValue('contact_source_role', contact.contact_role);
  setValue('contact_source_mobile', contact.mobile);
  setValue('contact_source_email', contact.email);
}

function ensureContactSaveButton(form) {
  const fieldsBlock = form.querySelector('[data-pa-contact-channels-fields]');
  if (!fieldsBlock) return;

  hydrateContactSourceFromPicker(form);
  const sourceId = String(form.querySelector('input[name="contact_source_id"]')?.value || '').trim();
  const existing = fieldsBlock.querySelector('[data-pa-contact-channels-save]');
  if (!sourceId) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ds-btn ds-btn--sm ds-btn--primary';
  button.dataset.paContactChannelsSave = 'true';
  button.textContent = 'שמירת פרטי קשר';
  button.setAttribute('aria-label', 'שמירת פרטי איש הקשר');
  button.style.alignSelf = 'end';
  button.style.whiteSpace = 'nowrap';
  button.style.marginInlineStart = '8px';
  fieldsBlock.appendChild(button);
}

function triggerContactSave(button) {
  const form = button?.closest?.('[data-pa-form]');
  const fieldsBlock = button?.closest?.('[data-pa-contact-channels-fields]');
  if (!form || !fieldsBlock || button.disabled) return;

  hydrateContactSourceFromPicker(form);
  const target = fieldsBlock.querySelector('input[name="phone"]')
    || fieldsBlock.querySelector('input[name="email"]');
  if (!target) return;

  button.disabled = true;
  button.textContent = 'שומר...';
  target.dispatchEvent(new Event('change', { bubbles: true }));

  setTimeout(() => {
    if (!button.isConnected) return;
    button.disabled = false;
    button.textContent = 'שמירת פרטי קשר';
  }, 1200);
}

function markProposalType(form) {
  const type = String(form.querySelector('[name="activity_type_group"]')?.value || '').trim();
  if (type) {
    if (form.dataset.paCompactProposalType !== type) form.dataset.paCompactProposalType = type;
  } else if (form.dataset.paCompactProposalType) {
    delete form.dataset.paCompactProposalType;
  }
}

function compactEditor(form) {
  if (!form || !form.querySelector('.pa-editor-workspace')) return;
  restoreLegacyMovedNodes(form);
  markRecipientMode(form);
  arrangeRecipientDateDomainRow(form);
  relocateProgramNotes(form);
  mergeGeneralNotesIntoDiscount(form);
  markActivitiesLayout(form);
  normalizeNextYearWorkshopRows(form);
  markSummaryLayout(form);
  markDuplicateEditorTotals(form);
  ensureContactSaveButton(form);
  markProposalType(form);
  if (form.dataset.paCompactLayoutApplied !== 'true') form.dataset.paCompactLayoutApplied = 'true';
}

function compactAll(root = document) {
  const direct = editorFormFromNode(root);
  if (direct) compactEditor(direct);
  root.querySelectorAll?.('[data-pa-form]').forEach(compactEditor);
}

let queued = false;
let pendingRoot = null;
let compactObserver = null;

function scheduleCompact(root = document) {
  pendingRoot = root || document;
  if (queued) return;
  queued = true;

  const run = () => {
    queued = false;
    const target = pendingRoot || document;
    pendingRoot = null;
    compactAll(target);
    compactObserver?.takeRecords();
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(run);
  } else {
    setTimeout(run, 0);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleCompact(document), { once: true });
  } else {
    scheduleCompact(document);
  }

  document.addEventListener('change', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) scheduleCompact(form);
  });

  document.addEventListener('click', (event) => {
    const contactSaveButton = event.target?.closest?.('[data-pa-contact-channels-save]');
    if (contactSaveButton) {
      event.preventDefault();
      triggerContactSave(contactSaveButton);
      return;
    }

    const typeButton = event.target?.closest?.('[data-pa-type-btn]');
    const contactToggle = event.target?.closest?.('[data-pa-contact-channels-toggle]');
    const addItemButton = event.target?.closest?.('[data-pa-add-item]');
    const unlockClientButton = event.target?.closest?.('[data-pa-unlock-client]');
    const recipientTypeOption = event.target?.closest?.('.ds-pa-recipient-type-option');
    const form = (typeButton || contactToggle || addItemButton || unlockClientButton || recipientTypeOption)?.closest?.('[data-pa-form]');
    if (form) setTimeout(() => scheduleCompact(form), 0);
  });

  const app = document.getElementById('app') || document.documentElement;
  compactObserver = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.type === 'childList')) return;
    scheduleCompact(app);
  });
  compactObserver.observe(app, {
    childList: true,
    subtree: true
  });
}

export {
  compactEditor,
  recipientReadyState,
  markRecipientMode,
  recipientTypeFieldForRow,
  arrangeRecipientDateDomainRow,
  relocateProgramNotes,
  mergeGeneralNotesIntoDiscount,
  restoreLegacyMovedNodes,
  markActivitiesLayout,
  normalizeNextYearWorkshopRows,
  markSummaryLayout,
  markDuplicateEditorTotals,
  selectedContactPayload,
  hydrateContactSourceFromPicker,
  ensureContactSaveButton,
  triggerContactSave,
  scheduleCompact
};
