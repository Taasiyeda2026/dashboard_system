const PATCH_KEY = Symbol.for('taasiyeda.proposalDirectApprovalNoAutoPdf');
const DIRECT_APPROVE_SELECTOR = '[data-pa-save-pending][data-pa-target-status="approved"]';
const PDF_ACTION_SELECTOR = '[data-pa-print]';
const SUPPRESS_WINDOW_MS = 120000;

/**
 * Direct "חתום ואשר" already saves the proposal and its signature. The proposal
 * workflow integrity layer used to follow that successful save by programmatically
 * clicking the PDF action. PDF rendering is intentionally high fidelity and performs
 * DOM cloning, computed-style extraction, SVG/canvas rendering and JPEG encoding on
 * the main thread, so starting it immediately after approval can make the whole UI
 * appear frozen.
 *
 * Suppress only that one synthetic PDF click after direct approval. A real user click
 * on the PDF action remains allowed, and the normal send flow can still generate a
 * missing final PDF when it is actually needed.
 */
export function installProposalDirectApprovalNoAutoPdf(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef?.addEventListener || documentRef[PATCH_KEY]) return false;

  let suppressSyntheticPdfUntil = 0;

  documentRef.addEventListener('click', (event) => {
    const target = event?.target;
    if (!target?.closest) return;

    if (target.closest(DIRECT_APPROVE_SELECTOR)) {
      suppressSyntheticPdfUntil = Date.now() + SUPPRESS_WINDOW_MS;
      return;
    }

    const pdfButton = target.closest(PDF_ACTION_SELECTOR);
    if (!pdfButton || Date.now() > suppressSyntheticPdfUntil) return;

    // Browser-generated user clicks are trusted. Never block an explicit PDF click.
    if (event.isTrusted === true) {
      suppressSyntheticPdfUntil = 0;
      return;
    }

    // Consume the compatibility layer's automatic button.click() once, before the
    // event reaches the proposal screen's expensive PDF-generation handler.
    suppressSyntheticPdfUntil = 0;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  Object.defineProperty(documentRef, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

if (typeof window !== 'undefined' && window === globalThis) {
  installProposalDirectApprovalNoAutoPdf(window);
}
