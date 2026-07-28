/*
 * Proposal print fallback for incomplete drafts.
 *
 * The regular saved-PDF flow performs business validations because it creates
 * and stores the final document. For day-to-day review and printing, users must
 * still be able to print the live preview or choose "Save as PDF" in the browser
 * even when optional or unfinished details are missing (including contact phone
 * or email). This handler is intentionally limited to the preview print button.
 */
(function installProposalIncompletePrintRuntime() {
  'use strict';

  if (globalThis.__dsProposalIncompletePrintRuntimeInstalled) return;
  globalThis.__dsProposalIncompletePrintRuntimeInstalled = true;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const PREVIEW_SELECTOR = '#pa-preview-overlay';
  const PRINT_BUTTON_SELECTOR = `${PREVIEW_SELECTOR} #pa-print-btn`;

  function updatePreviewPrintButton(root = document) {
    const buttons = [];
    if (root?.matches?.(PRINT_BUTTON_SELECTOR)) buttons.push(root);
    root?.querySelectorAll?.(PRINT_BUTTON_SELECTOR).forEach((button) => buttons.push(button));

    buttons.forEach((button) => {
      button.textContent = 'הדפסה / PDF';
      button.title = 'הדפסה או שמירה כ־PDF גם כאשר חסרים פרטים';
      button.setAttribute('aria-label', 'הדפסה או שמירה כ־PDF');
      button.dataset.paBrowserPrint = 'yes';
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.(PRINT_BUTTON_SELECTOR);
    if (!button) return;

    // Run before the screen's saved-PDF handler so incomplete details never
    // block the browser print dialog. The existing print stylesheet hides the
    // toolbar and prints only the proposal document.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    requestAnimationFrame(() => {
      try {
        window.print();
      } catch (error) {
        console.error('[proposal browser print failed]', error);
      }
    });
  }, true);

  const scheduleUpdate = (() => {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        updatePreviewPrintButton();
      });
    };
  })();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleUpdate, { once: true });
  } else {
    scheduleUpdate();
  }

  new MutationObserver(scheduleUpdate)
    .observe(document.documentElement, { childList: true, subtree: true });
})();
