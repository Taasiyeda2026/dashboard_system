import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ensureNoEndDateTab } from '../frontend/src/finance-collection-no-end-tab-runtime.js';

test('transaction invoice tabs never show the legacy no-end-date button',()=>{
  const dom=new JSDOM('<div class="ds-fin-collect-shell"><div class="ds-fin-tabs" role="tablist"><button data-finance-transaction-tab="automatic">גפן</button><button data-finance-transaction-tab="editable">הפקה ידנית</button></div></div>');
  const document=dom.window.document;
  ensureNoEndDateTab(document);
  assert.equal(document.querySelectorAll('[data-finance-collection-tab="no_end_date"]').length,0);
  // A previous runtime may have inserted it; remove it if this tablist is not collection.
  document.querySelector('.ds-fin-tabs').insertAdjacentHTML('beforeend','<button data-finance-collection-tab="no_end_date">ללא</button>');
  ensureNoEndDateTab(document);
  assert.equal(document.querySelectorAll('[data-finance-collection-tab="no_end_date"]').length,0);
  dom.window.close();
});
test('old collection tabs still show a no-end-date filter where it is relevant',()=>{
  const dom=new JSDOM('<div class="ds-fin-collect-shell"><div class="ds-fin-tabs" role="tablist"><button data-finance-collection-tab="open">פתוחים</button><button data-finance-collection-tab="closed">סגורים</button></div></div>');
  const document=dom.window.document;
  ensureNoEndDateTab(document);
  assert.equal(document.querySelectorAll('[data-finance-collection-tab="no_end_date"]').length,1);
  ensureNoEndDateTab(document);
  assert.equal(document.querySelectorAll('[data-finance-collection-tab="no_end_date"]').length,1);
  dom.window.close();
});
