const CONTAINER_SELECTOR = '[data-israa-tracking-v2]';
const TABLE_WRAP_SELECTOR = '.israa-v2__wrap';
const DEBOUNCE_MS = 50;

let timer = null;
let currentWrap = null;
let viewportWidth = window.innerWidth;
let forceRtlStart = true;

function alignToRtlStart(tableWrap) {
  // In an RTL scroll container zero is the inline-start (rightmost) edge.
  tableWrap.scrollLeft = 0;
  requestAnimationFrame(() => { tableWrap.scrollLeft = 0; });
}

function run() {
  const container = [...document.querySelectorAll(CONTAINER_SELECTOR)]
    .find((candidate) => candidate.offsetParent !== null);
  const tableWrap = container?.querySelector(TABLE_WRAP_SELECTOR) || null;

  if (!tableWrap) {
    currentWrap = null;
    return;
  }

  const wrapChanged = tableWrap !== currentWrap;
  const viewportChanged = window.innerWidth !== viewportWidth;
  if (wrapChanged || viewportChanged || forceRtlStart) alignToRtlStart(tableWrap);

  currentWrap = tableWrap;
  viewportWidth = window.innerWidth;
  forceRtlStart = false;
}

function schedule(resetToStart = false) {
  if (resetToStart) forceRtlStart = true;
  clearTimeout(timer);
  timer = setTimeout(run, DEBOUNCE_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => schedule(true), { once: true });
} else {
  schedule(true);
}

new MutationObserver(() => schedule()).observe(document.documentElement, {
  childList: true,
  subtree: true
});

window.addEventListener('resize', () => schedule(true), { passive: true });
window.addEventListener('hashchange', () => schedule(true));
window.addEventListener('israa-tracking-updated', () => schedule(true));
