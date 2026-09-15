const ALLOWED_ORIGIN = 'https://taasiyeda2026.github.io';
const ALLOWED_PATH_PREFIX = '/dashboard_system/';
const DEBUGGER_PROTOCOL_VERSION = '1.3';

function isAllowedDashboardUrl(rawUrl = '') {
  try {
    const url = new URL(rawUrl);
    return url.origin === ALLOWED_ORIGIN && url.pathname.startsWith(ALLOWED_PATH_PREFIX);
  } catch {
    return false;
  }
}

function chromeCall(register) {
  return new Promise((resolve, reject) => {
    register((result) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message || 'chrome_api_failed'));
      else resolve(result);
    });
  });
}

function attachDebugger(target) {
  return chromeCall((done) => chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION, done));
}

function detachDebugger(target) {
  return chromeCall((done) => chrome.debugger.detach(target, done));
}

function sendDebuggerCommand(target, method, params = {}) {
  return chromeCall((done) => chrome.debugger.sendCommand(target, method, params, done));
}

async function printTabToPdf(tabId) {
  const target = { tabId };
  let attached = false;
  try {
    await attachDebugger(target);
    attached = true;
    await sendDebuggerCommand(target, 'Page.enable');
    const result = await sendDebuggerCommand(target, 'Page.printToPDF', {
      landscape: false,
      displayHeaderFooter: false,
      printBackground: true,
      preferCSSPageSize: true,
      paperWidth: 8.27,
      paperHeight: 11.69,
      scale: 1,
      transferMode: 'ReturnAsBase64'
    });
    const data = String(result?.data || '');
    if (!data) throw new Error('proposal_pdf_empty_result');
    return data;
  } finally {
    if (attached) {
      try { await detachDebugger(target); } catch { /* best-effort cleanup */ }
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'TAASIYEDA_PROPOSAL_PRINT_TO_PDF') return false;

  const tabId = sender?.tab?.id;
  const tabUrl = sender?.tab?.url || '';
  if (!Number.isInteger(tabId) || !isAllowedDashboardUrl(tabUrl)) {
    sendResponse({ ok: false, error: 'proposal_pdf_untrusted_tab' });
    return false;
  }

  void printTabToPdf(tabId)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({
      ok: false,
      error: String(error?.message || error || 'proposal_pdf_failed')
    }));

  return true;
});
