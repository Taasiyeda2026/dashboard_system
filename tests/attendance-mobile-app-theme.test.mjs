import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const theme = await readFile(new URL('../attendance/src/styles/mobile-app-theme.css', import.meta.url), 'utf8');
const desktopTheme = await readFile(new URL('../attendance/src/styles/desktop-app-theme.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../attendance/src/app.js', import.meta.url), 'utf8');
const summaryRow = await readFile(new URL('../attendance/src/components/report-summary-row.js', import.meta.url), 'utf8');
const mobileEnhancer = await readFile(new URL('../attendance/src/mobile-reports-enhancer.js', import.meta.url), 'utf8');

test('Attendance mobile app theme is loaded after legacy overrides and scoped to mobile', () => {
  assert.match(theme, /@media \(max-width: 767px\)/);
  assert.match(theme, /env\(safe-area-inset-top/);
  assert.match(theme, /env\(safe-area-inset-bottom/);
  assert.match(theme, /radial-gradient/);
  assert.match(theme, /\.av2-bottom-nav/);
  assert.match(theme, /\.av2-report-row\[data-tone='course'\]/);
  assert.match(theme, /\.av2-report-summary-row\[data-tone='workshop'\]/);

  const followupIndex = index.indexOf('attendance-followup.css?v=67');
  const themeIndex = index.indexOf('mobile-app-theme.css?v=67');
  assert.notEqual(themeIndex, -1, 'mobile theme stylesheet is missing from attendance/index.html');
  assert.ok(themeIndex > followupIndex, 'mobile app theme must load after legacy attendance overrides');
});

test('Attendance desktop uses the same approved app language without leaking into mobile', () => {
  assert.match(desktopTheme, /@media \(min-width: 768px\)/);
  assert.match(desktopTheme, /radial-gradient/);
  assert.match(desktopTheme, /\.av2-stat-card/);
  assert.match(desktopTheme, /\.av2-cal/);
  assert.match(desktopTheme, /\.av2-report-list/);
  assert.match(desktopTheme, /\.av2-form-section/);
  const mobileIndex = index.indexOf('mobile-app-theme.css?v=67');
  const desktopIndex = index.indexOf('desktop-app-theme.css?v=67');
  assert.notEqual(desktopIndex, -1, 'desktop app theme stylesheet is missing from attendance/index.html');
  assert.ok(desktopIndex > mobileIndex, 'desktop companion theme should load after the mobile theme');
});

test('Attendance mobile navigation exposes all real app destinations and tracks new-report', () => {
  assert.match(theme, /\.av2-bottom-nav__item--desktop-only\s*\{[\s\S]*display:\s*flex/);
  assert.match(app, /const navActive = state\.screen;/);
});

test('Attendance report cards use semantic, deterministic mobile colour tones', () => {
  for (const tone of ['course', 'workshop', 'online', 'operations']) {
    assert.match(summaryRow, new RegExp(`return '${tone}'`));
    assert.match(mobileEnhancer, new RegExp(`return '${tone}'`));
  }
  assert.match(summaryRow, /wrapper\.dataset\.tone = mobileToneForActivityType/);
  assert.match(mobileEnhancer, /row\.dataset\.tone = mobileToneForActivityType/);
});
