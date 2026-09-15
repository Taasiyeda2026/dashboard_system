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

async function inspectPrintableProposal(target) {
  const expression = `
    (async () => {
      const proposal = document.querySelector('.proposal-preview-area .proposal-document');
      if (!proposal) {
        return {
          ok: false,
          reason: 'proposal_not_found',
          title: document.title,
          bodyClass: document.body.className
        };
      }

      try { await document.fonts?.ready; } catch {}
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const rect = proposal.getBoundingClientRect();
      const style = getComputedStyle(proposal);
      return {
        ok: true,
        title: document.title,
        bodyClass: document.body.className,
        textLength: (proposal.innerText || '').trim().length,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity
      };
    })()
  `;

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result?.result?.value || null;
}

async function waitForPrintRender(target) {
  const expression = `
    (async () => {
      try { await document.fonts?.ready; } catch {}
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const proposal = document.querySelector('.proposal-preview-area .proposal-document');
      const rect = proposal?.getBoundingClientRect?.();
      return {
        exists: !!proposal,
        textLength: (proposal?.innerText || '').trim().length,
        width: rect ? Math.round(rect.width) : 0,
        height: rect ? Math.round(rect.height) : 0,
        bodyClass: document.body.className
      };
    })()
  `;

  const result = await sendDebuggerCommand(target, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  return result?.result?.value || null;
}

async function printTabToPdf(tabId) {
  const target = { tabId };
  let attached = false;
  let mediaOverridden = false;
  try {
    await attachDebugger(target);
    attached = true;
    await sendDebuggerCommand(target, 'Page.enable');
    await sendDebuggerCommand(target, 'Runtime.enable');

    const before = await inspectPrintableProposal(target);
    if (!before?.ok) {
      throw new Error(`proposal_pdf_diagnostic_${before?.reason || 'unknown'}`);
    }
    if (!Number(before.textLength) || before.textLength < 50) {
      throw new Error('proposal_pdf_diagnostic_empty_text');
    }
    if (!Number(before.width) || !Number(before.height)) {
      throw new Error('proposal_pdf_diagnostic_zero_size');
    }

    await sendDebuggerCommand(target, 'Emulation.setEmulatedMedia', { media: 'print' });
    mediaOverridden = true;

    const after = await waitForPrintRender(target);
    if (!after?.exists || Number(after.textLength) < 50) {
      throw new Error('proposal_pdf_diagnostic_missing_after_print_media');
    }

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
    if (mediaOverridden) {
      try { await sendDebuggerCommand(target, 'Emulation.setEmulatedMedia', { media: '' }); } catch { /* best-effort cleanup */ }
    }
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
