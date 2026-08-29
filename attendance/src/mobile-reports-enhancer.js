const MOBILE_ENHANCED = 'mobileEnhanced';

function valueText(element, fallback = '—') {
  const value = String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function setMobileLabel(element, label) {
  if (element) element.dataset.mobileLabel = label;
}

function createSummary(row) {
  const dateCell = row.querySelector('.av2-rr__date');
  const typeCell = row.querySelector('.av2-rr__type');
  const nameCell = row.querySelector('.av2-rr__name');
  const hoursCell = row.querySelector('.av2-rr__hours');

  if (!dateCell || !typeCell || !nameCell || !hoursCell) return null;

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'av2-rr-mobile__summary';
  summary.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-label', `פתיחת פרטי דיווח ${valueText(dateCell, '')}`.trim());

  const date = document.createElement('span');
  date.className = 'av2-rr-mobile__date';
  const dateMain = document.createElement('strong');
  dateMain.textContent = valueText(dateCell.querySelector('strong'));
  const dateDay = document.createElement('small');
  dateDay.textContent = valueText(dateCell.querySelector('span'), '');
  date.append(dateMain, dateDay);

  const activity = document.createElement('span');
  activity.className = 'av2-rr-mobile__activity';
  const type = document.createElement('small');
  type.textContent = valueText(typeCell);
  const name = document.createElement('strong');
  name.textContent = valueText(nameCell);
  activity.append(type, name);

  const hours = document.createElement('span');
  hours.className = 'av2-rr-mobile__hours';
  const hoursValue = document.createElement('strong');
  hoursValue.textContent = valueText(hoursCell, '0.00');
  const hoursLabel = document.createElement('small');
  hoursLabel.textContent = 'שעות';
  hours.append(hoursValue, hoursLabel);

  const chevron = document.createElement('span');
  chevron.className = 'av2-rr-mobile__chevron';
  chevron.setAttribute('aria-hidden', 'true');

  summary.append(date, activity, hours, chevron);
  summary.addEventListener('click', (event) => {
    event.stopPropagation();
    const expanded = !row.classList.contains('is-mobile-expanded');
    row.classList.toggle('is-mobile-expanded', expanded);
    summary.setAttribute('aria-expanded', String(expanded));
    summary.setAttribute('aria-label', `${expanded ? 'סגירת' : 'פתיחת'} פרטי דיווח ${valueText(dateCell, '')}`.trim());
  });

  return summary;
}

function enhanceRow(row) {
  if (!(row instanceof HTMLElement) || row.dataset[MOBILE_ENHANCED] === '1') return;

  const summary = createSummary(row);
  if (!summary) return;

  const startCell = row.querySelector('.av2-rr__start');
  const endCell = row.querySelector('.av2-rr__end');
  const nameCell = row.querySelector('.av2-rr__name');
  const schoolCell = row.querySelector('.av2-rr__school');
  const authorityCell = row.querySelector('.av2-rr__authority');
  const kmCell = row.querySelector('.av2-rr__km');
  const expensesCell = row.querySelector('.av2-rr__expenses');
  const actionsCell = row.querySelector('.av2-rr__actions');
  const notesCell = row.querySelector('.av2-rr__notes-row');

  setMobileLabel(startCell, 'שעת התחלה');
  setMobileLabel(endCell, 'שעת סיום');
  setMobileLabel(nameCell, 'שם הפעילות');
  setMobileLabel(schoolCell, 'בית ספר');
  setMobileLabel(authorityCell, 'רשות');
  setMobileLabel(kmCell, 'ק״מ');
  setMobileLabel(expensesCell, 'הוצאות');
  setMobileLabel(actionsCell, 'פעולות');
  setMobileLabel(notesCell, 'הערות');

  if (expensesCell) {
    const indicator = expensesCell.querySelector('.av2-rr__expense-indicator');
    const label = String(indicator?.getAttribute('aria-label') || '').replace(/^הוצאות:\s*/, '').trim();
    expensesCell.dataset.mobileValue = label || '—';
  }

  row.prepend(summary);
  row.dataset[MOBILE_ENHANCED] = '1';
}

function enhanceAll(root = document) {
  root.querySelectorAll?.('.av2-report-row').forEach(enhanceRow);
}

function boot() {
  enhanceAll();
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.matches('.av2-report-row')) enhanceRow(node);
        enhanceAll(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
