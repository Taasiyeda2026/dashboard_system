// Manual Chromium validation. Uses the real screen components with labelled synthetic visual fixtures.
// For live Supabase coverage, use the separate local-stack integration script.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.NOTIFICATIONS_BROWSER_BASE_URL||'http://127.0.0.1:5187';
if(!['127.0.0.1','localhost'].includes(new URL(base).hostname))throw Error('Browser fixture must be localhost');
const output=process.env.NOTIFICATIONS_EVIDENCE_DIR||'work/notification-staging/visual';await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.NOTIFICATIONS_CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const results=[];
try{
 for(const [name,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}],['small-mobile',{width:320,height:740}]]){
  const context=await browser.newContext({viewport,locale:'he-IL',timezoneId:'Asia/Jerusalem'});const page=await context.newPage();
  const errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>{const host=new URL(route.request().url()).hostname;if(!['127.0.0.1','localhost'].includes(host)){external.push(host);return route.abort();}return route.continue();});
  await page.goto(`${base}/tests/fixtures/central-notifications/index.html`);await page.waitForFunction(()=>window.fixtureReady);
  await page.locator('[data-notification-tasks] article').first().waitFor();
  assert.equal(await page.locator('[data-notification-tasks] article').count(),3);
  assert.equal(await page.locator('[data-er-incoming] .ds-er-group').count(),1);
  const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${name}: horizontal overflow`);
  await noOverflow();
  await page.screenshot({path:`${output}/${name}-pending.png`,fullPage:true,animations:'disabled'});
  await page.locator('[data-notification-tab=updates]').click();
  await page.locator('[data-notification-read]').first().click();
  await page.waitForFunction(()=>window.fixtureState.notificationUnreadCount===2);
  assert.equal(await page.locator('[data-notification-tasks] article').count(),3,'Reading must not close a task');
  await page.screenshot({path:`${output}/${name}-updates.png`,fullPage:true,animations:'disabled'});
  await page.locator('[data-notification-tab=history]').click();await noOverflow();
  await page.locator('[data-notification-filter=domain]').selectOption('edit_request');
  await page.locator('[data-er-sent-resolved]').waitFor({state:'visible'});
  await page.screenshot({path:`${output}/${name}-history.png`,fullPage:true,animations:'disabled'});
  await page.evaluate(()=>window.visualScenario('empty'));await page.locator('[data-notification-updates] .ds-notification-empty').waitFor();
  await page.locator('[data-notification-tab=pending]').click();
  assert.equal(await page.locator('[data-notification-panel=pending] .ds-notification-empty:visible').count(),1);
  await page.screenshot({path:`${output}/${name}-empty.png`,fullPage:true,animations:'disabled'});
  await page.evaluate(()=>window.visualScenario('populated',150));await page.waitForFunction(()=>document.querySelectorAll('[data-notification-tasks] article').length===150);await noOverflow();
  assert.equal(await page.locator('[data-notification-task-count]').textContent(),'151');
  assert.equal(errors.length,0,errors.join('\n'));assert.equal(external.length,0,'No production/external requests are permitted');
  results.push({viewport:name,width:viewport.width,height:viewport.height,passed:true,checks:['real Chromium render','RTL','three tabs','unread clear','task stays open after read','legacy requests retained','empty state','150 tasks','no horizontal overflow','no external requests']});
  await context.close();
 }
 await writeFile(`${output}/results.json`,JSON.stringify({engine:'system Chromium',fixture:'synthetic visual data; real production components and CSS',results},null,2));
 console.log(JSON.stringify({passed:results.length,viewports:results.map(r=>r.viewport)}));
}finally{await browser.close();}
