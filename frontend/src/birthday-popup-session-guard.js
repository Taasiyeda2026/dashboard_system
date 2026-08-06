const POPUP_ROOT_SELECTOR = '[data-birthday-popup-root]';
const CONFIRM_SELECTOR = '.birthday-popup-confirm';
const ERROR_SELECTOR = '.birthday-popup-error';
const PREVIEW_QUERY_PARAM = 'birthday_preview';
const STORAGE_PREFIX = 'birthday-popup-dismissed:';

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function greetingKeyFromPopup(popup) {
  return String(popup?.dataset?.birthdayGreetingKey || '').trim();
}

function storageKey(greetingKey) {
  return `${STORAGE_PREFIX}${greetingKey}`;
}

function isDismissed(greetingKey) {
  if (!greetingKey) return false;
  try {
    return storage()?.getItem(storageKey(greetingKey)) === '1';
  } catch {
    return false;
  }
}

function markDismissed(greetingKey) {
  if (!greetingKey) return;
  try {
    storage()?.setItem(storageKey(greetingKey), '1');
  } catch {
    // sessionStorage may be unavailable in restricted browser modes.
  }

  const runtimeKeys = globalThis.__BIRTHDAY_POPUP_DISMISSED_KEYS__;
  if (runtimeKeys instanceof Set) runtimeKeys.add(greetingKey);
}

function clearDismissed(greetingKey) {
  if (!greetingKey) return;
  try {
    storage()?.removeItem(storageKey(greetingKey));
  } catch {
    // Ignore storage failures.
  }

  const runtimeKeys = globalThis.__BIRTHDAY_POPUP_DISMISSED_KEYS__;
  if (runtimeKeys instanceof Set) runtimeKeys.delete(greetingKey);
}

function syncBodyState() {
  if (!document.querySelector(POPUP_ROOT_SELECTOR)) {
    document.body.classList.remove('birthday-popup-open');
  }
}

function removePopup(popup) {
  if (!popup?.isConnected) return;
  popup.remove();
  syncBodyState();
}

function removeStoredPopup(popup) {
  const greetingKey = greetingKeyFromPopup(popup);
  if (isDismissed(greetingKey)) removePopup(popup);
}

function inspectAddedNode(node) {
  if (!(node instanceof Element)) return;

  if (node.matches(POPUP_ROOT_SELECTOR)) removeStoredPopup(node);
  node.querySelectorAll?.(POPUP_ROOT_SELECTOR).forEach(removeStoredPopup);
}

function clearPreviewParam() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PREVIEW_QUERY_PARAM)) return;
    url.searchParams.delete(PREVIEW_QUERY_PARAM);
    window.history.replaceState(window.history.state, '', url);
  } catch {
    // Ignore malformed URLs.
  }
}

function removeStackedCopies(clickedPopup, greetingKey) {
  document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach((popup) => {
    if (popup !== clickedPopup && greetingKeyFromPopup(popup) === greetingKey) {
      removePopup(popup);
    }
  });
}

document.addEventListener('click', (event) => {
  const button = event.target?.closest?.(CONFIRM_SELECTOR);
  const popup = button?.closest?.(POPUP_ROOT_SELECTOR);
  if (!button || !popup) return;

  const greetingKey = greetingKeyFromPopup(popup);
  if (!greetingKey) return;

  // Persist before the original async handler starts. This survives automatic
  // page reloads in the same tab and prevents the same greeting from returning.
  markDismissed(greetingKey);
  removeStackedCopies(popup, greetingKey);
  clearPreviewParam();
}, true);

const observer = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.type === 'childList') {
      mutation.addedNodes.forEach(inspectAddedNode);
      return;
    }

    if (
      mutation.type === 'attributes' &&
      mutation.attributeName === 'hidden' &&
      mutation.target instanceof Element &&
      mutation.target.matches(ERROR_SELECTOR) &&
      !mutation.target.hidden
    ) {
      // Saving failed. Allow the user to approve the greeting again.
      const popup = mutation.target.closest(POPUP_ROOT_SELECTOR);
      clearDismissed(greetingKeyFromPopup(popup));
    }
  });
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['hidden']
});

document.querySelectorAll(POPUP_ROOT_SELECTOR).forEach(removeStoredPopup);
