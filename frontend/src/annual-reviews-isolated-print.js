const PRINT_BUTTON_SELECTOR = '[data-ar2-print]';
const FRAME_ATTR = 'data-ar2-isolated-print-frame';

function escapeAttribute(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function staticValue(text, extraClass = '') {
  const value = document.createElement('div');
  value.className = `ar2-print-static-value${extraClass ? ` ${extraClass}` : ''}`;
  value.textContent = text;
  return value;
}

function controlLabel(control) {
  if (control.matches('[data-ar2-metric-comment]')) return 'הערה';
  if (control.closest('.ar2-question')) return 'תשובה';
  return control.closest('.ar2-field')?.querySelector(':scope > span')?.textContent?.trim() || 'תשובה';
}

function staticizeReview(sourceRoot, cloneRoot) {
  const sourceRatings = [...sourceRoot.querySelectorAll('.ar2-rating-wrap')];
  const cloneRatings = [...cloneRoot.querySelectorAll('.ar2-rating-wrap')];
  sourceRatings.forEach((source, index) => {
    const clone = cloneRatings[index];
    if (!clone) return;
    const selected = source.querySelector('.ar2-rating.is-selected');
    const label = source.querySelector('.ar2-rating-label')?.textContent?.trim();
    const prefix = label ? `${label} ` : 'דירוג: ';
    clone.replaceWith(staticValue(`${prefix}${selected?.textContent?.trim() || 'לא צוין'}`, 'ar2-print-static-rating'));
  });

  const sourceTextareas = [...sourceRoot.querySelectorAll('textarea.ar2-textarea')];
  const cloneTextareas = [...cloneRoot.querySelectorAll('textarea.ar2-textarea')];
  sourceTextareas.forEach((source, index) => {
    const clone = cloneTextareas[index];
    if (!clone) return;
    clone.replaceWith(staticValue(`${controlLabel(source)}: ${source.value?.trim() || '—'}`));
  });

  const sourceSelects = [...sourceRoot.querySelectorAll('select.ar2-select')];
  const cloneSelects = [...cloneRoot.querySelectorAll('select.ar2-select')];
  sourceSelects.forEach((source, index) => {
    const clone = cloneSelects[index];
    if (!clone) return;
    const selected = source.selectedOptions?.[0]?.textContent?.trim() || '—';
    clone.replaceWith(staticValue(`${controlLabel(source)}: ${selected}`));
  });

  const sourceInputs = [...sourceRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  const cloneInputs = [...cloneRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  sourceInputs.forEach((source, index) => {
    const clone = cloneInputs[index];
    if (!clone) return;
    clone.replaceWith(staticValue(`${controlLabel(source)}: ${source.value?.trim() || '—'}`));
  });

  const sourceChecks = [...sourceRoot.querySelectorAll('input[type="checkbox"]')];
  const cloneChecks = [...cloneRoot.querySelectorAll('input[type="checkbox"]')];
  sourceChecks.forEach((source, index) => {
    const clone = cloneChecks[index];
    if (!clone) return;
    clone.checked = source.checked;
    if (source.checked) clone.setAttribute('checked', '');
    else clone.removeAttribute('checked');
  });

  cloneRoot.querySelectorAll([
    '.ar2-no-print',
    '.ar2-topbar',
    '.ar2-save',
    '.ar2-toast',
    '[data-final-pdf-card]',
    'input[type="file"]',
    'script'
  ].join(',')).forEach((node) => node.remove());
}

function headResourcesHtml() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .map((link) => `<link rel="stylesheet" href="${escapeAttribute(link.href)}"${link.media ? ` media="${escapeAttribute(link.media)}"` : ''}>`)
    .join('');
  const styles = [...document.querySelectorAll('style')].map((style) => style.outerHTML).join('');
  return `${links}${styles}`;
}

function isolatedPrintCss() {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      background: #fff !important;
      color: #111827 !important;
      direction: rtl !important;
    }
    body { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif !important; }
    #app, #app .ar2-screen, #app .ar2-body {
      display: block !important;
      position: static !important;
      width: 100% !important;
      max-width: none !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
      transform: none !important;
      zoom: 1 !important;
      contain: none !important;
    }
    #app .ar2-topbar,
    #app .ar2-no-print,
    #app .ar2-private,
    #app [data-final-pdf-card],
    #app .ar2-save,
    #app button { display: none !important; }
    #app .ar2-card {
      display: block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 0 7mm !important;
      padding: 5mm !important;
      overflow: visible !important;
      box-shadow: none !important;
      border: 1px solid #cbd5e1 !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    #app .ar2-question,
    #app .ar2-metric,
    #app .ar2-card__head,
    #app .ar2-signatures {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    #app .ar2-question-list,
    #app .ar2-summary-grid,
    #app .ar2-metrics { display: grid !important; gap: 4mm !important; }
    #app .ar2-print-static-value {
      display: block !important;
      margin-top: 2mm !important;
      padding: 2.5mm 3mm !important;
      border: 1px solid #d7dde7 !important;
      border-radius: 2mm !important;
      background: #fff !important;
      color: #111827 !important;
      font-size: 10.5pt !important;
      line-height: 1.45 !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    #app .ar2-print-static-rating { font-weight: 700 !important; }
    #app input[type="checkbox"] { accent-color: #111827; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  `;
}

