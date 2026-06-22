import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const PLACEHOLDER = `-- No-op migration placeholder.
-- This version exists in the remote Supabase migration history.
-- Keep this file so local migration history matches the remote project.
SELECT 1;
`;

const RESTORED_MIGRATIONS = [
  {
    name: '20260530151253_exact_proposal_templates_multiline.sql',
    source: '20260530_exact_proposal_templates_multiline.sql (commit 70e18e2e)',
    mustMatch: /proposal_template_sections[\s\S]*template_key IN \('summer', 'next_year', 'combined'\)/
  },
  {
    name: '20260606210608_personal_reports_employee_travel_rates.sql',
    source: '20260607_personal_reports_employee_travel_rates.sql',
    mustMatch: /private\.employee_travel_rates/
  },
  {
    name: '20260620155322_add_participants_count_to_activities.sql',
    source: '20260620_activities_participants_count.sql',
    mustMatch: /add column if not exists participants_count/i
  }
];

const TRUE_PLACEHOLDER_MIGRATIONS = [
  '20260614224709_add_proposal_directory_compat_aliases.sql',
  '20260614224918_grant_proposals_agreements_directory_view_select.sql',
  '20260614224924_grant_proposals_agreements_directory_view_dependencies.sql',
  '20260616213242_add_stock_quantity_to_lists.sql',
  '20260617175109_allow_public_select_authorities_catalog.sql',
  '20260617214409_grant_workshop_stock_distributions_client_access.sql',
  '20260618185536_add_activities_audit_log.sql',
  '20260620105104_add_summer_workshop_training_status.sql'
];

test('frontend login uses Supabase Auth and not entry_code RPC', async () => {
  const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const pr = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(api, /signInWithPassword\(/);
  assert.match(api, /@think\.org\.il/);
  assert.doesNotMatch(api, /login_user_by_entry_code/);

  assert.match(pr, /signInWithPassword\(/);
  assert.match(pr, /resolveActiveUserRowAfterAuth/);
  assert.doesNotMatch(pr, /login_user_by_entry_code/);
  assert.doesNotMatch(pr, /verify_personal_reports_entry_code/);
});

test('login error text prefers username/password message', async () => {
  const ui = await readFile(new URL('../frontend/src/screens/shared/ui-hebrew.js', import.meta.url), 'utf8');
  const pr = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
  assert.match(ui, /invalid_credentials: 'שם משתמש או סיסמה שגויים'/);
  assert.match(pr, /שם משתמש או סיסמה שגויים/);
});

test('reconcile retrigger migration was removed', async () => {
  await assert.rejects(
    () => readFile(new URL('../supabase/migrations/20260621090000_reconcile_migration_history.sql', import.meta.url)),
    /ENOENT/
  );
});

test('restored migrations contain real SQL from stable history', async () => {
  for (const { name, mustMatch } of RESTORED_MIGRATIONS) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /^[\s\S]*SELECT\s+1\s*;\s*$/i, `${name} must not be a no-op`);
    assert.match(sql, mustMatch, `${name} should contain restored stable SQL`);
  }
});

test('true remote-history placeholder migrations contain valid SQL no-ops', async () => {
  for (const name of TRUE_PLACEHOLDER_MIGRATIONS) {
    const sql = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
    assert.match(sql, /SELECT\s+1\s*;/i, `${name} must contain SELECT 1;`);
    assert.doesNotMatch(sql, /SELECT 'noop'/i, `${name} must not use SELECT 'noop'`);
  }
});

test('supabase client prefers env vars and keeps production fallback when unset', async () => {
  const source = await readFile(new URL('../frontend/src/supabase-client.js', import.meta.url), 'utf8');
  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /FALLBACK_SUPABASE_URL/);
  assert.match(source, /readEnvValue\(/);
});

test('proposals_agreements indexes guard activity_type vs activity_type_group', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260521_upgrade_proposals_agreements.sql', import.meta.url), 'utf8');
  assert.match(sql, /activity_type_group/);
  assert.match(sql, /column_name = 'activity_type_group'/);
  assert.match(sql, /DROP INDEX IF EXISTS proposals_agreements_default_sort_idx/);
});

test('personal reports policies use drop before create in access migration', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260608_personal_reports_access_permission.sql', import.meta.url), 'utf8');
  assert.match(sql, /DROP POLICY IF EXISTS "reports_select_own" ON public\.personal_reports;/);
  assert.match(sql, /CREATE POLICY "reports_select_own" ON public\.personal_reports/);
});

test('authenticated users profile grant migration avoids anon and write privileges', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260622_grant_authenticated_users_profile_select.sql', import.meta.url),
    'utf8'
  );
  const normalized = sql.toLowerCase();

  assert.match(normalized, /grant select/);
  assert.match(normalized, /on table public\.users/);
  assert.match(normalized, /to authenticated/);
  assert.match(normalized, /information_schema\.columns/);
  assert.doesNotMatch(normalized, /\bto\s+anon\b/);
  assert.doesNotMatch(normalized, /grant all/);
  assert.doesNotMatch(normalized, /grant insert/);
  assert.doesNotMatch(normalized, /grant update/);
  assert.doesNotMatch(normalized, /grant delete/);
});
