import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const migrationUrl = new URL('supabase/migrations/20260819212000_enforce_proposal_activity_catalog_identity.sql', ROOT);
const featureLoaderUrl = new URL('frontend/src/feature-loaders.js', ROOT);
const proposalsScreenUrl = new URL('frontend/src/screens/proposals-agreements.js', ROOT);

test('proposal-linked activities are canonicalized by catalog number before persistence', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /new\.activity_no := v_canonical_no/);
  assert.match(migration, /v_catalog\.activity_no/);
  assert.match(migration, /v_item\.list_id is not null and l\.list_id = v_item\.list_id/);
  assert.match(migration, /proposal_gefen_courses/);
  assert.match(migration, /v_course_short_name/);
  assert.match(migration, /proposal_item_catalog_link_required/);
  assert.match(migration, /proposal_item_activity_number_required/);
  assert.match(migration, /before insert or update of proposal_item_id, activity_name, activity_no, gefen_number/);
  assert.doesNotMatch(migration, /update\s+public\.activities\s+set/i, 'migration must not bulk-rewrite existing activities');
});

test('proposal UI keeps stable activity_no for catalog selections and loads short-name alignment runtime', async () => {
  const [screen, featureLoader] = await Promise.all([
    readFile(proposalsScreenUrl, 'utf8'),
    readFile(featureLoaderUrl, 'utf8')
  ]);

  assert.match(screen, /activity_no:\s+isManualCourseRow\s*\?\s*''\s*:\s*\(fieldText\('activity_no'\)\s*\|\|\s*text\(pricingRow\?\.activity_no\)\)/);
  assert.match(screen, /list_id:\s+isManualCourseRow\s*\?\s*''\s*:\s*\(fieldText\('list_id'\)\s*\|\|\s*text\(pricingRow\?\.list_id\)\)/);
  assert.match(featureLoader, /import\('\.\/proposal-operational-name-runtime\.js'\)/);
});
