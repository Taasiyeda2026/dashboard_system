/*
 * Annual-review buttons are rendered twice:
 * - personal-reports.js uses data-ar-open and binds a direct listener.
 * - annual-reviews-v2.js replaces the list with data-ar2-open and binds a
 *   delegated document listener.
 *
 * A shell capture listener can stop the real click before it reaches either
 * owner. This guard loads first, remembers the relevant listeners as they are
 * registered, and invokes them synchronously from the earliest window-capture
 * phase. The event is then stopped so the review is opened exactly once.
 */

const nativeAddEventListener = EventTarget.prototype.addEventListener;
const documentCaptureClickHandlers = [];
const directButtonHandlers = new WeakMap();
const OPEN_SELECTOR = '[data-ar-open],[data-ar2-open]';

function isCaptureOption(options) {
  return options === true || Boolean(options && typeof options === 'object' && options.capture);
}

function rememberDirectHandler(target, listener) {
  const handlers = directButtonHandlers.get(target) || [];
  if (!handlers.includes(listener)) handlers.push(listener);
  directButtonHandlers.set(target, handlers);
}

function patchedAddEventListener(type, listener, options) {
  if (type === 'click' && typeof listener === 'function') {
    if (this === document && isCaptureOption(options)) {
      if (!documentCaptureClickHandlers.includes(listener)) {
        documentCaptureClickHandlers.push(listener);
      }
    }

    if (this instanceof Element && this.matches?.(OPEN_SELECTOR)) {
      rememberDirectHandler(this, listener);
    }
  }

  return nativeAddEventListener.call(this, type, listener, options);
}

// Kept active because the legacy buttons and their handlers are created only
// after an asynchronous review-list load.
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
  button.textContent = 'פותח…';
  button.disabled = true;

  let invoked = false;

  // Legacy implementation: invoke the listener attached directly to the button.
  for (const handler of directButtonHandlers.get(button) || []) {
    invoked = invoke(handler, button, event) || invoked;
  }

  // Current implementation: invoke document capture handlers. Unrelated handlers
  // return immediately because the target is not one of their controls.
  for (const handler of documentCaptureClickHandlers) {
    invoked = invoke(handler, document, event) || invoked;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (!invoked) {
    button.disabled = false;
    button.textContent = originalLabel;
    console.error('[annual-reviews-open-button] no opening listener was registered');
    return;
  }

  // Restore the control only when the opening process failed and the same landing
  // button is still present. A successful opening removes it from the DOM.
  setTimeout(() => {
    if (!button.isConnected) return;
    button.disabled = false;
    button.textContent = originalLabel;
  }, 7000);
}

// Registered before main.js and before all shell capture listeners.
nativeAddEventListener.call(window, 'click', openFromFirstCapture, { capture: true });
