/**
 * Dashboard System backend
 * Google Apps Script Web App
 * Source of truth: Google Sheets
 *
 * Assumption:
 * Row 1 = English headers
 * Row 2 = Hebrew labels
 * Data starts at row 3
 */

const CONFIG = {
  spreadsheetId: 'REPLACE_WITH_SPREADSHEET_ID',
  headerRow: 1,
  dataStartRow: 3,
  endDateLimit: '2026-06-15',
  sheets: {
    dataShort: 'data_short',
    dataLong: 'data_long',
    meetings: 'activity_meetings',
    permissions: 'permissions',
    instructors: 'contacts_instructors',
    schools: 'contacts_schools',
    editRequests: 'edit_requests',
    privateNotes: 'operations_private_notes'
  },
  activityTypes: ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'],
  financeStatuses: ['open', 'closed'],
  editRequestStatuses: ['pending', 'approved', 'rejected']
};

function doGet() {
  return jsonResponse({
    ok: true,
    data: {
      service: 'dashboard-system',
      status: 'ready'
    }
  });
}

function doPost(e) {
  try {
    var payload = parsePayload_(e);
    var action = text_(payload.action);
    var user = action === 'login' ? null : requireAuth_(payload.token);

    var handlers = {
      login: function() { return actionLogin_(payload); },
      bootstrap: function() { return actionBootstrap_(user); },
      dashboard: function() { return actionDashboard_(user); },
      activities: function() { return actionActivities_(user, payload); },
      week: function() { return actionWeek_(user, payload); },
      month: function() { return actionMonth_(user, payload); },
      exceptions: function() { return actionExceptions_(user, payload); },
      finance: function() { return actionFinance_(user, payload); },
      instructors: function() { return actionInstructors_(user); },
      contacts: function() { return actionContacts_(user); },
      myData: function() { return actionMyData_(user); },
      permissions: function() { return actionPermissions_(user); },
      addActivity: function() { return actionAddActivity_(user, payload); },
      saveActivity: function() { return actionSaveActivity_(user, payload); },
      submitEditRequest: function() { return actionSubmitEditRequest_(user, payload); },
      reviewEditRequest: function() { return actionReviewEditRequest_(user, payload); },
      savePermission: function() { return actionSavePermission_(user, payload); },
      savePrivateNote: function() { return actionSavePrivateNote_(user, payload); }
    };

    if (!handlers[action]) {
      throw new Error('Unknown action: ' + action);
    }

    return jsonResponse({
      ok: true,
      data: handlers[action]()
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      error: error && error.message ? error.message : 'Unexpected error'
    });
  }
}

/* =========================
   Actions
========================= */

function actionLogin_(payload) {
  var userId = text_(payload.user_id || payload.userId);
  var entryCode = text_(payload.entry_code || payload.entryCode);
  if (!userId) throw new Error('user_id is required');
  if (!entryCode) throw new Error('entry_code is required');

  var permissionRows = readRows_(CONFIG.sheets.permissions);
  var match = permissionRows.find(function(row) {
    return text_(row.user_id) === userId &&
           text_(row.entry_code) === entryCode &&
           yesNo_(row.active) === 'yes';
  });

  if (!match) throw new Error('Invalid user_id or entry_code');

  var role = normalizeRole_(match.display_role);
  var user = {
    user_id: text_(match.user_id),
    full_name: text_(match.full_name),
    display_role: role,
    default_view: text_(match.default_view),
    // assumption: for instructor accounts user_id == emp_id
    emp_id: text_(match.user_id),
    name: text_(match.full_name),
    role: role
  };

  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(user), 60 * 60 * 8);

  return {
    token: token,
    user: user
  };
}

function actionBootstrap_(user) {
  var permission = getPermissionRow_(user.user_id);
  var routes = buildRoutesFromPermission_(permission, user.display_role);
  var preferred = text_(permission.default_view) || defaultRouteForRole_(user.display_role);
  var defaultRoute = routes.indexOf(preferred) >= 0 ? preferred : (routes[0] || 'my-data');

  return {
    role: user.display_role,
    default_route: defaultRoute,
    routes: routes
  };
}

