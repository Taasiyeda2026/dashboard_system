function textOf(element) {
  return String(element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function ensureCompactCompletionToolbarStyles() {
  if (document.getElementById('ops-completion-toolbar-compact-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-completion-toolbar-compact-style';
  style.textContent = `
    #app .ds-ops-completion-control-card {
      padding: 8px 10px !important;
    }

    #app .ds-ops-completion-title-bar {
      display: grid !important;
      grid-template-columns: auto minmax(0, 1fr) !important;
      align-items: center !important;
      gap: 8px !important;
    }

    #app .ds-ops-completion-summary {
      min-width: max-content !important;
      margin: 0 !important;
    }

    #app .ops-completion-single-row {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      flex-wrap: nowrap !important;
      gap: 4px !important;
      width: 100% !important;
      min-width: 0 !important;
      overflow-x: auto !important;
      padding: 2px 0 !important;
      margin: 0 !important;
      scrollbar-width: thin;
      box-sizing: border-box;
    }

    #app .ops-completion-single-row > *,
    #app .ops-completion-single-row label {
      flex: 0 0 auto !important;
      min-width: 0 !important;
      margin: 0 !important;
    }

    #app .ops-completion-single-row .ds-btn,
    #app .ops-completion-single-row button {
      min-width: 0 !important;
      width: auto !important;
      height: 27px !important;
      min-height: 27px !important;
      padding: 2px 7px !important;
      border-radius: 7px !important;
      font-size: 10.5px !important;
      line-height: 1 !important;
      font-weight: 750 !important;
      white-space: nowrap !important;
    }

    #app .ops-completion-single-row .ds-input,
    #app .ops-completion-single-row input,
    #app .ops-completion-single-row select {
      height: 27px !important;
      min-height: 27px !important;
      padding: 1px 6px !important;
      border-radius: 7px !important;
      font-size: 10.5px !important;
      line-height: 1 !important;
      white-space: nowrap !important;
    }

    #app .ops-completion-single-row [data-ops-completion-date-filter] {
      width: 118px !important;
      max-width: 118px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-status-filter] {
      width: 104px !important;
      max-width: 104px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-type-filter] {
      width: 92px !important;
      max-width: 92px !important;
    }

    #app .ops-completion-single-row [data-ops-completion-authority-filter] {
      width: 106px !important;
      max-width: 106px !important;
    }

    #app .ops-completion-single-row [data-ops-approval-print-instructor] {
      width: 116px !important;
      max-width: 116px !important;
    }

    #app .ds-ops-completion-toolbar-stack,
    #app .ds-ops-completion-toolbar-section,
    #app .ds-ops-completion-filter-toolbar,
    #app .ds-ops-completion-actions-toolbar,
    #app .ds-ops-completion-subtabs {
      display: contents !important;
    }

    #app .ds-ops-completion-toolbar-label {
      display: none !important;
    }

    @media (max-width: 900px) {
      #app .ds-ops-completion-title-bar {
        grid-template-columns: 1fr !important;
      }
    }
  `;
  document.head.appendChild(style);
}

function compactCompletionApprovalToolbar() {
  const root = document.querySelector('#app .ds-ops-mgmt-screen');
  const titleBar = root?.querySelector('.ds-ops-completion-title-bar');
  if (!root || !titleBar) return;

  root.querySelectorAll('button').forEach((button) => {
    if (textOf(button) === 'אנשי קשר ואחראי קשר') button.textContent = 'אחראי קשר';
  });

  let row = titleBar.querySelector(':scope > .ops-completion-single-row');
  if (!row) {
    row = document.createElement('div');
    row.className = 'ops-completion-single-row';
    row.setAttribute('role', 'toolbar');
    row.setAttribute('aria-label', 'סינון ופעולות אישורי ביצוע');
    const summary = titleBar.querySelector(':scope > .ds-ops-completion-summary');
    if (summary) summary.insertAdjacentElement('afterend', row);
    else titleBar.prepend(row);
  }

  const subtabs = titleBar.querySelector('.ds-ops-completion-subtabs');
  const filters = titleBar.querySelector('.ds-ops-completion-filter-toolbar');
  const actions = titleBar.querySelector('.ds-ops-completion-actions-toolbar');

  [subtabs, filters, actions].forEach((container) => {
    if (!container) return;
    Array.from(container.children).forEach((child) => row.appendChild(child));
  });

  titleBar.querySelectorAll('.ds-ops-completion-toolbar-label').forEach((label) => label.remove());
}

function runCompactCompletionToolbar() {
  ensureCompactCompletionToolbarStyles();
  compactCompletionApprovalToolbar();
}

let queued = false;
function scheduleCompactCompletionToolbar() {
  if (queued) return;
  queued = true;
  setTimeout(() => {
    queued = false;
    runCompactCompletionToolbar();
  }, 60);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleCompactCompletionToolbar, { once: true });
  } else {
    scheduleCompactCompletionToolbar();
  }
  new MutationObserver(scheduleCompactCompletionToolbar).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
