import { api } from './api.js';
import { augmentNextYearPricingRows } from './proposal-next-year-workshops.js';
import { applyNextYearSpaceWorkshopPrice } from './proposal-next-year-space-workshop-pricing.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearSelectionHydration.v3');
const INTERNAL_GROUPS = new Set(['next_year_courses', 'next_year_workshops']);
const totalsTimers = new WeakMap();
let cachedPricingRows = [];

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function optionKey(row = {}) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order]
    .map(text).join('||');
}

function normalizePricingRows(rows = []) {
  return applyNextYearSpaceWorkshopPrice(augmentNextYearPricingRows(Array.isArray(rows) ? rows : []));
}

function cachePricing(rows = []) {
  if (Array.isArray(rows)) cachedPricingRows = normalizePricingRows(rows);
  return rows;
}

function cachePayload(payload = {}) {
  const rows = payload?.proposalActivityPricing || payload?.proposal_activity_pricing;
  if (Array.isArray(rows)) cachePricing(rows);
  return payload;
}

function wrapPayloadMethod(targetApi, name) {
  const original = targetApi?.[name];
  if (typeof original !== 'function') return;
  targetApi[name] = async function nextYearSelectionPayload(...args) {
    return cachePayload(await original.apply(this, args));
  };
}

function wrapPricingMethod(targetApi, name) {
  const original = targetApi?.[name];
  if (typeof original !== 'function') return;
  targetApi[name] = async function nextYearSelectionPricing(...args) {
    return cachePricing(await original.apply(this, args));
  };
}

function rowGroup(row) {
  return text(
    row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup
    || row?.dataset?.paRowGroup
    || row?.querySelector?.('[name="proposal_group"]')?.value
  );
}

function isWorkshopEntry(entry = {}) {
  const group = text(entry.proposal_group || entry.group_key);
  if (group === 'next_year_workshops') return true;
  if (group === 'next_year_courses') return false;
  const kind = text([entry.item_type, entry.activity_name, entry.pricing_key, entry.parent_pricing_key].join(' ')).toLowerCase();
  return text(entry.proposal_display_mode) === 'bundle_parent'
    || entry.is_bundle_parent === true
    || /סדנ|workshop|stem|חלל|maker/.test(kind);
}

function rowsForGroup(rows, group) {
  const normalized = normalizePricingRows(rows);
  const exact = normalized.filter((entry) => text(entry.proposal_group || entry.group_key) === group);
  if (exact.length) return exact;
  return normalized.filter((entry) => group === 'next_year_workshops'
    ? isWorkshopEntry(entry)
    : !isWorkshopEntry(entry) && Boolean(text(entry.activity_no || entry.gefen_number)));
}

function pricingIndex(rows) {
  const byOption = new Map();
  const byActivityNo = new Map();
  const byPricingKey = new Map();
  const byName = new Map();
  rows.forEach((entry) => {
    const key = optionKey(entry);
    if (key && !byOption.has(key)) byOption.set(key, entry);
    const activityNo = text(entry.activity_no);
    if (activityNo && !byActivityNo.has(activityNo)) byActivityNo.set(activityNo, entry);
    const pricingKey = text(entry.pricing_key);
    if (pricingKey && !byPricingKey.has(pricingKey)) byPricingKey.set(pricingKey, entry);
    const name = text(entry.activity_name).toLowerCase();
    if (name && !byName.has(name)) byName.set(name, entry);
  });
  return { byOption, byActivityNo, byPricingKey, byName };
}

/**
 * Option values already embed the full pricing identity (activity_no, name,
 * item_type, proposal_group, unit_duration, unit_price, sort_order joined by
 * "||" — see optionKey above), and the visible label always carries the same
 * price. When the pricing catalog cache hasn't populated yet (or no longer
 * has a matching row), this reconstructs a pricing row straight from what's
 * already selected on screen instead of leaving the row unpriced.
 */
