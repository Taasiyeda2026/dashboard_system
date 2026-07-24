/*
 * The annual-review area has two landing implementations:
 * - personal-reports.js uses data-ar-open and binds directly to each button.
 * - annual-reviews-v2.js uses data-ar2-open and a delegated document listener.
 *
 * Some shell listeners may stop the click before it reaches either owner. Keep a
 * narrow addEventListener wrapper active, remember only the two review-opening
 * handlers, and invoke a fallback only when the genuine event was not handled.
 */

const nativeAddEventListener = EventTarget.prototype.addEventListener;
const v2DocumentHandlers = [];
const directButtonHandlers = new WeakMap();
const handledEvents = new WeakSet();
const fallbackScheduled = new WeakSet();
const OPEN_SELECTOR = '[data-ar-open],[data-ar2-open]';

function listenerSource(listener) {
  try {
    return Function.prototype.toString.call(listener);
  } catch {
    return '';
  }
}

function isAnnualReviewsV2Handler(listener) {
  const source = listenerSource(listener);
  return source.includes('data-ar2-open') && source.includes('openReview');
}

function rememberDirectHandler(target, listener) {
  const current = directButtonHandlers.get(target) || [];
  if (!current.includes(listener)) current.push(listener);
  directButtonHandlers.set(target, current);
}

function wrappedReviewHandler(listener, thisArg) {
  return function annualReviewTrackedListener(event) {
    const button = event.target?.closest?.(OPEN_SELECTOR);
    if (button) handledEvents.add(event);
    return listener.call(thisArg || this, event);
  };
}

function patchedAddEventListener(type, listener, options) {
  if (type === 'click' && typeof listener === 'function') {
    if (this === document && isAnnualReviewsV2Handler(listener)) {
      if (!v2DocumentHandlers.includes(listener)) v2DocumentHandlers.push(listener);
      return nativeAddEventListener.call(this, type, wrappedReviewHandler(listener, document), options);
    }

    if (this instanceof Element && this.matches?.(OPEN_SELECTOR)) {
      rememberDirectHandler(this, listener);
      return nativeAddEventListener.call(this, type, wrappedReviewHandler(listener, this), options);
    }
  }

  return nativeAddEventListener.call(this, type, listener, options);
}

// Intentionally kept active: the legacy landing binds its direct handlers only
// after the async review list has been rendered.
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
  const eventLike = fallbackEvent(button);
  let invoked = false;

  for (const handler of directButtonHandlers.get(button) || []) {
    invoked = (await invokeHandler(handler, button, eventLike)) || invoked;
    if (!button.isConnected) return;
  }

  if (button.matches('[data-ar2-open]')) {
    for (const handler of v2DocumentHandlers) {
      invoked = (await invokeHandler(handler, document, eventLike)) || invoked;
      if (!button.isConnected) return;
    }
  }

  if (!invoked && button.isConnected) {
    button.disabled = false;
    button.textContent = button.dataset.reviewOpenOriginalLabel || 'פתיחת המשוב';
    console.error('[annual-reviews-open-button] no review-opening handler was registered');
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

  // The timeout runs after the normal capture/target/bubble phases. If one of the
  // real owners handled the event, do nothing. Otherwise invoke its saved handler.
  setTimeout(async () => {
    fallbackScheduled.delete(button);
    if (handledEvents.has(event) || !button.isConnected) return;
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

// Loaded before the application modules and therefore before any shell capture
// listener that might stop the event.
nativeAddEventListener.call(window, 'click', scheduleFallback, { capture: true });
