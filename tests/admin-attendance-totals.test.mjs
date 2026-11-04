import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { buildAdminAttendanceTotals, adminAttendanceTotalsHtml } from '../frontend/src/admin-attendance-totals.js';

const scope = { monthKey: '2026-10', employeeIds: ['1507', '1508'] };
const row = (id, fields = {}) => ({ recordId: id, employeeId: '1507', attendanceDate: '2026-10-20', activityType: 'קורס', workHours: 2, kilometers: 10, ...fields });

test('overview totals use stored paid course hours and separate every activity type', () => {
  const totals = buildAdminAttendanceTotals([
    row('a', { startTime: '08:00', endTime: '09:20' }),
    row('b', { activityType: 'הכשרה', workHours: 1.5, kilometers: 20 }),
    row('c', { activityType: 'תפעול', workHours: 0.5, kilometers: 0 }),
    row('d', { activityType: 'סדנאות קיץ', workHours: 1 }),
    row('e', { activityType: 'מקוון', workHours: 1, publicTransport: true, kilometers: 999 })
  ], scope);
  assert.equal(totals.totalHours, 6);
  assert.equal(totals.totalKilometers, 40);
  assert.equal(totals.hoursByType.get('קורס'), 2);
  assert.equal(totals.hoursByType.get('הכשרה'), 1.5);
  assert.equal(totals.hoursByType.get('סדנה'), 1);
  assert.equal(totals.hoursByType.get('זום'), 1);
});

test('month, employee scope and duplicate IDs prevent unrelated or repeated totals', () => {
  const a = row('a');
  const totals = buildAdminAttendanceTotals([a, a, row('b', { employeeId: '9999' }), row('c', { attendanceDate: '2026-11-01' })], scope);
  assert.equal(totals.totalHours, 2);
  assert.equal(totals.totalKilometers, 10);
  assert.equal(buildAdminAttendanceTotals([a], { ...scope, employeeIds: [] }).totalHours, 0);
});

test('reported cancellation appears before approval and is counted once after generated payroll rows exist', () => {
  const source = row('a', { reportedCancellationBeforeMinutes: 15, reportedCancellationAfterMinutes: 20 });
  const child = row('child', { generationKind: 'travel_time_cancellation', sourceAttendanceRecordId: 'a', activityType: 'ביטול זמן', workHours: 0.25, kilometers: 999 });
  const before = buildAdminAttendanceTotals([source], scope);
  const after = buildAdminAttendanceTotals([source, child], scope);
  assert.equal(before.hoursByType.get('ביטול זמן'), 35 / 60);
  assert.deepEqual(after, before);
  assert.equal(after.totalKilometers, 10);
});

test('standalone cancellations and generated rows without a reported source remain included', () => {
  const totals = buildAdminAttendanceTotals([
    row('manual', { activityType: 'ביטול זמן', workHours: 0.5 }),
    row('generated', { activityType: 'ביטול זמן', generationKind: 'travel_time_cancellation', sourceAttendanceRecordId: 'unreported', workHours: 1 })
  ], scope);
  assert.equal(totals.hoursByType.get('ביטול זמן'), 1.5);
  assert.equal(totals.totalHours, 1.5);
  assert.equal(totals.totalKilometers, 0);
});

test('zero cancellations suppress generated duplicates and legacy trip reports preserve requested time', () => {
  const totals = buildAdminAttendanceTotals([
    row('zero', { reportedCancellationBeforeMinutes: 0, reportedCancellationAfterMinutes: 0 }),
    row('child', { generationKind: 'travel_time_cancellation', sourceAttendanceRecordId: 'zero', workHours: 2, activityType: 'ביטול זמן' }),
    row('legacy', { reportedOutboundMinutes: 60, reportedReturnMinutes: 70 })
  ], scope);
  assert.equal(totals.hoursByType.get('ביטול זמן'), 40 / 60);
  assert.equal(totals.totalHours, 4 + 40 / 60);
});

