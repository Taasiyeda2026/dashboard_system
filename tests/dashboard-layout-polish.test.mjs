import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dashboardCss = fs.readFileSync(new URL('../frontend/src/styles/dashboard-layout.css', import.meta.url), 'utf8');

test('dashboard polish stylesheet is loaded after the shared stylesheet', () => {
  const sharedIndex = indexHtml.indexOf('./frontend/src/styles/main.css');
  const dashboardIndex = indexHtml.indexOf('./frontend/src/styles/dashboard-layout.css');

  assert.ok(sharedIndex >= 0, 'shared stylesheet must remain linked');
  assert.ok(dashboardIndex > sharedIndex, 'dashboard stylesheet must load after main.css');
});

test('desktop dashboard uses true 75 percent internal zoom without scaling the shell', () => {
  assert.match(dashboardCss, /#app \.screen-root:has\(\.ds-dashboard-wrap\)\s*\{[\s\S]*zoom:\s*1;/);
  assert.match(dashboardCss, /#app \.ds-dashboard-wrap\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*1180px;[\s\S]*zoom:\s*0\.75;/);
  assert.doesNotMatch(dashboardCss, /#app \.ds-dashboard-wrap\s*\{[\s\S]*width:\s*125%;/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-dashboard-kpi-grid--row2\s*\{[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-manager-grid\s*\{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*none;[\s\S]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(dashboardCss, /\.ds-manager-card--district\s*\{[\s\S]*grid-column:\s*auto\s*!important;/);
  assert.doesNotMatch(dashboardCss, /pointer-events:\s*none[^}]*\.ds-(?:interactive-card|manager-stat)/);
});

test('dashboard layout remains responsive on tablets and phones', () => {
  assert.match(dashboardCss, /@media \(max-width: 1050px\)/);
  assert.match(dashboardCss, /@media \(max-width: 720px\)/);
  assert.match(dashboardCss, /@media \(max-width: 430px\)/);
  assert.match(dashboardCss, /@media \(max-width: 720px\)[\s\S]*\.ds-manager-grid\s*\{[\s\S]*grid-template-columns:\s*1fr;/);
});
