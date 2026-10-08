/**
 * Impact feedback — local end-to-end flow for the five-tab module (manual run only; not wired into CI).
 *
 * Disposable stack (see e2e/impact-feedback/README.md):
 *   1. Postgres with the demo data:   E2E_DATABASE_URL=... E2E_ALLOW_RESET=1 node e2e/impact-feedback/seed-demo.mjs
 *   2. PostgREST on that database (roles anon / authenticated / authenticator from the seed)
 *   3. node e2e/impact-feedback/rest-proxy.mjs     (Supabase-shaped /rest/v1 on :54321)
 *   4. vite with VITE_SUPABASE_URL=http://localhost:54321 and VITE_SUPABASE_ANON_KEY=<anon JWT>
 *
 *   E2E_APP_URL=http://127.0.0.1:5173 E2E_SUPABASE_URL=http://localhost:54321 \
 *   E2E_ADMIN_TOKEN=<jwt sub=admin> E2E_ANON_TOKEN=<jwt role=anon> E2E_MANAGER_TOKEN=<jwt sub=non-admin> \
 *   E2E_DATABASE_URL=postgres://... CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e/impact-feedback/impact-feedback.e2e.mjs
 */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';
import pg from 'pg';
import * as XLSX from 'xlsx';

const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:5173';
const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'http://localhost:54321';
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN;
const ANON_TOKEN = process.env.E2E_ANON_TOKEN;
const MANAGER_TOKEN = process.env.E2E_MANAGER_TOKEN;
const ADMIN_ID = '11111111-1111-1111-1111-111111111111';
const SHOTS = process.env.E2E_SHOTS || '/tmp/impact-feedback-shots';
const HARNESS = `${APP}/e2e/impact-feedback/harness.html`;
const TABS = ['overview', 'students', 'instructors', 'staff', 'analysis'];
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
    console.log(`✘ ${name}\n   ${error.stack?.split('\n').slice(0, 4).join('\n   ')}`);
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

async function count(sql, params = []) {
  return Number((await db.query(sql, params)).rows[0].n);
}

async function kpi(page, label) {
  const item = page.locator('.ifb-kpi', { has: page.locator('.ifb-kpi__label', { hasText: label }) });
  return (await item.locator('.ifb-kpi__value').textContent()).trim();
}

async function openTab(page, tab) {
  await page.locator(`[data-ifb-tab="${tab}"]`).click();
  await page.waitForFunction((key) => document.querySelector(`[data-ifb-tab="${key}"]`)?.getAttribute('aria-selected') === 'true'
    && !document.querySelector('#ifb-panel .ds-spinner'), tab);
}

async function selectCourse(page, key) {
  await page.locator('[data-ifb-course]').selectOption(key);
  await page.waitForFunction((value) => document.querySelector('[data-ifb-course]')?.value === value, key);
}

/** The module itself never scrolls horizontally; tables become cards on phones. */
async function assertNoModuleOverflow(page, label) {
  const report = await page.evaluate(() => {
    const host = document.querySelector('[data-ifb-admin]');
    const vw = window.innerWidth;
    const offenders = [...host.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      if (el.closest('.ifb-table-wrap--scroll')) return false;
      return r.right > vw + 1 || r.left < -1;
    }).slice(0, 5).map((el) => `${el.tagName}.${el.className}`);
    return { scroll: host.scrollWidth, client: host.clientWidth, offenders };
  });
  assert.ok(report.scroll <= report.client + 1, `${label}: module scrollWidth ${report.scroll} > ${report.client}`);
  assert.deepEqual(report.offenders, [], `${label}: elements outside the viewport`);
}

async function fillQuestionnaire(page, { rating = 4, text = '', naFirst = false } = {}) {
  const questions = page.locator('fieldset.ifb-q');
  const total = await questions.count();
  let naUsed = false;
  for (let i = 0; i < total; i += 1) {
    const q = questions.nth(i);
    if (naFirst && !naUsed && await q.locator('.ifb-rate__na').count()) {
      await q.locator('.ifb-rate__na input').check();
      naUsed = true;
    } else if (await q.locator('.ifb-rate').count()) {
      await q.locator('.ifb-rate__opt').nth(rating - 1).click();
    } else if (await q.locator('.ifb-choice').count()) {
      await q.locator('.ifb-choice').first().click();
    } else if (text) {
      await q.locator('textarea').fill(text);
    }
  }
  return { total, naUsed };
}

