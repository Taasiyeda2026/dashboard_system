/*
 * Proposal browser-print runtime.
 *
 * Proposal PDFs are printed by the browser itself so text stays real text,
 * Hebrew remains RTL and tables remain vector/CSS instead of being rasterized.
 * This runtime intercepts both the preview print button and the direct PDF
 * actions before the legacy image-PDF generator can run.
 */

const PREVIEW_SELECTOR = '#pa-preview-overlay';
const PREVIEW_PRINT_SELECTOR = `${PREVIEW_SELECTOR} #pa-print-btn`;
const DIRECT_PRINT_SELECTOR = '[data-pa-print]';
const PREVIEW_ACTION_SELECTOR = '[data-pa-preview]';
const OPEN_PROPOSAL_SELECTOR = '[data-pa-open-proposal-id]';
const PRINT_LABEL = 'הדפסה / PDF';
const PRINT_TITLE = 'הדפסה או שמירה כ־PDF';
const PRINT_READY_TIMEOUT_MS = 10000;

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function isVisible(element) {
  if (!element) return false;
  if (element.hidden || element.disabled) return false;
  if (typeof element.getClientRects === 'function' && element.getClientRects().length > 0) return true;
  return element.offsetParent !== null;
}

function matchingControl(selector, datasetKey, proposalId, root = document) {
  const controls = Array.from(root?.querySelectorAll?.(selector) || []);
  const matches = controls.filter((control) => cleanText(control?.dataset?.[datasetKey]) === proposalId);
  return matches.find(isVisible) || matches[0] || null;
}

function waitForValue(resolver, timeoutMs = PRINT_READY_TIMEOUT_MS) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let value = null;
      try { value = resolver(); } catch { value = null; }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('proposal_browser_print_preview_timeout'));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function waitForPrintablePreview() {
  const overlay = await waitForValue(() => document.querySelector(PREVIEW_SELECTOR));
  await waitForValue(() => {
    const proposal = overlay.querySelector('.proposal-preview-area .proposal-document');
    if (!proposal) return null;
    const rect = proposal.getBoundingClientRect?.();
    if (rect && rect.width <= 0 && rect.height <= 0) return null;
    return proposal;
  });
  try { await document.fonts?.ready; } catch { /* browser fallback */ }
  await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  return overlay;
}

async function openProposalPreview(proposalId) {
  const existingOverlay = document.querySelector(PREVIEW_SELECTOR);
  if (existingOverlay) return waitForPrintablePreview();

  let previewButton = matchingControl(PREVIEW_ACTION_SELECTOR, 'paPreview', proposalId);
  if (previewButton) {
    previewButton.click();
    try {
      return await Promise.race([
        waitForPrintablePreview(),
        waitForValue(() => {
          const detail = document.querySelector('[data-pa-proposal-detail]');
          if (!detail || !isVisible(detail)) return null;
          return matchingControl(PREVIEW_ACTION_SELECTOR, 'paPreview', proposalId, detail);
        }, 4000).then((detailPreview) => ({ detailPreview }))
      ]).then(async (result) => {
        if (result?.detailPreview) {
          result.detailPreview.click();
          return waitForPrintablePreview();
        }
        return result;
      });
    } catch {
      // Continue with the detail/open path below.
    }
  }

  const opener = matchingControl(OPEN_PROPOSAL_SELECTOR, 'paOpenProposalId', proposalId);
  if (opener) opener.click();

  const detailPreview = await waitForValue(() => {
    const detail = document.querySelector('[data-pa-proposal-detail]');
    if (!detail || !isVisible(detail)) return null;
    return matchingControl(PREVIEW_ACTION_SELECTOR, 'paPreview', proposalId, detail);
  });
  detailPreview.click();
  return waitForPrintablePreview();
}

async function printProposalById(proposalId) {
  if (!proposalId) throw new Error('proposal_browser_print_missing_id');
  await openProposalPreview(proposalId);
  window.print();
}

export function configureProposalPreviewPrintButton(button) {
  if (!button) return false;

  const alreadyConfigured =
    button.dataset?.paBrowserPrint === 'yes' &&
    button.textContent === PRINT_LABEL &&
    button.title === PRINT_TITLE &&
    button.getAttribute?.('aria-label') === PRINT_TITLE;

  if (alreadyConfigured) return false;

  if (button.dataset) button.dataset.paBrowserPrint = 'yes';
  else button.setAttribute?.('data-pa-browser-print', 'yes');

  if (button.textContent !== PRINT_LABEL) button.textContent = PRINT_LABEL;
  if (button.title !== PRINT_TITLE) button.title = PRINT_TITLE;
  if (button.getAttribute?.('aria-label') !== PRINT_TITLE) {
    button.setAttribute?.('aria-label', PRINT_TITLE);
  }
  return true;
}

function configureDirectProposalPrintButton(button) {
  if (!button) return false;
  const alreadyConfigured =
    button.dataset?.paBrowserPrint === 'yes' &&
    button.title === PRINT_TITLE &&
    button.getAttribute?.('aria-label') === PRINT_TITLE;
  if (alreadyConfigured) return false;
  if (button.dataset) button.dataset.paBrowserPrint = 'yes';
  if (button.title !== PRINT_TITLE) button.title = PRINT_TITLE;
  if (button.getAttribute?.('aria-label') !== PRINT_TITLE) button.setAttribute?.('aria-label', PRINT_TITLE);
  return true;
}

export function updateProposalPreviewPrintButton(root = document) {
  const previewButtons = [];
  if (root?.matches?.(PREVIEW_PRINT_SELECTOR)) previewButtons.push(root);
  root?.querySelectorAll?.(PREVIEW_PRINT_SELECTOR).forEach((button) => previewButtons.push(button));
  previewButtons.forEach(configureProposalPreviewPrintButton);

  const directButtons = [];
  if (root?.matches?.(DIRECT_PRINT_SELECTOR)) directButtons.push(root);
  root?.querySelectorAll?.(DIRECT_PRINT_SELECTOR).forEach((button) => directButtons.push(button));
  directButtons.forEach(configureDirectProposalPrintButton);
}

export function installProposalIncompletePrintRuntime() {
  if (globalThis.__dsProposalIncompletePrintRuntimeInstalled) return false;
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  globalThis.__dsProposalIncompletePrintRuntimeInstalled = true;

  document.addEventListener('click', (event) => {
    const previewPrintButton = event.target?.closest?.(PREVIEW_PRINT_SELECTOR);
    if (previewPrintButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      requestAnimationFrame(() => {
        try { window.print(); }
        catch (error) { console.error('[proposal browser print failed]', error); }
      });
      return;
    }

    const directPrintButton = event.target?.closest?.(DIRECT_PRINT_SELECTOR);
    if (!directPrintButton) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const proposalId = cleanText(directPrintButton.dataset?.paPrint);
    directPrintButton.disabled = true;
    void printProposalById(proposalId)
      .catch((error) => console.error('[proposal browser print failed]', error))
      .finally(() => {
        if (directPrintButton.isConnected) directPrintButton.disabled = false;
      });
  }, true);

  const scheduleUpdate = (() => {
    let queued = false;
    return () => {
      if (queued) return;
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
