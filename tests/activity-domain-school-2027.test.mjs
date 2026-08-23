import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);

test('activity-domain migration keeps the data transition scoped to school_2027', async () => {
  const migration = await readFile(
    new URL('supabase/migrations/20260823140000_add_activity_domain_school_2027_transition.sql', ROOT),
    'utf8'
  );

  assert.match(migration, /add column if not exists activity_domain text/i);
  assert.match(migration, /activity_domain is null or activity_domain in \('E', 'Y'\)/);
  assert.match(migration, /activity_season = 'school_2027'/);
  assert.match(migration, /new\.activity_season is distinct from 'school_2027'/);
  assert.match(migration, /direct_proposal_id = item_proposal_id/);
  assert.match(migration, /assign_y_proposal_domain_to_activity/);
  assert.match(migration, /new\.activity_domain := 'Y'/);
  assert.match(migration, /trg_guard_proposal_linked_activity_domain_y/);
  assert.doesNotMatch(migration, /drop trigger if exists trg_guard_proposal_linked_activity_domain_y/i);
  assert.doesNotMatch(migration, /alter column proposal_domain/i);
});

test('activity-domain UI is limited to school_2027 create and edit forms', async () => {
  const [activities, detail, api] = await Promise.all([
    readFile(new URL('frontend/src/screens/activities.js', ROOT), 'utf8'),
    readFile(new URL('frontend/src/screens/shared/activity-detail-html.js', ROOT), 'utf8'),
    readFile(new URL('frontend/src/api.js', ROOT), 'utf8')
  ]);

  assert.match(activities, /name="activity_domain" required/);
  assert.match(activities, /isSchool2027Activity && !\['E', 'Y'\]\.includes\(activityDomain\)/);
  assert.match(detail, /is2027Row \? fieldEditOnly\(\s*'תחום פעילות'/);
  assert.match(api, /'activity_domain'/);
  assert.match(api, /invalid_activity_domain/);
  assert.doesNotMatch(api.match(/ACTIVITY_TABLE_COLUMNS = \[[\s\S]*?\]\.join\(','\);/)?.[0] || '', /activity_domain/);
});

test('manual review query resolves both direct and item proposal links before listing a row', async () => {
  const query = await readFile(
    new URL('supabase/queries/school_2027_activities_without_resolved_proposal.sql', ROOT),
    'utf8'
  );

  assert.match(query, /proposal_agreement_id/);
  assert.match(query, /proposal_item_id/);
  assert.match(query, /resolved_proposal_id is null/);
  assert.match(query, /conflicting_links/);
  assert.match(query, /activity_season = 'school_2027'/);
});