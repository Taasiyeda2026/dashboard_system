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
