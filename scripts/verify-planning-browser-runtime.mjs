// Manual browser check; not wired into automatic PR CI. Requires a local Vite server.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const base=process.env.PLANNING_BROWSER_URL || 'http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true});
try {
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route(`${base}/planning-runtime-check`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="he" dir="rtl"><body>Planning runtime check</body></html>'}));
  await page.goto(`${base}/planning-runtime-check`);
  const result=await page.evaluate(async()=>{
    const engine=await import('/frontend/src/screens/course-scheduling-engine.js');
    const {buildDynamicCoursePlan,createPlanningCheckpoint}=await import('/frontend/src/screens/course-scheduling-planning.js');
    const {createRouteClient}=await import('/frontend/src/screens/course-scheduling-travel.js');
    const instructors=Array.from({length:24},(_,i)=>({emp_id:String(i+1),full_name:`Instructor ${i+1}`,active:'yes',address:`home${i+1}`}));
    const profiles=Object.fromEntries(instructors.map(i=>[i.emp_id,{gender:'female',instruction_languages:['he'],friday_allowed:true}]));
    const rules=Object.fromEntries(instructors.map(i=>[i.emp_id,Array.from({length:6},(_,weekday)=>({weekday,available:true,start_time:'08:00',end_time:'18:00'}))]));
    const activities=Array.from({length:5},(_,i)=>({row_id:`browser-${i}`,activity_type:'course',activity_season:'school_2027',status:'פתוח',activity_name:'ביומימיקרי',sessions:8,school_id:1,school:'School',school_address:'school1',authority:'Authority',calendar_sector:'general',instruction_language:'he',required_instructor_gender:'any'}));
    const addresses=['school1',...instructors.map(i=>i.address)];let invokes=0;
    const routes=addresses.flatMap(origin=>addresses.filter(d=>d!==origin).map(destination=>({origin_key:origin,destination_key:destination,origin_address:origin,destination_address:destination,distance_km:5,duration_minutes:10})));
    const routeClient=createRouteClient({preloadedRows:routes,invoke:async()=>{invokes++;throw Error('unexpected network');}});
    let ticks=0,previous=performance.now(),maxTimerDelayMs=0;const interval=setInterval(()=>{const now=performance.now();ticks++;maxTimerDelayMs=Math.max(maxTimerDelayMs,now-previous-10);previous=now;},10);
    const start=performance.now();
    const plan=await buildDynamicCoursePlan({activities,instructors,profiles,rules,exceptions:{},schoolCalendar:[],catalog:[{activity_name:'ביומימיקרי',meetings_count:8,hours_count:1.5}],today:'2026-09-29',planningProfile:'fast',allowGlobalRepair:false,routeClient,checkpoint:createPlanningCheckpoint()});
    const wallMs=performance.now()-start;clearInterval(interval);
    const controller=new AbortController();let cancellationTicks=0;
    const history=Array.from({length:2500},(_,i)=>({...activities[0],row_id:`history-${i}`,emp_id:'1',instructor_assignment_status:'assigned',date_1:'2026-10-11',start_time:'10:00',end_time:'11:30'}));
    const pulse=setInterval(()=>cancellationTicks++,2);const abort=setTimeout(()=>controller.abort(),15);const cancelStart=performance.now();let cancelled=false;
    try{await engine.prepareSchedulingRunContextCooperatively({activities:history,instructors,profiles,rules,exceptions:{},schoolCalendar:[],periodKey:'year'},createPlanningCheckpoint({budgetMs:2,signal:controller.signal}));}catch(e){cancelled=e.code==='planning_cancelled';}finally{clearInterval(pulse);clearTimeout(abort);}
    return {browser:navigator.userAgent,schedulerYield:typeof globalThis.scheduler?.yield==='function',fixtureActivities:5,wallMs,proposals:plan.rows.filter(r=>r.kind==='proposal').length,routeInvokes:invokes,timerTicks:ticks,maxTimerDelayMs,cancelled,cancellationTicks,cancelMs:performance.now()-cancelStart};
  });
  console.log(JSON.stringify(result,null,2));
  assert.equal(result.proposals,5);assert.equal(result.routeInvokes,0);assert.ok(result.timerTicks>0);assert.equal(result.cancelled,true);assert.ok(result.cancellationTicks>0);assert.ok(result.cancelMs<250);assert.deepEqual(errors,[]);
} finally {await browser.close();}
