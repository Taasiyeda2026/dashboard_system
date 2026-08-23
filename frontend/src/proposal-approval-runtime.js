import {
  proposalsAgreementsScreen,
  proposalPreviewBodyHtml,
  filterTemplateSectionsForGroup,
  setProposalGroupLookups
} from './screens/proposals-agreements.js';
import { showToast } from './screens/shared/toast.js';
import { escapeHtml } from './screens/shared/html.js';
import { hasPermission } from './permission-policy.js';

const RUNTIME_FLAG = '__dsProposalApprovalRuntimeInstalled';
const TEST_FLAG = '__PROPOSAL_APPROVAL_RUNTIME_TEST__';
const APPROVAL_SELECTOR = '[data-pa-status-action="approved"][data-pa-action-id]';
const OVERLAY_ID = 'pa-preview-overlay';
const SIGNATURE_IMAGE = 'proposals/signature-idan-nahum.png';
const OPEN_TIMEOUT_MS = 15000;
const SAVE_TIMEOUT_MS = 20000;

function clean(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function canApprove(state) {
  return hasPermission(state?.user, 'approve_proposals_agreements');
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

export function createProposalApprovalSignatureMeta(now = new Date()) {
  return {
    signer_name: 'עידן נחום, סמנכ״ל כספים',
    signed_at: now.toISOString(),
    signature: { image: SIGNATURE_IMAGE }
  };
}

export function parseSignatureMeta(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

export function isCompleteSavedApproval(row) {
  const status = clean(row?.status).toLowerCase();
  const signatureMeta = parseSignatureMeta(row?.signature_meta);
  const signatureImage = clean(
    signatureMeta?.signature?.image
      || signatureMeta?.image
      || signatureMeta?.signature_image
  );
  return ['approved', 'מאושר', 'מאושר וחתום'].includes(status)
    && Boolean(signatureImage)
    && Boolean(clean(row?.approved_at || row?.approvedAt));
}

function setImportantStyle(element, property, value) {
  element?.style?.setProperty?.(property, value, 'important');
}

export function forceProposalApprovalOverlayVisible(overlay) {
  if (!overlay) return false;
  setImportantStyle(overlay, 'position', 'fixed');
  setImportantStyle(overlay, 'inset', '0');
  setImportantStyle(overlay, 'width', '100vw');
  setImportantStyle(overlay, 'height', '100vh');
  setImportantStyle(overlay, 'display', 'block');
  setImportantStyle(overlay, 'visibility', 'visible');
  setImportantStyle(overlay, 'opacity', '1');
  setImportantStyle(overlay, 'pointer-events', 'auto');
  setImportantStyle(overlay, 'overflow', 'auto');
  setImportantStyle(overlay, 'z-index', '2147483000');
  setImportantStyle(overlay, 'background', '#dde2e8');
  overlay.hidden = false;
  overlay.removeAttribute('aria-hidden');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('dir', 'rtl');
  overlay.tabIndex = -1;

  const toolbar = overlay.querySelector('.proposal-preview-toolbar');
  if (toolbar) {
    setImportantStyle(toolbar, 'position', 'sticky');
    setImportantStyle(toolbar, 'top', '0');
    setImportantStyle(toolbar, 'z-index', '2');
    setImportantStyle(toolbar, 'display', 'flex');
    setImportantStyle(toolbar, 'visibility', 'visible');
  }
  return true;
}

function overlayIsUsable(overlay) {
  if (!overlay?.isConnected) return false;
  const confirm = overlay.querySelector('#pa-signature-confirm');
  if (!confirm) return false;
  const style = typeof getComputedStyle === 'function' ? getComputedStyle(overlay) : null;
  if (style && (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)) return false;
  return true;
}

function replaceLocalRow(data, savedRow) {
  if (!Array.isArray(data?.rows) || !savedRow?.id) return;
  const index = data.rows.findIndex((row) => clean(row?.id) === clean(savedRow.id));
  if (index >= 0) data.rows[index] = savedRow;
}

function removeOverlay(overlay, previousBodyOverflow) {
  overlay?.remove();
  document.body.classList.remove('is-print-preview');
  document.body.style.overflow = previousBodyOverflow;
}

function approvalErrorText(error, fallback) {
  return clean(error?.message) || fallback;
}

async function loadApprovalTemplateSections({ api, data, row }) {
  if (!data?._editorDepsLoaded) {
    if (typeof api?.proposalsAgreementsEditorDeps !== 'function') {
      throw new Error('לא ניתן לטעון את תבנית הצעת המחיר. יש לרענן את המסך ולנסות שוב.');
    }
    const deps = await withTimeout(
      api.proposalsAgreementsEditorDeps(),
      OPEN_TIMEOUT_MS,
      'טעינת תבנית הצעת המחיר נמשכה זמן רב מדי. ניתן לנסות שוב.'
    );
    data.proposalTemplateSections = Array.isArray(deps?.proposalTemplateSections)
      ? deps.proposalTemplateSections
      : [];
    data.proposalActivityGroups = Array.isArray(deps?.proposalActivityGroups)
      ? deps.proposalActivityGroups
      : data.proposalActivityGroups;
    data.proposalGroupAliases = Array.isArray(deps?.proposalGroupAliases)
      ? deps.proposalGroupAliases
      : data.proposalGroupAliases;
    data._editorDepsLoaded = true;
  }

  setProposalGroupLookups(data, data.rows || [], data.proposalActivityPricing || []);
  const templateSections = filterTemplateSectionsForGroup(
    data.proposalTemplateSections,
    row?.activity_type_group
  );
  const hasCustomSections = Array.isArray(row?.custom_document_sections)
    && row.custom_document_sections.length > 0;
  if (!hasCustomSections && templateSections.length === 0) {
    throw new Error('לא נמצאה תבנית פעילה לסוג הצעת המחיר. הפעולה נעצרה.');
  }
  return templateSections;
}

function buildApprovalOverlay({ row, items, templateSections, renderPreview }) {
  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'proposal-preview-overlay proposal-approval-runtime-overlay';
  const clientLabel = [row?.client_authority, row?.school_framework].map(clean).filter(Boolean).join(' — ');
  const quoteLabel = clean(row?.quote_number) ? `הצעה ${clean(row.quote_number)}` : 'הצעת מחיר';
  const previewHtml = renderPreview(row, items, templateSections, { showSignatureImage: true });
  overlay.innerHTML = `
    <div class="proposal-preview-toolbar no-print" data-pa-approval-runtime-toolbar>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" id="pa-signature-cancel">ביטול</button>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="pa-signature-confirm">אישור וחתימה</button>
      <span class="ds-pa-preview-client">${escapeHtml(quoteLabel)}${clientLabel ? ` · ${escapeHtml(clientLabel)}` : ''}</span>
      <span role="alert" data-pa-approval-runtime-error style="display:none;color:#b91c1c;font-weight:700;margin-inline-start:auto"></span>
    </div>
    <div class="proposal-preview-area">${previewHtml}</div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('is-print-preview');
  forceProposalApprovalOverlayVisible(overlay);
  overlay.scrollTop = 0;
  return overlay;
}

export function installProposalApprovalRuntime({
  screen = proposalsAgreementsScreen,
  renderPreview = proposalPreviewBodyHtml,
  toast = showToast
} = {}) {
  if (!screen || typeof screen.bind !== 'function') return false;
  if (screen.__proposalApprovalRuntimePatched) return true;
  screen.__proposalApprovalRuntimePatched = true;

  const originalBind = screen.bind.bind(screen);
  screen.bind = function bindWithReliableProposalApproval(context = {}) {
    originalBind(context);
    const root = context?.root;
    if (!root) return;

    root.__proposalApprovalRuntimeContext = context;
    if (root.__proposalApprovalRuntimeBound) return;
    root.__proposalApprovalRuntimeBound = true;
    root.__proposalApprovalRuntimePending = new Set();

    root.addEventListener('click', async (event) => {
      const actionButton = event.target?.closest?.(APPROVAL_SELECTOR);
      if (!actionButton || !root.contains(actionButton)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const existingOverlay = document.getElementById(OVERLAY_ID);
      if (existingOverlay) {
        forceProposalApprovalOverlayVisible(existingOverlay);
        existingOverlay.querySelector('#pa-signature-confirm')?.focus();
        return;
      }

      const latest = root.__proposalApprovalRuntimeContext || {};
      const { data, state, api, rerender } = latest;
      const proposalId = clean(actionButton.dataset.paActionId);
      if (!proposalId || !canApprove(state)) {
        toast('אין הרשאה לאשר ולחתום הצעות מחיר', 'error');
        return;
      }
      if (root.__proposalApprovalRuntimePending.has(proposalId)) return;

      const row = Array.isArray(data?.rows)
        ? data.rows.find((candidate) => clean(candidate?.id) === proposalId)
        : null;
      if (!row) {
        toast('לא נמצאה הצעת המחיר. יש לרענן את המסך ולנסות שוב.', 'error');
        return;
      }

      root.__proposalApprovalRuntimePending.add(proposalId);
      actionButton.setAttribute('aria-busy', 'true');
      actionButton.dataset.paApprovalOpening = 'true';
      const previousBodyOverflow = document.body.style.overflow;
      let overlay = null;

      try {
        const templateSections = await loadApprovalTemplateSections({ api, data, row });
        const items = typeof api?.readProposalAgreementItems === 'function'
          ? await withTimeout(
              api.readProposalAgreementItems(proposalId),
              OPEN_TIMEOUT_MS,
              'טעינת שורות ההצעה נמשכה זמן רב מדי. ניתן לנסות שוב.'
            )
          : [];
        overlay = buildApprovalOverlay({
          row,
          items: Array.isArray(items) ? items : [],
          templateSections,
          renderPreview
        });
        document.body.style.overflow = 'hidden';

        if (!overlayIsUsable(overlay)) {
          throw new Error('מסך החתימה נוצר אך אינו זמין להצגה.');
        }

        const cancelButton = overlay.querySelector('#pa-signature-cancel');
        const confirmButton = overlay.querySelector('#pa-signature-confirm');
        const errorElement = overlay.querySelector('[data-pa-approval-runtime-error]');
        let saving = false;

        const close = () => {
          if (saving) return;
          removeOverlay(overlay, previousBodyOverflow);
        };
        cancelButton?.addEventListener('click', close);
        overlay.addEventListener('keydown', (keyboardEvent) => {
          if (keyboardEvent.key === 'Escape') close();
        });

        confirmButton?.addEventListener('click', async () => {
          if (saving) return;
          saving = true;
          confirmButton.disabled = true;
          cancelButton.disabled = true;
          confirmButton.setAttribute('aria-busy', 'true');
          const originalText = confirmButton.textContent;
          confirmButton.textContent = 'שומר חתימה ומאשר…';
          if (errorElement) {
            errorElement.textContent = '';
            errorElement.style.display = 'none';
          }

          try {
            if (typeof api?.updateProposalAgreementStatus !== 'function') {
              throw new Error('שירות אישור ההצעה אינו זמין.');
            }
            const signatureMeta = createProposalApprovalSignatureMeta();
            const result = await withTimeout(
              api.updateProposalAgreementStatus(proposalId, 'approved', '', signatureMeta),
              SAVE_TIMEOUT_MS,
              'שמירת החתימה נמשכה זמן רב מדי. יש לבדוק את החיבור ולנסות שוב.'
            );
            const savedRow = result?.row;
            if (!isCompleteSavedApproval(savedRow)) {
              throw new Error('השרת לא החזיר אישור מלא הכולל חתימה ותאריך אישור.');
            }

            replaceLocalRow(data, savedRow);
            removeOverlay(overlay, previousBodyOverflow);
            toast('ההצעה אושרה ונחתמה', 'success');
            try {
              if (typeof rerender === 'function') await rerender();
            } catch (rerenderError) {
              console.error('[proposal approval runtime rerender failed]', rerenderError);
            }
            document.dispatchEvent(new CustomEvent('app:proposals-pending-updated', {
              detail: { rows: Array.isArray(data?.rows) ? data.rows : [] }
            }));
          } catch (error) {
            const message = approvalErrorText(error, 'לא ניתן היה לשמור את החתימה ולאשר את ההצעה.');
            if (errorElement) {
              errorElement.textContent = message;
              errorElement.style.display = 'inline';
            }
            toast(message, 'error');
            console.error('[proposal approval runtime save failed]', error);
          } finally {
            if (confirmButton.isConnected) {
              confirmButton.disabled = false;
              cancelButton.disabled = false;
              confirmButton.removeAttribute('aria-busy');
              confirmButton.textContent = originalText;
              saving = false;
              confirmButton.focus();
            }
          }
        });

        queueMicrotask(() => confirmButton?.focus());
      } catch (error) {
        if (overlay) removeOverlay(overlay, previousBodyOverflow);
        const message = approvalErrorText(error, 'לא ניתן היה לפתוח את מסך החתימה. ניתן לנסות שוב.');
        toast(message, 'error');
        console.error('[proposal approval runtime open failed]', error);
      } finally {
        root.__proposalApprovalRuntimePending.delete(proposalId);
        if (actionButton.isConnected) {
          actionButton.disabled = false;
          actionButton.removeAttribute('aria-busy');
          delete actionButton.dataset.paApprovalOpening;
        }
      }
    }, true);
  };

  return true;
}

if (globalThis[TEST_FLAG] !== true && globalThis[RUNTIME_FLAG] !== true) {
  globalThis[RUNTIME_FLAG] = true;
  installProposalApprovalRuntime();
}
