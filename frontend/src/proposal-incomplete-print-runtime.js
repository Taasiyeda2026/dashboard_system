/*
 * Proposal PDF action runtime.
 *
 * The PDF action now creates a real text/vector PDF in the browser, stores that
 * exact file in Supabase, and opens the same file for the user. It deliberately
 * bypasses the legacy canvas/JPEG proposal generator.
 */
import { api } from './api.js';
import { showToast } from './screens/shared/toast.js';

const PREVIEW_SELECTOR = '#pa-preview-overlay';
const PREVIEW_PRINT_SELECTOR = `${PREVIEW_SELECTOR} #pa-print-btn`;
const DIRECT_PRINT_SELECTOR = '[data-pa-print]';
const PREVIEW_ACTION_SELECTOR = '[data-pa-preview]';
const PREVIEW_FORM_SELECTOR = '[data-pa-preview-form]';
const OPEN_PROPOSAL_SELECTOR = '[data-pa-open-proposal-id]';
const APPROVAL_SELECTOR = '[data-pa-status-action="approved"][data-pa-action-id]';
const PRINT_LABEL = 'הדפסה / PDF';
const PRINT_TITLE = 'הפקת PDF ושמירה אוטומטית';
const PRINT_READY_TIMEOUT_MS = 10000;

let activeProposalId = '';

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
        reject(new Error('proposal_pdf_preview_timeout'));
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

function reservePdfWindow() {
  try {
    const reserved = window.open('', '_blank');
    if (reserved) {
      try { reserved.opener = null; } catch { /* ignore */ }
      try { reserved.document.title = 'מפיק PDF…'; } catch { /* ignore */ }
    }
    return reserved;
  } catch {
    return null;
  }
}

function closeReservedPdfWindow(reserved) {
  if (!reserved || reserved.closed) return;
  try { reserved.close(); } catch { /* ignore */ }
}

function openFileInReservedWindow(file, reserved) {
  if (!file) throw new Error('proposal_pdf_file_missing');
  const objectUrl = URL.createObjectURL(file);
  if (reserved && !reserved.closed) {
    reserved.location.replace(objectUrl);
  } else {
    const opened = window.open(objectUrl, '_blank');
    if (!opened) throw new Error('proposal_pdf_popup_blocked');
  }
  setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
}

async function openStoredPdf(proposalId, reserved) {
  if (typeof api.getProposalFinalPdfSignedUrl !== 'function') return false;
  try {
    const result = await api.getProposalFinalPdfSignedUrl(proposalId);
    const signedUrl = cleanText(result?.signedUrl || result?.signed_url || result?.url);
    if (!signedUrl) return false;
    if (reserved && !reserved.closed) reserved.location.replace(signedUrl);
    else window.open(signedUrl, '_blank');
    return true;
  } catch {
    return false;
  }
}

function currentPreviewHtml(overlay) {
  const area = overlay?.querySelector?.('.proposal-preview-area');
  return String(area?.innerHTML || '').trim();
}

async function proposalSnapshotForPdf(proposalId) {
  if (typeof api.proposalAgreementDetail !== 'function') {
    return { proposal_id: proposalId, source: 'client-vector-pdf' };
  }
  try {
    const row = await api.proposalAgreementDetail(proposalId);
    const existing = row?.document_snapshot;
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing;
    return {
      proposal_id: proposalId,
      quote_number: cleanText(row?.quote_number),
      status: cleanText(row?.status),
      source: 'client-vector-pdf'
    };
  } catch {
    return { proposal_id: proposalId, source: 'client-vector-pdf' };
  }
}

