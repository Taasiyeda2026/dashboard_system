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
  proposalSessionUserFlagsFromFlatUser,
  canUseProposalsAgreementsApi,
  canManageProposalsAgreementsApi,
  canApproveProposalsAgreementsApi
} = await import('../frontend/src/api.js');
const { state } = await import('../frontend/src/state.js');
const {
  canAccessProposalsAgreements,
  canManageProposalsAgreements,
  proposalsAgreementsScreen
} = await import('../frontend/src/screens/proposals-agreements.js');

function filterKey(filters) {
  return filters.map(([column, value]) => `${column}=${String(value).toLowerCase()}`).join('&');
}

function createMockSupabase(rowsByFilterKey, options = {}) {
  const { failExtendedColumns = false } = options;
  return {
    from() {
      return {
        select(columns) {
          const isExtended = String(columns).includes('view_proposals_agreements');
          const filters = [];
          const builder = {
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            async maybeSingle() {
              if (failExtendedColumns && isExtended) {
                return {
                  data: null,
                  error: { message: 'column view_proposals_agreements does not exist in schema cache' }
                };
              }
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
    `${AUTH_USER_PUBLIC_COLUMNS},auth_user_id,can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`
  );
});

test('user with no proposal permissions cannot access proposals interface', () => {
  const userRow = {
    user_id: 'plain',
    role: 'authorized_user',
    is_active: true,
    permissions: {}
  };
  const flat = flattenUserRow(userRow);
  const bootstrap = buildBootstrapFromUser(userRow);
  assert.equal(bootstrap.routes.includes('proposals-agreements'), false);

  withUser(flat, () => {
    assert.equal(canUseProposalsAgreementsApi(), false);
    assert.equal(canManageProposalsAgreementsApi(), false);
    assert.equal(canApproveProposalsAgreementsApi(), false);
  });
  assert.equal(canAccessProposalsAgreements({ user: flat, effectiveRoutes: bootstrap.routes }), false);
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
    assert.equal(canManageProposalsAgreementsApi(), false);
    assert.equal(canApproveProposalsAgreementsApi(), false);
    assert.equal(canAccessProposalsAgreements({ user: flat, effectiveRoutes: bootstrap.routes }), true);
  });
});

test('view-only user does not receive manage or approve permissions from manage-only JSONB', () => {
  const userRow = {
    user_id: 'viewer-only',
    role: 'authorized_user',
    is_active: true,
    permissions: { view_proposals_agreements: 'yes' }
  };
  const flags = proposalPermissionFlagsFromFlatUser(flattenUserRow(userRow));
  assert.equal(flags.view_proposals_agreements, 'yes');
  assert.equal(flags.manage_proposals_agreements, undefined);
  assert.equal(flags.approve_proposals_agreements, undefined);
});

test('manage permission does not automatically grant approve permission', () => {
  const userRow = {
    user_id: 'manager-top',
    role: 'authorized_user',
    is_active: true,
    permissions: {},
    manage_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);
  const flags = proposalPermissionFlagsFromFlatUser(flat);

  withUser(flat, () => {
    assert.equal(canManageProposalsAgreementsApi(), true);
    assert.equal(canApproveProposalsAgreementsApi(), false);
  });
  assert.equal(flags.approve_proposals_agreements, undefined);
  assert.equal(flags.view_proposals_agreements, undefined);
  assert.equal(proposalSessionUserFlagsFromFlatUser(flat).view_proposals_agreements, true);
});

test('login session proposal flags match stable behavior without approve in session user', () => {
  const userRow = {
    user_id: 'approver-top',
    role: 'authorized_user',
    is_active: true,
    permissions: {},
    view_proposals_agreements: 'yes',
    manage_proposals_agreements: 'yes',
    approve_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);
  const sessionFlags = proposalSessionUserFlagsFromFlatUser(flat);

  assert.equal(sessionFlags.view_proposals_agreements, true);
  assert.equal(sessionFlags.manage_proposals_agreements, true);
  assert.equal(sessionFlags.approve_proposals_agreements, undefined);
});

test('top-level approve_proposals_agreements allows approval only when explicit', () => {
  const userRow = {
    user_id: 'approver-top',
    role: 'authorized_user',
    is_active: true,
    permissions: {},
    approve_proposals_agreements: 'yes'
  };
  const flat = flattenUserRow(userRow);

  withUser(flat, () => {
    assert.equal(canApproveProposalsAgreementsApi(), true);
    assert.equal(canManageProposalsAgreementsApi(), false);
  });
});

test('resolveActiveUserRowAfterAuth login mode prefers username match before auth/email fallback', async () => {
  const authUserId = '00000000-0000-4000-8000-000000000001';
  const authEmail = 'idann@think.org.il';
  const mockSupabase = createMockSupabase({
    'is_active=true&username=idann': {
      user_id: '8000',
      username: 'idann',
      email: authEmail,
      auth_user_id: authUserId,
      role: 'admin',
      is_active: true,
      permissions: {}
    },
    [`is_active=true&email=${authEmail}`]: {
      user_id: 'other-user',
      email: authEmail,
      auth_user_id: '00000000-0000-4000-8000-000000000099',
      role: 'authorized_user',
      is_active: true,
      permissions: { view_proposals_agreements: 'yes' }
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

test('requireAuthUserMatch rejects email match linked to a different auth user', async () => {
  const authEmail = 'shared@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: 'other-user',
      email: authEmail,
      auth_user_id: '00000000-0000-4000-8000-000000000099',
      role: 'admin',
      is_active: true,
      permissions: {}
    }
  });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'worker',
    authUserId: '00000000-0000-4000-8000-000000000010',
    requireAuthUserMatch: true
  });

  assert.equal(result.userRow, null);
});

test('resolveActiveUserRowAfterAuth falls back to base columns when optional columns are missing', async () => {
  const authEmail = 'viewer@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: 'viewer',
      email: authEmail,
      name: 'Viewer',
      role: 'authorized_user',
      emp_id: 'viewer',
      is_active: true,
      permissions: { view_proposals_agreements: 'yes' }
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

test('proposals permissions remain available after email profile load', async () => {
  const authEmail = 'viewer@think.org.il';
  const mockSupabase = createMockSupabase({
    [`is_active=true&email=${authEmail}`]: {
      user_id: 'viewer',
      email: authEmail,
      role: 'authorized_user',
      is_active: true,
      permissions: { view_proposals_agreements: 'yes' }
    }
  });

  const result = await resolveActiveUserRowAfterAuth({
    supabase: mockSupabase,
    authEmail,
    username: 'viewer',
    authUserId: '00000000-0000-4000-8000-000000000010',
    loginMode: true
  });

  const flat = flattenUserRow(result.userRow);
  withUser(flat, () => {
    assert.equal(canUseProposalsAgreementsApi(), true);
  });
});

test('missing optional columns does not grant extra proposal access', () => {
  const userRow = {
    user_id: 'login-user',
    role: 'authorized_user',
    is_active: true,
    permissions: {}
  };
  const flat = flattenUserRow(userRow);
  const bootstrap = buildBootstrapFromUser(userRow);

  assert.equal(bootstrap.routes.includes('proposals-agreements'), false);
  withUser(flat, () => {
    assert.equal(canUseProposalsAgreementsApi(), false);
  });
});

test('view-only user keeps stable drawer field rendering and no manage or approve actions', async () => {
  const screenSource = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
  assert.doesNotMatch(screenSource, /if \(key === 'notes' && !canManage\) return '';/);
  assert.match(screenSource, /const approvalNoteHtml = text\(row\.approval_note\) \? `/);

  const row = {
    id: '11111111-1111-1111-1111-111111111111',
    client_authority: 'רשות א',
    school_framework: 'בית ספר א',
    activity_type_group: 'קיץ',
    proposal_date: '2026-01-01',
    activity_names: ['רובוטיקה'],
    notes: 'customer-facing note',
    approval_note: 'approval note text',
    status: 'draft',
    total_amount: 100,
    approved_by: 'admin-user',
    auth_user_id: '00000000-0000-4000-8000-000000000001'
  };
  const viewState = { user: { role: 'authorized_user', view_proposals_agreements: 'yes' }, effectiveRoutes: ['proposals-agreements'] };
  const html = proposalsAgreementsScreen.render({ rows: [row] }, { state: viewState });
  assert.doesNotMatch(html, /admin-user/);
  assert.doesNotMatch(html, /00000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(html, /data-pa-edit-row/);
  assert.doesNotMatch(html, /חתום ואשר/);
});
