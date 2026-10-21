import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const backend=readFileSync(new URL('../supabase/functions/instructor-observation-sharepoint/index.ts',import.meta.url),'utf8');
const frontend=readFileSync(new URL('../frontend/src/instructor-observation-runtime.js',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261021133500_instructor_observation_sharepoint_exports.sql',import.meta.url),'utf8');

test('SharePoint path is resolved by mapped instructor identity rather than browser input',()=>{
 assert.match(backend,/eq\("emp_id",observation\.emp_id\)/);
 assert.match(backend,/eq\("school_year","2027"\)/);
 assert.match(backend,/canonicalEmployeeFolder\(mapping\.folder_web_url\)/);
 assert.match(backend,/\/03 תצפיות\/תצפית "/);
 assert.match(backend,/observation\.details\?\.observation_slot/);
 assert.match(backend,/if\(!\[1,2\]\.includes\(slot\)\)/);
 assert.match(backend,/folder\.folder/);
 assert.match(backend,/parsed\.origin!==SITE/);
 assert.match(backend,/decoded\.startsWith\(BASE\)/);
 assert.match(backend,/name\.includes\("\/"\)/);
});
test('PDF name includes verified instructor name, observation slot, date and unique immutable ID',()=>{
 assert.match(backend,/name\+" - תצפית "\+slot\+" - "\+dateString\(observation\.observation_date\)/);
 assert.match(backend,/observation\.id\.slice\(0,8\)/);
 assert.match(backend,/if\(receipt\)return json\(savedReceipt\(receipt\)\)/);
 assert.match(backend,/let file=await graph\(token,destination,\{\},true\)/);
 assert.match(backend,/\.upsert\(row,\{onConflict:"observation_id"\}\)/);
 assert.match(backend,/if\(!file\)/);
 assert.match(backend,/body:new Uint8Array\(pdfBytes\)/);
});
test('PDF is created from completed DB record with embedded Hebrew font, never browser input',()=>{
 assert.match(backend,/client\.from\("instructor_observations"\)\.select\("\*"\)/);
 assert.match(backend,/observation\.status!=="completed"/);
 assert.match(backend,/buildPdf\(observation,slot\)/);
 assert.match(backend,/npm:pdf-lib/);
 assert.match(backend,/npm:@pdf-lib\/fontkit/);
 assert.match(backend,/npm:bidi-js/);
 assert.match(backend,/return new Uint8Array\(await pdf\.save\(\)\)/);
 assert.doesNotMatch(frontend,/MS_CLIENT_SECRET|MS_TENANT_ID|graph\.microsoft\.com/);
});
test('UI automatically uploads after completion and offers a retry without unlocking completed report',()=>{
 assert.match(frontend,/else if \(action==='finish'\) \{stage=9;render\(\);await saveSharePointPdf\(\);\}/);
 assert.match(frontend,/if\(action==='sharepoint'\)/);
 assert.match(frontend,/sharepointReceipt=data/);
 assert.match(frontend,/href="'\+\s*e\(sharepointReceipt\.url\)/);
 assert.match(sql,/observation_id uuid primary key/);
 assert.match(sql,/grant select .* authenticated/);
 assert.doesNotMatch(sql,/grant (insert|update|delete).*authenticated/);
});
