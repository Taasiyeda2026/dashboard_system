// Disposable browser acceptance harness. No real backend requests or assignments.
// Run: node tests/manual/manual-scheduling-browser.mjs
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
const server = await createServer({ server: { host: '127.0.0.1', port: 4186 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
let cases = 0;
try {
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    await page.route('**/*', route => route.request().url().endsWith('/__manual_scheduling_acceptance')
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"></head><body></body></html>' })
      : route.request().url().startsWith('http://127.0.0.1:4186/') ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:4186/__manual_scheduling_acceptance');
    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="test-root"></div>';
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/frontend/src/screens/course-scheduling-neutral-colors.css'; document.head.append(link);
      const { courseSchedulingScreen } = await import('/frontend/src/screens/course-scheduling.js');
      const { supabase } = await import('/frontend/src/supabase-client.js');
      const activity = { row_id: 'synthetic-browser', updated_at: '2026-11-26T10:00:00Z', activity_season: 'school_2027',
        activity_type: 'קורס', status: 'פתוח', activity_name: 'בדיקת שיבוץ', school: 'בית ספר לבדיקה', authority: 'רשות לבדיקה',
        sessions: '2', date_1: '2027-05-05', date_2: '2027-05-12', start_date: '2027-05-05', end_date: '2027-05-12', start_time: '08:15', end_time: '09:45' };
      const state = { route: 'course-scheduling', user: { role: 'admin' }, courseSchedulingPeriodKey: 'year', courseSchedulingPlanningSharedLoaded: true };
      const data = { activities: [activity], instructors: [{ emp_id: '1507', full_name: 'מדריך לבדיקה', active: 'yes' }, { emp_id: '1508', full_name: 'מדריכה אחרת', active: 'no' }],
        _manualOperationsCapabilityChecked: true, _manualOperationsAvailable: true,
        scheduling: {}, meetingState: { loaded: true, approvedDates: new Map(), cancelledDates: new Map() } };
      window.acceptance = { calls: [], state, mode: 'clean' };
      supabase.rpc = async (name, args) => {
        window.acceptance.calls.push({ name, args });
        if (name === 'get_scheduling_manual_assignment_preview') return { data: { previewHash: 'synthetic-hash', blockers: [],
          warnings: window.acceptance.mode === 'warning' ? [{ code: 'manual_home_route_unknown' }] : [],
          reasonRequired: window.acceptance.mode === 'warning', instructorName: 'מדריך לבדיקה' } };
        if (name === 'commit_scheduling_manual_assignment') return { data: { ...activity, draft_emp_id: '1507', updated_at: '2026-11-26T10:01:00Z' } };
        return { data: [] };
      };
      const root = document.querySelector('#test-root');
      const render = () => { root.innerHTML = courseSchedulingScreen.render(data, { state }); courseSchedulingScreen.bind({ root, state, data, rerender: render }); };
      window.acceptance.render = render; render();
    });
    await page.locator('[data-open-manual-course]').first().click();
    const dialog = page.locator('.course-scheduling-manual-dialog');
    await dialog.waitFor();
    if (process.env.SCHEDULING_BROWSER_VISUAL_ONLY) {
      await page.screenshot({ path: '/tmp/manual-scheduling-' + viewport.width + '.png', fullPage: true });
      await page.close(); continue;
    }
    assert.equal(await dialog.locator('input[type=time], [data-manual-operation-date], [data-manual-operation-check], textarea').count(), 0);
    assert.equal(await dialog.locator('details').getAttribute('open'), null);
    assert.equal(await dialog.getAttribute('dir'), 'rtl');
    await dialog.locator('summary').click();
    assert.equal(await dialog.locator('details li').count(), 2);
    await dialog.locator('summary').click();
    await dialog.locator('[data-manual-instructor-search]').fill('אחרת');
    assert.equal(await dialog.locator('option[value="1507"]').evaluate(el => el.hidden), true);
    assert.equal(await dialog.locator('option[value="1508"]').evaluate(el => el.hidden), false);
    await dialog.locator('[data-manual-instructor-search]').fill('');
    await dialog.locator('[data-manual-operation-field=empId]').selectOption('1507');
    const box = await dialog.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
    const saveBox = await dialog.locator('[data-manual-operation-save]').boundingBox(); assert.ok(saveBox.y + saveBox.height <= viewport.height);
    await dialog.locator('[data-manual-operation-save]').click();
    await dialog.waitFor({ state: 'detached' });
    let calls = await page.evaluate(() => window.acceptance.calls);
    assert.deepEqual(calls.filter(c => /manual_assignment/.test(c.name)).map(c => c.name), ['get_scheduling_manual_assignment_preview', 'commit_scheduling_manual_assignment']);
    assert.ok(!calls.some(c => /optimization|candidates|planning_snapshot/.test(c.name)));
    cases += 7;
    // Repeat with an explicit warning: the first click must stop for consent.
    await page.evaluate(() => { window.acceptance.mode = 'warning'; window.acceptance.calls = []; window.acceptance.render(); });
    await page.locator('[data-open-manual-course]').first().click();
    await page.locator('[data-manual-operation-save]').click();
    await page.locator('[role=alertdialog]').waitFor();
    assert.equal(await page.locator('[data-manual-operation-save]').isDisabled(), true);
    calls = await page.evaluate(() => window.acceptance.calls); assert.ok(!calls.some(c => c.name === 'commit_scheduling_manual_assignment'));
    await page.locator('[data-manual-operation-field=reason]').fill('נבדק ואושר לבדיקה');
    await page.locator('[data-manual-operation-field=acknowledged]').check();
    await page.locator('[data-manual-operation-save]').click();
    await page.locator('.course-scheduling-manual-dialog').waitFor({ state: 'detached' });
    cases += 3;
    await page.close();
  }
  console.log(`Passed ${cases} browser assertions across desktop and mobile with synthetic data.`);
} finally { await browser.close(); await server.close(); }
