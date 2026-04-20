function actionBootstrap_(user) {
  var permission = getPermissionRow_(user.user_id);
  var routes = buildRoutesFromPermission_(permission, user.display_role);
  var preferred = text_(permission.default_view) || defaultRouteForRole_(user.display_role);
  var defaultRoute = resolveDefaultRoute_(preferred, routes, user.display_role);

  return {
    role: user.display_role,
    default_route: defaultRoute,
    routes: routes,
    profile: {
      full_name: text_(permission.full_name),
      display_role2: text_(permission.display_role2)
    },
    client_settings: buildClientSettingsPayload_()
  };
}

function dashboardPayloadYm_(payload) {
  var m = text_(payload && payload.month).slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(m)) return m;
  return formatDate_(new Date()).slice(0, 7);
}

function ymBounds_(ym) {
  var parts = String(ym || '').split('-');
  var y = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10);
  var tz = Session.getScriptTimeZone();
  if (!y || !mo || mo < 1 || mo > 12) {
    var today = formatDate_(new Date());
    return { first: today.slice(0, 8) + '01', last: today };
  }
  var first = Utilities.formatDate(new Date(y, mo - 1, 1), tz, 'yyyy-MM-dd');
  var last = Utilities.formatDate(new Date(y, mo, 0), tz, 'yyyy-MM-dd');
  return { first: first, last: last };
}

function activityOverlapsYm_(row, ym) {
  var b = ymBounds_(ym);
  var s = text_(row.start_date);
  var e = text_(row.end_date || row.start_date);
  if (!s) return false;
  if (!e) e = s;
  return s <= b.last && e >= b.first;
}

function dashboardActivityRefIso_(ym) {
  var today = formatDate_(new Date());
  var curYm = today.slice(0, 7);
  var b = ymBounds_(ym);
  if (ym === curYm) return today;
  if (ym < curYm) return b.last;
  return b.first;
}

