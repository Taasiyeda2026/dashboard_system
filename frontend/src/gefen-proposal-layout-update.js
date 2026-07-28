const GEFEN_DOCUMENT_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen .proposal-document-content';
const GEFEN_INTRO_SELECTOR = `${GEFEN_DOCUMENT_CONTENT_SELECTOR} .pa-org-intro`;
const GEFEN_INTRO_LIST_SELECTOR = `${GEFEN_INTRO_SELECTOR} .pa-proposal-list`;

function setImportantStyle(element, property, value) {
  element?.style?.setProperty(property, value, 'important');
}

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
  const intros = [];
  if (root?.matches?.(GEFEN_INTRO_SELECTOR)) intros.push(root);
  root?.querySelectorAll?.(GEFEN_INTRO_SELECTOR).forEach((intro) => intros.push(intro));

  intros.forEach((intro) => {
    const list = intro.querySelector(':scope > .pa-proposal-list');
    const items = Array.from(list?.children || []).filter((item) => item?.tagName === 'LI');
    if (!list || items.length !== 9) return;

    setImportantStyle(intro, 'margin-top', '0');
    setImportantStyle(intro, 'margin-bottom', '4px');
    setImportantStyle(intro, 'padding-top', '0');
    setImportantStyle(intro, 'padding-bottom', '0');

    intro.querySelectorAll(':scope > p').forEach((paragraph, index) => {
      setImportantStyle(paragraph, 'margin-top', '0');
      setImportantStyle(paragraph, 'margin-bottom', index === 0 ? '4px' : '2px');
      setImportantStyle(paragraph, 'line-height', '1.28');
    });

    list.dataset.gefenIntroColumns = 'yes';
    setImportantStyle(list, 'display', 'grid');
    setImportantStyle(list, 'grid-template-rows', 'repeat(3, auto)');
    setImportantStyle(list, 'grid-auto-flow', 'column');
    setImportantStyle(list, 'grid-auto-columns', 'minmax(145px, max-content)');
    setImportantStyle(list, 'column-gap', '24px');
    setImportantStyle(list, 'row-gap', '2px');
    setImportantStyle(list, 'justify-content', 'center');
    setImportantStyle(list, 'align-items', 'start');
    setImportantStyle(list, 'width', 'max-content');
    setImportantStyle(list, 'max-width', '100%');
    setImportantStyle(list, 'margin', '4px auto 5px');
    setImportantStyle(list, 'padding-inline-start', '16px');
    setImportantStyle(list, 'list-style-position', 'outside');
    setImportantStyle(list, 'text-align', 'right');
    setImportantStyle(list, 'direction', 'rtl');
    setImportantStyle(list, 'box-sizing', 'border-box');

    items.forEach((item) => {
      setImportantStyle(item, 'margin', '0');
      setImportantStyle(item, 'padding', '0');
      setImportantStyle(item, 'white-space', 'nowrap');
      setImportantStyle(item, 'break-inside', 'avoid');
      setImportantStyle(item, 'line-height', '1.18');
      setImportantStyle(item, 'font-weight', '700');
    });

    const followingBlock = intro.nextElementSibling;
    if (followingBlock) {
      setImportantStyle(followingBlock, 'margin-top', '4px');
      const firstParagraph = followingBlock.matches('p')
        ? followingBlock
        : followingBlock.querySelector(':scope > p, :scope > .pa-section-body > p, :scope > .pa-section-text > p');
      if (firstParagraph) {
        setImportantStyle(firstParagraph, 'margin-top', '0');
        setImportantStyle(firstParagraph, 'margin-bottom', '5px');
        setImportantStyle(firstParagraph, 'line-height', '1.28');
      }
    }
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
