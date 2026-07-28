const GEFEN_PROPOSAL_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content';

function setImportantStyle(element, property, value) {
  element?.style?.setProperty(property, value, 'important');
}

export function alignGefenProposalPdfHeader(root = document) {
  const contents = [];
  if (root?.matches?.(GEFEN_PROPOSAL_CONTENT_SELECTOR)) contents.push(root);
  root?.querySelectorAll?.(GEFEN_PROPOSAL_CONTENT_SELECTOR).forEach((content) => contents.push(content));

  contents.forEach((content) => {
    const title = content.querySelector(':scope > .pa-doc-title');
    const date = content.querySelector(':scope > .pa-doc-date:not(.pa-gefen-approval-date)');

    if (title) {
      setImportantStyle(title, 'display', 'block');
      setImportantStyle(title, 'width', '100%');
      setImportantStyle(title, 'max-width', 'none');
      setImportantStyle(title, 'align-self', 'stretch');
      setImportantStyle(title, 'text-align', 'center');
      setImportantStyle(title, 'margin-left', '0');
      setImportantStyle(title, 'margin-right', '0');
    }

    if (date) {
      setImportantStyle(date, 'display', 'block');
      setImportantStyle(date, 'width', '100%');
      setImportantStyle(date, 'max-width', 'none');
      setImportantStyle(date, 'align-self', 'stretch');
      setImportantStyle(date, 'text-align', 'left');
      setImportantStyle(date, 'direction', 'ltr');
      setImportantStyle(date, 'margin-left', '0');
      setImportantStyle(date, 'margin-right', '0');
    }
  });
}

let alignmentQueued = false;
function scheduleGefenProposalPdfHeaderAlignment() {
  if (alignmentQueued) return;
  alignmentQueued = true;
  queueMicrotask(() => {
    alignmentQueued = false;
    alignGefenProposalPdfHeader();
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleGefenProposalPdfHeaderAlignment, { once: true });
  } else {
    scheduleGefenProposalPdfHeaderAlignment();
  }

  new MutationObserver(scheduleGefenProposalPdfHeaderAlignment)
    .observe(document.documentElement, { childList: true, subtree: true });
}
