function handleGet_() {
  var validation = validateRequiredSheets_();

  return jsonResponse_({
    ok: validation.ok,
    data: {
      service: getSettingText_('system_name', CONFIG.SYSTEM_NAME || 'Dashboard Taasiyeda'),
      status: validation.ok ? 'ready' : 'missing_sheets',
      missing_sheets: validation.missing
    }
  });
}

function handlePost_(e) {
  try {
    beginRequestCache_();
    var payload = parsePayload_(e);
    var action = text_(payload.action);
    beginRequestPerf_(action, payload);
    var user = action === 'login' ? null : requireAuth_(payload.token);

    var handlers = {
      login: function() { return actionLogin_(payload); },
      bootstrap: function() { return actionBootstrap_(user); },
      dashboard: function() { return actionDashboard_(user, payload); },
      activities: function() { return actionActivities_(user, payload); },
      week: function() { return actionWeek_(user, payload); },
      month: function() { return actionMonth_(user, payload); },
      exceptions: function() { return actionExceptions_(user, payload); },
      finance: function() { return actionFinance_(user, payload); },
      instructors: function() { return actionInstructors_(user, payload); },
      instructorContacts: function() { return actionInstructorContacts_(user, payload); },
      contacts: function() { return actionContacts_(user, payload); },
      endDates: function() { return actionEndDates_(user, payload); },
      myData: function() { return actionMyData_(user, payload); },
      operations: function() { return actionOperations_(user); },
      editRequests: function() { return actionEditRequests_(user); },
      permissions: function() { return actionPermissions_(user, payload); },
      addActivity: function() { return actionAddActivity_(user, payload); },
      saveActivity: function() { return actionSaveActivity_(user, payload); },
      submitEditRequest: function() { return actionSubmitEditRequest_(user, payload); },
      reviewEditRequest: function() { return actionReviewEditRequest_(user, payload); },
      savePermission: function() { return actionSavePermission_(user, payload); },
      addUser: function() { return actionAddUser_(user, payload); },
      deactivateUser: function() { return actionDeactivateUser_(user, payload); },
      reactivateUser: function() { return actionReactivateUser_(user, payload); },
      deleteUser: function() { return actionDeleteUser_(user, payload); },
      savePrivateNote: function() { return actionSavePrivateNote_(user, payload); },
      saveFinanceRow: function() { return actionSaveFinanceRow_(user, payload); },
      syncFinance: function() { return actionSyncFinance_(user, payload); },
      listSheets: function() { return actionListSheets_(user); }
    };

    if (!handlers[action]) {
      throw new Error('Unknown action: ' + action);
    }

    var ACTION_ROUTE_MAP = {
      dashboard: 'dashboard',
      activities: 'activities',
      week: 'week',
      month: 'month',
      exceptions: 'exceptions',
      finance: 'finance',
      instructors: 'instructors',
      instructorContacts: 'instructor-contacts',
      contacts: 'contacts',
      endDates: 'end-dates',
      myData: 'my-data',
      operations: 'operations',
      editRequests: 'edit-requests',
      permissions: 'permissions'
    };
    var routeForAction = ACTION_ROUTE_MAP[action];
    if (routeForAction && !canUserAccessRoute_(user, routeForAction)) {
      throw new Error('Forbidden');
    }

    if (isReadActionCacheable_(action, user)) {
      var readKey = buildReadActionCacheKey_(action, user, payload);
      var readHit = scriptCacheGetJson_(readKey);
      if (readHit !== null) {
        markRequestPerf_('cache_lookup_done');
        return jsonResponse_({ ok: true, data: readHit }, {
          action: action,
          cache_hit: true
        });
      }
      markRequestPerf_('cache_lookup_done');
      var readData = handlers[action]();
      markRequestPerf_('action_done');
      scriptCachePutJson_(readKey, readData, CONFIG.SCRIPT_CACHE_SECONDS || 90);
      return jsonResponse_({ ok: true, data: readData }, {
        action: action,
        cache_hit: false
      });
    }

    markRequestPerf_('action_start');
    var writeData = handlers[action]();
    markRequestPerf_('action_done');
    return jsonResponse_({
      ok: true,
      data: writeData
    }, {
      action: action,
      cache_hit: false
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error && error.message ? error.message : 'Unexpected error'
    }, {
      action: (__rqPerf_ && __rqPerf_.action) || 'unknown',
      errored: true
    });
  }
}

function isReadActionCacheable_(action, user) {
  if (!user) return false;
  var map = {
    bootstrap: true,
    dashboard: true,
    activities: true,
    week: true,
    month: true,
    exceptions: true,
    finance: true,
    instructors: true,
    instructorContacts: true,
    contacts: true,
    endDates: true,
    myData: true,
    operations: true,
    editRequests: true,
    permissions: true
  };
  return !!map[action];
}

function buildReadActionCacheKey_(action, user, payload) {
  var version = dataViewsCacheVersion_();
  var userId = text_(user.user_id || '');
  var role = text_(user.display_role || '');
  var body = {};
  Object.keys(payload || {}).sort().forEach(function(key) {
    if (key === 'token' || key === 'action') return;
    body[key] = payload[key];
  });
  var digest = hashForCacheKey_(JSON.stringify(body));
  return ['pc', 'read', version, action, role, userId, digest].join(':');
}

function hashForCacheKey_(raw) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(raw || ''));
  return bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    var h = n.toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}
