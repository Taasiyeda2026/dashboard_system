import { api } from './api.js';
import { augmentNextYearPricingRows } from './proposal-next-year-workshops.js';
import { applyNextYearSpaceWorkshopPrice } from './proposal-next-year-space-workshop-pricing.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearSelectionHydration.v3');
const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
const INTERNAL_GROUPS = new Set([COURSE_GROUP, WORKSHOP_GROUP]);
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
  return [
    row.activity_no,
    row.activity_name,
    row.item_type,
    row.proposal_group,
    row.unit_duration,
    row.unit_price,
    row.sort_order
  ].map(text).join('||');
}

function normalizePricingRows(rows = []) {
  return applyNextYearSpaceWorkshopPrice(
    augmentNextYearPricingRows(Array.isArray(rows) ? rows : [])
  );
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
  if (group === WORKSHOP_GROUP) return true;
  if (group === COURSE_GROUP) return false;
  const kind = text([
    entry.item_type,
    entry.activity_name,
    entry.pricing_key,
    entry.parent_pricing_key
  ].join(' ')).toLowerCase();
  return text(entry.proposal_display_mode) === 'bundle_parent'
    || entry.is_bundle_parent === true
    || /סדנ|workshop|stem|חלל|maker/.test(kind);
}

function rowsForGroup(rows, group) {
  const normalized = normalizePricingRows(rows);
  const exact = normalized.filter((entry) => text(entry.proposal_group || entry.group_key) === group);
  if (exact.length) return exact;
  return normalized.filter((entry) => group === WORKSHOP_GROUP
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

function pickedFromOptionValue(selected, group) {
  const parts = String(selected || '').split('||');
  if (parts.length < 6) return null;
  const [activityNo, activityName, itemType, proposalGroup, unitDuration, unitPrice, sortOrder] = parts;
  if (!text(activityName)) return null;
  return {
    activity_no: text(activityNo),
    activity_name: text(activityName),
    item_type: text(itemType) || (group === WORKSHOP_GROUP ? 'סדנה' : 'קורס'),
    proposal_group: text(proposalGroup) || group,
    unit_duration: text(unitDuration),
    unit_price: numberOrNull(unitPrice),
    sort_order: numberOrNull(sortOrder)
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
  return pickedFromOptionValue(selected, rowGroup(row));
}

function setValue(row, name, value) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return false;
  const next = value == null ? '' : String(value);
  if (input.value === next) return false;
  input.value = next;
  return true;
}

function setPresentValue(row, name, value) {
  if (value == null || text(value) === '') return false;
  return setValue(row, name, value);
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
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => {
      groupTotal += calculateRow(row);
    });
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

export function hydrateNextYearPricingSelection(row, pricingRows = cachedPricingRows) {
  const group = rowGroup(row);
  if (!row || !INTERNAL_GROUPS.has(group)) {
    return { changed: false, picked: null, total: 0 };
  }

  const picked = resolvePicked(row, rowsForGroup(pricingRows, group));
  const form = row.closest('[data-pa-form]');
  if (!picked) {
    const total = calculateNextYearTotals(form);
    scheduleTotals(form, 80);
    return { changed: false, picked: null, total };
  }

  const selectedValue = text(row.querySelector('[data-pa-pricing-select]')?.value);
  let changed = false;
  const pickedPrice = numberOrNull(picked.unit_price);
  changed = setValue(row, 'pricing_option_key', selectedValue) || changed;
  changed = setPresentValue(row, 'activity_no', picked.activity_no) || changed;
  changed = setPresentValue(row, 'item_name', picked.activity_name) || changed;
  changed = setPresentValue(
    row,
    'item_type',
    picked.item_type || (group === WORKSHOP_GROUP ? 'סדנה' : 'קורס')
  ) || changed;
  changed = setPresentValue(row, 'gefen_number', picked.gefen_number) || changed;
  changed = setPresentValue(row, 'gefen_number_display', picked.gefen_number) || changed;
  changed = setPresentValue(row, 'meetings_count', picked.meetings_count) || changed;
  changed = setPresentValue(row, 'hours_count', picked.hours_count) || changed;
  changed = setPresentValue(
    row,
    'unit_duration',
    picked.unit_duration || (group === WORKSHOP_GROUP ? '45 דקות' : '')
  ) || changed;
  if (pickedPrice != null) changed = setValue(row, 'unit_price', pickedPrice) || changed;
  changed = setPresentValue(row, 'hourly_price', picked.hourly_price) || changed;
  changed = setPresentValue(row, 'description', picked.description_for_proposal) || changed;
  changed = setValue(row, 'proposal_group', group) || changed;

  const total = calculateNextYearTotals(form);
  scheduleTotals(form, 80);
  return { changed, picked, total };
}

function findCurrentRow(form, group, selectedValue, fallbackRow) {
  if (fallbackRow?.isConnected) return fallbackRow;
  const rows = Array.from(
    form?.querySelectorAll?.(`[data-pa-items-group="${group}"] [data-pa-item-row]`) || []
  );
  return rows.find((candidate) => text(candidate.querySelector('[data-pa-pricing-select]')?.value) === selectedValue)
    || rows.at(-1)
    || null;
}

function installRuntime(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef) return;

  documentRef.addEventListener('change', (event) => {
    const select = event.target?.closest?.('[data-pa-pricing-select]');
    const row = select?.closest?.('[data-pa-item-row]');
    const group = rowGroup(row);
    if (!row || !INTERNAL_GROUPS.has(group)) return;
    const form = row.closest('[data-pa-form]');
    const selectedValue = text(select.value);
    queueMicrotask(() => {
      const currentRow = findCurrentRow(form, group, selectedValue, row);
      if (currentRow) hydrateNextYearPricingSelection(currentRow, cachedPricingRows);
    });
  });

  documentRef.addEventListener('input', (event) => {
    const target = event.target;
    if (!target?.matches?.(
      '[data-pa-item-qty], [data-pa-item-price], [data-pa-discount-value], [data-pa-discount-type]'
    )) return;
    const form = target.closest('[data-pa-form]');
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
  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installNextYearSelectionHydration(api, globalThis);
