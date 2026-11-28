import { canManageAllPosters } from './permissions.js';
// Keep broad poster access separate from dashboard administration.
export const POSTER_MANAGEMENT_URL = 'https://taasiyeda2026.github.io/spin-off/poster.html?view=management';

export function posterNavigationPlacement(user = {}) {
  if (user?.is_active === false) return null;
  const role = String(user?.role || '').trim();
  if (role === 'admin') return 'admin-management';
  if (canManageAllPosters(user)) return 'manager-sidebar';
  if (role === 'activities_manager') return 'manager-sidebar';
  return null;
}
