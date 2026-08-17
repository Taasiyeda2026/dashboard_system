function installStyles() {
  if (document.getElementById('activities-approved-ui-fix-styles')) return;
  const style = document.createElement('style');
  style.id = 'activities-approved-ui-fix-styles';
  style.textContent = `
    #app .ds-table--activities-list th.ds-activities-col--instructor,
    #app .ds-table--activities-list td.ds-activities-col--instructor {
      min-width: 190px !important;
      width: 190px !important;
      overflow: hidden !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-wrap,
    #app .ds-table--activities-list .ds-activities-instructor-name {
      display: block !important;
      width: 100% !important;
      max-width: 100% !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
      line-height: 1.35 !important;
    }
    #app .ds-table--activities-list .ds-chip--instructor-empty {
      display: inline-flex !important;
      width: auto !important;
      min-width: 0 !important;
      color: #475569 !important;
      font-weight: 700 !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn {
      display: block !important;
      width: 100% !important;
      min-width: 0 !important;
      max-width: 100% !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      text-align: right !important;
      line-height: 1.25 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      cursor: pointer !important;
    }
    #app .ds-table--activities-list .ds-contact-popover-btn > span:first-child {
      display: block !important;
      min-width: 0 !important;
      color: #334155 !important;
      font-weight: 700 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    #app .ds-table--activities-list .ds-activities-contact-phone {
      display: none !important;
    }
    .ds-modal.ds-modal--scheduling {
      width: min(430px, calc(100vw - 32px)) !important;
      max-width: 430px !important;
      min-height: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__activity {
      display: none !important;
    }
    .ds-modal--scheduling .scheduling-workspace,
    .ds-modal--scheduling .scheduling-workspace__requirements {
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 10px !important;
    }
    .ds-modal--scheduling .scheduling-workspace__fields label {
      display: grid !important;
      gap: 4px !important;
      margin: 0 !important;
    }
    .ds-modal--scheduling .scheduling-workspace__status:empty {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function normalizeInstructorCells(root = document) {
  root.querySelectorAll?.('.ds-chip--instructor-empty').forEach((chip) => {
    if (chip.textContent !== 'ללא מדריך') chip.textContent = 'ללא מדריך';
    if (chip.hasAttribute('title')) chip.removeAttribute('title');
  });
}

function run() {
  installStyles();
  normalizeInstructorCells(document.getElementById('app') || document);
}

if (typeof document !== 'undefined') {
  run();
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver((mutations) => {
      const hasRelevantChange = mutations.some((mutation) => {
        if (mutation.type !== 'childList') return false;
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType !== 1) return false;
          return node.matches?.('.ds-chip--instructor-empty')
            || Boolean(node.querySelector?.('.ds-chip--instructor-empty'));
        });
      });
      if (hasRelevantChange) normalizeInstructorCells(app);
    }).observe(app, { childList: true, subtree: true });
  }
}