function actionDashboard_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var ym = dashboardPayloadYm_(payload || {});
  var cacheKey = [SCRIPT_CACHE_KEY_DASHBOARD, dataViewsCacheVersion_(), ym].join(':');

  var cachedDash = scriptCacheGetJson_(cacheKey);
  if (cachedDash) {
    return cachedDash;
  }

  var shortAll = readRows_(CONFIG.SHEETS.DATA_SHORT).map(mapShortRow_);
  var longAll = buildLongRows_();
  var shortRows = shortAll.filter(function(row) {
    return activityOverlapsYm_(row, ym);
  });
  var longRows = longAll.filter(function(row) {
    return activityOverlapsYm_(row, ym);
  });
  var instructorRows = readRows_(CONFIG.SHEETS.INSTRUCTORS).filter(function(row) {
    return yesNo_(row.active) === 'yes';
  });

  var refIso = dashboardActivityRefIso_(ym);
  var combined = shortRows.concat(longRows);

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
    return text_(row.activity_type) === 'course' && text_(row.end_date).slice(0, 7) === ym;
  }).length;

  var activeByType = {
    course: 0,
    workshop: 0,
    tour: 0,
    after_school: 0,
    escape_room: 0
  };
  var financeOpenCount = 0;
  var exceptionSum = 0;
  combined.forEach(function(row) {
    if (normalizeFinance_(row.finance_status) === 'open') {
      financeOpenCount += 1;
    }
    if (Object.prototype.hasOwnProperty.call(activeByType, text_(row.activity_type)) &&
        isActivityActiveBySpec_(row, refIso)) {
      activeByType[text_(row.activity_type)] += 1;
    }
  });

  longRows.forEach(function(row) {
    if (!text_(row.emp_id)) {
      exceptionSum += 1;
    } else if (!text_(row.start_date)) {
      exceptionSum += 1;
    } else if (text_(row.end_date) > getLateEndDateCutoff_()) {
      exceptionSum += 1;
    }
  });

  var kpi_cards = [
    { id: 'short', action: 'kpi|short', title: String(shortRows.length), subtitle: 'פעילויות קצרות', value: shortRows.length },
    { id: 'long', action: 'kpi|long', title: String(longRows.length), subtitle: 'פעילויות ארוכות', value: longRows.length },
    {
      id: 'active_courses',
      action: 'kpi|active_courses',
      title: String(activeByType.course),
      subtitle: 'קורסים פעילים',
      value: activeByType.course
    },
    {
      id: 'active_workshops',
      action: 'kpi|active_workshops',
      title: String(activeByType.workshop),
      subtitle: 'סדנאות פעילות',
      value: activeByType.workshop
    },
    {
      id: 'active_tours',
      action: 'kpi|active_tours',
      title: String(activeByType.tour),
      subtitle: 'סיורים פעילים',
      value: activeByType.tour
    },
    {
      id: 'active_after_school',
      action: 'kpi|active_after_school',
      title: String(activeByType.after_school),
      subtitle: 'אפטרסקול פעיל',
      value: activeByType.after_school
    },
    {
      id: 'active_escape_room',
      action: 'kpi|active_escape_room',
      title: String(activeByType.escape_room),
      subtitle: 'חדרי בריחה פעילים',
      value: activeByType.escape_room
    },
    {
      id: 'finance_open',
      action: 'kpi|finance_open',
      title: String(financeOpenCount),
      subtitle: 'כספים פתוחים',
      value: financeOpenCount
    },
    {
      id: 'exceptions',
      action: 'kpi|exceptions',
      title: String(exceptionSum),
      subtitle: 'חריגות (קורסים)',
      value: exceptionSum
    },
    {
      id: 'instructors',
      action: 'kpi|instructors',
      title: String(instructorRows.length),
      subtitle: 'מדריכים פעילים',
      value: instructorRows.length
    },
    {
      id: 'endings',
      action: 'kpi|endings',
      title: String(courseEndings),
      subtitle: 'מסיימים החודש',
      value: courseEndings
    }
  ];

  var result = {
    month: ym,
    totals: {
      total_short_activities: shortRows.length,
      total_long_activities: longRows.length,
      total_instructors: instructorRows.length,
      total_course_endings_current_month: courseEndings,
      /** תאימות לאחור לבדיקות / לקוחות ישנים */
      short: shortRows.length,
      long: longRows.length
    },
    by_activity_manager: Object.keys(byManager).sort().map(function(key) {
      return byManager[key];
    }),
    kpi_cards: kpi_cards,
    show_only_nonzero_kpis: settingYes_('show_only_nonzero_kpis')
  };
  scriptCachePutJson_(cacheKey, result, CONFIG.SCRIPT_CACHE_SECONDS);
  return result;
}

function actionActivities_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  var allRows = allActivities_();
  var typeKeys = listValuesForName_('activity_type');
  if (!typeKeys.length) {
    typeKeys = ['course', 'workshop', 'after_school', 'escape_room', 'tour'];
  }
  var activityTypeCounts = {};
  typeKeys.forEach(function(t) {
    activityTypeCounts[t] = 0;
  });
  allRows.forEach(function(r) {
    var t = text_(r.activity_type);
    if (Object.prototype.hasOwnProperty.call(activityTypeCounts, t)) {
      activityTypeCounts[t] += 1;
    }
  });

  var activityType = text_(payload.activity_type || 'all');
  var financeStatus = text_(payload.finance_status || '');
  var rows = allRows.filter(function(row) {
    if (activityType && activityType !== 'all' && text_(row.activity_type) !== activityType) return false;
    if (financeStatus && text_(row.finance_status) !== financeStatus) return false;
    return true;
  });

  rows.sort(function(a, b) {
    return text_(a.start_date).localeCompare(text_(b.start_date));
  });

  var noteMap = buildPrivateNotesMap_();

  return {
    activity_type_counts: activityTypeCounts,
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
      activity_types: activityTypesForFilters_(),
      finance_statuses: financeStatusesForFilters_()
    }
  };
}

