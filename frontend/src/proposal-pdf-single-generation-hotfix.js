import {
  gefenApprovalItems,
  nextYearGefenApprovalItems,
  proposalHasFinalPdf,
  proposalsAgreementsScreen
} from './screens/proposals-agreements.js';
import { showToast } from './screens/shared/toast.js';

const PATCH_KEY = Symbol.for('taasiyeda.proposalPdfSingleGenerationHotfix');
const API_PATCH_KEY = Symbol.for('taasiyeda.proposalGefenSendSnapshotHotfix');
const ERROR_PATCH_KEY = Symbol.for('taasiyeda.proposalGefenCurrentPriceErrorHotfix');
const CURRENT_GEFEN_ERROR_PREFIX = 'לא נמצא מחיר גפ״ן עדכני לתוכנית';
const PREPARED_CURRENT_PRICE_SNAPSHOTS = new Map();
const rootCleanup = new WeakMap();

function cleanText(value) {
  return String(value == null ? '' : value).trim();
}

function rowHasSavedPdf(row = {}) {
  if (typeof proposalHasFinalPdf === 'function') return proposalHasFinalPdf(row);
  return Boolean(cleanText(row.final_pdf_path));
}

function isNextYearCombinedProposal(row = {}) {
  const group = cleanText(row.activity_type_group).toLowerCase();
  const nextYear = group === 'next_year'
    || group === 'תשפ״ז'
    || group === 'תשפ"ז'
    || group === 'שנת הלימודים תשפ״ז'
    || group === 'תוכניות תשפ״ז';
  return nextYear && row.combine_gefen_approval === true;
}

