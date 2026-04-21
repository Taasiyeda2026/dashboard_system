import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dashboardScreen } from '../frontend/src/screens/dashboard.js';
import { activitiesScreen } from '../frontend/src/screens/activities.js';
import { financeScreen } from '../frontend/src/screens/finance.js';
import { operationsScreen } from '../frontend/src/screens/operations.js';

class MockSheet {
  constructor(name, values) {
    this.name = name;
    this.values = values;
  }
  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values[0] ? this.values[0].length : 0; }
  getRange(row, col, numRows, numCols) {
    const self = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const line = [];
          for (let c = 0; c < numCols; c++) {
            line.push((self.values[row - 1 + r] || [])[col - 1 + c] ?? '');
          }
          out.push(line);
        }
        return out;
      },
      setValues(rows) {
        for (let r = 0; r < numRows; r++) {
          for (let c = 0; c < numCols; c++) {
            if (!self.values[row - 1 + r]) self.values[row - 1 + r] = [];
            self.values[row - 1 + r][col - 1 + c] = rows[r][c];
          }
        }
      }
    };
  }
  appendRow(row) { this.values.push(row); }
  deleteRow(row) { this.values.splice(row - 1, 1); }
}

class MockSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(name) { return this.sheets[name] || null; }
}

function toEvent(body) {
  return { postData: { contents: JSON.stringify(body) } };
}

function parseResponse(resp) {
  return JSON.parse(resp.content);
}

function padRow(row, len) {
  const out = row.slice();
  while (out.length < len) out.push('');
  return out;
}

function mkSheet(headers, rows) {
  const len = headers.length;
  return [padRow(headers, len), new Array(len).fill(''), ...rows.map((r) => padRow(r, len))];
}

function buildSheets() {
  const baseActivityHeaders = [
    'RowID', 'activity_manager', 'authority', 'school', 'activity_type', 'activity_no', 'activity_name',
    'sessions', 'price', 'funding', 'start_time', 'end_time', 'emp_id', 'instructor_name', 'emp_id_2',
    'instructor_name_2', 'start_date', 'end_date', 'status', 'notes', 'finance_status', 'finance_notes'
  ];
  for (let i = 1; i <= 35; i++) baseActivityHeaders.push(`Date${i}`);

  return {
    data_short: new MockSheet('data_short', mkSheet(baseActivityHeaders, [
      ['SHORT-1', 'M-1', 'AUTH-1', 'School A', 'workshop', 'A-101', 'Short A', '1', '100', 'city', '09:00', '11:00', 'U-INST', 'Inst One', '', '', '2026-04-13', '2026-04-13', 'active', '', 'open', '', '2026-04-13'],
      ['SHORT-2', 'M-2', 'AUTH-2', 'School B', 'tour', 'A-102', 'Short B', '1', '120', 'city', '10:00', '12:00', 'U-INST', 'Inst One', '', '', '2026-04-14', '2026-04-14', 'active', '', 'closed', '', '2026-04-14']
    ])),
    data_long: new MockSheet('data_long', mkSheet(baseActivityHeaders, [
      ['LONG-1', 'M-1', 'AUTH-1', 'School A', 'course', 'L-201', 'Long A', '8', '200', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '2026-04-01', '2026-05-31', 'active', '', 'closed', '', '2026-04-03', '2026-04-10', '2026-04-17'],
      ['LONG-2', 'M-1', 'AUTH-1', 'School A', 'after_school', 'L-202', 'Long B', '10', '210', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '2026-04-02', '2026-06-15', 'active', '', 'open', '', '2026-04-04', '2026-04-11']
    ])),
    activity_meetings: new MockSheet('activity_meetings', mkSheet(
      ['source_row_id', 'meeting_no', 'meeting_date', 'notes', 'active'],
      [['LONG-2', '1', '2026-04-04', '', 'yes'], ['LONG-2', '2', '2026-04-11', '', 'yes']]
    )),
    permissions: new MockSheet('permissions', mkSheet(
      [
        'user_id', 'entry_code', 'full_name', 'display_role', 'display_role2', 'default_view',
        'view_admin', 'view_dashboard', 'view_activities', 'view_week', 'view_month',
        'view_instructors', 'view_exceptions', 'view_my_data', 'view_contacts',
        'view_finance', 'view_permissions', 'can_request_edit', 'can_edit_direct',
        'can_add_activity', 'can_review_requests', 'view_operations_data', 'active'
      ],
      [[
        'U-REVIEW', 'CODE-REVIEW', 'Ops Reviewer', 'operations reviewer', '', 'dashboard',
        'yes', 'yes', 'yes', 'yes', 'yes',
        'yes', 'yes', 'yes', 'yes',
        'yes', 'yes', 'yes', 'yes',
        'yes', 'yes', 'yes', 'yes'
      ]]
    )),
    settings: new MockSheet('settings', mkSheet(
      ['setting_key', 'setting_value', 'active'],
      [['data_start_row', '3', 'yes']]
    )),
    lists: new MockSheet('lists', mkSheet(['name', 'value', 'active'], [['activity_type', 'workshop', 'yes']])),
    contacts_instructors: new MockSheet('contacts_instructors', mkSheet(['emp_id', 'full_name', 'active'], [['U-INST', 'Inst One', 'yes']])),
    contacts_schools: new MockSheet('contacts_schools', mkSheet(['authority', 'school', 'contact_name', 'active'], [['AUTH-1', 'School A', 'School Contact', 'yes']])),
    edit_requests: new MockSheet('edit_requests', mkSheet(['request_id', 'active'], [])),
    operations_private_notes: new MockSheet('operations_private_notes', mkSheet(
      ['source_sheet', 'source_row_id', 'note_text', 'updated_at', 'updated_by', 'active'], []
    ))
  };
}

