import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { exportMonthToExcel } from '../attendance/src/services/excel.service.js';

const source = {
  id: 'course', report_date: '2026-10-15', activity_type: 'קורס',
  total_hours: 2, start_time: '08:00', end_time: '09:30',
  roundtrip_km: 40, expenses: 15,
};
const generated = {
  id: 'generated', report_date: source.report_date, activity_type: 'ביטול זמן',
  generation_kind: 'travel_time_cancellation', source_attendance_record_id: source.id,
  total_hours: 0.5, roundtrip_km: 0, expenses: 0,
};
const reported = { ...source, cancellation_before_minutes: 60, cancellation_after_minutes: 30 };

for (const [name, records, expectedHours] of [
  ['work only', [source], 2],
  ['reported cancellation before approval', [reported], 3.5],
  ['reported cancellation with a different approved generated amount', [reported, generated], 3.5],
  ['explicit zero request with a stale generated amount', [{ ...source, cancellation_before_minutes: 0, cancellation_after_minutes: 0 }, generated], 2],
  ['legacy compensation request with an approved generated amount', [{ ...source, travel_compensation: { requested_cancellation_minutes: 90, approved_cancellation_minutes: 30 } }, generated], 3.5],
  ['legacy generated cancellation without a reported request', [source, generated], 2.5],
  ['standalone cancellation plus an inline request and generated row', [reported, generated, { ...generated, id: 'standalone', generation_kind: null, source_attendance_record_id: null, total_hours: 0.75 }], 4.25],
  ['durations exceeding 24 hours', [{ ...reported, total_hours: 26 }], 27.5],
  ['empty month', [], 0],
]) {
  test(`instructor Excel total matches subtotals: ${name}`, () => {
    const before = structuredClone(records);
    let exported;
    globalThis.window = { XLSX: { ...XLSX, writeFile: value => { exported = value; } } };
    exportMonthToExcel(records, { name: 'בדיקה', empId: 1 }, 2026, 10);
    assert.ok(exported);
    const workbook = XLSX.read(XLSX.write(exported, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellNF: true });
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets['סיכום'], { range: 2 });
    const total = summary.find(row => row['סוג פעילות'] === 'סה"כ');
    const subtotals = summary.filter(row => row['סוג פעילות'] && row['סוג פעילות'] !== 'סה"כ');
    assert.equal(Math.round(total['שעות'] * 1440), expectedHours * 60);
    assert.equal(Math.round(subtotals.reduce((sum, row) => sum + row['שעות'], 0) * 1440), expectedHours * 60);
    assert.equal(total['ק"מ'], records.reduce((sum, row) => sum + row.roundtrip_km, 0));
    assert.equal(total['הוצאות (₪)'], records.reduce((sum, row) => sum + row.expenses, 0));
    const sheet = workbook.Sheets['סיכום'];
    const totalCell = Object.keys(sheet).find(key => /^A\d+$/.test(key) && sheet[key].v === 'סה"כ');
    assert.equal(sheet[totalCell.replace('A', 'C')].z, '[h]:mm');
    if (records.length) assert.equal(workbook.Sheets['רשומות'].E4.v * 24, records[0].total_hours);
    assert.deepEqual(records, before);
  });
}
