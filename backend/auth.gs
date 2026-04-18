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
  var defaultRoute = routes.indexOf(preferred) >= 0 ? preferred : (routes[0] || 'my-data');

  return {
    token: token,
    user: user,
    routes: routes,
    default_route: defaultRoute
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

  var map = {
    dashboard: 'view_dashboard',
    activities: 'view_activities',
    week: 'view_week',
    month: 'view_month',
    instructors: 'view_instructors',
    exceptions: 'view_exceptions',
    'my-data': 'view_my_data',
    contacts: 'view_contacts',
    finance: 'view_finance',
    permissions: 'view_permissions'
  };

  var allRoutes = [
    'dashboard',
    'activities',
    'week',
    'month',
    'instructors',
    'exceptions',
    'my-data',
    'contacts',
    'finance',
    'permissions'
  ];

  return allRoutes.filter(function(route) {
    if (route === 'permissions' && !(role === 'admin' || role === 'operations_reviewer')) return false;
    if (route === 'my-data' && role === 'instructor') return true;
    return yesNo_(permission[map[route]]) === 'yes' || route === 'my-data';
  });
}

function defaultRouteForRole_(role) {
  return role === 'instructor' ? 'my-data' : 'dashboard';
}
