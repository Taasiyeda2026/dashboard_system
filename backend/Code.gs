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
    user_id: text(match.user_id),
    name: text(match.name),
    role: normalizeRole(match.role),
    instructor_id: text(match.instructor_id)
  };

  const token = Utilities.getUuid();
  CacheService.getScriptCache().put('session:' + token, JSON.stringify(user), 60 * 60 * 8);
  return { token: token, user: user };
}

function bootstrap(user) {
  const routes = routesByRole(user.role);
  return { routes: routes, default_route: routes[0] || 'login', role: user.role, user: user };
}

function dashboardData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const shortRows = readSheet(APP_CONFIG.sheets.dataShort).map(normalizeShort);
  const longRows = buildLongRows();
  const instructors = readSheet(APP_CONFIG.sheets.instructors);
  const currentMonth = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM');

  const grouped = {};
  shortRows.forEach(function(row) {
    const manager = text(row.activity_manager) || 'unassigned';
    grouped[manager] = grouped[manager] || { activity_manager: manager, total_short: 0, total_long: 0, total: 0 };
    grouped[manager].total_short += 1;
    grouped[manager].total += 1;
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

function activitiesData(user, payload) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const filterType = text(payload.activity_type || 'all');
  const filterStatus = text(payload.finance_status || '');
  const viewRows = allActivities().filter(function(row) {
    if (filterType !== 'all' && row.activity_type !== filterType) return false;
    if (filterStatus && row.finance_status !== filterStatus) return false;
    return true;
  }).sort(function(a, b) {
    return text(a.start_date).localeCompare(text(b.start_date));
  });

  const notesBySource = mapByKey(readSheet(APP_CONFIG.sheets.privateNotes), 'source_row_id');
  return {
    rows: viewRows.map(function(row) {
      return {
        row_id: row.row_id,
        source_sheet: row.source_sheet,
        title: row.title,
        activity_type: row.activity_type,
        start_date: row.start_date,
        end_date: row.end_date,
        instructor_1: row.instructor_1,
        instructor_2: row.instructor_2,
        activity_manager: row.activity_manager,
        finance_status: row.finance_status,
        active: row.active,
        private_note: user.role === 'operations_reviewer' ? text((notesBySource[row.row_id] || {}).note) : ''
      };
    }),
    filters: {
      activity_types: ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'],
      finance_statuses: ['open', 'closed']
    }
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

  rows.forEach(function(row) {
    let exceptionType = '';
    if (!text(row.instructor_1)) exceptionType = 'missing_instructor';
    else if (!text(row.start_date)) exceptionType = 'missing_start_date';
    else if (text(row.end_date) > APP_CONFIG.endDateLimit) exceptionType = 'late_end_date';
    if (!exceptionType) return;

    counts[exceptionType] += 1;
    result.push({
      row_id: row.row_id,
      title: row.title,
      activity_type: row.activity_type,
      start_date: row.start_date,
      end_date: row.end_date,
      exception_type: exceptionType
    });
  });

  return { rows: result, counts: counts, priority: ['missing_instructor', 'missing_start_date', 'late_end_date'] };
}

function financeData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return {
    rows: allActivities().map(function(row) {
      return {
        row_id: row.row_id,
        title: row.title,
        finance_status: row.finance_status,
        active: row.active,
        activity_manager: row.activity_manager
      };
    })
  };
}

function instructorsData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  return {
    rows: readSheet(APP_CONFIG.sheets.instructors).map(function(row) {
      return {
        instructor_id: text(row.instructor_id),
        full_name: text(row.full_name),
        phone: text(row.phone),
        email: text(row.email),
        direct_manager: text(row.direct_manager),
        active: toYesNo(row.active)
      };
    })
  };
}

function contactsData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user']);
  const instructors = readSheet(APP_CONFIG.sheets.instructors).map(function(r) {
    return { type: 'instructor', name: text(r.full_name), phone: text(r.phone), email: text(r.email) };
  });
  const schools = readSheet(APP_CONFIG.sheets.schools).map(function(r) {
    return { type: 'school', name: text(r.school_name), phone: text(r.phone), email: text(r.email) };
  });
  return { rows: instructors.concat(schools) };
}