function pickedFromSelectedOption(select) {
  const selected = text(select?.value);
  if (!selected) return null;
  const parts = selected.split('||');
  const [activityNo, activityName, itemType, proposalGroup, unitDuration, unitPriceRaw, sortOrder] = parts.map(text);
  const label = text(select.selectedOptions?.[0]?.textContent);
  const labelPrice = numberOrNull(label.replace(/[^0-9.,-]/g, ''));
  const embeddedPrice = numberOrNull(unitPriceRaw);
  const unitPrice = embeddedPrice != null && embeddedPrice > 0 ? embeddedPrice : labelPrice;
  const name = activityName || text(label.split('—')[0]);
  if (!name || unitPrice == null || unitPrice <= 0) return null;
  return {
    activity_no: activityNo,
    activity_name: name,
    item_type: itemType,
    proposal_group: proposalGroup,
    unit_duration: unitDuration,
    unit_price: unitPrice,
    hourly_price: unitPrice,
    sort_order: numberOrNull(sortOrder),
    pricing_key: ''
  };
}

function resolvePicked(row, rows) {
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  const selected = text(select?.value);
  if (!selected) return null;
  const index = pricingIndex(rows);
  if (index.byOption.has(selected)) return index.byOption.get(selected);
  if (index.byActivityNo.has(selected)) return index.byActivityNo.get(selected);
  if (index.byPricingKey.has(selected)) return index.byPricingKey.get(selected);
  const parts = selected.split('||');
  const activityNo = text(parts[0]);
  const name = text(parts[1]).toLowerCase();
  if (activityNo && index.byActivityNo.has(activityNo)) return index.byActivityNo.get(activityNo);
  if (name && index.byName.has(name)) return index.byName.get(name);
  const selectedName = text(select.selectedOptions?.[0]?.textContent?.split('—')?.[0]).toLowerCase();
  if (selectedName && index.byName.has(selectedName)) return index.byName.get(selectedName);
  return pickedFromSelectedOption(select);
}

function setValue(row, name, value) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return false;
  const next = value == null ? '' : String(value);
  if (input.value === next) return false;
  input.value = next;
  return true;
}

function calculateRow(row) {
  const quantity = numberOrNull(row?.querySelector?.('[data-pa-item-qty]')?.value) ?? 0;
  const price = numberOrNull(row?.querySelector?.('[data-pa-item-price]')?.value) ?? 0;
  const total = quantity > 0 && price > 0 ? quantity * price : 0;
  const hidden = row?.querySelector?.('[data-pa-item-total]');
  const display = row?.querySelector?.('[data-pa-item-total-display]');
  if (hidden) hidden.value = total > 0 ? total.toFixed(2) : '';
  if (display) display.textContent = total > 0 ? `₪ ${formatCurrency(total)}` : '₪ 0';
  return total;
}

export function calculateNextYearTotals(form) {
  if (!form) return 0;
  let subtotal = 0;
  form.querySelectorAll('[data-pa-items-group]').forEach((section) => {
    let groupTotal = 0;
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => { groupTotal += calculateRow(row); });
    subtotal += groupTotal;
    const group = text(section.dataset.paItemsGroup);
    const output = section.querySelector(`[data-pa-group-total="${group}"]`);
    if (output) output.textContent = `₪ ${formatCurrency(groupTotal)}`;
  });
  const discountType = text(form.querySelector('[data-pa-discount-type]')?.value) || 'amount';
  const discountValue = numberOrNull(form.querySelector('[data-pa-discount-value]')?.value) ?? 0;
  const discount = discountType === 'percent'
    ? subtotal * (Math.min(discountValue, 100) / 100)
    : Math.min(discountValue, subtotal);
  const total = Math.max(subtotal - discount, 0);
  const grand = form.querySelector('[data-pa-grand-total]');
  const summary = form.querySelector('[data-pa-summary-total]');
  const subtotalOutput = form.querySelector('[data-pa-summary-subtotal]');
  const discountOutput = form.querySelector('[data-pa-summary-discount]');
  if (grand) grand.textContent = `₪ ${formatCurrency(total)}`;
  if (summary) summary.textContent = `₪ ${formatCurrency(total)}`;
  if (subtotalOutput) subtotalOutput.textContent = `₪ ${formatCurrency(subtotal)}`;
  if (discountOutput) discountOutput.textContent = discount > 0 ? `-₪ ${formatCurrency(discount)}` : '₪ 0';
  return total;
}