function installGefenCurrentPriceErrorBridge() {
  if (Error.prototype[ERROR_PATCH_KEY]) return;
  if (!Object.getOwnPropertyDescriptor(Error.prototype, 'userMessage')) {
    Object.defineProperty(Error.prototype, 'userMessage', {
      configurable: true,
      enumerable: false,
      get() {
        const message = cleanText(this?.message);
        return message.startsWith(CURRENT_GEFEN_ERROR_PREFIX) ? message : undefined;
      },
      set(value) {
        Object.defineProperty(this, 'userMessage', {
          value,
          configurable: true,
          enumerable: true,
          writable: true
        });
      }
    });
  }
  Object.defineProperty(Error.prototype, ERROR_PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

function installLockAndSendSnapshotGuard(api) {
  if (!api || api[API_PATCH_KEY] || typeof api.lockAndSendProposalAgreement !== 'function') return;
  const originalLockAndSend = api.lockAndSendProposalAgreement;
  api.lockAndSendProposalAgreement = async function lockAndSendWithCurrentGefenSnapshot(id, payload = {}) {
    const proposalId = cleanText(id);
    const prepared = PREPARED_CURRENT_PRICE_SNAPSHOTS.get(proposalId);
    const nextPayload = prepared
      ? {
          ...payload,
          documentSnapshot: prepared.documentSnapshot || payload.documentSnapshot || payload.document_snapshot,
          documentHtmlSnapshot: prepared.documentHtmlSnapshot || payload.documentHtmlSnapshot || payload.document_html_snapshot
        }
      : payload;
    const result = await originalLockAndSend.call(this, id, nextPayload);
    if (prepared) PREPARED_CURRENT_PRICE_SNAPSHOTS.delete(proposalId);
    return result;
  };
  Object.defineProperty(api, API_PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });
}

async function assertCurrentGefenPricingAvailable(row, api) {
  if (!isNextYearCombinedProposal(row)) return;
  if (typeof api?.readProposalAgreementItems !== 'function' || typeof api?.readCurrentGefenCourses !== 'function') {
    throw new Error('טעינת מחירון גפ״ן העדכני אינה זמינה.');
  }
  const items = await api.readProposalAgreementItems(cleanText(row.id));
  const selected = gefenApprovalItems(row, items);
  const currentCourses = await api.readCurrentGefenCourses(
    selected.map((item) => cleanText(item?.gefen_number ?? item?.gefenNumber)).filter(Boolean)
  );
  nextYearGefenApprovalItems(row, items, currentCourses);
}

function proposalRows(data) {
  return Array.isArray(data?.rows) ? data.rows : [];
}

function findProposalRow(data, id) {
  const proposalId = cleanText(id);
  return proposalRows(data).find((item) => cleanText(item?.id) === proposalId) || null;
}

function findSentActionButton(root, id) {
  const proposalId = cleanText(id);
  return Array.from(root.querySelectorAll('[data-pa-status-action="sent"][data-pa-action-id]'))
    .find((button) => cleanText(button.dataset.paActionId) === proposalId) || null;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSavedPdf(data, id, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = findProposalRow(data, id);
    if (rowHasSavedPdf(row)) return row;
    await wait(120);
  }
  return findProposalRow(data, id);
}

function dispatchPrintWithoutPopup(button) {
  if (!button) return;
  const originalOpen = typeof window !== 'undefined' ? window.open : null;
  const fakeWindow = {
    closed: false,
    opener: null,
    location: {
      href: 'about:blank',
      replace(url) { this.href = cleanText(url); }
    },
    close() { this.closed = true; }
  };
  try {
    if (typeof window !== 'undefined') window.open = () => fakeWindow;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  } finally {
    if (typeof window !== 'undefined') window.open = originalOpen;
  }
}

function installRootGuard(root, data, context = {}) {
  rootCleanup.get(root)?.();

  let activeProposalId = '';
  let observer = null;
  const api = context?.api;
  installLockAndSendSnapshotGuard(api);

  const activeFormProposalId = () => {
    const forms = Array.from(root.querySelectorAll('[data-pa-form][data-pa-id]'));
    const visibleForm = forms.find((form) => !form.hidden && form.offsetParent !== null) || forms.at(-1);
    return cleanText(visibleForm?.dataset?.paId);
  };

  const hideDuplicatePdfButton = () => {
    const overlay = document.getElementById('pa-preview-overlay');
    const pdfButton = overlay?.querySelector('#pa-print-btn');
    if (!pdfButton) return;

    const proposalId = activeProposalId || activeFormProposalId();
    if (!proposalId) return;

    const row = findProposalRow(data, proposalId);
    if (!rowHasSavedPdf(row)) return;

    pdfButton.disabled = true;
    pdfButton.hidden = true;
    pdfButton.remove();
  };

  const capturePreviewProposal = (event) => {
    const previewButton = event?.target?.closest?.('[data-pa-preview]');
    if (!previewButton) return;
    activeProposalId = cleanText(previewButton.dataset.paPreview);
  };

  const prepareCurrentGefenBeforeSend = async (event) => {
    const sentButton = event?.target?.closest?.('[data-pa-status-action="sent"][data-pa-action-id]');
    if (!sentButton) return;
    if (sentButton.dataset.paGefenSendBypass === 'true') {
      delete sentButton.dataset.paGefenSendBypass;
      return;
    }

    const proposalId = cleanText(sentButton.dataset.paActionId);
    const row = findProposalRow(data, proposalId);
    if (!row || !isNextYearCombinedProposal(row) || rowHasSavedPdf(row)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (sentButton.dataset.paGefenSendPreparing === 'true') return;
    sentButton.dataset.paGefenSendPreparing = 'true';
    sentButton.disabled = true;

    let temporaryPrintButton = null;
    try {
      await assertCurrentGefenPricingAvailable(row, api);

      const existingPrintButton = Array.from(root.querySelectorAll('[data-pa-print]'))
        .find((button) => cleanText(button.dataset.paPrint) === proposalId);
      temporaryPrintButton = existingPrintButton || document.createElement('button');
      if (!existingPrintButton) {
        temporaryPrintButton.type = 'button';
        temporaryPrintButton.hidden = true;
        temporaryPrintButton.dataset.paPrint = proposalId;
        root.appendChild(temporaryPrintButton);
      }

      dispatchPrintWithoutPopup(temporaryPrintButton);
      const savedRow = await waitForSavedPdf(data, proposalId);
      if (!rowHasSavedPdf(savedRow)) {
        showToast('הפקת ה־PDF העדכני לא הושלמה ולכן ההצעה לא סומנה כנשלחה.', 'error', 6000);
        return;
      }

      const currentHtml = cleanText(savedRow?.document_html_snapshot);
      const currentSnapshot = savedRow?.document_snapshot;
      if (!currentHtml || !currentSnapshot || typeof currentSnapshot !== 'object') {
        showToast('ה־PDF הופק אך נתוני המסמך העדכניים לא נשמרו במלואם. ההצעה לא סומנה כנשלחה.', 'error', 6000);
        return;
      }
      PREPARED_CURRENT_PRICE_SNAPSHOTS.set(proposalId, {
        documentHtmlSnapshot: currentHtml,
        documentSnapshot: currentSnapshot
      });

      const freshSentButton = findSentActionButton(root, proposalId) || sentButton;
      freshSentButton.disabled = false;
      freshSentButton.dataset.paGefenSendBypass = 'true';
      freshSentButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    } catch (error) {
      const message = cleanText(error?.userMessage || error?.message);
      showToast(message || 'לא ניתן היה לטעון את מחירון גפ״ן העדכני. ההצעה לא נשלחה.', 'error', 6000);
      console.error('[proposal current GEFEN send preparation failed]', error);
    } finally {
      if (temporaryPrintButton?.hidden && temporaryPrintButton?.isConnected) temporaryPrintButton.remove();
      if (sentButton.isConnected) {
        sentButton.disabled = false;
        delete sentButton.dataset.paGefenSendPreparing;
      }
    }
  };

  root.addEventListener('click', capturePreviewProposal, true);
  root.addEventListener('click', prepareCurrentGefenBeforeSend, true);

  if (typeof MutationObserver === 'function' && document?.body) {
    observer = new MutationObserver(hideDuplicatePdfButton);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  const cleanup = () => {
    root.removeEventListener('click', capturePreviewProposal, true);
    root.removeEventListener('click', prepareCurrentGefenBeforeSend, true);
    observer?.disconnect();
    observer = null;
    rootCleanup.delete(root);
  };

  rootCleanup.set(root, cleanup);
  context?.signal?.addEventListener?.('abort', cleanup, { once: true });
  hideDuplicatePdfButton();
}

export function installProposalPdfSingleGenerationHotfix(targetScreen = proposalsAgreementsScreen) {
  if (!targetScreen || targetScreen[PATCH_KEY]) return false;

  const originalBind = targetScreen.bind;
  if (typeof originalBind !== 'function') return false;

  targetScreen.bind = function proposalPdfSingleGenerationBind(context = {}) {
    const result = originalBind.call(this, context);
    const root = context?.root;
    const data = context?.data;
    if (root && typeof root.addEventListener === 'function') {
      installRootGuard(root, data, {
        ...context,
        signal: root?._paAbort?.signal || context?.signal
      });
    }
    return result;
  };

  Object.defineProperty(targetScreen, PATCH_KEY, {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  return true;
}

installGefenCurrentPriceErrorBridge();
installProposalPdfSingleGenerationHotfix(proposalsAgreementsScreen);
