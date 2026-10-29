import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staffFinalReadiness, staffFinalExpiryWarning } from '../frontend/src/impact-feedback/staff-delivery-status.js';

const now = Date.parse('2026-10-29T03:25:00Z'); // Israel, 29 October at 05:25

test('an already opened final-feedback link does not make a future course due', () => {
  const readiness = staffFinalReadiness({
    endDate: '2026-12-28',
    eligibilityAt: '2026-12-28T22:00:00Z',
    eligibilityStatus: 'not_due',
    now
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.label, 'ממתין לסיום הקורס');
});

test('missing end date and missing actual last meeting have different explanations', () => {
  assert.equal(staffFinalReadiness({
    endDate: '', eligibilityStatus: 'unscheduled', now
  }).label, 'ממתין לתאריך סיום');
  assert.equal(staffFinalReadiness({
    endDate: '2026-10-20', eligibilityStatus: 'unscheduled', now
  }).label, 'ממתין להשלמת מפגשי הקורס');
});

test('completed course can wait for the final-feedback release date', () => {
  assert.equal(staffFinalReadiness({
    endDate: '2026-10-20',
    eligibilityAt: '2026-10-21T00:00:00Z',
    eligibilityStatus: 'not_due', now
  }).label, 'ממתין למועד שליחת הסיום');
});

test('actual final-feedback eligibility is not blocked after course and last meeting ended', () => {
  const res = staffFinalReadiness({
    endDate: '2026-10-20',
    eligibilityAt: '2026-10-21T00:00:00Z',
    eligibilityStatus: 'eligible', now
  });
  assert.equal(res.ready, true);
});

test('premature final link expiry is surfaced without altering dates', () => {
  assert.match(staffFinalExpiryWarning({
    endDate:'2026-12-28', expiresAt:'2026-11-16T21:59:00Z', now
  }), /יש לעדכן תוקף/);
  assert.equal(staffFinalExpiryWarning({
    endDate:'2026-12-28', expiresAt:'2027-01-10T21:59:00Z', now
  }), '');
});

test('staff final management and list both use the actual-readiness state', () => {
  const source = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
  assert.match(source, /if \(stage === 'final'\) \{\s*const waiting = staffFinalWaiting\(g, campaign\)/);
  assert.match(source, /const earlyFinal = slot\.audience === 'educational_staff' && slot\.stage === 'final'/);
  assert.match(source, /earlyFinal \? statusText\(earlyFinal\.label, earlyFinal\.tone\) : campaignStatusHtml\(campaign\)/);
  assert.match(source, /earlyFinal \? staffFinalWaitingHtml\(earlyFinal, \{ detailed: true \}\) : ''/);
  assert.match(source, /שיתוף משוב הסיום יתאפשר לאחר השלמת הקורס/);
});
