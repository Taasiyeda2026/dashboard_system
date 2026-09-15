import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalVectorPdfBridge');
let vectorModulePromise = null;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function loadVectorModule() {
  if (!vectorModulePromise) {
    vectorModulePromise = import('./proposal-vector-pdf-runtime.js').catch((error) => {
      vectorModulePromise = null;
      throw error;
    });
  }
  return vectorModulePromise;
}

export function installProposalVectorPdfBridge(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  targetApi.createProposalFinalPdfFile = async ({ row = {}, previewHtml = '' } = {}) => {
    const module = await loadVectorModule();
    const id = clean(row?.id);
    const quote = clean(row?.quote_number);
    return module.createProposalVectorPdfFile({
      proposalId: id,
      html: previewHtml,
      title: quote ? `הצעת מחיר ${quote}` : 'הצעת מחיר',
      fileName: quote ? `הצעת_מחיר_${quote}.pdf` : `proposal-${id || 'document'}.pdf`
    }, scope);
  };

  targetApi.requestProposalFinalPdf = async (id, payload = {}) => {
    const proposalId = clean(id);
    const html = String(payload?.documentHtmlSnapshot || payload?.document_html_snapshot || '');
    if (!proposalId || !html.trim()) {
      return { ok: false, skipped: true, reason: proposalId ? 'missing_html_snapshot' : 'missing_proposal_id' };
    }

    try {
      const module = await loadVectorModule();
      const result = await module.saveProposalVectorPdf(targetApi, {
        proposalId,
        documentHtmlSnapshot: html,
        documentSnapshot: payload?.documentSnapshot || payload?.document_snapshot || {},
        title: 'הצעת מחיר'
      }, scope);
      return { ...(result || {}), ok: true, generation_source: 'client-vector' };
    } catch (error) {
      const message = error?.message || String(error);
      console.error('[proposal vector pdf] automatic save failed', { proposalId, message });
      return { ok: false, error: message, generation_source: 'client-vector' };
    }
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalVectorPdfBridge(api, globalThis);
