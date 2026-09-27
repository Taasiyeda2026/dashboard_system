import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  attendanceControlHtml,
  attendanceControlStylesHtml,
  bindAttendanceControl,
  eventTargetElement,
  applyAttendanceChoice,
  attendanceEntryIsResolved
} from '../frontend/src/screens/attendance-control.js';
import { buildAttendanceUpdatePayload } from '../frontend/src/screens/payroll-control-finish.js';

function installDom(html) {
  const dom = new JSDOM(html, { url: 'https://dashboard.test/', pretendToBeVisual: true });
  const { window } = dom;
  Object.assign(globalThis, {
    window,
    document: window.document,
    HTMLElement: window.HTMLElement,
    Element: window.Element,
    Node: window.Node,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
    CustomEvent: window.CustomEvent,
    CSS: { escape: (value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
  });
  return window;
}

test('eventTargetElement resolves button text-node clicks to the button element', () => {
  const window = installDom(`<!doctype html><body>
    <button type="button" data-attendance-field-choice="dashboard" data-comparison-id="row-0" data-field-key="kilometers">אישור חישוב מערכת</button>
  </body>`);
  const button = window.document.querySelector('[data-attendance-field-choice="dashboard"]');
  const textNode = button.firstChild;
  assert.equal(textNode?.nodeType, window.Node.TEXT_NODE);
  const event = new window.MouseEvent('click', { bubbles: true });
  Object.defineProperty(event, 'target', { get: () => textNode });
  const resolved = eventTargetElement(event);
  assert.equal(resolved, button);
  assert.equal(resolved.closest('[data-attendance-field-choice]')?.dataset.attendanceFieldChoice, 'dashboard');
});

test('embedded manager click on אישור חישוב מערכת writes system km and keeps record pending approval', async () => {
  const home = 'רחוב הבית 1, תל אביב';
  const destination = 'נמל חיפה, חיפה';
  const sourceRecord = {
    ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    Id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    recordId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    employeeId: '1535',
    EmployeeId: '1535',
    empNum: '1535',
    employeeName: 'ורד',
    EmployeeName: 'ורד',
    empName: 'ורד',
    employmentType: '',
    EmploymentType: '',
    team: 't1',
    Team: 't1',
    attendanceDate: '2026-09-24',
    AttendanceDate: '2026-09-24',
    startTime: '10:00',
    StartTime: '10:00',
    endTime: '12:30',
    EndTime: '12:30',
    workHours: 2.5,
    WorkHours: 2.5,
    activityType: 'הכשרה',
    ActivityType: 'הכשרה',
    schoolName: '',
    SchoolName: '',
    municipality: '',
    Municipality: '',
    programName: 'פורצות דרך',
    ProgramName: 'פורצות דרך',
    sessionNumber: '',
    SessionNumber: '',
    totalExpenses: 0,
    TotalExpenses: 0,
    kilometers: 0,
    Kilometers: 0,
    publicTransport: false,
    PublicTransport: false,
    public_transport: false,
    publicTransportCost: 0,
    PublicTransportCost: 0,
    public_transport_cost: 0,
    expensesDetails: '',
    ExpensesDetails: '',
    notes: '',
    Notes: '',
    originAddress: home,
    destinationAddress: destination,
    destinationEntityKey: 'training:train-1',
    destinationType: 'location',
    attachments: [],
    attachmentsNames: '',
    AttachmentsNames: '',
    status: '',
    approvedBy: '',
    approvedDate: ''
  };

  const updateCalls = [];
  const api = {
    attendanceControlTeams: async () => ([
      { employeeId: '1535', employeeName: 'ורד', team: 't1', Team: 't1', role: 'instructor' },
      { employeeId: 'm1', employeeName: 'מנהל', team: 't1', Team: 't1', role: 'manager' }
    ]),
    attendanceControlRecords: async () => [sourceRecord],
    attendanceControlDashboardSources: async () => ({
      activities: [],
      contacts: [{ emp_id: 1535, full_name: 'ורד', home_address: home }],
      travelCache: [{
        origin_address: home,
        destination_address: destination,
        distance_km: 88.175
      }, {
        origin_address: destination,
        destination_address: home,
        distance_km: 88.175
      }],
      expenses: [],
      trainingSchedule: [{
        id: 'train-1',
        training_date: '2026-09-24',
        start_time: '10:00',
        end_time: '12:30',
        course_name: 'פורצות דרך',
        activity_type: 'הכשרה',
        participant_scope: 'open',
        is_online: false,
        is_active: true,
        location_name: 'חיפה',
        location_address: destination
      }],
      schoolLookup: { list: [] },
      authorityLookup: { list: [] },
      travelSourceAvailable: true,
      expenseSourceAvailable: true
    }),
    attendanceControlMonthWorkflowStatuses: async () => ([{
      employee_id: '1535',
      workflow_status: 'submitted',
      attendance_submission_status: 'submitted'
    }]),
    listPayrollControlApprovals: async () => [],
    attendanceControlRecordReviews: async () => [],
    attendanceControlUpdateRecord: async (recordId, fields) => {
      updateCalls.push({ recordId, fields });
      return { success: true, recordId };
    },
    attendanceControlApproveRecord: async () => ({ success: true })
  };

  const window = installDom(`<!doctype html><html><body>
    <div data-manager-attendance-host>
      ${attendanceControlStylesHtml()}
      ${attendanceControlHtml()}
    </div>
  </body></html>`);
  const host = window.document.querySelector('[data-manager-attendance-host]');
  host.querySelector('[data-attendance-control]').hidden = false;
  bindAttendanceControl(host, {
    api,
    state: { user: { role: 'manager', full_name: 'מנהל' } },
    standalone: true
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const monthInput = host.querySelector('[data-attendance-month]');
  const teamInput = host.querySelector('[data-attendance-team]');
  const run = host.querySelector('[data-attendance-run]');
  const results = host.querySelector('[data-attendance-results]');
  const status = host.querySelector('[data-attendance-status]');

  monthInput.value = '2026-09';
  monthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  teamInput.value = 't1';
  teamInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(run.disabled, false);
  run.click();
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.match(results.innerHTML, /אישור חישוב מערכת/);
  assert.match(results.innerHTML, />176\.35</);
  assert.match(results.innerHTML, /לבדיקה/);
  assert.match(results.innerHTML, /אישור רשומה/);

  const button = results.querySelector('[data-attendance-field-choice="dashboard"][data-field-key="kilometers"]');
  assert.ok(button, 'dashboard km choice button must render');
  const textNode = button.firstChild;
  assert.equal(textNode?.nodeType, window.Node.TEXT_NODE);

  // Real clicks often land on the button's text node; that used to throw before any RPC.
  const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(clickEvent, 'target', { get: () => textNode });
  button.dispatchEvent(clickEvent);
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.equal(updateCalls.length, 1, 'update_payroll_attendance_record must be invoked');
  assert.equal(updateCalls[0].recordId, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(updateCalls[0].fields.kilometers, 176.35);
  assert.match(results.innerHTML, /✓ החלטה נשמרה/);
  assert.match(results.innerHTML, /ממתין לאישור/);
  assert.match(results.innerHTML, /אישור רשומה/);
  assert.doesNotMatch(results.innerHTML, /✓ רשומה אושרה/);
  assert.doesNotMatch(status.textContent, /שמירת ההחלטה נכשלה/);
  assert.match(status.textContent, /התיקון נשמר ברשומת הנוכחות/);
  assert.equal(status.classList.contains('is-error'), false);
});

test('choosing system kilometers prepares a write-back payload without approving the record', () => {
  const entry = {
    id: 'row-0',
    managerResolved: null,
    managerRecordApproved: false,
    attendance: {
      employeeId: '1535',
      employeeName: 'ורד',
      date: '2026-09-24',
      startTime: '10:00',
      endTime: '12:30',
      workHours: 2.5,
      activityType: 'הכשרה',
      program: 'פורצות דרך',
      kilometers: 0,
      publicTransport: false,
      publicTransportCost: 0,
      expenses: 0,
      recordId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      _source: {
        ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        employeeId: '1535',
        employeeName: 'ורד',
        attendanceDate: '2026-09-24',
        startTime: '10:00',
        endTime: '12:30',
        workHours: 2.5,
        activityType: 'הכשרה',
        schoolName: '',
        municipality: '',
        programName: 'פורצות דרך',
        sessionNumber: '',
        totalExpenses: 0,
        kilometers: 0,
        publicTransport: false,
        publicTransportCost: 0,
        expensesDetails: '',
        notes: '',
        team: 't1',
        employmentType: '',
        attachmentsNames: '',
        status: '',
        approvedBy: '',
        approvedDate: ''
      }
    },
    final: {
      employeeId: '1535',
      kilometers: 0,
      publicTransport: false,
      publicTransportCost: 0,
      startTime: '10:00',
      endTime: '12:30',
      workHours: 2.5
    },
    differences: [{
      key: 'kilometers',
      label: 'קילומטרים',
      type: 'number',
      attendance: 0,
      dashboard: 176.35,
      choice: 'attendance',
      custom: ''
    }]
  };

  applyAttendanceChoice(entry, 'kilometers', 'dashboard');
  assert.equal(entry.final.kilometers, 176.35);
  assert.equal(attendanceEntryIsResolved(entry), false);
  const payload = buildAttendanceUpdatePayload(entry);
  assert.equal(payload.changed, true);
  assert.equal(payload.fields.kilometers, 176.35);
});
