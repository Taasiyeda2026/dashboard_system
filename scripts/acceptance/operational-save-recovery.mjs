// Actual local SQL functions; identity deliberately modeled, not real Supabase Auth.
import pg from 'pg';import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
let c=new pg.Client({connectionString:'postgresql://postgres:isolated-test-only@127.0.0.1:55439/codex_engine_decision'});await c.connect();
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
// Simulate connection loss after a validated durable checkpoint, then recover it.
await acquire();await checkpoint(plan.rows);await c.end();
c=new pg.Client({connectionString:'postgresql://postgres:isolated-test-only@127.0.0.1:55439/codex_engine_decision'});await c.connect();await c.query("select set_config('test.uid','11111111-1111-4111-8111-111111111111',false),set_config('test.role','admin',false)");
const recovered=await commit();assert.deepEqual(await canonical(),[...plan.rows].sort((a,b)=>a.courseId.localeCompare(b.courseId)));
const evidence={scope:'existing disposable localhost PostgreSQL; actual checkpoint/commit RPCs, modeled admin identity; no planner invocation',pass:true,rows:plan.rows.length,saveMs,revision:recovered.rows[0].value.revision,reconnectedCheckpointRecovery:true};
await writeFile(out+'/single-save-recovery.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await c.end();
