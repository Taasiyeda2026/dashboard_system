// Real UI modules + real localhost Auth/PostgREST. Directory RPCs use empty test
// data; attendance, travel, transport, auth and error handling are not mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';
import {status,bootstrap,instructor,db} from './helpers/attendance-stability-local.mjs';
const root=new URL('../',import.meta.url);
const entry=`
import {showEditModal} from './attendance/src/screens/my-reports-screen.js';
import {renderLoginScreen} from './attendance/src/screens/login-screen.js';
import {renderNewReportScreen} from './attendance/src/screens/new-report-screen.js';
import {signInWithUsername,getExistingSession} from './attendance/src/auth/auth.service.js';
import {getMonthRecords,updateRecord,deleteRecord,calcMonthSummary} from './attendance/src/services/attendance.service.js';
import {getDailyTravelReports} from './attendance/src/services/daily-travel.service.js';
import {confirmLeavingReports} from './attendance/src/services/unsaved-changes.js';
window.qa={showEditModal,getMonthRecords,updateRecord,deleteRecord,calcMonthSummary,getDailyTravelReports,confirmLeavingReports};
const host=document.querySelector('#app');
const params=new URLSearchParams(location.search),empId=Number(params.get('emp'));
function report(){renderNewReportScreen(host,{instructor:{empId,name:'מדריך בדיקה'},defaultDate:'2026-11-10',onSaved:row=>{window.qa.saved=row;}});}
window.qa.open=report;
const session=await getExistingSession();
if(session)report();else renderLoginScreen(host,{onLogin:async({username,code})=>{await signInWithUsername(username,code);report();}});
`;
const bundle=await build({stdin:{contents:entry,resolveDir:root.pathname,sourcefile:'attendance-stability-harness.js'},bundle:true,write:false,format:'esm',platform:'browser',plugins:[{name:'local-endpoint-only',setup(b){b.onLoad({filter:/attendance\/src\/screens\/my-reports-screen\.js$/},async args=>({contents:(await readFile(args.path,'utf8'))+'\nexport {showEditModal};',resolveDir:new URL('./attendance/src/screens/',root).pathname,loader:'js'}));b.onLoad({filter:/attendance\/src\/api\/client\.js$/},async args=>{
 const source=await readFile(args.path,'utf8');
 return {contents:"import {createClient} from '@supabase/supabase-js';\n"+source.replace("'https://szinlhjuwyiyszdpsdop.supabase.co'",JSON.stringify(status.API_URL)).replace(/const SUPABASE_ANON_KEY = '[^']+';/,'const SUPABASE_ANON_KEY = '+JSON.stringify(status.ANON_KEY)+';').replace('window.supabase.createClient','createClient'),resolveDir:new URL('./attendance/src/api/',root).pathname,loader:'js'};
});}}]});
const css=(await Promise.all(['base','new-report-screen','report-tabs-responsive-typography','new-report-final-alignment'].map(name=>readFile(new URL('attendance/src/styles/'+name+'.css',root),'utf8')))).join('\n');
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':req.url==='/style.css'?'text/css':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:req.url==='/style.css'?css:'<!doctype html><html lang="he" dir="rtl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="app"></main><script type="module" src="/app.js"></script></html>');});

async function fillReport(page){
 await page.locator('#av2-activity-type').selectOption('תפעול');
 await page.locator('#av2-operation-choice').selectOption('team');
 await page.locator('#av2-team-meeting-mode').selectOption('physical');
 await page.locator('#av2-team-location').fill('כתובת בדיקה 2');
 // Use the actual custom time-picker's native select and dispatch its normal change.
 for(const [id,value] of [['av2-start-time-h','8'],['av2-start-time-m','0'],['av2-end-time-h','10'],['av2-end-time-m','0']]){
  const trigger=page.locator('#'+id+'-trigger');
  await trigger.click();
  await trigger.locator('..').getByRole('option',{name:value.padStart(2,'0'),exact:true}).click();
 }
 await page.locator('#av2-notes').fill('נוכחות בדיקה מבוקרת');
}

test('real services and browser: complete reporting with lost responses, offline recovery and repeat save',async t=>{
 let browser,baseUrl;
 try{
  await bootstrap();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.ATTENDANCE_CHROMIUM_EXECUTABLE_PATH||undefined,args:['--no-sandbox']});
  for(const [name,viewport,isMobile] of [['desktop Chrome',{width:1366,height:900},false],['Android-sized Chromium',{width:412,height:915},true],['iPhone-sized Chromium',{width:390,height:844},true]]){
   await t.test(name,async()=>{
    const emp=await instructor(name.startsWith('desktop')?99004:name.startsWith('Android')?99005:99006,null);
    const context=await browser.newContext({viewport,isMobile,hasTouch:isMobile,locale:'he-IL'});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
     assert.ok(['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname),'Production/external request forbidden');
     await route.continue();
    });
    await page.goto(baseUrl+'/?emp='+emp.emp);
    await page.locator('#av2-username').fill(String(emp.emp));
    await page.locator('#av2-code').fill(emp.password);
    await page.locator('.av2-login__submit').click();
    await page.locator('#av2-activity-type').waitFor();
    await fillReport(page);
    page.once('dialog',dialog=>dialog.dismiss());
    assert.equal(await page.evaluate(()=>window.qa.confirmLeavingReports()),false);
    page.once('dialog',dialog=>dialog.dismiss());
    await page.locator('#av2-report-date').fill('2026-11-09');
    await page.locator('#av2-report-date').dispatchEvent('change');
    assert.equal(await page.locator('#av2-report-date').inputValue(),'2026-11-10');
    // A disconnected save must retain all fields and return control.
    await context.setOffline(true);
    await page.locator('.av2-report__save').click();
    await page.waitForFunction(()=>document.querySelector('.av2-report__save')?.disabled===false);
    assert.equal(await page.locator('#av2-notes').inputValue(),'נוכחות בדיקה מבוקרת');
    await page.locator('.av2-report__error').waitFor({state:'visible'});
    await context.setOffline(false);
    // Commit on the real server, then lose only the response. The application
    // must find its stable ID instead of inserting a second attendance row.
    let lost=false;
    await page.route('**/rest/v1/attendance_records*',async route=>{
     if(!lost && route.request().method()==='POST'){
      lost=true;await route.fetch();await route.abort('failed');
     }else await route.continue();
    });
    await page.locator('.av2-report__save').click();
    await page.waitForFunction(()=>Boolean(window.qa.saved),null,{timeout:10000});
    assert.equal(lost,true);
    const rows=await page.evaluate(emp=>window.qa.getMonthRecords(emp,2026,11,{force:true}),emp.emp);
    assert.equal(rows.length,1);assert.equal(Number(rows[0].total_hours),2);
    // Wait for the form's normal successful-save reset before entering travel.
    await page.waitForFunction(()=>!document.querySelector('#av2-notes')?.value);
    await page.locator('#av2-travel-tab-trigger').click();
    await page.locator('.av2-daily-travel__leg').first().waitFor();
    await page.locator('.av2-daily-travel__mode select').first().selectOption('car');
    for(const index of [0,1]){
     await page.locator('[data-duration-hours="'+index+'"]').selectOption('1');
     await page.locator('[data-duration-minutes="'+index+'"]').selectOption('10');
     await page.locator('[data-daily-travel-leg="'+index+'"][data-field="kilometers"]').fill('20');
    }
    await page.route('**/rest/v1/rpc/**',async route=>{await new Promise(resolve=>setTimeout(resolve,100));await route.continue();});
    await page.locator('button:has-text("שמירת נסיעות")').click();
    await page.locator('.av2-daily-travel__saved').waitFor({state:'visible'});
    const saved=await page.evaluate(emp=>window.qa.getDailyTravelReports(emp,'2026-11'),emp.emp);
    assert.equal(saved.length,1);assert.equal(Number(saved[0].total_km),40);
    await page.locator('.av2-daily-travel__saved-edit').click();
    await page.locator('[data-daily-travel-leg="0"][data-field="kilometers"]').fill('25');
    await page.locator('button:has-text("שמירת נסיעות")').click();
    await page.locator('.av2-daily-travel__saved').waitFor({state:'visible'});
    await page.reload();
    await page.locator('#av2-travel-tab-trigger').click();
    await page.locator('.av2-daily-travel__saved').waitFor({state:'visible'});
    const reread=await page.evaluate(emp=>window.qa.getDailyTravelReports(emp,'2026-11'),emp.emp);
    assert.equal(reread.length,1);assert.equal(Number(reread[0].cancellation_minutes),50);assert.equal(Number(reread[0].total_km),45);
    const summary=await page.evaluate(async emp=>window.qa.calcMonthSummary(await window.qa.getMonthRecords(emp,2026,11,{force:true})),emp.emp);
    assert.equal(summary.totalHours,2);
    await page.evaluate(async({emp,id})=>{await window.qa.updateRecord(id,emp,{notes:'עדכון מבוקר'});await window.qa.deleteRecord(id,emp);},{emp:emp.emp,id:rows[0].id});
    const remaining=await page.evaluate(emp=>window.qa.getMonthRecords(emp,2026,11,{force:true}),emp.emp);
    assert.equal(remaining.length,0);
    assert.equal((await page.evaluate(emp=>window.qa.getDailyTravelReports(emp,'2026-11'),emp.emp)).length,0);
    assert.deepEqual(errors,[]);
    await context.close();
   });
  }
  await t.test('historical editor confirms a lost batch response without partial or duplicate writes',async()=>{
   const emp=await instructor(99007,null);
   await db.query("insert into attendance_month_approvals(emp_id,month_key,status)values($1,'2026-10','reopened')",[emp.emp]);
   await db.query("insert into attendance_records(emp_id,report_date,activity_type,activity_name_snapshot,start_time,end_time,total_hours,roundtrip_km,cancellation_before_minutes,cancellation_after_minutes)values($1,'2026-10-20','תפעול','צוות','08:00','09:00',1,10,5,5),($1,'2026-10-20','תפעול','צוות','10:00','11:00',1,20,5,5)",[emp.emp]);
   const context=await browser.newContext({locale:'he-IL'}),page=await context.newPage();
   page.setDefaultTimeout(10000);
   try{
    await page.route('**/*',async route=>{assert.ok(['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname));await route.continue();});
    await page.goto(baseUrl+'/?emp='+emp.emp);
    await page.locator('#av2-username').fill(String(emp.emp));await page.locator('#av2-code').fill(emp.password);await page.locator('.av2-login__submit').click();
    await page.locator('#av2-travel-tab-trigger').click();
    await page.locator('.av2-daily-travel').getByRole('button',{name:'חודש דיווח',exact:true}).click();
    await page.locator('.av2-daily-travel').getByRole('option',{name:/אוקטובר/}).click();
    await page.locator('.av2-daily-travel__historical-edit').click();
    await page.locator('[data-historical-field="roundtrip_km"]').nth(0).fill('30');
    await page.locator('[data-historical-field="roundtrip_km"]').nth(1).fill('40');
    let writes=0,failRefresh=true;
    await page.route('**/rest/v1/attendance_records*',async route=>{
     if(writes && failRefresh && new URL(route.request().url()).searchParams.get('select')?.includes('attendance_record_attachments'))await route.abort('failed');else await route.continue();
    });
    await page.route('**/rest/v1/rpc/av2_save_historical_travel_batch',async route=>{writes++;await route.fetch();await route.abort('failed');});
    await page.locator('[data-historical-action="save"]').click();
    await page.waitForFunction(()=>document.querySelector('.av2-daily-travel__status')?.textContent.includes('נשמרו בשרת, אך רענון'));
    assert.equal(await page.locator('[data-historical-field="roundtrip_km"]').nth(0).inputValue(),'30');
    failRefresh=false;await page.locator('.av2-daily-travel__retry').click();
    await page.locator('.av2-daily-travel__historical-edit').waitFor({state:'visible'});
    const rows=await page.evaluate(emp=>window.qa.getMonthRecords(emp,2026,10,{force:true}),emp.emp);
    assert.deepEqual(rows.map(row=>Number(row.roundtrip_km)).sort(),[30,40]);assert.equal(writes,1);
   }finally{await context.close();}
  });
  await t.test('existing attendance editor warns before closing and keeps input after network failure',async()=>{
   const emp=await instructor(99008,'2026-11-10');
   await db.query("update attendance_records set activity_type='תפעול',activity_name_snapshot='צוות',operation_meeting_mode='physical',destination_address_snapshot='כתובת בדיקה 2' where emp_id=$1",[emp.emp]);
   const context=await browser.newContext({locale:'he-IL'}),page=await context.newPage();
   page.setDefaultTimeout(10000);
   try{
    await page.route('**/*',async route=>{assert.ok(['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname));await route.continue();});
    await page.goto(baseUrl+'/?emp='+emp.emp);
    await page.locator('#av2-username').fill(String(emp.emp));await page.locator('#av2-code').fill(emp.password);await page.locator('.av2-login__submit').click();
    await page.locator('#av2-activity-type').waitFor();
    await page.evaluate(async emp=>{const record=(await window.qa.getMonthRecords(emp,2026,11,{force:true}))[0];window.qa.showEditModal({record,instructor:{empId:emp},activityTypes:['תפעול'],onRefresh:()=>{window.qa.edited=true;}});},emp.emp);
    await page.locator('#edit-notes').fill('עריכה ללא אובדן קלט');
    page.once('dialog',dialog=>dialog.dismiss());await page.locator('.av2-modal__header [aria-label="סגירה"]').click();
    assert.equal(await page.locator('#edit-notes').inputValue(),'עריכה ללא אובדן קלט');
    await context.setOffline(true);
    await page.locator('.av2-modal form button[type="submit"]').click();
    await page.locator('.av2-modal .av2-report__error').waitFor({state:'visible'});
    assert.equal(await page.locator('#edit-notes').inputValue(),'עריכה ללא אובדן קלט');
    await context.setOffline(false);
    assert.match(await page.locator('.av2-modal .av2-report__error').innerText(),/לא ניתן לאמת|תקשורת|חיבור/);
    await page.locator('.av2-modal form button[type="submit"]').click();
    await page.waitForFunction(()=>window.qa.edited===true);
    const rows=await page.evaluate(emp=>window.qa.getMonthRecords(emp,2026,11,{force:true}),emp.emp);
    assert.equal(rows[0].notes,'עריכה ללא אובדן קלט');
   }finally{await context.close();}
  });
  await t.test('review blockers: accessible validation, slow file retry and uncertain update',async()=>{
   const emp=await instructor(99022,null);
   const context=await browser.newContext({locale:'he-IL'}),page=await context.newPage();
   page.setDefaultTimeout(10000);
   try{
    await page.route('**/*',async route=>{assert.ok(['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname));await route.continue();});
    await page.goto(baseUrl+'/?emp='+emp.emp);
    await page.locator('#av2-username').fill(String(emp.emp));await page.locator('#av2-code').fill(emp.password);await page.locator('.av2-login__submit').click();
    await page.locator('.av2-report__save').click();
    await page.locator('.av2-report__error[role="alert"]').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>document.activeElement.id),'av2-activity-type');
    assert.equal(await page.locator('#av2-activity-type').isEnabled(),true);
    await fillReport(page);
    const bytes=Buffer.from('%PDF-1.4\ncontrolled attachment\n');
    await page.locator('.av2-report__save').click();await page.waitForFunction(()=>Boolean(window.qa.saved));
    await page.locator('#av2-expenses-tab-trigger').click();
    await page.locator('#av2-expense-amount').fill('25');await page.locator('#av2-expense-details').fill('מסמך בדיקה');
    await page.locator('#av2-expense-receipts').setInputFiles({name:'slow.pdf',mimeType:'application/pdf',buffer:bytes});
    const objects=new Map();let uploads=0,metadataWrites=0,loseMetadataRead=false;
    let release,started;const gate=new Promise(r=>release=r),uploadStarted=new Promise(r=>started=r);
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,x-client-info,content-type,x-upsert,cache-control,x-supabase-api-version','access-control-allow-methods':'GET,POST,PUT,OPTIONS','content-type':'application/json'};
    await page.route('**/storage/v1/**',async route=>{
     const request=route.request(),url=new URL(request.url());
     if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers});return;}
     if(url.pathname.includes('/object/list/')){await route.fulfill({headers,body:'[]'});return;}
     if(request.method()==='POST'){
      uploads++;
      objects.set(url.pathname,bytes);started();await gate;
      await route.abort('failed');return; // Object committed, response lost.
     }
     const object=objects.get(url.pathname);
     await route.fulfill(object?{status:200,headers:{...headers,'content-type':'application/pdf'},body:object}:{status:404,headers,body:JSON.stringify({message:'Object not found',statusCode:'404'})});
    });
    await page.route('**/rest/v1/rpc/av2_expense_attachment_add',async route=>{
     metadataWrites++;const response=await route.fetch();
     if(metadataWrites===1){loseMetadataRead=true;await route.abort('failed');}else await route.fulfill({response});
    });
    await page.route('**/rest/v1/rpc/av2_list_expenses',async route=>{
     if(loseMetadataRead){loseMetadataRead=false;await route.abort('failed');}else await route.continue();
    });
    await page.clock.install();
    const expenseSave=page.locator('.av2-expenses-tab__actions button[type="submit"]');
    await expenseSave.click();
    let uploadTimer;try{await Promise.race([uploadStarted,new Promise((_,reject)=>{uploadTimer=setTimeout(()=>reject(new Error('Upload did not start')),15000);})]);}finally{clearTimeout(uploadTimer);}
    await page.clock.fastForward(25000);
    assert.equal(await expenseSave.isDisabled(),true);
    assert.match(await page.locator('.av2-expenses-tab__status').innerText(),/ההוצאה נשמרה.*מעלה קבצים/);
    release();
    await page.waitForFunction(()=>document.querySelector('.av2-expenses-tab__actions button[type="submit"]')?.textContent.includes('נסה שוב צירוף קבצים'));
    assert.match(await page.locator('.av2-expenses-tab__upload-text').innerText(),/slow.pdf/);
    await expenseSave.click();
    await page.waitForFunction(()=>document.querySelector('.av2-expenses-tab__status')?.textContent==='ההוצאה נשמרה');
    assert.equal(uploads,1);assert.equal(metadataWrites,2);assert.equal(objects.size,1);
    const receipts=await db.query('select count(*)::int as n from attendance_expense_attachments where emp_id=$1',[emp.emp]);
    const expenses=await db.query('select count(*)::int as n from attendance_expense_reports where emp_id=$1',[emp.emp]);
    assert.equal(receipts.rows[0].n,1);assert.equal(expenses.rows[0].n,1);
    const rows=await page.evaluate(emp=>window.qa.getMonthRecords(emp,2026,11,{force:true}),emp.emp);
    assert.equal(rows.length,1);
    let patches=0,loseUpdateRead=false;
    await page.route('**/rest/v1/attendance_records*',async route=>{
     if(route.request().method()==='PATCH'){patches++;await route.fetch();loseUpdateRead=true;await route.abort('failed');}
     else if(loseUpdateRead){await route.abort('failed');}
     else await route.continue();
    });
    const attempt=()=>page.evaluate(async({id,emp})=>{try{return await window.qa.updateRecord(id,emp,{notes:'עדכון שאומת פעם אחת'});}catch(error){return {error:error.message};}},{id:rows[0].id,emp:emp.emp});
    assert.match((await attempt()).error,/לא ניתן לאמת/);
    loseUpdateRead=false;
    assert.equal((await attempt()).notes,'עדכון שאומת פעם אחת');assert.equal(patches,1);
   }finally{await context.close();}
  });
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await db.end();}
});
