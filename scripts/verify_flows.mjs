import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

class MockSheet {
  constructor(name, values) {
    this.name = name;
    this.values = values;
  }
  getDataRange() {
    return { getValues: () => this.values.map((r) => [...r]) };
  }
  appendRow(row) {
    this.values.push(row);
  }
  getRange(row, col, numRows, numCols) {
    return {
      setValues: (rows) => {
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            this.values[row - 1 + r][col - 1 + c] = rows[r][c];
          }
        }
      }
    };
  }
  deleteRow(row) {
    this.values.splice(row - 1, 1);
  }
}

class MockSpreadsheet {
  constructor(sheets) {
    this.sheets = sheets;
  }
  getSheetByName(name) {
    return this.sheets[name] || null;
  }
}

function toEvent(body) {
  return { postData: { contents: JSON.stringify(body) } };
}

function parseResponse(resp) {
  return JSON.parse(resp.content);
}

function seedSheets() {
  return {
    data_short: new MockSheet('data_short', [
      ['row_id', 'title', 'activity_type', 'start_date', 'instructor_1', 'instructor_2', 'activity_manager', 'finance_status', 'active'],
      ['SHORT-1', 'Short A', 'course', '2026-04-13', 'I-1', '', 'M-1', 'open', 'yes']
    ]),
    data_long: new MockSheet('data_long', [
      ['row_id', 'title', 'activity_type', 'instructor_1', 'activity_manager', 'finance_status', 'active', 'start_date', 'end_date'],
      ['LONG-1', 'Long Missing Instructor', 'course', '', 'M-1', 'closed', 'yes', '', ''],
      ['LONG-2', 'Long Missing Start', 'course', 'I-1', 'M-1', 'open', 'yes', '', ''],
      ['LONG-3', 'Long Late End', 'course', 'I-1', 'M-1', 'open', 'yes', '', '']
    ]),
    activity_meetings: new MockSheet('activity_meetings', [
      ['source_row_id', 'meeting_date'],
      ['LONG-3', '2026-06-16'],
      ['LONG-3', '2026-06-17']
    ]),
    permissions: new MockSheet('permissions', [
      ['user_id', 'name', 'role', 'entry_code', 'instructor_id', 'active'],
      ['U-ADMIN', 'Admin User', 'admin', 'CODE-ADMIN', '', 'yes'],
      ['U-REVIEW', 'Ops Reviewer', 'operations reviewer', 'CODE-REVIEW', '', 'yes'],
      ['U-AUTH', 'Authorized', 'authorized_user', 'CODE-AUTH', '', 'yes'],
      ['U-INST', 'Instructor', 'instructor', 'CODE-INST', 'I-1', 'yes']
    ]),
    lists: new MockSheet('lists', [['name'], ['x']]),
    contacts_instructors: new MockSheet('contacts_instructors', [
      ['instructor_id', 'full_name', 'direct_manager', 'phone', 'email', 'active'],
      ['I-1', 'Inst One', 'M-1', '111', 'i1@example.com', 'yes']
    ]),
    contacts_schools: new MockSheet('contacts_schools', [
      ['school_name', 'phone', 'email'],
      ['School A', '222', 's@example.com']
    ]),
    edit_requests: new MockSheet('edit_requests', [
      ['request_id', 'source_row_id', 'status', 'requester_user_id', 'changes_json', 'created_at']
    ]),
    operations_private_notes: new MockSheet('operations_private_notes', [
      ['source_row_id', 'note'],
      ['SHORT-1', 'Sensitive note']
    ])
  };
}

function buildContext() {
  const sheets = seedSheets();
  const spreadsheet = new MockSpreadsheet(sheets);
  const cache = new Map();

  const context = {
    SpreadsheetApp: { openById: () => spreadsheet },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v) => cache.set(k, v),
        get: (k) => cache.get(k) || null
      })
    },
    Utilities: {
      getUuid: () => `uuid-${Math.random().toString(16).slice(2)}`,
      formatDate: (date) => {
        const d = new Date(date);
        const yyyy = d.getUTCFullYear();
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(d.getUTCDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({
        content,
        setMimeType() { return this; }
      })
    },
    console
  };

  vm.createContext(context);
  const source = fs.readFileSync('backend/Code.gs', 'utf8');
  vm.runInContext(source, context);
  return { context, sheets };
}

