import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { activityTypeDisplayLabel, isOneDayActivityType, normalizeActivityTypeKey } from './shared/activity-options.js';
import {
  buildPayrollIdentityContext,
  payrollBundleHasContext,
  payrollEntityFieldsEquivalent
} from './payroll-control-identity.js';

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
    .replace(/\s+/g, '');
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
const DAILY_KM_TOLERANCE = 5;

// School-clock time is not payroll time. Only the two unambiguous business cases
// may be converted automatically; unusual timetables stay visible for review.
function dashboardPayrollHours(startTime, endTime) {
  const minutes = calculateWorkHours(startTime, endTime) * 60;
  if (Math.abs(minutes - 45) < 0.01) return 1;
  if (Math.abs(minutes - 90) < 0.01) return 2;
  return null;
}

function timeMinutesValue(value) {
  const match = timeText(value).match(/^(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function formatMinutesAsTime(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function courseExpectedAttendanceTimes(dashboard) {
  if (attendanceActivityTypeKey(dashboard?.activityType) !== 'course') return null;
  const payrollHours = dashboardPayrollHours(dashboard.startTime, dashboard.endTime);
  const end = timeMinutesValue(dashboard.endTime);
  if (payrollHours == null || end == null) return null;
  return { startTime: formatMinutesAsTime(end - payrollHours * 60), endTime: timeText(dashboard.endTime) };
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
      const typeKey = normalizeActivityTypeKey(activityType);
      const explicitMeetings = Array.isArray(activity.meetings);
      const meetingNo = isOneDayActivityType(typeKey)
        ? (explicitMeetings && meeting.meeting_no != null ? txt(meeting.meeting_no) : '')
        : (meeting.meeting_no ?? index + 1);
      const coursePayroll = typeKey === 'course' ? dashboardPayrollHours(startTime, endTime) : calculateWorkHours(startTime, endTime);
      const payrollHoursRequireReview = typeKey === 'course'
        ? coursePayroll == null
        : !(coursePayroll > 0);
      output.push({
        ...instructor, employeeName: instructor.employeeName || txt(contact.full_name), employmentType: txt(contact.employment_type),
        date, startTime, endTime,
        workHours: payrollHoursRequireReview ? null : coursePayroll,
        payrollHoursRequireReview,
        meetingCount: 1, activityType,
        school: txt(activityValue(activity, ['school', 'single_school_name', 'legacy_school'])),
        authority: txt(activityValue(activity, ['authority', 'authority_name'])), program: txt(activityValue(activity, ['activity_name', 'program_name', 'name'])),
        meetingNo, kilometers: null, expenses: null,
        schoolId: activity.school_id == null ? null : Number(activity.school_id),
        authorityId: activity.authority_id == null ? null : Number(activity.authority_id),
        activityNo: txt(activityValue(activity, ['activity_no', 'gefen_number', 'catalog_slug'])),
        activityId: txt(activityValue(activity, ['row_id', 'RowID', 'id']))
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
    expenseDetails: txt(row.expensesDetails || row.ExpensesDetails), notes: txt(row.notes || row.Notes), activityId: '',
    _source: row
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
  rows.__payrollIdentityContext = buildPayrollIdentityContext({
    schoolLookup: sources.schoolLookup || null,
    authorityLookup: sources.authorityLookup || null,
    activities: sources.activities || [],
    proposalGroupAliases: sources.proposalGroupAliases || [],
    dashboardRows: rows
  });
  return rows;
}

function minutesBetween(a, b) {
  const minutes = (v) => { const m = timeText(v).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  return Math.abs(minutes(a) - minutes(b));
}

function attendanceActivityTypeKey(value) {
  return normalizeActivityTypeKey(value);
}

function bundleComponents(row) {
  return row?.componentRows?.length ? row.componentRows : [row];
}

function sameBundleText(attendance, dashboard, key, identityContext = null) {
  if (identityContext && payrollBundleHasContext(attendance, dashboard, identityContext, key)) return true;
  const expected = normalizeAttendanceName(attendance[key]);
  return Boolean(expected) && bundleComponents(dashboard).some((row) => normalizeAttendanceName(row[key]) === expected);
}

function hasActivityIdMatch(attendance, dashboard) {
  const activityId = txt(attendance.activityId);
  return Boolean(activityId) && bundleComponents(dashboard).some((row) => txt(row.activityId) === activityId);
}

export function parseMeetingNumberList(value) {
  return txt(value).split(/[,،\s]+/).map((part) => txt(part)).filter(Boolean);
}

function dashboardMeetingNumbers(dashboard) {
  if (!dashboard) return [];
  const components = bundleComponents(dashboard);
  const numbers = components.flatMap((row) => (
    row.meetingNumbers?.length ? row.meetingNumbers.map((item) => txt(item)) : [txt(row.meetingNo)].filter(Boolean)
  ));
  if (numbers.length) return numbers;
  return parseMeetingNumberList(dashboard.meetingNo);
}

function meetingNumberListsEqual(left = [], right = []) {
  const a = (Array.isArray(left) ? left : parseMeetingNumberList(left)).map((value) => txt(value));
  const b = (Array.isArray(right) ? right : parseMeetingNumberList(right)).map((value) => txt(value));
  return a.length > 0 && a.length === b.length && a.every((value, index) => value === b[index]);
}

function meetingSequenceMatchesAttendance(attendance, dashboard) {
  const expected = parseMeetingNumberList(attendance?.meetingNo);
  if (!expected.length) return false;
  const actual = dashboardMeetingNumbers(dashboard);
  if (!actual.length) return false;
  if (meetingNumberListsEqual(expected, actual)) return true;
  if (actual.length < expected.length) return false;
  for (let index = 0; index <= actual.length - expected.length; index += 1) {
    if (meetingNumberListsEqual(expected, actual.slice(index, index + expected.length))) return true;
  }
  return false;
}

function hasMeetingNoMatch(attendance, dashboard) {
  return meetingSequenceMatchesAttendance(attendance, dashboard);
}

function sameActivityBundleContext(attendance, dashboard, identityContext = null) {
  if (hasActivityIdMatch(attendance, dashboard)) return true;
  const components = bundleComponents(dashboard);
  const attendanceActivityId = txt(attendance.activityId);
  if (attendanceActivityId && components.some((row) => txt(row.activityId) && txt(row.activityId) !== attendanceActivityId)) return false;
  const schools = new Set(components.map((row) => normalizeAttendanceName(row.school)).filter(Boolean));
  const programs = new Set(components.map((row) => normalizeAttendanceName(row.program)).filter(Boolean));
  if (schools.size > 1 || programs.size > 1) return false;
  return sameBundleText(attendance, dashboard, 'school', identityContext)
    || sameBundleText(attendance, dashboard, 'program', identityContext);
}

function bundleMatchesAttendanceMeetings(attendance, dashboard, identityContext = null) {
  if (!txt(attendance.meetingNo)) return true;
  if (!meetingSequenceMatchesAttendance(attendance, dashboard)) {
    // For a single-row bundle, a meeting-number mismatch surfaces as a difference rather than
    // blocking the match entirely.  For multi-row sequences the whole bundle is rejected.
    return bundleComponents(dashboard).length === 1;
  }
  if (!sameActivityBundleContext(attendance, dashboard, identityContext)) return false;
  const attendanceHours = rowWorkHours(attendance);
  const dashboardHours = rowWorkHours(dashboard);
  if (attendanceHours == null || dashboardHours == null) return true;
  // Allow up to 30 minutes of payroll-rounding difference (e.g. 90 min → 2 payroll hours).
  return Math.abs(attendanceHours - dashboardHours) <= 0.5;
}

function componentHasContext(attendance, dashboard, identityContext = null) {
  if (hasActivityIdMatch(attendance, dashboard)) return true;
  if (hasMeetingNoMatch(attendance, dashboard) && (sameBundleText(attendance, dashboard, 'school', identityContext) || sameBundleText(attendance, dashboard, 'program', identityContext))) return true;
  return sameBundleText(attendance, dashboard, 'school', identityContext) || sameBundleText(attendance, dashboard, 'program', identityContext);
}

function matchScore(attendance, dashboard, identityContext = null) {
  if (hasActivityIdMatch(attendance, dashboard)) return { score: 100, context: 100, time: 0, hours: 0, identity: 'activityId' };
  const sameText = (key) => sameBundleText(attendance, dashboard, key, identityContext);
  const timePoints = (key) => {
    if (!timeText(attendance[key]) || !timeText(dashboard[key])) return 0;
    return Math.max(0, 20 - Math.min(20, minutesBetween(attendance[key], dashboard[key]) / 3));
  };
  const sameActivityType = Boolean(attendanceActivityTypeKey(attendance.activityType))
    && bundleComponents(dashboard).some((row) => attendanceActivityTypeKey(row.activityType) === attendanceActivityTypeKey(attendance.activityType));
  const meetingIdentity = hasMeetingNoMatch(attendance, dashboard) ? 40 : 0;
  const context = meetingIdentity + (sameText('school') ? 30 : 0) + (sameText('authority') ? 10 : 0)
    + (sameText('program') ? 25 : 0) + (sameActivityType ? 15 : 0);
  const time = timePoints('startTime') + timePoints('endTime');
  const attendanceHours = rowWorkHours(attendance);
  const dashboardHours = rowWorkHours(dashboard);
  const hourDifference = attendanceHours == null || dashboardHours == null ? 0 : Math.abs(attendanceHours - dashboardHours);
  const hours = Math.max(0, 20 - Math.min(20, hourDifference * 8));
  const identity = meetingIdentity ? 'meeting' : '';
  return { score: context + time + hours, context, time, hours, identity };
}

function acceptableMatch(match, attendance, dashboard, identityContext = null) {
  if (match.identity === 'activityId') return true;
  const attendanceType = attendanceActivityTypeKey(attendance.activityType);
  const dashboardType = bundleComponents(dashboard).map((row) => attendanceActivityTypeKey(row.activityType)).find(Boolean) || '';
  if (attendanceType && dashboardType && attendanceType !== dashboardType) return false;
  if (match.identity === 'meeting' && (sameBundleText(attendance, dashboard, 'school', identityContext) || sameBundleText(attendance, dashboard, 'program', identityContext))) return true;
  return match.score >= 55 && (sameBundleText(attendance, dashboard, 'school', identityContext) || sameBundleText(attendance, dashboard, 'program', identityContext));
}

function matchIsUnambiguous(match, attendance, dashboard, identityContext = null) {
  if (!match || !dashboard) return false;
  if (match.identity === 'activityId') return true;
  if (match.identity === 'meeting' && acceptableMatch(match, attendance, dashboard, identityContext)) return true;
  return acceptableMatch(match, attendance, dashboard, identityContext) && match.score >= 70;
}

function comparable(type, value) {
  if (type === 'number' || type === 'money') return optionalNumber(value) ?? '__missing__';
  if (type === 'time') return timeText(value);
  if (type === 'activityType') return attendanceActivityTypeKey(value);
  return normalizeAttendanceName(value);
}

export function rowWorkHours(row) {
  if (row?.payrollHoursRequireReview) return null;
  const hours = optionalNumber(row?.workHours);
  if (hours != null) return hours;
  const calculated = calculateWorkHours(row?.startTime, row?.endTime);
  return calculated > 0 ? calculated : null;
}

function displayWorkHours(row) {
  const hours = rowWorkHours(row);
  if (hours == null) return '—';
  return hours.toFixed(2);
}

function displayDashboardWorkHours(dashboard) {
  if (!dashboard) return '—';
  const hours = rowWorkHours(dashboard);
  if (hours != null) return hours.toFixed(2);
  if (dashboard.payrollHoursRequireReview) return 'לא ניתן לחשב';
  return '—';
}

function hasReviewExpense(row) {
  return number(row?.expenses) > 0;
}

export function attendanceEntryIsResolved(entry) {
  if (!entry || entry.source === 'dashboard_only') return true;
  if (entry.managerResolved === 'approved_as_reported' || entry.managerResolved === 'corrected' || entry.managerResolved === 'auto_ok') return true;
  if (entry.unmatched || entry.source === 'attendance_not_compared') return false;
  if ((entry.differences || []).length > 0) return false;
  if (entry.dashboard?.payrollHoursRequireReview) return false;
  if (hasReviewExpense(entry.attendance)) return false;
  // No pending differences, no special requirements, and not unmatched → resolved.
  // (unmatched entries are caught above by the entry.unmatched check.)
  return true;
}

/**
 * Returns true when a daily-km entry has an unresolved issue that blocks approval.
 * An issue exists when: calculated is null and attendance reported km,
 * or calculated is known but the reported total differs by more than the tolerance.
 */
export function kmDayNeedsDecision(day) {
  if (!day) return false;
  if (day.managerResolved === 'auto_ok' || day.managerResolved === 'approved_as_reported' || day.managerResolved === 'corrected') return false;
  if (day.calculated == null) return Boolean(day.hasReportedKm);
  return day.hasReportedKm !== false && !day.matches;
}

/**
 * Record the manager's decision for a daily km entry.
 * resolution: 'approved_as_reported' | 'corrected'
 * correctedKm: required when resolution === 'corrected'; the total km for the day.
 */
export function resolveKilometersDay(result, employeeId, date, resolution, correctedKm = null) {
  const id = txt(employeeId);
  const day = (result?.dailyKilometers || []).find((d) => txt(d.employeeId) === id && d.date === date);
  if (!day) return;
  day.managerResolved = resolution;
  if (resolution === 'corrected' && correctedKm != null) day.correctedKm = correctedKm;
}

export function approveAttendanceEntryAsReported(entry) {
  if (!entry?.attendance) return entry;
  entry.final = {
    ...entry.attendance,
    workHours: rowWorkHours(entry.attendance) ?? optionalNumber(entry.attendance.workHours)
  };
  entry.managerResolved = 'approved_as_reported';
  return entry;
}

export function applyAttendanceManualCorrection(entry, changes = {}) {
  if (!entry?.attendance) return entry;
  entry.final = {
    ...entry.attendance,
    ...changes,
    workHours: changes.workHours ?? rowWorkHours({ ...entry.attendance, ...changes }) ?? optionalNumber(entry.attendance.workHours)
  };
  entry.managerResolved = 'corrected';
  return entry;
}

function dashboardBundle(rows) {
  const ordered = [...rows].sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
  const unique = (key) => [...new Set(ordered.map((row) => txt(row[key])).filter(Boolean))];
  const meetingNumbers = ordered.flatMap((row) => row.meetingNumbers?.length ? row.meetingNumbers : [txt(row.meetingNo)].filter(Boolean));
  const activityIds = unique('activityId');
  const distinctMeetings = [...new Set(meetingNumbers)];
  const meetingNo = activityIds.length > 1 && distinctMeetings.length !== 1 ? '' : (distinctMeetings.length === 1 ? distinctMeetings[0] : meetingNumbers.join(', '));
  const joined = (key) => unique(key).join(' + ');
  const schoolIds = [...new Set(ordered.map((row) => row.schoolId).filter(Number.isFinite))];
  const authorityIds = [...new Set(ordered.map((row) => row.authorityId).filter(Number.isFinite))];
  const activityNos = [...new Set(ordered.map((row) => txt(row.activityNo)).filter(Boolean))];
  return {
    ...ordered[0], componentRows: ordered, activityIds, activityId: activityIds.join(' + '),
    startTime: ordered.map((row) => timeText(row.startTime)).filter(Boolean).sort()[0] || '',
    endTime: ordered.map((row) => timeText(row.endTime)).filter(Boolean).sort().at(-1) || '',
    workHours: ordered.some((row) => row.payrollHoursRequireReview) ? null : Math.round(ordered.reduce((sum, row) => sum + rowWorkHours(row), 0) * 100) / 100,
    payrollHoursRequireReview: ordered.some((row) => row.payrollHoursRequireReview),
    meetingCount: ordered.reduce((sum, row) => sum + (number(row.meetingCount) || 1), 0),
    meetingNumbers: distinctMeetings.length === 1 ? distinctMeetings : (activityIds.length > 1 ? [] : meetingNumbers),
    meetingNo,
    school: joined('school'), authority: joined('authority'), program: joined('program'), activityType: joined('activityType'),
    schoolId: schoolIds.length === 1 ? schoolIds[0] : null,
    authorityId: authorityIds.length === 1 ? authorityIds[0] : null,
    activityNo: activityNos.length === 1 ? activityNos[0] : null
  };
}

function assignDashboardBundles(attendanceEntries, dashboardRows, identityContext = null) {
  const orderedDashboard = [...dashboardRows].sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
  const candidates = attendanceEntries.map(({ attendance }) => {
    const rows = [];
    let eligible = orderedDashboard
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => componentHasContext(attendance, row, identityContext));
    if (txt(attendance.meetingNo)) {
      const expectedMeetings = parseMeetingNumberList(attendance.meetingNo);
      const meetingRows = eligible.filter(({ row }) => {
        const numbers = dashboardMeetingNumbers(row);
        return expectedMeetings.some((meetingNo) => numbers.includes(meetingNo));
      });
      if (meetingRows.length) eligible = meetingRows;
    }
    for (let eligibleStart = 0; eligibleStart < eligible.length; eligibleStart += 1) {
      for (let eligibleEnd = eligibleStart; eligibleEnd < eligible.length; eligibleEnd += 1) {
        const selected = eligible.slice(eligibleStart, eligibleEnd + 1);
        const componentRows = selected.map(({ row }) => row);
        const activityIds = new Set(componentRows.map((row) => txt(row.activityId)).filter(Boolean));
        if (activityIds.size > 1) {
          // Multi-row bundle: require proof that all rows belong to the same logical activity.
          // Rows with conflicting activityNos are definitively different activities.
          const activityNos = new Set(componentRows.map((row) => txt(row.activityNo)).filter(Boolean));
          if (activityNos.size > 1) continue;
          // Without conflicting activityNos, all component rows must share the same school AND
          // program — the strongest available proxy for "same logical activity" when activityNo
          // is absent.  (bundle is not yet computed here, so check componentRows directly.)
          const bundleSchools = new Set(componentRows.map((row) => normalizeAttendanceName(row.school)).filter(Boolean));
          const bundlePrograms = new Set(componentRows.map((row) => normalizeAttendanceName(row.program)).filter(Boolean));
          if (bundleSchools.size > 1 || bundlePrograms.size > 1) continue;
          // Attendance must relate to the bundle's shared school or program context.
          const attSchool = normalizeAttendanceName(attendance.school);
          const attProgram = normalizeAttendanceName(attendance.program);
          if ((!attSchool || !bundleSchools.has(attSchool)) && (!attProgram || !bundlePrograms.has(attProgram))) continue;
        }
        if (txt(attendance.activityId) && activityIds.size && !activityIds.has(txt(attendance.activityId))) continue;
        const start = selected[0].index; const end = selected.at(-1).index;
        const bundle = dashboardBundle(componentRows);
        if (!bundleMatchesAttendanceMeetings(attendance, bundle, identityContext)) continue;
        const match = matchScore(attendance, bundle, identityContext);
        if (acceptableMatch(match, attendance, bundle, identityContext)) rows.push({ bundle, componentRows, start, end, ...match });
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

export function compareAttendanceRows(attendanceRows, dashboardRows, options = {}) {
  const identityContext = options.identityContext
    || dashboardRows?.__payrollIdentityContext
    || buildPayrollIdentityContext({ dashboardRows: dashboardRows || [] });
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
    const dayDashboard = (buckets.get(key) || []).filter((row) => !row.__profile);
    orderedEntries.forEach(({ attendance, attendanceIndex }) => {
      const activityId = txt(attendance.activityId);
      if (!activityId || assignments.has(attendanceIndex)) return;
      const candidate = dayDashboard.find((row) => !used.has(row) && txt(row.activityId) === activityId);
      if (!candidate) return;
      assignments.set(attendanceIndex, { bundle: candidate, componentRows: [candidate], score: 100, identity: 'activityId' });
      used.add(candidate);
    });
    const dayAssignments = assignDashboardBundles(orderedEntries.filter(({ attendanceIndex }) => !assignments.has(attendanceIndex)), dayDashboard.filter((row) => !used.has(row)), identityContext);
    let assignCursor = 0;
    orderedEntries.forEach(({ attendanceIndex }) => {
      if (assignments.has(attendanceIndex)) return;
      const match = dayAssignments[assignCursor++];
      if (!match) return;
      assignments.set(attendanceIndex, match);
      match.componentRows.forEach((row) => used.add(row));
    });
  });
  const aggregateUseCount = new Map();
  assignments.forEach((match) => match.componentRows.forEach((row) => aggregateUseCount.set(row, (aggregateUseCount.get(row) || 0) + 1)));
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    if (assignments.has(attendanceIndex)) return;
    const key = `${txt(attendance.employeeId)}|${attendance.date}`;
    const candidate = (buckets.get(key) || []).filter((row) => !row.__profile && number(row.meetingCount) > 1 && number(row.meetingCount) > (aggregateUseCount.get(row) || 0))
      .map((row) => ({ row, match: matchScore(attendance, row, identityContext) })).filter(({ row, match }) => acceptableMatch(match, attendance, row, identityContext))
      .sort((a, b) => b.match.score - a.match.score)[0];
    if (!candidate) return;
    const share = { ...candidate.row, meetingCount: 1, workHours: candidate.row.payrollHoursRequireReview ? null : Math.round((rowWorkHours(candidate.row) ?? 0) / number(candidate.row.meetingCount) * 100) / 100 };
    assignments.set(attendanceIndex, { bundle: share, componentRows: [candidate.row], score: candidate.match.score, sharedAggregate: true });
    aggregateUseCount.set(candidate.row, (aggregateUseCount.get(candidate.row) || 0) + 1);
    used.add(candidate.row);
  });
  const toMinutes = (v) => { const m = timeText(v).match(/^(\d{2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const comparisons = comparableAttendance.map((attendance, attendanceIndex) => {
    const match = assignments.get(attendanceIndex); const dashboard = match?.bundle || null;
    const final = { ...attendance, workHours: rowWorkHours(attendance) ?? optionalNumber(attendance.workHours) };
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
        const expected = courseExpectedAttendanceTimes(dashboard);
        if (expected && timeText(attendance.startTime) === expected.startTime && timeText(attendance.endTime) === expected.endTime) return [];
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
      if (key === 'meetingNo' && meetingNumberListsEqual(parseMeetingNumberList(attendance.meetingNo), dashboardMeetingNumbers(dashboard))) return [];
      if (['school', 'authority', 'program'].includes(key) && payrollEntityFieldsEquivalent(
        key,
        attendance,
        dashboard,
        identityContext,
        { matchUnambiguous: matchIsUnambiguous(match, attendance, dashboard, identityContext) }
      )) return [];
      return [{ key, label, type, attendance: attendanceValue, dashboard: dashboardValue, choice: 'attendance', custom: '' }];
    }) : [];
    const autoOk = dashboard
      && !differences.length
      && !dashboard.payrollHoursRequireReview
      && !hasReviewExpense(attendance);
    return {
      id: `row-${attendanceIndex}`, attendance, dashboard, final, differences,
      unmatched: !dashboard, matchScore: match?.score ?? null,
      managerResolved: autoOk ? 'auto_ok' : null
    };
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
    const hasReportedKm = attendance.some((row) => optionalNumber(row.kilometers) != null);
    const matches = calculated != null && (!hasReportedKm || Math.abs(reported - calculated) <= DAILY_KM_TOLERANCE);
    const kmIssue = calculated == null ? Boolean(hasReportedKm) : (hasReportedKm !== false && !matches);
    dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: kmIssue ? null : 'auto_ok' });
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
  difference.choice = choice; difference.custom = custom; difference.decided = true;
  const value = choice === 'dashboard' ? difference.dashboard : choice === 'custom' ? custom : difference.attendance;
  comparison.final[field] = difference.type === 'number' || difference.type === 'money' ? optionalNumber(value) : value;
  // Only mark as corrected once every difference has received an explicit manager decision.
  if (comparison.differences.every((d) => d.decided)) comparison.managerResolved = 'corrected';
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

function mergeFinalIntoSource(final, source) {
  if (!source || typeof source !== 'object') {
    return { ...final, workHours: rowWorkHours(final) ?? optionalNumber(final.workHours) };
  }
  const merged = { ...source };
  const assign = (keys, value) => {
    if (value == null || value === '') return;
    for (const key of keys) {
      if (Object.hasOwn(source, key)) { merged[key] = value; return; }
    }
  };
  assign(['startTime', 'StartTime', 'start'], final.startTime);
  assign(['endTime', 'EndTime', 'end'], final.endTime);
  assign(['workHours', 'WorkHours', 'hours'], rowWorkHours(final) ?? optionalNumber(final.workHours));
  assign(['activityType', 'ActivityType', 'activity'], final.activityType);
  assign(['schoolName', 'SchoolName', 'school'], final.school);
  assign(['municipality', 'Municipality', 'authority'], final.authority);
  assign(['programName', 'ProgramName', 'program'], final.program);
  assign(['sessionNumber', 'SessionNumber', 'session'], final.meetingNo);
  assign(['kilometers', 'Kilometers', 'km'], final.kilometers);
  assign(['totalExpenses', 'TotalExpenses', 'expenses'], final.expenses);
  assign(['expensesDetails', 'ExpensesDetails', 'expenseDetails'], final.expenseDetails);
  assign(['notes', 'Notes'], final.notes);
  assign(['ID', 'Id', 'id', 'activityId'], final.activityId);
  if (final.employmentType) assign(['employmentType', 'EmploymentType'], final.employmentType);
  return merged;
}

function isOriginalAttendanceSource(row) {
  return Boolean(row && typeof row === 'object' && (
    Object.hasOwn(row, 'attendanceDate') || Object.hasOwn(row, 'AttendanceDate')
    || Object.hasOwn(row, 'attachmentsNames') || Object.hasOwn(row, 'MonthApproved')
    || Object.hasOwn(row, 'approvedBy') || Object.hasOwn(row, 'approvedDate')
    || Object.hasOwn(row, 'status') || Object.hasOwn(row, 'סוג פריט') || Object.hasOwn(row, 'נתיב')
  ));
}

function sourceDetailSheet(mergedRows) {
  const headers = [];
  const seen = new Set();
  for (const row of mergedRows) {
    for (const key of Object.keys(row || {})) {
      if (key === '_source' || seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }
  const data = mergedRows.map((row) => headers.map((key) => {
    let value = row?.[key];
    if (key === 'workHours' || key === 'WorkHours' || key === 'hours') {
      return rowWorkHours(row) ?? optionalNumber(value) ?? '';
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) return lookupText(value);
    return value ?? '';
  }));
  return styledSheet(headers, data);
}

function detailRowValues(row) {
  return [
    txt(row.employeeId || row.EmployeeId || row.empNum), txt(row.employeeName || row.EmployeeName || row.empName),
    excelDate(row.date || row.attendanceDate || row.AttendanceDate), timeText(row.startTime || row.StartTime),
    timeText(row.endTime || row.EndTime), rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours) ?? '',
    lookupText(row.activityType || row.ActivityType), txt(row.school || row.schoolName || row.SchoolName),
    txt(row.authority || row.municipality || row.Municipality), txt(row.program || row.programName || row.ProgramName),
    txt(row.meetingNo || row.sessionNumber || row.SessionNumber), optionalNumber(row.kilometers ?? row.Kilometers) ?? '',
    optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) ?? '',
    txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails), txt(row.notes || row.Notes)
  ];
}

export function buildCorrectedAttendanceWorkbook(comparisons, dashboardRows = [], options = {}) {
  const employment = new Map((dashboardRows || []).map((row) => [txt(row.employeeId), txt(row.employmentType)]));
  const entries = (comparisons || []).filter((entry) => entry.source !== 'dashboard_only');
  const mergedRows = entries.map((entry) => {
    const final = { ...(entry.final || {}), employmentType: employment.get(txt(entry.final?.employeeId)) || txt(entry.final?.employmentType) };
    const source = entry.attendance?._source || entry.final?._source || null;
    return mergeFinalIntoSource(final, source);
  });
  const detailSheet = mergedRows.some(isOriginalAttendanceSource)
    ? sourceDetailSheet(mergedRows)
    : styledSheet(DETAIL_HEADERS, mergedRows.map(detailRowValues));
  const monthlyMap = new Map();
  mergedRows.filter((row) => normalizeAttendanceName(lookupText(row.employmentType || row.EmploymentType)).includes(normalizeAttendanceName('תעשיידע'))).forEach((row) => {
    const key = txt(row.employeeId || row.EmployeeId); if (!monthlyMap.has(key)) monthlyMap.set(key, { name: txt(row.employeeName || row.EmployeeName), id: key, hours: Array(8).fill(0), km: 0, expenses: 0, details: [] });
    const item = monthlyMap.get(key); const hours = rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours) ?? 0;
    const bucket = activityBucket(lookupText(row.activityType || row.ActivityType)); if (bucket >= 0) item.hours[bucket] += hours;
    item.km += optionalNumber(row.kilometers ?? row.Kilometers) || 0; item.expenses += optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) || 0;
    const details = txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails); if (details) item.details.push(details);
  });
  const monthly = [...monthlyMap.values()].map((item) => [item.name, item.id, ...item.hours.map((v) => Math.round(v * 100) / 100), item.km, item.expenses, [...new Set(item.details)].join('; ')]);
  const daily = mergedRows.filter((row) => normalizeAttendanceName(lookupText(row.employmentType || row.EmploymentType)).includes(normalizeAttendanceName('כוח אדם'))).map((row) => [
    excelDate(row.date || row.attendanceDate || row.AttendanceDate), txt(row.employeeName || row.EmployeeName), txt(row.employeeId || row.EmployeeId),
    lookupText(row.activityType || row.ActivityType), txt(row.authority || row.municipality || row.Municipality),
    timeText(row.startTime || row.StartTime), timeText(row.endTime || row.EndTime),
    rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours) ?? '',
    optionalNumber(row.kilometers ?? row.Kilometers) ?? '', optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) ?? '',
    txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails)
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'פירוט מלא');
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
  const different = new Set(mismatchedComparisons.map((c) => c.attendance.employeeId));
  const sum = (key) => result.comparisons.reduce((total, c) => {
    const attendance = optionalNumber(c.attendance[key]); const dashboard = optionalNumber(c.dashboard?.[key]);
    return attendance == null || dashboard == null ? total : total + Math.abs(attendance - dashboard);
  }, 0);
  const attendanceHours = result.comparisons.reduce((total, c) => total + (rowWorkHours(c.attendance) ?? 0), 0);
  const notComparedHours = (result.notCompared || []).reduce((total, c) => total + (rowWorkHours(c.attendance) ?? 0), 0);
  const dashboardHours = (result.dashboardPopulation || []).filter((row) => !row.__profile).reduce((total, row) => total + (rowWorkHours(row) ?? 0), 0);
  return {
    employees: employees.size, different: different.size,
    attendanceRows: result.comparisons.length + (result.notCompared || []).length,
    comparableAttendanceRows: result.comparisons.length, notComparedRows: (result.notCompared || []).length,
    dashboardRowsBeforeProcessing: result.dashboardPopulation?.sourceRowCount ?? (result.dashboardPopulation || []).filter((row) => !row.__profile).length,
    dashboardRows: (result.dashboardPopulation || []).filter((row) => !row.__profile).length,
    fullMatches: matched.length - fieldMismatches.length, fieldMismatches: fieldMismatches.length,
    unmatchedAttendance: unmatchedAttendance.length, unmatchedDashboard: 0,
    exceptions: mismatchedComparisons.length,
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
.attendance-control__employee{margin:10px 0;border-bottom:1px solid #d7e0ea}.attendance-control__employee>summary{padding:12px 4px;cursor:pointer;font-size:1.05em}.attendance-control__employee-days{padding:0 4px 10px}.attendance-control__employee-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 4px 8px}.attendance-control__approved{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 4px 8px;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:8px;color:#166534;font-weight:700}.attendance-control__approve-dialog{border:0;border-radius:12px;padding:20px;max-width:480px;color:#1f2a37}.attendance-control__approve-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}.attendance-control__manager-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0}.attendance-control__resolved-note{margin:8px 0;color:#166534;font-weight:700}.attendance-control__report-km{margin:4px 0 8px;color:#475569;font-size:.92em}
.attendance-control__day{border-top:1px solid #e2e8f0}.attendance-control__day>summary{display:grid;grid-template-columns:110px 110px 80px;gap:12px;align-items:center;padding:10px 2px;cursor:pointer}.attendance-control__reports{padding:0 10px 8px}.attendance-control__report{padding:12px 8px;border-top:1px solid rgba(37,99,235,.16);background:rgba(37,99,235,.025)}.attendance-control__report:first-child{border-top:0}.attendance-control__report-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.attendance-control__report-line strong{font-size:1em}.attendance-control__row-status{font-weight:800;white-space:nowrap;color:#24824d}.attendance-control__row-status--issue,.attendance-control__field-value--issue{color:#c62828!important}.attendance-control__identity{padding:5px 0 8px;color:#475569;font-size:.92em}.attendance-control__comparison-table{width:100%;border-collapse:collapse;margin:3px 0 8px}.attendance-control__comparison-table th,.attendance-control__comparison-table td{padding:7px 9px;text-align:right;border-bottom:1px solid #e2e8f0}.attendance-control__comparison-table th{color:#5f6f82;font-size:.86em}.attendance-control__comparison-table select,.attendance-control__comparison-table input{max-width:145px}.attendance-control__manual-table{width:auto;min-width:min(100%,520px)}.attendance-control__missing-match{margin:5px 0;color:#c62828;font-weight:800}.attendance-control__day-km{padding:0 10px 6px;color:#475569;font-size:.92em}.attendance-control__manual-note{margin:0 0 6px;color:#475569;font-size:.92em}.attendance-control__export{margin-top:14px}@media(max-width:800px){.attendance-control__comparison-table{font-size:.9em}}
@media(max-width:850px){.attendance-control__diff{grid-template-columns:1fr 1fr}.attendance-control__diff strong{grid-column:1/-1}.attendance-control__diff--header{display:none}[data-src-label]::before{content:attr(data-src-label)": ";font-weight:700;font-size:.8em;display:block;color:#5f6f82;margin-bottom:2px}}
</style>`;
}

export function resultsHtml(result, month = '', options = {}) {
  const totals = attendanceAuditSummary(result);
  const employees = new Map();
  const ensureEmployee = (id, name = '') => {
    const key = txt(id);
    if (!employees.has(key)) employees.set(key, { id: key, name: txt(name) || key, days: new Map() });
    if (name) employees.get(key).name = txt(name);
    return employees.get(key);
  };
  const addRow = (id, name, date, time, kind, item) => {
    const employee = ensureEmployee(id, name);
    if (!employee.days.has(date)) employee.days.set(date, []);
    employee.days.get(date).push({ kind, time: txt(time), item, employeeId: txt(id), date });
  };
  (result.comparisons || []).forEach((item) => addRow(item.attendance.employeeId, item.attendance.employeeName, item.attendance.date, item.attendance.startTime, 'comparison', item));
  (result.notCompared || []).forEach((item) => addRow(item.attendance.employeeId, item.attendance.employeeName, item.attendance.date, item.attendance.startTime, 'attendance', item));

  const dateLabel = (value) => {
    const match = txt(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : txt(value);
  };
  const shown = (value, fallback = '—') => escapeHtml(txt(value) || fallback);
  const hasValue = (value) => value != null && txt(value) !== '';
  const dayKmMap = new Map((result.dailyKilometers || []).map((day) => [`${txt(day.employeeId)}|${day.date}`, day]));
  const dayKmInfo = (employeeId, date) => dayKmMap.get(`${txt(employeeId)}|${date}`) || null;
  const dayKmIssue = (employeeId, date) => {
    const day = dayKmInfo(employeeId, date);
    if (!day) return false;
    if (day.managerResolved === 'auto_ok' || day.managerResolved === 'approved_as_reported' || day.managerResolved === 'corrected') return false;
    if (day.calculated == null) return Boolean(day.hasReportedKm);
    return day.hasReportedKm !== false && !day.matches;
  };
  const comparisonHasIssue = (comparison) => !attendanceEntryIsResolved(comparison);
  const entryResolvedLabel = (entry) => {
    if (entry.managerResolved === 'approved_as_reported') return 'אושר כפי שדווח';
    if (entry.managerResolved === 'corrected') return 'תוקן על ידי המנהל';
    return '';
  };
  const dayKmLineForReport = (employeeId, date) => {
    const km = dayKmInfo(employeeId, date);
    if (!km) return '';
    const reportedKm = km.hasReportedKm === false || (km.hasReportedKm !== true && optionalNumber(km.reported) == null)
      ? '—'
      : shown(km.reported ?? 0);
    const calculatedKm = km.calculated == null ? 'לא ניתן לחשב' : shown(km.calculated);
    const kmStatus = km.calculated == null ? 'לא ניתן לחשב ק״מ' : (km.matches ? 'תקין' : 'לבדיקה');
    const kmAction = kmDayNeedsDecision(km)
      ? ` <button type="button" class="ds-btn ds-btn--sm" data-km-approve-reported="${escapeHtml(txt(km.employeeId))}|${escapeHtml(km.date)}">אשר ק״מ כפי שדווח</button>`
      : (km.managerResolved === 'approved_as_reported' ? ' <span class="attendance-control__resolved-note">ק״מ אושר כמדווח</span>' : '');
    return `<div class="attendance-control__report-km">ק״מ ליום: ${reportedKm} מדווח | ${calculatedKm} מחושב | ${kmStatus}${kmAction}</div>`;
  };
  const managerActionsHtml = (entry) => {
    const resolvedLabel = entryResolvedLabel(entry);
    if (resolvedLabel) return `<p class="attendance-control__resolved-note">${escapeHtml(resolvedLabel)}</p>`;
    const needsHoursFix = entry.unmatched || entry.source === 'attendance_not_compared' || entry.dashboard?.payrollHoursRequireReview;
    return `<div class="attendance-control__manager-actions">
      <button type="button" class="ds-btn ds-btn--sm" data-attendance-approve-reported="${escapeHtml(entry.id)}">אשר כפי שדווח</button>
      ${needsHoursFix ? `<input class="ds-input ds-input--sm" data-attendance-correct-hours="${escapeHtml(entry.id)}" placeholder="שעות שכר מתוקנות" aria-label="שעות שכר מתוקנות"><button type="button" class="ds-btn ds-btn--sm" data-attendance-save-correction="${escapeHtml(entry.id)}">שמור תיקון</button>` : ''}
    </div>`;
  };
  const identityHtml = (row) => {
    const fields = [activityTypeDisplayLabel(row.activityType), row.program, row.school, row.authority, hasValue(row.meetingNo) ? `מפגש ${row.meetingNo}` : ''].filter(hasValue);
    return fields.length ? `<div class="attendance-control__identity">${fields.map(shown).join(' | ')}</div>` : '';
  };
  const manualReportTable = (row, { cancellation = false } = {}) => {
    const fields = [
      ['שעות שכר', displayWorkHours(row)], ['ק״מ', row.kilometers], ['הוצאות', row.expenses],
      ['פירוט הוצאה', row.expenseDetails], ['הערות', row.notes]
    ].filter(([, value]) => hasValue(value));
    const note = cancellation ? '<p class="attendance-control__manual-note">נשמר ברצף יום העבודה</p>' : '';
    return `${note}<table class="attendance-control__comparison-table attendance-control__manual-table"><tbody>${fields.map(([label, value]) => `<tr><th>${label}</th><td>${shown(value)}</td></tr>`).join('')}</tbody></table>`;
  };
  const comparisonTable = (comparison) => {
    const attendance = comparison.attendance || {};
    const dashboard = comparison.dashboard || null;
    const diffByKey = new Map((comparison.differences || []).map((diff) => [diff.key, diff]));
    const payrollReview = dashboard?.payrollHoursRequireReview;
    const dashboardWorkHoursHelp = payrollReview && displayDashboardWorkHours(dashboard) === 'לא ניתן לחשב'
      ? '<span class="attendance-control__manual-note">משך פעילות שאינו תואם כלל שכר מוגדר</span>'
      : '';
    const definitions = [
      ['workHours', payrollReview ? 'שעות שכר לבדיקה' : 'שעות שכר', displayWorkHours(attendance), dashboard ? displayDashboardWorkHours(dashboard) : null],
      ['activityType', 'סוג פעילות', activityTypeDisplayLabel(attendance.activityType), dashboard ? activityTypeDisplayLabel(dashboard.activityType) : null],
      ['activityHours', 'שעות פעילות', `${attendance.startTime || '—'}–${attendance.endTime || '—'}`, dashboard ? `${dashboard.startTime || '—'}–${dashboard.endTime || '—'}` : null],
      ['school', 'בית ספר', attendance.school, dashboard?.school],
      ['program', 'שם תכנית', attendance.program, dashboard?.program],
      ['expenses', 'הוצאות', attendance.expenses, dashboard?.expenses], ['meetingNo', 'מספר מפגש', attendance.meetingNo, dashboard?.meetingNo]
    ];
    const rows = definitions.filter(([key, , left, right]) => ['workHours', 'activityType', 'activityHours'].includes(key) || hasValue(left) || hasValue(right)).map(([key, label, left, right]) => {
      const related = key === 'activityHours' ? ['startTime', 'endTime'].map((field) => diffByKey.get(field)).find(Boolean) : diffByKey.get(key);
      const issue = Boolean(related) || (key === 'workHours' && payrollReview) || (key === 'expenses' && hasReviewExpense(attendance));
      const unavailable = !dashboard;
      const controls = related && !unavailable ? `<select class="ds-input ds-input--sm" data-attendance-choice aria-label="החלטה עבור ${escapeHtml(label)}"><option value="attendance">נתון הנוכחות</option><option value="dashboard">נתון הדשבורד</option><option value="custom">ערך אחר</option></select><input class="ds-input ds-input--sm" data-attendance-custom hidden aria-label="ערך אחר">` : '';
      const status = unavailable ? '⚠ לא נמצאה פעילות תואמת' : issue ? '⚠ לבדיקה' : 'תקין';
      return `<tr${related ? ` data-comparison="${comparison.id}" data-field="${related.key}"` : ''}><th>${escapeHtml(label)}</th><td>${shown(left)}</td><td class="${issue || unavailable ? 'attendance-control__field-value--issue' : ''}">${unavailable ? 'לא נמצאה התאמה' : shown(right)}${key === 'workHours' ? dashboardWorkHoursHelp : ''}</td><td class="attendance-control__row-status ${issue || unavailable ? 'attendance-control__row-status--issue' : ''}">${status}${controls}</td></tr>`;
    }).join('');
    return `${managerActionsHtml(comparison)}<table class="attendance-control__comparison-table"><thead><tr><th>נתון</th><th>נוכחות</th><th>דשבורד / בקרה</th><th>סטטוס</th></tr></thead><tbody>${rows}</tbody></table>`;
  };
  const reportHtml = ({ kind, item, employeeId, date }) => {
    const row = kind === 'dashboard' ? item.dashboard : item.attendance;
    const issue = kind === 'comparison' ? comparisonHasIssue(item) : !attendanceEntryIsResolved(item);
    const ok = !issue;
    const timelineStatus = ok ? '<span class="attendance-control__row-status">✓ תקין</span>' : (kind === 'comparison' && item.unmatched ? '<span class="attendance-control__row-status attendance-control__row-status--issue">⚠ לא נמצאה פעילות תואמת</span>' : '');
    const table = kind === 'comparison'
      ? (item.unmatched ? `${managerActionsHtml(item)}${manualReportTable(row)}` : comparisonTable(item))
      : `${managerActionsHtml(item)}${manualReportTable(row, { cancellation: isAttendanceOnlyActivityType(row.activityType) })}`;
    const missingMatch = kind === 'comparison' && item.unmatched ? '<p class="attendance-control__missing-match">לא נמצאה פעילות תואמת בדשבורד</p>' : '';
    const manualStatus = kind === 'attendance' && issue ? '<span class="attendance-control__row-status attendance-control__row-status--issue">⚠ לבדיקה</span>' : '';
    return `<section class="attendance-control__report"><div class="attendance-control__report-line"><strong>${shown(`${row.startTime || '—'}–${row.endTime || '—'} | ${activityTypeDisplayLabel(row.activityType) || 'דיווח'}`)}</strong>${timelineStatus}${manualStatus}</div>${identityHtml(row)}${dayKmLineForReport(employeeId, date)}${missingMatch}${table}</section>`;
  };
  const employeeHtml = [...employees.values()].sort((a, b) => a.name.localeCompare(b.name, 'he')).map((employee) => {
    const days = [...employee.days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => {
      rows.sort((left, right) => left.time.localeCompare(right.time));
      const attendanceRows = rows.filter((row) => row.kind !== 'dashboard');
      const hours = attendanceRows.reduce((sum, entry) => sum + (rowWorkHours(entry.kind === 'comparison' ? entry.item.attendance : entry.item.attendance) ?? 0), 0);
      const km = dayKmInfo(employee.id, date);
      const issue = dayKmIssue(employee.id, date) || rows.some((entry) => {
        const item = entry.item;
        return !attendanceEntryIsResolved(item);
      });
      const reportedKm = !km || km.hasReportedKm === false || (km.hasReportedKm !== true && optionalNumber(km.reported) == null)
        ? '—'
        : shown(km.reported ?? 0);
      const calculatedKm = km?.calculated == null ? 'לא ניתן לחשב' : shown(km.calculated);
      const kmStatus = km?.calculated == null ? 'לא ניתן לחשב ק״מ' : (km.matches ? 'תקין' : 'לבדיקה');
      const kmLine = `<div class="attendance-control__day-km">ק״מ מדווח: ${reportedKm} | ק״מ מחושב: ${calculatedKm} | ${kmStatus}</div>`;
      return `<details class="attendance-control__day${issue ? '' : ' attendance-control__day--ok'}" data-payroll-date="${escapeHtml(date)}"><summary><span>${shown(dateLabel(date))}</span><span>${hours.toFixed(2)} שעות</span><span class="attendance-control__row-status ${issue ? 'attendance-control__row-status--issue' : ''}">${issue ? '⚠ לבדיקה' : '✓ תקין'}</span></summary>${kmLine}<div class="attendance-control__reports">${rows.map((row) => reportHtml({ ...row, employeeId: employee.id, date })).join('')}</div></details>`;
    }).join('');
    const approval = options.approvalsByEmployee?.[employee.id];
    const approvedHtml = approval
      ? `<div class="attendance-control__approved"><span>מאושר להעברה לשכר</span><span>${shown(approval.approved_by_name)}</span><span>${shown(approval.approved_at ? new Date(approval.approved_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '')}</span><button type="button" class="ds-btn ds-btn--sm" data-payroll-view-pdf="${escapeHtml(String(approval.id || ''))}">צפייה בדוח</button></div>`
      : '';
    const finishButton = `<div class="attendance-control__employee-actions"><button type="button" class="ds-btn ds-btn--primary" data-payroll-finish="${escapeHtml(employee.id)}" data-payroll-employee-name="${shown(employee.name)}">סיום בדיקה ואישור להעברה לשכר</button></div>`;
    return `<details class="attendance-control__employee" data-payroll-employee="${escapeHtml(employee.id)}"><summary><strong>${shown(employee.name)}</strong></summary>${approvedHtml}${finishButton}<div class="attendance-control__employee-days">${days}</div></details>`;
  }).join('');
  const reviewEmployees = [...employees.values()].filter((employee) => {
    const entries = [...(result.comparisons || []), ...(result.notCompared || [])]
      .filter((entry) => txt(entry.attendance?.employeeId) === employee.id);
    return entries.some((entry) => !attendanceEntryIsResolved(entry))
      || [...employee.days.entries()].some(([date]) => dayKmIssue(employee.id, date));
  }).length;
  const metricsHtml = `<details class="attendance-control__metrics-details" data-payroll-metrics><summary>פרטים</summary><div class="attendance-control__metrics"><span>שורות נוכחות ${totals.attendanceRows}</span><span>התאמות ${totals.fullMatches}</span><span>פערים ${totals.fieldMismatches}</span><span>ללא התאמה ${totals.unmatchedAttendance}</span></div></details>`;
  const summaryBar = `<div class="attendance-control__summary-bar"><span>מדריכים <b>${employees.size}</b></span><span>תקינים <b>${Math.max(0, employees.size - reviewEmployees)}</b></span><span>לבדיקה <b>${reviewEmployees}</b></span></div>`;
  return `${summaryBar}${metricsHtml}${employeeHtml}<button type="button" class="ds-btn ds-btn--primary attendance-control__export" data-attendance-export>ייצוא דוח נוכחות מתוקן</button>`;
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
  let result = null; let employees = null; let teamIds = []; let approvalsByEmployee = {};
  const role = txt(state?.user?.role || state?.user?.display_role).toLowerCase();
  const isManager = role === 'manager' || role === 'instructor_manager';
  const canChooseTeam = ['operations_controller', 'system_admin', 'operation_manager', 'admin'].includes(role);
  const paintResults = () => {
    // Save open state of employees, days and metrics before replacing innerHTML
    const openEmployees = new Set();
    const openDays = new Set();
    let metricsOpen = false;
    results.querySelectorAll('details[data-payroll-employee][open]').forEach((el) => openEmployees.add(el.dataset.payrollEmployee));
    results.querySelectorAll('details[data-payroll-date][open]').forEach((el) => {
      const emp = el.closest('[data-payroll-employee]');
      openDays.add((emp?.dataset?.payrollEmployee || '') + '|' + el.dataset.payrollDate);
    });
    if (results.querySelector('details[data-payroll-metrics][open]')) metricsOpen = true;

    results.innerHTML = result ? resultsHtml(result, result.month, { approvalsByEmployee }) : '';

    // Restore open state after re-render
    results.querySelectorAll('details[data-payroll-employee]').forEach((el) => {
      if (openEmployees.has(el.dataset.payrollEmployee)) el.open = true;
    });
    results.querySelectorAll('details[data-payroll-date]').forEach((el) => {
      const emp = el.closest('[data-payroll-employee]');
      const key = (emp?.dataset?.payrollEmployee || '') + '|' + el.dataset.payrollDate;
      if (openDays.has(key)) el.open = true;
    });
    if (metricsOpen) {
      const m = results.querySelector('details[data-payroll-metrics]');
      if (m) m.open = true;
    }
  };
  const loadApprovals = async () => {
    approvalsByEmployee = {};
    if (!api?.listPayrollControlApprovals || !result?.month) return;
    try {
      const rows = await api.listPayrollControlApprovals({ monthKey: result.month });
      approvalsByEmployee = Object.fromEntries((rows || []).map((row) => [txt(row.employee_id), row]));
    } catch { approvalsByEmployee = {}; }
  };
  const approvalFromButton = (button) => {
    const id = txt(button?.dataset?.payrollViewPdf);
    return Object.values(approvalsByEmployee).find((row) => txt(row.id) === id) || null;
  };
  const askForSignature = async (finishMod) => new Promise((resolve) => {
    const dialog = panel.ownerDocument.createElement('dialog');
    dialog.className = 'attendance-control__approve-dialog';
    dialog.innerHTML = `<p>${finishMod.PAYROLL_APPROVAL_TEXT}</p><div class="attendance-control__approve-actions"><button type="button" class="ds-btn ds-btn--primary" data-payroll-sign>מאשר/ת וחותם/ת</button><button type="button" class="ds-btn" data-payroll-cancel>ביטול</button></div>`;
    panel.appendChild(dialog);
    const done = (value) => { try { dialog.close(); } catch {} dialog.remove(); resolve(value); };
    dialog.querySelector('[data-payroll-sign]')?.addEventListener('click', () => done(true));
    dialog.querySelector('[data-payroll-cancel]')?.addEventListener('click', () => done(false));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); done(false); });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else done(window.confirm(`${finishMod.PAYROLL_APPROVAL_TEXT}\n\nמאשר/ת וחותם/ת?`));
  });
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
      title.textContent = `בקרת שכר – ${monthLabel}`; status.textContent = '';
      await loadApprovals(); paintResults();
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
  results.addEventListener('click', async (event) => {
    const findEntry = (entryId) => (
      [...(result?.comparisons || []), ...(result?.notCompared || [])].find((entry) => entry.id === entryId) || null
    );
    const approveBtn = event.target.closest('[data-attendance-approve-reported]');
    if (approveBtn && result) {
      const entry = findEntry(approveBtn.dataset.attendanceApproveReported);
      if (entry) { approveAttendanceEntryAsReported(entry); paintResults(); status.textContent = ''; }
      return;
    }
    const saveCorrectionBtn = event.target.closest('[data-attendance-save-correction]');
    if (saveCorrectionBtn && result) {
      const entry = findEntry(saveCorrectionBtn.dataset.attendanceSaveCorrection);
      const hoursInput = results.querySelector(`[data-attendance-correct-hours="${saveCorrectionBtn.dataset.attendanceSaveCorrection}"]`);
      const hours = optionalNumber(hoursInput?.value);
      if (entry && hours != null) {
        applyAttendanceManualCorrection(entry, { workHours: hours });
        paintResults();
        status.textContent = '';
      } else if (entry) {
        status.textContent = 'יש להזין שעות שכר מתוקנות.';
      }
      return;
    }
    if (event.target.closest('[data-attendance-export]') && result) {
      XLSX.writeFile(buildCorrectedAttendanceWorkbook([...result.comparisons, ...(result.notCompared || [])], result.dashboardPopulation), attendanceExportFilename(result.month), { compression: true });
      return;
    }
    const kmApproveBtn = event.target.closest('[data-km-approve-reported]');
    if (kmApproveBtn && result) {
      const [kmEmployeeId, kmDate] = txt(kmApproveBtn.dataset.kmApproveReported).split('|');
      resolveKilometersDay(result, kmEmployeeId, kmDate, 'approved_as_reported');
      paintResults();
      status.textContent = '';
      return;
    }
    const viewBtn = event.target.closest('[data-payroll-view-pdf]');
    if (viewBtn) {
      const approval = approvalFromButton(viewBtn);
      if (!approval) return;
      const finishMod = await import('./payroll-control-finish.js');
      let signedUrl = '';
      if (approval.pdf_path && api?.payrollControlApprovalSignedUrl) {
        try { signedUrl = (await api.payrollControlApprovalSignedUrl(approval.pdf_path)).signedUrl || ''; } catch { signedUrl = ''; }
      }
      finishMod.openPayrollApprovalDocument(approval, signedUrl);
      return;
    }
    const finishBtn = event.target.closest('[data-payroll-finish]');
    if (!finishBtn || !result) return;
    const employeeId = txt(finishBtn.dataset.payrollFinish);
    const employeeName = txt(finishBtn.dataset.payrollEmployeeName);
    finishBtn.disabled = true;
    try {
      const finishMod = await import('./payroll-control-finish.js');
      if (finishMod.payrollEmployeeHasUnresolvedEntries(result, employeeId)) {
        status.textContent = 'לא ניתן לסיים את הבקרה: יש רשומות נוכחות שלא קיבלו החלטת מנהל.';
        return;
      }
      const signed = await askForSignature(finishMod);
      if (!signed) { status.textContent = 'האישור בוטל.'; return; }
      status.textContent = 'שולח עדכונים ושומר אישור להעברה לשכר…';
      const saved = await finishMod.approvePayrollControlEmployee({
        api, user: state?.user, result, employeeId, employeeName, confirmed: true
      });
      approvalsByEmployee[employeeId] = saved;
      paintResults();
      status.textContent = 'הבקרה אושרה להעברה לשכר והמסמך הופק בהצלחה.';
    } catch (error) {
      status.textContent = error?.message || 'שמירת האישור נכשלה.';
    } finally {
      finishBtn.disabled = false;
    }
  });
}
