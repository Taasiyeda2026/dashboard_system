import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatTimeShort } from './shared/format-date.js';
import { buildCompletionApprovals, completionApprovalPrintCss, completionApprovalsPrintHtml, approvalFileTitle } from './shared/activity-completion-approval-print.js';

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

export function activityDetailHtml(row, { ids = [], teamMap = new Map(), upload = null } = {}) {
  const group = groupForRow(row, teamMap);
  const status = completionStatusFromUpload(upload, row);
  const instructors = (Array.isArray(group?.instructors) ? group.instructors : [])
    .map((i) => text(i.name || i.empId)).filter(Boolean);
  const responsible = text(group?.responsibleName || '—');
  const mineResponsible = isResponsibleForGroup(group, ids);
  const peer = peerNameForRow(row, ids);
  const fields = [
    ['שם פעילות', rowTitle(row)],
    ['תאריך', formatDateHe(isoDate(row?.start_date || row?.activity_date)) || isoDate(row?.start_date || row?.activity_date) || '—'],
    ['יום', weekdayNameHe(row?.start_date || row?.activity_date) || '—'],
    ['שעות', activityHours(row)],
    ['רשות', text(row?.authority) || '—'],
    ['בית ספר', text(row?.school) || '—'],
    ['שכבה / קבוצה', text(row?.grade || row?.group_name) || '—'],
    ['מספר משתתפים', participants(row)],
    ['סטטוס אישור ביצוע', statusChipHtml(status)],
    ['מי איתי היום', instructors.length ? instructors.join('<br>') : (peer || 'אין מדריך נוסף')],
    ['אחראי קשר', `${escapeHtml(responsible)}${mineResponsible ? ' ' + statusChipHtml({ key: 'contact', label: 'אני אחראי קשר' }) : ''}`]
  ];
  return `<div class="instr-detail">${mineResponsible ? '<div class="instr-contact-note"><strong>אתה אחראי קשר</strong><br>יש לוודא את קיום הפעילות מול איש הקשר בבית הספר לפחות 48 שעות לפני יום הפעילות ולעדכן את שאר הצוות.</div>' : ''}<div class="instr-detail-grid">${fields.map(([k, v]) => `<div class="instr-info-row"><span>${escapeHtml(k)}</span><strong>${typeof v === 'string' && v.includes('<') ? v : escapeHtml(v)}</strong></div>`).join('')}</div><div class="instr-detail-actions"><button class="ds-btn ds-btn--sm ds-btn--secondary" data-instr-print-current>צפייה / הדפסה</button><button class="ds-btn ds-btn--sm ds-btn--primary" data-instr-nav-approvals>העלאת אישור ביצוע</button><button class="ds-btn ds-btn--sm ds-btn--ghost" data-ui-close-drawer>סגור</button></div></div>`;
}

export function printSingleActivity(row, instructorName = '') {
  try {
    const approvals = buildCompletionApprovals([row], { instructor: instructorName });
    if (!approvals?.length) {
      alert('לא ניתן לפתוח את אישור הביצוע. חסרים נתונים לפעילות זו.');
      return;
    }
    const title = approvalFileTitle(approvals[0]) || 'אישור ביצוע';
    const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${completionApprovalPrintCss}</style></head><body>${completionApprovalsPrintHtml(approvals)}</body></html>`;
    const win = window.open('', '_blank', 'noopener,noreferrer');
    if (!win) { alert('לא ניתן לפתוח חלון הדפסה. יש לאפשר חלונות קופצים בדפדפן.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 300);
  } catch (err) {
    alert(`שגיאה בפתיחת אישור הביצוע: ${err?.message || 'שגיאה לא ידועה'}`);
  }
}

export function bindActivityDetailActions(contentNode, { ui, row, state } = {}) {
  if (!contentNode) return;
  contentNode.querySelector('[data-instr-print-current]')?.addEventListener('click', () => {
    const nameFromRow = instructorNameForRow(row, currentInstructorIds(state), '');
    const instructorName = nameFromRow || currentInstructorName(state);
    printSingleActivity(row, instructorName);
  });
  contentNode.querySelector('[data-instr-nav-approvals]')?.addEventListener('click', () => {
    try { ui?.closeDrawer(); } catch { /* ignore */ }
    setTimeout(() => {
      document.querySelector('.shell-nav__btn[data-route="instructor-completion-approvals"]')?.click();
    }, 80);
  });
}
