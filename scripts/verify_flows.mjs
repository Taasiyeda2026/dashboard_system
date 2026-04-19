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
      ['RowID', 'activity_manager', 'authority', 'school', 'activity_type', 'activity_no', 'activity_name', 'sessions', 'price', 'funding', 'start_time', 'end_time', 'emp_id', 'instructor_name', 'emp_id_2', 'instructor_name_2', 'start_date', 'status', 'notes', 'finance_status', 'finance_notes'],
      ['SHORT-1', 'M-1', 'AUTH-1', 'School A', 'workshop', 'A-101', 'Short A', '1', '100', 'city', '09:00', '11:00', 'U-INST', 'Inst One', '', '', '2026-04-13', 'active', '', 'open', '']
    ]),
    data_long: new MockSheet('data_long', [
      [
        'RowID',
        'activity_manager',
        'authority',
        'school',
        'activity_type',
        'activity_no',
        'activity_name',
        'sessions',
        'price',
        'funding',
        'start_time',
        'end_time',
        'emp_id',
        'instructor_name',
        'emp_id_2',
        'instructor_name_2',
        'start_date',
        'end_date',
        'status',
        'notes',
        'finance_status',
        'finance_notes'
      ],
      ['LONG-1', 'M-1', 'AUTH-1', 'School A', 'course', 'L-201', 'Long Missing Instructor', '8', '200', 'city', '09:00', '12:00', '', '', '', '', '', '', 'active', '', 'closed', ''],
      ['LONG-2', 'M-1', 'AUTH-1', 'School A', 'course', 'L-202', 'Long Missing Start', '8', '200', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '', '', 'active', '', 'open', ''],
      ['LONG-3', 'M-1', 'AUTH-1', 'School A', 'course', 'L-203', 'Long Late End', '8', '200', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '', '', 'active', '', 'open', '']
    ]),
    activity_meetings: new MockSheet('activity_meetings', [
      ['source_row_id', 'meeting_no', 'meeting_date', 'notes', 'active'],
      ['LONG-3', '1', '2026-06-16', '', 'yes'],
      ['LONG-3', '2', '2026-06-17', '', 'yes']
    ]),
    permissions: new MockSheet('permissions', [
      ['user_id', 'entry_code', 'full_name', 'display_role', 'default_view', 'view_admin', 'view_dashboard', 'view_activities', 'view_week', 'view_month', 'view_instructors', 'view_exceptions', 'view_my_data', 'view_contacts', 'view_finance', 'view_permissions', 'can_request_edit', 'can_edit_direct', 'can_add_activity', 'can_review_requests', 'active'],
      ['U-ADMIN', 'CODE-ADMIN', 'Admin User', 'admin', 'dashboard', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'no', 'yes', 'yes', 'yes', 'yes'],
      ['U-REVIEW', 'CODE-REVIEW', 'Ops Reviewer', 'operations reviewer', 'dashboard', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'no', 'yes', 'yes', 'yes', 'yes'],
      ['U-AUTH', 'CODE-AUTH', 'Authorized', 'authorized_user', 'dashboard', 'no', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'yes', 'no', 'yes', 'no', 'no', 'no', 'yes'],
      ['U-INST', 'CODE-INST', 'Instructor', 'instructor', 'my-data', 'no', 'no', 'no', 'yes', 'yes', 'no', 'no', 'yes', 'no', 'no', 'no', 'yes', 'no', 'no', 'no', 'yes']
    ]),
    lists: new MockSheet('lists', [['name'], ['x']]),
    contacts_instructors: new MockSheet('contacts_instructors', [
      ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'],
      ['U-INST', 'Inst One', '111', 'i1@example.com', '', 'part-time', 'M-1', 'yes']
    ]),
    contacts_schools: new MockSheet('contacts_schools', [
      ['authority', 'school', 'contact_name', 'contact_role', 'phone', 'mobile', 'email', 'address', 'notes', 'active'],
      ['AUTH-1', 'School A', 'School Contact', 'Coordinator', '222', '333', 's@example.com', '', '', 'yes']
    ]),
    edit_requests: new MockSheet('edit_requests', [
      ['request_id', 'source_sheet', 'source_row_id', 'field_name', 'old_value', 'new_value', 'requested_by_user_id', 'requested_by_name', 'requested_at', 'status', 'reviewed_at', 'reviewed_by', 'reviewer_notes', 'active']
    ]),
    operations_private_notes: new MockSheet('operations_private_notes', [
      ['source_sheet', 'source_row_id', 'note_text', 'updated_at', 'updated_by', 'active'],
      ['data_short', 'SHORT-1', 'Sensitive note', '2026-04-01T00:00:00.000Z', 'U-REVIEW', 'yes']
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
      createTextOutput: (content) => ({ content, setMimeType() { return this; } })
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
  assert.equal(activitiesReviewer.data.rows.some((r) => r.RowID.startsWith('SHORT-')), true);
  assert.equal(activitiesReviewer.data.rows.some((r) => r.RowID.startsWith('LONG-')), true);

  const week = parseResponse(context.doPost(toEvent({ action: 'week', token: reviewLogin.data.token })));
  const month = parseResponse(context.doPost(toEvent({ action: 'month', token: reviewLogin.data.token })));
  const dashboard = parseResponse(context.doPost(toEvent({ action: 'dashboard', token: reviewLogin.data.token })));
  assert.ok(Array.isArray(week.data.days));
  assert.ok(Array.isArray(month.data.cells));
  assert.equal(typeof dashboard.data.totals.short, 'number');
  assert.equal(dashboard.data.totals.total_instructors, 1);

  const instructors = parseResponse(context.doPost(toEvent({ action: 'instructors', token: adminLogin.data.token })));
  assert.equal(instructors.ok, true);
  assert.equal(instructors.data.rows.length, 1);
  assert.equal(instructors.data.rows[0].emp_id, 'U-INST');

  const exceptions = parseResponse(context.doPost(toEvent({ action: 'exceptions', token: reviewLogin.data.token })));
  const exById = Object.fromEntries(exceptions.data.rows.map((r) => [r.RowID, r.exception_type]));
  assert.equal(exById['LONG-1'], 'missing_instructor');
  assert.equal(exById['LONG-2'], 'missing_start_date');
  assert.equal(exById['LONG-3'], 'late_end_date');

  const authEdit = parseResponse(context.doPost(toEvent({ action: 'saveActivity', token: authLogin.data.token, source_sheet: 'data_short', source_row_id: 'SHORT-1', changes: { activity_name: 'Auth change' } })));
  assert.equal(authEdit.data.created, true);
  assert.equal(sheets.data_short.values[1][6], 'Short A');
  assert.equal(sheets.edit_requests.values.length, 2);

  const adminEdit = parseResponse(context.doPost(toEvent({ action: 'saveActivity', token: adminLogin.data.token, source_sheet: 'data_short', source_row_id: 'SHORT-1', changes: { activity_name: 'Admin change' } })));
  assert.equal(adminEdit.data.updated, true);
  assert.equal(sheets.data_short.values[1][6], 'Admin change');

  const addByReviewer = parseResponse(context.doPost(toEvent({ action: 'addActivity', token: reviewLogin.data.token, activity: { source: 'short', activity_name: 'New short', activity_type: 'tour', start_date: '2026-04-18', emp_id: 'U-INST', activity_manager: 'M-1', finance_status: 'open', status: 'active' } })));
  assert.equal(addByReviewer.data.created, true);
  assert.ok(sheets.data_short.values.length > 2);

  const addByAuthorized = parseResponse(context.doPost(toEvent({ action: 'addActivity', token: authLogin.data.token, activity: { source: 'short', activity_name: 'Nope' } })));
  assert.equal(addByAuthorized.ok, false);

  const savePermission = parseResponse(context.doPost(toEvent({ action: 'savePermission', token: adminLogin.data.token, permission: { user_id: 'U-AUTH', full_name: 'Authorized', display_role: 'instructor', entry_code: 'CODE-AUTH', default_view: 'my-data', active: 'yes' } })));
  assert.equal(savePermission.data.saved, true);
  const permissionsRead = parseResponse(context.doPost(toEvent({ action: 'permissions', token: adminLogin.data.token })));
  const updatedRole = permissionsRead.data.rows.find((r) => r.user_id === 'U-AUTH');
  assert.equal(updatedRole.display_role, 'instructor');

  const finance = parseResponse(context.doPost(toEvent({ action: 'finance', token: reviewLogin.data.token })));
  assert.equal(finance.data.rows.some((r) => r.finance_status === 'closed'), true);

  console.log('Flow verification passed');
})();
