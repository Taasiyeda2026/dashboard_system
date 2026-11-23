import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mergeDailyTravelLegValues } from '../attendance/src/services/daily-travel-leg-merge.js';
import { summarizeDailyTravel } from '../attendance/src/services/daily-travel.js';
import { instructorAttendanceError } from '../attendance/src/services/instructor-error.service.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('merge preserves saved km on same-location between legs instead of forcing zero', () => {
  const preview = {
    kind: 'between', from: 'א', to: 'א', sameLocation: true, gapMinutes: 40, contextFingerprint: 'fp1',
  };
  const saved = {
    kind: 'between', from: 'א', to: 'א', sameLocation: true, kilometers: 12, mode: 'car',
    transportCost: 0, contextFingerprint: 'fp1',
  };
  assert.equal(mergeDailyTravelLegValues(preview, saved).kilometers, 12);
  assert.equal(mergeDailyTravelLegValues(preview, null).kilometers, 0);
  assert.equal(
    mergeDailyTravelLegValues(
      { kind: 'outbound', from: 'בית', to: 'א', contextFingerprint: 'fp1' },
      { kind: 'outbound', from: 'בית', to: 'א', kilometers: 31, minutes: 50, mode: 'car', contextFingerprint: 'fp1' },
    ).kilometers,
    31,
  );
});

test('summarize includes corrected same-location kilometers', () => {
  const legs = [
    { kind: 'outbound', minutes: 60, kilometers: 31, mode: 'car' },
    { kind: 'between', gapMinutes: 40, minutes: 40, kilometers: 8, sameLocation: true, mode: 'car' },
    { kind: 'return', minutes: 70, kilometers: 31, mode: 'car' },
  ];
  assert.deepEqual(summarizeDailyTravel(legs), {
    complete: true, kilometers: 70, cancellationMinutes: 80,
  });
});

test('edit form paints edit note and preserves expenses on re-save', async () => {
  const screen = await read('attendance/src/screens/new-report-screen.js');
  assert.match(screen, /עריכת דיווח מ-\$\{prefill\.report_date/);
  assert.match(screen, /sessionStorage\.removeItem\('av2_edit_record_id'\)/);
  assert.match(screen, /expenses: editingExisting && prefill\?\.expenses/);
  assert.match(screen, /activity_name_snapshot/);
});

test('travel tab uses merge helper and clarifies gap vs distance', async () => {
  const tab = await read('attendance/src/screens/daily-travel-tab.js');
  assert.match(tab, /mergeDailyTravelLegValues/);
  assert.match(tab, /פער שעות בין פעילויות \(לא מרחק נסיעה\)/);
  assert.match(tab, /קילומטרים בפועל/);
  assert.match(tab, /יש להשלים קילומטרים/);
});

test('month-submit missing travel maps to short instructor copy', () => {
  assert.match(
    instructorAttendanceError({ message: 'attendance_daily_travel_reports_missing' }),
    /נסיעות לפני הגשת החודש/,
  );
});

test('staged migration preserves same-location km and caches bumped', async () => {
  const migration = await read('supabase/migrations/20261123120000_preserve_same_location_travel_km.sql');
  const sw = await read('attendance/sw.js');
  const index = await read('attendance/index.html');
  const frontendSw = await read('frontend/sw.js');
  const config = await read('frontend/src/config.js');
  assert.match(migration, /jsonb_typeof\(v_item->'kilometers'\) is distinct from 'number'/);
  assert.match(migration, /do not apply to production without explicit approval/i);
  assert.match(sw, /const CACHE_VERSION = 181/);
  assert.match(index, /\?v=181/);
  assert.doesNotMatch(index, /\?v=180/);
  assert.match(frontendSw, /const CACHE_VERSION = 2127/);
  assert.match(config, /attendance-instructor-ux-upgrade-20261123-v1/);
});
