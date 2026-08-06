const PROPOSAL_DOCUMENT_SELECTOR = '.proposal-document';
const TITLE_SELECTOR = '.pa-doc-title';
const DATE_SELECTOR = '.pa-doc-date';
const TITLE_DATE_ROW_ATTRIBUTE = 'data-pa-title-date-row';

function setImportantStyle(element, property, value) {
  element?.style?.setProperty(property, value, 'important');
}

function proposalDocumentsWithin(root) {
  if (!root) return [];
  const documents = [];
  const add = (documentElement) => {
    if (documentElement && !documents.includes(documentElement)) documents.push(documentElement);
  };

  if (root.matches?.(PROPOSAL_DOCUMENT_SELECTOR)) add(root);
  add(root.closest?.(PROPOSAL_DOCUMENT_SELECTOR));
  root.querySelectorAll?.(PROPOSAL_DOCUMENT_SELECTOR).forEach(add);
  return documents;
}

function ensureTitleDateRow(proposalDocument, title) {
  const content = title.closest('.proposal-document-content') || title.parentElement;
  if (!content) return null;

  let row = title.closest(`[${TITLE_DATE_ROW_ATTRIBUTE}]`);
  if (!row) {
    row = proposalDocument.ownerDocument.createElement('div');
    row.className = 'pa-title-date-row';
    row.setAttribute(TITLE_DATE_ROW_ATTRIBUTE, 'true');
    content.insertBefore(row, title);
    row.appendChild(title);
  }
  return row;
}

function styleTitleDateRow(row, title, date) {
  setImportantStyle(row, 'display', 'grid');
  setImportantStyle(row, 'grid-template-columns', 'minmax(0, 1fr) minmax(0, 4fr) minmax(0, 1fr)');
  setImportantStyle(row, 'grid-template-rows', 'auto');
  setImportantStyle(row, 'align-items', 'baseline');
  setImportantStyle(row, 'column-gap', '0');
  setImportantStyle(row, 'width', '100%');
  setImportantStyle(row, 'max-width', 'none');
  setImportantStyle(row, 'margin', '0 0 1.4mm');
  setImportantStyle(row, 'padding', '0');
  setImportantStyle(row, 'direction', 'ltr');
  setImportantStyle(row, 'box-sizing', 'border-box');
  setImportantStyle(row, 'order', '0');

  setImportantStyle(title, 'grid-column', '2');
  setImportantStyle(title, 'grid-row', '1');
  setImportantStyle(title, 'display', 'block');
  setImportantStyle(title, 'width', '100%');
  setImportantStyle(title, 'max-width', 'none');
  setImportantStyle(title, 'justify-self', 'center');
  setImportantStyle(title, 'align-self', 'baseline');
  setImportantStyle(title, 'text-align', 'center');
  setImportantStyle(title, 'direction', 'rtl');
  setImportantStyle(title, 'margin', '0');
  setImportantStyle(title, 'padding', '0');
  setImportantStyle(title, 'position', 'static');
  setImportantStyle(title, 'transform', 'none');

  if (!date) return;
  setImportantStyle(date, 'grid-column', '1');
  setImportantStyle(date, 'grid-row', '1');
  setImportantStyle(date, 'display', 'block');
  setImportantStyle(date, 'width', 'auto');
  setImportantStyle(date, 'max-width', '100%');
  setImportantStyle(date, 'justify-self', 'start');
  setImportantStyle(date, 'align-self', 'baseline');
  setImportantStyle(date, 'text-align', 'left');
  setImportantStyle(date, 'direction', 'ltr');
  setImportantStyle(date, 'white-space', 'nowrap');
  setImportantStyle(date, 'margin', '0');
  setImportantStyle(date, 'padding', '0');
  setImportantStyle(date, 'position', 'static');
  setImportantStyle(date, 'transform', 'none');
}

export function alignProposalPdfTitleDate(root = typeof document !== 'undefined' ? document : null) {
  let alignedCount = 0;
  proposalDocumentsWithin(root).forEach((proposalDocument) => {
    const title = proposalDocument.querySelector(TITLE_SELECTOR);
    if (!title) return;

    const date = proposalDocument.querySelector(DATE_SELECTOR);
    const row = ensureTitleDateRow(proposalDocument, title);
    if (!row) return;

    if (date && date.parentElement !== row) row.insertBefore(date, row.firstChild);
    styleTitleDateRow(row, title, date);
    alignedCount += 1;
  });
  return alignedCount;
}

// Backward-compatible export retained for existing imports/tests.
export const alignGefenProposalPdfHeader = alignProposalPdfTitleDate;

let alignmentQueued = false;
function scheduleProposalPdfTitleDateAlignment() {
  if (alignmentQueued) return;
  alignmentQueued = true;
  queueMicrotask(() => {
    alignmentQueued = false;
    alignProposalPdfTitleDate();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleProposalPdfTitleDateAlignment, { once: true });
  } else {
    scheduleProposalPdfTitleDateAlignment();
  }

  new MutationObserver(scheduleProposalPdfTitleDateAlignment)
    .observe(document.documentElement, { childList: true, subtree: true });
}