function scheduleTotals(form, delay = 0) {
  if (!form) return;
  const previous = totalsTimers.get(form);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    totalsTimers.delete(form);
    if (form.isConnected) calculateNextYearTotals(form);
  }, delay);
  totalsTimers.set(form, timer);
}

export function hydrateNextYearPricingSelection(row, pricingRows = cachedPricingRows, { notify = true } = {}) {
  const group = rowGroup(row);
  if (!row || !INTERNAL_GROUPS.has(group)) return { changed: false, picked: null, total: 0 };
  const picked = resolvePicked(row, rowsForGroup(pricingRows, group));
  const form = row.closest('[data-pa-form]');
  if (!picked) return { changed: false, picked: null, total: calculateNextYearTotals(form) };

  const selectedValue = text(row.querySelector('[data-pa-pricing-select]')?.value);
  let changed = false;
  changed = setValue(row, 'pricing_option_key', selectedValue) || changed;
  changed = setValue(row, 'activity_no', picked.activity_no) || changed;
  changed = setValue(row, 'item_name', picked.activity_name) || changed;
  changed = setValue(row, 'item_type', picked.item_type) || changed;
  changed = setValue(row, 'gefen_number', picked.gefen_number) || changed;
  changed = setValue(row, 'gefen_number_display', picked.gefen_number) || changed;
  changed = setValue(row, 'meetings_count', picked.meetings_count) || changed;
  changed = setValue(row, 'hours_count', picked.hours_count) || changed;
  changed = setValue(row, 'unit_duration', picked.unit_duration) || changed;
  changed = setValue(row, 'unit_price', numberOrNull(picked.unit_price) ?? '') || changed;
  changed = setValue(row, 'hourly_price', picked.hourly_price ?? '') || changed;
  changed = setValue(row, 'description', picked.description_for_proposal || '') || changed;
  changed = setValue(row, 'proposal_group', group) || changed;
  changed = setValue(row, 'item_display_mode', picked.proposal_display_mode || 'single') || changed;
  changed = setValue(row, 'item_source_pricing_key', picked.pricing_key || '') || changed;
  changed = setValue(row, 'bundle_pricing_key', picked.pricing_key || '') || changed;
  changed = setValue(row, 'item_selected_bundle_items', '[]') || changed;

  const total = calculateNextYearTotals(form);
  const priceInput = row.querySelector('[data-pa-item-price]');
  if (changed && notify && form && priceInput && form.dataset.paNextYearDirectHydration !== 'yes') {
    form.dataset.paNextYearDirectHydration = 'yes';
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    delete form.dataset.paNextYearDirectHydration;
  }
  scheduleTotals(form, 100);
  return { changed, picked, total };
}

function isNextYearForm(form) {
  return Boolean(form?.querySelector?.('[data-pa-items-group]'));
}

function installRuntime(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef) return;

  documentRef.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    if (!row || !INTERNAL_GROUPS.has(rowGroup(row))) return;
    // The native form change path owns the final total and live-preview refresh.
    hydrateNextYearPricingSelection(row, cachedPricingRows, { notify: false });
  }, true);

  documentRef.addEventListener('input', (event) => {
    const target = event.target;
    if (!target?.matches?.('[data-pa-item-qty], [data-pa-item-price], [data-pa-discount-value], [data-pa-discount-type]')) return;
    const form = target.closest('[data-pa-form]');
    // Scoped to next-year forms only: this module owns totals for
    // next_year_courses/next_year_workshops rows exclusively. Other proposal
    // types (gefen, summer, tour...) keep using the generic calculator in
    // screens/proposals-agreements.js so there is exactly one owner per form.
    if (!isNextYearForm(form)) return;
    calculateNextYearTotals(form);
    scheduleTotals(form, 80);
  }, true);
}

export function installNextYearSelectionHydration(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  wrapPayloadMethod(targetApi, 'proposalsAgreements');
  wrapPayloadMethod(targetApi, 'proposalsAgreementsEditorDeps');
  wrapPricingMethod(targetApi, 'readProposalActivityPricing');
  installRuntime(scope);
  Object.defineProperty(targetApi, PATCH_KEY, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installNextYearSelectionHydration(api, globalThis);
