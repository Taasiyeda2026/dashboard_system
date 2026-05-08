import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('global accent picker persists both current and legacy keys', () => {
  const src = read('frontend/src/accent-picker.js');
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
  const src = read('frontend/src/accent-picker.js');
  assert.match(src, /root\.dataset\.dsAccent = selected/);
  assert.match(src, /btn\.style\.backgroundColor = colors\.accent/);
  assert.match(src, /btn\.dataset\.currentAccent = selected/);
});


test('accent picker keeps all settings accent keys in sync locally and remotely', () => {
  const src = read('frontend/src/accent-picker.js');
  assert.match(src, /ui_accent_color: selected/);
  assert.match(src, /saveRoutes\(nextSettings\)/);
  assert.match(src, /\['accent_color', 'theme_accent', 'ui_accent_color'\]/);
  assert.match(src, /saveClientSetting\(\{ key, value: selected \}\)/);
});

test('bootstrap accent fallback reads and returns all supported settings keys', () => {
  const accentPicker = read('frontend/src/accent-picker.js');
  const api = read('frontend/src/api.js');
  assert.match(accentPicker, /normalizeAccentName\(clientSettings\?\.ui_accent_color\)/);
  assert.match(api, /settingValue\('accent_color'\) \|\| settingValue\('theme_accent'\) \|\| settingValue\('ui_accent_color'\)/);
  assert.match(api, /accent_color: accentColor, theme_accent: accentColor, ui_accent_color: accentColor/);
});

async function importAccentPickerWithDom() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://dashboard.test/'
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.HTMLElement = dom.window.HTMLElement;
  return {
    ...(await import(`../frontend/src/accent-picker.js?accentPickerDomTest=${Date.now()}`)),
    dom
  };
}

test('accent picker click handler applies selected swatch to live DOM variables', async () => {
  const { bindAccentPickerOnce, applyGlobalAccent, dom } = await importAccentPickerWithDom();

  document.body.innerHTML = `
    <div id="app"></div>
    <div data-accent-picker-wrap>
      <button type="button" data-accent-picker-btn></button>
      <div data-accent-picker-popover hidden>
        <button type="button" data-accent-swatch data-accent="blue"></button>
        <button type="button" data-accent-swatch data-accent="green"></button>
        <button type="button" data-accent-swatch data-accent="purple"></button>
        <button type="button" data-accent-swatch data-accent="orange"></button>
        <button type="button" data-accent-swatch data-accent="gray"></button>
        <button type="button" data-accent-swatch data-accent="pink"></button>
        <button type="button" data-accent-swatch data-accent="cyan"></button>
      </div>
    </div>
  `;

  applyGlobalAccent('blue');
  bindAccentPickerOnce();
  document.querySelector('[data-accent="green"]').click();

  assert.equal(document.documentElement.style.getPropertyValue('--ds-accent'), '#166534');
  assert.equal(document.documentElement.style.getPropertyValue('--ds-accent-hover'), '#14532d');
  assert.equal(document.documentElement.style.getPropertyValue('--ds-accent-soft'), '#eaf5ec');
  assert.equal(document.documentElement.style.getPropertyValue('--ds-activities-stripe'), '#eaf5ec');
  assert.equal(document.documentElement.dataset.dsAccent, 'green');

  dom.window.close();
  for (const key of ['window', 'document', 'localStorage', 'HTMLElement']) {
    Reflect.deleteProperty(globalThis, key);
  }
});
