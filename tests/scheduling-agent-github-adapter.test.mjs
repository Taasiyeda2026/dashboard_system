import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  WORKER_AUDIENCE,WorkerTransportError,
  prepareServerPlanningSnapshot,createGithubWorkerTransport,
  createGithubAgentBackend
} from '../services/scheduling-agent/github-adapter.mjs';

const JWT_HEAD=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');
const JWT_BODY=Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url');
const TOKEN=JWT_HEAD+'.'+JWT_BODY+'.signature';

test('GitHub OIDC never needs reusable Supabase or GitHub PAT secrets',async()=>{
 const calls=[];
 const fetchImpl=async(url,options)=>{
  const raw=String(url);calls.push({url:raw,header:options.headers.Authorization,body:options.body});
  if(raw.includes('audience='))return{ok:true,json:async()=>({value:TOKEN})};
  assert.match(options.headers.Authorization,/^Bearer /);
  return{ok:true,json:async()=>({claimed:false})};
 };
 const env={ACTIONS_ID_TOKEN_REQUEST_URL:'https://oidc.actions.githubusercontent.com/token',
   ACTIONS_ID_TOKEN_REQUEST_TOKEN:'github-runtime-secret'};
 const transport=createGithubWorkerTransport({env,fetchImpl});
 assert.deepEqual(await transport.call('claim'),{claimed:false});
 assert.match(calls[0].url,/audience=taasiyeda-scheduling-agent-worker/);
 assert.equal(calls[1].header,'Bearer '+TOKEN);
 assert.doesNotMatch(String(calls[1].body),/private|secret|password/i);
});

test('will never make an unauthenticated worker request',()=>{
 assert.throws(()=>createGithubWorkerTransport({env:{}}),e=>e.code==='github_oidc_identity_unavailable');
 assert.throws(()=>createGithubWorkerTransport({env:{ACTIONS_ID_TOKEN_REQUEST_URL:'x',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'y'},baseUrl:'http://localhost'}),e=>e.code==='worker_api_https_required');
});

test('incomplete and non-authoritative snapshots are rejected before the engine',()=>{
 const empty={workspace:{revision:'12200'},sourceRevision:'649',activities:[]};
 assert.throws(()=>prepareServerPlanningSnapshot(empty),e=>e.code==='missing_server_snapshot_instructors');
 assert.throws(()=>prepareServerPlanningSnapshot({...empty,instructors:[],schoolLocations:[],
    externalBlockers:[],meetingInstructorHistory:[],profiles:[],rules:[],exceptions:[],
    schoolCalendar:[],catalog:[],routes:[],existingRows:[],targetCourseIds:[]}),
  e=>e.code==='authoritative_planning_source_incomplete');
});

test('workflow only runs on main schedule or explicit dispatch with exact OIDC permission',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/scheduling-agent-worker.yml',import.meta.url),'utf8');
 assert.match(yaml,/id-token: write/);
 assert.match(yaml,/github\.ref == 'refs\/heads\/main'/);
 assert.match(yaml,/github\.repository == 'Taasiyeda2026\/dashboard_system'/);
 assert.match(yaml,/persist-credentials: false/);
 assert.doesNotMatch(yaml,/pull_request:/);
 assert.doesNotMatch(yaml,/secrets\.|SUPABASE_SERVICE_ROLE_KEY/);
});

test('adapter provides only the narrow runner interface',()=>{
 const stub={call:async()=>({})};
 const backend=createGithubAgentBackend(stub);
 assert.deepEqual(Object.keys(backend).sort(),[
  'claimJob','acquireLease','heartbeatLease','loadSnapshot','readPreflight',
  'persistProposals','finishJob','releaseLease'].sort());
});

test('long-lived OIDC tokens refresh before the Edge iat window expires',async()=>{
 let time=Date.now(),exchanges=0;
 const transport=createGithubWorkerTransport({now:()=>time,
  env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic'},
  fetchImpl:async(url)=>{
   if(String(url).includes('audience=')){exchanges++;return {ok:true,json:async()=>({value:JWT_HEAD+'.'+
    Buffer.from(JSON.stringify({exp:Math.floor(time/1000)+3600})).toString('base64url')+'.signature'})};}
   return {ok:true,json:async()=>({ok:true})};
  }});
 await transport.call('heartbeat');time+=181000;await transport.call('heartbeat');
 assert.equal(exchanges,2);
});

test('lost worker connection has a safe retryable error code',async()=>{
 const transport=createGithubWorkerTransport({
  env:{ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid/token',ACTIONS_ID_TOKEN_REQUEST_TOKEN:'synthetic'},
  fetchImpl:async(url)=>{if(String(url).includes('audience='))return {ok:true,json:async()=>({value:TOKEN})};
   throw Error('private provider detail');}});
 await assert.rejects(transport.call('persist'),e=>e.code==='worker_transport_failed'&&!e.message.includes('private'));
});
