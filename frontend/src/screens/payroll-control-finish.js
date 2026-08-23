import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityTypeDisplayLabel } from './shared/activity-options.js';
import {
  attendanceMonthLabel,
  buildCorrectedAttendanceWorkbook,
  rowWorkHours,
  attendanceEntryIsResolved,
  kmDayNeedsDecision
} from './attendance-control.js';

export const PAYROLL_APPROVAL_STATUS = 'approved_for_payroll';
export const PAYROLL_APPROVAL_TEXT_VERSION = 'payroll-control-declaration-v1';
export const PAYROLL_APPROVAL_TEXT =
  'אני מאשר/ת כי בדקתי את דיווח הנוכחות החודשי, ביצעתי את התיקונים הנדרשים והדוח מאושר על ידי מנהל.';

const txt = (value) => String(value ?? '').trim();
const optionalNumber = (value) => {
  if (value == null || txt(value) === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const LOGIC_APP_FIELDS = [
  'employeeName', 'employeeId', 'attendanceDate', 'startTime', 'endTime',
  'workHours', 'activityType', 'schoolName', 'municipality', 'programName',
  'sessionNumber', 'totalExpenses', 'kilometers', 'expensesDetails', 'notes',
  'team', 'employmentType', 'attachmentsNames', 'status', 'approvedBy', 'approvedDate'
];

const SOURCE_KEYS = {
  employeeName: ['employeeName', 'EmployeeName', 'empName'],
  employeeId: ['employeeId', 'EmployeeId', 'empNum'],
  attendanceDate: ['attendanceDate', 'AttendanceDate', 'date'],
  startTime: ['startTime', 'StartTime', 'start'],
  endTime: ['endTime', 'EndTime', 'end'],
  workHours: ['workHours', 'WorkHours', 'hours'],
  activityType: ['activityType', 'ActivityType', 'activity'],
  schoolName: ['schoolName', 'SchoolName', 'school'],
  municipality: ['municipality', 'Municipality', 'authority'],
  programName: ['programName', 'ProgramName', 'program'],
  sessionNumber: ['sessionNumber', 'SessionNumber', 'session', 'meetingNo'],
  totalExpenses: ['totalExpenses', 'TotalExpenses', 'expenses'],
  kilometers: ['kilometers', 'Kilometers', 'km'],
  expensesDetails: ['expensesDetails', 'ExpensesDetails', 'expenseDetails'],
  notes: ['notes', 'Notes'],
  team: ['team', 'Team'],
  employmentType: ['employmentType', 'EmploymentType'],
  attachmentsNames: ['attachmentsNames', 'AttachmentsNames'],
  status: ['status', 'Status'],
  approvedBy: ['approvedBy', 'ApprovedBy'],
  approvedDate: ['approvedDate', 'ApprovedDate']
};

const CORRECTION_FIELDS = [
  ['startTime', 'startTime', false],
  ['endTime', 'endTime', false],
  ['workHours', 'workHours', true],
  ['activityType', 'activityType', false],
  ['schoolName', 'school', false],
  ['municipality', 'authority', false],
  ['programName', 'program', false],
  ['sessionNumber', 'meetingNo', false],
  ['totalExpenses', 'expenses', true],
  ['kilometers', 'kilometers', true],
  ['expensesDetails', 'expenseDetails', false],
  ['notes', 'notes', false]
];

function sameValue(left, right, numeric) {
  if (numeric) {
    const a = optionalNumber(left);
    const b = optionalNumber(right);
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return Math.abs(a - b) < 0.005;
  }
  return txt(left) === txt(right);
}

function finalFieldValue(row, key, numeric) {
  if (key === 'workHours') return rowWorkHours(row) ?? optionalNumber(row?.workHours);
  if (numeric) return optionalNumber(row?.[key]);
  return txt(row?.[key]);
}

export function attendanceRecordId(row = {}) {
  const source = row?._source && typeof row._source === 'object' ? row._source : row;
  return txt(source?.ID ?? source?.Id ?? source?.id ?? source?.recordId ?? row?.activityId);
}

export function payrollEmployeeEntries(result, employeeId) {
  const id = txt(employeeId);
  return [...(result?.comparisons || []), ...(result?.notCompared || [])]
    .filter((entry) => entry?.source !== 'dashboard_only' && txt(entry?.attendance?.employeeId) === id);
}

export function payrollEmployeeHasUnresolvedEntries(result, employeeId) {
  if (payrollEmployeeEntries(result, employeeId).some((entry) => !attendanceEntryIsResolved(entry))) return true;
  const id = txt(employeeId);
  return (result?.dailyKilometers || [])
    .filter((day) => txt(day.employeeId) === id)
    .some((day) => kmDayNeedsDecision(day));
}

function originalAttendanceRecord(entry) {
  const attendance = entry?.attendance || {};
  if (attendance._source && typeof attendance._source === 'object') return attendance._source;
  return attendance;
}

function sourceField(source, field) {
  for (const key of (SOURCE_KEYS[field] || [field])) {
    if (source && Object.prototype.hasOwnProperty.call(source, key)) return { present: true, value: source[key] };
  }
  return { present: false, value: undefined };
}

function copyOriginalLogicAppFields(source, fallback = null) {
  const payload = {};
  for (const field of LOGIC_APP_FIELDS) {
    const original = sourceField(source, field);
    if (original.present) { payload[field] = original.value; continue; }
    // Fallback: if the original source lacks the key, use the normalized attendance value
    // so the Logic App always receives a complete contract payload.
    if (fallback) {
      const fb = sourceField(fallback, field);
      if (fb.present) payload[field] = fb.value;
    }
  }
  return payload;
}

export function buildAttendanceUpdatePayload(entry) {
  const attendance = entry?.attendance || {};
  const final = entry?.final || attendance;
  const source = originalAttendanceRecord(entry);
  const fields = copyOriginalLogicAppFields(source, attendance);
  let changed = false;
  for (const [payloadKey, finalKey, numeric] of CORRECTION_FIELDS) {
    const prev = finalFieldValue(attendance, finalKey, numeric);
    const next = finalFieldValue(final, finalKey, numeric);
    if (sameValue(prev, next, numeric)) continue;
    fields[payloadKey] = next;
    changed = true;
  }
  if (changed) {
    const missingFields = LOGIC_APP_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(fields, field));
    if (missingFields.length) throw new Error('חסר נתון מקור הנדרש לעדכון בטוח של רשומת הנוכחות');
  }
  return {
    recordId: attendanceRecordId(attendance),
    fields,
    changed,
    employeeId: txt(final.employeeId || attendance.employeeId)
  };
}

export function collectChangedAttendanceUpdates(entries = []) {
  const updates = [];
  for (const entry of entries) {
    if (entry?.source === 'dashboard_only') continue;
    const update = buildAttendanceUpdatePayload(entry);
    if (!update.changed) continue;
    updates.push({
      recordId: update.recordId,
      fields: update.fields,
      employeeId: update.employeeId
    });
  }
  return updates;
}

/**
 * Validates and collects km write-back updates for payroll approval.
 *
 * APPROVED TODAY: only `approved_as_reported` — no write-back is generated.
 * BLOCKED: `corrected` km — the distribution rule (which record gets which amount) has
 * not been defined by the business.  Attempting to approve with corrected km throws so
 * that the caller cannot silently skip the unresolved business question.
 */
export function collectKmCorrectionUpdates(result, employeeId) {
  const id = txt(employeeId);
  const hasCorrected = (result?.dailyKilometers || [])
    .some((day) => txt(day.employeeId) === id && day.managerResolved === 'corrected');
  if (hasCorrected) {
    throw new Error('תיקון ק״מ יומי דורש החלטת חלוקה — לא ניתן לאשר להעברה לשכר ללא הגדרת כלל חלוקה.');
  }
  // approved_as_reported: attendance km stands; no write-back required.
  return [];
}

export function snapshotAttendanceRow(entry) {
  const attendance = entry?.attendance || {};
  const final = entry?.final || attendance;
  return {
    recordId: attendanceRecordId(attendance),
    employeeId: txt(final.employeeId || attendance.employeeId),
    employeeName: txt(final.employeeName || attendance.employeeName),
    employmentType: txt(final.employmentType || attendance.employmentType),
    date: txt(final.date || attendance.date),
    startTime: txt(final.startTime),
    endTime: txt(final.endTime),
    workHours: rowWorkHours(final) ?? optionalNumber(final.workHours),
    activityType: txt(final.activityType),
    school: txt(final.school),
    authority: txt(final.authority),
    program: txt(final.program),
    meetingNo: txt(final.meetingNo),
    kilometers: optionalNumber(final.kilometers),
    expenses: optionalNumber(final.expenses),
    expenseDetails: txt(final.expenseDetails),
    notes: txt(final.notes)
  };
}

export function buildPayrollApprovedSnapshot({
  employeeId,
  employeeName,
  monthKey,
  entries = [],
  employeeApprovalName = '',
  employeeApprovalAt = '',
  managerApprovalName = '',
  managerApprovalAt = ''
} = {}) {
  const rows = (entries || []).filter((entry) => entry?.source !== 'dashboard_only').map(snapshotAttendanceRow);
  return {
    employeeId: txt(employeeId),
    employeeName: txt(employeeName),
    monthKey: txt(monthKey),
    employeeApprovalName: txt(employeeApprovalName),
    employeeApprovalAt: txt(employeeApprovalAt),
    managerApprovalName: txt(managerApprovalName),
    managerApprovalAt: txt(managerApprovalAt),
    rows
  };
}

export function payrollMonthFileLabel(monthKey) {
  return attendanceMonthLabel(monthKey) || txt(monthKey);
}

export function payrollHebrewMonthName(monthKey) {
  const label = attendanceMonthLabel(monthKey);
  return label ? label.replace(/\s+\d{4}$/, '') : txt(monthKey);
}

export function payrollApprovalPdfFileName(employeeName, monthKey, version = 1) {
  const monthLabel = payrollMonthFileLabel(monthKey);
  const base = `דוח נוכחות - ${txt(employeeName) || 'עובד'} - ${monthLabel} - מאושר`;
  const numericVersion = Number(version);
  return Number.isFinite(numericVersion) && numericVersion > 1 ? `${base} - ${numericVersion}.pdf` : `${base}.pdf`;
}

export function canReadPayrollApprovals(user = {}) {
  const role = txt(user?.role || user?.display_role).toLowerCase();
  if (role === 'admin') return true;
  const flag = (value) => ['yes', 'true', '1'].includes(txt(value).toLowerCase()) || value === true;
  return flag(user?.finance_access) || flag(user?.view_finance);
}

export function canExportPayrollApprovals(user = {}) {
  return canReadPayrollApprovals(user);
}

function normalizeWorkflowStatus(value) {
  const status = txt(value).toLowerCase();
  if (status === 'submitted' || status === 'manager_approved' || status === 'approved') return status;
  return 'not_submitted';
}

export async function writeBackChangedAttendanceRecords(api, updates = []) {
  const failures = [];
  for (const update of updates) {
    if (!txt(update?.recordId)) {
      failures.push({ recordId: '', message: 'חסר מזהה רשומה במערכת הנוכחות.' });
      continue;
    }
    try {
      const response = await api.attendanceControlUpdateRecord(update.recordId, update.fields);
      if (response && response.success === false) {
        failures.push({
          recordId: update.recordId,
          message: txt(response.message || response.error) || 'עדכון רשומת נוכחות נכשל.'
        });
      }
    } catch (error) {
      failures.push({
        recordId: update.recordId,
        message: error?.message || 'עדכון רשומת נוכחות נכשל.'
      });
    }
  }
  return failures;
}

export async function approvePayrollControlEmployee({
  api,
  user,
  result,
  employeeId,
  employeeName,
  confirmed = false,
  monthWorkflow = {}
} = {}) {
  if (!confirmed) throw new Error('נדרשת חתימה מפורשת על הצהרת האישור.');
  const monthKey = txt(result?.month);
  if (!monthKey) throw new Error('חסר חודש לאישור.');
  if (normalizeWorkflowStatus(monthWorkflow?.workflowStatus) !== 'submitted') {
    throw new Error('לא ניתן לאשר מנהל לפני שהעובד השלים ואישר את החודש.');
  }
  const entries = payrollEmployeeEntries(result, employeeId);
  if (!entries.length) throw new Error('לא נמצאו רשומות נוכחות לעובד זה.');
  if (payrollEmployeeHasUnresolvedEntries(result, employeeId)) {
    throw new Error('לא ניתן לסיים את הבקרה: יש רשומות נוכחות שלא קיבלו החלטת מנהל.');
  }
  const updates = [
    ...collectChangedAttendanceUpdates(entries),
    ...collectKmCorrectionUpdates(result, employeeId)
  ];
  const failures = await writeBackChangedAttendanceRecords(api, updates);
  if (failures.length) {
    const detail = failures
      .map((item) => item.recordId ? `רשומה ${item.recordId}: ${item.message}` : item.message)
      .join(' ');
    const error = new Error(`עדכון מערכת הנוכחות נכשל. האישור לא נשמר. ${detail}`);
    error.code = 'attendance_update_failed';
    error.failures = failures;
    throw error;
  }
  const managerApprovalName = txt(user?.full_name || user?.name || user?.username || '');
  const managerApprovalAt = new Date().toISOString();
  const snapshot = buildPayrollApprovedSnapshot({
    employeeId,
    employeeName: employeeName || entries[0]?.final?.employeeName || entries[0]?.attendance?.employeeName,
    monthKey,
    entries,
    employeeApprovalName: txt(monthWorkflow?.submittedByName),
    employeeApprovalAt: txt(monthWorkflow?.submittedAt),
    managerApprovalName,
    managerApprovalAt
  });
  const artifacts = await api.attendanceManagerApprovalArtifacts({
    employee_id: txt(employeeId),
    employee_name: snapshot.employeeName,
    month_key: monthKey,
    manager_approval_name: managerApprovalName,
    manager_approval_at: managerApprovalAt,
    employee_approval_name: txt(monthWorkflow?.submittedByName),
    employee_approval_at: txt(monthWorkflow?.submittedAt),
    approved_snapshot: snapshot
  });
  if (!txt(artifacts?.sharepointWebUrl) || !txt(artifacts?.fileName)) {
    throw new Error('שמירת ה-PDF ב-SharePoint נכשלה. אישור המנהל לא נשמר.');
  }
  const saved = await api.managerFinalizeAttendanceMonthReview({
    employee_id: txt(employeeId),
    month_key: monthKey,
    manager_name: managerApprovalName,
    manager_pdf_sharepoint_url: txt(artifacts?.sharepointWebUrl),
    manager_pdf_sharepoint_item_id: txt(artifacts?.sharepointItemId) || null,
    manager_pdf_file_name: txt(artifacts?.fileName),
    manager_pdf_version: Number(artifacts?.managerPdfVersion || 0),
    manager_approved_snapshot: snapshot
  });
  return {
    ...saved,
    employee_id: txt(employeeId),
    month_key: monthKey,
    status: 'manager_approved',
    manager_approved_by_name: saved?.manager_approved_by_name || managerApprovalName,
    manager_approved_at: saved?.manager_approved_at || managerApprovalAt,
    manager_pdf_sharepoint_url: saved?.manager_pdf_sharepoint_url || txt(artifacts?.sharepointWebUrl),
    manager_pdf_file_name: saved?.manager_pdf_file_name || txt(artifacts?.fileName),
    manager_pdf_version: saved?.manager_pdf_version || Number(artifacts?.managerPdfVersion || 0),
    mailed_at: txt(artifacts?.mailedAt || '')
  };
}

export function buildPayrollApprovalsWorkbook(approvals = []) {
  const entries = (approvals || [])
    .filter((row) => txt(row?.status) === PAYROLL_APPROVAL_STATUS)
    .flatMap((approval) => {
      const rows = Array.isArray(approval?.approved_snapshot?.rows) ? approval.approved_snapshot.rows : [];
      return rows.map((row) => ({
        attendance: { _source: row },
        final: { ...row }
      }));
    });
  return buildCorrectedAttendanceWorkbook(entries, []);
}

export function downloadPayrollApprovalsExcel(approvals = [], user = {}) {
  if (!canExportPayrollApprovals(user)) throw new Error('אין הרשאה לייצוא Excel לשכר.');
  const approved = (approvals || []).filter((row) => txt(row?.status) === PAYROLL_APPROVAL_STATUS);
  if (!approved.length) throw new Error('אין אישורים להעברה לשכר לייצוא.');
  XLSX.writeFile(buildPayrollApprovalsWorkbook(approved), `שכר_מאושר.xlsx`, { compression: true });
}

function formatApprovalWhen(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return txt(value) || '—';
  return date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
}

export function payrollApprovalStatusHtml(approval) {
  if (!approval) return '';
  const id = escapeHtml(txt(approval.id));
  return `<div class="attendance-control__approved" data-payroll-approved="${id}">
    <span>מאושר להעברה לשכר</span>
    <span>${escapeHtml(txt(approval.approved_by_name) || '—')}</span>
    <span>${escapeHtml(formatApprovalWhen(approval.approved_at))}</span>
    <button type="button" class="ds-btn ds-btn--sm" data-payroll-view-pdf="${id}">צפייה בדוח</button>
  </div>`;
}

export function payrollControlApprovalsListHtml(approvals = [], { user } = {}) {
  const rows = Array.isArray(approvals) ? approvals : [];
  const canExport = canExportPayrollApprovals(user);
  const body = rows.length
    ? `<table class="payroll-approvals__table"><thead><tr>
        <th>עובד</th><th>חודש</th><th>סטטוס</th><th>מאשר</th><th>תאריך אישור</th><th></th>
      </tr></thead><tbody>${rows.map((row) => `<tr>
        <td>${escapeHtml(txt(row.employee_name) || txt(row.employee_id))}</td>
        <td>${escapeHtml(attendanceMonthLabel(row.month_key) || payrollMonthFileLabel(row.month_key))}</td>
        <td>מאושר להעברה לשכר</td>
        <td>${escapeHtml(txt(row.approved_by_name) || '—')}</td>
        <td>${escapeHtml(formatApprovalWhen(row.approved_at))}</td>
        <td><button type="button" class="ds-btn ds-btn--sm" data-payroll-view-pdf="${escapeHtml(txt(row.id))}">צפייה בדוח</button></td>
      </tr>`).join('')}</tbody></table>`
    : '<p class="payroll-approvals__empty">אין עדיין אישורים להעברה לשכר.</p>';
  const exportButton = canExport
    ? '<button type="button" class="ds-btn ds-btn--primary" data-payroll-approvals-export>ייצוא Excel לשכר</button>'
    : '';
  return `<section class="payroll-approvals" dir="rtl" data-payroll-approvals>
    <style>
      .payroll-approvals__head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px}
      .payroll-approvals__table{width:100%;border-collapse:collapse}
      .payroll-approvals__table th,.payroll-approvals__table td{padding:8px;border-bottom:1px solid #e2e8f0;text-align:right}
      .payroll-approvals__empty{margin:0;color:#64748b}
    </style>
    <div class="payroll-approvals__head"><strong>אישורי בקרת נוכחות</strong>${exportButton}</div>
    ${body}
  </section>`;
}

function snapshotSummary(rows = []) {
  const byType = new Map();
  let hours = 0;
  let km = 0;
  let expenses = 0;
  for (const row of rows) {
    const type = activityTypeDisplayLabel(row.activityType) || txt(row.activityType) || 'אחר';
    const value = optionalNumber(row.workHours) || 0;
    byType.set(type, Math.round(((byType.get(type) || 0) + value) * 100) / 100);
    hours += value;
    km += optionalNumber(row.kilometers) || 0;
    expenses += optionalNumber(row.expenses) || 0;
  }
  return {
    byType: [...byType.entries()],
    hours: Math.round(hours * 100) / 100,
    km: Math.round(km * 100) / 100,
    expenses: Math.round(expenses * 100) / 100
  };
}

export function buildPayrollApprovalPrintHtml(approval = {}) {
  const snapshot = approval.approved_snapshot || {};
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
  const summary = snapshotSummary(rows);
  const monthLabel = attendanceMonthLabel(approval.month_key || snapshot.monthKey) || payrollMonthFileLabel(approval.month_key || snapshot.monthKey);
  const employeeName = txt(approval.employee_name || snapshot.employeeName);
  const employeeId = txt(approval.employee_id || snapshot.employeeId);
  const employeeApprovedBy = txt(snapshot.employeeApprovalName || approval.submitted_by_name);
  const employeeApprovedAt = formatApprovalWhen(snapshot.employeeApprovalAt || approval.submitted_at);
  const managerApprovedBy = txt(snapshot.managerApprovalName || approval.manager_approved_by_name || approval.approved_by_name);
  const managerApprovedAt = formatApprovalWhen(snapshot.managerApprovalAt || approval.manager_approved_at || approval.approved_at);
  const table = rows.map((row) => `<tr>
    <td>${escapeHtml(row.date || '')}</td>
    <td>${escapeHtml(activityTypeDisplayLabel(row.activityType) || row.activityType || '')}</td>
    <td>${escapeHtml(row.authority || '')}</td>
    <td>${escapeHtml(row.school || '')}</td>
    <td>${escapeHtml(row.program || '')}</td>
    <td>${escapeHtml(row.meetingNo || '')}</td>
    <td>${escapeHtml(`${row.startTime || '—'}–${row.endTime || '—'}`)}</td>
    <td>${escapeHtml(row.workHours == null ? '—' : String(row.workHours))}</td>
    <td>${escapeHtml(row.kilometers == null ? '—' : String(row.kilometers))}</td>
    <td>${escapeHtml(row.expenses == null ? '—' : String(row.expenses))}</td>
    <td>${escapeHtml(row.expenseDetails || '')}</td>
    <td>${escapeHtml(row.notes || '')}</td>
  </tr>`).join('');
  const typeRows = summary.byType.map(([type, hours]) => `<li>${escapeHtml(type)}: ${hours}</li>`).join('');
  const expenseLine = summary.expenses
    ? `<p>סה״כ הוצאות: ${escapeHtml(String(summary.expenses))}</p>`
    : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(payrollApprovalPdfFileName(employeeName, approval.month_key || snapshot.monthKey))}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px;color:#1f2a37}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #d7e0ea;padding:8px;text-align:right}h1{margin:0 0 8px}.sign{margin-top:32px;border-top:1px solid #cbd5e1;padding-top:16px}</style>
    </head><body>
    <h1>דוח נוכחות חודשי מאושר</h1>
    <p>שם עובד: ${escapeHtml(employeeName || '—')}</p>
    <p>מספר עובד: ${escapeHtml(employeeId || '—')}</p>
    <p>חודש: ${escapeHtml(monthLabel || '—')}</p>
    <table><thead><tr><th>תאריך</th><th>סוג פעילות</th><th>רשות</th><th>בית ספר</th><th>תכנית</th><th>מפגש</th><th>שעות התחלה/סיום</th><th>סה״כ שעות</th><th>ק״מ</th><th>הוצאות</th><th>פירוט הוצאה</th><th>הערות</th></tr></thead>
    <tbody>${table || '<tr><td colspan="12">אין רשומות מאושרות</td></tr>'}</tbody></table>
    <p>סיכום לפי סוג פעילות</p>
    <ul>${typeRows || '<li>אין נתונים</li>'}</ul>
    <p>סה״כ שעות: ${escapeHtml(String(summary.hours))}</p>
    <p>סה״כ ק״מ: ${escapeHtml(String(summary.km))}</p>
    ${expenseLine}
    <div class="sign">
      <p>אישור עובד: ${escapeHtml(employeeApprovedBy || '—')} · ${escapeHtml(employeeApprovedAt)}</p>
      <p>אישור מנהל: ${escapeHtml(managerApprovedBy || '—')} · ${escapeHtml(managerApprovedAt)}</p>
    </div>
    </body></html>`;
}

export function openPayrollApprovalDocument(approval, signedUrl = '') {
  if (signedUrl) {
    window.open(signedUrl, '_blank', 'noopener');
    return;
  }
  const popup = window.open('', 'payroll-control-approval-doc');
  if (!popup) throw new Error('הדפדפן חסם את פתיחת המסמך.');
  popup.document.open();
  popup.document.write(buildPayrollApprovalPrintHtml(approval));
  popup.document.close();
  popup.focus();
}
