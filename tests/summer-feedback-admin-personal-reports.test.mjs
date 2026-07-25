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
  assert.match(dashboardEnhancer, /import '\.\/summer-feedback-admin-integration\.js'/);
  assert.doesNotMatch(integration, /instr-my-data-actions|data-summer-feedback-link/);
  assert.match(integration, /#pr-root \.pr-screen-mode-switch/);
  assert.match(integration, /textContent = 'משוב קיץ'/);
});

test('summer feedback tab is restricted to an authenticated active admin', () => {
  assert.match(integration, /waitForSupabaseAuthSession/);
  assert.match(integration, /from\('users'\)/);
  assert.match(integration, /select\('role,is_active'\)/);
  assert.match(integration, /normalizeRole\(data\?\.role\) === 'admin'/);
  assert.match(integration, /data\?\.is_active !== false/);
});

test('personal reports keeps its existing tabs and adds the full summer feedback management interface inside it', () => {
  assert.match(personalReports, />הדוחות שלי<\/button>/);
  assert.match(personalReports, />ניהול דוחות עובדים<\/button>/);
  assert.match(personalReports, />משובים<\/button>/);
  assert.match(integration, /pr-screen--summer-feedback-admin/);
  assert.match(integration, /title="ניהול משוב הקיץ"/);
  assert.match(integration, /\.\/summer-feedback\/\?view=admin&embedded=1/);
  assert.match(integration, /screen-mode-my-reports/);
  assert.match(integration, /lock-screen/);
});

test('embedded management mode removes the duplicate standalone header and follows the dashboard height', () => {
  assert.match(feedbackHtml, /href="\.\/embedded-admin\.css"/);
  assert.match(feedbackHtml, /src="\.\/embedded-admin\.js"/);
  assert.match(embeddedCss, /\.summer-feedback-embedded \.shell > header[\s\S]*display: none !important/);
  assert.match(embeddedCss, /\.summer-feedback-embedded \.container[\s\S]*width: 100%/);
  assert.match(embeddedJs, /params\.get\('embedded'\) === '1'/);
  assert.match(embeddedJs, /summer-feedback:embedded-height/);
  assert.match(integration, /Math\.min\(Math\.max\(Math\.ceil\(requested\), 720\), 5600\)/);
});
