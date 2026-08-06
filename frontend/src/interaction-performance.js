const MAX_INTERACTIONS = 150;
const PAINT_FRAMES = 2;

const ACTION_SELECTORS = [
  ['week-prev', '[data-week-prev]'],
  ['week-next', '[data-week-next]'],
  ['week-today', '[data-week-today]'],
  ['month-prev', '[data-month-prev]'],
  ['month-next', '[data-month-next]'],
  ['month-today', '[data-month-today]'],
  ['instructors-month-prev', '[data-instr-month-prev]'],
  ['instructors-month-next', '[data-instr-month-next]'],
  ['instructor-open', '[data-instructor-card]'],
  ['operations-tab', '[data-ops-tab]'],
  ['operations-stock-open', '[data-ops-open-stock-edit]'],
  ['operations-stock-save', '[data-ops-stock-edit-save]'],
  ['proposal-open', '[data-pa-open-proposal-id]'],
  ['proposal-new', '[data-pa-tab="new"]'],
  ['proposal-edit', '[data-pa-edit-row]']
];

function now() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function perfStore() {
  if (typeof window === 'undefined') return null;
  if (!window.__dsPerf) window.__dsPerf = { requests: [], renders: [], screens: {} };
  if (!Array.isArray(window.__dsPerf.interactions)) window.__dsPerf.interactions = [];
  return window.__dsPerf;
}

function interactionTarget(target) {
  if (!(target instanceof Element)) return null;
  for (const [action, selector] of ACTION_SELECTORS) {
    const element = target.closest(selector);
    if (element) return { action, selector, element };
  }
  return null;
}

function routeName(element) {
  const screen = element.closest('[data-screen], [data-route-screen]');
  return String(screen?.dataset?.screen || screen?.dataset?.routeScreen || window.__dsCurrentRoute || '').trim();
}

function appendInteraction(entry) {
  const store = perfStore();
  if (!store) return;
  store.interactions.push(entry);
  if (store.interactions.length > MAX_INTERACTIONS) {
    store.interactions.splice(0, store.interactions.length - MAX_INTERACTIONS);
  }
}

function afterPaint(callback, frames = PAINT_FRAMES) {
  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (fn) => setTimeout(() => fn(now()), 0);
  const step = () => {
    if (frames <= 1) callback();
    else afterPaint(callback, frames - 1);
  };
  raf(step);
}

function installInteractionPerformance() {
  if (typeof document === 'undefined' || globalThis.__dsInteractionPerformanceInstalled) return;
  globalThis.__dsInteractionPerformanceInstalled = true;
  perfStore();

  document.addEventListener('click', (event) => {
    const matched = interactionTarget(event.target);
    if (!matched) return;
    const startedAt = now();
    const entry = {
      action: matched.action,
      route: routeName(matched.element),
      selector: matched.selector,
      started_at: new Date().toISOString(),
      click_to_dom_change_ms: null,
      click_to_next_paint_ms: null
    };
    appendInteraction(entry);

    const observedRoot = document.getElementById('screenRoot') || document.body;
    let observerTimeout = null;
    const observer = typeof MutationObserver === 'function'
      ? new MutationObserver(() => {
          if (entry.click_to_dom_change_ms == null) {
            entry.click_to_dom_change_ms = Math.round(now() - startedAt);
          }
          observer.disconnect();
          clearTimeout(observerTimeout);
        })
      : null;
    observer?.observe(observedRoot, { childList: true, subtree: true, attributes: true, characterData: true });
    if (observer) {
      observerTimeout = setTimeout(() => observer.disconnect(), 15_000);
      observerTimeout?.unref?.();
    }

    afterPaint(() => {
      entry.click_to_next_paint_ms = Math.round(now() - startedAt);
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info('[interaction-perf]', { ...entry });
      }
    });
  }, true);
}

installInteractionPerformance();

export { ACTION_SELECTORS, installInteractionPerformance };
