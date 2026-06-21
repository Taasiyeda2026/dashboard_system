import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  classifyUserLookupError,
  resolveActiveUserRowAfterAuth
} from '../frontend/src/auth-user-resolve.js';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const UI_FILE = new URL('../frontend/src/screens/shared/ui-hebrew.js', import.meta.url);

function filterKey(filters) {
  return filters.map(([column, value]) => `${column}=${String(value).toLowerCase()}`).join('&');
}

function createMockSupabase(rowsByFilterKey, options = {}) {
  const { failExtendedColumns = false, permissionDeniedOnExtended = false, permissionDeniedAll = false } = options;
  return {
    from() {
      return {
        select(columns) {
          const isExtended = String(columns).includes('auth_user_id');
          const filters = [];
          const builder = {
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            async maybeSingle() {
              if (permissionDeniedAll || (permissionDeniedOnExtended && isExtended)) {
                return {
                  data: null,
                  error: { code: '42501', message: 'permission denied for column auth_user_id' }
                };
              }
              if (failExtendedColumns && isExtended) {
                return {
                  data: null,
                  error: { message: 'column auth_user_id does not exist in schema cache' }
                };
              }
              const row = rowsByFilterKey[filterKey(filters)] ?? null;
              return row ? { data: row, error: null } : { data: null, error: null };
            }
          };
          return builder;
        }
      };
    }
  };
}

test('login source maps auth success profile failures to distinct error codes', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const loginBlock = source.match(/async function loginWithSupabaseAuth[\s\S]*?^}/m)?.[0] || '';
  assert.match(loginBlock, /auth_ok_user_row_not_found/);
  assert.match(loginBlock, /auth_ok_user_row_permission_denied/);
  assert.match(loginBlock, /auth_ok_user_row_query_error/);
  assert.match(loginBlock, /auth_ok_user_row_multiple_matches/);
  assert.match(loginBlock, /loginMode: true/);
  assert.match(loginBlock, /\[login-auth-success\]/);
  assert.doesNotMatch(loginBlock, /console\.[^\n]*password/);
});

test('ui-hebrew exposes distinct messages for post-auth profile failures', async () => {
  const source = await readFile(UI_FILE, 'utf8');
  assert.match(source, /auth_ok_user_row_permission_denied:/);
  assert.match(source, /auth_ok_user_row_query_error:/);
  assert.match(source, /auth_ok_user_row_multiple_matches:/);
});

test('classifyUserLookupError distinguishes permission denied from not found', () => {
  assert.equal(classifyUserLookupError({ code: '42501', message: 'permission denied' }), 'permission_denied');
  assert.equal(classifyUserLookupError({ code: 'PGRST116', message: 'multiple rows returned' }), 'multiple_matches');
  assert.equal(classifyUserLookupError({ message: 'column auth_user_id missing from schema cache' }), 'missing_column');
});

test('Auth succeeds and user row is found by email', async () => {
  const authEmail = 'idann@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: '1234',
      email: authEmail,
      role: 'admin',
      is_active: true,
      permissions: {}
    }
  });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'idann',
    authUserId: '00000000-0000-4000-8000-000000000001',
    loginMode: true
  });

  assert.equal(result.status, 'found');
  assert.equal(result.matchedBy, 'email');
  assert.equal(result.userRow.user_id, '1234');
});

test('Auth succeeds and user row is found by user_id fallback', async () => {
  const mockSupabase = createMockSupabase({
    'is_active=true&user_id=worker': {
      user_id: 'worker',
      email: 'other@think.org.il',
      role: 'instructor',
      is_active: true,
      permissions: {}
    }
  });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail: 'worker@think.org.il',
    username: 'worker',
    authUserId: '00000000-0000-4000-8000-000000000002',
    loginMode: true
  });

  assert.equal(result.status, 'found');
  assert.equal(result.matchedBy, 'user_id');
});

test('extended column permission denied falls back to base columns and still finds email row', async () => {
  const authEmail = 'idann@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: '1234',
      email: authEmail,
      role: 'admin',
      is_active: true,
      permissions: { view_proposals_agreements: 'yes' }
    }
  }, { permissionDeniedOnExtended: true });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'idann',
    authUserId: '00000000-0000-4000-8000-000000000001',
    loginMode: true
  });

  assert.equal(result.status, 'found');
  assert.equal(result.matchedBy, 'email');
  assert.equal(result.fallbackFrom, 'permission_denied');
});

test('permission denied on base columns returns distinct status', async () => {
  const mockSupabase = createMockSupabase({}, { permissionDeniedAll: true });
  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail: 'idann@think.org.il',
    username: 'idann',
    authUserId: '00000000-0000-4000-8000-000000000001',
    loginMode: true,
    useExtendedColumnFallback: false,
    baseColumns: 'user_id,email,name,role,emp_id,is_active,permissions',
    extendedColumns: 'user_id,email,name,role,emp_id,is_active,permissions'
  });
  assert.equal(result.status, 'permission_denied');
});

test('no matching row returns distinct not_found status', async () => {
  const mockSupabase = createMockSupabase({});
  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail: 'missing@think.org.il',
    username: 'missing',
    authUserId: '00000000-0000-4000-8000-000000000099',
    loginMode: true,
    useExtendedColumnFallback: false,
    baseColumns: 'user_id,email,name,role,emp_id,is_active,permissions',
    extendedColumns: 'user_id,email,name,role,emp_id,is_active,permissions'
  });
  assert.equal(result.status, 'not_found');
});