async function rpcAs(token, fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.text() };
}

async function main() {
  assert.ok(ADMIN_TOKEN, 'E2E_ADMIN_TOKEN is required');
  await mkdir(SHOTS, { recursive: true });
  await db.connect();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  const { storageKey, session } = adminSession();
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'he-IL', acceptDownloads: true });
  await adminContext.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [storageKey, JSON.stringify(session)]);
  const admin = await adminContext.newPage();
  const pageErrors = [];
  admin.on('pageerror', (e) => pageErrors.push(e.message));
  const phone = () => browser.newContext({ ...devices['iPhone 13'], locale: 'he-IL' });
  const baseline = {
    responses: await count('select count(*) n from feedback_responses'),
    answers: await count('select count(*) n from feedback_answers'),
    publishedVersions: (await db.query("select id from feedback_template_versions where status <> 'draft' order by id")).rows.map((r) => r.id)
  };

  await step('All five tabs open, in order, as an accessible tablist with keyboard navigation', async () => {
    await admin.goto(HARNESS);
    await admin.locator('.ifb-kpis').waitFor();
    assert.deepEqual((await admin.locator('[role="tab"]').allTextContents()).map((x) => x.trim()),
      ['סקירה כללית', 'תלמידים', 'מדריכים', 'צוות חינוכי', 'ניתוח והשוואה']);
    assert.equal(await admin.locator('[role="tabpanel"]').getAttribute('aria-labelledby'), 'ifb-tab-overview');
    for (const tab of TABS) {
      await openTab(admin, tab);
      assert.equal(await admin.locator('#ifb-panel .ifb-empty--error').count(), 0, `${tab} renders without an error state`);
      assert.equal(await admin.locator('[role="tabpanel"]').getAttribute('aria-labelledby'), `ifb-tab-${tab}`);
    }
    await openTab(admin, 'overview');
    await admin.locator('[data-ifb-tab="overview"]').focus();
    await admin.keyboard.press('ArrowLeft');
    await admin.waitForFunction(() => document.activeElement?.dataset?.ifbTab === 'students');
    await admin.keyboard.press('End');
    await admin.waitForFunction(() => document.activeElement?.dataset?.ifbTab === 'analysis');
    await admin.keyboard.press('Home');
    await admin.waitForFunction(() => document.activeElement?.dataset?.ifbTab === 'overview' && !document.querySelector('#ifb-panel .ds-spinner'));
    assert.equal(await admin.locator('[data-ifb-tab="overview"]').getAttribute('tabindex'), '0');
    assert.equal(await admin.locator('[data-ifb-tab="students"]').getAttribute('tabindex'), '-1', 'roving tabindex');
  });

  await step('Overview counts questionnaires once, identifies people only where reliable, never invents data', async () => {
    const totalResponses = await count('select count(*) n from feedback_responses');
    assert.equal(await kpi(admin, 'שאלונים שהוגשו'), String(totalResponses));
    assert.equal(await kpi(admin, 'קורסים פעילים במעקב'), String(await count('select count(distinct program_key) n from feedback_campaigns')));
    const identified = await count(`select (select count(distinct instructor_emp_id) from feedback_recipients rc join feedback_responses r on r.recipient_id = rc.id where rc.recipient_type='instructor')
      + (select count(distinct contact_id) from feedback_recipients rc join feedback_responses r on r.recipient_id = rc.id where rc.recipient_type='educational_staff') n`);
    assert.equal(await kpi(admin, 'משיבים ייחודיים מזוהים'), String(identified), 'instructor answering PRE + FINAL counts once');
    const trail = admin.locator('tr[data-course-row="trailblazers"]');
    assert.match(await trail.locator('td[data-label="תלמידים – פתיחה"]').textContent(), /^\s*6\s*$/);
    assert.match(await trail.locator('td[data-label="מדריכים – פתיחה"]').textContent(), /1\/1/);
    assert.match(await trail.locator('td[data-label="צוות חינוכי"]').textContent(), /1\/2\s*\(50%\)/);
    assert.match(await trail.locator('td[data-label="היענות תלמידים"]').textContent(), /פתיחה: 13%/, '6 questionnaires / 45 registered participants');
    assert.match(await admin.locator('tr[data-course-row="pharma"] td[data-label="היענות תלמידים"]').textContent(), /אין נתון/, 'no participants count → no response rate');
    assert.match(await trail.locator('td[data-label="תלמידים פתיחה→סיום"]').textContent(), /2\.7\s*→\s*4\.3\s*\+1\.6/, 'pooled over every answer, not a mean of group means (3.0 → 4.5)');
    assert.match(await admin.locator('[data-ifb-idle-courses]').textContent(), /ביומימיקרי \(יסודי · 6089\)/);
    await admin.locator('[data-o="audience"]').selectOption('instructor');
    await admin.waitForFunction(() => /שאלונים לפי קהל יעד/.test(document.body.textContent));
    assert.equal(await kpi(admin, 'שאלונים שהוגשו'), String(await count("select count(*) n from feedback_responses r join feedback_campaigns c on c.id=r.campaign_id where c.audience='instructor'")));
    await admin.locator('[data-o="phase"]').selectOption('pre');
    assert.equal(await kpi(admin, 'שאלונים שהוגשו'), '1');
    assert.equal(await kpi(admin, 'משיבים ייחודיים מזוהים'), '—', 'unique people are not split across phases');
    await admin.locator('[data-o="audience"]').selectOption('');
    await admin.locator('[data-o="phase"]').selectOption('');
    await admin.screenshot({ path: `${SHOTS}/01-overview-desktop.png`, fullPage: true });
  });

  await step('The selected course is shared by every tab', async () => {
    await selectCourse(admin, 'trailblazers');
    await openTab(admin, 'students');
    const programs = (await admin.locator('.ifb-groups-table tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.row))).sort();
    assert.deepEqual(programs, ['ACT-1', 'ACT-2', 'ACT-8', 'ACT-9'], 'trailblazers groups + unresolved groups awaiting a course');
    assert.deepEqual((await admin.locator('.ifb-tpl-table tbody td[data-label="קורס"]').allTextContents()).map((x) => x.trim()), ['פורצות דרך', 'פורצות דרך']);
    await openTab(admin, 'instructors');
    assert.equal(await admin.locator('[data-ifb-course]').inputValue(), 'trailblazers');
    assert.deepEqual((await admin.locator('.ifb-instructor-table td[data-label="קורס"]').allTextContents()).map((x) => x.trim()), ['פורצות דרך']);
    await openTab(admin, 'staff');
    assert.equal(await admin.locator('.ifb-tpl-table tbody tr').count(), 1);
    await openTab(admin, 'analysis');
    assert.match(await admin.locator('.ifb-section h2').first().textContent(), /סיכום מצטבר – פורצות דרך/);
    await openTab(admin, 'overview');
    assert.deepEqual(await admin.locator('tr[data-course-row]').evaluateAll((rows) => rows.map((r) => r.dataset.courseRow)), ['trailblazers']);
  });

  await step('Students: PRE/POST per identical question, averages over all valid answers', async () => {
    await openTab(admin, 'students');
    const table = admin.locator('.ifb-prepost-table');
    await table.waitFor();
    const rows = await table.locator('tbody tr').count();
    const shared = await count(`select count(*) n from (
      select tq.question_id from feedback_template_questions tq join feedback_templates t on t.current_version_id = tq.version_id
      where t.program_key='trailblazers' and t.audience='student' and t.stage='pre' and tq.question_type='rating_1_5'
      intersect
      select tq.question_id from feedback_template_questions tq join feedback_templates t on t.current_version_id = tq.version_id
      where t.program_key='trailblazers' and t.audience='student' and t.stage='post' and tq.question_type='rating_1_5') x`);
    assert.equal(rows, shared, 'only questions asked in both stages');
    const first = await table.locator('tbody tr').first().textContent();
    assert.match(first, /2\.7\s*N=6/);
    assert.match(first, /4\.3\s*N=4/);
    assert.match(first, /\+1\.6/);
    assert.match(await admin.locator('#ifb-panel').textContent(), /ממוצעי אוכלוסיות המשיבים/, 'no claim of individual change');
    assert.match(await admin.locator('.ifb-inline-stats').first().textContent(), /פתיחה: 6 שאלונים/);
    await admin.screenshot({ path: `${SHOTS}/02-students-desktop.png`, fullPage: true });
  });

  await step('Instructors: readiness and final results; no PRE/FINAL claim without identical questions', async () => {
    await openTab(admin, 'instructors');
    await admin.locator('.ifb-q-table').first().waitFor();
    assert.match(await admin.locator('#ifb-panel').textContent(), /אינם כוללים שאלות זהות/);
    assert.match(await admin.locator('.ifb-instructor-table tbody tr').first().textContent(), /דנה לוי/);
    assert.match(await admin.locator('.ifb-answers').textContent(), /דנה לוי/, 'instructor feedback stays attributed to the instructor');
  });

  await step('Educational staff: per-question results and open comments', async () => {
    await openTab(admin, 'staff');
    await admin.locator('.ifb-q-table').waitFor();
    assert.match(await admin.locator('.ifb-inline-stats').first().textContent(), /סיום: 1 מתוך 2 \(50%\)/);
    assert.match(await admin.locator('#ifb-panel').textContent(), /התלמידות היו מעורבות מאוד/);
  });

  await step('Analysis: cumulative summary, separate populations, cross-course core comparison', async () => {
    await openTab(admin, 'analysis');
    const summary = admin.locator('.ifb-section').first();
    assert.match(await summary.textContent(), /לא ניתן לזיהוי \(אנונימי\)/, 'students are never given a unique-respondent count');
    const audienceRow = admin.locator('.ifb-section', { hasText: 'השוואה בין תלמידים' }).locator('tbody tr').first();
    assert.match(await audienceRow.textContent(), /N=4/);
    assert.doesNotMatch(await admin.locator('.ifb-section', { hasText: 'השוואה בין תלמידים' }).textContent(), /ממוצע משולב/);
    const cross = admin.locator('.ifb-cross-table');
    await cross.waitFor();
    const headers = (await cross.locator('thead th').allTextContents()).map((x) => x.trim());
    assert.deepEqual(headers.slice(1).sort(), ['פורצות דרך', 'רוקחים עולם'].sort(), 'only courses with data, each separately');
    assert.doesNotMatch(await cross.textContent(), /יזמות וטכנולוגיה/, 'topic-specific wording is neutralised in the shared core row');
    await admin.screenshot({ path: `${SHOTS}/03-analysis-desktop.png`, fullPage: true });
  });

  await step('Summary report exports per course with collection, per-question results and anonymous students', async () => {
    const [download] = await Promise.all([admin.waitForEvent('download'), admin.locator('[data-ifb-export="xlsx"]').first().click()]);
    const wb = XLSX.read(await readFile(await download.path()));
    assert.deepEqual(wb.SheetNames, ['איסוף והיענות', 'תוצאות לפי שאלה', 'פתיחה-סיום', 'השוואת אוכלוסיות', 'השוואת קורסים (ליבה)', 'תשובות פתוחות', 'נתונים גולמיים']);
    const collection = XLSX.utils.sheet_to_json(wb.Sheets['איסוף והיענות'], { header: 1 });
    const studentPre = collection.find((r) => r[1] === 'תלמידים' && r[2] === 'פתיחה');
    assert.deepEqual([studentPre[4], studentPre[9]], [6, 'אנונימי']);
    const questions = XLSX.utils.sheet_to_json(wb.Sheets['תוצאות לפי שאלה'], { header: 1 }).slice(1);
    assert.ok(questions.length > 0 && questions.every((r) => r[0] === 'פורצות דרך'), 'only the selected course');
    const raw = XLSX.utils.sheet_to_json(wb.Sheets['נתונים גולמיים'], { header: 1 }).slice(1);
    assert.ok(raw.filter((r) => r[2] === 'תלמידים').every((r) => !r[13]), 'students are never named');
  });

  await step('Look-alike course names never mix (Biomimicry 6089/53828, escape room, AI courses)', async () => {
    await openTab(admin, 'students');
    const labels = (await admin.locator('[data-ifb-course] option').allTextContents()).map((x) => x.trim());
    assert.ok(labels.includes('ביומימיקרי (יסודי · 6089)') && labels.includes('ביומימיקרי (חטיבה · 53828)'));
    assert.ok(labels.includes('יישומי AI') && labels.includes('סודות ויסודות AI'));
    await selectCourse(admin, 'biomimicry');
    const elementary = await admin.locator('.ifb-groups-table tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.row));
    assert.ok(elementary.includes('ACT-4') && !elementary.includes('ACT-5'));
    assert.match(await admin.locator('tr[data-row="ACT-9"]').textContent(), /קורס לא זוהה/, 'escape-room product is not counted as the course');
    await selectCourse(admin, 'biomimicry_secondary');
    const secondary = await admin.locator('.ifb-groups-table tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.row));
    assert.ok(secondary.includes('ACT-5') && !secondary.includes('ACT-4'));
    await selectCourse(admin, 'ai_applications');
    assert.ok((await admin.locator('.ifb-groups-table tbody tr').evaluateAll((rows) => rows.map((r) => r.dataset.row))).includes('ACT-6'));
    assert.equal(await admin.locator('tr[data-row="ACT-7"]').count(), 0);
  });

  await step('Draft → edit → N/A option → preview → publish v2; published v1 and its campaign stay intact', async () => {
    await selectCourse(admin, 'pharma');
    await openTab(admin, 'students');
    const v1 = (await db.query("select t.id, t.current_version_id from feedback_templates t where program_key='pharma' and audience='student' and stage='pre'")).rows[0];
    await admin.locator(`[data-tpl-open="${v1.id}"]`).click();
    await admin.locator('[data-tpl-edit]').click();
    const firstRating = admin.locator('[data-tq]').filter({ has: admin.locator('[data-tq-field="allow_na"]') }).first();
    await firstRating.waitFor();
    await firstRating.locator('[data-tq-field="allow_na"]').check();
    await admin.waitForTimeout(400);
    await admin.locator('[data-tpl-preview]').click();
    await admin.locator('.ifb-preview .ifb-rate__na').first().waitFor();
    await admin.locator('[data-preview-close]').click();
    admin.once('dialog', (d) => d.accept());
    await admin.locator('[data-tpl-publish]').click();
    await admin.waitForFunction(() => /גרסה מפורסמת: 2/.test(document.querySelector('.ifb-tpl-head')?.textContent || ''));
    const versions = (await db.query('select version_no, status from feedback_template_versions where template_id=$1 order by version_no', [v1.id])).rows;
    assert.deepEqual(versions, [{ version_no: 1, status: 'archived' }, { version_no: 2, status: 'published' }]);
    const naCount = await count("select count(*) n from feedback_template_questions tq join feedback_templates t on t.current_version_id=tq.version_id where t.id=$1 and tq.scoring->>'allow_na'='true'", [v1.id]);
    assert.equal(naCount, 1);
    assert.equal(await count("select count(*) n from feedback_template_questions where version_id=$1 and scoring ? 'allow_na'", [v1.current_version_id]), 0, 'v1 unchanged');
    await admin.locator('[data-tpl-back]').click();
    await admin.locator('.ifb-tpl-table').waitFor();
  });

  await step('Opened campaign uses v2; respondent answers "לא רלוונטי" on a phone; it is excluded from the mean', async () => {
    await admin.locator('tr[data-row="ACT-3"] [data-ifb-open-group]').click();
    const card = admin.locator('[data-slot="student:pre"]');
    await card.locator('[data-ifb-show-open]').click();
    await card.locator('form [type="submit"]').click();
    await card.locator('[data-ifb-qr]').waitFor();
    const token = (await db.query("select public_token t from feedback_campaigns where activity_row_id='ACT-3' and stage='pre'")).rows[0].t;
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${APP}/feedback.html?t=${token}`);
    await page.locator('.ifb-form').waitFor();
    const { naUsed } = await fillQuestionnaire(page, { rating: 4, naFirst: true });
    assert.ok(naUsed);
    await page.screenshot({ path: `${SHOTS}/04-public-na-mobile.png`, fullPage: true });
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
    assert.equal(await count("select count(*) n from feedback_answers a join feedback_responses r on r.id=a.response_id join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-3' and c.stage='pre' and a.value_options @> '{na}' and a.value_number is null"), 1);
    await admin.locator('[data-ifb-back]').click();
    await admin.locator('[data-ifb-refresh]').click();
    await admin.locator('.ifb-q-table').first().waitFor();
    await admin.locator('details.ifb-disclosure', { hasText: 'תוצאות שאלון הפתיחה' }).locator('summary').click();
    assert.match(await admin.locator('#ifb-panel').textContent(), /1 „לא רלוונטי”/);
  });

  await step('Existing public links keep working; historical responses and published versions are preserved', async () => {
    const token = (await db.query("select public_token t from feedback_campaigns where activity_row_id='ACT-1' and stage='pre'")).rows[0].t;
    const before = await count("select count(*) n from feedback_responses r join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-1' and c.stage='pre'");
    const ctx = await phone();
    const page = await ctx.newPage();
    await page.goto(`${APP}/feedback.html?t=${token}`);
    const { total } = await fillQuestionnaire(page, { rating: 3 });
    assert.ok(total > 0);
    assert.equal(await page.locator('.ifb-rate__na').count(), 0, 'v1 questionnaire unchanged (no N/A option)');
    await page.locator('[data-submit]').click();
    await page.locator('.ifb-message__title').waitFor();
    await ctx.close();
    assert.equal(await count("select count(*) n from feedback_responses r join feedback_campaigns c on c.id=r.campaign_id where c.activity_row_id='ACT-1' and c.stage='pre'"), before + 1);
    assert.equal(await count('select count(*) n from feedback_responses'), baseline.responses + 2, 'only the two new questionnaires were added');
    const published = (await db.query("select id from feedback_template_versions where status <> 'draft' order by id")).rows.map((r) => r.id);
    assert.ok(baseline.publishedVersions.every((id) => published.includes(id)), 'no published/archived version was removed');
  });

  await step('Permissions: anon and non-admin users cannot read admin aggregates', async () => {
    if (ANON_TOKEN) {
      const anon = await rpcAs(ANON_TOKEN, 'feedback_admin_course_summary', { p_academic_year: 'school_2027' });
      assert.ok(anon.status === 401 || anon.status === 403 || anon.status === 404, `anon got ${anon.status}`);
    }
    if (MANAGER_TOKEN) {
      const manager = await rpcAs(MANAGER_TOKEN, 'feedback_admin_course_summary', { p_academic_year: 'school_2027' });
      assert.match(manager.body, /feedback_forbidden/);
      const facts = await rpcAs(MANAGER_TOKEN, 'feedback_admin_answer_facts', { p_filters: {} });
      assert.match(facts.body, /feedback_forbidden/);
    }
    const page = await adminContext.newPage();
    await page.goto(`${HARNESS}`);
    await page.evaluate(async () => {
      const { state } = await import('/frontend/src/state.js');
      const { impactFeedbackScreen } = await import('/frontend/src/screens/impact-feedback.js');
      state.user = { role: 'operation_manager' };
      const root = document.getElementById('screenRoot');
      root.innerHTML = impactFeedbackScreen.render();
      impactFeedbackScreen.bind({ root, state });
    });
    assert.match(await page.locator('[data-ifb-admin]').textContent(), /לאדמין בלבד/);
    await page.close();
  });

  await step('Mobile (390px): every tab, same information, all tabs visible, no horizontal overflow', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'he-IL', isMobile: true, hasTouch: true });
    await ctx.addInitScript(([key, value]) => { localStorage.setItem(key, value); }, [storageKey, JSON.stringify(session)]);
    const page = await ctx.newPage();
    await page.goto(HARNESS);
    await page.locator('.ifb-kpis').waitFor();
    assert.equal(await page.locator('[data-ifb-admin]').getAttribute('dir'), 'rtl');
    for (const tab of TABS) {
      const box = await page.locator(`[data-ifb-tab="${tab}"]`).boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= 390, `tab ${tab} visible without scrolling`);
    }
    await selectCourse(page, 'trailblazers');
    for (const tab of TABS) {
      await openTab(page, tab);
      await page.waitForTimeout(150);
      await assertNoModuleOverflow(page, tab);
      await page.screenshot({ path: `${SHOTS}/05-mobile-${tab}.png`, fullPage: true });
    }
    await openTab(page, 'students');
    assert.ok(await page.locator('.ifb-prepost-table tbody tr').count() > 0, 'PRE/POST table on mobile');
    assert.ok(await page.locator('[data-ifb-export]').count() > 0, 'report export on mobile');
    assert.ok(await page.locator('[data-tpl-open]').count() > 0, 'questionnaire editing on mobile');
    await ctx.close();
    for (const tab of TABS) {
      await openTab(admin, tab);
      await assertNoModuleOverflow(admin, `desktop ${tab}`);
    }
  });

  assert.deepEqual(pageErrors, [], 'no uncaught page errors');
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} steps passed`);
  await browser.close();
  await db.end();
}

main().catch(async (error) => {
  console.error(error.message);
  await db.end().catch(() => {});
  process.exit(1);
});
