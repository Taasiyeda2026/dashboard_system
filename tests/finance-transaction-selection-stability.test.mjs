import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { financeScreen, createFinanceVisitState } from '../frontend/src/screens/finance.js';
import { transactionSelectionKey, transactionPreviewForVisit } from '../frontend/src/screens/finance-transaction-issuance.js';

const user = { role:'admin' };
const billingRow = (activityRowId, period) => ({
  activityRowId, activityName:'תמיר - המחזור מתחיל בבית', fundingSourceId:'funder-x',
  funding:'תמיר', gefenFunding:false, payerKey:'funding:funder-x', payerName:'תמיר',
  period, institutionSymbol:null, customerName:'מרחבים', customerEmail:'',
  plannedCount:1, completedCount:1, billedCount:0, unbilledCount:1, unbilledHours:1.5,
  unbilledSlots:[{slot:1,date:period,remainingAmount:435}], fundingAmount:435,
  issuableAmount:435, unbilledAmount:435, eligible:true, blockedReason:''
});
function mount() {
  const rows=[
    billingRow('back1','2026-09-01'), billingRow('back2','2026-09-01'), billingRow('back3','2026-09-01'),
    billingRow('current1','2026-10-01'), billingRow('current2','2026-10-01')
  ];
  const data = createFinanceVisitState();
  data.view='transactions';data.transactionTab='manual';
  data.transactionMonths={manual:'2026-10',automatic:'2026-10'};
  data.transactionContext={billingRows:rows,accounts:[],cancelled:[]};
  const dom = new JSDOM('<div id="app"></div>');
  const root = dom.window.document.getElementById('app');
  let renders=0;
  function repaint() { renders++;root.innerHTML=financeScreen.render(data,{state:{user}}); }
  repaint();
  financeScreen.bind({root,data,state:{user},api:{},rerender:repaint});
  return {root,data,rows,dom,getRenderCount:()=>renders};
}
function change(dom, checkbox, next) {
  checkbox.checked=next;
  checkbox.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
}

test('single checkboxes keep historical billing group open and preserve its DOM node',()=>{
  const {root,data,rows,dom,getRenderCount}=mount();
  const backlog=root.querySelector('[data-finance-transaction-period="2026-09"]').closest('[data-finance-transaction-group]');
  backlog.open=true;
  const item=backlog.querySelector('[data-finance-transaction-select]');
  const originalItem=item;
  const before=getRenderCount();
  change(dom,item,true);
  assert.equal(getRenderCount(),before,'checking must not trigger a screen re-render');
  assert.ok(root.contains(backlog),'expanded billing group is not replaced');
  assert.ok(root.contains(originalItem),'row is not replaced');
  assert.equal(backlog.open,true,'billing group remains expanded');
  assert.equal(data.transactionManualSelected[transactionSelectionKey(rows[0])],true);
  const all=backlog.querySelector('[data-finance-transaction-select-all]');
  assert.equal(all.checked,false);assert.equal(all.indeterminate,true);
  assert.equal(backlog.querySelector('[data-finance-transaction-period]').disabled,false);
  change(dom,item,false);
  assert.equal(all.indeterminate,false);
  assert.equal(backlog.querySelector('[data-finance-transaction-period]').disabled,true);
  root._financeUnbind();dom.window.close();
});

test('select all applies only to its payer period and can deselect every row',()=>{
  const {root,data,rows,dom,getRenderCount}=mount();
  const backlog=root.querySelector('[data-finance-transaction-period="2026-09"]').closest('[data-finance-transaction-group]');
  backlog.open=true;
  const selectAll=backlog.querySelector('[data-finance-transaction-select-all]');
  const before=getRenderCount();
  change(dom,selectAll,true);
  assert.equal(getRenderCount(),before);assert.equal(backlog.open,true);
  assert.ok([...backlog.querySelectorAll('[data-finance-transaction-select]')].every(x=>x.checked));
  assert.equal(data.transactionManualSelected[transactionSelectionKey(rows[3])],undefined,'current month is not selected');
  assert.equal(transactionPreviewForVisit(data,'manual').accounts.length,0,'backlog stays out of current month');
  assert.equal(backlog.querySelector('[data-finance-transaction-period]').disabled,false);
  change(dom,selectAll,false);
  assert.ok([...backlog.querySelectorAll('[data-finance-transaction-select]')].every(x=>!x.checked));
  assert.equal(backlog.querySelector('[data-finance-transaction-period]').disabled,true);
  root._financeUnbind();dom.window.close();
});

test('current month select all updates the issue action without collapsing the payer',()=>{
  const {root,data,rows,dom,getRenderCount}=mount();
  const current=[...root.querySelectorAll('[data-finance-transaction-group]')].find(g =>
    [...g.querySelectorAll('[data-finance-transaction-select]')].some(x=>x.dataset.financeTransactionSelect===transactionSelectionKey(rows[3])));
  assert.ok(current);
  const original=current;
  const all=current.querySelector('[data-finance-transaction-select-all]');
  const issue=root.querySelector('[data-finance-transaction-main-run]');
  assert.equal(issue.disabled,true);
  const before=getRenderCount();
  change(dom,all,true);
  assert.equal(getRenderCount(),before);
  assert.equal(root.contains(original),true);
  assert.equal(current.open,true);
  assert.equal(issue.disabled,false);
  assert.notEqual(issue.style.display,'none');
  assert.equal(transactionPreviewForVisit(data,'manual').totals.amount,870);
  change(dom,all,false);
  assert.equal(issue.disabled,true);
  assert.equal(issue.style.display,'none');
  assert.equal(transactionPreviewForVisit(data,'manual').accounts.length,0);
  root._financeUnbind();dom.window.close();
});
