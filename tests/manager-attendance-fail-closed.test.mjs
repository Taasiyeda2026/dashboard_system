import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  attendanceControlHtml,
  bindAttendanceControl
} from '../frontend/src/screens/attendance-control.js';

const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const ID = '11111111-2222-3333-4444-555555555555';
const sleep = (ms = 75) => new Promise(resolve => setTimeout(resolve, ms));

function mockRecord() {
  return {
    ID, Id: ID, id: ID, recordId: ID,
    employeeId: '1507', EmployeeId: '1507', empNum: '1507',
    employeeName: 'מדריכה לבדיקה', EmployeeName: 'מדריכה לבדיקה',
    team: 't1', Team: 't1', employmentType: '',
    attendanceDate: '2026-11-15', AttendanceDate: '2026-11-15',
    startTime: '10:00', endTime: '11:00', workHours: 1,
    activityType: 'תפעול', ActivityType: 'תפעול',
    schoolName: '', municipality: '', programName: 'צוות',
    sessionNumber: '', totalExpenses: 0, kilometers: 0,
    publicTransport: false, publicTransportCost: 0,
    expensesDetails: '', notes: '', attachments: []
  };
}

async function mount(failures = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host">' +
    attendanceControlHtml() + '</div></body></html>', {
    url: 'https://dashboard.test/',
    pretendToBeVisual: true
  });
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
    CSS: { escape: value => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&') }
  });
  const api = {
    attendanceControlTeams: async () => [
      { employeeId: '1507', employeeName: 'מדריכה לבדיקה', team: 't1', Team: 't1', role: 'instructor' },
      { employeeId: 'm1', employeeName: 'מנהל', team: 't1', Team: 't1', role: 'manager' }
    ],
    attendanceControlRecords: async () => [mockRecord()],
    attendanceControlDashboardSources: async () => ({
      activities: [], contacts: [], travelCache: [], expenses: [], trainingSchedule: [],
      schoolLookup: { list: [] }, authorityLookup: { list: [] },
      travelSourceAvailable: true, expenseSourceAvailable: true
    }),
    attendanceControlExpenseReports: async () => [],
    attendanceControlOrphanDailyTravelReports: async () => [],
    attendanceControlDailyTravelReports: async () => [],
    attendanceControlMonthWorkflowStatuses: async () => {
      if (failures.workflow) throw new Error('temporary workflow outage');
      return [{ employee_id: '1507', workflow_status: 'submitted', attendance_submission_status: 'submitted' }];
    },
    attendanceControlRecordReviews: async () => {
      if (failures.reviews) throw new Error('temporary review outage');
      return [];
    },
    listPayrollControlApprovals: async () => {
      if (failures.approvals) throw new Error('temporary approval outage');
      return [];
    }
  };
  const host = window.document.querySelector('#host');
  host.querySelector('[data-attendance-control]').hidden = false;
  bindAttendanceControl(host, { api, state: { user: { role: 'manager', full_name: 'מנהל' } }, standalone: true });
  await sleep(50);
  host.querySelector('[data-attendance-month]').value = '2026-11';
  host.querySelector('[data-attendance-month]').dispatchEvent(new window.Event('change', { bubbles: true }));
  host.querySelector('[data-attendance-team]').value = 't1';
  host.querySelector('[data-attendance-team]').dispatchEvent(new window.Event('change', { bubbles: true }));
  return { host, failures, window };
}

async function run(ctx) {
  const button = ctx.host.querySelector('[data-attendance-run]');
  assert.equal(button.disabled, false, 'run must be enabled for a selected month/team');
  button.click();
  await sleep(160);
  return {
    status: ctx.host.querySelector('[data-attendance-status]'),
    results: ctx.host.querySelector('[data-attendance-results]')
  };
}

for (const [key, pattern] of [
  ['workflow', /טעינת סטטוסי החודש נכשלה/],
  ['reviews', /טעינת אישורי הרשומות נכשלה/],
  ['approvals', /טעינת נתוני האישור הסופי נכשלה/]
]) {
  test(`manager review fails closed if ${key} source fails; retry restores the view`,
    { concurrency: false }, async () => {
      const ctx = await mount({ [key]: true });
      const first = await run(ctx);
      assert.match(first.status.textContent, pattern);
      assert.ok(first.status.classList.contains('is-error'));
      assert.equal(first.results.querySelector('[data-payroll-finish]'), null);
      assert.equal(first.results.querySelector('[data-attendance-approve-reported]'), null);
      assert.equal(first.results.children.length, 0, 'no stale or partial review view on failure');

      ctx.failures[key] = false;
      const second = await run(ctx);
      assert.ok(!second.status.classList.contains('is-error'));
      assert.ok(second.results.children.length > 0, 'review can be rebuilt after verified retry');
    });
}

test('manager summary hides all counts and actions on incomplete reads and offers retry', () => {
  assert.match(workspace, /if \(loadingError\)\s*\{/);
  assert.match(workspace, /data-manager-attendance-retry/);
  assert.match(workspace, /attendanceSummaryCache\.clear\(\)/);
  assert.match(workspace, /if \(summary\.recordsError \|\| summary\.workflowError \|\| summary\.approvalsError\)/);
  assert.match(workspace, /הטבלה מוסתרת עד לטעינה תקינה/);
  assert.match(workspace, /תגובת דיווחי הנוכחות אינה תקינה/);
  assert.match(workspace, /תגובת סטטוסי החודש אינה תקינה/);
});

test('manager cannot finalize using stale approvals after an earlier screen load', () => {
  assert.match(control, /await loadApprovals\(\);[\s\S]*?await loadWorkflowStatuses\(result\.month, reviewEmployeeIds\);[\s\S]*?await loadRecordReviews\(\);[\s\S]*?paintResults\(\);/);
  assert.match(control, /canManagerFinalizeEmployeeMonth\(workflowByEmployee\[employeeId\] \|\| \{\}, \{ bypassMonthSubmissionGate \}\)/);
  assert.match(control, /result = null;[\s\S]*?status\.classList\.add\('is-error'\)/);
});
