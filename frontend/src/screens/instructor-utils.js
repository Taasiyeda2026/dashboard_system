import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { buildCompletionApprovals, openApprovalPrintWindow, approvalFileTitle } from './shared/activity-completion-approval-print.js';
import { getActivityAuthorityName, getActivityInstructorNames, getActivitySchoolDisplayName, getActivitySchoolNames } from './shared/operations-activity-helpers.js';
import { completionApprovalStatusInfo, findMatchingCompletionApprovalUpload } from './shared/completion-approval-status.js';

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
export function participants(row) { const v = row?.participants_count ?? row?.participants ?? row?.participant_count; return v === null || v === undefined || text(v) === '' ? '—' : text(v); }
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
export function completionStatusFromUpload(upload) {
  return completionApprovalStatusInfo(upload);
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

export function photoApprovalStatus(row) {
  const raw = [row?.photo_approval, row?.photo_consent, row?.photo_consent_status, row?.photo_permission, row?.media_consent, row?.has_photo_approval]
    .map(text)
    .find(Boolean) || '';
  const normalized = norm(raw);
  if (row?.has_photo_approval === true || ['yes', 'true', '1', 'approved', 'אושר', 'יש', 'קיים', 'מאושר'].includes(normalized)) {
    return { key: 'approved', label: 'יש אישור צילום' };
  }
  if (row?.has_photo_approval === false || ['no', 'false', '0', 'missing', 'אין', 'חסר', 'לא'].includes(normalized)) {
    return { key: 'missing', label: 'אין אישור צילום' };
  }
  return { key: 'missing', label: 'לא עודכן אישור צילום' };
}

function cleanDetailValue(value) {
  const cleaned = text(value);
  return cleaned && cleaned !== '—' && cleaned !== 'לא עודכן' ? cleaned : '';
}

function schoolContactDetailHtml(row) {
  const name = cleanDetailValue(row?.school_contact_name || row?.contact_name);
  const phone = cleanDetailValue(row?.school_contact_phone || row?.contact_phone || row?.mobile || row?.phone);
  const role = cleanDetailValue(row?.school_contact_role || row?.contact_role);
  const parts = [name, role, phone].filter(Boolean);
  return parts.length ? parts.map(escapeHtml).join('<br>') : '';
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

function photoApprovalSectionHtml(photoUpload) {
  const fi = '<input type="file" accept=".pdf,.jpg,.jpeg,.png" style="display:none" data-instr-photo-file-input>';
  if (photoUpload?.file_path) {
    return `${statusChipHtml({ key: 'approved', label: 'יש אישור צילום' })} <button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" data-instr-view-photo title="צפייה בקובץ">👁</button> <button type="button" class="ds-btn ds-btn--xs ds-btn--secondary" data-instr-replace-photo>החלף</button>${fi}`;
  }
  return `${statusChipHtml({ key: 'missing', label: 'לא הועלה אישור צילום' })} <button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-instr-upload-photo>העלאת אישור צילום</button>${fi}`;
}

export function activityDetailHtml(row, { ids = [], teamMap = new Map(), upload = null, photoUpload = null } = {}) {
  const group = groupForRow(row, teamMap);
  const status = completionStatusFromUpload(upload, row);
  const responsible = cleanDetailValue(group?.responsibleName);
  const mineResponsible = isResponsibleForGroup(group, ids);
  const peersHtml = peerInstructorsHtml(row, ids, group);
  const contactHtml = schoolContactDetailHtml(row);
  const fields = [
    ['שם פעילות', rowTitle(row)],
    ['תאריך', formatDateHe(isoDate(row?.start_date || row?.activity_date)) || isoDate(row?.start_date || row?.activity_date) || '—'],
    ['שעות', activityHours(row)],
    ['בית ספר', text(row?.school) || '—'],
    ['סוג פעילות', text(row?.activity_type || row?.type || row?.item_type) || '—'],
    ['שכבה / קבוצה', text(row?.grade || row?.group_name) || '—'],
    ['מספר משתתפים', participants(row)],
    contactHtml ? ['איש קשר בית ספר', contactHtml] : null,
    ['אישור צילום', `<span data-instr-photo-section>${photoApprovalSectionHtml(photoUpload)}</span>`],
    ['אישור ביצוע', statusChipHtml(status)],
    peersHtml ? ['מי משובץ איתי', peersHtml] : null,
    responsible ? ['אחראי קשר', `${escapeHtml(responsible)}${mineResponsible ? ' ' + statusChipHtml({ key: 'contact', label: 'אני אחראי קשר' }) : ''}`] : null
  ].filter(Boolean);
  return `<div class="instr-detail">${mineResponsible ? '<div class="instr-contact-note"><strong>את/ה אחראי/ת קשר</strong><br>יש לוודא את קיום הפעילות מול איש הקשר בבית הספר ולעדכן את שאר הצוות.</div>' : ''}<div class="instr-detail-grid">${fields.map(([k, v]) => `<div class="instr-info-row"><span>${escapeHtml(k)}</span><strong>${typeof v === 'string' && v.includes('<') ? v : escapeHtml(v)}</strong></div>`).join('')}</div><div class="instr-detail-actions"><button class="ds-btn ds-btn--sm ds-btn--secondary" data-instr-print-approval>הדפסת אישור</button><button class="ds-btn ds-btn--sm ds-btn--primary" data-instr-upload-approval>העלאת אישור</button><button class="ds-btn ds-btn--sm ds-btn--ghost" data-ui-close-drawer>סגור</button></div></div>`;
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

export function findCompletionUploadForRow(row, uploads = [], instructorEmpId = '') {
  if (!row || !Array.isArray(uploads) || !uploads.length) return null;
  return findMatchingCompletionApprovalUpload(uploads, {
    rowIds: [row?.RowID, row?.row_id, row?.id, row?.activity_id, row?.uuid],
    instructorEmpId,
    date: row?.start_date || row?.activity_date || row?.date,
    authority: row?.authority,
    school: row?.school
  });
}

export function findPhotoUploadForRow(row, instructorEmpId, photoUploads = []) {
  if (!instructorEmpId || !Array.isArray(photoUploads) || !photoUploads.length) return null;
  const empIdNorm = norm(String(instructorEmpId));
  const myUploads = photoUploads.filter((u) => norm(String(u?.instructor_emp_id || '')) === empIdNorm);
  if (!myUploads.length) return null;
  const rowSchoolId = text(row?.school_id || row?.contact_school_id || '');
  if (rowSchoolId) {
    const byId = myUploads.find((u) => text(u?.school_id || '') === rowSchoolId);
    if (byId) return byId;
  }
  const rowSchool = norm(row?.school || row?.single_school_name || '');
  const rowAuthority = norm(row?.authority || '');
  if (!rowSchool) return null;
  return myUploads.find((u) => {
    const uSchool = norm(u?.school || '');
    if (!uSchool || uSchool !== rowSchool) return false;
    const uAuth = norm(u?.authority || '');
    return !rowAuthority || !uAuth || uAuth === rowAuthority;
  }) || null;
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

export function bindActivityDetailActions(contentNode, { row, state, allInstructorRows = [], api = null, photoUpload = null } = {}) {
  contentNode?.querySelector('[data-instr-print-approval]')?.addEventListener('click', () => {
    openInstructorApprovalForActivity(row, { state, allInstructorRows });
  });
  contentNode?.querySelector('[data-instr-upload-approval]')?.addEventListener('click', () => {
    const approval = resolveInstructorApprovalForRow(row, allInstructorRows, instructorNameForRow(row, currentInstructorIds(state), '') || currentInstructorName(state));
    if (approval) {
      try { sessionStorage.setItem('instructor_completion_approval_target', JSON.stringify({ date: approval.date, authority: approval.authority, school: approval.school })); } catch { /* ignore */ }
    }
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-completion-approvals' } }));
    document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]')?.click();
  });
  const photoSection = contentNode?.querySelector('[data-instr-photo-section]');
  if (photoSection && api) {
    let currentPhotoUpload = photoUpload;
    const bindPhotoSectionEvents = () => {
      const fi = photoSection.querySelector('[data-instr-photo-file-input]');
      photoSection.querySelector('[data-instr-upload-photo]')?.addEventListener('click', () => fi?.click());
      photoSection.querySelector('[data-instr-replace-photo]')?.addEventListener('click', () => fi?.click());
      photoSection.querySelector('[data-instr-view-photo]')?.addEventListener('click', async () => {
        if (!currentPhotoUpload?.file_path) return;
        try {
          const res = await api.photoApprovalSignedUrl({ filePath: currentPhotoUpload.file_path });
          if (res?.signedUrl) window.open(res.signedUrl, '_blank', 'noopener,noreferrer');
        } catch (err) { alert('שגיאה בפתיחת קובץ אישור הצילום: ' + (err?.message || '')); }
      });
      fi?.addEventListener('change', async (ev) => {
        const file = ev.target.files?.[0];
        if (!file) return;
        const instructorEmpId = currentInstructorIds(state)?.[0] || '';
        if (!instructorEmpId) { alert('לא נמצא מזהה מדריך.'); return; }
        const uploadBtn = photoSection.querySelector('[data-instr-upload-photo], [data-instr-replace-photo]');
        const origText = uploadBtn?.textContent || '';
        if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'מעלה...'; }
        try {
          let result;
          if (currentPhotoUpload?.id) {
            result = await api.replacePhotoApproval({ id: currentPhotoUpload.id, file });
          } else {
            result = await api.uploadPhotoApproval({
              instructorEmpId,
              instructorName: currentInstructorName(state),
              school: text(row?.school || ''),
              authority: text(row?.authority || ''),
              schoolId: text(row?.school_id || ''),
              file
            });
          }
          currentPhotoUpload = result?.row || null;
          photoSection.innerHTML = photoApprovalSectionHtml(currentPhotoUpload);
          bindPhotoSectionEvents();
        } catch (err) {
          alert('שגיאה בהעלאת אישור הצילום: ' + (err?.message || 'שגיאה לא ידועה'));
          if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = origText; }
        }
      });
    };
    bindPhotoSectionEvents();
  }
}
