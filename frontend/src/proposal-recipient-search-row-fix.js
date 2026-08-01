function proposalFormFromNode(node) {
  if (!(node instanceof Element)) return null;
  if (node.matches?.('[data-pa-form]')) return node;
  return node.closest?.('[data-pa-form]') || node.querySelector?.('[data-pa-form]') || null;
}

function alignRecipientSearchRow(form) {
  if (!form?.querySelector('.pa-editor-workspace')) return;

  const row = form.querySelector('[data-pa-recipient-meta-row]');
  const searchBlock = form.querySelector('[data-pa-client-search-row]');
  if (!row || !searchBlock) return;

  if (searchBlock.parentElement !== row) row.appendChild(searchBlock);

  row.style.setProperty('display', 'grid', 'important');
  row.style.setProperty('grid-template-columns', '160px 120px max-content 300px', 'important');
  row.style.setProperty('grid-template-rows', 'auto', 'important');
  row.style.setProperty('align-items', 'end', 'important');
  row.style.setProperty('justify-content', 'start', 'important');
  row.style.setProperty('gap', '10px', 'important');
  row.style.setProperty('inline-size', 'max-content', 'important');
  row.style.setProperty('max-inline-size', '100%', 'important');
  row.style.setProperty('margin', '0', 'important');

  searchBlock.classList.add('is-recipient-search-in-meta-row');
  searchBlock.style.setProperty('grid-column', '4', 'important');
  searchBlock.style.setProperty('grid-row', '1', 'important');
  searchBlock.style.setProperty('display', searchBlock.hidden ? 'none' : 'grid', 'important');
  searchBlock.style.setProperty('grid-template-columns', '300px', 'important');
  searchBlock.style.setProperty('align-items', 'end', 'important');
  searchBlock.style.setProperty('justify-content', 'start', 'important');
  searchBlock.style.setProperty('inline-size', '300px', 'important');
  searchBlock.style.setProperty('max-inline-size', '300px', 'important');
  searchBlock.style.setProperty('gap', '4px', 'important');
  searchBlock.style.setProperty('margin', '0', 'important');

  searchBlock.querySelectorAll('.ds-pa-client-search, .ds-pa-client-search-field-wrap').forEach((element) => {
    element.style.setProperty('inline-size', '300px', 'important');
    element.style.setProperty('max-inline-size', '300px', 'important');
    element.style.setProperty('margin', '0', 'important');
  });
}

function alignAllRecipientSearchRows(root = document) {
  const directForm = proposalFormFromNode(root);
  if (directForm) alignRecipientSearchRow(directForm);
  root.querySelectorAll?.('[data-pa-form]').forEach(alignRecipientSearchRow);
}

let queued = false;
let pendingRoot = null;

function scheduleRecipientSearchAlignment(root = document) {
  pendingRoot = root || document;
  if (queued) return;
  queued = true;

  const run = () => {
    const target = pendingRoot || document;
    pendingRoot = null;
    queued = false;
    alignAllRecipientSearchRows(target);
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

  document.addEventListener('click', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form) scheduleRecipientSearchAlignment(form);
  });

  const app = document.getElementById('app') || document.documentElement;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.type === 'childList')) {
      scheduleRecipientSearchAlignment(app);
    }
  });
  observer.observe(app, { childList: true, subtree: true });
}

export { alignRecipientSearchRow, scheduleRecipientSearchAlignment };
