import './proposal-next-year-editor-stability.js';

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
  // Contact panel visibility stays under proposals-agreements recipient selection logic.
}

function recipientTypeFieldForRow() {
  // Recipient type is rendered in formHtml; no runtime wrapping.
  return null;
}

function arrangeRecipientDateDomainRow() {
  // Date, domain and recipient type are rendered in one HTML row; no runtime reparenting.
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
  // Workshop one-line layout is owned by proposal-editor-compact-fixes.css.
  // Keep the hook so existing callers/tests continue to resolve.
  if (!form?.querySelector?.('[data-pa-items-group="next_year_workshops"]')) return;
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

function sanitizeContactSchoolSource(form) {
  const sourceIdInput = form?.querySelector?.('input[name="contact_source_id"]');
  const sourceTableInput = form?.querySelector?.('input[name="contact_source_table"]');
  if (!sourceIdInput) return false;

  const sourceId = String(sourceIdInput.value || '').trim();
  const sourceTable = String(sourceTableInput?.value || '').trim();
  if (!sourceId || !sourceTable || sourceTable === 'contacts_schools') return false;

  // proposals_agreements.contact_school_id is a FK to contacts_schools.id only.
  // School/authority catalogue rows have their own independent ids, so carrying
  // those ids into contact_school_id causes FK failures (or an incorrect link if
  // the numeric ids happen to collide). Keep authority_id/school_id intact and
  // clear only the contact link when the selected source is not contacts_schools.
  sourceIdInput.value = '';
  return true;
}

function hydrateContactSourceFromPicker(form) {
  const sourceIdInput = form.querySelector('input[name="contact_source_id"]');
  if (!sourceIdInput) return;

  const contact = selectedContactPayload(form);
  const setValue = (name, value) => {
    const input = form.querySelector(`input[name="${name}"]`);
    if (input && !String(input.value || '').trim() && value != null && String(value).trim()) {
      input.value = String(value);
    }
  };

  // Preserve recipient identity even when an older/stale editor already carries
  // a non-contact catalogue id in contact_source_id. The old implementation
  // returned early in that case, so sanitizing contact_source_id could leave the
  // proposal without authority_id/school_id and client validation blocked the save
  // before any Supabase request was sent.
  setValue('contact_source_authority_id', form?.dataset?.paAuthorityId || '');

  if (!contact) return;

  const sourceId = String(contact?.id || contact?.source_id || '').trim();
  const sourceTable = String(contact?.source_table || '').trim();

  setValue('contact_source_table', sourceTable || (sourceId ? 'contacts_schools' : ''));
  setValue('contact_source_authority_id', contact.authority_id);
  setValue('contact_source_school_id', contact.school_id);
  setValue('contact_source_semel_mosad', contact.semel_mosad);
  setValue('contact_source_authority', contact.authority || contact.authority_name);
  setValue('contact_source_school', contact.school || contact.school_name);
  setValue('contact_source_name', contact.contact_name);
  setValue('contact_source_role', contact.contact_role);
  setValue('contact_source_mobile', contact.mobile);
  setValue('contact_source_email', contact.email);

  if (sourceTable && sourceTable !== 'contacts_schools') {
    sourceIdInput.value = '';
  } else if (!String(sourceIdInput.value || '').trim() && sourceId) {
    sourceIdInput.value = sourceId;
  }
}

function ensureContactSaveButton(form) {
  const fieldsBlock = form.querySelector('[data-pa-contact-channels-fields]');
  if (!fieldsBlock) return;

  hydrateContactSourceFromPicker(form);
  sanitizeContactSchoolSource(form);
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
  sanitizeContactSchoolSource(form);
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
  relocateProgramNotes(form);
  mergeGeneralNotesIntoDiscount(form);
  markActivitiesLayout(form);
  normalizeNextYearWorkshopRows(form);
  markSummaryLayout(form);
  markDuplicateEditorTotals(form);
  hydrateContactSourceFromPicker(form);
  sanitizeContactSchoolSource(form);
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

function addedEditorRoots(mutations = []) {
  const roots = new Set();
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]')) roots.add(node);
    });
  });
  return roots;
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
    const proposalSaveButton = event.target?.closest?.('[data-pa-save-draft], [data-pa-save-pending]');
    if (proposalSaveButton) {
      const form = proposalSaveButton.closest?.('[data-pa-form]');
      if (form) {
        hydrateContactSourceFromPicker(form);
        sanitizeContactSchoolSource(form);
      }
    }

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
    addedEditorRoots(mutations).forEach((root) => scheduleCompact(root));
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
  sanitizeContactSchoolSource,
  hydrateContactSourceFromPicker,
  ensureContactSaveButton,
  triggerContactSave,
  scheduleCompact,
  addedEditorRoots
};