function buildBackendContext() {
  const sheets = buildSheets();
  const spreadsheet = new MockSpreadsheet(sheets);
  const cache = new Map();
  const context = {
    SpreadsheetApp: { openById: () => spreadsheet },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v) => cache.set(k, v),
        get: (k) => cache.get(k) || null,
        remove: (k) => cache.delete(k)
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
      },
      DigestAlgorithm: { MD5: 'md5' },
      computeDigest: (algo, raw) => Array.from(crypto.createHash('md5').update(String(raw || '')).digest()).map((n) => n > 127 ? n - 256 : n)
    },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (content) => ({ content, setMimeType() { return this; } })
    },
    console
  };
  vm.createContext(context);
  const files = fs.readdirSync('backend')
    .filter((f) => f.endsWith('.gs'))
    .sort((a, b) => (a === 'Code.gs' ? 1 : b === 'Code.gs' ? -1 : a.localeCompare(b)));
  for (const file of files) {
    const source = fs.readFileSync(path.join('backend', file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function renderMs(screen, data, state) {
  const t0 = performance.now();
  screen.render(data, { state });
  return Math.round(performance.now() - t0);
}

function runAction(context, token, action, payload = {}) {
  const rsp = parseResponse(context.doPost(toEvent({ action, token, debug_perf: true, ...payload })));
  if (!rsp.ok) throw new Error(`${action} failed: ${rsp.error}`);
  return { data: rsp.data, perf: rsp.data?.debug_perf || null };
}

function main() {
  const context = buildBackendContext();
  const login = parseResponse(context.doPost(toEvent({
    action: 'login',
    user_id: 'U-REVIEW',
    entry_code: 'CODE-REVIEW'
  })));
  if (!login.ok) throw new Error(`login failed: ${login.error}`);
  const token = login.data.token;

  const dashboard = runAction(context, token, 'dashboard', { month: '2026-04' });
  const activities = runAction(context, token, 'activities', { activity_type: 'all' });
  const finance = runAction(context, token, 'finance', {});
  const operations = runAction(context, token, 'operations', {});

  const screenState = {
    route: 'dashboard',
    user: { display_role: 'operations_reviewer', user_id: 'U-REVIEW' },
    financeTab: 'active',
    financeStatusFilter: '',
    financeSearch: ''
  };

  const summary = {
    dashboard: {
      backend_ms: dashboard.perf.total_ms,
      sheets_read_ms: dashboard.perf.sheets_total_ms,
      payload_bytes: dashboard.perf.response_size_bytes,
      render_ms: renderMs(dashboardScreen, dashboard.data, { ...screenState, route: 'dashboard' }),
      cache_hit: !!dashboard.perf.cache_hit
    },
    activities: {
      backend_ms: activities.perf.total_ms,
      sheets_read_ms: activities.perf.sheets_total_ms,
      payload_bytes: activities.perf.response_size_bytes,
      render_ms: renderMs(activitiesScreen, activities.data, { ...screenState, route: 'activities', activityTab: 'all' }),
      cache_hit: !!activities.perf.cache_hit
    },
    finance: {
      backend_ms: finance.perf.total_ms,
      sheets_read_ms: finance.perf.sheets_total_ms,
      payload_bytes: finance.perf.response_size_bytes,
      render_ms: renderMs(financeScreen, finance.data, { ...screenState, route: 'finance' }),
      cache_hit: !!finance.perf.cache_hit
    },
    operations: {
      backend_ms: operations.perf.total_ms,
      sheets_read_ms: operations.perf.sheets_total_ms,
      payload_bytes: operations.perf.response_size_bytes,
      render_ms: renderMs(operationsScreen, operations.data, { ...screenState, route: 'operations' }),
      cache_hit: !!operations.perf.cache_hit
    }
  };

  console.log(JSON.stringify(summary, null, 2));
}

main();
