/*
 * Annual-review buttons are rendered in two forms:
 * - data-ar-open: legacy landing, direct button listener.
 * - data-ar2-open: current landing, one delegated document listener.
 *
 * A shell capture listener may stop the click before it reaches the owner. This
 * guard loads first, remembers only the matching review-opening handlers, and
 * invokes exactly one of them from the earliest window-capture phase.
 */

const nativeAddEventListener = EventTarget.prototype.addEventListener;
const directButtonHandlers = new WeakMap();
let currentLandingHandler = null;
const OPEN_SELECTOR = '[data-ar-open],[data-ar2-open]';

function listenerSource(listener) {
  try {
    return Function.prototype.toString.call(listener);
  } catch {
    return '';
  }
}

function isCurrentLandingHandler(listener) {
  return listenerSource(listener).includes('data-ar2-open');
}

function rememberDirectHandler(target, listener) {
  const handlers = directButtonHandlers.get(target) || [];
  if (!handlers.includes(listener)) handlers.push(listener);
  directButtonHandlers.set(target, handlers);
}

function patchedAddEventListener(type, listener, options) {
  if (type === 'click' && typeof listener === 'function') {
    if (this === document && isCurrentLandingHandler(listener)) {
      currentLandingHandler = listener;
    }

    if (this instanceof Element && this.matches?.('[data-ar-open]')) {
      rememberDirectHandler(this, listener);
    }
  }

  return nativeAddEventListener.call(this, type, listener, options);
}

// Kept active because the legacy buttons are created after an asynchronous load.
EventTarget.prototype.addEventListener = patchedAddEventListener;

function invoke(handler, thisArg, event) {
  try {
    const result = handler.call(thisArg, event);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => console.error('[annual-reviews-open-button] open failed', error));
    }
    return true;
  } catch (error) {
    console.error('[annual-reviews-open-button] open failed', error);
    return false;
  }
}

function openFromFirstCapture(event) {
  const button = event.target?.closest?.(OPEN_SELECTOR);
  if (!button) return;

  const originalLabel = button.textContent.trim() || 'פתיחת המשוב';
  let invoked = false;

  if (button.matches('[data-ar2-open]') && currentLandingHandler) {
    invoked = invoke(currentLandingHandler, document, event);
  } else if (button.matches('[data-ar-open]')) {
    const handler = (directButtonHandlers.get(button) || [])[0];
    if (handler) invoked = invoke(handler, button, event);
  }

  // When the real owner is not registered yet, do not freeze the control.
  if (!invoked) return;

  button.textContent = 'טוען…';
  button.disabled = true;
  event.preventDefault();
  event.stopImmediatePropagation();

  // Successful opening replaces the landing and disconnects this button. Restore
  // it only when loading failed and the same control remains on screen.
  setTimeout(() => {
    if (!button.isConnected) return;
    button.disabled = false;
    button.textContent = originalLabel;
  }, 8000);
}

nativeAddEventListener.call(window, 'click', openFromFirstCapture, { capture: true });
