import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifyTravelComponentOverlap,
  projectedPayrollKilometers,
  buildDailyCanonicalDaySet,
  simulateDayPayrollKm,
  travelAmountsCompatible
} from '../frontend/src/attendance-travel-payroll-exclusivity.js';
import { buildAdminAttendanceTotals } from '../frontend/src/admin-attendance-totals.js';

const migrationPath = new URL('../supabase/migrations/20261119190227_nov_travel_double_pay_guard.sql', import.meta.url);
const migration = await readFile(migrationPath, 'utf8');

const OVERLAP_DAYS = [
  { emp: 1506, date: '2026-11-01', legacy: 6, daily: 6 },
  { emp: 1506, date: '2026-11-02', legacy: 10, daily: 10 },
  { emp: 1537, date: '2026-11-02', legacy: 99, daily: 31.5 },
  { emp: 1540, date: '2026-11-01', legacy: 80, daily: 4 },
  { emp: 1540, date: '2026-11-02', legacy: 8, daily: 4 },
  { emp: 1540, date: '2026-11-03', legacy: 4, daily: 4 },
  { emp: 1544, date: '2026-11-01', legacy: 179, daily: 179 },
  { emp: 1544, date: '2026-11-02', legacy: 108, daily: 109 },
  { emp: 1550, date: '2026-11-02', legacy: 82.5, daily: 87 },
  { emp: 1551, date: '2026-11-02', legacy: 160, daily: 180 }
];

test('migration drops get_payroll_attendance_records before RETURNS TABLE change', () => {
  const dropIdx = migration.search(/drop function if exists public\.get_payroll_attendance_records\(bigint\[\], date, date\);/i);
  const createIdx = migration.search(/create or replace function public\.get_payroll_attendance_records\(/i);
  assert.ok(dropIdx >= 0 && createIdx > dropIdx);
  assert.match(migration, /generation_kind text/);
  assert.match(migration, /daily_canonical/);
  assert.doesNotMatch(migration, /roundtrip_km\s*=\s*0/);
});

test('migration blocks unresolved overlaps on review and payroll dispatch', () => {
  assert.match(migration, /attendance_travel_overlap_unresolved/);
  assert.match(migration, /av2_travel_day_has_unresolved_overlap/);
  assert.match(migration, /av2_resolve_travel_payroll_component/);
  assert.match(migration, /attendance_travel_payroll_resolutions/);
  assert.match(migration, /av2_november_travel_legacy_conflict/);
  assert.match(migration, /av2_assert_payroll_travel_review_ready/);
  assert.match(migration, /pg_advisory_xact_lock/);
});

test('compatible amounts are not conflicts; unequal amounts require decision', () => {
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 179, dailyValue: 179 }), 'compatible');
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 99, dailyValue: 31.5 }), 'conflict');
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 129, dailyValue: 0, noTravel: true }), 'no_travel_vs_legacy');
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 80, dailyValue: 0 }), 'legacy_only_with_daily_zero');
  assert.ok(travelAmountsCompatible(108, 108.005));
});

test('Mohammed 1538 / 01.11 stays legacy-only until daily exists; matching daily does not double', () => {
  const legacyOnly = simulateDayPayrollKm({ legacyKm: 129 });
  assert.equal(legacyOnly.afterFixKm, 129);
  assert.equal(legacyOnly.ifApproveWithoutGuardKm, 129);

  const matchingDailyPending = simulateDayPayrollKm({
    legacyKm: 129, dailyKm: 129, reviewStatus: 'pending_review', unresolvedConflict: false
  });
  assert.equal(matchingDailyPending.afterFixKm, 129);
  assert.equal(matchingDailyPending.ifApproveWithoutGuardKm, 258);

  const matchingApproved = simulateDayPayrollKm({
    legacyKm: 129, dailyKm: 129, reviewStatus: 'approved', payableKm: 129
  });
  assert.equal(matchingApproved.afterFixKm, 129);
  assert.equal(matchingApproved.todayKm, 258);
});

