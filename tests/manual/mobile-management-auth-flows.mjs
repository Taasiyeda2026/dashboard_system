// Manual localhost acceptance; use synthetic accounts from the existing isolated E2E seed.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';import{readFile,writeFile}from'node:fs/promises';
const appUrl=process.env.MOBILE_QA_APP_URL || 'http://127.0.0.1:5174/';
if(!['127.0.0.1','localhost'].includes(new URL(appUrl).hostname))throw Error('Localhost app required');
const accounts=JSON.parse(await readFile(process.env.MOBILE_QA_ACCOUNTS_FILE || 'work/real-auth-accounts.json'));
await (await import('node:fs/promises')).mkdir('work/real-screen-captures',{recursive:true});
const b=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});const results=[];
for(const account of accounts.filter(a=>!process.env.MOBILE_QA_ROLES || process.env.MOBILE_QA_ROLES.split(',').includes(a.role))){
 const p=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
 const denied=[];const errors=[];
 await p.route('**/*',r=>{const q=r.request(),u=new URL(q.url());if(!['127.0.0.1','localhost'].includes(u.hostname))return r.abort();if(['PATCH','PUT','DELETE'].includes(q.method())){denied.push(u.pathname);return r.abort();}if(q.method()==='POST'&&u.pathname.includes('/rpc/')&&/send|save|update|delete|create|open_|approve|submit|dispatch|publish|reconcile|mark_|set_/.test(u.pathname.split('/').at(-1))){denied.push(u.pathname);return r.abort();}if(u.pathname.endsWith('.js')&&u.searchParams.has('v')){u.searchParams.delete('v');return r.continue({url:u.href});}return r.continue();});
 p.on('pageerror',e=>errors.push(e.message));await p.goto(appUrl);await p.locator('#loginForm').waitFor();
 await p.locator('#userId').fill(account.username);await p.locator('#entryCode').fill(account.password);await p.locator('.login-submit').click();
 await p.locator('.app-shell #screenRoot').waitFor({state:'visible',timeout:18000});
 if(account.role==='activities_manager')await p.locator('[data-manager-board-root]').waitFor({timeout:18000});
 if(account.role==='instructor') {
  const visible=await p.locator('.shell-header-nav [data-route="activities"]').count();
  assert.equal(visible,0);results.push({role:account.role,authenticatedShell:true,activitiesShortcutVisible:visible>0});
 } else {
  const quick=p.locator('.shell-header-nav [data-route="activities"]');
  if(await quick.count())await quick.click();else {await p.locator('#mobileMenuBtn').click();await p.locator('.shell-sidebar [data-route="activities"]').click();}
  await p.locator('.ds-activities-screen').waitFor({timeout:18000});
  await p.locator('[data-activity-period-tab="year_all"]').click();
  await p.locator('.ds-activities-row').first().waitFor({timeout:10000});
  await p.locator('input[data-filter-search]').fill('פורצות');
  await p.waitForTimeout(300);
  await p.locator('[data-mobile-activity-view]').click();
  await p.waitForTimeout(900);
  const card=p.locator('.ds-activities-row[data-row-id="ACT-1"]');
  const cardText=await card.innerText();
  assert.ok(cardText.includes('באישור ביצוע: 1'));
  assert.equal(await p.locator('[data-activity-quick-filter="missing-reports"]').isDisabled(),true);
  assert.equal(await p.locator('.ds-modal[aria-hidden="true"]').isVisible(),false);
  await p.screenshot({path:`work/real-screen-captures/full-app-${account.role}-activities.png`,fullPage:true});
  await card.locator('.ds-activities-program-name').click();
  await p.locator('[data-drawer-form]').waitFor({state:'visible'});await p.waitForTimeout(400);
  await p.screenshot({path:`work/real-screen-captures/full-app-${account.role}-drawer.png`});
  await p.locator('[data-drawer-form] [data-ui-close-drawer]').click();
  if(account.role==='admin' && process.env.MOBILE_QA_MANAGEMENT_ACTIONS==='1'){
   await p.locator('.ds-activities-row[data-row-id="ACT-1"] [data-management-action="feedback"]').first().click();
   await p.locator('[data-ifb-admin]').waitFor();
   await p.locator('.shell-header-nav [data-route="activities"]').click();
   await p.locator('.ds-activities-screen').waitFor();
   assert.equal(await p.locator('input[data-filter-search]').inputValue(),'פורצות');
   await p.setViewportSize({width:1440,height:900});
   await p.locator('input[data-filter-search]').fill('');
   await p.waitForTimeout(400);
   await p.locator('[data-activities-advanced-toggle]').click();
   await p.locator('[data-activity-advanced-field="managementFilter"]').selectOption('exceptions');
   await p.waitForFunction(()=>document.querySelectorAll('.ds-activities-row').length>2,{},{timeout:10000});
  }
  results.push({role:account.role,authenticatedShell:true,cardRows:await p.locator('.ds-activities-row').count(),query:await p.locator('input[data-filter-search]').inputValue(),innerWidth:await p.evaluate(()=>innerWidth),scrollWidth:await p.evaluate(()=>document.documentElement.scrollWidth),verifiedShown:cardText.includes('באישור ביצוע: 1'),cancelledUnknown:cardText.includes('ביטולים: לא זמינים'),denied,errors});
 }
 assert.deepEqual(errors,[]);assert.deepEqual(denied,[]);
 await p.close();
}
console.log(JSON.stringify(results,null,2));await writeFile('work/full-app-mobile-results.json',JSON.stringify(results,null,2));await b.close();
