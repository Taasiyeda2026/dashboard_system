import * as XLSX from 'xlsx';
import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';

export const DASHBOARD_EXPORT_HEADERS = ['מספר עובד', 'שם מדריך', 'סוג העסקה', 'תאריך', 'שעת התחלה', 'שעת סיום', 'סוג פעילות', 'שם בית ספר', 'רשות', 'שם תכנית', 'מספר מפגש', 'קילומטרים', 'הוצאות', 'מזהה פעילות'];
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
const number = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(txt(value).replace(/[₪,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

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
        meetingNo: meeting.meeting_no ?? index + 1, kilometers: activityValue(activity, ['kilometers', 'kilometres', 'distance_km', 'travel_km'], ''),
        expenses: activityValue(activity, ['expenses', 'expense_amount'], ''), activityId: txt(activityValue(activity, ['row_id', 'RowID', 'id']))
      });
    }));
  }
  return output;
}

function dashboardRowArray(row) {
  return [row.employeeId, row.employeeName, row.employmentType, row.date, row.startTime, row.endTime, row.activityType, row.school, row.authority, row.program, row.meetingNo, row.kilometers, row.expenses, row.activityId];
}

function styledSheet(headers, rows, widths = []) {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  sheet['!cols'] = headers.map((header, index) => ({ wch: widths[index] || Math.max(12, Math.min(28, txt(header).length + 5)) }));
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${Math.max(1, rows.length + 1)}` };
  sheet['!views'] = [{ RTL: true }];
  return sheet;
}

export function buildDashboardAttendanceWorkbook(activities, contacts) {
  const rows = buildDashboardAttendanceRows(activities, contacts);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, styledSheet(DASHBOARD_EXPORT_HEADERS, rows.map(dashboardRowArray)), 'נתוני דשבורד');
  return workbook;
}

export function parseAttendanceWorkbook(workbook) {
  const result = [];
  for (const sheetName of workbook.SheetNames || []) {
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
        meetingNo: txt(get('meetingNo')), kilometers: number(get('kilometers')), expenses: number(get('expenses')),
        expenseDetails: txt(get('expenseDetails')), notes: txt(get('notes')), activityId: txt(get('activityId'))
      });
    }
  }
  return result;
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
  if (type === 'number' || type === 'money') return number(value);
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
  return { comparisons, dashboardPopulation };
}

export function applyAttendanceChoice(comparison, field, choice, custom = '') {
  const difference = comparison.differences.find((item) => item.key === field);
  if (!difference) return comparison;
  difference.choice = choice; difference.custom = custom;
  const value = choice === 'dashboard' ? difference.dashboard : choice === 'custom' ? custom : difference.attendance;
  comparison.final[field] = difference.type === 'number' || difference.type === 'money' ? number(value) : value;
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
  const rows = (comparisons || []).map(({ final }) => ({ ...final, workHours: calculateWorkHours(final.startTime, final.endTime), employmentType: employment.get(txt(final.employeeId)) || txt(final.employmentType) }));
  const detail = rows.map((row) => [row.employeeId, row.employeeName, row.date, row.startTime, row.endTime, row.workHours, row.activityType, row.school, row.authority, row.program, row.meetingNo, row.kilometers, row.expenses, row.expenseDetails, row.notes]);
  const monthlyMap = new Map();
  rows.filter((row) => normalizeAttendanceName(row.employmentType).includes(normalizeAttendanceName('תעשיידע'))).forEach((row) => {
    const key = txt(row.employeeId); if (!monthlyMap.has(key)) monthlyMap.set(key, { name: row.employeeName, id: key, hours: Array(8).fill(0), km: 0, expenses: 0, details: [] });
    const item = monthlyMap.get(key); const bucket = activityBucket(row.activityType); if (bucket >= 0) item.hours[bucket] += row.workHours;
    item.km += number(row.kilometers); item.expenses += number(row.expenses); if (row.expenseDetails) item.details.push(row.expenseDetails);
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
  if (diff.type === 'time') return `שוני של ${minutesBetween(diff.attendance, diff.dashboard)} דקות`;
  if (diff.type === 'number') return `שוני של ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ק״מ`;
  if (diff.type === 'money') return `שוני של ${Math.abs(number(diff.attendance) - number(diff.dashboard))} ₪`;
  return `${txt(diff.attendance) || 'ללא ערך'} לעומת ${txt(diff.dashboard) || 'ללא ערך'}`;
}

function summary(result) {
  const employees = new Set(result.comparisons.map((c) => c.attendance.employeeId));
  const different = new Set(result.comparisons.filter((c) => c.differences.length).map((c) => c.attendance.employeeId));
  const sum = (key) => result.comparisons.reduce((total, c) => total + Math.abs(number(c.attendance[key]) - number(c.dashboard?.[key])), 0);
  const hourDiff = result.comparisons.reduce((total, c) => total + Math.abs(calculateWorkHours(c.attendance.startTime, c.attendance.endTime) - calculateWorkHours(c.dashboard?.startTime, c.dashboard?.endTime)), 0);
  return { employees: employees.size, different: different.size, hours: Math.round(hourDiff * 100) / 100, km: sum('kilometers'), expenses: sum('expenses') };
}

export function attendanceControlHtml() {
  return `<section class="attendance-control no-print" data-attendance-control hidden dir="rtl"><div class="attendance-control__head"><div><h2>בקרת נוכחות</h2><p>טענו את שני קובצי ה־Excel ובצעו בדיקה.</p></div><button type="button" class="ds-btn ds-btn--sm" data-attendance-close>סגירה</button></div><div class="attendance-control__uploads"><label><strong>קובץ דשבורד</strong><input type="file" accept=".xlsx,.xls" data-attendance-dashboard></label><label><strong>קובץ נוכחות</strong><input type="file" accept=".xlsx,.xls" data-attendance-source></label><button type="button" class="ds-btn ds-btn--primary" data-attendance-run disabled>בצע בדיקה</button></div><p class="attendance-control__status" data-attendance-status aria-live="polite"></p><div data-attendance-results></div></section>`;
}

export function attendanceControlStylesHtml() {
  return `<style id="attendance-control-styles">
.attendance-control{margin:16px 0;padding:18px;border:1px solid #cbd5e1;border-radius:14px;background:#fff;box-shadow:0 8px 24px rgba(15,23,42,.06)}
.attendance-control__head,.attendance-control__uploads,.attendance-control__metrics,.attendance-control__employee-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.attendance-control__head{justify-content:space-between}.attendance-control__head h2{margin:0}.attendance-control__head p{margin:4px 0;color:#64748b}
.attendance-control__uploads{margin:16px 0;padding:14px;background:#f8fafc;border-radius:10px}.attendance-control__uploads label{display:grid;gap:6px;min-width:220px;flex:1}.attendance-control__status{color:#b91c1c;font-weight:700}
.attendance-control__complete{padding:12px 14px;border-radius:10px;background:#ecfdf5;color:#166534}.attendance-control__metrics{margin:12px 0}.attendance-control__metrics>span,.attendance-control__employee-summary>span{padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc}
.attendance-control__employee{margin:10px 0;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden}.attendance-control__employee summary{display:flex;justify-content:space-between;padding:13px;cursor:pointer;background:#f8fafc}.attendance-control__employee-summary{padding:10px 13px}
.attendance-control__day{padding:10px 13px;border-top:1px solid #e2e8f0}.attendance-control__day h4{margin:0 0 8px}.attendance-control__diff{display:grid;grid-template-columns:minmax(110px,1fr) repeat(3,minmax(90px,1fr)) minmax(140px,1fr) minmax(110px,1fr);gap:7px;align-items:center;padding:7px 0;border-top:1px dashed #e2e8f0}.attendance-control__export{margin-top:14px}
@media(max-width:850px){.attendance-control__diff{grid-template-columns:1fr 1fr}.attendance-control__diff strong{grid-column:1/-1}}
</style>`;
}

function resultsHtml(result) {
  const totals = summary(result);
  const byEmployee = new Map();
  result.comparisons.forEach((comparison) => { const key = comparison.attendance.employeeId; if (!byEmployee.has(key)) byEmployee.set(key, []); byEmployee.get(key).push(comparison); });
  const cards = [...byEmployee.values()].map((rows) => {
    const changed = rows.filter((row) => row.differences.length);
    const name = rows[0].attendance.employeeName || rows[0].attendance.employeeId;
    const attendanceHours = rows.reduce((s, r) => s + calculateWorkHours(r.attendance.startTime, r.attendance.endTime), 0);
    const dashboardHours = rows.reduce((s, r) => s + calculateWorkHours(r.dashboard?.startTime, r.dashboard?.endTime), 0);
    const details = changed.map((comparison) => `<div class="attendance-control__day"><h4>${escapeHtml(comparison.attendance.date)} · ${escapeHtml(comparison.attendance.program || comparison.attendance.activityType || 'דיווח')}</h4>${comparison.differences.map((diff) => `<div class="attendance-control__diff" data-comparison="${comparison.id}" data-field="${diff.key}"><strong>${escapeHtml(diff.label)}</strong><span>${escapeHtml(txt(diff.attendance) || '—')}</span><span>${escapeHtml(txt(diff.dashboard) || '—')}</span><span>${escapeHtml(diffText(diff))}</span><select class="ds-input ds-input--sm" data-attendance-choice><option value="attendance">נתון הנוכחות</option><option value="dashboard">נתון הדשבורד</option><option value="custom">ערך אחר</option></select><input class="ds-input ds-input--sm" data-attendance-custom hidden aria-label="ערך אחר"></div>`).join('')}</div>`).join('');
    return `<details class="attendance-control__employee"${changed.length ? '' : ''}><summary><strong>${escapeHtml(name)}</strong><span>${changed.length} הבדלים</span></summary><div class="attendance-control__employee-summary"><span>שעות נוכחות <b>${attendanceHours.toFixed(2)}</b></span><span>שעות בדשבורד <b>${dashboardHours.toFixed(2)}</b></span><span>השוני <b>${Math.abs(attendanceHours-dashboardHours).toFixed(2)}</b></span></div>${details || '<p class="ds-muted">לא נמצאו הבדלים בנתונים הנבדקים.</p>'}</details>`;
  }).join('');
  return `<div class="attendance-control__complete"><strong>בדיקת הנוכחות הושלמה. נמצאו הבדלים אצל ${totals.different} מדריכים.</strong></div><div class="attendance-control__metrics"><span>מדריכים שנבדקו <b>${totals.employees}</b></span><span>שוני בשעות <b>${totals.hours}</b></span><span>שוני בקילומטרים <b>${totals.km}</b></span><span>שוני בהוצאות <b>₪${totals.expenses}</b></span></div>${cards}<button type="button" class="ds-btn ds-btn--primary attendance-control__export" data-attendance-export>ייצוא דוח נוכחות מתוקן</button>`;
}

async function readFile(file) {
  return XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
}

export function bindAttendanceControl(root, { activities = [], api } = {}) {
  const panel = root?.querySelector('[data-attendance-control]'); if (!panel) return;
  const dashboardInput = panel.querySelector('[data-attendance-dashboard]'); const attendanceInput = panel.querySelector('[data-attendance-source]');
  const run = panel.querySelector('[data-attendance-run]'); const status = panel.querySelector('[data-attendance-status]'); const results = panel.querySelector('[data-attendance-results]');
  let result = null;
  const update = () => { run.disabled = !(dashboardInput.files?.[0] && attendanceInput.files?.[0]); };
  dashboardInput.addEventListener('change', update); attendanceInput.addEventListener('change', update);
  root.querySelector('[data-attendance-open]')?.addEventListener('click', () => { panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  panel.querySelector('[data-attendance-close]')?.addEventListener('click', () => { panel.hidden = true; });
  root.querySelector('[data-attendance-dashboard-export]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget; button.disabled = true;
    try { const contacts = api?.instructorSchedulePrintContacts ? (await api.instructorSchedulePrintContacts()).rows || [] : []; XLSX.writeFile(buildDashboardAttendanceWorkbook(activities, contacts), `בקרת_נוכחות_דשבורד_${new Date().toISOString().slice(0,10)}.xlsx`, { compression: true }); }
    finally { button.disabled = false; }
  });
  run.addEventListener('click', async () => {
    run.disabled = true; status.textContent = 'בודק את הקבצים…';
    try {
      const [dashboardBook, attendanceBook] = await Promise.all([readFile(dashboardInput.files[0]), readFile(attendanceInput.files[0])]);
      const dashboardRows = parseAttendanceWorkbook(dashboardBook); const attendanceRows = parseAttendanceWorkbook(attendanceBook);
      if (!dashboardRows.length) throw new Error('לא נמצאו שורות בקובץ הדשבורד.'); if (!attendanceRows.length) throw new Error('לא נמצאו שורות עם מספר עובד ותאריך בקובץ הנוכחות.');
      result = compareAttendanceRows(attendanceRows, dashboardRows); status.textContent = ''; results.innerHTML = resultsHtml(result);
    } catch (error) { status.textContent = error?.message || 'קריאת הקבצים נכשלה.'; results.innerHTML = ''; }
    finally { update(); }
  });
  results.addEventListener('change', (event) => {
    const diff = event.target.closest('[data-comparison]'); if (!diff || !result) return;
    const comparison = result.comparisons.find((row) => row.id === diff.dataset.comparison); const field = diff.dataset.field;
    if (event.target.matches('[data-attendance-choice]')) { const custom = diff.querySelector('[data-attendance-custom]'); custom.hidden = event.target.value !== 'custom'; applyAttendanceChoice(comparison, field, event.target.value, custom.value); }
    if (event.target.matches('[data-attendance-custom]')) applyAttendanceChoice(comparison, field, 'custom', event.target.value);
  });
  results.addEventListener('click', (event) => { if (!event.target.closest('[data-attendance-export]') || !result) return; XLSX.writeFile(buildCorrectedAttendanceWorkbook(result.comparisons, result.dashboardPopulation), `דוח_נוכחות_מתוקן_${new Date().toISOString().slice(0,10)}.xlsx`, { compression: true }); });
}
