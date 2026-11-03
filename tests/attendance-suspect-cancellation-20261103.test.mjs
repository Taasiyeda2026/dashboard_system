import test from 'node:test';
import assert from 'node:assert/strict';
import { isSuspectCancellationRequest, cancellationRequestedMinutes, instructorReportedCancellationMinutes } from '../attendance/src/services/cancellation-segments.js';
import { reportedCancellationHours } from '../attendance/src/components/monthly-report-summary.js';

test('October 2026 clock-like cancellation segments are quarantined, not counted as hours', () => {
  const samples = [[570,690],[900,1035],[450,690],[480,690]];
  for (const [before, after] of samples) {
    const r = { cancellation_before_minutes: before, cancellation_after_minutes: after };
    assert.equal(isSuspectCancellationRequest(r), true);
    assert.equal(cancellationRequestedMinutes(r), null);
    assert.equal(instructorReportedCancellationMinutes(r), null);
    assert.equal(reportedCancellationHours([{ ...r, activity_type: 'קורס', total_hours: 2 }]), 0);
  }
});

test('Valid reported cancellation durations still contribute and zero is preserved', () => {
  const safe = { cancellation_before_minutes: 60, cancellation_after_minutes: 40 };
  assert.equal(isSuspectCancellationRequest(safe), false);
  assert.equal(cancellationRequestedMinutes(safe), 100);
  assert.equal(instructorReportedCancellationMinutes(safe), 100);
  assert.equal(instructorReportedCancellationMinutes({ cancellation_before_minutes: 0, cancellation_after_minutes: 0 }), 0);
  assert.equal(reportedCancellationHours([{ ...safe, activity_type: 'קורס' }]), 100 / 60);
});
