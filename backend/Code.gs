/**
 * Operations backend (Google Apps Script)
 * Source of truth: Google Sheets
 */

const CONFIG = {
  spreadsheetId: 'REPLACE_WITH_SPREADSHEET_ID',
  endDateLimit: '2026-06-15',
  sheets: {
    dataShort: 'data_short',
    dataLong: 'data_long',
    activityMeetings: 'activity_meetings',
    permissions: 'permissions',
    lists: 'lists',
    contactsInstructors: 'contacts_instructors',
    contactsSchools: 'contacts_schools',
    editRequests: 'edit_requests',
    operationsPrivateNotes: 'operations_private_notes'
  },
  routesByFlag: {
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
  }
};

function doGet() {
  return jsonResponse({ ok: true, data: { service: 'operations-backend', status: 'ready' } });
}

function doPost(e) {
  try {
    const input = parseBody(e);
    const action = asText(input.action);
    const session = action === 'login' ? { user: null } : requireSession(input.token);

    const actions = {
      login: () => login(input.entryCode),
      bootstrap: () => bootstrap(session.user),
      dashboard: () => dashboard(session.user),
      activities: () => activities(session.user, input.type || 'all'),
      week: () => week(session.user),
      month: () => month(session.user),
      exceptions: () => exceptions(session.user),
      finance: () => finance(session.user),
      instructors: () => instructors(session.user),
      contacts: () => contacts(session.user),
      myData: () => myData(session.user),
      permissions: () => permissions(session.user),
      addActivity: () => addActivity(session.user, input.activity || {}),
      saveActivity: () => saveActivity(session.user, input),
      submitEditRequest: () => submitEditRequest(session.user, input),
      reviewEditRequest: () => reviewEditRequest(session.user, input),
      savePermission: () => savePermission(session.user, input.permission || {}),
      savePrivateNote: () => savePrivateNote(session.user, input)
    };

    if (!actions[action]) throw new Error('Unknown action');
    return jsonResponse({ ok: true, data: actions[action]() });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || 'Unhandled error' });
  }
}

function login(entryCode) {
  const rows = readRows(CONFIG.sheets.permissions);
  const match = rows.find((row) => asText(row.entry_code) === asText(entryCode) && yesNo(row.active) === 'yes');
  if (!match) throw new Error('Invalid or inactive code');

  const user = {
    user_id: asText(match.user_id),
    full_name: asText(match.full_name),
    display_role: normalizeRole(match.display_role),
    name: asText(match.full_name),
    role: normalizeRole(match.display_role),
    default_view: asText(match.default_view)
  };

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`sess:${token}`, JSON.stringify(user), 60 * 60 * 8);
  return { token, user };
}

function bootstrap(user) {
  const permission = getPermissionByUserId(user.user_id);
  const role = asText(user.display_role || user.role);

  let routes;
  if (role === 'admin' || role === 'operations_reviewer') {
    routes = Object.keys(CONFIG.routesByFlag);
  } else if (role === 'instructor') {
    routes = ['my-data'];
  } else {
    routes = Object.keys(CONFIG.routesByFlag).filter((route) => yesNo(permission[CONFIG.routesByFlag[route]]) === 'yes');
    if (!routes.includes('my-data')) routes.push('my-data');
  }

  const preferred = asText(permission.default_view) || asText(user.default_view) || (role === 'instructor' ? 'my-data' : 'dashboard');
  const default_route = routes.includes(preferred) ? preferred : routes[0] || 'my-data';
  return { role, default_route, routes };
}

function dashboard(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const shortRows = readRows(CONFIG.sheets.dataShort);
  const longRows = mapDataLongRows();
  const instructorRows = readRows(CONFIG.sheets.contactsInstructors);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const courseEndings = longRows.filter((row) => asText(row.activity_type) === 'course' && inMonth(asText(row.end_date), monthStart, monthEnd)).length;

  const byManager = {};
  shortRows.forEach((row) => bumpManager(byManager, asText(row.activity_manager), 'short_count'));
  longRows.forEach((row) => bumpManager(byManager, asText(row.activity_manager), 'long_count'));

  return {
    totals: {
      short: shortRows.length,
      long: longRows.length,
      instructors: instructorRows.length,
      courseEndings
    },
    byManager: Object.keys(byManager).sort().map((k) => byManager[k])
  };
}

