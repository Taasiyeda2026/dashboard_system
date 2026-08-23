/** Central permission helpers for activity/edit-request capabilities. */
export function permissionFlagYes(value) {
  if (value === true || value === 1) return true;
  return ['yes', 'true', '1'].includes(String(value || '').trim().toLowerCase());
}

export function canViewEmployeeFiles(user = {}) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const explicit = nested.view_employee_files ?? user?.view_employee_files;
  const parent = nested.view_instructors ?? user?.view_instructors;
  const role = String(user?.role || user?.display_role || '').trim();
  return role === 'admin' || (permissionFlagYes(parent) && permissionFlagYes(explicit));
}

export function canViewIsraaManagement(user = {}) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  const role = String(user?.role || '').trim().toLowerCase();
  const explicit = nested.view_israa_management ?? user?.view_israa_management;
  return role === 'admin'
    || permissionFlagYes(explicit);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
}

function permissionValue(user = {}, canonical, aliases = []) {
  const nested = user?.permissions && typeof user.permissions === 'object' ? user.permissions : {};
  return firstDefined(nested[canonical], user[canonical], ...aliases.flatMap((key) => [nested[key], user[key]]));
}

function isAdmin(user = {}) {
  return String(user?.role || user?.display_role || '').trim() === 'admin';
}

function activityChildPermission(user, canonical, aliases = []) {
  return isAdmin(user) || (
    permissionFlagYes(permissionValue(user, 'view_activities'))
    && permissionFlagYes(permissionValue(user, canonical, aliases))
  );
}

export function canEditDirect(user = {}) {
  return activityChildPermission(user, 'can_edit_direct');
}

export function canAddActivityDirect(user = {}) {
  return activityChildPermission(user, 'can_add_activity');
}

export function canRequestEdit(user = {}) {
  return activityChildPermission(user, 'can_request_edit', ['can_request_edit_2']);
}

export function canRequestCreateActivity(user = {}) {
  return activityChildPermission(user, 'can_request_create_activity');
}

export function canReviewRequests(user = {}) {
  return activityChildPermission(user, 'can_review_requests', ['can_review_requests_2']);
}

export function canSendActivityCoordinationApprovals(user = {}) {
  return activityChildPermission(user, 'send_activity_coordination_approvals');
}

export function canManageInstructorOnboarding(user = {}) {
  return isAdmin(user) || (
    permissionFlagYes(permissionValue(user, 'view_instructors'))
    && permissionFlagYes(permissionValue(user, 'manage_instructor_onboarding'))
  );
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
