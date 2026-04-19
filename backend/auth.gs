function actionLogin_(payload) {
  var entryCode = text_(payload.entry_code || payload.entryCode);
  if (!entryCode) throw new Error('entry_code is required');

  var permissionRows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var match = permissionRows.find(function(row) {
    return text_(row.entry_code) === entryCode && yesNo_(row.active) === 'yes';
  });

  if (!match) throw new Error('Invalid or inactive code');

  var role = normalizeRole_(internalRoleFromPermissionRow_(match));
  var user = {
    user_id: text_(match.user_id),
    full_name: text_(match.full_name),
    display_role: role,
    display_role2: text_(match.display_role2),
    default_view: text_(match.default_view),
    emp_id: text_(match.user_id)
  };

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'session:' + token,
    JSON.stringify(user),
    CONFIG.SESSION_CACHE_SECONDS
  );

  var routes = buildRoutesFromPermission_(match, role);
  var preferred = text_(match.default_view) || defaultRouteForRole_(role);
  var defaultRoute = resolveDefaultRoute_(preferred, routes, role);

  return {
    token: token,
    user: user,
    routes: routes,
    default_route: defaultRoute,
    client_settings: buildClientSettingsPayload_()
  };
}

function requireAuth_(token) {
  var value = text_(token);
  if (!value) throw new Error('Unauthorized');

  var raw = CacheService.getScriptCache().get('session:' + value);
  if (!raw) throw new Error('Unauthorized');

  return JSON.parse(raw);
}

function requireAnyRole_(user, roles) {
  if (!user || !user.display_role) {
    throw new Error('Forbidden');
  }
  var role = user.display_role;
  if (roles.indexOf(role) >= 0) {
    return;
  }
  if (roles.indexOf('authorized_user') >= 0 && isAuthorizedUserTier_(role)) {
    return;
  }
  throw new Error('Forbidden');
}

function getPermissionRow_(userId) {
  var rows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var match = rows.find(function(row) {
    return text_(row.user_id) === text_(userId);
  });
  return match || {};
}

function buildRoutesFromPermission_(permission, role) {
  if (role === 'instructor') return ['my-data'];

  var allRoutes = [
    'dashboard',
    'activities',
    'week',
    'month',
    'instructors',
    'instructor-contacts',
    'contacts',
    'exceptions',
    'finance',
    'end-dates',
    'my-data',
    'permissions',
    'admin-home',
    'admin-settings',
    'admin-lists'
  ];

  if (role === 'admin') return allRoutes;

  var map = {
    dashboard: 'view_dashboard',
    activities: 'view_activities',
    week: 'view_week',
    month: 'view_month',
    instructors: 'view_instructors',
    'instructor-contacts': '__instructor_contacts__',
    exceptions: 'view_exceptions',
    'my-data': '__my_data__',
    contacts: '__school_contacts__',
    finance: 'view_finance',
    'end-dates': '__end_dates__',
    permissions: 'view_permissions'
  };

  return allRoutes.filter(function(route) {
    if (route === 'permissions') {
      if (!(role === 'admin' || role === 'operations_reviewer')) return false;
      return yesNo_(permission.view_permissions) === 'yes';
    }
    if (route === 'my-data') {
      return myDataViewYes_(permission);
    }
    if (route === 'instructor-contacts') {
      return instructorContactsViewYes_(permission);
    }
    if (route === 'contacts') {
      return schoolContactsViewYes_(permission);
    }
    if (route === 'end-dates') {
      return endDatesViewYes_(permission);
    }
    /* Admin screens: admin always has them (returned above); reviewer gets them */
    if (route === 'admin-home' || route === 'admin-settings' || route === 'admin-lists') {
      return role === 'admin' || role === 'operations_reviewer';
    }
    var flag = map[route];
    if (!flag) return false;
    return yesNo_(permission[flag]) === 'yes';
  });
}

function defaultRouteForRole_(role) {
  return role === 'instructor' ? 'my-data' : 'dashboard';
}

/** מיושר לערכי default_view בגיליון permissions (למשל view_dashboard) */
function viewKeyToRouteId_(viewKey) {
  var k = text_(viewKey);
  var table = {
    dashboard: 'dashboard',
    view_dashboard: 'dashboard',
    activities: 'activities',
    view_activities: 'activities',
    week: 'week',
    view_week: 'week',
    month: 'month',
    view_month: 'month',
    instructors: 'instructors',
    view_instructors: 'instructors',
    exceptions: 'exceptions',
    view_exceptions: 'exceptions',
    my_data: 'my-data',
    'my-data': 'my-data',
    view_my_data: 'my-data',
    view_operations_data: 'my-data',
    instructor_contacts: 'instructor-contacts',
    'instructor-contacts': 'instructor-contacts',
    view_contacts_instructors: 'instructor-contacts',
    'view_contacts_instructors 2': 'instructor-contacts',
    contacts: 'contacts',
    view_contacts: 'contacts',
    end_dates: 'end-dates',
    'end-dates': 'end-dates',
    view_end_dates: 'end-dates',
    finance: 'finance',
    view_finance: 'finance',
    permissions: 'permissions',
    view_permissions: 'permissions',
    view_admin: 'dashboard',
    view_edit_requests: 'permissions',
    view_final_approvals: 'permissions'
  };
  return table[k] || '';
}

function resolveDefaultRoute_(preferred, routes, role) {
  var p = text_(preferred);
  if (!p) {
    p = defaultRouteForRole_(role);
  }
  if (routes.indexOf(p) >= 0) {
    return p;
  }
  if (p.indexOf('view_') === 0) {
    var mapped = viewKeyToRouteId_(p);
    if (mapped && routes.indexOf(mapped) >= 0) {
      return mapped;
    }
  }
  return routes[0] || 'my-data';
}

function instructorContactsViewYes_(permission) {
  if (yesNo_(permission.view_contacts_instructors) === 'yes') return true;
  if (yesNo_(permission['view_contacts_instructors 2']) === 'yes') return true;
  return false;
}

function schoolContactsViewYes_(permission) {
  return yesNo_(permission.view_contacts) === 'yes';
}

function endDatesViewYes_(permission) {
  return yesNo_(permission.view_end_dates) === 'yes';
}

function myDataViewYes_(permission) {
  return (
    yesNo_(permission.view_my_data) === 'yes' ||
    yesNo_(permission.view_operations_data) === 'yes'
  );
}

function hasWorkViewForEdit_(permission) {
  return (
    yesNo_(permission.view_activities) === 'yes' ||
    yesNo_(permission.view_week) === 'yes' ||
    yesNo_(permission.view_month) === 'yes' ||
    yesNo_(permission.view_finance) === 'yes' ||
    yesNo_(permission.view_operations_data) === 'yes' ||
    yesNo_(permission.view_exceptions) === 'yes'
  );
}

function effectiveCanEditDirect_(permission, role) {
  if (role === 'instructor') return false;
  if (role === 'admin') return true;
  var explicit = text_(permission.can_edit_direct).toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;
  return hasWorkViewForEdit_(permission);
}

function effectiveCanAddActivity_(permission, role) {
  if (role === 'instructor') return false;
  var explicit = text_(permission.can_add_activity).toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;
  return yesNo_(permission.view_activities) === 'yes';
}
