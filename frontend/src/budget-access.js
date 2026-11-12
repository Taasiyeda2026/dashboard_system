// Visibility only. The budget gateway independently verifies identity and role.
export const BUDGET_OWNER_UID = 'e9ca304a-4e66-4774-830e-14f1318c4908';
export function canAccessBudget(user) {
  // Existing dashboard login returns profile_is_active, not the legacy active field.
  // Explicit inactivity always wins; the gateway still checks the live canonical account.
  const active = user?.active === 'yes' ||
    (user?.active == null && user?.profile_is_active === true);
  return user?.auth_user_id === BUDGET_OWNER_UID &&
    ['admin', 'system_admin'].includes(user?.role) && active &&
    user?.profile_is_active !== false && user?.is_active !== false;
}
