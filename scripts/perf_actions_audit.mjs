import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

class MockSheet {
  constructor(name, values) { this.name = name; this.values = values; }
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
          for (let c = 0; c < numCols; c++) line.push((self.values[row - 1 + r] || [])[col - 1 + c] ?? '');
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
      },
      getValue() { return ((self.values[row - 1] || [])[col - 1] ?? ''); },
      setValue(v) {
        if (!self.values[row - 1]) self.values[row - 1] = [];
        self.values[row - 1][col - 1] = v;
      },
      clearContent() {},
      setNumberFormat() {}
    };
  }
  getMaxRows() { return Math.max(1000, this.values.length); }
  appendRow(row) { this.values.push(row); }
  deleteRow(row) { this.values.splice(row - 1, 1); }
}
class MockSpreadsheet {
  constructor(sheets) { this.sheets = sheets; }
  getSheetByName(name) { return this.sheets[name] || null; }
  getSheets() { return Object.values(this.sheets); }
}
const toEvent = (body) => ({ postData: { contents: JSON.stringify(body) } });
const parseResponse = (resp) => JSON.parse(resp.content);
const padRow = (row, len) => [...row, ...new Array(Math.max(0, len - row.length)).fill('')];
const mkSheet = (headers, rows) => {
  const len = headers.length;
  return [padRow(headers, len), new Array(len).fill(''), ...rows.map((r) => padRow(r, len))];
};

function buildSheets() {
  const baseHeaders = ['RowID','activity_manager','authority','school','activity_type','activity_no','activity_name','sessions','price','funding','start_time','end_time','emp_id','instructor_name','emp_id_2','instructor_name_2','start_date','end_date','status','notes','finance_status','finance_notes'];
  for (let i = 1; i <= 35; i++) baseHeaders.push(`Date${i}`);
  return {
    data_short: new MockSheet('data_short', mkSheet(baseHeaders, [
      ['SHORT-1','M-1','AUTH-1','School A','workshop','A-101','Short A','1','100','city','09:00','11:00','U-INST','Inst One','','','2026-04-13','2026-04-13','active','','open','','2026-04-13'],
      ['SHORT-2','M-2','AUTH-2','School B','tour','A-102','Short B','1','120','city','10:00','12:00','U-INST','Inst One','','','2026-04-14','2026-04-14','active','','closed','','2026-04-14']
    ])),
    data_long: new MockSheet('data_long', mkSheet(baseHeaders, [
      ['LONG-1','M-1','AUTH-1','School A','course','L-201','Long A','8','200','city','09:00','12:00','U-INST','Inst One','','','2026-04-01','2026-05-31','active','','closed','','2026-04-03','2026-04-10','2026-04-17'],
      ['LONG-2','M-1','AUTH-1','School A','after_school','L-202','Long B','10','210','city','09:00','12:00','U-INST','Inst One','','','2026-04-02','2026-06-15','active','','open','','2026-04-04','2026-04-11']
    ])),
    activity_meetings: new MockSheet('activity_meetings', mkSheet(['source_row_id','meeting_no','meeting_date','notes','active'], [['LONG-2','1','2026-04-04','','yes'],['LONG-2','2','2026-04-11','','yes']])),
    permissions: new MockSheet('permissions', mkSheet(['user_id','entry_code','full_name','display_role','display_role2','default_view','view_admin','view_dashboard','view_activities','view_week','view_month','view_instructors','view_exceptions','view_my_data','view_contacts','view_finance','view_permissions','can_request_edit','can_edit_direct','can_add_activity','can_review_requests','active'], [[
      'U-REVIEW','CODE-REVIEW','Ops Reviewer','operations_reviewer','','dashboard','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes','yes'
    ]])),
    settings: new MockSheet('settings', mkSheet(['setting_key','setting_value','active'], [['data_start_row','3','yes']])),
    lists: new MockSheet('lists', mkSheet(['name','value','active'], [['activity_type','workshop','yes']])),
    contacts_instructors: new MockSheet('contacts_instructors', mkSheet(['emp_id','full_name','active'], [['U-INST','Inst One','yes']])),
    contacts_schools: new MockSheet('contacts_schools', mkSheet(['authority','school','contact_name','active'], [['AUTH-1','School A','School Contact','yes']])),
    edit_requests: new MockSheet('edit_requests', mkSheet(['request_id','source_sheet','source_row_id','active'], [])),
    operations_private_notes: new MockSheet('operations_private_notes', mkSheet(['source_sheet','source_row_id','note_text','updated_at','updated_by','active'], [])),
    holidays: new MockSheet('holidays', mkSheet(['date','name','active'], [])),
    exceptions: new MockSheet('exceptions', mkSheet(['exception_id','type','start_date','end_date','active'], []))
  };
}

