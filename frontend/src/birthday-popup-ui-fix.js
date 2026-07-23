import './styles/birthday-popup-overlay-fix.css';

const PREVIEW_QUERY_PARAM = 'birthday_preview';
const POPUP_ROOT_SELECTOR = '[data-birthday-popup-root]';
const PREVIEW_DISMISS_GUARD_MS = 3000;

let suppressPreviewUntil = 0;

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

function removeSuppressedPreview(root) {
  if (Date.now() > suppressPreviewUntil) return;
  const popup = root?.matches?.(POPUP_ROOT_SELECTOR)
    ? root
    : root?.querySelector?.(POPUP_ROOT_SELECTOR);
  if (!popup) return;
  popup.remove();
  document.body.classList.remove('birthday-popup-open');
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.('.birthday-popup-confirm');
  if (!button || !button.closest(POPUP_ROOT_SELECTOR) || !hasBirthdayPreviewParam()) return;

  // Clear the preview parameter before the original click handler runs. This
  // prevents an auth/focus check that is already queued from mounting it again.
  suppressPreviewUntil = Date.now() + PREVIEW_DISMISS_GUARD_MS;
  clearBirthdayPreviewParam();
}, true);

new MutationObserver((mutations) => {
  if (Date.now() > suppressPreviewUntil) return;
  mutations.forEach((mutation) => {
    mutation.addedNodes.forEach((node) => {
      if (node instanceof Element) removeSuppressedPreview(node);
    });
  });
}).observe(document.documentElement, {
  childList: true,
  subtree: true
});
