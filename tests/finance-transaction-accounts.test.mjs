import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildTransactionPreview, financeCycleCutoff, transactionActivitySummary, transactionDraftContent } from '../frontend/src/screens/finance-transaction-accounts.js';

const activity = (count, extra={}) => ({row_id:extra.row_id||'a1',school:'אלון',semel_mosad:'123',activity_name:'חלל',activity_no:'57651',price:9000,...Object.fromEntries(Array.from({length:count},(_,i)=>[`date_${i+1}`,`2026-10-${String(i+1).padStart(2,'0')}`])),...extra});
const summary=(count,opts={})=>transactionActivitySummary(activity(count,opts.activity),{cutoff:'2026-10-31',...opts});

test('monthly cutoff is previous month end',()=>assert.equal(financeCycleCutoff(new Date('2027-01-05T12:00:00Z')),'2026-12-31'));
test('two completed meetings are deferred while activity is still running',()=>assert.equal(transactionActivitySummary(activity(3,{date_3:'2026-12-01'}),{cutoff:'2026-10-31'}).eligible,false));
test('three meetings are eligible and each is 1.5 hours',()=>assert.deepEqual([summary(3).eligible,summary(3).unbilledHours],[true,4.5]));
test('deferred meetings accumulate and all four bill',()=>assert.equal(summary(4).unbilledCount,4));
test('cancelled meeting is excluded',()=>assert.equal(summary(3,{cancelledDates:['2026-10-02']}).unbilledCount,2));
test('future meeting is excluded from completed',()=>assert.equal(transactionActivitySummary(activity(4,{date_4:'2026-12-01'}),{cutoff:'2026-10-31'}).unbilledCount,3));
test('already billed meeting is excluded',()=>assert.equal(summary(4,{billedDates:['2026-10-01']}).unbilledCount,3));
test('finished activity gets closing bill for remaining meetings',()=>{const s=summary(4,{billedDates:['2026-10-01','2026-10-02']});assert.equal(s.closingBill,true);assert.equal(s.unbilledCount,2)});
test('activities for one institution produce one account',()=>assert.equal(buildTransactionPreview([activity(3),activity(4,{row_id:'a2'})],{cutoff:'2026-10-31'}).accounts.length,1));
test('ineligible activity is omitted while eligible peer remains',()=>{const p=buildTransactionPreview([activity(3,{date_3:'2026-12-01'}),activity(3,{row_id:'a2'})],{cutoff:'2026-10-31'});assert.deepEqual([p.accounts[0].lines.length,p.deferred.length],[1,1])});
test('hourly rate derives only from activity price and planned hours',()=>assert.equal(summary(10).hourlyRate,600));
test('final bill corrects rounding to exact activity price',()=>assert.equal(summary(3,{billedAmount:6000}).amount,3000));
test('missing institution symbol is blocked',()=>assert.equal(summary(3,{activity:{semel_mosad:''}}).blockedReason,'חסר סמל מוסד'));
test('Outlook draft has exact short body and no SharePoint link',()=>{const d=transactionDraftContent(8525,'אלון');assert.match(d.body,/מצורף חשבון עסקה מס׳ 8525/);assert.doesNotMatch(d.body,/sharepoint|http/i)});
test('migration has concurrent sequence, immutable snapshots and DB meeting uniqueness',()=>{const sql=fs.readFileSync('supabase/migrations/20260821190000_finance_transaction_accounts.sql','utf8');assert.match(sql,/sequence[\s\S]*start with 8525/i);assert.match(sql,/unique \(activity_row_id, meeting_date\)/);assert.match(sql,/unique \(idempotency_key, institution_symbol\)/);assert.match(sql,/activity_name_snapshot/)});
test('PDF implementation uses real embedded fonts and text, not screenshot/canvas',()=>{const source=fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts','utf8');assert.match(source,/embedFont/);assert.match(source,/drawText/);assert.doesNotMatch(source,/html2canvas|screenshot/i)});
test('Outlook failure is non-critical and retry targets existing account',()=>{const source=fs.readFileSync('supabase/functions/finance-transaction-accounts/index.ts','utf8');assert.match(source,/outlookStatus:"failed"/);assert.match(source,/accountId=clean\(body.accountId\)/);assert.doesNotMatch(source,/sendMail/)});