function buildContext() {
  const spreadsheet = new MockSpreadsheet(buildSheets());
  const cache = new Map();
  const context = {
    SpreadsheetApp: { openById: () => spreadsheet },
    CacheService: { getScriptCache: () => ({ put: (k, v) => cache.set(k, v), get: (k) => cache.get(k) || null, remove: (k) => cache.delete(k) }) },
    Utilities: {
      getUuid: () => `uuid-${Math.random().toString(16).slice(2)}`,
      formatDate: (date) => new Date(date).toISOString().slice(0, 10),
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf-8' },
      base64EncodeWebSafe: (input) => Buffer.from(String(input), 'utf8').toString('base64url'),
      base64DecodeWebSafe: (input) => Buffer.from(String(input), 'base64url').toString('utf8'),
      computeDigest: (_algo, raw) => Array.from(crypto.createHash('md5').update(String(raw || '')).digest()).map((n) => n > 127 ? n - 256 : n),
      computeHmacSha256Signature: (raw, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(raw)).digest()).map((n)=> n>127? n-256:n),
    },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (content) => ({ content, setMimeType() { return this; } }) },
    console
  };
  vm.createContext(context);
  const files = fs.readdirSync('backend').filter((f) => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? 1 : b === 'Code.gs' ? -1 : a.localeCompare(b)));
  for (const file of files) vm.runInContext(fs.readFileSync(path.join('backend', file), 'utf8'), context, { filename: file });
  return context;
}

function runAction(context, token, action, payload) {
  const t0 = performance.now();
  const rsp = parseResponse(context.doPost(toEvent({ action, token, debug_perf: true, ...(payload || {}) })));
  const durationMs = Math.round(performance.now() - t0);
  if (!rsp.ok) return { action, durationMs, status: 'failure', outgoing: 0, duplicates: 0, over20s: durationMs > 20000 };
  const reads = rsp.data?.debug_perf?.sheet_reads || [];
  const counter = new Map();
  for (const r of reads) {
    const key = `${r.sheet}|${r.method}|${r.columns || ''}`;
    counter.set(key, (counter.get(key) || 0) + 1);
  }
  const duplicates = [...counter.values()].reduce((acc, v) => acc + (v > 1 ? v - 1 : 0), 0);
  return { action, durationMs, status: 'success', outgoing: reads.length, duplicates, over20s: durationMs > 20000 };
}

const context = buildContext();
const login = parseResponse(context.doPost(toEvent({ action: 'login', user_id: 'U-REVIEW', entry_code: 'CODE-REVIEW' })));
if (!login.ok) throw new Error(login.error || 'login failed');
const token = login.data.token;

const actions = [
  ['dashboard', { month: '2026-04' }],
  ['activities', { activity_type: 'all' }],
  ['finance', {}],
  ['exceptions', {}],
  ['week', { date: '2026-04-13' }],
  ['month', { month: '2026-04' }]
];
const result = actions.map(([name, payload]) => runAction(context, token, name, payload));
console.table(result.map((r) => ({ action: r.action, durationMs: r.durationMs, 'success/failure': r.status, outgoingCalls: r.outgoing, duplicateCount: r.duplicates, over20s: r.over20s ? 'YES' : 'NO' })));
