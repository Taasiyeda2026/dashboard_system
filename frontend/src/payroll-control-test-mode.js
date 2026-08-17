const PAYROLL_WINDOW_NAME = 'dashboard-payroll-control';
const TEST_MODE_MARK = '__dashboardPayrollTestModeInstalled';
export const PAYROLL_TEST_MONTH = '2027-01';

const baseAttendance = (overrides = {}) => ({
  employeeId: '9901',
  employeeName: 'מדריך בדיקה א',
  employmentType: 'תעשיידע',
  team: '__test__',
  date: '2027-01-03',
  startTime: '09:00',
  endTime: '10:00',
  workHours: 1,
  activityType: 'קורס',
  school: 'בית ספר בדיקה א',
  authority: 'רשות בדיקה',
  program: 'T01 – 45 דקות תקין',
  meetingNo: '1',
  kilometers: 12,
  expenses: 0,
  expenseDetails: '',
  notes: '',
  ...overrides
});

const baseDashboard = (overrides = {}) => ({
  employeeId: '9901',
  employeeName: 'מדריך בדיקה א',
  employmentType: 'תעשיידע',
  date: '2027-01-03',
  startTime: '09:00',
  endTime: '09:45',
  workHours: 1,
  payrollHoursRequireReview: false,
  meetingCount: 1,
  activityType: 'קורס',
  school: 'בית ספר בדיקה א',
  authority: 'רשות בדיקה',
  program: 'T01 – 45 דקות תקין',
  meetingNo: '1',
  kilometers: 12,
  expenses: 0,
  schoolId: 99001,
  activityId: 'test-01',
  ...overrides
});

