import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { dashboardScreen } from '../frontend/src/screens/dashboard.js';
import { activitiesScreen } from '../frontend/src/screens/activities.js';
import { monthScreen } from '../frontend/src/screens/month.js';
import { weekScreen } from '../frontend/src/screens/week.js';
import { exceptionsScreen } from '../frontend/src/screens/exceptions.js';
import { financeScreen } from '../frontend/src/screens/finance.js';
import { instructorsScreen } from '../frontend/src/screens/instructors.js';
import { contactsScreen } from '../frontend/src/screens/contacts.js';
import { endDatesScreen } from '../frontend/src/screens/end-dates.js';

const SAMPLES_PER_SCREEN = 20;

class MockSheet {
  constructor(name, values) {
    this.name = name;
    this.values = values;
  }

  getName() { return this.name; }
  getLastRow() { return this.values.length; }
  getLastColumn() { return this.values[0] ? this.values[0].length : 0; }
  getDataRange() {
    return { getValues: () => this.values.map((row) => [...row]) };
  }

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

  appendRow(row) {
    this.values.push(row);
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
  const baseHeaders = [
    'RowID', 'activity_manager', 'authority', 'school', 'activity_type', 'activity_no', 'activity_name',
    'sessions', 'price', 'funding', 'start_time', 'end_time', 'emp_id', 'instructor_name', 'emp_id_2',
    'instructor_name_2', 'start_date', 'end_date', 'status', 'notes', 'finance_status', 'finance_notes'
  ];
  for (let i = 1; i <= 35; i++) baseHeaders.push(`Date${i}`);

  return {
    data_short: new MockSheet('data_short', mkSheet(baseHeaders, [
      ['SHORT-1', 'M-1', 'AUTH-1', 'School A', 'workshop', 'A-101', 'Short A', '1', '100', 'city', '09:00', '11:00', 'U-INST', 'Inst One', '', '', '2026-04-13', '2026-04-13', 'active', '', 'open', '', '2026-04-13'],
      ['SHORT-2', 'M-2', 'AUTH-2', 'School B', 'tour', 'A-102', 'Short B', '1', '120', 'city', '10:00', '12:00', 'U-INST2', 'Inst Two', '', '', '2026-04-14', '2026-04-14', 'active', '', 'closed', '', '2026-04-14'],
      ['SHORT-3', 'M-3', 'AUTH-1', 'School A', 'event', 'A-103', 'Short Missing Instructor', '1', '90', 'city', '08:00', '10:00', '', '', '', '', '2026-04-15', '2026-04-15', 'active', '', 'open', '', '2026-04-15']
    ])),
    data_long: new MockSheet('data_long', mkSheet(baseHeaders, [
      ['LONG-1', 'M-1', 'AUTH-1', 'School A', 'course', 'L-201', 'Long A', '8', '200', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '2026-04-01', '2026-05-31', 'active', '', 'closed', '', '2026-04-03', '2026-04-10', '2026-04-17'],
      ['LONG-2', 'M-1', 'AUTH-1', 'School A', 'after_school', 'L-202', 'Long B', '10', '210', 'city', '09:00', '12:00', 'U-INST', 'Inst One', '', '', '2026-04-02', '2026-06-15', 'active', '', 'open', '', '2026-04-04', '2026-04-11'],
      ['LONG-3', 'M-2', 'AUTH-2', 'School B', 'course', 'L-203', 'Long Missing Start', '8', '240', 'city', '11:00', '13:00', 'U-INST2', 'Inst Two', '', '', '', '2026-06-17', 'active', '', 'open', '', '2026-04-08'],
      ['LONG-4', 'M-4', 'AUTH-2', 'School B', 'course', 'L-204', 'Long Late End', '8', '240', 'city', '11:00', '13:00', 'U-INST2', 'Inst Two', '', '', '2026-04-09', '2026-04-12', 'active', '', 'open', '', '2026-04-09', '2026-06-25']
    ])),
    activity_meetings: new MockSheet('activity_meetings', mkSheet(
      ['source_row_id', 'meeting_no', 'meeting_date', 'notes', 'active'],
      [
        ['LONG-2', '1', '2026-04-04', '', 'yes'],
        ['LONG-2', '2', '2026-04-11', '', 'yes'],
        ['LONG-4', '1', '2026-06-25', '', 'yes']
      ]
    )),
    permissions: new MockSheet('permissions', mkSheet(
      [
        'user_id', 'entry_code', 'full_name', 'display_role', 'display_role2', 'default_view',
        'view_admin', 'view_dashboard', 'view_activities', 'view_week', 'view_month',
        'view_instructors', 'view_exceptions', 'view_my_data', 'view_contacts',
        'view_finance', 'view_end_dates', 'view_permissions', 'can_request_edit', 'can_edit_direct',
        'can_add_activity', 'can_review_requests', 'active'
      ],
      [[
        'U-REVIEW', 'CODE-REVIEW', 'Ops Reviewer', 'operation_manager', '', 'dashboard',
        'yes', 'yes', 'yes', 'yes', 'yes',
        'yes', 'yes', 'yes', 'yes',
        'yes', 'yes', 'yes', 'yes', 
        'yes', 'yes', 'yes'
      ]]
    )),
    settings: new MockSheet('settings', mkSheet(
      ['setting_key', 'setting_value', 'active'],
      [['data_start_row', '3', 'yes'], ['system_name', 'Dashboard Stage0', 'yes']]
    )),
    lists: new MockSheet('lists', mkSheet(
      ['name', 'value', 'active'],
      [
        ['activity_type', 'workshop', 'yes'],
        ['activity_type', 'course', 'yes'],
        ['activity_type', 'event', 'yes'],
        ['activity_type', 'tour', 'yes']
      ]
    )),
    contacts_instructors: new MockSheet('contacts_instructors', mkSheet(
      ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'],
      [
        ['U-INST', 'Inst One', '111', 'i1@example.com', '', 'part-time', 'M-1', 'yes'],
        ['U-INST2', 'Inst Two', '112', 'i2@example.com', '', 'full-time', 'M-2', 'yes']
      ]
    )),
    contacts_schools: new MockSheet('contacts_schools', mkSheet(
      ['authority', 'school', 'contact_name', 'contact_role', 'phone', 'mobile', 'email', 'address', 'notes', 'active'],
      [
        ['AUTH-1', 'School A', 'School Contact A', 'Coordinator', '222', '333', 'sa@example.com', '', '', 'yes'],
        ['AUTH-2', 'School B', 'School Contact B', 'Coordinator', '223', '334', 'sb@example.com', '', '', 'yes']
      ]
    )),
    edit_requests: new MockSheet('edit_requests', mkSheet(
      ['request_id', 'source_sheet', 'source_row_id', 'field_name', 'old_value', 'new_value', 'requested_by_user_id', 'requested_by_name', 'requested_at', 'status', 'reviewed_at', 'reviewed_by', 'reviewer_notes', 'active'],
      []
    )),
    operations_private_notes: new MockSheet('operations_private_notes', mkSheet(
      ['source_sheet', 'source_row_id', 'note_text', 'updated_at', 'updated_by', 'active'],
      []
    ))
  };
}

function toEvent(body) {
  return { postData: { contents: JSON.stringify(body) } };
}

function parseResponse(resp) {
  return JSON.parse(resp.content);
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
      computeDigest: (_algo, raw) => Array.from(crypto.createHash('md5').update(String(raw || '')).digest()).map((n) => (n > 127 ? n - 256 : n))
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

function percentile(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function renderDurationMs(screenModule, data, route) {
  const state = {
    route,
    user: { display_role: 'operations_reviewer', user_id: 'U-REVIEW' },
    activityTab: 'all',
    financeTab: 'active',
    financeStatusFilter: '',
    financeSearch: '',
    financeDateFrom: '',
    financeDateTo: '',
    financeMonthYm: '',
    dashboardMonthYm: '2026-04',
    weekOffset: 0,
    monthYm: '2026-04'
  };
  const start = performance.now();
  screenModule.render(data, { state });
  return Math.round((performance.now() - start) * 100) / 100;
}

function callAction(context, token, action, payload = {}) {
  const rsp = parseResponse(context.doPost(toEvent({ action, token, debug_perf: true, ...payload })));
  if (!rsp.ok) {
    throw new Error(`${action} failed: ${rsp.error}`);
  }
  return rsp.data;
}

function collectForScreen(context, token, screenSpec) {
  const apiDurations = [];
  const payloadBytes = [];
  const cacheSources = [];
  let firstRenderDuration = null;
  let bottleneckNotes = [];

  for (let i = 0; i < SAMPLES_PER_SCREEN; i++) {
    const data = callAction(context, token, screenSpec.action, screenSpec.payload);
    const debug = data?.debug_perf || {};
    apiDurations.push(Number(debug.total_ms || 0));
    payloadBytes.push(Number(debug.response_size_bytes || 0));
    cacheSources.push(debug.cache_hit ? 'cache' : 'server');

    if (i === 0) {
      firstRenderDuration = renderDurationMs(screenSpec.screen, data, screenSpec.route);
      const sheetReads = Array.isArray(debug.sheet_reads) ? debug.sheet_reads : [];
      const serverRead = sheetReads.find((item) => !item.from_cache);
      const heavyStep = Array.isArray(debug.steps)
        ? debug.steps.find((step) => Number(step.duration_ms || 0) >= 25)
        : null;
      if (serverRead) {
        bottleneckNotes.push(`sheet read (${serverRead.sheet}) ${serverRead.duration_ms}ms`);
      }
      if (heavyStep) {
        bottleneckNotes.push(`backend step ${heavyStep.step}=${heavyStep.duration_ms}ms`);
      }
      if (firstRenderDuration >= 50) {
        bottleneckNotes.push(`frontend first render ${firstRenderDuration}ms`);
      }
    }
  }

  const cacheHits = cacheSources.filter((s) => s === 'cache').length;
  const hitRatio = cacheSources.length ? cacheHits / cacheSources.length : null;

  return {
    screen: screenSpec.route,
    action: screenSpec.action,
    api_p50_ms: percentile(apiDurations, 50),
    api_p95_ms: percentile(apiDurations, 95),
    payload_p50_bytes: percentile(payloadBytes, 50),
    payload_p95_bytes: percentile(payloadBytes, 95),
    first_render_ms: firstRenderDuration,
    cache_hit_ratio: hitRatio,
    sample_sources: cacheSources,
    primary_source: cacheSources[0] || 'server',
    bottleneck_notes: bottleneckNotes.length ? bottleneckNotes.join('; ') : 'none observed'
  };
}

function writeMarkdownReport(results) {
  const now = new Date().toISOString();
  const lines = [];
  lines.push('# Stage 0 Baseline Measurements (Read Models Transition)');
  lines.push('');
  lines.push(`- Generated at (UTC): ${now}`);
  lines.push(`- Samples per screen: ${SAMPLES_PER_SCREEN}`);
  lines.push('- Source: local mock harness using current backend/frontend code paths with `debug_perf=true`.');
  lines.push('');
  lines.push('| Screen | API p50 (ms) | API p95 (ms) | Payload p50 (bytes) | Payload p95 (bytes) | First render (ms) | Cache hit ratio | First call source | Bottleneck notes |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---|---|');

  for (const row of results) {
    lines.push(`| ${row.screen} | ${row.api_p50_ms} | ${row.api_p95_ms} | ${row.payload_p50_bytes} | ${row.payload_p95_bytes} | ${row.first_render_ms} | ${(row.cache_hit_ratio * 100).toFixed(1)}% | ${row.primary_source} | ${row.bottleneck_notes} |`);
  }

  lines.push('');
  fs.writeFileSync('docs/architecture/read-models-stage0-baseline.md', `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const context = buildBackendContext();
  const login = parseResponse(context.doPost(toEvent({ action: 'login', user_id: 'U-REVIEW', entry_code: 'CODE-REVIEW' })));
  if (!login.ok) throw new Error(`login failed: ${login.error}`);

  const token = login.data.token;

  const screens = [
    { route: 'dashboard', action: 'dashboard', payload: { month: '2026-04' }, screen: dashboardScreen },
    { route: 'activities', action: 'activities', payload: { activity_type: 'all' }, screen: activitiesScreen },
    { route: 'month', action: 'month', payload: { month: '2026-04' }, screen: monthScreen },
    { route: 'week', action: 'week', payload: { offset: 0 }, screen: weekScreen },
    { route: 'exceptions', action: 'exceptions', payload: {}, screen: exceptionsScreen },
    { route: 'finance', action: 'finance', payload: {}, screen: financeScreen },
    { route: 'instructors', action: 'instructors', payload: {}, screen: instructorsScreen },
    { route: 'contacts', action: 'contacts', payload: {}, screen: contactsScreen },
    { route: 'endDates', action: 'endDates', payload: {}, screen: endDatesScreen }
  ];

  const results = screens.map((screenSpec) => collectForScreen(context, token, screenSpec));
  writeMarkdownReport(results);

  console.log(JSON.stringify(results, null, 2));
}

main();
