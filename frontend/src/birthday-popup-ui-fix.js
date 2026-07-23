import './styles/birthday-popup-overlay-fix.css';

const PREVIEW_QUERY_PARAM = 'birthday_preview';
const POPUP_ROOT_SELECTOR = '[data-birthday-popup-root]';
const DISMISS_GUARD_MS = 30_000;

let suppressUntil = 0;
let suppressedDialogLabel = '';
let approvedPopup = null;

function hasBirthdayPreviewParam() {
  try {
    return new URL(window.location.href).searchParams.has(PREVIEW_QUERY_PARAM);
  } catch {
    return false;
  }
}

function clearBirthdayPreviewParam() {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete(PREVIEW_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Ignore malformed URLs.
  }
}

function dialogLabelFromPopup(popup) {
  return String(popup?.querySelector?.('.birthday-popup-card')?.getAttribute('aria-label') || '').trim();
}

function syncBirthdayPopupBodyState() {
  if (!document.querySelector(POPUP_ROOT_SELECTOR)) {
    document.body.classList.remove('birthday-popup-open');
  }
}

function isSuppressedPopup(popup) {
  return Boolean(
    popup &&
    Date.now() <= suppressUntil &&
    suppressedDialogLabel &&
    dialogLabelFromPopup(popup) === suppressedDialogLabel
  );
}

function removeSuppressedDuplicate(root) {
  if (Date.now() > suppressUntil || !suppressedDialogLabel) return;
  const popup = root?.matches?.(POPUP_ROOT_SELECTOR)
    ? root
    : root?.querySelector?.(POPUP_ROOT_SELECTOR);

  if (!isSuppressedPopup(popup)) return;
  if (popup === approvedPopup && approvedPopup?.isConnected) return;

  popup.remove();
  syncBirthdayPopupBodyState();
}

function removeExistingStackedCopies(keepPopup) {
  document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach((popup) => {
    if (popup !== keepPopup && isSuppressedPopup(popup)) popup.remove();
  });
  syncBirthdayPopupBodyState();
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('.birthday-popup-confirm');
  const popup = button?.closest?.(POPUP_ROOT_SELECTOR);
  if (!button || !popup) return;

  // Two checks can finish almost together and leave two identical overlays stacked.
  // Keep only the overlay that was actually clicked, then block any identical copy
  // that is mounted while the acknowledgement is being saved.
  approvedPopup = popup;
  suppressedDialogLabel = dialogLabelFromPopup(popup);
  suppressUntil = Date.now() + DISMISS_GUARD_MS;
  removeExistingStackedCopies(popup);

  if (hasBirthdayPreviewParam()) {
    // Clear the preview parameter before the original click handler runs so a queued
    // preview check cannot use it again.
    clearBirthdayPreviewParam();
  }

  window.setTimeout(() => {
    if (!approvedPopup?.isConnected) approvedPopup = null;
    document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach((candidate) => {
      removeSuppressedDuplicate(candidate);
    });
  }, 0);
}, true);

new MutationObserver((mutations) => {
  if (Date.now() > suppressUntil) return;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) removeSuppressedDuplicate(node);
    });
  });

  if (approvedPopup && !approvedPopup.isConnected) approvedPopup = null;
}).observe(document.documentElement, {
  childList: true,
  subtree: true
});
