import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalWorkflowUiIntegrity');
const APPROVAL_WRAP_KEY = Symbol.for('taasiyeda.proposalApprovalAutomaticPdf');
const pendingForms = new WeakSet();
const pendingPdfIds = new Set();
let directApprovalPendingUntil = 0;

function text(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numberValue(value) {
  const number = Number(String(value == null ? '' : value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : 0;
}

function currencyText(value) {
  return `₪ ${Number(value || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
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

  const editorEvent = (event) => {
    if (!event.target?.matches?.('[data-pa-item-qty], [data-pa-item-price], [data-pa-pricing-select], [data-pa-discount-type], [data-pa-discount-value]')) return;
    scheduleTotals(event.target.closest('[data-pa-form]'), scope);
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
