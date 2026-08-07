import { operationsManagementScreen } from './operations-management.js';
import { ACTIVITY_SEASON_SCHOOL_2027 } from './shared/summer-activity.js';

const HIDDEN_2027_TABS = new Set(['authorities', 'completion_approval']);
const FIX_MARKER = '__operations2027RemainingFixApplied';

function is2027State(state = {}) {
  const value = String(state?.operationsManagement?.period || state?.activityPeriodTab || '').trim();
  return value === ACTIVITY_SEASON_SCHOOL_2027 || value === '2027';
}

function activeOperationsTab(state = {}) {
  return String(state?.operationsManagement?.tab || '').trim();
}

function distributionQuantity(row = {}) {
  for (const field of ['quantity_received', 'quantity', 'qty', 'amount']) {
    const value = row?.[field];
    if (value !== undefined && value !== '' && Number.isFinite(Number(value))) return Number(value);
  }
  return 0;
}

function distributionGroupKey(row = {}) {
  return String(row?.stock_group_key || row?.stockGroupKey || row?.workshop_stock_group_key || '').trim();
}

function distributionLocation(row = {}) {
  return String(row?.instructor_name || row?.instructor || row?.guide_name || row?.guide || row?.recipient_name || row?.employee_name || '').trim();
}

function isSchool2027Activity(row = {}) {
  const season = String(row?.activity_season || row?.activity_period || '').trim();
  return season === ACTIVITY_SEASON_SCHOOL_2027;
}

function aggregatePositiveDistributions(rows = []) {
  const byLocation = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row, index) => {
    const quantity = distributionQuantity(row);
    if (quantity <= 0) return;
    const group = distributionGroupKey(row);
    const location = distributionLocation(row);
    const key = group && location ? `${group}::${location}` : `unmatched::${index}`;
    const current = byLocation.get(key);
    if (!current) {
      byLocation.set(key, { ...row, quantity_received: quantity });
      return;
    }
    current.quantity_received = distributionQuantity(current) + quantity;
  });
  return Array.from(byLocation.values());
}

export function normalizeWorkshopInventory2027Data(data = {}, state = {}) {
  if (!is2027State(state) || activeOperationsTab(state) !== 'workshops') return data;
  return {
    ...data,
    workshopStockDistributions: aggregatePositiveDistributions(data?.workshopStockDistributions),
    workshopInventory2027Rows: (Array.isArray(data?.workshopInventory2027Rows) ? data.workshopInventory2027Rows : [])
      .filter(isSchool2027Activity)
  };
}

function mark2027Root(html) {
  return String(html || '').replace(
    'class="ds-screen-stack ds-ops-mgmt-screen"',
    'class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"'
  );
}

function resetHiddenActiveTab(state = {}) {
  if (!is2027State(state)) return;
  // Instructors work-schedule left operations management; fall back to workshops in 2027 ops context.
  if (state?.operationsManagement?.context === 'instructors') return;
  if (!HIDDEN_2027_TABS.has(activeOperationsTab(state))) return;
  state.operationsManagement = state.operationsManagement || {};
  state.operationsManagement.tab = 'workshops';
}

function installScreenWrappers() {
  if (operationsManagementScreen[FIX_MARKER]) return;
  operationsManagementScreen[FIX_MARKER] = true;

  const originalLoad = operationsManagementScreen.load;
  operationsManagementScreen.load = async function wrappedOperationsLoad(context = {}) {
    const data = await originalLoad.call(this, context);
    return normalizeWorkshopInventory2027Data(data || {}, context.state || {});
  };

  const originalRender = operationsManagementScreen.render;
  operationsManagementScreen.render = function wrappedOperationsRender(data, context = {}) {
    const state = context.state || {};
    resetHiddenActiveTab(state);

    if (!is2027State(state)) return originalRender.call(this, data, context);

    const normalizedData = normalizeWorkshopInventory2027Data(data || {}, state);
    const html = originalRender.call(this, normalizedData, context);
    return mark2027Root(html);
  };
}

function ensureImmediateHideStyle() {
  if (typeof document === 'undefined' || document.getElementById('ops-2027-remaining-fix-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-remaining-fix-style';
  style.textContent = `
    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-filter-field:has([data-ops-period]),
    .ds-ops-mgmt-screen[data-ops-year="2027"] [data-ops-tab="authorities"],
    .ds-ops-mgmt-screen[data-ops-year="2027"] [data-ops-tab="completion_approval"] {
      display: none !important;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-workshop-col--location {
      width: 250px !important;
      min-width: 210px !important;
      max-width: 290px !important;
      white-space: normal !important;
      text-align: right !important;
      font-size: 10px !important;
      line-height: 1.25 !important;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-list {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 8px;
      align-items: center;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-item {
      display: inline-flex;
      gap: 3px;
      white-space: nowrap;
      color: #334155;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-item strong {
      color: #17365d;
      font-weight: 700;
    }

    .ds-ops-mgmt-screen[data-ops-year="2027"] .ds-ops-opening-location-empty {
      color: #64748b;
    }
  `;
  document.head.appendChild(style);
}

function cleanup2027Dom() {
  if (typeof document === 'undefined') return;
  const root = document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"]');
  if (!root) return;

  const periodControl = root.querySelector('[data-ops-period]');
  periodControl?.closest?.('.ds-filter-field')?.remove?.();
  HIDDEN_2027_TABS.forEach((tab) => root.querySelector(`[data-ops-tab="${tab}"]`)?.remove?.());
}

let cleanupQueued = false;
function scheduleCleanup() {
  if (cleanupQueued || typeof requestAnimationFrame !== 'function') return;
  cleanupQueued = true;
  requestAnimationFrame(() => {
    cleanupQueued = false;
    cleanup2027Dom();
  });
}

function installDomCleanup() {
  if (typeof document === 'undefined') return;
  ensureImmediateHideStyle();
  scheduleCleanup();
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    const observer = new MutationObserver(() => scheduleCleanup());
    observer.observe(app, { childList: true, subtree: true });
  }
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('.ds-ops-mgmt-screen [data-ops-tab], .ds-ops-mgmt-screen [data-ops-custom-tab]')) {
      scheduleCleanup();
    }
  }, true);
}

installScreenWrappers();
installDomCleanup();
