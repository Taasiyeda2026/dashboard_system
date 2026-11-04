import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/20261104104800_finance_batch_dispatch_period_validation.sql',import.meta.url),'utf8');
test('consolidated Gefen dispatch looks up period by both activity and funder',()=>{
 assert.match(sql,/jsonb_array_elements\(coalesce\(account\.manual_draft->'items','\[\]'::jsonb\)\)/);
 assert.match(sql,/item->>'activity'=l\.activity_row_id/);
 assert.match(sql,/\(item->>'funder'\)::uuid=l\.funding_source_id/);
 assert.match(sql,/account\.manual_draft->'source'->>'period'/);
});
test('retain all financial checks for consolidated and single-account dispatch',()=>{
 for(const term of ['fullFundingBlockedReason','fullFundingAmount','payerKey','fundingAmount','stale_billing_reservation']) assert.ok(sql.includes(term),term);
});
