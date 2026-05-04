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


function shouldAllowLegacyFallbackForHeavyAction_(action, payload, user) {
  var a = text_(action);
    var heavy = {
    dashboard: true,
    dashboardSnapshot: true,
    month: true,
    week: true,
    activities: true,
    exceptions: true,
    endDates: true
  };
  if (!heavy[a]) return true;
  var forceLegacy = yesNo_(payload && payload.force_legacy) === 'yes' || payload && payload.force_legacy === true;
  var debugEnabled = yesNo_(payload && payload.debug) === 'yes' || yesNo_(payload && payload.debug_perf) === 'yes';
  var isAdmin = !!(user && (user.display_role === 'admin' || user.display_role === 'operation_manager'));
  if (forceLegacy || debugEnabled) {
    try { console.warn('[perf][legacy_fallback_explicit]', JSON.stringify({ action: a, force_legacy: !!forceLegacy, debug: !!debugEnabled, is_admin: !!isAdmin })); } catch (_e) {}
    setRequestPerfField_('legacy_fallback_explicit', true);
    return true;
  }
  try { console.warn('[perf][legacy_fallback_blocked]', JSON.stringify({ action: a, reason: 'read_model_missing_or_stale' })); } catch (_e2) {}
  setRequestPerfField_('legacy_fallback_blocked', true);
  setRequestPerfField_('legacy_fallback_reason', 'read_model_missing_or_stale');
  return false;
}

function handlePost_(e) {
  try {
    beginRequestCache_();
    var payload = parsePayload_(e);
    if (e && e.parameter && e.parameter.debug_perf != null && payload.debug_perf === undefined) {
      payload.debug_perf = e.parameter.debug_perf;
    }
    var action = text_(payload.action);
    beginRequestPerf_(action, payload, e);
    var user = action === 'login' ? null : requireAuth_(payload.token);

    var kind = getApiActionKind_(action);
    if (!kind) {
      throw new Error('Unknown action: ' + action);
    }

    var ACTION_ROUTE_MAP = {
      dashboard: 'dashboard',
      dashboardSnapshot: 'dashboard',
      dashboardSheet: 'dashboard',
      deploymentInfo: 'dashboard',
      diagnosticsConsistency: 'dashboard',
      activities: 'activities',
      activityDetail: 'activities',
      week: 'week',
      month: 'month',
      exceptions: 'exceptions',
      instructors: 'instructors',
      instructorContacts: 'instructor-contacts',
      contacts: 'contacts',
      addContact: 'contacts',
      saveContact: 'contacts',
      endDates: 'end-dates',
      myData: 'my-data',
      operations: 'operations',
      operationsDetail: 'operations',
      editRequests: 'edit-requests',
      permissions: 'permissions',
      adminSettings: 'admin-settings',
      adminLists: 'admin-lists'
    };
    var routeForAction = ACTION_ROUTE_MAP[action];
    if (routeForAction && !canUserAccessRoute_(user, routeForAction)) {
      throw new Error('Forbidden');
    }

    if (kind === 'auth') {
      markRequestPerf_('action_start');
      var loginData = runWriteApiHandler_(action, user, payload);
      markRequestPerf_('action_done');
      return jsonResponse_({ ok: true, data: loginData }, {
        action: action,
        cache_hit: false
      });
    }

    if (kind === 'read') {
      beginReadOnlyApiScope_();
      try {
        if (!isReadOnlyHttpReadAction_(action, user)) {
          throw new Error('internal: read action not classified as read-only: ' + action);
        }
        if (!isReadOnlyScriptCacheableApiAction_(action, user)) {
          markRequestPerf_('cache_lookup_done');
          var healthData = runReadApiHandler_(action, user, payload);
          markRequestPerf_('action_done');
          return jsonResponse_({ ok: true, data: healthData }, {
            action: action,
            cache_hit: false
          });
        }
        var readKey = buildReadActionCacheKey_(action, user, payload);
        var readHit = scriptCacheGetJson_(readKey);
        if (readHit !== null) {
          markRequestPerf_('cache_lookup_done');
          markRequestPerf_('action_done');
          opsHealthAfterReadResponse_(action, true, readHit);
          return jsonResponse_({ ok: true, data: readHit }, {
            action: action,
            cache_hit: true
          });
        }
        markRequestPerf_('cache_lookup_done');
        // dashboardSnapshot owns its own freshness logic inside actionDashboardSnapshot_.
        // It must NOT go through materializeScreenDataFromReadModel_ (no branch there → null)
        // or the heavy-action legacy-fallback guard (which would throw READ_MODEL_UNAVAILABLE_TRY_AGAIN).
        if (action === 'dashboardSnapshot') {
          var snapshotData = runReadApiHandler_(action, user, payload);
          markRequestPerf_('action_done');
          scriptCachePutJson_(readKey, snapshotData, CONFIG.SCRIPT_CACHE_SECONDS || 900);
          opsHealthAfterReadResponse_(action, false, snapshotData);
          return jsonResponse_({ ok: true, data: snapshotData }, {
            action: action,
            cache_hit: false
          });
        }
        var readData = materializeScreenDataFromReadModel_(action, user, payload);
        if (readData !== null) {
          markRequestPerf_('action_done');
          setRequestPerfField_('read_model_screen_hit', true);
          scriptCachePutJson_(readKey, readData, CONFIG.SCRIPT_CACHE_SECONDS || 900);
          opsHealthAfterReadResponse_(action, false, readData);
          return jsonResponse_({ ok: true, data: readData }, {
            action: action,
            cache_hit: false
          });
        }
        /* Persisted read-model miss: block implicit heavy legacy fallback in normal flow. */
        if (!shouldAllowLegacyFallbackForHeavyAction_(action, payload, user)) {
          markRequestPerf_('action_done');
          throw new Error('READ_MODEL_UNAVAILABLE_TRY_AGAIN');
        }
        readData = runReadApiHandler_(action, user, payload);
        markRequestPerf_('action_done');
        scriptCachePutJson_(readKey, readData, CONFIG.SCRIPT_CACHE_SECONDS || 900);
        opsHealthAfterReadResponse_(action, false, readData);
        return jsonResponse_({ ok: true, data: readData }, {
          action: action,
          cache_hit: false
        });
      } finally {
        endReadOnlyApiScope_();
      }
    }

    if (kind === 'write') {
      markRequestPerf_('action_start');
      var writeData = runWriteApiHandler_(action, user, payload);
      if (action === 'addActivity' ||
          action === 'saveActivity' ||
          action === 'submitEditRequest' ||
          action === 'reviewEditRequest' ||
          action === 'savePermission' ||
          action === 'syncEndDates') {
        try {
          markReadModelsDirtyByMutation_(action, payload || {});
        } catch (_rmDirtyErr) {}
        try {
          markDashboardSnapshotsRefreshNeeded_('mutation:' + action);
        } catch (snapshotErr) {
          try {
            updateDashboardRefreshControl_(
              'error',
              snapshotErr && snapshotErr.message ? snapshotErr.message : String(snapshotErr)
            );
          } catch (_e) {}
        }
        try {
          bumpDataViewsCacheVersion_();
        } catch (_bumpErr) {}
        try {
          scheduleSnapshotRebuildSoon_();
        } catch (_rebuildErr) {}
      }
      markRequestPerf_('action_done');

      return jsonResponse_({
        ok: true,
        data: writeData
      }, {
        action: action,
        cache_hit: false
      });
    }

    throw new Error('internal: unhandled api kind: ' + kind);
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
