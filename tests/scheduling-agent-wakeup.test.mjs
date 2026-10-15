import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {createGithubAppDispatcher} from '../supabase/functions/scheduling-agent-wakeup/github-app.mjs';
import {createWakeupHandler} from '../supabase/functions/scheduling-agent-wakeup/handler.mjs';

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pem=privateKey.export({format:'pem',type:'pkcs8'});
const time=Date.parse('2026-10-15T08:00:00Z');
function fixture(overrides={}){
 const calls=[];
 const documents=[{app_id:123,account:{login:'Taasiyeda2026'},suspended_at:null},
  {token:'synthetic-installation-token',permissions:{actions:'write'},expires_at:new Date(time+3600000).toISOString()},
  {total_count:1,repositories:[{id:1212938814,full_name:'Taasiyeda2026/dashboard_system'}]},
  {state:'active',path:'.github/workflows/scheduling-agent-worker.yml'},null];
 const dispatch=createGithubAppDispatcher({appId:'123',installationId:'456',privateKey:pem,now:()=>time,
  fetchImpl:async(url,options)=>{calls.push({url,options});const i=calls.length-1;
   if(overrides.failAt===i)throw Error('private-key-must-not-leak');
   if(overrides.httpAt===i)return Response.json({message:'sensitive-provider-body'},{status:403});
   if(i===4)return new Response(null,{status:204});
   return Response.json(Object.hasOwn(overrides,i)?overrides[i]:documents[i]);
  }});
 return {dispatch,calls};
}
test('signed App JWT exchanges narrowly scoped token and dispatches exact workflow/main',async()=>{
 const f=fixture();assert.deepEqual(await f.dispatch(),{accepted:true});
 const jwt=f.calls[0].options.headers.Authorization.slice(7);const [h,b,s]=jwt.split('.');
 assert.equal(verify('RSA-SHA256',Buffer.from(h+'.'+b),publicKey,Buffer.from(s,'base64url')),true);
 const claims=JSON.parse(Buffer.from(b,'base64url'));assert.equal(claims.iss,'123');assert.ok(claims.exp-claims.iat<=180);
 assert.deepEqual(JSON.parse(f.calls[1].options.body),{repository_ids:[1212938814],permissions:{actions:'write'}});
 assert.equal(f.calls[4].url,'https://api.github.com/repos/Taasiyeda2026/dashboard_system/actions/workflows/scheduling-agent-worker.yml/dispatches');
 assert.deepEqual(JSON.parse(f.calls[4].options.body),{ref:'main'});
 assert.ok(f.calls.every(c=>c.options.redirect==='error'));
});
for(const [name,overrides,code] of [
 ['missing Actions write',{1:{token:'synthetic',permissions:{actions:'read'},expires_at:new Date(time+3600000).toISOString()}},'github_actions_write_required'],
 ['wrong repository',{2:{total_count:1,repositories:[{id:22,full_name:'other/repo'}]}},'github_repository_scope_denied'],
 ['multiple repository token',{2:{total_count:2,repositories:[{id:1212938814,full_name:'Taasiyeda2026/dashboard_system'}]}},'github_repository_scope_denied'],
 ['suspended installation',{0:{app_id:123,account:{login:'Taasiyeda2026'},suspended_at:'2026-10-15'}},'github_installation_denied'],
 ['disabled workflow',{3:{state:'disabled_manually',path:'.github/workflows/scheduling-agent-worker.yml'}},'github_workflow_inactive'],
 ['provider permission denied',{httpAt:1},'github_app_permission_denied'],
 ['lost provider connection',{failAt:4},'github_unreachable']
])test(name+' fails closed without leaking provider details',async()=>{
 const f=fixture(overrides);await assert.rejects(f.dispatch(),e=>e.code===code&&!e.message.includes('sensitive'));
 if(overrides.failAt!==4)assert.ok(f.calls.length<5);
});
test('missing App configuration never falls back to PAT',async()=>{
 await assert.rejects(createGithubAppDispatcher({})(),e=>e.code==='github_app_not_configured');
});
test('readiness verifies Actions write without dispatching or touching queue',async()=>{
 const f=fixture();const handler=createWakeupHandler({secret:'synthetic-server-secret-32-characters',
  dispatch:f.dispatch,command:()=>assert.fail('readiness must not reserve')});
 const r=await handler(new Request('https://example.invalid/wake',{method:'POST',
  headers:{'x-scheduling-wakeup-secret':'synthetic-server-secret-32-characters'},body:'{"action":"verify"}'}));
 assert.equal((await r.json()).verified,true);assert.equal(f.calls.length,4);
 assert.ok(f.calls.every(c=>!c.url.endsWith('/dispatches')));
});
const secret='synthetic-server-secret-32-characters';
const req=(key=secret,method='POST')=>new Request('https://example.invalid/wake',{method,headers:{'x-scheduling-wakeup-secret':key}});
test('unauthorized wake and wrong method never reserve or dispatch',async()=>{
 const handler=createWakeupHandler({secret,command:()=>assert.fail(),dispatch:()=>assert.fail()});
 assert.equal((await handler(req('invalid'))).status,401);
 assert.equal((await handler(req(secret,'GET'))).status,405);
});
test('disabled or already reserved queue never dispatches',async()=>{
 const handler=createWakeupHandler({secret,command:async()=>({reserved:false}),dispatch:()=>assert.fail()});
 assert.deepEqual(await (await handler(req())).json(),{status:'idle'});
});
test('dispatch failure is acknowledged for durable retry, not job completion',async()=>{
 const events=[];const handler=createWakeupHandler({secret,
  command:async(action,payload)=>{events.push({action,payload});return {reserved:true,jobId:'synthetic',dispatchToken:'synthetic'};},
  dispatch:async()=>{throw Object.assign(Error('not logged'),{code:'github_unreachable'});}});
 const response=await handler(req());assert.equal(response.status,503);
 assert.equal(events[1].action,'ack');assert.equal(events[1].payload.accepted,false);
 assert.equal(events[1].payload.failureCode,'github_unreachable');
});
test('lost acknowledgement reports unavailable; never reports optimization completed',async()=>{
 let dispatched=0;const handler=createWakeupHandler({secret,
  command:async action=>{if(action==='ack')throw Error('lost');return {reserved:true,jobId:'synthetic',dispatchToken:'synthetic'};},
  dispatch:async()=>{dispatched++;}});
 const response=await handler(req());assert.equal(dispatched,1);assert.equal(response.status,503);
 assert.deepEqual(await response.json(),{code:'wakeup_backend_unavailable'});
});
