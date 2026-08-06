const SCHOOL_2027_FROM = '2026-09-01';
const SCHOOL_2027_TO = '2027-08-31';
let timer = null;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeDateInputs(root) {
  const period = root.querySelector('[data-ops-period]');
  const from = root.querySelector('[data-ops-date="from"]');
  const to = root.querySelector('[data-ops-date="to"]');
  if (!period || !from || !to || text(period.value) !== 'school_2027') return;

  [from, to].forEach((input) => {
    input.removeAttribute('min');
    input.removeAttribute('max');
    input.removeAttribute('readonly');
    input.disabled = false;
  });

  const fromValue = text(from.value);
  const toValue = text(to.value);
  const staleSummerRange = (fromValue && fromValue < SCHOOL_2027_FROM) || (toValue && toValue < SCHOOL_2027_FROM);
  const outside2027 = (fromValue && fromValue > SCHOOL_2027_TO) || (toValue && toValue > SCHOOL_2027_TO);
  if (staleSummerRange || outside2027) {
    from.value = SCHOOL_2027_FROM;
    to.value = SCHOOL_2027_TO;
    from.dispatchEvent(new Event('change', { bubbles: true }));
    to.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const root = document.querySelector('#app .ds-ops-mgmt-screen');
    if (root) normalizeDateInputs(root);
  }, 30);
}

if (typeof document !== 'undefined') {
  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-ops-period]')) schedule();
  }, true);
  const app = document.getElementById('app');
  if (app && typeof MutationObserver === 'function') {
    new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
  }
  schedule();
}
