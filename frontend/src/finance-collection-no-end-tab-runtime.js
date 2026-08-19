const TAB_VALUE = 'no_end_date';
const TAB_LABEL = 'ללא';

function ensureNoEndDateTab(root = document) {
  root.querySelectorAll?.('.ds-fin-tabs[role="tablist"]').forEach((tabList) => {
    if (!tabList.closest('.ds-fin-collect-shell')) return;
    let button = tabList.querySelector(`[data-finance-collection-tab="${TAB_VALUE}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ds-fin-tab';
      button.dataset.financeCollectionTab = TAB_VALUE;
      button.textContent = TAB_LABEL;
      tabList.append(button);
    }

    const activeOtherTab = [...tabList.querySelectorAll('[data-finance-collection-tab]')]
      .some((candidate) => candidate !== button && candidate.classList.contains('is-active'));
    button.classList.toggle('is-active', !activeOtherTab);
  });
}

function scheduleEnsure() {
  queueMicrotask(() => ensureNoEndDateTab(document));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnsure, { once: true });
  } else {
    scheduleEnsure();
  }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(scheduleEnsure);
    observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  }
}

export { ensureNoEndDateTab };
