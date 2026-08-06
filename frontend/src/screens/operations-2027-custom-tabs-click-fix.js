const CUSTOM_TAB_KEYS = new Set([
  'summer_training_matrix',
  'course_training_matrix',
  'course_print_kits'
]);

const MARKER_ATTR = 'data-ops-2027-runtime-marker';
const REPAIRED_ATTR = 'data-ops-custom-tabs-click-repaired';

let observer = null;
let queued = false;

function operations2027Root() {
  return document.querySelector(
    '.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027'
  );
}

function ensureRuntimeMarker(root) {
  if (!root || root.querySelector(`[${MARKER_ATTR}]`)) return;
  const field = document.createElement('span');
  field.hidden = true;
  field.setAttribute(MARKER_ATTR, '');
  field.setAttribute('aria-hidden', 'true');
  field.style.setProperty('display', 'none', 'important');
  field.style.setProperty('position', 'absolute', 'important');
  field.style.setProperty('width', '0', 'important');
  field.style.setProperty('height', '0', 'important');
  field.style.setProperty('overflow', 'hidden', 'important');
  field.innerHTML = '<select tabindex="-1" aria-hidden="true"><option value="school_2027" selected>2027</option></select>';
  root.appendChild(field);
}

function recreateCustomTabs(root) {
  if (!root || root.hasAttribute(REPAIRED_ATTR)) return;
  root.setAttribute(REPAIRED_ATTR, '');
  root.querySelectorAll('[data-ops-custom-tab]').forEach((button) => {
    if (CUSTOM_TAB_KEYS.has(String(button.dataset.opsCustomTab || ''))) button.remove();
  });
}

function repairOperations2027Tabs() {
  const root = operations2027Root();
  if (!root) return;
  ensureRuntimeMarker(root);
  recreateCustomTabs(root);
}

function queueRepair() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    repairOperations2027Tabs();
  });
}

function observeOperations() {
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  observer?.disconnect?.();
  observer = new MutationObserver(() => queueRepair());
  observer.observe(app, { childList: true, subtree: true });
}

function ensureMarkerBeforeCustomTabClick(event) {
  const button = event.target?.closest?.('[data-ops-custom-tab]');
  const tabKey = String(button?.dataset?.opsCustomTab || '');
  if (!CUSTOM_TAB_KEYS.has(tabKey)) return;
  const root = button.closest('.ds-ops-mgmt-screen');
  if (!root?.matches?.('[data-ops-year="2027"], .ops-year-2027')) return;
  ensureRuntimeMarker(root);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', ensureMarkerBeforeCustomTabClick, true);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueRepair();
      observeOperations();
    }, { once: true });
  } else {
    queueRepair();
    observeOperations();
  }
}

export {
  CUSTOM_TAB_KEYS,
  ensureRuntimeMarker,
  recreateCustomTabs
};
