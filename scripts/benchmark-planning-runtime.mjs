// Manual deterministic benchmark; never part of automatic PR CI.
// BENCH_ENGINE_ROOT can select a source archive for before/after comparison.
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.env.BENCH_ENGINE_ROOT ? pathToFileURL(resolve(process.env.BENCH_ENGINE_ROOT)+'/') : new URL('../',import.meta.url);
const moduleURL=name=>new URL(`frontend/src/screens/${name}.js`,root);
const {buildDynamicCoursePlan,createPlanningCheckpoint}=await import(moduleURL('course-scheduling-planning'));
const {createRouteClient}=await import(moduleURL('course-scheduling-travel'));
const {setPlanningPerfEnabled,resetPlanningPerfReport,flushPlanningPerfReport}=await import(moduleURL('course-scheduling-perf'));
const count=Number(process.env.BENCH_ACTIVITIES || 175), instructorCount=Number(process.env.BENCH_INSTRUCTORS || 24);
const instructors=Array.from({length:instructorCount},(_,i)=>({emp_id:String(i+1),full_name:`Instructor ${i+1}`,active:'yes',address:`home${i+1}`}));
const profiles=Object.fromEntries(instructors.map(row=>[row.emp_id,{emp_id:row.emp_id,gender:'female',instruction_languages:['he'],friday_allowed:true}]));
const rules=Object.fromEntries(instructors.map(row=>[row.emp_id,Array.from({length:6},(_,weekday)=>({emp_id:row.emp_id,weekday,available:true,start_time:'08:00',end_time:'18:00'}))]));
const activities=Array.from({length:count},(_,i)=>({row_id:`bench-${i+1}`,activity_season:'school_2027',activity_type:'course',status:'פתוח',activity_name:'ביומימיקרי',school:`School ${Math.floor(i/5)+1}`,school_id:Math.floor(i/5)+1,school_address:`school${Math.floor(i/5)+1}`,authority:'רשות מדידה',district:'מרכז',calendar_sector:'general',instruction_language:'he',required_instructor_gender:'any',sessions:8,updated_at:'2026-09-29T20:00:00Z'}));
const schools=[...new Set(activities.map(row=>row.school_address))];
const addresses=[...schools,...instructors.map(row=>row.address)];
const routes=addresses.flatMap(origin=>addresses.filter(destination=>destination!==origin).map(destination=>({origin_key:origin,destination_key:destination,origin_address:origin,destination_address:destination,distance_km:5,duration_minutes:10})));
const inputs={activities,instructors,profiles,rules,exceptions:{},schoolCalendar:[],catalog:[{activity_name:'ביומימיקרי',meetings_count:8,hours_count:1.5}],today:'2026-09-29',planningProfile:'fast'};
let calls=0;
const routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>{calls++;throw Error('Warm benchmark must not use network');}});
const canonicalRows=rows=>rows.map(row=>({courseId:row.courseId,kind:row.kind,instructorEmpId:row.instructorEmpId||'',meetings:row.meetings||[]})).sort((a,b)=>a.courseId.localeCompare(b.courseId));
const signature=rows=>createHash('sha256').update(JSON.stringify(canonicalRows(rows))).digest('hex');
const reports=[];
async function measure(label,extra={}) {
  setPlanningPerfEnabled(true);resetPlanningPerfReport(label);
  const start=performance.now(),progress=[];let last=start,maxTimerDelayMs=0,ticks=0,lastStage=start,lastPhase='start';const phases={};
  const timer=setInterval(()=>{const now=performance.now();maxTimerDelayMs=Math.max(maxTimerDelayMs,now-last-100);last=now;ticks++;},100);
  const callsBefore=calls;
  try {
    const result=await buildDynamicCoursePlan({...inputs,...extra,routeClient,checkpoint:createPlanningCheckpoint(),onProgress:({phase,completed,total})=>{const now=performance.now();phases[lastPhase]=(phases[lastPhase]||0)+now-lastStage;lastStage=now;lastPhase=phase;progress.push({phase,completed,total,atMs:now-start});}});
    phases[lastPhase]=(phases[lastPhase]||0)+performance.now()-lastStage;
    const report={label,wallMs:performance.now()-start,rows:result.rows.length,kinds:result.rows.reduce((a,r)=>(a[r.kind]=(a[r.kind]||0)+1,a),{}),planSignature:signature(result.rows),maxTimerDelayMs,timerTicks:ticks,serviceCalls:calls-callsBefore,phasesMs:phases,perf:flushPlanningPerfReport({log:false})};
    reports.push(report);console.log(JSON.stringify(report));return result;
  }finally{clearInterval(timer);setPlanningPerfEnabled(false);}
}
const full=await measure('full-175');
if(process.env.BENCH_INCREMENTAL!=='0') {
  await measure('one-dirty',{existingRows:full.rows,targetCourseIds:['bench-1'],allowGlobalRepair:false});
  await measure('three-dirty',{existingRows:full.rows,targetCourseIds:['bench-1','bench-51','bench-101'].filter(id=>activities.some(a=>a.row_id===id)),allowGlobalRepair:false});
}
const output=process.env.BENCH_OUTPUT || '/tmp/planning-runtime-benchmark.json';
await writeFile(output,JSON.stringify({fixture:{activities:count,instructors:instructorCount,schools:schools.length,sessions:8,warmRoutePairs:routes.length},scope:'engine-only; warm synthetic routes; no DB or network',reports},null,2));
console.log(`Saved ${output}`);
