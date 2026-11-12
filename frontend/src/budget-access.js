// Visibility only. The budget gateway independently verifies identity and role.
export const BUDGET_OWNER_UID = 'e9ca304a-4e66-4774-830e-14f1318c4908';
export function canAccessBudget(user) {
  return user?.auth_user_id === BUDGET_OWNER_UID &&
    ['admin', 'system_admin'].includes(user?.role) && user?.active === 'yes';
}

// Resolve the current Auth identity and canonical profile instead of relying on
// dashboard_user fields persisted by older dashboard releases.
export async function resolveBudgetUser(client) {
  if (!client) return null;
  try {
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || auth?.user?.id !== BUDGET_OWNER_UID) return null;
    const { data: profile, error: profileError } = await client
      .from('users').select('role,is_active').eq('auth_user_id', auth.user.id).maybeSingle();
    if (profileError || !profile?.is_active) return null;
    const user = { auth_user_id: auth.user.id, role: profile.role, active: profile.is_active === true ? 'yes' : 'no' };
    if (!canAccessBudget(user)) return null;
    const { data: latest, error: sessionError } = await client.auth.getSession();
    return !sessionError && latest?.session?.user?.id === user.auth_user_id ? user : null;
  } catch {
    return null;
  }
}
