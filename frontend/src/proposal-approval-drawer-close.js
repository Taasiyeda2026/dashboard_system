const ACTION_SELECTOR = '[data-pa-status-action="approved"][data-pa-action-id]';

export function closeOpenProposalDetails(documentRef = globalThis.document) {
  const detail = documentRef?.querySelector?.('[data-pa-proposal-detail]');
  if (!detail) return false;
  const closeButton = detail.querySelector('[data-pa-close-drawer]');
  if (closeButton) closeButton.click();
  if (detail.isConnected) detail.remove();
  return true;
}

export function installProposalApprovalDrawerClose(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef.__proposalApprovalDrawerCloseInstalled) return false;
  documentRef.__proposalApprovalDrawerCloseInstalled = true;
  documentRef.addEventListener('click', (event) => {
    if (!event.target?.closest?.(ACTION_SELECTOR)) return;
    const closeDetails = () => closeOpenProposalDetails(documentRef);
    if (typeof scope.queueMicrotask === 'function') scope.queueMicrotask(closeDetails);
    else Promise.resolve().then(closeDetails);
  }, true);
  return true;
}

installProposalApprovalDrawerClose(globalThis);
