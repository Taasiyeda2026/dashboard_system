const EDITOR_SELECTOR = '#app .pa-editor-workspace [data-pa-form], #app [data-pa-form] .pa-editor-workspace';

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
  notesDetails.hidden = true;
}

function markProposalType(form) {
  const type = String(form.querySelector('[name="activity_type_group"]')?.value || '').trim();
  if (type) form.dataset.paCompactProposalType = type;
  else delete form.dataset.paCompactProposalType;
}

function compactEditor(form) {
  if (!form || !form.querySelector('.pa-editor-workspace')) return;
  markRecipientMode(form);
  relocateProgramNotes(form);
  mergeGeneralNotesIntoDiscount(form);
  markProposalType(form);
  form.dataset.paCompactLayoutApplied = 'true';
}

function compactAll(root = document) {
  const direct = editorFormFromNode(root);
  if (direct) compactEditor(direct);
  root.querySelectorAll?.('[data-pa-form]').forEach(compactEditor);
}

let queued = false;
function scheduleCompact(root = document) {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    compactAll(root);
  });
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
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) setTimeout(() => scheduleCompact(form), 0);
  });

  const app = document.getElementById('app') || document.documentElement;
  new MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) =>
      mutation.type === 'childList'
      || mutation.attributeName === 'hidden'
      || mutation.attributeName === 'open'
      || mutation.attributeName === 'value');
    if (relevant) scheduleCompact(app);
  }).observe(app, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'open', 'value']
  });
}

export { compactEditor, markRecipientMode, relocateProgramNotes, mergeGeneralNotesIntoDiscount };
