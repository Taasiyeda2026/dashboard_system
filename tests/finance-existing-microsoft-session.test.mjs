import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const finance = await readFile(new URL('../frontend/src/screens/finance.js',import.meta.url),'utf8');
const delegated = await readFile(new URL('../frontend/src/microsoft/finance-invoice-mail.js',import.meta.url),'utf8');

test('finance manual confirmation obtains Microsoft mail token before reserving or dispatching',()=>{
  const manual = finance.slice(finance.indexOf("const manualConfirm ="),finance.indexOf("if (ev.target.closest('[data-finance-clear-notification-filter]'))"));
  assert.match(manual,/delegatedMailToken\([\s\S]*?interactive: true[\s\S]*?runSelectedManualAccounts\(visit, api\)/);
});
test('finance monthly billing obtains Microsoft token before reserving or dispatching',()=>{
  const month = finance.slice(finance.indexOf("const transactionRun ="),finance.indexOf("const tabBtn =",finance.indexOf("const transactionRun =")));
  assert.match(month,/delegatedMailToken\([\s\S]*?interactive: true[\s\S]*?runTransactionIssuance\(visit, api/);
});
test('finance uses verified auth email before profile email for same mailbox',()=>{
  assert.match(delegated,/user\?\.auth_email \|\| user\?\.email/);
  assert.match(finance,/state\?\.user\?\.auth_email \|\| state\?\.user\?\.email/);
});
test('draft generation retains non-interactive path in background to avoid unsolicited popups',()=>{
  assert.match(delegated,/interactive: false/);
});
