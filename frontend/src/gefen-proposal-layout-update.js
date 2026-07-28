const GEFEN_DOCUMENT_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen .proposal-document-content';
const GEFEN_INTRO_SELECTOR = `${GEFEN_DOCUMENT_CONTENT_SELECTOR} .pa-org-intro`;
const GEFEN_INTRO_LIST_SELECTOR = `${GEFEN_INTRO_SELECTOR} .pa-proposal-list`;
const GEFEN_PRINT_STYLE_ID = 'gefen-proposal-print-layout-v2';

function setImportantStyle(element, property, value) {
  element?.style?.setProperty(property, value, 'important');
}

function ensureGefenProposalPrintStyles() {
  if (typeof document === 'undefined' || document.getElementById(GEFEN_PRINT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = GEFEN_PRINT_STYLE_ID;
  style.textContent = `
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content {
      display: flex !important;
      flex-direction: column !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-date {
      order: 0 !important;
      margin: 0 0 1mm !important;
      line-height: 1.1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-title {
      order: 1 !important;
      margin: 0 0 1.4mm !important;
      line-height: 1.08 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-org-intro {
      order: 2 !important;
      margin: 0 0 1.2mm !important;
      padding: 0 4mm !important;
      box-sizing: border-box !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > :not(.pa-doc-date):not(.pa-doc-title):not(.pa-org-intro) {
      order: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro > p {
      margin: 0 0 1mm !important;
      line-height: 1.22 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list {
      display: grid !important;
      grid-template-rows: repeat(3, auto) !important;
      grid-auto-flow: column !important;
      grid-auto-columns: minmax(36mm, max-content) !important;
      column-gap: 7mm !important;
      row-gap: .7mm !important;
      justify-content: center !important;
      align-items: start !important;
      width: max-content !important;
      max-width: 100% !important;
      margin: .8mm auto 1mm !important;
      padding-inline-start: 4mm !important;
      list-style-position: outside !important;
      text-align: right !important;
      direction: rtl !important;
      box-sizing: border-box !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li {
      margin: 0 !important;
      padding: 0 !important;
      white-space: nowrap !important;
      break-inside: avoid !important;
      line-height: 1.15 !important;
      font-weight: 700 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section {
      margin: 1.6mm 0 !important;
      padding: 0 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-heading {
      margin: 0 0 .8mm !important;
      line-height: 1.12 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section p,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-text > p,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-body > p {
      margin: 0 0 1mm !important;
      line-height: 1.23 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section ul,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section ol {
      margin: .6mm 0 1.2mm !important;
      padding-inline-start: 5mm !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section li {
      margin: 0 0 .45mm !important;
      line-height: 1.2 !important;
    }
  `;
  document.head.appendChild(style);
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
      setImportantStyle(paragraph, 'line-height', '1.22');
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
      setImportantStyle(item, 'line-height', '1.15');
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
        setImportantStyle(firstParagraph, 'line-height', '1.23');
      }
    }
  });
}

export function applyGefenProposalLayout(root = document) {
  ensureGefenProposalPrintStyles();
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

ensureGefenProposalPrintStyles();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleGefenProposalLayout, { once: true });
} else {
  scheduleGefenProposalLayout();
}

new MutationObserver(scheduleGefenProposalLayout)
  .observe(document.documentElement, { childList: true, subtree: true });
