// Manual isolated benchmark. Not wired to automatic PR CI.
import {chromium} from '../node_modules/playwright-core/index.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const fixtureDir = process.env.SCHEDULING_BENCH_FIXTURE_DIR;
if (!fixtureDir) throw new Error('Set SCHEDULING_BENCH_FIXTURE_DIR to isolated full-fixture.json/display-fixture.json directory');
const outputDir = resolve(process.env.SCHEDULING_BENCH_OUTPUT_DIR || 'work/scheduling-display-benchmark');
await mkdir(outputDir,{recursive:true});
const full=JSON.parse(await readFile(join(fixtureDir,'full-fixture.json'))),display=JSON.parse(await readFile(join(fixtureDir,'display-fixture.json')));
// Manual harness only; never load dashboard production services.
await writeFile('.pr1-full.json',JSON.stringify(full));await writeFile('.pr1-display.json',JSON.stringify(display));
const base = execFileSync('git',['show','35b12ec232023458cb37b581afc861fd19e66801:frontend/src/screens/course-scheduling.js'],{encoding:'utf8'}).replace('function courseListHtml(', 'export function courseListHtml(');
await writeFile('frontend/src/screens/.pr1-baseline-course.js',base);
await writeFile('frontend/src/screens/.pr1-baseline-cache.js',execFileSync('git',['show','35b12ec232023458cb37b581afc861fd19e66801:frontend/src/screens/course-scheduling-session-cache.js']));
await writeFile('.pr1-benchmark.html',`<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><main id="screen"></main><script type="module">
import * as after from '/frontend/src/screens/course-scheduling.js';
import * as before from '/frontend/src/screens/.pr1-baseline-course.js';
import * as cacheAfter from '/frontend/src/screens/course-scheduling-session-cache.js';
import * as cacheBefore from '/frontend/src/screens/.pr1-baseline-cache.js';
import {supabase} from '/frontend/src/supabase-client.js';window.pr1={after,before,cacheAfter,cacheBefore,supabase};</script></html>`);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const results=[];
for(const device of [{name:'desktop',viewport:{width:1440,height:900},rate:1},{name:'mobile-throttled',viewport:{width:390,height:844},rate:4}])for(const variant of ['before','after']){
 const context=await browser.newContext({viewport:device.viewport,isMobile:device.rate>1,hasTouch:device.rate>1});const page=await context.newPage();let network=0,blocked=0,mutations=[];const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.hostname==='127.0.0.1')return route.continue();
 if(url.pathname.startsWith('/rest/v1/')){network++;let data=[];
 if(url.pathname.endsWith('/rpc/get_scheduling_planning_workspace'))data=full;
 else if(url.pathname.endsWith('/rpc/get_scheduling_planning_display_workspace'))data=display;
 else if(url.pathname.endsWith('/rpc/get_scheduling_planning_row_details')){const args=req.postDataJSON();data=full.rows.find(r=>r.activityId===args.p_activity_id)?.row||null;}
 else if(url.pathname.includes('/rpc/')&&!url.pathname.endsWith('/rpc/scheduling_authority_school_locations'))mutations.push(url.pathname);
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data),headers:{'access-control-allow-origin':'*'}});}
 blocked++;await route.abort();});
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:device.rate});await page.goto('http://127.0.0.1:5180/.pr1-benchmark.html');await page.waitForFunction(()=>window.pr1);
 const measurement=await page.evaluate(async({variant,full,display})=>{
  const lib=window.pr1[variant],cache=window.pr1[variant==='before'?'cacheBefore':'cacheAfter'];const identity={userId:'synthetic',sessionId:'session'};
  const activities=full.rows.map((entry,i)=>({row_id:entry.activityId,activity_season:'school_2027',activity_type:'קורס',status:'פתוח',school:`בית ספר ${i}`,school_id:String(i),authority:'רשות',activity_name:`פעילות ${i}`,sessions:8,start_date:entry.row.startDate,start_time:entry.row.startTime,end_time:entry.row.endTime,date_1:entry.row.startDate,updated_at:'2026-10-09'}));
  const instructors=Array.from({length:49},(_,i)=>({emp_id:String(i+1),full_name:`מדריך ${i+1}`,active:'yes'}));
  window.pr1.supabase.auth.getSession=async()=>({data:{session:{user:{id:identity.userId},access_token:`x.${btoa(JSON.stringify({session_id:identity.sessionId}))}.x`}},error:null});
  let apiRequests=0;const api={activities:async()=>{apiRequests++;return {rows:activities}},instructorContacts:async()=>{apiRequests++;return {rows:instructors}}};
  const root=document.querySelector('#screen');sessionStorage.clear();const start=performance.now();const loaded=await lib.courseSchedulingScreen.load({api,forceRefresh:true});const coldLoadMs=performance.now()-start;
  const shared=variant==='before'?full:display;const data={...loaded,_planningShared:shared,_planningSharedLoadedKey:'year|'};
  const state={user:{role:'admin'},route:'course-scheduling',routes:['instructors','course-scheduling'],courseSchedulingPlanningSharedLoaded:true,courseSchedulingPlanningRows:shared.rows.map(e=>e.row),courseSchedulingPlanningShared:shared,courseSchedulingPlanningSharedRevision:11946};
  const samples=[],longtasks=[];const observer=new PerformanceObserver(l=>longtasks.push(...l.getEntries().map(e=>e.duration)));observer.observe({type:'longtask',buffered:true});
  function render(){root.innerHTML=lib.courseSchedulingScreen.render(data,{state});lib.courseSchedulingScreen.bind({root,data,state,api,rerender:render,clearScreenDataCache:()=>{}});}
  for(let i=0;i<7;i++){const a=performance.now();const html=lib.courseSchedulingScreen.render(data,{state});const htmlMs=performance.now()-a;const b=performance.now();root.innerHTML=html;const height=root.offsetHeight;lib.courseSchedulingScreen.bind({root,data,state,api,rerender:render,clearScreenDataCache:()=>{}});const domBindMs=performance.now()-b;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));samples.push({htmlMs,domBindMs,cards:root.querySelectorAll('[data-course-card]').length,nodes:root.querySelectorAll('*').length,height});}
  const w=performance.now();await (cache.writeSchedulingSessionCacheAsync || cache.writeSchedulingSessionCache)(identity,data);const writeMs=performance.now()-w;const r=performance.now();const restored=cache.readSchedulingSessionCache(identity);const readMs=performance.now()-r;
  const warm=performance.now();await lib.courseSchedulingScreen.load({api});const warmLoadMs=performance.now()-warm;
  const interactions=[];
  const search=root.querySelector('[data-course-list-search]');const a=performance.now();search.value='פעילות 252';search.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));interactions.push({name:'search-last',ms:performance.now()-a,matched:[...root.querySelectorAll('[data-course-card]')].filter(e=>!e.hidden).length});
  root.querySelector('[data-clear-course-list-search]').click();await new Promise(r=>requestAnimationFrame(r));
  if(variant==='after'){
    const all=new Set();for(let i=0;i<11;i++){root.querySelectorAll('[data-course-card]').forEach(e=>all.add(e.dataset.courseCard));root.querySelector('[data-course-list-page]:last-child')?.click();}interactions.push({name:'all-pages',unique:all.size});
    state.courseSchedulingListPage=0;render();
  }
  // Preserve filters/selection and explicit scroll during data rerender; existing restoration helper reused.
  state.courseSchedulingSelectedId='';state.courseSchedulingBusinessStatus='open';state.courseSchedulingListPage=0;render();
  const courseStart=performance.now();root.querySelector(`[data-course-card="${activities[0].row_id}"]`).click();
  const deadline=performance.now()+8000;
  while(state.courseSchedulingPlanningRows[0]._detailsDeferred && performance.now()<deadline) await new Promise(r=>setTimeout(r,10));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  interactions.push({name:'open-course-and-hydrate',ms:performance.now()-courseStart,loaded:!state.courseSchedulingPlanningRows[0]._detailsDeferred});
  const opened=performance.now();root.querySelector(`[data-workboard-alternatives][data-course-id="${activities[0].row_id}"]`).click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));interactions.push({name:'open-loaded-alternatives',ms:performance.now()-opened,loaded:!state.courseSchedulingPlanningRows[0]._detailsDeferred});
  state.courseSchedulingPlanningLoading=true;render();const busy=performance.now();const input=root.querySelector('[data-course-list-search]');input.value='פעילות 252';input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));interactions.push({name:'search-with-running-flag',ms:performance.now()-busy,selected:state.courseSchedulingSelectedId,filter:state.courseSchedulingBusinessStatus});
  const cacheConcurrency=[];
  for(let i=0;i<7;i++){
    const start=performance.now();let delay=null;
    const response=new Promise(resolve=>setTimeout(()=>{delay=performance.now()-start;resolve();},0));
    await (cache.writeSchedulingSessionCacheAsync || cache.writeSchedulingSessionCache)(identity,data);
    await response;cacheConcurrency.push({queuedCallbackDelayMs:delay,totalWriteMs:performance.now()-start});
  }
  observer.disconnect();return {coldLoadMs,warmLoadMs,apiRequests,samples,cacheConcurrency,cache:{writeMs,readMs,restored:!!restored,hasPlanning:!!restored?._planningShared,bytes:[...Array(sessionStorage.length)].reduce((n,_,i)=>n+new TextEncoder().encode(sessionStorage.getItem(sessionStorage.key(i))).length,0)},interactions,longtasks,heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null};
 },{variant,full,display});
 assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);assert.equal(measurement.interactions[0].matched,1);assert.equal(measurement.interactions.find(x=>x.name==='open-course-and-hydrate').loaded,true);if(variant==='after'){assert.ok(measurement.samples.every(s=>s.cards<=25));assert.equal(measurement.interactions.find(x=>x.name==='all-pages').unique,253);assert.ok(measurement.cache.restored&&measurement.cache.hasPlanning);}
 results.push({device:device.name,cpuThrottle:device.rate,variant,...measurement,networkRequests:network,blocked,mutations,errors});await context.close();
}
await writeFile(join(outputDir,'browser-results.json'),JSON.stringify({results,scope:'Actual courseSchedulingScreen render/bind and load with local synthetic API/Supabase responses; CPU throttle emulation, not physical mobile; timings include local RPC waits; open-course and alternatives use loaded state plus two frames (no fixed sleep); running-flag check does not prove responsiveness during real engine computation.'},null,2));console.log(JSON.stringify(results.map(r=>({device:r.device,variant:r.variant,cache:r.cache,cards:r.samples[0].cards,errors:r.errors,network:r.networkRequests,mutations:r.mutations}))));await browser.close();
