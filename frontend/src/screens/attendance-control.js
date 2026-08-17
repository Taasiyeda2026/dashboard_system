import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { activityTypeDisplayLabel, normalizeActivityTypeKey } from './shared/activity-options.js';

export const DETAIL_HEADERS = ['מספר עובד', 'שם עובד', 'תאריך', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית', 'מספר מפגש', 'קילומטרים', 'הוצאות', 'פירוט הוצאות', 'הערות'];
export const MONTHLY_HEADERS = ['שם מדריך', 'מספר עובד', 'שעות ביטול זמן', 'שעות הכשרה', 'שעות חדר בריחה', 'שעות סדנה', 'שעות סדנאות קיץ', 'שעות סיור', 'שעות קורס', 'שעות תפעול', 'סה"כ קילומטרים', 'הוצאות', 'פירוט הוצאות'];
export const DAILY_HEADERS = ['תאריך', 'שם מדריך', 'מספר עובד', 'סוג פעילות', 'רשות', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'קילומטרים', 'הוצאות', 'פירוט הוצאות'];

const FIELD_DEFS = [
  ['startTime', 'שעת התחלה', 'time'], ['endTime', 'שעת סיום', 'time'],
  ['workHours', 'שעות עבודה', 'number'],
  ['school', 'בית ספר', 'text'], ['authority', 'רשות', 'text'],
  ['program', 'שם תכנית', 'text'], ['activityType', 'סוג פעילות', 'activityType'], ['meetingNo', 'מספר מפגש', 'text'],
  ['kilometers', 'קילומטרים', 'number'], ['expenses', 'הוצאות', 'money']
];
const HEADER_ALIASES = {
  employeeId: ['מספר עובד', 'מס עובד', 'מספרעובד', 'employee id', 'emp id', 'emp_id'],
  employeeName: ['שם עובד', 'שם מדריך', 'עובד', 'מדריך', 'full name'],
  employmentType: ['סוג העסקה', 'employment type', 'employment_type'], date: ['תאריך', 'date', 'תאריך פעילות'],
  startTime: ['שעת התחלה', 'כניסה', 'שעת כניסה', 'התחלה', 'start time'], endTime: ['שעת סיום', 'יציאה', 'שעת יציאה', 'סיום', 'end time'],
  workHours: ['שעות עבודה', 'סהכ שעות', 'סה"כ שעות', 'שעות'], activityType: ['סוג פעילות', 'פעילות', 'activity type'],
  school: ['שם בית ספר', 'בית ספר', 'מסגרת'], authority: ['רשות', 'עיר', 'מועצה'], program: ['שם תכנית', 'שם תוכנית', 'תכנית', 'תוכנית'],
  meetingNo: ['מספר מפגש', 'מס מפגש', 'מפגש'], kilometers: ['קילומטרים', 'ק"מ', 'קמ', 'נסיעות'], expenses: ['הוצאות', 'סכום הוצאות'],
  expenseDetails: ['פירוט הוצאות', 'תיאור הוצאות'], notes: ['הערות', 'הערה'], activityId: ['מזהה פעילות', 'מזהה פעילות פנימי', 'rowid']
};

const txt = (value) => String(value ?? '').trim();
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const number = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNumber = (value) => txt(value) === '' || value == null ? null : number(value);
const ATTENDANCE_ONLY_ACTIVITY_TYPES = new Set(['ביטולזמן', 'הכשרה', 'תפעול']);

export function isAttendanceOnlyActivityType(value) {
  return ATTENDANCE_ONLY_ACTIVITY_TYPES.has(normalizeAttendanceName(value));
}

export function normalizeAttendanceName(value) {
  return txt(value).normalize('NFKD').toLowerCase()
    .replace(/[׳״'"`´’‘“”.,;:()\[\]{}\-_/\\\u05BE\u2010-\u2015]/g, '')
    .replace(/\s+/g, '')
    .replace(/מאיר$/u, '');
}

function headerKey(value) {
  return normalizeAttendanceName(value).replace(/_/g, '');
}

function resolveColumns(header = []) {
  const normalized = header.map(headerKey);
  return Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => {
    const index = normalized.findIndex((item) => aliases.some((alias) => item === headerKey(alias)));
    return [key, index];
  }));
}

function excelDate(value) {
  // readFile uses raw mode (no cellDates) so date cells arrive as Excel serial integers.
  // Keeping raw serials avoids the UTC-midnight timezone shift that drops the 1st of every month.
  if (typeof value === 'number' && value >= 1) {
    // Try SheetJS SSF parser first (most accurate).
    const parsed = (XLSX.SSF || XLSX.default?.SSF)?.parse_date_code(value);
    if (parsed && parsed.y > 1900) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    // Direct fallback: Excel serial 25569 = 1970-01-01 UTC.
    // Serials ≥61 are corrected for the Lotus 1900 leap-year bug (fake Feb 29 = serial 60).
    // Formula: Unix epoch day = serial - 25569 (≥61) or serial - 25568 (≤59).
    try {
      const correction = value >= 61 ? 25569 : 25568;
      const d = new Date((value - correction) * 86400000);
      if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() > 1900 && d.getUTCFullYear() < 2200) {
        return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
      }
    } catch { /* ignore */ }
  }
  // Fallback for Date objects (edge-case) — use local components to avoid UTC shift.
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  const raw = txt(value).replace(/^[^\d]+/, '').slice(0, 10);
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (!match) return '';
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function timeText(value) {
  if (value instanceof Date) return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  if (typeof value === 'number' && value >= 0 && value < 1) {
    const minutes = Math.round(value * 1440) % 1440;
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const match = txt(value).match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '';
}

export function calculateWorkHours(start, end) {
  const parse = (value) => { const m = timeText(value).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const from = parse(start); let to = parse(end);
  if (from === null || to === null) return 0;
  if (to < from) to += 1440;
  return Math.round(((to - from) / 60) * 100) / 100;
}

function activityValue(row, names, fallback = '') {
  for (const name of names) if (row?.[name] !== undefined && row?.[name] !== null && txt(row[name]) !== '') return row[name];
  return fallback;
}

// Instructors need setup time before an activity starts and wrap-up time after it ends.
// Attendance that falls within these windows is not flagged as a time deviation.
//   Start: up to 15 minutes early arrival is legitimate (setup / travel to room).
//   End:   up to 10 minutes late departure is legitimate (wrap-up / student questions).
const ATTENDANCE_GRACE_START_MINUTES = 15;
const ATTENDANCE_GRACE_END_MINUTES   = 10;

// School-clock time is not payroll time. Only the two unambiguous business cases
// may be converted automatically; unusual timetables stay visible for review.
function dashboardPayrollHours(startTime, endTime) {
  const minutes = calculateWorkHours(startTime, endTime) * 60;
  if (Math.abs(minutes - 45) < 0.01) return 1;
  if (Math.abs(minutes - 90) < 0.01) return 2;
  return null;
}

export function buildDashboardAttendanceRows(activities = [], contacts = []) {
  const contactById = new Map((contacts || []).map((row) => [txt(row.emp_id || row.employee_id), row]));
  const output = [];
  for (const activity of activities || []) {
    const instructors = [
      { employeeId: txt(activity.emp_id), employeeName: txt(activity.instructor_name || activity.name) },
      { employeeId: txt(activity.emp_id_2), employeeName: txt(activity.instructor_name_2) }
    ].filter((item, index, all) => item.employeeId && all.findIndex((candidate) => candidate.employeeId === item.employeeId) === index);
    if (!instructors.length) continue;
    const meetings = activityMeetings(activity);
    const fallbackDate = activityValue(activity, ['activity_date', 'start_date', 'date']);
    const dates = meetings.length ? meetings : (fallbackDate ? [{ date: fallbackDate }] : []);
    dates.forEach((meeting, index) => instructors.forEach((instructor) => {
      const date = excelDate(meeting.date);
      const startTime = timeText(meeting.start_time || activity.start_time);
      const endTime = timeText(meeting.end_time || activity.end_time);
      if (!date) return;
      const contact = contactById.get(instructor.employeeId) || {};
      // Resolve activityType before building the row so we can apply payroll compensation.
      const activityType = txt(activityValue(activity, ['activity_type_label', 'activity_type', 'item_type']));
      output.push({
        ...instructor, employeeName: instructor.employeeName || txt(contact.full_name), employmentType: txt(contact.employment_type),
        date, startTime, endTime,
        workHours: dashboardPayrollHours(startTime, endTime),
        payrollHoursRequireReview: dashboardPayrollHours(startTime, endTime) == null,
        meetingCount: 1, activityType,
        school: txt(activityValue(activity, ['school', 'single_school_name', 'legacy_school'])),
        authority: txt(activityValue(activity, ['authority', 'authority_name'])), program: txt(activityValue(activity, ['activity_name', 'program_name', 'name'])),
        meetingNo: meeting.meeting_no ?? index + 1, kilometers: null, expenses: null,
        schoolId: activity.school_id == null ? null : Number(activity.school_id), activityId: txt(activityValue(activity, ['row_id', 'RowID', 'id']))
      });
    }));
  }
  return output;
}

// Repeated meeting dates can be intentional (for example two lessons on the
// same day). Keep every source meeting, then aggregate only the comparison view
// by activity/instructor/day and retain the original count and total duration.
export function aggregateDashboardAttendanceRows(rows = []) {
  const output = []; const groups = new Map();
  (rows || []).forEach((row, index) => {
    if (row.__profile) { output.push(row); return; }
    const activityKey = txt(row.activityId) || `__row_${index}`;
    const key = `${activityKey}|${txt(row.employeeId)}|${txt(row.date)}`;
    if (!groups.has(key)) {
      const aggregate = { ...row, meetingCount: number(row.meetingCount) || 1, workHours: optionalNumber(row.workHours) };
      aggregate.meetingNumbers = [txt(row.meetingNo)].filter(Boolean);
      groups.set(key, aggregate); output.push(aggregate); return;
    }
    const aggregate = groups.get(key);
    aggregate.meetingCount += number(row.meetingCount) || 1;
    aggregate.payrollHoursRequireReview ||= row.payrollHoursRequireReview || optionalNumber(row.workHours) == null;
    aggregate.workHours = aggregate.payrollHoursRequireReview ? null : Math.round((aggregate.workHours + optionalNumber(row.workHours)) * 100) / 100;
    if (timeText(row.startTime) && (!timeText(aggregate.startTime) || timeText(row.startTime) < timeText(aggregate.startTime))) aggregate.startTime = row.startTime;
    if (timeText(row.endTime) && (!timeText(aggregate.endTime) || timeText(row.endTime) > timeText(aggregate.endTime))) aggregate.endTime = row.endTime;
    const meetingNo = txt(row.meetingNo); if (meetingNo) aggregate.meetingNumbers.push(meetingNo);
    aggregate.meetingNo = aggregate.meetingNumbers.join(', ');
  });
  output.sourceRowCount = (rows || []).filter((row) => !row.__profile).length;
  return output;
}

function styledSheet(headers, rows, widths = []) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map((header, index) => ({ wch: widths[index] || Math.max(12, Math.min(28, txt(header).length + 5)) }));
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, rows.length + 1)}` };
  sheet['!views'] = [{ RTL: true }];
  return sheet;
}

export function parseAttendanceWorkbook(workbook) {
  const result = [];
  const fullDetailSheet = (workbook.SheetNames || []).find((name) => normalizeAttendanceName(name) === normalizeAttendanceName('פירוט מלא'));
  for (const sheetName of fullDetailSheet ? [fullDetailSheet] : (workbook.SheetNames || [])) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    if (!matrix.length) continue;
    const columns = resolveColumns(matrix[0]);
    if (columns.employeeId < 0 || columns.date < 0) continue;
    for (const source of matrix.slice(1)) {
      const get = (key) => columns[key] >= 0 ? source[columns[key]] : '';
      const employeeId = txt(get('employeeId'));
      if (!employeeId || !excelDate(get('date'))) continue;
      result.push({
        sourceSheet: sheetName, employeeId, employeeName: txt(get('employeeName')), employmentType: txt(get('employmentType')),
        date: excelDate(get('date')), startTime: timeText(get('startTime')), endTime: timeText(get('endTime')),
        workHours: optionalNumber(get('workHours')) ?? calculateWorkHours(get('startTime'), get('endTime')),
        activityType: txt(get('activityType')), school: txt(get('school')), authority: txt(get('authority')), program: txt(get('program')),
        meetingNo: txt(get('meetingNo')), kilometers: optionalNumber(get('kilometers')), expenses: optionalNumber(get('expenses')),
        expenseDetails: txt(get('expenseDetails')), notes: txt(get('notes')), activityId: txt(get('activityId'))
      });
    }
  }
  return result;
}

export function attendanceMonthLabel(month) {
  const match = txt(month).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return match ? `${HEBREW_MONTHS[Number(match[2]) - 1]} ${match[1]}` : '';
}

export function filterAttendanceRowsByMonth(attendanceRows = [], month = '') {
  if (!attendanceMonthLabel(month)) throw new Error('יש לבחור חודש לבדיקה לפני ביצוע הבדיקה.');
  return attendanceRows.filter((row) => txt(row.date).startsWith(`${month}-`));
}

function lookupText(value) {
  if (value && typeof value === 'object') return txt(value.Value || value.value || value.Label || value.label);
  if (typeof value !== 'string') return txt(value);
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? lookupText(parsed) : txt(value);
  } catch { return txt(value); }
}

export function normalizeAttendanceApiRows(records = []) {
  return records.map((row) => ({
    employeeId: txt(row.employeeId || row.EmployeeId || row.empNum),
    employeeName: txt(row.employeeName || row.EmployeeName || row.empName),
    employmentType: lookupText(row.employmentType || row.EmploymentType),
    team: lookupText(row.team || row.Team), date: excelDate(row.attendanceDate || row.AttendanceDate || row.date),
    startTime: timeText(row.startTime || row.StartTime || row.start), endTime: timeText(row.endTime || row.EndTime || row.end),
    workHours: optionalNumber(row.workHours ?? row.WorkHours ?? row.hours), activityType: lookupText(row.activityType || row.ActivityType || row.activity),
    school: txt(row.schoolName || row.SchoolName || row.school), authority: txt(row.municipality || row.Municipality || row.authority),
    program: txt(row.programName || row.ProgramName || row.program), meetingNo: txt(row.sessionNumber || row.SessionNumber || row.session),
    kilometers: optionalNumber(row.kilometers ?? row.Kilometers ?? row.km), expenses: optionalNumber(row.totalExpenses ?? row.TotalExpenses),
    expenseDetails: txt(row.expensesDetails || row.ExpensesDetails), notes: txt(row.notes || row.Notes), activityId: txt(row.ID || row.Id || row.id)
  })).filter((row) => row.employeeId && row.date);
}

export function attendanceTeams(employees = []) {
  const managers = employees.filter((employee) => txt(employee.role || employee.Role).toLowerCase() === 'manager');
  const managerByTeam = new Map(managers.map((manager) => [lookupText(manager.team || manager.Team), txt(manager.employeeName || manager.EmployeeName || manager.Title || manager.empName)]).filter(([team]) => team));
  if (!managerByTeam.size) {
    for (const employee of employees) {
      const team = lookupText(employee.team || employee.Team);
      if (team && !managerByTeam.has(team)) managerByTeam.set(team, team);
    }
  }
  return [...managerByTeam].map(([id, managerName]) => ({ id, managerName: managerName || id }));
}

export function attendanceExportFilename(month) {
  const label = attendanceMonthLabel(month);
  if (!label) throw new Error('יש לבחור חודש לבדיקה לפני הייצוא.');
  return `דוח_נוכחות_מתוקן_${label.replace(/\s+/g, '_')}.xlsx`;
}

export function attendanceDateScope(attendanceRows = [], month = '') {
  const dates = [...new Set(attendanceRows.map((row) => row.date).filter(Boolean))].sort();
  const monthMatch = txt(month).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  const monthEnd = monthMatch ? new Date(Date.UTC(Number(monthMatch[1]), Number(monthMatch[2]), 0)).getUTCDate() : 0;
  return {
    employeeIds: [...new Set(attendanceRows.map((row) => txt(row.employeeId)).filter(Boolean))],
    dates: new Set(dates),
    fromDate: monthMatch ? `${month}-01` : dates[0] || '',
    toDate: monthMatch ? `${month}-${monthEnd}` : dates.at(-1) || ''
  };
}

function usableDistance(row) {
  if (!row || row.distance_km == null || row.distance_km === '') return null;
  const value = Number(row.distance_km);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function instructorSchoolDistance(cache, employeeId, schoolId) {
  const hit = cache.find((row) => txt(row.origin_instructor_emp_id) === txt(employeeId) && Number(row.destination_school_id) === Number(schoolId));
  return usableDistance(hit);
}

function schoolSchoolDistance(cache, originSchoolId, destinationSchoolId) {
  if (Number(originSchoolId) === Number(destinationSchoolId)) return 0;
  const hit = cache.find((row) => Number(row.origin_school_id) === Number(originSchoolId) && Number(row.destination_school_id) === Number(destinationSchoolId));
  return usableDistance(hit);
}

// Uses the same cached instructor→school and school→school route segments as scheduling.
// Each row receives its incoming segment; the final row also receives the return-home
// segment (the system's instructor→school distance is symmetric for that return).
export function applyDashboardRouteKilometers(rows = [], travelCache = []) {
  const groups = new Map();
  rows.forEach((row) => { const key = `${row.employeeId}|${row.date}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
  for (const allDayRows of groups.values()) {
    allDayRows.forEach((row) => { row.kilometers = null; });
    const isZoom = (row) => /zoom|זום/u.test(normalizeAttendanceName(`${row.school} ${row.program}`));
    const physicalRows = allDayRows.filter((row) => !isZoom(row));
    allDayRows.filter(isZoom).forEach((row) => { row.kilometers = 0; });
    // A partial route is misleading. If even one physical destination cannot be
    // identified, leave the complete day for manager review.
    if (physicalRows.some((row) => row.schoolId == null)) continue;
    const dayRows = physicalRows;
    dayRows.sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
    dayRows.forEach((row, index) => {
      const incoming = index === 0
        ? instructorSchoolDistance(travelCache, row.employeeId, row.schoolId)
        : schoolSchoolDistance(travelCache, dayRows[index - 1].schoolId, row.schoolId);
      const returnHome = index === dayRows.length - 1 ? instructorSchoolDistance(travelCache, row.employeeId, row.schoolId) : 0;
      row.kilometers = incoming == null || returnHome == null ? null : Math.round((incoming + returnHome) * 100) / 100;
    });
    if (dayRows.some((row) => row.kilometers == null)) allDayRows.forEach((row) => { row.kilometers = null; });
  }
  return rows;
}