export function buildPayrollControlTestDataset() {
  const attendanceRows = [];
  const dashboardRows = [];

  // T01: standard 45-minute school lesson => 1 payroll hour, matching km.
  attendanceRows.push(baseAttendance());
  dashboardRows.push(baseDashboard());

  // T02: standard 90-minute school lesson => 2 payroll hours, matching km.
  attendanceRows.push(baseAttendance({
    employeeId: '9902', employeeName: 'מדריך בדיקה ב', date: '2027-01-04',
    startTime: '10:00', endTime: '12:00', workHours: 2, kilometers: 18,
    program: 'T02 – 90 דקות תקין', school: 'בית ספר בדיקה ב', meetingNo: '2'
  }));
  dashboardRows.push(baseDashboard({
    employeeId: '9902', employeeName: 'מדריך בדיקה ב', date: '2027-01-04',
    startTime: '10:00', endTime: '11:30', workHours: 2, kilometers: 18,
    program: 'T02 – 90 דקות תקין', school: 'בית ספר בדיקה ב', meetingNo: '2',
    schoolId: 99002, activityId: 'test-02'
  }));

  // T03: start-time difference outside the allowed grace window.
  attendanceRows.push(baseAttendance({
    date: '2027-01-05', startTime: '08:30', endTime: '09:30',
    program: 'T03 – שעת התחלה שונה', kilometers: 14
  }));
  dashboardRows.push(baseDashboard({
    date: '2027-01-05', startTime: '09:00', endTime: '09:45',
    program: 'T03 – שעת התחלה שונה', kilometers: 14, activityId: 'test-03'
  }));

  // T04: end-time difference that should require review.
  attendanceRows.push(baseAttendance({
    date: '2027-01-06', startTime: '09:00', endTime: '10:30', workHours: 1,
    program: 'T04 – שעת סיום שונה', kilometers: 11
  }));
  dashboardRows.push(baseDashboard({
    date: '2027-01-06', startTime: '09:00', endTime: '09:45', workHours: 1,
    program: 'T04 – שעת סיום שונה', kilometers: 11, activityId: 'test-04'
  }));

  // T05: daily kilometers differ. This deliberately exercises the payroll km rule.
  attendanceRows.push(baseAttendance({
    date: '2027-01-07', program: 'T05 – פער ק״מ', kilometers: 30
  }));
  dashboardRows.push(baseDashboard({
    date: '2027-01-07', program: 'T05 – פער ק״מ', kilometers: 20, activityId: 'test-05'
  }));

  // T06: dashboard route cannot be calculated.
  attendanceRows.push(baseAttendance({
    date: '2027-01-08', program: 'T06 – ק״מ לא ניתן לחישוב', kilometers: 10
  }));
  dashboardRows.push(baseDashboard({
    date: '2027-01-08', program: 'T06 – ק״מ לא ניתן לחישוב', kilometers: null, activityId: 'test-06'
  }));

  // T07: expense value differs.
  attendanceRows.push(baseAttendance({
    date: '2027-01-09', program: 'T07 – פער הוצאות', kilometers: 9, expenses: 50
  }));
  dashboardRows.push(baseDashboard({
    date: '2027-01-09', program: 'T07 – פער הוצאות', kilometers: 9, expenses: 20, activityId: 'test-07'
  }));

  // T08: attendance report without a corresponding dashboard activity.
  attendanceRows.push(baseAttendance({
    employeeId: '9903', employeeName: 'מדריך בדיקה ג', date: '2027-01-10',
    program: 'T08 – נוכחות ללא פעילות בדשבורד', school: 'בית ספר בדיקה ג', kilometers: 7
  }));

  // T09: dashboard activity without attendance.
  dashboardRows.push(baseDashboard({
    employeeId: '9904', employeeName: 'מדריך בדיקה ד', date: '2027-01-11',
    program: 'T09 – פעילות בדשבורד ללא נוכחות', school: 'בית ספר בדיקה ד',
    kilometers: 8, schoolId: 99004, activityId: 'test-09'
  }));

  // T10: attendance-only activity; should stay in the workday timeline without activity matching.
  attendanceRows.push(baseAttendance({
    employeeId: '9902', employeeName: 'מדריך בדיקה ב', date: '2027-01-12',
    startTime: '14:00', endTime: '16:00', workHours: 2, activityType: 'הכשרה',
    school: '', authority: '', program: 'T10 – הכשרה', meetingNo: '', kilometers: 0
  }));

  // T11: two schools on the same day; daily reported/calculated km totals both equal 40.
  attendanceRows.push(baseAttendance({
    employeeId: '9905', employeeName: 'מדריך בדיקה ה', date: '2027-01-13',
    startTime: '08:00', endTime: '09:00', program: 'T11A – מסלול יומי',
    school: 'בית ספר בדיקה ה1', kilometers: 15
  }));
  attendanceRows.push(baseAttendance({
    employeeId: '9905', employeeName: 'מדריך בדיקה ה', date: '2027-01-13',
    startTime: '11:00', endTime: '12:00', program: 'T11B – מסלול יומי',
    school: 'בית ספר בדיקה ה2', kilometers: 25, meetingNo: '2'
  }));
  dashboardRows.push(baseDashboard({
    employeeId: '9905', employeeName: 'מדריך בדיקה ה', date: '2027-01-13',
    startTime: '08:00', endTime: '08:45', program: 'T11A – מסלול יומי',
    school: 'בית ספר בדיקה ה1', kilometers: 15, schoolId: 99005, activityId: 'test-11a'
  }));
  dashboardRows.push(baseDashboard({
    employeeId: '9905', employeeName: 'מדריך בדיקה ה', date: '2027-01-13',
    startTime: '11:00', endTime: '11:45', program: 'T11B – מסלול יומי',
    school: 'בית ספר בדיקה ה2', kilometers: 25, meetingNo: '2', schoolId: 99006, activityId: 'test-11b'
  }));

  // T12: non-standard dashboard duration; payroll hours must remain explicitly reviewable.
  attendanceRows.push(baseAttendance({
    employeeId: '9903', employeeName: 'מדריך בדיקה ג', date: '2027-01-14',
    startTime: '13:00', endTime: '14:00', workHours: 1,
    program: 'T12 – שעות שכר לבדיקה', school: 'בית ספר בדיקה ג', kilometers: 6
  }));
  dashboardRows.push(baseDashboard({
    employeeId: '9903', employeeName: 'מדריך בדיקה ג', date: '2027-01-14',
    startTime: '13:00', endTime: '14:00', workHours: null,
    payrollHoursRequireReview: true,
    program: 'T12 – שעות שכר לבדיקה', school: 'בית ספר בדיקה ג',
    kilometers: 6, schoolId: 99003, activityId: 'test-12'
  }));

  return { attendanceRows, dashboardRows };
}

