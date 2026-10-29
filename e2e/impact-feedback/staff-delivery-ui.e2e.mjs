// Manual-only: actual screen, stubbed reads, no real API / Graph traffic.
// Run with a local Vite server and VITE_SUPABASE_URL=http://127.0.0.1:59999.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const app=process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
assert.ok(['127.0.0.1','localhost'].includes(new URL(app).hostname));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const states=['not_due','pending','sent','failed','needs_attention'];
const labels=['ממתין לשליחה','נשלח','השליחה נכשלה','דרושה בדיקת שליחה'];
const groups=states.flatMap((_,i)=>['first','second'].map(half=>({
  row_id:`${half}-${i}`,program_key:'trailblazers',program_source:'name',feedback_excluded:false,
  school:`בית ספר לדוגמה ${i+1}`,authority:'חיפה',contact_name:`איש קשר ${i+1}`,has_contact:true,
  start_date:half==='first'?'2026-10-12':'2027-01-12',end_date:half==='first'?'2026-10-30':'2027-01-30',
  academic_year:'school_2027',grade:'ח',campaigns:[]
})));
let statusAvailable=true;
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort();
      if(!url.pathname.includes('/rest/v1/'))return route.continue();
      const name=url.pathname.split('/').at(-1);let body=[];
      if(name==='feedback_programs')body=[{key:'trailblazers',title:'פורצות דרך',is_active:true}];
      if(name==='feedback_admin_groups')body=groups;
      if(name==='feedback_staff_auto_status') {
        if(!statusAvailable)return route.fulfill({status:503,contentType:'application/json',body:'{"message":"status unavailable"}'});
        body=groups.flatMap((g,i)=>['pre','final'].map(stage=>({activity_row_id:g.row_id,stage,status:states[Math.floor(i/2)]})));
      }
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
    });
    await page.goto(`${app}/e2e/impact-feedback/harness.html`);
    await page.locator('[data-ifb-tab="staff"]').click();
    for(const half of ['first','second']) {
      await page.locator(`[data-ifb-group-half="${half}"]`).click();
      await page.locator('.ifb-groups-table--staff tbody tr').first().waitFor();
      assert.equal(await page.locator('.ifb-groups-table--staff tbody tr').count(),5);
      assert.equal(await page.locator('.ifb-groups-table--staff th.ifb-col-stage').count(),2);
      for(const label of labels)assert.equal(await page.locator('.ifb-mail-status').filter({hasText:label}).count(),2);
      // A not_due opening is not automatically a pending email; its date controls
      // whether it is still in the future or has missed the dispatch window.
      assert.equal(await page.locator('.ifb-mail-status')
        .filter({hasText:half==='first'?'לא נשלח · מועד השליחה חלף':'ממתין לתחילת הקורס'}).count(),1);
      assert.equal(await page.locator('.ifb-mail-status')
        .filter({hasText:'ממתין לסיום הקורס'}).count(),1);
      const overflow=await page.locator('.ifb-admin').evaluate(el=>el.scrollWidth>el.clientWidth+2);
      assert.equal(overflow,false,`no overflow at ${viewport.width}/${half}`);
    }
    await page.locator('[data-ifb-tab="students"]').click();
    assert.equal(await page.locator('.ifb-mail-status').count(),0);
    await page.locator('[data-ifb-tab="instructors"]').click();
    assert.equal(await page.locator('.ifb-mail-status').count(),0);
    statusAvailable=false;
    await page.locator('[data-ifb-tab="staff"]').click();
    await page.locator('[data-ifb-refresh]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.ifb-mail-status').length===10 &&
      [...document.querySelectorAll('.ifb-mail-status')].every(el=>el.textContent.includes('סטטוס שליחה לא זמין')));
    assert.deepEqual(errors,[]);
    statusAvailable=true;await context.close();
    console.log(`PASS staff UI ${viewport.width}px: both halves, five labels, two columns, read failure, other audiences unchanged`);
  }
} finally {await browser.close();}
