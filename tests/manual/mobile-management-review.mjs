// Manual only. Start Vite on 127.0.0.1:5173; all external traffic is blocked.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
page.on('pageerror',error=>console.log('PAGE ERROR',error.message));
await page.goto('http://127.0.0.1:5173/tests/manual/mobile-management-review.html');
await page.waitForFunction(()=>window.reviewReady,{timeout:30000});
await mkdir('work/screenshots',{recursive:true});
const report=[];
for(const width of [320,375,390,430,1440]) {
 await page.setViewportSize({width,height:900});
 for(const screen of ['activities','drawer','month','week','manager','feedback']) {
  await page.evaluate(screen=>window.review(screen),screen);
  await page.waitForTimeout(120);
  const result = await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,overflows:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left < -1||r.right>innerWidth+1)&&getComputedStyle(el).position!=='fixed'}).slice(0,8).map(el=>`${el.tagName}.${el.className}`)}));
  assert.ok(result.scrollWidth <= width + 1, `${screen} at ${width}: page overflow`);
  if(screen === 'drawer' && width > 820) {
    assert.equal(await page.locator('[data-dates-management-summary]').isVisible(),false);
    assert.equal(await page.locator('.activity-desktop-progress-title').isVisible(),true);
    assert.equal(await page.locator('.activity-mobile-progress-title').isVisible(),false);
    assert.equal(await page.locator('.activity-mobile-progress-suffix').isVisible(),false);
    if(await page.locator('[data-management-panel]').count()) assert.equal(await page.locator('[data-management-panel]').isVisible(),false);
  }
  if(screen === 'drawer' && width <= 820) {
    assert.equal(await page.locator('.activity-desktop-progress-title').isVisible(),false);
    assert.equal(await page.locator('.activity-mobile-progress-title').isVisible(),true);
    const rect = await page.locator('.ds-drawer').boundingBox();
    assert.ok(Math.abs(rect.width - width) < 2 && rect.x < 2, 'drawer fills viewport');
    for(const button of await page.locator('.activity-drawer__header-actions button').all()) {
      const box = await button.boundingBox();
      if(box) assert.ok(box.width >= 43 && box.height >= 43, 'header actions have mobile touch targets');
    }
  }
  report.push({screen,...result});
  if(width===390 || (width===1440&&screen==='activities'))await page.screenshot({path:`work/screenshots/${screen}-${width}.png`,fullPage:true});
 }
}
await page.setViewportSize({width:390,height:844});
await page.evaluate(()=>window.review('activities'));
assert.equal(await page.locator('[data-mobile-activity-view]').count(),0);
assert.equal(await page.locator('[data-mobile-2027-card] .activity-management-indicators').count(),0);
assert.equal(await page.locator('[data-mobile-2027-card] [data-management-action="activity"]').count(),2);
await page.screenshot({path:'work/screenshots/activities-compact-390.png',fullPage:true});
await page.evaluate(()=>window.review('week'));
await page.locator('[data-mobile-week-day="2026-11-15"]').click();
assert.equal(await page.locator('[data-mobile-week-hidden="false"]').count(),1);
await page.locator('[data-mobile-week-day="all"]').click();
assert.equal(await page.locator('[data-mobile-week-hidden="false"]').count(),2);
await page.evaluate(()=>window.review('feedback'));
await page.locator('[data-mobile-section-nav-toggle]').click();
assert.equal(await page.locator('.ifb-tabs').isVisible(),true);
await page.screenshot({path:'work/screenshots/feedback-open-390.png',fullPage:true});
await writeFile('work/mobile-review-results.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report.filter(x=>x.scrollWidth>x.width+1),null,2));
console.log(`Checked ${report.length} viewport/screen combinations`);
await browser.close();
