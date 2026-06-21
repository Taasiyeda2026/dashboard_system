import { supabase } from './supabase-client.js';

export const AUTH_USER_PUBLIC_COLUMNS = 'user_id,email,name,role,emp_id,is_active,permissions';
export const AUTH_USER_PUBLIC_COLUMNS_EXTENDED = `${AUTH_USER_PUBLIC_COLUMNS},auth_user_id,can_review_requests,view_proposals_agreements,manage_proposals_agreements,approve_proposals_agreements`;

function lookupLog(event, payload = {}) {
  try {
    console.info('[auth-user-resolve]', { event, ...payload });
  } catch {
    /* ignore */
  }
}

function isMissingSupabaseColumnError(error) {
  if (isUsersPermissionError(error)) return false;
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return msg.includes('schema cache') || msg.includes('could not find') || /column .+ does not exist/.test(msg);
}

function isUsersPermissionError(error) {
  const code = String(error?.code || '').trim();
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return code === '42501'
    || code === 'PGRST301'
    || /permission denied|not authorized|rls|policy|forbidden|insufficient privilege/i.test(msg);
}

function isMultipleMatchesError(error) {
  const code = String(error?.code || '').trim();
  const msg = String(error?.message || error?.details || error?.hint || error || '').toLowerCase();
  return (code === 'PGRST116' && msg.includes('multiple'))
    || msg.includes('more than one row');
}

export function classifyUserLookupError(error) {
  if (!error) return null;
  if (isMissingSupabaseColumnError(error)) return 'missing_column';
  if (isUsersPermissionError(error)) return 'permission_denied';
  if (isMultipleMatchesError(error)) return 'multiple_matches';
  return 'query_error';
}

function summarizeLookupError(error) {
  if (!error) return null;
  return {
    code: String(error?.code || '').trim() || null,
    message: String(error?.message || '').trim() || null,
    details: String(error?.details || '').trim() || null,
    hint: String(error?.hint || '').trim() || null,
    kind: classifyUserLookupError(error)
  };
}

function columnsIncludeAuthUserId(columns) {
  return String(columns || '')
    .split(',')
    .map((part) => part.trim())
    .includes('auth_user_id');
}

function authUserIdMatchesRow(authUserId, userRow) {
  const expected = String(authUserId || '').trim();
  if (!expected) return true;
  const actual = String(userRow?.auth_user_id || '').trim();
  if (!actual) return true;
  return actual === expected;
}

function buildLookupAttempts(options = {}, columns = '') {
  const authEmail = String(options.authEmail || '').trim().toLowerCase();
  const username = String(options.username || '').trim().toLowerCase();
  const authUserId = String(options.authUserId || '').trim();
  const sessionUserId = String(options.sessionUserId || '').trim();
  const loginMode = options.loginMode === true;
  const canUseAuthUserId = columnsIncludeAuthUserId(columns);
  const attempts = [];

  if (sessionUserId && !loginMode) {
    attempts.push({ matchedBy: 'session_user_id', filters: [['user_id', sessionUserId]] });
  }

  if (loginMode) {
    if (authEmail) attempts.push({ matchedBy: 'email', filters: [['email', authEmail]] });
    if (username) {
      attempts.push({ matchedBy: 'user_id', filters: [['user_id', username]] });
      attempts.push({ matchedBy: 'emp_id', filters: [['emp_id', username]] });
    }
    if (canUseAuthUserId && authUserId) {
      attempts.push({ matchedBy: 'auth_user_id', filters: [['auth_user_id', authUserId]] });
      if (username) {
        attempts.push({ matchedBy: 'auth_user_id+user_id', filters: [['auth_user_id', authUserId], ['user_id', username]] });
      }
    }
    return attempts;
  }

  if (canUseAuthUserId && authUserId && username) {
    attempts.push({ matchedBy: 'auth_user_id+user_id', filters: [['auth_user_id', authUserId], ['user_id', username]] });
  }
  if (canUseAuthUserId && authUserId) {
    attempts.push({ matchedBy: 'auth_user_id', filters: [['auth_user_id', authUserId]] });
  }
  if (username) {
    attempts.push({ matchedBy: 'user_id', filters: [['user_id', username]] });
    attempts.push({ matchedBy: 'emp_id', filters: [['emp_id', username]] });
  }
  if (authEmail) attempts.push({ matchedBy: 'email', filters: [['email', authEmail]] });
  if (sessionUserId) {
    attempts.unshift({ matchedBy: 'session_user_id', filters: [['user_id', sessionUserId]] });
  }
  return attempts;
}

