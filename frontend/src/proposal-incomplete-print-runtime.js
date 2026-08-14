/*
 * Proposal print fallback for incomplete drafts.
 *
 * The regular saved-PDF flow performs business validations because it creates
 * and stores the final document. For day-to-day review and printing, users must
 * still be able to print the live preview or choose "Save as PDF" in the browser
 * even when optional or unfinished details are missing (including contact phone
 * or email). This handler is intentionally limited to the preview print button.
 *
 * When the native proposal PDF renderer is active, the saved-PDF button belongs
 * to that renderer and this fallback must not intercept or relabel it.
 */

const PREVIEW_SELECTOR = '#pa-preview-overlay';
const PRINT_BUTTON_SELECTOR = `${PREVIEW_SELECTOR} #pa-print-btn`;
const PRINT_LABEL = 'הדפסה / PDF';
const PRINT_TITLE = 'הדפסה או שמירה כ־PDF גם כאשר חסרים פרטים';
const PRINT_ARIA_LABEL = 'הדפסה או שמירה כ־PDF';

function nativeProposalPdfEnabled() {
  return globalThis.__dsProposalNativePdfEnabled === true;
}

/**
 * Configures the preview print button without causing repeated DOM mutations.
 *
 * The MutationObserver below watches child-list changes. Reassigning textContent
 * on every observer callback creates another child-list mutation and can trap the
 * browser in an endless microtask loop. This function is deliberately idempotent:
 * once the button already has the expected state, it performs no DOM writes.
 */
export function configureProposalPreviewPrintButton(button) {
  if (!button || nativeProposalPdfEnabled()) return false;

  const alreadyConfigured =
    button.dataset?.paBrowserPrint === 'yes' &&
    button.textContent === PRINT_LABEL &&
    button.title === PRINT_TITLE &&
    button.getAttribute?.('aria-label') === PRINT_ARIA_LABEL;

  if (alreadyConfigured) return false;

  if (button.dataset) button.dataset.paBrowserPrint = 'yes';
  else button.setAttribute?.('data-pa-browser-print', 'yes');

  if (button.textContent !== PRINT_LABEL) button.textContent = PRINT_LABEL;
  if (button.title !== PRINT_TITLE) button.title = PRINT_TITLE;
  if (button.getAttribute?.('aria-label') !== PRINT_ARIA_LABEL) {
    button.setAttribute?.('aria-label', PRINT_ARIA_LABEL);
  }

  return true;
}

export function updateProposalPreviewPrintButton(root = document) {
  if (nativeProposalPdfEnabled()) return;
  const buttons = [];
  if (root?.matches?.(PRINT_BUTTON_SELECTOR)) buttons.push(root);
  root?.querySelectorAll?.(PRINT_BUTTON_SELECTOR).forEach((button) => buttons.push(button));
  buttons.forEach(configureProposalPreviewPrintButton);
}

export function installProposalIncompletePrintRuntime() {
  if (globalThis.__dsProposalIncompletePrintRuntimeInstalled) return false;
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  globalThis.__dsProposalIncompletePrintRuntimeInstalled = true;

  document.addEventListener('click', (event) => {
    if (nativeProposalPdfEnabled()) return;
    const button = event.target?.closest?.(PRINT_BUTTON_SELECTOR);
    if (!button) return;

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
      if (queued || nativeProposalPdfEnabled()) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        updateProposalPreviewPrintButton();
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

  return true;
}

installProposalIncompletePrintRuntime();
