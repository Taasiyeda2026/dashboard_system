import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { activityTypeDisplayLabel, isOneDayActivityType, normalizeActivityTypeKey } from './shared/activity-options.js';
import {
  buildPayrollIdentityContext,
  payrollBundleHasContext,
  payrollEntityFieldsEquivalent
} from './payroll-control-identity.js';

export const DETAIL_HEADERS = ['מספר עובד', 'שם עובד', 'תאריך', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'ביטול זמן', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית', 'מספר מפגש', 'קילומטרים', 'תחבורה ציבורית', 'עלות תחבורה ציבורית', 'הוצאות', 'פירוט הוצאות', 'הערות', 'אסמכתאות'];
export const MONTHLY_HEADERS = ['שם מדריך', 'מספר עובד', 'שעות ביטול זמן', 'שעות הכשרה', 'שעות חדר בריחה', 'שעות סדנה', 'שעות סדנאות קיץ', 'שעות סיור', 'שעות קורס', 'שעות תפעול', 'סה"כ קילומטרים', 'הוצאות', 'פירוט הוצאות'];
export const DAILY_HEADERS = ['תאריך', 'שם מדריך', 'מספר עובד', 'סוג פעילות', 'רשות', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'ביטול זמן', 'קילומטרים', 'הוצאות', 'פירוט הוצאות'];

const FIELD_DEFS = [
  ['startTime', 'שעת התחלה', 'time'], ['endTime', 'שעת סיום', 'time'],
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
  expenseDetails: ['פירוט הוצאות', 'תיאור הוצאות'], notes: ['הערות', 'הערה'], activityId: ['מזהה פעילות', 'מזהה פעילות פנימי', 'rowid'],
  publicTransport: ['תחבורה ציבורית', 'public transport', 'public_transport'],
  publicTransportCost: ['עלות תחבורה ציבורית', 'public transport cost', 'public_transport_cost'],
  attachmentsNames: ['אסמכתאות', 'קבצים', 'attachments']
};

const txt = (value) => String(value ?? '').trim();
const HEBREW_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const number = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};
const optionalNumber = (value) => txt(value) === '' || value == null ? null : number(value);
const asBoolean = (value) => value === true || value === 'true' || value === 1 || value === '1' || value === 'yes';
const ATTENDANCE_ONLY_ACTIVITY_TYPES = new Set(['ביטולזמן', 'הכשרה', 'תפעול']);

export function normalizeAttendanceAttachments(raw = [], names = '') {
  const list = Array.isArray(raw) ? raw : [];
  const normalized = list.map((item) => ({
    id: txt(item?.id || item?.attachmentId),
    fileName: txt(item?.fileName || item?.file_name || item?.name),
    storagePath: txt(item?.storagePath || item?.storage_path || item?.path),
    fileType: txt(item?.fileType || item?.file_type || item?.type),
    fileSize: item?.fileSize ?? item?.file_size ?? null
  })).filter((item) => item.fileName || item.storagePath);
  if (normalized.length) return normalized;
  return txt(names).split(',').map((name) => txt(name)).filter(Boolean).map((fileName) => ({
    id: '', fileName, storagePath: '', fileType: '', fileSize: null
  }));
}

export function enforceAttendanceTravelMode(row = {}) {
  const next = { ...row };
  const hadPublicTransportKey = Object.prototype.hasOwnProperty.call(row, 'publicTransport');
  const hadPublicTransportCostKey = Object.prototype.hasOwnProperty.call(row, 'publicTransportCost');
  let publicTransport = asBoolean(next.publicTransport);
  let kilometers = optionalNumber(next.kilometers);
  let publicTransportCost = optionalNumber(next.publicTransportCost);
  if (publicTransport) {
    kilometers = 0;
    publicTransportCost = publicTransportCost == null ? 0 : Math.max(0, publicTransportCost);
  } else if ((kilometers || 0) > 0) {
    publicTransport = false;
    publicTransportCost = 0;
  } else if (hadPublicTransportKey || hadPublicTransportCostKey) {
    publicTransport = false;
    publicTransportCost = 0;
  } else {
    // Preserve "unset" travel mode for approve-as-reported / unchanged rows.
    publicTransport = false;
    publicTransportCost = publicTransportCost == null ? null : 0;
  }
  next.publicTransport = publicTransport;
  if (publicTransportCost != null || hadPublicTransportCostKey || publicTransport || (kilometers || 0) > 0) {
    next.publicTransportCost = publicTransportCost ?? 0;
  }
  next.kilometers = kilometers;
  return next;
}

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
  const from = parse(start); const to = parse(end);
  if (from === null || to === null) return 0;
  if (to <= from) return 0;
  return Math.round(((to - from) / 60) * 100) / 100;
}

export function attendanceTimeRangeIsValid(start, end) {
  const from = timeText(start);
  const to = timeText(end);
  if (!from || !to) return true;
  return calculateWorkHours(from, to) > 0;
}

export function parseDurationHoursInput(value) {
  const raw = txt(value);
  const clock = raw.match(/^(\d+):([0-5]\d)$/);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const numeric = optionalNumber(raw);
  return numeric != null && numeric >= 0 ? numeric : null;
}

