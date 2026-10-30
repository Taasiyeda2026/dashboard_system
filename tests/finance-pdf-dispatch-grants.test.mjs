import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { financeError } from '../frontend/src/screens/finance-errors.js';

const sql=readFileSync(new URL('../supabase/migrations/20261030160000_finance_pdf_dispatch_service_role_select.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');
const api=readFileSync(new URL('../frontend/src/api.js',import.meta.url),'utf8');

test('the PDF dispatcher receives SELECT only on three invoice snapshots; not user roles',()=>{
  assert.match(sql,/grant select on table\s+public\.finance_transaction_accounts,\s+public\.finance_transaction_account_lines,\s+public\.finance_transaction_account_meetings\s+to service_role;/i);
  assert.doesNotMatch(sql,/\bgrant\s+(all|update|insert|delete)\b|\bto\s+(anon|authenticated)\b/i);
});
test('Edge function uses fixed browser preflight and preserves JWT requirement on POST',()=>{
  assert.match(edge,/Access-Control-Allow-Headers["']: ["']authorization, x-client-info, apikey, content-type/);
  assert.match(edge,/Access-Control-Allow-Methods["']: ["']POST, OPTIONS/);
  assert.match(edge,/finance_transaction_can_issue/);
});
test('the frontend retains concrete dispatch errors rather than replacing with a generic string',()=>{
  assert.match(api,/typeof error\.context\?\.json === 'function'/);
  assert.match(api,/server\?\.error/);
  assert.match(financeError(new Error('finance_pdf_connection_failed')),/שירות הפקת החשבון/);
  assert.match(financeError(new Error('finance_pdf_authorization_failed')),/אינו מורשה/);
  assert.match(financeError(new Error('graph_auth_failed')),/SharePoint/);
});