function myData(user) {
  allow(user, ['admin', 'operations_reviewer', 'authorized_user', 'instructor']);
  if (user.role === 'instructor') {
    return {
      rows: allActivities().filter(function(row) {
        return text(row.instructor_1) === text(user.instructor_id) || text(row.instructor_2) === text(user.instructor_id);
      })
    };
  }
  return { rows: allActivities() };
}

function permissionsData(user) {
  allow(user, ['admin', 'operations_reviewer']);
  return {
    rows: readSheet(APP_CONFIG.sheets.permissions).map(function(row) {
      return {
        user_id: text(row.user_id),
        name: text(row.name),
        role: normalizeRole(row.role),
        entry_code: text(row.entry_code),
        instructor_id: text(row.instructor_id),
        active: toYesNo(row.active)
      };
    })
  };
}

function addActivity(user, payload) {
  allow(user, ['admin', 'operations_reviewer']);
  const target = text(payload.target || 'data_short');
  const data = payload.data || {};
  if (target !== 'data_short' && target !== 'data_long') throw new Error('Invalid target sheet');

  if (target === 'data_short') {
    const row = {
      row_id: nextId(APP_CONFIG.sheets.dataShort, 'SHORT-'),
      title: text(data.title),
      activity_type: text(data.activity_type),
      start_date: text(data.start_date),
      instructor_1: text(data.instructor_1),
      instructor_2: text(data.instructor_2),
      activity_manager: text(data.activity_manager),
      finance_status: normalizeFinance(data.finance_status),
      active: toYesNo(data.active || 'yes')
    };
    appendToSheet(APP_CONFIG.sheets.dataShort, row);
    return { created: true, row_id: row.row_id, target: target };
  }

  const longRow = {
    row_id: nextId(APP_CONFIG.sheets.dataLong, 'LONG-'),
    title: text(data.title),
    activity_type: text(data.activity_type),
    instructor_1: text(data.instructor_1),
    activity_manager: text(data.activity_manager),
    finance_status: normalizeFinance(data.finance_status),
    active: toYesNo(data.active || 'yes')
  };
  appendToSheet(APP_CONFIG.sheets.dataLong, longRow);

  const meetings = Array.isArray(data.meetings) ? data.meetings : [];
  meetings.filter(function(d) { return !!text(d); }).forEach(function(date) {
    appendToSheet(APP_CONFIG.sheets.meetings, {
      meeting_id: Utilities.getUuid(),
      source_row_id: longRow.row_id,
      meeting_date: text(date)
    });
  });

  return { created: true, row_id: longRow.row_id, target: target };
}

function saveActivity(user, payload) {
  const sourceRowId = text(payload.source_row_id);
  if (!sourceRowId) throw new Error('source_row_id is required');
  const changes = payload.changes || {};

  if (user.role === 'authorized_user' || user.role === 'instructor') {
    return submitEditRequest(user, { source_row_id: sourceRowId, changes: changes });
  }
  allow(user, ['admin', 'operations_reviewer']);

  const isShort = sourceRowId.indexOf('SHORT-') === 0;
  const sheetName = isShort ? APP_CONFIG.sheets.dataShort : APP_CONFIG.sheets.dataLong;
  const records = readSheet(sheetName);
  const index = records.findIndex(function(row) { return text(row.row_id) === sourceRowId; });
  if (index === -1) throw new Error('Row not found');

  const updated = Object.assign({}, records[index], changes);
  if (!isShort) updated.instructor_2 = '';
  if (updated.finance_status) updated.finance_status = normalizeFinance(updated.finance_status);
  if (updated.active) updated.active = toYesNo(updated.active);

  writeBack(sheetName, records, index, updated);
  return { updated: true, source_row_id: sourceRowId };
}

