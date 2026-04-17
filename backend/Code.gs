/**
 * Internal operations backend for Google Apps Script.
 * Source of truth: Google Sheets only.
 */

const SETTINGS = {
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
  return jsonOut({ ok: true, data: { service: 'operations-backend', status: 'ready' } });
}

function doPost(e) {
  try {
    const input = JSON.parse(e.postData.contents || '{}');
    const action = input.action;
    const auth = action === 'login' ? { user: null } : requireAuth(input.token);

    const map = {
      login: () => login(input.entryCode),
      bootstrap: () => bootstrap(auth.user),
      dashboard: () => dashboard(auth.user),
      activities: () => activities(auth.user, input.type || 'all'),
      week: () => week(auth.user),
      month: () => month(auth.user),
      exceptions: () => exceptions(auth.user),
      finance: () => finance(auth.user),
      instructors: () => instructors(auth.user),
      contacts: () => contacts(auth.user),
      myData: () => myData(auth.user),
      permissions: () => permissionsData(auth.user),
      submitEditRequest: () => submitEditRequest(auth.user, input)
    };

    if (!map[action]) throw new Error('Unknown action');
    return jsonOut({ ok: true, data: map[action]() });
  } catch (error) {
    return jsonOut({ ok: false, error: error.message || 'Unhandled error' });
  }
}

function login(entryCode) {
  const rows = rowsFor(SETTINGS.sheets.permissions);
  const match = rows.find((row) => str(row.entry_code) === str(entryCode) && yesNo(row.active) === 'yes');
  if (!match) throw new Error('Invalid or inactive code');

  const user = {
    user_id: str(match.user_id),
    name: str(match.name),
    role: normalizeRole(match.role),
    instructor_id: str(match.instructor_id)
  };

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(`sess:${token}`, JSON.stringify(user), 60 * 60 * 8);
  return { token, user };
}

function bootstrap(user) {
  return {
    role: user.role,
    routes: user.role === 'instructor'
      ? ['my-data']
      : ['dashboard', 'activities', 'week', 'month', 'instructors', 'exceptions', 'my-data', 'contacts', 'finance', 'permissions']
  };
}

function dashboard(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const shortRows = rowsFor(SETTINGS.sheets.dataShort);
  const longRows = withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings));
  const instructorRows = rowsFor(SETTINGS.sheets.instructors);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const courseEndings = longRows.filter((row) => row.activity_type === 'course' && inMonth(row.end_date, monthStart, monthEnd)).length;

  const byManager = {};
  shortRows.forEach((row) => {
    const k = str(row.activity_manager) || 'unassigned';
    byManager[k] = byManager[k] || { activity_manager: k, short_count: 0, long_count: 0, total: 0 };
    byManager[k].short_count++;
    byManager[k].total++;
  });
  longRows.forEach((row) => {
    const k = str(row.activity_manager) || 'unassigned';
    byManager[k] = byManager[k] || { activity_manager: k, short_count: 0, long_count: 0, total: 0 };
    byManager[k].long_count++;
    byManager[k].total++;
  });

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
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const notes = rowsFor(SETTINGS.sheets.privateNotes);
  const notesBySource = toMap(notes, 'source_row_id');
  const merged = [
    ...rowsFor(SETTINGS.sheets.dataShort).map((r) => mapShort(r)),
    ...withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings)).map((r) => mapLong(r))
  ].filter((row) => type === 'all' || row.activity_type === type)
   .sort((a, b) => str(a.start_date).localeCompare(str(b.start_date)));

  return {
    rows: merged.map((row) => ({ ...row, private_note: str(notesBySource[row.row_id]?.note || '') }))
  };
}

function week(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const start = mondayOf(new Date());
  const days = Array.from({ length: 7 }, (_, i) => shiftDate(start, i));
  const rows = allActivities();

  return {
    days: days.map((d) => {
      const key = fmtDate(d);
      return {
        date: key,
        items: rows.filter((r) => str(r.start_date) <= key && str(r.end_date || r.start_date) >= key)
      };
    })
  };
}

function month(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const rows = allActivities();

  return {
    cells: Array.from({ length: daysInMonth }, (_, i) => {
      const date = fmtDate(new Date(y, m, i + 1));
      return {
        day: i + 1,
        items: rows.filter((r) => str(r.start_date) <= date && str(r.end_date || r.start_date) >= date)
      };
    })
  };
}

function exceptions(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const rows = withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings));
  const endLimit = SETTINGS.endDateLimit;
  const counts = { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
  const result = [];

  rows.forEach((row) => {
    let ex = '';
    if (!str(row.instructor_1)) ex = 'missing_instructor';
    else if (!str(row.start_date)) ex = 'missing_start_date';
    else if (str(row.end_date) > endLimit) ex = 'late_end_date';
    if (!ex) return;

    counts[ex]++;
    result.push({ row_id: row.row_id, title: row.title, end_date: row.end_date, exception_type: ex });
  });

  return { rows: result, counts };
}

function finance(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return { rows: allActivities().map((r) => ({ row_id: r.row_id, title: r.title, finance_status: normalizeFinance(r.finance_status), active: yesNo(r.active) })) };
}

function instructors(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return { rows: rowsFor(SETTINGS.sheets.instructors).map((row) => ({
    instructor_id: str(row.instructor_id),
    full_name: str(row.full_name),
    direct_manager: str(row.direct_manager),
    active: yesNo(row.active)
  })) };
}

