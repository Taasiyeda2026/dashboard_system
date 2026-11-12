// Visibility only. The budget gateway independently verifies identity and role.
export const BUDGET_OWNER_UID = 'e9ca304a-4e66-4774-830e-14f1318c4908';
export function canAccessBudget(user) {
  return user?.auth_user_id === BUDGET_OWNER_UID &&
    ['admin', 'system_admin'].includes(user?.role) && user?.active === 'yes';
}
