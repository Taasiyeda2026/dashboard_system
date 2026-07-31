import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssUrl = new URL('../frontend/src/styles/activity-drawer-floating-actions.css', import.meta.url);
const entryUrl = new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url);

test('activity edit action is a true overlay above the scrollable drawer body', async () => {
  const css = await readFile(cssUrl, 'utf8');

  assert.match(css, /activity-drawer-inline-layout\s*>\s*\.activity-drawer__view-footer[\s\S]*position:\s*absolute\s*!important/);
  assert.match(css, /activity-drawer-inline-layout\s*>\s*\.activity-drawer__view-footer[\s\S]*inset-block-end:\s*16px\s*!important/);
  assert.match(css, /activity-drawer-inline-layout\s*>\s*\.activity-drawer-inline__body[\s\S]*padding-block-end:\s*96px\s*!important/);
  assert.match(css, /data-activity-actions-docked\]\[hidden\][\s\S]*display:\s*none\s*!important/);
});

test('floating overlay assets use a new cache version', async () => {
  const entry = await readFile(entryUrl, 'utf8');
  assert.match(entry, /activity-drawer-floating-actions\.css\?v=20260731-floating-overlay-v2/);
  assert.match(entry, /activity-drawer-floating-actions\.js\?v=20260731-floating-overlay-v2/);
});
