const PAYROLL_WINDOW_NAME = 'dashboard-payroll-control';
const PAYROLL_FIX_MARK = '__dashboardPayrollWindowFixInstalled';
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

export function shouldHidePayrollTeamOption(label = '', value = '') {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  const rawValue = String(value || '').replace(/\s+/g, ' ').trim();
  return text === 'הכל' || rawValue === 'הכל';
}

export function payrollTeamDisplayLabel(label = '') {
  const text = String(label || '').replace(/\s+/g, ' ').trim();
  if (/^לינוי(?:\s+שמואל(?:\s+מזרחי)?)?$/u.test(text)) return 'הילה';
  return text;
}

export function payrollMonthPickerYears(now = new Date(), currentValue = '') {
  const currentYear = Number(now?.getFullYear?.()) || new Date().getFullYear();
  const selectedYear = Number(String(currentValue || '').slice(0, 4));
  const years = new Set();
  for (let year = currentYear - 2; year <= currentYear + 3; year += 1) years.add(year);
  if (Number.isFinite(selectedYear) && selectedYear >= 2000 && selectedYear <= 2200) years.add(selectedYear);
  return [...years].sort((a, b) => a - b);
}

function ensurePayrollStyles(doc) {
  if (!doc?.head || doc.getElementById('payroll-control-window-fix-styles')) return;
  const style = doc.createElement('style');
  style.id = 'payroll-control-window-fix-styles';
  style.textContent = `
    html{background:#eef3f8}
    body{margin:0!important;padding:28px!important;background:#eef3f8!important;color:#172033}
    [data-payroll-window]{width:min(1120px,100%);margin:0 auto}
    [data-payroll-window] .attendance-control{
      box-sizing:border-box;
      margin:0!important;
      padding:24px 26px!important;
      border:1px solid #d6dfeb!important;
      border-radius:18px!important;
      background:#fff!important;
      box-shadow:0 14px 38px rgba(15,23,42,.08)!important;
    }
    [data-payroll-window] .attendance-control__head{
      display:flex!important;
      align-items:center!important;
      justify-content:space-between!important;
      gap:16px!important;
      margin-bottom:18px!important;
    }
    [data-payroll-window] .attendance-control__head h2{
      margin:0!important;
      font-size:28px!important;
      line-height:1.2!important;
      font-weight:800!important;
    }
    [data-payroll-window] .attendance-control__head [data-attendance-close]{
      min-height:42px!important;
      padding:9px 18px!important;
      border-color:#b9c7d9!important;
      background:#fff!important;
      color:#172033!important;
      font-weight:700!important;
    }
    [data-payroll-window] .attendance-control__uploads{
      display:grid!important;
      grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(220px,1.15fr) auto!important;
      align-items:end!important;
      gap:14px!important;
      margin:0!important;
      padding:18px!important;
      border:1px solid #edf1f6!important;
      border-radius:14px!important;
      background:#f7f9fc!important;
    }
    [data-payroll-window] .attendance-control__uploads label{
      display:grid!important;
      grid-template-columns:minmax(0,1fr)!important;
      gap:8px!important;
      min-width:0!important;
      margin:0!important;
      flex:none!important;
    }
    [data-payroll-window] .attendance-control__uploads label>strong{
      font-size:16px!important;
      font-weight:800!important;
      color:#111827!important;
    }
    [data-payroll-window] .attendance-control__uploads label>span{
      display:none!important;
    }
    [data-payroll-window] .attendance-control__uploads .ds-input,
    [data-payroll-window] .payroll-month-picker select{
      box-sizing:border-box!important;
      width:100%!important;
      min-width:0!important;
      min-height:44px!important;
      padding:9px 12px!important;
      border:1px solid #cbd5e1!important;
      border-radius:10px!important;
      background:#fff!important;
      color:#172033!important;
      font-size:16px!important;
      line-height:1.2!important;
      outline:none!important;
    }
    [data-payroll-window] .attendance-control__uploads .ds-input:focus,
    [data-payroll-window] .payroll-month-picker select:focus{
      border-color:#7aa7e8!important;
      box-shadow:0 0 0 3px rgba(59,130,246,.12)!important;
    }
    [data-payroll-window] .attendance-control__uploads [data-attendance-run]{
      min-height:44px!important;
      padding:10px 18px!important;
      border-radius:10px!important;
      white-space:nowrap!important;
      font-weight:800!important;
      align-self:end!important;
    }
    [data-payroll-window] .payroll-month-native{
      position:absolute!important;
      width:1px!important;
      height:1px!important;
      opacity:0!important;
      pointer-events:none!important;
      overflow:hidden!important;
    }
    [data-payroll-window] .payroll-month-picker{
      display:grid!important;
      grid-template-columns:minmax(0,1fr) 96px!important;
      gap:8px!important;
      direction:rtl!important;
    }
    [data-payroll-window] .payroll-month-picker select{
      appearance:auto!important;
    }
    [data-payroll-window] .attendance-control__status{
      margin:12px 2px 0!important;
    }
    [data-payroll-window] [data-attendance-results]{
      margin-top:14px!important;
    }
    @media(max-width:900px){
      body{padding:18px!important}
      [data-payroll-window]{width:100%}
      [data-payroll-window] .attendance-control{padding:20px!important}
      [data-payroll-window] .attendance-control__uploads{
        grid-template-columns:1fr 1fr!important;
      }
      [data-payroll-window] .attendance-control__uploads [data-attendance-run]{
        grid-column:1/-1!important;
        width:100%!important;
      }
    }
    @media(max-width:620px){
      body{padding:10px!important}
      [data-payroll-window] .attendance-control{padding:16px!important;border-radius:14px!important}
      [data-payroll-window] .attendance-control__head h2{font-size:23px!important}
      [data-payroll-window] .attendance-control__uploads{grid-template-columns:1fr!important;padding:14px!important}
      [data-payroll-window] .attendance-control__uploads [data-attendance-run]{grid-column:auto!important}
    }
  `;
  doc.head.appendChild(style);
}