function activities(user, type) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);

  const notesByKey = readRows(CONFIG.sheets.operationsPrivateNotes).reduce((acc, row) => {
    const key = `${asText(row.source_sheet)}:${asText(row.source_row_id)}`;
    if (yesNo(row.active) === 'yes') acc[key] = row;
    return acc;
  }, {});

  const rows = [...mapDataShortRows(), ...mapDataLongRows()]
    .filter((row) => asText(type) === 'all' || asText(row.activity_type) === asText(type))
    .sort((a, b) => asText(a.start_date).localeCompare(asText(b.start_date)))
    .map((row) => {
      const key = `${row.source_sheet}:${row.RowID}`;
      return {
        ...row,
        private_note: user.display_role === 'operations_reviewer' ? asText(notesByKey[key]?.note_text) : ''
      };
    });

  return { rows };
}

function week(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const start = mondayOf(new Date());
  const all = allActivities();

  return {
    days: Array.from({ length: 7 }, (_, offset) => {
      const date = formatDate(shiftDate(start, offset));
      return {
        date,
        items: all.filter((row) => asText(row.start_date) <= date && asText(row.end_date || row.start_date) >= date)
      };
    })
  };
}

function month(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const days = new Date(y, m + 1, 0).getDate();
  const all = allActivities();

  return {
    cells: Array.from({ length: days }, (_, i) => {
      const date = formatDate(new Date(y, m, i + 1));
      return {
        day: i + 1,
        items: all.filter((row) => asText(row.start_date) <= date && asText(row.end_date || row.start_date) >= date)
      };
    })
  };
}

function exceptions(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const rows = mapDataLongRows();
  const counts = { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };

  const result = rows.reduce((acc, row) => {
    let exception_type = '';
    if (!asText(row.emp_id)) exception_type = 'missing_instructor';
    else if (!asText(row.start_date)) exception_type = 'missing_start_date';
    else if (asText(row.end_date) > CONFIG.endDateLimit) exception_type = 'late_end_date';

    if (!exception_type) return acc;
    counts[exception_type]++;
    acc.push({ RowID: row.RowID, activity_name: row.activity_name, end_date: row.end_date, exception_type });
    return acc;
  }, []);

  return { rows: result, counts };
}

function finance(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return {
    rows: allActivities().map((row) => ({
      RowID: row.RowID,
      activity_name: row.activity_name,
      finance_status: normalizeFinance(row.finance_status),
      status: asText(row.status)
    }))
  };
}

function instructors(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return { rows: readRows(CONFIG.sheets.contactsInstructors) };
}

function contacts(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const instructorRows = readRows(CONFIG.sheets.contactsInstructors).map((row) => ({
    kind: 'instructor',
    emp_id: asText(row.emp_id),
    full_name: asText(row.full_name),
    mobile: asText(row.mobile),
    email: asText(row.email),
    authority: '',
    school: '',
    contact_name: '',
    phone: ''
  }));
  const schoolRows = readRows(CONFIG.sheets.contactsSchools).map((row) => ({
    kind: 'school',
    emp_id: '',
    full_name: '',
    mobile: asText(row.mobile),
    email: asText(row.email),
    authority: asText(row.authority),
    school: asText(row.school),
    contact_name: asText(row.contact_name),
    phone: asText(row.phone)
  }));
  return { rows: [...instructorRows, ...schoolRows] };
}

function myData(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const empId = asText(user.user_id);
  return {
    rows: allActivities().filter((row) => asText(row.emp_id) === empId || asText(row.emp_id_2) === empId)
  };
}

function permissions(user) {
  requireAnyRole(user, ['admin', 'operations_reviewer']);
  return {
    rows: readRows(CONFIG.sheets.permissions).map((row) => ({ ...row, display_role: normalizeRole(row.display_role) }))
  };
}