test('ten overlap days: exclusivity prevents 589 km double-pay and does not auto-pay max on conflicts', () => {
  let duplicateExposure = 0;
  let underpayIfBlindDaily = 0;
  let conflicts = 0;
  for (const day of OVERLAP_DAYS) {
    const status = classifyTravelComponentOverlap({ legacyValue: day.legacy, dailyValue: day.daily });
    const sim = simulateDayPayrollKm({
      legacyKm: day.legacy,
      dailyKm: day.daily,
      reviewStatus: 'pending_review',
      unresolvedConflict: status === 'conflict'
    });
    // Duplicate exposure if both sources were summed after approve.
    duplicateExposure += Math.min(day.legacy, day.daily);
    if (status === 'conflict') {
      conflicts += 1;
      underpayIfBlindDaily += Math.max(0, day.legacy - day.daily);
      assert.equal(sim.blocked, true);
      // Keep legacy entitlement until a documented resolution; never auto-approve max().
      assert.equal(sim.afterFixKm, day.legacy);
    } else {
      assert.equal(sim.blocked, false);
      assert.equal(status, 'compatible');
    }
  }
  assert.equal(OVERLAP_DAYS.length, 10);
  assert.equal(conflicts, 6);
  assert.equal(Number(duplicateExposure.toFixed(2)), 589);
  assert.equal(Number(underpayIfBlindDaily.toFixed(2)), 147.5);
});

test('public transport equal overlap is exclusivity-compatible; unequal needs resolution', () => {
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 17.5, dailyValue: 17.5 }), 'compatible');
  assert.equal(classifyTravelComponentOverlap({ legacyValue: 16, dailyValue: 0 }), 'legacy_only_with_daily_zero');
});

test('admin totals include daily payable km once and suppress activity km on canonical days', () => {
  const scope = { monthKey: '2026-11', employeeIds: ['1538'] };
  const activityA = {
    recordId: 'a', employeeId: '1538', attendanceDate: '2026-11-01',
    activityType: 'קורס', workHours: 2, kilometers: 62
  };
  const activityB = {
    recordId: 'b', employeeId: '1538', attendanceDate: '2026-11-01',
    activityType: 'קורס', workHours: 2, kilometers: 67
  };
  const payable = {
    recordId: 'p', employeeId: '1538', attendanceDate: '2026-11-01',
    activityType: 'ביטול זמן', generationKind: 'daily_travel_cancellation',
    workHours: 1, kilometers: 129
  };
  const before = buildAdminAttendanceTotals([activityA, activityB], scope);
  assert.equal(before.totalKilometers, 129);
  const after = buildAdminAttendanceTotals([activityA, activityB, payable], scope);
  assert.equal(after.totalKilometers, 129);
});

test('projectedPayrollKilometers zeros activity rows when daily canonical day exists', () => {
  const days = buildDailyCanonicalDaySet([
    { employeeId: '1544', attendanceDate: '2026-11-01', generationKind: 'daily_travel_cancellation' }
  ]);
  assert.equal(projectedPayrollKilometers({
    employeeId: '1544', attendanceDate: '2026-11-01', kilometers: 179
  }, { dailyCanonicalDays: days }), 0);
  assert.equal(projectedPayrollKilometers({
    employeeId: '1544', attendanceDate: '2026-11-01',
    generationKind: 'daily_travel_cancellation', kilometers: 179
  }, { dailyCanonicalDays: days }), 179);
  assert.equal(projectedPayrollKilometers({
    employeeId: '1544', attendanceDate: '2026-10-31', kilometers: 50
  }, { dailyCanonicalDays: days }), 50);
});

test('bridge and control surfaces wire overlap RPCs and Hebrew gate errors', async () => {
  const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
  const control = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
  const config = await readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  assert.match(bridge, /attendanceControlTravelPayrollOverlaps/);
  assert.match(bridge, /attendanceControlResolveTravelPayrollOverlap/);
  assert.match(bridge, /generation_kind/);
  assert.match(bridge, /attendance_travel_overlap_unresolved/);
  assert.match(control, /data-travel-overlap-resolve/);
  assert.match(control, /חריגת חפיפת נסיעות/);
  assert.match(config, /nov-travel-double-pay-guard-20261119-v1/);
  assert.match(sw, /CACHE_VERSION = 2128/);
});
