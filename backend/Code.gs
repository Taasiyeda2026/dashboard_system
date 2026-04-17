const APP_CONFIG = {
  spreadsheetId: 'REPLACE_WITH_SPREADSHEET_ID',
  endDateLimit: '2026-06-15',
  sheets: {
    dataShort: 'data_short',
    dataLong: 'data_long',
    meetings: 'activity_meetings',
    permissions: 'permissions',
    lists: 'lists',
    instructors: 'contacts_instructors',
    schools: 'contacts_schools',
    editRequests: 'edit_requests',
    privateNotes: 'operations_private_notes'
  }
};

function doGet() {
  return jsonResponse({ ok: true, data: { service: 'dashboard-system', version: 1 } });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = text(payload.action);
    const currentUser = action === 'login' ? null : requireAuth(payload.token);
    const handlers = {
      login: function() { return login(payload.entry_code); },
      bootstrap: function() { return bootstrap(currentUser); },
      dashboard: function() { return dashboardData(currentUser); },
      activities: function() { return activitiesData(currentUser, payload); },
      week: function() { return weekData(currentUser); },
      month: function() { return monthData(currentUser); },
      exceptions: function() { return exceptionsData(currentUser); },
      finance: function() { return financeData(currentUser); },
      instructors: function() { return instructorsData(currentUser); },
      contacts: function() { return contactsData(currentUser); },
      myData: function() { return myData(currentUser); },
      permissions: function() { return permissionsData(currentUser); },
      addActivity: function() { return addActivity(currentUser, payload); },
      saveActivity: function() { return saveActivity(currentUser, payload); },
      submitEditRequest: function() { return submitEditRequest(currentUser, payload); },
      reviewEditRequest: function() { return reviewEditRequest(currentUser, payload); },
      savePermission: function() { return savePermission(currentUser, payload); },
      savePrivateNote: function() { return savePrivateNote(currentUser, payload); }
    };

    if (!handlers[action]) throw new Error('Unknown action');
    return jsonResponse({ ok: true, data: handlers[action]() });
  } catch (error) {
    return jsonResponse({ ok: false, error: error && error.message ? error.message : 'Unexpected error' });
  }
}

function login(entryCode) {
  const records = readSheet(APP_CONFIG.sheets.permissions);
  const match = records.find(function(row) {
    return text(row.entry_code) === text(entryCode) && toYesNo(row.active) === 'yes';
  });
  if (!match) throw new Error('Invalid or inactive code');

  const user = {
    user_id: str(match.user_id),
    name: str(match.full_name),
    role: normalizeRole(match.display_role),
    default_view: str(match.default_view)
  };

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(user), 60 * 60 * 8);
  return { token: token, user: user };
}

function bootstrap(user) {
  const map = {
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
  const defaults = user.role === 'instructor'
    ? ['my-data']
    : ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance'];

  const row = permissionRow(user.user_id);
  const routes = user.role === 'admin' || user.role === 'operations_reviewer'
    ? [...defaults, 'permissions']
    : defaults.filter((route) => yesNo(row[map[route]]) === 'yes' || route === 'my-data');

  const preferred = str(row.default_view) || (user.role === 'instructor' ? 'my-data' : 'dashboard');
  const defaultRoute = routes.includes(preferred) ? preferred : routes[0] || 'my-data';

  return { role: user.role, default_route: defaultRoute, routes };
}

function dashboard(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const shortRows = rowsFor(SETTINGS.sheets.dataShort);
  const longRows = withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings));
  const instructorRows = rowsFor(SETTINGS.sheets.instructors);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const courseEndings = longRows.filter((row) => str(row.activity_type) === 'course' && inMonth(row.end_date, monthStart, monthEnd)).length;

  const byManager = {};
  shortRows.forEach((row) => {
    const k = str(row.activity_manager) || 'unassigned';
    byManager[k] = byManager[k] || { activity_manager: k, short_count: 0, long_count: 0, total: 0 };
    byManager[k].short_count++;
    byManager[k].total++;
  });
  longRows.forEach(function(row) {
    const manager = text(row.activity_manager) || 'unassigned';
    grouped[manager] = grouped[manager] || { activity_manager: manager, total_short: 0, total_long: 0, total: 0 };
    grouped[manager].total_long += 1;
    grouped[manager].total += 1;
  });

  return {
    totals: {
      total_short_activities: shortRows.length,
      total_long_activities: longRows.length,
      total_instructors: instructors.length,
      total_course_endings_current_month: longRows.filter(function(row) {
        return row.activity_type === 'course' && text(row.end_date).slice(0, 7) === currentMonth;
      }).length
    },
    by_activity_manager: Object.keys(grouped).sort().map(function(key) { return grouped[key]; })
  };
}

