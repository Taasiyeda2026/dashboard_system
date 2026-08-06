const PRINT_BUTTON_SELECTOR = '[data-ar2-print]';

function printableValue(text, className = '') {
  const node = document.createElement('div');
  node.className = `ar2-readable-value${className ? ` ${className}` : ''}`;
  node.textContent = String(text || '').trim();
  return node;
}

function selectedRating(wrap) {
  return wrap?.querySelector('.ar2-rating.is-selected')?.textContent?.trim() || '';
}

function controlLabel(control) {
  if (control.matches('[data-ar2-metric-comment]')) return 'הערה';
  if (control.closest('.ar2-question')) return '';
  return control.closest('.ar2-field')?.querySelector(':scope > span')?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function replaceRatings(sourceRoot, cloneRoot) {
  const sourceRatings = [...sourceRoot.querySelectorAll('.ar2-rating-wrap')];
  const cloneRatings = [...cloneRoot.querySelectorAll('.ar2-rating-wrap')];
  sourceRatings.forEach((source, index) => {
    const clone = cloneRatings[index];
    if (!clone) return;
    const value = selectedRating(source);
    if (!value) {
      clone.remove();
      return;
    }
    const label = source.querySelector('.ar2-rating-label')?.textContent?.replace(/:+$/, '').trim() || 'דירוג';
    const badge = printableValue(`${label}: ${value}`, 'ar2-readable-rating');
    clone.replaceWith(badge);
  });
}

function replaceTextareas(sourceRoot, cloneRoot) {
  const sourceControls = [...sourceRoot.querySelectorAll('textarea.ar2-textarea')];
  const cloneControls = [...cloneRoot.querySelectorAll('textarea.ar2-textarea')];
  sourceControls.forEach((source, index) => {
    const clone = cloneControls[index];
    if (!clone) return;
    const value = source.value?.trim() || '';
    if (!value) {
      clone.remove();
      return;
    }
    const label = controlLabel(source);
    const className = source.matches('[data-ar2-metric-comment]') ? 'ar2-readable-comment' : 'ar2-readable-answer';
    clone.replaceWith(printableValue(label ? `${label}: ${value}` : value, className));
  });
}

function replaceSelects(sourceRoot, cloneRoot) {
  const sourceControls = [...sourceRoot.querySelectorAll('select.ar2-select')];
  const cloneControls = [...cloneRoot.querySelectorAll('select.ar2-select')];
  sourceControls.forEach((source, index) => {
    const clone = cloneControls[index];
    if (!clone) return;
    const value = source.selectedOptions?.[0]?.textContent?.trim() || '';
    if (!value || value === 'בחירה') {
      clone.remove();
      return;
    }
    const label = controlLabel(source);
    clone.replaceWith(printableValue(label ? `${label}: ${value}` : value));
  });
}

function replaceInputs(sourceRoot, cloneRoot) {
  const sourceControls = [...sourceRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  const cloneControls = [...cloneRoot.querySelectorAll('input.ar2-input:not([type="file"])')];
  sourceControls.forEach((source, index) => {
    const clone = cloneControls[index];
    if (!clone) return;
    const value = source.value?.trim() || '';
    if (!value) {
      clone.remove();
      return;
    }
    const label = controlLabel(source);
    clone.replaceWith(printableValue(label ? `${label}: ${value}` : value));
  });
}

function replaceCheckboxes(sourceRoot, cloneRoot) {
  const sourceControls = [...sourceRoot.querySelectorAll('input[type="checkbox"]')];
  const cloneControls = [...cloneRoot.querySelectorAll('input[type="checkbox"]')];
  sourceControls.forEach((source, index) => {
    const clone = cloneControls[index];
    if (!clone) return;
    const mark = document.createElement('span');
    mark.className = 'ar2-readable-checkmark';
    mark.textContent = source.checked ? '☑' : '☐';
    clone.replaceWith(mark);
  });
}

function directText(node, selector) {
  return node.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function goalFieldValue(goal, label) {
  const field = [...goal.querySelectorAll('.ar2-field')]
    .find((item) => directText(item, ':scope > span') === label);
  const value = field?.querySelector('.ar2-readable-value')?.textContent?.trim() || '';
  return value.replace(new RegExp(`^${label}\\s*:\\s*`), '') || '—';
}

function buildGoalsTable(cloneRoot) {
  const goals = [...cloneRoot.querySelectorAll('.ar-safe-goal')];
  if (!goals.length) return;

  const table = document.createElement('table');
  table.className = 'ar2-readable-goals-table';
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
    const row = document.createElement('tr');
    const values = [
      title.match(/\d+/)?.[0] || String(index + 1),
      goalFieldValue(goal, 'היעד'),
      goalFieldValue(goal, 'פעולות מוסכמות'),
      goalFieldValue(goal, 'מדד הצלחה'),
      goalFieldValue(goal, 'אחריות'),
      goalFieldValue(goal, 'תאריך יעד')
    ];
    values.forEach((value, cellIndex) => {
      const cell = document.createElement(cellIndex === 0 ? 'th' : 'td');
      if (cellIndex === 0) cell.className = 'ar2-goal-number';
      cell.textContent = value;
      row.appendChild(cell);
    });
    body.appendChild(row);
  });

  table.appendChild(body);
  const wrap = document.createElement('div');
  wrap.className = 'ar2-readable-goals-wrap';
  wrap.appendChild(table);
  goals[0].parentElement?.replaceWith(wrap);
}

function organizeQuestions(cloneRoot) {
  cloneRoot.querySelectorAll('.ar2-question').forEach((question) => {
    const title = question.querySelector('.ar2-question__title');
    const rating = question.querySelector('.ar2-readable-rating');
    const answer = question.querySelector('.ar2-readable-answer');
    if (!answer && !rating) {
      question.remove();
      return;
    }
    if (title) {
      const heading = document.createElement('div');
      heading.className = 'ar2-readable-question-heading';
      heading.appendChild(title);
      if (rating) heading.appendChild(rating);
      question.prepend(heading);
    }
  });

  cloneRoot.querySelectorAll('.ar2-metric').forEach((metric) => {
    const title = metric.querySelector(':scope > strong');
    const rating = metric.querySelector('.ar2-readable-rating');
    const comment = metric.querySelector('.ar2-readable-comment');
    if (!rating && !comment) {
      metric.remove();
      return;
    }
    if (title) {
      const heading = document.createElement('div');
      heading.className = 'ar2-readable-question-heading';
      heading.appendChild(title);
      if (rating) heading.appendChild(rating);
      metric.prepend(heading);
    }
  });

  cloneRoot.querySelectorAll('.ar2-metrics').forEach((metrics) => {
    if (metrics.querySelector('.ar2-metric')) return;
    const parent = metrics.parentElement;
    if (parent && parent.querySelector(':scope > h3')) parent.remove();
    else metrics.remove();
  });
}

function cleanFields(cloneRoot) {
  cloneRoot.querySelectorAll('.ar2-field').forEach((field) => {
    if (!field.querySelector('.ar2-readable-value')) field.remove();
  });
}

function cleanSectionHeaders(cloneRoot) {
  cloneRoot.querySelectorAll('.ar2-status').forEach((node) => node.remove());
  cloneRoot.querySelectorAll('.ar2-card__head').forEach((head) => {
    if (!head.closest('header.ar2-card')) head.querySelectorAll('.ar2-muted').forEach((node) => node.remove());
  });
}

function prepareClone(sourceRoot) {
  const cloneRoot = sourceRoot.cloneNode(true);
  replaceRatings(sourceRoot, cloneRoot);
  replaceTextareas(sourceRoot, cloneRoot);
  replaceSelects(sourceRoot, cloneRoot);
  replaceInputs(sourceRoot, cloneRoot);
  replaceCheckboxes(sourceRoot, cloneRoot);

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

  cleanSectionHeaders(cloneRoot);
  organizeQuestions(cloneRoot);
  buildGoalsTable(cloneRoot);
  cleanFields(cloneRoot);
  return cloneRoot;
}

function printCss() {
  return `
    @page { size: A4 portrait; margin: 12mm; }
    *, *::before, *::after { box-sizing: border-box !important; }
    html, body {
      margin: 0 !important; padding: 0 !important; width: 100% !important;
      height: auto !important; overflow: visible !important;
      visibility: visible !important; opacity: 1 !important;
      background: #fff !important; color: #172033 !important; direction: rtl !important;
    }
    body {
      font-family: Arial, "Segoe UI", sans-serif !important;
      font-size: 10.7pt !important; line-height: 1.48 !important;
    }
    #app, .ar2-screen, .ar2-body {
      display: block !important; position: static !important; width: 100% !important;
      max-width: none !important; height: auto !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; overflow: visible !important;
      visibility: visible !important; opacity: 1 !important; transform: none !important;
      zoom: 1 !important; contain: none !important; background: #fff !important;
    }
    .ar2-topbar, .ar2-no-print, .ar2-private, .ar2-save, .ar-safe-save,
    .ar2-toast, .ar2-progress, .ar2-status, [data-final-pdf-card], button,
    input[type="file"] { display: none !important; }
    h1, h2, h3, p, strong, span, li, label, div, td, th {
      visibility: visible !important; opacity: 1 !important;
    }
    .ar2-card {
      display: block !important; width: 100% !important; height: auto !important;
      margin: 0 0 4.5mm !important; padding: 4mm !important;
      overflow: visible !important; background: #fff !important;
      border: 1px solid #cbd5e1 !important; border-radius: 2.5mm !important;
      box-shadow: none !important; break-inside: auto !important;
      page-break-inside: auto !important;
    }
    header.ar2-card {
      padding: 4.5mm !important; border-top: 3px solid #334155 !important;
    }
    .ar2-card__head {
      display: block !important; margin: 0 0 3mm !important;
      break-inside: avoid !important; page-break-inside: avoid !important;
    }
    h1 { margin: 0 0 1.5mm !important; font-size: 18pt !important; line-height: 1.2 !important; }
    h2 { margin: 0 !important; font-size: 14pt !important; line-height: 1.3 !important; color: #0f172a !important; }
    h3 { margin: 3mm 0 2mm !important; font-size: 11.5pt !important; line-height: 1.3 !important; }
    p { margin: 1.5mm 0 !important; }
    .ar2-muted { color: #526176 !important; font-size: 9.8pt !important; line-height: 1.4 !important; }
    .ar2-question-list, .ar2-summary-grid, .ar2-metrics,
    .ar-safe-shared, .ar-safe-shared-grid {
      display: block !important; margin: 0 !important; padding: 0 !important;
    }
    .ar2-question, .ar2-metric {
      display: block !important; margin: 0 !important; padding: 3mm 0 !important;
      border: 0 !important; border-bottom: 1px solid #dbe3ee !important;
      background: #fff !important; break-inside: auto !important;
      page-break-inside: auto !important; orphans: 3; widows: 3;
    }
    .ar2-question:last-child, .ar2-metric:last-child { border-bottom: 0 !important; }
    .ar2-readable-question-heading {
      display: flex !important; align-items: flex-start !important;
      justify-content: space-between !important; gap: 5mm !important;
      margin: 0 0 1mm !important; break-after: avoid !important;
      page-break-after: avoid !important;
    }
    .ar2-question__title, .ar2-readable-question-heading > strong {
      margin: 0 !important; color: #0f172a !important; font-size: 11pt !important;
      font-weight: 700 !important; line-height: 1.35 !important;
    }
    .ar2-question__prompt {
      display: block !important; margin: 0 0 1.7mm !important;
      color: #526176 !important; font-size: 9.7pt !important; line-height: 1.4 !important;
    }
    .ar2-readable-value {
      display: block !important; width: 100% !important; margin: 0 !important;
      padding: 0 !important; border: 0 !important; background: transparent !important;
      color: #172033 !important; font-size: 10.5pt !important; line-height: 1.48 !important;
      white-space: pre-wrap !important; overflow-wrap: anywhere !important;
    }
    .ar2-readable-answer, .ar2-readable-comment {
      padding: 2.4mm 3mm !important; background: #f8fafc !important;
      border-right: 2px solid #94a3b8 !important; border-radius: 1.5mm !important;
    }
    .ar2-readable-rating {
      display: inline-block !important; width: auto !important; flex: 0 0 auto !important;
      padding: .8mm 2.2mm !important; border: 1px solid #64748b !important;
      border-radius: 999px !important; color: #334155 !important;
      font-size: 9.3pt !important; font-weight: 700 !important; line-height: 1.2 !important;
      white-space: nowrap !important;
    }
    .ar2-field {
      display: grid !important; grid-template-columns: 36mm 1fr !important;
      gap: 4mm !important; align-items: start !important; padding: 2mm 0 !important;
      border-bottom: 1px solid #e2e8f0 !important; break-inside: avoid !important;
    }
    .ar2-field > span { color: #334155 !important; font-size: 10pt !important; font-weight: 700 !important; }
    .ar2-check { display: flex !important; align-items: flex-start !important; gap: 2mm !important; margin-top: 2mm !important; }
    .ar2-readable-checkmark { flex: 0 0 auto !important; font-size: 12pt !important; line-height: 1 !important; }
    .ar2-readable-goals-wrap { margin-top: 2mm !important; overflow: visible !important; }
    .ar2-readable-goals-table {
      width: 100% !important; border-collapse: collapse !important; table-layout: fixed !important;
      direction: rtl !important; font-size: 9pt !important; line-height: 1.35 !important;
    }
    .ar2-readable-goals-table th, .ar2-readable-goals-table td {
      padding: 2mm !important; border: 1px solid #b8c4d3 !important;
      vertical-align: top !important; text-align: right !important;
      white-space: pre-wrap !important; overflow-wrap: anywhere !important;
    }
    .ar2-readable-goals-table thead th { background: #eef2f7 !important; font-weight: 700 !important; }
    .ar2-readable-goals-table th:nth-child(1) { width: 6% !important; }
    .ar2-readable-goals-table th:nth-child(2) { width: 20% !important; }
    .ar2-readable-goals-table th:nth-child(3) { width: 27% !important; }
    .ar2-readable-goals-table th:nth-child(4) { width: 24% !important; }
    .ar2-readable-goals-table th:nth-child(5) { width: 10% !important; }
    .ar2-readable-goals-table th:nth-child(6) { width: 13% !important; }
    .ar2-goal-number { text-align: center !important; font-weight: 700 !important; }
    .ar2-signatures {
      display: grid !important; grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
      gap: 4mm !important; font-size: 9.8pt !important; break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    [hidden] { display: none !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  `;
}

function buildPrintDocument(sourceRoot) {
  const clone = prepareClone(sourceRoot);
  const heading = sourceRoot.querySelector('h1')?.textContent?.trim() || 'משוב שנתי';
  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${heading.replace(/[<>&"]/g, '')}</title>
  <style>${printCss()}</style>
</head>
<body><main id="app">${clone.outerHTML}</main></body>
</html>`;
}

function openPrintWindow() {
  const printWindow = window.open('', `annual-review-readable-${Date.now()}`, 'popup=yes,width=1000,height=900');
  if (!printWindow) throw new Error('print_popup_blocked');
  try { printWindow.opener = null; } catch {}
  return printWindow;
}

async function printReview(sourceRoot, printWindow) {
  const doc = printWindow.document;
  doc.open();
  doc.write(buildPrintDocument(sourceRoot));
  doc.close();
  if (doc.fonts?.ready) await doc.fonts.ready.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 150));
  printWindow.addEventListener('afterprint', () => setTimeout(() => {
    try { printWindow.close(); } catch {}
  }, 0), { once: true });
  printWindow.focus();
  printWindow.print();
}

document.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest(PRINT_BUTTON_SELECTOR);
  if (!button || button.disabled) return;
  const sourceRoot = button.closest('.ar2-screen') || document.querySelector('#app .ar2-screen');
  if (!sourceRoot) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  let printWindow;
  try {
    printWindow = openPrintWindow();
  } catch (error) {
    console.error('[annual-review readable print]', error);
    window.alert('הדפדפן חסם את חלון ההדפסה. יש לאפשר חלונות קופצים לאתר ולנסות שוב.');
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'מכין את המשוב להדפסה…';
  try {
    await printReview(sourceRoot, printWindow);
  } catch (error) {
    console.error('[annual-review readable print]', error);
    try { printWindow.close(); } catch {}
    window.alert('לא ניתן היה להכין את המשוב להדפסה. יש לרענן את העמוד ולנסות שוב.');
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}, true);
