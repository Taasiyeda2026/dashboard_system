import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { manualAccountViewHtml,prepareManualAccount,updateManualDraft,runManualAccount,manualFundingFilterOptions,manualFilteredActivities,toggleManualActivity,focusManualActivity,saveActiveManualDraft,previewSelectedManualAccounts,runSelectedManualAccounts,formatManualMoney,parseManualMoney,normalizeManualRecipientEmails,manualSelectedFundingSummary,manualSelectionSnapshot,updateManualConsolidatedField,manualPdfPreviewFilename,syncManualPdfPreviewDom,clearManualPdfPreviewUrls,activateManualPdfPreview,manualConsolidatedActivityRows } from '../frontend/src/screens/finance-manual-account.js';
const data=()=>({collectionActivities:[{row_id:'a',school:'בית ספר',authority:'עיריית רחובות',activity_name:'קורס',activity_no:'123'}],transactionContext:{billingRows:[{activityRowId:'a',fundingSourceId:'r',funding:'רשות',payerName:'עיריית רחובות',period:'2026-09-01',institutionSymbol:'123',unbilledCount:2,issuableAmount:7000,eligible:true}]}});
test('manual wizard selects existing activity/funder and edits document fields without touching source data',()=>{
  const d=data();const source=JSON.stringify(d.collectionActivities);prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.amount,7000);assert.equal(d.manualDraft.quantity,2);assert.equal(d.manualFundingKey,'r|2026-09-01');
  updateManualDraft(d,'description','תיאור למסמך');updateManualDraft(d,'amount',6000);
  assert.equal(d.manualDraft.unit_price,3000);assert.equal(JSON.stringify(d.collectionActivities),source);
  const html=manualAccountViewHtml(d);assert.match(html,/בחירת פעילות קיימת/);assert.match(html,/תיאור למסמך/);assert.doesNotMatch(html,/data-finance-manual-confirm/);
  assert.match(html,/<option value="a" selected>בית ספר \| עיריית רחובות \| קורס<\/option>/);
  assert.doesNotMatch(html,/בית ספר · קורס · a|ds-fin-manual__selected/);
  assert.match(html,/ds-fin-manual__activity-grid|ds-fin-manual__grid/);
});
test('editing invalidates preview; only a reviewed PDF can be confirmed with its server revision',async()=>{
  const d=data();prepareManualAccount(d,'a');await assert.rejects(runManualAccount(d,{}),/מקדימה/);
  d.manualQuote={revision:'server-version'};d.manualPdf='base64';updateManualDraft(d,'quantity',1);assert.equal(d.manualQuote,null);
  d.manualQuote={revision:'server-version'};let payload;
  await runManualAccount(d,{reserveFinanceManualAccount:async p=>{payload=p;return{id:'x'};},dispatchFinanceTransactionAccount:async()=>({})});
  assert.equal(payload.activity,'a');assert.equal(payload.funder,'r');assert.equal(payload.revision,'server-version');
});
test('manual search includes school activity authority and stable identifier; no new activity input exists',()=>{
  const d=data();d.manualSearch='רחובות';assert.match(manualAccountViewHtml(d),/value="a"/);
  d.manualSearch='אין פעילות כזו';assert.doesNotMatch(manualAccountViewHtml(d),/value="a"/);
});
test('full funding before performance uses the selected financier budget and retains a separate basis',()=>{
  const d=data();Object.assign(d.transactionContext.billingRows[0],{eligible:false,period:null,manualMonth:'2026-12-01',plannedCount:4,unbilledCount:0,issuableAmount:0,fullFundingAmount:7000,fullFundingBlockedReason:''});
  prepareManualAccount(d,'a');assert.equal(d.manualDraft.billing_basis,'full_funding');assert.equal(d.manualDraft.amount,7000);assert.equal(d.manualDraft.quantity,4);assert.equal(d.manualFundingKey,'r|2026-12-01');
  assert.match(manualAccountViewHtml(d),/מלוא חלק המממן/);
});

