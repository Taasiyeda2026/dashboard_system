import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  formatCancellationDuration, parseCancellationDuration,
  canReportInlineCancellation, cancellationRequestedMinutes,
} from '../attendance/src/services/cancellation-segments.js';

const read = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');
const [create, edit, migration, control, bridge] = await Promise.all([
  read('attendance/src/screens/new-report-screen.js'),
  read('attendance/src/screens/my-reports-screen.js'),
  read('supabase/migrations/20261013093000_unified_attendance_travel_time_cancellation.sql'),
  read('frontend/src/screens/attendance-control.js'),
  read('frontend/src/payroll-attendance-v2-bridge.js'),
]);

test('explicit duration fields accept clock hours:minutes and preserve zero', () => {
  assert.equal(parseCancellationDuration('0:00'), 0);
  assert.equal(parseCancellationDuration('1:44'), 104);
  assert.equal(parseCancellationDuration('12:05'), 725);
  assert.equal(parseCancellationDuration('01:60'), null);
  assert.equal(parseCancellationDuration('-1:00'), null);
  assert.equal(parseCancellationDuration('25:00'), null);
  assert.equal(formatCancellationDuration(104), '1:44');
});

test('inline cancellation is eligible only on physical source activities', () => {
  assert.equal(canReportInlineCancellation({ activityType: 'קורס' }), true);
  assert.equal(canReportInlineCancellation({ activityType: 'הכשרה' }), true);
  assert.equal(canReportInlineCancellation({ activityType: 'הכשרה', online: true }), false);
  assert.equal(canReportInlineCancellation({ activityType: 'ביטול זמן' }), false);
  assert.equal(cancellationRequestedMinutes({
    cancellation_before_minutes: 52, cancellation_after_minutes: 52,
    total_hours: 2
  }), 104);
  assert.equal(cancellationRequestedMinutes({ total_hours: 2 }), null);
});

test('new and edit forms keep separate before/after segments and physical venue', () => {
  for (const screen of [create, edit]) {
    assert.match(screen, /cancellation_before_minutes/);
    assert.match(screen, /cancellation_after_minutes/);
    assert.match(screen, /trainingLocationField/);
    assert.match(screen, /canReportInlineCancellation/);
    assert.match(screen, /parseCancellationDuration/);
  }
  assert.match(create, /trainingLocationField\.wrap/);
  assert.match(edit, /publicTransportToggle\.checked/);
  assert.match(create, /total_hours: totalHours/);
  assert.match(edit, /total_hours:\s+totalHours/);
});

test('SQL preserves course timestamps and gates cancellation behind manager approval', () => {
  assert.match(migration, /add column if not exists cancellation_before_minutes integer/);
  assert.match(migration, /add column if not exists cancellation_after_minutes integer/);
  assert.match(migration, /av2_compute_source_travel_review_status/);
  assert.match(migration, /when c\.review_status in \('approved', 'corrected'\)/);
  assert.match(migration, /only clears unapproved/);
  assert.doesNotMatch(migration, /set\s+total_hours\s*=\s*cancellation_/);
  assert.match(bridge, /reportedCancellationBeforeMinutes/);
  assert.match(control, /דיווח ביטול זמן \(לפני\/אחרי\)/);
});
