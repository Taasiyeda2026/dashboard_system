import { permissionFlagYes } from './permissions.js';
import { CAPABILITY_REGISTRY, tabCapability } from './capability-registry.js';

export const PERMISSION_ALIASES = Object.freeze({
  can_request_edit: ['can_request_edit_2'],
  can_review_requests: ['can_review_requests_2'],
  view_workshop_stock: ['view_inventory'],
  view_proposals_agreements: ['view_proposals'],
  finance_access: ['view_finance']
});

function rawPermission(user = {}, key) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const values = [user?.[key], nested?.[key]];
  for (const alias of PERMISSION_ALIASES[key] || []) values.push(user?.[alias], nested?.[alias]);
  return values.some(permissionFlagYes);
}

export function hasPermission(user = {}, key) {
  if (String(user?.role || user?.display_role || '').trim() === 'admin') return true;
  if (CAPABILITY_REGISTRY.some((item) => item.adminOnly && item.legacyPermission === key)) return false;
  if (!rawPermission(user, key)) return false;
  const capability = CAPABILITY_REGISTRY.find((item) => item.permission === key);
  let parent = capability?.parent ? CAPABILITY_REGISTRY.find((item) => item.id === capability.parent) : null;
  while (parent) {
    if (parent.permission && !rawPermission(user, parent.permission)) return false;
    parent = parent.parent ? CAPABILITY_REGISTRY.find((item) => item.id === parent.parent) : null;
  }
  return true;
}

export const MANAGED_ROUTE_PERMISSIONS = Object.freeze(Object.fromEntries(
  CAPABILITY_REGISTRY
    .filter((item) => item.permission && (item.route || item.routes) && !item.context)
    .flatMap((item) => (item.routes || [item.route]).map((route) => [route, item.permission]))
));

export function enforceManagedRoutes(routes = [], user = {}) {
  if (String(user?.role || user?.display_role || '').trim() === 'admin') return [...new Set(routes)];
  return [...new Set(routes)].filter((route) => {
    const candidates = CAPABILITY_REGISTRY.filter((item) => !item.adminOnly && !item.context && (item.route === route || item.routes?.includes(route)));
    return !candidates.length || candidates.some((item) => hasPermission(user, item.permission));
  });
}

export const OPERATIONS_TAB_PERMISSIONS = Object.freeze({
  ...Object.fromEntries(CAPABILITY_REGISTRY.filter((item) => item.parent?.startsWith('operations') && item.tab && item.permission).map((item) => [item.tab, item.permission]))
});

export function canOpenOperationsTab(user = {}, tab) {
  const permission = tabCapability(String(tab || ''), 'operations')?.permission || OPERATIONS_TAB_PERMISSIONS[String(tab || '')];
  return !permission || hasPermission(user, permission);
}

export function canOpenCapability(user = {}, capabilityId) {
  const capability = CAPABILITY_REGISTRY.find((item) => item.id === capabilityId);
  if (!capability) return false;
  if (capability.adminOnly) return String(user?.role || user?.display_role || '').trim() === 'admin';
  return hasPermission(user, capability.permission);
}

export function canOpenRoute(user = {}, route) {
  return enforceManagedRoutes([route], user).includes(route);
}
