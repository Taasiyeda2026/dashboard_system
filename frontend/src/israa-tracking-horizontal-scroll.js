const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const TABLE_WRAP_SELECTOR = '.israa-v2__wrap';
const TABLE_SELECTOR = '.israa-v2__table';
const TOP_SCROLL_ATTR = 'data-israa-v2-top-scroll';
const DEBOUNCE_MS = 60;

let timer = null;

function injectStyles() {
  if (document.getElementById('israa-tracking-horizontal-scroll-styles')) return;

  const style = document.createElement('style');
  style.id = 'israa-tracking-horizontal-scroll-styles';
  style.textContent = `
    .israa-v2__top-scroll {
      width: 100%;
      height: 17px;
      margin: 0 0 5px;
      overflow-x: auto;
      overflow-y: hidden;
      direction: rtl;
      scrollbar-gutter: stable;
      border-inline: 1px solid transparent;
    }

    .israa-v2__top-scroll[hidden] {
      display: none !important;
    }

    .israa-v2__top-scroll-inner {
      height: 1px;
      min-height: 1px;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);
}

function syncDimensions(topScroller, tableWrap, table) {
  const inner = topScroller.querySelector('.israa-v2__top-scroll-inner');
  if (!inner || !tableWrap || !table) return;

  const tableWidth = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
  const needsHorizontalScroll = tableWidth > tableWrap.clientWidth + 1;

  topScroller.hidden = !needsHorizontalScroll;
  inner.style.width = `${Math.ceil(tableWidth)}px`;

  if (needsHorizontalScroll) {
    topScroller.scrollLeft = tableWrap.scrollLeft;
  }
}

function enhanceContainer(container) {
  const tableWrap = container.querySelector(TABLE_WRAP_SELECTOR);
  const table = tableWrap?.querySelector(TABLE_SELECTOR);
  if (!tableWrap || !table) return;

  let topScroller = container.querySelector(`[${TOP_SCROLL_ATTR}]`);
  if (!topScroller) {
    topScroller = document.createElement('div');
    topScroller.className = 'israa-v2__top-scroll';
    topScroller.setAttribute(TOP_SCROLL_ATTR, 'true');
    topScroller.setAttribute('role', 'scrollbar');
    topScroller.setAttribute('aria-label', 'גלילה רוחבית של טבלת המעקב');
    topScroller.innerHTML = '<div class="israa-v2__top-scroll-inner"></div>';
    tableWrap.insertAdjacentElement('beforebegin', topScroller);
  }

  if (topScroller.dataset.scrollSyncBound !== 'true') {
    topScroller.dataset.scrollSyncBound = 'true';
    let syncing = false;

    topScroller.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      tableWrap.scrollLeft = topScroller.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    }, { passive: true });

    tableWrap.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      topScroller.scrollLeft = tableWrap.scrollLeft;
      requestAnimationFrame(() => { syncing = false; });
    }, { passive: true });
  }

  requestAnimationFrame(() => syncDimensions(topScroller, tableWrap, table));
}

function run() {
  injectStyles();
  document.querySelectorAll(CONTAINER_SELECTOR).forEach(enhanceContainer);
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
window.addEventListener('hashchange', schedule);
