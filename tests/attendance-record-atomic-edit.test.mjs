import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  attendanceControlHtml,
  attendanceControlStylesHtml,
  bindAttendanceControl
} from '../frontend/src/screens/attendance-control.js';

const RECORD_ID = '11111111-2222-3333-4444-555555555555';

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

const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function sourceRecord(overrides = {}) {
  return {
    ID: RECORD_ID,
    Id: RECORD_ID,
    id: RECORD_ID,
    recordId: RECORD_ID,
    employeeId: '1507',
    EmployeeId: '1507',
    empNum: '1507',
    employeeName: 'דנה בדיקה',
    EmployeeName: 'דנה בדיקה',
    empName: 'דנה בדיקה',
    employmentType: '',
    EmploymentType: '',
    team: 't1',
    Team: 't1',
    attendanceDate: '2026-09-20',
    AttendanceDate: '2026-09-20',
    startTime: '09:00',
    StartTime: '09:00',
    endTime: '10:00',
    EndTime: '10:00',
    workHours: 1,
    WorkHours: 1,
    activityType: 'תפעול',
    ActivityType: 'תפעול',
    schoolName: 'מיקום א',
    SchoolName: 'מיקום א',
    municipality: 'תל אביב',
    Municipality: 'תל אביב',
    programName: 'פעילות מקור',
    ProgramName: 'פעילות מקור',
    sessionNumber: '1',
    SessionNumber: '1',
    totalExpenses: 0,
    TotalExpenses: 0,
    kilometers: 10,
    Kilometers: 10,
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
    attachments: [],
    attachmentsNames: '',
    AttachmentsNames: '',
    status: '',
    approvedBy: '',
    approvedDate: '',
    ...overrides
  };
}

