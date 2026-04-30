function actionLogin_(payload) {
  var userId = text_(payload.user_id || payload.userId);
  var entryCode = text_(payload.entry_code || payload.entryCode);
  if (!userId) throw new Error('user_id is required');
  if (!entryCode) throw new Error('entry_code is required');

  var permissionRows = readRowsProjected_(CONFIG.SHEETS.PERMISSIONS, [
    'user_id',
    'full_name',
    'entry_code',
    'active',
    'display_role',
    'display_role2',
    'default_view',
    'org_id',
    'emp_id',
    'can_add_activity',
    'can_edit_direct',
    'can_request_edit',
    'view_dashboard',
    'view_activities',
    'view_week',
    'view_month',
    'view_instructors',
    'view_exceptions',
    'view_finance',
    'view_permissions',
    'view_operations_data',
    'view_edit_requests',
    'view_my_data',
    'view_contacts',
    'view_contacts_instructors',
    'view_contacts_instructors 2',
    'view_end_dates'
  ]);
  var matchByUser = permissionRows.find(function(row) {
    return text_(row.user_id) === userId;
  });

  if (!matchByUser) throw new Error('invalid_credentials');
  if (yesNo_(matchByUser.active) !== 'yes') throw new Error('user_inactive');
  if (text_(matchByUser.entry_code) !== entryCode) throw new Error('invalid_credentials');

  var role = normalizeRole_(internalRoleFromPermissionRow_(matchByUser));
  var routes = effectiveRoutesForUser_(matchByUser, role);
  var preferred = text_(matchByUser.default_view) || defaultRouteForRole_(role);
  var defaultRoute = resolveDefaultRoute_(preferred, routes, role);
  var canAddActivity = effectiveCanAddActivity_(matchByUser, role);
  var canEditDirect = effectiveCanEditDirect_(matchByUser, role);
  var canRequestEdit = effectiveCanRequestEdit_(matchByUser, role);
  var user = {
    user_id: text_(matchByUser.user_id),
    full_name: text_(matchByUser.full_name),
    display_role: role,
    display_role2: text_(matchByUser.display_role2),
    default_view: text_(matchByUser.default_view),
    emp_id: text_(matchByUser.user_id),
    can_add_activity: !!canAddActivity,
    can_edit_direct: !!canEditDirect,
    can_request_edit: !!canRequestEdit,
    can_view_finance: role === 'admin' || yesNo_(matchByUser.view_finance) === 'yes'
  };

  user.effective_routes = routes.slice();
  user.default_route = defaultRoute;
  var token = createSessionToken_(user);
  CacheService.getScriptCache().put(
    sessionCacheKey_(token),
    JSON.stringify(user),
    CONFIG.SESSION_CACHE_SECONDS
  );

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

  var sessionFromToken = parseSessionToken_(value);
  if (sessionFromToken) {
    var enrichedRaw = CacheService.getScriptCache().get(sessionCacheKey_(value));
    // Backward compatibility for sessions cached with the old key format.
    if (!enrichedRaw) {
      enrichedRaw = CacheService.getScriptCache().get('session:' + value);
    }
    if (enrichedRaw) {
      try {
        var enriched = JSON.parse(enrichedRaw);
        return {
          user_id: text_(enriched.user_id || sessionFromToken.user_id),
          full_name: text_(enriched.full_name || sessionFromToken.full_name),
          display_role: text_(enriched.display_role || sessionFromToken.display_role),
          display_role2: text_(enriched.display_role2 || sessionFromToken.display_role2),
          emp_id: text_(enriched.emp_id || sessionFromToken.emp_id || sessionFromToken.user_id),
          org_id: text_(enriched.org_id || sessionFromToken.org_id),
          effective_routes: Array.isArray(enriched.effective_routes) ? enriched.effective_routes.slice() : [],
          default_route: text_(enriched.default_route),
          can_add_activity: !!(enriched.can_add_activity || sessionFromToken.can_add_activity),
          can_edit_direct: !!enriched.can_edit_direct,
          can_request_edit: !!enriched.can_request_edit,
          can_view_finance: !!enriched.can_view_finance,
          __session_token: value
        };
      } catch (_e) {}
    }
    sessionFromToken.__session_token = value;
    return sessionFromToken;
  }

  var raw = CacheService.getScriptCache().get(sessionCacheKey_(value));
  // Backward compatibility for pre-fix UUID/plain-token keys.
  if (!raw) raw = CacheService.getScriptCache().get('session:' + value);
  if (!raw) throw new Error('Unauthorized');

  var parsed = JSON.parse(raw);
  parsed.__session_token = value;
  return parsed;
}

function sessionCacheKey_(token) {
  var raw = text_(token);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  var hex = bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    var h = n.toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
  return 'session:' + hex;
}

function sessionTokenSecret_() {
  var fromSettings = getSettingText_('auth_token_secret', '');
  if (fromSettings) return fromSettings;
  return CONFIG.SPREADSHEET_ID || 'dashboard-system';
}

function toWebSafeBase64_(raw) {
  return Utilities.base64EncodeWebSafe(String(raw || ''), Utilities.Charset.UTF_8).replace(/=+$/g, '');
}

function fromWebSafeBase64_(raw) {
  var text = String(raw || '');
  if (!text) return '';
  var padded = text + '==='.slice((text.length + 3) % 4);
  var bytes = Utilities.base64DecodeWebSafe(padded);
  return Utilities.newBlob(bytes).getDataAsString();
}