async function generateStoreAndOpenProposalPdf(proposalId, overlay, reserved) {
  const id = cleanText(proposalId);
  if (!id) throw new Error('proposal_pdf_missing_id');
  const html = currentPreviewHtml(overlay);
  if (!html) throw new Error('proposal_pdf_missing_html');
  if (typeof api.createProposalFinalPdfFile !== 'function' || typeof api.uploadProposalFinalPdf !== 'function') {
    throw new Error('proposal_vector_pdf_runtime_unavailable');
  }

  const detail = typeof api.proposalAgreementDetail === 'function'
    ? await api.proposalAgreementDetail(id).catch(() => null)
    : null;

  if ((cleanText(detail?.status) === 'sent' || cleanText(detail?.locked_at)) && cleanText(detail?.final_pdf_path)) {
    if (await openStoredPdf(id, reserved)) return { stored: true, reused: true };
  }

  const documentSnapshot = detail?.document_snapshot && typeof detail.document_snapshot === 'object' && !Array.isArray(detail.document_snapshot)
    ? detail.document_snapshot
    : await proposalSnapshotForPdf(id);
  const row = detail || { id };
  const pdfFile = await api.createProposalFinalPdfFile({ row, previewHtml: html });
  if (!pdfFile || pdfFile.type !== 'application/pdf' || !pdfFile.size) throw new Error('proposal_vector_pdf_invalid_file');

  let stored = false;
  try {
    await api.uploadProposalFinalPdf(id, {
      pdfFile,
      file: pdfFile,
      documentSnapshot,
      documentHtmlSnapshot: html
    });
    stored = true;
  } catch (error) {
    console.error('[proposal vector pdf storage failed]', { proposalId: id, message: error?.message || String(error) });
    showToast('ה־PDF הופק אך לא נשמר במערכת. ניתן לנסות שוב.', 'error');
  }

  openFileInReservedWindow(pdfFile, reserved);
  if (stored) showToast('ה־PDF נשמר במערכת', 'success');
  return { stored, pdfFile };
}

async function openProposalPreview(proposalId) {
  activeProposalId = cleanText(proposalId) || activeProposalId;
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

async function generateProposalPdfById(proposalId, reserved) {
  if (!proposalId) throw new Error('proposal_pdf_missing_id');
  const overlay = await openProposalPreview(proposalId);
  return generateStoreAndOpenProposalPdf(proposalId, overlay, reserved);
}

function rememberProposalIdFromEvent(event) {
  const preview = event.target?.closest?.(PREVIEW_ACTION_SELECTOR);
  const opener = event.target?.closest?.(OPEN_PROPOSAL_SELECTOR);
  const approval = event.target?.closest?.(APPROVAL_SELECTOR);
  const direct = event.target?.closest?.(DIRECT_PRINT_SELECTOR);
  const previewForm = event.target?.closest?.(PREVIEW_FORM_SELECTOR);
  const form = previewForm?.closest?.('[data-pa-form][data-pa-id]');
  const id = cleanText(
    direct?.dataset?.paPrint
      || approval?.dataset?.paActionId
      || preview?.dataset?.paPreview
      || opener?.dataset?.paOpenProposalId
      || form?.dataset?.paId
  );
  if (id) activeProposalId = id;
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
  if (button.getAttribute?.('aria-label') !== PRINT_TITLE) button.setAttribute?.('aria-label', PRINT_TITLE);
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
    rememberProposalIdFromEvent(event);

    const previewPrintButton = event.target?.closest?.(PREVIEW_PRINT_SELECTOR);
    if (previewPrintButton) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const reserved = reservePdfWindow();
      previewPrintButton.disabled = true;
      void waitForPrintablePreview()
        .then((overlay) => generateStoreAndOpenProposalPdf(activeProposalId, overlay, reserved))
        .catch((error) => {
          closeReservedPdfWindow(reserved);
          showToast('לא ניתן היה להפיק את ה־PDF. ניתן לנסות שוב.', 'error');
          console.error('[proposal vector pdf failed]', error);
        })
        .finally(() => {
          if (previewPrintButton.isConnected) previewPrintButton.disabled = false;
        });
      return;
    }

    const directPrintButton = event.target?.closest?.(DIRECT_PRINT_SELECTOR);
    if (!directPrintButton) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const proposalId = cleanText(directPrintButton.dataset?.paPrint);
    const reserved = reservePdfWindow();
    directPrintButton.disabled = true;
    void generateProposalPdfById(proposalId, reserved)
      .catch((error) => {
        closeReservedPdfWindow(reserved);
        showToast('לא ניתן היה להפיק את ה־PDF. ניתן לנסות שוב.', 'error');
        console.error('[proposal vector pdf failed]', error);
      })
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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleUpdate, { once: true });
  else scheduleUpdate();

  new MutationObserver(scheduleUpdate).observe(document.documentElement, { childList: true, subtree: true });
  return true;
}

installProposalIncompletePrintRuntime();