test('manual issuance filters by actual funder, not school; mixed funding selects the right share',()=>{
  const d={
    collectionActivities:[
      {row_id:'a',school:'אוסישקין',authority:'נהרייה',authority_id:11,activity_name:'ביומימיקרי',funding:'גפן + רשות'},
      {row_id:'b',school:'הרצל',authority:'עכו',authority_id:22,activity_name:'ביומימיקרי',funding:'רשות'},
      {row_id:'c',school:'אוסישקין',authority:'נהרייה',authority_id:11,activity_name:'חלל',funding:'גפן'},
      {row_id:'d',school:'גולדה',authority:'חיפה',authority_id:33,activity_name:'חלל',funding:'רמי שני'}
    ],
    transactionContext:{billingRows:[
      {activityRowId:'a',fundingSourceId:'g',funding:'גפ״ן',period:'2026-10-01',eligible:true,unbilledCount:2,issuableAmount:2000},
      {activityRowId:'a',fundingSourceId:'r',funding:'רשות',payerName:'נהרייה',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000},
      {activityRowId:'b',fundingSourceId:'r',funding:'רשות',payerName:'עכו',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000},
      {activityRowId:'c',fundingSourceId:'g',funding:'גפן',period:'2026-10-01',eligible:true,unbilledCount:2,issuableAmount:2000},
      {activityRowId:'d',fundingSourceId:'s',funding:'רמי שני',period:'2027-02-01',eligible:true,unbilledCount:2,issuableAmount:3000}
    ]}
  };
  const options=manualFundingFilterOptions(d);
  assert.ok(options.some(f=>f.label==='רמי שני'));
  assert.equal(options.filter(f=>f.key.startsWith('authority:')).length,2);
  const gefen=options.find(f=>f.label==='גפ״ן'||f.label==='גפן');
  d.manualFunderFilter=gefen.key;
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['a','c']);
  prepareManualAccount(d,'a');
  assert.equal(d.manualFundingKey,'g|2026-10-01');
  const authority=options.find(f=>f.label==='רשות - נהרייה');
  d.manualFunderFilter=authority.key;
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['a']);
  prepareManualAccount(d,'a');
  assert.equal(d.manualFundingKey,'r|2027-02-01');
  const html=manualAccountViewHtml(d);
  assert.match(html,/data-finance-manual-funder-filter/);
  assert.match(html,/value="r\|2027-02-01"/);
  assert.doesNotMatch(html,/value="g\|2026-10-01"/);
  assert.match(html,/אוסישקין \| נהרייה \| ביומימיקרי/);
  assert.doesNotMatch(html,/הרצל \| עכו \| ביומימיקרי/);
});
test('funder filter includes old single-funder records even if allocation details are missing',()=>{
  const d={collectionActivities:[
    {row_id:'missing',school:'שקמה',authority:'אשדוד',funding:'גפן',activity_name:'בינה מלאכותית'},
    {row_id:'unassigned',school:'דקל',authority:'רחובות',funding:'',activity_name:'חלל'}],
  transactionContext:{billingRows:[{activityRowId:'missing',fundingSourceId:null,funding:'גפן',blockedReason:'חסרה חלוקת מימון'}]}};
  const options=manualFundingFilterOptions(d);
  assert.ok(options.some(f=>f.key==='funder:גפן'));
  assert.ok(options.some(f=>f.key==='unassigned'));
  d.manualFunderFilter='funder:גפן';
  assert.deepEqual(manualFilteredActivities(d).map(a=>a.row_id),['missing']);
});

