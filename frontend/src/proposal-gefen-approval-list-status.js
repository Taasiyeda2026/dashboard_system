import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalGefenApprovalListStatus');
const UI_GUARD_KEY = Symbol.for('taasiyeda.proposalGefenApprovalUiGuard');
const STYLE_ID = 'ds-pa-client-file-gefen-layout-v1';
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

function ensureClientFileLayoutStyles(scope = globalThis) {
  const documentRef = scope?.document;
  if (!documentRef?.head || documentRef.getElementById(STYLE_ID)) return;
  const style = documentRef.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #app .ds-pa-table th.ds-pa-actions-col,
    #app .ds-pa-table td.ds-pa-actions-cell {
      width: 220px !important;
      min-width: 220px !important;
    }
    #app .ds-pa-table .ds-pa-actions-inner {
      justify-content: center;
    }
    #app .ds-pa-info-value.ds-pa-info-value--with-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    #app .ds-pa-gefen-inline-view {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      min-width: 28px;
      height: 28px;
      padding: 0;
      margin: 0;
      border-radius: 8px;
    }
  `;
  documentRef.head.appendChild(style);
}

function removeGefenListColumns(root) {
  root.querySelectorAll?.('table[data-pa-table]').forEach((table) => {
    const headerRow = table.tHead?.rows?.[0];
    if (headerRow) {
      const cells = Array.from(headerRow.cells);
      const targetIndexes = cells
        .map((cell, index) => ({ index, label: text(cell.textContent) }))
        .filter(({ label }) => label === 'אישור גפ״ן' || label === 'חתום / הוזמן')
        .map(({ index }) => index)
        .sort((a, b) => b - a);
      targetIndexes.forEach((index) => headerRow.cells[index]?.remove());
    }

    const colgroup = table.querySelector('colgroup');
    if (colgroup) {
      const cols = Array.from(colgroup.children);
      if (cols.length >= 11) {
        cols[9]?.remove();
        cols[8]?.remove();
      }
      const remaining = Array.from(colgroup.children);
      const actionsCol = remaining.at(-1);
      if (actionsCol) actionsCol.style.width = '220px';
    }

    Array.from(table.tBodies || []).forEach((tbody) => {
      Array.from(tbody.rows || []).forEach((row) => {
        if (row.cells.length >= 11) {
          row.cells[9]?.remove();
          row.cells[8]?.remove();
          return;
        }
        row.querySelector('.ds-pa-gfen-signed-col')?.remove();
        row.querySelector('.ds-pa-gefen-status-text')?.closest('td')?.remove();
      });
    });
  });
}

function dedupeProposalViewActions(root) {
  root.querySelectorAll?.('.ds-pa-drawer-icon-btns').forEach((actions) => {
    const finalPdf = actions.querySelector('[data-pa-view-final-pdf]');
    const preview = actions.querySelector('[data-pa-preview]');
    if (finalPdf && preview) preview.remove();
  });
}

function moveGefenApprovalViewIntoInfo(root) {
  root.querySelectorAll?.('[data-pa-proposal-detail], .ds-pa-drawer-panel').forEach((container) => {
    const viewButton = container.querySelector('.ds-pa-drawer-icon-btns [data-pa-view-gefen-approval]');
    if (!viewButton) return;

    const infoCell = Array.from(container.querySelectorAll('.ds-pa-info-cell')).find((cell) =>
      text(cell.querySelector('.ds-pa-info-label')?.textContent) === 'אישור גפ״ן'
    );
    const value = infoCell?.querySelector('.ds-pa-info-value');
    if (!value) return;

    value.classList.add('ds-pa-info-value--with-action');
    viewButton.classList.add('ds-pa-gefen-inline-view');
    viewButton.title = viewButton.title || 'צפייה באישור גפ״ן';
    viewButton.setAttribute('aria-label', viewButton.getAttribute('aria-label') || 'צפייה באישור גפ״ן');
    value.appendChild(viewButton);
  });
}

export function applyClientFileProposalDisplayPolish(root = globalThis.document, scope = globalThis) {
  if (!root?.querySelectorAll) return root;
  ensureClientFileLayoutStyles(scope);
  removeGefenListColumns(root);
  dedupeProposalViewActions(root);
  moveGefenApprovalViewIntoInfo(root);
  return root;
}

export function applyGefenEligibilityUi(root = globalThis.document, scope = globalThis) {
  if (!root?.querySelectorAll) return root;

  applyClientFileProposalDisplayPolish(root, scope);

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
