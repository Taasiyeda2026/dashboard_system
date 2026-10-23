import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { JSDOM } from 'jsdom';
import {
  roundCancellationMinutesUp, parseCancellationDuration, formatCancellationDuration,
  instructorReportedCancellationMinutes, cancellationMinutesForSave,
} from '../attendance/src/services/cancellation-segments.js';
import { reportedCancellationHours, buildMonthlySummaryItems } from '../attendance/src/components/monthly-report-summary.js';
import { exportMonthToExcel } from '../attendance/src/services/excel.service.js';

test('cancellation always rounds upward to five minutes, including hour boundaries', () => {
  for (const [input, expected] of [[0, 0], [1, 5], [5, 5], [6, 10], [59, 60], [60, 60], [87, 90], [90, 90], [102, 105], [119, 120], [1440, 1440]]) {
    assert.equal(roundCancellationMinutesUp(input), expected, String(input));
    assert.equal(roundCancellationMinutesUp(expected), expected, 'rounding is idempotent');
  }
  assert.equal(parseCancellationDuration('1:27'), 90);
  assert.equal(parseCancellationDuration('1:42'), 105);
  assert.equal(formatCancellationDuration(87), '1:30');
  assert.equal(formatCancellationDuration(102), '1:45');
  assert.equal(parseCancellationDuration('1:60'), null);
  assert.equal(parseCancellationDuration('24:01'), null);
});

test('historical reviewed requests retain their stored minutes while their display rounds upward', () => {
  const record = { cancellation_before_minutes: 87, cancellation_after_minutes: 102, travel_compensation: { review_status: 'approved', approved_cancellation_minutes: 120 } };
  assert.equal(instructorReportedCancellationMinutes(record), 195);
  assert.equal(cancellationMinutesForSave('1:30', record, 'cancellation_before_minutes'), 87);
  assert.equal(cancellationMinutesForSave('1:45', record, 'cancellation_after_minutes'), 102);
  assert.equal(cancellationMinutesForSave('1:35', record, 'cancellation_before_minutes'), 95);
  assert.equal(cancellationMinutesForSave('1:27', null, 'cancellation_before_minutes'), 90);
  assert.equal(instructorReportedCancellationMinutes({ travel_compensation: { requested_cancellation_minutes: 87 } }), 90);
  assert.equal(instructorReportedCancellationMinutes({ travel_compensation: { requested_cancellation_minutes: null } }), null);
});

test('cancellation summaries and Excel share rounded durations without rounding activity hours or double counting', () => {
  const records = [
    { id: 'source', report_date: '2026-10-24', activity_type: 'קורס', total_hours: 1.45, cancellation_before_minutes: 87, cancellation_after_minutes: 102 },
    { id: 'generated', report_date: '2026-10-24', activity_type: 'ביטול זמן', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'source', total_hours: 1 },
    { id: 'standalone', report_date: '2026-10-24', activity_type: 'ביטול זמן', total_hours: 1.45 },
  ];
  const before = structuredClone(records);
  assert.equal(reportedCancellationHours(records), 4.75);
  const cards = buildMonthlySummaryItems(records);
  assert.equal(cards.find(card => card.activityType === 'ביטול זמן').value, '4:45');
  assert.equal(cards.find(card => card.activityType === 'קורס').value, '1:27');
  let workbook;
  globalThis.window = { XLSX: { ...XLSX, writeFile: value => { workbook = value; } } };
  exportMonthToExcel(records, { empId: 1, name: 'בדיקה' }, 2026, 10);
  const saved = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  assert.equal(Math.round(saved.Sheets['רשומות'].E4.v * 1440), 87);
  assert.equal(Math.round(saved.Sheets['רשומות'].F4.v * 1440), 195);
  assert.equal(Math.round(saved.Sheets['רשומות'].E6.v * 1440), 90);
  const rows = XLSX.utils.sheet_to_json(saved.Sheets['סיכום'], { range: 2 });
  assert.equal(Math.round(rows.find(row => row['סוג פעילות'] === 'ביטול זמן')['שעות'] * 1440), 285);
  assert.equal(Math.round(rows.find(row => row['סוג פעילות'] === 'סה"כ')['שעות'] * 1440), 372);
  assert.deepEqual(records, before);
});

test('instructor form rounds entered cancellation and saves five-minute values', async () => {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test/attendance/?adminPreview=1' });
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLSelectElement', 'MutationObserver', 'Event', 'CustomEvent', 'sessionStorage']) globalThis[name] = dom.window[name];
  globalThis.requestAnimationFrame = callback => callback();
  window.supabase = { createClient: () => ({ rpc: async () => { throw new Error('Unexpected production call'); } }) };
  const { renderNewReportScreen } = await import('../attendance/src/screens/new-report-screen.js');
  const { createRecord, getMonthRecords } = await import('../attendance/src/services/attendance.service.js');
  const { PREVIEW_EMP_ID } = await import('../attendance/src/preview/preview-mode.js');
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  renderNewReportScreen(document.getElementById('app'), {
    instructor: { empId: PREVIEW_EMP_ID }, defaultDate: date,
    prefillRecord: { id: 'duplicated-reviewed-source', report_date: date, activity_type: 'תפעול', activity_name_snapshot: 'הרמת כוסית', start_time: '08:00', end_time: '10:00', cancellation_before_minutes: 87, cancellation_after_minutes: 102, travel_compensation: { review_status: 'approved' }, notes: 'rounding-audit' },
  });
  await flush();
  for (const [id, entered, expected] of [['av2-cancellation-before', '1:27', '1:30'], ['av2-cancellation-after', '1:42', '1:45']]) {
    const input = document.getElementById(id);
    input.value = entered;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(input.value, expected);
  }
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  const records = await getMonthRecords(PREVIEW_EMP_ID, now.getFullYear(), now.getMonth() + 1);
  const saved = records.find(record => record.notes === 'rounding-audit');
  assert.ok(saved, document.querySelector('.av2-report__error')?.textContent);
  assert.equal(saved.cancellation_before_minutes, 90);
  assert.equal(saved.cancellation_after_minutes, 105);
  assert.equal(saved.total_hours, 2);
  const standalone = await createRecord(PREVIEW_EMP_ID, { report_date: date, activity_type: 'ביטול זמן', total_hours: 1.45 });
  assert.equal(standalone.total_hours, 1.5);
  dom.window.close();
});
