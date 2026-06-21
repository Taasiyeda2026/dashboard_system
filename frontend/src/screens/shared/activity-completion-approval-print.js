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

function text(value) {
  const clean = String(value ?? '').trim();
  if (!clean || ['null', 'undefined', 'לא עודכן'].includes(clean.toLowerCase())) return '';
  return clean;
}

function norm(value) {
  return text(value).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase();
}

function cleanSchoolName(activity) {
  const authority = getActivityAuthorityName(activity);
  const school = getActivitySchoolDisplayName(activity);
  if (!school || school === 'לא משויך') return '';
  const nSchool = norm(school);
  const nAuthority = norm(authority);
  if (nAuthority && nSchool.endsWith(nAuthority)) {
    return school.replace(new RegExp(`\\s*[-–,]?\\s*${authority.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '').trim() || school;
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
  (Array.isArray(rows) ? rows : []).forEach((row) => getInstructorEntries(row).forEach((entry) => names.add(entry.name)));
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

function schoolAddress(activity, directory) {
  return text(activity?.school_address || activity?.address) || text(findSchoolRows(activity, directory)[0]?.address);
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
            empId: instructorEntry.empId,
            date: activityDate,
            authority,
            school,
            address: schoolAddress(activity, directory),
            contact: schoolContact(activity, directory, contactsIndex),
            activities: []
          });
        }
        const group = groups.get(key);
        if (!group.address) group.address = schoolAddress(activity, directory);
        if (!group.contact.name && !group.contact.phone && !group.contact.email) group.contact = schoolContact(activity, directory, contactsIndex);
        group.activities.push({
          name: getActivityName(activity),
          type: text(activity?.activity_type || activity?.type || activity?.program_type),
          grade: getActivityGradeLabel(activity),
          group: text(activity?.class_name || activity?.group_name || activity?.class || activity?.group),
          time: getActivityTimeRange(activity),
          start: text(activity?.start_time || activity?.StartTime),
          end: text(activity?.end_time || activity?.EndTime),
          notes: text(activity?.notes || activity?.operations_private_notes || activity?.public_notes)
        });
      });
    });
  });
  return Array.from(groups.values()).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.school.localeCompare(b.school, 'he'));
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
  return `<div><strong>${escapeHtml(label)}:</strong> ${value ? escapeHtml(value) : BLANK}</div>`;
}

export function completionApprovalDocumentHtml(approval) {
  const rows = approval.activities.map((activity) => `<tr>
    <td>${escapeHtml(activity.name)}</td><td>${escapeHtml(activity.type)}</td><td>${escapeHtml(activity.grade)}</td><td>${escapeHtml(activity.group)}</td>
    <td>${escapeHtml(activity.start || (activity.time || '').split('-')[0]?.trim() || '')}</td><td>${escapeHtml(activity.end || (activity.time || '').split('-')[1]?.trim() || '')}</td>
    <td>${BLANK}</td><td>${escapeHtml(activity.notes)}</td>
  </tr>`).join('');
  return `<article class="completion-approval-page" dir="rtl">
    <header class="completion-approval-header"><h1>עמותת תעשיידע – תעשייה למען חינוך מתקדם</h1><h2>אישור ביצוע פעילות</h2></header>
    <section class="completion-approval-details">
      ${field('רשות', approval.authority)}${field('שם בית ספר', approval.school)}${field('כתובת בית ספר', approval.address)}${field('תאריך פעילות', formatDateHe(approval.date) || approval.date)}${field('שם מדריך/ה', approval.instructorName)}${field('מספר עובד', approval.empId)}
    </section>
    <section class="completion-approval-contact"><h3>פרטי איש קשר מטעם בית הספר</h3>
      ${field('שם איש קשר', approval.contact.name)}${field('תפקיד', approval.contact.role)}${field('טלפון', approval.contact.phone)}${field('דוא״ל', approval.contact.email)}
    </section>
    <table class="completion-approval-table"><thead><tr><th>שם סדנה / פעילות</th><th>סוג פעילות</th><th>כיתה / שכבה</th><th>קבוצה</th><th>שעת התחלה</th><th>שעת סיום</th><th>מספר משתתפים</th><th>הערות</th></tr></thead><tbody>${rows}</tbody></table>
    <section class="completion-approval-signature"><h3>אישור בית הספר</h3><p>אני מאשר/ת כי הפעילות המפורטת לעיל התקיימה בבית הספר בתאריך המצוין.</p>
      <p>שם איש/אשת הקשר בבית הספר: _______________________</p><p>תפקיד: _______________________</p><p>חתימה: _______________________</p><p>חותמת בית הספר: _______________________</p><p>תאריך חתימה: _______________________</p><p>הערות בית הספר:</p><p>____________________________________________________</p><p>____________________________________________________</p>
    </section>
  </article>`;
}

export function completionApprovalsPrintHtml(approvals = []) {
  return approvals.map(completionApprovalDocumentHtml).join('');
}

export const completionApprovalPrintCss = `
  body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:0;color:#111827;background:#fff;font-size:12px;line-height:1.45}
  .completion-approval-page{box-sizing:border-box;min-height:277mm;padding:12mm;break-after:page;page-break-after:always;background:#fff}
  .completion-approval-page:last-child{break-after:auto;page-break-after:auto}
  .completion-approval-header{text-align:center;border-bottom:1px solid #111827;padding-bottom:8px;margin-bottom:10px}.completion-approval-header h1{font-size:17px;margin:0 0 4px}.completion-approval-header h2{font-size:20px;margin:0}
  .completion-approval-details,.completion-approval-contact{display:grid;grid-template-columns:1fr 1fr;gap:5px 18px;margin:9px 0}.completion-approval-contact h3,.completion-approval-signature h3{grid-column:1/-1;margin:0 0 3px;font-size:15px}
  .completion-approval-table{width:100%;border-collapse:collapse;margin:10px 0;table-layout:fixed}.completion-approval-table th,.completion-approval-table td{border:1px solid #334155;padding:5px;text-align:right;vertical-align:top;word-break:break-word}.completion-approval-table th{background:#f1f5f9;font-weight:700}.completion-approval-table th:nth-child(7),.completion-approval-table td:nth-child(7){width:78px;text-align:center}
  .completion-approval-signature{margin-top:12px;break-inside:avoid;page-break-inside:avoid}.completion-approval-signature p{margin:7px 0}
  @page{size:A4 portrait;margin:0}@media print{body{margin:0}.completion-approval-page{break-after:page;page-break-after:always}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}}
`;
