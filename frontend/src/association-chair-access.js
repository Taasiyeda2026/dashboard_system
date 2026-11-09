/**
 * Association chair (יו"ר העמותה) is a stable user_id allowlist, not a display-role check.
 * Keep this identity-based so renaming display_role cannot widen or drop access.
 */
export const ASSOCIATION_CHAIR_USER_ID = '3090';

export const ASSOCIATION_CHAIR_ROUTES = Object.freeze([
  'dashboard',
  'activities',
  'impact-feedback'
]);

export function isAssociationChairViewer(user = {}) {
  if (user?.is_active === false) return false;
  return String(user?.user_id || '').trim() === ASSOCIATION_CHAIR_USER_ID;
}

export function restrictRoutesForAssociationChair(routes = [], user = {}) {
  if (!isAssociationChairViewer(user)) return [...routes];
  const allowed = new Set(ASSOCIATION_CHAIR_ROUTES);
  return [...new Set(routes)].filter((route) => allowed.has(route));
}
