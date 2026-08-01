function proposalFormFromNode(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches?.('[data-pa-form]')) return node;
  return node.closest?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]') || null;
}

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function selectedRecipientType(form) {
  return cleanText(
    form.querySelector('input[name="client_type_selector"]:checked')?.value
    || form.querySelector('input[name="contact_source_client_type"]')?.value
    || 'school'
  );
}

function recipientSelectionReady(form) {
  const type = selectedRecipientType(form);
  const authorityId = cleanText(form.querySelector('input[name="contact_source_authority_id"]')?.value);
  const schoolId = cleanText(form.querySelector('input[name="contact_source_school_id"]')?.value);
  const otherName = cleanText(form.querySelector('[name="other_client_name"]')?.value);

  if (type === 'authority') return Boolean(authorityId);
  if (type === 'other') return Boolean(otherName);
  return Boolean(authorityId && schoolId);
}

function ensureRecipientLayoutStyles() {
  if (document.getElementById('proposal-recipient-clean-layout-style')) return;

  const style = document.createElement('style');
  style.id = 'proposal-recipient-clean-layout-style';
  style.textContent = `
    #app .pa-editor-workspace .ds-pa-form-meta-panel {
      overflow: visible !important;
      inline-size: auto !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] {
      display: grid !important;
      grid-template-columns: 150px 100px 250px auto !important;
      grid-template-rows: auto !important;
      align-items: end !important;
      justify-content: start !important;
      gap: 10px !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
      margin: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-flow-slot] {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: auto !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="client"] {
      display: contents !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row] {
      display: contents !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-wrap],
    #app .pa-editor-workspace [data-pa-school-search-panel],
    #app .pa-editor-workspace [data-pa-client-card],
    #app .pa-editor-workspace [data-pa-other-client-field],
    #app .pa-editor-workspace .ds-pa-client-locked,
    #app .pa-editor-workspace .ds-pa-client-locked-body,
    #app .pa-editor-workspace .ds-pa-client-locked-actions,
    #app .pa-editor-workspace .ds-pa-school-step-text,
    #app .pa-editor-workspace .ds-pa-client-search-field-wrap {
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      outline: 0 !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-wrap]:not([hidden]) {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: auto !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: auto !important;
      max-inline-size: 430px !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-wrap][hidden],
    #app .pa-editor-workspace [data-pa-client-card][hidden],
    #app .pa-editor-workspace [data-pa-school-search-panel][hidden],
    #app .pa-editor-workspace [data-pa-other-client-field][hidden],
    #app .pa-editor-workspace [data-pa-step-panel="contact"][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] {
      position: relative !important;
      inline-size: 240px !important;
      max-inline-size: 240px !important;
      padding: 0 !important;
      overflow: visible !important;
      z-index: 30 !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-client-search-field-wrap] input {
      inline-size: 240px !important;
      max-inline-size: 240px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-results],
    #app .pa-editor-workspace [data-pa-school-results] {
      position: absolute !important;
      inset-inline: 0 !important;
      inset-block-start: calc(100% + 4px) !important;
      z-index: 1000 !important;
      inline-size: 240px !important;
      max-inline-size: 240px !important;
      max-block-size: 240px !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      background: #fff !important;
      border: 1px solid var(--pa-editor-line, #dbe4ee) !important;
      border-radius: 9px !important;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16) !important;
    }

    #app .pa-editor-workspace [data-pa-client-results][hidden],
    #app .pa-editor-workspace [data-pa-school-results][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-school-step-text {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: center !important;
      gap: 5px !important;
      min-block-size: 36px !important;
      padding: 0 !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace .ds-pa-school-step-text > span,
    #app .pa-editor-workspace .ds-pa-school-step-text > strong {
      margin: 0 !important;
      padding: 0 !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace .ds-pa-school-step-text [data-pa-change-authority-step] {
      min-inline-size: max-content !important;
      block-size: 34px !important;
      margin: 0 3px 0 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-card]:not([hidden]) {
      display: inline-flex !important;
      align-items: flex-end !important;
      inline-size: auto !important;
      max-inline-size: 430px !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: auto !important;
      max-inline-size: 430px !important;
      min-block-size: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-body {
      display: contents !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked p {
      display: grid !important;
      grid-template-columns: max-content !important;
      gap: 2px !important;
      min-inline-size: 0 !important;
      max-inline-size: 155px !important;
      min-block-size: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked p > span,
    #app .pa-editor-workspace .ds-pa-client-locked p > strong {
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-type {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-detail {
      max-inline-size: 95px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-name {
      max-inline-size: 155px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-state {
      max-inline-size: 75px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-name,
    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-state {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-actions {
      display: inline-flex !important;
      align-items: flex-end !important;
      align-self: flex-end !important;
      padding: 0 !important;
    }

    #app .pa-editor-workspace .ds-pa-recipient-type-field {
      display: grid !important;
      gap: 3px !important;
      inline-size: 250px !important;
      max-inline-size: 250px !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type {
      grid-template-columns: repeat(3, 80px) !important;
      inline-size: 250px !important;
      max-inline-size: 250px !important;
      gap: 5px !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type-option {
      inline-size: 80px !important;
      min-inline-size: 80px !important;
    }

    #app .pa-editor-workspace [data-pa-other-client-field]:not([hidden]) {
      display: inline-flex !important;
      align-items: flex-end !important;
      gap: 8px !important;
      inline-size: auto !important;
      max-inline-size: 240px !important;
      padding: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-other-client-field] h5 {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="contact"]:not([hidden]) {
      display: grid !important;
      gap: 6px !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
      margin: 2px 0 0 !important;
      padding: 8px 0 0 !important;
      border: 0 !important;
      border-block-start: 1px solid var(--pa-editor-line, #dbe4ee) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    @media (max-width: 1180px) {
      #app .pa-editor-workspace [data-pa-recipient-meta-row] {
        grid-template-columns: 140px 90px 240px auto !important;
        gap: 8px !important;
      }

      #app .pa-editor-workspace [data-pa-recipient-flow-slot],
      #app .pa-editor-workspace [data-pa-client-search-wrap]:not([hidden]),
      #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]),
      #app .pa-editor-workspace [data-pa-client-card]:not([hidden]),
      #app .pa-editor-workspace .ds-pa-client-locked {
        max-inline-size: 400px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function setSearchLabels(form) {
  const authorityLabel = form.querySelector('[data-pa-client-search-label]');
  if (authorityLabel) authorityLabel.textContent = 'רשות';

  const schoolLabel = form.querySelector('[data-pa-school-search-field-wrap] label > span');
  if (schoolLabel) schoolLabel.textContent = 'בית ספר';

  const changeAuthorityButton = form.querySelector('[data-pa-change-authority-step]');
  if (changeAuthorityButton) changeAuthorityButton.textContent = 'שינוי';
}

function ensureFlowSlot(row) {
  let slot = row.querySelector(':scope > [data-pa-recipient-flow-slot]');
  if (slot) return slot;

  slot = document.createElement('div');
  slot.dataset.paRecipientFlowSlot = 'true';
  row.appendChild(slot);
  return slot;
}

function moveIntoSlot(slot, element) {
  if (element && element.parentElement !== slot) slot.appendChild(element);
}

function alignRecipientSearchRow(form) {
  if (!form?.querySelector('.pa-editor-workspace')) return;

  ensureRecipientLayoutStyles();

  const metaPanel = form.querySelector('.ds-pa-form-meta-panel');
  const row = form.querySelector('[data-pa-recipient-meta-row]');
  const recipientField = form.querySelector('.ds-pa-recipient-type-field');
  const recipientButtons = form.querySelector('.ds-pa-recipient-type');
  const searchWrap = form.querySelector('[data-pa-client-search-wrap]');
  const clientCard = form.querySelector('[data-pa-client-card]');
  const otherField = form.querySelector('[data-pa-other-client-field]');
  const schoolPanel = form.querySelector('[data-pa-school-search-panel]');
  const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
  if (!metaPanel || !row || !recipientField || !searchWrap) return;

  setSearchLabels(form);

  recipientField.hidden = false;
  recipientField.removeAttribute('hidden');
  recipientButtons?.removeAttribute('hidden');

  const slot = ensureFlowSlot(row);
  moveIntoSlot(slot, searchWrap);
  moveIntoSlot(slot, otherField);
  moveIntoSlot(slot, clientCard);

  const locked = Boolean(clientCard && !clientCard.hidden && clientCard.querySelector('.ds-pa-client-locked'));
  const type = selectedRecipientType(form);
  const schoolSearchOpen = Boolean(schoolPanel && !schoolPanel.hidden);

  searchWrap.hidden = locked;
  if (otherField) otherField.hidden = locked || type !== 'other';

  const stage = locked ? 'locked' : (schoolSearchOpen ? 'school-search' : 'authority-search');
  form.dataset.paRecipientLayoutStage = stage;
  form.dataset.paRecipientLayoutType = type;

  const lockedElement = clientCard?.querySelector('.ds-pa-client-locked');
  if (lockedElement) {
    const lockedType = cleanText(lockedElement.querySelector('.ds-pa-client-locked-type strong')?.textContent);
    lockedElement.classList.toggle('is-authority', lockedType === 'רשות');
    lockedElement.classList.toggle('is-school', lockedType === 'בית ספר');
    lockedElement.classList.toggle('is-other', lockedType === 'אחר');
  }

  const ready = recipientSelectionReady(form) || locked;
  form.classList.toggle('has-recipient-selection', ready);
  if (contactPanel) {
    contactPanel.hidden = !ready;
    contactPanel.setAttribute('aria-hidden', String(!ready));
  }
}

function alignAllRecipientSearchRows(root = document) {
  const directForm = proposalFormFromNode(root);
  if (directForm) alignRecipientSearchRow(directForm);
  root.querySelectorAll?.('[data-pa-form]').forEach(alignRecipientSearchRow);
}

let queued = false;
let pendingRoot = null;
let recipientObserver = null;

function scheduleRecipientSearchAlignment(root = document) {
  pendingRoot = root || document;
  if (queued) return;
  queued = true;

  const run = () => {
    const target = pendingRoot || document;
    pendingRoot = null;
    queued = false;
    alignAllRecipientSearchRows(target);
    recipientObserver?.takeRecords();
  };

  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => requestAnimationFrame(run));
  } else {
    setTimeout(run, 0);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleRecipientSearchAlignment(document), { once: true });
  } else {
    scheduleRecipientSearchAlignment(document);
  }

  document.addEventListener('change', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) scheduleRecipientSearchAlignment(form);
  });

  document.addEventListener('input', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) scheduleRecipientSearchAlignment(form);
  });

  document.addEventListener('click', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (!form) return;
    setTimeout(() => scheduleRecipientSearchAlignment(form), 0);
    setTimeout(() => scheduleRecipientSearchAlignment(form), 80);
  });

  const app = document.getElementById('app') || document.documentElement;
  recipientObserver = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === 'childList')) {
      scheduleRecipientSearchAlignment(app);
    }
  });
  recipientObserver.observe(app, { childList: true, subtree: true });
}

export {
  selectedRecipientType,
  recipientSelectionReady,
  ensureRecipientLayoutStyles,
  alignRecipientSearchRow,
  scheduleRecipientSearchAlignment
};
