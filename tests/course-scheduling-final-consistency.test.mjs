import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';

const migrationUrl = new URL('../supabase/migrations/20260807223000_course_scheduling_final_consistency.sql', import.meta.url);

test('route service configuration failure is fail-closed', async () => {
  const result = await calculateCandidateTravel([], [], {
    unavailableReason: 'google_key_not_configured',
    googleCalls: 0,
    cacheHits: 0,
    requests: [],
    request: async () => null
  });
  assert.equal(result.unavailableReason, 'route_service_unavailable');

  const screen = await readFile(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  assert.match(screen, /ההצעות מציגות רק מדריכים שאומתו בבטחה/);
});

test('direct activity instructor changes use the scheduling hard gates', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /scheduling_validate_direct_activity_assignment_after_write/);
  assert.match(sql, /scheduling_course_instructor_violations\(new\.row_id, holder, false\)/);
  assert.match(sql, /scheduling_assert_home_route\(holder, new\.row_id\)/);
  assert.match(sql, /scheduling_assert_assignment_calendar\(new\.row_id, holder, meetings\)/);
  assert.match(sql, /instructor_name_mismatch/);
  assert.match(sql, /new\.instructor_assignment_locked := true/);
  assert.match(sql, /new\.instructor_assignment_status := 'שובץ'/);
});

test('school calendar changes revalidate locked courses', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /scheduling_school_calendar_validation_reason/);
  assert.match(sql, /activity_date_on_school_holiday/);
  assert.match(sql, /activity_after_shortened_school_day/);
  assert.match(sql, /school_calendar_revalidate_locked_assignments/);
  assert.match(sql, /after insert or update or delete on public\.school_calendar/);
});

test('service worker cache is advanced', async () => {
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /const CACHE_VERSION = 1422;/);
});
