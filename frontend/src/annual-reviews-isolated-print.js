const PRINT_BUTTON_SELECTOR = '[data-ar2-print]';

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
    const prefix = label ? `${label}: ` : 'דירוג: ';
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
    const mark = document.createElement('span');
    mark.className = 'ar2-print-checkmark';
    mark.textContent = source.checked ? '☑' : '☐';
    clone.replaceWith(mark);
  });

  cloneRoot.querySelectorAll([
    '.ar2-no-print',
    '.ar2-topbar',
    '.ar2-save',
    '.ar2-toast',
    '.ar2-progress',
    '[data-final-pdf-card]',
    'input[type="file"]',
    'button',
    'script'
  ].join(',')).forEach((node) => node.remove());
}

function isolatedPrintCss() {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    *, *::before, *::after { box-sizing: border-box !important; }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      background: #fff !important;
      color: #111827 !important;
      direction: rtl !important;
    }
    body {
      font-family: Arial, "Segoe UI", sans-serif !important;
      font-size: 10.5pt !important;
      line-height: 1.45 !important;
    }
    #app, .ar2-screen, .ar2-body {
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
      visibility: visible !important;
      opacity: 1 !important;
      transform: none !important;
      zoom: 1 !important;
      contain: none !important;
      color: #111827 !important;
      background: #fff !important;
    }
    .ar2-topbar,
    .ar2-no-print,
    .ar2-private,
    .ar2-save,
    .ar2-toast,
    .ar2-progress,
    [data-final-pdf-card],
    button,
    input[type="file"] { display: none !important; }
    .ar2-card {
      display: block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 0 7mm !important;
      padding: 5mm !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      color: #111827 !important;
      background: #fff !important;
      border: 1px solid #cbd5e1 !important;
      border-radius: 3mm !important;
      box-shadow: none !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    .ar2-card__head {
      display: flex !important;
      align-items: flex-start !important;
      justify-content: space-between !important;
      gap: 5mm !important;
      margin: 0 0 4mm !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    h1, h2, h3, p, strong, span, li, label, div {
      visibility: visible !important;
      opacity: 1 !important;
    }
    h1 { margin: 0 0 2mm !important; font-size: 18pt !important; line-height: 1.25 !important; }
    h2 { margin: 0 !important; font-size: 14pt !important; line-height: 1.3 !important; }
    h3 { margin: 3mm 0 2mm !important; font-size: 11.5pt !important; line-height: 1.3 !important; }
    p { margin: 1.5mm 0 !important; }
    .ar2-muted { color: #475569 !important; }
    .ar2-status {
      display: inline-block !important;
      padding: 1.5mm 3mm !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 999px !important;
      background: #fff !important;
      color: #334155 !important;
      font-size: 9pt !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
    }
    .ar2-question-list,
    .ar2-summary-grid,
    .ar2-metrics {
      display: grid !important;
      gap: 4mm !important;
    }
    .ar2-question,
    .ar2-metric {
      display: block !important;
      padding: 3.5mm !important;
      border: 1px solid #d7dde7 !important;
      border-radius: 2.5mm !important;
      background: #fff !important;
      color: #111827 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .ar2-question__title { margin-bottom: 1mm !important; font-weight: 700 !important; }
    .ar2-question__prompt { margin: 0 0 2mm !important; color: #475569 !important; }
    .ar2-print-static-value {
      display: block !important;
      width: 100% !important;
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
      visibility: visible !important;
      opacity: 1 !important;
    }
    .ar2-print-static-rating { font-weight: 700 !important; }
    .ar2-print-checkmark { display: inline-block !important; margin-inline-end: 2mm !important; font-size: 13pt !important; }
    .ar2-guide { margin: 2mm 0 0 !important; padding-inline-start: 7mm !important; }
    .ar2-guide li { margin-bottom: 1.5mm !important; }
    .ar2-signatures {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4mm !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    [hidden] { display: none !important; }
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
  <title>${heading.replace(/[<>&"]/g, '')}</title>
  <style>${isolatedPrintCss()}</style>
</head>
<body>
  <main id="app">${clone.outerHTML}</main>
</body>
</html>`;
}

function openPrintWindow() {
  const name = `annual-review-print-${Date.now()}`;
  const printWindow = window.open('', name, 'popup=yes,width=1000,height=900');
  if (!printWindow) throw new Error('print_popup_blocked');
  try { printWindow.opener = null; } catch {}
  printWindow.document.open();
  printWindow.document.write('<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><title>מכין משוב להדפסה</title></head><body style="font-family:Arial,sans-serif;direction:rtl;padding:24px">מכין את המשוב להדפסה…</body></html>');
  printWindow.document.close();
  return printWindow;
}

async function waitForPrintDocument(printWindow) {
  const doc = printWindow.document;
  if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {});
  await Promise.all([...doc.images].map((image) => image.complete ? Promise.resolve() : new Promise((resolve) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', resolve, { once: true });
    setTimeout(resolve, 1500);
  })));
  await new Promise((resolve) => setTimeout(resolve, 120));
}

async function printStandaloneReview(sourceRoot, printWindow) {
  const doc = printWindow.document;
  doc.open();
  doc.write(buildPrintDocument(sourceRoot));
  doc.close();
  await waitForPrintDocument(printWindow);

  printWindow.addEventListener('afterprint', () => {
    setTimeout(() => {
      try { printWindow.close(); } catch {}
    }, 0);
  }, { once: true });

  printWindow.focus();
  printWindow.print();
}

async function handlePrintClick(event, button) {
  const sourceRoot = button.closest('.ar2-screen') || document.querySelector('#app .ar2-screen');
  if (!sourceRoot || button.disabled) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  let printWindow;
  try {
    printWindow = openPrintWindow();
  } catch (error) {
    console.error('[annual-review standalone print]', error);
    window.alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.');
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'מכין את המשוב להדפסה…';
  try {
    await printStandaloneReview(sourceRoot, printWindow);
  } catch (error) {
    console.error('[annual-review standalone print]', error);
    try { printWindow.close(); } catch {}
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
