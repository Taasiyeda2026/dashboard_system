import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const consent=readFileSync(new URL('../frontend/src/scheduling-agent-approval-page.js',import.meta.url),'utf8');

test('OAuth consent permits only authenticated scheduling team identities',()=>{
 assert.match(consent,/const authorizationId=new URL\(location.href\).searchParams.get\('authorization_id'\)/);
 assert.match(consent,/if\(authorizationId\)\{[\s\S]*?scheduling_agent_team_identity/);
 assert.match(consent,/teamAccess\?\.authorized!==true/);
 assert.match(consent,/supabase.auth.oauth.getAuthorizationDetails\(authorizationId\)/);
 assert.match(consent,/supabase.auth.oauth.approveAuthorization\(authorizationId\)/);
 assert.match(consent,/supabase.auth.oauth.denyAuthorization\(authorizationId\)/);
});

test('Non-OAuth manager approval remains owner-only',()=>{
 const consentBlock=consent.indexOf('if(authorizationId){');
 const end=consent.indexOf('const requests=await rpc(',consentBlock);
 const current=consent.slice(consentBlock,end);
 assert.ok(current.indexOf("scheduling_agent_team_identity")>=0);
 assert.ok(!current.includes("rpc('scheduling_agent_read_snapshot')"),
   'Team consent must not invoke the owner-only snapshot RPC');
 assert.match(consent.slice(end-180,end),/await rpc\('scheduling_agent_read_snapshot'\)/);
 assert.match(consent,/const requests=await rpc\('scheduling_agent_list_requests'\)/);
});

test('Consent callback never redirects to arbitrary HTTP origins',()=>{
 assert.match(consent,/if\(target.protocol!=='https:'\)/);
});
