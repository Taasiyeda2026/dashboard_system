import test from 'node:test';
import assert from 'node:assert/strict';
import {createGateway,snapshotHash,GatewayError} from '../supabase/functions/scheduling-agent-gateway/gateway.mjs';
const CANONICAL_SHEET_ID='fixture-sheet';
const uuid='11111111-1111-4111-8111-111111111111';
const request=body=>new Request('https://private.example/gateway',{method:'POST',body:JSON.stringify(body)});
function setup(options={}){const calls=[];const gateway=createGateway({spreadsheetId:CANONICAL_SHEET_ID,authenticate:async()=>({id:'owner'}),rpc:async(a,n,p)=>(calls.push([n,p]),{state:'pending'}),readSheet:async(a,id)=>{assert.equal(id,CANONICAL_SHEET_ID);return {values:[['course','instructor']],modifiedTime:'revision1'};},...options});return {gateway,calls};}
test('snapshot reads both pinned sources and creates a deterministic hash',async()=>{
 const {gateway,calls}=setup();const r=await gateway(request({action:'read_snapshot'}));assert.equal(r.status,200);
 const data=await r.json();assert.equal(data.result.sheetHash.length,64);assert.equal(calls[0][0],'scheduling_agent_read_snapshot');
 assert.equal(await snapshotHash({b:1,a:2}),await snapshotHash({a:2,b:1}));
 assert.notEqual(await snapshotHash({a:2}),await snapshotHash({a:3}));
});
test('anonymous caller never reads a sheet or database',async()=>{
 let reads=0;const {gateway,calls}=setup({authenticate:async()=>null,readSheet:async()=>{reads++;}});
 const r=await gateway(request({action:'read_snapshot'}));assert.equal(r.status,401);assert.equal(reads,0);assert.equal(calls.length,0);
});
test('only stored option selections enter approval; arbitrary fields and role spoofing fail',async()=>{
 const {gateway,calls}=setup();const body={action:'request_approval',activityId:'course-1',optionIndex:0,workspaceRevision:'12070',sourceRevision:'442',idempotencyKey:uuid};
 assert.equal((await gateway(request({...body,instructorId:55}))).status,400);assert.equal(calls.length,0);
 assert.equal((await gateway(request({...body,role:'admin'}))).status,400);
 assert.equal((await gateway(request(body))).status,200);assert.equal(calls.at(-1)[0],'scheduling_agent_request_approval');assert.equal(calls.at(-1)[1].p_sheet_hash.length,64);
});
test('default deployment refuses commits even with an approval request ID',async()=>{
 const {gateway,calls}=setup();assert.equal((await gateway(request({action:'commit_approved_changes',requestId:uuid}))).status,503);assert.equal(calls.length,0);
});
test('approval is never a tool action; SQL and sheet destinations cannot be supplied',async()=>{
 const {gateway,calls}=setup();for(const action of ['approve','execute_sql','update_sheet'])assert.equal((await gateway(request({action}))).status,400);
 assert.equal((await gateway(request({action:'read_snapshot',spreadsheetId:'another'}))).status,400);assert.equal(calls.length,0);
});
test('trusted commit adapter reads sheet again and delegates approval consumption to one atomic RPC',async()=>{
 const {gateway,calls}=setup({commitsEnabled:true});const response=await gateway(request({action:'commit_approved_changes',requestId:uuid}));assert.equal(response.status,200);
 assert.deepEqual(calls.map(c=>c[0]),['scheduling_agent_read_snapshot','scheduling_agent_commit_approved']);assert.equal(calls[1][1].p_request_id,uuid);
});
test('configuration failure and upstream secrets never escape in response',async()=>{
 const {gateway}=setup({rpc:async()=>{throw Error('Bearer secret-token');}});const response=await gateway(request({action:'read_snapshot'}));assert.equal(response.status,502);assert.equal((await response.text()).includes('secret-token'),false);
});
test('oversized payload rejected before authentication or dependency calls',async()=>{
 let auth=0;const {gateway}=setup({authenticate:async()=>{auth++;return {id:'owner'};}});
 assert.equal((await gateway(request({action:'read_snapshot',blob:'x'.repeat(20000)}))).status,413);assert.equal(auth,0);
});
test('missing server OAuth returns a clearly partial read snapshot but never creates approval',async()=>{
 const {gateway,calls}=setup({readSheet:async()=>{throw new GatewayError('google_server_oauth_not_configured',503);}});
 const r=await gateway(request({action:'read_snapshot'}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.result.googleStatus,'authorization_required');assert.equal(data.result.sheetHash,null);
 const approval=await gateway(request({action:'request_approval',activityId:'course',optionIndex:0,workspaceRevision:'1',sourceRevision:'1',idempotencyKey:uuid}));assert.equal(approval.status,503);assert.equal(calls.some(c=>c[0]==='scheduling_agent_request_approval'),false);
});