function activities(user, type) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const notes = rowsFor(SETTINGS.sheets.privateNotes);
  const notesBySource = notes.reduce((acc, row) => {
    const key = `${str(row.source_sheet)}:${str(row.source_row_id)}`;
    acc[key] = row;
    return acc;
  }, {});

  const merged = [
    ...rowsFor(SETTINGS.sheets.dataShort).map((r) => mapShort(r)),
    ...withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings)).map((r) => mapLong(r))
  ].filter((row) => type === 'all' || row.activity_type === type)
    .sort((a, b) => str(a.start_date).localeCompare(str(b.start_date)));

  const notesBySource = mapByKey(readSheet(APP_CONFIG.sheets.privateNotes), 'source_row_id');
  return {
    rows: merged.map((row) => {
      const note = notesBySource[`${row.source_sheet}:${row.RowID}`];
      return {
        ...row,
        private_note: user.role === 'operations_reviewer' && yesNo(note?.active || 'yes') === 'yes' ? str(note?.note_text) : ''
      };
    })
  };
}

function weekData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const today = new Date();
  const day = today.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = shiftDate(today, mondayOffset);
  const rows = visibleActivitiesForUser(user);

  return {
    days: Array.apply(null, Array(7)).map(function(_, i) {
      const d = shiftDate(monday, i);
      const key = formatDate(d);
      return {
        date: key,
        items: rows.filter(function(row) {
          return key >= text(row.start_date) && key <= text(row.end_date || row.start_date);
        })
      };
    })
  };
}

function monthData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const daysCount = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = visibleActivitiesForUser(user);

  return {
    month: Utilities.formatDate(now, 'UTC', 'yyyy-MM'),
    cells: Array.apply(null, Array(daysCount)).map(function(_, idx) {
      const date = formatDate(new Date(Date.UTC(year, month, idx + 1)));
      return {
        day: idx + 1,
        date: date,
        items: rows.filter(function(row) {
          return date >= text(row.start_date) && date <= text(row.end_date || row.start_date);
        })
      };
    })
  };
}

function exceptionsData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const rows = buildLongRows();
  const counts = { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
  const result = [];

  rows.forEach((row) => {
    let ex = '';
    if (!str(row.emp_id)) ex = 'missing_instructor';
    else if (!str(row.start_date)) ex = 'missing_start_date';
    else if (str(row.end_date) > endLimit) ex = 'late_end_date';
    if (!ex) return;

    counts[ex]++;
    result.push({ RowID: str(row.RowID), activity_name: str(row.activity_name), end_date: str(row.end_date), exception_type: ex });
  });

  return { rows: result, counts: counts, priority: ['missing_instructor', 'missing_start_date', 'late_end_date'] };
}

function finance(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return {
    rows: allActivities().map((r) => ({
      RowID: r.RowID,
      activity_name: r.activity_name,
      finance_status: normalizeFinance(r.finance_status),
      status: str(r.status)
    }))
  };
}

function instructors(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return { rows: rowsFor(SETTINGS.sheets.instructors) };
}

function contacts(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const instructorsRows = rowsFor(SETTINGS.sheets.instructors).map((r) => ({
    kind: 'instructor',
    emp_id: str(r.emp_id),
    full_name: str(r.full_name),
    mobile: str(r.mobile),
    phone: '',
    email: str(r.email)
  }));
  const schoolsRows = rowsFor(SETTINGS.sheets.schools).map((r) => ({
    kind: 'school',
    authority: str(r.authority),
    school: str(r.school),
    contact_name: str(r.contact_name),
    phone: str(r.phone),
    mobile: str(r.mobile),
    email: str(r.email)
  }));
  return { rows: [...instructorsRows, ...schoolsRows] };
}

function myData(user) {
  requireAny(user, ['instructor', 'admin', 'operations_reviewer', 'authorized_user']);
  const empId = str(user.user_id);
  const rows = allActivities().filter((r) => str(r.emp_id) === empId || str(r.emp_id_2) === empId);
  return { rows };
}

function permissionsData(user) {
  requireAny(user, ['admin', 'operations_reviewer']);
  return { rows: rowsFor(SETTINGS.sheets.permissions).map((r) => ({ ...r, display_role: normalizeRole(r.display_role) })) };
}