function buildPrintDocument(sourceRoot) {
  const clone = sourceRoot.cloneNode(true);
  staticizeReview(sourceRoot, clone);
  const heading = sourceRoot.querySelector('h1')?.textContent?.trim() || 'משוב שנתי';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${escapeAttribute(document.baseURI)}">
  <title>${escapeAttribute(heading)}</title>
  ${headResourcesHtml()}
  <style id="annual-review-isolated-print-overrides">${isolatedPrintCss()}</style>
</head>
<body class="ar2-printing">
  <main id="app">${clone.outerHTML}</main>
</body>
</html>`;
}

function createPrintFrame() {
  document.querySelectorAll(`[${FRAME_ATTR}]`).forEach((frame) => frame.remove());
  const frame = document.createElement('iframe');
  frame.setAttribute(FRAME_ATTR, 'true');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-12000px';
  frame.style.top = '0';
  frame.style.width = '1000px';
  frame.style.height = '1400px';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  frame.style.background = '#fff';
  document.body.appendChild(frame);
  return frame;
}

function waitForStylesheet(link, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      resolve();
    };
    try {
      if (link.sheet) return finish();
    } catch {}
    link.addEventListener('load', finish, { once: true });
    link.addEventListener('error', finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

async function waitForPrintAssets(frame) {
  const doc = frame.contentDocument;
  if (!doc) throw new Error('print_document_unavailable');
  await Promise.all([...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) => waitForStylesheet(link)));
  if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {});
  await Promise.all([...doc.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 1500);
  })));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function printIsolatedReview(sourceRoot) {
  const frame = createPrintFrame();
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    throw new Error('print_document_unavailable');
  }

  doc.open();
  doc.write(buildPrintDocument(sourceRoot));
  doc.close();
  await waitForPrintAssets(frame);

  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error('print_window_unavailable');
  }

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    frame.remove();
  };
  printWindow.addEventListener('afterprint', () => setTimeout(cleanup, 0), { once: true });
  setTimeout(cleanup, 120000);
  printWindow.focus();
  printWindow.print();
}

async function handlePrintClick(event, button) {
  const sourceRoot = button.closest('.ar2-screen') || document.querySelector('#app .ar2-screen');
  if (!sourceRoot || button.disabled) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'מכין את המשוב להדפסה…';
  try {
    await printIsolatedReview(sourceRoot);
  } catch (error) {
    console.error('[annual-review isolated print]', error);
    window.alert('לא ניתן היה להכין את המשוב להדפסה. יש לרענן את העמוד ולנסות שוב.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(PRINT_BUTTON_SELECTOR);
  if (!button) return;
  handlePrintClick(event, button);
}, true);
