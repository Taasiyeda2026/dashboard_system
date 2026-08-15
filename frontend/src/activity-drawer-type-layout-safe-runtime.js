const TEST_FLAG = '__ACTIVITY_DRAWER_TYPE_LAYOUT_FIX_TEST__';
const ENHANCED_ATTR = 'data-activity-drawer-inline-layout';
const FIXED_ATTR = 'data-activity-drawer-type-layout-fixed';

const previousTestFlag = globalThis[TEST_FLAG];
globalThis[TEST_FLAG] = true;
const { applyActivityDrawerTypeLayoutFix } = await import('./activity-drawer-type-layout-fix.js');
if (previousTestFlag === undefined) delete globalThis[TEST_FLAG];
else globalThis[TEST_FLAG] = previousTestFlag;

function applyPending(root = document) {
  const selector = `[data-drawer-form][${ENHANCED_ATTR}]:not([${FIXED_ATTR}])`;
  const forms = [];
  if (root?.matches?.(selector)) forms.push(root);
  root?.querySelectorAll?.(selector).forEach((form) => forms.push(form));
  forms.forEach((form) => applyActivityDrawerTypeLayoutFix(form));
}

function initialize() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyPending(document);
    });
  };

  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [ENHANCED_ATTR]
  });
  schedule();
}

initialize();