function submitEditRequest(user, input) {
  requireAny(user, ['authorized_user', 'instructor']);
  const id = str(input.source_row_id || input.RowID);
  const sourceSheet = str(input.source_sheet || (id.startsWith('LONG-') ? SETTINGS.sheets.dataLong : SETTINGS.sheets.dataShort));
  if (!/^SHORT-|^LONG-/.test(id)) throw new Error('Invalid source row id');

  appendRow(SETTINGS.sheets.editRequests, {
    request_id: `REQ-${new Date().getTime()}`,
    source_sheet: sourceSheet,
    source_row_id: id,
    field_name: str(input.field_name),
    old_value: str(input.old_value),
    new_value: str(input.new_value),
    requested_by_user_id: user.user_id,
    requested_by_name: user.name,
    requested_at: new Date().toISOString(),
    status: 'pending',
    reviewed_at: '',
    reviewed_by: '',
    reviewer_notes: '',
    active: 'yes'
  });

function saveActivity(user, input) {
  const sourceRowId = str(input.source_row_id || input.RowID);
  const sourceSheet = str(input.source_sheet || (sourceRowId.startsWith('LONG-') ? SETTINGS.sheets.dataLong : SETTINGS.sheets.dataShort));
  const changes = input.changes || {};

function saveActivity(user, payload) {
  const sourceRowId = text(payload.source_row_id);
  if (!sourceRowId) throw new Error('source_row_id is required');
  const changes = payload.changes || {};

  if (user.role === 'authorized_user' || user.role === 'instructor') {
    const fieldNames = Object.keys(changes);
    fieldNames.forEach((field) => {
      submitEditRequest(user, {
        source_sheet: sourceSheet,
        source_row_id: sourceRowId,
        field_name: field,
        old_value: '',
        new_value: changes[field]
      });
    });
    return { created: true };
  }
  allow(user, ['admin', 'operations_reviewer']);

  requireAny(user, ['admin', 'operations_reviewer']);
  updateRowByKey(sourceSheet, 'RowID', sourceRowId, changes);

  if (sourceSheet === SETTINGS.sheets.dataLong && (changes.start_date || changes.end_date)) {
    setLongDateRange(sourceRowId, str(changes.start_date), str(changes.end_date));
  }

  writeBack(sheetName, records, index, updated);
  return { updated: true, source_row_id: sourceRowId };
}

function addActivity(user, input) {
  requireAny(user, ['admin', 'operations_reviewer']);
  const activity = input.activity || {};
  const target = str(activity.source || 'short').toLowerCase() === 'long' ? SETTINGS.sheets.dataLong : SETTINGS.sheets.dataShort;
  const idPrefix = target === SETTINGS.sheets.dataLong ? 'LONG' : 'SHORT';
  const rowId = `${idPrefix}-${new Date().getTime()}`;

  const common = {
    RowID: rowId,
    activity_manager: str(activity.activity_manager),
    authority: str(activity.authority),
    school: str(activity.school),
    activity_type: str(activity.activity_type),
    activity_no: str(activity.activity_no),
    activity_name: str(activity.activity_name || activity.title),
    sessions: str(activity.sessions),
    price: str(activity.price),
    funding: str(activity.funding),
    start_time: str(activity.start_time),
    end_time: str(activity.end_time),
    emp_id: str(activity.emp_id || activity.instructor_1),
    instructor_name: str(activity.instructor_name),
    status: str(activity.status || 'active'),
    notes: str(activity.notes),
    finance_status: normalizeFinance(activity.finance_status),
    finance_notes: str(activity.finance_notes)
  };
  appendToSheet(APP_CONFIG.sheets.editRequests, requestRow);
  return { created: true, request_id: requestRow.request_id };
}

  if (target === SETTINGS.sheets.dataShort) {
    appendRow(target, {
      ...common,
      emp_id_2: str(activity.emp_id_2 || activity.instructor_2),
      instructor_name_2: str(activity.instructor_name_2),
      start_date: str(activity.start_date)
    });
  } else {
    appendRow(target, {
      ...common,
      start_date: str(activity.start_date),
      end_date: str(activity.end_date || activity.start_date)
    });
    setLongDateRange(rowId, str(activity.start_date), str(activity.end_date || activity.start_date));
  }

  const records = readSheet(APP_CONFIG.sheets.editRequests);
  const index = records.findIndex(function(row) { return text(row.request_id) === requestId; });
  if (index === -1) throw new Error('Request not found');

  const row = Object.assign({}, records[index], {
    status: newStatus,
    reviewed_by: text(user.user_id),
    reviewed_at: new Date().toISOString()
  });

  if (newStatus === 'approved') {
    const sourceRowId = text(row.source_row_id);
    const changes = JSON.parse(text(row.changes_json) || '{}');
    const adminProxy = { role: 'admin' };
    saveActivity(adminProxy, { source_row_id: sourceRowId, changes: changes });
  }

  const existing = permissionRow(userId);
  const payload = {
    ...existing,
    user_id: userId,
    entry_code: str(permission.entry_code),
    full_name: str(permission.full_name),
    display_role: normalizeRole(permission.display_role),
    default_view: str(permission.default_view),
    view_admin: optionalYesNo(permission, 'view_admin', existing),
    view_dashboard: optionalYesNo(permission, 'view_dashboard', existing),
    view_activities: optionalYesNo(permission, 'view_activities', existing),
    view_week: optionalYesNo(permission, 'view_week', existing),
    view_month: optionalYesNo(permission, 'view_month', existing),
    view_instructors: optionalYesNo(permission, 'view_instructors', existing),
    view_exceptions: optionalYesNo(permission, 'view_exceptions', existing),
    view_my_data: optionalYesNo(permission, 'view_my_data', existing),
    view_contacts: optionalYesNo(permission, 'view_contacts', existing),
    view_finance: optionalYesNo(permission, 'view_finance', existing),
    view_permissions: optionalYesNo(permission, 'view_permissions', existing),
    can_request_edit: optionalYesNo(permission, 'can_request_edit', existing),
    can_edit_direct: optionalYesNo(permission, 'can_edit_direct', existing),
    can_add_activity: optionalYesNo(permission, 'can_add_activity', existing),
    can_review_requests: optionalYesNo(permission, 'can_review_requests', existing),
    active: yesNo(permission.active)
  };

  if (index >= 0) writeBack(APP_CONFIG.sheets.permissions, records, index, normalized);
  else appendToSheet(APP_CONFIG.sheets.permissions, normalized);
  return { saved: true };
}

function savePrivateNote(user, payload) {
  allow(user, ['operations_reviewer']);
  const sourceRowId = text(payload.source_row_id);
  const noteText = text(payload.note);
  const records = readSheet(APP_CONFIG.sheets.privateNotes);
  const index = records.findIndex(function(r) { return text(r.source_row_id) === sourceRowId; });
  const data = {
    source_row_id: sourceRowId,
    note: noteText,
    updated_by: text(user.user_id),
    updated_at: new Date().toISOString()
  };

  if (index >= 0) writeBack(APP_CONFIG.sheets.privateNotes, records, index, data);
  else appendToSheet(APP_CONFIG.sheets.privateNotes, data);
  return { saved: true };
}

function mapShort(row) {
  row = row || {};
  return {
    source_sheet: SETTINGS.sheets.dataShort,
    RowID: str(row.RowID),
    activity_manager: str(row.activity_manager),
    authority: str(row.authority),
    school: str(row.school),
    activity_type: str(row.activity_type),
    activity_no: str(row.activity_no),
    activity_name: str(row.activity_name),
    sessions: str(row.sessions),
    price: str(row.price),
    funding: str(row.funding),
    start_time: str(row.start_time),
    end_time: str(row.end_time),
    emp_id: str(row.emp_id),
    instructor_name: str(row.instructor_name),
    emp_id_2: str(row.emp_id_2),
    instructor_name_2: str(row.instructor_name_2),
    start_date: str(row.start_date),
    end_date: str(row.start_date),
    status: str(row.status),
    notes: str(row.notes),
    finance_status: normalizeFinance(row.finance_status),
    finance_notes: str(row.finance_notes)
  };
}

function mapLong(row) {
  row = row || {};
  return {
    source_sheet: SETTINGS.sheets.dataLong,
    RowID: str(row.RowID),
    activity_manager: str(row.activity_manager),
    authority: str(row.authority),
    school: str(row.school),
    activity_type: str(row.activity_type),
    activity_no: str(row.activity_no),
    activity_name: str(row.activity_name),
    sessions: str(row.sessions),
    price: str(row.price),
    funding: str(row.funding),
    start_time: str(row.start_time),
    end_time: str(row.end_time),
    emp_id: str(row.emp_id),
    instructor_name: str(row.instructor_name),
    emp_id_2: '',
    instructor_name_2: '',
    start_date: str(row.start_date),
    end_date: str(row.end_date),
    status: str(row.status),
    notes: str(row.notes),
    finance_status: normalizeFinance(row.finance_status),
    finance_notes: str(row.finance_notes)
  };
}

function withLongDates(longRows, meetingRows) {
  const byId = {};
  meetingRows.forEach((m) => {
    const id = str(m.source_row_id);
    const d = str(m.meeting_date);
    if (!id || !d || yesNo(m.active || 'yes') !== 'yes') return;
    byId[id] = byId[id] || [];
    byId[id].push(d);
  });

  return longRows.map((row) => {
    const dates = (byId[str(row.RowID)] || []).sort();
    return {
      ...row,
      start_date: dates[0] || str(row.start_date),
      end_date: dates[dates.length - 1] || str(row.end_date)
    };
  });
}

function permissionRow(userId) {
  return rowsFor(SETTINGS.sheets.permissions).find((r) => str(r.user_id) === str(userId)) || {};
}

function rowsFor(sheetName) {
  const sheet = SpreadsheetApp.openById(SETTINGS.spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  if (!values[0] || !values[0].length) throw new Error(`Missing headers in sheet: ${sheetName}`);

  const headers = values[0].map((h) => str(h));
  return values.slice(1).map((row) => {
    row = row || [];
    const item = {};
    headers.forEach((h, i) => { item[h] = row[i]; });
    return item;
  });
}

function requireAuth(token) {
  const raw = CacheService.getScriptCache().get('session:' + text(token));
  if (!raw) throw new Error('Unauthorized');
  return JSON.parse(raw);
}

function allow(user, roles) {
  if (!user || roles.indexOf(user.role) === -1) throw new Error('Forbidden');
}

function routesByRole(role) {
  if (role === 'instructor') return ['my-data'];
  if (role === 'authorized_user') return ['dashboard', 'activities', 'week', 'month', 'exceptions', 'finance', 'instructors', 'contacts', 'my-data'];
  return ['dashboard', 'activities', 'week', 'month', 'exceptions', 'finance', 'instructors', 'contacts', 'my-data', 'permissions'];
}

function readSheet(name) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => str(h));
  const sourceIdx = headers.indexOf('source_row_id');
  const dateIdx = headers.indexOf('meeting_date');
  if (sourceIdx < 0 || dateIdx < 0) return;

  for (let i = values.length - 1; i >= 1; i--) {
    if (str(values[i][sourceIdx]) === str(sourceRowId)) {
      sheet.deleteRow(i + 1);
    }
  }

  const start = startDate || endDate;
  const end = endDate || startDate;
  if (start) appendRow(SETTINGS.sheets.meetings, { source_row_id: sourceRowId, meeting_no: '1', meeting_date: start, notes: '', active: 'yes' });
  if (end && end !== start) appendRow(SETTINGS.sheets.meetings, { source_row_id: sourceRowId, meeting_no: '2', meeting_date: end, notes: '', active: 'yes' });
}

