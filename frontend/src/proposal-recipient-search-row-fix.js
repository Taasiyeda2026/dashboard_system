function proposalFormFromNode(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches?.('[data-pa-form]')) return node;
  return node.closest?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]') || null;
}

function text(value) {
  return String(value == null ? '' : value).trim();
}

function selectedRecipientType(form) {
  return text(
    form.querySelector('input[name="client_type_selector"]:checked')?.value
    || form.querySelector('input[name="contact_source_client_type"]')?.value
    || 'school'
  );
}

function recipientSelectionReady(form) {
  const type = selectedRecipientType(form);
  const authorityId = text(form.querySelector('input[name="contact_source_authority_id"]')?.value);
  const schoolId = text(form.querySelector('input[name="contact_source_school_id"]')?.value);
  const otherName = text(form.querySelector('[name="other_client_name"]')?.value);

  if (type === 'authority') return Boolean(authorityId);
  if (type === 'other') return Boolean(authorityId && otherName);
  return Boolean(authorityId && schoolId);
}

function setImportant(element, property, value) {
  if (!element?.style) return;
  if (
    element.style.getPropertyValue(property) === value
    && element.style.getPropertyPriority(property) === 'important'
  ) return;
  element.style.setProperty(property, value, 'important');
}

function ensureRecipientSingleBoxStyles() {
  if (document.getElementById('proposal-recipient-single-box-style')) return;

  const style = document.createElement('style');
  style.id = 'proposal-recipient-single-box-style';
  style.textContent = `
    #app .pa-editor-workspace .ds-pa-form-meta-panel {
      display: grid !important;
      grid-template-columns: max-content !important;
      justify-content: start !important;
      align-items: start !important;
      inline-size: fit-content !important;
      max-inline-size: 100% !important;
      min-block-size: 0 !important;
      gap: 7px !important;
      overflow-x: auto !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] {
      display: grid !important;
      grid-template-columns: 160px 120px max-content max-content !important;
      grid-template-rows: auto !important;
      align-items: end !important;
      justify-content: start !important;
      gap: 10px !important;
      inline-size: max-content !important;
      max-inline-size: none !important;
      min-block-size: 0 !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-step-panel="client"] {
      display: contents !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row],
    #app .pa-editor-workspace [data-pa-client-search-wrap],
    #app .pa-editor-workspace [data-pa-school-search-panel],
    #app .pa-editor-workspace [data-pa-client-card],
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
      padding: 0 !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row]:not([hidden]) {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: max-content !important;
      max-inline-size: none !important;
      min-block-size: 0 !important;
      grid-column: 4 !important;
      grid-row: 1 !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-wrap]:not([hidden]) {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: max-content !important;
      max-inline-size: none !important;
      min-block-size: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-row][hidden],
    #app .pa-editor-workspace [data-pa-client-card][hidden],
    #app .pa-editor-workspace [data-pa-school-search-panel][hidden],
    #app .pa-editor-workspace [data-pa-step-panel="contact"][hidden] {
      display: none !important;
    }

    #app .pa-editor-workspace [data-pa-school-search-panel]:not([hidden]) {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: max-content !important;
      max-inline-size: none !important;
    }

    #app .pa-editor-workspace .ds-pa-school-step-text {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: center !important;
      gap: 5px !important;
      min-block-size: 34px !important;
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
      inline-size: max-content !important;
      max-inline-size: none !important;
      grid-column: 4 !important;
      grid-row: 1 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked {
      display: inline-flex !important;
      flex-flow: row nowrap !important;
      align-items: flex-end !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      inline-size: max-content !important;
      max-inline-size: none !important;
      min-block-size: 0 !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-body {
      display: contents !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked p {
      display: grid !important;
      grid-template-columns: max-content !important;
      gap: 2px !important;
      min-inline-size: 0 !important;
      max-inline-size: 180px !important;
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
      max-inline-size: 110px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-name {
      max-inline-size: 180px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-state {
      max-inline-size: 86px !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-name,
    #app .pa-editor-workspace .ds-pa-client-locked.is-authority .ds-pa-client-locked-state {
      display: none !important;
    }

    #app .pa-editor-workspace .ds-pa-client-locked-actions {
      display: inline-flex !important;
      align-items: flex-end !important;
      align-self: flex-end !important;
    }

    #app .pa-editor-workspace .ds-pa-recipient-type-field {
      display: grid !important;
      gap: 3px !important;
      inline-size: max-content !important;
      margin: 0 !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type {
      grid-template-columns: repeat(3, 84px) !important;
      inline-size: max-content !important;
      gap: 5px !important;
    }

    #app .pa-editor-workspace [data-pa-recipient-meta-row] .ds-pa-recipient-type-option {
      inline-size: 84px !important;
      min-inline-size: 84px !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] {
      inline-size: 230px !important;
      max-inline-size: 230px !important;
    }

    #app .pa-editor-workspace [data-pa-client-search-field-wrap] > label,
    #app .pa-editor-workspace [data-pa-client-search-field-wrap] input {
      inline-size: 230px !important;
      max-inline-size: 230px !important;
      margin: 0 !important;
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

    #app .pa-editor-workspace [data-pa-step-panel="contact"] > .ds-pa-form-grid,
    #app .pa-editor-workspace [data-pa-step-panel="contact"] .ds-pa-contact-channels,
    #app .pa-editor-workspace [data-pa-step-panel="contact"] .ds-pa-contact-channels-fields {
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
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

function enforceRecipientRowStyles(row, searchBlock, clientCard) {
  setImportant(row, 'display', 'grid');
  setImportant(row, 'grid-template-columns', '160px 120px max-content max-content');
  setImportant(row, 'grid-template-rows', 'auto');
  setImportant(row, 'align-items', 'end');
  setImportant(row, 'justify-content', 'start');
  setImportant(row, 'gap', '10px');
  setImportant(row, 'inline-size', 'max-content');
  setImportant(row, 'max-inline-size', 'none');
  setImportant(row, 'margin', '0');

  setImportant(searchBlock, 'grid-column', '4');
  setImportant(searchBlock, 'grid-row', '1');
  setImportant(searchBlock, 'display', searchBlock.hidden ? 'none' : 'inline-flex');
  setImportant(searchBlock, 'flex-flow', 'row nowrap');
  setImportant(searchBlock, 'align-items', 'end');
  setImportant(searchBlock, 'justify-content', 'start');
  setImportant(searchBlock, 'gap', '8px');
  setImportant(searchBlock, 'inline-size', 'max-content');
  setImportant(searchBlock, 'max-inline-size', 'none');
  setImportant(searchBlock, 'margin', '0');

  if (clientCard) {
    setImportant(clientCard, 'grid-column', '4');
    setImportant(clientCard, 'grid-row', '1');
    setImportant(clientCard, 'display', clientCard.hidden ? 'none' : 'inline-flex');
    setImportant(clientCard, 'align-items', 'end');
    setImportant(clientCard, 'inline-size', 'max-content');
    setImportant(clientCard, 'max-inline-size', 'none');
    setImportant(clientCard, 'margin', '0');
  }
}

function alignRecipientSearchRow(form) {
  if (!form?.querySelector('.pa-editor-workspace')) return;

  ensureRecipientSingleBoxStyles();

  const metaPanel = form.querySelector('.ds-pa-form-meta-panel');
  const row = form.querySelector('[data-pa-recipient-meta-row]');
  const searchBlock = form.querySelector('[data-pa-client-search-row]');
  const clientCard = form.querySelector('[data-pa-client-card]');
  const recipientField = form.querySelector('.ds-pa-recipient-type-field');
  const recipientButtons = form.querySelector('.ds-pa-recipient-type');
  const contactPanel = form.querySelector('[data-pa-step-panel="contact"]');
  const schoolPanel = form.querySelector('[data-pa-school-search-panel]');
  if (!metaPanel || !row || !searchBlock || !recipientField) return;

  setSearchLabels(form);

  recipientField.hidden = false;
  recipientField.removeAttribute('hidden');
  if (recipientButtons) {
    recipientButtons.hidden = false;
    recipientButtons.removeAttribute('hidden');
  }

  if (searchBlock.parentElement !== row) row.appendChild(searchBlock);
  if (clientCard && clientCard.parentElement !== row) row.appendChild(clientCard);

  row.classList.add('ds-pa-recipient-single-line');
  searchBlock.classList.add('is-recipient-search-in-meta-row');
  enforceRecipientRowStyles(row, searchBlock, clientCard);

  const locked = Boolean(clientCard && !clientCard.hidden && clientCard.querySelector('.ds-pa-client-locked'));
  const schoolSearchOpen = Boolean(schoolPanel && !schoolPanel.hidden);
  const stage = locked ? 'locked' : (schoolSearchOpen ? 'school-search' : 'authority-search');
  form.dataset.paRecipientLayoutStage = stage;
  form.dataset.paRecipientLayoutType = selectedRecipientType(form);

  const lockedElement = clientCard?.querySelector('.ds-pa-client-locked');
  if (lockedElement) {
    const lockedType = text(lockedElement.querySelector('.ds-pa-client-locked-type strong')?.textContent);
    lockedElement.classList.toggle('is-authority', lockedType === 'רשות');
    lockedElement.classList.toggle('is-school', lockedType === 'בית ספר');
    lockedElement.classList.toggle('is-other', lockedType === 'אחר');
  }

  const ready = recipientSelectionReady(form);
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
    requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(run)));
  } else {
    setTimeout(run, 0);
  }
}

function mutationNeedsRecipientAlignment(mutation) {
  if (mutation.type === 'childList') return true;
  const target = mutation.target;
  return target instanceof Element && target.matches(
    '[data-pa-recipient-meta-row], [data-pa-client-search-row], [data-pa-client-card], '
    + '.ds-pa-recipient-type-field, [data-pa-school-search-panel]'
  );
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
    if (form && event.target?.matches?.('[name="other_client_name"]')) {
      scheduleRecipientSearchAlignment(form);
    }
  });

  document.addEventListener('click', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) setTimeout(() => scheduleRecipientSearchAlignment(form), 0);
  });

  const app = document.getElementById('app') || document.documentElement;
  recipientObserver = new MutationObserver((mutations) => {
    if (!mutations.some(mutationNeedsRecipientAlignment)) return;
    const relevantTarget = mutations.find(mutationNeedsRecipientAlignment)?.target;
    const form = relevantTarget instanceof Element ? relevantTarget.closest('[data-pa-form]') : null;
    scheduleRecipientSearchAlignment(form || app);
  });
  recipientObserver.observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'hidden', 'class']
  });
}

export {
  selectedRecipientType,
  recipientSelectionReady,
  ensureRecipientSingleBoxStyles,
  enforceRecipientRowStyles,
  alignRecipientSearchRow,
  scheduleRecipientSearchAlignment
};
