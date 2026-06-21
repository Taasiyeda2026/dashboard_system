import { supabase } from './supabase-client.js';

export const AUTH_USER_PUBLIC_COLUMNS = 'user_id,email,name,role,emp_id,is_active,permissions';

async function fetchActiveUserRowByColumn(client, columns, column, value) {
  if (!client || !column || value == null || value === '') return null;
  const { data, error } = await client
    .from('users')
    .select(columns)
    .eq(column, value)
    .eq('is_active', true)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function resolveActiveUserRowAfterAuth(options = {}) {
  const client = options.supabase || supabase;
  const columns = String(options.columns || AUTH_USER_PUBLIC_COLUMNS);
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
    const userRow = await fetchActiveUserRowByColumn(client, columns, column, value);
    if (userRow) return { userRow, matchedBy: column };
  }
  return { userRow: null, matchedBy: '' };
}
