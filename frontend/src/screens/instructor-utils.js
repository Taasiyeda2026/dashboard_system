import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { buildCompletionApprovals, openApprovalPrintWindow, approvalFileTitle } from './shared/activity-completion-approval-print.js';
import { getActivityAuthorityName, getActivityInstructorNames, getActivitySchoolDisplayName, getActivitySchoolNames } from './shared/operations-activity-helpers.js';

export const WEEKDAYS_HE = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'יום ו׳', 'יום ש׳'];
export const WEEKDAY_SHORT_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

export function text(value) { return String(value ?? '').trim(); }
export function norm(value) { return text(value).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase(); }
export function isoDate(value) { const s = text(value).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : ''; }
export function monthKey(value) { return isoDate(value).slice(0, 7); }
export function parseLocalDate(iso) { const s = isoDate(iso); return s ? new Date(`${s}T12:00:00`) : null; }
export function weekdayNameHe(value) { const d = parseLocalDate(value); return d ? WEEKDAYS_HE[d.getDay()] : ''; }
export function activityHours(row) {
  const start = formatTimeShort(row?.start_time || row?.StartTime || '');
  const end = formatTimeShort(row?.end_time || row?.EndTime || '');
  return start && end ? `${start}–${end}` : (start || end || '—');
}
export function participants(row) { const v = row?.participants_count; return v === null || v === undefined || text(v) === '' ? '—' : text(v); }
export function currentInstructorIds(state) { const u = state?.user || {}; return [u.emp_id, u.employee_id, u.user_id, u.username].map(text).filter(Boolean); }
export function currentInstructorName(state) { const u = state?.user || {}; return text(u.full_name || u.name || u.username || u.email || ''); }
export function assignedToCurrentInstructor(row, ids) { return (Array.isArray(ids) ? ids : [ids]).some((id) => id && (id === text(row?.emp_id) || id === text(row?.emp_id_2))); }
export function instructorNameForRow(row, ids, fallback = '') {
  if ((Array.isArray(ids) ? ids : [ids]).includes(text(row?.emp_id))) return text(row?.instructor_name || row?.instructor || fallback);
  if ((Array.isArray(ids) ? ids : [ids]).includes(text(row?.emp_id_2))) return text(row?.instructor_name_2 || row?.instructor_2 || fallback);
  return fallback;
}
export function peerNameForRow(row, ids) {
  if ((Array.isArray(ids) ? ids : [ids]).includes(text(row?.emp_id))) return text(row?.instructor_name_2 || row?.instructor_2 || '');
  if ((Array.isArray(ids) ? ids : [ids]).includes(text(row?.emp_id_2))) return text(row?.instructor_name || row?.instructor || '');
  return '';
}
export function completionStatusFromUpload(upload, row = {}) {
  const raw = text(upload?.status || row?.completion_approval_status || '').toLowerCase();
  if (raw === 'approved' || raw === 'אושר') return { key: 'approved', label: 'אושר' };
  if (raw === 'rejected' || raw === 'נדחה') return { key: 'rejected', label: 'נדחה — נדרש תיקון' };
  if (raw === 'uploaded' || upload?.file_path || raw === 'הועלה' || raw.includes('uploaded')) return { key: 'uploaded', label: 'הועלה לבדיקה' };
  return { key: 'missing', label: 'טרם הועלה' };
}
export function statusChipHtml(status, extraClass = '') { return `<span class="instr-status instr-status--${escapeHtml(status.key)} ${escapeHtml(extraClass)}">${escapeHtml(status.label)}</span>`; }
export function contactGroupsByDateSchool(groups = []) {
  const map = new Map();
  (Array.isArray(groups) ? groups : []).forEach((g) => {
    const key = `${isoDate(g?.activity_date)}|${norm(g?.school)}`;
    if (key !== '|') map.set(key, g);
  });
  return map;
}
export function groupForRow(row, teamMap) { return teamMap?.get(`${isoDate(row?.start_date || row?.activity_date)}|${norm(row?.school)}`) || null; }
export function isResponsibleForGroup(group, ids) { return !!group && (Array.isArray(ids) ? ids : [ids]).includes(text(group.responsibleEmpId)); }
export function rowTitle(row) { return text(row?.activity_name || row?.activity || row?.activity_type || 'פעילות'); }

