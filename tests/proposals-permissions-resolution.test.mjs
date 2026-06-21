import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  AUTH_USER_PUBLIC_COLUMNS,
  AUTH_USER_PUBLIC_COLUMNS_EXTENDED,
  resolveActiveUserRowAfterAuth
} from '../frontend/src/auth-user-resolve.js';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => sessionStore.has(key) ? sessionStore.get(key) : null,
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => localStore.has(key) ? localStore.get(key) : null,
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const {
  flattenUserRow,
  buildBootstrapFromUser,
  proposalPermissionFlagsFromFlatUser,
  canUseProposalsAgreementsApi,
  canManageProposalsAgreementsApi,
  canApproveProposalsAgreementsApi
} = await import('../frontend/src/api.js');
const { state } = await import('../frontend/src/state.js');
const { canAccessProposalsAgreements, canManageProposalsAgreements } = await import('../frontend/src/screens/proposals-agreements.js');

function createMockSupabase(responsesByColumn, options = {}) {
  const { failExtendedColumns = false } = options;
  return {
    from() {
      return {
        select(columns) {
          const isExtended = String(columns).includes('view_proposals_agreements');
          return {
            eq(column) {
              const value = arguments[1];
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      if (failExtendedColumns && isExtended) {
                        return {
                          data: null,
                          error: { message: 'column view_proposals_agreements does not exist in schema cache' }
                        };
                      }
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

function withUser(user, fn) {
  const previous = state.user;
  state.user = user;
  try {
    return fn();
  } finally {
    state.user = previous;
  }
}

test('USER_PUBLIC_COLUMNS keeps base columns and extended list adds compatibility fields', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const baseMatch = source.match(/const USER_PUBLIC_COLUMNS = '([^']+)'/);
  assert.ok(baseMatch);
  assert.equal(baseMatch[1], AUTH_USER_PUBLIC_COLUMNS);
  assert.equal(
    AUTH_USER_PUBLIC_COLUMNS_EXTENDED,
    `${AUTH_USER_PUBLIC_COLUMNS},can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`
  );
  assert.match(
    source,
    /USER_PUBLIC_COLUMNS_EXTENDED = `\$\{USER_PUBLIC_COLUMNS\},can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`/
  );
});

test('flattenUserRow preserves JSONB permissions and top-level columns override JSON values', () => {
  const flat = flattenUserRow({
    user_id: 'u1',
    name: 'Test User',
    role: 'authorized_user',
    is_active: true,
    permissions: {
      view_proposals_agreements: 'no',
      manage_proposals_agreements: 'no',
      approve_proposals_agreements: 'no'
    },
    view_proposals_agreements: 'yes',
    manage_proposals_agreements: 'yes',
    approve_proposals_agreements: 'yes'
  });

  assert.equal(flat.view_proposals_agreements, 'yes');
  assert.equal(flat.manage_proposals_agreements, 'yes');
  assert.equal(flat.approve_proposals_agreements, 'yes');
});

test('JSONB view_proposals_agreements allows proposals route and API access', () => {
  const userRow = {
    user_id: 'viewer',
    role: 'authorized_user',
    is_active: true,
    permissions: { view_proposals_agreements: 'yes' }
  };
  const flat = flattenUserRow(userRow);
  const bootstrap = buildBootstrapFromUser(userRow);
  assert.ok(bootstrap.routes.includes('proposals-agreements'));

  withUser(flat, () => {
    assert.equal(canUseProposalsAgreementsApi(), true);
    assert.equal(canAccessProposalsAgreements({ user: flat, effectiveRoutes: bootstrap.routes }), true);
  });
});

test('top-level view_proposals_agreements allows proposals route and API access', () => {
  const userRow = {
    user_id: 'viewer-top',
    role: 'authorized_user',
    is_active: true,
    permissions: {},
    view_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);
  const bootstrap = buildBootstrapFromUser(userRow);

  assert.ok(bootstrap.routes.includes('proposals-agreements'));
  withUser(flat, () => {
    assert.equal(canUseProposalsAgreementsApi(), true);
    assert.equal(canAccessProposalsAgreements({ user: flat, effectiveRoutes: bootstrap.routes }), true);
  });
});

test('top-level manage_proposals_agreements allows management', () => {
  const userRow = {
    user_id: 'manager-top',
    role: 'authorized_user',
    is_active: true,
    permissions: {},
    manage_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);

  withUser(flat, () => {
    assert.equal(canManageProposalsAgreementsApi(), true);
    assert.equal(canManageProposalsAgreements({ user: flat }), true);
  });
});

test('top-level approve_proposals_agreements allows approval', () => {
  const userRow = {
    user_id: 'approver-top',
    role: 'operation_manager',
    is_active: true,
    permissions: {},
    approve_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);

  withUser(flat, () => {
    assert.equal(canApproveProposalsAgreementsApi(), true);
  });
});

test('proposalPermissionFlagsFromFlatUser exposes yes flags for session user', () => {
  const flags = proposalPermissionFlagsFromFlatUser(flattenUserRow({
    user_id: 'flags',
    role: 'authorized_user',
    is_active: true,
    permissions: { view_proposals_agreements: 'yes', approve_proposals_agreements: 'yes' }
  }));
  assert.equal(flags.view_proposals_agreements, 'yes');
  assert.equal(flags.approve_proposals_agreements, 'yes');
  assert.equal(flags.manage_proposals_agreements, undefined);
});

test('resolveActiveUserRowAfterAuth falls back to base columns when optional columns are missing', async () => {
  const authEmail = 'viewer@think.org.il';
  const mockSupabase = createMockSupabase({
    email: {
      [authEmail]: {
        user_id: 'viewer',
        email: authEmail,
        name: 'Viewer',
        role: 'authorized_user',
        emp_id: 'viewer',
        is_active: true,
        permissions: { view_proposals_agreements: 'yes' }
      }
    }
  }, { failExtendedColumns: true });

  const { userRow, matchedBy } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'viewer',
    authUserId: '00000000-0000-4000-8000-000000000010'
  });

  assert.equal(matchedBy, 'email');
  assert.equal(userRow.user_id, 'viewer');
  assert.deepEqual(userRow.permissions, { view_proposals_agreements: 'yes' });
});

test('resolveActiveUserRowAfterAuth uses extended columns when available', async () => {
  const authEmail = 'manager@think.org.il';
  const mockSupabase = createMockSupabase({
    email: {
      [authEmail]: {
        user_id: 'manager',
        email: authEmail,
        name: 'Manager',
        role: 'authorized_user',
        emp_id: 'manager',
        is_active: true,
        permissions: {},
        manage_proposals_agreements: 'yes'
      }
    }
  });

  const { userRow } = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'manager',
    authUserId: '00000000-0000-4000-8000-000000000011'
  });

  assert.equal(userRow.manage_proposals_agreements, 'yes');
  const flat = flattenUserRow(userRow);
  withUser(flat, () => {
    assert.equal(canManageProposalsAgreementsApi(), true);
  });
});

test('missing optional columns does not break login user resolution', async () => {
  const authEmail = 'login@think.org.il';
  const mockSupabase = createMockSupabase({
    email: {
      [authEmail]: {
        user_id: 'login-user',
        email: authEmail,
        name: 'Login User',
        role: 'domain_manager',
        emp_id: 'login-user',
        is_active: true,
        permissions: {}
      }
    }
  }, { failExtendedColumns: true });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'login-user',
    authUserId: '00000000-0000-4000-8000-000000000012'
  });

  assert.ok(result.userRow);
  assert.equal(result.userRow.role, 'domain_manager');
});