export function applyDashboardExpenses(rows = [], expenses = []) {
  const totals = new Map(); const details = new Map();
  for (const expense of expenses) {
    const key = `${txt(expense.emp_id)}|${excelDate(expense.expense_date)}`;
    totals.set(key, (totals.get(key) || 0) + number(expense.amount));
    const description = txt(expense.description || expense.notes); if (description) (details.get(key) || details.set(key, []).get(key)).push(description);
  }
  const used = new Set();
  rows.forEach((row) => {
    const key = `${row.employeeId}|${row.date}`;
    if (!totals.has(key) || used.has(key)) return;
    row.expenses = Math.round(totals.get(key) * 100) / 100;
    row.expenseDetails = [...new Set(details.get(key) || [])].join('; ');
    used.add(key);
  });
  return rows;
}

export async function loadAttendanceDashboardDataset(attendanceRows, api, month = '') {
  const scope = attendanceDateScope(attendanceRows, month);
  if (!scope.employeeIds.length || !scope.fromDate || !api?.attendanceControlDashboardSources) return [];
  const sources = await api.attendanceControlDashboardSources(scope);
  const sourceRows = buildDashboardAttendanceRows(sources.activities, sources.contacts)
    .filter((row) => (month ? row.date.startsWith(`${month}-`) : scope.dates.has(row.date)) && scope.employeeIds.includes(row.employeeId));
  const rows = aggregateDashboardAttendanceRows(sourceRows);
  applyDashboardRouteKilometers(rows, sources.travelCache || []);
  applyDashboardExpenses(rows, sources.expenses || []);
  for (const contact of sources.contacts || []) {
    const employeeId = txt(contact.emp_id);
    if (scope.employeeIds.includes(employeeId)) rows.push({ employeeId, employeeName: txt(contact.full_name), employmentType: txt(contact.employment_type), __profile: true });
  }
  return rows;
}

