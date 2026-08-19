import * as XLSX from 'xlsx';
import { attendanceMonthLabel, normalizeAttendanceName } from './attendance-control.js';

export const PAYROLL_FINAL_APPROVAL_STATUS = 'approved_for_payroll';

export const FINANCE_HOUR_CATEGORIES = [
  { key: 'course', label: 'קורס' },
  { key: 'training', label: 'הכשרה' },
  { key: 'workshop', label: 'סדנה' },
  { key: 'tour', label: 'סיור' },
  { key: 'operations', label: 'תפעול' },
  { key: 'time_cancel', label: 'ביטול זמן' }
];

export const FINANCE_ATTENDANCE_COLUMNS = [
  'צוות',
  'שם העובד',
  'סוג העסקה',
  'ימי עבודה',
  ...FINANCE_HOUR_CATEGORIES.map((item) => item.label),
  'סה״כ ק״מ',
  'קובץ',
  'הערות'
];

export const FINANCE_ATTENDANCE_GENERAL_SHEET = 'נוכחות';
export const FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS = ['תעשיידע', 'מעוף', 'MANPOWER', 'עצמאי'];
export const FINANCE_MAOF_SHEET = 'מעוף';
export const FINANCE_MAOF_DAILY_COLUMNS = [
  'תאריך',
  'שם מדריך',
  'מספר עובד',
  'רשות',
  'סוג פעילות',
  'שעות פעילות',
  'סה״כ שעות',
  'סה״כ ק״מ ליום'
];

const txt = (value) => String(value ?? '').trim();

