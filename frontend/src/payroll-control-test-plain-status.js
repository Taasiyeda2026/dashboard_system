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
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-instructor-list{
      display:grid;
      gap:10px;
      margin-top:10px;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-instructor{
      border:1px solid #d7e0ea;
      border-radius:10px;
      background:#fff;
      overflow:hidden;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-instructor>summary{
      cursor:pointer;
      padding:12px 14px;
      background:#fff;
      font-weight:800;
      font-size:1rem;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-instructor__days{
      padding:0 6px 6px;
    }
    [data-payroll-window] [data-attendance-control][data-payroll-test-mode="true"] .payroll-test-instructor__days>.attendance-control__employee{
      margin:7px 0;
    }
  `;
  doc.head.appendChild(style);
}

function instructorNameFromCard(card) {
  const strong = card.querySelector(':scope > summary strong');
  const raw = String(strong?.textContent || '').trim();
  return raw.split('|')[0]?.trim() || 'מדריך';
}

function groupResultsByInstructor(doc, results) {
  if (results.querySelector(':scope > .payroll-test-instructor-list')) return;
  const cards = [...results.querySelectorAll(':scope > .attendance-control__employee')];
  if (!cards.length) return;

  const groups = new Map();
  cards.forEach((card) => {
    const name = instructorNameFromCard(card);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(card);
  });

  const list = doc.createElement('div');
  list.className = 'payroll-test-instructor-list';
  cards[0].insertAdjacentElement('beforebegin', list);

  groups.forEach((instructorCards, name) => {
    const accordion = doc.createElement('details');
    accordion.className = 'payroll-test-instructor';
    const summary = doc.createElement('summary');
    summary.textContent = name;
    const days = doc.createElement('div');
    days.className = 'payroll-test-instructor__days';
    instructorCards.forEach((card) => days.appendChild(card));
    accordion.append(summary, days);
    list.appendChild(accordion);
  });
}

function simplifyManualReasonLabels(results) {
  results.querySelectorAll('.payroll-test-review-reasons').forEach((group) => {
    group.querySelector('strong')?.remove();
    group.querySelectorAll('span').forEach((reason) => {
      const value = String(reason.textContent || '').trim();
      const manualMatch = value.match(/^(ביטול זמן|הכשרה|תפעול|הוצאה)\s*[–-]\s*נדרש אישור ידני$/u);
      if (manualMatch) reason.textContent = manualMatch[1];
    });
  });
}

function applyPlainStatusPresentation(doc) {
  const panel = doc?.querySelector?.('[data-attendance-control]');
  if (!panel || panel.dataset.payrollTestMode !== 'true') return false;
  const results = panel.querySelector('[data-attendance-results]');
  if (!results) return false;

  ensurePlainStatusStyles(doc);
  simplifyManualReasonLabels(results);

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

  groupResultsByInstructor(doc, results);
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
