import { hydrateNextYearPricingSelection } from './proposal-next-year-selection-hydration.js';

const INSTALL_KEY = Symbol.for('taasiyeda.nextYearOptionPriceSync.v2');
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

function install(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef[INSTALL_KEY]) return;
  Object.defineProperty(documentRef, INSTALL_KEY, { value: true, configurable: false });

  documentRef.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    if (!row || !NEXT_YEAR_GROUPS.has(rowGroup(row))) return;

    const selectedValue = text(select.value);
    const selectedOption = select.selectedOptions?.[0];
    const isBundleParent = selectedOption?.dataset?.bundleParent === '1';

    // Single next-year rows can be injected after the screen built its original
    // pricing lookup. Own those selections here so the stale screen lookup cannot
    // discard the chosen workshop. Bundle parents still use the native bundle UI.
    if (selectedValue && !selectedValue.startsWith('__') && !isBundleParent) {
      event.stopPropagation();
      hydrateNextYearPricingSelection(row, undefined, { notify: false });
      refreshNextYearPreview(row);
    }

    queueMicrotask(() => syncSelectedNextYearOptionPrice(row));
  }, true);
}

if (typeof document !== 'undefined') install(globalThis);