function enhanceMonthInput(input) {
  if (!input || input.dataset.payrollMonthEnhanced === 'true') return;
  input.dataset.payrollMonthEnhanced = 'true';
  input.classList.add('payroll-month-native');

  const doc = input.ownerDocument;
  const wrapper = doc.createElement('div');
  wrapper.className = 'payroll-month-picker';

  const monthSelect = doc.createElement('select');
  monthSelect.className = 'payroll-month-select';
  monthSelect.setAttribute('aria-label', 'חודש');
  monthSelect.innerHTML = '<option value="">חודש</option>'
    + HEBREW_MONTHS.map((month, index) => `<option value="${String(index + 1).padStart(2, '0')}">${month}</option>`).join('');

  const yearSelect = doc.createElement('select');
  yearSelect.className = 'payroll-year-select';
  yearSelect.setAttribute('aria-label', 'שנה');
  yearSelect.innerHTML = payrollMonthPickerYears(new Date(), input.value)
    .map((year) => `<option value="${year}">${year}</option>`).join('');

  const syncFromNative = () => {
    const match = String(input.value || '').match(/^(\d{4})-(\d{2})$/);
    if (match) {
      const [, year, month] = match;
      if (![...yearSelect.options].some((option) => option.value === year)) {
        const option = doc.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
      }
      yearSelect.value = year;
      monthSelect.value = month;
    } else if (!yearSelect.value) {
      yearSelect.value = String(new Date().getFullYear());
    }
  };

  const syncToNative = () => {
    if (!monthSelect.value || !yearSelect.value) {
      input.value = '';
    } else {
      input.value = `${yearSelect.value}-${monthSelect.value}`;
    }
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  monthSelect.addEventListener('change', syncToNative);
  yearSelect.addEventListener('change', () => {
    if (monthSelect.value) syncToNative();
  });
  input.addEventListener('change', syncFromNative);

  wrapper.append(monthSelect, yearSelect);
  input.insertAdjacentElement('afterend', wrapper);
  syncFromNative();
}

function normalizeTeamSelect(select) {
  if (!select) return;
  for (const option of [...select.options]) {
    if (shouldHidePayrollTeamOption(option.textContent, option.value)) {
      option.remove();
      continue;
    }
    const display = payrollTeamDisplayLabel(option.textContent);
    if (display && display !== String(option.textContent || '').trim()) option.textContent = display;
  }
}

function watchTeamSelect(select) {
  if (!select || select.dataset.payrollTeamEnhanced === 'true') return;
  select.dataset.payrollTeamEnhanced = 'true';
  normalizeTeamSelect(select);
  new MutationObserver(() => normalizeTeamSelect(select)).observe(select, { childList: true, subtree: true, characterData: true });
}

function enhancePayrollDocument(doc) {
  if (!doc?.querySelector) return false;
  const root = doc.querySelector('[data-payroll-window]');
  const panel = doc.querySelector('[data-attendance-control]');
  if (!root || !panel) return false;

  ensurePayrollStyles(doc);
  doc.documentElement.dir = 'rtl';
  doc.body.dir = 'rtl';

  enhanceMonthInput(panel.querySelector('[data-attendance-month]'));
  enhanceMonthInput(panel.querySelector('[data-dashboard-month]'));
  watchTeamSelect(panel.querySelector('[data-attendance-team]'));
  return true;
}

function observePayrollPopup(popup) {
  if (!popup || popup.closed) return;
  const doc = popup.document;
  if (enhancePayrollDocument(doc)) return;

  const observer = new MutationObserver(() => {
    if (enhancePayrollDocument(doc)) observer.disconnect();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
}

export function installPayrollControlWindowFix(targetWindow = typeof window !== 'undefined' ? window : null) {
  if (!targetWindow || targetWindow[PAYROLL_FIX_MARK]) return false;
  targetWindow[PAYROLL_FIX_MARK] = true;

  const originalOpen = targetWindow.open?.bind(targetWindow);
  if (typeof originalOpen !== 'function') return false;

  targetWindow.open = function patchedOpen(url, name, features) {
    const popup = originalOpen(url, name, features);
    if (name === PAYROLL_WINDOW_NAME && popup) {
      try {
        observePayrollPopup(popup);
      } catch (error) {
        console.warn('[payroll-control-window-fix] unable to enhance payroll popup', error);
      }
    }
    return popup;
  };
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPayrollControlWindowFix(window);
}
