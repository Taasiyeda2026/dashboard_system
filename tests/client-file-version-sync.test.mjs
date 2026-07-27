import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SW_FILE = new URL('../frontend/sw.js', import.meta.url);
const CONFIG_FILE = new URL('../frontend/src/config.js', import.meta.url);
const INDEX_FILE = new URL('../index.html', import.meta.url);
const DASHBOARD_CSS_FILE = new URL('../frontend/src/styles/dashboard-layout.css', import.meta.url);

test('service worker and client-file hotfix versions are current and structurally valid', async () => {
  const [sw, config] = await Promise.all([
    readFile(SW_FILE, 'utf8'),
    readFile(CONFIG_FILE, 'utf8')
  ]);

  const cacheVersion = Number(sw.match(/const CACHE_VERSION = (\d+);/)?.[1] || 0);
  assert.ok(Number.isInteger(cacheVersion) && cacheVersion >= 1247, 'CACHE_VERSION must remain at the current generation or newer');

  const hotfixVersion = config.match(/HOTFIX_VERSION:\s*'([^']+)'/)?.[1] || '';
  assert.ok(hotfixVersion.trim(), 'HOTFIX_VERSION must be defined');
  assert.match(
    hotfixVersion,
    /(?:proposal-pdf-(?:svg-origin-clean|storage-key)|client-contact-secure-rpc)/,
    'HOTFIX_VERSION must describe a supported current client hotfix generation'
  );

  const installBlock = sw.match(/self\.addEventListener\('install',[\s\S]*?\n\}\);/)?.[0] || '';
  assert.doesNotMatch(installBlock, /deleteOutdatedCaches\(/);
  assert.match(sw, /self\.addEventListener\('activate'[\s\S]*deleteOutdatedCaches\(/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /isApiLikeUrl/);
});

test('dashboard layout stylesheet is loaded and keeps the intended responsive structure', async () => {
  const [indexHtml, dashboardCss] = await Promise.all([
    readFile(INDEX_FILE, 'utf8'),
    readFile(DASHBOARD_CSS_FILE, 'utf8')
  ]);

  const sharedStylesheetIndex = indexHtml.indexOf('./frontend/src/styles/main.css');
  const dashboardStylesheetIndex = indexHtml.indexOf('./frontend/src/styles/dashboard-layout.css');

  assert.ok(sharedStylesheetIndex >= 0, 'main.css must remain linked');
  assert.ok(dashboardStylesheetIndex > sharedStylesheetIndex, 'dashboard layout must load after main.css');
  assert.match(dashboardCss, /#app \.ds-dashboard-wrap\s*\{[\s\S]*max-width:\s*1180px;[\s\S]*zoom:\s*1;/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid--row2\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-manager-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /@media \(max-width: 720px\)[\s\S]*\.ds-manager-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});