function addActivity(user, activity) {
  requireAnyRole(user, ['admin', 'operations_reviewer']);

  const source_sheet = normalizeSourceSheet(activity.source_sheet || activity.source);
  const RowID = `${source_sheet === CONFIG.sheets.dataLong ? 'LONG' : 'SHORT'}-${new Date().getTime()}`;

  if (source_sheet === CONFIG.sheets.dataShort) {
    appendRow(CONFIG.sheets.dataShort, {
      RowID,
      activity_manager: asText(activity.activity_manager),
      authority: asText(activity.authority),
      school: asText(activity.school),
      activity_type: asText(activity.activity_type),
      activity_no: asText(activity.activity_no),
      activity_name: asText(activity.activity_name),
      sessions: asText(activity.sessions),
      price: asText(activity.price),
      funding: asText(activity.funding),
      start_time: asText(activity.start_time),
      end_time: asText(activity.end_time),
      emp_id: asText(activity.emp_id),
      instructor_name: asText(activity.instructor_name),
      emp_id_2: asText(activity.emp_id_2),
      instructor_name_2: asText(activity.instructor_name_2),
      start_date: asText(activity.start_date),
      status: asText(activity.status),
      notes: asText(activity.notes),
      finance_status: normalizeFinance(activity.finance_status),
      finance_notes: asText(activity.finance_notes)
    });
  } else {
    appendRow(CONFIG.sheets.dataLong, {
      RowID,
      activity_manager: asText(activity.activity_manager),
      authority: asText(activity.authority),
      school: asText(activity.school),
      activity_type: asText(activity.activity_type),
      activity_no: asText(activity.activity_no),
      activity_name: asText(activity.activity_name),
      sessions: asText(activity.sessions),
      price: asText(activity.price),
      funding: asText(activity.funding),
      start_time: asText(activity.start_time),
      end_time: asText(activity.end_time),
      emp_id: asText(activity.emp_id),
      instructor_name: asText(activity.instructor_name),
      start_date: asText(activity.start_date),
      end_date: asText(activity.end_date || activity.start_date),
      status: asText(activity.status),
      notes: asText(activity.notes),
      finance_status: normalizeFinance(activity.finance_status),
      finance_notes: asText(activity.finance_notes)
    });
    replaceLongMeetings(RowID, asText(activity.start_date), asText(activity.end_date || activity.start_date));
  }

  return { created: true, source_sheet, source_row_id: RowID };
}

function saveActivity(user, input) {
  const source_sheet = normalizeSourceSheet(input.source_sheet);
  const source_row_id = asText(input.source_row_id || input.RowID);
  const changes = input.changes || {};
  if (!source_row_id) throw new Error('Missing source_row_id');

  if (user.display_role === 'authorized_user' || user.display_role === 'instructor') {
    const created = createEditRequestsFromChanges(user, source_sheet, source_row_id, changes);
    return { created: true, count: created };
  }

  requireAnyRole(user, ['admin', 'operations_reviewer']);
  updateRowByKey(source_sheet, 'RowID', source_row_id, changes);

  if (source_sheet === CONFIG.sheets.dataLong && (Object.prototype.hasOwnProperty.call(changes, 'start_date') || Object.prototype.hasOwnProperty.call(changes, 'end_date'))) {
    const latest = findRowByKey(source_sheet, 'RowID', source_row_id);
    replaceLongMeetings(source_row_id, asText(latest.start_date), asText(latest.end_date));
  }

  return { updated: true, source_sheet, source_row_id };
}

function submitEditRequest(user, input) {
  requireAnyRole(user, ['authorized_user', 'instructor']);

  const source_sheet = normalizeSourceSheet(input.source_sheet);
  const source_row_id = asText(input.source_row_id || input.RowID);
  if (!source_row_id) throw new Error('Missing source_row_id');

  if (Array.isArray(input.requests) && input.requests.length) {
    input.requests.forEach((request) => {
      createEditRequestRow(user, {
        source_sheet,
        source_row_id,
        field_name: asText(request.field_name),
        old_value: asText(request.old_value),
        new_value: asText(request.new_value)
      });
    });
    return { created: true, count: input.requests.length };
  }

  if (input.field_name) {
    createEditRequestRow(user, {
      source_sheet,
      source_row_id,
      field_name: asText(input.field_name),
      old_value: asText(input.old_value),
      new_value: asText(input.new_value)
    });
    return { created: true, count: 1 };
  }

  const count = createEditRequestsFromChanges(user, source_sheet, source_row_id, input.changes || {});
  return { created: true, count };
}

