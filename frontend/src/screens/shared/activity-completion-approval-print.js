import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';
import {
  getActivityAuthorityName,
  getActivityName,
  getActivityPrimaryDate,
  getActivityScheduleDates,
  getActivitySchoolDisplayName,
  getActivitySchoolNames,
  getActivityTimeRange,
  getActivityGradeLabel,
  isValidInstructorName
} from './operations-activity-helpers.js';

const BLANK = '________________';
const ORG_NAME = 'עמותת תעשיידע – תעשייה למען חינוך מתקדם';
const taasiyedaLogoSrc = new URL('../../../assets/logo1.png', import.meta.url).href;

function text(value) {
  const clean = String(value ?? '').trim();
  if (!clean || ['null', 'undefined', 'לא עודכן'].includes(clean.toLowerCase())) return '';
  return clean;
}

function norm(value) {
  return text(value).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function isDeletedActivity(activity) {
  return norm(activity?.status) === norm('נמחק');
}

function cleanSchoolName(activity) {
  const authority = getActivityAuthorityName(activity);
  const school = getActivitySchoolDisplayName(activity);
  if (!school || school === 'לא משויך') return '';
  const nSchool = norm(school);
  const nAuthority = norm(authority);
  if (nAuthority && nSchool.endsWith(nAuthority)) {
    return school.replace(new RegExp(String.raw`\s*[-–,]?\s*${authority.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\s*$`), '').trim() || school;
  }
  return school;
}

function activityDates(activity) {
  const dates = getActivityScheduleDates(activity);
  if (dates.length) return dates;
  const primary = getActivityPrimaryDate(activity);
  return primary ? [primary] : [];
}

function getInstructorEntries(activity) {
  const entries = [];
  const add = (name, empId) => {
    const cleanName = text(name);
    if (!isValidInstructorName(cleanName)) return;
    if (entries.some((entry) => norm(entry.name) === norm(cleanName))) return;
    entries.push({ name: cleanName, empId: text(empId) });
  };
  add(activity?.instructor_name || activity?.instructor || activity?.guide_name || activity?.guide, activity?.emp_id || activity?.employee_id || activity?.instructor_emp_id);
  add(activity?.instructor_name_2 || activity?.instructor_2 || activity?.guide_name_2 || activity?.guide_2, activity?.emp_id_2 || activity?.employee_id_2 || activity?.instructor_emp_id_2);
  return entries;
}

export function completionApprovalInstructorOptions(rows = []) {
  const names = new Set();
  (Array.isArray(rows) ? rows : [])
    .filter((row) => !isDeletedActivity(row))
    .forEach((row) => getInstructorEntries(row).forEach((entry) => names.add(entry.name)));
  return Array.from(names).sort((a, b) => a.localeCompare(b, 'he'));
}

function findSchoolRows(activity, directory) {
  const rows = Array.isArray(directory?.rows) ? directory.rows : [];
  const schoolId = text(activity?.school_id || activity?.single_school_id);
  const authority = norm(getActivityAuthorityName(activity));
  const schools = getActivitySchoolNames(activity).map(norm);
  return rows.filter((row) => {
    if (schoolId && text(row.school_id) === schoolId) return true;
    return authority && norm(row.authority) === authority && schools.includes(norm(row.school_name || row.school));
  });
}

function schoolContact(activity, directory, contactsIndex) {
  const direct = {
    name: text(activity?.contact_name || activity?.school_contact_name),
    role: text(activity?.contact_role || activity?.school_contact_role),
    phone: text(activity?.contact_phone || activity?.mobile || activity?.phone || activity?.contact_mobile),
    email: text(activity?.contact_email || activity?.email || activity?.contact_mail)
  };
  if (direct.name || direct.phone || direct.email) return direct;
  const authorityKey = norm(getActivityAuthorityName(activity));
  for (const schoolName of getActivitySchoolNames(activity)) {
    const options = contactsIndex instanceof Map ? (contactsIndex.get(`${authorityKey}|${norm(schoolName)}`) || []) : [];
    const first = options.find((option) => text(option.name || option.contact_name));
    if (first) return { name: text(first.name || first.contact_name), role: text(first.role || first.contact_role), phone: text(first.phone || first.mobile), email: text(first.email || first.contact_email) };
  }
  const schoolRow = findSchoolRows(activity, directory)[0];
  if (schoolRow?.principal_name || schoolRow?.school_phone) {
    return { name: text(schoolRow.principal_name), role: text(schoolRow.principal_name) ? 'מנהל/ת' : '', phone: text(schoolRow.school_phone), email: '' };
  }
  return { name: '', role: '', phone: '', email: '' };
}

function rowKey(activity, date, instructorName) {
  return [activity?.id, activity?.activity_id, activity?.uuid, activity?.RowID, date, instructorName, getActivityName(activity), getActivityTimeRange(activity)].map(text).join('|');
}

export function buildCompletionApprovals(rows = [], { instructor = '', dateMode = 'all', date = '', dateFrom = '', dateTo = '', directory = {}, contactsIndex = new Map() } = {}) {
  const selected = text(instructor);
  if (!selected) return [];
  const groups = new Map();
  const seen = new Set();
  (Array.isArray(rows) ? rows : []).forEach((activity) => {
    if (isDeletedActivity(activity)) return;
    getInstructorEntries(activity).forEach((instructorEntry) => {
      if (instructorEntry.name !== selected) return;
      activityDates(activity).forEach((activityDate) => {
        if (dateMode === 'single' && date && activityDate !== date) return;
        if (dateMode === 'range') {
          if (dateFrom && activityDate < dateFrom) return;
          if (dateTo && activityDate > dateTo) return;
        }
        const unique = rowKey(activity, activityDate, instructorEntry.name);
        if (seen.has(unique)) return;
        seen.add(unique);
        const authority = getActivityAuthorityName(activity);
        const school = cleanSchoolName(activity);
        const key = `${norm(instructorEntry.name)}|${activityDate}|${norm(authority)}|${norm(school)}`;
        if (!groups.has(key)) {
          groups.set(key, {
            id: key,
            instructorName: instructorEntry.name,
            date: activityDate,
            authority,
            school,
            contact: schoolContact(activity, directory, contactsIndex),
            activities: []
          });
        }
        const group = groups.get(key);
        if (!group.contact.name && !group.contact.phone && !group.contact.email) group.contact = schoolContact(activity, directory, contactsIndex);
        group.activities.push({
          name: getActivityName(activity),
          grade: getActivityGradeLabel(activity),
          time: getActivityTimeRange(activity),
          start: text(activity?.start_time || activity?.StartTime),
          end: text(activity?.end_time || activity?.EndTime)
        });
      });
    });
  });
  return Array.from(groups.values()).map((group) => ({
    ...group,
    activities: sortApprovalActivitiesByTime(group.activities)
  })).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.school.localeCompare(b.school, 'he'));
}

