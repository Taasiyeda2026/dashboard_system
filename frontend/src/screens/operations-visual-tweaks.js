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
      text-align: center;
      white-space: nowrap;
    }
    #app.ds-activities-archive-mode .ds-table--activities-list tbody td:nth-child(1),
    #app.ds-activities-archive-mode .ds-table--activities-list thead th:nth-child(1) {
      width: 24%;
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

function runOperationsVisualTweaks() {
  addOperationsVisualTweaksStyle();
  removeEmptyCellLegendText();
  setActivitiesArchiveMode();
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