function reviewEditRequest(user, input) {
  requireAnyRole(user, ['admin', 'operations_reviewer']);

  const request_id = asText(input.request_id);
  const decision = asText(input.status).toLowerCase();
  const reviewer_notes = asText(input.reviewer_notes);
  if (!request_id) throw new Error('Missing request_id');
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid status');

  const req = findRowByKey(CONFIG.sheets.editRequests, 'request_id', request_id);
  if (!req) throw new Error('Request not found');
  if (asText(req.status).toLowerCase() !== 'pending') throw new Error('Request already reviewed');

  if (decision === 'approved') {
    updateRowByKey(asText(req.source_sheet), 'RowID', asText(req.source_row_id), {
      [asText(req.field_name)]: asText(req.new_value)
    });

    if (asText(req.source_sheet) === CONFIG.sheets.dataLong && (asText(req.field_name) === 'start_date' || asText(req.field_name) === 'end_date')) {
      const row = findRowByKey(CONFIG.sheets.dataLong, 'RowID', asText(req.source_row_id));
      replaceLongMeetings(asText(req.source_row_id), asText(row.start_date), asText(row.end_date));
    }
  }

  updateRowByKey(CONFIG.sheets.editRequests, 'request_id', request_id, {
    status: decision,
    reviewed_at: new Date().toISOString(),
    reviewed_by: asText(user.user_id),
    reviewer_notes,
    active: 'yes'
  });

  return { reviewed: true, request_id, status: decision };
}

function savePermission(user, permissionInput) {
  requireAnyRole(user, ['admin', 'operations_reviewer']);
  const user_id = asText(permissionInput.user_id);
  if (!user_id) throw new Error('Missing user_id');

  const existing = getPermissionByUserId(user_id);
  const permission = {
    ...existing,
    user_id,
    entry_code: takeText(permissionInput, 'entry_code', existing),
    full_name: takeText(permissionInput, 'full_name', existing),
    display_role: normalizeRole(takeText(permissionInput, 'display_role', existing)),
    default_view: takeText(permissionInput, 'default_view', existing),
    view_admin: takeYesNo(permissionInput, 'view_admin', existing),
    view_dashboard: takeYesNo(permissionInput, 'view_dashboard', existing),
    view_activities: takeYesNo(permissionInput, 'view_activities', existing),
    view_week: takeYesNo(permissionInput, 'view_week', existing),
    view_month: takeYesNo(permissionInput, 'view_month', existing),
    view_instructors: takeYesNo(permissionInput, 'view_instructors', existing),
    view_exceptions: takeYesNo(permissionInput, 'view_exceptions', existing),
    view_my_data: takeYesNo(permissionInput, 'view_my_data', existing),
    view_contacts: takeYesNo(permissionInput, 'view_contacts', existing),
    view_finance: takeYesNo(permissionInput, 'view_finance', existing),
    view_permissions: takeYesNo(permissionInput, 'view_permissions', existing),
    can_request_edit: takeYesNo(permissionInput, 'can_request_edit', existing),
    can_edit_direct: takeYesNo(permissionInput, 'can_edit_direct', existing),
    can_add_activity: takeYesNo(permissionInput, 'can_add_activity', existing),
    can_review_requests: takeYesNo(permissionInput, 'can_review_requests', existing),
    active: takeYesNo(permissionInput, 'active', existing)
  };

  upsertRowByKey(CONFIG.sheets.permissions, 'user_id', permission);
  return { saved: true, user_id };
}

function savePrivateNote(user, input) {
  requireAnyRole(user, ['operations_reviewer']);
  const source_sheet = normalizeSourceSheet(input.source_sheet);
  const source_row_id = asText(input.source_row_id || input.RowID);
  if (!source_row_id) throw new Error('Missing source_row_id');

  const row = {
    source_sheet,
    source_row_id,
    note_text: asText(input.note_text),
    updated_at: new Date().toISOString(),
    updated_by: asText(user.user_id),
    active: takeYesNo(input, 'active', { active: 'yes' })
  };

  upsertRowByCompositeKeys(CONFIG.sheets.operationsPrivateNotes, ['source_sheet', 'source_row_id'], row);
  return { saved: true, source_sheet, source_row_id };
}

function allActivities() {
  return [...mapDataShortRows(), ...mapDataLongRows()];
}

function mapDataShortRows() {
  return readRows(CONFIG.sheets.dataShort).map((row) => ({
    source_sheet: CONFIG.sheets.dataShort,
    RowID: asText(row.RowID),
    activity_manager: asText(row.activity_manager),
    authority: asText(row.authority),
    school: asText(row.school),
    activity_type: asText(row.activity_type),
    activity_no: asText(row.activity_no),
    activity_name: asText(row.activity_name),
    sessions: asText(row.sessions),
    price: asText(row.price),
    funding: asText(row.funding),
    start_time: asText(row.start_time),
    end_time: asText(row.end_time),
    emp_id: asText(row.emp_id),
    instructor_name: asText(row.instructor_name),
    emp_id_2: asText(row.emp_id_2),
    instructor_name_2: asText(row.instructor_name_2),
    start_date: asText(row.start_date),
    end_date: asText(row.start_date),
    status: asText(row.status),
    notes: asText(row.notes),
    finance_status: normalizeFinance(row.finance_status),
    finance_notes: asText(row.finance_notes)
  }));
}