export function buildAttendanceTimeCorrection(current = {}, draftStart = '', draftEnd = '') {
  const startTime = timeText(draftStart) || timeText(current.startTime);
  const endTime = timeText(draftEnd) || timeText(current.endTime);
  return {
    valid: attendanceTimeRangeIsValid(startTime, endTime),
    changes: { startTime, endTime }
  };
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
  const start = timeMinutesValue(dashboard.startTime);
  const end = timeMinutesValue(dashboard.endTime);
  if (payrollHours == null || start == null || end == null) return null;

  const beforeMinutes = Math.ceil(payrollHours / 2) * 15;
  const afterMinutes = Math.floor(payrollHours / 2) * 15;
  return {
    startTime: formatMinutesAsTime(start - beforeMinutes),
    endTime: formatMinutesAsTime(end + afterMinutes),
  };
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

function isTrainingAttendanceType(value) {
  return normalizeAttendanceName(value).includes('הכשרה');
}

export function buildTrainingScheduleDashboardRows(scheduleRows = [], attendanceRows = [], employeeIds = []) {
  const scopedIds = new Set((employeeIds || []).map((value) => txt(value)).filter(Boolean));
  const trainingAttendance = (attendanceRows || []).filter((row) =>
    scopedIds.has(txt(row.employeeId)) && isTrainingAttendanceType(row.activityType)
  );
  const activeSchedules = (scheduleRows || []).filter((row) => row?.is_active !== false);
  const openCountByDate = new Map();
  for (const schedule of activeSchedules) {
    if (txt(schedule.participant_scope) !== 'open' && schedule.emp_id != null) continue;
    const date = excelDate(schedule.training_date);
    if (date) openCountByDate.set(date, (openCountByDate.get(date) || 0) + 1);
  }

  const output = [];
  const seen = new Set();
  const pushRow = (schedule, employeeId) => {
    const id = txt(employeeId);
    const date = excelDate(schedule.training_date);
    if (!id || !date || !scopedIds.has(id)) return;
    const key = `${txt(schedule.id)}|${id}|${date}`;
    if (seen.has(key)) return;
    seen.add(key);
    const startTime = timeText(schedule.start_time);
    const endTime = timeText(schedule.end_time);
    output.push({
      employeeId: id,
      employeeName: '',
      date,
      startTime,
      endTime,
      workHours: calculateWorkHours(startTime, endTime),
      payrollHoursRequireReview: false,
      meetingCount: 1,
      activityType: txt(schedule.activity_type) || 'הכשרה',
      school: '',
      authority: '',
      program: txt(schedule.course_name),
      meetingNo: '',
      kilometers: schedule.is_online === true ? 0 : null,
      expenses: null,
      activityNo: '',
      activityId: `training:${txt(schedule.id)}`,
      __trainingSchedule: true,
      trainingScope: txt(schedule.participant_scope) || (schedule.emp_id == null ? 'open' : 'assigned'),
      isOnline: schedule.is_online === true,
      locationName: txt(schedule.location_name),
      locationAddress: txt(schedule.location_address)
    });
  };

  for (const schedule of activeSchedules) {
    const date = excelDate(schedule.training_date);
    if (!date) continue;
    const scope = txt(schedule.participant_scope) || (schedule.emp_id == null ? 'open' : 'assigned');
    if (scope === 'assigned' && schedule.emp_id != null) {
      pushRow(schedule, schedule.emp_id);
      continue;
    }

    const sameDate = trainingAttendance.filter((row) => txt(row.date) === date);
    const courseKey = normalizeAttendanceName(schedule.course_name);
    const exactCourse = sameDate.filter((row) => normalizeAttendanceName(row.program) === courseKey);
    const candidates = exactCourse.length
      ? exactCourse
      : ((openCountByDate.get(date) || 0) === 1 ? sameDate : []);
    for (const attendance of candidates) pushRow(schedule, attendance.employeeId);
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

export function attendanceMonthDateRange(month = '') {
  const match = txt(month).match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return { fromDate: '', toDate: '' };
  const year = Number(match[1]);
  const mon = Number(match[2]);
  const lastDay = new Date(year, mon, 0).getDate();
  const monthKey = `${match[1]}-${match[2]}`;
  return {
    fromDate: `${monthKey}-01`,
    toDate: `${monthKey}-${String(lastDay).padStart(2, '0')}`
  };
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
  return records.map((row) => {
    const attachments = normalizeAttendanceAttachments(
      row.attachments || row.Attachments || row._attachments,
      row.attachmentsNames || row.AttachmentsNames
    );
    return enforceAttendanceTravelMode({
      employeeId: txt(row.employeeId || row.EmployeeId || row.empNum),
      employeeName: txt(row.employeeName || row.EmployeeName || row.empName),
      employmentType: lookupText(row.employmentType || row.EmploymentType),
      team: lookupText(row.team || row.Team), date: excelDate(row.attendanceDate || row.AttendanceDate || row.date),
      startTime: timeText(row.startTime || row.StartTime || row.start), endTime: timeText(row.endTime || row.EndTime || row.end),
      workHours: optionalNumber(row.workHours ?? row.WorkHours ?? row.hours), activityType: lookupText(row.activityType || row.ActivityType || row.activity),
      school: txt(row.schoolName || row.SchoolName || row.school), authority: txt(row.municipality || row.Municipality || row.authority),
      program: txt(row.programName || row.ProgramName || row.program), meetingNo: txt(row.sessionNumber || row.SessionNumber || row.session),
      kilometers: optionalNumber(row.kilometers ?? row.Kilometers ?? row.km),
      publicTransport: asBoolean(row.publicTransport ?? row.PublicTransport ?? row.public_transport),
      publicTransportCost: optionalNumber(row.publicTransportCost ?? row.PublicTransportCost ?? row.public_transport_cost),
      expenses: optionalNumber(row.totalExpenses ?? row.TotalExpenses),
      expenseDetails: txt(row.expensesDetails || row.ExpensesDetails), notes: txt(row.notes || row.Notes),
      activityId: txt(row.activityRowId || row.activity_row_id || row.activityId || row.activityNumericId || row.activity_numeric_id),
      recordId: txt(row.recordId || row.ID || row.Id || row.id),
      originAddress: txt(row.originAddress || row.origin_address),
      destinationAddress: txt(row.destinationAddress || row.destination_address),
      destinationEntityKey: txt(row.destinationEntityKey || row.destination_entity_key),
      destinationType: txt(row.destinationType || row.destination_type),
      isRemoteDestination: asBoolean(row.isRemoteDestination ?? row.is_remote),
      attachments,
      attachmentsNames: attachments.map((item) => item.fileName).filter(Boolean).join(', '),
      _source: row
    });
  }).filter((row) => row.employeeId && row.date);
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

function normalizedRouteAddress(value) {
  return txt(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function routeLocationFromStop(stop = {}) {
  const attendance = stop.attendance || {};
  const dashboard = stop.dashboard || {};
  const address = txt(attendance.destinationAddress || dashboard.destinationAddress);
  const entityKey = txt(attendance.destinationEntityKey || dashboard.destinationEntityKey);
  const schoolId = dashboard.schoolId ?? attendance?._source?.schoolId ?? attendance?._source?.school_id ?? null;
  if (address) {
    return {
      type: txt(attendance.destinationType || dashboard.destinationType) || (schoolId != null ? 'school' : 'location'),
      address,
      entityKey,
      schoolId: schoolId == null ? null : Number(schoolId)
    };
  }
  if (schoolId != null) return { type: 'school', address: '', entityKey: `school_id:${Number(schoolId)}`, schoolId: Number(schoolId) };
  return null;
}

function instructorLocationDistance(cache, employeeId, location, originAddress = '') {
  if (!location) return null;
  if (location.schoolId != null && !location.address) return instructorSchoolDistance(cache, employeeId, location.schoolId);
  const address = normalizedRouteAddress(location.address);
  const homeAddress = normalizedRouteAddress(originAddress);
  const hit = cache.find((row) => (
    (
      txt(row.origin_instructor_emp_id) === txt(employeeId)
      || (homeAddress && normalizedRouteAddress(row.origin_address) === homeAddress)
    )
    && (
      (location.entityKey && txt(row.destination_entity_key) === location.entityKey)
      || (address && normalizedRouteAddress(row.destination_address) === address)
    )
  ));
  return usableDistance(hit);
}

function locationInstructorDistance(cache, employeeId, location, homeAddress = '') {
  if (!location) return null;
  if (location.schoolId != null && !location.address) return instructorSchoolDistance(cache, employeeId, location.schoolId);
  const address = normalizedRouteAddress(location.address);
  const home = normalizedRouteAddress(homeAddress);
  if (address && home && address === home) return 0;
  if (!address || !home) return null;
  const hit = cache.find((row) => (
    (
      (location.entityKey && txt(row.origin_entity_key) === location.entityKey)
      || normalizedRouteAddress(row.origin_address) === address
    )
    && normalizedRouteAddress(row.destination_address) === home
  ));
  const reverseDistance = usableDistance(hit);
  if (reverseDistance != null) return reverseDistance;
  // Older cache rows sometimes contain only instructor -> destination. Preserve
  // their legacy symmetric fallback, while preferring the real reverse route
  // whenever both directional Google routes are available.
  return instructorLocationDistance(cache, employeeId, location, homeAddress);
}

function locationLocationDistance(cache, origin, destination) {
  if (!origin || !destination) return null;
  if (
    (origin.entityKey && destination.entityKey && origin.entityKey === destination.entityKey)
    || (origin.address && destination.address && normalizedRouteAddress(origin.address) === normalizedRouteAddress(destination.address))
  ) return 0;
  if (origin.schoolId != null && destination.schoolId != null && !origin.address && !destination.address) {
    return schoolSchoolDistance(cache, origin.schoolId, destination.schoolId);
  }
  const originAddress = normalizedRouteAddress(origin.address);
  const destinationAddress = normalizedRouteAddress(destination.address);
  const hit = cache.find((row) => (
    ((origin.entityKey && txt(row.origin_entity_key) === origin.entityKey)
      || (originAddress && normalizedRouteAddress(row.origin_address) === originAddress))
    && ((destination.entityKey && txt(row.destination_entity_key) === destination.entityKey)
      || (destinationAddress && normalizedRouteAddress(row.destination_address) === destinationAddress))
  ));
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


function nearestAttendanceRouteDashboardRow(attendance, rows = []) {
  const employeeId = txt(attendance?.employeeId);
  const activityId = txt(attendance?.activityId);
  if (!employeeId || !activityId) return null;

  let candidates = rows.filter((row) => !row?.__profile
    && txt(row.employeeId) === employeeId
    && txt(row.activityId) === activityId);
  if (!candidates.length) return null;

  const expectedMeetings = parseMeetingNumberList(attendance?.meetingNo);
  if (expectedMeetings.length) {
    const byMeeting = candidates.filter((row) => {
      const actualMeetings = dashboardMeetingNumbers(row);
      return expectedMeetings.every((meetingNo) => actualMeetings.includes(meetingNo));
    });
    if (byMeeting.length) candidates = byMeeting;
  }
  if (candidates.length === 1) return candidates[0];

  const targetTime = Date.parse(`${txt(attendance?.date)}T00:00:00Z`);
  return [...candidates].sort((left, right) => {
    const leftTime = Date.parse(`${txt(left?.date)}T00:00:00Z`);
    const rightTime = Date.parse(`${txt(right?.date)}T00:00:00Z`);
    const leftDistance = Number.isFinite(targetTime) && Number.isFinite(leftTime) ? Math.abs(leftTime - targetTime) : Number.MAX_SAFE_INTEGER;
    const rightDistance = Number.isFinite(targetTime) && Number.isFinite(rightTime) ? Math.abs(rightTime - targetTime) : Number.MAX_SAFE_INTEGER;
    return leftDistance - rightDistance || timeText(left?.startTime).localeCompare(timeText(right?.startTime));
  })[0] || null;
}

function plannedTrainingRouteRow(attendance, rows = []) {
  if (!isTrainingAttendanceType(attendance?.activityType)) return null;
  const employeeId = txt(attendance?.employeeId);
  const date = txt(attendance?.date);
  const candidates = (rows || []).filter((row) => row?.__trainingSchedule
    && txt(row.employeeId) === employeeId
    && txt(row.date) === date);
  if (!candidates.length) return null;
  const program = normalizeAttendanceName(attendance?.program);
  const exact = program
    ? candidates.filter((row) => normalizeAttendanceName(row.program) === program)
    : [];
  if (exact.length === 1) return exact[0];
  return candidates.length === 1 ? candidates[0] : null;
}

// Attendance can be reported on a different date from the scheduled meeting.
// Kilometer validation must therefore follow the instructor's ACTUAL workday sequence:
// home -> first physical activity -> next physical activity -> ... -> home.
// Each attendance record receives only the route segment(s) that belong to it.
export function applyAttendanceDayRouteKilometers(rows = [], attendanceRows = [], travelCache = []) {
  const groups = new Map();

  for (const attendance of attendanceRows || []) {
    if (!attendance?.employeeId || !attendance?.date) continue;
    if (isAttendanceTravelTimeCancellation(attendance)
      || normalizeAttendanceName(attendance?.activityType).includes('ביטולזמן')) continue;

    const isZoom = attendance.isRemoteDestination === true
      || /zoom|זום/u.test(normalizeAttendanceName(`${attendance?.school || ''} ${attendance?.program || ''} ${attendance?.activityType || ''}`));
    const routeOnly = rows.find((row) => row?.__routeOnly
      && txt(row.sourceRecordId) === txt(attendance.recordId));
    const trainingPlan = plannedTrainingRouteRow(attendance, rows);
    const dashboard = trainingPlan || routeOnly || nearestAttendanceRouteDashboardRow(attendance, rows);
    const key = `${txt(attendance.employeeId)}|${txt(attendance.date)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ attendance, dashboard, isZoom });
  }

  for (const stops of groups.values()) {
    const physicalStops = stops.filter((stop) => !stop.isZoom);
    stops.filter((stop) => stop.isZoom && stop.dashboard).forEach((stop) => { stop.dashboard.kilometers = 0; });
    if (!physicalStops.length) continue;

    const linkedRows = [...new Set(physicalStops.map((stop) => stop.dashboard).filter(Boolean))];
    linkedRows.forEach((row) => { row.kilometers = null; });

    physicalStops.forEach((stop) => { stop.location = routeLocationFromStop(stop); });
    // A physical stop is unresolved only when it has neither a school identity nor
    // a trusted destination address. A null school_id by itself is not a missing route.
    if (physicalStops.some((stop) => !stop.dashboard || !stop.location)) continue;

    physicalStops.sort((left, right) => timeText(left.attendance?.startTime).localeCompare(timeText(right.attendance?.startTime)));
    let routeUnavailable = false;
    physicalStops.forEach((stop, index) => {
      const employeeId = txt(stop.attendance.employeeId);
      const incoming = index === 0
        ? instructorLocationDistance(travelCache, employeeId, stop.location, stop.attendance.originAddress)
        : locationLocationDistance(travelCache, physicalStops[index - 1].location, stop.location);
      const returnHome = index === physicalStops.length - 1
        ? locationInstructorDistance(travelCache, employeeId, stop.location, stop.attendance.originAddress)
        : 0;
      if (incoming == null || returnHome == null) {
        routeUnavailable = true;
        return;
      }
      stop.dashboard.kilometers = Math.round((incoming + returnHome) * 100) / 100;
    });

    if (routeUnavailable) linkedRows.forEach((row) => { row.kilometers = null; });
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
  const sourceRows = [
    ...buildDashboardAttendanceRows(sources.activities, sources.contacts),
    ...buildTrainingScheduleDashboardRows(sources.trainingSchedule || [], attendanceRows, scope.employeeIds)
  ].filter((row) => (month ? row.date.startsWith(`${month}-`) : scope.dates.has(row.date)) && scope.employeeIds.includes(row.employeeId));
  const rows = aggregateDashboardAttendanceRows(sourceRows);
  applyDashboardRouteKilometers(rows, sources.travelCache || []);

  const routeOnlyRows = (attendanceRows || [])
    .filter((attendance) => isAttendanceOnlyActivityType(attendance.activityType)
      && attendance.isRemoteDestination !== true
      && txt(attendance.destinationAddress))
    .map((attendance) => ({
      employeeId: txt(attendance.employeeId),
      employeeName: txt(attendance.employeeName),
      date: txt(attendance.date),
      startTime: timeText(attendance.startTime),
      endTime: timeText(attendance.endTime),
      activityType: txt(attendance.activityType),
      school: txt(attendance.school),
      program: txt(attendance.program),
      kilometers: null,
      originAddress: txt(attendance.originAddress),
      destinationAddress: txt(attendance.destinationAddress),
      destinationEntityKey: txt(attendance.destinationEntityKey),
      destinationType: txt(attendance.destinationType) || 'location',
      sourceRecordId: txt(attendance.recordId),
      __routeOnly: true
    }));
  rows.push(...routeOnlyRows);
  applyAttendanceDayRouteKilometers(rows, attendanceRows, sources.travelCache || []);
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

export function formatDurationHours(value) {
  const hours = optionalNumber(value);
  if (hours == null) return '—';
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(totalMinutes / 60)}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

function displayWorkHours(row) {
  return formatDurationHours(rowWorkHours(row));
}

function displayDashboardWorkHours(dashboard) {
  if (!dashboard) return '—';
  const hours = rowWorkHours(dashboard);
  if (hours != null) return formatDurationHours(hours);
  if (dashboard.payrollHoursRequireReview) return 'לא ניתן לחשב';
  return '—';
}

function hasReviewExpense(row) {
  return number(row?.expenses) > 0;
}

export function attendanceEntryIsResolved(entry) {
  if (!entry || entry.source === 'dashboard_only') return true;
  return entry.managerRecordApproved === true;
}

export function approveAttendanceEntryCurrent(entry) {
  if (!entry?.attendance) return entry;
  const base = entry.final || entry.attendance;
  entry.final = enforceAttendanceTravelMode({
    ...base,
    workHours: rowWorkHours(base) ?? optionalNumber(base.workHours)
  });
  let corrected = entry.managerResolved === 'corrected';
  for (const difference of (entry.differences || [])) {
    if (difference.decided) {
      if (difference.choice && difference.choice !== 'attendance') corrected = true;
      continue;
    }
    difference.choice = 'attendance';
    difference.custom = '';
    difference.decided = true;
    if (difference.key === 'startTime' || difference.key === 'endTime') {
      entry.final.workHours = calculateWorkHours(entry.final.startTime, entry.final.endTime);
    }
  }
  entry.managerRecordApproved = true;
  entry.managerResolved = corrected ? 'corrected' : 'approved_as_reported';
  return entry;
}

const MONTH_WORKFLOW_LABELS = {
  not_submitted: 'פתוח לדיווח',
  submitted: 'אושר על ידי העובד / בבקרת מנהל',
  manager_approved: 'אושר על ידי המנהל',
  approved: 'אושר סופית'
};

function normalizeAttendanceSubmissionStatus(value) {
  const status = txt(value).toLowerCase();
  if (status === 'submitted') return 'submitted';
  if (status === 'locked') return 'locked';
  if (status === 'reopened') return 'reopened';
  return 'open';
}

export function resolvePayrollMonthWorkflow(workflow = {}) {
  const explicit = txt(workflow.workflow_status || workflow.workflowStatus).toLowerCase();
  const submissionStatus = normalizeAttendanceSubmissionStatus(
    workflow.attendance_submission_status || workflow.attendanceSubmissionStatus
  );
  const hasPayrollApproval = explicit === 'approved'
    || Boolean(workflow.payroll_approved_at || workflow.payrollApprovedAt)
    || txt(workflow.payroll_status).toLowerCase() === 'approved_for_payroll';
  const derivedStatus = hasPayrollApproval
    ? 'approved'
    : explicit === 'manager_approved' || (submissionStatus === 'locked' && Boolean(workflow.manager_approved_at || workflow.managerApprovedAt))
      ? 'manager_approved'
      : explicit === 'submitted' || submissionStatus === 'submitted'
        ? 'submitted'
        : 'not_submitted';
  const label = submissionStatus === 'reopened' && derivedStatus === 'not_submitted'
    ? 'פתוח לדיווח (הוחזר לתיקון)'
    : MONTH_WORKFLOW_LABELS[derivedStatus] || MONTH_WORKFLOW_LABELS.not_submitted;
  return {
    status: derivedStatus,
    label,
    submissionStatus
  };
}

/**
 * Central team-manager month write gate for edit + add-record flows.
 * Requires an explicit employee month state of submitted or admin-reopened.
 * Open months stay read-only; locked / final payroll stay blocked.
 */
export function teamManagerEmployeeMonthWriteAllowed(workflow = {}) {
  const resolved = resolvePayrollMonthWorkflow(workflow);
  if (resolved.status === 'manager_approved' || resolved.status === 'approved') return false;
  const submissionStatus = normalizeAttendanceSubmissionStatus(
    workflow.attendance_submission_status || workflow.attendanceSubmissionStatus
  );
  if (submissionStatus === 'locked') return false;
  if (submissionStatus === 'submitted' || submissionStatus === 'reopened') return true;
  return txt(workflow.workflow_status || workflow.workflowStatus).toLowerCase() === 'submitted';
}

/**
 * Team managers may edit/approve records only while the employee month is submitted
 * or explicitly reopened for correction.
 * Admin / operation_manager may mutate before submission via bypassMonthSubmissionGate,
 * but locked / final-payroll months stay read-only for everyone (DB lifecycle matches).
 */
export function canManagerMutatePayrollEmployeeMonth(workflow = {}, { bypassMonthSubmissionGate = false } = {}) {
  const resolved = resolvePayrollMonthWorkflow(workflow);
  if (resolved.status === 'manager_approved' || resolved.status === 'approved') return false;
  if (bypassMonthSubmissionGate) return true;
  return teamManagerEmployeeMonthWriteAllowed(workflow);
}

export function canManagerAddMissingAttendanceRecord(workflow = {}) {
  return teamManagerEmployeeMonthWriteAllowed(workflow);
}

/** Monthly manager finalize requires employee re-submission after admin reopen. */
export function canManagerFinalizeEmployeeMonth(workflow = {}, { bypassMonthSubmissionGate = false } = {}) {
  if (bypassMonthSubmissionGate) {
    return resolvePayrollMonthWorkflow(workflow).status === 'submitted';
  }
  const submissionStatus = normalizeAttendanceSubmissionStatus(
    workflow.attendance_submission_status || workflow.attendanceSubmissionStatus
  );
  return submissionStatus === 'submitted'
    && resolvePayrollMonthWorkflow(workflow).status === 'submitted';
}

/**
 * Single source of truth for manager-overview status + action.
 * Status badge and action button must always derive from this helper together.
 */
export function resolveManagerAttendanceOverviewState({ workflow = {}, recordCount = 0 } = {}) {
  const resolved = resolvePayrollMonthWorkflow(workflow);
  const submissionStatus = normalizeAttendanceSubmissionStatus(
    workflow.attendance_submission_status || workflow.attendanceSubmissionStatus || resolved.submissionStatus
  );
  const pdfUrl = txt(
    workflow.manager_pdf_sharepoint_url
    || workflow.managerPdfSharepointUrl
    || workflow.manager_pdf_url
  );
  const count = Math.max(0, Number(recordCount) || 0);

  if (resolved.status === 'approved') {
    return {
      status: 'approved',
      statusLabel: '✓ אושר סופית',
      statusClass: 'is-ok',
      actionKind: pdfUrl ? 'pdf' : 'none',
      actionLabel: 'צפייה בדוח',
      pdfUrl,
      opensManagerReview: false
    };
  }
  if (resolved.status === 'manager_approved') {
    return {
      status: 'manager_approved',
      statusLabel: '✓ אושר על ידי המנהל',
      statusClass: 'is-ok',
      actionKind: pdfUrl ? 'pdf' : 'none',
      actionLabel: 'צפייה בדוח',
      pdfUrl,
      opensManagerReview: false
    };
  }
  if (submissionStatus === 'reopened') {
    return {
      status: 'reopened',
      statusLabel: 'פתוח לתיקון',
      statusClass: 'is-pending',
      actionKind: 'review',
      actionLabel: 'פתח לבדיקה',
      pdfUrl: '',
      opensManagerReview: true
    };
  }
  if (resolved.status === 'submitted') {
    return {
      status: 'submitted',
      statusLabel: '✓ אושר על ידי העובד · ממתין לבקרת מנהל',
      statusClass: 'is-pending',
      actionKind: 'review',
      actionLabel: 'פתח לבדיקה',
      pdfUrl: '',
      opensManagerReview: true
    };
  }
  if (!count) {
    return {
      status: 'no_report',
      statusLabel: 'לא נמצא דיווח',
      statusClass: 'is-muted',
      actionKind: 'none',
      actionLabel: '',
      pdfUrl: '',
      opensManagerReview: false
    };
  }
  return {
    status: 'awaiting_employee',
    statusLabel: 'טרם אושר ע״י העובד',
    statusClass: 'is-pending',
    actionKind: 'view',
    actionLabel: 'צפייה',
    pdfUrl: '',
    opensManagerReview: true
  };
}

/** Count of admin-pending months: manager_approved without final admin/payroll approval. */
export function countAdminPendingManagerApproved(rows = []) {
  let count = 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    const status = txt(row?.workflow_status || row?.workflowStatus || row?.status).toLowerCase();
    const submission = normalizeAttendanceSubmissionStatus(
      row?.attendance_submission_status || row?.attendanceSubmissionStatus
    );
    if (submission === 'reopened') continue;
    if (status === 'manager_approved') count += 1;
  }
  return count;
}

/**
 * Prefer the latest closed month that still has manager_approved pending admin.
 * Falls back to the current month when nothing is waiting.
 */
export function resolveAdminAttendanceDefaultMonth({
  pendingByMonth = [],
  currentMonth = ''
} = {}) {
  const current = txt(currentMonth);
  const ranked = (Array.isArray(pendingByMonth) ? pendingByMonth : [])
    .map((row) => ({
      monthKey: txt(row?.month_key || row?.monthKey),
      pendingCount: Math.max(0, Number(row?.pending_count ?? row?.pendingCount) || 0)
    }))
    .filter((row) => row.monthKey && row.pendingCount > 0)
    .sort((left, right) => right.monthKey.localeCompare(left.monthKey));
  return ranked[0]?.monthKey || current;
}

export const EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE =
  'העובד טרם סיים ואישר את הדיווח החודשי. הנתונים מוצגים לצפייה בלבד.';

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
  entry.final = enforceAttendanceTravelMode({
    ...entry.attendance,
    workHours: rowWorkHours(entry.attendance) ?? optionalNumber(entry.attendance.workHours)
  });
  entry.managerResolved = 'approved_as_reported';
  entry.managerRecordApproved = true;
  return entry;
}

export function applyAttendanceManualCorrection(entry, changes = {}) {
  if (!entry?.attendance) return entry;
  entry.managerRecordApproved = false;
  const base = entry.final || entry.attendance;
  const merged = { ...base, ...changes };
  const timesChanged = Object.hasOwn(changes, 'startTime') || Object.hasOwn(changes, 'endTime');
  entry.final = enforceAttendanceTravelMode({
    ...merged,
    workHours: timesChanged
      ? calculateWorkHours(merged.startTime, merged.endTime)
      : rowWorkHours(merged) ?? optionalNumber(base.workHours)
  });
  entry.managerResolved = 'corrected';
  return entry;
}

export function isAttendanceTravelTimeCancellation(entryOrRow = {}) {
  const row = entryOrRow?.attendance || entryOrRow?.final || entryOrRow;
  const source = row?._source || entryOrRow?._source || {};
  return txt(source.generationKind || row?.generationKind) === 'travel_time_cancellation';
}

export function attendanceEntryRecordId(entryOrRow = {}) {
  const row = entryOrRow?.attendance || entryOrRow?.final || entryOrRow || {};
  const source = row?._source || {};
  return txt(row.recordId || source.recordId || source.record_id || source.ID || source.Id || source.id);
}

/** Resolve the Element behind a DOM event (clicks on button text can target a Text node). */
export function eventTargetElement(event) {
  const target = event?.target;
  if (target && typeof target.closest === 'function') return target;
  const parent = target?.parentElement;
  return parent && typeof parent.closest === 'function' ? parent : null;
}

function generatedTravelCancellationIsSystemResolved(entryOrRow = {}) {
  if (!isAttendanceTravelTimeCancellation(entryOrRow)) return false;
  const row = entryOrRow?.attendance || entryOrRow?.final || entryOrRow;
  const source = row?._source || entryOrRow?._source || {};
  return txt(source.travelCalculationStatus) === 'resolved' && source.manuallyOverridden !== true;
}

function entryHasOpenNonTravelGaps(entry) {
  if (!entry) return false;
  if (entry.unmatched || entry.source === 'attendance_not_compared') return true;
  if ((entry.differences || []).some((diff) => diff.key !== 'kilometers' && !diff.decided)) return true;
  if (hasReviewExpense(entry.attendance) && entry.managerResolved !== 'approved_as_reported' && entry.managerResolved !== 'corrected') {
    return true;
  }
  return false;
}

function travelFieldsEqual(left = {}, right = {}) {
  return asBoolean(left.publicTransport) === asBoolean(right.publicTransport)
    && (optionalNumber(left.publicTransportCost) ?? 0) === (optionalNumber(right.publicTransportCost) ?? 0)
    && (optionalNumber(left.kilometers) ?? 0) === (optionalNumber(right.kilometers) ?? 0);
}

/**
 * Travel-only correction: updates final PT/km without auto-resolving other open gaps.
 * No-op when values are unchanged or the row is a generated travel_time_cancellation.
 */
export function applyAttendanceTravelCorrection(entry, changes = {}) {
  if (!entry?.attendance) return { entry, changed: false };
  if (isAttendanceTravelTimeCancellation(entry)) return { entry, changed: false };
  entry.managerRecordApproved = false;

  const base = { ...(entry.final || entry.attendance) };
  const nextTravel = enforceAttendanceTravelMode({
    ...base,
    publicTransport: changes.publicTransport,
    publicTransportCost: changes.publicTransportCost,
    kilometers: changes.kilometers
  });
  if (travelFieldsEqual(base, nextTravel)) return { entry, changed: false };

  entry.final = {
    ...base,
    publicTransport: nextTravel.publicTransport,
    publicTransportCost: nextTravel.publicTransportCost,
    kilometers: nextTravel.kilometers
  };

  if (entryHasOpenNonTravelGaps(entry)) {
    if (entry.managerResolved === 'auto_ok' || entry.managerResolved === 'approved_as_reported' || entry.managerResolved === 'corrected') {
      entry.managerResolved = null;
    }
  } else {
    entry.managerResolved = 'corrected';
  }
  return { entry, changed: true };
}

/** Recompute daily reported km from entry finals after a travel edit; clear stale day decisions. */
export function refreshDailyKilometersAfterTravelChange(result, employeeId, date) {
  const id = txt(employeeId);
  const day = (result?.dailyKilometers || []).find((item) => txt(item.employeeId) === id && item.date === date);
  if (!day) return day;
  const entries = [...(result?.comparisons || []), ...(result?.notCompared || [])]
    .filter((entry) => txt(entry.attendance?.employeeId) === id && entry.attendance?.date === date);
  const reported = Math.round(entries.reduce((sum, entry) => {
    const row = entry.final || entry.attendance || {};
    return sum + (optionalNumber(row.kilometers) || 0);
  }, 0) * 100) / 100;
  const hasReportedKm = entries.some((entry) => optionalNumber((entry.final || entry.attendance || {}).kilometers) != null);
  day.reported = reported;
  day.hasReportedKm = hasReportedKm;
  day.matches = day.calculated != null && (!hasReportedKm || Math.abs(reported - day.calculated) <= DAILY_KM_TOLERANCE);
  day.managerResolved = 'auto_ok';
  if (Object.prototype.hasOwnProperty.call(day, 'correctedKm')) delete day.correctedKm;
  return day;
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

function hasTrainingScheduleCandidate(attendance, dashboardRows = []) {
  if (!isTrainingAttendanceType(attendance?.activityType)) return false;
  const employeeId = txt(attendance.employeeId);
  const date = txt(attendance.date);
  return (dashboardRows || []).some((row) => row?.__trainingSchedule
    && txt(row.employeeId) === employeeId
    && txt(row.date) === date);
}

export function compareAttendanceRows(attendanceRows, dashboardRows, options = {}) {
  const identityContext = options.identityContext
    || dashboardRows?.__payrollIdentityContext
    || buildPayrollIdentityContext({ dashboardRows: dashboardRows || [] });
  const attendanceOnly = (attendanceRows || []).filter((row) =>
    isAttendanceOnlyActivityType(row.activityType)
      && !(isTrainingAttendanceType(row.activityType) && hasTrainingScheduleCandidate(row, dashboardRows))
  );
  const attendanceOnlySet = new Set(attendanceOnly);
  const comparableAttendance = (attendanceRows || []).filter((row) => !attendanceOnlySet.has(row));
  const attendanceIds = new Set((attendanceRows || []).map((row) => txt(row.employeeId)).filter(Boolean));
  const dashboardSourcePopulation = (dashboardRows || []).filter((row) => attendanceIds.has(txt(row.employeeId)));
  const dashboardPopulation = aggregateDashboardAttendanceRows(dashboardSourcePopulation);
  dashboardPopulation.sourceRowCount = dashboardRows?.sourceRowCount ?? dashboardSourcePopulation.filter((row) => !row.__profile).length;
  const buckets = new Map();
  dashboardPopulation.filter((row) => !row.__routeOnly).forEach((row) => {
    const key = `${txt(row.employeeId)}|${row.date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  });
  const used = new Set(); const assignments = new Map(); const attendanceBuckets = new Map();

  // Planned training is identified by employee + training date before generic score matching.
  // The planned hours may differ substantially from the instructor report; that difference is
  // exactly what the manager must review and must not cause the plan itself to be discarded.
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    if (!isTrainingAttendanceType(attendance.activityType)) return;
    const candidates = dashboardPopulation.filter((row) => row?.__trainingSchedule
      && !used.has(row)
      && txt(row.employeeId) === txt(attendance.employeeId)
      && txt(row.date) === txt(attendance.date));
    if (!candidates.length) return;
    const program = normalizeAttendanceName(attendance.program);
    const exactProgram = program
      ? candidates.filter((row) => normalizeAttendanceName(row.program) === program)
      : [];
    const pool = exactProgram.length ? exactProgram : candidates;
    if (pool.length !== 1) return;
    const candidate = pool[0];
    assignments.set(attendanceIndex, {
      bundle: candidate,
      componentRows: [candidate],
      score: 100,
      identity: 'trainingPlan'
    });
    used.add(candidate);
  });

  // Prefer the stable activity row id supplied by attendance. The dashboard date can differ
  // from the actual attendance date, so meeting number is used to disambiguate repetitions.
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    const activityId = txt(attendance.activityId);
    if (!activityId) return;
    const candidates = dashboardPopulation.filter((row) => !row.__profile && !row.__routeOnly
      && !used.has(row)
      && txt(row.employeeId) === txt(attendance.employeeId)
      && txt(row.activityId) === activityId);
    if (!candidates.length) return;
    const sameDate = candidates.filter((row) => row.date === attendance.date);
    const expectedMeetings = parseMeetingNumberList(attendance.meetingNo);
    const meetingMatches = expectedMeetings.length
      ? candidates.filter((row) => expectedMeetings.some((meetingNo) => dashboardMeetingNumbers(row).includes(meetingNo)))
      : [];
    const pool = sameDate.length ? sameDate : (meetingMatches.length ? meetingMatches : candidates);
    if (pool.length !== 1) return;
    const candidate = pool[0];
    assignments.set(attendanceIndex, { bundle: candidate, componentRows: [candidate], score: 100, identity: 'activityId' });
    used.add(candidate);
  });

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
      const attendanceValue = key === 'workHours' ? rowWorkHours(attendance) : type === 'activityType' ? activityTypeDisplayLabel(attendance[key]) : attendance[key];
      const dashboardValue = key === 'workHours' ? rowWorkHours(dashboard) : type === 'activityType' ? activityTypeDisplayLabel(dashboard[key]) : dashboard[key];
      if (dashboard?.__trainingSchedule && ['school', 'authority', 'meetingNo', 'expenses'].includes(key)) return [];
      if (key === 'kilometers') {
        const attendanceKm = optionalNumber(attendanceValue);
        const dashboardKm = optionalNumber(dashboardValue);
        if (attendanceKm == null && dashboardKm == null) return [];
        if (attendanceKm != null && dashboardKm != null && Math.abs(attendanceKm - dashboardKm) <= DAILY_KM_TOLERANCE) return [];
      } else if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
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
      // Attendance may carry a decorated display label (program + school + authority), while
      // the dashboard keeps the canonical program name. A stable activity id proves these
      // values belong to the same activity, so the display decoration is not a real mismatch.
      if (key === 'program' && hasActivityIdMatch(attendance, dashboard)) return [];
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
      && !hasReviewExpense(attendance);
    return {
      id: `row-${attendanceIndex}`, attendance, dashboard, final, differences,
      unmatched: !dashboard, matchScore: match?.score ?? null,
      managerResolved: autoOk ? 'auto_ok' : null
    };
  });
  const dashboardOnly = dashboardPopulation
    .filter((row) => !row.__profile && !row.__routeOnly && row.date && !used.has(row))
    .map((dashboard, index) => ({
      id: `dashboard-only-${index}`,
      source: 'dashboard_only',
      dashboard,
      final: { ...dashboard },
      includeInFinal: false
    }));
  const notCompared = attendanceOnly.map((attendance, index) => ({
    id: `attendance-only-${index}`, source: 'attendance_not_compared', attendance,
    final: { ...attendance }, differences: [], excludedFromActivityComparison: true,
    managerResolved: generatedTravelCancellationIsSystemResolved(attendance) ? 'auto_ok' : null
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
    // Legacy aggregate retained for diagnostics only. Kilometer approval is per record.
    dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok' });
  });
  return { comparisons, notCompared, dashboardOnly, dashboardPopulation, dailyKilometers };
}

export function setDashboardOnlyChoice(entry, includeInFinal) {
  if (entry?.source === 'dashboard_only') entry.includeInFinal = Boolean(includeInFinal);
  return entry;
}

export function applyAttendanceChoice(comparison, field, choice, custom = '') {
  comparison.managerRecordApproved = false;
  const difference = comparison.differences.find((item) => item.key === field);
  if (!difference) return comparison;
  difference.choice = choice; difference.custom = custom; difference.decided = true;
  const value = choice === 'dashboard' ? difference.dashboard : choice === 'custom' ? custom : difference.attendance;
  comparison.final[field] = difference.type === 'number' || difference.type === 'money' ? optionalNumber(value) : value;
  if (field === 'startTime' || field === 'endTime') {
    comparison.final.workHours = calculateWorkHours(comparison.final.startTime, comparison.final.endTime);
  }
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
  assign(['date', 'attendanceDate', 'AttendanceDate'], final.date);
  assign(['startTime', 'StartTime', 'start'], final.startTime);
  assign(['endTime', 'EndTime', 'end'], final.endTime);
  assign(['workHours', 'WorkHours', 'hours'], rowWorkHours(final) ?? optionalNumber(final.workHours));
  assign(['activityType', 'ActivityType', 'activity'], final.activityType);
  assign(['schoolName', 'SchoolName', 'school'], final.school);
  assign(['municipality', 'Municipality', 'authority'], final.authority);
  assign(['programName', 'ProgramName', 'program'], final.program);
  assign(['sessionNumber', 'SessionNumber', 'session'], final.meetingNo);
  assign(['kilometers', 'Kilometers', 'km'], final.kilometers);
  assign(['publicTransport', 'PublicTransport', 'public_transport'], final.publicTransport);
  assign(['publicTransportCost', 'PublicTransportCost', 'public_transport_cost'], final.publicTransportCost);
  assign(['totalExpenses', 'TotalExpenses', 'expenses'], final.expenses);
  assign(['expensesDetails', 'ExpensesDetails', 'expenseDetails'], final.expenseDetails);
  assign(['notes', 'Notes'], final.notes);
  assign(['attachmentsNames', 'AttachmentsNames'], final.attachmentsNames);
  assign(['ID', 'Id', 'id', 'activityId'], final.activityId);
  if (final.employmentType) assign(['employmentType', 'EmploymentType'], final.employmentType);
  return merged;
}

function exportDuration(value) {
  const hours = optionalNumber(value);
  return hours == null ? '' : formatDurationHours(hours);
}

function exportRecordId(row = {}, source = {}) {
  const raw = source || {};
  return txt(
    row.recordId || row.ID || row.Id || row.id
    || raw.recordId || raw.ID || raw.Id || raw.id
  );
}

function exportGenerationKind(row = {}, source = {}) {
  const raw = source || {};
  return txt(row.generationKind || row.generation_kind || raw.generationKind || raw.generation_kind);
}

function exportSourceRecordId(row = {}, source = {}) {
  const raw = source || {};
  return txt(
    row.sourceAttendanceRecordId || row.source_attendance_record_id
    || raw.sourceAttendanceRecordId || raw.source_attendance_record_id
  );
}

function exportCancellationHours(row = {}, source = {}) {
  const raw = source || {};
  const minutes = optionalNumber(
    row.finalCancellationMinutes ?? row.final_cancellation_minutes
    ?? raw.finalCancellationMinutes ?? raw.final_cancellation_minutes
  );
  if (minutes != null) return minutes / 60;
  return rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours);
}

function prepareAttendanceExportRows(entries = [], employment = new Map()) {
  const normalized = entries.map((entry) => {
    const final = {
      ...(entry.final || {}),
      employmentType: employment.get(txt(entry.final?.employeeId || entry.attendance?.employeeId))
        || txt(entry.final?.employmentType || entry.attendance?.employmentType)
    };
    const source = entry.attendance?._source || entry.final?._source || null;
    const row = mergeFinalIntoSource(final, source);
    if (final.employmentType && !txt(row.employmentType || row.EmploymentType)) {
      row.employmentType = final.employmentType;
    }
    return {
      row,
      source: source || {},
      recordId: exportRecordId(row, source),
      generationKind: exportGenerationKind(row, source),
      sourceRecordId: exportSourceRecordId(row, source),
      cancellationHours: exportCancellationHours(row, source)
    };
  });

  const sourceIds = new Set(
    normalized
      .filter((item) => item.generationKind !== 'travel_time_cancellation')
      .map((item) => item.recordId)
      .filter(Boolean)
  );
  const cancellationBySource = new Map();
  for (const item of normalized) {
    if (item.generationKind !== 'travel_time_cancellation' || !item.sourceRecordId || !sourceIds.has(item.sourceRecordId)) continue;
    cancellationBySource.set(
      item.sourceRecordId,
      (cancellationBySource.get(item.sourceRecordId) || 0) + (item.cancellationHours || 0)
    );
  }

  const detailRows = normalized
    .filter((item) => item.generationKind !== 'travel_time_cancellation' || !item.sourceRecordId || !sourceIds.has(item.sourceRecordId))
    .map((item) => ({
      ...item.row,
      __cancellationHours: item.generationKind === 'travel_time_cancellation'
        ? null
        : (cancellationBySource.get(item.recordId) ?? null)
    }));

  return {
    allRows: normalized.map((item) => item.row),
    detailRows
  };
}

export function detailRowValues(row) {
  const publicTransport = row?.publicTransport === true
    || row?.PublicTransport === true
    || row?.public_transport === true
    || row?.publicTransport === 'true'
    || row?.public_transport === 'true';
  const attachmentsNames = txt(
    row?.attachmentsNames
    || row?.AttachmentsNames
    || (Array.isArray(row?.attachments)
      ? row.attachments.map((item) => txt(item?.fileName || item?.file_name || item?.name)).filter(Boolean).join(', ')
      : '')
  );
  return [
    txt(row.employeeId || row.EmployeeId || row.empNum), txt(row.employeeName || row.EmployeeName || row.empName),
    excelDate(row.date || row.attendanceDate || row.AttendanceDate), timeText(row.startTime || row.StartTime),
    timeText(row.endTime || row.EndTime), exportDuration(rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours)),
    exportDuration(row.__cancellationHours),
    lookupText(row.activityType || row.ActivityType), txt(row.school || row.schoolName || row.SchoolName),
    txt(row.authority || row.municipality || row.Municipality), txt(row.program || row.programName || row.ProgramName),
    txt(row.meetingNo || row.sessionNumber || row.SessionNumber), optionalNumber(row.kilometers ?? row.Kilometers) ?? '',
    publicTransport ? 'כן' : 'לא',
    optionalNumber(row.publicTransportCost ?? row.PublicTransportCost ?? row.public_transport_cost) ?? '',
    optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) ?? '',
    txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails), txt(row.notes || row.Notes),
    attachmentsNames
  ];
}

