import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  attendanceOccurrenceKey,
  buildDashboardCourseOptions,
} from '../attendance/src/services/activities-report.helpers.js';
import { createReportedTravelTable } from '../attendance/src/components/reported-daily-travel.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('occurrence keys prefer activity id and meeting over activity name', () => {
  assert.equal(
    attendanceOccurrenceKey({
      report_date: '2026-11-23',
      activity_row_id: 'row-1',
      meeting_no: 2,
      activity_name_snapshot: 'ignored',
    }),
    'row:2026-11-23:row-1:m:2',
  );
  assert.equal(
    attendanceOccurrenceKey({
      report_date: '2026-11-23',
      activity_name_snapshot: 'only-name',
    }),
    '',
  );
  assert.notEqual(
    attendanceOccurrenceKey({ report_date: '2026-11-23', activity_row_id: 'a', meeting_no: 1 }),
    attendanceOccurrenceKey({ report_date: '2026-11-23', activity_row_id: 'a', meeting_no: 2 }),
  );
});

test('occurrence keys never treat attendance record.id as activity identity', () => {
  const attendancePkOnly = attendanceOccurrenceKey({
    id: 'attendance-pk-uuid',
    report_date: '2026-11-23',
    meeting_no: 1,
    activity_name_snapshot: 'קורס',
  });
  assert.equal(attendancePkOnly, '');

  const withActivityRow = attendanceOccurrenceKey({
    id: 'attendance-pk-uuid',
    activity_row_id: 'dash-row-9',
    report_date: '2026-11-23',
    meeting_no: 1,
  });
  assert.equal(withActivityRow, 'row:2026-11-23:dash-row-9:m:1');

  const legacyBusiness = attendanceOccurrenceKey({
    id: 'attendance-pk-uuid',
    report_date: '2026-11-23',
    meeting_no: 2,
    course_business_identity: { course: 'physics', school_id: 12 },
    start_time: '08:00',
    end_time: '10:00',
  });
  assert.match(legacyBusiness, /^course:2026-11-23:/);
  assert.match(legacyBusiness, /:m:2:t:08:00-10:00$/);

  const byActivityId = attendanceOccurrenceKey({
    id: 'attendance-pk-uuid',
    activity_id: 'act-77',
    report_date: '2026-11-23',
    meeting_no: 1,
  });
  assert.equal(byActivityId, 'activity:2026-11-23:act-77:m:1');
});

test('reported travel table hides public-transport column when unused', () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  globalThis.document = dom.window.document;
  try {
    const withoutTransit = createReportedTravelTable([{
      travel_date: '2026-11-05',
      total_km: 40,
      cancellation_minutes: 30,
      public_transport_cost: 0,
      legs: [{ mode: 'car', kind: 'to' }],
      review_status: 'pending_review',
    }]);
    assert.doesNotMatch(withoutTransit.textContent, /תחבורה ציבורית/);
    assert.ok(withoutTransit.querySelector('.av2-reported-travel__table--no-transit'));
    assert.equal(withoutTransit.querySelectorAll('thead th').length, 4);

    const withTransit = createReportedTravelTable([{
      travel_date: '2026-11-05',
      total_km: 0,
      cancellation_minutes: 0,
      public_transport_cost: 14.5,
      legs: [{ mode: 'public_transport', kind: 'to' }],
      review_status: 'pending_review',
    }]);
    assert.match(withTransit.textContent, /תחבורה ציבורית/);
    assert.equal(withTransit.querySelectorAll('thead th').length, 5);
    assert.match(withTransit.textContent, /₪14\.5/);
  } finally {
    delete globalThis.document;
  }
});

test('new-report keeps success near save and clears it on tab changes', async () => {
  const source = await read('attendance/src/screens/new-report-screen.js');
  assert.match(source, /actionsRow\.after\(successBanner\)/);
  assert.match(source, /clearSuccessBanner\(\)/);
  assert.match(source, /Attendance success must not linger on travel\/expenses/);
  assert.match(source, /פעילות זו כבר דווחה בתאריך זה/);
  assert.match(source, /refreshMonthAttendanceRecords/);
  assert.match(source, /optionIsAlreadyReported/);
});

test('new-report fails closed when month attendance fetch fails before create', async () => {
  const source = await read('attendance/src/screens/new-report-screen.js');
  assert.match(source, /monthAttendanceRecordsReliable/);
  assert.match(source, /reason:\s*'fetch-failed'/);
  assert.match(source, /Fail closed: do not treat a fetch error as an empty month/);
  assert.match(source, /if\s*\(\s*!monthRefresh\.ok\s*\)/);
  assert.match(source, /לא ניתן לוודא שאין דיווח כפול כרגע/);
  // Must not clear the month cache to [] inside the catch (that would look like "no duplicates").
  const catchBlock = source.match(/month attendance load failed:[\s\S]*?return\s*\{[\s\S]*?reason:\s*'fetch-failed'/);
  assert.ok(catchBlock, 'expected fetch-failed return in catch');
  assert.doesNotMatch(catchBlock[0], /monthAttendanceRecords\s*=\s*\[\s*\]/);
});

test('mobile report cards keep balanced padding without forced school ellipsis', async () => {
  const css = await read('attendance/src/styles/mobile-reports.css');
  const contract = await read('attendance/src/styles/mobile-final-contract.css');
  assert.match(css, /padding:\s*10px 14px/);
  assert.match(css, /\.av2-rr-mobile__school[\s\S]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.av2-rr-mobile__school[\s\S]*white-space:\s*normal/);
  assert.doesNotMatch(css, /\.av2-rr-mobile__school[\s\S]*text-overflow:\s*ellipsis/);
  // Final contract must not reintroduce the old 4-column crush or tight side padding.
  assert.match(contract, /\.av2-rr-mobile__summary[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+16px\s*!important/);
  assert.match(contract, /\.av2-rr-mobile__summary[\s\S]*padding:\s*10px 14px\s*!important/);
  assert.doesNotMatch(contract, /grid-template-columns:\s*64px minmax\(0,\s*1fr\) 48px 16px/);
});

test('distinct course schedules become separate picker options', () => {
  const rows = [
    {
      row_id: 'a', activity_name: 'קורס', activity_type: 'course',
      single_school_id: 1, single_school_name: 'א', start_time: '08:00', end_time: '10:00',
    },
    {
      row_id: 'b', activity_name: 'קורס', activity_type: 'course',
      single_school_id: 1, single_school_name: 'א', start_time: '12:00', end_time: '14:00',
    },
  ];
  const options = buildDashboardCourseOptions(rows);
  assert.equal(options.length, 2);
  assert.match(options[0].label, /08:00|12:00/);
});

test('attendance cache markers move with the mobile report fixes', async () => {
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  assert.match(sw, /const CACHE_VERSION = 189/);
  assert.match(index, /\?v=189/);
});
