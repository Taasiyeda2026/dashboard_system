const GEFEN_DOCUMENT_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen .proposal-document-content';
const GEFEN_INTRO_LIST_SELECTOR = `${GEFEN_DOCUMENT_CONTENT_SELECTOR} .pa-org-intro .pa-proposal-list`;

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

export function layoutGefenIntroSkills(root = document) {
  const lists = [];
  if (root?.matches?.(GEFEN_INTRO_LIST_SELECTOR)) lists.push(root);
  root?.querySelectorAll?.(GEFEN_INTRO_LIST_SELECTOR).forEach((list) => lists.push(list));

  lists.forEach((list) => {
    const items = Array.from(list.children).filter((item) => item?.tagName === 'LI');
    if (items.length !== 9) return;

    list.dataset.gefenIntroColumns = 'yes';
    list.style.display = 'grid';
    list.style.gridTemplateRows = 'repeat(3, auto)';
    list.style.gridAutoFlow = 'column';
    list.style.gridAutoColumns = 'minmax(145px, max-content)';
    list.style.columnGap = '34px';
    list.style.rowGap = '6px';
    list.style.justifyContent = 'center';
    list.style.alignItems = 'start';
    list.style.width = 'max-content';
    list.style.maxWidth = '100%';
    list.style.margin = '10px auto 0';
    list.style.paddingInlineStart = '18px';
    list.style.listStylePosition = 'outside';
    list.style.textAlign = 'right';
    list.style.direction = 'rtl';
    list.style.boxSizing = 'border-box';

    items.forEach((item) => {
      item.style.margin = '0';
      item.style.padding = '0';
      item.style.whiteSpace = 'nowrap';
      item.style.breakInside = 'avoid';
      item.style.lineHeight = '1.35';
    });
  });
}

export function applyGefenProposalLayout(root = document) {
  moveGefenProposalDateAboveTitle(root);
  layoutGefenIntroSkills(root);
}

let layoutQueued = false;
function scheduleGefenProposalLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  queueMicrotask(() => {
    layoutQueued = false;
    applyGefenProposalLayout();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleGefenProposalLayout, { once: true });
} else {
  scheduleGefenProposalLayout();
}

new MutationObserver(scheduleGefenProposalLayout)
  .observe(document.documentElement, { childList: true, subtree: true });
