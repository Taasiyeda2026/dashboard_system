import { operationsManagementScreen } from './operations-management.js';
import {
  ACTIVITY_SEASON_REGULAR,
  ACTIVITY_SEASON_SCHOOL_2027
} from './shared/summer-activity.js';

const WORKSHOPS_2026_FROM = '2026-06-15';
const WORKSHOPS_2026_TO = '2026-08-30';
const HIDDEN_2027_TABS = new Set(['authorities', 'completion_approval']);
const FIX_MARKER = '__operations2027RemainingFixApplied';

function is2027State(state = {}) {
  const value = String(state?.operationsManagement?.period || state?.activityPeriodTab || '').trim();
  return value === ACTIVITY_SEASON_SCHOOL_2027 || value === '2027';
}

function activeOperationsTab(state = {}) {
  return String(state?.operationsManagement?.tab || '').trim();
}

async function ensure2026OpeningStockRows(data, context = {}) {
  if (!is2027State(context.state)) return data;
  if (Array.isArray(data?.workshopInventorySourceRows) && data.workshopInventorySourceRows.length) return data;
  if (!context.api?.allActivities) return data;

  const response = await context.api.allActivities({
    activity_period: ACTIVITY_SEASON_REGULAR,
    startDate: WORKSHOPS_2026_FROM,
    endDate: WORKSHOPS_2026_TO
  }).catch(() => ({ rows: [] }));

  data.workshopInventorySourceRows = Array.isArray(response?.rows) ? response.rows : [];
  return data;
}

function numberFromCell(cell) {
  const raw = String(cell?.textContent || '')
    .replace(/[\u200e\u200f,\s]/g, '')
    .replace(/−/g, '-')
    .replace(/[^0-9.+-]/g, '');
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function displayNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function workshopRows(root) {
  return Array.from(root?.querySelectorAll?.('tr[data-ops-stock-group]') || []);
}

function openingStockByGroup(html) {
  if (typeof document === 'undefined') return new Map();
  const template = document.createElement('template');
  template.innerHTML = html;
  const result = new Map();
  workshopRows(template.content).forEach((row) => {
    const key = String(row.getAttribute('data-ops-stock-group') || '').trim();
    const value = numberFromCell(row.cells?.[2]);
    if (key && value !== null) result.set(key, value);
  });
  return result;
}

function applyOpeningStockToCurrentYear(currentHtml, carryoverHtml) {
  if (typeof document === 'undefined') return currentHtml;
  const openingByGroup = openingStockByGroup(carryoverHtml);
  if (!openingByGroup.size) return currentHtml;

  const template = document.createElement('template');
  template.innerHTML = currentHtml;
  workshopRows(template.content).forEach((row) => {
    const key = String(row.getAttribute('data-ops-stock-group') || '').trim();
    if (!openingByGroup.has(key) || !row.cells || row.cells.length < 7) return;

    const opening = openingByGroup.get(key);
    const used = numberFromCell(row.cells[3]) || 0;
    const required = numberFromCell(row.cells[4]) || 0;
    const expected = opening - used - required;

    row.cells[2].textContent = displayNumber(opening);
    row.cells[2].setAttribute('dir', 'ltr');
    row.cells[5].textContent = displayNumber(expected);
    row.cells[5].setAttribute('dir', 'ltr');
    row.dataset.opsOpeningStock = displayNumber(opening);

    const currentStatus = String(row.cells[6].textContent || '').trim();
    if (expected < 0) row.cells[6].textContent = 'חסר מלאי';
    else if (currentStatus === 'חסר מלאי') row.cells[6].textContent = 'תקין';
  });
  return template.innerHTML;
}

function mark2027Root(html) {
  return String(html || '').replace(
    'class="ds-screen-stack ds-ops-mgmt-screen"',
    'class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027" data-ops-year="2027"'
  );
}

function resetHiddenActiveTab(state = {}) {
  if (!is2027State(state)) return;
  if (!HIDDEN_2027_TABS.has(activeOperationsTab(state))) return;
  state.operationsManagement = state.operationsManagement || {};
  state.operationsManagement.tab = 'instructors';
}

function installScreenWrappers() {
  if (operationsManagementScreen[FIX_MARKER]) return;
  operationsManagementScreen[FIX_MARKER] = true;

  const originalLoad = operationsManagementScreen.load;
  operationsManagementScreen.load = async function wrappedOperationsLoad(context = {}) {
    const data = await originalLoad.call(this, context);
    return ensure2026OpeningStockRows(data || {}, context);
  };

  const originalRender = operationsManagementScreen.render;
  operationsManagementScreen.render = function wrappedOperationsRender(data, context = {}) {
    const state = context.state || {};
    resetHiddenActiveTab(state);

    if (!is2027State(state)) return originalRender.call(this, data, context);

    let html;
    const isWorkshopInventory = activeOperationsTab(state) === 'workshops';
    const sourceRows = Array.isArray(data?.workshopInventorySourceRows) ? data.workshopInventorySourceRows : [];
    if (isWorkshopInventory && sourceRows.length && typeof document !== 'undefined') {
      const carryoverHtml = originalRender.call(this, data, context);
      const currentYearData = {
        ...data,
        workshopInventorySourceRows: Array.isArray(data?.rows) ? data.rows : []
      };
      const currentYearHtml = originalRender.call(this, currentYearData, context);
      html = applyOpeningStockToCurrentYear(currentYearHtml, carryoverHtml);
    } else {
      html = originalRender.call(this, data, context);
    }

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
