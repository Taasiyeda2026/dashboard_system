import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveActiveUserRowAfterAuth } from '../frontend/src/auth-user-resolve.js';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const CLIENT_FILE = new URL('../frontend/src/supabase-client.js', import.meta.url);
const VITE_FILE = new URL('../vite.config.js', import.meta.url);
const RESOLVE_FILE = new URL('../frontend/src/auth-user-resolve.js', import.meta.url);

function createMockSupabase(responsesByColumn) {
  return {
    from() {
      return {
        select() {
          return {
            eq(column) {
              const value = arguments[1];
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      const row = responsesByColumn[column]?.[value] ?? null;
                      return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
                    }
                  };
                }
              };
            }
          };
        }
      };
    }
  };
}

test('login uses Supabase Auth email domain and resolves users with email-first fallback', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const loginBlock = source.match(/async function loginWithSupabaseAuth[\s\S]*?^}/m);
  assert.ok(loginBlock, 'loginWithSupabaseAuth should exist');
  assert.match(loginBlock[0], /@think\.org\.il/);
  assert.match(loginBlock[0], /signInWithPassword\(/);
  assert.match(loginBlock[0], /resolveActiveUserRowAfterAuth\(/);
  assert.match(loginBlock[0], /auth_ok_user_row_not_found/);
  assert.match(loginBlock[0], /userRow\.auth_user_id = authUserId/);
  assert.doesNotMatch(loginBlock[0], /login_user_by_entry_code/);
  assert.doesNotMatch(loginBlock[0], /\.eq\('entry_code'/);
  assert.doesNotMatch(loginBlock[0], /throwLoginError\('invalid_credentials', \{ auth_user_id/);
});

test('resolveActiveUserRowAfterAuth finds idann by email when user_id differs', async () => {
  const authEmail = 'idann@think.org.il';
  const mockSupabase = createMockSupabase({
    email: {
      [authEmail]: {
        user_id: '1234',
        email: authEmail,
        name: 'Idan N',
        role: 'admin',
        emp_id: '1234',
        is_active: true
      }
    },
    user_id: {
      idann: null
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'idann',
    authUserId: '00000000-0000-4000-8000-000000000001'
  });

  assert.equal(matchedBy, 'email');
  assert.equal(userRow.user_id, '1234');
  assert.equal(userRow.email, authEmail);
});

test('resolveActiveUserRowAfterAuth falls back to user_id when email lookup misses', async () => {
  const authEmail = 'worker@think.org.il';
  const mockSupabase = createMockSupabase({
    email: {},
    user_id: {
      worker: {
        user_id: 'worker',
        email: 'other@think.org.il',
        name: 'Worker',
        role: 'instructor',
        emp_id: '9000',
        is_active: true
      }
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'worker',
    authUserId: '00000000-0000-4000-8000-000000000002'
  });

  assert.equal(matchedBy, 'user_id');
  assert.equal(userRow.user_id, 'worker');
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

test('auth user resolver tries email before user_id and emp_id', async () => {
  const source = await readFile(RESOLVE_FILE, 'utf8');
  const emailIndex = source.indexOf("['email', authEmail]");
  const userIdIndex = source.indexOf("['user_id', username]");
  const empIdIndex = source.indexOf("['emp_id', username]");
  assert.ok(emailIndex >= 0, 'email lookup should exist');
  assert.ok(userIdIndex >= 0, 'user_id lookup should exist');
  assert.ok(empIdIndex >= 0, 'emp_id lookup should exist');
  assert.ok(emailIndex < userIdIndex, 'email should be tried before user_id');
  assert.ok(userIdIndex < empIdIndex, 'user_id should be tried before emp_id');
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
