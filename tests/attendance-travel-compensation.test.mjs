import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateTravelCancellationMinutes } from '../attendance/src/services/travel-compensation.js';
import { HEBREW_ACTIVITY_TYPES, OPERATIONS_REPORT_TYPE } from '../attendance/src/services/activities-report.helpers.js';
import { sourceAttendanceRecords } from '../attendance/src/services/travel-compensation.js';
import { summarizeFinanceAttendance } from '../frontend/src/screens/finance-attendance-summary.js';

const migration = await readFile(new URL('../supabase/migrations/20260908100000_attendance_travel_compensation.sql', import.meta.url), 'utf8');
const edge = await readFile(new URL('../supabase/functions/attendance-travel-compensation/index.ts', import.meta.url), 'utf8');
const report = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const select = await readFile(new URL('../attendance/src/components/searchable-select.js', import.meta.url), 'utf8');
const home = await readFile(new URL('../attendance/src/screens/home-screen.js', import.meta.url), 'utf8');
const dialog = await readFile(new URL('../attendance/src/submit-confirmation-dialog.js', import.meta.url), 'utf8');
const manager = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');

test('activity order and canonical operations value remain exact', () => {
  assert.deepEqual(HEBREW_ACTIVITY_TYPES, ['קורס','סדנה','סיור','זום','חדר בריחה','הכשרה','ביטול זמן','תפעול']);
  assert.equal(OPERATIONS_REPORT_TYPE, 'תפעול');
});

test('45 minute allowance is applied independently in both directions', () => {
  assert.equal(calculateTravelCancellationMinutes(45,45), 0);
  assert.equal(calculateTravelCancellationMinutes(60,45), 15);
  assert.equal(calculateTravelCancellationMinutes(85,80), 75);
  assert.equal(calculateTravelCancellationMinutes(30,100), 55);
});

test('operation options are managed, active-only and preserve legacy snapshots through other', () => {
  assert.match(migration, /attendance_operation_options/);
  assert.match(migration, /'הרמת כוסית'[\s\S]*'אחר'/);
  assert.match(report, /legacyOperationSnapshot[\s\S]*matchedOperation[\s\S]*otherOperation/);
  assert.match(report, /chosen\?\.is_other \? trainingDescField\.input\.value\.trim\(\) :/);
});

test('activity search is extended-only while authority and school keep default search', () => {
  assert.match(report, /id: 'av2-activity-name'[\s\S]*searchMode: 'extended-only'/);
  assert.match(select, /searchWrap\.hidden = searchMode === 'extended-only'/);
  assert.match(select, /חזרה לפעילויות שלי/);
  assert.doesNotMatch(report.match(/id: 'av2-authority'[\s\S]*?onChange/s)?.[0] || '', /searchMode: 'extended-only'/);
  for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) assert.match(select, new RegExp(key));
});

test('server route endpoint trusts canonical ids, not injected addresses or minutes', () => {
  assert.match(edge, /db\.auth\.getUser\(token\)/);
  assert.match(edge, /av2_prepare_attendance_travel/);
  assert.match(edge, /\['origin','destination','outbound','return_minutes','emp_id'\]/);
  assert.match(edge, /travelMode: 'DRIVE'/);
  assert.doesNotMatch(edge, /TRANSIT|40\s*km|40-km/i);
  assert.match(migration, /a\.emp_id::text=v_emp::text or a\.emp_id_2::text=v_emp::text/);
  assert.match(migration, /activity_schools/);
  assert.match(migration, /not in \('זום','תפעול','הכשרה','ביטולזמן'\)/);
});

test('generated cancellation lifecycle is nullable-clock, unique, idempotent and distinct from manual cancellation', () => {
  assert.match(migration, /alter column start_time drop not null/);
  assert.match(migration, /generation_kind = 'travel_time_cancellation'[\s\S]*start_time is null[\s\S]*end_time is null/);
  assert.match(migration, /unique index[\s\S]*one_travel_cancellation_per_source/);
  assert.match(migration, /on conflict\(source_attendance_record_id\)/);
  assert.match(migration, /on delete cascade/);
  assert.match(migration, /generation_kind is null and source_attendance_record_id is null and start_time is not null/);
});

test('route context changes reset overrides while unchanged context is preserved', () => {
  assert.match(migration, /changed := not found or old\.route_context_fingerprint is distinct from/);
  assert.match(migration, /if changed then[\s\S]*manually_overridden=false,override_by=null,override_at=null/);
  assert.match(edge, /context_changed === false && context\.calculation_status === 'resolved'/);
});

test('source-only instructor counts exclude generated payable rows', () => {
  const rows = sourceAttendanceRecords([{ id: 'source' }, { id: 'child', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'source' }, { id: 'manual', activity_type: 'ביטול זמן' }]);
  assert.deepEqual(rows.map((row) => row.id), ['source','manual']);
  assert.match(home, /buildStat\(sourceRecords\.length/);
  assert.match(home, /sourceCount: sourceRecords\.length/);
});

test('generated cancellation is the only finance contribution and manager receives its audit', () => {
  const approval = { status: 'approved_for_payroll', employee_id: '12', approved_snapshot: { rows: [
    { employeeId: '12', date: '2026-09-02', activityType: 'קורס', workHours: 2 },
    { employeeId: '12', date: '2026-09-02', activityType: 'ביטול זמן', workHours: 1.25, generationKind: 'travel_time_cancellation' }
  ] } };
  const result = summarizeFinanceAttendance([approval]);
  assert.equal(result.rows[0].hours.time_cancel, 1.25);
  assert.match(bridge, /calculatedCancellationMinutes/);
  assert.match(manager, /נערך ידנית[\s\S]*מחושב במקור/);
  assert.match(migration, /attendance_generated_record_protected/);
});

test('monthly submission is guarded server-side and uses internal single-flight modal', () => {
  assert.match(migration, /av2_submit_attendance_month/);
  assert.match(migration, /attendance_travel_compensation_unresolved/);
  assert.match(migration, /before insert or update on public\.attendance_month_approvals/);
  assert.match(migration, /route_context_fingerprint is distinct from/);
  assert.doesNotMatch(home, /\bconfirm\s*\(|\balert\s*\(/);
  assert.match(dialog, /role', 'dialog'/);
  assert.match(dialog, /if \(busy\) return/);
  assert.match(dialog, /נסה לחשב שוב/);
});