export function buildCorrectedAttendanceWorkbook(comparisons, dashboardRows = [], options = {}) {
  const employment = new Map((dashboardRows || []).map((row) => [txt(row.employeeId), txt(row.employmentType)]));
  const entries = (comparisons || []).filter((entry) => entry.source !== 'dashboard_only');
  const { allRows: mergedRows, detailRows } = prepareAttendanceExportRows(entries, employment);
  const detailSheet = styledSheet(
    DETAIL_HEADERS,
    detailRows.map(detailRowValues),
    [12, 18, 12, 11, 11, 11, 11, 14, 20, 16, 22, 11, 12, 14, 18, 12, 24, 24, 22]
  );
  const monthlyMap = new Map();
  mergedRows.filter((row) => normalizeAttendanceName(lookupText(row.employmentType || row.EmploymentType)).includes(normalizeAttendanceName('תעשיידע'))).forEach((row) => {
    const key = txt(row.employeeId || row.EmployeeId); if (!monthlyMap.has(key)) monthlyMap.set(key, { name: txt(row.employeeName || row.EmployeeName), id: key, hours: Array(8).fill(0), km: 0, expenses: 0, details: [] });
    const item = monthlyMap.get(key); const hours = rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours) ?? 0;
    const bucket = activityBucket(lookupText(row.activityType || row.ActivityType)); if (bucket >= 0) item.hours[bucket] += hours;
    item.km += optionalNumber(row.kilometers ?? row.Kilometers) || 0; item.expenses += optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) || 0;
    const details = txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails); if (details) item.details.push(details);
  });
  const monthly = [...monthlyMap.values()].map((item) => [item.name, item.id, ...item.hours.map(exportDuration), item.km, item.expenses, [...new Set(item.details)].join('; ')]);
  const daily = detailRows.map((row) => [
    excelDate(row.date || row.attendanceDate || row.AttendanceDate), txt(row.employeeName || row.EmployeeName), txt(row.employeeId || row.EmployeeId),
    lookupText(row.activityType || row.ActivityType), txt(row.authority || row.municipality || row.Municipality),
    timeText(row.startTime || row.StartTime), timeText(row.endTime || row.EndTime),
    exportDuration(rowWorkHours(row) ?? optionalNumber(row.workHours ?? row.WorkHours)),
    exportDuration(row.__cancellationHours),
    optionalNumber(row.kilometers ?? row.Kilometers) ?? '', optionalNumber(row.expenses ?? row.totalExpenses ?? row.TotalExpenses) ?? '',
    txt(row.expenseDetails || row.expensesDetails || row.ExpensesDetails)
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'פירוט מלא');
  XLSX.utils.book_append_sheet(workbook, styledSheet(MONTHLY_HEADERS, monthly), 'סיכום חודשי');
  XLSX.utils.book_append_sheet(workbook, styledSheet(DAILY_HEADERS, daily, [12, 18, 12, 14, 16, 11, 11, 11, 11, 12, 12, 24]), 'תצוגה יומית');
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

function formatTravelMinutesClock(value) {
  const totalMinutes = Math.max(0, Math.round(Number(value) || 0));
  return Math.floor(totalMinutes / 60) + ':' + String(totalMinutes % 60).padStart(2, '0');
}

function travelCompensationDisplay(source = {}) {
  const status = txt(source.travelCalculationStatus);
  if (!status) return [];
  if (status === 'resolved') {
    const rows = [
      ['זמן נסיעה הלוך', formatTravelMinutesClock(source.outboundTravelMinutes)],
      ['זמן נסיעה חזור', formatTravelMinutesClock(source.returnTravelMinutes)],
      ['ביטול זמן', formatTravelMinutesClock(source.finalCancellationMinutes)],
      ['מקור חישוב', 'מחושב אוטומטית לפי זמן הנסיעה']
    ];
    if (source.manuallyOverridden && source.calculatedCancellationMinutes != null) {
      rows.push(['ביטול זמן מחושב במקור', formatTravelMinutesClock(source.calculatedCancellationMinutes)]);
    }
    return rows;
  }
  if (status === 'pending') return [['ביטול זמן', 'ממתין לחישוב זמן הנסיעה']];
  if (status === 'unavailable') {
    const reason = txt(source.travelFailureCode);
    const label = reason === 'instructor_address_missing'
      ? 'לא ניתן לחשב – חסרה כתובת מדריך'
      : reason === 'destination_address_missing'
        ? 'לא ניתן לחשב – חסרה כתובת יעד'
        : 'חישוב זמן הנסיעה לא זמין';
    return [['ביטול זמן', label]];
  }
  return [];
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
    km: sum('kilometers'), expenses: sum('expenses')
  };
}

export function filterAttendanceControlScopeRows(rows = [], { selectedTeam = '', selectedInstructor = '' } = {}) {
  const instructorId = txt(selectedInstructor);
  return (rows || [])
    .filter((row) => {
      if (selectedTeam === '__all__') return true;
      return txt(row.team) === txt(selectedTeam);
    })
    .filter((row) => !instructorId || txt(row.employeeId) === instructorId);
}

export function attendanceControlHtml() {
  return `<section class="attendance-control no-print" data-attendance-control hidden dir="rtl"><div class="attendance-control__head"><div><h2 data-attendance-title>בקרת נוכחות</h2></div><button type="button" class="ds-btn ds-btn--sm" data-attendance-close>סגירה</button></div><div class="attendance-control__uploads"><label><strong>חודש בקרה</strong><span>בחר חודש</span><input class="ds-input" type="month" data-attendance-month></label><label><strong>צוות</strong><select class="ds-input" data-attendance-team disabled><option value="">טוען צוותים…</option></select></label><label data-attendance-instructor-wrap hidden><strong>מדריך</strong><select class="ds-input" data-attendance-instructor disabled><option value="">כל המדריכים</option></select></label><button type="button" class="ds-btn ds-btn--primary" data-attendance-run disabled>אישור בקרת נוכחות</button></div><p class="attendance-control__status" data-attendance-status aria-live="polite"></p><div data-attendance-results></div></section>`;
}