function actionDashboard_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var shortRows = readRows_(CONFIG.sheets.dataShort).map(mapShortRow_);
  var longRows = buildLongRows_();
  var instructorRows = readRows_(CONFIG.sheets.instructors).filter(function(row) {
    return yesNo_(row.active) === 'yes';
  });

  var currentMonth = formatDate_(new Date()).slice(0, 7);

  var byManager = {};
  shortRows.forEach(function(row) {
    var manager = text_(row.activity_manager) || 'unassigned';
    if (!byManager[manager]) {
      byManager[manager] = {
        activity_manager: manager,
        total_short: 0,
        total_long: 0,
        total: 0
      };
    }
    byManager[manager].total_short += 1;
    byManager[manager].total += 1;
  });

  longRows.forEach(function(row) {
    var manager = text_(row.activity_manager) || 'unassigned';
    if (!byManager[manager]) {
      byManager[manager] = {
        activity_manager: manager,
        total_short: 0,
        total_long: 0,
        total: 0
      };
    }
    byManager[manager].total_long += 1;
    byManager[manager].total += 1;
  });

  var courseEndings = longRows.filter(function(row) {
    return text_(row.activity_type) === 'course' && text_(row.end_date).slice(0, 7) === currentMonth;
  }).length;

  return {
    totals: {
      total_short_activities: shortRows.length,
      total_long_activities: longRows.length,
      total_instructors: instructorRows.length,
      total_course_endings_current_month: courseEndings
    },
    by_activity_manager: Object.keys(byManager).sort().map(function(key) {
      return byManager[key];
    })
  };
}

function actionActivities_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var activityType = text_(payload.activity_type || 'all');
  var financeStatus = text_(payload.finance_status || '');
  var rows = allActivities_().filter(function(row) {
    if (activityType && activityType !== 'all' && text_(row.activity_type) !== activityType) return false;
    if (financeStatus && text_(row.finance_status) !== financeStatus) return false;
    return true;
  });

  rows.sort(function(a, b) {
    return text_(a.start_date).localeCompare(text_(b.start_date));
  });

  var noteMap = buildPrivateNotesMap_();

  return {
    rows: rows.map(function(row) {
      var noteKey = row.source_sheet + '|' + row.RowID;
      var noteRow = noteMap[noteKey];
      return {
        RowID: row.RowID,
        source_sheet: row.source_sheet,
        activity_manager: row.activity_manager,
        authority: row.authority,
        school: row.school,
        activity_type: row.activity_type,
        activity_no: row.activity_no,
        activity_name: row.activity_name,
        sessions: row.sessions,
        price: row.price,
        funding: row.funding,
        start_time: row.start_time,
        end_time: row.end_time,
        emp_id: row.emp_id,
        instructor_name: row.instructor_name,
        emp_id_2: row.emp_id_2,
        instructor_name_2: row.instructor_name_2,
        start_date: row.start_date,
        end_date: row.end_date,
        status: row.status,
        notes: row.notes,
        finance_status: row.finance_status,
        finance_notes: row.finance_notes,
        private_note: user.display_role === 'operations_reviewer' && noteRow && yesNo_(noteRow.active) === 'yes'
          ? text_(noteRow.note_text)
          : ''
      };
    }),
    filters: {
      activity_types: CONFIG.activityTypes,
      finance_statuses: CONFIG.financeStatuses
    }
  };
}

function actionWeek_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

  var today = new Date();
  var monday = mondayOfWeek_(today);
  var rows = visibleActivitiesForUser_(user);

  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = shiftDate_(monday, i);
    var key = formatDate_(d);
    days.push({
      date: key,
      items: rows.filter(function(row) {
        return key >= text_(row.start_date) && key <= text_(row.end_date || row.start_date);
      })
    });
  }

  return { days: days };
}

function actionMonth_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var rows = visibleActivitiesForUser_(user);

  var cells = [];
  for (var i = 1; i <= daysInMonth; i++) {
    var d = new Date(year, month, i);
    var key = formatDate_(d);
    cells.push({
      day: i,
      date: key,
      items: rows.filter(function(row) {
        return key >= text_(row.start_date) && key <= text_(row.end_date || row.start_date);
      })
    });
  }

  return {
    month: formatDate_(new Date()).slice(0, 7),
    cells: cells
  };
}

function actionExceptions_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var rows = buildLongRows_();
  var counts = {
    missing_instructor: 0,
    missing_start_date: 0,
    late_end_date: 0
  };
  var result = [];

  rows.forEach(function(row) {
    var exceptionType = '';
    if (!text_(row.emp_id)) {
      exceptionType = 'missing_instructor';
    } else if (!text_(row.start_date)) {
      exceptionType = 'missing_start_date';
    } else if (text_(row.end_date) > CONFIG.endDateLimit) {
      exceptionType = 'late_end_date';
    }

    if (!exceptionType) return;

    counts[exceptionType] += 1;
    result.push({
      RowID: row.RowID,
      activity_name: row.activity_name,
      end_date: row.end_date,
      exception_type: exceptionType
    });
  });

  return {
    rows: result,
    counts: counts,
    priority: ['missing_instructor', 'missing_start_date', 'late_end_date']
  };
}

