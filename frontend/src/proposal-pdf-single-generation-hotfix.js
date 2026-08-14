import { proposalsAgreementsScreen, proposalHasFinalPdf } from './screens/proposals-agreements.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfSingleGenerationHotfix');
const rootCleanup = new WeakMap();

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function rowHasSavedPdf(row = {}) {
  if (typeof proposalHasFinalPdf === 'function') return proposalHasFinalPdf(row);
  return Boolean(cleanText(row.final_pdf_path));
}

function installRootGuard(root, data, context = {}) {
  rootCleanup.get(root)?.();

  let activeProposalId = '';
  let observer = null;

  const proposalRows = () => Array.isArray(data?.rows) ? data.rows : [];

  const activeFormProposalId = () => {
    const forms = Array.from(root.querySelectorAll('[data-pa-form][data-pa-id]'));
    const visibleForm = forms.find((form) => !form.hidden && form.offsetParent !== null) || forms.at(-1);
    return cleanText(visibleForm?.dataset?.paId);
  };

  const hideDuplicatePdfButton = () => {
    const overlay = document.getElementById('pa-preview-overlay');
    const pdfButton = overlay?.querySelector('#pa-print-btn');
    if (!pdfButton) return;

    const proposalId = activeProposalId || activeFormProposalId();
    if (!proposalId) return;

    const row = proposalRows().find((item) => cleanText(item?.id) === proposalId);
    if (!rowHasSavedPdf(row)) return;

    pdfButton.disabled = true;
    pdfButton.hidden = true;
    pdfButton.remove();
  };

  const capturePreviewProposal = (event) => {
    const previewButton = event?.target?.closest?.('[data-pa-preview]');
    if (!previewButton) return;
    activeProposalId = cleanText(previewButton.dataset.paPreview);
  };

  root.addEventListener('click', capturePreviewProposal, true);

  if (typeof MutationObserver === 'function' && document?.body) {
    observer = new MutationObserver(hideDuplicatePdfButton);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  const cleanup = () => {
    root.removeEventListener('click', capturePreviewProposal, true);
    observer?.disconnect();
    observer = null;
    rootCleanup.delete(root);
  };

  rootCleanup.set(root, cleanup);
  context?.signal?.addEventListener?.('abort', cleanup, { once: true });
  hideDuplicatePdfButton();
}

export function installProposalPdfSingleGenerationHotfix(targetScreen = proposalsAgreementsScreen) {
  if (!targetScreen || targetScreen[PATCH_KEY]) return false;

  const originalBind = targetScreen.bind;
  if (typeof originalBind !== 'function') return false;

  targetScreen.bind = function proposalPdfSingleGenerationBind(context = {}) {
    const result = originalBind.call(this, context);
    const root = context?.root;
    const data = context?.data;
    if (root && typeof root.addEventListener === 'function') {
      installRootGuard(root, data, {
        ...context,
        signal: root?._paAbort?.signal || context?.signal
      });
    }
    return result;
  };

  Object.defineProperty(targetScreen, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  return true;
}

installProposalPdfSingleGenerationHotfix(proposalsAgreementsScreen);
