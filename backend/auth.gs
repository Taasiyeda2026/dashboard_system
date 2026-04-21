function actionLogin_(payload) {
  var userId = text_(payload.user_id || payload.userId);
  var entryCode = text_(payload.entry_code || payload.entryCode);
  if (!userId) throw new Error('user_id is required');
  if (!entryCode) throw new Error('entry_code is required');

  var permissionRows = readRows_(CONFIG.SHEETS.PERMISSIONS);
  var matchByUser = permissionRows.find(function(row) {
    return text_(row.user_id) === userId;
  });

  if (!matchByUser) throw new Error('invalid_credentials');
  if (yesNo_(matchByUser.active) !== 'yes') throw new Error('user_inactive');
  if (text_(matchByUser.entry_code) !== entryCode) throw new Error('invalid_credentials');

  var role = normalizeRole_(internalRoleFromPermissionRow_(matchByUser));
  var user = {
    user_id: text_(matchByUser.user_id),
    full_name: text_(matchByUser.full_name),
    display_role: role,
    display_role2: text_(matchByUser.display_role2),
    default_view: text_(matchByUser.default_view),
    emp_id: text_(matchByUser.user_id)
  };

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put(
    'session:' + token,
    JSON.stringify(user),
    CONFIG.SESSION_CACHE_SECONDS
  );

  var routes = effectiveRoutesForUser_(matchByUser, role);
  var preferred = text_(matchByUser.default_view) || defaultRouteForRole_(role);
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

function allKnownRoutes_() {
  return [
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
    'operations',
    'edit-requests',
    'permissions'
  ];
}

function parseRoutesCsvSetting_(key, fallbackRoutes) {
  var raw = getSettingText_(key, '');
  if (!raw) return (fallbackRoutes || []).slice();
  var known = allKnownRoutes_();
  var out = [];
  raw.split(',').forEach(function(v) {
    var route = text_(v);
    if (!route || known.indexOf(route) < 0) return;
    if (out.indexOf(route) < 0) out.push(route);
  });
  return out.length ? out : (fallbackRoutes || []).slice();
}

function buildNavigationSettings_() {
  return {
    disabled_routes: parseRoutesCsvSetting_('disabled_routes', []),
    sidebar_hidden_routes: parseRoutesCsvSetting_('sidebar_hidden_routes', []),
    contextual_only_routes: parseRoutesCsvSetting_('contextual_only_routes', [])
  };
}

function buildRoutesFromPermission_(permission, role) {
  if (role === 'instructor') return ['my-data'];

  var allRoutes = allKnownRoutes_();

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
    operations: 'view_operations_data',
    'edit-requests': 'view_edit_requests',
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
    var flag = map[route];
    if (!flag) return false;
    return yesNo_(permission[flag]) === 'yes';
  });
}

function computeEffectiveRoutes_(permission, role) {
  var permitted = buildRoutesFromPermission_(permission, role);
  var nav = buildNavigationSettings_();
  var blocked = nav.disabled_routes || [];
  return permitted.filter(function(route) {
    return blocked.indexOf(route) < 0;
  });
}

function effectiveRoutesForUser_(permission, role) {
  return computeEffectiveRoutes_(permission, role);
}

function defaultRouteForRole_(role) {
  if (role === 'instructor') return 'my-data';
  if (role === 'operations_reviewer') {
    return viewKeyToRouteId_(getSettingText_('operations_default_view_key', 'view_operations_data')) || 'dashboard';
  }
  if (role === 'admin') {
    return viewKeyToRouteId_(getSettingText_('admin_default_view_key', 'view_admin')) || 'dashboard';
  }
  return 'dashboard';
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
    view_operations_data: 'operations',
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
    view_edit_requests: 'edit-requests',
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

function canUserAccessRoute_(user, route) {
  var r = text_(route);
  if (!r) return false;
  var permission = getPermissionRow_(user.user_id);
  var effective = effectiveRoutesForUser_(permission, user.display_role);
  return effective.indexOf(r) >= 0;
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
  if (role === 'admin') return getSettingBool_('admin_direct_edit', true);
  if (role === 'operations_reviewer') {
    return getSettingBool_('operations_direct_edit', true);
  }
  if (getSettingBool_('non_admin_edits_require_approval', true)) return false;
  var explicit = text_(permission.can_edit_direct).toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;
  return false;
}

function effectiveCanAddActivity_(permission, role) {
  if (role === 'instructor') return false;
  if (role === 'admin') return getSettingBool_('admin_can_add_rows', true);
  if (role === 'operations_reviewer') return getSettingBool_('operations_can_add_rows', true);
  if (getSettingBool_('non_admin_edits_require_approval', true)) return false;
  var explicit = text_(permission.can_add_activity).toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;
  return false;
}
