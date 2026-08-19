const PAYROLL_WINDOW_NAME = 'dashboard-payroll-control';
const TEST_MODE_MARK = '__dashboardPayrollTestModeInstalled';
export const PAYROLL_TEST_MONTH = '2027-01';

const attendanceRecord = (overrides = {}) => ({
  employeeId: '9901',
  employeeName: 'מדריך בדיקה א',
  employmentType: 'תעשיידע',
  team: '__test__',
  attendanceDate: '2027-01-03',
  startTime: '09:00',
  endTime: '10:00',
  workHours: 1,
  activityType: 'קורס',
  schoolName: 'בית ספר בדיקה א',
  municipality: 'רשות בדיקה',
  programName: 'T01 – קורס 45 דקות',
  sessionNumber: '1',
  kilometers: 20,
  totalExpenses: 0,
  expensesDetails: '',
  notes: '',
  ...overrides
});

const dashboardActivity = (overrides = {}) => ({
  row_id: 'test-01',
  emp_id: '9901',
  instructor_name: 'מדריך בדיקה א',
  activity_type: 'course',
  item_type: 'course',
  authority: 'רשות בדיקה',
  school: 'בית ספר בדיקה א',
  school_id: 99001,
  activity_name: 'T01 – קורס 45 דקות',
  meetings: [{ date: '2027-01-03', start_time: '09:00', end_time: '09:45', meeting_no: 1 }],
  ...overrides
});

const contact = (emp_id, full_name) => ({
  emp_id,
  full_name,
  employment_type: 'תעשיידע'
});

const homeSchoolRoute = (employeeId, schoolId, distanceKm) => ({
  origin_instructor_emp_id: String(employeeId),
  destination_school_id: Number(schoolId),
  distance_km: distanceKm
});

/**
 * Two independent source datasets, mirroring production boundaries:
 * 1) attendanceRecords = what the instructor submitted for payroll in Attendance.
 * 2) dashboardSources = what the dashboard/Supabase knows about planned activities
 *    plus the dashboard's route/expense control sources.
 *
 * The uploaded Attendance workbook is used only as the shape/reference for these
 * synthetic records. No real employee names, IDs or production records are copied.
 */