export function approvalFileTitle(approval) {
  return sanitizeFileTitle(`${approval?.instructorName || 'מדריך'} - ${formatDateHe(approval?.date) || approval?.date || 'תאריך'} - ${approval?.school || 'בית ספר'}`);
}

export function approvalsBatchTitle(approvals = [], instructorName = '') {
  const dates = approvals.map((approval) => approval.date).filter(Boolean).sort();
  const range = dates.length ? `${formatDateHe(dates[0])}${dates[0] !== dates[dates.length - 1] ? ` עד ${formatDateHe(dates[dates.length - 1])}` : ''}` : 'כל התאריכים';
  return sanitizeFileTitle(`אישורי ביצוע - ${instructorName || 'מדריך'} - ${range}`);
}

export function sanitizeFileTitle(value) {
  return text(value).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function field(label, value) {
  const displayValue = value ? escapeHtml(value) : BLANK;
  return `<div class="completion-approval-detail-row" data-print-text="${escapeHtml(`${label}: ${value || BLANK}`)}"><strong>${escapeHtml(label)}:</strong> <span>${displayValue}</span></div>`;
}

export function formatApprovalTime(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
  }
  const clean = text(value);
  if (!clean) return '';
  const timeMatch = clean.match(/(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?/);
  if (timeMatch) return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  const date = new Date(clean);
  if (!Number.isNaN(date.getTime())) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
  return '';
}

export function sortApprovalActivitiesByTime(entries = []) {
  return (Array.isArray(entries) ? entries : []).slice().sort((a, b) => {
    const startA = formatApprovalTime(a?.start || (a?.time || '').split('-')[0]?.trim());
    const startB = formatApprovalTime(b?.start || (b?.time || '').split('-')[0]?.trim());
    if (startA && !startB) return -1;
    if (!startA && startB) return 1;
    if (startA !== startB) return startA.localeCompare(startB);

    const endA = formatApprovalTime(a?.end || (a?.time || '').split('-')[1]?.trim());
    const endB = formatApprovalTime(b?.end || (b?.time || '').split('-')[1]?.trim());
    if (endA && !endB) return -1;
    if (!endA && endB) return 1;
    if (endA !== endB) return endA.localeCompare(endB);

    return text(a?.name).localeCompare(text(b?.name), 'he');
  });
}

function approvalLine(label, extraClass = '') {
  const className = ['completion-approval-signature-line', extraClass].filter(Boolean).join(' ');
  return `<p class="${className}"><strong>${escapeHtml(label)}:</strong> <span class="approval-sign-line"></span></p>`;
}

export function completionApprovalDocumentHtml(approval) {
  const rows = sortApprovalActivitiesByTime(approval.activities).map((activity) => `<tr>
    <td>${escapeHtml(activity.name)}</td>
    <td class="completion-approval-table__center">${escapeHtml(activity.grade)}</td>
    <td class="completion-approval-table__center">${escapeHtml(formatApprovalTime(activity.start || (activity.time || '').split('-')[0]?.trim()))}</td>
    <td class="completion-approval-table__center">${escapeHtml(formatApprovalTime(activity.end || (activity.time || '').split('-')[1]?.trim()))}</td>
    <td class="completion-approval-table__manual"></td>
  </tr>`).join('');
  const authorityLine = text(approval.authority) ? field('רשות', approval.authority) : '';
  return `<article class="completion-approval-page" dir="rtl">
    <header class="completion-approval-header"><img class="completion-approval-logo" src="${escapeHtml(taasiyedaLogoSrc)}" alt="לוגו תעשיידע"><h1>אישור ביצוע פעילות</h1></header>
    <section class="completion-approval-details">
      ${field('בית ספר', approval.school)}
      ${authorityLine}
      ${field('תאריך פעילות', formatDateHe(approval.date) || approval.date)}
      ${field('מדריך/ה', approval.instructorName)}
    </section>
    <table class="completion-approval-table approval-print-table"><colgroup><col class="completion-approval-col-activity"><col class="completion-approval-col-grade"><col class="completion-approval-col-start"><col class="completion-approval-col-end"><col class="completion-approval-col-participants"></colgroup><thead><tr><th>שם הפעילות</th><th class="completion-approval-table__center">כיתה</th><th class="completion-approval-table__center">שעת התחלה</th><th class="completion-approval-table__center">שעת סיום</th><th>מספר משתתפים</th></tr></thead><tbody>${rows}</tbody></table>
    <section class="completion-approval-signature"><h3>אישור בית הספר</h3><p class="completion-approval-signature-summary">אני מאשר/ת כי הפעילות המפורטת לעיל התקיימה בבית הספר בתאריך המצוין.</p>
      ${approvalLine('שם מלא')}
      ${approvalLine('תפקיד', 'completion-approval-signature-line--double-after')}
      ${approvalLine('חתימה', 'completion-approval-signature-line--double-after')}
      ${approvalLine('חותמת בית הספר')}
    </section>
    <footer class="completion-approval-footer">${escapeHtml(ORG_NAME)}</footer>
  </article>`;
}

export function completionApprovalsPrintHtml(approvals = []) {
  return approvals.map(completionApprovalDocumentHtml).join('');
}

export const completionApprovalPrintCss = `
  body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:0;color:#111827;background:#fff;font-size:12px;line-height:1.45}
  .completion-approval-page{box-sizing:border-box;min-height:277mm;padding:12mm 12mm 10mm;break-after:page;page-break-after:always;background:#fff;display:flex;flex-direction:column}
  .completion-approval-page:last-child{break-after:auto;page-break-after:auto}
  .completion-approval-header{position:relative;text-align:center;border-bottom:1px solid #111827;padding:0 28mm 8px;margin-bottom:10px;min-height:22mm}.completion-approval-header h1{font-size:20px;margin:0;padding-top:7mm}.completion-approval-logo{position:absolute;inset-inline-end:0;top:0;height:42px;max-height:20mm;width:auto;object-fit:contain}
  .completion-approval-details{display:grid;grid-template-columns:1fr;gap:6px;margin:9px 0 14px;text-align:right;font-size:14px;color:#111827}.completion-approval-detail-row{font-size:14px;font-weight:400;line-height:1.45}.completion-approval-details strong{font-weight:700}.completion-approval-detail-row span{font-weight:400}
  .completion-approval-signature h3{margin:0 0 3px;font-size:15px}
  .completion-approval-table{border-collapse:collapse;margin:10px 0;table-layout:fixed}.approval-print-table{width:60%;margin-inline:auto}.completion-approval-col-activity{width:41.22%}.completion-approval-col-grade{width:13.26%}.completion-approval-col-start{width:13.26%}.completion-approval-col-end{width:13.26%}.completion-approval-col-participants{width:19%}.completion-approval-col-grade,.completion-approval-table td:nth-child(2),.completion-approval-table th:nth-child(2){white-space:normal;overflow-wrap:normal;word-break:keep-all}.completion-approval-table th,.completion-approval-table td{border:.5pt solid #cbd5e1;padding:4px 5px;text-align:right;vertical-align:middle;word-break:normal;overflow-wrap:anywhere}.completion-approval-table th{background:#f8fafc;font-weight:700;font-size:10.5px;line-height:1.25;white-space:nowrap;text-align:center;color:#111827}.completion-approval-table th:first-child,.completion-approval-table td:first-child{text-align:right}.completion-approval-table td{font-size:11.2px;line-height:1.35}.completion-approval-table__center{text-align:center!important}.completion-approval-table__manual{text-align:center;white-space:nowrap}
  .approval-sign-line{display:inline-block;width:220px;border-bottom:1px solid #111827;min-height:1.35em}
  .completion-approval-signature{margin-top:16px;break-inside:avoid;page-break-inside:avoid}.completion-approval-signature p{margin:16px 0}.completion-approval-signature-summary{margin:12px 0 18px}.completion-approval-signature-line{margin:16px 0}.completion-approval-signature-line--double-after{margin-bottom:40px}
  .completion-approval-footer{margin-top:auto;padding-top:8mm;text-align:center;font-size:10px;line-height:1.2;color:#64748b}
  @page{size:A4 portrait;margin:0}@media print{body{margin:0}.completion-approval-page{break-after:page;page-break-after:always}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}}
`;