async function mountControl({ approved = false, failUpdate = { value: false }, records = null } = {}) {
  const updateCalls = [];
  const approvalCalls = [];
  const api = {
    attendanceControlTeams: async () => ([
      { employeeId: '1507', employeeName: 'דנה בדיקה', team: 't1', Team: 't1', role: 'instructor' },
      { employeeId: 'm1', employeeName: 'מנהל', team: 't1', Team: 't1', role: 'manager' }
    ]),
    attendanceControlRecords: async () => (records || [sourceRecord()]).map((row) => ({ ...row })),
    attendanceControlDashboardSources: async () => ({
      activities: [],
      contacts: [{ emp_id: 1507, full_name: 'דנה בדיקה', home_address: 'תל אביב' }],
      travelCache: [],
      expenses: [],
      trainingSchedule: [],
      schoolLookup: { list: [] },
      authorityLookup: { list: [] },
      travelSourceAvailable: true,
      expenseSourceAvailable: true
    }),
    attendanceControlMonthWorkflowStatuses: async () => ([{
      employee_id: '1507',
      workflow_status: 'submitted',
      attendance_submission_status: 'submitted'
    }]),
    listPayrollControlApprovals: async () => [],
    attendanceControlRecordReviews: async () => approved ? [{ record_id: RECORD_ID }] : [],
    attendanceControlUpdateRecord: async (recordId, fields) => {
      updateCalls.push({ recordId, fields: { ...fields } });
      if (failUpdate.value) throw new Error('write failed');
      return { success: true, recordId };
    },
    attendanceControlApproveRecord: async (recordId, value) => {
      approvalCalls.push({ recordId, approved: value !== false });
      return { success: true, recordId, approved: value !== false };
    }
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
  await wait(50);

  const monthInput = host.querySelector('[data-attendance-month]');
  const teamInput = host.querySelector('[data-attendance-team]');
  monthInput.value = '2026-09';
  monthInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  teamInput.value = 't1';
  teamInput.dispatchEvent(new window.Event('change', { bubbles: true }));
  host.querySelector('[data-attendance-run]').click();
  await wait(140);

  return {
    window,
    host,
    results: host.querySelector('[data-attendance-results]'),
    status: host.querySelector('[data-attendance-status]'),
    updateCalls,
    approvalCalls,
    failUpdate
  };
}

function enterEdit(ctx) {
  const button = ctx.results.querySelector('[data-attendance-edit-record]');
  assert.ok(button, 'record edit button must render');
  button.click();
  const report = ctx.results.querySelector('[data-record-editing="1"]');
  assert.ok(report, 'record must enter full edit mode');
  assert.match(report.textContent, /שינויים טרם נשמרו/);
  assert.ok(report.querySelector('[data-attendance-save-record]'));
  assert.ok(report.querySelector('[data-attendance-cancel-record]'));
  assert.equal(report.querySelectorAll('[data-attendance-manual-save]').length, 0);
  return report;
}

function inputFor(report, key) {
  const input = report.querySelector(`[data-attendance-manual-input][data-field-key="${key}"]`);
  assert.ok(input, `missing editable field ${key}`);
  return input;
}

function setInput(ctx, report, key, value, eventType = 'input') {
  const input = inputFor(report, key);
  input.value = value;
  input.dispatchEvent(new ctx.window.Event(eventType, { bubbles: true }));
  return input;
}

test('two record fields stay local and are persisted by one update only', { concurrency: false }, async () => {
  const ctx = await mountControl();
  const report = enterEdit(ctx);
  setInput(ctx, report, 'program', 'פעילות מתוקנת');
  setInput(ctx, report, 'kilometers', '22');

  assert.equal(ctx.updateCalls.length, 0, 'editing must not write to Supabase');
  assert.equal(ctx.approvalCalls.length, 0, 'editing must not touch record approval');

  report.querySelector('[data-attendance-save-record]').click();
  await wait(120);

  assert.equal(ctx.updateCalls.length, 1, 'one record save must issue exactly one update');
  assert.equal(ctx.updateCalls[0].recordId, RECORD_ID);
  assert.equal(ctx.updateCalls[0].fields.programName, 'פעילות מתוקנת');
  assert.equal(ctx.updateCalls[0].fields.kilometers, 22);
  assert.deepEqual(ctx.approvalCalls, [{ recordId: RECORD_ID, approved: false }]);
  assert.match(ctx.status.textContent, /ממתינה לאישור מחדש/);
});

test('changing both times recalculates total hours live and saves them together', { concurrency: false }, async () => {
  const ctx = await mountControl();
  const report = enterEdit(ctx);
  setInput(ctx, report, 'startTime', '10:00');
  setInput(ctx, report, 'endTime', '12:30');

  const hours = inputFor(report, 'workHours');
  assert.equal(hours.readOnly, true);
  assert.equal(hours.value, '2:30');
  assert.equal(ctx.updateCalls.length, 0);

  report.querySelector('[data-attendance-save-record]').click();
  await wait(120);

  assert.equal(ctx.updateCalls.length, 1);
  assert.equal(ctx.updateCalls[0].fields.startTime, '10:00');
  assert.equal(ctx.updateCalls[0].fields.endTime, '12:30');
  assert.equal(ctx.updateCalls[0].fields.workHours, 2.5);
});

test('cancel discards the local draft and restores the exact original values without writes', { concurrency: false }, async () => {
  const ctx = await mountControl();
  let report = enterEdit(ctx);
  setInput(ctx, report, 'program', 'טיוטה שלא נשמרה');
  setInput(ctx, report, 'kilometers', '99');

  report.querySelector('[data-attendance-cancel-record]').click();
  await wait(30);

  assert.equal(ctx.updateCalls.length, 0);
  assert.equal(ctx.approvalCalls.length, 0);
  assert.equal(ctx.results.querySelector('[data-record-editing="1"]'), null);

  report = enterEdit(ctx);
  assert.equal(inputFor(report, 'program').value, 'פעילות מקור');
  assert.equal(inputFor(report, 'kilometers').value, '10');
});

test('validation failure keeps the record in edit mode and performs no database action', { concurrency: false }, async () => {
  const ctx = await mountControl();
  const report = enterEdit(ctx);
  setInput(ctx, report, 'startTime', '13:00');
  setInput(ctx, report, 'endTime', '12:00');

  report.querySelector('[data-attendance-save-record]').click();
  await wait(60);

  assert.equal(ctx.updateCalls.length, 0);
  assert.equal(ctx.approvalCalls.length, 0);
  assert.ok(ctx.results.querySelector('[data-record-editing="1"]'));
  assert.equal(ctx.status.classList.contains('is-error'), true);
});

test('an approved record loses approval only after a successful record write', { concurrency: false }, async () => {
  const failUpdate = { value: true };
  const ctx = await mountControl({ approved: true, failUpdate });
  const report = enterEdit(ctx);
  assert.doesNotMatch(report.textContent, /✓ רשומה אושרה/);
  setInput(ctx, report, 'program', 'שינוי אחרי אישור');

  report.querySelector('[data-attendance-save-record]').click();
  await wait(80);

  assert.equal(ctx.updateCalls.length, 1);
  assert.equal(ctx.approvalCalls.length, 0, 'failed update must not cancel the prior approval');
  assert.ok(ctx.results.querySelector('[data-record-editing="1"]'));
  assert.match(ctx.results.textContent, /שינויים טרם נשמרו/);

  failUpdate.value = false;
  ctx.results.querySelector('[data-attendance-save-record]').click();
  await wait(120);

  assert.equal(ctx.updateCalls.length, 2);
  assert.deepEqual(ctx.approvalCalls, [{ recordId: RECORD_ID, approved: false }]);
  assert.match(ctx.status.textContent, /ממתינה לאישור מחדש/);
});

test('public transport and kilometers remain mutually exclusive in one atomic save', { concurrency: false }, async () => {
  const ctx = await mountControl();
  const report = enterEdit(ctx);
  const publicTransport = setInput(ctx, report, 'publicTransport', 'true', 'change');
  assert.equal(publicTransport.value, 'true');
  const km = inputFor(report, 'kilometers');
  const cost = inputFor(report, 'publicTransportCost');
  assert.equal(km.disabled, true);
  assert.equal(km.value, '0');
  assert.equal(cost.disabled, false);
  setInput(ctx, report, 'publicTransportCost', '18.5');

  assert.equal(ctx.updateCalls.length, 0);
  report.querySelector('[data-attendance-save-record]').click();
  await wait(120);

  assert.equal(ctx.updateCalls.length, 1);
  assert.equal(ctx.updateCalls[0].fields.publicTransport, true);
  assert.equal(ctx.updateCalls[0].fields.publicTransportCost, 18.5);
  assert.equal(ctx.updateCalls[0].fields.kilometers, 0);
});
