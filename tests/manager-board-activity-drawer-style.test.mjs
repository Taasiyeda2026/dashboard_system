import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const interactionsSrc = fs.readFileSync(
  new URL('../frontend/src/manager-board-interactions-runtime.js', import.meta.url),
  'utf8'
);
const indexSrc = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('manager board loads the shared activityDrawer feature before rendering activity details', () => {
  assert.ok(interactionsSrc.includes("import { ensureFeature } from './feature-loaders.js';"));
  assert.ok(interactionsSrc.includes("await ensureFeature('activityDrawer');"));

  const featureLoad = interactionsSrc.indexOf("await ensureFeature('activityDrawer');");
  const detailRender = interactionsSrc.indexOf('content: activityWorkDrawerHtml(row');
  assert.ok(featureLoad >= 0 && detailRender > featureLoad);
});

test('manager activity detail opens asynchronously so feature loading completes first', () => {
  assert.ok(interactionsSrc.includes('async function openActivityDetailDrawer(row)'));
  assert.ok(interactionsSrc.includes('if (row) void openActivityDetailDrawer(row);'));
});

test('manager interaction runtime asset URL is cache-busted for the drawer-style fix', () => {
  assert.ok(indexSrc.includes('manager-board-interactions-runtime.js?v=20260819-activity-drawer-style-fix-v1'));
});
