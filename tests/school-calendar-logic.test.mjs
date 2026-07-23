import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockingSchoolCalendarEvent,
  buildWeeklyDatesSkippingSchoolCalendar,
  compactSchoolCalendarLabel,
  isSummerActivitySeason,
  shortenedSchoolDayConflict
} from '../frontend/src/screens/shared/school-calendar-logic.js';

const rows = [
  {
    external_key: 'holiday',
    title: 'חופשת סוכות',
    start_date: '2026-09-22',
    end_date: '2026-09-29',
    blocks_scheduling: true,
    show_on_main_calendar: true,
    is_active: true
  },
  {
    external_key: 'short',
    title: 'יום הזיכרון',
    start_date: '2027-05-11',
    end_date: '2027-05-11',
    school_day_end_time: '12:00:00',
    enforce_end_time: true,
    show_on_main_calendar: true,
    is_active: true
  }
];

test('finds a blocking event inside a date range', () => {
  assert.equal(blockingSchoolCalendarEvent(rows, '2026-09-24')?.title, 'חופשת סוכות');
  assert.equal(blockingSchoolCalendarEvent(rows, '2026-10-01'), null);
});

test('weekly sequence skips holiday weeks and preserves the number of meetings', () => {
  assert.deepEqual(
    buildWeeklyDatesSkippingSchoolCalendar(rows, '2026-09-15', 4),
    ['2026-09-15', '2026-10-06', '2026-10-13', '2026-10-20']
  );
});

test('detects an activity that ends after a shortened school day', () => {
  assert.equal(shortenedSchoolDayConflict(rows, '2027-05-11', '12:30')?.title, 'יום הזיכרון');
  assert.equal(shortenedSchoolDayConflict(rows, '2027-05-11', '11:45'), null);
});

test('creates a compact label', () => {
  assert.equal(compactSchoolCalendarLabel(rows, { maxTitles: 2 }), 'חופשת סוכות · יום הזיכרון עד 12:00');
});

test('recognizes summer seasons as allowed exceptions', () => {
  assert.equal(isSummerActivitySeason('summer_2026'), true);
  assert.equal(isSummerActivitySeason('school_2027'), false);
});
