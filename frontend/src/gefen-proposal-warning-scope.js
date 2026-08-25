const STYLE_ID = 'gefen-proposal-warning-scope-v1';

function installGefenProposalWarningScope() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-gefen-document-warning {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

installGefenProposalWarningScope();
