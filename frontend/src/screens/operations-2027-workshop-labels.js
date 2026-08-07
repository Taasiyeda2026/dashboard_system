import { operationsManagementScreen } from './operations-management.js';

const INSTALL_MARKER = '__operations2027WorkshopLabelsInstalled';
const HEADER_LABELS = new Map([
  ['מלאי פתיחה 2027', 'מלאי פתיחה'],
  ['ניצול בפועל 2027', 'ניצול בפועל'],
  ['צפי נדרש 2027', 'צפי נדרש'],
  ['יתרה צפויה 2027', 'יתרה צפויה']
]);

function resolveOperations2027Root(container) {
  if (!container) return null;
  if (container.matches?.('[data-ops-year="2027"], .ops-year-2027')) return container;
  return container.querySelector?.(
    '.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027'
  ) || null;
}

function replaceHeaderLabel(header) {
  if (!header) return;
  for (const node of header.childNodes) {
    if (node.nodeType !== 3) continue;
    const original = String(node.textContent || '');
    for (const [from, to] of HEADER_LABELS.entries()) {
      if (!original.includes(from)) continue;
      node.textContent = original.replace(from, to);
      return;
    }
  }
  const fullText = String(header.textContent || '').trim();
  const replacement = HEADER_LABELS.get(fullText);
  if (replacement) header.textContent = replacement;
}

export function applyOperations2027WorkshopLabels(container) {
  const root = resolveOperations2027Root(container);
  if (!root) return;
  root.querySelectorAll('.ds-ops-workshops-table thead th').forEach(replaceHeaderLabel);
}

function installOperations2027WorkshopLabels() {
  if (operationsManagementScreen[INSTALL_MARKER]) return;
  operationsManagementScreen[INSTALL_MARKER] = true;
  const originalBind = operationsManagementScreen.bind;
  operationsManagementScreen.bind = function wrappedOperations2027WorkshopLabels(context = {}) {
    originalBind.call(this, context);
    applyOperations2027WorkshopLabels(context.root);
  };
}

installOperations2027WorkshopLabels();
