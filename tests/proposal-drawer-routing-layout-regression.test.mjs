import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DOMAIN_ROUTING_FILE = new URL('../frontend/src/proposal-domain-routing.js', import.meta.url);
const ACTIVITY_LINKING_FILE = new URL('../frontend/src/proposal-activity-linking.js', import.meta.url);
const FEATURE_LOADERS_FILE = new URL('../frontend/src/feature-loaders.js', import.meta.url);
const FEATURE_ROUTE_LOADER_FILE = new URL('../frontend/src/feature-route-loader.js', import.meta.url);
const GEFEN_STATUS_FILE = new URL('../frontend/src/proposal-gefen-approval-list-status.js', import.meta.url);
const DRAWER_STYLE_FILE = new URL('../frontend/src/proposal-drawer-activity-style.js', import.meta.url);
const PROPOSALS_SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

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

test('Israa routing card participates in normal proposal drawer flow via dedicated host', async () => {
  const domainRouting = await readFile(DOMAIN_ROUTING_FILE, 'utf8');

  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*position:\s*static\s*!important;/);
  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*width:\s*100%;/);
  assert.match(domainRouting, /\.proposal-israa-routing\s*\{[\s\S]*box-sizing:\s*border-box;/);
  assert.match(domainRouting, /querySelector\('\[data-proposal-domain-routing-host\]'\)/);
  assert.match(domainRouting, /replaceChildren\(card\)/);
  assert.doesNotMatch(domainRouting, /insertAdjacentElement\(/);
  assert.doesNotMatch(domainRouting, /afterend/);
  assert.doesNotMatch(domainRouting, /data-proposal-activity-creator-host/);
});