function schoolContactDetailHtml(row) {
  const name = text(row?.school_contact_name) || 'לא עודכן';
  const phone = text(row?.school_contact_phone) || 'לא עודכן';
  return `${escapeHtml(name)}<br>${escapeHtml(phone)}`;
}

function instructorEntriesForRow(row, group = null) {
  const entries = [];
  const add = (name, empId, phone, role) => {
    const entry = { name: text(name), empId: text(empId), phone: text(phone), role: text(role) };
    if (!entry.name && !entry.empId) return;
    const normalizedName = norm(entry.name);
    const existing = entries.find((item) => (entry.empId && item.empId === entry.empId) || (normalizedName && norm(item.name) === normalizedName));
    if (existing) {
      existing.name = existing.name || entry.name;
      existing.empId = existing.empId || entry.empId;
      existing.phone = existing.phone || entry.phone;
      existing.role = existing.role || entry.role;
      return;
    }
    entries.push(entry);
  };
  const rowNames = getActivityInstructorNames(row);
  add(rowNames[0] || row?.instructor_name || row?.instructor || row?.guide_name || row?.guide, row?.emp_id, row?.instructor_phone || row?.phone, row?.instructor_role || row?.role);
  add(rowNames[1] || row?.instructor_name_2 || row?.instructor_2 || row?.guide_name_2 || row?.guide_2, row?.emp_id_2, row?.instructor_phone_2 || row?.phone_2, row?.instructor_role_2 || row?.role_2);
  (Array.isArray(group?.instructors) ? group.instructors : []).forEach((instructor) => {
    if (typeof instructor === 'string') add(instructor, '', '', '');
    else add(instructor?.name || instructor?.full_name, instructor?.empId || instructor?.emp_id || instructor?.employee_id, instructor?.phone || instructor?.mobile, instructor?.role);
  });
  return entries;
}

function isCurrentInstructorEntry(entry, ids) {
  const idList = Array.isArray(ids) ? ids.map(text).filter(Boolean) : [text(ids)].filter(Boolean);
  return !!entry?.empId && idList.includes(entry.empId);
}

function peerInstructorsHtml(row, ids, group = null) {
  const assignedInstructors = instructorEntriesForRow(row, group);
  const currentAssignedCount = assignedInstructors.filter((entry) => isCurrentInstructorEntry(entry, ids)).length;
  const peers = assignedInstructors.filter((entry) => !isCurrentInstructorEntry(entry, ids));
  if (!peers.length && currentAssignedCount) return '<span class="instr-peer-solo">את/ה משובץ/ת לבד בפעילות זו</span>';
  if (!peers.length) return '';

  return peers.map((entry) => {
    const name = entry.name || entry.empId;
    const detailsText = [entry.phone, entry.role].filter(Boolean).join(' · ');
    return `<span class="instr-peer-card"><strong>${escapeHtml(name)}</strong>${detailsText ? `<small>${escapeHtml(detailsText)}</small>` : ''}</span>`;
  }).join('');
}

export function activityDetailHtml(row, { ids = [], teamMap = new Map(), upload = null } = {}) {
  const group = groupForRow(row, teamMap);
  const status = completionStatusFromUpload(upload, row);
  const responsible = text(group?.responsibleName || '—');
  const mineResponsible = isResponsibleForGroup(group, ids);
  const peersHtml = peerInstructorsHtml(row, ids, group);
  const fields = [
    ['שם פעילות', rowTitle(row)],
    ['תאריך', formatDateHe(isoDate(row?.start_date || row?.activity_date)) || isoDate(row?.start_date || row?.activity_date) || '—'],
    ['יום', weekdayNameHe(row?.start_date || row?.activity_date) || '—'],
    ['שעות', activityHours(row)],
    ['רשות', text(row?.authority) || '—'],
    ['בית ספר', text(row?.school) || '—'],
    ['איש קשר בבית הספר', schoolContactDetailHtml(row)],
    ['שכבה / קבוצה', text(row?.grade || row?.group_name) || '—'],
    ['מספר משתתפים', participants(row)],
    ['סטטוס אישור ביצוע', statusChipHtml(status)],
    peersHtml ? ['מי נמצא איתי', peersHtml] : null,
    ['אחראי קשר', `${escapeHtml(responsible)}${mineResponsible ? ' ' + statusChipHtml({ key: 'contact', label: 'אני אחראי קשר' }) : ''}`]
  ].filter(Boolean);
  return `<div class="instr-detail">${mineResponsible ? '<div class="instr-contact-note"><strong>אתה אחראי קשר</strong><br>יש לוודא את קיום הפעילות מול איש הקשר בבית הספר לפחות 48 שעות לפני יום הפעילות ולעדכן את שאר הצוות.</div>' : ''}<div class="instr-detail-grid">${fields.map(([k, v]) => `<div class="instr-info-row"><span>${escapeHtml(k)}</span><strong>${typeof v === 'string' && v.includes('<') ? v : escapeHtml(v)}</strong></div>`).join('')}</div><div class="instr-detail-actions"><button class="ds-btn ds-btn--sm ds-btn--ghost" data-ui-close-drawer>סגור</button></div></div>`;
}