function ensureTestModeStyles(doc) {
  if (!doc?.head || doc.getElementById('payroll-control-test-mode-styles')) return;
  const style = doc.createElement('style');
  style.id = 'payroll-control-test-mode-styles';
  style.textContent = `
    [data-payroll-window] .payroll-control__actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    [data-payroll-window] .payroll-test-mode-button{border-color:#7aa7e8!important;color:#1d4ed8!important;background:#eff6ff!important;font-weight:800!important}
    [data-payroll-window] .payroll-test-mode-banner{margin:0 0 12px;padding:12px 14px;border:1px solid #93c5fd;border-radius:10px;background:#eff6ff;color:#1e3a8a;font-weight:700;line-height:1.5}
    [data-payroll-window] .payroll-test-mode-banner small{display:block;margin-top:4px;color:#475569;font-weight:600}
  `;
  doc.head.appendChild(style);
}

function installResultCapture(panel, moduleApi) {
  const results = panel.querySelector('[data-attendance-results]');
  if (!results || results.dataset.payrollTestCapture === 'true') return;
  results.dataset.payrollTestCapture = 'true';

  results.addEventListener('change', (event) => {
    const result = panel.__payrollTestResult;
    if (!result) return;

    const dashboardOnlyElement = event.target.closest?.('[data-dashboard-only]');
    if (dashboardOnlyElement && event.target.matches?.('[data-dashboard-only-choice]')) {
      event.stopImmediatePropagation();
      const entry = result.dashboardOnly.find((item) => item.id === dashboardOnlyElement.dataset.dashboardOnly);
      moduleApi.setDashboardOnlyChoice(entry, event.target.value === 'add');
      return;
    }

    const diff = event.target.closest?.('[data-comparison]');
    if (!diff) return;
    event.stopImmediatePropagation();
    const comparison = result.comparisons.find((row) => row.id === diff.dataset.comparison);
    const field = diff.dataset.field;
    if (!comparison) return;
    if (event.target.matches?.('[data-attendance-choice]')) {
      const custom = diff.querySelector('[data-attendance-custom]');
      custom.hidden = event.target.value !== 'custom';
      moduleApi.applyAttendanceChoice(comparison, field, event.target.value, custom.value);
    }
    if (event.target.matches?.('[data-attendance-custom]')) {
      moduleApi.applyAttendanceChoice(comparison, field, 'custom', event.target.value);
    }
  }, true);
}

