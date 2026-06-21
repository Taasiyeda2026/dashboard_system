import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const CLIENT_FILE = new URL('../frontend/src/supabase-client.js', import.meta.url);
const VITE_FILE = new URL('../vite.config.js', import.meta.url);

test('login uses Supabase Auth email domain and loads users by user_id after Auth', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const loginBlock = source.match(/async function loginWithSupabaseAuth[\s\S]*?^}/m);
  assert.ok(loginBlock, 'loginWithSupabaseAuth should exist');
  assert.match(loginBlock[0], /@think\.org\.il/);
  assert.match(loginBlock[0], /signInWithPassword\(/);
  assert.match(loginBlock[0], /\.eq\('user_id', username\)/);
  assert.match(loginBlock[0], /userRow\.auth_user_id = authUserId/);
  assert.doesNotMatch(loginBlock[0], /login_user_by_entry_code/);
  assert.doesNotMatch(loginBlock[0], /\.eq\('entry_code'/);
});

test('USER_PUBLIC_COLUMNS selects granted users table fields only', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const match = source.match(/const USER_PUBLIC_COLUMNS = '([^']+)'/);
  assert.ok(match, 'USER_PUBLIC_COLUMNS should exist');
  const columns = match[1].split(',');
  assert.deepEqual(columns, [
    'user_id',
    'email',
    'name',
    'role',
    'emp_id',
    'is_active',
    'permissions'
  ]);
});

test('supabase client prefers env vars and keeps production fallback when unset', async () => {
  const source = await readFile(CLIENT_FILE, 'utf8');
  assert.match(source, /VITE_SUPABASE_URL/);
  assert.match(source, /SUPABASE_URL/);
  assert.match(source, /VITE_SUPABASE_ANON_KEY/);
  assert.match(source, /SUPABASE_ANON_KEY/);
  assert.match(source, /FALLBACK_SUPABASE_URL/);
  assert.match(source, /usesFallbackUrl/);
  assert.match(source, /isConfigured/);
});

test('vite exposes SUPABASE_ env prefix for Preview integrations', async () => {
  const source = await readFile(VITE_FILE, 'utf8');
  assert.match(source, /envPrefix:\s*\[[^\]]*'SUPABASE_'/);
});

test('optional stabilize/reconcile migrations were removed', async () => {
  await assert.rejects(
    () => readFile(new URL('../supabase/migrations/20260621120000_stabilize_auth_login_and_grants.sql', import.meta.url)),
    /ENOENT/
  );
  await assert.rejects(
    () => readFile(new URL('../supabase/migrations/20260621090000_reconcile_migration_history.sql', import.meta.url)),
    /ENOENT/
  );
});

test('placeholder migrations use valid no-op SQL for Supabase Preview', async () => {
  const files = [
    '../supabase/migrations/20260614224918_grant_proposals_agreements_directory_view_select.sql',
    '../supabase/migrations/20260617214409_grant_workshop_stock_distributions_client_access.sql',
    '../supabase/migrations/20260620155322_add_participants_count_to_activities.sql',
    '../supabase/migrations/20260614224924_grant_proposals_agreements_directory_view_dependencies.sql',
    '../supabase/migrations/20260614224709_add_proposal_directory_compat_aliases.sql'
  ];

  for (const rel of files) {
    const sql = await readFile(new URL(rel, import.meta.url), 'utf8');
    assert.match(sql, /SELECT\s+1\s*;/i, `${rel} should contain SELECT 1; no-op`);
  }
});