function contacts(user) {
  requireAny(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const instructorsRows = rowsFor(SETTINGS.sheets.instructors).map((r) => ({ kind: 'instructor', name: r.full_name, phone: r.phone, email: r.email }));
  const schoolsRows = rowsFor(SETTINGS.sheets.schools).map((r) => ({ kind: 'school', name: r.school_name, phone: r.phone, email: r.email }));
  return { rows: [...instructorsRows, ...schoolsRows] };
}

function myData(user) {
  requireAny(user, ['instructor', 'admin', 'operations_reviewer', 'authorized_user']);
  const instructorId = str(user.instructor_id);
  const rows = allActivities().filter((r) => str(r.instructor_1) === instructorId || str(r.instructor_2) === instructorId);
  return { rows };
}

function permissionsData(user) {
  requireAny(user, ['admin', 'operations_reviewer']);
  return { rows: rowsFor(SETTINGS.sheets.permissions).map((r) => ({ user_id: r.user_id, name: r.name, role: normalizeRole(r.role), active: yesNo(r.active) })) };
}

function submitEditRequest(user, input) {
  requireAny(user, ['authorized_user', 'instructor']);
  const id = str(input.source_row_id);
  if (!/^SHORT-|^LONG-/.test(id)) throw new Error('Invalid source row id');
  appendRow(SETTINGS.sheets.editRequests, {
    request_id: `REQ-${new Date().getTime()}`,
    source_row_id: id,
    status: 'pending',
    requester_user_id: user.user_id,
    changes_json: JSON.stringify(input.changes || {}),
    created_at: new Date().toISOString()
  });
  return { created: true };
}

function allActivities() {
  return [
    ...rowsFor(SETTINGS.sheets.dataShort).map((r) => mapShort(r)),
    ...withLongDates(rowsFor(SETTINGS.sheets.dataLong), rowsFor(SETTINGS.sheets.meetings)).map((r) => mapLong(r))
  ];
}

function mapShort(row) {
  return {
    row_id: str(row.row_id),
    title: str(row.title),
    activity_type: str(row.activity_type),
    start_date: str(row.start_date),
    end_date: str(row.start_date),
    instructor_1: str(row.instructor_1),
    instructor_2: str(row.instructor_2),
    activity_manager: str(row.activity_manager),
    finance_status: normalizeFinance(row.finance_status),
    active: yesNo(row.active)
  };
}

function mapLong(row) {
  return {
    row_id: str(row.row_id),
    title: str(row.title),
    activity_type: str(row.activity_type),
    start_date: str(row.start_date),
    end_date: str(row.end_date),
    instructor_1: str(row.instructor_1),
    instructor_2: '',
    activity_manager: str(row.activity_manager),
    finance_status: normalizeFinance(row.finance_status),
    active: yesNo(row.active)
  };
}

function withLongDates(longRows, meetingRows) {
  const byId = {};
  meetingRows.forEach((m) => {
    const id = str(m.source_row_id);
    const d = str(m.meeting_date);
    if (!id || !d) return;
    byId[id] = byId[id] || [];
    byId[id].push(d);
  });

  return longRows.map((row) => {
    const dates = (byId[str(row.row_id)] || []).sort();
    return {
      ...row,
      start_date: dates[0] || '',
      end_date: dates[dates.length - 1] || ''
    };
  });
}

function rowsFor(sheetName) {
  const sheet = SpreadsheetApp.openById(SETTINGS.spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error(`Missing sheet: ${sheetName}`);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map((h) => str(h));
  return values.slice(1).map((row) => {
    const item = {};
    headers.forEach((h, i) => { item[h] = row[i]; });
    return item;
  });
}

function appendRow(sheetName, item) {
  const sheet = SpreadsheetApp.openById(SETTINGS.spreadsheetId).getSheetByName(sheetName);
  const headers = sheet.getDataRange().getValues()[0].map((h) => str(h));
  const row = headers.map((h) => item[h] ?? '');
  sheet.appendRow(row);
}

function requireAuth(token) {
  const raw = CacheService.getScriptCache().get(`sess:${str(token)}`);
  if (!raw) throw new Error('Unauthorized');
  return { user: JSON.parse(raw) };
}

function requireAny(user, roles) {
  if (!roles.includes(user.role)) throw new Error('Forbidden');
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function toMap(rows, key) {
  return rows.reduce((acc, row) => { acc[str(row[key])] = row; return acc; }, {});
}

function str(value) {
  if (value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') return fmtDate(value);
  return String(value).trim();
}

function yesNo(value) {
  const v = str(value).toLowerCase();
  return v === 'yes' ? 'yes' : 'no';
}

function normalizeFinance(value) {
  const v = str(value).toLowerCase();
  return v === 'closed' ? 'closed' : 'open';
}

function normalizeRole(value) {
  const raw = str(value).toLowerCase();
  if (raw === 'admin') return 'admin';
  if (raw === 'operations reviewer' || raw === 'operations_reviewer') return 'operations_reviewer';
  if (raw === 'instructor') return 'instructor';
  return 'authorized_user';
}

function mondayOf(date) {
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = clone.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  clone.setDate(clone.getDate() + diff);
  return clone;
}

function shiftDate(date, days) {
  const clone = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  clone.setDate(clone.getDate() + days);
  return clone;
}

function inMonth(dateValue, monthStart, monthEnd) {
  const text = str(dateValue);
  if (!text) return false;
  const d = new Date(text);
  return d >= monthStart && d <= monthEnd;
}

function fmtDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
