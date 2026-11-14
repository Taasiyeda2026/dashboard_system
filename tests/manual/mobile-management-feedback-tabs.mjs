// Manual localhost acceptance; use synthetic accounts from the existing isolated E2E seed.
import { chromium } from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const appUrl=process.env.MOBILE_QA_APP_URL || 'http://127.0.0.1:5174/';
if(!['127.0.0.1','localhost'].includes(new URL(appUrl).hostname))throw Error('Localhost app required');
const account=JSON.parse(await readFile(process.env.MOBILE_QA_ACCOUNTS_FILE || 'work/real-auth-accounts.json','utf8')).find((a)=>a.role==='admin');
const browser=await chromium.launch({...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {}),args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'he-IL',timezoneId:'Asia/Jerusalem'});
const reads=new Set(['lookup_login_user_by_username','get_current_app_user','feedback_admin_groups','feedback_admin_course_summary_for_half','feedback_admin_instructor_assignments','feedback_admin_answer_facts','feedback_admin_instructor_review_items','feedback_staff_auto_status','feedback_staff_send_plan']);
const blocked=[]; const failures=[];
await page.route('**/*',async(route)=>{const request=route.request(),url=new URL(request.url());if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();if(request.method()==='POST'&&!url.pathname.startsWith('/auth/v1/')&&!reads.has(url.pathname.split('/').at(-1))){blocked.push(url.pathname);return route.abort();}if(url.pathname.endsWith('.js')&&url.searchParams.has('v')){url.searchParams.delete('v');return route.continue({url:url.href});}return route.continue();});
page.on('pageerror',e=>failures.push(e.message));
await page.goto(appUrl);
await page.locator('#loginForm').waitFor();
await page.locator('#userId').fill(account.username);await page.locator('#entryCode').fill(account.password);await page.locator('.login-submit').click();
await page.locator('.app-shell #screenRoot').waitFor({state:'visible',timeout:18000});
await page.evaluate(()=>document.dispatchEvent(new CustomEvent('app:navigate',{detail:{route:'impact-feedback',force:true}})));
await page.locator('[data-ifb-admin]').waitFor({state:'visible'});
await page.waitForFunction(()=>document.querySelector('#ifb-panel')&&!document.querySelector('[data-ifb-admin] .ds-spinner'));
await mkdir('work/real-screen-captures',{recursive:true});
const results=[];
for(const tab of ['overview','students','instructors','staff','analysis','templates']){
  const button=page.locator(`[data-ifb-tab="${tab}"]`);
  if(!await button.isVisible())await page.locator('[data-mobile-section-nav-toggle]').click();
  await button.click();
  await page.waitForFunction(tab=>document.querySelector(`[data-ifb-tab="${tab}"]`)?.getAttribute('aria-selected')==='true'&&!document.querySelector('#ifb-panel .ds-spinner'),tab);
  await page.waitForTimeout(250);
  const result=await page.evaluate(tab=>({tab,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,error:document.querySelector('.ifb-empty--error')?.textContent||'',rows:document.querySelectorAll('.ifb-table tbody tr').length}),tab);
  if(result.error||result.width!==390||result.scrollWidth!==390)throw Error(JSON.stringify(result));
  results.push(result);
  await page.screenshot({path:`work/real-screen-captures/feedback-${tab}-390.png`,fullPage:true});
}
await writeFile('work/real-auth-feedback-results.json',JSON.stringify({results,blocked,failures},null,2));
console.log(JSON.stringify({results,blocked,failures},null,2));
await browser.close();