function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundHours(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function emptyHours() {
  return Object.fromEntries(FINANCE_HOUR_CATEGORIES.map((item) => [item.key, 0]));
}

function employeeIdOf(value) {
  return txt(value?.employeeId || value?.employee_id || value?.emp_id || value?.empNum);
}

function lookupText(value) {
  if (value && typeof value === 'object') return txt(value.Value || value.value || value.Label || value.label);
  return txt(value);
}

export function financeHourCategory(value) {
  const raw = txt(value);
  if (!raw) return '';
  const normalized = normalizeAttendanceName(raw);
  if (normalized.includes('ביטולזמן')) return 'time_cancel';
  if (normalized.includes('הכשרה')) return 'training';
  if (normalized.includes('חדרבריחה') || normalized.includes('escaperoom')) return '';
  if (normalized.includes('סדנאותקיץ')) return '';
  if (normalized.includes('אפטרסקול') || normalized.includes('afterschool')) return '';
  if (normalized.includes('סדנה') || normalized === 'workshop' || normalized === 'workshops') return 'workshop';
  if (normalized.includes('סיור') || normalized === 'tour' || normalized === 'tours') return 'tour';
  if (normalized.includes('קורס') || normalized === 'course' || normalized === 'courses') return 'course';
  if (normalized.includes('תפעול')) return 'operations';
  return '';
}

export function isFinalPayrollApproval(approval = {}) {
  return txt(approval?.status).toLowerCase() === PAYROLL_FINAL_APPROVAL_STATUS;
}

function snapshotRows(approval = {}) {
  const snapshot = approval?.approved_snapshot && typeof approval.approved_snapshot === 'object'
    ? approval.approved_snapshot
    : {};
  if (Array.isArray(snapshot.rows)) return snapshot.rows;
  if (Array.isArray(approval?.rows)) return approval.rows;
  return [];
}

function approvalFileUrl(approval = {}) {
  const path = txt(approval.pdf_path || approval.manager_pdf_sharepoint_url);
  if (/^https?:\/\//i.test(path)) return path;
  return '';
}

function approvalHasFile(approval = {}) {
  return Boolean(approvalFileUrl(approval) || txt(approval.pdf_path) || txt(approval.pdf_file_name));
}

export function buildEmployeeTeamMap(employees = []) {
  const map = new Map();
  for (const employee of employees || []) {
    const id = employeeIdOf(employee) || txt(employee?.id);
    const team = lookupText(employee?.team || employee?.Team);
    if (id && team && !map.has(id)) map.set(id, team);
  }
  return map;
}

function rowTeam(row = {}, approval = {}, teamByEmployee = new Map()) {
  const fromRow = lookupText(row.team || row.Team);
  if (fromRow) return fromRow;
  const fromApproval = lookupText(approval.team || approval.Team);
  if (fromApproval) return fromApproval;
  const employeeId = employeeIdOf(row) || employeeIdOf(approval);
  return txt(teamByEmployee.get(employeeId));
}

function rowDate(row = {}) {
  return txt(row.date || row.attendanceDate || row.AttendanceDate).slice(0, 10);
}

function rowAuthority(row = {}) {
  return lookupText(row.authority || row.municipality || row.Municipality);
}

function rowActivityType(row = {}) {
  return txt(row.activityType || row.ActivityType);
}

function parseTimeMinutes(value) {
  const match = txt(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTimeMinutes(total) {
  const minutes = Math.max(0, Math.round(Number(total) || 0));
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function mergeFinanceReportedTimeRanges(ranges = []) {
  const parsed = (ranges || [])
    .map((range) => ({
      start: parseTimeMinutes(range?.start || range?.startTime),
      end: parseTimeMinutes(range?.end || range?.endTime)
    }))
    .filter((range) => range.start != null && range.end != null && range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of parsed) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged.map((range) => ({
    start: formatTimeMinutes(range.start),
    end: formatTimeMinutes(range.end),
    hours: roundHours((range.end - range.start) / 60)
  }));
}

export function formatFinanceReportedHourRanges(ranges = []) {
  return mergeFinanceReportedTimeRanges(ranges)
    .map((range) => `${range.start}–${range.end}`)
    .join(', ');
}

function formatMaofDate(value) {
  const iso = txt(value).slice(0, 10);
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : iso;
}

function approvalEmploymentType(approval = {}, rows = []) {
  return txt(approval?.approved_snapshot?.employmentType || rows[0]?.employmentType);
}

export function buildMaofDailyExcelRows(approvals = []) {
  const groups = new Map();
  const dailyKm = new Map();
  for (const approval of approvals || []) {
    if (!isFinalPayrollApproval(approval)) continue;
    const rows = snapshotRows(approval);
    if (financeEmploymentSheetName(approvalEmploymentType(approval, rows)) !== FINANCE_MAOF_SHEET) continue;
    const employeeId = employeeIdOf(approval) || employeeIdOf(approval?.approved_snapshot) || employeeIdOf(rows[0]);
    if (!employeeId) continue;
    const employeeName = txt(approval.employee_name || approval.approved_snapshot?.employeeName || rows[0]?.employeeName) || employeeId;
    for (const row of rows) {
      const date = rowDate(row);
      if (!date) continue;
      const activityType = rowActivityType(row);
      const authority = rowAuthority(row);
      const groupKey = `${employeeId}|${date}|${authority}|${activityType}`;
      let group = groups.get(groupKey);
      if (!group) {
        group = {
          employeeId,
          employeeName,
          date,
          authority,
          activityType,
          ranges: [],
          extraHours: 0
        };
        groups.set(groupKey, group);
      }
      const startTime = txt(row.startTime || row.StartTime || row.start);
      const endTime = txt(row.endTime || row.EndTime || row.end);
      if (parseTimeMinutes(startTime) != null && parseTimeMinutes(endTime) != null) {
        group.ranges.push({ start: startTime, end: endTime });
      } else {
        group.extraHours = roundHours(group.extraHours + num(row.workHours ?? row.WorkHours));
      }
      const dayKey = `${employeeId}|${date}`;
      dailyKm.set(dayKey, roundHours((dailyKm.get(dayKey) || 0) + num(row.kilometers ?? row.Kilometers ?? row.km)));
    }
  }

  const entries = [...groups.values()].map((group) => {
    const merged = mergeFinanceReportedTimeRanges(group.ranges);
    const rangeHours = merged.reduce((sum, range) => sum + range.hours, 0);
    return {
      date: group.date,
      displayDate: formatMaofDate(group.date),
      employeeName: group.employeeName,
      employeeId: group.employeeId,
      authority: group.authority,
      activityType: group.activityType,
      hourRanges: formatFinanceReportedHourRanges(group.ranges),
      totalHours: roundHours(rangeHours + group.extraHours),
      firstStart: merged[0]?.start || '',
      dayKey: `${group.employeeId}|${group.date}`
    };
  }).sort((a, b) => (
    a.date.localeCompare(b.date)
    || a.employeeName.localeCompare(b.employeeName, 'he')
    || a.employeeId.localeCompare(b.employeeId, 'he')
    || a.firstStart.localeCompare(b.firstStart)
    || a.authority.localeCompare(b.authority, 'he')
    || a.activityType.localeCompare(b.activityType, 'he')
  ));

  const seenDay = new Set();
  return entries.map((entry) => {
    const showKm = !seenDay.has(entry.dayKey);
    if (showKm) seenDay.add(entry.dayKey);
    return {
      'תאריך': entry.displayDate,
      'שם מדריך': entry.employeeName,
      'מספר עובד': entry.employeeId,
      'רשות': entry.authority,
      'סוג פעילות': entry.activityType,
      'שעות פעילות': entry.hourRanges,
      'סה״כ שעות': entry.totalHours,
      'סה״כ ק״מ ליום': showKm ? (dailyKm.get(entry.dayKey) || 0) : ''
    };
  });
}

export function unmappedFinanceActivityTypes(approvals = []) {
  const found = new Set();
  for (const approval of approvals || []) {
    if (!isFinalPayrollApproval(approval)) continue;
    for (const row of snapshotRows(approval)) {
      const type = txt(row.activityType || row.ActivityType);
      if (type && !financeHourCategory(type)) found.add(type);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'he'));
}

export function summarizeFinanceAttendance(approvals = [], { employees = [], employeeSearch = '' } = {}) {
  const teamByEmployee = buildEmployeeTeamMap(employees);
  const byEmployee = new Map();
  for (const approval of approvals || []) {
    if (!isFinalPayrollApproval(approval)) continue;
    const rows = snapshotRows(approval);
    const employeeId = employeeIdOf(approval) || employeeIdOf(approval?.approved_snapshot) || employeeIdOf(rows[0]);
    if (!employeeId) continue;
    let entry = byEmployee.get(employeeId);
    if (!entry) {
      entry = {
        employeeId,
        employeeName: txt(approval.employee_name || approval.approved_snapshot?.employeeName || rows[0]?.employeeName),
        employmentType: txt(approval.approved_snapshot?.employmentType || rows[0]?.employmentType),
        team: '',
        workDates: new Set(),
        hours: emptyHours(),
        kilometers: 0,
        notes: [],
        fileUrl: '',
        fileName: '',
        hasFile: false,
        unmappedTypes: []
      };
      byEmployee.set(employeeId, entry);
    }
    if (!entry.employeeName) entry.employeeName = txt(approval.employee_name || approval.approved_snapshot?.employeeName);
    if (!entry.employmentType) entry.employmentType = txt(approval.approved_snapshot?.employmentType || rows[0]?.employmentType);
    if (approvalHasFile(approval) && !entry.hasFile) {
      entry.hasFile = true;
      entry.fileUrl = approvalFileUrl(approval);
      entry.fileName = txt(approval.pdf_file_name) || 'קובץ';
    }
    for (const row of rows) {
      const date = rowDate(row);
      if (date) entry.workDates.add(date);
      const category = financeHourCategory(row.activityType || row.ActivityType);
      const hours = num(row.workHours ?? row.WorkHours);
      if (category) entry.hours[category] = roundHours(entry.hours[category] + hours);
      else if (txt(row.activityType || row.ActivityType)) entry.unmappedTypes.push(txt(row.activityType || row.ActivityType));
      entry.kilometers = roundHours(entry.kilometers + num(row.kilometers ?? row.Kilometers ?? row.km));
      const note = txt(row.notes || row.Notes);
      if (note && !entry.notes.includes(note)) entry.notes.push(note);
      if (!entry.employmentType) entry.employmentType = txt(row.employmentType);
      if (!entry.team) entry.team = rowTeam(row, approval, teamByEmployee);
    }
    if (!entry.team) entry.team = rowTeam({}, approval, teamByEmployee);
  }

  const search = normalizeAttendanceName(employeeSearch);
  const summaries = [...byEmployee.values()]
    .map((entry) => ({
      employeeId: entry.employeeId,
      employeeName: entry.employeeName || entry.employeeId,
      employmentType: entry.employmentType,
      team: entry.team,
      workDays: entry.workDates.size,
      hours: entry.hours,
      kilometers: roundHours(entry.kilometers),
      notes: entry.notes.join(' · '),
      fileUrl: entry.fileUrl,
      fileName: entry.fileName,
      hasFile: entry.hasFile,
      unmappedTypes: [...new Set(entry.unmappedTypes)]
    }))
    .filter((entry) => !search || normalizeAttendanceName(entry.employeeName).includes(search) || normalizeAttendanceName(entry.employeeId).includes(search))
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'he') || a.employeeId.localeCompare(b.employeeId, 'he'));

  return {
    rows: summaries,
    unmappedActivityTypes: unmappedFinanceActivityTypes(approvals)
  };
}

export function financeAttendanceDisplayRow(entry = {}) {
  const hours = entry.hours || emptyHours();
  return {
    'צוות': entry.team || '',
    'שם העובד': entry.employeeName || '',
    'סוג העסקה': entry.employmentType || '',
    'ימי עבודה': entry.workDays || 0,
    קורס: hours.course || 0,
    הכשרה: hours.training || 0,
    סדנה: hours.workshop || 0,
    סיור: hours.tour || 0,
    תפעול: hours.operations || 0,
    'ביטול זמן': hours.time_cancel || 0,
    'סה״כ ק״מ': entry.kilometers || 0,
    קובץ: entry.hasFile ? (entry.fileUrl || entry.fileName || 'קובץ') : '',
    הערות: entry.notes || ''
  };
}

export function buildFinanceAttendanceExcelRows(entries = []) {
  return (entries || []).map(financeAttendanceDisplayRow);
}

export function normalizeFinanceEmploymentType(value) {
  return String(value ?? '').trim().replace(/\s+/g, '').toLowerCase();
}

export function financeEmploymentSheetName(employmentType) {
  const key = normalizeFinanceEmploymentType(employmentType);
  return FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS.find((label) => normalizeFinanceEmploymentType(label) === key) || '';
}

function appendFinanceAttendanceSheet(workbook, sheetName, entries = []) {
  const rows = buildFinanceAttendanceExcelRows(entries);
  const sheetRows = [
    FINANCE_ATTENDANCE_COLUMNS,
    ...rows.map((row) => FINANCE_ATTENDANCE_COLUMNS.map((header) => row[header] ?? ''))
  ];
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const fileCol = FINANCE_ATTENDANCE_COLUMNS.indexOf('קובץ');
  (entries || []).forEach((entry, index) => {
    if (!entry?.hasFile || !entry.fileUrl || fileCol < 0) return;
    const cellRef = XLSX.utils.encode_cell({ r: index + 1, c: fileCol });
    const cell = sheet[cellRef] || { t: 's', v: 'קובץ' };
    cell.l = { Target: entry.fileUrl };
    cell.v = 'קובץ';
    sheet[cellRef] = cell;
  });
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
}

function appendMaofDailySheet(workbook, approvals = []) {
  const rows = buildMaofDailyExcelRows(approvals);
  const sheetRows = [
    FINANCE_MAOF_DAILY_COLUMNS,
    ...rows.map((row) => FINANCE_MAOF_DAILY_COLUMNS.map((header) => row[header] ?? ''))
  ];
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheetRows), FINANCE_MAOF_SHEET);
}

export function buildFinanceAttendanceWorkbook(entries = [], { approvals = [] } = {}) {
  const workbook = XLSX.utils.book_new();
  appendFinanceAttendanceSheet(workbook, FINANCE_ATTENDANCE_GENERAL_SHEET, entries);
  for (const sheetName of FINANCE_ATTENDANCE_EMPLOYMENT_SHEETS) {
    if (sheetName === FINANCE_MAOF_SHEET) {
      appendMaofDailySheet(workbook, approvals);
      continue;
    }
    const typed = (entries || []).filter((entry) => financeEmploymentSheetName(entry?.employmentType) === sheetName);
    appendFinanceAttendanceSheet(workbook, sheetName, typed);
  }
  return workbook;
}

export function financeAttendanceExportFilename(monthKey) {
  const label = attendanceMonthLabel(monthKey) || txt(monthKey) || 'חודש';
  return `דיווח_נוכחות_${label.replace(/\s+/g, '_')}.xlsx`;
}

export function downloadFinanceAttendanceExcel(entries = [], monthKey = '', options = {}) {
  XLSX.writeFile(buildFinanceAttendanceWorkbook(entries, options), financeAttendanceExportFilename(monthKey), { compression: true });
}

export function currentFinanceMonthKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}