function actionFinance_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  return {
    rows: allActivities_().map(function(row) {
      return {
        RowID: row.RowID,
        activity_name: row.activity_name,
        finance_status: normalizeFinance_(row.finance_status),
        status: text_(row.status),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        activity_type: text_(row.activity_type)
      };
    })
  };
}

function actionInstructors_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  return {
    rows: readRows_(CONFIG.sheets.instructors).map(function(row) {
      return {
        emp_id: text_(row.emp_id),
        full_name: text_(row.full_name),
        mobile: text_(row.mobile),
        email: text_(row.email),
        address: text_(row.address),
        employment_type: text_(row.employment_type),
        direct_manager: text_(row.direct_manager),
        active: yesNo_(row.active)
      };
    })
  };
}

function actionContacts_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var instructorRows = readRows_(CONFIG.sheets.instructors).map(function(row) {
    return {
      kind: 'instructor',
      emp_id: text_(row.emp_id),
      full_name: text_(row.full_name),
      authority: '',
      school: '',
      contact_name: '',
      phone: '',
      mobile: text_(row.mobile),
      email: text_(row.email)
    };
  });

  var schoolRows = readRows_(CONFIG.sheets.schools).map(function(row) {
    return {
      kind: 'school',
      emp_id: '',
      full_name: '',
      authority: text_(row.authority),
      school: text_(row.school),
      contact_name: text_(row.contact_name),
      phone: text_(row.phone),
      mobile: text_(row.mobile),
      email: text_(row.email)
    };
  });

  return { rows: instructorRows.concat(schoolRows) };
}

function actionMyData_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

  if (user.display_role === 'instructor') {
    var myEmpId = text_(user.emp_id || user.user_id);
    return {
      rows: allActivities_().filter(function(row) {
        return text_(row.emp_id) === myEmpId || text_(row.emp_id_2) === myEmpId;
      })
    };
  }

  return { rows: allActivities_() };
}

function actionPermissions_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);

  return {
    rows: readRows_(CONFIG.sheets.permissions).map(function(row) {
      return {
        user_id: text_(row.user_id),
        entry_code: text_(row.entry_code),
        full_name: text_(row.full_name),
        display_role: normalizeRole_(row.display_role),
        default_view: text_(row.default_view),
        view_admin: yesNo_(row.view_admin),
        view_dashboard: yesNo_(row.view_dashboard),
        view_activities: yesNo_(row.view_activities),
        view_week: yesNo_(row.view_week),
        view_month: yesNo_(row.view_month),
        view_instructors: yesNo_(row.view_instructors),
        view_exceptions: yesNo_(row.view_exceptions),
        view_my_data: yesNo_(row.view_my_data),
        view_contacts: yesNo_(row.view_contacts),
        view_finance: yesNo_(row.view_finance),
        view_permissions: yesNo_(row.view_permissions),
        can_request_edit: yesNo_(row.can_request_edit),
        can_edit_direct: yesNo_(row.can_edit_direct),
        can_add_activity: yesNo_(row.can_add_activity),
        can_review_requests: yesNo_(row.can_review_requests),
        active: yesNo_(row.active)
      };
    })
  };
}

