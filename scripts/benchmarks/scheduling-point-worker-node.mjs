// Synthetic-only process CPU/RSS comparison. No DB connection or credentials.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {gunzipSync} from 'node:zlib';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {SchedulingPointWorker} from '../../frontend/src/screens/course-scheduling-worker-client.js';
import {buildDynamicCoursePlan} from '../../frontend/src/screens/course-scheduling-planning.js';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
import assert from 'node:assert/strict';
const bytes=process.env.WORKER_FIXTURE ? await readFile(process.env.WORKER_FIXTURE) : gunzipSync(Buffer.from(await readFile(new URL('../../docs/scheduling-point-engine-20261009/synthetic-fixture.json.gz.b64',import.meta.url),'utf8'),'base64')),f=JSON.parse(bytes);
const input={activities:f.activities,instructors:f.instructors,profiles:f.profiles,rules:f.rules,exceptions:{},schoolCalendar:[],catalog:[{activity_name:'ביומימיקרי',meetings_count:8,hours_count:1.5}],today:'2026-10-09',targetCourseIds:['synthetic-110'],existingRows:f.existing,committedRows:f.existing,lockedOptions:{},allowGlobalRepair:false,planningProfile:'fast',skipSoftOptimization:true};
const endpoint=new URL('../../frontend/src/screens/course-scheduling-point.worker.js',import.meta.url).href;
const createWorker=()=>{const entry=`import {parentPort} from 'node:worker_threads';globalThis.self={postMessage:m=>{if(m.type==='result')m.metrics.threadMemory=process.memoryUsage();parentPort.postMessage(m);}};await import(${JSON.stringify(endpoint)});parentPort.on('message',data=>self.onmessage({data}));`;const thread=new Worker(new URL('data:text/javascript,'+encodeURIComponent(entry)),{type:'module'}),adapter={postMessage:m=>thread.postMessage(m),terminate:()=>thread.terminate()};thread.on('message',data=>adapter.onmessage?.({data}));thread.on('error',e=>adapter.onerror?.(e));return adapter;};
const client=new SchedulingPointWorker({createWorker}),samples=[];let expected=null;
try{for(const variant of ['before','after'])for(let i=0;i<21;i++){
 globalThis.gc?.();const memoryBefore=process.memoryUsage(),cpu=process.cpuUsage();let peakRss=memoryBefore.rss;
 const timer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss)},10),delay=monitorEventLoopDelay({resolution:10});delay.enable();const start=performance.now();
 const result=variant==='before'?await buildDynamicCoursePlan({...input,routeClient:createRouteClient({preloadedRows:f.routes,invoke:async()=>{throw Error('No network')}})}):await client.run(input,{owner:'synthetic-admin',version:'12',routeRows:f.routes,perf:true});
 const wallMs=performance.now()-start,usage=process.cpuUsage(cpu),memoryAfter=process.memoryUsage();clearInterval(timer);delay.disable();assert.equal(result.finalPlanValidation.valid,true);
 const hours=result.rows.reduce((n,row)=>n+(row.instructorEmpId?(row.meetings||[]).reduce((h,m)=>{const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3,5));return h+(mins(m.end_time)-mins(m.start_time))/60},0):0),0),quality={covered:result.rows.filter(r=>r.instructorEmpId).length,hours,failures:result.finalPlanValidation.failures,warnings:result.finalPlanValidation.warnings};
 const digest=createHash('sha256').update(JSON.stringify(result.rows,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');if(expected===null)expected=digest;else assert.equal(digest,expected);
 samples.push({variant,warm:i>0,wallMs,cpuMs:(usage.user+usage.system)/1000,eventLoopMaxMs:delay.max/1e6,memoryBefore,memoryAfter,peakRssSampled:Math.max(peakRss,memoryAfter.rss),workerMemory:variant==='after'?client.lastRunMetrics.threadMemory:null,quality,rowsSha256:digest,dbRequests:0});
 console.log(JSON.stringify({variant,warm:i>0,wallMs,cpuMs:samples.at(-1).cpuMs,peakRss:samples.at(-1).peakRssSampled}));
}}finally{client.dispose();await writeFile(process.env.WORKER_RESULT||'worker-node-results.json',JSON.stringify({node:process.version,fixtureSha256:createHash('sha256').update(bytes).digest('hex'),samples,scope:'Node process CPU includes worker threads; RSS sampled every 10ms, not proven allocator peak; native worker-thread adapter exercises actual browser endpoint. Browser UX measured separately.'},null,2));}
