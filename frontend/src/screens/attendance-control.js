import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';

export const DETAIL_HEADERS = ['מספר עובד', 'שם עובד', 'תאריך', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית', 'מספר מפגש', 'קילומטרים', 'הוצאות', 'פירוט הוצאות', 'הערות'];
export const MONTHLY_HEADERS = ['שם מדריך', 'מספר עובד', 'שעות ביטול זמן', 'שעות הכשרה', 'שעות חדר בריחה', 'שעות סדנה', 'שעות סדנאות קיץ', 'שעות סיור', 'שעות קורס', 'שעות תפעול', 'סה"כ קילומטרים', 'הוצאות', 'פירוט הוצאות'];
export const DAILY_HEADERS = ['תאריך', 'שם מדריך', 'מספר עובד', 'סוג פעילות', 'רשות', 'שעת התחלה', 'שעת סיום', 'שעות עבודה', 'קילומטרים', 'הוצאות', 'פירוט הוצאות'];

const FIELD_DEFS = [
  ['startTime', 'שעת התחלה', 'time'], ['endTime', 'שעת סיום', 'time'],
  ['program', 'שם תכנית', 'text'], ['meetingNo', 'מספר מפגש', 'text'],
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

export function normalizeAttendanceName(value) {
  return txt(value).normalize('NFKD').toLowerCase()
    .replace(/[׳״'"`´’‘“”.,;:()\[\]{}\-_/\\]/g, '')
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
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'number' && value > 1000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  const raw = txt(value).slice(0, 10);
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

export function buildDashboardAttendanceRows(activities = [], contacts = []) {
  const contactById = new Map((contacts || []).map((row) => [txt(row.emp_id || row.employee_id), row]));
  const output = [];
  for (const activity of activities || []) {
    const instructors = [
      { employeeId: txt(activity.emp_id), employeeName: txt(activity.instructor_name || activity.name) },
      { employeeId: txt(activity.emp_id_2), employeeName: txt(activity.instructor_name_2) }
    ].filter((item) => item.employeeId);
    if (!instructors.length) continue;
    const meetings = activityMeetings(activity);
    const fallbackDate = activityValue(activity, ['activity_date', 'start_date', 'date']);
    const dates = meetings.length ? meetings : (fallbackDate ? [{ date: fallbackDate }] : []);
    dates.forEach((meeting, index) => instructors.forEach((instructor) => {
      const contact = contactById.get(instructor.employeeId) || {};
      output.push({
        ...instructor, employeeName: instructor.employeeName || txt(contact.full_name), employmentType: txt(contact.employment_type),
        date: excelDate(meeting.date), startTime: timeText(meeting.start_time || activity.start_time), endTime: timeText(meeting.end_time || activity.end_time),
        activityType: txt(activityValue(activity, ['activity_type_label', 'activity_type', 'item_type'])), school: txt(activityValue(activity, ['school', 'single_school_name', 'legacy_school'])),
        authority: txt(activityValue(activity, ['authority', 'authority_name'])), program: txt(activityValue(activity, ['activity_name', 'program_name', 'name'])),
        meetingNo: meeting.meeting_no ?? index + 1, kilometers: null, expenses: null,
        schoolId: activity.school_id == null ? null : Number(activity.school_id), activityId: txt(activityValue(activity, ['row_id', 'RowID', 'id']))
      });
    }));
  }
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
  for (const dayRows of groups.values()) {
    dayRows.sort((a, b) => timeText(a.startTime).localeCompare(timeText(b.startTime)));
    dayRows.forEach((row, index) => {
      const incoming = index === 0
        ? instructorSchoolDistance(travelCache, row.employeeId, row.schoolId)
        : schoolSchoolDistance(travelCache, dayRows[index - 1].schoolId, row.schoolId);
      const returnHome = index === dayRows.length - 1 ? instructorSchoolDistance(travelCache, row.employeeId, row.schoolId) : 0;
      row.kilometers = incoming == null || returnHome == null ? null : Math.round((incoming + returnHome) * 100) / 100;
    });
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
  const rows = buildDashboardAttendanceRows(sources.activities, sources.contacts)
    .filter((row) => (month ? row.date.startsWith(`${month}-`) : scope.dates.has(row.date)) && scope.employeeIds.includes(row.employeeId));
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

function matchScore(attendance, dashboard) {
  let score = 0;
  if (normalizeAttendanceName(attendance.school) === normalizeAttendanceName(dashboard.school)) score += 35;
  if (normalizeAttendanceName(attendance.authority) === normalizeAttendanceName(dashboard.authority)) score += 20;
  if (normalizeAttendanceName(attendance.activityType) === normalizeAttendanceName(dashboard.activityType)) score += 15;
  if (normalizeAttendanceName(attendance.program) === normalizeAttendanceName(dashboard.program)) score += 25;
  score += Math.max(0, 20 - Math.min(20, minutesBetween(attendance.startTime, dashboard.startTime) / 3));
  return score;
}

function comparable(type, value) {
  if (type === 'number' || type === 'money') return optionalNumber(value) ?? '__missing__';
  if (type === 'time') return timeText(value);
  return normalizeAttendanceName(value);
}

export function compareAttendanceRows(attendanceRows, dashboardRows) {
  const attendanceIds = new Set((attendanceRows || []).map((row) => txt(row.employeeId)).filter(Boolean));
  const dashboardPopulation = (dashboardRows || []).filter((row) => attendanceIds.has(txt(row.employeeId)));
  const buckets = new Map();
  dashboardPopulation.forEach((row) => {
    const key = `${txt(row.employeeId)}|${row.date}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  });
  const used = new Set();
  const comparisons = (attendanceRows || []).map((attendance, attendanceIndex) => {
    const candidates = buckets.get(`${txt(attendance.employeeId)}|${attendance.date}`) || [];
    const available = candidates.map((row, index) => ({ row, index, score: matchScore(attendance, row) })).filter(({ row }) => !used.has(row));
    available.sort((a, b) => b.score - a.score);
    const dashboard = available[0]?.row || null;
    if (dashboard) used.add(dashboard);
    const final = { ...attendance };
    const differences = dashboard ? FIELD_DEFS.flatMap(([key, label, type]) => {
      if (comparable(type, attendance[key]) === comparable(type, dashboard[key])) return [];
      return [{ key, label, type, attendance: attendance[key], dashboard: dashboard[key], choice: 'attendance', custom: '' }];
    }) : [];
    return { id: `row-${attendanceIndex}`, attendance, dashboard, final, differences, unmatched: !dashboard };
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
  return { comparisons, dashboardOnly, dashboardPopulation };
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
  comparison.final.workHours = calculateWorkHours(comparison.final.startTime, comparison.final.endTime);
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
    .map(({ final }) => ({ ...final, workHours: calculateWorkHours(final.startTime, final.endTime), employmentType: employment.get(txt(final.employeeId)) || txt(final.employmentType) }));
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

function diffText(diff) {
  if (diff.type === 'time' && (!timeText(diff.attendance) || !timeText(diff.dashboard))) return 'חסר נתון באחד המקורות';
  if (diff.type === 'time') return `פער ${minutesBetween(diff.attendance, diff.dashboard)} דקות`;
  if ((diff.type === 'number' || diff.type === 'money') && (optionalNumber(diff.attendance) == null || optionalNumber(diff.dashboard) == null)) return 'חסר נתון באחד המקורות';
  if (diff.type === 'number') return `פער ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ק״מ`;
  if (diff.type === 'money') return `פער ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ₪`;
  return `${txt(diff.attendance) || 'ללא ערך'} לעומת ${txt(diff.dashboard) || 'ללא ערך'}`;
}

function summary(result) {
  const employees = new Set(result.comparisons.map((c) => c.attendance.employeeId));
  const different = new Set([
    ...result.comparisons.filter((c) => c.differences.length).map((c) => c.attendance.employeeId),
    ...(result.dashboardOnly || []).map((entry) => entry.dashboard.employeeId)
  ]);
  const sum = (key) => result.comparisons.reduce((total, c) => {
    const attendance = optionalNumber(c.attendance[key]); const dashboard = optionalNumber(c.dashboard?.[key]);
    return attendance == null || dashboard == null ? total : total + Math.abs(attendance - dashboard);
  }, 0);
  const hourDiff = result.comparisons.reduce((total, c) => total + Math.abs(calculateWorkHours(c.attendance.startTime, c.attendance.endTime) - calculateWorkHours(c.dashboard?.startTime, c.dashboard?.endTime)), 0);
  return { employees: employees.size, different: different.size, hours: Math.round(hourDiff * 100) / 100, km: sum('kilometers'), expenses: sum('expenses') };
}

export function attendanceControlHtml() {
  return `<section class="attendance-control no-print" data-attendance-control hidden dir="rtl"><div class="attendance-control__head"><div><h2 data-attendance-title>בקרת נוכחות</h2><p>בחרו חודש, העלו קובץ נוכחות והמערכת תשווה אותו לנתוני הדשבורד.</p></div><button type="button" class="ds-btn ds-btn--sm" data-attendance-close>סגירה</button></div><div class="attendance-control__uploads"><label><strong>חודש לבדיקה</strong><input class="ds-input" type="month" data-attendance-month></label><label><strong>העלאת קובץ נוכחות</strong><input type="file" accept=".xlsx,.xls" data-attendance-source></label><button type="button" class="ds-btn ds-btn--primary" data-attendance-run disabled>בצע בדיקה</button></div><p class="attendance-control__status" data-attendance-status aria-live="polite"></p><div data-attendance-results></div></section>`;
}

export function attendanceControlStylesHtml() {
  return `<style id="attendance-control-styles">
.attendance-control{margin:16px 0;padding:18px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.attendance-control__head,.attendance-control__uploads,.attendance-control__metrics,.attendance-control__employee-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.attendance-control__head{justify-content:space-between}.attendance-control__head h2{margin:0}.attendance-control__head p{margin:4px 0;color:#64748b}
.attendance-control__uploads{margin:16px 0;padding:14px;background:#f8fafc;border-radius:10px}.attendance-control__uploads label{display:grid;gap:6px;min-width:220px;flex:1}.attendance-control__status{color:#b91c1c;font-weight:700}
.attendance-control__complete{padding:12px 14px;border-radius:10px;background:#ecfdf5;color:#166534}.attendance-control__metrics{margin:12px 0}.attendance-control__metrics>span,.attendance-control__employee-summary>span{padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
.attendance-control__employee{margin:10px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}.attendance-control__employee summary{display:flex;justify-content:space-between;padding:13px;cursor:pointer;background:#f8fafc}.attendance-control__employee-summary{padding:10px 13px}
.attendance-control__dashboard-only{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 13px;padding:12px;border:1px solid #f59e0b;border-radius:9px;background:#fffbeb}.attendance-control__dashboard-only>div{display:grid;gap:4px}.attendance-control__dashboard-only span{color:#64748b}
.attendance-control__day{padding:10px 13px;border-top:1px solid #e2e8f0}.attendance-control__day h4{margin:0 0 8px}.attendance-control__diff{display:grid;grid-template-columns:minmax(110px,1fr) repeat(3,minmax(90px,1fr)) minmax(140px,1fr) minmax(110px,1fr);gap:7px;align-items:center;padding:7px 0;border-top:1px dashed #e2e8f0}.attendance-control__export{margin-top:14px}
@media(max-width:850px){.attendance-control__diff{grid-template-columns:1fr 1fr}.attendance-control__diff strong{grid-column:1/-1}}
</style>`;
}

export function resultsHtml(result, month = '') {
  const totals = summary(result);
  const byEmployee = new Map();
  result.comparisons.forEach((comparison) => { const key = comparison.attendance.employeeId; if (!byEmployee.has(key)) byEmployee.set(key, []); byEmployee.get(key).push(comparison); });
  (result.dashboardOnly || []).forEach((entry) => { const key = entry.dashboard.employeeId; if (!byEmployee.has(key)) byEmployee.set(key, []); });
  const dashboardOnlyByEmployee = new Map();
  (result.dashboardOnly || []).forEach((entry) => { const key = entry.dashboard.employeeId; if (!dashboardOnlyByEmployee.has(key)) dashboardOnlyByEmployee.set(key, []); dashboardOnlyByEmployee.get(key).push(entry); });
  const cards = [...byEmployee.entries()].map(([employeeId, rows]) => {
    const changed = rows.filter((row) => row.differences.length);
    const dashboardOnly = dashboardOnlyByEmployee.get(employeeId) || [];
    const name = rows[0]?.attendance?.employeeName || dashboardOnly[0]?.dashboard?.employeeName || employeeId;
    const attendanceHours = rows.reduce((s, r) => s + calculateWorkHours(r.attendance.startTime, r.attendance.endTime), 0);
    const dashboardHours = rows.reduce((s, r) => s + calculateWorkHours(r.dashboard?.startTime, r.dashboard?.endTime), 0)
      + dashboardOnly.reduce((sum, entry) => sum + calculateWorkHours(entry.dashboard.startTime, entry.dashboard.endTime), 0);
    const details = changed.map((comparison) => `<div class="attendance-control__day"><h4>${escapeHtml(comparison.attendance.date)} · ${escapeHtml(comparison.attendance.program || comparison.attendance.activityType || 'דיווח')}</h4>${comparison.differences.map((diff) => `<div class="attendance-control__diff" data-comparison="${comparison.id}" data-field="${diff.key}"><strong>${escapeHtml(diff.label)}</strong><span>${escapeHtml(txt(diff.attendance) || '—')}</span><span>${escapeHtml(txt(diff.dashboard) || '—')}</span><span>${escapeHtml(diffText(diff))}</span><select class="ds-input ds-input--sm" data-attendance-choice><option value="attendance">נתון הנוכחות</option><option value="dashboard">נתון הדשבורד</option><option value="custom">ערך אחר</option></select><input class="ds-input ds-input--sm" data-attendance-custom hidden aria-label="ערך אחר"></div>`).join('')}</div>`).join('');
    const missing = dashboardOnly.map((entry) => `<div class="attendance-control__dashboard-only" data-dashboard-only="${entry.id}"><div><strong>מופיע בדשבורד ולא נמצא בנוכחות</strong><span>${escapeHtml(entry.dashboard.date)} · ${escapeHtml(entry.dashboard.program || entry.dashboard.activityType || 'פעילות')} · ${escapeHtml(`${entry.dashboard.startTime || '—'}–${entry.dashboard.endTime || '—'}`)}</span></div><select class="ds-input ds-input--sm" data-dashboard-only-choice><option value="leave">להשאיר ללא שינוי</option><option value="add">להוסיף לנתונים הסופיים</option></select></div>`).join('');
    const gapCount = changed.length + dashboardOnly.length;
    return `<details class="attendance-control__employee"><summary><strong>${escapeHtml(name)}</strong><span>${gapCount} הבדלים</span></summary><div class="attendance-control__employee-summary"><span>שעות נוכחות <b>${attendanceHours.toFixed(2)}</b></span><span>שעות בדשבורד <b>${dashboardHours.toFixed(2)}</b></span><span>השוני <b>${Math.abs(attendanceHours-dashboardHours).toFixed(2)}</b></span></div>${details}${missing}${gapCount ? '' : '<p class="ds-muted">לא נמצאו הבדלים בנתונים הנבדקים.</p>'}</details>`;
  }).join('');
  const monthSummary = attendanceMonthLabel(month) ? `<span>חודש הבדיקה: <b>${escapeHtml(attendanceMonthLabel(month))}</b></span>` : '';
  return `<div class="attendance-control__complete"><strong>נמצאו פערים אצל ${totals.different} מדריכים. לחצו על מדריך לפרטים המלאים.</strong></div><div class="attendance-control__metrics">${monthSummary}<span>מדריכים שנבדקו <b>${totals.employees}</b></span><span>פער בשעות <b>${totals.hours}</b></span><span>פער בקילומטרים <b>${totals.km}</b></span><span>פער בהוצאות <b>₪${totals.expenses}</b></span></div>${cards}<button type="button" class="ds-btn ds-btn--primary attendance-control__export" data-attendance-export>ייצוא דוח נוכחות מתוקן</button>`;
}

async function readFile(file) {
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
}

export function bindAttendanceControl(root, { api } = {}) {
  const panel = root?.querySelector('[data-attendance-control]'); if (!panel) return;
  const attendanceInput = panel.querySelector('[data-attendance-source]');
  const monthInput = panel.querySelector('[data-attendance-month]'); const title = panel.querySelector('[data-attendance-title]');
  const run = panel.querySelector('[data-attendance-run]'); const status = panel.querySelector('[data-attendance-status]'); const results = panel.querySelector('[data-attendance-results]');
  let result = null;
  const update = () => { run.disabled = !attendanceInput.files?.[0] || !attendanceMonthLabel(monthInput.value); };
  attendanceInput.addEventListener('change', update);
  monthInput.addEventListener('change', update);
  root.querySelector('[data-attendance-open]')?.addEventListener('click', () => { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  panel.querySelector('[data-attendance-close]')?.addEventListener('click', () => { panel.hidden = true; });
  run.addEventListener('click', async () => {
    run.disabled = true; status.textContent = 'טוען את נתוני הדשבורד ובודק את הקובץ…';
    try {
      const month = monthInput.value; const monthLabel = attendanceMonthLabel(month);
      if (!monthLabel) throw new Error('יש לבחור חודש לבדיקה לפני ביצוע הבדיקה.');
      const attendanceRows = filterAttendanceRowsByMonth(parseAttendanceWorkbook(await readFile(attendanceInput.files[0])), month);
      if (!attendanceRows.length) throw new Error(`לא נמצאו דיווחי נוכחות עבור ${monthLabel}`);
      const dashboardRows = await loadAttendanceDashboardDataset(attendanceRows, api, month);
      result = compareAttendanceRows(attendanceRows, dashboardRows); result.month = month;
      title.textContent = `בקרת נוכחות – ${monthLabel}`; status.textContent = ''; results.innerHTML = resultsHtml(result, month);
    } catch (error) { status.textContent = error?.message || 'קריאת הקבצים נכשלה.'; results.innerHTML = ''; }
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
  results.addEventListener('click', (event) => { if (!event.target.closest('[data-attendance-export]') || !result) return; XLSX.writeFile(buildCorrectedAttendanceWorkbook([...result.comparisons, ...result.dashboardOnly], result.dashboardPopulation), attendanceExportFilename(result.month), { compression: true }); });
}
