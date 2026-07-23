import './styles/birthday-popup-overlay-fix.css';

const PREVIEW_QUERY_PARAM = 'birthday_preview';
const POPUP_ROOT_SELECTOR = '[data-birthday-popup-root]';
const DISMISS_GUARD_MS = 3000;

let suppressUntil = 0;
let suppressedDialogLabel = '';

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

function removeSuppressedDuplicate(root) {
  if (Date.now() > suppressUntil || !suppressedDialogLabel) return;
  const popup = root?.matches?.(POPUP_ROOT_SELECTOR)
    ? root
    : root?.querySelector?.(POPUP_ROOT_SELECTOR);
  if (!popup || dialogLabelFromPopup(popup) !== suppressedDialogLabel) return;
  popup.remove();
  document.body.classList.remove('birthday-popup-open');
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('.birthday-popup-confirm');
  const popup = button?.closest?.(POPUP_ROOT_SELECTOR);
  if (!button || !popup) return;

  // Remember the exact greeting that was approved. If an already queued auth
  // or focus check mounts the same greeting again, remove only that duplicate.
  // A different employee on the same date is still allowed to appear.
  suppressedDialogLabel = dialogLabelFromPopup(popup);
  suppressUntil = Date.now() + DISMISS_GUARD_MS;

  if (hasBirthdayPreviewParam()) {
    // Clear the preview parameter before the original handler runs so a queued
    // preview check cannot use it again.
    clearBirthdayPreviewParam();
  }
}, true);

new MutationObserver((mutations) => {
  if (Date.now() > suppressUntil) return;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) removeSuppressedDuplicate(node);
    });
  });
}).observe(document.documentElement, {
  childList: true,
  subtree: true
});
