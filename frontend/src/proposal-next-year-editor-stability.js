import { api } from './api.js';
import { augmentNextYearPricingRows } from './proposal-next-year-workshops.js';
import { calculateNextYearTotals } from './proposal-next-year-selection-hydration.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearEditorStability.v6');
const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
const UNIFIED_GROUP = 'next_year';
const NEXT_YEAR_GROUPS = new Set([COURSE_GROUP, WORKSHOP_GROUP, UNIFIED_GROUP]);
const NEXT_YEAR_TYPE_ALIASES = new Set([
  'next_year', 'שנה הבאה', 'שנת הלימודים תשפ״ז', 'תוכניות תשפ״ז', 'תשפ״ז'
]);

let cachedPricingRows = [];
const scheduledForms = new WeakSet();

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

function normalizedName(value) {
  return text(value).replace(/[״"׳'`]/g, '').toLowerCase();
}

function pricingOptionKey(row = {}) {
  return [row.activity_no, row.activity_name, row.item_type, row.proposal_group, row.unit_duration, row.unit_price, row.sort_order]
    .map(text).join('||');
}

function pricingGroup(row = {}) {
  return text(row.group_key || row.proposal_group || row.activity_type_group);
}

function isWorkshopPricingRow(row = {}) {
  const group = pricingGroup(row);
  if (group === WORKSHOP_GROUP) return true;
  if (group === COURSE_GROUP) return false;
  const kind = normalizedName([row.item_type, row.activity_name, row.catalog_type, row.pricing_key, row.parent_pricing_key].join(' '));
  return text(row.proposal_display_mode) === 'bundle_parent'
    || row.is_bundle_parent === true
    || /סדנ|workshop|stem|חלל|maker/.test(kind);
}

function isCoursePricingRow(row = {}) {
  const group = pricingGroup(row);
  if (group === COURSE_GROUP) return true;
  if (group === WORKSHOP_GROUP || isWorkshopPricingRow(row)) return false;
  if (!NEXT_YEAR_TYPE_ALIASES.has(group)) return false;
  const kind = normalizedName([row.item_type, row.activity_name].join(' '));
  return /קורס|תוכנית|תכנית|program|course|הדרכה/.test(kind)
    || Boolean(text(row.gefen_number || row.activity_no));
}

export function pricingRowsForNextYearGroup(rows = [], groupKey = '') {
  const group = text(groupKey);
  if (!NEXT_YEAR_GROUPS.has(group)) return [];
  const augmented = augmentNextYearPricingRows(Array.isArray(rows) ? rows : []);
  if (group === UNIFIED_GROUP) {
    const merged = new Map();
    pricingRowsForNextYearGroup(augmented, COURSE_GROUP).forEach((row) => merged.set(pricingOptionKey(row), row));
    pricingRowsForNextYearGroup(augmented, WORKSHOP_GROUP).forEach((row) => merged.set(pricingOptionKey(row), row));
    return [...merged.values()];
  }
  const exact = augmented.filter((row) => pricingGroup(row) === group);
  const candidates = exact.length
    ? exact
    : augmented.filter((row) => group === WORKSHOP_GROUP ? isWorkshopPricingRow(row) : isCoursePricingRow(row));
  const seen = new Set();
  return candidates.filter((row) => {
    if (row?.is_active_for_proposals === false) return false;
    if (/^(?:שעות\s*)?בדיק/i.test(text(row.activity_name))) return false;
    if (/^תמיר/i.test(text(row.activity_name))) return false;
    if (group === COURSE_GROUP && text(row.proposal_display_mode) === 'bundle_child') return false;
    const key = pricingOptionKey(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cachePayload(payload = {}) {
  const rows = payload?.proposalActivityPricing || payload?.proposal_activity_pricing;
  if (Array.isArray(rows)) cachedPricingRows = augmentNextYearPricingRows(rows);
  return payload;
}

function wrapPayloadMethod(targetApi, name) {
  const original = targetApi?.[name];
  if (typeof original !== 'function') return;
  targetApi[name] = async function nextYearEditorPayload(...args) {
    return cachePayload(await original.apply(this, args));
  };
}

function wrapPricingMethod(targetApi, name) {
  const original = targetApi?.[name];
  if (typeof original !== 'function') return;
  targetApi[name] = async function nextYearEditorPricing(...args) {
    const rows = await original.apply(this, args);
    if (Array.isArray(rows)) cachedPricingRows = augmentNextYearPricingRows(rows);
    return rows;
  };
}

function rowField(row, name) {
  return text(row?.querySelector?.(`[name="${name}"]`)?.value);
}

function setInputValue(row, name, value, { overwrite = false } = {}) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return false;
  const current = text(input.value);
  const next = value == null ? '' : String(value);
  if (!overwrite && current) return false;
  if (input.value === next) return false;
  input.value = next;
  return true;
}

function rowHasMeaningfulSelection(row) {
  return Boolean(
    text(row?.querySelector?.('[data-pa-pricing-select]')?.value)
    || rowField(row, 'item_name')
    || rowField(row, 'activity_no')
    || rowField(row, 'pricing_option_key')
    || rowField(row, 'item_source_pricing_key')
    || numberOrNull(rowField(row, 'unit_price')) > 0
    || numberOrNull(rowField(row, 'total_price')) > 0
  );
}

export function isBlankNextYearEditorRow(row) {
  return Boolean(row) && !rowHasMeaningfulSelection(row);
}

function rowPricingIndexes(rows) {
  const byOption = new Map();
  const byActivityNo = new Map();
  const byPricingKey = new Map();
  const byName = new Map();
  rows.forEach((row) => {
    const optionKey = pricingOptionKey(row);
    if (optionKey && !byOption.has(optionKey)) byOption.set(optionKey, row);
    const activityNo = text(row.activity_no);
    if (activityNo && !byActivityNo.has(activityNo)) byActivityNo.set(activityNo, row);
    const pricingKey = text(row.pricing_key);
    if (pricingKey && !byPricingKey.has(pricingKey)) byPricingKey.set(pricingKey, row);
    const name = normalizedName(row.activity_name);
    if (name && !byName.has(name)) byName.set(name, row);
  });
  return { byOption, byActivityNo, byPricingKey, byName };
}

function resolvePricingForRow(row, pricingRows) {
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  const selectedValue = text(select?.value);
  const indexes = rowPricingIndexes(pricingRows);
  if (selectedValue && indexes.byOption.has(selectedValue)) return indexes.byOption.get(selectedValue);
  if (selectedValue && indexes.byActivityNo.has(selectedValue)) return indexes.byActivityNo.get(selectedValue);
  if (selectedValue && indexes.byPricingKey.has(selectedValue)) return indexes.byPricingKey.get(selectedValue);
  const activityNo = rowField(row, 'activity_no');
  if (activityNo && indexes.byActivityNo.has(activityNo)) return indexes.byActivityNo.get(activityNo);
  const sourceKey = rowField(row, 'item_source_pricing_key') || rowField(row, 'bundle_pricing_key');
  if (sourceKey && indexes.byPricingKey.has(sourceKey)) return indexes.byPricingKey.get(sourceKey);
  const name = normalizedName(rowField(row, 'item_name'));
  if (name && indexes.byName.has(name)) return indexes.byName.get(name);
  const selectedLabel = normalizedName(select?.selectedOptions?.[0]?.textContent?.split('—')?.[0]);
  return selectedLabel ? indexes.byName.get(selectedLabel) || null : null;
}

function optionLabel(row = {}) {
  const parts = [text(row.activity_name), text(row.item_type)];
  const price = numberOrNull(row.unit_price);
  if (price != null && price > 0) parts.push(`₪ ${formatCurrency(price)}`);
  return parts.filter(Boolean).join(' — ');
}

function ensurePricingOptions(select, pricingRows) {
  if (!select || !pricingRows.length) return false;
  const existing = new Set(Array.from(select.options || []).map((option) => text(option.value)).filter(Boolean));
  let changed = false;
  pricingRows.forEach((pricingRow) => {
    const value = pricingOptionKey(pricingRow);
    if (!value || existing.has(value)) return;
    const option = select.ownerDocument.createElement('option');
    option.value = value;
    option.textContent = optionLabel(pricingRow);
    if (text(pricingRow.proposal_display_mode) === 'bundle_parent' || pricingRow.is_bundle_parent === true) {
      option.dataset.bundleParent = '1';
    }
    select.appendChild(option);
    existing.add(value);
    changed = true;
  });
  return changed;
}

function hydrateRowFromPricing(row, pricingRows) {
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  if (!select) return false;
  ensurePricingOptions(select, pricingRows);
  const picked = resolvePricingForRow(row, pricingRows);
  if (!picked) return false;

  let changed = false;
  const selectedValue = text(select.value) || pricingOptionKey(picked);
  if (!text(select.value) && selectedValue && Array.from(select.options).some((option) => option.value === selectedValue)) {
    select.value = selectedValue;
    changed = true;
  }
  changed = setInputValue(row, 'pricing_option_key', selectedValue) || changed;
  changed = setInputValue(row, 'activity_no', picked.activity_no) || changed;
  changed = setInputValue(row, 'item_name', picked.activity_name) || changed;
  changed = setInputValue(row, 'item_type', picked.item_type) || changed;
  changed = setInputValue(row, 'gefen_number', picked.gefen_number) || changed;
  changed = setInputValue(row, 'gefen_number_display', picked.gefen_number) || changed;
  changed = setInputValue(row, 'meetings_count', picked.meetings_count) || changed;
  changed = setInputValue(row, 'hours_count', picked.hours_count) || changed;
  changed = setInputValue(row, 'unit_duration', picked.unit_duration) || changed;
  changed = setInputValue(row, 'item_source_pricing_key', picked.pricing_key) || changed;
  changed = setInputValue(row, 'bundle_pricing_key', picked.pricing_key) || changed;

  const storedPrice = numberOrNull(rowField(row, 'unit_price'));
  const catalogPrice = numberOrNull(picked.unit_price);
  if ((storedPrice == null || storedPrice <= 0) && catalogPrice != null && catalogPrice > 0) {
    changed = setInputValue(row, 'unit_price', catalogPrice, { overwrite: true }) || changed;
  }
  const price = numberOrNull(rowField(row, 'unit_price'));
  const hours = numberOrNull(rowField(row, 'hours_count'));
  if (!rowField(row, 'hourly_price') && price != null && hours != null && hours > 0) {
    changed = setInputValue(row, 'hourly_price', Number((price / hours).toFixed(4)), { overwrite: true }) || changed;
  }
  return changed;
}

function nextYearForm(form) {
  const type = text(form?.querySelector?.('[name="activity_type_group"]')?.value);
  return NEXT_YEAR_TYPE_ALIASES.has(type)
    || Boolean(form?.querySelector?.(`[data-pa-items-group="${COURSE_GROUP}"], [data-pa-items-group="${WORKSHOP_GROUP}"], [data-pa-next-year-unified]`));
}

function markPendingUserRow(form) {
  const group = text(form?.dataset?.paNextYearPendingAddGroup);
  if (!NEXT_YEAR_GROUPS.has(group)) return;
  const section = form.querySelector(`[data-pa-items-group="${group}"], [data-pa-next-year-unified]`);
  const rows = Array.from(section?.querySelectorAll?.('[data-pa-item-row]') || []);
  const row = rows.filter((item) => item.dataset.paNextYearUserAdded !== 'yes').at(-1);
  if (row) row.dataset.paNextYearUserAdded = 'yes';
  delete form.dataset.paNextYearPendingAddGroup;
}

export function removeBlankNextYearRows(form) {
  if (!form || !nextYearForm(form)) return 0;
  let removed = 0;
  const rowSelector = form.querySelector('[data-pa-next-year-unified]')
    ? '[data-pa-next-year-unified] [data-pa-item-row]'
    : `[data-pa-items-group="${COURSE_GROUP}"] [data-pa-item-row], [data-pa-items-group="${WORKSHOP_GROUP}"] [data-pa-item-row]`;
  form.querySelectorAll(rowSelector).forEach((row) => {
    if (!isBlankNextYearEditorRow(row)) return;
    row.remove();
    removed += 1;
  });
  if (removed) calculateNextYearTotals(form);
  return removed;
}

export function stabilizeNextYearForm(form, pricingRows = cachedPricingRows, options = {}) {
  if (!form || !nextYearForm(form)) return { changed: false, removed: 0, total: 0 };
  markPendingUserRow(form);
  let changed = false;
  let removed = 0;
  const childSections = [COURSE_GROUP, WORKSHOP_GROUP]
    .map((groupKey) => form.querySelector(`[data-pa-items-group="${groupKey}"]`))
    .filter(Boolean);
  const unifiedSection = form.querySelector('[data-pa-next-year-unified]');
  // Shared picker host wraps two typed sections; prefer those so options stay complete.
  const sections = childSections.length
    ? childSections
    : (unifiedSection ? [unifiedSection] : []);

  sections.forEach((section) => {
    const groupKey = text(section.dataset.paItemsGroup) || UNIFIED_GROUP;
    const useUnifiedOptions = Boolean(unifiedSection) || groupKey === UNIFIED_GROUP;
    const groupRows = pricingRowsForNextYearGroup(pricingRows, useUnifiedOptions ? UNIFIED_GROUP : groupKey);
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => {
      const userAdded = row.dataset.paNextYearUserAdded === 'yes';
      if (options.removeBlankRows === true && !userAdded && isBlankNextYearEditorRow(row)) {
        row.remove();
        removed += 1;
        changed = true;
        return;
      }
      changed = ensurePricingOptions(row.querySelector('[data-pa-pricing-select]'), groupRows) || changed;
      if (rowHasMeaningfulSelection(row)) changed = hydrateRowFromPricing(row, groupRows) || changed;
    });
  });

  const total = calculateNextYearTotals(form);
  if (options.notify !== false && (changed || removed > 0)) {
    const target = form.querySelector('[data-pa-item-price]') || form.querySelector('[data-pa-item-qty]');
    if (target && form.dataset.paNextYearHydrating !== 'yes') {
      form.dataset.paNextYearHydrating = 'yes';
      target.dispatchEvent(new Event('input', { bubbles: true }));
      delete form.dataset.paNextYearHydrating;
    }
  }
  return { changed, removed, total };
}

function scheduleForm(form, options = {}) {
  if (!form || scheduledForms.has(form)) return;
  scheduledForms.add(form);
  const run = () => {
    scheduledForms.delete(form);
    if (form.isConnected) stabilizeNextYearForm(form, cachedPricingRows, { ...options, notify: false });
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function formsInNode(node) {
  if (!(node instanceof Element)) return [];
  const forms = [];
  if (node.matches('[data-pa-form]')) forms.push(node);
  node.querySelectorAll?.('[data-pa-form]').forEach((form) => forms.push(form));
  const closest = node.closest?.('[data-pa-form]');
  if (closest) forms.push(closest);
  return [...new Set(forms)];
}

function installDomRuntime(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef?.documentElement || typeof scope?.MutationObserver !== 'function') return;

  documentRef.addEventListener('click', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (form && event.target?.closest?.('[data-pa-save-draft], [data-pa-save-pending], [data-pa-preview], [data-pa-type-btn]')) {
      removeBlankNextYearRows(form);
    }

    const addButton = event.target?.closest?.('[data-pa-add-item][data-pa-add-item-group], [data-pa-next-year-unified] [data-pa-add-item]');
    if (!addButton) return;
    const addForm = addButton.closest('[data-pa-form]');
    const group = text(addButton.dataset.paAddItemGroup) || (addButton.closest('[data-pa-next-year-unified]') ? UNIFIED_GROUP : '');
    if (!addForm || !NEXT_YEAR_GROUPS.has(group)) return;
    addForm.dataset.paNextYearPendingAddGroup = group;
    queueMicrotask(() => scheduleForm(addForm, { removeBlankRows: false }));
  }, true);

  documentRef.addEventListener('change', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (!form || !event.target?.matches?.('[name="activity_type_group"]')) return;
    removeBlankNextYearRows(form);
    queueMicrotask(() => scheduleForm(form, { removeBlankRows: false }));
  }, true);

  const observer = new scope.MutationObserver((mutations) => {
    const forms = new Set();
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (!node.matches?.('[data-pa-form], [data-pa-items-group], [data-pa-item-row], [data-pa-items-host]')
          && !node.querySelector?.('[data-pa-items-group], [data-pa-item-row]')) return;
        formsInNode(node).forEach((form) => forms.add(form));
      });
    });
    forms.forEach((form) => scheduleForm(form, { removeBlankRows: false }));
  });
  observer.observe(documentRef.getElementById('app') || documentRef.body || documentRef.documentElement, {
    childList: true,
    subtree: true
  });
}

export function installNextYearEditorStability(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  wrapPayloadMethod(targetApi, 'proposalsAgreements');
  wrapPayloadMethod(targetApi, 'proposalsAgreementsEditorDeps');
  wrapPricingMethod(targetApi, 'readProposalActivityPricing');
  installDomRuntime(scope);
  Object.defineProperty(targetApi, PATCH_KEY, { value: true, configurable: false, enumerable: false, writable: false });
  return true;
}

installNextYearEditorStability(api, globalThis);
