import test from 'node:test';
import assert from 'node:assert/strict';
import { staffDeliveryPresentation, staffStatusIndex } from '../frontend/src/impact-feedback/staff-delivery-status.js';

const thursday = '2026-10-29T03:24:00.000Z'; // 05:24 Asia/Jerusalem

test('staff opening that was never mailed after its weekly window is not called "not due"', () => {
  const p = staffDeliveryPresentation({ stage:'pre',status:'not_due',
    startDate:'2026-10-13',now:thursday });
  assert.equal(p.label, 'לא נשלח · מועד השליחה חלף');
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
    reason:'missing_contact_email',now:thursday}).label,'לא נשלח · חסרה כתובת מייל');
  assert.equal(staffDeliveryPresentation({stage:'pre',now:thursday}).label,'סטטוס שליחה לא זמין');
});

test('system-accepted delivery stays sent regardless of past dates, campaign or response state', () => {
  const afterWindow = '2026-11-12T20:00:00Z';
  assert.deepEqual(staffDeliveryPresentation({
    stage:'pre', status:'sent', reason:'accepted',
    startDate:'2026-10-06', now:afterWindow
  }), {label:'נשלח',tone:'success'});
  assert.equal(staffDeliveryPresentation({
    stage:'final',status:'sent',endDate:'2026-12-26',now:afterWindow
  }).label,'נשלח');
});

test('past window without any accepted send is never marked as scheduled', () => {
  const now='2026-10-29T18:00:00Z';
  const cases=[
    ['opening_window_elapsed','לא נשלח · מועד השליחה חלף'],
    ['dispatch_window_elapsed','לא נשלח · מועד השליחה חלף'],
    ['missing_contact_email_after_deadline','לא נשלח · חסרה כתובת מייל'],
    ['missing_selected_contact_after_deadline','לא נשלח · חסר איש קשר']
  ];
  for (const [reason,label] of cases) {
    assert.equal(staffDeliveryPresentation({stage:'pre',status:'needs_attention',
      reason,startDate:'2026-10-13',now}).label,label);
  }
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'failed',now}).label,'השליחה נכשלה');
  assert.equal(staffDeliveryPresentation({stage:'pre',status:'pending',now}).label,'ממתין לשליחה');
});

test('activity delivery index is not copied from one representative to a different course', () => {
  const index=staffStatusIndex([
    {activity_row_id:'CLASS-A',stage:'pre',status:'sent',reason:'accepted'},
    {activity_row_id:'CLASS-B',stage:'pre',status:'needs_attention',reason:'opening_window_elapsed'},
    {activity_row_id:'CLASS-A',stage:'mid',status:'not_due',reason:'not_due'}
  ]);
  assert.equal(index.get('CLASS-A|pre')?.status,'sent');
  assert.equal(index.get('CLASS-B|pre')?.status,'needs_attention');
  assert.equal(index.get('CLASS-A|mid')?.status,'not_due');
  assert.equal(index.get('CLASS-B|mid'),undefined);
});
