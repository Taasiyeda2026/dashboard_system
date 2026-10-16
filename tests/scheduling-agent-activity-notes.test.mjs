import test from 'node:test';
import assert from 'node:assert/strict';
import {schedulingError} from '../supabase/functions/scheduling-agent-team-gateway/diagnostics.mjs';
let handler;
globalThis.Deno={env:{get:()=> 'test-key'},serve:h=>{handler=h;}};
await import('../supabase/functions/scheduling-agent-team-gateway/index.ts');
const args={activityId:'course-1',note:'Estimated date — pending approval',expectedNotesVersion:'d41d8cd98f00b204e9800998ecf8427e',requestId:'11111111-1111-4111-8111-111111111111'};
async function call(name,input,{authenticated=true,member=true,network=false,denied=false}={}){
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,opts)=>{
  calls.push({url,opts});
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'synthetic-user'});
  if(url.endsWith('/scheduling_agent_team_identity'))return Response.json({authorized:member});
  if(network)throw Error('network lost');
  if(denied)return Response.json({code:'42501',message:'activity_notes_permission_denied'},{status:403});
  return Response.json({notes:'Existing\nNew',notesVersion:args.expectedNotesVersion,canAppendNotes:true,saved:true});
 };
 try{
  const r=await handler(new Request('https://test.invalid/mcp',{method:'POST',headers:authenticated?{Authorization:'Bearer user-jwt'}:{},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:input}})}));
  const raw=await r.json();let body;try{body=JSON.parse(raw.result?.content?.[0]?.text);}catch{body=raw;}
  return {status:r.status,body,calls};
 }finally{globalThis.fetch=original;}
}
test('notes read and append use caller identity and exact activity notes RPC',async()=>{
 const read=await call('read_activity_notes',{activityId:'course-1'});assert.match(read.calls.at(-1).url,/scheduling_agent_team_read_activity_notes$/);
 const r=await call('append_activity_note',args);
 assert.match(r.calls.at(-1).url,/scheduling_agent_team_append_activity_note$/);
 assert.equal(r.calls.at(-1).opts.headers.Authorization,'Bearer user-jwt');
 assert.deepEqual(JSON.parse(r.calls.at(-1).opts.body),{p_activity_id:args.activityId,p_note:args.note,p_expected_notes_version:args.expectedNotesVersion,p_request_id:args.requestId});
});
test('unknown fields, empty notes, invalid versions and request IDs cannot dispatch',async()=>{
 for(const input of [{...args,finance_notes:'x'},{...args,note:' '},{...args,expectedNotesVersion:'0'},{...args,requestId:'bad'}]){
  const r=await call('append_activity_note',input);assert.equal(r.calls.length,2);assert.equal(r.body.result.isError,true);
 }
});
test('authentication and membership are enforced before note access',async()=>{
 assert.equal((await call('read_activity_notes',{activityId:'course-1'},{authenticated:false})).status,401);
 assert.equal((await call('append_activity_note',args,{member:false})).status,401);
});
test('write denial is actionable; uncertain write never claims success or retries',async()=>{
 const denied=await call('append_activity_note',args,{denied:true});assert.equal(denied.body.reasonCode,'activity_notes_permission_denied');assert.equal(denied.body.writesCommitted,false);
 const uncertain=await call('append_activity_note',args,{network:true});assert.equal(uncertain.body.writesCommitted,null);assert.equal(uncertain.calls.length,3);
 assert.equal(schedulingError({message:'activity_notes_version_conflict'},409).reasonCode,'activity_notes_version_conflict');
});