function signSessionToken_(headerPayload) {
  var sigBytes = Utilities.computeHmacSha256Signature(headerPayload, sessionTokenSecret_());
  return Utilities.base64EncodeWebSafe(sigBytes).replace(/=+$/g, '');
}

function createSessionToken_(user) {
  var nowSec = Math.floor(new Date().getTime() / 1000);
  var ttlSec = Number(CONFIG.SESSION_CACHE_SECONDS || (60 * 60 * 8));
  var claims = {
    uid: text_(user.user_id),
    role: text_(user.display_role),
    org_id: text_(user.org_id),
    emp_id: text_(user.emp_id || user.user_id),
    can_add_activity: !!user.can_add_activity,
    name: text_(user.full_name),
    role2: text_(user.display_role2),
    iat: nowSec,
    exp: nowSec + ttlSec
  };
  var header = { alg: 'HS256', typ: 'JWT' };
  var encodedHeader = toWebSafeBase64_(JSON.stringify(header));
  var encodedPayload = toWebSafeBase64_(JSON.stringify(claims));
  var headerPayload = encodedHeader + '.' + encodedPayload;
  var signature = signSessionToken_(headerPayload);
  return headerPayload + '.' + signature;
}

function parseSessionToken_(token) {
  var t = text_(token);
  var parts = t.split('.');
  if (parts.length !== 3) return null;
  var headerPayload = parts[0] + '.' + parts[1];
  var expectedSignature = signSessionToken_(headerPayload);
  if (expectedSignature !== parts[2]) return null;
  var payload = {};
  try {
    payload = JSON.parse(fromWebSafeBase64_(parts[1]) || '{}');
  } catch (_e) {
    return null;
  }
  var nowSec = Math.floor(new Date().getTime() / 1000);
  if (Number(payload.exp || 0) <= nowSec) return null;
  var userId = text_(payload.uid);
  var role = text_(payload.role);
  if (!userId || !role) return null;
  return {
    user_id: userId,
    display_role: role,
    org_id: text_(payload.org_id),
    emp_id: text_(payload.emp_id || userId),
    can_add_activity: !!payload.can_add_activity,
    effective_routes: [],
    default_route: '',
    can_edit_direct: false,
    can_request_edit: false,
    can_view_finance: false,
    full_name: text_(payload.name),
    display_role2: text_(payload.role2)
  };
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
  setRequestPerfField_('permissions_lookup', true);
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
      if (!canDirectWriteRole_(role)) return false;
      return permYes_(permission, 'view_permissions');
    }
    if (route === 'my-data') {
      return myDataViewYes_(permission);
    }
    if (route === 'instructor-contacts') {
      return instructorContactsViewYes_(permission);
    }
    if (route === 'contacts') {
      return instructorContactsViewYes_(permission) || schoolContactsViewYes_(permission);
    }
    if (route === 'end-dates') {
      return endDatesViewYes_(permission);
    }
    var flag = map[route];
    if (!flag) return false;
    return permYes_(permission, flag);
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
  if (isOperationManagerRole_(role)) {
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
  if (user && Object.prototype.toString.call(user.effective_routes) === '[object Array]') {
    if (user.effective_routes.indexOf(r) >= 0) return true;
    if (user.effective_routes.length) return false;
  }
  var permission = getPermissionRow_(user.user_id);
  var effective = effectiveRoutesForUser_(permission, user.display_role);
  if (user && user.user_id) {
    user.effective_routes = effective.slice();
    user.default_route = resolveDefaultRoute_(text_(permission.default_view), effective, user.display_role);
    try {
      CacheService.getScriptCache().put(
        sessionCacheKey_(text_(user.__session_token || '')),
        JSON.stringify(user),
        CONFIG.SESSION_CACHE_SECONDS
      );
    } catch (_e) {}
  }
  return effective.indexOf(r) >= 0;
}

/** בדיקת הרשאה מפורשת — רק 'yes' מפורש מעניק גישה; ריק/null = אין גישה */
function permYes_(permission, field) {
  return text_(permission[field]).toLowerCase() === 'yes';
}

function instructorContactsViewYes_(permission) {
  if (permYes_(permission, 'view_contacts_instructors')) return true;
  if (permYes_(permission, 'view_contacts_instructors 2')) return true;
  return false;
}

function schoolContactsViewYes_(permission) {
  return permYes_(permission, 'view_contacts');
}

function endDatesViewYes_(permission) {
  return permYes_(permission, 'view_end_dates');
}

function myDataViewYes_(permission) {
  return (
    permYes_(permission, 'view_my_data') ||
    permYes_(permission, 'view_operations_data')
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
  if (isOperationManagerRole_(role)) {
    return getSettingBool_('operations_direct_edit', true);
  }
  return false;
}

function effectiveCanRequestEdit_(permission, role) {
  if (role === 'instructor') return false;
  if (canDirectWriteRole_(role)) return true;
  var explicit = text_(permission.can_request_edit).toLowerCase();
  if (explicit === 'yes') return true;
  if (explicit === 'no') return false;
  return hasWorkViewForEdit_(permission);
}

function effectiveCanAddActivity_(permission, role) {
  if (role === 'instructor') return false;
  if (role === 'admin') return getSettingBool_('admin_can_add_rows', true);
  if (isOperationManagerRole_(role)) return getSettingBool_('operations_can_add_rows', true);
  return false;
}
