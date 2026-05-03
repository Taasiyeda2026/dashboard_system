/**
 * HTTP API routing metadata: read-only vs mutating actions.
 * Read actions run under beginReadOnlyApiScope_(); assertMutationAllowedInCurrentRequest_
 * blocks sheet/cache invalidation helpers if invoked accidentally from that scope.
 */

var __readOnlyApiScopeDepth_ = 0;

function beginReadOnlyApiScope_() {
  __readOnlyApiScopeDepth_++;
}

function endReadOnlyApiScope_() {
  __readOnlyApiScopeDepth_ = Math.max(0, __readOnlyApiScopeDepth_ - 1);
}

function isReadOnlyApiScopeActive_() {
  return __readOnlyApiScopeDepth_ > 0;
}

/**
 * Throws if a data-mutation side path runs while serving a read-only API action.
 * Does not apply to ScriptCache puts for read response caching.
 */
function assertMutationAllowedInCurrentRequest_(label) {
  if (!isReadOnlyApiScopeActive_()) return;
  try {
    console.error('[api] blocked mutation during read-only request', JSON.stringify({ label: text_(label) }));
  } catch (e) {}
  throw new Error('internal: mutation_in_read_only_scope');
}

/** Side-effect-free reads: script-cacheable, no post-handler mutation hooks. */
var READ_ONLY_API_ACTIONS_MAP_ = {
  bootstrap: true,
  readModelManifest: true,
  readModelGet: true,
  readModelHealth: true,
  dashboard: true,
  dashboardSnapshot: true,
  dashboardSheet: true,
  deploymentInfo: true,
  diagnosticsConsistency: true,
  activities: true,
  activityDetail: true,
  week: true,
  month: true,
  exceptions: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  adminSettings: true,
  adminLists: true,
  listSheets: true,
  health_check: true
};

/** Mutations, auth, and admin refresh jobs — never use read-model cache path. */
var WRITE_API_ACTIONS_MAP_ = {
  login: true,
  refreshAllReadModels: true,
  addContact: true,
  saveContact: true,
  addActivity: true,
  saveActivity: true,
  submitEditRequest: true,
  reviewEditRequest: true,
  savePermission: true,
  addUser: true,
  deactivateUser: true,
  reactivateUser: true,
  deleteUser: true,
  savePrivateNote: true,
  syncEndDates: true,
  refreshDataViews: true
};

/**
 * @return {'auth'|'read'|'write'|''}
 */
function getApiActionKind_(action) {
  var a = text_(action);
  if (a === 'login') return 'auth';
  if (READ_ONLY_API_ACTIONS_MAP_[a]) return 'read';
  if (WRITE_API_ACTIONS_MAP_[a]) return 'write';
  return '';
}

/** Any authenticated read-only API action (includes health_check). */
function isReadOnlyHttpReadAction_(action, user) {
  if (!user) return false;
  return !!READ_ONLY_API_ACTIONS_MAP_[text_(action)];
}

/** Subset that may use ScriptCache for response bodies (excludes health_check for live metrics). */
function isReadOnlyScriptCacheableApiAction_(action, user) {
  if (!isReadOnlyHttpReadAction_(action, user)) return false;
  return text_(action) !== 'health_check';
}

/**
 * Explicit allow-list for read handlers that may run the heavy sheet-backed path.
 * Keep in sync with READ_API_HANDLER_FACTORIES_ — add new read actions here when adding a factory.
 */
var LEGACY_READ_DISPATCH_ALLOWLIST_ = {
  bootstrap: true,
  readModelManifest: true,
  readModelGet: true,
  readModelHealth: true,
  dashboard: true,
  dashboardSnapshot: true,
  dashboardSheet: true,
  deploymentInfo: true,
  diagnosticsConsistency: true,
  activities: true,
  activityDetail: true,
  week: true,
  month: true,
  exceptions: true,
  instructors: true,
  instructorContacts: true,
  contacts: true,
  endDates: true,
  myData: true,
  operations: true,
  operationsDetail: true,
  editRequests: true,
  permissions: true,
  adminSettings: true,
  adminLists: true,
  listSheets: true,
  health_check: true
};

function warnLegacyReadDispatchIfNotAllowlisted_(action) {
  var a = text_(action);
  if (LEGACY_READ_DISPATCH_ALLOWLIST_[a]) return;
  try {
    console.warn('[legacy-allowlist]', JSON.stringify({
      action: a,
      screen: a,
      reason: 'read_dispatch_not_on_legacy_allowlist',
      caller: 'router_read_path_runReadApiHandler_'
    }));
  } catch (e) {}
}

function runReadApiHandler_(action, user, payload) {
  var a = text_(action);
  warnLegacyReadDispatchIfNotAllowlisted_(a);
  var fn = READ_API_HANDLER_FACTORIES_[a];
  if (!fn) throw new Error('internal: missing read handler for ' + a);
  return fn(user, payload);
}

function runWriteApiHandler_(action, user, payload) {
  var a = text_(action);
  var fn = WRITE_API_HANDLER_FACTORIES_[a];
  if (!fn) throw new Error('internal: missing write handler for ' + a);
  return fn(user, payload);
}