export function attendanceControlStylesHtml() {
  return `<style id="attendance-control-styles">
.attendance-control{margin:16px auto;padding:20px;max-width:1220px;border:1px solid #d8e2ee;border-radius:18px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.06);color:#183153}
.attendance-control__head,.attendance-control__uploads,.attendance-control__metrics,.attendance-control__employee-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.attendance-control__head{justify-content:space-between}.attendance-control__head h2{margin:0;font-size:1.45rem}.attendance-control__head p{margin:4px 0;color:#64748b}
.attendance-control__uploads{margin:16px 0;padding:14px;background:#f7fafc;border:1px solid #e4ebf3;border-radius:12px}.attendance-control__uploads label{display:grid;gap:6px;min-width:210px;flex:1}.attendance-control__uploads .ds-input{min-height:40px}.attendance-control__status{color:#64748b;font-weight:700}.attendance-control__status.is-error{color:#b91c1c}
.attendance-control__overview{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0 16px}.attendance-control__overview-card{min-height:82px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:12px;border:1px solid #dfe8f2;border-radius:14px;background:linear-gradient(180deg,#fff,#f8fbff);box-shadow:0 4px 12px rgba(15,23,42,.035)}.attendance-control__overview-card span{font-size:.82rem;color:#64748b;font-weight:700}.attendance-control__overview-card strong{margin-top:5px;font-size:1.32rem;color:#183153}
.attendance-control__summary-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 12px}.attendance-control__summary-bar span{padding:7px 11px;border:1px solid #dbe5ef;border-radius:999px;background:#fff;font-size:.88rem}.attendance-control__metrics-details{margin:6px 0 12px}.attendance-control__metrics-details>summary{cursor:pointer;color:#64748b;font-size:.9em;padding:4px 2px}.attendance-control__metrics{margin:6px 0;display:flex;flex-wrap:wrap;gap:8px}.attendance-control__metrics>span,.attendance-control__employee-summary>span{padding:8px 10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
.attendance-control__employee{margin:12px 0;border:1px solid #dbe5ef;border-radius:14px;background:#fff;overflow:hidden}.attendance-control__employee>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:13px 15px;cursor:pointer;font-size:1.02em;background:#fbfdff}.attendance-control__employee-record-progress{font-size:.86rem;color:#64748b;font-weight:700}.attendance-control__employee-days{padding:0 14px 14px}.attendance-control__employee-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 14px 10px}.attendance-control__approved{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 14px 10px;padding:8px 10px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:9px;color:#166534;font-weight:700}.attendance-control__approve-dialog{border:0;border-radius:12px;padding:20px;max-width:480px;color:#1f2a37}.attendance-control__approve-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.attendance-control__add-dialog{width:min(760px,calc(100vw - 32px));max-width:760px}.attendance-control__add-dialog h3{margin:0 0 6px}.attendance-control__add-dialog>p{margin:0 0 14px;color:#64748b}.attendance-control__add-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 12px}.attendance-control__add-grid label{display:grid;gap:5px;font-weight:700;color:#475569}.attendance-control__add-grid label>span{font-size:.82rem}.attendance-control__add-grid .ds-input{width:100%;min-height:40px}.attendance-control__add-grid .attendance-control__add-wide{grid-column:1/-1}.attendance-control__add-error{margin:10px 0 0;color:#b91c1c;font-weight:700}.attendance-control__add-hint{margin:10px 0 0;color:#64748b;font-size:.84rem}@media(max-width:640px){.attendance-control__add-grid{grid-template-columns:1fr}.attendance-control__add-grid .attendance-control__add-wide{grid-column:auto}}
.attendance-control__day{margin-top:10px;border:1px solid #e4eaf1;border-radius:12px;overflow:hidden}.attendance-control__day>summary{display:grid;grid-template-columns:130px 130px minmax(100px,1fr);gap:12px;align-items:center;padding:11px 13px;cursor:pointer;background:#fafcff}.attendance-control__reports{padding:12px;background:#f6f9fc}.attendance-control__report{padding:0;border:1px solid #dfe7f0;border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 4px 12px rgba(15,23,42,.035)}.attendance-control__report+.attendance-control__report{margin-top:12px}.attendance-control__report-line{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 14px;border-bottom:1px solid #edf1f5;background:#fff}.attendance-control__report-line strong{font-size:1rem}.attendance-control__report-line-actions,.attendance-control__record-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.attendance-control__record-actions{justify-content:flex-end}.attendance-control__record-approved-indicator{display:inline-flex;align-items:center;min-height:32px;padding:0 10px;border-radius:8px;background:#ecfdf3;color:#166534;font-size:.86rem;font-weight:800}.attendance-control__identity{display:none}
.attendance-control__report-card{margin:12px 14px;padding:12px;border:1px solid #dce7f2;border-radius:12px;background:#f8fbff}.attendance-control__report-card-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;font-weight:800}.attendance-control__report-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px}.attendance-control__report-card-item{min-height:62px;display:flex;flex-direction:column;justify-content:center;padding:9px 10px;border:1px solid #e1e9f1;border-radius:10px;background:#fff}.attendance-control__report-card-item span{font-size:.76rem;color:#718096;font-weight:700}.attendance-control__report-card-item strong{margin-top:4px;font-size:.95rem;color:#1f3554;overflow-wrap:anywhere}
.attendance-control__report-meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:1px solid #e3eaf2;color:#53657a;font-size:.84rem}.attendance-control__report-meta strong{color:#334155}.attendance-control__report-meta span{padding:4px 7px;border-radius:999px;background:#eef4fa}
.attendance-control__reported-details{display:grid;gap:6px;margin-top:8px}.attendance-control__reported-details>div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;padding:7px 9px;border:1px solid #e7edf3;border-radius:8px;background:#fafcff}.attendance-control__reported-details span{color:#64748b;font-size:.82rem}.attendance-control__reported-details strong{color:#334155;font-size:.9rem;overflow-wrap:anywhere}.attendance-control__comparison-wrap--compact{padding:10px 12px;border:1px solid #e4eaf1;border-radius:10px;background:#fbfdff}
.attendance-control__comparison-wrap{margin:12px 14px}.attendance-control__comparison-title{display:flex;align-items:center;gap:7px;margin:0 0 8px;font-weight:800;color:#193b66}.attendance-control__comparison-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #dde6ef;border-radius:12px;overflow:hidden;background:#fff}.attendance-control__comparison-table th,.attendance-control__comparison-table td{padding:9px 11px;text-align:right;border-bottom:1px solid #e8edf3;vertical-align:middle}.attendance-control__comparison-table thead th{background:#f5f8fc;color:#52657b;font-size:.83rem;font-weight:800}.attendance-control__comparison-table tbody th{color:#44566d;font-size:.86rem;width:20%}.attendance-control__comparison-table tr:last-child th,.attendance-control__comparison-table tr:last-child td{border-bottom:0}.attendance-control__comparison-row--issue th,.attendance-control__comparison-row--issue td{background:transparent}.attendance-control__comparison-row--info th,.attendance-control__comparison-row--info td{background:#f7fbff}.attendance-control__comparison-table select,.attendance-control__comparison-table input{min-height:34px;max-width:150px}.attendance-control__manual-table{width:100%}.attendance-control__manual-table tbody th{width:34%}
.attendance-control__parameter-table tbody th{width:16%}.attendance-control__parameter-table td:nth-child(2),.attendance-control__parameter-table td:nth-child(3){width:18%}.attendance-control__parameter-table td:nth-child(4){width:13%}.attendance-control__actions-cell{width:35%}.attendance-control__row-actions{display:grid;gap:6px}.attendance-control__row-action-buttons{display:flex;gap:5px;flex-wrap:wrap}.attendance-control__row-action-buttons .ds-btn{min-height:30px;padding:5px 8px;font-size:.78rem}.attendance-control__row-action-buttons .ds-btn.is-selected{border-color:#2d7ea3;background:#eaf7fb;color:#0b617d;font-weight:800}.attendance-control__row-custom{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.attendance-control__row-custom[hidden]{display:none}.attendance-control__row-custom:not([hidden]){margin-top:4px}.attendance-control__row-custom .ds-input{width:130px}.attendance-control__row-decision{color:#466174;font-weight:700}.attendance-control__no-action,.attendance-control__empty-source{color:#94a3b8}.attendance-control__comparison-row--resolved th,.attendance-control__comparison-row--resolved td{background:#f5fbf7}
.attendance-control__travel-cancellation-row th,.attendance-control__travel-cancellation-row td{border-top:2px solid #dce7ef}.attendance-control__travel-cancellation-row th{color:#0f6078}.attendance-control__row-actions--compact .attendance-control__row-custom{margin-top:0}
.attendance-control__status-pill{display:inline-flex;align-items:center;justify-content:center;min-width:72px;padding:4px 8px;border-radius:999px;font-size:.78rem;font-weight:800;white-space:nowrap}.attendance-control__status-pill--ok{color:#137a45;background:#eaf8f0}.attendance-control__status-pill--issue{color:#b91c1c;background:transparent;min-width:0;padding:0;border-radius:0}.attendance-control__status-pill--info{color:#316da8;background:#eaf4ff}.attendance-control__row-status{font-weight:800;white-space:nowrap;color:#24824d}.attendance-control__row-status--issue,.attendance-control__field-value--issue{color:#b91c1c!important}.attendance-control__field-value--issue{font-weight:800}.attendance-control__missing-match{margin:8px 14px;color:#b91c1c;font-weight:800}.attendance-control__manual-note{margin:4px 0;color:#64748b;font-size:.9em}
.attendance-control__record-edit-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:12px 14px 14px;padding-top:12px;border-top:1px solid #edf1f5}.attendance-control__record-edit-footer .attendance-control__record-edit-pending{margin-inline-end:auto;color:#316da8;font-weight:800}.attendance-control__record-edit-footer .ds-btn{min-height:36px}
.attendance-control__manager-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin:12px 14px 14px;padding-top:12px;border-top:1px solid #edf1f5}.attendance-control__manager-actions>.ds-btn{min-height:36px}.attendance-control__manager-actions>.ds-input{width:160px;min-height:36px}.attendance-control__travel-edit{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;width:100%}.attendance-control__travel-edit label{min-height:36px;display:flex;align-items:center;gap:6px;padding:0 8px;border:1px solid #dbe4ee;border-radius:8px;background:#fff}.attendance-control__travel-edit .ds-input{width:150px;min-height:36px}.attendance-control__attachments{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 14px 12px;color:#334155;font-size:.9em}.attendance-control__resolved-note{margin:0;color:#166534;font-weight:800}.attendance-control__report-km{margin:4px 0 8px;color:#475569;font-size:.92em}.attendance-control__day-km{padding:0 10px 6px;color:#475569;font-size:.92em}.attendance-control__export{margin-top:14px}
@media(max-width:900px){.attendance-control{padding:12px}.attendance-control__day>summary{grid-template-columns:1fr 1fr auto}.attendance-control__reports{padding:8px}.attendance-control__comparison-wrap{overflow-x:auto;margin-inline:8px}.attendance-control__comparison-table{min-width:820px}.attendance-control__report-card{margin-inline:8px}.attendance-control__manager-actions{margin-inline:8px}.attendance-control__report-card-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){.attendance-control__uploads label{min-width:100%}.attendance-control__overview{grid-template-columns:repeat(2,minmax(0,1fr))}.attendance-control__day>summary{grid-template-columns:1fr auto}.attendance-control__day>summary .attendance-control__row-status{grid-column:1/-1}.attendance-control__report-card-grid{grid-template-columns:1fr 1fr}.attendance-control__manager-actions{justify-content:stretch}.attendance-control__manager-actions>.ds-btn,.attendance-control__manager-actions>.ds-input,.attendance-control__travel-edit .ds-input,.attendance-control__travel-edit .ds-btn{flex:1 1 100%;width:100%}.attendance-control__travel-edit label{width:100%;box-sizing:border-box}}
</style>`;
}