test('multiple activities for one financer issue exactly one account with all lines', async () => {
  const d=data();
  d.collectionActivities.push({...d.collectionActivities[0],row_id:'b',school:'בית ספר שני'});
  d.transactionContext.billingRows.push({...d.transactionContext.billingRows[0],activityRowId:'b',issuableAmount:4300});
  d.manualFunderFilter='authority:name:עיריית רחובות';
  toggleManualActivity(d,'a',true);
  toggleManualActivity(d,'b',true);
  updateManualDraft(d,'amount',4000);
  saveActiveManualDraft(d);
  const requests=[];
  const api={
    previewFinanceFunderBatchAccount:async items=>{
      requests.push(items);
      return {quote:{revision:'combined-rev',total_amount:11000,finance_transaction_account_lines:[{},{}]},pdfBase64:'COMBINEDPDF'};
    },
    reserveFinanceFunderBatchAccount:async request=>({id:'one-account',total_amount:11000,request}),
    dispatchFinanceTransactionAccount:async payload=>({document:'issued',id:payload.accountId})
  };
  const previews=await previewSelectedManualAccounts(d,api);
  assert.equal(previews.length,1);
  assert.equal(requests.length,1);
  assert.deepEqual(requests[0].map(item=>item.activity),['a','b']);
  assert.equal(requests[0][0].draft.amount,7000);
  assert.equal(requests[0][1].draft.amount,4000);
  const view=manualAccountViewHtml(d);
  assert.match(view,/אישור והפקת חשבון מרוכז/);
  assert.match(view,/data-finance-manual-pdf-open="consolidated"/);
  assert.match(view,/data-finance-manual-pdf-download="consolidated"/);
  assert.doesNotMatch(view,/<iframe/,'PDF extension cannot hijack an embedded viewer');
  assert.doesNotMatch(view,/COMBINEDPDF/,'base64 must not be embedded into HTML');
  assert.doesNotMatch(view,/אישור והפקת 2 חשבונות/);
  const issued=await runSelectedManualAccounts(d,api);
  assert.equal(issued.length,1);
  assert.equal(issued[0].reserved.id,'one-account');
  assert.equal(issued[0].reserved.request.revision,'combined-rev');
});
test('multi-activity preview requires a financer, invalidates on edit, and cancels failed dispatch',async()=>{
  const d=data();
  d.collectionActivities.push({...d.collectionActivities[0],row_id:'b'});
  d.transactionContext.billingRows.push({...d.transactionContext.billingRows[0],activityRowId:'b'});
  toggleManualActivity(d,'a',true);
  toggleManualActivity(d,'b',true);
  await assert.rejects(previewSelectedManualAccounts(d,{}),/גורם מימון/);
  d.manualFunderFilter='authority:name:עיריית רחובות';
  const api={previewFinanceFunderBatchAccount:async()=>({quote:{revision:'r1'},pdfBase64:'pdf'})};
  await previewSelectedManualAccounts(d,api);
  updateManualDraft(d,'description','edited');
  assert.equal(d.manualConsolidatedPreview,null);
  await previewSelectedManualAccounts(d,api);
  let cancelled='';
  await assert.rejects(runSelectedManualAccounts(d,{
    reserveFinanceFunderBatchAccount:async()=>({id:'one'}),
    dispatchFinanceTransactionAccount:async()=>{throw Error('dispatch failed');},
    cancelFinanceTransactionReservation:async id=>{cancelled=id}
  }),/dispatch failed/);
  assert.equal(cancelled,'one');
});
test('non-school payer does not inherit a school semel or invent a customer number',()=>{
  const d=data();d.transactionContext.billingRows[0].gefenFunding=false;
  d.transactionContext.billingRows[0].institutionSymbol='211466';
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.institution_symbol,'');
  const html=manualAccountViewHtml(d);
  assert.match(html,/מספר לקוח \(אם קיים\)/);
  assert.match(html,/הצגת החשבון לבדיקה \(PDF\)/);
  assert.doesNotMatch(html,/סמל מוסד \/ מספר לקוח/);
});
test('Gefen payer retains school institution symbol',()=>{
  const d=data();d.transactionContext.billingRows[0].gefenFunding=true;
  d.transactionContext.billingRows[0].institutionSymbol='211466';
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.institution_symbol,'211466');
  assert.match(manualAccountViewHtml(d),/סמל מוסד/);
});

test('manual invoice displays grouped payer amounts and keeps numeric values in the draft',()=>{
  assert.equal(formatManualMoney(17500),'17,500.00');
  assert.equal(formatManualMoney(4500),'4,500.00');
  assert.equal(parseManualMoney('17,500.00'),17500);
  assert.equal(parseManualMoney('1,250.75'),1250.75);
  assert.equal(parseManualMoney('1250.75'),1250.75);
  assert.ok(Number.isNaN(parseManualMoney('1,25.00')));
  const d=data();prepareManualAccount(d,'a');
  const html=manualAccountViewHtml(d);
  assert.match(html,/7,000\.00 ₪/);
  assert.match(html,/data-finance-manual-field="amount" value="7,000\.00"/);
  assert.match(html,/data-finance-manual-field="unit_price" value="3,500\.00"/);
  updateManualDraft(d,'amount','6,500.50');
  assert.equal(d.manualDraft.amount,6500.5);
  assert.equal(d.manualDraft.unit_price,3250.25);
  updateManualDraft(d,'unit_price','1,250.00');
  assert.equal(d.manualDraft.unit_price,1250);
  assert.equal(d.manualDraft.amount,2500);
  assert.ok(Number.isFinite(d.manualDraft.amount));
});
test('money input formatting retains enough unit-price precision for server amount validation',()=>{
  const d=data();d.transactionContext.billingRows[0].unbilledCount=11;d.transactionContext.billingRows[0].issuableAmount=2500;
  prepareManualAccount(d,'a');
  const shown=formatManualMoney(d.manualDraft.unit_price,{unitPrice:true});
  const parsed=parseManualMoney(shown);
  assert.equal(Math.round(parsed*11*100)/100,2500);
  assert.match(shown,/^227\.2727/);
});


