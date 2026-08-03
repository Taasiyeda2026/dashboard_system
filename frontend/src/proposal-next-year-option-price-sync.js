import { hydrateNextYearPricingSelection } from './proposal-next-year-selection-hydration.js';

const INSTALL_KEY = Symbol.for('taasiyeda.nextYearOptionPriceSync.v3');
const NEXT_YEAR_GROUPS = new Set(['next_year_courses', 'next_year_workshops']);

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
  const parsed = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString('he-IL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function rowGroup(row) {
  return text(
    row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup
    || row?.dataset?.paRowGroup
    || row?.querySelector?.('[name="proposal_group"]')?.value
  );
}

function setRowValue(row, name, value) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return false;
  const next = value == null ? '' : String(value);
  if (input.value === next) return false;
  input.value = next;
  return true;
}

export function syncSelectedNextYearOptionPrice(row) {
  if (!row || !NEXT_YEAR_GROUPS.has(rowGroup(row))) return false;
  const select = row.querySelector('[data-pa-pricing-select]');
  const option = select?.selectedOptions?.[0];
  const price = numberValue(row.querySelector('[data-pa-item-price]')?.value);
  if (!option || !text(option.value) || price <= 0) return false;

  const current = text(option.textContent);
  const nextPrice = `₪ ${formatPrice(price)}`;
  const next = /₪\s*[\d,.]+/.test(current)
    ? current.replace(/₪\s*[\d,.]+/g, nextPrice)
    : `${current} — ${nextPrice}`;
  if (current === next) return false;
  option.textContent = next;
  return true;
}

function refreshNextYearPreview(row) {
  const form = row?.closest?.('[data-pa-form]');
  const priceInput = row?.querySelector?.('[data-pa-item-price]');
  if (!form || !priceInput || form.dataset.paNextYearOptionSelection === 'yes') return;
  form.dataset.paNextYearOptionSelection = 'yes';
  priceInput.dispatchEvent(new Event('input', { bubbles: true }));
  delete form.dataset.paNextYearOptionSelection;
}

/**
 * The screen's native pricing handler owns the complete editor update, including
 * compact row text and bundle-parent details. Some next-year options are injected
 * after that handler built its lookup, so their compound option key is unknown to
 * it. Temporarily expose the activity name as the option value during the native
 * change event. The native lookup already knows the source pricing row by name.
 * After the event completes, restore the exact compound identity and displayed
 * next-year price, then trigger one totals/live-preview refresh.
 */
export function bridgeNextYearPricingSelection(row) {
  if (!row || !NEXT_YEAR_GROUPS.has(rowGroup(row))) return null;
  const select = row.querySelector('[data-pa-pricing-select]');
  const option = select?.selectedOptions?.[0];
  const originalValue = text(option?.value);
  if (!option || !originalValue || originalValue.startsWith('__')) return null;

  const parts = originalValue.split('||').map(text);
  const activityName = parts[1] || text(option.textContent).split('—')[0].trim();
  if (!activityName || activityName === originalValue) return null;
  const embeddedPrice = numberValue(parts[5]);

  option.value = activityName;

  return () => {
    option.value = originalValue;
    hydrateNextYearPricingSelection(row, undefined, { notify: false });
    setRowValue(row, 'pricing_option_key', originalValue);
    if (embeddedPrice > 0) setRowValue(row, 'unit_price', embeddedPrice);
    refreshNextYearPreview(row);
    syncSelectedNextYearOptionPrice(row);
  };
}

function install(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef[INSTALL_KEY]) return;
  Object.defineProperty(documentRef, INSTALL_KEY, { value: true, configurable: false });

  documentRef.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    if (!row || !NEXT_YEAR_GROUPS.has(rowGroup(row))) return;

    const restore = bridgeNextYearPricingSelection(row);
    queueMicrotask(() => {
      if (restore) restore();
      else syncSelectedNextYearOptionPrice(row);
    });
  }, true);
}

if (typeof document !== 'undefined') install(globalThis);
