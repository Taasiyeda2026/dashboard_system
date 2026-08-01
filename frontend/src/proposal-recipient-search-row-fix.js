/**
 * Retired layout injector.
 * Recipient row structure is owned by proposals-agreements.js HTML
 * and proposal-editor-compact-fixes.css. Kept as a no-op import so
 * existing cache-busted config imports continue to resolve.
 */
function ensureRecipientFinalLayoutStyles() {
  if (typeof document === 'undefined') return;
  const stale = document.getElementById('proposal-recipient-final-layout-style');
  if (stale) stale.remove();
}

ensureRecipientFinalLayoutStyles();

export { ensureRecipientFinalLayoutStyles };