export function buildPayrollControlTestSourceData() {
  const attendanceRecords = [
    // T01: course — 45 school-clock minutes are reported as one payroll hour.
    attendanceRecord(),

    // T02: course — 90 school-clock minutes are reported as two payroll hours.
    attendanceRecord({
      attendanceDate: '2027-01-04', startTime: '10:00', endTime: '12:00', workHours: 2,
      programName: 'T02 – קורס 90 דקות', schoolName: 'בית ספר בדיקה ב', sessionNumber: '2', kilometers: 24
    }),

    // T03: course — five-minute day-edge tolerance around a 90-minute dashboard meeting.
    attendanceRecord({
      attendanceDate: '2027-01-05', startTime: '08:55', endTime: '10:35', workHours: 2,
      programName: 'T03 – טולרנס 5 דקות', schoolName: 'בית ספר בדיקה ג', sessionNumber: '3', kilometers: 16
    }),

    // T04A + T04B: cancellation time stays in the same chronological workday.
    attendanceRecord({
      attendanceDate: '2027-01-06', startTime: '08:00', endTime: '10:00', workHours: 2,
      programName: 'T04 – קורס לפני ביטול זמן', schoolName: 'בית ספר בדיקה ד', sessionNumber: '4', kilometers: 18
    }),
    attendanceRecord({
      attendanceDate: '2027-01-06', startTime: '10:00', endTime: '11:00', workHours: 1,
      activityType: 'ביטול זמן', programName: 'T04 – ביטול זמן', schoolName: 'בית ספר בדיקה ד',
      sessionNumber: '', kilometers: 0, notes: 'דיווח שכר ידני לבדיקה'
    }),

    // T05: training exists only in attendance and requires manual payroll review.
    attendanceRecord({
      attendanceDate: '2027-01-07', startTime: '14:00', endTime: '16:00', workHours: 2,
      activityType: 'הכשרה', schoolName: 'זום', municipality: '', programName: 'T05 – הכשרה',
      sessionNumber: '', kilometers: 0
    }),

    // T06: operations exists only in attendance and requires manual payroll review.
    attendanceRecord({
      attendanceDate: '2027-01-08', startTime: '17:00', endTime: '17:30', workHours: 0.5,
      activityType: 'תפעול', schoolName: '', municipality: '', programName: 'T06 – תפעול',
      sessionNumber: '', kilometers: 0
    }),

    // T07: workshop — use the actual reported work-hours field, without course conversion.
    attendanceRecord({
      employeeId: '9902', employeeName: 'מדריך בדיקה ב', attendanceDate: '2027-01-09',
      startTime: '09:00', endTime: '13:00', workHours: 4, activityType: 'סדנה',
      schoolName: 'מרכז בדיקה א', programName: 'T07 – סדנה', sessionNumber: '', kilometers: 12
    }),

    // T08: summer workshop uses the distinct Attendance label found in real payroll data.
    attendanceRecord({
      employeeId: '9902', employeeName: 'מדריך בדיקה ב', attendanceDate: '2027-01-10',
      startTime: '09:00', endTime: '13:00', workHours: 4, activityType: 'סדנאות קיץ',
      schoolName: 'מרכז בדיקה קיץ', programName: 'T08 – סדנאות קיץ', sessionNumber: '', kilometers: 14
    }),

    // T09: tour — payroll hours follow the reported duration, not the course 45/60 rule.
    attendanceRecord({
      employeeId: '9902', employeeName: 'מדריך בדיקה ב', attendanceDate: '2027-01-11',
      startTime: '10:05', endTime: '12:00', workHours: 1.92, activityType: 'סיור',
      schoolName: 'אתר סיור בדיקה', programName: 'T09 – סיור', sessionNumber: '', kilometers: 22
    }),

    // T10: escape room — 45 clock minutes remain 0.75 reported hours; no course conversion.
    attendanceRecord({
      employeeId: '9902', employeeName: 'מדריך בדיקה ב', attendanceDate: '2027-01-12',
      startTime: '10:00', endTime: '10:45', workHours: 0.75, activityType: 'חדר בריחה',
      schoolName: 'בית ספר בדיקה ה', programName: 'T10 – חדר בריחה', sessionNumber: '', kilometers: 10
    }),

    // T11: Attendance contains a payable report with no corresponding dashboard activity.
    attendanceRecord({
      employeeId: '9903', employeeName: 'מדריך בדיקה ג', attendanceDate: '2027-01-13',
      startTime: '08:00', endTime: '10:00', workHours: 2, activityType: 'קורס',
      schoolName: 'בית ספר בדיקה חסר', programName: 'T11 – נוכחות ללא דשבורד', sessionNumber: '1', kilometers: 8
    }),

    // T12: reported km differs from the dashboard route calculation (30 vs 20).
    attendanceRecord({
      employeeId: '9903', employeeName: 'מדריך בדיקה ג', attendanceDate: '2027-01-15',
      startTime: '09:00', endTime: '10:00', workHours: 1,
      schoolName: 'בית ספר בדיקה ו', programName: 'T12 – פער ק״מ', kilometers: 30
    }),

    // T13: attendance has km but dashboard route data is incomplete.
    attendanceRecord({
      employeeId: '9903', employeeName: 'מדריך בדיקה ג', attendanceDate: '2027-01-16',
      startTime: '09:00', endTime: '10:00', workHours: 1,
      schoolName: 'בית ספר ללא מסלול', programName: 'T13 – ק״מ לא ניתן לחישוב', kilometers: 10
    }),

    // T14: expense is a payroll component. Even a matching supporting expense record still needs approval.
    attendanceRecord({
      employeeId: '9903', employeeName: 'מדריך בדיקה ג', attendanceDate: '2027-01-17',
      startTime: '09:00', endTime: '10:00', workHours: 1,
      schoolName: 'בית ספר בדיקה ז', programName: 'T14 – הוצאה לאישור', kilometers: 6,
      totalExpenses: 50, expensesDetails: 'חניה', notes: 'הוצאה שדווחה בנוכחות'
    }),

    // T15: workHours is intentionally independent from the start/end span and must be preserved.
    attendanceRecord({
      employeeId: '9903', employeeName: 'מדריך בדיקה ג', attendanceDate: '2027-01-18',
      startTime: '08:00', endTime: '14:00', workHours: 5, activityType: 'סדנה',
      schoolName: 'מרכז בדיקה ב', programName: 'T15 – שעות שכר מדווחות', sessionNumber: '', kilometers: 4
    })
  ];

  const activities = [
    dashboardActivity(),
    dashboardActivity({
      row_id: 'test-02', school: 'בית ספר בדיקה ב', school_id: 99002, activity_name: 'T02 – קורס 90 דקות',
      meetings: [{ date: '2027-01-04', start_time: '10:00', end_time: '11:30', meeting_no: 2 }]
    }),
    dashboardActivity({
      row_id: 'test-03', school: 'בית ספר בדיקה ג', school_id: 99003, activity_name: 'T03 – טולרנס 5 דקות',
      meetings: [{ date: '2027-01-05', start_time: '09:00', end_time: '10:30', meeting_no: 3 }]
    }),
    dashboardActivity({
      row_id: 'test-04', school: 'בית ספר בדיקה ד', school_id: 99004, activity_name: 'T04 – קורס לפני ביטול זמן',
      meetings: [{ date: '2027-01-06', start_time: '08:00', end_time: '09:30', meeting_no: 4 }]
    }),
    dashboardActivity({
      row_id: 'test-07', emp_id: '9902', instructor_name: 'מדריך בדיקה ב', activity_type: 'workshop', item_type: 'workshop',
      school: 'מרכז בדיקה א', school_id: 99007, activity_name: 'T07 – סדנה',
      meetings: [{ date: '2027-01-09', start_time: '09:00', end_time: '13:00' }]
    }),
    dashboardActivity({
      row_id: 'test-08', emp_id: '9902', instructor_name: 'מדריך בדיקה ב', activity_type: 'workshop', item_type: 'workshop',
      activity_season: 'summer_2026', school: 'מרכז בדיקה קיץ', school_id: 99008, activity_name: 'T08 – סדנאות קיץ',
      meetings: [{ date: '2027-01-10', start_time: '09:00', end_time: '13:00' }]
    }),
    dashboardActivity({
      row_id: 'test-09', emp_id: '9902', instructor_name: 'מדריך בדיקה ב', activity_type: 'tour', item_type: 'tour',
      school: 'אתר סיור בדיקה', school_id: 99009, activity_name: 'T09 – סיור',
      meetings: [{ date: '2027-01-11', start_time: '10:05', end_time: '12:00' }]
    }),
    dashboardActivity({
      row_id: 'test-10', emp_id: '9902', instructor_name: 'מדריך בדיקה ב', activity_type: 'escape_room', item_type: 'escape_room',
      school: 'בית ספר בדיקה ה', school_id: 99010, activity_name: 'T10 – חדר בריחה',
      meetings: [{ date: '2027-01-12', start_time: '10:00', end_time: '10:45' }]
    }),
    // T11B: dashboard activity with no Attendance report.
    dashboardActivity({
      row_id: 'test-11b', emp_id: '9903', instructor_name: 'מדריך בדיקה ג',
      school: 'בית ספר בדיקה ללא נוכחות', school_id: 99011, activity_name: 'T11B – דשבורד ללא נוכחות',
      meetings: [{ date: '2027-01-14', start_time: '11:00', end_time: '11:45', meeting_no: 1 }]
    }),
    dashboardActivity({
      row_id: 'test-12', emp_id: '9903', instructor_name: 'מדריך בדיקה ג',
      school: 'בית ספר בדיקה ו', school_id: 99012, activity_name: 'T12 – פער ק״מ',
      meetings: [{ date: '2027-01-15', start_time: '09:00', end_time: '09:45', meeting_no: 1 }]
    }),
    dashboardActivity({
      row_id: 'test-13', emp_id: '9903', instructor_name: 'מדריך בדיקה ג',
      school: 'בית ספר ללא מסלול', school_id: 99013, activity_name: 'T13 – ק״מ לא ניתן לחישוב',
      meetings: [{ date: '2027-01-16', start_time: '09:00', end_time: '09:45', meeting_no: 1 }]
    }),
    dashboardActivity({
      row_id: 'test-14', emp_id: '9903', instructor_name: 'מדריך בדיקה ג',
      school: 'בית ספר בדיקה ז', school_id: 99014, activity_name: 'T14 – הוצאה לאישור',
      meetings: [{ date: '2027-01-17', start_time: '09:00', end_time: '09:45', meeting_no: 1 }]
    }),
    dashboardActivity({
      row_id: 'test-15', emp_id: '9903', instructor_name: 'מדריך בדיקה ג', activity_type: 'workshop', item_type: 'workshop',
      school: 'מרכז בדיקה ב', school_id: 99015, activity_name: 'T15 – שעות שכר מדווחות',
      meetings: [{ date: '2027-01-18', start_time: '08:00', end_time: '14:00' }]
    })
  ];

  const contacts = [
    contact('9901', 'מדריך בדיקה א'),
    contact('9902', 'מדריך בדיקה ב'),
    contact('9903', 'מדריך בדיקה ג')
  ];

  // Distances represent one-way instructor→school cache values. The production
  // route calculator adds the return-home leg on a single-stop day.
  const travelCache = [
    homeSchoolRoute('9901', 99001, 10),
    homeSchoolRoute('9901', 99002, 12),
    homeSchoolRoute('9901', 99003, 8),
    homeSchoolRoute('9901', 99004, 9),
    homeSchoolRoute('9902', 99007, 6),
    homeSchoolRoute('9902', 99008, 7),
    homeSchoolRoute('9902', 99009, 11),
    homeSchoolRoute('9902', 99010, 5),
    homeSchoolRoute('9903', 99011, 4),
    homeSchoolRoute('9903', 99012, 10),
    // Intentionally no route for T13 / school 99013.
    homeSchoolRoute('9903', 99014, 3),
    homeSchoolRoute('9903', 99015, 2)
  ];

  const expenses = [
    { emp_id: '9903', expense_date: '2027-01-17', amount: 50, description: 'חניה' }
  ];

  return {
    attendanceRecords,
    dashboardSources: { activities, contacts, travelCache, expenses }
  };
}

