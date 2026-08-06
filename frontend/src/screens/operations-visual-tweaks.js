function addOperationsVisualTweaksStyle() {
  if (document.getElementById('ops-visual-tweaks-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-visual-tweaks-style';
  style.textContent = `
    .ops-trx-section td {
      border-top: 4px solid var(--ds-accent, #0292b7) !important;
      border-bottom: 2px solid var(--ds-accent, #0292b7) !important;
      background: color-mix(in srgb, var(--ds-accent, #0292b7) 12%, #ffffff) !important;
      color: var(--ds-accent, #0292b7) !important;
      font-weight: 900 !important;
    }
    .ops-trx-section-title {
      background: color-mix(in srgb, var(--ds-accent, #0292b7) 12%, #ffffff) !important;
      color: var(--ds-accent, #0292b7) !important;
    }
    #app .ds-activities-screen .ds-table--activities-list thead,
    #app .ds-activities-screen .ds-table--activities-list thead tr,
    #app .ds-activities-screen .ds-table--activities-list thead th {
      position: sticky;
      top: 0;
      z-index: 40;
    }
    #app .ds-activities-screen .ds-table--activities-list thead th {
      background: #eef8fb !important;
      color: #0f172a !important;
      font-weight: 800 !important;
      box-shadow: inset 0 -1px 0 #b7d7e4, 0 2px 5px rgba(15, 23, 42, 0.08);
      border-bottom: 1px solid #b7d7e4 !important;
      vertical-align: middle;
    }
    #app .ds-activities-screen .ds-table-wrap:has(.ds-table--activities-list) {
      overflow: visible;
    }
    #app table thead,
    #app table thead tr,
    #app table thead th {
      position: sticky;
      top: 0;
      z-index: 40;
    }
    #app table thead th {
      background: #eef8fb !important;
      color: #0f172a !important;
      font-weight: 800 !important;
      box-shadow: inset 0 -1px 0 #b7d7e4, 0 2px 5px rgba(15, 23, 42, 0.08);
      border-bottom: 1px solid #b7d7e4 !important;
      vertical-align: middle;
    }
    #app table thead th:first-child {
      border-top-right-radius: 8px;
    }
    #app table thead th:last-child {
      border-top-left-radius: 8px;
    }

    #app.ds-activities-archive-mode .ds-table--activities-list {
      width: 100% !important;
      table-layout: fixed !important;
      border-collapse: separate;
      border-spacing: 0;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list th,
    #app.ds-activities-archive-mode .ds-table--activities-list td {
      height: 50px;
      padding: 8px 10px;
      vertical-align: middle;
      box-sizing: border-box;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th {
      height: 44px;
      white-space: nowrap;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:not(.ds-activities-col--instructor) {
      text-align: center;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list thead th.ds-activities-col--instructor,
    #app.ds-activities-archive-mode .ds-table--activities-list td.ds-activities-col--instructor {
      text-align: right !important;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(1) {
      width: 24%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(5),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(5) {
      text-align: right;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(2),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(3),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(3) {
      width: 12%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(4),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(4) {
      width: 16%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(6),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(6),
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(7),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(7) {
      width: 10%;
      text-align: center;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-cell,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-instructor-wrap {
      min-width: 0;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-name,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-cell-ellipsis,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-instructor-name,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-manager-line {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-name {
      font-weight: 800;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-program-type,
    #app.ds-activities-archive-mode .ds-table--activities-list .ds-activities-manager-line {
      font-size: 11px;
      color: #64748b;
      line-height: 1.2;
      margin-top: 2px;
    }

    /* ניהול תפעול — שורת פעולות וחיפוש קומפקטית */
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar,
    #app .ds-ops-mgmt-screen .ops-compact-action-row {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 6px !important;
      flex-wrap: nowrap !important;
      width: 100% !important;
      max-width: 100% !important;
      padding: 4px 0 !important;
      margin: 0 0 8px !important;
      overflow-x: auto !important;
      scrollbar-width: thin;
      box-sizing: border-box;
    }
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-btn,
    #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-btn,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar button,
    #app .ds-ops-mgmt-screen .ops-compact-action-row button {
      min-width: 0 !important;
      width: auto !important;
      min-height: 30px !important;
      height: 30px !important;
      padding: 3px 9px !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      line-height: 1.1 !important;
      font-weight: 750 !important;
      white-space: nowrap !important;
      flex: 0 0 auto !important;
    }
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-input,
    #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-input,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar input,
    #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar select,
    #app .ds-ops-mgmt-screen .ops-compact-action-row input,
    #app .ds-ops-mgmt-screen .ops-compact-action-row select {
      min-width: 165px !important;
      width: min(230px, 24vw) !important;
      max-width: 230px !important;
      min-height: 30px !important;
      height: 30px !important;
      padding: 2px 8px !important;
      border-radius: 8px !important;
      font-size: 12px !important;
      flex: 1 1 190px !important;
    }
    @media (max-width: 1050px) {
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar,
      #app .ds-ops-mgmt-screen .ops-compact-action-row {
        flex-wrap: wrap !important;
        overflow-x: visible !important;
      }
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar .ds-input,
      #app .ds-ops-mgmt-screen .ops-compact-action-row .ds-input,
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar input,
      #app .ds-ops-mgmt-screen .ds-ops-mgmt-panel__toolbar select,
      #app .ds-ops-mgmt-screen .ops-compact-action-row input,
      #app .ds-ops-mgmt-screen .ops-compact-action-row select {
        width: 210px !important;
        max-width: 210px !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function removeEmptyCellLegendText() {
  document.querySelectorAll('.ops-trx-legend span').forEach((span) => {
    const text = String(span.textContent || '').trim();
    if (text.includes('תא ריק')) span.remove();
  });
}

function textOf(el) {
  return String(el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function isVisibleElement(el) {
  if (!el) return false;
  const rect = el.getBoundingClientRect?.();
  if (!rect) return true;
  return rect.width > 0 && rect.height > 0;
}

function isActivitiesArchiveVisible() {
  const app = document.getElementById('app');
  if (!app || !app.querySelector('.ds-table--activities-list')) return false;
  const activeCandidates = app.querySelectorAll(`
    button.is-active,
    button.active,
    button[aria-pressed="true"],
    .is-active,
    .active,
    [aria-selected="true"],
    [data-active="true"]
  `);
  return Array.from(activeCandidates).some((el) => isVisibleElement(el) && textOf(el).includes('ארכיון'));
}

function setActivitiesArchiveMode() {
  const app = document.getElementById('app');
  if (!app) return;
  app.classList.toggle('ds-activities-archive-mode', isActivitiesArchiveVisible());
}

function compactOperationsActionRow() {
  const root = document.querySelector('#app .ds-ops-mgmt-screen');
  if (!root) return;

  const buttons = Array.from(root.querySelectorAll('button'));
  buttons.forEach((button) => {
    if (textOf(button) === 'אנשי קשר ואחראי קשר') button.textContent = 'אחראי קשר';
  });

  const knownLabels = new Set([
    'הדפס סידור עבודה',
    'כולל ישנים',
    'מדריכים',
    'אחראי קשר',
    'אנשי קשר ואחראי קשר',
    'הכשרות קיץ',
    'סדנת קיץ'
  ]);
  const actionButtons = Array.from(root.querySelectorAll('button')).filter((button) => knownLabels.has(textOf(button)));
  if (!actionButtons.length) return;

  const anchor = actionButtons.find((button) => textOf(button) === 'אחראי קשר') || actionButtons[0];
  let row = anchor.closest('.ds-ops-mgmt-panel__toolbar, .ds-toolbar, .ds-screen-top-row');
  if (!row) {
    let node = anchor.parentElement;
    let depth = 0;
    while (node && node !== root && depth < 5) {
      const matchingButtons = Array.from(node.querySelectorAll('button')).filter((button) => knownLabels.has(textOf(button)));
      if (matchingButtons.length >= 2) {
        row = node;
        break;
      }
      node = node.parentElement;
      depth += 1;
    }
  }
  row?.classList.add('ops-compact-action-row');
}

function runOperationsVisualTweaks() {
  addOperationsVisualTweaksStyle();
  removeEmptyCellLegendText();
  setActivitiesArchiveMode();
  compactOperationsActionRow();
}

function scheduleOperationsVisualTweaks() {
  setTimeout(runOperationsVisualTweaks, 80);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleOperationsVisualTweaks, { once: true });
  } else {
    scheduleOperationsVisualTweaks();
  }
  new MutationObserver(scheduleOperationsVisualTweaks).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected', 'data-active'] });
}

import('./contacts-full-directory.js').catch((error) => {
  console.warn('[contacts-full-directory] failed to load enhancement', error);
});