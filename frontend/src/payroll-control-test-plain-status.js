const PAYROLL_WINDOW_NAME = 'dashboard-payroll-control';
const INSTALL_MARK = '__dashboardPayrollTestPlainStatusInstalled';

function ensurePlainStatusStyles(doc) {
  if (!doc?.head || doc.getElementById('payroll-test-plain-status-styles')) return;
  const style = doc.createElement('style');
  style.id = 'payroll-test-plain-status-styles';
  style.textContent = `
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-review-reasons{
      margin:7px 13px!important;
      padding:0!important;
      border:0!important;
      border-radius:0!important;
      background:transparent!important;
      color:inherit!important;
      display:flex!important;
      gap:8px!important;
      align-items:baseline!important;
      flex-wrap:wrap!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-review-reasons strong,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-review-reasons span{
      margin:0!important;
      padding:0!important;
      border:0!important;
      border-radius:0!important;
      background:transparent!important;
      color:#b91c1c!important;
      font-weight:700!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__short-gaps,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__dashboard-only-line span:last-child,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__day--not-compared .attendance-control__row-status,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__day--mismatch .attendance-control__row-status{
      color:#b91c1c!important;
      background:transparent!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__diff:not(.attendance-control__diff--header)>span:nth-of-type(3){
      color:#b91c1c!important;
      font-weight:700!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__day--mismatch,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__day--not-compared,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__dashboard-only{
      background:#fff!important;
      border-color:#d7e0ea!important;
      color:inherit!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__employee>summary>span{
      color:inherit!important;
      background:transparent!important;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__employee[data-payroll-test-status="ok"]>summary>span,
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .attendance-control__employee[data-payroll-test-status="ok"] .attendance-control__day--ok .attendance-control__row-status{
      color:#15803d!important;
    }
  `;
  doc.head.appendChild(style);
}

function applyPlainStatusPresentation(doc) {
  const panel = doc?.querySelector?.('[data-attendance-control]');
  if (!panel || panel.dataset.payrollTestMode !== 'true') return false;
  const results = panel.querySelector('[data-attendance-results]');
  if (!results) return false;

  ensurePlainStatusStyles(doc);

  results.querySelectorAll('.attendance-control__employee').forEach((card) => {
    const summaryStatus = card.querySelector(':scope > summary > span');
    const isOk = String(summaryStatus?.textContent || '').trim() === 'תקין';
    if (isOk) card.dataset.payrollTestStatus = 'ok';
    else delete card.dataset.payrollTestStatus;

    if (!isOk) {
      card.querySelectorAll('.attendance-control__day--ok .attendance-control__row-status').forEach((status) => {
        if (/תקין/.test(String(status.textContent || ''))) status.textContent = '';
      });
    }
  });

  return true;
}

function observePopup(popup) {
  if (!popup || popup.closed) return;
  const doc = popup.document;
  ensurePlainStatusStyles(doc);
  const Observer = doc.defaultView?.MutationObserver || MutationObserver;
  let scheduled = false;
  const applySoon = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      applyPlainStatusPresentation(doc);
    });
  };
  const observer = new Observer(applySoon);
  observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-payroll-test-mode'] });
  applySoon();
}

export function installPayrollControlTestPlainStatus(targetWindow = typeof window !== 'undefined' ? window : null) {
  if (!targetWindow || targetWindow[INSTALL_MARK]) return false;
  targetWindow[INSTALL_MARK] = true;
  const originalOpen = targetWindow.open?.bind(targetWindow);
  if (typeof originalOpen !== 'function') return false;
  targetWindow.open = function patchedPayrollPlainStatusOpen(url, name, features) {
    const popup = originalOpen(url, name, features);
    if (name === PAYROLL_WINDOW_NAME && popup) {
      try { observePopup(popup); } catch (error) { console.warn('[payroll-test-plain-status] failed', error); }
    }
    return popup;
  };
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPayrollControlTestPlainStatus(window);
}
