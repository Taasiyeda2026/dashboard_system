// Actual local SQL functions; identity deliberately modeled, not real Supabase Auth.
import pg from 'pg';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
const c=new pg.Client({connectionString:'postgresql://postgres:isolated-test-only@127.0.0.1:55439/codex_engine_decision'});await c.connect();
const out=process.env.ACCEPTANCE_OUT,plan=JSON.parse(await readFile(out+'/national-plan.json','utf8')),version=plan.engineVersion,run='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await c.query("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false),set_config('test.role','admin',false)");
const source=(await c.query('select revision from public.scheduling_planning_source_state')).rows[0].revision;
await c.query("insert into public.scheduling_planning_workspaces(period_key,district,engine_version,validated_source_revision) values ('year','','planning-v31',$1) on conflict(period_key,district) do nothing",[source]);
let revision=(await c.query("select revision from public.scheduling_planning_workspaces where period_key='year' and district='' ")).rows[0].revision;
const acquire=()=>c.query("select public.acquire_scheduling_planning_run_lease('year','',$1,120)",[run]);await acquire();
async function checkpoint(rows,phase='validated') {for(let i=0;i<rows.length;i+=10){const meta={__planningRunMeta:true,phase:i+10>=rows.length?phase:'running',planningStage:'planned',workspaceRevision:String(revision),sourceRevision:String(source)};await c.query("select public.save_scheduling_planning_checkpoint('year','',$1,'isolated','isolated',$2,$2,'[]'::jsonb,$3::jsonb,$4,$5)",[version,rows.length,JSON.stringify([meta,...rows.slice(i,i+10)]),run,source]);}}
const commit=()=>c.query("select public.commit_scheduling_planning_checkpoint('year','',$1,'isolated','isolated',$2,$3,$4) value",[version,revision,run,source]);
await checkpoint(plan.rows);const at=performance.now();const saved=await commit();const saveMs=performance.now()-at;revision=saved.rows[0].value.revision;
const canonical=async()=>(await c.query('select row_data from public.scheduling_planning_rows order by activity_id')).rows.map(r=>r.row_data);
assert.deepEqual(await canonical(),[...plan.rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)));console.log(JSON.stringify({saveMs,rows:plan.rows.length,revision}));
const results=[{case:'actual SQL commit and full load parity',pass:true,saveMs,rows:plan.rows.length}];
for(const [name,modify] of [
 ['protected instructor change',rows=>{rows.find(r=>r.kind==='live'&&r.instructorEmpId).instructorEmpId='999';}],
 ['official date removal',rows=>{rows.find(r=>r.kind==='live'&&r.meetings.length).meetings.pop();}],
 ['forged live cannot bypass gates',rows=>{const r=rows.find(r=>r.kind==='fixed-proposal'&&r.instructorEmpId);r.kind='live';r.instructorEmpId='999';}],
 ['invalid new meeting',rows=>{const r=rows.find(r=>r.kind==='proposal'&&r.instructorEmpId);r.meetings[0].end_time='23:59';}]
]){await acquire();const rows=structuredClone(plan.rows);modify(rows);await checkpoint(rows);let error;try{await commit()}catch(e){error=e;}assert.ok(error,name);assert.deepEqual(await canonical(),[...plan.rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)));results.push({case:name,pass:true,rejection:error.message});}
await acquire();await checkpoint(plan.rows);await c.query("select public.release_scheduling_planning_run_lease('year','',$1)",[run]);await assert.rejects(commit(),e=>e.message.includes('planning_run_ownership_lost'));results.push({case:'cancelled run cannot commit',pass:true});
for(const role of ['admin','operation_manager','denied']){await c.query("select set_config('test.role',$1,false)",[role]);if(role==='denied')await assert.rejects(acquire(),e=>e.code==='42501');else await acquire();results.push({case:'modeled role '+role,pass:true});}
await c.query("select set_config('test.role','admin',false)");
await acquire();
for(const mode of ['snapshot','incremental']) {
 const query=mode==='snapshot'?"select public.save_scheduling_planning_snapshot('year','',$1,'isolated','isolated',$2::jsonb,$3,$4,$5) value":"select public.save_scheduling_planning_incremental_snapshot('year','',$1,'isolated','isolated',$2::jsonb,'[]'::jsonb,$3,$4,$5) value";
 const rows=mode==='snapshot'?plan.rows:[plan.rows.find(r=>r.kind==='fixed-proposal'&&r.instructorEmpId)];
 const updated=new Map((await c.query('select row_id,updated_at::text as updated_at from public.activities')).rows.map(a=>[a.row_id,a.updated_at]));
 const envelopes=values=>values.map(row=>({activityId:row.courseId,activityUpdatedAt:updated.get(row.courseId),row}));
 const result=await c.query(query,[version,JSON.stringify(envelopes(rows)),revision,run,source]);revision=result.rows[0].value.revision;
 results.push({case:'validated '+mode+' writer',pass:true});
 const forged=structuredClone(rows);forged[0].instructorEmpId='999';await assert.rejects(c.query(query,[version,JSON.stringify(envelopes(forged)),revision,run,source]));
 assert.deepEqual(await canonical(),[...plan.rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)));results.push({case:'invalid '+mode+' writer rolls back',pass:true});
}
const lockTarget=plan.rows.find(r=>r.kind==='fixed-proposal'&&r.instructorEmpId),illegalLock={...lockTarget,instructorEmpId:'999'};
await c.query('update public.scheduling_planning_rows set locked_option=$1::jsonb where activity_id=$2',[JSON.stringify(illegalLock),lockTarget.courseId]);
await acquire();const withLock=plan.rows.map(r=>r.courseId===lockTarget.courseId?illegalLock:r);await checkpoint(withLock);await assert.rejects(commit(),e=>e.message.includes('planning_server_candidate_constraint_failed'));
await c.query('update public.scheduling_planning_rows set locked_option=null where activity_id=$1',[lockTarget.courseId]);
results.push({case:'new illegal lock cannot acquire protected-source exemption',pass:true});
await assert.rejects(c.query("select public.save_scheduling_planning_snapshot('year','','planning-v36','isolated','isolated','[]'::jsonb,$1,$2,$3)",[revision,run,source]),e=>e.message.includes('planning_engine_downgrade_forbidden'));
results.push({case:'v37 canonical workspace cannot downgrade to legacy writer',pass:true});
await c.query('grant usage on schema public,auth to authenticated,anon');
await c.query('set role authenticated');
await c.query("select public.get_scheduling_planning_engine_capabilities()");
await assert.rejects(c.query("select public.scheduling_v37_workspace_validation(1)"),e=>e.code==='42501');
await c.query("select set_config('test.role','denied',false)");await assert.rejects(c.query("select public.get_scheduling_planning_engine_capabilities()"),e=>e.code==='42501');
await c.query('reset role');await c.query('set role anon');await assert.rejects(c.query("select public.get_scheduling_planning_engine_capabilities()"),e=>e.code==='42501');await c.query('reset role');
results.push({case:'actual SQL roles authenticated/denied/anon and private-validator execution grants',pass:true});
await c.query("select set_config('test.role','admin',false)");
const hash=(await c.query("select md5(string_agg(to_jsonb(a)::text,'|' order by row_id)) hash from public.activities a")).rows[0].hash;
await writeFile(out+'/sql-acceptance.json',JSON.stringify({scope:'PostgreSQL 17 local schema adapter, real RPC SQL, explicitly modeled identities; not a deployed Supabase/Auth instance',sourceActivitiesHash:hash,results},null,2));console.log(JSON.stringify({results}));await c.end();
