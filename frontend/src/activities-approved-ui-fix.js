function installStyles() {
  if (document.getElementById('activities-approved-ui-fix-styles')) return;
  const style = document.createElement('style');
  style.id = 'activities-approved-ui-fix-styles';
  style.textContent = `
    #app .ds-table--activities-list th.ds-activities-col--instructor,
    #app .ds-table--activities-list td.ds-activities-col--instructor {
      min-width: 190px !important;
      width: 190px !important;
      overflow: visible !important;
    }
    #app .ds-table--activities-list .ds-activities-instructor-wrap,
    #app .ds-table--activities-list .ds-activities-instructor-name {
      display: block !important;
      width: 100% !important;
      max-width: none !important;
      overflow: visible !important;
      text-overflow: clip !important;
      white-space: normal !important;
      word-break: normal !important;
      line-height: 1.35 !important;
    }
    #app .ds-table--activities-list .ds-chip--instructor-empty {
      display: inline !important;
      width: auto !important;
      min-width: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: #475569 !important;
      font-weight: 700 !important;
      white-space: normal !important;
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
    chip.textContent = 'ללא מדריך';
    chip.removeAttribute('title');
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
    new MutationObserver(run).observe(app, { childList: true, subtree: true });
  }
}
