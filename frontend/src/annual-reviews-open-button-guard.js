/*
 * The personal-reports screen initially binds review buttons directly to the
 * legacy landing nodes. annual-reviews-v2 then replaces that landing markup,
 * so those node-bound listeners are discarded. Capture the v2 delegated click
 * handler while the module is initialized and invoke it from the window capture
 * phase. This keeps the replacement buttons functional even when another shell
 * listener stops the event before it reaches document.
 */

const nativeDocumentAddEventListener = document.addEventListener;
let annualReviewsV2ClickHandler = null;
let documentListenerRestored = false;

function isCaptureOption(options) {
  return options === true || Boolean(options && typeof options === 'object' && options.capture);
}

function restoreDocumentAddEventListener() {
  if (documentListenerRestored) return;
  documentListenerRestored = true;
  try {
    delete document.addEventListener;
  } catch {
    document.addEventListener = nativeDocumentAddEventListener;
  }
}

document.addEventListener = function patchedDocumentAddEventListener(type, listener, options) {
  if (
    !annualReviewsV2ClickHandler
    && type === 'click'
    && isCaptureOption(options)
    && typeof listener === 'function'
    && String(listener).includes('data-ar2-open')
  ) {
    annualReviewsV2ClickHandler = listener;
  }

  return nativeDocumentAddEventListener.call(this, type, listener, options);
};

window.addEventListener('click', (event) => {
  const button = event.target?.closest?.('[data-ar2-open]');
  if (!button || typeof annualReviewsV2ClickHandler !== 'function') return;

  event.preventDefault();
  event.stopImmediatePropagation();

  annualReviewsV2ClickHandler({
    target: button,
    preventDefault() {},
    stopPropagation() {},
    stopImmediatePropagation() {}
  });
}, true);

// Direct sibling modules are evaluated before queued microtasks, so the v2
// listener is captured and the native method is restored immediately afterward.
queueMicrotask(restoreDocumentAddEventListener);
setTimeout(restoreDocumentAddEventListener, 0);
