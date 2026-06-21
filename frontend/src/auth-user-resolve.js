import { supabase } from './supabase-client.js';

export const AUTH_USER_PUBLIC_COLUMNS = 'user_id,email,name,role,emp_id,is_active,permissions';
export const AUTH_USER_PUBLIC_COLUMNS_EXTENDED = `${AUTH_USER_PUBLIC_COLUMNS},can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`;

function isMissingSupabaseColumnError(error) {
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find');
}

async function fetchActiveUserRowByColumn(client, columns, column, value) {
  if (!client || !column || value == null || value === '') {
    return { userRow: null, missingColumnError: false };
  }
  const { data, error } = await client
    .from('users')
    .select(columns)
    .eq(column, value)
    .eq('is_active', true)
    .maybeSingle();
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

async function resolveActiveUserRowWithColumns(options, columns) {
  const client = options.supabase || supabase;
  const authEmail = String(options.authEmail || '').trim().toLowerCase();
  const username = String(options.username || '').trim().toLowerCase();
  const authUserId = String(options.authUserId || '').trim();

  const attempts = [
    ['email', authEmail],
    ['user_id', username],
    ['emp_id', username]
  ];
  if (authUserId) attempts.push(['auth_user_id', authUserId]);

  for (const [column, value] of attempts) {
    const result = await fetchActiveUserRowByColumn(client, columns, column, value);
    if (result.missingColumnError) {
      return { userRow: null, matchedBy: '', missingColumnError: true };
    }
    if (result.userRow) {
      return { userRow: result.userRow, matchedBy: column, missingColumnError: false };
    }
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
