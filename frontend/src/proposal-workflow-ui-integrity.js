import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalWorkflowUiIntegrity');
const APPROVAL_WRAP_KEY = Symbol.for('taasiyeda.proposalApprovalAutomaticPdf');
const PRICING_WRAP_KEY = Symbol.for('taasiyeda.proposalGenericPricingCache');
const NEXT_YEAR_INTERNAL_GROUPS = new Set(['next_year_courses', 'next_year_workshops']);
const pendingForms = new WeakSet();
const pendingPdfIds = new Set();
let directApprovalPendingUntil = 0;
let cachedPricingRows = [];

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return text(value).replace(/[״"׳'`]/g, '').toLowerCase();
}

function numberValue(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function currencyText(value) {
  return `₪ ${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function pricingOptionKey(row = {}) {
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

function cachePricingRows(rows) {
  if (Array.isArray(rows)) cachedPricingRows = rows;
  return rows;
}

function cachePricingPayload(payload = {}) {
  const rows = payload?.proposalActivityPricing || payload?.proposal_activity_pricing;
  if (Array.isArray(rows)) cachePricingRows(rows);
  return payload;
}

function wrapPricingSources(targetApi) {
  if (!targetApi || targetApi[PRICING_WRAP_KEY]) return;
  ['proposalsAgreements', 'proposalsAgreementsEditorDeps'].forEach((methodName) => {
    const original = targetApi[methodName];
    if (typeof original !== 'function') return;
    targetApi[methodName] = async function proposalGenericPricingPayload(...args) {
      return cachePricingPayload(await original.apply(this, args));
    };
  });
  const readPricing = targetApi.readProposalActivityPricing;
  if (typeof readPricing === 'function') {
    targetApi.readProposalActivityPricing = async function proposalGenericPricingRows(...args) {
      return cachePricingRows(await readPricing.apply(this, args));
    };
  }
  Object.defineProperty(targetApi, PRICING_WRAP_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

function rowGroup(row) {
  return text(
    row?.closest?.('[data-pa-items-group]')?.dataset?.paItemsGroup
    || row?.dataset?.paRowGroup
    || row?.querySelector?.('[name="proposal_group"]')?.value
  );
}

function pricingIndex(rows = []) {
  const byOption = new Map();
  const byActivityNo = new Map();
  const byPricingKey = new Map();
  const byName = new Map();
  rows.forEach((entry) => {
    const option = pricingOptionKey(entry);
    if (option && !byOption.has(option)) byOption.set(option, entry);
    const activityNo = text(entry.activity_no);
    if (activityNo && !byActivityNo.has(activityNo)) byActivityNo.set(activityNo, entry);
    const pricingKey = text(entry.pricing_key);
    if (pricingKey && !byPricingKey.has(pricingKey)) byPricingKey.set(pricingKey, entry);
    const name = normalized(entry.activity_name);
    if (name && !byName.has(name)) byName.set(name, entry);
  });
  return { byOption, byActivityNo, byPricingKey, byName };
}

function selectedPricingFallback(select) {
  const selected = text(select?.value);
  const parts = selected.split('||');
  const labelName = text(select?.selectedOptions?.[0]?.textContent?.split('—')?.[0]);
  const optionPrice = numberOrNull(parts[5]);
  const labelPrice = numberOrNull(String(select?.selectedOptions?.[0]?.textContent || '').replace(/[^0-9.,-]/g, ''));
  const unitPrice = optionPrice != null && optionPrice > 0 ? optionPrice : labelPrice;
  if (!labelName || unitPrice == null || unitPrice <= 0) return null;
  return {
    activity_no: text(parts[0]),
    activity_name: text(parts[1]) || labelName,
    item_type: text(parts[2]),
    proposal_group: text(parts[3]),
    unit_duration: text(parts[4]),
    unit_price: unitPrice,
    sort_order: numberOrNull(parts[6]),
    pricing_key: ''
  };
}

function resolveGenericPricingRow(row, pricingRows = cachedPricingRows) {
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  const selected = text(select?.value);
  if (!selected || selected.startsWith('__')) return null;
  const index = pricingIndex(Array.isArray(pricingRows) ? pricingRows : []);
  if (index.byOption.has(selected)) return index.byOption.get(selected);
  if (index.byActivityNo.has(selected)) return index.byActivityNo.get(selected);
  if (index.byPricingKey.has(selected)) return index.byPricingKey.get(selected);

  const parts = selected.split('||');
  const activityNo = text(parts[0]);
  const name = normalized(parts[1]);
  if (activityNo && index.byActivityNo.has(activityNo)) return index.byActivityNo.get(activityNo);
  if (name && index.byName.has(name)) return index.byName.get(name);

  const labelName = normalized(select?.selectedOptions?.[0]?.textContent?.split('—')?.[0]);
  if (labelName && index.byName.has(labelName)) return index.byName.get(labelName);
  return selectedPricingFallback(select);
}

function setRowValue(row, name, value) {
  const input = row?.querySelector?.(`[name="${name}"]`);
  if (!input) return false;
  const next = value == null ? '' : String(value);
  if (input.value === next) return false;
  input.value = next;
  return true;
}

function rowTotal(row) {
  const quantity = numberValue(row?.querySelector?.('[data-pa-item-qty]')?.value);
  const price = numberValue(row?.querySelector?.('[data-pa-item-price]')?.value);
  const total = quantity > 0 && price > 0 ? quantity * price : 0;
  const hidden = row?.querySelector?.('[data-pa-item-total]');
  const output = row?.querySelector?.('[data-pa-item-total-display]');
  if (hidden) hidden.value = total > 0 ? total.toFixed(2) : '';
  if (output && output.textContent !== currencyText(total)) output.textContent = currencyText(total);
  return total;
}

export function recalculateProposalEditorTotals(form) {
  if (!form) return 0;
  const rows = Array.from(form.querySelectorAll('[data-pa-item-row]'));
  const totals = new Map(rows.map((row) => [row, rowTotal(row)]));
  const subtotal = rows.reduce((sum, row) => sum + (totals.get(row) || 0), 0);

  form.querySelectorAll('[data-pa-items-group]').forEach((section) => {
    const groupTotal = Array.from(section.querySelectorAll('[data-pa-item-row]'))
      .reduce((sum, row) => sum + (totals.get(row) || 0), 0);
    const groupKey = text(section.dataset.paItemsGroup);
    const output = section.querySelector(`[data-pa-group-total="${groupKey}"]`);
    if (output && output.textContent !== currencyText(groupTotal)) output.textContent = currencyText(groupTotal);
  });

  const discountType = text(form.querySelector('[data-pa-discount-type]')?.value) || 'amount';
  const discountValue = numberValue(form.querySelector('[data-pa-discount-value]')?.value);
  const discount = discountType === 'percent'
    ? subtotal * Math.min(Math.max(discountValue, 0), 100) / 100
    : Math.min(Math.max(discountValue, 0), subtotal);
  const total = Math.max(subtotal - discount, 0);

  [
    ['[data-pa-grand-total]', currencyText(total)],
    ['[data-pa-summary-total]', currencyText(total)],
    ['[data-pa-summary-subtotal]', currencyText(subtotal)],
    ['[data-pa-summary-discount]', discount > 0 ? `-₪ ${discount.toLocaleString('he-IL')}` : '₪ 0']
  ].forEach(([selector, value]) => {
    const element = form.querySelector(selector);
    if (element && element.textContent !== value) element.textContent = value;
  });
  return total;
}

export function hydrateGenericPricingSelection(row, pricingRows = cachedPricingRows, { notify = true } = {}) {
  const group = rowGroup(row);
  const select = row?.querySelector?.('[data-pa-pricing-select]');
  if (!row || !select || NEXT_YEAR_INTERNAL_GROUPS.has(group)) return { changed: false, picked: null, total: 0 };
  if (select.selectedOptions?.[0]?.dataset?.bundleParent === '1') {
    return { changed: false, picked: null, total: recalculateProposalEditorTotals(row.closest('[data-pa-form]')) };
  }
  const picked = resolveGenericPricingRow(row, pricingRows);
  if (!picked || text(picked.proposal_display_mode) === 'bundle_parent' || picked.is_bundle_parent === true) {
    return { changed: false, picked: null, total: recalculateProposalEditorTotals(row.closest('[data-pa-form]')) };
  }

  const selected = text(select.value);
  let changed = false;
  changed = setRowValue(row, 'pricing_option_key', selected) || changed;
  changed = setRowValue(row, 'activity_no', picked.activity_no || '') || changed;
  changed = setRowValue(row, 'item_name', picked.activity_name || '') || changed;
  changed = setRowValue(row, 'item_type', picked.item_type || '') || changed;
  changed = setRowValue(row, 'gefen_number', picked.gefen_number || '') || changed;
  changed = setRowValue(row, 'gefen_number_display', picked.gefen_number || '') || changed;
  changed = setRowValue(row, 'meetings_count', picked.meetings_count ?? '') || changed;
  changed = setRowValue(row, 'hours_count', picked.hours_count ?? '') || changed;
  changed = setRowValue(row, 'unit_duration', picked.unit_duration || '') || changed;
  changed = setRowValue(row, 'unit_price', numberOrNull(picked.unit_price) ?? '') || changed;
  changed = setRowValue(row, 'hourly_price', picked.hourly_price ?? '') || changed;
  changed = setRowValue(row, 'description', picked.description_for_proposal || '') || changed;
  changed = setRowValue(row, 'proposal_group', picked.proposal_group || group) || changed;
  changed = setRowValue(row, 'item_display_mode', picked.proposal_display_mode || 'single') || changed;
  changed = setRowValue(row, 'item_source_pricing_key', picked.pricing_key || '') || changed;
  changed = setRowValue(row, 'bundle_pricing_key', picked.pricing_key || '') || changed;
  changed = setRowValue(row, 'item_selected_bundle_items', '[]') || changed;

  const form = row.closest('[data-pa-form]');
  const total = recalculateProposalEditorTotals(form);
  const priceInput = row.querySelector('[data-pa-item-price]');
  if (changed && notify && form && priceInput && form.dataset.paGenericPricingHydration !== 'yes') {
    form.dataset.paGenericPricingHydration = 'yes';
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
    delete form.dataset.paGenericPricingHydration;
  }
  return { changed, picked, total };
}

function scheduleTotals(form, scope = globalThis) {
  if (!form || pendingForms.has(form)) return;
  pendingForms.add(form);
  const run = () => {
    pendingForms.delete(form);
    if (form.isConnected) recalculateProposalEditorTotals(form);
  };
  if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
  else scope.setTimeout?.(run, 0);
}

function proposalTypeFromRow(row) {
  const explicit = text(row?.dataset?.paProposalType || row?.dataset?.proposalType);
  const source = explicit || Array.from(row?.cells || []).map((cell) => text(cell.textContent)).join(' ');
  if (/קיץ|פעילויות קיץ|summer/i.test(source)) return 'summer';
  return 'other';
}

function applySummerRows(screen, summerOnly) {
  screen.dataset.paProposalListMode = summerOnly ? 'summer' : 'regular';
  screen.querySelectorAll('[data-pa-table] tbody tr[data-pa-row-id]').forEach((row) => {
    const isSummer = proposalTypeFromRow(row) === 'summer';
    row.hidden = summerOnly ? !isSummer : isSummer;
  });
  screen.querySelector('[data-pa-summer-tab]')?.classList.toggle('is-active', summerOnly);
}

export function finalizeSummerTab(screen) {
  const oldButton = screen?.querySelector?.('[data-pa-summer-tab]:not([data-pa-summer-finalized])');
  if (!oldButton) return null;
  const button = oldButton.cloneNode(true);
  button.dataset.paSummerFinalized = 'true';
  oldButton.replaceWith(button);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    screen.querySelector('[data-pa-tab="records"]')?.click();
    const filter = screen.querySelector('[data-pa-filter="activity_type_group"]');
    if (filter) filter.value = 'summer';
    applySummerRows(screen, true);
  });
  return button;
}

function removeUnqualifiedInjectedGefenButtons(root) {
  root.querySelectorAll?.('[data-pa-generate-gefen-approval][title="הפקת אישור גפ״ן מנתוני ההצעה"]')
    .forEach((button) => button.remove());
}

function refreshProposalUi(root = document) {
  root.querySelectorAll?.('.ds-pa-screen').forEach((screen) => {
    finalizeSummerTab(screen);
    applySummerRows(screen, text(screen.dataset.paProposalListMode) === 'summer');
  });
  removeUnqualifiedInjectedGefenButtons(root);
  root.querySelectorAll?.('[data-pa-form]').forEach((form) => scheduleTotals(form));
}

function scheduleAutomaticPdf(proposalId, scope = globalThis) {
  const id = text(proposalId);
  if (!id || !scope.document || pendingPdfIds.has(id)) return;
  pendingPdfIds.add(id);
  const startedAt = Date.now();
  const timer = scope.setInterval(() => {
    const escaped = scope.CSS?.escape ? scope.CSS.escape(id) : id.replace(/["\\]/g, '\\$&');
    const button = scope.document.querySelector(`[data-pa-print="${escaped}"]`);
    if (button && !button.disabled) {
      scope.clearInterval(timer);
      button.click();
      scope.setTimeout(() => pendingPdfIds.delete(id), 5000);
      return;
    }
    if (Date.now() - startedAt > 30000) {
      scope.clearInterval(timer);
      pendingPdfIds.delete(id);
    }
  }, 350);
}

function wrapApprovalStatus(targetApi, scope) {
  const original = targetApi?.updateProposalAgreementStatus;
  if (typeof original !== 'function' || original[APPROVAL_WRAP_KEY]) return;
  const wrapped = async function updateStatusAndGeneratePdf(...args) {
    const result = await original.apply(this, args);
    const requestedStatus = text(args[1]);
    const row = result?.row;
    const directApproval = requestedStatus === 'approved' && Date.now() <= directApprovalPendingUntil;
    if (directApproval && text(row?.id || args[0])) {
      directApprovalPendingUntil = 0;
      scheduleAutomaticPdf(text(row?.id || args[0]), scope);
    }
    return result;
  };
  Object.defineProperty(wrapped, APPROVAL_WRAP_KEY, { value: true });
  targetApi.updateProposalAgreementStatus = wrapped;
}

function installDomRuntime(scope) {
  const documentRef = scope?.document;
  if (!documentRef?.documentElement || typeof scope.MutationObserver !== 'function') return;

  const isNextYearScoped = (form, row) => {
    if (row) return NEXT_YEAR_INTERNAL_GROUPS.has(rowGroup(row));
    return Boolean(form?.querySelector?.('[data-pa-items-group]'));
  };

  const editorEvent = (event) => {
    if (!event.target?.matches?.('[data-pa-item-qty], [data-pa-item-price], [data-pa-pricing-select], [data-pa-discount-type], [data-pa-discount-value]')) return;
    const form = event.target.closest('[data-pa-form]');
    const row = event.target.closest('[data-pa-item-row]');
    // next_year_courses/next_year_workshops rows and forms are owned exclusively by
    // proposal-next-year-selection-hydration.js (hydration + totals). Skipping the
    // duplicate recalculation here keeps a single mechanism responsible for those
    // totals; every other proposal type keeps its existing behavior unchanged.
    const nextYearScoped = isNextYearScoped(form, row);
    if (event.type === 'change' && event.target.matches('[data-pa-pricing-select]')) {
      queueMicrotask(() => {
        if (row?.isConnected) hydrateGenericPricingSelection(row, cachedPricingRows, { notify: true });
        if (!nextYearScoped) scheduleTotals(form, scope);
      });
      return;
    }
    if (!nextYearScoped) scheduleTotals(form, scope);
  };
  documentRef.addEventListener('input', editorEvent, true);
  documentRef.addEventListener('change', editorEvent, true);
  documentRef.addEventListener('click', (event) => {
    const directApprove = event.target?.closest?.('[data-pa-save-pending][data-pa-target-status="approved"]');
    if (directApprove) directApprovalPendingUntil = Date.now() + 120000;

    const tab = event.target?.closest?.('[data-pa-tab]');
    const screen = tab?.closest?.('.ds-pa-screen');
    if (!screen || tab?.dataset?.paTab === 'records' && event.target.closest?.('[data-pa-summer-tab]')) return;
    if (tab) {
      const filter = screen.querySelector('[data-pa-filter="activity_type_group"]');
      if (filter && text(screen.dataset.paProposalListMode) === 'summer') filter.value = '';
      applySummerRows(screen, false);
    }
  }, true);

  let queued = false;
  const observer = new scope.MutationObserver((mutations) => {
    const relevant = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
      node instanceof scope.Element && (
        node.matches?.('.ds-pa-screen, [data-pa-form], [data-pa-item-row], [data-pa-table], tr[data-pa-row-id]')
        || node.querySelector?.('.ds-pa-screen, [data-pa-form], [data-pa-item-row], [data-pa-table], tr[data-pa-row-id]')
      )));
    if (!relevant || queued) return;
    queued = true;
    const run = () => {
      queued = false;
      refreshProposalUi(documentRef);
      observer.takeRecords();
    };
    if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
    else scope.setTimeout(run, 0);
  });
  observer.observe(documentRef.getElementById('app') || documentRef.documentElement, { childList: true, subtree: true });
  refreshProposalUi(documentRef);
}

export function installProposalWorkflowUiIntegrity(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;
  wrapPricingSources(targetApi);
  wrapApprovalStatus(targetApi, scope);
  installDomRuntime(scope);
  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  return true;
}

installProposalWorkflowUiIntegrity(api, globalThis);
