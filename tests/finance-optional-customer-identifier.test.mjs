import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261030051500_finance_optional_customer_identifier.sql', import.meta.url), 'utf8');
const edge = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');

test('school symbols are required only for monthly Gefen billing, not funder invoices',()=>{
  assert.match(sql, /source_reason='' and monthly and coalesce\(base->>'institutionSymbol',''\)=''/);
  assert.match(sql, /alter column institution_symbol drop not null/);
  assert.match(sql, /mode='automatic' and row->>'institutionSymbol' is distinct from p_institution_symbol/);
  assert.match(sql, /idempotency_key=p_idempotency_key;/);
  assert.match(sql, /idempotency_only_unique/);
});
test('manual quote never copies school ID into unrelated payer customer number',()=>{
  assert.match(sql, /case when \(r->>'gefenFunding'\)::boolean then r->>'institutionSymbol' else null end/);
  assert.match(sql, /q->>'institution_symbol',r->>'payerName'/);
});
test('PDF displays only a real identifier and labels it by payer type',()=>{
  assert.match(edge, /if \(clean\(account\.institution_symbol\)\)/);
  assert.match(edge, /schoolBilling \? 'סמל מוסד' : 'מספר לקוח'/);
  assert.doesNotMatch(edge, /מספר לקוח: \$\{account\.institution_symbol\}/);
});