function actionAddActivity_(user, payload) {
  if (!canDirectAdd_(user)) {
    throw new Error('Forbidden');
  }

  var targetRaw = text_(payload.target || payload.source_sheet || '');
  var targetSheet = normalizeTargetSheet_(targetRaw);
  if (!targetSheet) {
    throw new Error('Invalid target/source sheet');
  }
  var rawActivity = payload.data || payload.activity || payload.row || {};
  var activity = normalizeActivityPayload_(rawActivity, targetSheet);
  var rowId = nextId_(targetSheet, targetSheet === CONFIG.sheets.dataLong ? 'LONG-' : 'SHORT-');

  var common = {
    RowID: rowId,
    activity_manager: text_(activity.activity_manager),
    authority: text_(activity.authority),
    school: text_(activity.school),
    activity_type: text_(activity.activity_type),
    activity_no: text_(activity.activity_no),
    activity_name: text_(activity.activity_name),
    sessions: text_(activity.sessions),
    price: text_(activity.price),
    funding: text_(activity.funding),
    start_time: text_(activity.start_time),
    end_time: text_(activity.end_time),
    emp_id: text_(activity.emp_id),
    instructor_name: text_(activity.instructor_name),
    status: text_(activity.status || 'active'),
    notes: text_(activity.notes),
    finance_status: normalizeFinance_(activity.finance_status),
    finance_notes: text_(activity.finance_notes)
  };

  if (targetSheet === CONFIG.sheets.dataShort) {
    appendRow_(targetSheet, {
      RowID: common.RowID,
      activity_manager: common.activity_manager,
      authority: common.authority,
      school: common.school,
      activity_type: common.activity_type,
      activity_no: common.activity_no,
      activity_name: common.activity_name,
      sessions: common.sessions,
      price: common.price,
      funding: common.funding,
      start_time: common.start_time,
      end_time: common.end_time,
      emp_id: common.emp_id,
      instructor_name: common.instructor_name,
      emp_id_2: text_(activity.emp_id_2),
      instructor_name_2: text_(activity.instructor_name_2),
      start_date: text_(activity.start_date),
      status: common.status,
      notes: common.notes,
      finance_status: common.finance_status,
      finance_notes: common.finance_notes
    });
  } else {
    appendRow_(targetSheet, {
      RowID: common.RowID,
      activity_manager: common.activity_manager,
      authority: common.authority,
      school: common.school,
      activity_type: common.activity_type,
      activity_no: common.activity_no,
      activity_name: common.activity_name,
      sessions: common.sessions,
      price: common.price,
      funding: common.funding,
      start_time: common.start_time,
      end_time: common.end_time,
      emp_id: common.emp_id,
      instructor_name: common.instructor_name,
      start_date: text_(activity.start_date),
      end_date: text_(activity.end_date),
      status: common.status,
      notes: common.notes,
      finance_status: common.finance_status,
      finance_notes: common.finance_notes
    });

    if (Array.isArray(rawActivity.meetings) && rawActivity.meetings.length) {
      setMeetings_(rowId, rawActivity.meetings);
    } else {
      setMeetingsFromRange_(rowId, text_(activity.start_date), text_(activity.end_date));
    }
  }

  return {
    created: true,
    RowID: rowId,
    source_sheet: targetSheet
  };
}

function actionSaveActivity_(user, payload) {
  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = resolveSourceSheet_(sourceRowId, payload.source_sheet);
  var rawChanges = payload.changes || payload.data || {};
  var changes = normalizeActivityPayload_(rawChanges, sourceSheet);

  if (!sourceRowId) throw new Error('source_row_id is required');
  if (!sourceSheet) throw new Error('Invalid source sheet');

  if (user.display_role === 'authorized_user') {
    return actionSubmitEditRequest_(user, {
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      changes: rawChanges
    });
  }
  if (!canDirectEdit_(user)) throw new Error('Forbidden');

  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);

  if (sourceSheet === CONFIG.sheets.dataLong) {
    if (Array.isArray(rawChanges.meetings)) {
      setMeetings_(sourceRowId, rawChanges.meetings);
    } else if (changes.start_date || changes.end_date) {
      if (!hasActiveMeetings_(sourceRowId)) {
        setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
      }
    }
  }

  return {
    updated: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

function actionSubmitEditRequest_(user, payload) {
  requireAnyRole_(user, ['authorized_user']);

  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = resolveSourceSheet_(sourceRowId, payload.source_sheet);
  var rawChanges = payload.changes || payload.data || {};
  var changes = normalizeActivityPayload_(rawChanges, sourceSheet);

  if (!sourceRowId) throw new Error('source_row_id is required');
  if (!sourceSheet) throw new Error('Invalid source sheet');
  if (sourceRowId.indexOf('SHORT-') !== 0 && sourceRowId.indexOf('LONG-') !== 0) {
    throw new Error('Invalid source_row_id');
  }
  if (!Object.keys(changes).length) throw new Error('No valid editable fields in changes');

  var currentRow = getRowByKey_(sourceSheet, 'RowID', sourceRowId);
  var requestId = 'REQ-' + new Date().getTime();

  Object.keys(changes).forEach(function(fieldName) {
    appendRow_(CONFIG.sheets.editRequests, {
      request_id: requestId,
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      field_name: fieldName,
      old_value: text_(currentRow[fieldName]),
      new_value: text_(changes[fieldName]),
      requested_by_user_id: text_(user.user_id),
      requested_by_name: text_(user.full_name),
      requested_at: new Date().toISOString(),
      status: 'pending',
      reviewed_at: '',
      reviewed_by: '',
      reviewer_notes: '',
      active: 'yes'
    });
  });

  return {
    created: true,
    request_id: requestId
  };
}

function actionReviewEditRequest_(user, payload) {
  requireAnyRole_(user, ['operations_reviewer']);

  var requestId = text_(payload.request_id);
  var status = text_(payload.status).toLowerCase();
  var reviewerNotes = text_(payload.reviewer_notes);

  if (!requestId) throw new Error('request_id is required');
  if (CONFIG.editRequestStatuses.indexOf(status) < 0 || status === 'pending') {
    throw new Error('Invalid review status');
  }

  var rows = readRows_(CONFIG.sheets.editRequests);
  var requestRows = rows.filter(function(row) {
    return text_(row.request_id) === requestId;
  });

  if (!requestRows.length) throw new Error('Request not found');

  if (status === 'approved') {
    var sourceSheet = text_(requestRows[0].source_sheet);
    var sourceRowId = text_(requestRows[0].source_row_id);
    var changes = {};

    requestRows.forEach(function(row) {
      changes[text_(row.field_name)] = text_(row.new_value);
    });

    updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);

    if (sourceSheet === CONFIG.sheets.dataLong && (changes.start_date || changes.end_date)) {
      if (!hasActiveMeetings_(sourceRowId)) {
        setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
      }
    }
  }

  updateEditRequestRows_(requestId, {
    status: status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: text_(user.user_id),
    reviewer_notes: reviewerNotes
  });

  return {
    reviewed: true,
    request_id: requestId,
    status: status
  };
}

