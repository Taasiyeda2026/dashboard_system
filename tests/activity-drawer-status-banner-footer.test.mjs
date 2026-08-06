import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssUrl = new URL('../frontend/src/styles/activity-drawer-floating-actions.css', import.meta.url);
const featureLoaderUrl = new URL('../frontend/src/feature-loaders.js', import.meta.url);

test('activity form fills remaining drawer height below status banners', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /> \.ds-drawer__content\s*\{[\s\S]*display:\s*flex\s*!important/);
  assert.match(css, /\.activity-drawer-inline-layout\s*\{[\s\S]*flex:\s*1 1 auto\s*!important/);
  assert.match(css, /\.activity-drawer-inline-layout\s*\{[\s\S]*block-size:\s*auto\s*!important/);
  assert.doesNotMatch(css, /\.activity-drawer-inline-layout\s*\{[\s\S]*block-size:\s*100%\s*!important/);
});

test('floating footer assets use the latest cache-busting version', async () => {
  const source = await readFile(featureLoaderUrl, 'utf8');
  assert.match(source, /import\('\.\/styles\/activity-drawer-floating-actions\.css'\)/);
  assert.match(source, /activity-drawer-floating-actions\.js\?v=20260731-floating-overlay-v3/);
});
