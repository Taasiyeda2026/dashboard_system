/**
 * Proposal details public presentation cleanup.
 * Loaded only with the proposals feature — not on every app boot.
 */
(function installProposalDetailsPublicCleanup() {
  'use strict';

  if (globalThis.__dsProposalDetailsPublicCleanupInstalled) return;
  globalThis.__dsProposalDetailsPublicCleanupInstalled = true;

  const allowedSendingLabels = new Set(['נשלח על ידי', 'תאריך שליחה']);
  const hiddenProposalLabels = new Set(['סטטוס', 'תחום', 'תאריך הצעה']);
  const emptyPublicValues = new Set(['', 'לא הוזן', 'לא נשמר', 'לא קיים', '—']);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const normalizedText = (element) => String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  const cellLabel = (cell) => normalizedText(cell?.querySelector('.ds-pa-info-label'));
  const cellValue = (cell) => normalizedText(cell?.querySelector('.ds-pa-info-value'));
  const cardByTitle = (detail, title) => Array.from(detail.querySelectorAll('.ds-pa-info-card'))
    .find((card) => normalizedText(card.querySelector('.ds-pa-card-title')) === title) || null;

  let observer = null;

  function ensureProposalDetailsPublicStyle() {
    if (document.getElementById('proposal-details-public-style')) return;
    const style = document.createElement('style');
    style.id = 'proposal-details-public-style';
    style.textContent = `
      #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid.ds-pa-proposal-info-grid--public {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-activities-wide {
        height: auto !important;
        min-height: 0 !important;
        margin-top: 12px !important;
        padding: 10px 12px 12px !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-activities-wide > .ds-pa-card-title {
        margin: 0 0 6px !important;
        padding: 0 !important;
        line-height: 1.25;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] {
        height: auto !important;
        min-height: 0 !important;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] > :first-child {
        margin-top: 0 !important;
      }
      #app [data-pa-proposal-detail] [data-pa-drawer-items] :is(h3, h4, h5) {
        margin-top: 0 !important;
        margin-bottom: 6px !important;
        line-height: 1.25;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 12px !important;
        height: auto !important;
        min-height: 0 !important;
        margin: 8px 0 0 !important;
        padding: 9px 12px !important;
        border: 0 !important;
        border-top: 1px solid var(--ds-border) !important;
        border-radius: 0 !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary .ds-pa-card-title {
        margin: 0 !important;
        padding: 0 !important;
        font-size: 0.9rem;
        line-height: 1.2;
      }
      #app [data-pa-proposal-detail] .ds-pa-info-card--financial-summary .ds-pa-total-amount {
        margin: 0 !important;
        padding: 0 !important;
        font-size: 1.05rem;
        line-height: 1.2;
        white-space: nowrap;
      }
      #app [data-pa-proposal-detail] .ds-pa-saved-pdf-indicator {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 17px;
        height: 17px;
        color: #0f766e;
        vertical-align: middle;
      }
      #app [data-pa-proposal-detail] .ds-pa-saved-pdf-indicator svg {
        display: block;
        width: 15px;
        height: 15px;
      }
      @media (max-width: 900px) {
        #app [data-pa-proposal-detail] .ds-pa-proposal-info-grid.ds-pa-proposal-info-grid--public {
          grid-template-columns: 1fr !important;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createMergedSendingCell(label, value) {
    const cell = document.createElement('div');
    cell.className = 'ds-pa-info-cell';
    cell.dataset.paMergedSending = 'true';

    const labelElement = document.createElement('span');
    labelElement.className = 'ds-pa-info-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('span');
    valueElement.className = 'ds-pa-info-value';
    valueElement.textContent = value;

    cell.append(labelElement, valueElement);
    return cell;
  }

  function updateSavedPdfIndicator(detail, hasSavedPdf) {
    detail.querySelectorAll('[data-pa-saved-pdf-indicator]').forEach((indicator) => indicator.remove());
    if (!hasSavedPdf) return;
    const statusItem = detail.querySelector('.ds-pa-drawer-meta-item--status');
    const metaLine = statusItem?.parentElement;
    if (!metaLine) return;
    const indicator = document.createElement('span');
    indicator.className = 'ds-pa-saved-pdf-indicator';
    indicator.dataset.paSavedPdfIndicator = 'true';
    indicator.title = 'קיים PDF שמור';
    indicator.setAttribute('aria-label', 'קיים PDF שמור');
    indicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
    metaLine.appendChild(indicator);
  }

  function cleanProposalDetails() {
    if (!document.querySelector('#app [data-pa-proposal-detail], #app [data-pa-screen]')) return;
    ensureProposalDetailsPublicStyle();
    document.querySelectorAll('#app [data-pa-proposal-detail]').forEach((detail) => {
      const proposalCard = cardByTitle(detail, 'פרטי ההצעה');
      const proposalGrid = proposalCard?.querySelector('.ds-pa-info-grid');
      proposalCard?.querySelectorAll('.ds-pa-info-cell').forEach((cell) => {
        if (hiddenProposalLabels.has(cellLabel(cell)) || uuidPattern.test(cellValue(cell))) cell.remove();
      });

      const sendingCard = cardByTitle(detail, 'פרטי שליחה');
      const sendingGrid = sendingCard?.querySelector('.ds-pa-info-grid');
      if (sendingCard) {
        const pdfStatusCell = Array.from(sendingGrid?.querySelectorAll('.ds-pa-info-cell') || [])
          .find((cell) => cellLabel(cell) === 'סטטוס PDF');
        updateSavedPdfIndicator(detail, cellValue(pdfStatusCell) === 'נשמר');
      }
      if (proposalGrid && sendingCard) {
        proposalGrid.querySelectorAll('[data-pa-merged-sending]').forEach((cell) => cell.remove());
        const publicSendingCells = [];

        sendingGrid?.querySelectorAll('.ds-pa-info-cell').forEach((cell) => {
          const label = cellLabel(cell);
          const value = cellValue(cell);
          if (allowedSendingLabels.has(label) && !emptyPublicValues.has(value) && !uuidPattern.test(value)) {
            cell.dataset.paMergedSending = 'true';
            publicSendingCells.push(cell);
          }
        });

        if (publicSendingCells.length) {
          publicSendingCells.forEach((cell) => proposalGrid.appendChild(cell));
        } else {
          proposalGrid.appendChild(createMergedSendingCell('פרטי שליחה', 'ההצעה טרם נשלחה'));
        }

        sendingCard.remove();
        proposalCard.parentElement?.classList.add('ds-pa-proposal-info-grid--public');
      }

      detail.querySelectorAll('.ds-pa-info-cell').forEach((cell) => {
        if (uuidPattern.test(cellValue(cell))) cell.remove();
      });
    });
  }

  let cleanupQueued = false;
  const scheduleProposalDetailsCleanup = () => {
    if (cleanupQueued) return;
    cleanupQueued = true;
    setTimeout(() => {
      cleanupQueued = false;
      cleanProposalDetails();
    }, 40);
  };

  function bindObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver(scheduleProposalDetailsCleanup);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scheduleProposalDetailsCleanup();
      bindObserver();
    }, { once: true });
  } else {
    scheduleProposalDetailsCleanup();
    bindObserver();
  }
})();