test('email recipient field supports multiple comma-separated addresses and normalizes legacy semicolons', () => {
  const d=data();
  d.transactionContext.billingRows[0].customerEmail='finance@example.com;manager@example.com';
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.customer_email,'finance@example.com, manager@example.com');
  const dom=new JSDOM(manualAccountViewHtml(d));
  const input=dom.window.document.querySelector('[data-finance-manual-field="customer_email"]');
  assert.equal(input.type,'email');
  assert.equal(input.multiple,true,'native HTML multi-recipient validation must be enabled');
  assert.equal(input.value,'finance@example.com, manager@example.com');
  assert.equal(input.checkValidity(),true,'both recipients are valid');
  assert.equal(normalizeManualRecipientEmails('first@example.com; second@example.com, third@example.com'),
    'first@example.com, second@example.com, third@example.com');
  assert.equal(updateManualDraft(d,'customer_email','one@example.com;two@example.com'),undefined);
  assert.equal(d.manualDraft.customer_email,'one@example.com, two@example.com');
  input.value='one@example.com, invalid-email';
  assert.equal(input.checkValidity(),false,'an invalid recipient must still be rejected');
  dom.window.close();
});

test('consolidated funder displays the total of all selected activities, not only the active one',async()=>{
  const d={...data(),manualFunderFilter:'funder:רמי שני',collectionActivities:[],transactionContext:{billingRows:[]}};
  for(const [id,amount,school] of [['a',10000,'א'],['b',7000,'ב'],['c',5000,'ג']]){
    d.collectionActivities.push({row_id:id,school,activity_name:'בינה מלאכותית',activity_no:'9545',funding:'רמי שני'});
    d.transactionContext.billingRows.push({
      activityRowId:id,fundingSourceId:'s',funding:'רמי שני',payerName:'רמי שני',
      customerEmail:school+'@example.com',period:'2026-11-01',manualMonth:'2026-11-01',
      plannedCount:8,eligible:false,fullFundingAmount:amount,fullFundingBlockedReason:'',issuableAmount:0,
      gefenFunding:false
    });
    toggleManualActivity(d,id,true);
  }
  assert.equal(manualSelectedFundingSummary(d).amount,22000);
  const html=manualAccountViewHtml(d);
  assert.match(html,/חשבון מרוכז · 3 פעילויות/);
  assert.match(html,/סכום כולל: 22,000\.00 ₪/);
  assert.match(html,/פרטי החשבון המרוכז/);
  assert.doesNotMatch(html,/בית ספר בפעילות הנערכת|סכום פעילות זו/);
  assert.match(html,/חשבון מרוכז — ללא בית ספר יחיד/);
  assert.match(html,/data-finance-manual-bulk-field="customer_email"/);
  assert.match(html,/data-finance-manual-preview/);
  assert.doesNotMatch(html,/סכום החשבון/);
  assert.equal(d.manualDraft.customer_email,'','non-Gefen payer must not inherit school contact email');

  updateManualDraft(d,'customer_email','payer@example.com;finance@example.com');
  saveActiveManualDraft(d);
  assert.equal(d.manualFunderRecipientEmail,'payer@example.com, finance@example.com');
  const requests=[];
  await previewSelectedManualAccounts(d,{previewFinanceFunderBatchAccount:async items=>{
    requests.push(items);
    return {quote:{revision:'sponsor-revision',total_amount:22000},pdfBase64:'PDF'};
  }});
  assert.equal(requests.length,1);
  assert.equal(requests[0].length,3);
  assert.deepEqual(requests[0].map(item=>item.draft.amount),[10000,7000,5000]);
  assert.deepEqual(requests[0].map(item=>item.draft.customer_email),Array(3).fill('payer@example.com, finance@example.com'));
  assert.equal(requests[0].every(item=>item.draft.customer_name==='רמי שני'),true);
  assert.match(manualAccountViewHtml(d),/סכום כולל: 22,000\.00 ₪/);

  // When editing a different activity, the financer recipient remains common.
  toggleManualActivity(d,'b',true);
  assert.equal(d.manualDraft.customer_email,'payer@example.com, finance@example.com');
  assert.equal(manualSelectionSnapshot(d,'a').draft.customer_email,'payer@example.com, finance@example.com');
});