function approvalMatchesRow(approval, row, instructorName = '') {
  if (!approval || !row) return false;
  const rowDate = isoDate(row?.start_date || row?.activity_date || row?.date || row?.date_1);
  if (rowDate && approval.date !== rowDate) return false;

  const rowAuthority = getActivityAuthorityName(row);
  if (rowAuthority && rowAuthority !== 'לא משויך' && norm(approval.authority) !== norm(rowAuthority)) return false;

  const rowSchools = [getActivitySchoolDisplayName(row), ...getActivitySchoolNames(row)]
    .map((school) => norm(school))
    .filter((school) => school && school !== norm('לא משויך'));
  if (rowSchools.length && !rowSchools.some((school) => norm(approval.school) === school || school.endsWith(norm(approval.school)) || norm(approval.school).endsWith(school))) return false;

  return !instructorName || norm(approval.instructorName) === norm(instructorName);
}

function instructorNamesForActivity(row, preferredName = '') {
  return [
    preferredName,
    row?.instructor_name,
    row?.instructor,
    row?.guide_name,
    row?.guide,
    row?.instructor_name_2,
    row?.instructor_2,
    row?.guide_name_2,
    row?.guide_2
  ].map(text).filter((name, index, names) => name && names.findIndex((other) => norm(other) === norm(name)) === index);
}

export function resolveInstructorApprovalForRow(row, allInstructorRows = [], instructorName = '') {
  const scopedRows = Array.isArray(allInstructorRows) && allInstructorRows.length ? allInstructorRows : [row];
  if (!row) return null;
  for (const selectedInstructor of instructorNamesForActivity(row, instructorName)) {
    const approvals = buildCompletionApprovals(scopedRows, { instructor: selectedInstructor });
    const exact = approvals.find((approval) => approvalMatchesRow(approval, row, selectedInstructor));
    if (exact) return exact;
    const sameActivityGroup = approvals.find((approval) => approvalMatchesRow(approval, row, ''));
    if (sameActivityGroup) return sameActivityGroup;
  }
  return null;
}

export function openInstructorApprovalForActivity(row, { instructorName = '', allInstructorRows = [], state = null } = {}) {
  const nameFromRow = instructorName || instructorNameForRow(row, currentInstructorIds(state), '');
  const selectedInstructor = nameFromRow || currentInstructorName(state);
  const approval = resolveInstructorApprovalForRow(row, allInstructorRows, selectedInstructor);
  if (!approval) {
    openApprovalPrintWindow([], '');
    return null;
  }
  openApprovalPrintWindow([approval], approvalFileTitle(approval));
  return approval;
}

export function printSingleActivity(row, instructorName = '', allInstructorRows = []) {
  try {
    const approval = resolveInstructorApprovalForRow(row, allInstructorRows, instructorName);
    if (!approval) {
      openApprovalPrintWindow([], '');
      return;
    }
    openApprovalPrintWindow([approval], approvalFileTitle(approval));
  } catch (err) {
    alert(`שגיאה בפתיחת אישור הביצוע: ${err?.message || 'שגיאה לא ידועה'}`);
  }
}

export function bindActivityDetailActions() {
  /* Activity detail drawer is info-only; upload/print live on אישורי ביצוע tab. */
}
