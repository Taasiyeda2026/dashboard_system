const MOBILE_ENHANCED = 'mobileEnhanced';

function valueText(element, fallback = '—') {
  const value = String(element?.textContent || '').replace(/\s+/g, ' ').trim();
  return value || fallback;
}

function setMobileLabel(element, label) {
  if (element) element.dataset.mobileLabel = label;
}

function mobileToneForActivityType(value) {
  const type = String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
  if (type.includes('קורס')) return 'course';
  if (type.includes('סדנה')) return 'workshop';
  if (type.includes('זום') || type.includes('מקוון')) return 'online';
  if (type.includes('תפעול') || type.includes('אירוע') || type.includes('כנס') || type.includes('מטה')) return 'operations';
  return 'default';
}

function createSummary(row) {
  const dateCell = row.querySelector('.av2-rr__date');
  const startCell = row.querySelector('.av2-rr__start');
  const endCell = row.querySelector('.av2-rr__end');
  const typeCell = row.querySelector('.av2-rr__type');
  const nameCell = row.querySelector('.av2-rr__name');
  const schoolCell = row.querySelector('.av2-rr__school');
  const hoursCell = row.querySelector('.av2-rr__hours');

  if (!dateCell || !typeCell || !nameCell || !hoursCell) return null;
  row.dataset.tone = mobileToneForActivityType(valueText(typeCell, ''));

  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'av2-rr-mobile__summary';
  summary.setAttribute('aria-expanded', 'false');
  summary.setAttribute('aria-label', `פתיחת פרטי דיווח ${valueText(dateCell, '')}`.trim());

  const main = document.createElement('span');
  main.className = 'av2-rr-mobile__main';

  const name = document.createElement('strong');
  name.className = 'av2-rr-mobile__name';
  name.textContent = valueText(nameCell);

  const meta = document.createElement('span');
  meta.className = 'av2-rr-mobile__meta';

  const date = document.createElement('span');
  date.className = 'av2-rr-mobile__date';
  date.textContent = valueText(dateCell.querySelector('strong') || dateCell);

  const range = document.createElement('span');
  range.className = 'av2-rr-mobile__range';
  const start = valueText(startCell, '');
  const end = valueText(endCell, '');
  range.textContent = start && end ? `${start}–${end}` : (start || end || '—');

  const school = document.createElement('span');
  school.className = 'av2-rr-mobile__school';
  school.textContent = valueText(schoolCell);

  meta.append(date, range, school);
  main.append(name, meta);

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

  summary.append(main, hours, chevron);
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
  const dayTotalCell = row.querySelector('.av2-rr__day-total');
  const typeCell = row.querySelector('.av2-rr__type');
  const nameCell = row.querySelector('.av2-rr__name');
  const meetingCell = row.querySelector('.av2-rr__meeting');
  const schoolCell = row.querySelector('.av2-rr__school');
  const authorityCell = row.querySelector('.av2-rr__authority');
  const kmCell = row.querySelector('.av2-rr__km');
  const expensesCell = row.querySelector('.av2-rr__expenses');
  const actionsCell = row.querySelector('.av2-rr__actions');

  setMobileLabel(startCell, 'שעת התחלה');
  setMobileLabel(endCell, 'שעת סיום');
  setMobileLabel(dayTotalCell, 'סה״כ יומי');
  setMobileLabel(typeCell, 'סוג פעילות');
  setMobileLabel(nameCell, 'שם הפעילות');
  setMobileLabel(meetingCell, 'מפגש');
  setMobileLabel(schoolCell, 'מיקום / בית ספר');
  setMobileLabel(authorityCell, 'רשות');
  setMobileLabel(kmCell, 'ק״מ');
  setMobileLabel(expensesCell, 'הוצאות');
  setMobileLabel(actionsCell, 'פעולות');

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