function actionSavePermission_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer']);

  var row = payload.permission || payload.row || {};
  var userId = text_(row.user_id);
  if (!userId) throw new Error('user_id is required');

  var existing = getPermissionRow_(userId);

  var normalized = {
    user_id: userId,
    entry_code: text_(row.entry_code || existing.entry_code),
    full_name: text_(row.full_name || existing.full_name),
    display_role: normalizeRole_(row.display_role || existing.display_role),
    default_view: text_(row.default_view || existing.default_view),
    view_admin: pickYesNo_(row, 'view_admin', existing),
    view_dashboard: pickYesNo_(row, 'view_dashboard', existing),
    view_activities: pickYesNo_(row, 'view_activities', existing),
    view_week: pickYesNo_(row, 'view_week', existing),
    view_month: pickYesNo_(row, 'view_month', existing),
    view_instructors: pickYesNo_(row, 'view_instructors', existing),
    view_exceptions: pickYesNo_(row, 'view_exceptions', existing),
    view_my_data: pickYesNo_(row, 'view_my_data', existing),
    view_contacts: pickYesNo_(row, 'view_contacts', existing),
    view_finance: pickYesNo_(row, 'view_finance', existing),
    view_permissions: pickYesNo_(row, 'view_permissions', existing),
    can_request_edit: pickYesNo_(row, 'can_request_edit', existing),
    can_edit_direct: pickYesNo_(row, 'can_edit_direct', existing),
    can_add_activity: pickYesNo_(row, 'can_add_activity', existing),
    can_review_requests: pickYesNo_(row, 'can_review_requests', existing),
    active: yesNo_(row.active || existing.active)
  };

  upsertRowByKey_(CONFIG.sheets.permissions, 'user_id', normalized);

  return {
    saved: true,
    user_id: userId
  };
}

function actionSavePrivateNote_(user, payload) {
  requireAnyRole_(user, ['operations_reviewer']);
  var sourceSheet = text_(payload.source_sheet);
  var sourceRowId = text_(payload.source_row_id);
  var noteText = text_(payload.note_text || payload.note || payload.value);

  if (!sourceSheet && sourceRowId) {
    sourceSheet = resolveSourceSheet_(sourceRowId, '');
  }

  if (!sourceSheet || !sourceRowId) throw new Error('source_sheet and source_row_id are required');

  var existing = getPrivateNoteRow_(sourceSheet, sourceRowId);

  var row = {
    source_sheet: sourceSheet,
    source_row_id: sourceRowId,
    note_text: noteText,
    updated_at: new Date().toISOString(),
    updated_by: text_(user.user_id),
    active: existing ? yesNo_(existing.active || 'yes') : 'yes'
  };

  upsertPrivateNoteRow_(row);

  return {
    saved: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

/* =========================
   Normalized datasets
========================= */

function allActivities_() {
  return readRows_(CONFIG.sheets.dataShort).map(mapShortRow_).concat(buildLongRows_());
}

function visibleActivitiesForUser_(user) {
  if (user.display_role !== 'instructor') return allActivities_();

  var empId = text_(user.emp_id || user.user_id);
  return allActivities_().filter(function(row) {
    return text_(row.emp_id) === empId || text_(row.emp_id_2) === empId;
  });
}

function buildLongRows_() {
  var rows = readRows_(CONFIG.sheets.dataLong).map(mapLongRow_);
  var meetingsByRow = buildMeetingsMap_();

  return rows.map(function(row) {
    var dates = meetingsByRow[row.RowID] || [];
    if (dates.length) {
      row.start_date = dates[0];
      row.end_date = dates[dates.length - 1];
    }
    return row;
  });
}

function mapShortRow_(row) {
  return {
    source_sheet: CONFIG.sheets.dataShort,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
    activity_type: text_(row.activity_type),
    activity_no: text_(row.activity_no),
    activity_name: text_(row.activity_name),
    sessions: text_(row.sessions),
    price: text_(row.price),
    funding: text_(row.funding),
    start_time: text_(row.start_time),
    end_time: text_(row.end_time),
    emp_id: text_(row.emp_id),
    instructor_name: text_(row.instructor_name),
    emp_id_2: text_(row.emp_id_2),
    instructor_name_2: text_(row.instructor_name_2),
    start_date: text_(row.start_date),
    end_date: text_(row.start_date),
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes)
  };
}

function mapLongRow_(row) {
  return {
    source_sheet: CONFIG.sheets.dataLong,
    RowID: text_(row.RowID),
    activity_manager: text_(row.activity_manager),
    authority: text_(row.authority),
    school: text_(row.school),
    activity_type: text_(row.activity_type),
    activity_no: text_(row.activity_no),
    activity_name: text_(row.activity_name),
    sessions: text_(row.sessions),
    price: text_(row.price),
    funding: text_(row.funding),
    start_time: text_(row.start_time),
    end_time: text_(row.end_time),
    emp_id: text_(row.emp_id),
    instructor_name: text_(row.instructor_name),
    emp_id_2: '',
    instructor_name_2: '',
    start_date: text_(row.start_date),
    end_date: text_(row.end_date),
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes)
  };
}

