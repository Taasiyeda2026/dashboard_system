import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const featureLoaders = await readFile(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
const routeLoader = await readFile(new URL('../frontend/src/feature-route-loader.js', import.meta.url), 'utf8');

test('proposal hover/focus preload warms only the screen module, not the heavy proposal feature bundle', () => {
  const match = featureLoaders.match(/case 'proposals-agreements':[\s\S]*?case 'operations-management':/);
  assert.ok(match, 'proposal preload case must exist');
  assert.match(match[0], /import\('\.\/screens\/proposals-agreements\.js'\)/);
  assert.doesNotMatch(match[0], /ensureFeature\('proposals'\)/);
});

test('proposal route features wait for first screen paint and browser idle time', () => {
  assert.match(routeLoader, /DEFERRED_FEATURE_ROUTES = new Set\(\['proposals-agreements'\]\)/);
  assert.match(routeLoader, /screenHasFirstPaint\(\)/);
  assert.match(routeLoader, /requestIdleCallback/);
  assert.match(routeLoader, /DEFERRED_FEATURE_MAX_WAIT_MS/);
  assert.match(routeLoader, /scheduleRouteFeatures\(route\)/);
});

test('non-proposal routes keep immediate feature loading behavior', () => {
  assert.match(routeLoader, /if \(!DEFERRED_FEATURE_ROUTES\.has\(key\)\) \{[\s\S]*?loadRouteFeatures\(key\);[\s\S]*?return;/);
});
