import { operationsManagementScreen } from './operations-management.js';

const INSTALL_MARKER = '__operations2027RootBindHotfixInstalled';
const OPS_2027_SELECTOR = '.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027';

export function resolveOperations2027ScreenRoot(container) {
  if (!container) return null;
  if (container.matches?.(OPS_2027_SELECTOR)) return container;
  return container.querySelector?.(OPS_2027_SELECTOR) || null;
}

export function applyOperations2027VisibleLabels(screenRoot) {
  const workshopTab = screenRoot?.querySelector?.('[data-ops-tab="workshops"]');
  if (workshopTab) workshopTab.textContent = 'מלאי סדנאות';
}

function installRootBindHotfix() {
  if (operationsManagementScreen[INSTALL_MARKER]) return;
  operationsManagementScreen[INSTALL_MARKER] = true;

  const originalBind = operationsManagementScreen.bind;
  operationsManagementScreen.bind = function wrappedOperations2027RootBind(context = {}) {
    const screenRoot = resolveOperations2027ScreenRoot(context.root);
    if (!screenRoot) return originalBind.call(this, context);

    applyOperations2027VisibleLabels(screenRoot);
    return originalBind.call(this, { ...context, root: screenRoot });
  };
}

installRootBindHotfix();
