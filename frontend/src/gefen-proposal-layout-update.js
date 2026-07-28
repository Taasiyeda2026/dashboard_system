const GEFEN_DOCUMENT_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen .proposal-document-content';

export function moveGefenProposalDateAboveTitle(root = document) {
  const contents = [];
  if (root?.matches?.(GEFEN_DOCUMENT_CONTENT_SELECTOR)) contents.push(root);
  root?.querySelectorAll?.(GEFEN_DOCUMENT_CONTENT_SELECTOR).forEach((content) => contents.push(content));

  contents.forEach((content) => {
    const title = content.querySelector(':scope > .pa-doc-title');
    const date = content.querySelector(':scope > .pa-doc-date:not(.pa-gefen-approval-date)');
    if (!title || !date || title.nextElementSibling !== date) return;
    content.insertBefore(date, title);
  });
}

let reorderQueued = false;
function scheduleGefenProposalDateReorder() {
  if (reorderQueued) return;
  reorderQueued = true;
  queueMicrotask(() => {
    reorderQueued = false;
    moveGefenProposalDateAboveTitle();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleGefenProposalDateReorder, { once: true });
} else {
  scheduleGefenProposalDateReorder();
}

new MutationObserver(scheduleGefenProposalDateReorder)
  .observe(document.documentElement, { childList: true, subtree: true });
