import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const proposalsSource = readFileSync(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const featureLoaderSource = readFileSync(new URL('../frontend/src/feature-loaders.js', import.meta.url), 'utf8');
const featureRouteSource = readFileSync(new URL('../frontend/src/feature-route-loader.js', import.meta.url), 'utf8');
const warmupSource = readFileSync(new URL('../frontend/src/progressive-route-warmup.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('proposals list no longer auto-loads every remaining page', () => {
  assert.doesNotMatch(proposalsSource, /appendRemainingProposalPages\s*\(\s*\)\s*;/);
  assert.doesNotMatch(proposalsSource, /while\s*\(\s*data\._hasMore\s*\)/);
  assert.match(proposalsSource, /loadNextProposalPage/);
  assert.match(proposalsSource, /data-pa-load-more-proposals/);
  assert.match(proposalsSource, /הצגת תיקים נוספים/);
});

test('proposals list query supports server-side search and filters', () => {
  assert.doesNotMatch(apiSource, /void search;\s*\/\/ reserved for future server-side search/);
  assert.match(apiSource, /applyProposalsAgreementsListFilters/);
  assert.match(apiSource, /sanitizeProposalListSearchTerm/);
  assert.match(apiSource, /authorityId/);
  assert.match(apiSource, /schoolId/);
  assert.match(apiSource, /clientType/);
  assert.match(apiSource, /contact_client_type/);
  assert.match(apiSource, /authority_name\.ilike\.\$\{term\}/);
  assert.match(proposalsSource, /reloadProposalList\(\{\s*search:\s*query\s*\}/);

  const filterStart = apiSource.indexOf('function applyProposalsAgreementsListFilters');
  const filterEnd = apiSource.indexOf('function applyProposalsAgreementsListSort', filterStart);
  const filterFn = apiSource.slice(filterStart, filterEnd);
  assert.match(filterFn, /authority_name\.ilike\.\$\{term\}/);
  assert.doesNotMatch(filterFn, /authority_code\.ilike/);
  assert.doesNotMatch(filterFn, /semel_mosad\.ilike/);
});

test('instructor emp-id reads share the contacts_instructors bootstrap promise', () => {
  assert.match(apiSource, /async function readInstructorEmpIdsFromSupabase/);
  assert.match(apiSource, /readInstructorContactsRowsForBootstrap\(\)/);
  assert.match(apiSource, /instructorEmpIdsCache/);
  assert.match(apiSource, /instructorEmpIdsPromise/);
  const empStart = apiSource.indexOf('async function readInstructorEmpIdsFromSupabase');
  const empEnd = apiSource.indexOf('async function readExceptionsFromSupabase', empStart);
  const empFn = apiSource.slice(empStart, empEnd);
  assert.match(empFn, /readInstructorContactsRowsForBootstrap\(\)/);
  assert.doesNotMatch(empFn, /\.select\(\s*['`]emp_id,active['`]\s*\)/);
});

test('proposal item reads do not fetch the activity-group catalog', () => {
  const start = apiSource.indexOf('readProposalAgreementItems: async');
  const end = apiSource.indexOf('readProposalActivityPricing: async', start);
  const fn = apiSource.slice(start, end);
  assert.match(fn, /proposalGroupLookupCache/);
  assert.doesNotMatch(fn, /await getProposalGroupLookup\(\)/);
});

test('proposals list does not prefetch contacts or recipient catalog', () => {
  const fnStart = apiSource.indexOf('async function readProposalsAgreementsFromSupabase');
  const fnEnd = apiSource.indexOf('async function readProposalsPendingApprovedCountFromSupabase') > fnStart
    ? apiSource.indexOf('const USER_PUBLIC_COLUMNS', fnStart)
    : apiSource.indexOf('const USER_PUBLIC_COLUMNS', fnStart);
  const listFn = apiSource.slice(fnStart, fnEnd);
  assert.match(listFn, /contactOptions:\s*\[\]/);
  assert.doesNotMatch(listFn, /readContactsSchoolsForProposals\(\)/);
  assert.doesNotMatch(listFn, /readAuthoritySchoolCatalog\(\)/);
  assert.doesNotMatch(listFn, /readProposalActivityGroupsFromSupabase\(\)/);
  assert.match(apiSource, /proposalsAgreementsContacts:\s*async\s*\(\)\s*=>\s*readContactsSchoolsForProposals\(\)/);
  assert.match(proposalsSource, /ensureContacts/);
  assert.match(apiSource, /readContactsSchoolsForProposals\(\)/); // still used by editor deps / contacts API
});

test('bootstrap entry stays minimal and feature modules load on demand', () => {
  assert.match(entrySource, /import '\.\/network-request-dedupe\.js';/);
  assert.match(entrySource, /import '\.\/main\.js';/);
  assert.match(entrySource, /import '\.\/feature-route-loader\.js';/);
  assert.doesNotMatch(entrySource, /proposal-pdf-/);
  assert.doesNotMatch(entrySource, /annual-reviews-/);
  assert.doesNotMatch(entrySource, /israa-tracking-/);
  assert.doesNotMatch(entrySource, /activity-drawer-/);
  assert.match(featureLoaderSource, /case 'proposals'/);
  assert.match(featureLoaderSource, /case 'annualReviews'/);
  assert.match(featureLoaderSource, /case 'israa'/);
  assert.match(featureLoaderSource, /case 'activityDrawer'/);
  // Literal dynamic imports are required for Rollup/Vite async chunks.
  assert.match(featureLoaderSource, /import\('\.\/proposal-pdf-svg-origin-clean\.js'\)/);
  assert.match(featureLoaderSource, /import\('\.\/annual-reviews-final-pdf-safe\.js'\)/);
  assert.match(featureLoaderSource, /import\('\.\/activity-drawer-floating-actions\.js/);
  assert.match(featureRouteSource, /ensureFeaturesForRoute/);
  assert.match(featureRouteSource, /preloadScreenModule/);
});

test('index.html keeps a single app entry and no screen hotfix scripts', () => {
  assert.match(indexSource, /main-with-proposal-pdf-hotfix\.js\?v=[^\"']+/);
  assert.doesNotMatch(indexSource, /dashboard-kpi-corrections\.js/);
  assert.doesNotMatch(indexSource, /proposal-editor-compact-fixes\.js/);
  assert.doesNotMatch(indexSource, /client-file-layout-polish\.js/);
  assert.doesNotMatch(indexSource, /operations-summer-training-matrix\.js/);
  assert.doesNotMatch(indexSource, /operations-inventory-polish\.js/);
  assert.doesNotMatch(indexSource, /proposal-editor-compact-fixes\.css/);
});

test('progressive warmup never loads screen data into cache', () => {
  assert.doesNotMatch(warmupSource, /await\s+withTimeout\(screen\.load/);
  assert.doesNotMatch(warmupSource, /screenDataCache\[cacheKey\]\s*=/);
  assert.doesNotMatch(warmupSource, /IDLE_WARM_ORDER/);
  assert.doesNotMatch(warmupSource, /warmRoute\s*\(/);
  assert.match(warmupSource, /__DS_DISABLE_SCREEN_DATA_WARMUP__\s*=\s*true/);
  assert.match(warmupSource, /preloadScreenModule/);
});

test('client-file first page does not wait for item eligibility or linked documents', () => {
  const start = apiSource.indexOf('async function readProposalsAgreementsFromSupabase');
  const end = apiSource.indexOf('async function readProposalsPendingApprovedCountFromSupabase', start) > start
    ? apiSource.indexOf('const USER_PUBLIC_COLUMNS', start)
    : apiSource.indexOf('const USER_PUBLIC_COLUMNS', start);
  const listLoader = apiSource.slice(start, end);
  assert.doesNotMatch(listLoader, /eligibilityRows/);
  assert.doesNotMatch(listLoader, /\.from\('proposal_agreement_items'\)/);
  assert.match(listLoader, /includeLinkedDocuments\s*=\s*false/);
  assert.match(listLoader, /range\(pageOffset, pageOffset \+ pageSize - 1\)/);
  assert.match(proposalsSource, /includeLinkedDocuments:\s*false/);
});
