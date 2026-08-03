import { api } from './api.js';
import { augmentNextYearPricingRows } from './proposal-next-year-workshops.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalNextYearEditorStability.v2');
const COURSE_GROUP = 'next_year_courses';
const WORKSHOP_GROUP = 'next_year_workshops';
const NEXT_YEAR_GROUPS = new Set([COURSE_GROUP, WORKSHOP_GROUP]);
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

function optionLabel(row = {}) {
  const parts = [text(row.activity_name), text(row.item_type)];
  const price = numberOrNull(row.unit_price);
  if (price != null && price > 0) parts.push(`₪ ${price.toLocaleString('he-IL')}`);
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

function nextYearForm(form) {
  const type = text(form?.querySelector?.('[name="activity_type_group"]')?.value);
  return NEXT_YEAR_TYPE_ALIASES.has(type)
    || Boolean(form?.querySelector?.(`[data-pa-items-group="${COURSE_GROUP}"]`));
}

function markPendingUserRow(form) {
  const group = text(form?.dataset?.paNextYearPendingAddGroup);
  if (!NEXT_YEAR_GROUPS.has(group)) return;
  const section = form.querySelector(`[data-pa-items-group="${group}"]`);
  const rows = Array.from(section?.querySelectorAll?.('[data-pa-item-row]') || []);
  const row = rows.filter((item) => item.dataset.paNextYearUserAdded !== 'yes').at(-1);
  if (row) row.dataset.paNextYearUserAdded = 'yes';
  delete form.dataset.paNextYearPendingAddGroup;
}

export function removeBlankNextYearRows(form) {
  if (!form || !nextYearForm(form)) return 0;
  let removed = 0;
  NEXT_YEAR_GROUPS.forEach((groupKey) => {
    form.querySelectorAll(`[data-pa-items-group="${groupKey}"] [data-pa-item-row]`).forEach((row) => {
      if (!isBlankNextYearEditorRow(row)) return;
      row.remove();
      removed += 1;
    });
  });
  return removed;
}

export function stabilizeNextYearForm(form, pricingRows = cachedPricingRows, options = {}) {
  if (!form || !nextYearForm(form)) return { changed: false, removed: 0, total: 0 };
  markPendingUserRow(form);
  let changed = false;
  let removed = 0;

  NEXT_YEAR_GROUPS.forEach((groupKey) => {
    const section = form.querySelector(`[data-pa-items-group="${groupKey}"]`);
    if (!section) return;
    const groupRows = pricingRowsForNextYearGroup(pricingRows, groupKey);
    section.querySelectorAll('[data-pa-item-row]').forEach((row) => {
      const userAdded = row.dataset.paNextYearUserAdded === 'yes';
      if (options.removeBlankRows !== false && !userAdded && isBlankNextYearEditorRow(row)) {
        row.remove();
        removed += 1;
        changed = true;
        return;
      }
      changed = ensurePricingOptions(row.querySelector('[data-pa-pricing-select]'), groupRows) || changed;
    });
  });

  return { changed, removed, total: 0 };
}

function scheduleForm(form, options = {}) {
  if (!form || scheduledForms.has(form)) return;
  scheduledForms.add(form);
  const run = () => {
    scheduledForms.delete(form);
    if (form.isConnected) stabilizeNextYearForm(form, cachedPricingRows, options);
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

    const addButton = event.target?.closest?.('[data-pa-add-item][data-pa-add-item-group]');
    if (!addButton) return;
    const addForm = addButton.closest('[data-pa-form]');
    const group = text(addButton.dataset.paAddItemGroup);
    if (!addForm || !NEXT_YEAR_GROUPS.has(group)) return;
    addForm.dataset.paNextYearPendingAddGroup = group;
    queueMicrotask(() => scheduleForm(addForm, { removeBlankRows: true }));
  }, true);

  documentRef.addEventListener('change', (event) => {
    const form = event.target?.closest?.('[data-pa-form]');
    if (!form || !event.target?.matches?.('[name="activity_type_group"]')) return;
    removeBlankNextYearRows(form);
    queueMicrotask(() => scheduleForm(form, { removeBlankRows: true }));
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
    forms.forEach((form) => scheduleForm(form, { removeBlankRows: true }));
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
