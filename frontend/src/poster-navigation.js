// The dashboard entry is limited to admins and actual team managers.
export const POSTER_MANAGEMENT_URL = 'https://taasiyeda2026.github.io/spin-off/poster.html?view=management';

export function posterNavigationPlacement(user = {}) {
  if (user?.is_active === false) return null;
  const role = String(user?.role || '').trim();
  if (role === 'admin') return 'admin-management';
  if (role === 'activities_manager') return 'manager-sidebar';
  return null;
}
