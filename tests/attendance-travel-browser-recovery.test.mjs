import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {build} from 'esbuild';

const entry=fileURLToPath(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url));
const mocks=new Map([
 ['../services/attendance.service.js', "export const getMonthApproval=async()=>null;export const invalidateAttendanceCache=()=>{};"],
 ['../api/client.js',"export const supabase={};"],
 ['../services/month-gate.service.js',"export const canEditMonth=()=>true;export const formatMonthLabel=(y,m)=>y+'-'+String(m).padStart(2,'0');"],
 ['../services/historical-display.service.js',[
  "export const listInstructorDisplayMonths=async()=>['2026-11'];",
  "export const readHistoricalAttendance=async()=>({rows:[],approval:null});",
  "export const historicalTravelDays=()=>[];",
  "export const historicalTravelReports=()=>[];",
  "export const isHistoricTravelMonth=m=>m<'2026-11';",
  "export const monthStatusLabel=()=>'';"
 ].join('\n')],
 ['../components/reported-daily-travel.js',"export const createReportedTravelTable=()=>document.createElement('div');"],
 ['../services/daily-travel.service.js',[
  "export const getDailyTravelActivityLegs=async(_id,date,{signal}={})=>window.__travelMock.preview(date,signal);",
  "export const getDailyTravelReport=async(_id,date,{signal}={})=>window.__travelMock.report(date,signal);",
  "export const getDailyTravelReports=async()=>window.__travelMock.reports.slice();",
  "export const getAssignedTravelDays=async()=>window.__travelMock.days.slice();",
  "export const saveDailyTravel=async(date,legs,noTravel,{signal}={})=>window.__travelMock.save(date,legs,noTravel,signal);"
 ].join('\n')]
]);
const bundle=await build({
 entryPoints:[entry],bundle:true,write:false,format:'iife',platform:'browser',
 globalName:'TravelComponent',
 plugins:[{
  name:'mock-travel-external-services',
  setup(b){
   b.onResolve({filter:/^\.\.\/(services|components|api)\//},a=>
     mocks.has(a.path)?{path:a.path,namespace:'travel-browser-test-mock'}:undefined);
   b.onLoad({filter:/.*/,namespace:'travel-browser-test-mock'},a=>
     ({contents:mocks.get(a.path),loader:'js'}));
  }
 }]
});
const bundled=bundle.outputFiles[0].text;

const setup=async page=>{
 await page.clock.install();
 await page.goto('about:blank');
 await page.evaluate(()=>{
   window.__travelMock={
     previewHangs:false,reportHangs:false,saveHangs:false,persistOnHangingSave:false,
     previewCalls:0,saveCalls:[],reports:[],
     days:[{date:'2026-11-05',ready:true,activities:'הדרכה',review_status:'missing'},
       {date:'2026-11-06',ready:true,activities:'הדרכה',review_status:'missing'}],
     preview(date,signal){
       this.previewCalls++;
       if(this.previewHangs===true || this.previewHangs===date)return new Promise(()=>{});
       return Promise.resolve([
         {kind:'outbound',from:'בית',to:'בית ספר',minutes:null,kilometers:null},
         {kind:'return',from:'בית ספר',to:'בית',minutes:null,kilometers:null}
       ]);
     },
     report(date){if(this.reportHangs)return new Promise(()=>{});return Promise.resolve(this.reports.find(r=>r.travel_date===date)||null);},
     save(date,legs,noTravel,signal){
       this.saveCalls.push({date,legs,noTravel});
       const stored={travel_date:date,no_travel:noTravel,
         legs:noTravel?[]:structuredClone(legs),review_status:'pending_review',
         total_km:0,cancellation_minutes:0};
       if(this.saveHangs){
         if(this.persistOnHangingSave)this.reports=[stored];
         return new Promise(()=>{});
       }
       this.reports=[stored];
       return Promise.resolve(stored);
     }
   };
 });
 await page.addScriptTag({content:bundled});
 await page.evaluate(()=>{
  window.travelComponent=window.TravelComponent.createDailyTravelTab({
   empId:1502,initialDate:'2026-11-05'
  });
  document.body.append(window.travelComponent.panel);
 });
};

const withPage=async fn=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.ATTENDANCE_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
 const page=await browser.newPage({locale:'he-IL'});
 try{await setup(page);await fn(page);}
 finally{await browser.close();}
};

test('real Chromium: hanging travel preview exposes retry and no longer freezes attendance UI',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{
   window.__travelMock.previewHangs=true;
   window.pendingLoad=window.travelComponent.load();
  });
  await page.waitForFunction(()=>window.__travelMock.previewCalls>0);
  await page.clock.fastForward(12500);
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__retry')?.hidden===false);
  const status=await page.locator('.av2-daily-travel__status').innerText();
  assert.match(status,/לא הסתיימה בזמן/);
  await page.evaluate(()=>{window.__travelMock.previewHangs=false;});
  await page.locator('.av2-daily-travel__retry').click();
  await page.waitForFunction(()=>!document.querySelector('.av2-daily-travel__status')?.textContent.includes('טוען'));
  assert.equal(await page.locator('button:has-text("שמירת נסיעות")').isEnabled(),true);
  assert.ok(await page.evaluate(()=>window.__travelMock.previewCalls)>=2);
 });
});

test('real Chromium: timed-out save with existing server report is confirmed without duplicate write',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{window.__travelMock.saveHangs=true;window.__travelMock.persistOnHangingSave=true;});
  await page.evaluate(()=>window.travelComponent.load());
  await page.locator('.av2-daily-travel input[type="checkbox"]').check();
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>window.__travelMock.saveCalls.length===1);
  await page.clock.fastForward(15500);
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('נמצא שמור'));
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
  assert.equal(await page.locator('.av2-daily-travel__saved').isVisible(),true);
 });
});

