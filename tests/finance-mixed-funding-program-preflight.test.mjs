import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {automaticMixedFundingProgramReview,transactionAccountsViewHtml,transactionIssuanceResultMessage} from '../frontend/src/screens/finance-transaction-issuance.js';

const activity='PAI-mixed';
const g={activityRowId:activity,activityName:'פורצות דרך',gefenNumber:'52279',gefenFunding:true,
  fundingSourceId:'gefen',funding:'גפן',period:'2026-10-01',institutionSymbol:'240036',
  customerName:'מקיף דתי אמי"ת קנדי',payerName:'מקיף דתי אמי"ת קנדי',payerKey:'school:527',
  eligible:true,blockedReason:'',issuableAmount:1285.71,unbilledSlots:[],unbilledCount:3};
const sponsor={...g,gefenFunding:false,fundingSourceId:'sponsor',funding:'רמי שני',eligible:false,issuableAmount:0};
const data=(program='52279',rows=[g,sponsor])=>({
  transactionContext:{billingRows:rows,accounts:[]},transactionMonths:{automatic:'2026-10',manual:'2026-10'},
  collectionActivities:[{row_id:activity,school:'מקיף דתי אמי"ת קנדי',activity_name:'פורצות דרך',activity_no:program,gefen_number:program,funding:'גפן + רמי שני'}]
});

test('mixed funded Gefen activity is shown with its program before automatic issuance',()=>{
 const results=automaticMixedFundingProgramReview(data(),'2026-10');
 assert.equal(results.length,1);
 assert.equal(results[0].code,'52279');
 assert.equal(results[0].valid,true);
 const html=transactionAccountsViewHtml(data(),()=>'<h1>Test</h1>');
 assert.match(html,/מספר גפ״ן: 52279/);
});
test('legacy 3604 source for Poratzot shows 52279 in preflight without false conflict',()=>{
 const legacy={...g,gefenNumber:'3604'};
 const other={...sponsor,gefenNumber:'3604'};
 const results=automaticMixedFundingProgramReview(data('3604',[legacy,other]),'2026-10');
 assert.equal(results.length,1);
 assert.equal(results[0].code,'52279');
 assert.equal(results[0].sourceCode,'3604');
 assert.equal(results[0].valid,true);
});
test('genuine code divergence from All Activities still blocks preflight',()=>{
 const results=automaticMixedFundingProgramReview(data('9999'),'2026-10');
 assert.equal(results.length,1);
 assert.equal(results[0].valid,false);
});
test('ordinary single-funded activity does not trigger mixed-funding confirmation',()=>{
 assert.deepEqual(automaticMixedFundingProgramReview(data('52279',[g]),'2026-10'),[]);
});
test('no invoice number is allocated by preview check',()=>{
 const src=readFileSync(new URL('../frontend/src/screens/finance.js',import.meta.url),'utf8');
 assert.match(src,/automaticMixedFundingProgramReview\(visit, month\)/);
 assert.match(src,/pendingTransactionApproval/);
 assert.match(src,/data-finance-transaction-approve/);
 assert.match(src,/executeTransactionRun\('automatic', approved\.month\)/);
 assert.doesNotMatch(src,/window\.confirm\(confirmationMessage\)/);
 assert.doesNotMatch(src,/response\?\.trim\(\) !== 'מאשר'/);
});

test('automatic billing confirmation is rendered within the app and requires explicit approval',()=>{
 const preview=data();
 preview.pendingTransactionApproval={
   mode:'automatic',month:'2026-10',accountCount:1,amount:1285.71,
   mixed:[{school:'מקיף דתי אמי"ת קנדי',course:'פורצות דרך',code:'52279'}]
 };
 const html=transactionAccountsViewHtml(preview,()=>'<h1>Finance</h1>');
 assert.match(html,/role="dialog" aria-modal="true"/);
 assert.match(html,/data-finance-transaction-approve/);
 assert.match(html,/data-finance-transaction-cancel/);
 assert.match(html,/1,285\.71/);
 assert.match(html,/52279/);
});
test('failed invoice generation reports the account name and reason instead of appearing successful',()=>{
 const message=transactionIssuanceResultMessage([{accountLabel:'בית ספר לדוגמה',error:'stale_billing_preview'}]);
 assert.match(message,/נשמרו 0 חשבונות/);
 assert.match(message,/בית ספר לדוגמה/);
 assert.match(message,/נתוני החיוב השתנו/);
});