/* =========================
   Permissions and notes
========================= */

function getPermissionRow_(userId) {
  var rows = readRows_(CONFIG.sheets.permissions);
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

  var allRoutes = ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance', 'permissions'];

  return allRoutes.filter(function(route) {
    if (route === 'permissions' && !(role === 'admin' || role === 'operations_reviewer')) return false;
    if (route === 'my-data' && role === 'instructor') return true;
    return yesNo_(permission[map[route]]) === 'yes' || route === 'my-data';
  });
}

function defaultRouteForRole_(role) {
  return role === 'instructor' ? 'my-data' : 'dashboard';
}

function buildPrivateNotesMap_() {
  var rows = readRows_(CONFIG.sheets.privateNotes);
  var map = {};
  rows.forEach(function(row) {
    var key = text_(row.source_sheet) + '|' + text_(row.source_row_id);
    map[key] = row;
  });
  return map;
}

function getPrivateNoteRow_(sourceSheet, sourceRowId) {
  var rows = readRows_(CONFIG.sheets.privateNotes);
  var match = rows.find(function(row) {
    return text_(row.source_sheet) === text_(sourceSheet) &&
           text_(row.source_row_id) === text_(sourceRowId);
  });
  return match || null;
}

/* =========================
   Meetings
========================= */

function buildMeetingsMap_() {
  var rows = readRows_(CONFIG.sheets.meetings).filter(function(row) {
    return yesNo_(row.active) === 'yes';
  });

  var map = {};
  rows.forEach(function(row) {
    var key = text_(row.source_row_id);
    var date = text_(row.meeting_date);
    if (!key || !date) return;
    if (!map[key]) map[key] = [];
    map[key].push(date);
  });

  Object.keys(map).forEach(function(key) {
    map[key].sort();
  });

  return map;
}

function setMeetings_(sourceRowId, meetings) {
  var cleaned = (meetings || []).map(function(item, idx) {
    if (typeof item === 'string') {
      return {
        source_row_id: sourceRowId,
        meeting_no: String(idx + 1),
        meeting_date: text_(item),
        notes: '',
        active: 'yes'
      };
    }
    return {
      source_row_id: sourceRowId,
      meeting_no: text_(item.meeting_no || String(idx + 1)),
      meeting_date: text_(item.meeting_date),
      notes: text_(item.notes),
      active: yesNo_(item.active || 'yes')
    };
  }).filter(function(item) {
    return !!text_(item.meeting_date);
  });

  var existing = readRowsWithMeta_(CONFIG.sheets.meetings).filter(function(row) {
    return text_(row.data.source_row_id) === text_(sourceRowId);
  });

  var usedRowNumbers = {};
  cleaned.forEach(function(item) {
    var match = existing.find(function(existingRow) {
      return text_(existingRow.data.meeting_no) === text_(item.meeting_no) && !usedRowNumbers[existingRow.rowNumber];
    });

    if (match) {
      writeRowAt_(CONFIG.sheets.meetings, match.rowNumber, item);
      usedRowNumbers[match.rowNumber] = true;
      return;
    }
    appendRow_(CONFIG.sheets.meetings, item);
  });

  existing.forEach(function(existingRow) {
    if (usedRowNumbers[existingRow.rowNumber]) return;
    var patch = {};
    Object.keys(existingRow.data).forEach(function(key) {
      patch[key] = existingRow.data[key];
    });
    patch.active = 'no';
    writeRowAt_(CONFIG.sheets.meetings, existingRow.rowNumber, patch);
  });
}

