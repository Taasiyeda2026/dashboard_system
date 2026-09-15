const READY_ATTR = 'data-taasiyeda-proposal-pdf-extension';
const PAGE_SOURCE = 'taasiyeda-proposal-pdf-page';
const EXTENSION_SOURCE = 'taasiyeda-proposal-pdf-extension';

function markReady() {
  document.documentElement?.setAttribute(READY_ATTR, 'ready');
}

markReady();
if (!document.documentElement) {
  document.addEventListener('DOMContentLoaded', markReady, { once: true });
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== PAGE_SOURCE || message.type !== 'PRINT_TO_PDF_REQUEST') return;

  const requestId = String(message.requestId || '');
  if (!requestId) return;

  void chrome.runtime.sendMessage({ type: 'TAASIYEDA_PROPOSAL_PRINT_TO_PDF' })
    .then((response) => {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'PRINT_TO_PDF_RESPONSE',
        requestId,
        ok: Boolean(response?.ok),
        data: response?.data || '',
        error: response?.error || ''
      }, window.location.origin);
    })
    .catch((error) => {
      window.postMessage({
        source: EXTENSION_SOURCE,
        type: 'PRINT_TO_PDF_RESPONSE',
        requestId,
        ok: false,
        data: '',
        error: String(error?.message || error || 'proposal_pdf_extension_failed')
      }, window.location.origin);
    });
});
