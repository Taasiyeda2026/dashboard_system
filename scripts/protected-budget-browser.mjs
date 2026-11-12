import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';

export async function verifyLiveBrowser({session,profile}) {
 const require=createRequire(import.meta.url);
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE);
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const errors=[];
 context.on('page',page=>page.on('pageerror',()=>errors.push('Browser runtime error')));
 const key='sb-szinlhjuwyiyszdpsdop-auth-token';
 const production=process.env.PRODUCTION_DASHBOARD==='true';
 const legacy=process.env.LEGACY_DASHBOARD_SESSION==='true';
 await context.addInitScript(({key,session,profile,production,legacy})=>{
  if(location.origin!=='https://taasiyeda2026.github.io')return;
  localStorage.setItem(key,JSON.stringify(session));
  if(production){
   const permissions=typeof profile.permissions==='string'?JSON.parse(profile.permissions||'{}'):(profile.permissions||{});
   const user={...profile,...permissions,user_id:String(profile.user_id),auth_user_id:session.user.id,role:profile.role,active:'yes'};
   if(legacy){delete user.auth_user_id;delete user.active;}
   const claims={uid:user.user_id,role:user.role,emp_id:String(user.emp_id||user.user_id),name:String(user.name||'')};
   localStorage.setItem('dashboard_user',JSON.stringify(user));
   localStorage.setItem('dashboard_token','sb.'+btoa(unescape(encodeURIComponent(JSON.stringify(claims))))+'.session');
   sessionStorage.setItem('ds_session_alive','1');
  }
 },{key,session,profile,production,legacy});
 const source=resolve(process.env.DASHBOARD_SOURCE||'.');
 if(!production)await context.route('https://taasiyeda2026.github.io/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/budget-launcher.js')||path.endsWith('/budget-access.js')){
   await route.fulfill({contentType:'application/javascript',body:readFileSync(resolve(source,'frontend/src',path.split('/').pop()),'utf8')});return;
  }
  const html=`<!doctype html><html lang="he"><meta charset="utf-8"><button id="launch">בקרה תקציבית</button><p id="launchError"></p><script type="module">
   import {launchBudget} from '/dashboard_system/frontend/src/budget-launcher.js';
   document.querySelector('#launch').onclick=()=>launchBudget({user:{auth_user_id:'e9ca304a-4e66-4774-830e-14f1318c4908',role:'admin',active:'yes'},getSession:async()=>({data:{session:JSON.parse(localStorage.getItem('${key}'))}})}).catch(()=>document.querySelector('#launchError').textContent='Launch failed');
   </script></html>`;
  await route.fulfill({contentType:'text/html',body:html});
 });
 try{
  const page=await context.newPage();await page.goto('https://taasiyeda2026.github.io/dashboard_system/'+(production?'?route=admin-home':''),{waitUntil:'domcontentloaded'});
  const launch=page.locator(production?'[data-budget-open]':'#launch');
  await launch.waitFor({state:'visible',timeout:120000});
  const popupPromise=page.waitForEvent('popup');await launch.click();const app=await popupPromise;
  await app.locator('#app').waitFor({state:'visible',timeout:45000});await app.locator('.metric-value').first().waitFor();
  assert.ok(app.url().startsWith('blob:https://taasiyeda2026.github.io/'));
  assert.equal(await app.locator('input[type=password]').count(),0);
  assert.equal(await app.locator('#menuBtn').getAttribute('aria-expanded'),'false');
  if(process.env.BUDGET_ENTRY_ONLY==='true'){
   await page.evaluate(key=>localStorage.removeItem(key),key);
   await app.locator('#login').waitFor({state:'visible'});
   assert.equal(await app.locator('#view').innerText(),'');
   assert.equal(errors.length,0,'Browser reported a runtime error');
   console.log('::notice title=Existing dashboard session verification::PASS published management tile and protected budget launch with missing persisted identity/active fields; no extra login; logout cleanup. No financial writes.');
   return;
  }
  for(const view of ['annual','quarters','cashflow','revenues','expenses','activities','scenarios','controls','actuals','reports']){
   await app.locator('#menuBtn').click();await app.locator(`[data-view="${view}"]`).click();
   await app.locator('#view .loading').waitFor({state:'hidden',timeout:45000});
   assert.ok(!(await app.locator('#view').innerText()).includes('לא ניתן לטעון'),`Live ${view} screen failed`);
   if(view==='annual'){
    await app.locator('.quarter-toggle').first().click();await app.locator('.month-head').first().waitFor();
    assert.ok([3,6].includes(await app.locator('.month-head').count()));
    assert.equal(await app.locator('td.num').evaluateAll(cells=>cells.filter(e=>e.scrollWidth>e.clientWidth+1).length),0);
    assert.ok((await app.locator('tbody tr').first().boundingBox()).height<35);
    await app.locator('[data-action="pin"]').first().click();await app.locator('.row-highlight').first().waitFor();
    await app.locator('#presentBtn').click();assert.ok(await app.locator('body').evaluate(e=>e.classList.contains('presentation')));await app.locator('#presentBtn').click();
   }
  }
  const downloadPromise=app.waitForEvent('download');await app.locator('[data-action="xlsx"]').click();const download=await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.xlsx'));await download.cancel();
  const reportPromise=app.waitForEvent('popup');await app.locator('[data-action="pdf"]').click();const report=await reportPromise;
  await report.locator('table').waitFor();const pdf=await report.pdf();assert.equal(pdf.subarray(0,5).toString(),'%PDF-');await report.close();
  // No report, screenshot, token or financial dataset is uploaded as an artifact.
  await page.evaluate(key=>localStorage.removeItem(key),key);
  await app.locator('#login').waitFor({state:'visible'});assert.equal(await app.locator('#view').innerText(),'');
  assert.equal(errors.length,0,'Browser reported a runtime error');
  console.log('::notice title=Live browser verification::PASS real owner session; protected launcher; all 10 budget screens; quarter expansion; numeric visibility; highlighting; presentation; Excel/PDF; logout cleanup. No financial writes or report artifacts.');
 }catch{throw Error('Live protected budget browser verification failed; no financial details logged')}finally{await context.close();await browser.close()}
}
