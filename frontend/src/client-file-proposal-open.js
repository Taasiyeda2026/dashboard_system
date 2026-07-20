function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeStatus(value) {
  const raw = text(value).toLowerCase().replace(/\s+/g, '_');
  return raw === 'sent' || raw === 'delivered' ? 'sent' : raw;
}

function cssEscape(value) {
  if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
  return String(value).replace(/["\\]/g, '\\$&');
}

function hideNativeClientWorkspace(shell) {
  shell?.querySelectorAll('[data-pa-client-workspace]').forEach((node) => {
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
  });
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-cf-open-proposal]');
  if (!trigger) return;
  const shell = trigger.closest('[data-client-file-shell]');
  if (!shell) return;
  // Let the overlay handler own PDF-only buttons and richer open flow when present.
  if (event.target.closest('[data-cf-open-pdf]')) return;

  const id = text(trigger.dataset.cfOpenProposal);
  const proposal = (Array.isArray(shell._cfData?.rows) ? shell._cfData.rows : []).find((row) => text(row?.id) === id);
  if (!proposal) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const clientKeyHint = text(trigger.dataset.cfClientKey);
  if (clientKeyHint) shell._cfActiveClientKey = clientKeyHint;

  const legacy = shell.querySelector('[data-client-file-legacy]');
  const content = shell.querySelector('[data-cf-content]');
  const statusBar = shell.querySelector('[data-cf-workspace-status]');
  if (legacy) legacy.hidden = false;
  hideNativeClientWorkspace(shell);
  if (content) content.hidden = true;
  if (statusBar) {
    statusBar.hidden = false;
    const title = statusBar.querySelector('strong');
    if (title) title.textContent = proposal.quote_number ? `הצעה ${proposal.quote_number}` : 'הצעת מחיר';
  }
  shell.classList.add('is-legacy-open');

  const tabName = normalizeStatus(proposal.status) === 'sent' ? 'sent' : 'records';
  legacy?.querySelector(`[data-pa-tab="${tabName}"]`)?.click();

  window.setTimeout(() => {
    const row = legacy?.querySelector(`[data-pa-row-id="${cssEscape(id)}"]`);
    if (row) {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      row.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  }, 120);
}, true);
