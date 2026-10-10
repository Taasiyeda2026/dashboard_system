// Manual, anonymous offline comparison. Does not connect to production.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decisionInput} from './new-engine-input.mjs';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
const out=process.env.ACCEPTANCE_OUT;if(!out)throw Error('ACCEPTANCE_OUT required');await mkdir(out,{recursive:true});
const {input,routes}=await decisionInput(process.env.DECISION_DIR);
const mod=await import(process.env.ENGINE_MODULE?pathToFileURL(process.env.ENGINE_MODULE):'../../frontend/src/screens/course-scheduling-planning.js');
let routeMisses=0;input.routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>{routeMisses++;return {data:{calculated:false},error:null}}});
input.allowGlobalRepair=true;input.skipSoftOptimization=process.env.BASELINE_ONLY==='1';
const before=JSON.stringify({...input,routeClient:null}),cpu=process.cpuUsage(),at=performance.now();let phase='';input.onProgress=async p=>{if(p.phase!==phase){phase=p.phase;console.log(JSON.stringify({phase,elapsedMs:performance.now()-at}));}};
const plan=await mod.buildDynamicCoursePlan(input);const elapsedMs=performance.now()-at,used=process.cpuUsage(cpu);
const {onProgress,...after}=input;if(JSON.stringify({...after,routeClient:null})!==before)throw Error('Source changed');
await writeFile(out+'/national-plan.json',JSON.stringify(plan));const result={version:mod.PLANNING_ENGINE_VERSION,elapsedMs,cpuMs:(used.user+used.system)/1000,maxRSSKiB:process.resourceUsage().maxRSS,heapUsedBytes:process.memoryUsage().heapUsed,rows:plan.rows.length,assigned:plan.rows.filter(r=>r.instructorEmpId).length,routeMisses,databaseRequests:0,metrics:plan.newEngineMetrics,optimization:plan.optimization,quality:plan.quality,sourceUnchanged:true};await writeFile(out+'/national-metrics.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
