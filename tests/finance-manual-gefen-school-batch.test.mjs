import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const front=await readFile(new URL('../frontend/src/screens/finance-manual-account.js',import.meta.url),'utf8');
const sql=await readFile(new URL('../supabase/migrations/20261104102100_finance_manual_gefen_same_school_batch.sql',import.meta.url),'utf8');
const pdf=await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');

test('manual Gefen full-funding groups by school and funder, not activity ID',()=>{
 assert.match(front,/const fullGefen=gefen && entry\.request\.draft\?\.billing_basis==='full_funding'/);
 assert.match(front,/fullGefen \? `gefen:\$\{payerKey\}:\$\{entry\.request\.funder\}` : `gefen:\$\{entry\.id\}`/);
});
test('server permits Gefen batch only for full-funding claims',()=>{
 assert.match(sql,/gefenFunding'\)::boolean,true\)\s*and q->>'billing_basis' is distinct from 'full_funding'/);
 assert.match(sql,/is distinct from funder_id/);
 assert.match(sql,/payer_key_snapshot' is distinct from payer_key/);
 assert.match(sql,/expected_revision/);
});
test('billed Gefen lines retain monthly classification in combined invoice',()=>{
 assert.match(sql,/case when coalesce\(\(s->>'gefenFunding'\)::boolean,false\) then 'monthly' else 'completion' end/);
});
test('manual PDF addresses courses to school, workshops to payer',()=>{
 assert.match(pdf,/account\.issue_mode === 'manual' && isCourseOnly && billedSchools\.length/);
 assert.match(pdf,/\['workshop', 'tour', 'סדנה', 'סיור'\]/);
});