function mapDataLongRows() {
  const meetingMap = readRows(CONFIG.sheets.activityMeetings).reduce((acc, row) => {
    if (yesNo(row.active) !== 'yes') return acc;
    const source_row_id = asText(row.source_row_id);
    const meeting_date = asText(row.meeting_date);
    if (!source_row_id || !meeting_date) return acc;
    acc[source_row_id] = acc[source_row_id] || [];
    acc[source_row_id].push(meeting_date);
    return acc;
  }, {});

  return readRows(CONFIG.sheets.dataLong).map((row) => {
    const RowID = asText(row.RowID);
    const dates = (meetingMap[RowID] || []).sort();
    return {
      source_sheet: CONFIG.sheets.dataLong,
      RowID,
      activity_manager: asText(row.activity_manager),
      authority: asText(row.authority),
      school: asText(row.school),
      activity_type: asText(row.activity_type),
      activity_no: asText(row.activity_no),
      activity_name: asText(row.activity_name),
      sessions: asText(row.sessions),
      price: asText(row.price),
      funding: asText(row.funding),
      start_time: asText(row.start_time),
      end_time: asText(row.end_time),
      emp_id: asText(row.emp_id),
      instructor_name: asText(row.instructor_name),
      emp_id_2: '',
      instructor_name_2: '',
      start_date: dates[0] || asText(row.start_date),
      end_date: dates[dates.length - 1] || asText(row.end_date),
      status: asText(row.status),
      notes: asText(row.notes),
      finance_status: normalizeFinance(row.finance_status),
      finance_notes: asText(row.finance_notes)
    };
  });
}

function createEditRequestsFromChanges(user, source_sheet, source_row_id, changes) {
  const row = findRowByKey(source_sheet, 'RowID', source_row_id) || {};
  const fields = Object.keys(changes || {});
  fields.forEach((field) => {
    createEditRequestRow(user, {
      source_sheet,
      source_row_id,
      field_name: field,
      old_value: asText(row[field]),
      new_value: asText(changes[field])
    });
  });
  return fields.length;
}

function createEditRequestRow(user, payload) {
  appendRow(CONFIG.sheets.editRequests, {
    request_id: `REQ-${new Date().getTime()}-${Math.floor(Math.random() * 10000)}`,
    source_sheet: payload.source_sheet,
    source_row_id: payload.source_row_id,
    field_name: payload.field_name,
    old_value: payload.old_value,
    new_value: payload.new_value,
    requested_by_user_id: asText(user.user_id),
    requested_by_name: asText(user.full_name),
    requested_at: new Date().toISOString(),
    status: 'pending',
    reviewed_at: '',
    reviewed_by: '',
    reviewer_notes: '',
    active: 'yes'
  });
}

function replaceLongMeetings(source_row_id, start_date, end_date) {
  deleteRowsByField(CONFIG.sheets.activityMeetings, 'source_row_id', source_row_id);
  const start = start_date || end_date;
  const end = end_date || start_date;

  if (start) {
    appendRow(CONFIG.sheets.activityMeetings, {
      source_row_id,
      meeting_no: '1',
      meeting_date: start,
      notes: '',
      active: 'yes'
    });
  }

  if (end && end !== start) {
    appendRow(CONFIG.sheets.activityMeetings, {
      source_row_id,
      meeting_no: '2',
      meeting_date: end,
      notes: '',
      active: 'yes'
    });
  }
}

function getPermissionByUserId(user_id) {
  return findRowByKey(CONFIG.sheets.permissions, 'user_id', user_id) || {};
}

function normalizeSourceSheet(value) {
  const source = asText(value);
  if (!source || source === 'short' || source === CONFIG.sheets.dataShort) return CONFIG.sheets.dataShort;
  if (source === 'long' || source === CONFIG.sheets.dataLong) return CONFIG.sheets.dataLong;
  throw new Error('Invalid source_sheet');
}

function normalizeRole(value) {
  const role = asText(value).toLowerCase();
  if (role === 'admin') return 'admin';
  if (role === 'operations reviewer' || role === 'operations_reviewer') return 'operations_reviewer';
  if (role === 'instructor') return 'instructor';
  return 'authorized_user';
}

