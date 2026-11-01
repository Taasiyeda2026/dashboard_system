import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as XLSX from 'xlsx';
import { JSDOM } from 'jsdom';
import {
  normalizeAttendanceApiRows, compareAttendanceRows, resultsHtml, attendanceControlStylesHtml,
  attendanceTrainingDetails, applyAttendanceDayRouteKilometers, approveAttendanceEntryCurrent,
  buildCorrectedAttendanceWorkbook, loadAttendanceDashboardDataset
} from '../frontend/src/screens/attendance-control.js';

const record = (extra = {}) => ({
  recordId: 'd688878d-609e-4e94-8d4a-44259ca19d38', employeeId: '1550', employeeName: 'בדיקה',
  attendanceDate: '2026-10-29', activityType: 'הכשרה', programName: 'פורצות דרך',
  startTime: '13:45', endTime: '15:00', workHours: 1.25, trainingMode: 'online', kilometers: 0,
  ...extra
});
const resultFor = (extra = {}) => compareAttendanceRows(normalizeAttendanceApiRows([record(extra)]), []);
const render = result => new JSDOM(resultsHtml(result, '2026-10', {
  workflowByEmployee: { '1550': { workflow_status: 'employee_submitted', attendance_submission_status: 'submitted' } }
})).window.document;
const report = doc => doc.querySelector('.attendance-control__report');
const dayStatus = doc => doc.querySelector('.attendance-control__day > summary .attendance-control__row-status');

test('real October Zoom report shows source mode, 1:15 and zero km without a dashboard table or approval', () => {
  const result = resultFor();
  const doc = render(result);
  assert.match(report(doc).textContent, /הכשרה – זום/);
  assert.match(report(doc).textContent, /1:15/);
  assert.match(report(doc).textContent, /0 ק״מ – הכשרה בזום/);
  assert.match(report(doc).textContent, /אופן קיום ההכשרהזום/);
  assert.equal(report(doc).querySelectorAll('thead th').length, 2);
  assert.equal(report(doc).querySelectorAll('.attendance-control__status-pill--neutral').length, 1);
  assert.doesNotMatch(report(doc).textContent, /מידע מהדיווח/);
  assert.equal(dayStatus(doc).textContent, 'ממתין לאישור');
  assert.equal(report(doc).querySelectorAll('.attendance-control__status-pill--ok').length, 0);
  assert.equal(result.notCompared[0].managerRecordApproved, undefined);
});

test('physical training reuses cached home-location-home kilometers and exposes its location', () => {
  const attendance = normalizeAttendanceApiRows([record({ trainingMode: 'physical', destinationAddress: 'יקום', destinationEntityKey: 'training:base', kilometers: 80 })]);
  const rows = [{ employeeId: '1550', date: '2026-10-29', sourceRecordId: attendance[0].recordId,
    destinationAddress: 'יקום', destinationEntityKey: 'training:base', destinationType: 'location', kilometers: null, __routeOnly: true }];
  applyAttendanceDayRouteKilometers(rows, attendance, [{ origin_instructor_emp_id: 1550,
    origin_entity_key: 'instructor:1550', destination_entity_key: 'training:base', distance_km: 40 }]);
  assert.equal(rows[0].kilometers, 80);
  const doc = render(compareAttendanceRows(attendance, rows));
  assert.match(report(doc).textContent, /פרונטלי/);
  assert.match(report(doc).textContent, /מיקום ההכשרהיקום/);
  assert.match(report(doc).textContent, /80 ק״מ/);
  assert.equal(attendanceTrainingDetails(attendance[0]).issue, false);
});

test('physical training shows cached calculation and flags a kilometer discrepancy without changing the report', () => {
  const result = resultFor({ trainingMode: 'physical', destinationAddress: 'יקום', kilometers: 100 });
  result.dashboardPopulation = [{ __routeOnly: true, sourceRecordId: record().recordId, kilometers: 80 }];
  const doc = render(result);
  assert.match(report(doc).textContent, /100 ק״מ · דווח · חישוב מערכת: 80 ק״מ/);
  assert.equal(dayStatus(doc).textContent, 'לבדיקה');
  assert.equal(result.notCompared[0].final.kilometers, 100);
});

test('physical training without a recognized destination stays under review without inventing km', () => {
  const result = resultFor({ trainingMode: 'physical', kilometers: null });
  const doc = render(result);
  assert.match(report(doc).textContent, /מיקום חסר או לא מזוהה/);
  assert.equal(dayStatus(doc).textContent, 'לבדיקה');
  assert.equal(result.notCompared[0].final.kilometers, null);
});

test('missing and unknown training modes preserve historical kilometers and explicit approvals', () => {
  for (const trainingMode of ['', null, 'unknown']) {
    const result = resultFor({ trainingMode, kilometers: 37 });
    assert.match(report(render(result)).textContent, /חסר מידע – נדרשת בדיקה/);
    assert.equal(dayStatus(render(result)).textContent, 'לבדיקה');
    assert.equal(result.notCompared[0].final.kilometers, 37);
    result.notCompared[0].managerRecordApproved = true;
    assert.equal(dayStatus(render(result)).textContent, '✓ אושר');
    assert.equal(result.notCompared[0].final.kilometers, 37);
  }
});

