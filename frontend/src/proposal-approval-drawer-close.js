const APPROVAL_SELECTOR = '[data-pa-status-action="approved"][data-pa-action-id]';
const PREVIEW_SELECTOR = '[data-pa-preview]';
const ACTION_SELECTOR = `${PREVIEW_SELECTOR}, ${APPROVAL_SELECTOR}`;
const DETAIL_SELECTOR = '[data-pa-proposal-detail]';
const OVERLAY_SELECTOR = '#pa-preview-overlay';
const OPEN_TIMEOUT_MS = 16000;

function captureDisplayState(detail) {
  return {
    display: detail.style.getPropertyValue('display'),
    displayPriority: detail.style.getPropertyPriority('display'),
    hadAriaHidden: detail.hasAttribute('aria-hidden'),
    ariaHidden: detail.getAttribute('aria-hidden')
  };
}

export function suspendProposalDetails(detail) {
  if (!detail?.style || detail.dataset.paDocumentOverlaySuspended === 'true') return null;
  const previous = captureDisplayState(detail);
  detail.dataset.paDocumentOverlaySuspended = 'true';
  detail.style.setProperty('display', 'none', 'important');
  detail.setAttribute('aria-hidden', 'true');
  return { detail, previous };
}

export function restoreProposalDetails(session) {
  const detail = session?.detail;
  const previous = session?.previous;
  if (!detail || !previous || !detail.isConnected) return false;

  if (previous.display) {
    detail.style.setProperty('display', previous.display, previous.displayPriority || '');
  } else {
    detail.style.removeProperty('display');
  }

  if (previous.hadAriaHidden) detail.setAttribute('aria-hidden', previous.ariaHidden ?? '');
  else detail.removeAttribute('aria-hidden');
  delete detail.dataset.paDocumentOverlaySuspended;
  return true;
}

export function closeOpenProposalDetails(documentRef = globalThis.document) {
  const detail = documentRef?.querySelector?.(DETAIL_SELECTOR);
  if (!detail) return false;
  const closeButton = detail.querySelector('[data-pa-close-drawer]');
  if (closeButton) closeButton.click();
  if (detail.isConnected) detail.remove();
  return true;
}

function watchDocumentOverlay(scope, detail) {
  const documentRef = scope?.document;
  const MutationObserverCtor = scope?.MutationObserver;
  if (!documentRef?.documentElement || typeof MutationObserverCtor !== 'function') return false;

  let overlaySeen = false;
  let suspendedSession = null;
  let openTimer = null;
  let observer = null;

  const finish = () => {
    observer?.disconnect();
    observer = null;
    if (openTimer != null && typeof scope.clearTimeout === 'function') scope.clearTimeout(openTimer);
    openTimer = null;
    if (suspendedSession) restoreProposalDetails(suspendedSession);
    suspendedSession = null;
  };

  const sync = () => {
    const overlay = documentRef.querySelector(OVERLAY_SELECTOR);
    if (overlay) {
      overlaySeen = true;
      if (!suspendedSession && detail.isConnected) suspendedSession = suspendProposalDetails(detail);
      return;
    }
    if (overlaySeen) finish();
  };

  observer = new MutationObserverCtor(sync);
  observer.observe(documentRef.documentElement, { childList: true, subtree: true });

  if (typeof scope.setTimeout === 'function') {
    openTimer = scope.setTimeout(() => {
      if (!overlaySeen) finish();
    }, OPEN_TIMEOUT_MS);
  }

  if (typeof scope.queueMicrotask === 'function') scope.queueMicrotask(sync);
  else Promise.resolve().then(sync);
  return true;
}

export function installProposalApprovalDrawerClose(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef.__proposalApprovalDrawerCloseInstalled) return false;
  documentRef.__proposalApprovalDrawerCloseInstalled = true;

  documentRef.addEventListener('click', (event) => {
    const action = event.target?.closest?.(ACTION_SELECTOR);
    if (!action) return;
    const detail = action.closest?.(DETAIL_SELECTOR);
    if (!detail) return;

    // Do not swallow the original action. The regular preview/signature handler
    // still opens #pa-preview-overlay; once it appears, temporarily hide the
    // drawer so the document is the only visible layer. When the overlay closes
    // or signature is cancelled, the exact same drawer is restored in-place.
    watchDocumentOverlay(scope, detail);
  }, true);
  return true;
}

installProposalApprovalDrawerClose(globalThis);
