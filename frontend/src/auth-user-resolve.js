import { supabase } from './supabase-client.js';

export const AUTH_USER_PUBLIC_COLUMNS = 'user_id,email,name,role,emp_id,is_active,permissions';
export const AUTH_USER_PUBLIC_COLUMNS_EXTENDED = `${AUTH_USER_PUBLIC_COLUMNS},auth_user_id,can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`;

function isMissingSupabaseColumnError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
}

function authUserIdMatchesRow(authUserId, userRow) {
  const expected = String(authUserId || '').trim();
  if (!expected) return true;
  const actual = String(userRow?.auth_user_id || '').trim();
  if (!actual) return true;
  return actual === expected;
}

async function fetchActiveUserRowByFilters(client, columns, filters = []) {
  if (!client || !Array.isArray(filters) || !filters.length) {
    return { userRow: null, missingColumnError: false };
  }
  let query = client.from('users').select(columns).eq('is_active', true);
  for (const [column, value] of filters) {
    if (!column || value == null || value === '') {
      return { userRow: null, missingColumnError: false };
    }
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    return {
      userRow: null,
      missingColumnError: isMissingSupabaseColumnError(error),
      error
    };
  }
  if (!data) return { userRow: null, missingColumnError: false };
  return { userRow: data, missingColumnError: false };
}

async function fetchActiveUserRowByColumn(client, columns, column, value) {
  return fetchActiveUserRowByFilters(client, columns, [[column, value]]);
}

async function resolveActiveUserRowWithColumns(options, columns) {
  const client = options.supabase || supabase;
  const authEmail = String(options.authEmail || '').trim().toLowerCase();
  const username = String(options.username || '').trim().toLowerCase();
  const authUserId = String(options.authUserId || '').trim();
  const sessionUserId = String(options.sessionUserId || '').trim();
  const requireAuthUserMatch = options.requireAuthUserMatch === true;

  const attempts = [];

  if (sessionUserId) {
    attempts.push({ matchedBy: 'session_user_id', filters: [['user_id', sessionUserId]] });
  }

  if (authUserId && username) {
    attempts.push({ matchedBy: 'auth_user_id+user_id', filters: [['auth_user_id', authUserId], ['user_id', username]] });
    attempts.push({ matchedBy: 'auth_user_id', filters: [['auth_user_id', authUserId]] });
  } else if (authUserId) {
    attempts.push({ matchedBy: 'auth_user_id', filters: [['auth_user_id', authUserId]] });
  }

  if (username) {
    attempts.push({ matchedBy: 'user_id', filters: [['user_id', username]] });
    attempts.push({ matchedBy: 'emp_id', filters: [['emp_id', username]] });
  }

  if (authEmail) {
    attempts.push({ matchedBy: 'email', filters: [['email', authEmail]] });
  }

  for (const attempt of attempts) {
    const result = await fetchActiveUserRowByFilters(client, columns, attempt.filters);
    if (result.missingColumnError) {
      return { userRow: null, matchedBy: '', missingColumnError: true };
    }
    if (!result.userRow) continue;
    if (requireAuthUserMatch && !authUserIdMatchesRow(authUserId, result.userRow)) {
      continue;
    }
    return { userRow: result.userRow, matchedBy: attempt.matchedBy, missingColumnError: false };
  }

  return { userRow: null, matchedBy: '', missingColumnError: false };
}

export async function resolveActiveUserRowAfterAuth(options = {}) {
  const baseColumns = String(options.baseColumns || AUTH_USER_PUBLIC_COLUMNS);
  const extendedColumns = String(options.extendedColumns || AUTH_USER_PUBLIC_COLUMNS_EXTENDED);
  const explicitColumns = options.columns != null ? String(options.columns) : null;
  const useExtendedColumnFallback = options.useExtendedColumnFallback !== false && !explicitColumns;

  if (explicitColumns) {
    return resolveActiveUserRowWithColumns(options, explicitColumns);
  }

  if (!useExtendedColumnFallback) {
    return resolveActiveUserRowWithColumns(options, baseColumns);
  }

  const extendedResult = await resolveActiveUserRowWithColumns(options, extendedColumns);
  if (extendedResult.missingColumnError) {
    return resolveActiveUserRowWithColumns(options, baseColumns);
  }
  return extendedResult;
}
