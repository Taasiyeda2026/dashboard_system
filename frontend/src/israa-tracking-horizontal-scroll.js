const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const TABLE_WRAP_SELECTOR = '.israa-v2__wrap';
const TABLE_SELECTOR = '.israa-v2__table';
const FIXED_SCROLL_ATTR = 'data-israa-v2-fixed-scroll';
const OLD_TOP_SCROLL_ATTR = 'data-israa-v2-top-scroll';
const DEBOUNCE_MS = 50;

let timer = null;
let fixedScroller = null;
let activeWrap = null;
let syncing = false;

function injectStyles() {
  if (document.getElementById('israa-tracking-horizontal-scroll-styles')) return;

  const style = document.createElement('style');
  style.id = 'israa-tracking-horizontal-scroll-styles';
  style.textContent = `
    .israa-v2__fixed-scroll {
      position: fixed;
      bottom: 7px;
      height: 19px;
      overflow-x: auto;
      overflow-y: hidden;
      direction: rtl;
      scrollbar-gutter: stable;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 3px 12px rgba(15, 23, 42, .18);
      z-index: 1200;
    }

    .israa-v2__fixed-scroll[hidden] {
      display: none !important;
    }

    .israa-v2__fixed-scroll-inner {
      height: 1px;
      min-height: 1px;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function ensureFixedScroller() {
  if (fixedScroller?.isConnected) return fixedScroller;

  fixedScroller = document.querySelector(`[${FIXED_SCROLL_ATTR}]`);
  if (!fixedScroller) {
    fixedScroller = document.createElement('div');
    fixedScroller.className = 'israa-v2__fixed-scroll';
    fixedScroller.setAttribute(FIXED_SCROLL_ATTR, 'true');
    fixedScroller.setAttribute('role', 'scrollbar');
    fixedScroller.setAttribute('aria-label', 'גלילה רוחבית קבועה של טבלת המעקב');
    fixedScroller.innerHTML = '<div class="israa-v2__fixed-scroll-inner"></div>';
    document.body.appendChild(fixedScroller);
  }

  if (fixedScroller.dataset.scrollSyncBound !== 'true') {
    fixedScroller.dataset.scrollSyncBound = 'true';
    fixedScroller.addEventListener('scroll', () => {
      if (syncing || !activeWrap) return;
      syncing = true;
      activeWrap.scrollLeft = fixedScroller.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    }, { passive: true });
  }

  return fixedScroller;
}

function bindTableWrap(tableWrap) {
  if (tableWrap.dataset.fixedScrollSyncBound === 'true') return;
  tableWrap.dataset.fixedScrollSyncBound = 'true';

  tableWrap.addEventListener('scroll', () => {
    if (syncing || !fixedScroller || activeWrap !== tableWrap) return;
    syncing = true;
    fixedScroller.scrollLeft = tableWrap.scrollLeft;
    requestAnimationFrame(() => { syncing = false; });
  }, { passive: true });
}

function hideFixedScroller() {
  if (fixedScroller) fixedScroller.hidden = true;
  if (activeWrap) activeWrap.closest(CONTAINER_SELECTOR)?.style.removeProperty('padding-bottom');
  activeWrap = null;
}

function syncGeometry(container, tableWrap, table) {
  const scroller = ensureFixedScroller();
  const inner = scroller.querySelector('.israa-v2__fixed-scroll-inner');
  if (!inner) return;

  const rect = tableWrap.getBoundingClientRect();
  const tableWidth = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
  const needsHorizontalScroll = tableWidth > tableWrap.clientWidth + 1;
  const visibleContainer = container.offsetParent !== null && rect.width > 0;

  if (!needsHorizontalScroll || !visibleContainer) {
    hideFixedScroller();
    return;
  }

  activeWrap = tableWrap;
  bindTableWrap(tableWrap);

  const left = Math.max(0, rect.left);
  const right = Math.min(window.innerWidth, rect.right);
  const width = Math.max(0, right - left);

  scroller.style.left = `${Math.round(left)}px`;
  scroller.style.width = `${Math.round(width)}px`;
  inner.style.width = `${Math.ceil(tableWidth)}px`;
  scroller.hidden = width < 40;
  container.style.paddingBottom = '30px';

  if (!scroller.hidden) scroller.scrollLeft = tableWrap.scrollLeft;
}

function run() {
  injectStyles();

  const container = [...document.querySelectorAll(CONTAINER_SELECTOR)]
    .find((candidate) => candidate.offsetParent !== null);

  if (!container) {
    hideFixedScroller();
    return;
  }

  container.querySelector(`[${OLD_TOP_SCROLL_ATTR}]`)?.remove();

  const tableWrap = container.querySelector(TABLE_WRAP_SELECTOR);
  const table = tableWrap?.querySelector(TABLE_SELECTOR);
  if (!tableWrap || !table) {
    hideFixedScroller();
    return;
  }

  requestAnimationFrame(() => syncGeometry(container, tableWrap, table));
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', schedule, { once: true });
} else {
  schedule();
}

new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('resize', schedule, { passive: true });
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('hashchange', schedule);
window.addEventListener('israa-tracking-updated', schedule);