function setMeetingsFromRange_(sourceRowId, startDate, endDate) {
  var rows = [];
  if (text_(startDate)) {
    rows.push({
      source_row_id: sourceRowId,
      meeting_no: '1',
      meeting_date: text_(startDate),
      notes: '',
      active: 'yes'
    });
  }
  if (text_(endDate) && text_(endDate) !== text_(startDate)) {
    rows.push({
      source_row_id: sourceRowId,
      meeting_no: '2',
      meeting_date: text_(endDate),
      notes: '',
      active: 'yes'
    });
  }
  setMeetings_(sourceRowId, rows);
}

/* =========================
   Sheet CRUD helpers
========================= */

function readRows_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.dataStartRow) return [];

  var headers = sheet.getRange(CONFIG.headerRow, 1, 1, lastCol).getValues()[0].map(text_);
  var values = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, lastCol).getValues();

  return values.filter(function(row) {
    return row.some(function(cell) { return text_(cell) !== ''; });
  }).map(function(row) {
    var item = {};
    headers.forEach(function(header, idx) {
      item[header] = row[idx];
    });
    return item;
  });
}

function readRowsWithMeta_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < CONFIG.dataStartRow) return [];

  var headers = sheet.getRange(CONFIG.headerRow, 1, 1, lastCol).getValues()[0].map(text_);
  var values = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, lastCol).getValues();

  return values.map(function(row, idx) {
    var item = {};
    headers.forEach(function(header, headerIdx) {
      item[header] = row[headerIdx];
    });
    return {
      rowNumber: CONFIG.dataStartRow + idx,
      data: item
    };
  }).filter(function(entry) {
    return Object.keys(entry.data).some(function(key) { return text_(entry.data[key]) !== ''; });
  });
}

function appendRow_(sheetName, rowObj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : '';
  });
  sheet.appendRow(row);
}

function writeRowAt_(sheetName, rowNumber, rowObj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var row = headers.map(function(header) {
    return Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : '';
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
}

function getRowByKey_(sheetName, keyField, keyValue) {
  var rows = readRows_(sheetName);
  var match = rows.find(function(row) {
    return text_(row[keyField]) === text_(keyValue);
  });
  if (!match) throw new Error('Row not found: ' + keyValue);
  return match;
}

function updateRowByKey_(sheetName, keyField, keyValue, changes) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var rows = readRows_(sheetName);
  var index = rows.findIndex(function(row) {
    return text_(row[keyField]) === text_(keyValue);
  });

  if (index < 0) throw new Error('Row not found: ' + keyValue);

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(changes, header)
      ? changes[header]
      : rows[index][header];
  });

  var rowNumber = CONFIG.dataStartRow + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function upsertRowByKey_(sheetName, keyField, rowObj) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaders_(sheet);
  var rows = readRows_(sheetName);
  var index = rows.findIndex(function(row) {
    return text_(row[keyField]) === text_(rowObj[keyField]);
  });

  if (index < 0) {
    appendRow_(sheetName, rowObj);
    return;
  }

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : rows[index][header];
  });

  var rowNumber = CONFIG.dataStartRow + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function upsertPrivateNoteRow_(rowObj) {
  var sheet = getSheet_(CONFIG.sheets.privateNotes);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.sheets.privateNotes);
  var index = rows.findIndex(function(row) {
    return text_(row.source_sheet) === text_(rowObj.source_sheet) &&
           text_(row.source_row_id) === text_(rowObj.source_row_id);
  });

  if (index < 0) {
    appendRow_(CONFIG.sheets.privateNotes, rowObj);
    return;
  }

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : rows[index][header];
  });

  var rowNumber = CONFIG.dataStartRow + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
}

function updateEditRequestRows_(requestId, patch) {
  var sheet = getSheet_(CONFIG.sheets.editRequests);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.sheets.editRequests);

  rows.forEach(function(row, idx) {
    if (text_(row.request_id) !== text_(requestId)) return;

    var updated = {};
    headers.forEach(function(header) {
      updated[header] = Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : row[header];
    });

    var rowNumber = CONFIG.dataStartRow + idx;
    var values = headers.map(function(header) { return updated[header]; });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  });
}