async function fetchActiveUserRowByFilters(client, columns, filters = [], attemptMeta = {}) {
  if (!client || !Array.isArray(filters) || !filters.length) {
    return { userRow: null, missingColumnError: false, permissionError: false, multipleMatches: false };
  }
  lookupLog('attempt_start', {
    matchedBy: attemptMeta.matchedBy || '',
    columns,
    filters: Object.fromEntries(filters)
  });
  let query = client.from('users').select(columns).eq('is_active', true);
  for (const [column, value] of filters) {
    if (!column || value == null || value === '') {
      lookupLog('attempt_skip_empty_filter', { matchedBy: attemptMeta.matchedBy || '', column, value });
      return { userRow: null, missingColumnError: false, permissionError: false, multipleMatches: false };
    }
    query = query.eq(column, value);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    const summary = summarizeLookupError(error);
    lookupLog('attempt_error', {
      matchedBy: attemptMeta.matchedBy || '',
      dataCount: 0,
      ...summary
    });
    return {
      userRow: null,
      missingColumnError: isMissingSupabaseColumnError(error),
      permissionError: isUsersPermissionError(error),
      multipleMatches: isMultipleMatchesError(error),
      error,
      errorSummary: summary
    };
  }
  lookupLog('attempt_result', {
    matchedBy: attemptMeta.matchedBy || '',
    dataCount: data ? 1 : 0,
    user_id: data?.user_id || null
  });
  if (!data) return { userRow: null, missingColumnError: false, permissionError: false, multipleMatches: false };
  return { userRow: data, missingColumnError: false, permissionError: false, multipleMatches: false };
}

async function resolveActiveUserRowWithColumns(options, columns) {
  const authEmail = String(options.authEmail || '').trim().toLowerCase();
  const username = String(options.username || '').trim().toLowerCase();
  const authUserId = String(options.authUserId || '').trim();
  const requireAuthUserMatch = options.requireAuthUserMatch === true;
  const attempts = buildLookupAttempts(options, columns);
  const attemptLog = [];
  let sawPermissionError = false;
  let sawQueryError = false;
  let sawMultipleMatches = false;
  let lastErrorSummary = null;

  lookupLog('resolve_start', {
    columns,
    authEmail,
    username,
    authUserId,
    loginMode: options.loginMode === true,
    requireAuthUserMatch,
    attemptOrder: attempts.map((attempt) => attempt.matchedBy)
  });

  for (const attempt of attempts) {
    const result = await fetchActiveUserRowByFilters(
      options.supabase || supabase,
      columns,
      attempt.filters,
      attempt
    );
    const entry = {
      matchedBy: attempt.matchedBy,
      filters: Object.fromEntries(attempt.filters),
      dataCount: result.userRow ? 1 : 0,
      error: result.errorSummary || null,
      skippedReason: ''
    };

    if (result.missingColumnError) {
      entry.skippedReason = 'missing_column';
      attemptLog.push(entry);
      return {
        userRow: null,
        matchedBy: '',
        missingColumnError: true,
        status: 'missing_column',
        attempts: attemptLog
      };
    }
    if (result.permissionError) {
      sawPermissionError = true;
      lastErrorSummary = result.errorSummary;
      attemptLog.push(entry);
      continue;
    }
    if (result.multipleMatches) {
      sawMultipleMatches = true;
      lastErrorSummary = result.errorSummary;
      attemptLog.push(entry);
      continue;
    }
    if (result.errorSummary) {
      sawQueryError = true;
      lastErrorSummary = result.errorSummary;
      attemptLog.push(entry);
      continue;
    }
    if (!result.userRow) {
      attemptLog.push(entry);
      continue;
    }
    if (requireAuthUserMatch && !authUserIdMatchesRow(authUserId, result.userRow)) {
      entry.skippedReason = 'auth_user_id_mismatch';
      attemptLog.push(entry);
      lookupLog('attempt_rejected_auth_mismatch', {
        matchedBy: attempt.matchedBy,
        expected_auth_user_id: authUserId,
        row_auth_user_id: result.userRow?.auth_user_id || null,
        row_user_id: result.userRow?.user_id || null
      });
      continue;
    }
    attemptLog.push(entry);
    lookupLog('resolve_success', {
      matchedBy: attempt.matchedBy,
      user_id: result.userRow.user_id,
      email: result.userRow.email || null
    });
    return {
      userRow: result.userRow,
      matchedBy: attempt.matchedBy,
      missingColumnError: false,
      status: 'found',
      attempts: attemptLog
    };
  }

  const status = sawMultipleMatches
    ? 'multiple_matches'
    : sawPermissionError
      ? 'permission_denied'
      : sawQueryError
        ? 'query_error'
        : 'not_found';

  lookupLog('resolve_failed', {
    status,
    authEmail,
    username,
    authUserId,
    lastError: lastErrorSummary
  });

  return {
    userRow: null,
    matchedBy: '',
    missingColumnError: false,
    status,
    attempts: attemptLog,
    lastError: lastErrorSummary
  };
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
  if (extendedResult.userRow) return extendedResult;
  if (extendedResult.missingColumnError || extendedResult.status === 'permission_denied') {
    lookupLog('resolve_fallback_base_columns', {
      reason: extendedResult.missingColumnError ? 'missing_column' : 'permission_denied',
      previousStatus: extendedResult.status
    });
    const baseResult = await resolveActiveUserRowWithColumns(options, baseColumns);
    return {
      ...baseResult,
      attempts: [...(extendedResult.attempts || []), ...(baseResult.attempts || [])],
      fallbackFrom: extendedResult.status || 'extended_columns_failed'
    };
  }
  return extendedResult;
}