async function activateTestMode(doc) {
  const panel = doc.querySelector('[data-attendance-control]');
  if (!panel) return;
  const button = panel.querySelector('[data-payroll-test-mode]');
  const title = panel.querySelector('[data-attendance-title]');
  const status = panel.querySelector('[data-attendance-status]');
  const results = panel.querySelector('[data-attendance-results]');
  if (!results) return;

  button.disabled = true;
  status.textContent = 'טוען נתוני בדיקה של תשפ״ז…';
  try {
    const moduleApi = await import('./screens/attendance-control.js?v=20260817-test-mode-v1');
    const { attendanceRows, dashboardRows } = buildPayrollControlTestDataset();
    const result = moduleApi.compareAttendanceRows(attendanceRows, dashboardRows);
    result.month = PAYROLL_TEST_MONTH;
    panel.__payrollTestResult = result;
    panel.__payrollTestModuleApi = moduleApi;
    panel.dataset.payrollTestMode = 'true';
    installResultCapture(panel, moduleApi);

    title.textContent = 'בקרת שכר – מצב בדיקה תשפ״ז';
    status.textContent = '';
    results.innerHTML = `<div class="payroll-test-mode-banner">מצב בדיקה תשפ״ז — נתונים פיקטיביים בלבד. אין קריאה או כתיבה ל-Supabase או למערכת הנוכחות.<small>התרחישים T01–T12 כוללים תקין 45/90 דקות, פערי שעות, ק״מ תקין/שונה/חסר, הוצאות, דיווח ללא פעילות, פעילות ללא דיווח, הכשרה, יום עם שני בתי ספר ושעות שכר לא סטנדרטיות. לחזרה לנתוני אמת יש לבצע בקרת שכר רגילה.</small></div>${moduleApi.resultsHtml(result, PAYROLL_TEST_MONTH)}`;
    results.querySelector('[data-attendance-export]')?.remove();
  } catch (error) {
    console.error('[payroll-control-test-mode] failed', error);
    status.textContent = 'טעינת מצב הבדיקה נכשלה.';
  } finally {
    button.disabled = false;
  }
}

function enhancePayrollTestDocument(doc) {
  if (!doc?.querySelector) return false;
  const panel = doc.querySelector('[data-attendance-control]');
  if (!panel) return false;
  if (panel.querySelector('[data-payroll-test-mode]')) return true;

  ensureTestModeStyles(doc);
  const head = panel.querySelector('.attendance-control__head');
  const close = panel.querySelector('[data-attendance-close]');
  if (!head || !close) return false;

  let actions = head.querySelector('.payroll-control__actions');
  if (!actions) {
    actions = doc.createElement('div');
    actions.className = 'payroll-control__actions';
    close.insertAdjacentElement('beforebegin', actions);
    actions.appendChild(close);
  }

  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'ds-btn ds-btn--sm payroll-test-mode-button';
  button.dataset.payrollTestMode = 'true';
  button.textContent = 'מצב בדיקה תשפ״ז';
  button.addEventListener('click', () => activateTestMode(doc));
  actions.insertBefore(button, close);

  const run = panel.querySelector('[data-attendance-run]');
  run?.addEventListener('click', () => {
    if (!panel.__payrollTestResult) return;
    panel.__payrollTestResult = null;
    panel.__payrollTestModuleApi = null;
    delete panel.dataset.payrollTestMode;
    panel.querySelector('[data-attendance-results]').innerHTML = '';
  }, true);
  return true;
}

function observePayrollPopup(popup) {
  if (!popup || popup.closed) return;
  const doc = popup.document;
  if (enhancePayrollTestDocument(doc)) return;
  const MutationObserverCtor = doc.defaultView?.MutationObserver || MutationObserver;
  const observer = new MutationObserverCtor(() => {
    if (enhancePayrollTestDocument(doc)) observer.disconnect();
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });
}

export function installPayrollControlTestMode(targetWindow = typeof window !== 'undefined' ? window : null) {
  if (!targetWindow || targetWindow[TEST_MODE_MARK]) return false;
  targetWindow[TEST_MODE_MARK] = true;
  const originalOpen = targetWindow.open?.bind(targetWindow);
  if (typeof originalOpen !== 'function') return false;

  targetWindow.open = function patchedPayrollTestOpen(url, name, features) {
    const popup = originalOpen(url, name, features);
    if (name === PAYROLL_WINDOW_NAME && popup) {
      try {
        observePayrollPopup(popup);
      } catch (error) {
        console.warn('[payroll-control-test-mode] unable to enhance payroll popup', error);
      }
    }
    return popup;
  };
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  installPayrollControlTestMode(window);
}