function submitEditRequest(user, payload) {
  allow(user, ['authorized_user', 'instructor']);
  const sourceRowId = text(payload.source_row_id);
  if (!/^SHORT-|^LONG-/.test(sourceRowId)) throw new Error('Invalid source_row_id');

  const requestRow = {
    request_id: 'REQ-' + new Date().getTime(),
    source_row_id: sourceRowId,
    requester_user_id: text(user.user_id),
    status: 'pending',
    changes_json: JSON.stringify(payload.changes || {}),
    created_at: new Date().toISOString(),
    reviewed_by: '',
    reviewed_at: ''
  };
  appendToSheet(APP_CONFIG.sheets.editRequests, requestRow);
  return { created: true, request_id: requestRow.request_id };
}

function reviewEditRequest(user, payload) {
  allow(user, ['operations_reviewer']);
  const requestId = text(payload.request_id);
  const newStatus = text(payload.status);
  if (['approved', 'rejected'].indexOf(newStatus) === -1) throw new Error('Invalid review status');

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

  writeBack(APP_CONFIG.sheets.editRequests, records, index, row);
  return { reviewed: true, request_id: requestId, status: newStatus };
}

function savePermission(user, payload) {
  allow(user, ['admin', 'operations_reviewer']);
  const row = payload.row || {};
  const records = readSheet(APP_CONFIG.sheets.permissions);
  const index = records.findIndex(function(r) { return text(r.user_id) === text(row.user_id); });
  const normalized = {
    user_id: text(row.user_id),
    name: text(row.name),
    role: normalizeRole(row.role),
    entry_code: text(row.entry_code),
    instructor_id: text(row.instructor_id),
    active: toYesNo(row.active)
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

function allActivities() {
  const shortRows = readSheet(APP_CONFIG.sheets.dataShort).map(normalizeShort);
  const longRows = buildLongRows();
  return shortRows.concat(longRows);
}

function visibleActivitiesForUser(user) {
  const rows = allActivities();
  if (user.role !== 'instructor') return rows;
  return rows.filter(function(row) {
    return text(row.instructor_1) === text(user.instructor_id) || text(row.instructor_2) === text(user.instructor_id);
  });
}

function buildLongRows() {
  const longRows = readSheet(APP_CONFIG.sheets.dataLong);
  const meetings = readSheet(APP_CONFIG.sheets.meetings);
  const grouped = {};
  meetings.forEach(function(m) {
    const source = text(m.source_row_id);
    if (!/^LONG-/.test(source)) return;
    grouped[source] = grouped[source] || [];
    grouped[source].push(text(m.meeting_date));
  });

  return longRows.map(function(row) {
    const rowId = text(row.row_id);
    const dates = (grouped[rowId] || []).sort();
    return {
      row_id: rowId,
      source_sheet: APP_CONFIG.sheets.dataLong,
      title: text(row.title),
      activity_type: text(row.activity_type),
      start_date: dates[0] || text(row.start_date),
      end_date: dates.length ? dates[dates.length - 1] : text(row.end_date),
      instructor_1: text(row.instructor_1),
      instructor_2: '',
      activity_manager: text(row.activity_manager),
      finance_status: normalizeFinance(row.finance_status),
      active: toYesNo(row.active)
    };
  });
}

function normalizeShort(row) {
  return {
    row_id: text(row.row_id),
    source_sheet: APP_CONFIG.sheets.dataShort,
    title: text(row.title),
    activity_type: text(row.activity_type),
    start_date: text(row.start_date),
    end_date: text(row.start_date),
    instructor_1: text(row.instructor_1),
    instructor_2: text(row.instructor_2),
    activity_manager: text(row.activity_manager),
    finance_status: normalizeFinance(row.finance_status),
    active: toYesNo(row.active)
  };
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
  if (values.length < 2) return [];
  const headers = values[0].map(function(h) { return text(h); });
  return values.slice(1).filter(function(row) {
    return row.some(function(cell) { return text(cell) !== ''; });
  }).map(function(row) {
    const item = {};
    headers.forEach(function(h, idx) { item[h] = row[idx]; });
    return item;
  });
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

function getSheet(name) {
  const spreadsheet = SpreadsheetApp.openById(APP_CONFIG.spreadsheetId);
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

function normalizeRole(value) {
  const role = text(value).toLowerCase();
  if (['admin', 'operations_reviewer', 'authorized_user', 'instructor'].indexOf(role) >= 0) return role;
  throw new Error('Invalid role: ' + role);
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

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
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
