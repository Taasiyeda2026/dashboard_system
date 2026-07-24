/*
 * The annual-review area currently has two landing implementations:
 * personal-reports.js creates buttons with data-ar-open and annual-reviews-v2.js
 * replaces them with data-ar2-open buttons. Other shell capture listeners may
 * stop the real click before it reaches the listener that owns the button.
 *
 * Keep a very small addEventListener wrapper active so we can remember the
 * relevant direct/delegated handlers even when they are registered later, then
 * run a fallback only if the original click left the same button on screen.
 */

const nativeAddEventListener = EventTarget.prototype.addEventListener;
const documentClickHandlers = [];
const directButtonHandlers = new WeakMap();
const fallbackScheduled = new WeakSet();
const OPEN_SELECTOR = '[data-ar-open],[data-ar2-open]';

function isCaptureOption(options) {
  return options === true || Boolean(options && typeof options === 'object' && options.capture);
}

function rememberDirectHandler(target, listener) {
  const current = directButtonHandlers.get(target) || [];
  if (!current.includes(listener)) current.push(listener);
  directButtonHandlers.set(target, current);
}

function patchedAddEventListener(type, listener, options) {
  if (type === 'click' && typeof listener === 'function') {
    if (this === document && isCaptureOption(options)) {
      if (!documentClickHandlers.includes(listener)) documentClickHandlers.push(listener);
    } else if (this instanceof Element && this.matches?.(OPEN_SELECTOR)) {
      rememberDirectHandler(this, listener);
    }
  }
  return nativeAddEventListener.call(this, type, listener, options);
}

EventTarget.prototype.addEventListener = patchedAddEventListener;

function fallbackEvent(button) {
  return {
    target: button,
    currentTarget: button,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

async function invokeHandler(handler, thisArg, eventLike) {
  try {
    await handler.call(thisArg, eventLike);
    return true;
  } catch (error) {
    console.error('[annual-reviews-open-button] fallback handler failed', error);
    return false;
  }
}

async function runFallback(button) {
  if (!button?.isConnected) return;

  const direct = directButtonHandlers.get(button) || [];
  const eventLike = fallbackEvent(button);
  let invoked = false;

  for (const handler of direct) {
    invoked = (await invokeHandler(handler, button, eventLike)) || invoked;
    if (!button.isConnected) return;
  }

  if (button.matches('[data-ar2-open]')) {
    for (const handler of documentClickHandlers) {
      invoked = (await invokeHandler(handler, document, eventLike)) || invoked;
      if (!button.isConnected) return;
    }
  }

  if (!invoked && button.isConnected) {
    button.disabled = false;
    button.textContent = button.dataset.reviewOpenOriginalLabel || 'פתיחת המשוב';
    console.error('[annual-reviews-open-button] no matching open handler was registered');
  }
}

function scheduleFallback(event) {
  const button = event.target?.closest?.(OPEN_SELECTOR);
  if (!button || fallbackScheduled.has(button)) return;
  fallbackScheduled.add(button);

  if (!button.dataset.reviewOpenOriginalLabel) {
    button.dataset.reviewOpenOriginalLabel = button.textContent.trim() || 'פתיחת המשוב';
  }
  button.textContent = 'פותח…';

  // Allow the normal target/document listeners to run first. Only when the same
  // button remains on the landing do we invoke the remembered handler ourselves.
  setTimeout(async () => {
    fallbackScheduled.delete(button);
    if (!button.isConnected) return;
    await runFallback(button);
    if (button.isConnected) {
      setTimeout(() => {
        if (!button.isConnected) return;
        button.disabled = false;
        button.textContent = button.dataset.reviewOpenOriginalLabel || 'פתיחת המשוב';
      }, 6000);
    }
  }, 0);
}

// Registered before the application modules. It does not block the genuine
// click; it only schedules a fallback after the normal event dispatch.
nativeAddEventListener.call(window, 'click', scheduleFallback, { capture: true });