test('activity creator mounts into its own host without afterend or domain-host reuse', async () => {
  const [activityLinking, domainRouting, proposalsScreen] = await Promise.all([
    readFile(ACTIVITY_LINKING_FILE, 'utf8'),
    readFile(DOMAIN_ROUTING_FILE, 'utf8'),
    readFile(PROPOSALS_SCREEN_FILE, 'utf8')
  ]);

  assert.match(activityLinking, /querySelector\('\[data-proposal-activity-creator-host\]'\)/);
  assert.match(activityLinking, /replaceChildren\(card\)/);
  assert.doesNotMatch(activityLinking, /insertAdjacentElement\(/);
  assert.doesNotMatch(activityLinking, /afterend/);
  assert.doesNotMatch(activityLinking, /data-proposal-domain-routing-host/);
  assert.match(domainRouting, /replaceChildren\(card\)/);

  assert.match(
    proposalsScreen,
    /ds-pa-activities-wide[\s\S]*\$\{itemsHost\}<div data-proposal-activity-creator-host><\/div>\$\{financialCard\}/
  );
  assert.match(
    proposalsScreen,
    /<\/section>\s*<div data-proposal-domain-routing-host><\/div>/
  );
});

test('only proposal-drawer-activity-style owns proposal detail shell geometry', async () => {
  const [drawerStyle, gefenStatus] = await Promise.all([
    readFile(DRAWER_STYLE_FILE, 'utf8'),
    readFile(GEFEN_STATUS_FILE, 'utf8')
  ]);

  assert.match(drawerStyle, /\[data-pa-proposal-detail\][\s\S]*position:\s*fixed\s*!important/);
  assert.match(drawerStyle, /\[data-pa-proposal-detail\][\s\S]*justify-content:\s*flex-start\s*!important/);
  assert.match(drawerStyle, /\[data-pa-proposal-detail\]\.ds-pa-proposal-detail[\s\S]*?width:\s*100%\s*!important/);
  assert.match(drawerStyle, /\[data-pa-proposal-detail\]\.ds-pa-proposal-detail[\s\S]*?max-width:\s*none\s*!important/);
  assert.match(drawerStyle, /\[data-pa-proposal-detail\][\s\S]*width:\s*min\(820px, 55vw\)\s*!important/);
  assert.match(drawerStyle, /\.ds-pa-drawer-body[\s\S]*display:\s*flex\s*!important/);
  assert.match(drawerStyle, /\.ds-pa-drawer-body[\s\S]*flex-direction:\s*column\s*!important/);
  assert.match(drawerStyle, /\.ds-pa-drawer-body[\s\S]*gap:\s*10px\s*!important/);
  assert.match(drawerStyle, /\.ds-pa-drawer-body[\s\S]*overflow-y:\s*auto\s*!important/);
  assert.match(
    drawerStyle,
    /\[data-proposal-activity-creator-host\]:empty[\s\S]*\[data-proposal-domain-routing-host\]:empty[\s\S]*display:\s*none\s*!important/
  );

  assert.doesNotMatch(
    gefenStatus,
    /#app\s+\[data-pa-proposal-detail\][^{]*\{[^}]*\bposition\s*:/
  );
  assert.doesNotMatch(
    gefenStatus,
    /#app\s+\[data-pa-proposal-detail\][^{]*\{[^}]*\bjustify-content\s*:/
  );
  assert.doesNotMatch(
    gefenStatus,
    /#app\s+\[data-pa-proposal-detail\][^{]*\{[^}]*\b(?:max-)?(?:width|height)\s*:/
  );
  assert.doesNotMatch(
    gefenStatus,
    /#app\s+\[data-pa-proposal-detail\][^{]*\{[^}]*\boverflow(?:-y)?\s*:/
  );
  // Gefen keeps table + inline eye helpers, not drawer shell ownership.
  assert.match(gefenStatus, /\.ds-pa-gefen-inline-view/);
  assert.match(gefenStatus, /\.ds-pa-table th\.ds-pa-actions-col/);
});

test('drawer owner is available before proposal detail opens without loading the full proposals bundle early', async () => {
  const [featureLoaders, routeLoader, proposalsScreen] = await Promise.all([
    readFile(FEATURE_LOADERS_FILE, 'utf8'),
    readFile(FEATURE_ROUTE_LOADER_FILE, 'utf8'),
    readFile(PROPOSALS_SCREEN_FILE, 'utf8')
  ]);

  assert.match(featureLoaders, /case 'proposalDrawerShell':/);
  assert.match(
    featureLoaders,
    /case 'proposalDrawerShell':[\s\S]*?import\('\.\/proposal-drawer-activity-style\.js\?v=20260913-v4'\)/
  );

  const proposalsStart = featureLoaders.indexOf("case 'proposals':");
  const proposalsEnd = featureLoaders.indexOf("case 'annualReviews':", proposalsStart);
  assert.ok(proposalsStart >= 0 && proposalsEnd > proposalsStart, 'proposal feature loader block must exist');
  const proposalsBlock = featureLoaders.slice(proposalsStart, proposalsEnd);

  assert.match(proposalsBlock, /loadOnce\('proposals',\s*async\s*\(\)\s*=>/);
  assert.match(proposalsBlock, /await\s+Promise\.all\(/);
  assert.match(proposalsBlock, /return ensureFeature\('proposalDrawerShell'\)/);
  assert.ok(proposalsBlock.indexOf('proposal-gefen-approval-list-status.js') >= 0);
  assert.ok(proposalsBlock.indexOf('proposal-details-public-cleanup.js') >= 0);
  assert.equal(
    (proposalsBlock.match(/proposal-drawer-activity-style\.js/g) || []).length,
    0,
    'full proposals bundle must reuse proposalDrawerShell instead of importing the style directly'
  );
  assert.equal(
    (featureLoaders.match(/proposal-drawer-activity-style\.js/g) || []).length,
    1,
    'drawer owner module must be imported exactly once'
  );

  assert.match(routeLoader, /DEFERRED_FEATURE_ROUTES/);
  assert.match(routeLoader, /ensureFeature\('proposalDrawerShell'\)/);
  assert.match(
    routeLoader,
    /ensureFeature\('proposalDrawerShell'\)[\s\S]*requestIdleCallback[\s\S]*loadRouteFeatures|ensureFeature\('proposalDrawerShell'\)[\s\S]*loadRouteFeatures/
  );

  assert.match(proposalsScreen, /await ensureFeature\('proposalDrawerShell'\)/);
  assert.match(proposalsScreen, /const renderProposalDetailWorkspace = async \(row\) => \{/);
});