test('real Chromium: failed save does not erase the entered no-travel selection',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{window.__travelMock.saveHangs=true;window.__travelMock.persistOnHangingSave=false;});
  await page.evaluate(()=>window.travelComponent.load());
  const checkbox=page.locator('.av2-daily-travel input[type="checkbox"]');
  await checkbox.check();
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>window.__travelMock.saveCalls.length===1);
  await page.clock.fastForward(15500);
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('לא נמצא דיווח'));
  assert.equal(await checkbox.isChecked(),true);
  assert.equal(await page.locator('button:has-text("שמירת נסיעות")').isEnabled(),true);
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
 });
});


test('real Chromium: switching days during a stalled preview loads the newly chosen day',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{
   window.__travelMock.previewHangs='2026-11-05';
   window.pendingLoad=window.travelComponent.load();
  });
  await page.waitForFunction(()=>window.__travelMock.previewCalls===1);
  await page.evaluate(()=>{
   window.travelComponent.setDate('2026-11-06');
   void window.travelComponent.load();
  });
  await page.clock.fastForward(12500);
  await page.waitForFunction(()=>{
   const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='שמירת נסיעות');
   return document.querySelector('#av2-travel-date')?.value==='2026-11-06'
      && window.__travelMock.previewCalls>=2 && save && !save.disabled;
  });
  assert.equal(await page.locator('#av2-travel-date').inputValue(),'2026-11-06');
 });
});

test('real Chromium: unverified save stays blocked until server status can be checked',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{window.__travelMock.saveHangs=true;});
  await page.evaluate(()=>window.travelComponent.load());
  await page.locator('.av2-daily-travel input[type="checkbox"]').check();
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>window.__travelMock.saveCalls.length===1);
  await page.evaluate(()=>{window.__travelMock.reportHangs=true;});
  await page.clock.fastForward(15500);
  await page.clock.fastForward(12500);
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('לא ניתן לאמת'));
  assert.equal(await page.locator('button:has-text("שמירת נסיעות")').isDisabled(),true);
  assert.equal(await page.locator('.av2-daily-travel__retry').isVisible(),true);
  await page.evaluate(()=>{window.__travelMock.reportHangs=false;});
  await page.locator('.av2-daily-travel__retry').click();
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('לא נמצא דיווח'));
  assert.equal(await page.locator('button:has-text("שמירת נסיעות")').isEnabled(),true);
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
 });
});

test('real Chromium: mismatched server report blocks overwrite until reviewed',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{window.__travelMock.saveHangs=true;});
  await page.evaluate(()=>window.travelComponent.load());
  await page.locator('.av2-daily-travel input[type="checkbox"]').check();
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>window.__travelMock.saveCalls.length===1);
  await page.evaluate(()=>{
   window.__travelMock.reports=[{
     travel_date:'2026-11-05',no_travel:false,review_status:'pending_review',
     legs:[{kind:'outbound',from:'בית',to:'בית ספר',mode:'car',minutes:70,kilometers:25},
           {kind:'return',from:'בית ספר',to:'בית',mode:'car',minutes:70,kilometers:25}]
   }];
  });
  await page.clock.fastForward(15500);
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('נתונים אחרים'));
  assert.equal(await page.locator('button:has-text("שמירת נסיעות")').isDisabled(),true);
  assert.match(await page.locator('.av2-daily-travel__retry').innerText(),/רענון מהשרת/);
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
 });
});

test('real Chromium: cancelling day departure preserves unsaved travel and permits saving',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>window.travelComponent.load());
  const checkbox=page.locator('.av2-daily-travel input[type="checkbox"]');
  await checkbox.check();
  let prompts=0;
  page.on('dialog',async dialog=>{prompts++;assert.match(dialog.message(),/שינויים שטרם נשמרו/);await dialog.dismiss();});
  const moved=await page.evaluate(()=>window.travelComponent.setDate('2026-11-06'));
  assert.equal(moved,false);assert.equal(prompts,1);
  assert.equal(await checkbox.isChecked(),true);
  assert.equal(await page.locator('#av2-travel-date').inputValue(),'2026-11-05');
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__saved')?.hidden===false);
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
 });
});

test('real Chromium: confirmed departure discards only after explicit warning',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>window.travelComponent.load());
  await page.locator('.av2-daily-travel input[type="checkbox"]').check();
  page.once('dialog',dialog=>dialog.accept());
  await page.evaluate(async()=>{window.travelComponent.setDate('2026-11-06');await window.travelComponent.load();});
  assert.equal(await page.locator('#av2-travel-date').inputValue(),'2026-11-06');
  assert.equal(await page.locator('.av2-daily-travel input[type="checkbox"]').isChecked(),false);
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),0);
 });
});

test('real Chromium: in-flight save keeps its day and blocks duplicate submission',async()=>{
 await withPage(async page=>{
  await page.evaluate(()=>{window.__travelMock.saveHangs=true;});
  await page.evaluate(()=>window.travelComponent.load());
  await page.locator('.av2-daily-travel input[type="checkbox"]').check();
  await page.locator('button:has-text("שמירת נסיעות")').click();
  await page.waitForFunction(()=>window.__travelMock.saveCalls.length===1);
  page.once('dialog',dialog=>dialog.accept());
  assert.equal(await page.evaluate(()=>window.travelComponent.setDate('2026-11-06')),false);
  await page.evaluate(()=>document.querySelector('.av2-daily-travel__actions button')?.click());
  assert.equal(await page.locator('#av2-travel-date').inputValue(),'2026-11-05');
  assert.equal(await page.evaluate(()=>window.__travelMock.saveCalls.length),1);
 });
});
