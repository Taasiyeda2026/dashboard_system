const TAB_VALUE = 'no_end_date';
const TAB_LABEL = 'ללא';
const NO_END_DATE_LABEL = 'ללא תאריך סיום';

const HEBREW_MONTHS = {
  ינואר: '01',
  פברואר: '02',
  מרץ: '03',
  אפריל: '04',
  מאי: '05',
  יוני: '06',
  יולי: '07',
  אוגוסט: '08',
  ספטמבר: '09',
  אוקטובר: '10',
  נובמבר: '11',
  דצמבר: '12'
};

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function ensureNoEndDateTab(root = document) {
  root.querySelectorAll?.('.ds-fin-tabs[role="tablist"]').forEach((tabList) => {
    if (!tabList.closest('.ds-fin-collect-shell')) return;
    let button = tabList.querySelector(`[data-finance-collection-tab="${TAB_VALUE}"]`);
    if (!button) {
      button = tabList.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'ds-fin-tab';
      button.dataset.financeCollectionTab = TAB_VALUE;
      button.textContent = TAB_LABEL;
      tabList.append(button);
    }

    const activeOtherTab = [...tabList.querySelectorAll('[data-finance-collection-tab]')]
      .some((candidate) => candidate !== button && candidate.classList.contains('is-active'));
    if (activeOtherTab && button.classList.contains('is-active')) button.classList.remove('is-active');
  });
}

function financeCollectionMonthSortKey(section) {
  const label = text(section?.querySelector?.('.ds-fin-collect-month__title')?.textContent);
  if (label === NO_END_DATE_LABEL) return '9999-99';
  const match = label.match(/^([^\d]+?)\s+(20\d{2})$/);
  const month = HEBREW_MONTHS[text(match?.[1])];
  const year = match?.[2] || '';
  return month && year ? `${year}-${month}` : `9998-${label}`;
}

function activeCollectionTab(shell) {
  return text(shell?.querySelector?.('.ds-fin-tabs [data-finance-collection-tab].is-active')?.dataset?.financeCollectionTab) || 'open';
}

function isNoEndDateSection(section) {
  return text(section?.querySelector?.('.ds-fin-collect-month__title')?.textContent) === NO_END_DATE_LABEL;
}

function addFilteredEmptyState(body, tab) {
  if (!body || body.querySelector('.ds-fin-collect-month') || body.querySelector('.ds-empty')) return;
  const messages = {
    open: 'אין פעילויות פתוחות לגבייה.',
    closed: 'אין פעילויות סגורות לגבייה.',
    no_end_date: 'אין פעילויות ללא תאריך סיום.'
  };
  const empty = body.ownerDocument.createElement('div');
  empty.className = 'ds-empty';
  empty.setAttribute('role', 'status');
  empty.innerHTML = `<p class="ds-empty__msg">${messages[tab] || 'אין פעילויות לתצוגה.'}</p>`;
  body.append(empty);
}

function filterAndSortMonthSections(shell) {
  const body = shell?.querySelector?.('[data-finance-collection-body]');
  if (!body) return;
  const tab = activeCollectionTab(shell);
  const sections = [...body.querySelectorAll(':scope > .ds-fin-collect-month')];

  if (tab === 'open' || tab === 'closed') {
    sections.filter(isNoEndDateSection).forEach((section) => section.remove());
  } else if (tab === TAB_VALUE) {
    sections.filter((section) => !isNoEndDateSection(section)).forEach((section) => section.remove());
  }

  const visible = [...body.querySelectorAll(':scope > .ds-fin-collect-month')];
  const sorted = [...visible].sort((a, b) => financeCollectionMonthSortKey(a).localeCompare(financeCollectionMonthSortKey(b)));
  const currentOrder = visible.map(financeCollectionMonthSortKey).join('|');
  const sortedOrder = sorted.map(financeCollectionMonthSortKey).join('|');
  if (currentOrder !== sortedOrder) sorted.forEach((section) => body.append(section));

  addFilteredEmptyState(body, tab);
}

function polishFinanceCollection(root = document) {
  ensureNoEndDateTab(root);
  root.querySelectorAll?.('.ds-fin-collect-shell').forEach(filterAndSortMonthSections);
}

function schedulePolish() {
  queueMicrotask(() => polishFinanceCollection(document));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedulePolish, { once: true });
  } else {
    schedulePolish();
  }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(schedulePolish);
    observer.observe(document.getElementById('app') || document.documentElement, { childList: true, subtree: true });
  }
}

export {
  ensureNoEndDateTab,
  financeCollectionMonthSortKey,
  polishFinanceCollection
};
