import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildDailyHoursByDate,
  buildMonthlySummaryItems,
  formatDurationHours,
  groupReportRecordsByDate
} from '../attendance/src/components/monthly-report-summary.js';
import { createReportDaySummaryRow } from '../attendance/src/components/report-summary-row.js';
import { readFile } from 'node:fs/promises';

test('daily hours include generated travel cancellation', () => {
  const records = [
    { id: 'course', report_date: '2026-09-02', total_hours: 1.83, activity_type: 'קורס', activity_name_snapshot: 'ביומימיקרי' },
    { id: 'cancel', report_date: '2026-09-02', total_hours: 1.75, activity_type: 'ביטול זמן', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course' }
  ];
  const totals = buildDailyHoursByDate(records);
  assert.equal(Math.round(totals.get('2026-09-02') * 100), 358);
  const [day] = groupReportRecordsByDate(records);
  assert.equal(Math.round(day.totalHours * 100), 358);
  assert.equal(day.cancellationHours, 1.75);
  assert.equal(formatDurationHours(day.totalHours), '3:35');
});

test('monthly cards omit empty metrics and include only existing attendance data', () => {
  const items = buildMonthlySummaryItems([
    { activity_type: 'קורס', total_hours: 3.5, roundtrip_km: 95, expenses: 0 },
    { activity_type: 'ביטול זמן', total_hours: 1.75, generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course', roundtrip_km: 0, expenses: 0 }
  ]);
  assert.deepEqual(items.map((item) => item.label), ['סה״כ שעות קורס', 'סה״כ ביטול זמן', 'סה״כ ק״מ']);
  assert.ok(!items.some((item) => item.label === 'סה״כ הוצאות'));
  assert.equal(items.find((item) => item.label === 'סה״כ שעות קורס').value, '3:30');
});

test('home daily row shows one daily total and activity types in the opened detail', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  const day = groupReportRecordsByDate([
    { id: 'course', report_date: '2026-09-02', total_hours: 1.83, activity_type: 'קורס', activity_name_snapshot: 'ביומימיקרי', school_name_snapshot: 'מקיף אבו גוש' },
    { id: 'cancel', report_date: '2026-09-02', total_hours: 1.75, activity_type: 'ביטול זמן', activity_name_snapshot: 'ביטול זמן מחושב', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course' }
  ])[0];
  const row = createReportDaySummaryRow(day);
  assert.match(row.textContent, /3:35/);
  const button = row.querySelector('.av2-report-summary-row__toggle');
  button.click();
  assert.match(row.textContent, /קורס/);
  assert.match(row.textContent, /ביטול זמן/);
  assert.equal(row.querySelector('.av2-report-summary-row__details').hidden, false);
  delete globalThis.document;
});

test('mobile expanded report explicitly exposes activity type', async () => {
  const enhancer = await readFile(new URL('../attendance/src/mobile-reports-enhancer.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../attendance/src/styles/mobile-reports.css', import.meta.url), 'utf8');
  assert.match(enhancer, /setMobileLabel\(typeCell, 'סוג פעילות'\)/);
  assert.match(css, /is-mobile-expanded > \.av2-rr__type/);
});

test('decimal attendance hours are presented as clock durations', () => {
  assert.equal(formatDurationHours(1.83), '1:50');
  assert.equal(formatDurationHours(1.75), '1:45');
  assert.equal(formatDurationHours(1.5), '1:30');
  assert.equal(formatDurationHours(3), '3:00');
});

test('attendance UI uses H:MM formatting instead of decimal hours', async () => {
  const [reports, home, newReport, summaryRow, referenceLayout] = await Promise.all([
    readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8'),
    readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8'),
    readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8'),
    readFile(new URL('../attendance/src/components/report-summary-row.js', import.meta.url), 'utf8'),
    readFile(new URL('../attendance/src/reference-data-layout.js', import.meta.url), 'utf8'),
  ]);
  assert.match(reports, /hoursCell\.textContent = formatDurationHours\(record\.total_hours\)/);
  assert.match(home, /buildStat\(formatDurationHours\(summary\.totalHours\)/);
  assert.match(newReport, /h > 0 \? formatDurationHours\(h\) : '—'/);
  assert.match(summaryRow, /hours\.textContent = formatDurationHours\(record\.total_hours\)/);
  assert.match(referenceLayout, /durationNumberFrom\(text\(row\.querySelector\('\.av2-rr__hours'\)\)\)/);
  assert.doesNotMatch(reports, /record\.total_hours[^\n]*toFixed\(2\)/);
  assert.doesNotMatch(summaryRow, /record\.total_hours[^\n]*toFixed\(2\)/);
});

