import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {}
};

const { hasPermission } = await import('../frontend/src/permission-policy.js');
const { ROLE_PERMISSION_TEMPLATES } = await import('../frontend/src/capability-registry.js');
const {
  applyAttendanceManualCorrection,
  enforceAttendanceTravelMode,
  normalizeAttendanceApiRows,
  normalizeAttendanceAttachments
} = await import('../frontend/src/screens/attendance-control.js');
const { buildAttendanceUpdatePayload } = await import('../frontend/src/screens/payroll-control-finish.js');

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const adminStandalone = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../frontend/src/payroll-attendance-v2-bridge.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260916010000_attendance_control_pt_attachments.sql', import.meta.url), 'utf8');
const liveRecords = await readFile(new URL('../supabase/migrations/20260819223000_payroll_attendance_live_records_access.sql', import.meta.url), 'utf8');
const reopened = await readFile(new URL('../supabase/migrations/20260831143000_attendance_reopened_correction_window.sql', import.meta.url), 'utf8');
const retention = await readFile(new URL('../supabase/migrations/20260828223936_attendance_retention_foundation.sql', import.meta.url), 'utf8');
const finish = await readFile(new URL('../frontend/src/screens/payroll-control-finish.js', import.meta.url), 'utf8');
const attendanceControl = await readFile(new URL('../frontend/src/screens/attendance-control.js', import.meta.url), 'utf8');

function legacyRecordFromBridgeSource(row = {}) {
  // Mirror bridge mapping without importing the bridge module (which boots api/state).
  const text = (value) => String(value ?? '').trim();
  const attachments = Array.isArray(row.attachments) ? row.attachments : [];
  const publicTransport = row.public_transport === true;
  return {
    ID: text(row.record_id),
    employeeId: text(row.employee_id),
    employeeName: text(row.employee_name),
    employmentType: text(row.employment_type),
    team: text(row.team),
    attendanceDate: text(row.attendance_date),
    startTime: text(row.start_time),
    endTime: text(row.end_time),
    workHours: row.work_hours,
    activityType: text(row.activity_type),
    schoolName: text(row.school_name),
    municipality: text(row.municipality),
    programName: text(row.program_name),
    sessionNumber: text(row.session_number),
    totalExpenses: row.total_expenses,
    kilometers: row.kilometers,
    publicTransport,
    publicTransportCost: row.public_transport_cost ?? 0,
    expensesDetails: text(row.expenses_details),
    notes: text(row.notes),
    attachments,
    attachmentsNames: attachments.map((item) => text(item.fileName || item.file_name)).filter(Boolean).join(', '),
    status: '',
    approvedBy: '',
    approvedDate: ''
  };
}