function appendToSheet(name, row) {
  const sheet = getSheet(name);
  const headers = sheet.getDataRange().getValues()[0] || [];
  const values = headers.map(function(h) { return row[text(h)] || ''; });
  sheet.appendRow(values);
}

function writeBack(name, records, index, updatedRow) {
  const sheet = getSheet(name);
  const headers = sheet.getDataRange().getValues()[0] || [];
  const rowNumber = index + 2;
  const values = headers.map(function(h) { return updatedRow[text(h)] || ''; });
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
}

function nextId(sheetName, prefix) {
  const rows = readSheet(sheetName);
  const max = rows.reduce(function(acc, row) {
    const raw = text(row.row_id);
    if (raw.indexOf(prefix) !== 0) return acc;
    const value = parseInt(raw.replace(prefix, ''), 10);
    return Math.max(acc, isNaN(value) ? 0 : value);
  }, 0);
  return prefix + ('000' + (max + 1)).slice(-3);
}

function str(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return fmtDate(value);
  return String(value).trim();
}

function normalizeFinance(value) {
  return text(value).toLowerCase() === 'closed' ? 'closed' : 'open';
}

function toYesNo(value) {
  return text(value).toLowerCase() === 'no' ? 'no' : 'yes';
}

function mapByKey(rows, key) {
  const map = {};
  rows.forEach(function(row) { map[text(row[key])] = row; });
  return map;
}

function optionalYesNo(input, key, fallbackObj) {
  if (Object.prototype.hasOwnProperty.call(input || {}, key)) {
    return yesNo(input[key]);
  }
  return yesNo(fallbackObj[key]);
}

function mondayOf(date) {
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = clone.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  return clone;
}

function shiftDate(date, days) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function formatDate(date) {
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
