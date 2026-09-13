import { api } from './api.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalGefenApprovalListStatus');
const UI_GUARD_KEY = Symbol.for('taasiyeda.proposalGefenApprovalUiGuard');
const STYLE_ID = 'ds-pa-client-file-gefen-layout-v3';
const CLIENT_FILE_TABLE_WIDTHS = Object.freeze([65, 65, 145, 160, 120, 110, 110, 120, 150]);
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
      width: 150px !important;
      min-width: 150px !important;
      text-align: center !important;
    }
    #app .ds-pa-table th.ds-pa-actions-col {
      vertical-align: middle !important;
    }
    #app .ds-pa-table .ds-pa-actions-inner {
      width: 100%;
      justify-content: center !important;
      align-items: center !important;
      margin-inline: auto;
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
      remaining.forEach((col, index) => {
        const width = CLIENT_FILE_TABLE_WIDTHS[index];
        if (width) col.style.width = `${width}px`;
      });
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

function proposalDisplayDateTimestamp(value) {
  const raw = text(value);
  if (!raw) return Number.NEGATIVE_INFINITY;
  const dmy = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return Date.UTC(Number(year), Number(month) - 1, Number(day));
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortProposalTablesByProposalDate(root) {
  root.querySelectorAll?.('table[data-pa-table]').forEach((table) => {
    const headerRow = table.tHead?.rows?.[0];
    const dateIndex = headerRow
      ? Array.from(headerRow.cells).findIndex((cell) => text(cell.textContent) === 'תאריך')
      : -1;
    if (dateIndex < 0) return;

    Array.from(table.tBodies || []).forEach((tbody) => {
      const rows = Array.from(tbody.rows || []).filter((row) => row.hasAttribute('data-pa-row-id'));
      if (rows.length < 2) return;
      const sorted = rows
        .map((row, index) => ({ row, index, time: proposalDisplayDateTimestamp(row.cells[dateIndex]?.textContent) }))
        .sort((a, b) => (b.time - a.time) || (a.index - b.index))
        .map(({ row }) => row);
      if (sorted.every((row, index) => row === rows[index])) return;
      sorted.forEach((row) => tbody.appendChild(row));
    });
  });
}

function proposalActionKey(button) {
  if (!button?.getAttribute) return '';
  const attrs = [
    'data-pa-preview',
    'data-pa-view-final-pdf',
    'data-pa-view-gefen-approval',
    'data-pa-generate-gefen-approval',
    'data-pa-edit-row',
    'data-pa-print',
    'data-pa-delete-row',
    'data-pa-clone-row'
  ];
  for (const attr of attrs) {
    if (button.hasAttribute(attr)) return `${attr}:${text(button.getAttribute(attr))}`;
  }
  if (button.hasAttribute('data-pa-status-action')) {
    return `data-pa-status-action:${text(button.getAttribute('data-pa-status-action'))}:${text(button.getAttribute('data-pa-action-id'))}`;
  }
  return '';
}

export function compactProposalRowActions(root) {
  root.querySelectorAll?.('.ds-pa-actions-cell').forEach((cell) => {
    const more = cell.querySelector('.ds-pa-row-more');
    const menu = more?.querySelector('.ds-pa-row-more-menu');
    if (!more || !menu) return;

    const directKeys = new Set(
      Array.from(cell.querySelectorAll('button'))
        .filter((button) => !button.closest('.ds-pa-row-more'))
        .map(proposalActionKey)
        .filter(Boolean)
    );

    menu.querySelectorAll('button').forEach((button) => {
      const key = proposalActionKey(button);
      if (key && directKeys.has(key)) button.remove();
    });

    if (!menu.querySelector('button')) more.remove();
  });
}

export function prepareProposalDetailDrawer(root) {
  root.querySelectorAll?.('[data-pa-proposal-detail]').forEach((detail) => {
    detail.setAttribute('role', 'dialog');
    detail.setAttribute('aria-modal', 'true');
    detail.setAttribute('aria-label', 'פרטי הצעה');
    detail.querySelector('.ds-pa-drawer')?.removeAttribute('hidden');
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
  sortProposalTablesByProposalDate(root);
  compactProposalRowActions(root);
  prepareProposalDetailDrawer(root);
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

  documentRef.addEventListener('click', (event) => {
    const proposalDetail = event.target?.closest?.('[data-pa-proposal-detail]');
    if (proposalDetail && event.target === proposalDetail) {
      proposalDetail.querySelector('[data-pa-close-drawer]')?.click();
      return;
    }

    // Block stale controls as well as removing them visually. This closes the small
    // interval between a list render and the DOM cleanup below.
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