test('only actual record approval turns report and day green; partial approval remains pending', () => {
  const result = compareAttendanceRows(normalizeAttendanceApiRows([record(), record({ recordId: 'second' })]), []);
  approveAttendanceEntryCurrent(result.notCompared[0]);
  let doc = render(result);
  assert.equal(dayStatus(doc).textContent, 'ממתין לאישור');
  assert.equal(dayStatus(doc).classList.contains('attendance-control__row-status--ok'), false);
  assert.match(doc.querySelector('.attendance-control__employee-record-progress').textContent, /1 ממתינות לאישור/);
  assert.equal(doc.querySelector('[data-payroll-finish]').disabled, true);
  approveAttendanceEntryCurrent(result.notCompared[1]);
  doc = render(result);
  assert.equal(dayStatus(doc).textContent, '✓ אושר');
  assert.equal(dayStatus(doc).classList.contains('attendance-control__row-status--ok'), true);
  assert.equal(doc.querySelector('[data-payroll-finish]').disabled, false);
  assert.match(attendanceControlStylesHtml(), /row-status\{[^}]*color:#316da8/);
});

test('regular dashboard activity keeps comparison while operations and time cancellation use report details', () => {
  const attendance = normalizeAttendanceApiRows([record({ activityType: 'קורס', trainingMode: '' })]);
  const doc = render(compareAttendanceRows(attendance, [{ ...attendance[0], startTime: '13:00', activityId: 'activity' }]));
  assert.match(report(doc).textContent, /בדיקת הרשומה מול הדשבורד/);
  assert.equal(report(doc).querySelectorAll('thead th').length, 5);
  for (const activityType of ['תפעול', 'ביטול זמן']) {
    const independent = report(render(resultFor({ activityType, trainingMode: '' })));
    assert.equal(independent.querySelectorAll('thead th').length, 2);
    assert.doesNotMatch(independent.textContent, /אופן קיום ההכשרה/);
    assert.match(independent.textContent, /ממתין לאישור/);
  }
});

test('source travel review no longer hides training details and does not imply record approval', () => {
  const result = resultFor({ trainingMode: 'physical', destinationAddress: 'יקום', kilometers: 80,
    reviewStatus: 'auto_matched', calculatedCancellationMinutes: 10,
    reportedOutboundMinutes: 50, reportedReturnMinutes: 50 });
  const doc = render(result);
  assert.match(report(doc).textContent, /אופן קיום ההכשרהפרונטלי/);
  assert.match(report(doc).textContent, /בדיקת ביטול זמן/);
  assert.match(report(doc).textContent, /מאושר לתשלוםטרם אושר/);
  assert.equal(dayStatus(doc).textContent, 'ממתין לאישור');
});

test('editing independent reports keeps existing inputs and locks online travel inputs', () => {
  for (const trainingMode of ['online', 'physical']) {
    const result = resultFor({ trainingMode }); result.notCompared[0].__recordEditing = true;
    const doc = render(result);
    assert.ok(report(doc).querySelector('[data-field-key="startTime"]'));
    assert.ok(report(doc).querySelector('[data-attendance-save-record]'));
    assert.equal(Boolean(report(doc).querySelector('input[data-field-key="kilometers"]')), trainingMode === 'physical');
  }
});

test('online and unknown training cannot generate dashboard route stops from a stored address', async () => {
  for (const trainingMode of ['online', '']) {
    const attendance = normalizeAttendanceApiRows([record({ trainingMode, destinationAddress: 'יקום' })]);
    const api = { attendanceControlDashboardSources: async () => ({ activities: [], contacts: [], travelCache: [] }) };
    const rows = await loadAttendanceDashboardDataset(attendance, api, '2026-10');
    assert.equal(rows.filter(r => r.__routeOnly).length, 0);
  }
});

test('both actual bridge RPC paths preserve training mode, expenses and hours through approval/export', async () => {
  const source = readFileSync(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export .*;\n/gm, '');
  const raw = { record_id: record().recordId, employee_id: '1550', attendance_date: '2026-10-29',
    activity_type: 'הכשרה', training_mode: 'online', start_time: '13:45', end_time: '15:00',
    work_hours: 1.25, kilometers: 0, total_expenses: 12, program_name: 'פורצות דרך' };
  const api = {};
  vm.runInNewContext(source, { api, waitForSupabaseAuthSession: async () => null,
    supabase: { rpc: async name => ({ error: null, data: name === 'get_payroll_attendance_records' ? [raw]
      : name === 'get_manager_attendance_review_snapshot' ? { records: [raw] } : [] }) } });
  const direct = await api.attendanceControlRecords({ employeeIds: ['1550'] });
  const snapshot = await api.managerAttendanceReviewSnapshot({ employeeId: '1550', monthKey: '2026-10' });
  for (const rows of [direct, snapshot.records]) {
    assert.equal(rows[0].trainingMode, 'online');
    const result = compareAttendanceRows(normalizeAttendanceApiRows(rows), []);
    approveAttendanceEntryCurrent(result.notCompared[0]);
    assert.equal(result.notCompared[0].final.workHours, 1.25);
    assert.equal(result.notCompared[0].final.expenses, 12);
    assert.equal(result.notCompared[0].final.kilometers, 0);
    const wb = buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.notCompared], []);
    const exported = XLSX.utils.sheet_to_json(wb.Sheets['פירוט מלא'], { header: 1 })[1];
    assert.equal(exported[5], '1:15');
    assert.equal(exported[12], 0);
    assert.equal(exported[15], 12);
    assert.equal(rows[0].trainingMode, 'online');
  }
});