test('summary renders readable hour-minute totals and escapes unknown type labels', () => {
  const totals = buildAdminAttendanceTotals([row('a', { activityType: '<script>', workHours: 1.5, kilometers: 12.3 })], scope);
  const dom = new JSDOM(adminAttendanceTotalsHtml(totals, scope.monthKey));
  assert.match(dom.window.document.body.textContent, /1:30/);
  assert.match(dom.window.document.body.textContent, /12.3/);
  assert.equal(dom.window.document.querySelector('script'), null);
  assert.equal(dom.window.document.querySelector('[data-admin-attendance-totals]')?.tagName, 'SECTION');
  dom.window.close();
});

test('overview loads the selected month and places totals ahead of approvals and teams', async () => {
  const source = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
  const renderFunction = source.slice(source.indexOf('async function renderData('), source.indexOf('async function toggleApprovedSnapshot('));
  const dom = new JSDOM('<main><div data-admin-attendance-body></div><span data-admin-attendance-mode></span></main>');
  const root = dom.window.document.querySelector('main');
  const calls = [];
  const api = {
    attendanceControlMonthWorkflowStatuses: async () => [],
    listPayrollControlApprovals: async () => [],
    attendanceControlRecords: async options => { calls.push(options); return [row('a')]; }
  };
  const factory = new Function('api', 'buildAdminAttendanceTotals', 'adminAttendanceTotalsHtml', `
    let renderToken = 0;
    const isAdmin = () => true;
    const setMessage = () => {};
    const text = value => String(value ?? '');
    const employeeId = row => row.emp_id;
    const loadEmployees = async () => [{ emp_id: '1507' }];
    const attendanceMonthDateRange = () => ({ fromDate: '2026-10-01', toDate: '2026-10-31' });
    const monthMode = () => ({ label: 'בקרה ואישור' });
    const summaryHtml = () => '<div data-status-summary></div>';
    const groupsHtml = () => '<div data-teams></div>';
    ${renderFunction}; return renderData;
  `);
  await factory(api, buildAdminAttendanceTotals, adminAttendanceTotalsHtml)(root, '2026-10');
  assert.deepEqual(calls, [{ employeeIds: ['1507'], fromDate: '2026-10-01', toDate: '2026-10-31' }]);
  const children = [...root.querySelector('[data-admin-attendance-body]').children];
  assert.ok(children[0].hasAttribute('data-admin-attendance-totals'));
  assert.ok(children[1].hasAttribute('data-status-summary'));
  assert.ok(children[2].hasAttribute('data-teams'));
  assert.equal(root.__adminAttendanceContext.totals.totalHours, 2);
  dom.window.close();
});

test('admin overview shows only nonzero reported categories and keeps review alerts separate', () => {
  const totals = buildAdminAttendanceTotals([
    row('course', { workHours: 2, kilometers: 12 }),
    row('training', { activityType: 'הכשרה', workHours: 1.5, kilometers: 0 })
  ], scope);
  const document = new JSDOM(adminAttendanceTotalsHtml(totals, scope.monthKey)).window.document;
  const cardLabels = [...document.querySelectorAll('.admin-attendance-standalone__summary article span')].map(node => node.textContent);
  assert.deepEqual(cardLabels, ['סה״כ ק״מ', 'שעות קורס', 'שעות הכשרה']);
  assert.equal(document.querySelector('.admin-attendance-totals__warning'), null);
});

test('empty month displays no empty metric cards; cancellation review stays visible', () => {
  const totals = buildAdminAttendanceTotals([], scope);
  totals.suspectCancellationCount = 10;
  const document = new JSDOM(adminAttendanceTotalsHtml(totals, scope.monthKey)).window.document;
  assert.equal(document.querySelectorAll('.admin-attendance-standalone__summary article').length, 0);
  assert.match(document.querySelector('.admin-attendance-totals__empty').textContent, /אין דיווחים/);
  assert.match(document.querySelector('.admin-attendance-totals__warning').textContent, /10/);
});

test('additional genuinely reported activity types remain visible', () => {
  const totals = buildAdminAttendanceTotals([row('zoom', { activityType: 'מקוון', workHours: 1, kilometers: 0 })], scope);
  const document = new JSDOM(adminAttendanceTotalsHtml(totals, scope.monthKey)).window.document;
  assert.deepEqual([...document.querySelectorAll('.admin-attendance-standalone__summary article span')].map(n => n.textContent), ['שעות זום']);
});
