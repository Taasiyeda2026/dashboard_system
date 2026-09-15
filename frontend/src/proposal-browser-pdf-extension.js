const READY_ATTR = 'data-taasiyeda-proposal-pdf-extension';
const PAGE_SOURCE = 'taasiyeda-proposal-pdf-page';
const EXTENSION_SOURCE = 'taasiyeda-proposal-pdf-extension';
const DEFAULT_TIMEOUT_MS = 30000;
const PRINT_PARITY_STYLE_ID = 'taasiyeda-proposal-pdf-print-parity';

function safeFileName(value = '') {
  const clean = String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'proposal';
}

export function ensureProposalPdfPrintParityStyles(documentRef = globalThis.document) {
  if (!documentRef?.createElement || documentRef.getElementById?.(PRINT_PARITY_STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = PRINT_PARITY_STYLE_ID;
  style.textContent = `
    @media print {
      .proposal-document.pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-gefen-school-meta {
        white-space: nowrap !important;
      }
    }
  `;
  documentRef.head?.appendChild?.(style);
}

export function proposalPdfExtensionAvailable(documentRef = globalThis.document) {
  return documentRef?.documentElement?.getAttribute?.(READY_ATTR) === 'ready';
}

export function proposalPdfFileFromBase64(base64, fileName = 'proposal.pdf', scope = globalThis) {
  const decode = scope?.atob;
  if (typeof decode !== 'function') throw new Error('proposal_pdf_base64_decoder_unavailable');

  const binary = decode.call(scope, String(base64 || ''));
  if (!binary) throw new Error('proposal_pdf_empty_result');

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);

  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== '%PDF-') throw new Error('proposal_pdf_invalid_signature');

  const name = `${safeFileName(String(fileName || '').replace(/\.pdf$/i, ''))}.pdf`;
  if (typeof scope?.File === 'function') {
    return new scope.File([bytes], name, { type: 'application/pdf', lastModified: Date.now() });
  }

  const blob = new scope.Blob([bytes], { type: 'application/pdf' });
  try { Object.defineProperty(blob, 'name', { value: name, configurable: true }); } catch { /* fallback blob */ }
  return blob;
}

export function requestProposalPdfFromExtension({ fileName = 'proposal.pdf', timeoutMs = DEFAULT_TIMEOUT_MS } = {}, scope = globalThis) {
  const windowRef = scope?.window || scope;
  const documentRef = scope?.document || windowRef?.document;
  if (!proposalPdfExtensionAvailable(documentRef)) {
    return Promise.reject(new Error('proposal_pdf_extension_unavailable'));
  }
  if (typeof windowRef?.postMessage !== 'function' || typeof windowRef?.addEventListener !== 'function') {
    return Promise.reject(new Error('proposal_pdf_extension_bridge_unavailable'));
  }

  ensureProposalPdfPrintParityStyles(documentRef);

  const requestId = `proposal-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const targetOrigin = windowRef.location?.origin || '*';

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      windowRef.removeEventListener('message', onMessage);
      callback(value);
    };

    const onMessage = (event) => {
      if (event.source !== windowRef) return;
      if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
      const message = event.data;
      if (!message || message.source !== EXTENSION_SOURCE || message.type !== 'PRINT_TO_PDF_RESPONSE') return;
      if (message.requestId !== requestId) return;
      if (!message.ok) {
        finish(reject, new Error(String(message.error || 'proposal_pdf_extension_failed')));
        return;
      }
      try {
        finish(resolve, proposalPdfFileFromBase64(message.data, fileName, scope));
      } catch (error) {
        finish(reject, error);
      }
    };

    const timer = setTimeout(() => {
      finish(reject, new Error('proposal_pdf_extension_timeout'));
    }, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));

    windowRef.addEventListener('message', onMessage);
    windowRef.postMessage({
      source: PAGE_SOURCE,
      type: 'PRINT_TO_PDF_REQUEST',
      requestId
    }, targetOrigin);
  });
}
