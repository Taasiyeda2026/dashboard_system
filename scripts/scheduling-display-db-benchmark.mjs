// Fresh localhost PostgreSQL only. Synthetic fixtures; no production credentials.
import pg from '../node_modules/pg/lib/index.js';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const fixtureDir = process.env.SCHEDULING_AUDIT_FIXTURE_DIR;
if (!fixtureDir) throw new Error('Set SCHEDULING_AUDIT_FIXTURE_DIR to audit evidence directory');
const outputDir = resolve(process.env.SCHEDULING_BENCH_OUTPUT_DIR || 'work/scheduling-display-benchmark');
await mkdir(outputDir,{recursive:true});
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
const c=new pg.Client({connectionString:'postgresql://postgres@127.0.0.1:55440/postgres'});await c.connect();
const schema=JSON.parse(await readFile(join(fixtureDir,'db-schema.json')));const metadata=JSON.parse(await readFile(join(fixtureDir,'db-metadata.json')));
await c.query("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE FUNCTION public.app_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.permission',true)='true' $$;");
for(const name of ['users','scheduling_planning_workspaces','scheduling_planning_rows'])await c.query(schema.tables.find(t=>t.name===name).ddl);
for(const name of ['get_scheduling_planning_workspace','scheduling_planning_row_instructor_ids'])await c.query(metadata.functions.find(f=>f.name===name).definition);
await c.query(await readFile('./supabase/migrations/20261009180000_scheduling_display_reads.sql','utf8'));
const rows=JSON.parse(await readFile(join(fixtureDir,'base-rows-253.json')));const id='00000000-0000-4000-8000-000000000003';
await c.query("INSERT INTO public.scheduling_planning_workspaces(id,period_key,district,revision,engine_version)VALUES($1,'year','',11946,'planning-v35')",[id]);
for(const row of rows)await c.query('INSERT INTO public.scheduling_planning_rows(workspace_id,activity_id,row_data)VALUES($1,$2,$3)',[id,row.courseId,row]);
await c.query("SET test.permission='true'");const before=(await c.query('SELECT md5(string_agg(row_data::text,\'\' ORDER BY activity_id)) checksum FROM scheduling_planning_rows')).rows[0].checksum;
let passed=0;await c.query('SET ROLE anon');await assert.rejects(c.query("SELECT public.get_scheduling_planning_display_workspace('year','')"),e=>e.code==='42501');passed++;
await c.query('SET ROLE authenticated');await c.query("SET test.permission='false'");for(const sql of ["SELECT public.get_scheduling_planning_display_workspace('year','')",`SELECT public.get_scheduling_planning_row_details('${id}','${rows[0].courseId}',11946)`]){await assert.rejects(c.query(sql),e=>e.code==='42501');passed++;}
await c.query("SET test.permission='true'");await assert.rejects(c.query(`SELECT public.get_scheduling_planning_row_details('${id}','${rows[0].courseId}',11945)`),e=>e.code==='40001');passed++;
const detail=(await c.query('SELECT public.get_scheduling_planning_row_details($1,$2,11946) value',[id,rows[0].courseId])).rows[0].value;assert.deepEqual(detail,rows[0]);passed++;
const samples=[];
for(let i=0;i<7;i++)for(const variant of ['full','display']){const start=performance.now();const res=await c.query(`SELECT public.get_scheduling_planning_${variant==='full'?'workspace':'display_workspace'}('year','') value`);const value=res.rows[0].value;const elapsed=performance.now()-start;assert.equal(value.rows.length,253);samples.push({variant,ms:elapsed,requests:1,bytes:Buffer.byteLength(JSON.stringify(value))});if(variant==='display'&&i===0)await writeFile(join(outputDir,'display-fixture.json'),JSON.stringify(value));}
await c.query('RESET ROLE');const after=(await c.query('SELECT md5(string_agg(row_data::text,\'\' ORDER BY activity_id)) checksum FROM scheduling_planning_rows')).rows[0].checksum;assert.equal(before,after);passed++;
const full=(await c.query("SELECT public.get_scheduling_planning_workspace('year','') value")).rows[0].value;await writeFile(join(outputDir,'full-fixture.json'),JSON.stringify(full));
await writeFile(join(outputDir,'db-results.json'),JSON.stringify({passed,rows:253,productionWrites:0,checksum:before,samples,environment:(await c.query('SELECT version()')).rows[0].version,limitations:'Isolated PostgreSQL; permission result stub controlled by test; real RLS/auth JWT not exercised; no server CPU/peak memory samples.'},null,2));console.log(JSON.stringify({passed,samples}));await c.end();
