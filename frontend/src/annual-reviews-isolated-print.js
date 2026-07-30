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

function cleanFieldText(text, label) {
  const value = String(text || '').trim();
  if (!value) return '—';
  if (!label || label === 'תשובה') return value;
  return `${label}: ${value}`;
}

function directText(node, selector) {
  return node.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function fieldValue(goal, label) {
  const field = [...goal.querySelectorAll('.ar2-field')]
    .find((item) => directText(item, ':scope > span') === label);
  const text = field?.querySelector('.ar2-print-static-value')?.textContent?.trim() || '—';
  return text.replace(new RegExp(`^${label}\\s*:\\s*`), '') || '—';
}

function buildGoalsTable(cloneRoot) {
  const goals = [...cloneRoot.querySelectorAll('.ar-safe-goal')];
  if (!goals.length) return;

  const table = document.createElement('table');
  table.className = 'ar2-print-goals-table';
  table.innerHTML = `<thead><tr>
    <th class="ar2-goal-number">מס׳</th>
    <th>יעד</th>
    <th>פעולות</th>
    <th>מדד הצלחה</th>
    <th>אחריות</th>
    <th>תאריך יעד</th>
  </tr></thead>`;

  const body = document.createElement('tbody');
  goals.forEach((goal, index) => {
    const title = directText(goal, ':scope > strong');
    const number = title.match(/\d+/)?.[0] || String(index + 1);
    const row = document.createElement('tr');
    [
      number,
      fieldValue(goal, 'היעד'),
      fieldValue(goal, 'פעולות מוסכמות'),
      fieldValue(goal, 'מדד הצלחה'),
      fieldValue(goal, 'אחריות'),
      fieldValue(goal, 'תאריך יעד')
    ].forEach((text, cellIndex) => {
      const cell = document.createElement(cellIndex === 0 ? 'th' : 'td');
      if (cellIndex === 0) cell.className = 'ar2-goal-number';
      cell.textContent = text;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });
  table.appendChild(body);

  const sourceContainer = goals[0].parentElement;
  const wrapper = document.createElement('div');
  wrapper.className = 'ar2-print-goals-wrap';
  wrapper.appendChild(table);
  sourceContainer?.replaceWith(wrapper);
}

function compactQuestions(cloneRoot) {
  cloneRoot.querySelectorAll('.ar2-question').forEach((question) => {
    const title = question.querySelector('.ar2-question__title');
    const rating = question.querySelector('.ar2-print-static-rating');
    const answer = question.querySelector('.ar2-print-answer');
    const hasAnswer = Boolean(answer && answer.textContent.trim() && answer.textContent.trim() !== '—');

    question.querySelector('.ar2-question__prompt')?.remove();

    if (!hasAnswer && !rating) {
      question.remove();
      return;
    }

    if (title) {
      const heading = document.createElement('div');
      heading.className = 'ar2-print-question-heading';
      heading.appendChild(title);
      if (rating) heading.appendChild(rating);
      question.prepend(heading);
    }
  });

  cloneRoot.querySelectorAll('.ar2-metric').forEach((metric) => {
    const title = metric.querySelector(':scope > strong');
    const rating = metric.querySelector('.ar2-print-static-rating');
    if (!title) return;
    const heading = document.createElement('div');
    heading.className = 'ar2-print-question-heading';
    heading.appendChild(title);
    if (rating) heading.appendChild(rating);
    metric.prepend(heading);
  });
}

function compactSectionHeaders(cloneRoot) {
  cloneRoot.querySelectorAll('.ar2-status').forEach((status) => status.remove());
  cloneRoot.querySelectorAll('.ar2-card__head').forEach((head) => {
    if (!head.closest('header.ar2-card')) {
      head.querySelectorAll('.ar2-muted').forEach((node) => node.remove());
    }
  });
  cloneRoot.querySelectorAll('.ar2-card__head > div').forEach((node) => {
    node.style.removeProperty('display');
  });
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
    const label = controlLabel(source);
    const extraClass = label === 'תשובה' ? 'ar2-print-answer' : '';
    clone.replaceWith(staticValue(cleanFieldText(source.value, label), extraClass));
  });

  const sourceSelects = [...sourceRoot.querySelectorAll('select.ar2-select')];
  const cloneSelects = [...cloneRoot.querySelectorAll('select.ar2-select')];
  sourceSelects.forEach((source, index) => {
    const clone = cloneSelects[index];
    if (!clone) return;
    const selected = source.selectedOptions?.[0]?.textContent?.trim() || '—';
    clone.replaceWith(staticValue(cleanFieldText(selected, controlLabel(source))));
  });

  const sourceInputs = [...sourceRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  const cloneInputs = [...cloneRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  sourceInputs.forEach((source, index) => {
    const clone = cloneInputs[index];
    if (!clone) return;
    clone.replaceWith(staticValue(cleanFieldText(source.value, controlLabel(source))));
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
    '.ar-safe-save',
    '.ar2-toast',
    '.ar2-progress',
    '[data-final-pdf-card]',
    'input[type="file"]',
    'button',
    'script'
  ].join(',')).forEach((node) => node.remove());

  compactSectionHeaders(cloneRoot);
  compactQuestions(cloneRoot);
  buildGoalsTable(cloneRoot);
}

function isolatedPrintCss() {
  return `
    @page { size: A4 portrait; margin: 10mm; }
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
      font-size: 10.2pt !important;
      line-height: 1.42 !important;
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
    .ar-safe-save,
    .ar2-toast,
    .ar2-progress,
    .ar2-status,
    [data-final-pdf-card],
    button,
    input[type="file"] { display: none !important; }

    .ar2-card {
      display: block !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 0 4mm !important;
      padding: 0 0 4mm !important;
      overflow: visible !important;
      visibility: visible !important;
      opacity: 1 !important;
      color: #111827 !important;
      background: #fff !important;
      border: 0 !important;
      border-bottom: 1px solid #cbd5e1 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    header.ar2-card {
      margin-bottom: 5mm !important;
      padding-bottom: 4mm !important;
      border-bottom: 2px solid #334155 !important;
    }
    .ar2-card__head {
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 5mm !important;
      margin: 0 0 2.5mm !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .ar2-card__head > div { width: 100% !important; }
    h1, h2, h3, p, strong, span, li, label, div, td, th {
      visibility: visible !important;
      opacity: 1 !important;
    }
    h1 { margin: 0 0 1.5mm !important; font-size: 18pt !important; line-height: 1.2 !important; }
    h2 {
      margin: 0 !important;
      padding: 0 0 1.5mm !important;
      font-size: 13.5pt !important;
      line-height: 1.25 !important;
      color: #0f172a !important;
    }
    h3 { margin: 2mm 0 1.5mm !important; font-size: 11.5pt !important; line-height: 1.25 !important; }
    p { margin: 1mm 0 !important; }
    .ar2-muted { color: #475569 !important; font-size: 9.5pt !important; line-height: 1.35 !important; }

    .ar2-question-list,
    .ar2-summary-grid,
    .ar2-metrics,
    .ar-safe-shared,
    .ar-safe-shared-grid {
      display: block !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .ar2-question,
    .ar2-metric {
      display: block !important;
      margin: 0 !important;
      padding: 2.2mm 0 !important;
      border: 0 !important;
      border-bottom: 1px solid #e2e8f0 !important;
      border-radius: 0 !important;
      background: #fff !important;
      color: #111827 !important;
      break-inside: auto !important;
      page-break-inside: auto !important;
      orphans: 3;
      widows: 3;
    }
    .ar2-question:last-child,
    .ar2-metric:last-child { border-bottom: 0 !important; }
    .ar2-print-question-heading {
      display: flex !important;
      align-items: baseline !important;
      justify-content: space-between !important;
      gap: 5mm !important;
      margin: 0 0 1mm !important;
      break-after: avoid !important;
      page-break-after: avoid !important;
    }
    .ar2-question__title,
    .ar2-print-question-heading > strong {
      margin: 0 !important;
      color: #0f172a !important;
      font-size: 10.5pt !important;
      font-weight: 700 !important;
      line-height: 1.3 !important;
    }
    .ar2-question__prompt { display: none !important; }
    .ar2-print-static-value {
      display: block !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #111827 !important;
      font-size: 10.2pt !important;
      line-height: 1.42 !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
      visibility: visible !important;
      opacity: 1 !important;
    }
    .ar2-print-static-rating {
      display: inline-block !important;
      width: auto !important;
      flex: 0 0 auto !important;
      padding: .7mm 2mm !important;
      border: 1px solid #94a3b8 !important;
      border-radius: 999px !important;
      color: #334155 !important;
      font-size: 9pt !important;
      font-weight: 700 !important;
      line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    .ar2-field {
      display: grid !important;
      grid-template-columns: minmax(34mm, auto) 1fr !important;
      align-items: start !important;
      gap: 3mm !important;
      margin: 0 !important;
      padding: 1.5mm 0 !important;
      border-bottom: 1px solid #e2e8f0 !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .ar2-field > span {
      color: #334155 !important;
      font-size: 9.5pt !important;
      font-weight: 700 !important;
    }
    .ar2-field .ar2-print-static-value { font-size: 9.8pt !important; }
    .ar2-check {
      display: flex !important;
      align-items: flex-start !important;
      gap: 2mm !important;
      margin-top: 2mm !important;
      font-size: 9.5pt !important;
      line-height: 1.35 !important;
    }
    .ar2-print-checkmark {
      display: inline-block !important;
      flex: 0 0 auto !important;
      font-size: 12pt !important;
      line-height: 1 !important;
    }

    .ar2-print-goals-wrap {
      margin-top: 2mm !important;
      overflow: visible !important;
    }
    .ar2-print-goals-table {
      width: 100% !important;
      border-collapse: collapse !important;
      table-layout: fixed !important;
      direction: rtl !important;
      font-size: 8.7pt !important;
      line-height: 1.3 !important;
    }
    .ar2-print-goals-table th,
    .ar2-print-goals-table td {
      padding: 1.7mm !important;
      border: 1px solid #cbd5e1 !important;
      vertical-align: top !important;
      text-align: right !important;
      white-space: pre-wrap !important;
      overflow-wrap: anywhere !important;
    }
    .ar2-print-goals-table thead th {
      background: #f1f5f9 !important;
      color: #0f172a !important;
      font-weight: 700 !important;
    }
    .ar2-print-goals-table th:nth-child(1) { width: 6% !important; }
    .ar2-print-goals-table th:nth-child(2) { width: 20% !important; }
    .ar2-print-goals-table th:nth-child(3) { width: 28% !important; }
    .ar2-print-goals-table th:nth-child(4) { width: 24% !important; }
    .ar2-print-goals-table th:nth-child(5) { width: 10% !important; }
    .ar2-print-goals-table th:nth-child(6) { width: 12% !important; }
    .ar2-goal-number { text-align: center !important; font-weight: 700 !important; }

    .ar2-guide { margin: 1mm 0 0 !important; padding-inline-start: 6mm !important; }
    .ar2-guide li { margin-bottom: 1mm !important; }
    .ar2-signatures {
      display: grid !important;
      grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4mm !important;
      margin-top: 3mm !important;
      padding-top: 3mm !important;
      border-top: 1px solid #94a3b8 !important;
      border-bottom: 0 !important;
      font-size: 9.5pt !important;
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
