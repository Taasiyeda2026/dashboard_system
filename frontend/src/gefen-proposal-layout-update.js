const GEFEN_DOCUMENT_CONTENT_SELECTOR = '.proposal-document.pa-proposal-doc--gefen .proposal-document-content';
const GEFEN_INTRO_SELECTOR = `${GEFEN_DOCUMENT_CONTENT_SELECTOR} .pa-org-intro`;
const GEFEN_INTRO_LIST_SELECTOR = `${GEFEN_INTRO_SELECTOR} .pa-proposal-list`;
const GEFEN_PRINT_STYLE_ID = 'gefen-proposal-print-layout-v4';
const GEFEN_INTRO_ITEM_COUNT = 12;
const GEFEN_INTRO_ROWS = 3;
const GEFEN_FONT_DELTA_PX = 0.5;
const GEFEN_LINE_HEIGHT_DELTA = 0.25;
const GEFEN_TYPOGRAPHY_VERSION = 'font-plus-0.5-line-plus-0.25-v1';

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
      padding: 0 3mm !important;
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
      grid-template-columns: repeat(4, minmax(30mm, max-content)) !important;
      grid-template-rows: repeat(3, auto) !important;
      column-gap: 4.5mm !important;
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
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(1),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(4),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(7),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(10) {
      grid-row: 1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(2),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(5),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(8),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(11) {
      grid-row: 2 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(3),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(6),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(9),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(12) {
      grid-row: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(-n+3) {
      grid-column: 1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+4):nth-child(-n+6) {
      grid-column: 2 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+7):nth-child(-n+9) {
      grid-column: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+10):nth-child(-n+12) {
      grid-column: 4 !important;
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
    @media print {
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-title {
        width: 100% !important;
        text-align: center !important;
      }
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-date {
        width: 100% !important;
        text-align: left !important;
      }
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-gefen-contact-details {
        display: flex !important;
        align-items: center !important;
        flex-wrap: nowrap !important;
        gap: 1.5mm !important;
        white-space: nowrap !important;
        direction: rtl !important;
      }
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-gefen-contact-details > span,
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-gefen-contact-details bdi {
        flex: 0 0 auto !important;
        white-space: nowrap !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function hasDirectText(element) {
  return Array.from(element?.childNodes || []).some((node) => node.nodeType === 3 && String(node.textContent || '').trim());
}

function applyGefenTypography(root = document) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return;
  const contents = [];
  if (root?.matches?.(GEFEN_DOCUMENT_CONTENT_SELECTOR)) contents.push(root);
  root?.querySelectorAll?.(GEFEN_DOCUMENT_CONTENT_SELECTOR).forEach((content) => contents.push(content));

  contents.forEach((content) => {
    if (content.dataset.gefenTypographyVersion === GEFEN_TYPOGRAPHY_VERSION) return;

    const candidates = [content, ...Array.from(content.querySelectorAll('*'))]
      .filter((element) => hasDirectText(element));
    const measurements = candidates.map((element) => {
      const computed = window.getComputedStyle(element);
      const fontSize = Number.parseFloat(computed.fontSize);
      const lineHeightPx = Number.parseFloat(computed.lineHeight);
      const display = String(computed.display || '').toLowerCase();
      const canAdjustLineHeight = !['inline', 'contents', 'none'].includes(display);
      const baseLineHeightRatio = Number.isFinite(lineHeightPx) && Number.isFinite(fontSize) && fontSize > 0
        ? lineHeightPx / fontSize
        : 1.2;
      return { element, fontSize, baseLineHeightRatio, canAdjustLineHeight };
    });

    measurements.forEach(({ element, fontSize, baseLineHeightRatio, canAdjustLineHeight }) => {
      if (Number.isFinite(fontSize) && fontSize > 0) {
        setImportantStyle(element, 'font-size', `${fontSize + GEFEN_FONT_DELTA_PX}px`);
      }
      if (canAdjustLineHeight && Number.isFinite(baseLineHeightRatio)) {
        setImportantStyle(element, 'line-height', String(baseLineHeightRatio + GEFEN_LINE_HEIGHT_DELTA));
      }
    });

    content.dataset.gefenTypographyVersion = GEFEN_TYPOGRAPHY_VERSION;
  });
}

export function moveGefenProposalDateAboveTitle(root = document) {
  const contents = [];
  if (root?.matches?.(GEFEN_DOCUMENT_CONTENT_SELECTOR)) contents.push(root);
  root?.querySelectorAll?.(GEFEN_DOCUMENT_CONTENT_SELECTOR).forEach((content) => contents.push(content));

  contents.forEach((content) => {
    const title = content.querySelector(':scope > .pa-doc-title');
    const date = content.querySelector(':scope > .pa-doc-date:not(.pa-gefen-approval-date)');
    if (!title || !date || title.previousElementSibling === date) return;
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
    if (!list || items.length !== GEFEN_INTRO_ITEM_COUNT) return;

    setImportantStyle(intro, 'margin-top', '0');
    setImportantStyle(intro, 'margin-bottom', '4px');
    setImportantStyle(intro, 'padding-top', '0');
    setImportantStyle(intro, 'padding-bottom', '0');

    intro.querySelectorAll(':scope > p').forEach((paragraph, index) => {
      setImportantStyle(paragraph, 'margin-top', '0');
      setImportantStyle(paragraph, 'margin-bottom', index === 0 ? '4px' : '2px');
      setImportantStyle(paragraph, 'line-height', '1.22');
    });

    list.dataset.gefenIntroColumns = '4x3';
    setImportantStyle(list, 'display', 'grid');
    setImportantStyle(list, 'grid-template-columns', 'repeat(4, minmax(122px, max-content))');
    setImportantStyle(list, 'grid-template-rows', 'repeat(3, auto)');
    setImportantStyle(list, 'column-gap', '20px');
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

    items.forEach((item, index) => {
      const column = Math.floor(index / GEFEN_INTRO_ROWS) + 1;
      const row = (index % GEFEN_INTRO_ROWS) + 1;
      setImportantStyle(item, 'grid-column', String(column));
      setImportantStyle(item, 'grid-row', String(row));
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
  applyGefenTypography(root);
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

if (typeof document !== 'undefined') {
  ensureGefenProposalPrintStyles();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleGefenProposalLayout, { once: true });
  } else {
    scheduleGefenProposalLayout();
  }

  new MutationObserver(scheduleGefenProposalLayout)
    .observe(document.documentElement, { childList: true, subtree: true });
}
