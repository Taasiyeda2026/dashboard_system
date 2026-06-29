import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveActiveUserRowAfterAuth } from '../frontend/src/auth-user-resolve.js';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const CLIENT_FILE = new URL('../frontend/src/supabase-client.js', import.meta.url);
const VITE_FILE = new URL('../vite.config.js', import.meta.url);
const RESOLVE_FILE = new URL('../frontend/src/auth-user-resolve.js', import.meta.url);

function filterKey(filters) {
  return filters.map(([column, value]) => `${column}=${String(value).toLowerCase()}`).join('&');
}

function createMockSupabase(rowsByFilterKey) {
  return {
    from() {
      return {
        select() {
          const filters = [];
          const builder = {
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            async maybeSingle() {
              const row = rowsByFilterKey[filterKey(filters)] ?? null;
              return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
            }
          };
          return builder;
        }
      };
    }
  };
}

test('login uses Supabase Auth email domain and resolves users with strict auth fallback', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const loginBlock = source.match(/async function loginWithSupabaseAuth[\s\S]*?^}/m);
  assert.ok(loginBlock, 'loginWithSupabaseAuth should exist');
  assert.match(loginBlock[0], /lookup_login_user_by_username/);
  assert.match(loginBlock[0], /loginUser\.auth_email/);
  assert.doesNotMatch(loginBlock[0], /`\$\{[^`]*username[^`]*}\@think\.org\.il`/);
  assert.match(loginBlock[0], /signInWithPassword\(/);
  assert.match(loginBlock[0], /resolveActiveUserRowAfterAuth\(/);
  assert.match(loginBlock[0], /loginMode: true/);
  assert.match(loginBlock[0], /auth_ok_user_row_not_found/);
  assert.match(loginBlock[0], /userRow\.auth_user_id = authUserId/);
  assert.doesNotMatch(loginBlock[0], /login_user_by_entry_code/);
  assert.doesNotMatch(loginBlock[0], /\.eq\('entry_code'/);
  assert.doesNotMatch(loginBlock[0], /throwLoginError\('invalid_credentials', \{ auth_user_id/);
});

test('resolveActiveUserRowAfterAuth finds idann by email when user_id differs', async () => {
  const authEmail = 'idann@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: '1234',
      email: authEmail,
      name: 'Idan N',
      role: 'admin',
      emp_id: '1234',
      is_active: true
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'idann',
    authUserId: '00000000-0000-4000-8000-000000000001',
    loginMode: true
  });

  assert.equal(matchedBy, 'email');
  assert.equal(userRow.user_id, '1234');
  assert.equal(userRow.email, authEmail);
});

test('resolveActiveUserRowAfterAuth falls back to user_id when email lookup misses', async () => {
  const authEmail = 'worker@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&user_id=worker`]: {
      user_id: 'worker',
      email: 'other@think.org.il',
      name: 'Worker',
      role: 'instructor',
      emp_id: '9000',
      is_active: true
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'worker',
    authUserId: '00000000-0000-4000-8000-000000000002',
    loginMode: true
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
    'username',
    'email',
    'name',
    'full_name',
    'role',
    'display_role',
    'display_role2',
    'emp_id',
    'is_active',
    'permissions'
  ]);
  assert.match(source, /USER_PUBLIC_COLUMNS_EXTENDED = `\$\{USER_PUBLIC_COLUMNS\},auth_user_id,auth_email,can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`/);
});

test('auth user resolver supports login diagnostics and auth mismatch checks', async () => {
  const source = await readFile(RESOLVE_FILE, 'utf8');
  assert.match(source, /AUTH_USER_PUBLIC_COLUMNS_EXTENDED/);
  assert.match(source, /requireAuthUserMatch/);
  assert.match(source, /loginMode/);
  assert.match(source, /classifyUserLookupError/);
  assert.match(source, /\[auth-user-resolve\]/);
});

