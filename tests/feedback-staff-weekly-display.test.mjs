import test from 'node:test';
import assert from 'node:assert/strict';
import { staffDeliveryPresentation } from '../frontend/src/impact-feedback/staff-delivery-status.js';

const thursday = '2026-10-29T03:24:00.000Z'; // 05:24 Asia/Jerusalem

test('staff opening that was never mailed after its weekly window is not called "not due"', () => {
  const p = staffDeliveryPresentation({ stage:'pre',status:'not_due',
    startDate:'2026-10-13',now:thursday });
  assert.equal(p.label, 'לא נשלח · חלון השליחה חלף');
  assert.equal(p.tone, 'warning');
});

test('new staff openings follow the seven-day Friday–Thursday interval', () => {
  for (const day of ['2026-10-23','2026-10-25','2026-10-29']) {
    assert.equal(staffDeliveryPresentation({stage:'pre',status:'not_due',
      startDate:day,now:thursday}).label,'שליחה בחמישי 08:00');
  }
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'not_due',
    startDate:'2026-10-22',now:thursday}).tone,'warning');
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'not_due',
    startDate:'2026-10-30',now:thursday}).label,'ממתין לתחילת הקורס');
});

test('midpoint is distinguished from the next weekly batch', () => {
  assert.equal(staffDeliveryPresentation({stage:'mid',status:'not_due',
    eligibilityAt:'2026-11-12T11:00:00Z',now:thursday}).label,'ממתין למפגש האמצעי');
  assert.equal(staffDeliveryPresentation({stage:'mid',status:'not_due',
    eligibilityAt:'2026-10-25T11:00:00Z',now:'2026-10-28T10:00:00Z'}).label,'שליחה בחמישי 08:00');
  assert.equal(staffDeliveryPresentation({stage:'mid',status:'not_due',
    reason:'unscheduled',now:thursday}).label,'ממתין לתאריכי המפגשים');
});

test('sent, waiting for reply, or uncertain are never mistaken for not due', () => {
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'sent',startDate:'2026-10-08',
    now:thursday}).label,'נשלח');
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'scheduled',startDate:'2026-10-25',
    now:thursday}).label,'שליחה היום ב-08:00');
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'needs_attention',
    reason:'missing_contact_email',now:thursday}).label,'חסרה כתובת מייל');
  assert.equal(staffDeliveryPresentation({stage:'pre',now:thursday}).label,'סטטוס שליחה לא זמין');
});