function nextId_(sheetName, prefix) {
  var keyField = 'RowID';
  var rows = readRows_(sheetName);
  var max = 0;

  rows.forEach(function(row) {
    var raw = text_(row[keyField]);
    if (raw.indexOf(prefix) !== 0) return;
    var n = parseInt(raw.replace(prefix, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });

  return prefix + ('000' + (max + 1)).slice(-3);
}

function getSheet_(sheetName) {
  var spreadsheet = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing sheet: ' + sheetName);
  return sheet;
}

function getHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (!lastCol) throw new Error('Missing headers in sheet: ' + sheet.getName());
  return sheet.getRange(CONFIG.headerRow, 1, 1, lastCol).getValues()[0].map(text_);
}

/* =========================
   Auth / role helpers
========================= */

function requireAuth_(token) {
  var value = text_(token);
  if (!value) throw new Error('Unauthorized');

  var raw = CacheService.getScriptCache().get('session:' + value);
  if (!raw) throw new Error('Unauthorized');

  return JSON.parse(raw);
}

function requireAnyRole_(user, roles) {
  if (!user || roles.indexOf(user.display_role) < 0) {
    throw new Error('Forbidden');
  }
}

function canDirectEdit_(user) {
  return user && (user.display_role === 'admin' || user.display_role === 'operations_reviewer');
}

function canDirectAdd_(user) {
  return canDirectEdit_(user);
}

/* =========================
   Normalization helpers
========================= */

function normalizeRole_(value) {
  var role = text_(value).toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'operations_reviewer' || role === 'operations reviewer') return 'operations_reviewer';
  if (role === 'authorized_user' || role === 'authorized user') return 'authorized_user';
  if (role === 'instructor') return 'instructor';
  throw new Error('Invalid role: ' + role);
}

function normalizeFinance_(value) {
  return text_(value).toLowerCase() === 'closed' ? 'closed' : 'open';
}

function yesNo_(value) {
  return text_(value).toLowerCase() === 'no' ? 'no' : 'yes';
}

function pickYesNo_(input, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
    return yesNo_(input[key]);
  }
  return yesNo_(fallback[key]);
}

function normalizeTargetSheet_(value) {
  var textValue = text_(value);
  if (textValue === CONFIG.sheets.dataShort || textValue.toLowerCase() === 'short') return CONFIG.sheets.dataShort;
  if (textValue === CONFIG.sheets.dataLong || textValue.toLowerCase() === 'long') return CONFIG.sheets.dataLong;
  return '';
}

function resolveSourceSheet_(sourceRowId, sourceSheetHint) {
  var normalizedHint = normalizeTargetSheet_(sourceSheetHint);
  if (normalizedHint) return normalizedHint;
  if (text_(sourceRowId).indexOf('LONG-') === 0) return CONFIG.sheets.dataLong;
  if (text_(sourceRowId).indexOf('SHORT-') === 0) return CONFIG.sheets.dataShort;
  return '';
}

function normalizeActivityPayload_(raw, sourceSheet) {
  var payload = raw || {};
  var map = {
    activity_manager: payload.activity_manager,
    authority: payload.authority,
    school: payload.school,
    activity_type: payload.activity_type,
    activity_no: payload.activity_no,
    activity_name: payload.activity_name,
    sessions: payload.sessions,
    price: payload.price,
    funding: payload.funding,
    start_time: payload.start_time,
    end_time: payload.end_time,
    emp_id: payload.emp_id,
    instructor_name: payload.instructor_name,
    start_date: payload.start_date,
    status: payload.status,
    notes: payload.notes,
    finance_status: payload.finance_status,
    finance_notes: payload.finance_notes
  };

  if (sourceSheet === CONFIG.sheets.dataShort) {
    map.emp_id_2 = payload.emp_id_2;
    map.instructor_name_2 = payload.instructor_name_2;
  }
  if (sourceSheet === CONFIG.sheets.dataLong) {
    map.end_date = payload.end_date;
  }

  var cleaned = {};
  Object.keys(map).forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(map, key)) return;
    if (map[key] === undefined) return;
    if (key === 'finance_status') {
      cleaned[key] = normalizeFinance_(map[key]);
      return;
    }
    cleaned[key] = text_(map[key]);
  });

  return cleaned;
}

function hasActiveMeetings_(sourceRowId) {
  var rows = readRows_(CONFIG.sheets.meetings);
  return rows.some(function(row) {
    return text_(row.source_row_id) === text_(sourceRowId) && yesNo_(row.active) === 'yes';
  });
}

function text_(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate_(value);
  return String(value).trim();
}

/* =========================
   Date helpers
========================= */

function mondayOfWeek_(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var day = d.getDay();
  var diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function shiftDate_(date, days) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function formatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* =========================
   Response helpers
========================= */

function parsePayload_(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw || '{}');
}

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