(function run() {
  const { context, sheets } = buildContext();

  const adminLogin = parseResponse(context.doPost(toEvent({ action: 'login', entryCode: 'CODE-ADMIN' })));
  const reviewLogin = parseResponse(context.doPost(toEvent({ action: 'login', entryCode: 'CODE-REVIEW' })));
  const authLogin = parseResponse(context.doPost(toEvent({ action: 'login', entryCode: 'CODE-AUTH' })));
  const instLogin = parseResponse(context.doPost(toEvent({ action: 'login', entryCode: 'CODE-INST' })));

  assert.equal(adminLogin.ok, true);
  assert.equal(adminLogin.data.user.role, 'admin');
  assert.equal(instLogin.data.user.role, 'instructor');

  const bootstrapAdmin = parseResponse(context.doPost(toEvent({ action: 'bootstrap', token: adminLogin.data.token })));
  const bootstrapInst = parseResponse(context.doPost(toEvent({ action: 'bootstrap', token: instLogin.data.token })));
  assert.equal(bootstrapAdmin.data.default_route, 'dashboard');
  assert.equal(bootstrapInst.data.default_route, 'my-data');

  const activitiesReviewer = parseResponse(context.doPost(toEvent({ action: 'activities', token: reviewLogin.data.token, type: 'all' })));
  const activitiesAdmin = parseResponse(context.doPost(toEvent({ action: 'activities', token: adminLogin.data.token, type: 'all' })));
  assert.equal(activitiesReviewer.data.rows.some((r) => r.private_note === 'Sensitive note'), true);
  assert.equal(activitiesAdmin.data.rows.some((r) => r.private_note === 'Sensitive note'), false);
  assert.equal(activitiesReviewer.data.rows.some((r) => r.row_id.startsWith('SHORT-')), true);
  assert.equal(activitiesReviewer.data.rows.some((r) => r.row_id.startsWith('LONG-')), true);

  const week = parseResponse(context.doPost(toEvent({ action: 'week', token: reviewLogin.data.token })));
  const month = parseResponse(context.doPost(toEvent({ action: 'month', token: reviewLogin.data.token })));
  const dashboard = parseResponse(context.doPost(toEvent({ action: 'dashboard', token: reviewLogin.data.token })));
  assert.ok(Array.isArray(week.data.days));
  assert.ok(Array.isArray(month.data.cells));
  assert.equal(typeof dashboard.data.totals.short, 'number');

  const exceptions = parseResponse(context.doPost(toEvent({ action: 'exceptions', token: reviewLogin.data.token })));
  const exById = Object.fromEntries(exceptions.data.rows.map((r) => [r.row_id, r.exception_type]));
  assert.equal(exById['LONG-1'], 'missing_instructor');
  assert.equal(exById['LONG-2'], 'missing_start_date');
  assert.equal(exById['LONG-3'], 'late_end_date');

  const authEdit = parseResponse(context.doPost(toEvent({ action: 'saveActivity', token: authLogin.data.token, source_row_id: 'SHORT-1', changes: { title: 'Auth change' } })));
  assert.equal(authEdit.data.created, true);
  assert.equal(sheets.data_short.values[1][1], 'Short A');
  assert.equal(sheets.edit_requests.values.length, 2);

  const adminEdit = parseResponse(context.doPost(toEvent({ action: 'saveActivity', token: adminLogin.data.token, source_row_id: 'SHORT-1', changes: { title: 'Admin change' } })));
  assert.equal(adminEdit.data.updated, true);
  assert.equal(sheets.data_short.values[1][1], 'Admin change');

  const addByReviewer = parseResponse(context.doPost(toEvent({ action: 'addActivity', token: reviewLogin.data.token, activity: { source: 'short', title: 'New short', activity_type: 'tour', start_date: '2026-04-18', instructor_1: 'I-1', activity_manager: 'M-1', finance_status: 'open', active: 'yes' } })));
  assert.equal(addByReviewer.data.created, true);
  assert.ok(sheets.data_short.values.length > 2);

  const addByAuthorized = parseResponse(context.doPost(toEvent({ action: 'addActivity', token: authLogin.data.token, activity: { source: 'short', title: 'Nope' } })));
  assert.equal(addByAuthorized.ok, false);

  const savePermission = parseResponse(context.doPost(toEvent({ action: 'savePermission', token: adminLogin.data.token, permission: { user_id: 'U-AUTH', name: 'Authorized', role: 'instructor', entry_code: 'CODE-AUTH', instructor_id: 'I-1', active: 'yes' } })));
  assert.equal(savePermission.data.saved, true);
  const permissionsRead = parseResponse(context.doPost(toEvent({ action: 'permissions', token: adminLogin.data.token })));
  const updatedRole = permissionsRead.data.rows.find((r) => r.user_id === 'U-AUTH');
  assert.equal(updatedRole.role, 'instructor');

  const finance = parseResponse(context.doPost(toEvent({ action: 'finance', token: reviewLogin.data.token })));
  assert.equal(finance.data.rows.some((r) => r.finance_status === 'closed'), true);

  console.log('Flow verification passed');
})();
