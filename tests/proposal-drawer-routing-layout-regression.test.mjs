import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN_ROUTING_FILE = new URL('../frontend/src/proposal-domain-routing.js', import.meta.url);
const ACTIVITY_LINKING_FILE = new URL('../frontend/src/proposal-activity-linking.js', import.meta.url);
const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);

test('domain E routing owns separate DOM and state markers from activity creation', async () => {
  const [domainRouting, activityLinking] = await Promise.all([
    readFile(DOMAIN_ROUTING_FILE, 'utf8'),
    readFile(ACTIVITY_LINKING_FILE, 'utf8')
  ]);

  assert.match(domainRouting, /data-proposal-domain-routing-card/);
  assert.doesNotMatch(domainRouting, /data-proposal-activity-creator/);
  assert.doesNotMatch(domainRouting, /data-proposal-activity-loaded/);

  assert.match(activityLinking, /data-proposal-activity-creator/);
  assert.match(activityLinking, /data-proposal-activity-loaded/);
});

test('Israa routing card participates in normal proposal drawer flow', async () => {
  const domainRouting = await readFile(DOMAIN_ROUTING_FILE, 'utf8');

  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*position:\s*static\s*!important;/);
  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*width:\s*100%;/);
  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*box-sizing:\s*border-box;/);
  assert.match(domainRouting, /root\.querySelector\('\.ds-pa-activities-wide'\)/);
});

test('proposal drawer owner styles load after legacy proposal enhancers', async () => {
  const featureLoaders = await readFile(FEATURE_LOADERS_FILE, 'utf8');
  const start = featureLoaders.indexOf("case 'proposals':");
  const end = featureLoaders.indexOf("case 'annualReviews':", start);
  assert.ok(start >= 0 && end > start, 'proposal feature loader block must exist');

  const proposalsBlock = featureLoaders.slice(start, end);
  const legacyLayout = proposalsBlock.indexOf('proposal-gefen-approval-list-status.js');
  const publicCleanup = proposalsBlock.indexOf('proposal-details-public-cleanup.js');
  const ownerStyle = proposalsBlock.indexOf('proposal-drawer-activity-style.js?v=20260913-v2');

  assert.match(proposalsBlock, /loadOnce\('proposals',\s*async\s*\(\)\s*=>/);
  assert.match(proposalsBlock, /await\s+Promise\.all\(/);
  assert.ok(legacyLayout >= 0, 'legacy GEFEN enhancer must still load');
  assert.ok(publicCleanup >= 0, 'public cleanup must still load');
  assert.ok(ownerStyle > publicCleanup, 'drawer owner stylesheet must load only after legacy enhancers finish');
  assert.equal((proposalsBlock.match(/proposal-drawer-activity-style\.js/g) || []).length, 1);
});