test('auth user resolver prioritizes username before id fallbacks in login mode', async () => {
  const source = await readFile(RESOLVE_FILE, 'utf8');
  const loginBlock = source.match(/if \(loginMode\) \{[\s\S]*?return attempts;/);
  assert.ok(loginBlock, 'loginMode attempt block should exist');
  const authIndex = loginBlock[0].indexOf("matchedBy: 'auth_user_id'");
  const usernameIndex = loginBlock[0].indexOf("matchedBy: 'username'");
  const emailIndex = loginBlock[0].indexOf("matchedBy: 'email'");
  const userIdIndex = loginBlock[0].indexOf("matchedBy: 'user_id'");
  const empIdIndex = loginBlock[0].indexOf("matchedBy: 'emp_id'");
  assert.ok(authIndex >= 0, 'auth_user_id lookup should still exist in login mode');
  assert.ok(usernameIndex >= 0, 'username lookup should exist in login mode');
  assert.ok(userIdIndex >= 0, 'user_id fallback should exist in login mode');
  assert.ok(empIdIndex >= 0, 'emp_id fallback should exist in login mode');
  assert.ok(emailIndex >= 0, 'email lookup should exist in login mode');
  assert.ok(usernameIndex < userIdIndex, 'username should be tried before user_id in login mode');
  assert.ok(userIdIndex < empIdIndex, 'user_id should be tried before emp_id in login mode');
  const authEmailIndex = loginBlock[0].indexOf("matchedBy: 'auth_email'");
  assert.ok(authEmailIndex >= 0, 'auth_email lookup should exist in login mode');
  assert.ok(usernameIndex < authIndex, 'username should still be tried before auth identity fallbacks');
  assert.ok(authIndex < authEmailIndex, 'auth_user_id should be tried before auth_email in auth-first fallback mode');
  assert.ok(authEmailIndex < emailIndex, 'auth_email should be tried before legacy email fallback');
  assert.ok(emailIndex < userIdIndex, 'auth email fallback should be tried before user_id in auth login mode');
});


test('login resolver keeps idann admin username match before employee/auth fallbacks', async () => {
  const authEmail = 'idann@think.org.il';
  const authUserId = '00000000-0000-4000-8000-000000000001';
  const mockSupabase = createMockSupabase({
    'is_active=true&username=idann': {
      user_id: '8000',
      username: 'idann',
      email: authEmail,
      auth_user_id: authUserId,
      role: 'admin',
      emp_id: '8000',
      is_active: true
    },
    [`is_active=true&auth_user_id=${authUserId.toLowerCase()}`]: {
      user_id: '1502',
      username: '1502',
      email: authEmail,
      auth_user_id: authUserId,
      role: 'instructor',
      emp_id: '1502',
      is_active: true
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'idann',
    authUserId,
    loginMode: true,
    requireAuthUserMatch: true
  });

  assert.equal(matchedBy, 'username');
  assert.equal(userRow.user_id, '8000');
  assert.equal(userRow.role, 'admin');
});

test('login resolver supports instructor employee-number login after username misses', async () => {
  const mockSupabase = createMockSupabase({
    'is_active=true&emp_id=1502': {
      user_id: 'u-eldar',
      username: 'eldar',
      email: '1502@think.org.il',
      role: 'instructor',
      emp_id: '1502',
      is_active: true
    }
  });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail: '1502@think.org.il',
    username: '1502',
    authUserId: '00000000-0000-4000-8000-000000000150',
    loginMode: true,
    requireAuthUserMatch: true
  });

  assert.equal(matchedBy, 'emp_id');
  assert.equal(userRow.role, 'instructor');
  assert.equal(userRow.emp_id, '1502');
});