function bumpManager(store, manager, counterKey) {
  const key = manager || 'unassigned';
  store[key] = store[key] || { activity_manager: key, short_count: 0, long_count: 0, total: 0 };
  store[key][counterKey]++;
  store[key].total++;
}

function parseBody(e) {
  const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
  return JSON.parse(raw || '{}');
}

function readRows(sheetName) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((h) => asText(h));
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, i) => { item[header] = row[i]; });
    return item;
  });
}

function appendRow(sheetName, item) {
  const sheet = getSheet(sheetName);
  const headers = sheet.getDataRange().getValues()[0].map((h) => asText(h));
  sheet.appendRow(headers.map((header) => item[header] ?? ''));
}

function updateRowByKey(sheetName, key, keyValue, changes) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => asText(h));
  const keyIdx = headers.indexOf(key);
  if (keyIdx < 0) throw new Error(`Missing key column: ${key}`);

  for (let i = 1; i < values.length; i++) {
    if (asText(values[i][keyIdx]) !== asText(keyValue)) continue;
    headers.forEach((header, col) => {
      if (Object.prototype.hasOwnProperty.call(changes, header)) values[i][col] = changes[header];
    });
    sheet.getRange(i + 1, 1, 1, headers.length).setValues([values[i]]);
    return;
  }
  throw new Error(`Row not found: ${keyValue}`);
}

function upsertRowByKey(sheetName, key, item) {
  const existing = findRowByKey(sheetName, key, item[key]);
  if (!existing) {
    appendRow(sheetName, item);
    return;
  }
  updateRowByKey(sheetName, key, item[key], item);
}

function upsertRowByCompositeKeys(sheetName, keys, item) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => asText(h));
  const keyIndexes = keys.map((key) => {
    const idx = headers.indexOf(key);
    if (idx < 0) throw new Error(`Missing key column: ${key}`);
    return idx;
  });

  for (let i = 1; i < values.length; i++) {
    const isMatch = keyIndexes.every((idx, p) => asText(values[i][idx]) === asText(item[keys[p]]));
    if (!isMatch) continue;
    const next = headers.map((header, col) => (Object.prototype.hasOwnProperty.call(item, header) ? item[header] : values[i][col]));
    sheet.getRange(i + 1, 1, 1, headers.length).setValues([next]);
    return;
  }

  appendRow(sheetName, item);
}

function deleteRowsByField(sheetName, field, value) {
  const sheet = getSheet(sheetName);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map((h) => asText(h));
  const idx = headers.indexOf(field);
  if (idx < 0) throw new Error(`Missing key column: ${field}`);

  for (let i = values.length - 1; i >= 1; i--) {
    if (asText(values[i][idx]) === asText(value)) sheet.deleteRow(i + 1);
  }
}

function findRowByKey(sheetName, key, keyValue) {
  const rows = readRows(sheetName);
  return rows.find((row) => asText(row[key]) === asText(keyValue)) || null;
}

function getSheet(sheetName) {
  const sheet = SpreadsheetApp.openById(CONFIG.spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  return sheet;
}

function requireSession(token) {
  if (!asText(token)) throw new Error('Unauthorized');
  const raw = CacheService.getScriptCache().get(`sess:${asText(token)}`);
  if (!raw) throw new Error('Unauthorized');
  return { user: JSON.parse(raw) };
}

function requireAnyRole(user, roles) {
  if (!roles.includes(asText(user.display_role))) throw new Error('Forbidden');
}

function takeText(input, key, fallbackObj) {
  return Object.prototype.hasOwnProperty.call(input, key) ? asText(input[key]) : asText(fallbackObj[key]);
}

function takeYesNo(input, key, fallbackObj) {
  return Object.prototype.hasOwnProperty.call(input, key) ? yesNo(input[key]) : yesNo(fallbackObj[key]);
}

function asText(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDate(value);
  return String(value).trim();
}

function yesNo(value) {
  return asText(value).toLowerCase() === 'yes' ? 'yes' : 'no';
}

function normalizeFinance(value) {
  return asText(value).toLowerCase() === 'closed' ? 'closed' : 'open';
}

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function shiftDate(date, days) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function inMonth(dateText, monthStart, monthEnd) {
  if (!dateText) return false;
  const d = new Date(dateText);
  return d >= monthStart && d <= monthEnd;
}

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