var READ_API_HANDLER_FACTORIES_ = {
  bootstrap: function(u, p) {
    return actionBootstrap_(u);
  },
  readModelManifest: function(u, p) {
    return actionReadModelManifest_(u);
  },
  readModelGet: function(u, p) {
    return actionReadModelGet_(u, p);
  },
  readModelHealth: function(u, p) {
    requireAnyRole_(u, ['admin', 'operation_manager']);
    return getReadModelHealth_();
  },
  dashboard: function(u, p) {
    return actionDashboard_(u, p);
  },
  dashboardSnapshot: function(u, p) {
    return actionDashboardSnapshot_(u, p);
  },
  dashboardSheet: function(u, p) {
    try {
      return actionDashboardSheet_(u, p);
    } catch (err) {
      try {
        console.warn('[dashboardSheet] fallback to dashboardSnapshot', JSON.stringify({
          error: err && err.message ? String(err.message) : String(err)
        }));
      } catch (_logErr) {}
      var fallback = actionDashboardSnapshot_(u, p || {});
      if (fallback && typeof fallback === 'object') {
        fallback._dashboard_sheet_failed = true;
        fallback._dashboard_sheet_fallback = 'dashboardSnapshot';
        fallback._dashboard_sheet_error = err && err.message ? String(err.message) : String(err);
      }
      setRequestPerfField_('dashboard_sheet_fallback_used', true);
      return fallback;
    }
  },
  deploymentInfo: function(u, p) {
    return actionDeploymentInfo_(u);
  },
  diagnosticsConsistency: function(u, p) {
    return actionDiagnosticsConsistency_(u, p);
  },
  activities: function(u, p) {
    return actionActivitiesSnapshotFirst_(u, p);
  },
  activityDetail: function(u, p) {
    return actionActivityDetail_(u, p);
  },
  week: function(u, p) {
    return actionWeek_(u, p);
  },
  month: function(u, p) {
    return actionMonth_(u, p);
  },
  exceptions: function(u, p) {
    return actionExceptions_(u, p);
  },
  finance: function(u, p) {
    return actionFinance_(u, p);
  },
  financeDetail: function(u, p) {
    return actionFinanceDetail_(u, p);
  },
  instructors: function(u, p) {
    return actionInstructors_(u);
  },
  instructorContacts: function(u, p) {
    return actionInstructorContacts_(u);
  },
  contacts: function(u, p) {
    return actionContacts_(u, p);
  },
  endDates: function(u, p) {
    return actionEndDates_(u);
  },
  myData: function(u, p) {
    return actionMyData_(u);
  },
  operations: function(u, p) {
    return actionOperations_(u, p);
  },
  operationsDetail: function(u, p) {
    return actionOperationsDetail_(u, p);
  },
  editRequests: function(u, p) {
    return actionEditRequests_(u);
  },
  permissions: function(u, p) {
    return actionPermissions_(u);
  },
  adminSettings: function(u, p) {
    return actionAdminSettings_(u);
  },
  adminLists: function(u, p) {
    return actionAdminLists_(u);
  },
  listSheets: function(u, p) {
    return actionListSheets_(u);
  },
  health_check: function(u, p) {
    return actionHealthCheck_(u);
  }
};


var WRITE_API_HANDLER_FACTORIES_ = {
  login: function(u, p) {
    return actionLogin_(p);
  },
  refreshAllReadModels: function(u, p) {
    requireAnyRole_(u, ['admin', 'operation_manager']);
    return refreshAllReadModels_();
  },
  addContact: function(u, p) {
    return actionAddContact_(u, p);
  },
  saveContact: function(u, p) {
    return actionSaveContact_(u, p);
  },
  addActivity: function(u, p) {
    return actionAddActivity_(u, p);
  },
  saveActivity: function(u, p) {
    return actionSaveActivity_(u, p);
  },
  submitEditRequest: function(u, p) {
    return actionSubmitEditRequest_(u, p);
  },
  reviewEditRequest: function(u, p) {
    return actionReviewEditRequest_(u, p);
  },
  savePermission: function(u, p) {
    return actionSavePermission_(u, p);
  },
  addUser: function(u, p) {
    return actionAddUser_(u, p);
  },
  deactivateUser: function(u, p) {
    return actionDeactivateUser_(u, p);
  },
  reactivateUser: function(u, p) {
    return actionReactivateUser_(u, p);
  },
  deleteUser: function(u, p) {
    return actionDeleteUser_(u, p);
  },
  savePrivateNote: function(u, p) {
    return actionSavePrivateNote_(u, p);
  },
  saveFinanceRow: function(u, p) {
    return actionSaveFinanceRow_(u, p);
  },
  syncFinance: function(u, p) {
    return actionSyncFinance_(u, p);
  },
  syncEndDates: function(u, p) {
    return actionSyncEndDates_(u, p);
  },
  refreshDataViews: function(u, p) {
    return actionRefreshDataViews_(u);
  }
};