function actionWeek_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

  var today = new Date();
  var startDay = getWeekStartDay_();
  var weekOffset = parseInt((payload && payload.week_offset) || 0, 10) || 0;
  var anchor = shiftDate_(startOfWeekContaining_(today, startDay), weekOffset * 7);
  var showSat = settingShowShabbat_();
  var calRows = visibleActivitiesForUser_(user);
  var meetingsMap = buildMeetingsMap_();

  var days = [];
  for (var i = 0; i < 7; i++) {
    var d = shiftDate_(anchor, i);
    var dow = d.getDay();
    if (!showSat && dow === 6) {
      continue;
    }
    var key = formatDate_(d);
    days.push({
      date: key,
      weekday_label: hebrewWeekdayLabel_(dow),
      items: activityItemsForCalendarDate_(calRows, meetingsMap, key)
    });
  }

  return {
    days: days,
    week_starts_on: startDay,
    show_shabbat: showSat,
    week_offset: weekOffset
  };
}

function actionMonth_(user, payload) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);

  var now = new Date();
  var ym = text_(payload && payload.ym).slice(0, 7);
  var ymMatch = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  var year;
  var month;
  if (ymMatch) {
    year = parseInt(ymMatch[1], 10);
    month = parseInt(ymMatch[2], 10) - 1;
  } else {
    year = now.getFullYear();
    month = now.getMonth();
  }
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var calRows = visibleActivitiesForUser_(user);
  var meetingsMap = buildMeetingsMap_();

  var cells = [];
  for (var i = 1; i <= daysInMonth; i++) {
    var d = new Date(year, month, i);
    var key = formatDate_(d);
    cells.push({
      day: i,
      date: key,
      items: activityItemsForCalendarDate_(calRows, meetingsMap, key)
    });
  }

  var mm = month + 1;
  return {
    month: year + '-' + (mm < 10 ? '0' : '') + mm,
    cells: cells,
    hide_saturday: !settingShowShabbat_()
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
    } else if (text_(row.end_date) > getLateEndDateCutoff_()) {
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

  var today = formatDate_(new Date());
  var rule = text_(readActiveSettingsMap_().finance_display_rule);
  var rows = allActivities_().filter(function(row) {
    if (rule === 'ended_until_today') {
      var e = text_(row.end_date || row.start_date);
      return !!e && e <= today;
    }
    return true;
  });

  return {
    rows: rows.map(function(row) {
      return {
        RowID: row.RowID,
        source_sheet: row.source_sheet,
        activity_name: row.activity_name,
        finance_status: normalizeFinance_(row.finance_status),
        finance_notes: text_(row.finance_notes),
        status: text_(row.status),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        activity_type: text_(row.activity_type),
        funding: text_(row.funding),
        start_date: text_(row.start_date),
        end_date: text_(row.end_date || row.start_date),
        price: row.price,
        sessions: row.sessions
      };
    })
  };
}

