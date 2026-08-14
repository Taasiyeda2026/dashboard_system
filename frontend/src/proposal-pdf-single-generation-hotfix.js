import {
  proposalsAgreementsScreen,
  proposalHasFinalPdf,
  buildProposalDocumentSnapshot,
  normalizeProposalAgreementRow,
  validateProposalDocumentHtml
} from './screens/proposals-agreements.js';
import { generateProposalNativePdfBlob } from './proposal-native-pdf.js';
import { showToast } from './screens/shared/toast.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfSingleGenerationHotfix');
const rootCleanup = new WeakMap();
const nativePdfInFlight = new Set();

globalThis.__dsProposalNativePdfEnabled = true;

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function rowHasSavedPdf(row = {}) {
  if (typeof proposalHasFinalPdf === 'function') return proposalHasFinalPdf(row);
  return Boolean(cleanText(row.final_pdf_path));
}

function proposalItemsFromSnapshot(row = {}) {
  return row?.document_snapshot && Array.isArray(row.document_snapshot.items)
    ? row.document_snapshot.items
    : [];
}

function updateDataRow(data, row) {
  if (!row?.id || !Array.isArray(data?.rows)) return;
  const id = cleanText(row.id);
  const index = data.rows.findIndex((item) => cleanText(item?.id) === id);
  if (index >= 0) data.rows[index] = normalizeProposalAgreementRow({ ...data.rows[index], ...row });
}

async function ensureProposalPdfContext(proposalId, data, api) {
  let row = (Array.isArray(data?.rows) ? data.rows : [])
    .find((item) => cleanText(item?.id) === proposalId) || null;
  if (!row) throw new Error('proposal_not_found');

  if (typeof api?.proposalAgreementDetail === 'function') {
    try {
      const detailed = await api.proposalAgreementDetail(proposalId);
      if (detailed) {
        row = normalizeProposalAgreementRow({ ...row, ...detailed });
        updateDataRow(data, row);
      }
    } catch (error) {
      console.warn('[proposal-native-pdf] detail load failed', error);
    }
  }

  if ((!Array.isArray(data?.proposalTemplateSections) || !data.proposalTemplateSections.length)
    && typeof api?.proposalsAgreementsEditorDeps === 'function') {
    const deps = await api.proposalsAgreementsEditorDeps();
    if (Array.isArray(deps?.proposalTemplateSections)) data.proposalTemplateSections = deps.proposalTemplateSections;
  }

  let items = Array.isArray(data?._itemsByProposalId?.[proposalId])
    ? data._itemsByProposalId[proposalId]
    : [];
  if (!items.length) items = proposalItemsFromSnapshot(row);
  if (!items.length && typeof api?.readProposalAgreementItems === 'function') {
    try {
      items = await api.readProposalAgreementItems(proposalId);
    } catch {
      items = [];
    }
  }
  if (!Array.isArray(items)) items = [];
  if (!data._itemsByProposalId || typeof data._itemsByProposalId !== 'object') data._itemsByProposalId = {};
  data._itemsByProposalId[proposalId] = items;

  return {
    row,
    items,
    templateSections: Array.isArray(data?.proposalTemplateSections) ? data.proposalTemplateSections : []
  };
}

function proposalPreviewHtml() {
  const overlay = document.getElementById('pa-preview-overlay');
  const area = overlay?.querySelector('.proposal-preview-area');
  return cleanText(area?.innerHTML);
}

function savedSnapshotCanBeBackfilled(row = {}) {
  return cleanText(row.status).toLowerCase() === 'sent'
    && !rowHasSavedPdf(row)
    && Boolean(cleanText(row.document_html_snapshot))
    && Boolean(row.document_snapshot && typeof row.document_snapshot === 'object' && !Array.isArray(row.document_snapshot));
}

function nativePdfFileName(proposalId) {
  const safeId = cleanText(proposalId).replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'document';
  return `proposal-${safeId}.pdf`;
}

function setPdfButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.nativePdfOriginalHtml) button.dataset.nativePdfOriginalHtml = button.innerHTML;
    button.dataset.nativePdfBusy = 'yes';
    button.disabled = true;
    button.innerHTML = '<span class="ds-pa-pdf-spinner" aria-hidden="true"></span> מפיק PDF...';
    button.title = 'מפיק PDF חד וניתן לחיפוש';
    return;
  }
  button.disabled = false;
  button.innerHTML = button.dataset.nativePdfOriginalHtml || 'PDF';
  button.title = 'הפקת PDF ושמירה אוטומטית';
  delete button.dataset.nativePdfOriginalHtml;
  delete button.dataset.nativePdfBusy;
}

