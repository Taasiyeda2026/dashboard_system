const OPEN_RECORD_KEY = 'av2_open_record_id';

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function syncOperationOtherField() {
  const select = document.querySelector('#av2-operation-choice');
  const input = document.querySelector('#av2-operation-desc');
  const wrap = input?.closest('.av2-field');
  if (!select || !wrap) return;
  const selectedLabel = text(select.selectedOptions?.[0]?.textContent);
  const show = selectedLabel === 'אחר';
  wrap.hidden = !show;
  wrap.style.display = show ? '' : 'none';
  wrap.setAttribute('aria-hidden', show ? 'false' : 'true');
  if (input) input.required = show;
}

function ensureSidebarDashboardButton() {
  const footer = document.querySelector('.av2-bottom-nav__footer');
  if (!footer || footer.querySelector('[data-av2-dashboard]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'av2-bottom-nav__dashboard';
  button.dataset.av2Dashboard = 'true';
  button.setAttribute('aria-label', 'דשבורד');
  button.innerHTML = '<span class="av2-bottom-nav__dashboard-icon" aria-hidden="true">⌂</span><span>דשבורד</span>';
  button.addEventListener('click', () => window.location.assign('/dashboard_system/'));
  footer.prepend(button);
}

function findNavButton(label) {
  return [...document.querySelectorAll('.av2-bottom-nav__item')]
    .find((button) => text(button.textContent) === label) || null;
}

function openSpecificReportWhenReady() {
  let recordId = '';
  try { recordId = text(sessionStorage.getItem(OPEN_RECORD_KEY)); } catch {}
  if (!recordId) return;

  const row = document.querySelector(`.av2-report-row[data-record-id="${CSS.escape(recordId)}"]`);
  if (!row) return;

  try { sessionStorage.removeItem(OPEN_RECORD_KEY); } catch {}
  row.classList.add('is-targeted-from-home');
  row.scrollIntoView({ block: 'center', behavior: 'smooth' });

  const editButton = row.querySelector('button[aria-label="עריכה"]');
  if (editButton && !editButton.disabled) {
    window.setTimeout(() => editButton.click(), 80);
  }
}

function handleHomeReportClick(event) {
  const row = event.target instanceof Element
    ? event.target.closest('.av2-home .av2-report-summary-row[data-record-id]')
    : null;
  if (!row) return;
  const recordId = text(row.dataset.recordId);
  if (!recordId) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  try { sessionStorage.setItem(OPEN_RECORD_KEY, recordId); } catch {}
  findNavButton('הדיווחים שלי')?.click();
}

function sync() {
  syncOperationOtherField();
  ensureSidebarDashboardButton();
  openSpecificReportWhenReady();
}

if (typeof document !== 'undefined') {
  document.addEventListener('change', (event) => {
    if (event.target instanceof Element && event.target.matches('#av2-operation-choice')) {
      syncOperationOtherField();
    }
  });
  document.addEventListener('click', handleHomeReportClick, true);

  const observer = new MutationObserver(() => sync());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  sync();
}
