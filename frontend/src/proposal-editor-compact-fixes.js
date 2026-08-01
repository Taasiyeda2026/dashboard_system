function editorFormFromNode(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches?.('[data-pa-form]')) return node;
  return node.closest?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]') || null;
}

function markRecipientMode(form) {
  const locked = form.querySelector('.ds-pa-client-locked');
  if (!locked) return;
  const type = String(locked.querySelector('.ds-pa-client-locked-type strong')?.textContent || '').trim();
  locked.classList.toggle('is-authority', type === 'רשות');
  locked.classList.toggle('is-school', type === 'בית ספר');
  locked.classList.toggle('is-other', type === 'אחר');
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
  markSummaryLayout(form);
  markDuplicateEditorTotals(form);
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
    const typeButton = event.target?.closest?.('[data-pa-type-btn]');
    const form = typeButton?.closest?.('[data-pa-form]');
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
  markRecipientMode,
  relocateProgramNotes,
  mergeGeneralNotesIntoDiscount,
  restoreLegacyMovedNodes,
  markActivitiesLayout,
  markSummaryLayout,
  markDuplicateEditorTotals,
  scheduleCompact
};
