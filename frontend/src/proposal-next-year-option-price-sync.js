const INSTALL_KEY = Symbol.for('taasiyeda.nextYearOptionPriceSync.v1');
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

function install(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef[INSTALL_KEY]) return;
  Object.defineProperty(documentRef, INSTALL_KEY, { value: true, configurable: false });

  documentRef.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    if (!row) return;
    queueMicrotask(() => syncSelectedNextYearOptionPrice(row));
  }, true);
}

if (typeof document !== 'undefined') install(globalThis);
