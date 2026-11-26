// Synthetic benchmark. No Supabase, Google calls or operational data.
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const root = resolve(process.env.ENGINE_ROOT || '.');
const fromEngine = name => import(pathToFileURL(resolve(root, 'frontend/src/screens', name)).href);
const {buildDynamicCoursePlan, createPlanningCheckpoint} = await fromEngine('course-scheduling-planning.js');
const {createRouteClient} = await fromEngine('course-scheduling-travel.js');
const {setPlanningPerfEnabled, resetPlanningPerfReport, flushPlanningPerfReport} = await fromEngine('course-scheduling-perf.js');

const instructors = Array.from({length:24}, (_, index) => ({
  emp_id:String(index+1), full_name:`Instructor ${index+1}`, active:'yes', address:`home${index+1}`
}));
const profiles = Object.fromEntries(instructors.map(({emp_id}) => [emp_id, {
  emp_id, gender:'female', instruction_languages:['he'], friday_allowed:true
}]));
const rules = Object.fromEntries(instructors.map(({emp_id}) => [emp_id,
  Array.from({length:6}, (_, weekday) => ({emp_id,weekday,available:true,start_time:'08:00',end_time:'18:00'}))
]));
const activities = Array.from({length:175}, (_, index) => {
  const school = Math.floor(index/5)+1;
  return {
    row_id:`bench-${index+1}`, activity_season:'school_2027', activity_type:'course', status:'פתוח',
    activity_name:'ביומימיקרי', school:`School ${school}`, school_id:school, school_address:`school${school}`,
    authority:'רשות מדידה', district:'מרכז', calendar_sector:'general', instruction_language:'he',
    required_instructor_gender:'any', sessions:8, updated_at:'2026-09-29T20:00:00Z'
  };
});
const schools = [...new Set(activities.map(row=>row.school_address))];
const addresses = [...schools,...instructors.map(row=>row.address)];
const routes = addresses.flatMap(origin => addresses.filter(destination => destination!==origin).map(destination => ({
  origin_key:origin, destination_key:destination, distance_km:5, duration_minutes:10
})));
const mode = process.argv[2] || 'full';
if (!['full','point'].includes(mode)) throw Error('Use full or point');
const routeClient = createRouteClient({
  preloadedRows:routes,
  invoke:async()=>{ throw Error('Warm-cache fixture must not call a route provider'); }
});
setPlanningPerfEnabled(true);
resetPlanningPerfReport(mode);
const profile = process.env.BENCH_PROFILE || 'fast';
const start = performance.now();
let lastTick = start, heartbeatTicks = 0, maximumTimerLagMs = 0;
const timer = setInterval(() => {
  const now = performance.now();
  maximumTimerLagMs=Math.max(maximumTimerLagMs,now-lastTick-100);
  lastTick=now;
  heartbeatTicks++;
},100);
const milestoneMs = {};
try {
  const result = await buildDynamicCoursePlan({
    activities,instructors,profiles,rules,exceptions:{},schoolCalendar:[],
    catalog:[{activity_name:'ביומימיקרי',meetings_count:8,hours_count:1.5}],
    today:'2026-09-29',routeClient,planningProfile:profile,checkpoint:createPlanningCheckpoint(),
    ...(mode==='point' ? {targetCourseIds:['bench-51'],allowGlobalRepair:false} : {}),
    onProgress:({row,completed})=>{
      if (row && [25,50,100,175].includes(completed)) milestoneMs[completed]=Math.round(performance.now()-start);
    }
  });
  if (!result.finalPlanValidation.valid || routeClient.batchInvokes !== 0) throw Error('Benchmark invariant failed');
  const q = result.quality;
  console.log(JSON.stringify({
    mode,profile,wallMs:performance.now()-start,maximumTimerLagMs,heartbeatTicks,milestoneMs,
    rows:result.rows.length,covered:q.covered,meetingHours:q.meetingHours,valid:result.finalPlanValidation.valid,
    contextRows:activities.length,instructors:instructors.length,warmRoutes:routes.length,
    dbRequests:0,providerCalls:routeClient.batchInvokes,
    metrics:result.newEngineMetrics,counters:flushPlanningPerfReport({log:false}).counters
  },null,2));
} finally {
  clearInterval(timer);
  setPlanningPerfEnabled(false);
}