function minutesBetween(a, b) {
  const minutes = (v) => { const m = timeText(v).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  return Math.abs(minutes(a) - minutes(b));
}

function attendanceActivityTypeKey(value) {
  const normalized = normalizeActivityTypeKey(value);
  return normalized === 'after_school' ? 'course' : normalized;
}

function bundleComponents(row) {
  return row?.componentRows?.length ? row.componentRows : [row];
}

function sameBundleText(attendance, dashboard, key) {
  const expected = normalizeAttendanceName(attendance[key]);
  return Boolean(expected) && bundleComponents(dashboard).some((row) => normalizeAttendanceName(row[key]) === expected);
}

function componentHasContext(attendance, dashboard) {
  // Bundle membership needs identity evidence. Authority and activity type are
  // useful scoring signals, but are too broad to admit a component by themselves.
  return sameBundleText(attendance, dashboard, 'school')
    || sameBundleText(attendance, dashboard, 'program');
}

function matchScore(attendance, dashboard) {
  const sameText = (key) => sameBundleText(attendance, dashboard, key);
  const timePoints = (key) => {
    if (!timeText(attendance[key]) || !timeText(dashboard[key])) return 0;
    return Math.max(0, 20 - Math.min(20, minutesBetween(attendance[key], dashboard[key]) / 3));
  };
  const sameActivityType = Boolean(attendanceActivityTypeKey(attendance.activityType))
    && bundleComponents(dashboard).some((row) => attendanceActivityTypeKey(row.activityType) === attendanceActivityTypeKey(attendance.activityType));
  const context = (sameText('school') ? 30 : 0) + (sameText('authority') ? 15 : 0)
    + (sameText('program') ? 25 : 0) + (sameActivityType ? 15 : 0);
  const time = timePoints('startTime') + timePoints('endTime');
  const hourDifference = Math.abs(rowWorkHours(attendance) - rowWorkHours(dashboard));
  const hours = Math.max(0, 20 - Math.min(20, hourDifference * 8));
  return { score: context + time + hours, context, time, hours };
}

function acceptableMatch(match) {
  // Time alone is never identity evidence: require at least one non-empty
  // contextual agreement in addition to a meaningful absolute score.
  return match.score >= 40 && match.context >= 15;
}

function comparable(type, value) {
  if (type === 'number' || type === 'money') return optionalNumber(value) ?? '__missing__';
  if (type === 'time') return timeText(value);
  if (type === 'activityType') return attendanceActivityTypeKey(value);
  return normalizeAttendanceName(value);
}

function rowWorkHours(row) {
  if (row?.payrollHoursRequireReview) return 0;
  return optionalNumber(row?.workHours) ?? calculateWorkHours(row?.startTime, row?.endTime);
}

function dashboardBundle(rows) {
  const ordered = [...rows].sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
  const unique = (key) => [...new Set(ordered.map((row) => txt(row[key])).filter(Boolean))];
  const meetingNumbers = ordered.flatMap((row) => row.meetingNumbers?.length ? row.meetingNumbers : [txt(row.meetingNo)].filter(Boolean));
  const activityIds = unique('activityId');
  const joined = (key) => unique(key).join(' + ');
  return {
    ...ordered[0], componentRows: ordered, activityIds, activityId: activityIds.join(' + '),
    startTime: ordered.map((row) => timeText(row.startTime)).filter(Boolean).sort()[0] || '',
    endTime: ordered.map((row) => timeText(row.endTime)).filter(Boolean).sort().at(-1) || '',
    workHours: ordered.some((row) => row.payrollHoursRequireReview) ? null : Math.round(ordered.reduce((sum, row) => sum + rowWorkHours(row), 0) * 100) / 100,
    payrollHoursRequireReview: ordered.some((row) => row.payrollHoursRequireReview),
    meetingCount: ordered.reduce((sum, row) => sum + (number(row.meetingCount) || 1), 0),
    meetingNumbers, meetingNo: meetingNumbers.join(', '),
    school: joined('school'), authority: joined('authority'), program: joined('program'), activityType: joined('activityType')
  };
}

function assignDashboardBundles(attendanceEntries, dashboardRows) {
  const orderedDashboard = [...dashboardRows].sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
  const candidates = attendanceEntries.map(({ attendance }) => {
    const rows = []; const eligible = orderedDashboard
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => componentHasContext(attendance, row));
    for (let eligibleStart = 0; eligibleStart < eligible.length; eligibleStart += 1) {
      for (let eligibleEnd = eligibleStart; eligibleEnd < eligible.length; eligibleEnd += 1) {
        const selected = eligible.slice(eligibleStart, eligibleEnd + 1);
        const componentRows = selected.map(({ row }) => row);
        const start = selected[0].index; const end = selected.at(-1).index;
        const bundle = dashboardBundle(componentRows); const match = matchScore(attendance, bundle);
        if (acceptableMatch(match)) rows.push({ bundle, componentRows, start, end, ...match });
      }
    }
    return rows.sort((a, b) => b.score - a.score || b.componentRows.length - a.componentRows.length);
  });
  const memo = new Map();
  const search = (position, dashboardCursor) => {
    if (position === attendanceEntries.length) return { utility: 0, assignments: [] };
    const memoKey = `${position}|${dashboardCursor}`; if (memo.has(memoKey)) return memo.get(memoKey);
    const skipped = search(position + 1, dashboardCursor);
    let best = { utility: skipped.utility, assignments: [null, ...skipped.assignments] };
    for (const candidate of candidates[position]) {
      if (candidate.start < dashboardCursor) continue;
      const remaining = search(position + 1, candidate.end + 1);
      const utility = candidate.score + remaining.utility;
      if (utility > best.utility) best = { utility, assignments: [candidate, ...remaining.assignments] };
    }
    memo.set(memoKey, best); return best;
  };
  return search(0, 0).assignments;
}