function actionInstructors_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);

  return {
    rows: readRows_(CONFIG.SHEETS.INSTRUCTORS).map(function(row) {
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
  var permission = getPermissionRow_(user.user_id);
  if (!schoolContactsViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  var schoolRows = readRows_(CONFIG.SHEETS.SCHOOLS).map(function(row) {
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

  return { rows: schoolRows };
}

function actionInstructorContacts_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!instructorContactsViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  return {
    rows: readRows_(CONFIG.SHEETS.INSTRUCTORS).map(function(row) {
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

function actionEndDates_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user']);
  var permission = getPermissionRow_(user.user_id);
  if (!endDatesViewYes_(permission)) {
    throw new Error('Forbidden');
  }

  var rows = buildLongRows_()
    .filter(function(row) {
      return !!text_(row.end_date);
    })
    .map(function(row) {
      return {
        RowID: row.RowID,
        activity_name: row.activity_name,
        activity_type: text_(row.activity_type),
        activity_manager: text_(row.activity_manager),
        authority: text_(row.authority),
        school: text_(row.school),
        start_date: text_(row.start_date),
        end_date: text_(row.end_date),
        status: text_(row.status),
        source_sheet: row.source_sheet
      };
    });

  rows.sort(function(a, b) {
    return text_(a.end_date).localeCompare(text_(b.end_date));
  });

  return { rows: rows };
}

function actionMyData_(user) {
  requireAnyRole_(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  var permission = getPermissionRow_(user.user_id);
  if (user.display_role !== 'instructor' && !myDataViewYes_(permission)) {
    throw new Error('Forbidden');
  }

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
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.view_permissions) !== 'yes') {
    throw new Error('Forbidden');
  }

  var cachedPerm = scriptCacheGetJson_(SCRIPT_CACHE_KEY_PERMISSIONS_LIST);
  if (cachedPerm) {
    return cachedPerm;
  }

  var permSheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var permHeaders = getHeaders_(permSheet);

  var result = {
    rows: readRows_(CONFIG.SHEETS.PERMISSIONS).map(function(row) {
      var out = {
        user_id: text_(row.user_id),
        entry_code: text_(row.entry_code),
        full_name: text_(row.full_name),
        display_role: normalizeRole_(internalRoleFromPermissionRow_(row)),
        display_role2: text_(row.display_role2),
        default_view: text_(row.default_view),
        active: yesNo_(row.active)
      };
      permHeaders.forEach(function(h) {
        if (h === 'user_id' || h === 'entry_code' || h === 'full_name' || h === 'display_role' || h === 'display_role2' || h === 'default_view' || h === 'active') {
          return;
        }
        if (h.indexOf('view_') === 0 || h.indexOf('can_') === 0) {
          out[h] = yesNo_(row[h]);
        }
      });
      return out;
    })
  };
  scriptCachePutJson_(SCRIPT_CACHE_KEY_PERMISSIONS_LIST, result, CONFIG.SCRIPT_CACHE_SECONDS);
  return result;
}

function actionAddActivity_(user, payload) {
  var permission = getPermissionRow_(user.user_id);
  if (!effectiveCanAddActivity_(permission, user.display_role)) {
    throw new Error('Forbidden');
  }

  var activity = payload.activity || {};
  var source = text_(activity.source || 'short').toLowerCase();
  var targetSheet = source === 'long' ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT;
  var rowId = nextId_(targetSheet, targetSheet === CONFIG.SHEETS.DATA_LONG ? 'LONG-' : 'SHORT-');

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

  if (targetSheet === CONFIG.SHEETS.DATA_SHORT) {
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

    if (Array.isArray(activity.meetings) && activity.meetings.length) {
      setMeetings_(rowId, activity.meetings);
    } else {
      setMeetingsFromRange_(rowId, text_(activity.start_date), text_(activity.end_date));
    }
  }

  scriptCacheInvalidateDataViews_();
  return {
    created: true,
    RowID: rowId,
    source_sheet: targetSheet
  };
}

function actionSaveActivity_(user, payload) {
  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  var changes = payload.changes || {};

  if (!sourceRowId) throw new Error('source_row_id is required');

  var permission = getPermissionRow_(user.user_id);
  if (!effectiveCanEditDirect_(permission, user.display_role)) {
    return actionSubmitEditRequest_(user, {
      source_sheet: sourceSheet,
      source_row_id: sourceRowId,
      changes: changes
    });
  }

  updateRowByKey_(sourceSheet, 'RowID', sourceRowId, changes);

  if (sourceSheet === CONFIG.SHEETS.DATA_LONG) {
    if (Array.isArray(changes.meetings)) {
      setMeetings_(sourceRowId, changes.meetings);
    } else if (changes.start_date || changes.end_date) {
      setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
    }
  }

  scriptCacheInvalidateDataViews_();
  return {
    updated: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

function actionSubmitEditRequest_(user, payload) {
  requireAnyRole_(user, ['authorized_user', 'instructor']);

  var sourceRowId = text_(payload.source_row_id || payload.RowID);
  var sourceSheet = text_(payload.source_sheet || (sourceRowId.indexOf('LONG-') === 0 ? CONFIG.SHEETS.DATA_LONG : CONFIG.SHEETS.DATA_SHORT));
  var changes = payload.changes || {};

  if (!sourceRowId) throw new Error('source_row_id is required');
  if (sourceRowId.indexOf('SHORT-') !== 0 && sourceRowId.indexOf('LONG-') !== 0) {
    throw new Error('Invalid source_row_id');
  }

  var currentRow = getRowByKey_(sourceSheet, 'RowID', sourceRowId);
  var requestId = 'REQ-' + new Date().getTime();

  Object.keys(changes).forEach(function(fieldName) {
    appendRow_(CONFIG.SHEETS.EDIT_REQUESTS, {
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
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.can_review_requests) !== 'yes') {
    throw new Error('Forbidden');
  }

  var requestId = text_(payload.request_id);
  var status = text_(payload.status).toLowerCase();
  var reviewerNotes = text_(payload.reviewer_notes);

  if (!requestId) throw new Error('request_id is required');
  if (CONFIG.EDIT_REQUEST_STATUSES.indexOf(status) < 0 || status === 'pending') {
    throw new Error('Invalid review status');
  }

  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS);
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

    if (sourceSheet === CONFIG.SHEETS.DATA_LONG && (changes.start_date || changes.end_date)) {
      setMeetingsFromRange_(sourceRowId, text_(changes.start_date), text_(changes.end_date));
    }
  }

  updateEditRequestRows_(requestId, {
    status: status,
    reviewed_at: new Date().toISOString(),
    reviewed_by: text_(user.user_id),
    reviewer_notes: reviewerNotes
  });

  scriptCacheInvalidateDataViews_();
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
  var sheet = getSheet_(CONFIG.SHEETS.PERMISSIONS);
  var headers = getHeaders_(sheet);

  var merged = {};
  headers.forEach(function(h) {
    if (h === 'user_id') {
      merged[h] = userId;
      return;
    }
    if (Object.prototype.hasOwnProperty.call(row, h)) {
      if (h === 'display_role') {
        merged[h] = normalizeRole_(text_(row[h]) || internalRoleFromPermissionRow_(existing));
      } else if (h === 'active' || h.indexOf('view_') === 0 || h.indexOf('can_') === 0) {
        merged[h] = yesNo_(row[h]);
      } else {
        merged[h] = row[h];
      }
      return;
    }
    merged[h] = existing[h] !== undefined && existing[h] !== null ? existing[h] : '';
  });

  if (headers.indexOf('entry_code') >= 0 && !text_(merged.entry_code)) {
    merged.entry_code = text_(row.entry_code || existing.entry_code);
  }
  if (headers.indexOf('full_name') >= 0 && !text_(merged.full_name)) {
    merged.full_name = text_(row.full_name || existing.full_name);
  }
  if (headers.indexOf('display_role') >= 0 && !text_(merged.display_role)) {
    merged.display_role = normalizeRole_(internalRoleFromPermissionRow_(existing));
  }
  if (headers.indexOf('default_view') >= 0 && !text_(merged.default_view)) {
    merged.default_view = text_(row.default_view || existing.default_view);
  }
  if (headers.indexOf('active') >= 0) {
    merged.active = Object.prototype.hasOwnProperty.call(row, 'active') ? yesNo_(row.active) : yesNo_(existing.active);
  }

  upsertRowByKey_(CONFIG.SHEETS.PERMISSIONS, 'user_id', merged);

  scriptCacheInvalidateDataViews_();
  return {
    saved: true,
    user_id: userId
  };
}

function actionSavePrivateNote_(user, payload) {
  var permission = getPermissionRow_(user.user_id);
  if (yesNo_(permission.can_review_requests) !== 'yes' || user.display_role !== 'operations_reviewer') {
    throw new Error('Forbidden');
  }

  var sourceSheet = text_(payload.source_sheet);
  var sourceRowId = text_(payload.source_row_id);
  var noteText = text_(payload.note_text || payload.note);

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

  scriptCacheInvalidateDataViews_();
  return {
    saved: true,
    source_sheet: sourceSheet,
    source_row_id: sourceRowId
  };
}

function allActivities_() {
  if (__rqCache_ && Object.prototype.hasOwnProperty.call(__rqCache_, 'allActivities')) {
    return __rqCache_.allActivities;
  }
  var list = readRows_(CONFIG.SHEETS.DATA_SHORT).map(mapShortRow_).concat(buildLongRows_());
  if (__rqCache_) {
    __rqCache_.allActivities = list;
  }
  return list;
}

function visibleActivitiesForUser_(user) {
  if (__rqCache_ && __rqCache_.visibleActivitiesForUserCache) {
    return __rqCache_.visibleActivitiesForUserCache;
  }
  var result;
  if (user.display_role !== 'instructor') {
    result = allActivities_();
  } else {
    var empId = text_(user.emp_id || user.user_id);
    result = allActivities_().filter(function(row) {
      return text_(row.emp_id) === empId || text_(row.emp_id_2) === empId;
    });
  }
  if (__rqCache_) {
    __rqCache_.visibleActivitiesForUserCache = result;
  }
  return result;
}

function buildLongRows_() {
  if (__rqCache_ && __rqCache_.buildLongRows) {
    return __rqCache_.buildLongRows;
  }
  var rows = readRows_(CONFIG.SHEETS.DATA_LONG).map(mapLongRow_);
  var meetingsByRow = buildMeetingsMap_();

  var built = rows.map(function(row) {
    var dates = meetingsByRow[row.RowID] || [];
    if (dates.length) {
      row.start_date = dates[0];
      row.end_date = dates[dates.length - 1];
    }
    return row;
  });
  if (__rqCache_) {
    __rqCache_.buildLongRows = built;
  }
  return built;
}

function mapShortRow_(row) {
  return {
    source_sheet: CONFIG.SHEETS.DATA_SHORT,
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
    end_date: text_(row.end_date) || text_(row.start_date),
    status: text_(row.status),
    notes: text_(row.notes),
    finance_status: normalizeFinance_(row.finance_status),
    finance_notes: text_(row.finance_notes)
  };
}

function mapLongRow_(row) {
  return {
    source_sheet: CONFIG.SHEETS.DATA_LONG,
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

function buildPrivateNotesMap_() {
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var map = {};
  rows.forEach(function(row) {
    var key = text_(row.source_sheet) + '|' + text_(row.source_row_id);
    map[key] = row;
  });
  return map;
}

function getPrivateNoteRow_(sourceSheet, sourceRowId) {
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var match = rows.find(function(row) {
    return text_(row.source_sheet) === text_(sourceSheet) &&
           text_(row.source_row_id) === text_(sourceRowId);
  });
  return match || null;
}

function upsertPrivateNoteRow_(rowObj) {
  var sheet = getSheet_(CONFIG.SHEETS.PRIVATE_NOTES);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.SHEETS.PRIVATE_NOTES);
  var index = rows.findIndex(function(row) {
    return text_(row.source_sheet) === text_(rowObj.source_sheet) &&
           text_(row.source_row_id) === text_(rowObj.source_row_id);
  });

  if (index < 0) {
    appendRow_(CONFIG.SHEETS.PRIVATE_NOTES, rowObj);
    return;
  }

  var updated = {};
  headers.forEach(function(header) {
    updated[header] = Object.prototype.hasOwnProperty.call(rowObj, header) ? rowObj[header] : rows[index][header];
  });

  var rowNumber = getDataStartRow_() + index;
  var values = headers.map(function(header) { return updated[header]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  invalidateReadRowsCache_(CONFIG.SHEETS.PRIVATE_NOTES);
}

function buildMeetingsMap_() {
  if (__rqCache_ && __rqCache_.meetingsMap) {
    return __rqCache_.meetingsMap;
  }
  var rows = readRows_(CONFIG.SHEETS.MEETINGS).filter(function(row) {
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

  if (__rqCache_) {
    __rqCache_.meetingsMap = map;
  }
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

  deleteRowsByKey_(CONFIG.SHEETS.MEETINGS, 'source_row_id', sourceRowId);

  cleaned.forEach(function(row) {
    appendRow_(CONFIG.SHEETS.MEETINGS, row);
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

function updateEditRequestRows_(requestId, patch) {
  var sheet = getSheet_(CONFIG.SHEETS.EDIT_REQUESTS);
  var headers = getHeaders_(sheet);
  var rows = readRows_(CONFIG.SHEETS.EDIT_REQUESTS);

  rows.forEach(function(row, idx) {
    if (text_(row.request_id) !== text_(requestId)) return;

    var updated = {};
    headers.forEach(function(header) {
      updated[header] = Object.prototype.hasOwnProperty.call(patch, header) ? patch[header] : row[header];
    });

    var rowNumber = getDataStartRow_() + idx;
    var values = headers.map(function(header) { return updated[header]; });
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([values]);
  });
  invalidateReadRowsCache_(CONFIG.SHEETS.EDIT_REQUESTS);
}

function listValuesForName_(listName) {
  var target = text_(listName);
  var rows = readRows_(CONFIG.SHEETS.LISTS);
  var out = [];
  rows.forEach(function(row) {
    if (text_(row.list_name) !== target) return;
    var v = text_(row.value);
    if (!v) return;
    if (out.indexOf(v) < 0) out.push(v);
  });
  return out;
}

function activityTypesForFilters_() {
  var fromSheet = listValuesForName_('activity_type');
  if (!fromSheet.length) {
    return CONFIG.ACTIVITY_TYPES.slice();
  }
  return ['all'].concat(fromSheet);
}

function financeStatusesForFilters_() {
  var fromSheet = listValuesForName_('finance_status');
  return fromSheet.length ? fromSheet : CONFIG.FINANCE_STATUSES.slice();
}

function getLateEndDateCutoff_() {
  var m = readActiveSettingsMap_();
  var v = text_(m.late_end_date_cutoff);
  return v || CONFIG.LATE_END_DATE_CUTOFF;
}

function settingYes_(key) {
  return yesNo_(readActiveSettingsMap_()[key]) !== 'no';
}

/** yes = הצגת שבת בלוחות זמן (כמו ב־settings) */
function settingShowShabbat_() {
  return text_(readActiveSettingsMap_().show_shabbat).toLowerCase() === 'yes';
}

function getWeekStartDay_() {
  var n = parseInt(text_(readActiveSettingsMap_().week_start_day), 10);
  if (isNaN(n) || n < 0 || n > 6) {
    return 0;
  }
  return n;
}

function startOfWeekContaining_(date, startDay) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var day = d.getDay();
  var diff = (day - startDay + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function hebrewWeekdayLabel_(jsDay) {
  var names = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  return names[jsDay] || '';
}

function buildClientSettingsPayload_() {
  var m = readActiveSettingsMap_();
  return {
    hide_emp_id_on_screens: yesNo_(m.hide_emp_id_on_screens) === 'yes',
    hide_activity_no_on_screens: yesNo_(m.hide_activity_no_on_screens) === 'yes',
    week_start_day: getWeekStartDay_(),
    show_shabbat: settingShowShabbat_()
  };
}

/** פריטי לוח שנה ליום אחד — rows ו-meetingsMap מחושבים פעם אחת לכל בקשת week/month */
function activityItemsForCalendarDate_(rows, meetingsMap, dateKey) {
  var out = [];
  var seen = {};
  rows.forEach(function(row) {
    var include = false;
    if (text_(row.source_sheet) === CONFIG.SHEETS.DATA_LONG) {
      var dlist = meetingsMap[row.RowID] || [];
      if (dlist.length) {
        include = dlist.indexOf(dateKey) >= 0;
      } else {
        var s = text_(row.start_date);
        var e = text_(row.end_date || row.start_date);
        include = !!s && dateKey >= s && dateKey <= e;
      }
    } else {
      var s2 = text_(row.start_date);
      var e2 = text_(row.end_date || row.start_date);
      include = !!s2 && dateKey >= s2 && dateKey <= e2;
    }
    if (include && !seen[row.RowID]) {
      seen[row.RowID] = true;
      out.push(row);
    }
  });
  return out;
}

function isActivityActiveBySpec_(row, todayIso) {
  var st = text_(row.status).toLowerCase();
  if (settingYes_('use_status_with_dates') && st === 'ended') {
    return false;
  }
  var s = text_(row.start_date);
  var e = text_(row.end_date || row.start_date);
  if (!s) return false;
  return todayIso >= s && todayIso <= e;
}

function countActiveByType_(rows, todayIso, activityType) {
  return rows.filter(function(row) {
    return text_(row.activity_type) === activityType && isActivityActiveBySpec_(row, todayIso);
  }).length;
}
