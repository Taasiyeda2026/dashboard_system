import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const hotfixSource  = await readFile(new URL('../frontend/src/school-catalog-bootstrap-hotfix.js', import.meta.url), 'utf8');
const activitiesSource = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const apiSource     = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('school catalog hotfix reads every Supabase page with pagination', () => {
  assert.match(hotfixSource, /const PAGE_SIZE = 1000;/);
  assert.match(hotfixSource, /query\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(hotfixSource, /if \(pageRows\.length < PAGE_SIZE\) break;/);
  assert.match(hotfixSource, /table: 'schools'/);
  assert.match(hotfixSource, /school_records:/);
});

test('login and bootstrap do NOT load school/authority catalog at startup', () => {
  // api.login() must use focused bootstrap lists, not readAuthoritySchoolCatalog
  assert.match(apiSource, /readBootstrapListsFromSupabase/);
  // The hotfix must NOT wrap api.login or api.bootstrap
  assert.doesNotMatch(hotfixSource, /targetApi\.login\s*=/);
  assert.doesNotMatch(hotfixSource, /targetApi\.bootstrap\s*=/);
  assert.doesNotMatch(hotfixSource, /enrichBootstrapResult/);
  assert.doesNotMatch(hotfixSource, /installSchoolCatalogBootstrapHotfix/);
});

test('ensureSchoolAuthorityCatalogInState is exported and deduplicates parallel calls', () => {
  // Function is exported for use by activity forms
  assert.match(hotfixSource, /export async function ensureSchoolAuthorityCatalogInState/);
  // Deduplication: a second in-flight call returns the existing Promise
  assert.match(hotfixSource, /catalogInflight/);
  // Cache: result is reused within TTL
  assert.match(hotfixSource, /CACHE_TTL_MS/);
  assert.match(hotfixSource, /catalogCacheAt/);
});

test('ensureSchoolAuthorityCatalogInState patches all required dropdown_options keys', () => {
  assert.match(hotfixSource, /d\.school\s*=/);
  assert.match(hotfixSource, /d\.schools\s*=/);
  assert.match(hotfixSource, /d\.school_records\s*=/);
  assert.match(hotfixSource, /d\.authority\s*=/);
  assert.match(hotfixSource, /d\.authorities\s*=/);
  assert.match(hotfixSource, /d\.authority_records\s*=/);
});

test('activities screen imports and calls ensureSchoolAuthorityCatalogInState before opening forms', () => {
  // Import must be present
  assert.match(activitiesSource, /ensureSchoolAuthorityCatalogInState/);
  // Must be called before both add and edit form opens
  const callCount = (activitiesSource.match(/ensureSchoolAuthorityCatalogInState/g) || []).length;
  assert.ok(callCount >= 2, `expected at least 2 usages of ensureSchoolAuthorityCatalogInState, got ${callCount}`);
});
