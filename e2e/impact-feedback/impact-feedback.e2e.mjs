/**
 * Impact feedback — local end-to-end flow (manual run only; not wired into CI).
 *
 * Requires a disposable stack: Postgres with tests/fixtures/impact-feedback-stub-schema.sql + the
 * impact feedback migrations + demo activities, PostgREST behind a Supabase-shaped /rest/v1 proxy,
 * and `vite` serving the repo with VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY pointing at that proxy.
 *
 *   E2E_APP_URL=http://127.0.0.1:5173 E2E_SUPABASE_URL=http://localhost:54321 \
 *   E2E_ADMIN_TOKEN=<jwt sub=admin> E2E_DATABASE_URL=postgres://... E2E_SHOTS=/tmp/shots \
 *   node e2e/impact-feedback/impact-feedback.e2e.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';
import pg from 'pg';
import * as XLSX from 'xlsx';

const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://localhost:54321';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN;
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const SHOTS = process.env.E2E_SHOTS || '/tmp/impact-feedback-shots';
const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });

const results = [];
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`✔ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`✘ ${name}\n   ${error.stack?.split('\n').slice(0, 3).join('\n   ')}`);
    throw error;
  }
}

function adminSession() {
  const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
  const session = {
    access_token: ADMIN_TOKEN,
    refresh_token: 'local-e2e',
    token_type: 'bearer',
    expires_in: 21600,
    expires_at: Math.floor(Date.now() / 1000) + 21600,
    user: { id: ADMIN_ID, aud: 'authenticated', role: 'authenticated', email: 'admin@example.test', app_metadata: {}, user_metadata: {} }
  };
  return { storageKey, session };
}

async function noHorizontalOverflow(page) {
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  assert.ok(scroll <= width + 1, `horizontal overflow: ${scroll} > ${width}`);
}

async function fillQuestionnaire(page, { rating = 4, text = '' } = {}) {
  const questions = page.locator('fieldset.ifb-q');
  const count = await questions.count();
  for (let i = 0; i < count; i += 1) {
    const q = questions.nth(i);
    if (await q.locator('.ifb-rate').count()) {
      await q.locator('.ifb-rate__opt').nth(rating - 1).click();
    } else if (await q.locator('.ifb-choices.is-yesno').count()) {
      await q.locator('.ifb-choice').first().click();
    } else if (await q.locator('.ifb-choices').count()) {
      await q.locator('.ifb-choice').first().click();
    } else if (text) {
      await q.locator('textarea').fill(text);
    }
  }
  return count;
}

async function count(sql, params = []) {
  return Number((await db.query(sql, params)).rows[0].n);
}

async function main() {
  assert.ok(ADMIN_TOKEN, 'E2E_ADMIN_TOKEN is required');
  await mkdir(SHOTS, { recursive: true });
  await db.connect();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { storageKey, session } = adminSession();

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'he-IL', acceptDownloads: true });
  await adminContext.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [storageKey, JSON.stringify(session)]);
  await adminContext.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const admin = await adminContext.newPage();
  const consoleErrors = [];
  admin.on('pageerror', (e) => consoleErrors.push(e.message));

  const student = () => browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' });
  const links = {};

  await step('Activity drawer shows an admin "משובים" button that opens the group feedback screen', async () => {
    await admin.goto(`${APP}/e2e/impact-feedback/harness.html?drawer=1`);
    const button = admin.locator('[data-impact-feedback-open]');
    await button.waitFor();
    assert.equal((await button.textContent()).trim(), '💬 משובים');
    await button.click();
    const nav = await admin.evaluate(() => window.__lastNavigate);
    assert.equal(nav.route, 'impact-feedback');
    await admin.locator('.ifb-group-head').waitFor();
    assert.match(await admin.locator('.ifb-group-head__title').textContent(), /בית ספר אלון/);
    assert.equal(await admin.locator('.ifb-slot').count(), 4);
  });

  await step('Dashboard: KPIs, table, filters and search (desktop)', async () => {
    await admin.goto(`${APP}/e2e/impact-feedback/harness.html`);
    await admin.locator('.ifb-table tbody tr').first().waitFor();
    assert.equal(await admin.locator('.ifb-kpi').count(), 6);
    const rows = await admin.locator('.ifb-table tbody tr').count();
    assert.equal(rows, 8, 'six recognised program groups + two unrecognised course groups');
    assert.equal(await admin.locator('.ifb-table [data-status="not_opened"]').count(), 24);
    assert.match(await admin.locator('tr[data-row="ACT-9"]').textContent(), /אופק – יזמות פרימיום לתעשייה/, 'Gefen 52279 is identified as Ofek automatically');
    assert.match(await admin.locator('tr[data-row="ACT-10"]').textContent(), /פורצות דרך/, 'Gefen 3604 is identified as Trailblazers automatically');
    assert.equal(await admin.locator('.ifb-unresolved .ifb-chip').count(), 2);
    assert.equal((await admin.locator('.ifb-unresolved .ifb-chip').first().textContent()).trim(), 'תוכנית לא זוהתה');
    await admin.locator('[data-f="search"]').fill('הגפן');
    await admin.waitForFunction(() => document.querySelectorAll('.ifb-table tbody tr').length === 1);
    await admin.locator('[data-ifb-clear="overview"]').click();
    await admin.locator('[data-f="program"]').selectOption('ofek');
    assert.equal(await admin.locator('.ifb-table tbody tr').count(), 2);
    await admin.locator('[data-ifb-clear="overview"]').click();
    await admin.locator('tr[data-row="ACT-10"] [data-ifb-open-group]').click();
    await admin.locator('[data-ifb-program-card]').waitFor();
    assert.match(await admin.locator('[data-ifb-program-card]').textContent(), /פורצות דרך · זוהתה לפי מספר גפ״ן/);
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('.ifb-table tbody tr').first().waitFor();
    await admin.locator('[data-ifb-clear="overview"]').click();
    await admin.screenshot({ path: `${SHOTS}/01-dashboard-desktop.png`, fullPage: true });
  });

  await step('Unrecognised program stays visible; admin maps it manually; mapping persists; master data untouched', async () => {
    const before = (await db.query("select to_jsonb(a) j from activities a where row_id in ('ACT-5','ACT-7') order by row_id")).rows;
    await admin.locator('[data-f="status"]').selectOption('unresolved');
    assert.equal(await admin.locator('.ifb-table tbody tr').count(), 2);
    const row = admin.locator('tr[data-row="ACT-7"]');
    assert.match(await row.textContent(), /קורס יזמות מיוחד/);
    await row.locator('select[name="program"]').selectOption('ofek');
    await row.locator('[data-ifb-set-program] [type="submit"]').click();
    await admin.waitForFunction(() => document.querySelectorAll('.ifb-table tbody tr').length === 1);
    await admin.locator('[data-f="status"]').selectOption('');
    await admin.waitForFunction(() => /אופק – יזמות פרימיום/.test(document.querySelector('tr[data-row="ACT-7"]')?.textContent || ''));
    assert.equal(await admin.locator('tr[data-row="ACT-7"] [data-status="not_opened"]').count(), 4);
    // ACT-5 via the group screen: mark as not relevant, then bring it back and choose a program.
    await admin.locator('tr[data-row="ACT-5"] [data-ifb-open-group]').click();
    await admin.locator('[data-ifb-program-card]').waitFor();
    assert.match(await admin.locator('[data-ifb-program-card]').textContent(), /תוכנית לא זוהתה/);
    assert.match(await admin.locator('[data-slot="student:pre"]').textContent(), /יש לבחור תוכנית/);
    admin.once('dialog', (d) => d.accept());
    await admin.locator('[data-ifb-program-exclude]').click();
    await admin.waitForFunction(() => /לא רלוונטית/.test(document.querySelector('[data-ifb-program-card]')?.textContent || ''));
    await admin.locator('[data-ifb-program-card] select[name="program"]').selectOption('space_tech');
    await admin.locator('[data-ifb-program-card] [type="submit"]').click();
    await admin.waitForFunction(() => /טכנולוגיות החלל/.test(document.querySelector('.ifb-kicker')?.textContent || ''));
    assert.match(await admin.locator('[data-ifb-program-card]').textContent(), /נבחרה ידנית/);
    await admin.goto(`${APP}/e2e/impact-feedback/harness.html`);
    await admin.locator('tr[data-row="ACT-7"]').waitFor();
    assert.match(await admin.locator('tr[data-row="ACT-7"]').textContent(), /אופק – יזמות פרימיום/, 'mapping persists after reload');
    const after = (await db.query("select to_jsonb(a) j from activities a where row_id in ('ACT-5','ACT-7') order by row_id")).rows;
    assert.deepEqual(after, before, 'activities master data unchanged');
    const mappings = (await db.query("select activity_row_id, program_key, excluded from feedback_program_mappings order by activity_row_id")).rows;
    assert.deepEqual(mappings, [{ activity_row_id: 'ACT-5', program_key: 'space_tech', excluded: false }, { activity_row_id: 'ACT-7', program_key: 'ofek', excluded: false }]);
    // Return both to "unrecognised" so the remaining scenarios run on the original data set.
    await db.query('delete from feedback_program_mappings');
    await admin.goto(`${APP}/e2e/impact-feedback/harness.html`);
    await admin.locator('.ifb-table tbody tr').first().waitFor();
  });

  await step('Admin opens student PRE feedback → QR + link', async () => {
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    const card = admin.locator('[data-slot="student:pre"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-qr]').waitFor();
    assert.match(await card.locator('.ifb-chip').first().textContent(), /פעיל/);
    await card.locator('[data-ifb-qr]').click();
    await admin.locator('.ifb-qr__code svg').waitFor();
    links.pre = (await admin.locator('.ifb-qr__url').textContent()).trim();
    assert.match(links.pre, /\/feedback\.html\?t=[A-Za-z0-9_-]{40,}$/);
    await admin.screenshot({ path: `${SHOTS}/02-qr-projection.png` });
    await admin.locator('[data-qr-copy]').click();
    const copied = await admin.evaluate(() => navigator.clipboard.readText());
    assert.equal(copied, links.pre);
    await admin.locator('[data-qr-close]').click();
  });

  await step('Student opens the link on a phone without login, fills and submits', async () => {
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.pre);
    await page.locator('.ifb-hero__title').waitFor();
    assert.equal(await page.locator('.ifb-hero__title').textContent(), 'פורצות דרך');
    assert.equal(await page.locator('.shell-sidebar, .shell-nav').count(), 0, 'no app shell on the public page');
    const n = await fillQuestionnaire(page, { rating: 2 });
    assert.equal(n, 10);
    assert.match(await page.locator('[data-progress-label]').textContent(), /10 מתוך 10/);
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOTS}/03-student-pre-mobile.png`, fullPage: true });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'תודה רבה ששיתפת אותנו 💙');
    await page.screenshot({ path: `${SHOTS}/04-thank-you-mobile.png` });
    await page.reload();
    await page.locator('.ifb-message__title').waitFor();
    assert.match(await page.locator('.ifb-message__title').textContent(), /תודה/, 'same device sees thanks, not a second empty form');
    await ctx.close();
    assert.equal(await count("select count(*) n from feedback_responses r join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-1' and c.stage='pre'"), 1);
  });

  await step('Required-answer validation and double-tap submit store exactly one response', async () => {
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.pre);
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-q.is-missing').first().waitFor();
    assert.match(await page.locator('[data-submit-error]').textContent(), /נשארו 10 שאלות/);
    await fillQuestionnaire(page, { rating: 3 });
    await page.locator('[data-submit]').dblclick();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
    for (let i = 0; i < 2; i += 1) {
      const c = await student();
      const p = await c.newPage();
      await p.goto(links.pre);
      await fillQuestionnaire(p, { rating: 3 });
      await p.locator('[data-submit]').click();
      await p.locator('.ifb-message__title').waitFor();
      await c.close();
    }
    assert.equal(await count("select count(*) n from feedback_responses r join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-1' and c.stage='pre'"), 4);
  });

  await step('Admin sees the response count; only-PRE shows an explicit note', async () => {
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    const card = admin.locator('[data-slot="student:pre"]');
    await admin.waitForFunction(() => /התקבלו 4 תשובות/.test(document.querySelector('[data-slot="student:pre"] .ifb-chip')?.textContent || ''));
    await admin.locator('.ifb-angle--students .ifb-note').first().waitFor();
    assert.match(await admin.locator('.ifb-angle--students').textContent(), /יש רק נתוני פתיחה/);
    assert.match(await card.textContent(), /4/);
  });

  await step('Student POST opens with a different QR and collects answers', async () => {
    const card = admin.locator('[data-slot="student:post"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-qr]').waitFor();
    await card.locator('[data-ifb-qr]').click();
    links.post = (await admin.locator('.ifb-qr__url').textContent()).trim();
    await admin.locator('[data-qr-close]').click();
    assert.notEqual(links.post, links.pre);
    for (let i = 0; i < 3; i += 1) {
      const ctx = await student();
      const page = await ctx.newPage();
      await page.goto(links.post);
      const n = await fillQuestionnaire(page, { rating: 5, text: i === 0 ? 'הכי אהבתי לבנות את אב הטיפוס' : '' });
      assert.equal(n, 19);
      if (i === 0) await page.screenshot({ path: `${SHOTS}/05-student-post-mobile.png`, fullPage: true });
      await page.locator('[data-submit]').click();
      await page.locator('.ifb-message__title').waitFor();
      await ctx.close();
    }
  });

  await step('PRE/POST appears in the group dashboard as group-vs-group averages', async () => {
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    const table = admin.locator('.ifb-angle--students table');
    await table.waitFor();
    const text = await table.textContent();
    assert.match(text, /ממוצע הקבוצה עלה מ-2\.8 ל-5\.0/);
    assert.doesNotMatch(await admin.locator('.ifb-angles').textContent(), /התלמיד הממוצע/);
    assert.match(await admin.locator('.ifb-angle--students').textContent(), /N פתיחה: 4 · N סיום: 3/);
  });

  await step('Personal instructor link: WhatsApp/mail/copy → instructor fills → locked', async () => {
    const card = admin.locator('[data-slot="instructor:final"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    const wa = card.locator('[data-ifb-share="whatsapp"]');
    await wa.waitFor();
    const href = await wa.getAttribute('href');
    assert.match(href, /^https:\/\/wa\.me\/972527654321\?text=/);
    const message = decodeURIComponent(href.split('text=')[1]);
    assert.match(message, /שלום דנה לוי/);
    links.instructor = message.match(/https?:\/\/\S+feedback\.html\?t=\S+/)[0];
    assert.match(await card.locator('[data-ifb-share="email"]').getAttribute('href'), /^mailto:dana@example\.test\?subject=/);
    await card.locator('[data-ifb-copy]').click();
    assert.equal(await admin.evaluate(() => navigator.clipboard.readText()), links.instructor);
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.instructor);
    assert.match(await page.locator('.ifb-hero__hello').textContent(), /שלום דנה לוי/);
    assert.equal(await page.locator('.ifb-rate__opt.is-emoji').count(), 0, 'instructor rating scale must not render smileys');
    const n = await fillQuestionnaire(page, { rating: 4, text: 'שלב הדגמים עבד מצוין' });
    assert.equal(n, 20);
    await page.screenshot({ path: `${SHOTS}/06-instructor-mobile.png`, fullPage: true });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await page.goto(links.instructor);
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'המשוב כבר מולא');
    await ctx.close();
  });

  await step('Personal educational-staff link → contact fills', async () => {
    const card = admin.locator('[data-slot="educational_staff:final"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-share="whatsapp"]').waitFor();
    const href = await card.locator('[data-ifb-share="whatsapp"]').getAttribute('href');
    assert.match(href, /wa\.me\/972501234567/);
    links.staff = decodeURIComponent(href.split('text=')[1]).match(/https?:\/\/\S+feedback\.html\?t=\S+/)[0];
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.staff);
    assert.equal(await page.locator('.ifb-rate__opt.is-emoji').count(), 0, 'educational staff rating scale must not render smileys');
    const firstScale = page.locator('.ifb-rate').first();
    assert.deepEqual(await firstScale.locator('.ifb-rate__face').allTextContents(), ['1', '2', '3', '4', '5']);
    await fillQuestionnaire(page, { rating: 3 });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
  });

  await step('Three perspectives are shown separately in the group screen', async () => {
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    await admin.locator('.ifb-angle--instructor .ifb-score').first().waitFor();
    assert.ok(await admin.locator('.ifb-angle--students .ifb-score').count() >= 5);
    assert.ok(await admin.locator('.ifb-angle--staff .ifb-score').count() >= 5);
    assert.ok(await admin.locator('.ifb-angle--instructor .ifb-score').count() >= 5);
    assert.match(await admin.locator('.ifb-angle--staff').textContent(), /באילו תחומים הבחינו בשינוי/);
    assert.match(await admin.locator('.ifb-angle--instructor').textContent(), /רמת העומס/);
    assert.match(await admin.locator('.ifb-section').last().textContent(), /שלב הדגמים עבד מצוין/);
    await admin.locator('.ifb-angle--students [data-ifb-drill="knowledge"]').click();
    await admin.locator('.ifb-drill').waitFor();
    assert.match(await admin.locator('.ifb-drill').textContent(), /השאלות שהרכיבו את המדד/);
    for (const slot of ['student:pre', 'student:post']) assert.match(await admin.locator(`[data-slot="${slot}"] .ifb-chip`).first().textContent(), /התקבלו/);
    for (const slot of ['instructor:final', 'educational_staff:final']) assert.equal((await admin.locator(`[data-slot="${slot}"] .ifb-chip`).first().textContent()).trim(), 'הושלם');
    await admin.screenshot({ path: `${SHOTS}/07-group-three-perspectives-desktop.png`, fullPage: true });
  });

  await step('Admin downloads Excel and CSV (raw + summary); students are anonymous', async () => {
    const [xlsxDownload] = await Promise.all([admin.waitForEvent('download'), admin.locator('[data-ifb-export="xlsx"]').first().click()]);
    const wb = XLSX.read(await readFile(await xlsxDownload.path()));
    assert.deepEqual(wb.SheetNames, ['Summary', 'Raw data']);
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['Raw data'], { header: 1 });
    const header = raw[0];
    const audienceCol = header.indexOf('קהל');
    const nameCol = header.indexOf('שם הממלא/ת');
    assert.ok(raw.slice(1).filter((r) => r[audienceCol] === 'תלמידים').every((r) => !r[nameCol]));
    assert.ok(raw.slice(1).some((r) => r[audienceCol] === 'מדריך' && r[nameCol] === 'דנה לוי'));
    assert.ok(raw.slice(1).some((r) => r[audienceCol] === 'צוות חינוכי' && r[nameCol] === 'רונית כהן'));
    const [rawCsv] = await Promise.all([admin.waitForEvent('download'), admin.locator('[data-ifb-export="raw"]').first().click()]);
    const csvText = await readFile(await rawCsv.path(), 'utf8');
    assert.ok(csvText.startsWith('﻿'));
    assert.ok(csvText.split('\r\n').length > 100);
    const [summaryCsv] = await Promise.all([admin.waitForEvent('download'), admin.locator('[data-ifb-export="summary"]').first().click()]);
    assert.match(await readFile(await summaryCsv.path(), 'utf8'), /ממוצע הקבוצה עלה/);
  });

  await step('Results dashboard: filters, PRE/POST, scores, drill-down; open answers tab', async () => {
    await admin.locator('[data-ifb-tab="results"]').click();
    await admin.locator('.ifb-angles').waitFor();
    assert.match(await admin.locator('.ifb-angle--students table').textContent(), /עלה מ-/);
    await admin.locator('[data-r="program"]').selectOption('biomimicry');
    await admin.locator('.ifb-empty').waitFor();
    await admin.locator('[data-r="program"]').selectOption('');
    await admin.locator('.ifb-angles').waitFor();
    await admin.screenshot({ path: `${SHOTS}/08-results-desktop.png`, fullPage: true });
    await admin.locator('[data-ifb-tab="answers"]').click();
    await admin.locator('.ifb-answer').first().waitFor();
    await admin.locator('[data-a="audience"]').selectOption('instructor');
    assert.ok((await admin.locator('.ifb-answer').count()) >= 1);
    assert.match(await admin.locator('.ifb-answers').textContent(), /דנה לוי/);
    await admin.locator('[data-a="audience"]').selectOption('student');
    assert.doesNotMatch(await admin.locator('.ifb-answers').textContent(), /דנה לוי|רונית/);
  });

  await step('Group without contact / without instructor shows a clear reason; zero responses state', async () => {
    await admin.locator('[data-ifb-tab="overview"]').click();
    await admin.locator('tr[data-row="ACT-2"] [data-ifb-open-group]').click();
    await admin.locator('.ifb-group-head').waitFor();
    assert.match(await admin.locator('[data-slot="educational_staff:final"]').textContent(), /לא מוגדר איש קשר/);
    assert.match(await admin.locator('[data-slot="instructor:final"]').textContent(), /לא משובץ מדריך/);
    assert.match(await admin.locator('.ifb-angle--students').textContent(), /טרם התקבלו תשובות/);
    const card = admin.locator('[data-slot="student:pre"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-qr]').click();
    links.young = (await admin.locator('.ifb-qr__url').textContent()).trim();
    await admin.locator('[data-qr-close]').click();
  });

  await step('Young age band (א׳–ג׳) renders smileys and stores 1–5', async () => {
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.young);
    await page.locator('.ifb-rate__opt.is-emoji').first().waitFor();
    assert.match(await page.locator('fieldset.ifb-q').first().textContent(), /אני יודע\/ת מה זה בינה מלאכותית/);
    await page.screenshot({ path: `${SHOTS}/09-young-emoji-mobile.png`, fullPage: true });
    await fillQuestionnaire(page, { rating: 5 });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
    const values = (await db.query("select distinct a.value_number::int v from feedback_answers a join feedback_responses r on r.id=a.response_id join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-2'")).rows.map((r) => r.v);
    assert.deepEqual(values, [5]);
  });

  await step('Only POST without PRE is labelled as such', async () => {
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-3"] [data-ifb-open-group]').click();
    const card = admin.locator('[data-slot="student:post"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-qr]').click();
    const link = (await admin.locator('.ifb-qr__url').textContent()).trim();
    await admin.locator('[data-qr-close]').click();
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(link);
    await fillQuestionnaire(page, { rating: 4 });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-3"] [data-ifb-open-group]').click();
    await admin.locator('.ifb-angle--students table').waitFor();
    assert.match(await admin.locator('.ifb-angle--students').textContent(), /יש רק נתוני סיום/);
  });

  await step('Closed campaign and expired token show a friendly page, not a technical error', async () => {
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    admin.once('dialog', (d) => d.accept());
    await admin.locator('[data-slot="student:post"] [data-ifb-close]').click();
    await admin.waitForFunction(() => /נסגר/.test(document.querySelector('[data-slot="student:post"] .ifb-chip')?.textContent || ''));
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.post);
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'המשוב נסגר');
    await page.screenshot({ path: `${SHOTS}/10-closed-mobile.png` });
    await db.query("update feedback_campaigns set opens_at = now() - interval '3 days', expires_at = now() - interval '1 hour' where activity_row_id='ACT-1' and stage='pre'");
    await page.goto(links.pre.replace(/t=/, 't=') + '&fresh=1');
    await page.evaluate(() => localStorage.clear());
    await page.goto(links.pre);
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'תוקף המשוב הסתיים');
    await page.goto(`${APP}/feedback.html?t=${'A'.repeat(43)}`);
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'הקישור אינו תקין');
    await page.goto(`${APP}/feedback.html`);
    await page.locator('.ifb-message__title').waitFor();
    assert.equal(await page.locator('.ifb-message__title').textContent(), 'הקישור אינו תקין');
    await ctx.close();
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    assert.match(await admin.locator('[data-slot="student:pre"] .ifb-chip').first().textContent(), /פג תוקף/);
    await admin.locator('[data-slot="student:pre"] details.ifb-extend summary').click();
    const nextWeek = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
    await admin.locator('[data-slot="student:pre"] [data-ifb-extend] input').fill(nextWeek);
    await admin.locator('[data-slot="student:pre"] [data-ifb-extend] button').click();
    await admin.waitForFunction(() => /התקבלו/.test(document.querySelector('[data-slot="student:pre"] .ifb-chip')?.textContent || ''));
  });

  await step('RLS/public access: anon cannot read tables or call admin RPCs', async () => {
    const anonKey = process.env.E2E_ANON_KEY;
    const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'content-type': 'application/json' };
    for (const table of ['feedback_campaigns', 'feedback_recipients', 'feedback_responses', 'feedback_answers', 'feedback_templates']) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { headers });
      assert.ok(res.status === 401 || res.status === 403, `${table} must be closed to anon (got ${res.status})`);
    }
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/feedback_admin_groups`, { method: 'POST', headers, body: '{}' });
    assert.ok(rpc.status === 401 || rpc.status === 403 || rpc.status === 404, `admin RPC must be closed to anon (got ${rpc.status})`);
    const facts = await fetch(`${SUPABASE_URL}/rest/v1/rpc/feedback_admin_answer_facts`, { method: 'POST', headers, body: '{}' });
    assert.ok(facts.status >= 400);
  });

  await step('Templates: edit wording in a draft, preview, publish v2; existing campaign stays on v1', async () => {
    await admin.locator('[data-ifb-tab="templates"]').click();
    await admin.locator('.ifb-program-card').first().waitFor();
    assert.equal(await admin.locator('.ifb-program-card').count(), 8);
    assert.equal(await admin.locator('.ifb-tile').count(), 32);
    const tile = admin.locator('.ifb-program-card', { hasText: 'פורצות דרך' }).locator('.ifb-tile', { hasText: 'תלמידים – פתיחה' });
    await tile.click();
    await admin.locator('.ifb-tq.is-readonly').first().waitFor();
    await admin.locator('[data-tpl-edit]').click();
    const first = admin.locator('[data-tq]').first();
    await first.waitFor();
    await first.locator('[data-tq-field="wording.default"]').fill('אני מבין/ה היטב מה לומדים בתחום {topic}');
    await first.locator('[data-tq-field="wording.default"]').blur();
    await admin.waitForTimeout(400);
    await admin.locator('[data-tq]').nth(1).locator('[data-tpl-move="-1"]').click();
    await admin.waitForTimeout(400);
    await admin.locator('[data-tpl-add-new] [name="text"]').fill('אני יודעת לבנות אב־טיפוס ראשוני לרעיון שלי');
    await admin.locator('[data-tpl-add-new] [type="submit"]').click();
    await admin.waitForFunction(() => document.querySelectorAll('[data-tq]').length === 11);
    await admin.locator('[data-tpl-preview]').click();
    await admin.locator('.ifb-preview .ifb-q').first().waitFor();
    assert.equal(await admin.locator('.ifb-preview .ifb-q').count(), 11);
    await admin.screenshot({ path: `${SHOTS}/11-template-preview.png` });
    await admin.locator('[data-preview-close]').click();
    admin.once('dialog', (d) => d.accept());
    await admin.locator('[data-tpl-publish]').click();
    await admin.locator('[data-tpl-edit]').waitFor();
    assert.match(await admin.locator('.ifb-group-head').textContent(), /גרסה מפורסמת: 2/);
    const versions = (await db.query("select v.version_no, v.status from feedback_template_versions v join feedback_templates t on t.id=v.template_id where t.program_key='trailblazers' and t.audience='student' and t.stage='pre' order by 1")).rows;
    assert.deepEqual(versions, [{ version_no: 1, status: 'archived' }, { version_no: 2, status: 'published' }]);
    await admin.screenshot({ path: `${SHOTS}/12-templates-desktop.png`, fullPage: true });

    await admin.locator('[data-ifb-tab="overview"]').click();
    await admin.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    assert.match(await admin.locator('[data-slot="student:pre"]').textContent(), /v1\s*גרסה קודמת/);
    const ctx = await student();
    const page = await ctx.newPage();
    await page.goto(links.pre);
    await page.locator('fieldset.ifb-q').first().waitFor();
    assert.equal(await page.locator('fieldset.ifb-q').count(), 10, 'collected questionnaire is unchanged (v1)');
    assert.doesNotMatch(await page.locator('.ifb-form').textContent(), /אב־טיפוס ראשוני לרעיון שלי/);
    await ctx.close();
  });

  await step('Mobile admin layout (390px) has no horizontal overflow; RTL is set', async () => {
    const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' });
    await ctx.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [storageKey, JSON.stringify(session)]);
    const page = await ctx.newPage();
    await page.goto(`${APP}/e2e/impact-feedback/harness.html`);
    await page.locator('.ifb-table tbody tr').first().waitFor();
    await noHorizontalOverflow(page);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ifb-admin')).direction), 'rtl');
    await page.screenshot({ path: `${SHOTS}/13-dashboard-mobile.png`, fullPage: true });
    await page.locator('tr[data-row="ACT-1"] [data-ifb-open-group]').click();
    await page.locator('.ifb-slot').first().waitFor();
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOTS}/14-group-mobile.png`, fullPage: true });
    await ctx.close();
  });

  assert.deepEqual(consoleErrors, [], `admin page errors: ${consoleErrors.join(' | ')}`);
  await browser.close();
  await db.end();
}

main()
  .then(() => {
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} E2E scenarios passed`);
  })
  .catch(async (error) => {
    console.error(`\nE2E failed: ${error.message}`);
    await db.end().catch(() => {});
    process.exit(1);
  });