test('login lookup migration syncs auth emails and matches username before user_id before emp_id', async () => {
  const migrationPath = new URL('../supabase/migrations/20260629120000_sync_auth_email_and_login_lookup_ids.sql', import.meta.url);
  const sql = await readFile(migrationPath, 'utf8');
  const normalized = sql.toLowerCase();

  assert.match(normalized, /update public\.users as u/);
  assert.match(normalized, /set auth_email = au\.email/);
  assert.match(normalized, /from auth\.users as au/);
  assert.match(normalized, /u\.is_active = true/);
  assert.match(normalized, /u\.auth_user_id = au\.id/);
  assert.match(normalized, /u\.auth_email is distinct from au\.email/);

  const updateClause = normalized.match(/update public\.users as u[\s\S]*?drop function/)?.[0] || '';
  const setClause = updateClause.match(/set[\s\S]*?from auth\.users as au/)?.[0] || '';
  assert.doesNotMatch(setClause, /user_id\s*=/);
  assert.doesNotMatch(setClause, /username\s*=/);
  assert.doesNotMatch(setClause, /role\s*=/);
  assert.doesNotMatch(setClause, /auth_user_id\s*=/);

  assert.match(normalized, /lower\(btrim\(u\.username::text\)\) = input\.login_key/);
  assert.match(normalized, /lower\(btrim\(u\.user_id::text\)\) = input\.login_key/);
  assert.match(normalized, /lower\(btrim\(u\.emp_id::text\)\) = input\.login_key/);
  assert.match(normalized, /when lower\(btrim\(u\.username::text\)\) = input\.login_key then 1/);
  assert.match(normalized, /when lower\(btrim\(u\.user_id::text\)\) = input\.login_key then 2/);
  assert.match(normalized, /when lower\(btrim\(u\.emp_id::text\)\) = input\.login_key then 3/);
  assert.match(normalized, /lookup_login_user_by_username\('6000'\)/);
  assert.match(normalized, /lookup_login_user_by_username\('edenc'\)/);
  assert.match(normalized, /u\.user_id in \('6000', '1500'\)/);
});

test('idann auth email repair migration only updates the pinned admin row', async () => {
  const migrationPath = new URL('../supabase/migrations/20260626090000_repair_idann_auth_email.sql', import.meta.url);
  const sql = await readFile(migrationPath, 'utf8');
  const normalized = sql.toLowerCase();

  assert.match(normalized, /update public\.users/);
  assert.match(normalized, /set auth_email = 'idann@think\.org\.il'/);
  assert.match(normalized, /where username = 'idann'/);
  assert.match(normalized, /and user_id = '8000'/);
  assert.match(normalized, /and role = 'admin'/);
  assert.match(normalized, /and is_active = true/);
  assert.match(normalized, /and auth_user_id = 'e9ca304a-4e66-4774-830e-14f1318c4908'/);
  assert.match(normalized, /auth_email is distinct from 'idann@think\.org\.il'/);
  const setClause = normalized.match(/set[\s\S]*?where/)?.[0] || '';
  assert.doesNotMatch(setClause, /user_id\s*=/);
  assert.doesNotMatch(setClause, /username\s*=/);
  assert.doesNotMatch(setClause, /role\s*=/);
  assert.doesNotMatch(setClause, /auth_user_id\s*=/);
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

test('authenticated users profile SELECT grant migration is safe and minimal', async () => {
  const migrationPath = new URL('../supabase/migrations/20260622_grant_authenticated_users_profile_select.sql', import.meta.url);
  const sql = await readFile(migrationPath, 'utf8');
  const normalized = sql.toLowerCase();

  assert.match(normalized, /grant usage on schema public to authenticated/);
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

test('restored migrations contain real SQL; true placeholders remain no-ops', async () => {
  const restored = [
    '../supabase/migrations/20260530151253_exact_proposal_templates_multiline.sql',
    '../supabase/migrations/20260606210608_personal_reports_employee_travel_rates.sql',
    '../supabase/migrations/20260620155322_add_participants_count_to_activities.sql'
  ];
  for (const rel of restored) {
    const sql = await readFile(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /^[\s\S]*SELECT\s+1\s*;\s*$/i, `${rel} should not be a no-op`);
  }

  const placeholders = [
    '../supabase/migrations/20260614224918_grant_proposals_agreements_directory_view_select.sql',
    '../supabase/migrations/20260617214409_grant_workshop_stock_distributions_client_access.sql',
    '../supabase/migrations/20260614224924_grant_proposals_agreements_directory_view_dependencies.sql',
    '../supabase/migrations/20260614224709_add_proposal_directory_compat_aliases.sql'
  ];

  for (const rel of placeholders) {
    const sql = await readFile(new URL(rel, import.meta.url), 'utf8');
    assert.match(sql, /SELECT\s+1\s*;/i, `${rel} should contain SELECT 1; no-op`);
  }
});
