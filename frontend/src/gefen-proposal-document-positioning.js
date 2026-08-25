const GEFEN_DOCUMENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen:not(.pa-gefen-approval-document)';
const GEFEN_CONTENT_SELECTOR = '.proposal-document-content';
const GEFEN_DATE_SELECTOR = '.pa-doc-date:not(.pa-gefen-approval-date)';
const GEFEN_RECIPIENT_SELECTOR = '.pa-gefen-recipient';
const STYLE_ID = 'gefen-proposal-document-positioning-v1';
const FONT_DELTA_PX = 0.5;
const LINE_HEIGHT_DELTA_PX = 0.25;

function setImportantStyle(element, property, value) {
  element?.style?.setProperty?.(property, value, 'important');
}

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    ${GEFEN_DOCUMENT_SELECTOR} ${GEFEN_RECIPIENT_SELECTOR} {
      margin-bottom: .8mm !important;
    }

    ${GEFEN_DOCUMENT_SELECTOR} > .pa-gefen-proposal-date {
      display: block !important;
      width: 100% !important;
      margin: 0 0 .8mm !important;
      padding: 0 !important;
      text-align: left !important;
      direction: ltr !important;
    }

    ${GEFEN_DOCUMENT_SELECTOR} .pa-section p,
    ${GEFEN_DOCUMENT_SELECTOR} .pa-section-text > p,
    ${GEFEN_DOCUMENT_SELECTOR} .pa-section-body > p {
      margin-bottom: 1.15mm !important;
    }

    ${GEFEN_DOCUMENT_SELECTOR} .pa-gefen-course-table {
      margin-bottom: 2.6mm !important;
    }
  `;
  document.head.appendChild(style);
}

function preserveRequestedDateTypography(date) {
  if (!date || date.dataset.gefenDateTypographyPreserved === 'yes') return;
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;

  const computed = window.getComputedStyle(date);
  const fontSize = Number.parseFloat(computed.fontSize);
  const lineHeight = Number.parseFloat(computed.lineHeight);

  // The existing GEFEN typography runtime normally applies these deltas first.
  // If it has not run yet, preserve the same requested deltas before moving the date
  // outside .proposal-document-content, where that runtime no longer scans it.
  if (!date.style.getPropertyValue('font-size') && Number.isFinite(fontSize) && fontSize > 0) {
    setImportantStyle(date, 'font-size', `${fontSize + FONT_DELTA_PX}px`);
  }
  if (!date.style.getPropertyValue('line-height') && Number.isFinite(lineHeight) && lineHeight > 0) {
    setImportantStyle(date, 'line-height', `${lineHeight + LINE_HEIGHT_DELTA_PX}px`);
  }
  date.dataset.gefenDateTypographyPreserved = 'yes';
}

function positionGefenDate(documentElement) {
  const recipient = documentElement.querySelector(GEFEN_RECIPIENT_SELECTOR);
  const content = documentElement.querySelector(GEFEN_CONTENT_SELECTOR);
  const date = content?.querySelector(`:scope > ${GEFEN_DATE_SELECTOR}`)
    || documentElement.querySelector(':scope > .pa-gefen-proposal-date');

  if (!recipient || !date) return;

  preserveRequestedDateTypography(date);
  date.classList.add('pa-gefen-proposal-date');

  if (recipient.nextElementSibling !== date) {
    recipient.insertAdjacentElement('afterend', date);
  }
}

export function applyGefenProposalDocumentPositioning(root = document) {
  ensureStyles();
  const documents = [];
  if (root?.matches?.(GEFEN_DOCUMENT_SELECTOR)) documents.push(root);
  root?.querySelectorAll?.(GEFEN_DOCUMENT_SELECTOR).forEach((documentElement) => documents.push(documentElement));
  documents.forEach(positionGefenDate);
}

let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    applyGefenProposalDocumentPositioning();
  });
}

if (typeof document !== 'undefined') {
  ensureStyles();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }

  new MutationObserver(schedule)
    .observe(document.documentElement, { childList: true, subtree: true });
}
