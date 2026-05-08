import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('global accent picker persists both current and legacy keys', () => {
  const src = read('frontend/src/main.js');
  assert.match(src, /const ACCENT_LS_KEY = 'ds_global_accent'/);
  assert.match(src, /const LEGACY_STRIPE_LS_KEY = 'ds_activities_stripe'/);
  assert.match(src, /localStorage\.setItem\(ACCENT_LS_KEY, selected\)/);
  assert.match(src, /localStorage\.setItem\(LEGACY_STRIPE_LS_KEY, selected\)/);
  assert.match(src, /normalizeAccentName\(localStorage\.getItem\(LEGACY_STRIPE_LS_KEY\)\)/);
});

test('global accent variables drive key buttons, summaries, nav and activity tables', () => {
  const css = read('frontend/src/styles/main.css');
  assert.match(css, /\.ds-btn--primary \{[\s\S]*var\(--ds-accent\)[\s\S]*\}/);
  assert.match(css, /\.shell-nav__btn\.is-active \{[\s\S]*var\(--ds-accent\)[\s\S]*\}/);
  assert.match(css, /\.ds-summary-btn\.is-active \{[\s\S]*var\(--ds-accent-soft\)[\s\S]*var\(--ds-accent\)[\s\S]*\}/);
  assert.match(css, /\.ds-activities-screen \.ds-table tbody tr:nth-child\(even\) td \{[\s\S]*var\(--ds-activities-stripe/);
  assert.match(css, /\.ds-activities-screen \.ds-table th \{[\s\S]*var\(--ds-accent-soft\)/);
});


test('accent picker records current accent on the button and root dataset', () => {
  const src = read('frontend/src/main.js');
  assert.match(src, /root\.dataset\.dsAccent = selected/);
  assert.match(src, /btn\.style\.backgroundColor = colors\.accent/);
  assert.match(src, /btn\.dataset\.currentAccent = selected/);
});


test('accent picker keeps all settings accent keys in sync locally and remotely', () => {
  const src = read('frontend/src/main.js');
  assert.match(src, /ui_accent_color: selected/);
  assert.match(src, /saveRoutesToStorage\(state\.routes, state\.route, state\.clientSettings\)/);
  assert.match(src, /\['accent_color', 'theme_accent', 'ui_accent_color'\]/);
  assert.match(src, /api\.saveClientSetting\(\{ key, value: selected \}\)/);
});

test('bootstrap accent fallback reads and returns all supported settings keys', () => {
  const main = read('frontend/src/main.js');
  const api = read('frontend/src/api.js');
  assert.match(main, /normalizeAccentName\(state\?\.clientSettings\?\.ui_accent_color\)/);
  assert.match(api, /settingValue\('accent_color'\) \|\| settingValue\('theme_accent'\) \|\| settingValue\('ui_accent_color'\)/);
  assert.match(api, /accent_color: accentColor, theme_accent: accentColor, ui_accent_color: accentColor/);
});
