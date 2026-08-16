const PATCH_KEY = Symbol.for('taasiyeda.workSchedulePrintReliability');

function clean(value) {
  return String(value ?? '').trim();
}

export function instrumentWorkSchedulePrintWindow(printWindow) {
  if (!printWindow || printWindow[PATCH_KEY] || typeof printWindow.print !== 'function') return printWindow;
  const originalPrint = printWindow.print.bind(printWindow);
  let requested = false;
  let printed = false;

  const runPrint = () => {
    if (printed || printWindow.closed) return;
    printed = true;
    try { printWindow.focus?.(); } catch { /* ignore */ }
    originalPrint();
  };

  const printWhenReady = () => {
    const fontsReady = printWindow.document?.fonts?.ready;
    Promise.resolve(fontsReady).catch(() => undefined).then(() => {
      if (typeof printWindow.requestAnimationFrame === 'function') {
        printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(runPrint));
      } else if (typeof printWindow.setTimeout === 'function') {
        printWindow.setTimeout(runPrint, 40);
      } else {
        setTimeout(runPrint, 40);
      }
    });
  };

  printWindow.print = () => {
    if (requested) return;
    requested = true;
    const doc = printWindow.document;
    if (!doc || doc.readyState === 'complete') {
      printWhenReady();
      return;
    }
    try { printWindow.addEventListener?.('load', printWhenReady, { once: true }); } catch { /* ignore */ }
    // Some print-only windows created with document.write do not emit a useful load
    // event in every Chromium version. Keep a bounded fallback, but still wait for
    // document fonts before entering the native Save/Print dialog.
    const schedule = typeof printWindow.setTimeout === 'function' ? printWindow.setTimeout.bind(printWindow) : setTimeout;
    schedule(printWhenReady, 900);
  };

  try {
    Object.defineProperty(printWindow, PATCH_KEY, { value: true, configurable: false });
  } catch { /* window proxies can reject defineProperty; the wrapped print still works */ }
  return printWindow;
}

function isWorkSchedulePrintClick(event) {
  const button = event?.target?.closest?.('[data-ops-print]');
  if (!button) return false;
  return Boolean(button.closest?.('.ds-ops-mgmt-screen'));
}

export function installWorkSchedulePrintReliability(doc = globalThis.document, win = globalThis.window) {
  if (!doc || !win || doc.documentElement?.dataset?.workSchedulePrintReliability === '1') return false;
  if (doc.documentElement?.dataset) doc.documentElement.dataset.workSchedulePrintReliability = '1';

  doc.addEventListener('click', (event) => {
    if (!isWorkSchedulePrintClick(event) || typeof win.open !== 'function') return;
    const originalOpen = win.open;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      if (win.open === patchedOpen) win.open = originalOpen;
    };
    function patchedOpen(...args) {
      const child = originalOpen.apply(win, args);
      const url = clean(args[0]);
      // Operations work-schedule print opens a blank same-origin document and then
      // writes the printable HTML into it. Only instrument that exact kind of popup.
      if (child && !url) instrumentWorkSchedulePrintWindow(child);
      return child;
    }
    try { win.open = patchedOpen; } catch { return; }
    setTimeout(restore, 0);
  }, true);
  return true;
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  installWorkSchedulePrintReliability(document, window);
}
