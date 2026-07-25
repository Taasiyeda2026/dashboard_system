import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dashboardEnhancer = readFileSync(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../frontend/src/summer-feedback-admin-integration.js', import.meta.url), 'utf8');
const personalReports = readFileSync(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
const feedbackHtml = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const embeddedCss = readFileSync(new URL('../frontend/public/summer-feedback/embedded-admin.css', import.meta.url), 'utf8');
const embeddedJs = readFileSync(new URL('../frontend/public/summer-feedback/embedded-admin.js', import.meta.url), 'utf8');

test('dashboard loads the admin-only summer feedback integration without restoring the instructor button', () => {
  assert.ok(dashboardEnhancer.includes("import './summer-feedback-admin-integration.js';"));
  assert.equal(integration.includes('instr-my-data-actions'), false);
  assert.equal(integration.includes('data-summer-feedback-link'), false);
  assert.ok(integration.includes("document.querySelectorAll('#pr-root .pr-screen-mode-switch')"));
  assert.ok(integration.includes("button.textContent = 'משוב קיץ'"));
});

test('summer feedback tab is restricted to an authenticated active admin', () => {
  assert.ok(integration.includes('waitForSupabaseAuthSession'));
  assert.ok(integration.includes(".from('users')"));
  assert.ok(integration.includes(".select('role,is_active')"));
  assert.ok(integration.includes("normalizeRole(data?.role) === 'admin'"));
  assert.ok(integration.includes('data?.is_active !== false'));
});

test('personal reports keeps its existing tabs and adds the full summer feedback management interface inside it', () => {
  assert.ok(personalReports.includes('הדוחות שלי'));
  assert.ok(personalReports.includes('ניהול דוחות עובדים'));
  assert.ok(personalReports.includes('משובים'));
  assert.ok(integration.includes('pr-screen--summer-feedback-admin'));
  assert.ok(integration.includes('title="ניהול משוב הקיץ"'));
  assert.ok(integration.includes('./summer-feedback/?view=admin&embedded=1'));
  assert.ok(integration.includes('sourceTabList.cloneNode(true)'));
  assert.ok(integration.includes('button.dataset.prAction'));
  assert.ok(integration.includes('lock-screen'));
});

test('embedded management mode removes the duplicate standalone header and follows the dashboard height', () => {
  assert.ok(feedbackHtml.includes('href="./embedded-admin.css"'));
  assert.ok(feedbackHtml.includes('src="./embedded-admin.js"'));
  assert.ok(embeddedCss.includes('html.summer-feedback-embedded .shell > header'));
  assert.ok(embeddedCss.includes('display: none !important'));
  assert.ok(embeddedCss.includes('html.summer-feedback-embedded .container'));
  assert.ok(embeddedCss.includes('width: 100%'));
  assert.ok(embeddedJs.includes("params.get('embedded') === '1'"));
  assert.ok(embeddedJs.includes('summer-feedback:embedded-height'));
  assert.ok(integration.includes('Math.min(Math.max(Math.ceil(requested), 720), 5600)'));
});