export function compareAttendanceRows(attendanceRows, dashboardRows) {
  const attendanceOnly = (attendanceRows || []).filter((row) => isAttendanceOnlyActivityType(row.activityType));
  const comparableAttendance = (attendanceRows || []).filter((row) => !isAttendanceOnlyActivityType(row.activityType));
  const attendanceIds = new Set((attendanceRows || []).map((row) => txt(row.employeeId)).filter(Boolean));
  const dashboardSourcePopulation = (dashboardRows || []).filter((row) => attendanceIds.has(txt(row.employeeId)));
  const dashboardPopulation = aggregateDashboardAttendanceRows(dashboardSourcePopulation);
  dashboardPopulation.sourceRowCount = dashboardRows?.sourceRowCount ?? dashboardSourcePopulation.filter((row) => !row.__profile).length;
  const buckets = new Map();
  dashboardPopulation.forEach((row) => {
    const key = `${txt(row.employeeId)}|${row.date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  });
  const used = new Set(); const assignments = new Map(); const attendanceBuckets = new Map();
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    const key = `${txt(attendance.employeeId)}|${attendance.date}`;
    if (!attendanceBuckets.has(key)) attendanceBuckets.set(key, []);
    attendanceBuckets.get(key).push({ attendance, attendanceIndex });
  });
  attendanceBuckets.forEach((entries, key) => {
    const orderedEntries = [...entries].sort((a, b) => timeText(a.attendance.startTime).localeCompare(timeText(b.attendance.startTime)));
    const dayAssignments = assignDashboardBundles(orderedEntries, (buckets.get(key) || []).filter((row) => !row.__profile));
    dayAssignments.forEach((match, index) => {
      if (!match) return;
      assignments.set(orderedEntries[index].attendanceIndex, match);
      match.componentRows.forEach((row) => used.add(row));
    });
  });
  // Second pass: soft matching for rows that are unmatched after the main pass.
  // Requires same authority + same activity type + meaningful time overlap (≥30 min).
  // Prevents the same activity from appearing as both "נוכחות ללא פעילות" and "פעילות ללא נוכחות".
  const toMinutes = (v) => { const m = timeText(v).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const unusedByKey = new Map();
  dashboardPopulation.forEach((row) => {
    if (row.__profile || used.has(row)) return;
    const key = `${txt(row.employeeId)}|${row.date}`;
    if (!unusedByKey.has(key)) unusedByKey.set(key, []);
    unusedByKey.get(key).push(row);
  });
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    if (assignments.has(attendanceIndex)) return;
    const key = `${txt(attendance.employeeId)}|${attendance.date}`;
    const candidates = unusedByKey.get(key) || [];
    const aStart = toMinutes(attendance.startTime); const aEnd = toMinutes(attendance.endTime);
    let bestScore = 0; let bestMatch = null;
    for (const dashRow of candidates) {
      if (used.has(dashRow)) continue;
      const sameAuthority = Boolean(normalizeAttendanceName(attendance.authority))
        && normalizeAttendanceName(attendance.authority) === normalizeAttendanceName(dashRow.authority);
      const sameType = Boolean(attendanceActivityTypeKey(attendance.activityType))
        && attendanceActivityTypeKey(attendance.activityType) === attendanceActivityTypeKey(dashRow.activityType);
      if (!sameAuthority || !sameType) continue;
      const dStart = toMinutes(dashRow.startTime); const dEnd = toMinutes(dashRow.endTime);
      const overlapMinutes = (aStart != null && aEnd != null && dStart != null && dEnd != null)
        ? Math.max(0, Math.min(aEnd, dEnd) - Math.max(aStart, dStart)) : 0;
      if (overlapMinutes < 30) continue;
      const score = (sameAuthority ? 15 : 0) + (sameType ? 15 : 0) + Math.min(30, overlapMinutes / 4);
      if (score > bestScore) { bestScore = score; bestMatch = dashRow; }
    }
    if (bestMatch) {
      const bundle = dashboardBundle([bestMatch]);
      assignments.set(attendanceIndex, { bundle, componentRows: [bestMatch], score: bestScore, isSoftMatch: true });
      used.add(bestMatch);
      unusedByKey.set(key, (unusedByKey.get(key) || []).filter((r) => r !== bestMatch));
    }
  });
  // A dashboard activity may itself represent several meetings. If attendance
  // reports those meetings separately, reuse that aggregate up to meetingCount
  // times rather than manufacturing a dashboard-only exception.
  const aggregateUseCount = new Map();
  assignments.forEach((match) => match.componentRows.forEach((row) => aggregateUseCount.set(row, (aggregateUseCount.get(row) || 0) + 1)));
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    if (assignments.has(attendanceIndex)) return;
    const key = `${txt(attendance.employeeId)}|${attendance.date}`;
    const candidate = (buckets.get(key) || []).filter((row) => !row.__profile && number(row.meetingCount) > 1 && number(row.meetingCount) > (aggregateUseCount.get(row) || 0))
      .map((row) => ({ row, match: matchScore(attendance, row) })).filter(({ match }) => acceptableMatch(match))
      .sort((a, b) => b.match.score - a.match.score)[0];
    if (!candidate) return;
    const share = { ...candidate.row, meetingCount: 1, workHours: candidate.row.payrollHoursRequireReview ? null : Math.round(rowWorkHours(candidate.row) / number(candidate.row.meetingCount) * 100) / 100 };
    assignments.set(attendanceIndex, { bundle: share, componentRows: [candidate.row], score: candidate.match.score, sharedAggregate: true });
    aggregateUseCount.set(candidate.row, (aggregateUseCount.get(candidate.row) || 0) + 1);
    used.add(candidate.row);
  });
  const comparisons = comparableAttendance.map((attendance, attendanceIndex) => {
    const match = assignments.get(attendanceIndex); const dashboard = match?.bundle || null;
    // Freeze the attendance payroll value before any manager time decision. The
    // export must not later derive paid hours from a selected school-clock range.
    const final = { ...attendance, workHours: rowWorkHours(attendance) };
    const differences = dashboard ? FIELD_DEFS.flatMap(([key, label, type]) => {
      // Travel is audited once for the instructor's complete daily route, never per row.
      if (key === 'kilometers') return [];
      // An unusual school timetable has no invented payroll conversion.
      if (key === 'workHours' && dashboard.payrollHoursRequireReview) return [];
      const attendanceValue = key === 'workHours' ? rowWorkHours(attendance) : type === 'activityType' ? activityTypeDisplayLabel(attendance[key]) : attendance[key];
      const dashboardValue = key === 'workHours' ? rowWorkHours(dashboard) : type === 'activityType' ? activityTypeDisplayLabel(dashboard[key]) : dashboard[key];
      if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
      // Grace window for time fields: early arrival (≤10 min before start) and late departure
      // (≤10 min after end) are legitimate setup/wrap-up time and must not be flagged.
      if (type === 'time') {
        const aMin = toMinutes(attendanceValue); const dMin = toMinutes(dashboardValue);
        if (aMin !== null && dMin !== null) {
          // School end-time and paid end-time intentionally differ for standard
          // 45/90-minute activities. Equal starts plus the matching payroll
          // duration is a valid alignment, not a time discrepancy.
          if (key === 'endTime' && !dashboard.payrollHoursRequireReview
            && timeText(attendance.startTime) === timeText(dashboard.startTime)
            && Math.abs(calculateWorkHours(attendance.startTime, attendance.endTime) - rowWorkHours(dashboard)) < 0.01) return [];
          if (key === 'startTime' && aMin >= dMin - ATTENDANCE_GRACE_START_MINUTES && aMin <= dMin) return [];
          if (key === 'endTime'   && aMin >= dMin && aMin <= dMin + ATTENDANCE_GRACE_END_MINUTES) return [];
        }
      }
      // Dashboard rows never carry real expense data (expenses: null by default).
      // Suppress the diff when attendance reports 0 and the dashboard field is absent —
      // there is no actual discrepancy, just a missing dashboard value.
      if (key === 'expenses' && (optionalNumber(attendanceValue) ?? 0) === 0 && optionalNumber(dashboardValue) == null) return [];
      return [{ key, label, type, attendance: attendanceValue, dashboard: dashboardValue, choice: 'attendance', custom: '' }];
    }) : [];
    return { id: `row-${attendanceIndex}`, attendance, dashboard, final, differences, unmatched: !dashboard, matchScore: match?.score ?? null };
  });
  const dashboardOnly = dashboardPopulation
    .filter((row) => !row.__profile && row.date && !used.has(row))
    .map((dashboard, index) => ({
      id: `dashboard-only-${index}`,
      source: 'dashboard_only',
      dashboard,
      final: { ...dashboard },
      includeInFinal: false
    }));
  const notCompared = attendanceOnly.map((attendance, index) => ({
    id: `attendance-only-${index}`, source: 'attendance_not_compared', attendance,
    final: { ...attendance }, differences: [], excludedFromActivityComparison: true
  }));
  const dailyKilometers = [];
  const dayKeys = new Set((attendanceRows || []).map((row) => `${txt(row.employeeId)}|${row.date}`));
  dayKeys.forEach((key) => {
    const [employeeId, date] = key.split('|');
    const attendance = (attendanceRows || []).filter((row) => txt(row.employeeId) === employeeId && row.date === date);
    const dashboard = dashboardPopulation.filter((row) => !row.__profile && txt(row.employeeId) === employeeId && row.date === date);
    const reported = Math.round(attendance.reduce((sum, row) => sum + (optionalNumber(row.kilometers) || 0), 0) * 100) / 100;
    const calculatedValues = dashboard.map((row) => optionalNumber(row.kilometers));
    const calculated = dashboard.length && calculatedValues.every((value) => value != null)
      ? Math.round(calculatedValues.reduce((sum, value) => sum + value, 0) * 100) / 100 : null;
    dailyKilometers.push({ employeeId, date, reported, calculated, matches: calculated != null && reported === calculated });
  });
  return { comparisons, notCompared, dashboardOnly, dashboardPopulation, dailyKilometers };
}

export function setDashboardOnlyChoice(entry, includeInFinal) {
  if (entry?.source === 'dashboard_only') entry.includeInFinal = Boolean(includeInFinal);
  return entry;
}

export function applyAttendanceChoice(comparison, field, choice, custom = '') {
  const difference = comparison.differences.find((item) => item.key === field);
  if (!difference) return comparison;
  difference.choice = choice; difference.custom = custom;
  const value = choice === 'dashboard' ? difference.dashboard : choice === 'custom' ? custom : difference.attendance;
  comparison.final[field] = difference.type === 'number' || difference.type === 'money' ? optionalNumber(value) : value;
  return comparison;
}

function activityBucket(value) {
  const normalized = normalizeAttendanceName(value);
  if (normalized.includes('ביטולזמן')) return 0; if (normalized.includes('הכשרה')) return 1;
  if (normalized.includes('חדרבריחה')) return 2; if (normalized.includes('סדנאותקיץ')) return 4;
  if (normalized.includes('סדנה')) return 3; if (normalized.includes('סיור')) return 5;
  if (normalized.includes('קורס')) return 6; if (normalized.includes('תפעול')) return 7;
  return -1;
}

export function buildCorrectedAttendanceWorkbook(comparisons, dashboardRows = []) {
  const employment = new Map((dashboardRows || []).map((row) => [txt(row.employeeId), txt(row.employmentType)]));
  const rows = (comparisons || [])
    .filter((entry) => entry.source !== 'dashboard_only' || entry.includeInFinal)
    .map(({ final }) => ({ ...final, workHours: rowWorkHours(final), employmentType: employment.get(txt(final.employeeId)) || txt(final.employmentType) }));
  const detail = rows.map((row) => [row.employeeId, row.employeeName, row.date, row.startTime, row.endTime, row.workHours, row.activityType, row.school, row.authority, row.program, row.meetingNo, row.kilometers, row.expenses, row.expenseDetails, row.notes]);
  const monthlyMap = new Map();
  rows.filter((row) => normalizeAttendanceName(row.employmentType).includes(normalizeAttendanceName('תעשיידע'))).forEach((row) => {
    const key = txt(row.employeeId); if (!monthlyMap.has(key)) monthlyMap.set(key, { name: row.employeeName, id: key, hours: Array(8).fill(0), km: 0, expenses: 0, details: [] });
    const item = monthlyMap.get(key); const bucket = activityBucket(row.activityType); if (bucket >= 0) item.hours[bucket] += row.workHours;
    item.km += optionalNumber(row.kilometers) || 0; item.expenses += optionalNumber(row.expenses) || 0; if (row.expenseDetails) item.details.push(row.expenseDetails);
  });
  const monthly = [...monthlyMap.values()].map((item) => [item.name, item.id, ...item.hours.map((v) => Math.round(v * 100) / 100), item.km, item.expenses, [...new Set(item.details)].join('; ')]);
  const daily = rows.filter((row) => normalizeAttendanceName(row.employmentType).includes(normalizeAttendanceName('כוח אדם'))).map((row) => [row.date, row.employeeName, row.employeeId, row.activityType, row.authority, row.startTime, row.endTime, row.workHours, row.kilometers, row.expenses, row.expenseDetails]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, styledSheet(DETAIL_HEADERS, detail), 'פירוט מלא');
  XLSX.utils.book_append_sheet(workbook, styledSheet(MONTHLY_HEADERS, monthly), 'סיכום חודשי');
  XLSX.utils.book_append_sheet(workbook, styledSheet(DAILY_HEADERS, daily), 'תצוגה יומית');
  return workbook;
}

// Format a decimal-hours gap as a human-readable Hebrew string.
// < 1 hour  → "45 דקות"
// ≥ 1 hour  → "2 שעות 15 דקות" (or "2 שעות" when minutes = 0)
function formatHourGap(decimalHours) {
  const totalMinutes = Math.round(Math.abs(decimalHours) * 60);
  if (totalMinutes < 60) return `${totalMinutes} דקות`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m > 0 ? `${h} שעות ${m} דקות` : `${h} שעות`;
}

function diffText(diff) {
  if (diff.type === 'time' && (!timeText(diff.attendance) || !timeText(diff.dashboard))) return 'חסר נתון באחד המקורות';
  if (diff.type === 'time') return `פער ${minutesBetween(diff.attendance, diff.dashboard)} דקות`;
  if ((diff.type === 'number' || diff.type === 'money') && (optionalNumber(diff.attendance) == null || optionalNumber(diff.dashboard) == null)) return 'חסר נתון באחד המקורות';
  if (diff.type === 'number') {
    // workHours is a duration field — display as time, not km.
    if (diff.key === 'workHours') return `פער ${formatHourGap(Math.abs(number(diff.attendance) - number(diff.dashboard)))}`;
    return `פער ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ק״מ`;
  }
  if (diff.type === 'money') return `פער ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ₪`;
  return `${txt(diff.attendance) || 'ללא ערך'} לעומת ${txt(diff.dashboard) || 'ללא ערך'}`;
}

function shortDifferenceText(diff) {
  const labels = { startTime: 'שעת התחלה שונה', endTime: 'שעת סיום שונה', workHours: 'שעות שכר לבדיקה', school: 'בית הספר שונה', program: 'שם התוכנית שונה', meetingNo: 'מספר המפגש שונה' };
  if (diff.key === 'kilometers' && (optionalNumber(diff.attendance) == null || optionalNumber(diff.dashboard) == null)) return 'לא ניתן לחשב ק״מ';
  return labels[diff.key] || `${diff.label} שונה`;
}

export function attendanceAuditSummary(result) {
  const employees = new Set([...result.comparisons, ...(result.notCompared || [])].map((c) => c.attendance.employeeId));
  const matched = result.comparisons.filter((c) => !c.unmatched);
  const fieldMismatches = matched.filter((c) => c.differences.length);
  const unmatchedAttendance = result.comparisons.filter((c) => c.unmatched);
  const mismatchedComparisons = [...fieldMismatches, ...unmatchedAttendance];
  const different = new Set([
    ...mismatchedComparisons.map((c) => c.attendance.employeeId),
    ...(result.dashboardOnly || []).map((entry) => entry.dashboard.employeeId)
  ]);
  const sum = (key) => result.comparisons.reduce((total, c) => {
    const attendance = optionalNumber(c.attendance[key]); const dashboard = optionalNumber(c.dashboard?.[key]);
    return attendance == null || dashboard == null ? total : total + Math.abs(attendance - dashboard);
  }, 0);
  const attendanceHours = result.comparisons.reduce((total, c) => total + rowWorkHours(c.attendance), 0);
  const notComparedHours = (result.notCompared || []).reduce((total, c) => total + rowWorkHours(c.attendance), 0);
  const dashboardHours = (result.dashboardPopulation || []).filter((row) => !row.__profile).reduce((total, row) => total + rowWorkHours(row), 0);
  return {
    employees: employees.size, different: different.size,
    attendanceRows: result.comparisons.length + (result.notCompared || []).length,
    comparableAttendanceRows: result.comparisons.length, notComparedRows: (result.notCompared || []).length,
    dashboardRowsBeforeProcessing: result.dashboardPopulation?.sourceRowCount ?? (result.dashboardPopulation || []).filter((row) => !row.__profile).length,
    dashboardRows: (result.dashboardPopulation || []).filter((row) => !row.__profile).length,
    fullMatches: matched.length - fieldMismatches.length, fieldMismatches: fieldMismatches.length,
    unmatchedAttendance: unmatchedAttendance.length, unmatchedDashboard: (result.dashboardOnly || []).length,
    exceptions: mismatchedComparisons.length + (result.dashboardOnly || []).length,
    attendanceHours: Math.round(attendanceHours * 100) / 100, notComparedHours: Math.round(notComparedHours * 100) / 100,
    totalReportedHours: Math.round((attendanceHours + notComparedHours) * 100) / 100, dashboardHours: Math.round(dashboardHours * 100) / 100,
    hours: Math.round(Math.abs(attendanceHours - dashboardHours) * 100) / 100,
    km: (result.dailyKilometers || []).reduce((total, day) => day.calculated == null ? total : total + Math.abs(day.reported - day.calculated), 0), expenses: sum('expenses')
  };
}

export function attendanceControlHtml() {
  return `<section class="attendance-control no-print" data-attendance-control hidden dir="rtl"><div class="attendance-control__head"><div><h2 data-attendance-title>בקרת שכר</h2></div><button type="button" class="ds-btn ds-btn--sm" data-attendance-close>סגירה</button></div><div class="attendance-control__uploads"><label><strong>נוכחות</strong><span>בחר חודש</span><input class="ds-input" type="month" data-attendance-month></label><label><strong>דשבורד</strong><span>בחר חודש</span><input class="ds-input" type="month" data-dashboard-month></label><label><strong>צוות</strong><select class="ds-input" data-attendance-team disabled><option value="">טוען צוותים…</option></select></label><button type="button" class="ds-btn ds-btn--primary" data-attendance-run disabled>אישור בקרת שכר</button></div><p class="attendance-control__status" data-attendance-status aria-live="polite"></p><div data-attendance-results></div></section>`;
}

export function attendanceControlStylesHtml() {
  return `<style id="attendance-control-styles">
.attendance-control{margin:16px 0;padding:18px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.attendance-control__head,.attendance-control__uploads,.attendance-control__metrics,.attendance-control__employee-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.attendance-control__head{justify-content:space-between}.attendance-control__head h2{margin:0}.attendance-control__head p{margin:4px 0;color:#64748b}
.attendance-control__uploads{margin:16px 0;padding:14px;background:#f8fafc;border-radius:10px}.attendance-control__uploads label{display:grid;gap:6px;min-width:220px;flex:1}.attendance-control__status{color:#b91c1c;font-weight:700}
.attendance-control__summary-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 0;padding:12px 14px;border-radius:10px;background:#f4f7fb;color:#1f2a37;font-weight:600}.attendance-control__summary-bar span{padding:7px 12px;border:1px solid #d7e0ea;border-radius:8px;background:#ffffff;font-weight:600}.attendance-control__metrics-details{margin:6px 0 12px}.attendance-control__metrics-details>summary{cursor:pointer;color:#64748b;font-size:.92em;padding:4px 2px}.attendance-control__metrics{margin:6px 0;display:flex;flex-wrap:wrap;gap:8px}.attendance-control__metrics>span,.attendance-control__employee-summary>span{padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
.attendance-control__employee{margin:8px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}.attendance-control__employee>summary{display:flex;justify-content:space-between;gap:12px;padding:11px 13px;cursor:pointer;background:#f8fafc}.attendance-control__employee-summary{padding:8px 13px}
.attendance-control__dashboard-only{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:7px 13px;padding:9px 11px;border:1px solid #d7e0ea;border-radius:9px;background:#fff}.attendance-control__dashboard-only-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.attendance-control__dashboard-only-line span:last-child{color:#b7791f;font-weight:700}
.attendance-control__day{margin:7px 13px;padding:9px 11px;border:1px solid;border-radius:9px}.attendance-control__day h4{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0;font-size:.95em}.attendance-control__day--ok{border-color:#d7e0ea;background:#fff;color:inherit}.attendance-control__day--ok .attendance-control__row-status{color:#2d8a55}.attendance-control__day--mismatch{border-color:#d7e0ea;background:#fff}.attendance-control__day--mismatch .attendance-control__row-status{color:#b7791f}.attendance-control__day--not-compared{border-color:#cbd5e1;background:#f8fafc;color:#475569}.attendance-control__row-status{font-weight:800;white-space:nowrap}.attendance-control__short-gaps{margin:6px 0 0;color:#b7791f;font-weight:700}.attendance-control__comparison-details{margin-top:6px}.attendance-control__comparison-details>summary{display:inline-flex!important;justify-content:center!important;padding:5px 10px!important;border:1px solid #cbd5e1;border-radius:7px;background:#fff!important;font-weight:700}.attendance-control__comparison-details[open]>summary{margin-bottom:6px}.attendance-control__diff{display:grid;grid-template-columns:minmax(110px,1fr) repeat(3,minmax(90px,1fr)) minmax(140px,1fr) minmax(110px,1fr);gap:7px;align-items:center;padding:7px 0;border-top:1px dashed #e2e8f0}.attendance-control__diff--header{border-top:none;border-bottom:1px solid #d7e0ea;padding-top:4px;padding-bottom:6px;margin-bottom:1px;color:#5f6f82;font-size:.82em;font-weight:700}.attendance-control__diff--header span{font-weight:700}.attendance-control__export{margin-top:14px}
@media(max-width:850px){.attendance-control__diff{grid-template-columns:1fr 1fr}.attendance-control__diff strong{grid-column:1/-1}.attendance-control__diff--header{display:none}[data-src-label]::before{content:attr(data-src-label)": ";font-weight:700;font-size:.8em;display:block;color:#5f6f82;margin-bottom:2px}}
</style>`;
}

export function resultsHtml(result, month = '') {
  const totals = attendanceAuditSummary(result);

  // Build per-employee buckets for both comparable rows and notCompared rows.
  // notCompared rows (ביטול זמן / הכשרה / תפעול) must be woven into each
  // instructor's chronological timeline rather than shown in a separate section.
  const byEmployee = new Map(); // employee + day → one compact work unit
  const ensure = (key) => { if (!byEmployee.has(key)) byEmployee.set(key, { comparisons: [], notCompared: [] }); return byEmployee.get(key); };
  result.comparisons.forEach((c) => ensure(`${c.attendance.employeeId}|${c.attendance.date}`).comparisons.push(c));
  (result.notCompared || []).forEach((e) => ensure(`${e.attendance.employeeId}|${e.attendance.date}`).notCompared.push(e));
  // Ensure employees with only dashboardOnly rows still get a card.
  (result.dashboardOnly || []).forEach((e) => ensure(`${e.dashboard.employeeId}|${e.dashboard.date}`));

  const dashboardOnlyByEmployee = new Map();
  (result.dashboardOnly || []).forEach((entry) => { const key = `${entry.dashboard.employeeId}|${entry.dashboard.date}`; if (!dashboardOnlyByEmployee.has(key)) dashboardOnlyByEmployee.set(key, []); dashboardOnlyByEmployee.get(key).push(entry); });

  const cards = [...byEmployee.entries()].map(([dayKey, { comparisons: rows, notCompared: ncRows }]) => {
    const [employeeId, date] = dayKey.split('|');
    const dashboardOnly = dashboardOnlyByEmployee.get(dayKey) || [];
    const name = rows[0]?.attendance?.employeeName || ncRows[0]?.attendance?.employeeName || dashboardOnly[0]?.dashboard?.employeeName || employeeId;
    const attendanceHours = rows.reduce((s, r) => s + rowWorkHours(r.attendance), 0);
    const dashboardHours = rows.reduce((s, r) => s + rowWorkHours(r.dashboard), 0)
      + dashboardOnly.reduce((sum, entry) => sum + rowWorkHours(entry.dashboard), 0);

    // Unified timeline: comparable rows + notCompared rows sorted by date → startTime.
    // notCompared entries are tagged so they can be rendered differently.
    const timeline = [
      ...rows.map((c) => ({ kind: 'comparison', item: c, sortKey: (c.attendance.date || '') + (c.attendance.startTime || '') })),
      ...ncRows.map((e) => ({ kind: 'notCompared', item: e, sortKey: (e.attendance.date || '') + (e.attendance.startTime || '') })),
    ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const details = timeline.map(({ kind, item }) => {
      if (kind === 'notCompared') {
        // Displayed inline in the chronological timeline; does not affect gap counting.
        return `<div class="attendance-control__day attendance-control__day--not-compared"><h4><span>${escapeHtml(item.attendance.date)} · ${escapeHtml(item.attendance.activityType || 'דיווח')} · ${escapeHtml(`${item.attendance.startTime || '—'}–${item.attendance.endTime || '—'}`)} · ${rowWorkHours(item.attendance)} שעות</span><span class="attendance-control__row-status">נשמר ברצף יום העבודה</span></h4></div>`;
      }
      const comparison = item;
      const mismatch = comparison.unmatched || comparison.differences.length > 0;
      const status = comparison.unmatched ? '⚠ לא נמצאה פעילות תואמת' : mismatch ? '⚠ לבדיקה' : '✓ תקין';
      const shortGaps = [...(comparison.unmatched ? ['לא נמצאה פעילות תואמת'] : comparison.differences.map(shortDifferenceText)), ...(comparison.dashboard?.payrollHoursRequireReview ? ['שעות שכר לבדיקה'] : [])].filter((value, index, values) => values.indexOf(value) === index);
      const note = shortGaps.length ? `<p class="attendance-control__short-gaps">${shortGaps.map(escapeHtml).join(' · ')}</p>` : '';
      const diffHeader = comparison.differences.length ? '<div class="attendance-control__diff attendance-control__diff--header" aria-hidden="true"><strong>שדה</strong><span>נוכחות</span><span>דשבורד</span><span>פער</span><span>החלטה</span><span></span></div>' : '';
      const choices = diffHeader + comparison.differences.map((diff) => `<div class="attendance-control__diff" data-comparison="${comparison.id}" data-field="${diff.key}"><strong>${escapeHtml(diff.label)}</strong><span data-src-label="נוכחות">${escapeHtml(txt(diff.attendance) || '—')}</span><span data-src-label="דשבורד">${escapeHtml(txt(diff.dashboard) || '—')}</span><span>${escapeHtml(diffText(diff))}</span><select class="ds-input ds-input--sm" data-attendance-choice><option value="attendance">נתון הנוכחות</option><option value="dashboard">נתון הדשבורד</option><option value="custom">ערך אחר</option></select><input class="ds-input ds-input--sm" data-attendance-custom hidden aria-label="ערך אחר"></div>`).join('');
      const fullComparison = choices ? `<details class="attendance-control__comparison-details"><summary>פרטים</summary>${choices}</details>` : '';
      return `<div class="attendance-control__day attendance-control__day--${mismatch ? 'mismatch' : 'ok'}"><h4><span>${escapeHtml(`${comparison.attendance.startTime || '—'}–${comparison.attendance.endTime || '—'}`)} | ${escapeHtml(comparison.attendance.program || comparison.attendance.activityType || 'דיווח')}</span><span class="attendance-control__row-status">${status}</span></h4>${note}${fullComparison}</div>`;
    }).join('');

    const missing = dashboardOnly.map((entry) => `<div class="attendance-control__dashboard-only" data-dashboard-only="${entry.id}"><div class="attendance-control__dashboard-only-line"><strong>${escapeHtml(`${entry.dashboard.startTime || '—'}–${entry.dashboard.endTime || '—'}`)}</strong><span>| ${escapeHtml(entry.dashboard.program || entry.dashboard.activityType || 'פעילות')} |</span><span>פעילות בדשבורד ללא דיווח</span></div><select class="ds-input ds-input--sm" data-dashboard-only-choice><option value="leave">להשאיר ללא שינוי</option><option value="add">להוסיף לנתונים הסופיים</option></select></div>`).join('');
    // notCompared rows are informational; they are not counted as gaps.
    const gapCount = rows.filter((row) => row.unmatched || row.differences.length).length + dashboardOnly.length;
    const allAttendance = [...rows.map((row) => row.attendance), ...ncRows.map((row) => row.attendance)].sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
    const totalHours = allAttendance.reduce((sum, row) => sum + rowWorkHours(row), 0);
    const km = (result.dailyKilometers || []).find((day) => day.employeeId === employeeId && day.date === date);
    const payrollUnknown = rows.some((row) => row.dashboard?.payrollHoursRequireReview);
    const hoursStatus = payrollUnknown ? 'שעות שכר לבדיקה' : `${totalHours.toFixed(2)} שעות`;
    const kmStatus = km?.calculated == null ? 'לא ניתן לחשב ק״מ' : `${km.reported} ק״מ`;
    return `<details class="attendance-control__employee"><summary><strong>${escapeHtml(name)} | ${escapeHtml(date)} | ${escapeHtml(hoursStatus)} | ${escapeHtml(kmStatus)} | ${gapCount} חריגות</strong><span>${gapCount ? 'לבדיקה' : 'תקין'}</span></summary><div class="attendance-control__employee-summary"><span>שעות נוכחות <b>${attendanceHours.toFixed(2)}</b></span><span>שעות בדשבורד <b>${payrollUnknown ? 'שעות שכר לבדיקה' : dashboardHours.toFixed(2)}</b></span>${km ? `<span>${km.calculated == null ? 'לא ניתן לחשב ק״מ' : `מסלול יומי: דווח <b>${km.reported}</b> ק״מ · חושב <b>${km.calculated}</b>`}</span>` : ''}</div>${details}${missing}</details>`;
  }).join('');

  const days = byEmployee.size;
  const reviewDays = [...byEmployee.keys()].filter((dayKey) => { const bucket = byEmployee.get(dayKey); const dashboardOnly = dashboardOnlyByEmployee.get(dayKey) || []; return bucket.comparisons.some((row) => row.unmatched || row.differences.length) || dashboardOnly.length; }).length;
  const summaryBar = `<div class="attendance-control__summary-bar"><span>מדריכים <b>${totals.employees}</b></span><span>ימים <b>${days}</b></span><span>תקינים <b>${days - reviewDays}</b></span><span>לבדיקה <b>${reviewDays}</b></span></div>`;
  const technicalMetrics = `<div class="attendance-control__metrics"><span>שורות נוכחות <b>${totals.attendanceRows}</b></span><span>שורות להשוואה <b>${totals.comparableAttendanceRows}</b></span><span>דיווחים שאינם נבדקים <b>${totals.notComparedRows}</b></span><span>מפגשי דשבורד (מקור) <b>${totals.dashboardRowsBeforeProcessing}</b></span><span>שורות דשבורד להשוואה <b>${totals.dashboardRows}</b></span><span>התאמות מלאות <b>${totals.fullMatches}</b></span><span>אי־התאמות בשדות <b>${totals.fieldMismatches}</b></span><span>שעות נוכחות <b>${totals.attendanceHours}</b></span><span>שעות שאינן נבדקות <b>${totals.notComparedHours}</b></span><span>סה״כ שעות מדווחות <b>${totals.totalReportedHours}</b></span><span>שעות דשבורד <b>${totals.dashboardHours}</b></span><span>פער ק"מ <b>${totals.km}</b></span><span>פער הוצאות <b>₪${totals.expenses}</b></span></div>`;
  // notCompared rows are now woven into each employee's timeline; no separate section needed.
  return `${summaryBar}<details class="attendance-control__metrics-details"><summary>פירוט הבדיקה</summary>${technicalMetrics}</details>${cards}<button type="button" class="ds-btn ds-btn--primary attendance-control__export" data-attendance-export>ייצוא דוח נוכחות מתוקן</button>`;
}

function openAttendanceControlWindow(api, state) {
  const popup = window.open('', 'dashboard-payroll-control');
  if (!popup) throw new Error('הדפדפן חסם את פתיחת חלון בקרת השכר. יש לאפשר חלונות קופצים ולנסות שוב.');
  popup.document.title = 'בקרת שכר';
  popup.document.documentElement.lang = 'he';
  popup.document.body.innerHTML = `<main data-payroll-window>${attendanceControlStylesHtml()}${attendanceControlHtml()}</main>`;
  popup.document.head.insertAdjacentHTML('beforeend', '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif}.ds-input{box-sizing:border-box;padding:9px;border:1px solid #cbd5e1;border-radius:8px}.ds-btn{padding:9px 14px;border:1px solid #94a3b8;border-radius:8px;background:#fff;cursor:pointer}.ds-btn--primary{background:#2563eb;color:#fff}.ds-btn:disabled{opacity:.55;cursor:not-allowed}</style>');
  const popupRoot = popup.document.querySelector('[data-payroll-window]');
  popupRoot.querySelector('[data-attendance-control]').hidden = false;
  bindAttendanceControl(popupRoot, { api, state, standalone: true });
  popup.focus();
}

export function bindAttendanceControl(root, { api, state = {}, standalone = false } = {}) {
  const panel = root?.querySelector('[data-attendance-control]'); if (!panel) return;
  const monthInput = panel.querySelector('[data-attendance-month]'); const dashboardMonthInput = panel.querySelector('[data-dashboard-month]');
  const teamInput = panel.querySelector('[data-attendance-team]'); const title = panel.querySelector('[data-attendance-title]');
  const run = panel.querySelector('[data-attendance-run]'); const status = panel.querySelector('[data-attendance-status]'); const results = panel.querySelector('[data-attendance-results]');
  let result = null; let employees = null; let teamIds = [];
  const role = txt(state?.user?.role || state?.user?.display_role).toLowerCase();
  const isManager = role === 'manager' || role === 'instructor_manager';
  const canChooseTeam = ['operations_controller', 'system_admin', 'operation_manager', 'admin'].includes(role);
  const update = () => { run.disabled = !employees || !attendanceMonthLabel(monthInput.value) || !attendanceMonthLabel(dashboardMonthInput.value) || !teamInput.value; };
  monthInput.addEventListener('change', update); dashboardMonthInput.addEventListener('change', update); teamInput.addEventListener('change', update);
  root.querySelector('[data-attendance-open]')?.addEventListener('click', () => {
    try { openAttendanceControlWindow(api, state); } catch (error) { window.alert(error.message); }
  });
  panel.querySelector('[data-attendance-close]')?.addEventListener('click', () => standalone ? root.ownerDocument.defaultView.close() : (panel.hidden = true));
  if (standalone) {
    status.textContent = 'טוען את רשימת הצוותים…';
    api?.attendanceControlTeams?.().then((loaded) => {
      employees = loaded;
      const teams = attendanceTeams(employees);
      teamIds = teams.map((team) => team.id);
      const currentEmpId = txt(state?.user?.emp_id || state?.user?.employee_id || state?.user?.user_id);
      const currentEmployee = employees.find((employee) => txt(employee.employeeId || employee.EmployeeId || employee.ID) === currentEmpId);
      const ownTeam = lookupText(currentEmployee?.team || currentEmployee?.Team);
      const options = canChooseTeam ? [{ id: '__all__', managerName: 'כל הצוותים' }, ...teams] : teams.filter((team) => team.id === ownTeam);
      teamInput.innerHTML = `<option value="">בחר צוות</option>${options.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.managerName)}</option>`).join('')}`;
      if (isManager && ownTeam) { teamInput.value = ownTeam; teamInput.disabled = true; }
      else teamInput.disabled = !canChooseTeam;
      status.textContent = options.length ? '' : 'לא נמצא צוות המשויך למשתמש המחובר.';
      update();
    }).catch(() => { status.textContent = 'טעינת נתוני מערכת הנוכחות נכשלה.'; });
  }
  run.addEventListener('click', async () => {
    run.disabled = true; status.textContent = 'טוען את נתוני הנוכחות והדשבורד ומבצע בקרת שכר…';
    try {
      const month = monthInput.value; const dashboardMonth = dashboardMonthInput.value; const monthLabel = attendanceMonthLabel(month);
      if (!monthLabel) throw new Error('יש לבחור חודש לבדיקה לפני ביצוע הבדיקה.');
      const selectedTeam = teamInput.value;
      const records = await api.attendanceControlRecords();
      const attendanceRows = filterAttendanceRowsByMonth(normalizeAttendanceApiRows(records), month)
        .filter((row) => selectedTeam === '__all__' ? teamIds.includes(row.team) : row.team === selectedTeam);
      if (!attendanceRows.length) throw new Error(`לא נמצאו דיווחי נוכחות עבור ${monthLabel}`);
      const dashboardRows = await loadAttendanceDashboardDataset(attendanceRows, api, dashboardMonth);
      result = compareAttendanceRows(attendanceRows, dashboardRows); result.month = month;
      title.textContent = `בקרת שכר – ${monthLabel}`; status.textContent = ''; results.innerHTML = resultsHtml(result, month);
    } catch (error) { status.textContent = error?.message || 'טעינת נתוני בקרת השכר נכשלה.'; results.innerHTML = ''; }
    finally { update(); }
  });
  results.addEventListener('change', (event) => {
    const dashboardOnlyElement = event.target.closest('[data-dashboard-only]');
    if (dashboardOnlyElement && event.target.matches('[data-dashboard-only-choice]') && result) {
      const entry = result.dashboardOnly.find((item) => item.id === dashboardOnlyElement.dataset.dashboardOnly);
      setDashboardOnlyChoice(entry, event.target.value === 'add');
      return;
    }
    const diff = event.target.closest('[data-comparison]'); if (!diff || !result) return;
    const comparison = result.comparisons.find((row) => row.id === diff.dataset.comparison); const field = diff.dataset.field;
    if (event.target.matches('[data-attendance-choice]')) { const custom = diff.querySelector('[data-attendance-custom]'); custom.hidden = event.target.value !== 'custom'; applyAttendanceChoice(comparison, field, event.target.value, custom.value); }
    if (event.target.matches('[data-attendance-custom]')) applyAttendanceChoice(comparison, field, 'custom', event.target.value);
  });
  results.addEventListener('click', (event) => { if (!event.target.closest('[data-attendance-export]') || !result) return; XLSX.writeFile(buildCorrectedAttendanceWorkbook([...result.comparisons, ...(result.notCompared || []), ...result.dashboardOnly], result.dashboardPopulation), attendanceExportFilename(result.month), { compression: true }); });
}
