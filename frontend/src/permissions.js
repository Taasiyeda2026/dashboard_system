/** Central permission helpers for activity/edit-request capabilities. */
export function permissionFlagYes(value) {
  if (value === true || value === 1) return true;
  return ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

const EMPLOYEE_FILE_DEFAULT_ROLES = new Set([
  'admin',
  'operation_manager',
  'finance',
  'activities_manager',
  'domain_manager',
  'business_development_manager',
  'instructor_manager'
]);

export function canViewEmployeeFiles(user = {}) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const explicit = user?.view_employee_files ?? nested.view_employee_files;
  if (explicit !== undefined && explicit !== null && String(explicit).trim() !== '') {
    return permissionFlagYes(explicit);
  }
  const role = String(user?.role || user?.display_role || '').trim();
  return EMPLOYEE_FILE_DEFAULT_ROLES.has(role);
}

export function canViewIsraaManagement(user = {}) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const role = String(user?.role || '').trim().toLowerCase();
  const explicit = user?.view_israa_management ?? nested.view_israa_management;
  const userId = String(user?.user_id || '').trim();
  const authUserId = String(user?.auth_user_id || '').trim();
  return role === 'admin'
    || permissionFlagYes(explicit)
    || userId === '3030'
    || authUserId === '92bfb9d9-1b17-4022-901a-5f7cf17a263a';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function userPermissions(user = {}) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  return { ...nested, ...user };
}

export function canEditDirect(user = {}) {
  const p = userPermissions(user);
  return permissionFlagYes(firstDefined(p.can_edit_direct, p.permissions?.can_edit_direct));
}

export function canAddActivityDirect(user = {}) {
  const p = userPermissions(user);
  return permissionFlagYes(firstDefined(p.can_add_activity, p.permissions?.can_add_activity));
}

export function canRequestEdit(user = {}) {
  const p = userPermissions(user);
  return permissionFlagYes(firstDefined(p.can_request_edit, p.can_request_edit_2, p.permissions?.can_request_edit, p.permissions?.can_request_edit_2));
}

export function canRequestCreateActivity(user = {}) {
  const p = userPermissions(user);
  return permissionFlagYes(firstDefined(p.can_request_create_activity, p.permissions?.can_request_create_activity))
    || canRequestEdit(user);
}

export function canReviewRequests(user = {}) {
  const p = userPermissions(user);
  return permissionFlagYes(firstDefined(p.can_review_requests, p.can_review_requests_2, p.permissions?.can_review_requests, p.permissions?.can_review_requests_2));
}

export function activityPermissions(user = {}) {
  return {
    canEditDirect: canEditDirect(user),
    canAddActivityDirect: canAddActivityDirect(user),
    canRequestEdit: canRequestEdit(user),
    canRequestCreateActivity: canRequestCreateActivity(user),
    canReviewRequests: canReviewRequests(user)
  };
}