export function buildPayrollControlTestDataset(moduleApi) {
  const required = [
    'normalizeAttendanceApiRows',
    'buildDashboardAttendanceRows',
    'aggregateDashboardAttendanceRows',
    'applyDashboardRouteKilometers',
    'applyDashboardExpenses'
  ];
  if (!moduleApi || required.some((key) => typeof moduleApi[key] !== 'function')) {
    throw new Error('payroll_test_module_api_required');
  }

  const sourceData = buildPayrollControlTestSourceData();
  const attendanceRows = moduleApi.normalizeAttendanceApiRows(sourceData.attendanceRecords);
  const dashboardSourceRows = moduleApi.buildDashboardAttendanceRows(
    sourceData.dashboardSources.activities,
    sourceData.dashboardSources.contacts
  );
  const dashboardRows = moduleApi.aggregateDashboardAttendanceRows(dashboardSourceRows);
  moduleApi.applyDashboardRouteKilometers(dashboardRows, sourceData.dashboardSources.travelCache);
  moduleApi.applyDashboardExpenses(dashboardRows, sourceData.dashboardSources.expenses);

  return { attendanceRows, dashboardRows, sourceData };
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
    const moduleApi = await import('./screens/attendance-control.js?v=20260817-grouped-days-v2');
    const { attendanceRows, dashboardRows, sourceData } = buildPayrollControlTestDataset(moduleApi);
    const result = moduleApi.compareAttendanceRows(attendanceRows, dashboardRows);
    result.month = PAYROLL_TEST_MONTH;
    panel.__payrollTestResult = result;
    panel.__payrollTestModuleApi = moduleApi;
    panel.dataset.payrollTestMode = 'true';
    installResultCapture(panel, moduleApi);

    title.textContent = 'בקרת נוכחות – מצב בדיקה תשפ״ז';
    status.textContent = '';
    results.innerHTML = `<div class="payroll-test-mode-banner">מצב בדיקה תשפ״ז — שני מקורות נפרדים, כמו בעבודה האמיתית.<small>נוכחות: ${sourceData.attendanceRecords.length} דיווחי שכר במבנה Attendance. דשבורד: ${sourceData.dashboardSources.activities.length} פעילויות מתוכננות, עם נתוני מסלול והוצאות לבקרה. המנוע עצמו לא תוקן כאן — מצב הבדיקה נועד לחשוף איפה הבקרה הנוכחית מקבלת החלטה לא נכונה. אין קריאה או כתיבה ל-Supabase או למערכת הנוכחות.</small></div>${moduleApi.resultsHtml(result, PAYROLL_TEST_MONTH)}`;
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
