import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { translateApiErrorForUser } from '../frontend/src/screens/shared/ui-hebrew.js';

const sql = await readFile(
  new URL('../supabase/migrations/20260904130000_allow_unchanged_historical_school_calendar_dates.sql', import.meta.url),
  'utf8',
);

test('calendar trigger validates inserts and newly changed blocked dates', () => {
  assert.match(sql, /tg_op = 'INSERT' or activity_date is distinct from old_activity_date or old_conflict_title is null/);
  assert.match(sql, /message = 'activity_date_on_school_holiday'/);
});

test('unchanged historical blocked dates do not block notes or location corrections', () => {
  assert.match(sql, /activity_date is not distinct from old_activity_date/);
  assert.match(sql, /school_calendar_event_applies\(sc\.calendar_sector, old_activity_sector\)/);
  assert.match(sql, /old_conflict_title is null/);
});

test('school sector changes reject a newly introduced calendar violation', () => {
  assert.match(sql, /school_calendar_sector_for_school_id\(new\.school_id\)/);
  assert.match(sql, /school_calendar_sector_for_school_id\(old\.school_id\)/);
  // A conflict in the new sector is allowed only when that same date was
  // already blocked in the old sector; otherwise old_conflict_title stays null.
  assert.match(sql, /conflict_title is not null[\s\S]*old_conflict_title is null/);
});

test('Eden 30.09 exception and shortened-day protection remain in the trigger', () => {
  assert.match(sql, /school_calendar_eden_20260930_request/);
  assert.match(sql, /approved_holiday_activity_2026_09_30/);
  assert.match(sql, /activity_after_shortened_school_day/);
});

test('technical holiday constraint is translated into a clear Hebrew message', () => {
  assert.equal(
    translateApiErrorForUser('23514 | activity_date_on_school_holiday | 2026-10-27|יום הבחירות לכנסת ה-26'),
    'לא ניתן לשמור פעילות בתאריך 27.10.2026 – יום הבחירות לכנסת ה-26.',
  );
});
