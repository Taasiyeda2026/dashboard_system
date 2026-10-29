import test from 'node:test';
import assert from 'node:assert/strict';
import { activityMeetingSlots, financeActivityFacts, financeCycleCutoff, financePaymentDueDate, transactionDraftContent } from '../frontend/src/screens/finance-transaction-accounts.js';
test('meeting identity preserves same-day slots and uses current dates without attendance', () => {
  const a={sessions:'3',date_1:'2026-07-01',date_2:'2026-07-01',date_3:'2026-12-01'};
  const now=new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(activityMeetingSlots(a).map(s=>s.slot),[1,2,3]);
  assert.equal(financeActivityFacts(a,{now}).completedCount,2);
  assert.equal(financeActivityFacts({...a,date_3:'2026-07-02'},{now}).finished,true);
  assert.equal(financeActivityFacts({...a,date_2:null},{now}).finished,false);
});
test('cancellation facts exclude meetings and today requires end time to have passed in Israel', () => {
  const a={sessions:'2',date_1:'2026-10-25',date_2:'2026-10-25',end_time:'12:00'};
  assert.equal(financeActivityFacts(a,{now:new Date('2026-10-25T10:00:00Z')}).completedCount,0);
  assert.equal(financeActivityFacts(a,{now:new Date('2026-10-25T10:00:01Z')}).completedCount,2);
  assert.equal(financeActivityFacts(a,{now:new Date('2026-10-25T10:01:00Z'),cancelledDates:['2026-10-25']}).completedCount,0);
});
test('business cutoff and payment terms cross year in Israel', () => {
  assert.equal(financeCycleCutoff(new Date('2026-12-31T23:00:00Z')),'2026-12-31');
  assert.equal(financePaymentDueDate('2026-12-12'),'2027-01-30');
  assert.doesNotMatch(transactionDraftContent(1,'בית ספר').body,/https?:/);
});