test('view_attendance_control gates manager board workspace access', () => {
  assert.match(workspace, /hasPermission\(state\?\.user, 'view_attendance_control'\)/);
  assert.doesNotMatch(workspace, /function canUseWorkspace\(\)\s*\{\s*return role\(\) === 'admin';/);
});

test('activities_manager template includes view_attendance_control', () => {
  assert.equal(ROLE_PERMISSION_TEMPLATES.activities_manager.view_attendance_control, 'yes');
  assert.equal(hasPermission({
    role: 'activities_manager',
    permissions: ROLE_PERMISSION_TEMPLATES.activities_manager
  }, 'view_attendance_control'), true);
});

test('manager roles stay scoped by direct_manager in payroll records RPC', () => {
  assert.match(migration, /v_role in \('activities_manager', 'manager', 'instructor_manager'\)/);
  assert.match(migration, /ci\.direct_manager/);
  assert.match(liveRecords, /ci\.direct_manager/);
  assert.match(migration, /payroll_attendance_permission_denied/);
});

test('admin control mode reuses attendance-control instead of a duplicate UI', () => {
  assert.match(adminStandalone, /data-admin-attendance-control-open>בקרה ועריכה</);
  assert.match(adminStandalone, /import\('\.\/screens\/attendance-control\.js'\)/);
  assert.match(adminStandalone, /attendance\.bindAttendanceControl\(host,/);
  assert.match(adminStandalone, /attendanceControlHtml\(\)/);
  assert.doesNotMatch(adminStandalone, /function buildAdminRowEditor/);
});

test('admin overview screen remains available', () => {
  assert.match(adminStandalone, /בקרת נוכחות אדמין/);
  assert.match(adminStandalone, /data-admin-attendance-body/);
  assert.match(adminStandalone, /adminFinalizeAttendanceMonthPayroll/);
  assert.match(adminStandalone, /adminReopenAttendanceMonthForCorrection/);
});

test('public_transport fields flow from RPC through bridge into UI normalization', () => {
  assert.match(migration, /public_transport boolean/);
  assert.match(migration, /public_transport_cost numeric/);
  assert.match(migration, /p_fields \? 'publicTransport'/);
  assert.match(bridge, /publicTransport,/);
  assert.match(bridge, /publicTransportCost,/);
  assert.match(attendanceControl, /publicTransport/);
  assert.match(attendanceControl, /publicTransportCost/);

  const row = legacyRecordFromBridgeSource({
    record_id: '11111111-1111-1111-1111-111111111111',
    employee_id: '1501',
    employee_name: 'מדריך',
    employment_type: 'שכיר',
    team: 'מנהל א',
    attendance_date: '2026-09-02',
    start_time: '09:00',
    end_time: '11:00',
    work_hours: 2,
    activity_type: 'קורס',
    school_name: 'בי"ס',
    municipality: 'רשות',
    program_name: 'תכנית',
    session_number: '1',
    total_expenses: 0,
    kilometers: 0,
    expenses_details: '',
    notes: '',
    public_transport: true,
    public_transport_cost: 12.5,
    attachments: [{ id: 'a1', fileName: 'קבלה.pdf', storagePath: '1501/rec/file.pdf' }]
  });
  assert.equal(row.publicTransport, true);
  assert.equal(row.publicTransportCost, 12.5);
  assert.equal(row.attachmentsNames, 'קבלה.pdf');

  const normalized = normalizeAttendanceApiRows([row]);
  assert.equal(normalized[0].publicTransport, true);
  assert.equal(normalized[0].publicTransportCost, 12.5);
  assert.equal(normalized[0].attachments[0].fileName, 'קבלה.pdf');
});

test('PT correction write-back uses attendanceControlUpdateRecord payload fields', () => {
  assert.match(finish, /attendanceControlUpdateRecord/);
  assert.match(finish, /\['publicTransport', 'publicTransport'/);
  assert.match(finish, /\['publicTransportCost', 'publicTransportCost'/);

  const entry = {
    attendance: {
      ID: 'rec-1',
      employeeId: '1501',
      employeeName: 'מדריך',
      attendanceDate: '2026-09-02',
      startTime: '09:00',
      endTime: '11:00',
      workHours: 2,
      activityType: 'קורס',
      schoolName: 'בי"ס',
      municipality: 'רשות',
      programName: 'תכנית',
      sessionNumber: '1',
      totalExpenses: 0,
      kilometers: 18,
      publicTransport: false,
      publicTransportCost: 0,
      expensesDetails: '',
      notes: '',
      team: 'מנהל א',
      employmentType: 'שכיר',
      attachmentsNames: '',
      status: '',
      approvedBy: '',
      approvedDate: ''
    }
  };
  applyAttendanceManualCorrection(entry, { publicTransport: true, publicTransportCost: 9, kilometers: 0 });
  const update = buildAttendanceUpdatePayload(entry);
  assert.equal(update.changed, true);
  assert.equal(update.fields.publicTransport, true);
  assert.equal(update.fields.publicTransportCost, 9);
  assert.equal(update.fields.kilometers, 0);
});

test('PT and kilometers remain mutually exclusive', () => {
  const mixed = enforceAttendanceTravelMode({ publicTransport: true, publicTransportCost: 8, kilometers: 12 });
  assert.equal(mixed.publicTransport, true);
  assert.equal(mixed.kilometers, 0);
  assert.equal(mixed.publicTransportCost, 8);

  const kmWins = enforceAttendanceTravelMode({ publicTransport: false, publicTransportCost: 8, kilometers: 12 });
  assert.equal(kmWins.publicTransport, false);
  assert.equal(kmWins.publicTransportCost, 0);
  assert.equal(kmWins.kilometers, 12);

  assert.match(migration, /Enforce single travel reimbursement/);
  assert.match(migration, /if v_public_transport then/);
  assert.match(migration, /v_kilometers := 0/);
});

test('attachments are aggregated once in RPC and shown in control UI', () => {
  assert.match(migration, /jsonb_agg\(/);
  assert.match(migration, /from public\.attendance_record_attachments att/);
  assert.doesNotMatch(bridge, /for \(const row of[\s\S]*attendance_record_attachments/);
  assert.match(attendanceControl, /data-attendance-open-attachment/);
  assert.match(bridge, /attendanceControlAttachmentSignedUrl/);
  assert.equal(normalizeAttendanceAttachments([], 'a.pdf, b.png').length, 2);
});

test('lifecycle lock and reopen window remain in place', () => {
  assert.match(retention, /av2_guard_attendance_record_lifecycle/);
  assert.match(retention, /attendance_month_locked/);
  assert.match(reopened, /attendance_reopen_window_closed/);
  assert.match(reopened, /extract\(day from current_date\)::int <= 7/);
  assert.doesNotMatch(migration, /drop trigger if exists av2_guard_attendance_record_lifecycle/);
  assert.doesNotMatch(migration, /reopen_reason|correction_reason/);
});

test('manager role in attendance-control includes activities_manager and keeps team chooser admin-scoped', () => {
  assert.match(attendanceControl, /\['manager', 'instructor_manager', 'activities_manager'\]/);
  assert.match(attendanceControl, /\['operations_controller', 'system_admin', 'operation_manager', 'admin'\]/);
});