async function generateAndStoreNativeProposalPdf({ proposalId, button, data, api }) {
  if (!proposalId || nativePdfInFlight.has(proposalId)) return;
  if (!api || typeof api.uploadProposalFinalPdf !== 'function') throw new Error('proposal_pdf_upload_unavailable');

  nativePdfInFlight.add(proposalId);
  setPdfButtonBusy(button, true);
  try {
    const { row, items, templateSections } = await ensureProposalPdfContext(proposalId, data, api);
    if (rowHasSavedPdf(row)) {
      button?.remove();
      return;
    }

    const useStoredSnapshot = savedSnapshotCanBeBackfilled(row);
    const documentHtmlSnapshot = useStoredSnapshot
      ? cleanText(row.document_html_snapshot)
      : proposalPreviewHtml();
    if (!documentHtmlSnapshot) throw new Error('proposal_pdf_preview_missing');

    const htmlCheck = validateProposalDocumentHtml(documentHtmlSnapshot);
    if (!htmlCheck.ok) {
      const error = new Error(`proposal_document_incomplete:${htmlCheck.missing.join(',')}`);
      error.userMessage = `לא ניתן להפיק PDF. חסר במסמך: ${htmlCheck.missing.join(', ')}.`;
      throw error;
    }

    const documentSnapshot = useStoredSnapshot
      ? row.document_snapshot
      : buildProposalDocumentSnapshot(row, items, templateSections);

    const blob = await generateProposalNativePdfBlob(documentHtmlSnapshot, {
      proposalId,
      title: 'הצעת מחיר',
      onStage: (stage) => {
        if (button) button.dataset.nativePdfStage = stage;
      }
    });
    const pdfFile = new File([blob], nativePdfFileName(proposalId), {
      type: 'application/pdf',
      lastModified: Date.now()
    });

    const result = await api.uploadProposalFinalPdf(proposalId, {
      pdfFile,
      documentSnapshot,
      documentHtmlSnapshot
    });
    if (result?.row) updateDataRow(data, result.row);

    showToast('ה-PDF הופק ונשמר בהצלחה.', 'success');
    button?.remove();
  } catch (error) {
    console.error('[proposal-native-pdf-save-failed]', {
      proposalId,
      code: error?.code || '',
      message: error?.message || String(error)
    });
    showToast(error?.userMessage || error?.message || 'יצירת ה-PDF נכשלה.', 'error', 5000);
    setPdfButtonBusy(button, false);
  } finally {
    nativePdfInFlight.delete(proposalId);
  }
}

function installRootGuard(root, data, context = {}) {
  rootCleanup.get(root)?.();

  let activeProposalId = '';
  let observer = null;
  const api = context?.api;

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

    if (pdfButton.dataset.nativePdfBusy !== 'yes') {
      if (pdfButton.textContent !== 'PDF') pdfButton.textContent = 'PDF';
      if (pdfButton.title !== 'הפקת PDF חד ושמירה אוטומטית') pdfButton.title = 'הפקת PDF חד ושמירה אוטומטית';
      if (pdfButton.getAttribute('aria-label') !== 'הפקת PDF חד ושמירה אוטומטית') {
        pdfButton.setAttribute('aria-label', 'הפקת PDF חד ושמירה אוטומטית');
      }
      if (pdfButton.dataset.paNativePdf !== 'yes') pdfButton.dataset.paNativePdf = 'yes';
    }

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

  const captureNativePdf = (event) => {
    const pdfButton = event?.target?.closest?.('#pa-preview-overlay #pa-print-btn');
    if (!pdfButton) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const proposalId = activeProposalId || activeFormProposalId();
    if (!proposalId) {
      showToast('לא נמצאה הצעת המחיר להפקת PDF.', 'error');
      return;
    }
    void generateAndStoreNativeProposalPdf({ proposalId, button: pdfButton, data, api });
  };

  root.addEventListener('click', capturePreviewProposal, true);
  document.addEventListener('click', captureNativePdf, true);

  if (typeof MutationObserver === 'function' && document?.body) {
    observer = new MutationObserver(hideDuplicatePdfButton);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  const cleanup = () => {
    root.removeEventListener('click', capturePreviewProposal, true);
    document.removeEventListener('click', captureNativePdf, true);
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
