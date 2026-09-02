import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalGefenApprovalListStatus');
const UI_GUARD_KEY = Symbol.for('taasiyeda.proposalGefenApprovalUiGuard');
const ineligibleProposalIds = new Set();
let uiRefreshPending = false;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function selectorValue(value, scope = globalThis) {
  const raw = text(value);
  if (scope?.CSS?.escape) return scope.CSS.escape(raw);
  return raw.replace(/["\\]/g, '\\$&');
}

function rememberEligibility(payload = {}, scope = globalThis) {
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  rows.forEach((row) => {
    const id = text(row?.id);
    if (!id || typeof row?.gefen_approval_applicable !== 'boolean') return;
    if (row.gefen_approval_applicable === false) {
      ineligibleProposalIds.add(id);
      // Defensive: an old/default true value must never append a GEFEN page when
      // the loader already established that the proposal has no eligible GEFEN course.
      row.combine_gefen_approval = false;
    } else {
      ineligibleProposalIds.delete(id);
    }
  });
  scheduleEligibilityUiRefresh(scope);
  return payload;
}

function unavailableMarkup() {
  return '<span class="ds-pa-unavailable" aria-label="לא זמין">—</span>';
}

export function applyGefenEligibilityUi(root = globalThis.document, scope = globalThis) {
  if (!root?.querySelectorAll || !ineligibleProposalIds.size) return root;

  ineligibleProposalIds.forEach((id) => {
    const escaped = selectorValue(id, scope);
    root.querySelectorAll(
      `[data-pa-generate-gefen-approval="${escaped}"], [data-pa-view-gefen-approval="${escaped}"]`
    ).forEach((element) => element.remove());

    root.querySelectorAll(`tr[data-pa-row-id="${escaped}"]`).forEach((row) => {
      const status = row.querySelector('.ds-pa-gefen-status-text');
      if (status?.parentElement) status.parentElement.textContent = '—';

      const signedCell = row.querySelector('.ds-pa-gfen-signed-col');
      if (signedCell?.querySelector('[data-pa-gfen-signed]')) signedCell.innerHTML = unavailableMarkup();
    });
  });

  return root;
}

function scheduleEligibilityUiRefresh(scope = globalThis) {
  if (uiRefreshPending || !scope?.document) return;
  uiRefreshPending = true;
  const run = () => {
    uiRefreshPending = false;
    applyGefenEligibilityUi(scope.document, scope);
  };
  if (typeof scope.requestAnimationFrame === 'function') scope.requestAnimationFrame(run);
  else scope.setTimeout?.(run, 0);
}

function installEligibilityUiGuard(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef || documentRef[UI_GUARD_KEY]) return false;
  Object.defineProperty(documentRef, UI_GUARD_KEY, { value: true, configurable: false });

  // Block stale controls as well as removing them visually. This closes the small
  // interval between a list render and the DOM cleanup below.
  documentRef.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-pa-generate-gefen-approval], [data-pa-view-gefen-approval]');
    if (!button) return;
    const id = text(button.dataset.paGenerateGefenApproval || button.dataset.paViewGefenApproval);
    if (!ineligibleProposalIds.has(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.remove();
  }, true);

  const root = documentRef.getElementById('app') || documentRef.documentElement;
  if (root && typeof scope.MutationObserver === 'function') {
    new scope.MutationObserver(() => scheduleEligibilityUiRefresh(scope))
      .observe(root, { childList: true, subtree: true });
  }
  scheduleEligibilityUiRefresh(scope);
  return true;
}

export function gefenApprovalListOptions(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};
  return {
    ...source,
    includeLinkedDocuments: true
  };
}

export function installGefenApprovalListStatus(targetApi = api, scope = globalThis) {
  if (!targetApi || targetApi[PATCH_KEY]) return false;

  const originalLoader = targetApi.proposalsAgreements;
  if (typeof originalLoader !== 'function') return false;

  targetApi.proposalsAgreements = async function proposalsWithGefenApprovalStatus(options = {}) {
    const payload = await originalLoader.call(this, gefenApprovalListOptions(options));
    return rememberEligibility(payload, scope);
  };

  Object.defineProperty(targetApi, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
  installEligibilityUiGuard(scope);
  return true;
}

installGefenApprovalListStatus(api, globalThis);