test('Gefen manual invoice keeps its original school recipients',()=>{
  const d=data();
  d.transactionContext.billingRows[0].customerEmail='school@example.com;principal@example.com';
  d.transactionContext.billingRows[0].gefenFunding=true;
  prepareManualAccount(d,'a');
  assert.equal(d.manualDraft.customer_email,'school@example.com, principal@example.com');
});

test('consolidated invoice previews use Blob URLs and download under a descriptive filename',()=>{
  const d=data();
  prepareManualAccount(d,'a');
  const pdfBase64=Buffer.from('%PDF-1.4\\nminimal sample').toString('base64');
  d.manualConsolidatedPreview={
    items:Array.from({length:29},(_,i)=>({activity:'activity'+i})),
    quote:{customer_name_snapshot:'רמי שני',issue_date:'2026-10-30',total_amount:265750},
    pdfBase64
  };
  const html=manualAccountViewHtml(d);
  assert.equal(html.includes('data:application/pdf;base64'),false);
  assert.doesNotMatch(html,/%PDF-1.4|minimal sample/);
  const dom=new JSDOM(html);
  const root=dom.window.document.body;
  const revoked=[];
  let count=0;
  const scope={
    URL:{
      createObjectURL:()=>`blob:invoice-preview-${++count}`,
      revokeObjectURL:(url)=>revoked.push(url)
    },
    atob:(value)=>Buffer.from(value,'base64').toString('binary')
  };
  syncManualPdfPreviewDom(root,d,scope);
  assert.equal(root.querySelector('iframe'),null);
  assert.ok(root.querySelector('[data-finance-manual-pdf-open="consolidated"]'));
  assert.ok(root.querySelector('[data-finance-manual-pdf-download="consolidated"]'));
  const opens=[];
  const clicked=[];
  const originalClick=dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click=function(){
    clicked.push({href:this.getAttribute('href'),filename:this.download});
  };
  assert.equal(activateManualPdfPreview(root,'consolidated','open',{open:(...args)=>opens.push(args)}),true);
  assert.deepEqual(opens,[['blob:invoice-preview-1','_blank','noopener']]);
  assert.equal(activateManualPdfPreview(root,'consolidated','download',scope),true);
  assert.deepEqual(clicked,[{
    href:'blob:invoice-preview-1',
    filename:'טיוטת חשבון עסקה - רמי שני - 29 פעילויות - 30.10.2026.pdf'
  }]);
  dom.window.HTMLAnchorElement.prototype.click=originalClick;
  syncManualPdfPreviewDom(root,d,scope);
  assert.equal(count,1,'re-render with the same PDF must reuse its Blob URL');
  d.manualConsolidatedPreview=null;
  syncManualPdfPreviewDom(root,d,scope);
  assert.deepEqual(revoked,['blob:invoice-preview-1']);
  clearManualPdfPreviewUrls(root,scope.URL);
  assert.equal(manualPdfPreviewFilename({customer_name_snapshot:'רמי/שני',issue_date:'2026-10-30'}),
    'טיוטת חשבון עסקה - רמי שני - 30.10.2026.pdf');
  dom.window.close();
});

test('single-invoice PDF preview also provides a named download rather than inline base64',()=>{
  const d=data();prepareManualAccount(d,'a');
  d.manualQuote={customer_name_snapshot:'עיריית רחובות',issue_date:'2026-10-30'};
  d.manualPdf='JVBERi0=';
  const html=manualAccountViewHtml(d);
  assert.match(html,/data-finance-manual-pdf-download="single"/);
  assert.match(html,/data-finance-manual-pdf-open="single"/);
  assert.doesNotMatch(html,/<iframe/);
  assert.equal(html.includes('data:application/pdf;base64'),false);
});

