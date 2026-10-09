// Manual, isolated acceptance benchmark. Never writes planning/source data.
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import os from 'node:os';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
globalThis.fetch = async () => { throw Error('Benchmark network disabled'); };
const dbUrl = process.env.BENCH_DATABASE_URL;
if (!dbUrl || !['127.0.0.1','localhost','[::1]'].includes(new URL(dbUrl).hostname)) throw Error('Explicit loopback-only BENCH_DATABASE_URL required');
const root = pathToFileURL(resolve(process.env.ENGINE_ROOT || '.', 'frontend/src/screens') + '/').href;
const { buildDynamicCoursePlan, createPlanningCheckpoint, planningPlanQuality } = await import(root+'course-scheduling-planning.js');
const { createRouteClient } = await import(root+'course-scheduling-travel.js');
const { setPlanningPerfEnabled, resetPlanningPerfReport, flushPlanningPerfReport } = await import(root+'course-scheduling-perf.js');
const db=new pg.Client({connectionString:dbUrl});await db.connect();
const loadStart=performance.now();
const snapshot=(await db.query("SELECT payload,md5(payload::text) hash FROM isolated_fixture WHERE id='synthetic-253'")).rows[0];
const fixtureReadMs=performance.now()-loadStart;await db.end();
if (!snapshot) throw Error('Isolated synthetic fixture missing');
const existing=snapshot.payload.existing;
const route=()=>createRouteClient({preloadedRows:snapshot.payload.routes,invoke:async()=>{throw Error('No route network permitted');}});
const out={sourceTree:process.env.ENGINE_ROOT||'.',environment:{node:process.version,platform:os.platform(),cpus:os.cpus().length,cpu:os.cpus()[0].model,totalMemoryBytes:os.totalmem(),load:os.loadavg()},fixture:{activities:253,instructors:49,sessions:8,synthetic:true,warmRoutes:snapshot.payload.routes.length,dbHash:snapshot.hash,fixtureReadMs,fixtureReadRequests:1,computationDbRequests:0},samples:[]};
async function measured(label,fn,{iterations=1,dbRequests=0,detail={}}={}) {
 global.gc?.(); setPlanningPerfEnabled(true);resetPlanningPerfReport(label);
 const memoryBefore=process.memoryUsage();let peakRss=memoryBefore.rss;
 const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},10);
 const delay=monitorEventLoopDelay({resolution:10});delay.enable();
 let maxHeartbeatLag=0,last=performance.now(),ticks=0;
 const hb=setInterval(()=>{const now=performance.now();maxHeartbeatLag=Math.max(maxHeartbeatLag,now-last-10);last=now;ticks++;},10);
 const cpu=process.cpuUsage();const start=performance.now();let value,error;
 try {for(let i=0;i<iterations;i++)value=await fn();}catch(e){error={stack:String(e.stack),code:e.code,failures:e.failures,repairCourseIds:e.repairCourseIds};}
 const wallMs=performance.now()-start,used=process.cpuUsage(cpu),memoryAfter=process.memoryUsage();
 clearInterval(sample);clearInterval(hb);delay.disable();peakRss=Math.max(peakRss,memoryAfter.rss);
 const row={label,iterations,wallMs,perIterationMs:wallMs/iterations,cpuMs:(used.user+used.system)/1000,cpuWallRatio:(used.user+used.system)/1000/wallMs,dbRequests,memoryBefore,memoryAfter,peakRssSampled:peakRss,heapDeltaBytes:memoryAfter.heapUsed-memoryBefore.heapUsed,eventLoopMaxMs:delay.max/1e6,maxHeartbeatLagMs:maxHeartbeatLag,heartbeatTicks:ticks,perf:flushPlanningPerfReport({log:false}),detail,error};
 out.samples.push(row);setPlanningPerfEnabled(false);console.log(JSON.stringify({label,wallMs,cpuMs:row.cpuMs,counters:row.perf.counters,error}));
 
 return value;
}
const mode=process.env.BENCH_CASE||'point';
const count=Number(process.env.BENCH_ITERATIONS||7);
for(let sample=0;sample<count;sample++){
 const dbActivities=snapshot.payload.activities;
 const selected=mode==='cohorts25'?dbActivities.slice(0,25).map((a,i)=>({...a,school_id:Math.floor(i/5)+1,school:'Synthetic school '+Math.floor(i/5)})):mode==='school5'?dbActivities.slice(0,5).map(a=>({...a,school_id:1,school:'Synthetic school 0'})):dbActivities;
 const targeted=mode==='point'?['synthetic-110']:selected.map(a=>a.row_id);
 const saved=mode==='point'?existing:[];
 const result=await measured(mode,()=>buildDynamicCoursePlan({activities:selected,instructors:snapshot.payload.instructors,profiles:snapshot.payload.profiles,rules:snapshot.payload.rules,exceptions:{},schoolCalendar:[],catalog:[{activity_name:'ביומימיקרי',meetings_count:8,hours_count:1.5}],today:'2026-10-09',routeClient:route(),targetCourseIds:targeted,existingRows:saved,committedRows:saved,allowGlobalRepair:false,planningProfile:'fast',skipSoftOptimization:process.env.BASE_ONLY==='1',checkpoint:createPlanningCheckpoint()}),{detail:{targetActivities:targeted.length,activitiesContext:selected.length,instructors:49,sessions:8}});
 if(result){const last=out.samples.at(-1);last.detail.quality=planningPlanQuality(result.rows);last.detail.validation=result.finalPlanValidation;last.detail.optimization=result.optimization;last.detail.hours=result.rows.reduce((n,row)=>n+(row.instructorEmpId?(row.meetings||[]).reduce((m,x)=>{const minute=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));return m+(minute(x.end_time)-minute(x.start_time))/60},0):0),0);await writeFile('./'+(process.env.RESULT_FILE||'bench-results.json'),JSON.stringify(out,null,2));}
}
await writeFile('./'+(process.env.RESULT_FILE||'bench-results.json'),JSON.stringify(out,null,2));
