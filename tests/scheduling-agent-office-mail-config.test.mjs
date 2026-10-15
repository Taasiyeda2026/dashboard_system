import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('wakeup uses existing approved office mail app without changing shared MS credentials',()=>{
 const code=readFileSync(new URL('../supabase/functions/scheduling-agent-wakeup/index.ts',import.meta.url),'utf8');
 assert.match(code,/tenantId:Deno\.env\.get\('FEEDBACK_STAFF_MS_TENANT_ID'\)/);
 assert.match(code,/clientId:Deno\.env\.get\('FEEDBACK_STAFF_MS_CLIENT_ID'\)/);
 assert.match(code,/clientSecret:Deno\.env\.get\('FEEDBACK_STAFF_MS_CLIENT_SECRET'\)/);
 assert.match(code,/sender:'office@think\.org\.il'/);
 assert.doesNotMatch(code,/Deno\.env\.get\('MS_CLIENT_SECRET'\)/);
});