test('consolidated invoice shows every school, not only the school of the active activity',()=>{
  const d=data();
  d.manualFunderFilter='funder:רמי שני';
  d.collectionActivities=Array.from({length:29},(_,i)=>({
    row_id:'act'+i, school:'בית ספר '+(i+1),activity_name:'קורס '+(i+1)
  }));
  d.manualActivityId='act0';
  d.manualSelectedActivityIds=d.collectionActivities.map(a=>a.row_id);
  d.manualDraft={amount:10000};
  d.manualActivityDrafts=Object.fromEntries(d.collectionActivities.map((a,i)=>[a.row_id,{
    draft:{amount:i===28?5750:10000}, fundingKey:'s|2026-11-01'
  }]));
  // Exercise a large mixed-amount consolidated selection.
  assert.equal(manualConsolidatedActivityRows(d).length,29);
  const html=manualAccountViewHtml(d);
  const document=new JSDOM(html).window.document;
  assert.match(html,/29 פעילויות · 29 בתי ספר/);
  assert.match(html,/סכום כולל: 285,750\\.00 ₪/);
  const table=document.querySelector('.ds-fin-manual__selected-schools table');
  assert.ok(table,'a consolidated invoice must list the schools');
  assert.equal(table.querySelectorAll('tbody tr').length,29);
  assert.ok(table.textContent.includes('בית ספר 29'));
  assert.ok(table.textContent.includes('קורס 29'));
  assert.match(html,/חשבון מרוכז — ללא בית ספר יחיד/);
  assert.match(html,/פרטי החשבון המרוכז/);
  assert.doesNotMatch(html,/בית ספר בפעילות הנערכת|סכום פעילות זו/);
  assert.equal(document.querySelector('[data-finance-manual-activity]').value,'');
  assert.equal(document.querySelector('[data-finance-manual-bulk-field="customer_name"]').value,'');
  assert.equal(document.querySelector('.ds-fin-manual__selected-schools').open,true);
});

test('bulk payer fields update every selected activity and preserve per-school financial allocation',()=>{
  const d=data();
  d.manualFunderFilter='authority:name:עיריית רחובות';
  d.collectionActivities.push({...d.collectionActivities[0],row_id:'b',school:'בית ספר שני'});
  d.transactionContext.billingRows.push({...d.transactionContext.billingRows[0],activityRowId:'b',issuableAmount:4300});
  toggleManualActivity(d,'a',true);
  toggleManualActivity(d,'b',true);
  const original=manualSelectedFundingSummary(d).amount;
  assert.equal(d.manualBulkEditingActivityId,'');
  updateManualConsolidatedField(d,'customer_email','account@example.com;backup@example.com');
  updateManualConsolidatedField(d,'customer_name','עיריית רחובות');
  updateManualConsolidatedField(d,'institution_symbol','123');
  const requests=['a','b'].map(id=>manualSelectionSnapshot(d,id));
  assert.deepEqual(requests.map(row=>row.draft.customer_email),Array(2).fill('account@example.com, backup@example.com'));
  assert.deepEqual(requests.map(row=>row.draft.customer_name),Array(2).fill('עיריית רחובות'));
  assert.deepEqual(requests.map(row=>row.draft.institution_symbol),Array(2).fill('123'));
  assert.equal(manualSelectedFundingSummary(d).amount,original,'editing payer cannot change per-activity amounts');
  const first=manualAccountViewHtml(d);
  assert.match(first,/פרטי החשבון המרוכז/);
  assert.doesNotMatch(first,/בית ספר בפעילות הנערכת/);
  d.manualBulkEditingActivityId='b';
  focusManualActivity(d,'b');
  const second=manualAccountViewHtml(d);
  assert.match(second,/בית ספר בפעילות הנערכת/);
  assert.match(second,/סכום פעילות זו/);
  assert.match(second,/data-finance-manual-preview/);
  d.manualBulkEditingActivityId='';
  assert.doesNotMatch(manualAccountViewHtml(d),/בית ספר בפעילות הנערכת/);
});
