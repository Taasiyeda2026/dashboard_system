/*
 * The annual-review landing is first rendered by personal-reports.js and then
 * replaced by annual-reviews-v2.js. Direct listeners attached to the original
 * buttons are therefore lost. Capture document-level click handlers while the
 * application modules are initialized, then bind every replacement button
 * directly and forward the real click to the captured handlers.
 */

const nativeAddEventListener = EventTarget.prototype.addEventListener;
const capturedDocumentClickHandlers = [];
let listenerPatchRestored = false;

function isCaptureOption(options) {
  return options === true || Boolean(options && typeof options === 'object' && options.capture);
}

function patchedAddEventListener(type, listener, options) {
  if (
    this === document
    && type === 'click'
    && isCaptureOption(options)
    && typeof listener === 'function'
  ) {
    capturedDocumentClickHandlers.push(listener);
  }

  return nativeAddEventListener.call(this, type, listener, options);
}

function restoreNativeAddEventListener() {
  if (listenerPatchRestored) return;
  listenerPatchRestored = true;
  EventTarget.prototype.addEventListener = nativeAddEventListener;
}

function forwardAnnualReviewClick(event, button) {
  event.preventDefault();
  event.stopImmediatePropagation();

  for (const handler of capturedDocumentClickHandlers) {
    try {
      handler.call(document, event);
    } catch (error) {
      console.error('[annual-reviews-open-button] delegated handler failed', error);
    }
  }
}

function bindAnnualReviewOpenButtons(root = document) {
  root.querySelectorAll?.('[data-ar2-open]:not([data-ar2-open-bound])').forEach((button) => {
    button.dataset.ar2OpenBound = 'true';
    nativeAddEventListener.call(button, 'click', (event) => {
      forwardAnnualReviewClick(event, button);
    }, { capture: true });
  });
}

EventTarget.prototype.addEventListener = patchedAddEventListener;

bindAnnualReviewOpenButtons();
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches?.('[data-ar2-open]')) bindAnnualReviewOpenButtons(node.parentElement || document);
      else bindAnnualReviewOpenButtons(node);
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// All static sibling modules finish evaluation before these callbacks run.
queueMicrotask(restoreNativeAddEventListener);
setTimeout(restoreNativeAddEventListener, 0);
