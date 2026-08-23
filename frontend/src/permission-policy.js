import { permissionFlagYes } from './permissions.js';

export const PERMISSION_ALIASES = Object.freeze({
  can_request_edit: ['can_request_edit_2'],
  can_review_requests: ['can_review_requests_2'],
  view_workshop_stock: ['view_inventory'],
  view_proposals_agreements: ['view_proposals'],
  finance_access: ['view_finance']
});

export function hasPermission(user = {}, key) {
  if (String(user?.role || user?.display_role || '').trim() === 'admin') return true;
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const values = [user?.[key], nested?.[key]];
  for (const alias of PERMISSION_ALIASES[key] || []) values.push(user?.[alias], nested?.[alias]);
  return values.some(permissionFlagYes);
}

export const MANAGED_ROUTE_PERMISSIONS = Object.freeze({
  activities: 'view_activities',
  catalog: 'view_catalog',
  invitations: 'view_orders',
  orders: 'view_orders',
  'proposals-agreements': 'view_proposals_agreements',
  finance: 'finance_access',
  'personal-reports': 'can_access_personal_reports',
  'israa-management': 'view_israa_management',
  'operations-management': 'view_operations_management',
  'course-scheduling': 'view_operations_scheduling'
});

export function enforceManagedRoutes(routes = [], user = {}) {
  if (String(user?.role || user?.display_role || '').trim() === 'admin') return [...new Set(routes)];
  return [...new Set(routes)].filter((route) => {
    const permission = MANAGED_ROUTE_PERMISSIONS[route];
    return !permission || hasPermission(user, permission);
  });
}

export const OPERATIONS_TAB_PERMISSIONS = Object.freeze({
  completion_approval: 'view_activity_approvals',
  workshops: 'view_workshop_stock'
});

export function canOpenOperationsTab(user = {}, tab) {
  const permission = OPERATIONS_TAB_PERMISSIONS[String(tab || '')];
  return !permission || hasPermission(user, permission);
}