export function resultsHtml(result, month = '', options = {}) {
  const totals = attendanceAuditSummary(result);
  const workflowByEmployee = options.workflowByEmployee || {};
  const bypassMonthSubmissionGate = Boolean(options.bypassMonthSubmissionGate);
  let currentEmployeeCanMutate = true;
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
  const allAttendanceEntries = [...(result.comparisons || []), ...(result.notCompared || [])];
  const entryRecordId = (entry) => {
    const row = entry?.attendance || entry?.final || {};
    const source = row?._source || {};
    return txt(row.recordId || source.recordId || source.ID || source.Id || source.id);
  };
  const cancellationSourceRecordId = (entry) => {
    const row = entry?.attendance || entry?.final || {};
    const source = row?._source || {};
    return txt(source.sourceAttendanceRecordId || source.source_attendance_record_id || row.sourceAttendanceRecordId);
  };
  const sourceEntryIds = new Set(allAttendanceEntries.filter((entry) => !isAttendanceTravelTimeCancellation(entry)).map(entryRecordId).filter(Boolean));
  const generatedCancellationBySource = new Map();
  const foldedCancellationEntryIds = new Set();
  for (const entry of allAttendanceEntries) {
    if (!isAttendanceTravelTimeCancellation(entry)) continue;
    const sourceId = cancellationSourceRecordId(entry);
    if (!sourceId || !sourceEntryIds.has(sourceId)) continue;
    generatedCancellationBySource.set(sourceId, entry);
    foldedCancellationEntryIds.add(entry.id);
  }
  (result.comparisons || []).forEach((item) => {
    const row = item.final || item.attendance;
    addRow(row.employeeId || item.attendance.employeeId, row.employeeName || item.attendance.employeeName, row.date || item.attendance.date, row.startTime || item.attendance.startTime, 'comparison', item);
  });
  (result.notCompared || []).forEach((item) => {
    if (foldedCancellationEntryIds.has(item.id)) return;
    const row = item.final || item.attendance;
    addRow(row.employeeId || item.attendance.employeeId, row.employeeName || item.attendance.employeeName, row.date || item.attendance.date, row.startTime || item.attendance.startTime, 'attendance', item);
  });

  const dateLabel = (value) => {
    const match = txt(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}.${match[2]}.${match[1]}` : txt(value);
  };
  const shown = (value, fallback = '—') => escapeHtml(txt(value) || fallback);
  const hasValue = (value) => value != null && txt(value) !== '';
  const hasMeaningfulValue = (value) => {
    if (!hasValue(value)) return false;
    if (typeof value === 'boolean') return value;
    const raw = txt(value);
    const numeric = Number(raw.replace(/[₪,\s]/g, ''));
    if (Number.isFinite(numeric)) return numeric !== 0;
    return !['לא', 'false'].includes(raw.toLowerCase());
  };
  const dayKmMap = new Map((result.dailyKilometers || []).map((day) => [`${txt(day.employeeId)}|${day.date}`, day]));
  const dayKmInfo = (employeeId, date) => dayKmMap.get(`${txt(employeeId)}|${date}`) || null;
  const dayKmIssue = (employeeId, date) => {
    const day = dayKmInfo(employeeId, date);
    if (!day) return false;
    if (day.managerResolved === 'auto_ok' || day.managerResolved === 'approved_as_reported' || day.managerResolved === 'corrected') return false;
    if (day.calculated == null) return Boolean(day.hasReportedKm);
    return day.hasReportedKm !== false && !day.matches;
  };
  const comparisonHasIssue = (comparison) => {
    if (!comparison) return false;
    if (attendanceEntryIsResolved(comparison)) return false;
    if (comparison.unmatched) return true;
    if ((comparison.differences || []).some((difference) => !difference.decided)) return true;
    if (hasReviewExpense(comparison.attendance)
      && comparison.managerResolved !== 'approved_as_reported'
      && comparison.managerResolved !== 'corrected') return true;
    return false;
  };
  const entryResolvedLabel = (entry) => {
    if (entry.managerResolved === 'approved_as_reported') return 'אושר כפי שדווח';
    if (entry.managerResolved === 'corrected') return 'תוקן על ידי המנהל';
    return '';
  };
  const dayKmLineForReport = () => '';
  const managerActionsHtml = () => '';
  const attachmentsHtml = (row) => {
    const attachments = normalizeAttendanceAttachments(row?.attachments || row?._source?.attachments, row?.attachmentsNames || row?._source?.attachmentsNames);
    if (!attachments.length) return '';
    const links = attachments.map((item, index) => {
      const label = escapeHtml(item.fileName || `קובץ ${index + 1}`);
      if (!item.storagePath) return `<span>${label}</span>`;
      return `<button type="button" class="ds-btn ds-btn--sm" data-attendance-open-attachment="${escapeHtml(item.storagePath)}">${label}</button>`;
    }).join(' ');
    return `<div class="attendance-control__attachments"><strong>אסמכתאות:</strong> ${links}</div>`;
  };
  const identityHtml = (row, { compactCancellation = false } = {}) => {
    const fields = compactCancellation
      ? [activityTypeDisplayLabel(row.activityType), row.program]
      : [activityTypeDisplayLabel(row.activityType), row.program, row.school, row.authority, hasValue(row.meetingNo) ? `מפגש ${row.meetingNo}` : ''];
    const visible = fields.filter(hasValue);
    return visible.length ? `<div class="attendance-control__identity">${visible.map(shown).join(' | ')}</div>` : '';
  };
  const travelSummaryHtml = (row, entry, { includeCancellation = true } = {}) => {
    const current = entry?.final || row || {};
    const source = row?._source
      || current?._source
      || entry?.attendance?._source
      || entry?._source
      || {};
    const parts = [];
    if (asBoolean(current.publicTransport)) {
      const cost = optionalNumber(current.publicTransportCost);
      parts.push(cost != null && cost > 0 ? `תחבורה ציבורית · ${cost} ₪` : 'תחבורה ציבורית');
    } else {
      const km = optionalNumber(current.kilometers);
      if (km != null && km > 0) parts.push(`${km} ק״מ`);
    }
    travelCompensationDisplay(source).forEach(([label, value]) => {
      if (!includeCancellation && label.startsWith('ביטול זמן')) return;
      if (hasValue(value)) parts.push(`${label}: ${value}`);
    });
    return parts.length
      ? `<div class="attendance-control__report-meta"><strong>נסיעות</strong>${parts.map((part) => `<span>${shown(part)}</span>`).join('')}</div>`
      : '';
  };

  const decisionLabel = (difference, dashboardLabel) => {
    if (!difference?.decided) return '';
    if (difference.choice === 'dashboard') return `נבחר: ${dashboardLabel}`;
    if (difference.choice === 'custom') return 'נבחר: ערך מתוקן';
    return 'נבחר: דיווח נוכחות';
  };

  const fieldActionsHtml = (entry, key, difference, { hasSystemValue = false, dashboardLabel = 'דשבורד' } = {}) => {
    if (!difference) return '<span class="attendance-control__no-action">—</span>';
    if (!currentEmployeeCanMutate) {
      const selected = decisionLabel(difference, dashboardLabel);
      return selected
        ? `<small class="attendance-control__row-decision">${escapeHtml(selected)}</small>`
        : '<span class="attendance-control__no-action">—</span>';
    }
    const selected = decisionLabel(difference, dashboardLabel);
    const approved = attendanceEntryIsResolved(entry);
    return `<div class="attendance-control__row-actions">
      <div class="attendance-control__row-action-buttons">
        <button type="button" class="ds-btn ds-btn--sm${difference.decided && difference.choice === 'attendance' ? ' is-selected' : ''}" data-attendance-field-choice="attendance" data-comparison-id="${escapeHtml(entry.id)}" data-field-key="${escapeHtml(key)}">אישור נוכחות</button>
        ${hasSystemValue ? `<button type="button" class="ds-btn ds-btn--sm${difference.decided && difference.choice === 'dashboard' ? ' is-selected' : ''}" data-attendance-field-choice="dashboard" data-comparison-id="${escapeHtml(entry.id)}" data-field-key="${escapeHtml(key)}">אישור ${escapeHtml(dashboardLabel)}</button>` : ''}
      </div>
      ${selected ? `<small class="attendance-control__row-decision">${escapeHtml(selected)}</small>` : ''}
    </div>`;
  };

  const MANUAL_EDITABLE_FIELDS = new Set([
    'date', 'activityType', 'authority', 'school', 'program', 'meetingNo',
    'startTime', 'endTime', 'workHours', 'expenses', 'expenseDetails', 'notes'
  ]);
  const TRAVEL_EDITABLE_FIELDS = new Set(['publicTransport', 'publicTransportCost', 'kilometers']);

  const manualFieldInputMeta = (key, value) => {
    if (key === 'date') return { type: 'date', value: txt(value) };
    if (key === 'startTime' || key === 'endTime') return { type: 'time', value: timeText(value) };
    if (key === 'workHours') return { type: 'text', value: formatDurationHours(value), placeholder: 'למשל 1:30' };
    if (key === 'expenses' || key === 'publicTransportCost') return { type: 'number', value: optionalNumber(value) ?? '', step: '0.01', min: '0' };
    if (key === 'kilometers') return { type: 'number', value: optionalNumber(value) ?? '', step: '1', min: '0' };
    if (key === 'meetingNo') return { type: 'number', value: txt(value), step: '1', min: '1' };
    return { type: 'text', value: txt(value) };
  };

  const manualFieldActionsHtml = (entry, key, label, rawValue) => {
    if (!MANUAL_EDITABLE_FIELDS.has(key) && !TRAVEL_EDITABLE_FIELDS.has(key)) {
      return '<span class="attendance-control__no-action">—</span>';
    }
    if (!currentEmployeeCanMutate || entry?.__recordEditing !== true) {
      return '<span class="attendance-control__no-action">—</span>';
    }
    if (key === 'publicTransport') {
      const selected = asBoolean(rawValue);
      return `<div class="attendance-control__row-actions">
        <div class="attendance-control__row-custom" data-attendance-manual-edit-wrap>
          <select class="ds-input ds-input--sm" data-attendance-manual-input="${escapeHtml(entry.id)}" data-field-key="${escapeHtml(key)}" aria-label="עריכת ${escapeHtml(label)}">
            <option value="false"${selected ? '' : ' selected'}>לא</option>
            <option value="true"${selected ? ' selected' : ''}>כן</option>
          </select>
        </div>
      </div>`;
    }
    const meta = manualFieldInputMeta(key, rawValue);
    return `<div class="attendance-control__row-actions">
      <div class="attendance-control__row-custom" data-attendance-manual-edit-wrap>
        <input class="ds-input ds-input--sm" data-attendance-manual-input="${escapeHtml(entry.id)}" data-field-key="${escapeHtml(key)}"
          type="${meta.type}" value="${escapeHtml(String(meta.value ?? ''))}"${meta.placeholder ? ` placeholder="${escapeHtml(meta.placeholder)}"` : ''}${meta.step ? ` step="${meta.step}"` : ''}${meta.min ? ` min="${meta.min}"` : ''}
          aria-label="עריכת ${escapeHtml(label)}"${key === 'workHours' ? ' readonly aria-readonly="true"' : ''}>
      </div>
    </div>`;
  };

  const foldedTravelCancellationRowHtml = (entry) => {
    if (!entry) return '';
    const row = entry.final || entry.attendance || {};
    const source = row?._source || entry?.attendance?._source || {};
    const calculatedMinutes = source.calculatedCancellationMinutes;
    const finalMinutes = source.finalCancellationMinutes;
    const finalHours = rowWorkHours(row);
    const finalLabel = finalMinutes != null
      ? formatTravelMinutesClock(finalMinutes)
      : formatDurationHours(finalHours);
    const calculatedLabel = calculatedMinutes != null
      ? formatTravelMinutesClock(calculatedMinutes)
      : finalLabel;
    const approved = attendanceEntryIsResolved(entry);
    const overridden = source.manuallyOverridden === true;
    const calculationStatus = txt(source.travelCalculationStatus || source.travel_calculation_status).toLowerCase();
    const calculationIssue = Boolean(calculationStatus && calculationStatus !== 'resolved');
    const statusClass = approved
      ? 'attendance-control__status-pill--ok'
      : (calculationIssue ? 'attendance-control__status-pill--issue' : 'attendance-control__status-pill--info');
    const status = approved
      ? (overridden ? '✓ אושר תיקון' : '✓ אושר')
      : (calculationIssue ? 'לבדיקה' : 'ממתין לאישור');
    const actions = currentEmployeeCanMutate && !approved
      ? `<div class="attendance-control__row-actions attendance-control__row-actions--compact">
          <div class="attendance-control__row-action-buttons">
            <button type="button" class="ds-btn ds-btn--sm" data-attendance-approve-reported="${escapeHtml(entry.id)}">אישור רשומה</button>
          </div>
          <div class="attendance-control__row-custom">
            <input class="ds-input ds-input--sm" data-attendance-correct-hours="${escapeHtml(entry.id)}" type="number" min="0" step="0.01" placeholder="שעות מתוקנות" aria-label="ביטול זמן מתוקן">
            <button type="button" class="ds-btn ds-btn--sm" data-attendance-save-correction="${escapeHtml(entry.id)}">שמור תיקון</button>
          </div>
        </div>`
      : '<span class="attendance-control__no-action">—</span>';
    return `<tr class="${calculationIssue ? 'attendance-control__comparison-row--issue' : (approved ? 'attendance-control__comparison-row--resolved' : '')} attendance-control__travel-cancellation-row">
      <th>ביטול זמן נסיעה</th>
      <td>${shown(finalLabel)}</td>
      <td>${shown(calculatedLabel)}</td>
      <td><span class="attendance-control__status-pill ${statusClass}">${status}</span></td>
      <td class="attendance-control__actions-cell">${actions}</td>
    </tr>`;
  };

  const parameterReviewTable = (entry, { attendanceOnly = false, attachedCancellation = null } = {}) => {
    const attendance = entry?.attendance || {};
    const current = entry?.final || attendance;
    const editing = entry?.__recordEditing === true;
    const dashboard = attendanceOnly ? null : (entry?.dashboard || null);
    const trainingPlan = dashboard?.__trainingSchedule === true;
    const dashboardLabel = trainingPlan ? 'תכנון / מערכת' : 'דשבורד';
    const diffByKey = new Map((entry?.differences || []).map((diff) => [diff.key, diff]));
    const publicTransport = asBoolean(current.publicTransport);
    const publicTransportCost = optionalNumber(current.publicTransportCost);
    const attendanceKm = publicTransport ? null : optionalNumber(current.kilometers);
    const dashboardKm = publicTransport ? null : optionalNumber(dashboard?.kilometers);
    const attendanceExpenses = optionalNumber(current.expenses);
    const dashboardExpenses = optionalNumber(dashboard?.expenses);

    const displayRow = attendanceOnly ? current : attendance;
    const definitions = [
      { key: 'date', label: 'תאריך', left: dateLabel(displayRow.date), editValue: current.date, right: dashboard ? dateLabel(dashboard.date) : null, always: true },
      { key: 'activityType', label: 'סוג פעילות', left: activityTypeDisplayLabel(displayRow.activityType), editValue: current.activityType, right: dashboard ? activityTypeDisplayLabel(dashboard.activityType) : null, always: true },
      { key: 'authority', label: 'רשות / יישוב', left: displayRow.authority, editValue: current.authority, right: dashboard?.authority },
      { key: 'school', label: 'בית ספר / מיקום', left: displayRow.school, editValue: current.school, right: dashboard?.school },
      { key: 'program', label: 'תוכנית / קורס', left: displayRow.program, editValue: current.program, right: dashboard?.program },
      { key: 'meetingNo', label: 'מספר מפגש', left: displayRow.meetingNo, editValue: current.meetingNo, right: dashboard?.meetingNo },
      { key: 'startTime', label: 'שעת התחלה', left: displayRow.startTime, editValue: current.startTime, right: dashboard?.startTime, always: true },
      { key: 'endTime', label: 'שעת סיום', left: displayRow.endTime, editValue: current.endTime, right: dashboard?.endTime, always: true },
      { key: 'workHours', label: 'סה״כ שעות', left: displayWorkHours(current), editValue: rowWorkHours(current), right: dashboard ? displayDashboardWorkHours(dashboard) : null, always: true, autoCalculated: true },
      { key: 'publicTransport', label: 'תחבורה ציבורית', left: publicTransport ? 'כן' : 'לא', editValue: publicTransport, right: null, visible: publicTransport || (publicTransportCost != null && publicTransportCost > 0) },
      { key: 'publicTransportCost', label: 'עלות תחבורה ציבורית', left: publicTransportCost, editValue: publicTransportCost, right: null, visible: publicTransport || (publicTransportCost != null && publicTransportCost > 0) },
      { key: 'kilometers', label: 'ק״מ', left: attendanceKm, editValue: attendanceKm, right: dashboardKm, visible: !publicTransport },
      { key: 'expenses', label: 'הוצאות', left: attendanceExpenses, editValue: attendanceExpenses, right: dashboardExpenses, visible: (attendanceExpenses != null && attendanceExpenses > 0) || (dashboardExpenses != null && dashboardExpenses > 0) || diffByKey.has('expenses') },
      { key: 'expenseDetails', label: 'פירוט הוצאה', left: current.expenseDetails, editValue: current.expenseDetails, right: null, visible: (attendanceExpenses != null && attendanceExpenses > 0) && hasValue(current.expenseDetails) },
      { key: 'notes', label: 'הערות', left: current.notes, editValue: current.notes, right: null, visible: hasValue(current.notes) }
    ];

    const rows = definitions.filter((definition) => {
      if (editing && (MANUAL_EDITABLE_FIELDS.has(definition.key) || TRAVEL_EDITABLE_FIELDS.has(definition.key))) return true;
      if (definition.visible === true) return true;
      if (definition.visible === false) return false;
      if (definition.always) return true;
      if (diffByKey.has(definition.key)) return true;
      return hasValue(definition.left) || hasValue(definition.right);
    }).map((definition) => {
      const { key, label, left, right, editValue, autoCalculated = false } = definition;
      const related = diffByKey.get(key);
      const hasSystemValue = dashboard != null && right != null && txt(right) !== '';
      const systemMissing = dashboard != null && !hasSystemValue;
      const expenseIssue = key === 'expenses' && hasReviewExpense(attendance);
      const issue = !autoCalculated && (Boolean(related && !related.decided) || (expenseIssue && !related?.decided));

      let statusClass = 'attendance-control__status-pill--info';
      let status = 'תואם';
      if (autoCalculated) {
        statusClass = 'attendance-control__status-pill--info';
        status = 'מחושב אוטומטית';
      } else if (related?.decided) {
        statusClass = 'attendance-control__status-pill--ok';
        status = '✓ החלטה נשמרה';
      } else if (issue) {
        statusClass = 'attendance-control__status-pill--issue';
        status = 'לבדיקה';
      } else if (attendanceOnly && entry.managerResolved === 'corrected') {
        statusClass = 'attendance-control__status-pill--ok';
        status = '✓ תוקן';
      } else if (attendanceOnly || systemMissing || !dashboard) {
        statusClass = 'attendance-control__status-pill--info';
        status = 'מידע מהדיווח';
      } else {
        statusClass = 'attendance-control__status-pill--info';
        status = 'תואם';
      }

      const systemValue = autoCalculated
        ? (dashboard && hasSystemValue ? shown(right) : '<span class="attendance-control__empty-source">—</span>')
        : dashboard
          ? (hasSystemValue ? shown(right) : '<span class="attendance-control__empty-source">—</span>')
          : '<span class="attendance-control__empty-source">—</span>';
      const actionSourceLabel = trainingPlan && key === 'kilometers' ? 'חישוב מערכת' : (trainingPlan ? 'תכנון' : dashboardLabel);
      const editable = MANUAL_EDITABLE_FIELDS.has(key) || TRAVEL_EDITABLE_FIELDS.has(key);
      let actions = editing && editable
        ? manualFieldActionsHtml(entry, key, label, editValue)
        : related
          ? fieldActionsHtml(entry, key, related, { hasSystemValue, dashboardLabel: actionSourceLabel })
          : '<span class="attendance-control__no-action">—</span>';
      if (!editing && currentEmployeeCanMutate && (attendanceOnly || entry?.unmatched) && key === 'date' && !attendanceEntryIsResolved(entry)) {
        actions = `<div class="attendance-control__row-actions">
          <div class="attendance-control__row-action-buttons">
            <button type="button" class="ds-btn ds-btn--sm" data-attendance-approve-reported="${escapeHtml(entry.id)}">אישור נוכחות</button>
          </div>
        </div>${actions}`;
      }
      const rowClass = issue ? 'attendance-control__comparison-row--issue' : related?.decided ? 'attendance-control__comparison-row--resolved' : '';

      return `<tr class="${rowClass}"${related ? ` data-comparison="${escapeHtml(entry.id)}" data-field="${escapeHtml(key)}"` : ''}>
        <th>${escapeHtml(label)}</th>
        <td>${shown(left)}</td>
        <td>${systemValue}</td>
        <td><span class="attendance-control__status-pill ${statusClass}">${status}</span></td>
        <td class="attendance-control__actions-cell">${actions}</td>
      </tr>`;
    }).join('');

    const title = attendanceOnly
      ? 'פרטי הדיווח לבקרה'
      : trainingPlan ? 'בדיקת ההכשרה מול התכנון' : 'בדיקת הרשומה מול הדשבורד';
    const cancellationRow = foldedTravelCancellationRowHtml(attachedCancellation);
    const sourceHeading = attachedCancellation && attendanceOnly ? 'חישוב מערכת' : dashboardLabel;
    return `<div class="attendance-control__comparison-wrap"><p class="attendance-control__comparison-title">${title}</p>
      <table class="attendance-control__comparison-table attendance-control__parameter-table">
        <thead><tr><th>פרמטר</th><th>נוכחות</th><th>${escapeHtml(sourceHeading)}</th><th>סטטוס</th><th>פעולות</th></tr></thead>
        <tbody>${rows}${cancellationRow}</tbody>
      </table>
    </div>`;
  };

  const manualReportTable = (row, { cancellation = false, entry = null, attachedCancellation = null } = {}) => {
    const display = entry?.final || row;
    const source = row?._source || display?._source || {};
    const autoCancellation = source.generationKind === 'travel_time_cancellation'
      || isAttendanceTravelTimeCancellation(entry || row);
    const minutesLabel = (value) => `${Math.floor((Number(value) || 0) / 60)}:${String((Number(value) || 0) % 60).padStart(2, '0')}`;

    if (autoCancellation) {
      const calculated = source.calculatedCancellationMinutes != null ? minutesLabel(source.calculatedCancellationMinutes) : displayWorkHours(display);
      const finalValue = source.finalCancellationMinutes != null ? minutesLabel(source.finalCancellationMinutes) : displayWorkHours(display);
      const sourceLabel = row.program || row.school || 'פעילות מקור';
      const unresolved = !entryResolvedLabel(entry || {});
      const rows = [
        ['תאריך', dateLabel(row.date), dateLabel(row.date), false],
        ['סוג פעילות', 'ביטול זמן', 'ביטול זמן', false],
        ['מקור הפעילות', sourceLabel, sourceLabel, false],
        ['ביטול זמן', finalValue, calculated, unresolved]
      ].map(([label, left, right, issue]) => `<tr class="${issue ? 'attendance-control__comparison-row--issue' : ''}"><th>${escapeHtml(label)}</th><td>${shown(left)}</td><td>${shown(right)}</td><td><span class="attendance-control__status-pill ${issue ? 'attendance-control__status-pill--issue' : 'attendance-control__status-pill--info'}">${issue ? 'ממתין לאישור' : 'תואם'}</span></td><td><span class="attendance-control__no-action">—</span></td></tr>`).join('');
      const override = source.manuallyOverridden
        ? `<p class="attendance-control__manual-note"><strong>ביטול זמן: ${escapeHtml(finalValue)}</strong><br>נערך ידנית${source.overrideByName ? ` על ידי ${escapeHtml(source.overrideByName)}` : ''}</p>`
        : `<p class="attendance-control__manual-note"><strong>ביטול זמן: ${escapeHtml(finalValue)}</strong><br>מחושב אוטומטית לפי זמן הנסיעה</p>`;
      return `<div class="attendance-control__comparison-wrap"><p class="attendance-control__comparison-title">בדיקת ביטול זמן</p><table class="attendance-control__comparison-table attendance-control__parameter-table"><thead><tr><th>פרמטר</th><th>נוכחות</th><th>חישוב מערכת</th><th>סטטוס</th><th>פעולות</th></tr></thead><tbody>${rows}</tbody></table>${override}</div>${attachmentsHtml(display)}`;
    }

    return `${parameterReviewTable(entry || { attendance: row, final: display, differences: [] }, { attendanceOnly: true, attachedCancellation })}${attachmentsHtml(display)}`;
  };

  const reportHtml = ({ kind, item, employeeId, date }) => {
    const editing = kind !== 'dashboard' && item?.__recordEditing === true;
    const row = kind === 'dashboard' ? item.dashboard : (item.final || item.attendance);
    const attachedCancellation = generatedCancellationBySource.get(entryRecordId(item)) || null;
    const dataIssue = kind === 'comparison' ? comparisonHasIssue(item) : false;
    const approved = kind === 'dashboard' ? true : attendanceEntryIsResolved(item);
    const attachedApproved = attachedCancellation ? attendanceEntryIsResolved(attachedCancellation) : true;
    const cancellationEntry = isAttendanceTravelTimeCancellation(item)
      || normalizeAttendanceName(row.activityType).includes('ביטולזמן');
    const status = editing
      ? '<span class="attendance-control__status-pill attendance-control__status-pill--info">שינויים טרם נשמרו</span>'
      : approved && attachedApproved
      ? '<span class="attendance-control__status-pill attendance-control__status-pill--ok">✓ אושר</span>'
      : dataIssue
        ? '<span class="attendance-control__status-pill attendance-control__status-pill--issue">לבדיקה</span>'
        : '<span class="attendance-control__status-pill attendance-control__status-pill--info">ממתין לאישור</span>';
    let body = '';

    if (cancellationEntry && isAttendanceTravelTimeCancellation(item)) {
      body = `${manualReportTable(row, { cancellation: true, entry: item })}${managerActionsHtml(item)}`;
    } else if (kind === 'comparison') {
      const missingMatch = item.unmatched ? '<p class="attendance-control__missing-match">לא נמצאה פעילות תואמת בדשבורד</p>' : '';
      body = `${missingMatch}${parameterReviewTable(item, { attachedCancellation })}${travelSummaryHtml(row, item, { includeCancellation: !attachedCancellation })}${attachmentsHtml(item.final || row)}${managerActionsHtml(item)}`;
    } else {
      body = `${manualReportTable(row, { entry: item, attachedCancellation })}${travelSummaryHtml(row, item, { includeCancellation: !attachedCancellation })}${managerActionsHtml(item)}`;
    }

    const recordActions = kind === 'dashboard' || !currentEmployeeCanMutate || editing
      ? ''
      : `<div class="attendance-control__record-actions">
          <button type="button" class="ds-btn ds-btn--sm" data-attendance-edit-record="${escapeHtml(item.id)}" data-attendance-edit-approved="${approved ? '1' : '0'}">${approved ? 'תיקון רשומה' : 'עריכת רשומה'}</button>
          ${approved
            ? '<span class="attendance-control__record-approved-indicator" aria-label="רשומה אושרה">✓ רשומה אושרה</span>'
            : `<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-attendance-approve-reported="${escapeHtml(item.id)}">אישור רשומה</button>`}
        </div>`;
    const editFooter = editing
      ? `<div class="attendance-control__record-edit-footer">
          <span class="attendance-control__record-edit-pending" data-attendance-record-pending>שינויים טרם נשמרו</span>
          <button type="button" class="ds-btn ds-btn--primary" data-attendance-save-record="${escapeHtml(item.id)}">שמור שינויים</button>
          <button type="button" class="ds-btn" data-attendance-cancel-record="${escapeHtml(item.id)}">בטל</button>
        </div>`
      : '';
    return `<section class="attendance-control__report" data-attendance-record-id="${escapeHtml(item.id)}" data-record-editing="${editing ? '1' : '0'}"><div class="attendance-control__report-line"><strong>${shown(`${row.startTime || '—'}–${row.endTime || '—'} | ${activityTypeDisplayLabel(row.activityType) || 'דיווח'}`)}</strong><div class="attendance-control__report-line-actions">${status}${recordActions}</div></div>${body}${editFooter}</section>`;
  };
  const employeeHtml = [...employees.values()].sort((a, b) => a.name.localeCompare(b.name, 'he')).map((employee) => {
    const hasWorkflowRow = Object.prototype.hasOwnProperty.call(workflowByEmployee, employee.id);
    const workflow = resolvePayrollMonthWorkflow(hasWorkflowRow ? workflowByEmployee[employee.id] : { workflow_status: 'not_submitted' });
    currentEmployeeCanMutate = canManagerMutatePayrollEmployeeMonth(
      hasWorkflowRow ? workflowByEmployee[employee.id] : { workflow_status: 'not_submitted' },
      { bypassMonthSubmissionGate }
    );
    const days = [...employee.days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, rows]) => {
      rows.sort((left, right) => left.time.localeCompare(right.time));
      const attendanceRows = rows.filter((row) => row.kind !== 'dashboard');
      const attachedCancellations = rows
        .map((entry) => generatedCancellationBySource.get(entryRecordId(entry.item)))
        .filter(Boolean);
      const hours = attendanceRows.reduce((sum, entry) => sum + (rowWorkHours(entry.item.final || entry.item.attendance) ?? 0), 0)
        + attachedCancellations.reduce((sum, entry) => sum + (rowWorkHours(entry.final || entry.attendance) ?? 0), 0);
      const needsApproval = rows.some((entry) => {
        const item = entry.item;
        const attached = generatedCancellationBySource.get(entryRecordId(item));
        return !attendanceEntryIsResolved(item) || (attached ? !attendanceEntryIsResolved(attached) : false);
      });
      const dataIssue = rows.some((entry) => entry.kind === 'comparison' && comparisonHasIssue(entry.item));
      const dayStatus = !needsApproval ? '✓ אושר' : (dataIssue ? 'לבדיקה' : 'ממתין לאישור');
      return `<details class="attendance-control__day${needsApproval ? '' : ' attendance-control__day--ok'}" data-payroll-date="${escapeHtml(date)}"><summary><span>${shown(dateLabel(date))}</span><span>${formatDurationHours(hours)} שעות</span><span class="attendance-control__row-status ${dataIssue ? 'attendance-control__row-status--issue' : ''}">${dayStatus}</span></summary><div class="attendance-control__reports">${rows.map((row) => reportHtml({ ...row, employeeId: employee.id, date })).join('')}</div></details>`;
    }).join('');
    const employeeEntries = allAttendanceEntries.filter((entry) => txt(entry.attendance?.employeeId) === employee.id);
    const totalRecordCount = employeeEntries.length;
    const approvedRecordCount = employeeEntries.filter(attendanceEntryIsResolved).length;
    const pendingRecordCount = Math.max(0, totalRecordCount - approvedRecordCount);
    const recordProgressHtml = totalRecordCount
      ? `<span class="attendance-control__employee-record-progress">אושרו ${approvedRecordCount} מתוך ${totalRecordCount} רשומות</span>`
      : '';
    const approval = options.approvalsByEmployee?.[employee.id];
    const workflowHtml = `<p class="attendance-control__manual-note">סטטוס חודש: <strong>${escapeHtml(workflow.label)}</strong></p>`;
    const managerApprovedAt = workflowByEmployee[employee.id]?.manager_approved_at;
    const managerApprovedBy = workflowByEmployee[employee.id]?.manager_approved_by_name;
    const managerPdfUrl = workflowByEmployee[employee.id]?.manager_pdf_sharepoint_url;
    const managerApprovedHtml = workflow.status === 'manager_approved'
      ? `<div class="attendance-control__approved"><span>אושר על ידי המנהל</span><span>${shown(managerApprovedBy)}</span><span>${shown(managerApprovedAt ? new Date(managerApprovedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '')}</span>${managerPdfUrl ? `<button type="button" class="ds-btn ds-btn--sm" data-payroll-open-sharepoint="${escapeHtml(String(managerPdfUrl))}">צפייה בדוח</button>` : '<span class="attendance-control__manual-note">PDF בהפקה / ממתין ל־retry</span>'}</div>`
      : '';
    const approvedHtml = approval
      ? `<div class="attendance-control__approved"><span>אושר סופית</span><span>${shown(approval.approved_by_name)}</span><span>${shown(approval.approved_at ? new Date(approval.approved_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '')}</span><button type="button" class="ds-btn ds-btn--sm" data-payroll-view-pdf="${escapeHtml(String(approval.id || ''))}">צפייה בדוח</button></div>`
      : '';
    let finishControls = '';
    if (!approval) {
      const workflowRow = hasWorkflowRow ? workflowByEmployee[employee.id] : { workflow_status: 'not_submitted' };
      const writeAllowed = canManagerMutatePayrollEmployeeMonth(workflowRow, { bypassMonthSubmissionGate });
      const submissionStatus = normalizeAttendanceSubmissionStatus(
        workflowRow.attendance_submission_status || workflowRow.attendanceSubmissionStatus
      );
      const finalizeAllowed = canManagerFinalizeEmployeeMonth(workflowRow, { bypassMonthSubmissionGate });
      if (!writeAllowed && workflow.status === 'not_submitted') {
        finishControls = `<div class="attendance-control__employee-actions"><span class="attendance-control__manual-note" data-payroll-readonly-notice>${escapeHtml(EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE)}</span></div>`;
      } else if (writeAllowed) {
        const addRecordBtn = canManagerAddMissingAttendanceRecord(workflowRow)
          ? `<button type="button" class="ds-btn" data-attendance-add-record="${escapeHtml(employee.id)}" data-attendance-add-employee-name="${escapeHtml(employee.name)}" title="הוספת רשומה" aria-label="הוספת רשומה">+</button>`
          : '';
        const finalizeBtn = finalizeAllowed
          ? `<button type="button" class="ds-btn ds-btn--primary" data-payroll-finish="${escapeHtml(employee.id)}" data-payroll-employee-name="${shown(employee.name)}"${pendingRecordCount ? ' disabled' : ''}>אישור מנהל</button>`
          : '';
        const reopenNotice = submissionStatus === 'reopened' && !bypassMonthSubmissionGate
          ? '<span class="attendance-control__manual-note">המדריך חייב לסיים ולאשר מחדש את החודש לפני אישור מנהל.</span>'
          : '';
        const pendingNotice = finalizeAllowed && pendingRecordCount
          ? `<span class="attendance-control__manual-note">נותרו ${pendingRecordCount} רשומות לאישור.</span>`
          : '';
        finishControls = `<div class="attendance-control__employee-actions">${addRecordBtn}${finalizeBtn}${reopenNotice}${pendingNotice}</div>`;
      }
    }
    const readonlyAttr = currentEmployeeCanMutate ? '' : ' data-payroll-employee-readonly="1"';
    return `<details class="attendance-control__employee" data-payroll-employee="${escapeHtml(employee.id)}"${readonlyAttr}><summary><strong>${shown(employee.name)}</strong>${recordProgressHtml}</summary>${workflowHtml}${managerApprovedHtml}${approvedHtml}${finishControls}<div class="attendance-control__employee-days">${days}</div></details>`;
  }).join('');
  const reviewEmployees = [...employees.values()].filter((employee) => {
    const hasWorkflowRow = Object.prototype.hasOwnProperty.call(workflowByEmployee, employee.id);
    const workflow = resolvePayrollMonthWorkflow(hasWorkflowRow ? workflowByEmployee[employee.id] : { workflow_status: 'not_submitted' });
    const entries = [...(result.comparisons || []), ...(result.notCompared || [])]
      .filter((entry) => txt(entry.attendance?.employeeId) === employee.id);
    // "לבדיקה" counts real data gaps / missing submission — not pending manager approval.
    const hasDataIssue = entries.some((entry) => {
      if (attendanceEntryIsResolved(entry)) return false;
      if (entry.unmatched || entry.source === 'attendance_not_compared') return Boolean(entry.unmatched);
      if ((entry.differences || []).some((difference) => !difference.decided)) return true;
      if (hasReviewExpense(entry.attendance)
        && entry.managerResolved !== 'approved_as_reported'
        && entry.managerResolved !== 'corrected') return true;
      return false;
    });
    return hasDataIssue || (hasWorkflowRow && workflow.status === 'not_submitted');
  }).length;
  const metricsHtml = `<details class="attendance-control__metrics-details" data-payroll-metrics><summary>פרטים</summary><div class="attendance-control__metrics"><span>שורות נוכחות ${totals.attendanceRows}</span><span>התאמות ${totals.fullMatches}</span><span>פערים ${totals.fieldMismatches}</span><span>ללא התאמה ${totals.unmatchedAttendance}</span></div></details>`;
  const overviewRows = [...(result.comparisons || []), ...(result.notCompared || [])].map((entry) => entry.final || entry.attendance || {}).filter(Boolean);
  const overviewHours = new Map();
  let overviewKm = 0;
  let overviewExpenses = 0;
  for (const row of overviewRows) {
    const type = activityTypeDisplayLabel(row.activityType) || 'אחר';
    const hours = rowWorkHours(row) || 0;
    if (hours > 0) overviewHours.set(type, (overviewHours.get(type) || 0) + hours);
    overviewKm += optionalNumber(row.kilometers) || 0;
    overviewExpenses += optionalNumber(row.expenses) || 0;
  }
  const preferredTypes = ['קורס', 'סדנה', 'ביטול זמן', 'הכשרה', 'תפעול', 'סיור', 'חדר בריחה'];
  const overviewCards = preferredTypes.filter((type) => (overviewHours.get(type) || 0) > 0)
    .map((type) => [`סה״כ ${type}`, formatDurationHours(overviewHours.get(type))]);
  if (overviewKm > 0) overviewCards.push(['סה״כ ק״מ', Math.round(overviewKm).toLocaleString('he-IL')]);
  if (overviewExpenses > 0) overviewCards.push(['הוצאות', `${Math.round(overviewExpenses).toLocaleString('he-IL')} ₪`]);
  const overviewHtml = overviewCards.length ? `<div class="attendance-control__overview">${overviewCards.map(([label, value]) => `<div class="attendance-control__overview-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}</div>` : '';
  const summaryBar = `<div class="attendance-control__summary-bar"><span>מדריכים <b>${employees.size}</b></span><span>תקינים <b>${Math.max(0, employees.size - reviewEmployees)}</b></span><span>לבדיקה <b>${reviewEmployees}</b></span></div>`;
  return `${overviewHtml}${summaryBar}${metricsHtml}${employeeHtml}<button type="button" class="ds-btn ds-btn--primary attendance-control__export" data-attendance-export>ייצוא דוח נוכחות מתוקן</button>`;
}

function openAttendanceControlWindow(api, state) {
  const popup = window.open('', 'dashboard-payroll-control');
  if (!popup) throw new Error('הדפדפן חסם את פתיחת חלון בקרת הנוכחות. יש לאפשר חלונות קופצים ולנסות שוב.');
  popup.document.title = 'בקרת נוכחות';
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
  const monthInput = panel.querySelector('[data-attendance-month]');
  const teamInput = panel.querySelector('[data-attendance-team]');
  const instructorWrap = panel.querySelector('[data-attendance-instructor-wrap]');
  const instructorInput = panel.querySelector('[data-attendance-instructor]');
  const title = panel.querySelector('[data-attendance-title]');
  const run = panel.querySelector('[data-attendance-run]'); const status = panel.querySelector('[data-attendance-status]'); const results = panel.querySelector('[data-attendance-results]');
  let result = null; let employees = null; let teamIds = []; let approvalsByEmployee = {}; let workflowByEmployee = {};
  const role = txt(state?.user?.role || state?.user?.display_role).toLowerCase();
  const isManager = ['manager', 'instructor_manager', 'activities_manager'].includes(role);
  const canChooseTeam = ['operations_controller', 'system_admin', 'operation_manager', 'admin'].includes(role);
  const bypassMonthSubmissionGate = ['admin', 'operation_manager'].includes(role);
  const fillInstructorOptions = (selectedTeam) => {
    if (!instructorInput) return;
    const rows = (employees || []).filter((employee) => {
      const team = lookupText(employee.team || employee.Team);
      if (!selectedTeam || selectedTeam === '__all__') return Boolean(team);
      return team === selectedTeam;
    });
    const seen = new Set();
    const options = [];
    for (const employee of rows) {
      const id = txt(employee.employeeId || employee.EmployeeId || employee.ID);
      const name = txt(employee.employeeName || employee.EmployeeName || employee.Title || employee.empName) || id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      options.push({ id, name });
    }
    options.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    instructorInput.innerHTML = `<option value="">כל המדריכים</option>${options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
    instructorInput.value = '';
  };
  const paintResults = () => {
    // Save open state of employees, days, metrics and record edit mode before replacing innerHTML.
    const openEmployees = new Set();
    const openDays = new Set();
    const editingRecords = new Set();
    let metricsOpen = false;
    results.querySelectorAll('details[data-payroll-employee][open]').forEach((el) => openEmployees.add(el.dataset.payrollEmployee));
    results.querySelectorAll('details[data-payroll-date][open]').forEach((el) => {
      const emp = el.closest('[data-payroll-employee]');
      openDays.add((emp?.dataset?.payrollEmployee || '') + '|' + el.dataset.payrollDate);
    });
    results.querySelectorAll('.attendance-control__report[data-record-editing="1"]').forEach((report) => {
      const button = report.querySelector('[data-attendance-edit-record]');
      if (button?.dataset?.attendanceEditRecord) editingRecords.add(button.dataset.attendanceEditRecord);
    });
    if (results.querySelector('details[data-payroll-metrics][open]')) metricsOpen = true;

    results.innerHTML = result
      ? resultsHtml(result, result.month, {
        approvalsByEmployee,
        workflowByEmployee,
        bypassMonthSubmissionGate
      })
      : '';

    // Restore open state after re-render
    results.querySelectorAll('details[data-payroll-employee]').forEach((el) => {
      if (openEmployees.has(el.dataset.payrollEmployee)) el.open = true;
    });
    results.querySelectorAll('details[data-payroll-date]').forEach((el) => {
      const emp = el.closest('[data-payroll-employee]');
      const key = (emp?.dataset?.payrollEmployee || '') + '|' + el.dataset.payrollDate;
      if (openDays.has(key)) el.open = true;
    });
    for (const recordId of editingRecords) {
      const button = results.querySelector(`[data-attendance-edit-record="${CSS.escape(recordId)}"]`);
      const report = button?.closest('.attendance-control__report');
      if (!report) continue;
      report.dataset.recordEditing = '1';
      report.querySelectorAll('[data-attendance-manual-edit-wrap], .attendance-control__row-custom').forEach((wrap) => { wrap.hidden = false; });
      button.textContent = 'סיום עריכה';
    }
    if (metricsOpen) {
      const m = results.querySelector('details[data-payroll-metrics]');
      if (m) m.open = true;
    }
  };
  const loadApprovals = async () => {
    approvalsByEmployee = {};
    if (!api?.listPayrollControlApprovals || !result?.month) return;
    try {
      const employeeIds = [...new Set([
        ...(result.comparisons || []),
        ...(result.notCompared || [])
      ].map((entry) => txt(entry?.attendance?.employeeId)).filter(Boolean))];
      const rows = await api.listPayrollControlApprovals({ monthKey: result.month, employeeIds });
      approvalsByEmployee = Object.fromEntries((rows || []).map((row) => [txt(row.employee_id), row]));
    } catch { approvalsByEmployee = {}; }
  };
  const loadWorkflowStatuses = async (monthKey, employeeIds = []) => {
    workflowByEmployee = {};
    if (!monthKey || !employeeIds.length) return;
    if (!api?.attendanceControlMonthWorkflowStatuses) {
      workflowByEmployee = Object.fromEntries(employeeIds.map((employeeId) => [txt(employeeId), { workflow_status: 'not_submitted' }]));
      return;
    }
    try {
      const rows = await api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds });
      workflowByEmployee = Object.fromEntries((rows || []).map((row) => [txt(row.employee_id || row.employeeId), row]));
    } catch {
      workflowByEmployee = Object.fromEntries(employeeIds.map((employeeId) => [txt(employeeId), { workflow_status: 'not_submitted' }]));
    }
  };
  const loadRecordReviews = async () => {
    const entries = [...(result?.comparisons || []), ...(result?.notCompared || [])];
    for (const entry of entries) entry.managerRecordApproved = false;
    if (!entries.length || !api?.attendanceControlRecordReviews) return;
    const recordIds = [...new Set(entries.map(attendanceEntryRecordId).filter(Boolean))];
    if (!recordIds.length) return;
    try {
      const rows = await api.attendanceControlRecordReviews({ recordIds });
      const approved = new Set((rows || []).map((row) => txt(row.record_id || row.recordId)).filter(Boolean));
      for (const entry of entries) {
        if (approved.has(attendanceEntryRecordId(entry))) approveAttendanceEntryCurrent(entry);
      }
    } catch (error) {
      console.warn('[attendance-control] record reviews load failed', error);
    }
  };
  const syncEntryAfterPersistentWrite = (entry) => {
    const source = entry.attendance?._source;
    entry.attendance = { ...(entry.attendance || {}), ...(entry.final || {}), _source: source };
    entry.final = { ...entry.attendance };
    entry.managerRecordApproved = false;
  };
  const assertEmployeeMonthMutableForManager = (entry) => {
    if (bypassMonthSubmissionGate) return;
    const employeeId = txt(entry?.attendance?.employeeId || entry?.final?.employeeId);
    const workflowRow = workflowByEmployee[employeeId];
    if (!canManagerMutatePayrollEmployeeMonth(workflowRow || { workflow_status: 'not_submitted' })) {
      throw new Error(EMPLOYEE_MONTH_NOT_SUBMITTED_READONLY_MESSAGE);
    }
  };
  const persistEntryCorrection = async (entry) => {
    assertEmployeeMonthMutableForManager(entry);
    // Literal path required: Vite/Rollup cannot rewrite `import(variable)` into a hashed chunk.
    const finishMod = await import('./payroll-control-finish.js?v=20261005-manager-pdf-decouple-v1');
    const update = finishMod.buildAttendanceUpdatePayload(entry);
    if (!update.recordId) throw new Error('חסר מזהה רשומת נוכחות לעדכון.');
    if (!update.changed) {
      entry.managerRecordApproved = false;
      return { ...update, wrote: false };
    }
    if (!api?.attendanceControlUpdateRecord) throw new Error('עדכון רשומת הנוכחות אינו זמין.');
    await api.attendanceControlUpdateRecord(update.recordId, update.fields);
    syncEntryAfterPersistentWrite(entry);
    // Writing bumps attendance_records.updated_at and invalidates any prior review;
    // also clear the review row explicitly so reloads stay consistent.
    if (api?.attendanceControlApproveRecord) {
      try {
        await api.attendanceControlApproveRecord(update.recordId, false);
      } catch (error) {
        console.warn('[attendance-control] clear record review after edit failed', error);
      }
    }
    return { ...update, wrote: true };
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
  const askForMissingAttendanceRecord = async ({ employeeId, employeeName, monthKey }) => new Promise((resolve) => {
    const { fromDate, toDate } = attendanceMonthDateRange(monthKey);
    const dialog = panel.ownerDocument.createElement('dialog');
    dialog.className = 'attendance-control__approve-dialog attendance-control__add-dialog';
    const activityTypes = ['קורס', 'סדנה', 'סיור', 'זום', 'חדר בריחה', 'הכשרה', 'ביטול זמן', 'תפעול'];
    dialog.innerHTML = `<form method="dialog" data-attendance-add-form>
      <h3>הוספת דיווח שנשכח</h3>
      <p>${escapeHtml(employeeName || employeeId)} · ${escapeHtml(attendanceMonthLabel(monthKey))}</p>
      <div class="attendance-control__add-grid">
        <label><span>תאריך *</span><input class="ds-input" type="date" name="attendanceDate" min="${escapeHtml(fromDate)}" max="${escapeHtml(toDate)}" required></label>
        <label><span>סוג פעילות *</span><select class="ds-input" name="activityType" required><option value="">בחירה</option>${activityTypes.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('')}</select></label>
        <label><span>שעת התחלה *</span><input class="ds-input" type="time" name="startTime" required></label>
        <label><span>שעת סיום *</span><input class="ds-input" type="time" name="endTime" required></label>
        <label><span>רשות / יישוב</span><input class="ds-input" type="text" name="municipality"></label>
        <label><span>בית ספר / מיקום</span><input class="ds-input" type="text" name="schoolName"></label>
        <label><span>תוכנית / קורס</span><input class="ds-input" type="text" name="programName"></label>
        <label><span>מספר מפגש</span><input class="ds-input" type="number" name="sessionNumber" min="1" step="1"></label>
        <label><span>ק״מ</span><input class="ds-input" type="number" name="kilometers" min="0" step="0.01" value="0"></label>
        <label><span>תחבורה ציבורית</span><select class="ds-input" name="publicTransport"><option value="false">לא</option><option value="true">כן</option></select></label>
        <label><span>עלות תחבורה ציבורית</span><input class="ds-input" type="number" name="publicTransportCost" min="0" step="0.01" value="0"></label>
        <label><span>הוצאות</span><input class="ds-input" type="number" name="totalExpenses" min="0" step="0.01" value="0"></label>
        <label class="attendance-control__add-wide"><span>פירוט הוצאות</span><input class="ds-input" type="text" name="expensesDetails"></label>
        <label class="attendance-control__add-wide"><span>הערות</span><input class="ds-input" type="text" name="notes"></label>
      </div>
      <p class="attendance-control__add-hint">הרשומה תתווסף כחלק מבקרת המנהל ותמתין לאישור רשומה רגיל לפני אישור החודש.</p>
      <p class="attendance-control__add-error" data-attendance-add-error hidden></p>
      <div class="attendance-control__approve-actions"><button type="submit" class="ds-btn ds-btn--primary">הוסף דיווח</button><button type="button" class="ds-btn" data-attendance-add-cancel>ביטול</button></div>
    </form>`;
    panel.appendChild(dialog);
    const form = dialog.querySelector('[data-attendance-add-form]');
    const errorEl = dialog.querySelector('[data-attendance-add-error]');
    const done = (value) => { try { dialog.close(); } catch {} dialog.remove(); resolve(value); };
    dialog.querySelector('[data-attendance-add-cancel]')?.addEventListener('click', () => done(null));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); done(null); });
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const FormDataCtor = panel.ownerDocument.defaultView?.FormData || FormData;
      const values = Object.fromEntries(new FormDataCtor(form).entries());
      const reportDate = txt(values.attendanceDate);
      const startTime = timeText(values.startTime);
      const endTime = timeText(values.endTime);
      const expenses = optionalNumber(values.totalExpenses) ?? 0;
      const kilometers = optionalNumber(values.kilometers) ?? 0;
      const publicTransport = txt(values.publicTransport) === 'true';
      const publicTransportCost = optionalNumber(values.publicTransportCost) ?? 0;
      const meetingNo = txt(values.sessionNumber);
      let message = '';
      if (!reportDate || !reportDate.startsWith(`${monthKey}-`)) message = 'יש לבחור תאריך מתוך חודש הבקרה.';
      else if (!txt(values.activityType)) message = 'יש לבחור סוג פעילות.';
      else if (!startTime || !endTime || !attendanceTimeRangeIsValid(startTime, endTime)) message = 'שעת הסיום חייבת להיות מאוחרת משעת ההתחלה.';
      else if (meetingNo && !/^[1-9]\d*$/.test(meetingNo)) message = 'מספר המפגש אינו תקין.';
      else if (expenses < 0 || kilometers < 0 || publicTransportCost < 0) message = 'סכומי הוצאות ונסיעות אינם יכולים להיות שליליים.';
      if (message) {
        if (errorEl) { errorEl.textContent = message; errorEl.hidden = false; }
        return;
      }
      done({
        attendanceDate: reportDate,
        activityType: txt(values.activityType),
        startTime,
        endTime,
        municipality: txt(values.municipality),
        schoolName: txt(values.schoolName),
        programName: txt(values.programName),
        sessionNumber: meetingNo,
        kilometers: publicTransport ? 0 : kilometers,
        publicTransport,
        publicTransportCost: publicTransport ? publicTransportCost : 0,
        totalExpenses: expenses,
        expensesDetails: expenses > 0 ? txt(values.expensesDetails) : '',
        notes: txt(values.notes)
      });
    });
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      dialog.querySelector('[name="attendanceDate"]')?.focus();
    } else {
      dialog.remove();
      resolve(null);
    }
  });
  const update = () => { run.disabled = !employees || !attendanceMonthLabel(monthInput.value) || !teamInput.value; };
  monthInput.addEventListener('change', update);
  teamInput.addEventListener('change', () => {
    if (canChooseTeam) fillInstructorOptions(teamInput.value);
    update();
  });
  instructorInput?.addEventListener('change', update);
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
      // Manager roster RPCs are already server-scoped by direct_manager and do not
      // include the manager as an employee row. Use returned teams as-is.
      const options = canChooseTeam
        ? [{ id: '__all__', managerName: 'כל המערכת' }, ...teams]
        : teams;
      teamInput.innerHTML = `<option value="">בחר צוות</option>${options.map((team) => `<option value="${escapeHtml(team.id)}">${escapeHtml(team.managerName)}</option>`).join('')}`;
      if (isManager) {
        if (teams.length === 1) {
          teamInput.value = teams[0].id;
          teamInput.disabled = true;
        } else {
          teamInput.disabled = teams.length === 0;
        }
      } else {
        teamInput.disabled = !canChooseTeam;
      }
      if (instructorWrap && instructorInput) {
        instructorWrap.hidden = !canChooseTeam;
        instructorInput.disabled = !canChooseTeam;
        if (canChooseTeam) fillInstructorOptions(teamInput.value);
      }
      status.textContent = options.length ? '' : 'לא נמצא צוות המשויך למשתמש המחובר.';
      update();
    }).catch(() => { status.textContent = 'טעינת נתוני מערכת הנוכחות נכשלה.'; });
  }
  const loadAttendanceReview = async ({ successMessage = '' } = {}) => {
    run.disabled = true; status.textContent = 'טוען את נתוני הנוכחות והדשבורד ומבצע בקרת נוכחות…';
    try {
      const month = monthInput.value; const monthLabel = attendanceMonthLabel(month);
      if (!monthLabel) throw new Error('יש לבחור חודש לבדיקה לפני ביצוע הבדיקה.');
      const selectedTeam = teamInput.value;
      const selectedInstructor = txt(instructorInput?.value);
      const { fromDate, toDate } = attendanceMonthDateRange(month);
      const records = await api.attendanceControlRecords({ fromDate, toDate });
      const attendanceRows = filterAttendanceControlScopeRows(
        filterAttendanceRowsByMonth(normalizeAttendanceApiRows(records), month),
        { selectedTeam, selectedInstructor }
      );
      if (!attendanceRows.length) throw new Error(`לא נמצאו דיווחי נוכחות עבור ${monthLabel}`);
      const dashboardRows = await loadAttendanceDashboardDataset(attendanceRows, api, month);
      result = compareAttendanceRows(attendanceRows, dashboardRows); result.month = month;
      const employeeIds = [...new Set(attendanceRows.map((row) => txt(row.employeeId)).filter(Boolean))];
      title.textContent = `בקרת נוכחות – ${monthLabel}`;
      await Promise.all([loadApprovals(), loadWorkflowStatuses(month, employeeIds), loadRecordReviews()]);
      paintResults();
      status.textContent = successMessage;
    } catch (error) {
      workflowByEmployee = {};
      status.textContent = error?.message || 'טעינת נתוני בקרת הנוכחות נכשלה.';
      results.innerHTML = '';
    }
    finally { update(); }
  };
  run.addEventListener('click', () => { loadAttendanceReview(); });
  const setStatusMessage = (message, { error = false } = {}) => {
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(error && message));
  };
  const syncRecordDraftUi = (target) => {
    const input = target?.closest?.('[data-attendance-manual-input]');
    const report = input?.closest?.('.attendance-control__report');
    if (!input || report?.dataset.recordEditing !== '1') return false;
    const field = txt(input.dataset.fieldKey);
    if (field === 'startTime' || field === 'endTime') {
      const startInput = report.querySelector('[data-attendance-manual-input][data-field-key="startTime"]');
      const endInput = report.querySelector('[data-attendance-manual-input][data-field-key="endTime"]');
      const workHoursInput = report.querySelector('[data-attendance-manual-input][data-field-key="workHours"]');
      const startTime = timeText(startInput?.value);
      const endTime = timeText(endInput?.value);
      if (workHoursInput && startTime && endTime) {
        workHoursInput.value = attendanceTimeRangeIsValid(startTime, endTime)
          ? formatDurationHours(calculateWorkHours(startTime, endTime))
          : '';
      }
    }
    if (field === 'publicTransport') {
      const usesPublicTransport = input.value === 'true';
      const costInput = report.querySelector('[data-attendance-manual-input][data-field-key="publicTransportCost"]');
      const kmInput = report.querySelector('[data-attendance-manual-input][data-field-key="kilometers"]');
      if (costInput) {
        costInput.disabled = !usesPublicTransport;
        if (!usesPublicTransport) costInput.value = '0';
        else if (!costInput.value) costInput.value = '0';
      }
      if (kmInput) {
        kmInput.disabled = usesPublicTransport;
        if (usesPublicTransport) kmInput.value = '0';
      }
    }
    const pending = report.querySelector('[data-attendance-record-pending]');
    if (pending) pending.textContent = 'שינויים טרם נשמרו';
    return true;
  };
  results.addEventListener('input', (event) => {
    syncRecordDraftUi(eventTargetElement(event));
  });
  results.addEventListener('change', (event) => {
    const clickEl = eventTargetElement(event);
    if (!clickEl) return;
    if (syncRecordDraftUi(clickEl)) return;
    const travelToggle = clickEl.closest('[data-attendance-correct-pt]');
    if (travelToggle) {
      const entryId = travelToggle.dataset.attendanceCorrectPt;
      const costInput = results.querySelector(`[data-attendance-correct-pt-cost="${CSS.escape(entryId)}"]`);
      const kmInput = results.querySelector(`[data-attendance-correct-km="${CSS.escape(entryId)}"]`);
      if (costInput) costInput.disabled = !travelToggle.checked;
      if (kmInput) {
        kmInput.disabled = travelToggle.checked;
        if (travelToggle.checked) kmInput.value = '';
      }
      if (travelToggle.checked && costInput && !costInput.value) costInput.value = '0';
      return;
    }
    const dashboardOnlyElement = clickEl.closest('[data-dashboard-only]');
    if (dashboardOnlyElement && clickEl.matches('[data-dashboard-only-choice]') && result) {
      const entry = result.dashboardOnly.find((item) => item.id === dashboardOnlyElement.dataset.dashboardOnly);
      setDashboardOnlyChoice(entry, event.target.value === 'add');
      return;
    }
    const diff = clickEl.closest('[data-comparison]'); if (!diff || !result) return;
    const comparison = result.comparisons.find((row) => row.id === diff.dataset.comparison); const field = diff.dataset.field;
    if (clickEl.matches('[data-attendance-choice]')) { const custom = diff.querySelector('[data-attendance-custom]'); custom.hidden = event.target.value !== 'custom'; applyAttendanceChoice(comparison, field, event.target.value, custom.value); }
    if (clickEl.matches('[data-attendance-custom]')) applyAttendanceChoice(comparison, field, 'custom', event.target.value);
  });
  const parseManualCorrectionValue = (field, rawValue) => {
    const raw = txt(rawValue);
    if (field === 'publicTransport') {
      return { valid: raw === 'true' || raw === 'false', value: raw === 'true' };
    }
    if (field === 'workHours') {
      const hours = parseDurationHoursInput(raw);
      return { valid: hours != null, value: hours };
    }
    if (field === 'publicTransportCost' || field === 'kilometers') {
      const numeric = optionalNumber(raw);
      return { valid: numeric != null && numeric >= 0, value: numeric };
    }
    if (field === 'expenses') {
      // Empty input clears the expense (amount 0); detail is cleared on save.
      if (!raw) return { valid: true, value: 0 };
      const numeric = optionalNumber(raw);
      return { valid: numeric != null && numeric >= 0, value: numeric };
    }
    if (field === 'meetingNo') {
      if (!raw) return { valid: true, value: '' };
      return { valid: /^\d+$/.test(raw), value: raw };
    }
    if (field === 'date') return { valid: /^20\d{2}-(0[1-9]|1[0-2])-([012]\d|3[01])$/.test(raw), value: raw };
    if (field === 'startTime' || field === 'endTime') return { valid: /^([01]\d|2[0-3]):[0-5]\d$/.test(raw), value: raw };
    if (field === 'activityType') return { valid: Boolean(raw), value: raw };
    return { valid: true, value: raw };
  };

  results.addEventListener('click', async (event) => {
    const clickEl = eventTargetElement(event);
    if (!clickEl) return;
    const findEntry = (entryId) => (
      [...(result?.comparisons || []), ...(result?.notCompared || [])].find((entry) => entry.id === entryId) || null
    );

    const addRecordBtn = clickEl.closest('[data-attendance-add-record]');
    if (addRecordBtn && result) {
      const employeeId = txt(addRecordBtn.dataset.attendanceAddRecord);
      const workflowRow = workflowByEmployee[employeeId] || {};
      if (!canManagerAddMissingAttendanceRecord(workflowRow)) {
        setStatusMessage('ניתן להוסיף דיווח שנשכח רק כשהחודש הוגש לבקרה או נפתח מחדש לתיקון, ולפני אישור מנהל/שכר.', { error: true });
        return;
      }
      if (!api?.attendanceControlCreateRecord) {
        setStatusMessage('הוספת דיווח נוכחות אינה זמינה כרגע.', { error: true });
        return;
      }
      const fields = await askForMissingAttendanceRecord({
        employeeId,
        employeeName: txt(addRecordBtn.dataset.attendanceAddEmployeeName),
        monthKey: result.month
      });
      if (!fields) return;
      addRecordBtn.disabled = true;
      try {
        await api.attendanceControlCreateRecord(employeeId, fields);
        await loadAttendanceReview({ successMessage: 'הדיווח שנשכח נוסף. יש לבדוק ולאשר את הרשומה החדשה לפני אישור החודש.' });
      } catch (error) {
        setStatusMessage(error?.message || 'הוספת דיווח הנוכחות נכשלה.', { error: true });
      } finally {
        addRecordBtn.disabled = false;
      }
      return;
    }

    const focusTravelBtn = clickEl.closest('[data-attendance-focus-travel]');
    if (focusTravelBtn && result) {
      const entryId = txt(focusTravelBtn.dataset.attendanceFocusTravel);
      const editor = results.querySelector(`[data-attendance-travel-edit="${CSS.escape(entryId)}"]`);
      editor?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      editor?.querySelector('input:not([disabled])')?.focus();
      return;
    }

    const fieldChoiceBtn = clickEl.closest('[data-attendance-field-choice]');
    if (fieldChoiceBtn && result) {
      const entryId = txt(
        fieldChoiceBtn.dataset.comparisonId
        || fieldChoiceBtn.getAttribute('data-comparison-id')
      );
      const comparison = findEntry(entryId);
      const field = txt(fieldChoiceBtn.dataset.fieldKey || fieldChoiceBtn.getAttribute('data-field-key'));
      const choice = txt(
        fieldChoiceBtn.dataset.attendanceFieldChoice
        || fieldChoiceBtn.getAttribute('data-attendance-field-choice')
      );
      if (!comparison || !field) {
        setStatusMessage('לא נמצאה רשומת הנוכחות לאישור השדה.', { error: true });
        return;
      }
      const rowElement = fieldChoiceBtn.closest('[data-comparison]');
      if (choice === 'custom') {
        const customWrap = rowElement?.querySelector('.attendance-control__row-custom');
        const customInput = rowElement?.querySelector('[data-attendance-custom]');
        if (customWrap) customWrap.hidden = false;
        customInput?.focus();
        return;
      }
      fieldChoiceBtn.disabled = true;
      try {
        applyAttendanceChoice(comparison, field, choice);
        const persisted = await persistEntryCorrection(comparison);
        paintResults();
        setStatusMessage(persisted.wrote
          ? 'התיקון נשמר ברשומת הנוכחות. הרשומה ממתינה לאישור.'
          : 'ההחלטה נשמרה בבקרה. יש לאשר את הרשומה.');
      } catch (error) {
        paintResults();
        setStatusMessage(error?.message || 'שמירת ההחלטה נכשלה.', { error: true });
      } finally {
        fieldChoiceBtn.disabled = false;
      }
      return;
    }

    const customSaveBtn = clickEl.closest('[data-attendance-custom-save]');
    if (customSaveBtn && result) {
      const entryId = txt(
        customSaveBtn.dataset.comparisonId
        || customSaveBtn.getAttribute('data-comparison-id')
      );
      const comparison = findEntry(entryId);
      const field = txt(customSaveBtn.dataset.fieldKey || customSaveBtn.getAttribute('data-field-key'));
      const rowElement = customSaveBtn.closest('[data-comparison]');
      const customInput = rowElement?.querySelector('[data-attendance-custom]');
      if (!comparison || !field || !customInput) {
        setStatusMessage('לא נמצאה רשומת הנוכחות לשמירת הערך המתוקן.', { error: true });
        return;
      }
      const value = txt(customInput.value);
      if (!value) {
        setStatusMessage('יש להזין ערך מתוקן.', { error: true });
        customInput.focus();
        return;
      }
      customSaveBtn.disabled = true;
      try {
        applyAttendanceChoice(comparison, field, 'custom', value);
        await persistEntryCorrection(comparison);
        paintResults();
        setStatusMessage('התיקון נשמר ברשומת הנוכחות. הרשומה ממתינה לאישור.');
      } catch (error) {
        paintResults();
        setStatusMessage(error?.message || 'שמירת התיקון נכשלה.', { error: true });
      } finally {
        customSaveBtn.disabled = false;
      }
      return;
    }

    const saveRecordBtn = clickEl.closest('[data-attendance-save-record]');
    if (saveRecordBtn && result) {
      const entry = findEntry(txt(saveRecordBtn.dataset.attendanceSaveRecord));
      const report = saveRecordBtn.closest('.attendance-control__report');
      if (!entry || !report) {
        setStatusMessage('לא נמצאה הרשומה לשמירת השינויים.', { error: true });
        return;
      }
      saveRecordBtn.disabled = true;
      try {
        assertEmployeeMonthMutableForManager(entry);
        const changes = {};
        const inputs = [...report.querySelectorAll('[data-attendance-manual-input]')];
        for (const input of inputs) {
          const field = txt(input.dataset.fieldKey);
          if (!field) continue;
          const parsed = parseManualCorrectionValue(field, input.value);
          if (!parsed.valid) {
            const message = field === 'workHours'
              ? 'יש להזין שעות בפורמט שעות:דקות, למשל 1:30.'
              : `הערך בשדה "${input.getAttribute('aria-label')?.replace(/^עריכת\s+/, '') || field}" אינו תקין.`;
            throw new Error(message);
          }
          changes[field] = parsed.value;
        }

        const current = entry.final || entry.attendance || {};
        const startTime = changes.startTime ?? timeText(current.startTime);
        const endTime = changes.endTime ?? timeText(current.endTime);
        if (!attendanceTimeRangeIsValid(startTime, endTime)) {
          throw new Error('כדי לשמור את הרשומה, שעת הסיום חייבת להיות מאוחרת משעת ההתחלה.');
        }
        if (Object.hasOwn(changes, 'startTime') || Object.hasOwn(changes, 'endTime')) {
          changes.startTime = startTime;
          changes.endTime = endTime;
          changes.workHours = calculateWorkHours(startTime, endTime);
        }

        if (Object.hasOwn(changes, 'publicTransport') || Object.hasOwn(changes, 'publicTransportCost') || Object.hasOwn(changes, 'kilometers')) {
          const usesPublicTransport = asBoolean(changes.publicTransport ?? current.publicTransport);
          changes.publicTransport = usesPublicTransport;
          if (usesPublicTransport) {
            changes.kilometers = 0;
            changes.publicTransportCost = optionalNumber(changes.publicTransportCost) ?? optionalNumber(current.publicTransportCost) ?? 0;
          } else {
            changes.publicTransportCost = 0;
            changes.kilometers = optionalNumber(changes.kilometers) ?? optionalNumber(current.kilometers) ?? 0;
          }
        }

        const draftEntry = {
          ...entry,
          attendance: { ...(entry.attendance || {}) },
          final: { ...(entry.final || entry.attendance || {}) },
          differences: (entry.differences || []).map((difference) => ({ ...difference }))
        };
        delete draftEntry.__recordEditing;
        const oldDate = txt(entry.attendance?.date);
        applyAttendanceManualCorrection(draftEntry, changes);
        const saved = await persistEntryCorrection(draftEntry);

        if (saved.wrote) {
          entry.attendance = { ...(draftEntry.attendance || {}) };
          entry.final = { ...(draftEntry.final || draftEntry.attendance || {}) };
          entry.managerResolved = draftEntry.managerResolved;
          entry.managerRecordApproved = false;
          const newDate = txt(entry.attendance?.date);
          if (newDate && newDate !== oldDate) {
            const sourceRow = entry.attendance || {};
            const source = sourceRow._source || {};
            const sourceId = txt(sourceRow.recordId || source.recordId || source.ID || source.Id || source.id);
            const linkedCancellation = [...(result.notCompared || [])].find((candidate) => {
              if (!isAttendanceTravelTimeCancellation(candidate)) return false;
              const childSource = candidate.attendance?._source || {};
              return txt(childSource.sourceAttendanceRecordId || childSource.source_attendance_record_id) === sourceId;
            });
            if (linkedCancellation?.attendance) {
              linkedCancellation.attendance.date = newDate;
              linkedCancellation.final = { ...(linkedCancellation.final || linkedCancellation.attendance), date: newDate };
              linkedCancellation.managerRecordApproved = false;
            }
          }
          refreshDailyKilometersAfterTravelChange(result, entry.attendance?.employeeId, oldDate);
          refreshDailyKilometersAfterTravelChange(result, entry.attendance?.employeeId, entry.attendance?.date);
        }
        delete entry.__recordEditing;
        paintResults();
        setStatusMessage(saved.wrote
          ? 'השינויים נשמרו ברשומת הנוכחות. הרשומה ממתינה לאישור מחדש.'
          : 'לא נמצאו שינויים לשמירה.');
      } catch (error) {
        setStatusMessage(error?.message || 'שמירת השינויים נכשלה.', { error: true });
      } finally {
        saveRecordBtn.disabled = false;
      }
      return;
    }

    const cancelRecordBtn = clickEl.closest('[data-attendance-cancel-record]');
    if (cancelRecordBtn && result) {
      const entry = findEntry(txt(cancelRecordBtn.dataset.attendanceCancelRecord));
      if (!entry) return;
      delete entry.__recordEditing;
      paintResults();
      setStatusMessage('');
      return;
    }

    const editRecordBtn = clickEl.closest('[data-attendance-edit-record]');
    if (editRecordBtn && result) {
      const entry = findEntry(txt(editRecordBtn.dataset.attendanceEditRecord));
      if (!entry) {
        setStatusMessage('לא נמצאה רשומת הנוכחות לעריכה.', { error: true });
        return;
      }
      try {
        assertEmployeeMonthMutableForManager(entry);
      } catch (error) {
        setStatusMessage(error?.message || 'לא ניתן לערוך את הרשומה.', { error: true });
        return;
      }
      const correctingApprovedRecord = editRecordBtn.dataset.attendanceEditApproved === '1';
      entry.__recordEditing = true;
      paintResults();
      setStatusMessage(correctingApprovedRecord
        ? 'שינויים טרם נשמרו. האישור הקודם יבוטל רק לאחר שמירה מוצלחת.'
        : 'שינויים טרם נשמרו.');
      const report = results.querySelector(`[data-attendance-record-id="${CSS.escape(entry.id)}"]`);
      const publicTransportInput = report?.querySelector('[data-attendance-manual-input][data-field-key="publicTransport"]');
      if (publicTransportInput) syncRecordDraftUi(publicTransportInput);
      report?.querySelector('[data-attendance-manual-input]')?.focus();
      return;
    }

    const approveBtn = clickEl.closest('[data-attendance-approve-reported]');
    if (approveBtn && result) {
      const entry = findEntry(approveBtn.dataset.attendanceApproveReported);
      if (!entry) {
        setStatusMessage('לא נמצאה רשומת הנוכחות לאישור.', { error: true });
        return;
      }
      approveBtn.disabled = true;
      let writeSucceeded = false;
      try {
        assertEmployeeMonthMutableForManager(entry);
        approveAttendanceEntryCurrent(entry);
        const finishMod = await import('./payroll-control-finish.js?v=20261005-manager-pdf-decouple-v1');
        const update = finishMod.buildAttendanceUpdatePayload(entry);
        if (!update.recordId) throw new Error('חסר מזהה רשומת נוכחות לאישור.');
        if (update.changed) {
          if (!api?.attendanceControlUpdateRecord) throw new Error('עדכון רשומת הנוכחות אינו זמין.');
          await api.attendanceControlUpdateRecord(update.recordId, update.fields);
          writeSucceeded = true;
          syncEntryAfterPersistentWrite(entry);
        }
        if (!api?.attendanceControlApproveRecord) throw new Error('שמירת אישור הרשומה אינה זמינה.');
        await api.attendanceControlApproveRecord(update.recordId, true);
        entry.managerRecordApproved = true;
        paintResults();
        setStatusMessage('הרשומה אושרה ונשמרה.');
      } catch (error) {
        entry.managerRecordApproved = false;
        paintResults();
        setStatusMessage(error?.message || (writeSucceeded
          ? 'התיקון נשמר, אך אישור הרשומה לא נשמר. יש לנסות לאשר שוב.'
          : 'אישור הרשומה נכשל.'), { error: true });
      } finally {
        approveBtn.disabled = false;
      }
      return;
    }
    const saveCorrectionBtn = clickEl.closest('[data-attendance-save-correction]');
    if (saveCorrectionBtn && result) {
      const entry = findEntry(saveCorrectionBtn.dataset.attendanceSaveCorrection);
      const hoursInput = results.querySelector(`[data-attendance-correct-hours="${saveCorrectionBtn.dataset.attendanceSaveCorrection}"]`);
      const hours = optionalNumber(hoursInput?.value);
      if (entry && hours != null) {
        applyAttendanceManualCorrection(entry, { workHours: hours });
        saveCorrectionBtn.disabled = true;
        try {
          await persistEntryCorrection(entry);
          paintResults();
          setStatusMessage('התיקון נשמר ברשומת הנוכחות. הרשומה ממתינה לאישור.');
        } catch (error) {
          setStatusMessage(error?.message || 'שמירת התיקון נכשלה.', { error: true });
        } finally {
          saveCorrectionBtn.disabled = false;
        }
      } else if (entry) {
        setStatusMessage('יש להזין שעות שכר מתוקנות.', { error: true });
      }
      return;
    }
    const saveTravelBtn = clickEl.closest('[data-attendance-save-travel]');
    if (saveTravelBtn && result) {
      const entryId = saveTravelBtn.dataset.attendanceSaveTravel;
      const entry = findEntry(entryId);
      if (!entry) return;
      if (isAttendanceTravelTimeCancellation(entry)) {
        setStatusMessage('לא ניתן לערוך נסיעה עבור רשומת ביטול זמן נסיעה.', { error: true });
        return;
      }
      const usesPublicTransport = Boolean(results.querySelector(`[data-attendance-correct-pt="${CSS.escape(entryId)}"]`)?.checked);
      const cost = optionalNumber(results.querySelector(`[data-attendance-correct-pt-cost="${CSS.escape(entryId)}"]`)?.value);
      const km = optionalNumber(results.querySelector(`[data-attendance-correct-km="${CSS.escape(entryId)}"]`)?.value);
      if (usesPublicTransport && km != null && km > 0) {
        setStatusMessage('לא ניתן לשמור גם קילומטרים וגם תחבורה ציבורית.', { error: true });
        return;
      }
      const { changed } = applyAttendanceTravelCorrection(entry, {
        publicTransport: usesPublicTransport,
        publicTransportCost: usesPublicTransport ? (cost ?? 0) : 0,
        kilometers: usesPublicTransport ? 0 : (km ?? 0)
      });
      if (!changed) {
        setStatusMessage('לא בוצע שינוי בנתוני הנסיעה.');
        return;
      }
      saveTravelBtn.disabled = true;
      try {
        await persistEntryCorrection(entry);
        refreshDailyKilometersAfterTravelChange(result, entry.attendance?.employeeId, entry.attendance?.date);
        paintResults();
        setStatusMessage('תיקון הנסיעה נשמר ברשומת הנוכחות. הרשומה ממתינה לאישור.');
      } catch (error) {
        setStatusMessage(error?.message || 'שמירת תיקון הנסיעה נכשלה.', { error: true });
      } finally {
        saveTravelBtn.disabled = false;
      }
      return;
    }
    const openAttachmentBtn = clickEl.closest('[data-attendance-open-attachment]');
    if (openAttachmentBtn) {
      const path = txt(openAttachmentBtn.dataset.attendanceOpenAttachment);
      if (!path) return;
      try {
        setStatusMessage('פותח אסמכתא…');
        const signed = await api?.attendanceControlAttachmentSignedUrl?.(path);
        const url = txt(signed?.signedUrl);
        if (!url) throw new Error('לא התקבל קישור לצפייה באסמכתא.');
        window.open(url, '_blank', 'noopener');
        setStatusMessage('');
      } catch (error) {
        setStatusMessage(error?.message || 'פתיחת האסמכתא נכשלה.', { error: true });
      }
      return;
    }
    if (clickEl.closest('[data-attendance-export]') && result) {
      XLSX.writeFile(buildCorrectedAttendanceWorkbook([...result.comparisons, ...(result.notCompared || [])], result.dashboardPopulation), attendanceExportFilename(result.month), { compression: true });
      return;
    }
    const kmApproveBtn = clickEl.closest('[data-km-approve-reported]');
    if (kmApproveBtn && result) {
      const [kmEmployeeId, kmDate] = txt(kmApproveBtn.dataset.kmApproveReported).split('|');
      resolveKilometersDay(result, kmEmployeeId, kmDate, 'approved_as_reported');
      paintResults();
      setStatusMessage('');
      return;
    }
    const viewBtn = clickEl.closest('[data-payroll-view-pdf]');
    if (viewBtn) {
      const approval = approvalFromButton(viewBtn);
      if (!approval) return;
      const finishMod = await import('./payroll-control-finish.js?v=20261005-manager-pdf-decouple-v1');
      if (txt(approval.pdf_path).startsWith('http://') || txt(approval.pdf_path).startsWith('https://')) {
        window.open(approval.pdf_path, '_blank', 'noopener');
        return;
      }
      let signedUrl = '';
      if (approval.pdf_path && api?.payrollControlApprovalSignedUrl) {
        try { signedUrl = (await api.payrollControlApprovalSignedUrl(approval.pdf_path)).signedUrl || ''; } catch { signedUrl = ''; }
      }
      finishMod.openPayrollApprovalDocument(approval, signedUrl);
      return;
    }
    const viewSharePointBtn = clickEl.closest('[data-payroll-open-sharepoint]');
    if (viewSharePointBtn) {
      const sharePointUrl = txt(viewSharePointBtn.dataset.payrollOpenSharepoint);
      if (sharePointUrl) window.open(sharePointUrl, '_blank', 'noopener');
      return;
    }
    const finishBtn = clickEl.closest('[data-payroll-finish]');
    if (!finishBtn || !result) return;
    const employeeId = txt(finishBtn.dataset.payrollFinish);
    const employeeName = txt(finishBtn.dataset.payrollEmployeeName);
    const workflow = resolvePayrollMonthWorkflow(workflowByEmployee[employeeId] || {});
    if (workflow.status !== 'submitted') {
      setStatusMessage('לא ניתן לאשר מנהל לפני שהעובד השלים ואישר את החודש.', { error: true });
      return;
    }
    finishBtn.disabled = true;
    try {
      const finishMod = await import('./payroll-control-finish.js?v=20261005-manager-pdf-decouple-v1');
      if (finishMod.payrollEmployeeHasUnresolvedEntries(result, employeeId)) {
        setStatusMessage('לא ניתן לאשר את החודש: יש רשומות שעדיין לא אושרו על ידי מנהל הצוות.', { error: true });
        return;
      }
      const signed = await askForSignature(finishMod);
      if (!signed) { setStatusMessage('האישור בוטל.'); return; }
      setStatusMessage('שומר אישור מנהל…');
      const saved = await finishMod.approvePayrollControlEmployee({
        api,
        user: state?.user,
        result,
        employeeId,
        employeeName,
        confirmed: true,
        monthWorkflow: {
          workflowStatus: workflow.status,
          attendanceSubmissionStatus: workflow.submissionStatus,
          submittedAt: workflowByEmployee[employeeId]?.submitted_at || '',
          submittedByName: workflowByEmployee[employeeId]?.submitted_by_name || ''
        }
      });
      workflowByEmployee[employeeId] = {
        ...(workflowByEmployee[employeeId] || {}),
        workflow_status: 'manager_approved',
        attendance_submission_status: 'locked',
        manager_approved_at: saved?.manager_approved_at || new Date().toISOString(),
        manager_approved_by_name: saved?.manager_approved_by_name || txt(state?.user?.full_name || state?.user?.name || ''),
        manager_pdf_sharepoint_url: saved?.manager_pdf_sharepoint_url || ''
      };
      paintResults();
      if (saved?.pdf_pending) {
        setStatusMessage('אישור המנהל נשמר והחודש ננעל. הפקת/שמירת ה-PDF נכשלה ותושלם אוטומטית ב־retry.', { error: true });
      } else if (saved?.mail_sent === false) {
        setStatusMessage('אישור המנהל נשמר והחודש ננעל. ה-PDF נשמר ב-SharePoint, אך שליחת המייל לעובד נכשלה.', { error: true });
      } else {
        setStatusMessage('אישור המנהל נשמר בהצלחה, החודש ננעל והדוח נשלח לעובד.');
      }
    } catch (error) {
      setStatusMessage(error?.message || 'שמירת האישור נכשלה.', { error: true });
    } finally {
      finishBtn.disabled = false;
    }
  });
}
