import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import {
  approvalFileTitle,
  buildCompletionApprovals,
  completionApprovalPrintCss,
  completionApprovalsPrintHtml
} from './shared/activity-completion-approval-print.js';

let printContext = [];

const COMPLETION_APPROVAL_SUMMER_FROM = '2026-06-20';
const COMPLETION_APPROVAL_SUMMER_TO = '2026-08-31';

function normalizeCompletionApprovalType(value) {
  return String(value || '').trim().replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/[\s_-]+/g, ' ').toLowerCase();
}
function isIncludedCompletionApprovalActivityType(row) {
  return [row?.activity_type, row?.item_type, row?.type, row?.activityType, row?.activity_name, row?.activityName].some((value) => {
    const normalized = normalizeCompletionApprovalType(value);
    return normalized === 'workshop' || normalized === 'escape room' || normalized === 'סדנה' || normalized === 'סדנאות' || normalized === 'חדר בריחה' || normalized === 'חדרי בריחה';
  });
}
function activityDateInCompletionApprovalSummer(row) {
  const raw = text(row?.start_date || row?.activity_date || row?.date || '');
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= COMPLETION_APPROVAL_SUMMER_FROM && date <= COMPLETION_APPROVAL_SUMMER_TO;
}
function isSummerCompletionApprovalRow(row) {
  return isIncludedCompletionApprovalActivityType(row) && activityDateInCompletionApprovalSummer(row);
}


function text(value) { return String(value ?? '').trim(); }
function norm(value) { return text(value).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase(); }
function currentInstructorName(state) {
  const user = state?.user || {};
  return text(user.full_name || user.name || user.username || user.email || '');
}
function currentIdentityValues(state) {
  const user = state?.user || {};
  return [user.emp_id, user.employee_id, user.user_id].map(text).filter(Boolean);
}
function currentEmpId(state) { return currentIdentityValues(state)[0] || ''; }
function assignedToCurrentInstructor(row, ids) {
  const values = Array.isArray(ids) ? ids : [ids];
  if (!values.length) return false;
  return values.includes(text(row?.emp_id)) || values.includes(text(row?.emp_id_2));
}
function instructorNameForRows(rows, ids, fallback) {
  const hit = (Array.isArray(rows) ? rows : []).find((row) => assignedToCurrentInstructor(row, ids));
  if (!hit) return fallback;
  if (ids.includes(text(hit.emp_id))) return text(hit.instructor_name || hit.instructor || fallback);
  if (ids.includes(text(hit.emp_id_2))) return text(hit.instructor_name_2 || hit.instructor_2 || fallback);
  return fallback;
}
function uploadKey(approval) {
  return `${text(approval?.date)}|${norm(approval?.authority)}|${norm(approval?.school)}`;
}
function uploadsByApproval(uploads = []) {
  const map = new Map();
  (Array.isArray(uploads) ? uploads : []).forEach((upload) => {
    const key = `${text(upload?.activity_date)}|${norm(upload?.authority)}|${norm(upload?.school)}`;
    if (!map.has(key)) map.set(key, upload);
  });
  return map;
}
function statusLabel(upload) {
  const status = text(upload?.status);
  if (status === 'approved') return 'אושר';
  if (status === 'rejected') return 'נדחה';
  if (status === 'uploaded' || upload?.file_path) return 'הועלה';
  return 'טרם הועלה';
}
function printApprovals(approvals, title) {
  if (!approvals?.length) return;
  const safeTitle = title || 'אישור ביצוע';
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(safeTitle)}</title><style>${completionApprovalPrintCss}</style></head><body>${completionApprovalsPrintHtml(approvals)}</body></html>`;
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) { alert('לא ניתן לפתוח חלון הדפסה. יש לאפשר חלונות קופצים.'); return; }
  win.document.open(); win.document.write(html); win.document.close(); win.focus();
  setTimeout(() => { try { win.print(); } catch { /* ignore */ } }, 250);
}

export const instructorCompletionApprovalsScreen = {
  load: async ({ api }) => {
    const [myData, uploads] = await Promise.all([
      api.myData(),
      api.completionApprovalUploads().catch(() => ({ rows: [] }))
    ]);
    return { rows: myData?.rows || [], uploads: uploads?.rows || [] };
  },
  render(data, { state } = {}) {
    const ids = currentIdentityValues(state);
    const rows = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => assignedToCurrentInstructor(row, ids) && isSummerCompletionApprovalRow(row));
    const instructorName = instructorNameForRows(rows, ids, currentInstructorName(state));
    const approvals = buildCompletionApprovals(rows, { instructor: instructorName, dateMode: 'range', dateFrom: COMPLETION_APPROVAL_SUMMER_FROM, dateTo: COMPLETION_APPROVAL_SUMMER_TO });
    const uploadMap = uploadsByApproval(data?.uploads || []);
    printContext = approvals;
    const body = approvals.map((approval, index) => {
      const upload = uploadMap.get(uploadKey(approval));
      const activities = approval.activities.map((activity) => escapeHtml(activity.name)).join('<br>');
      return `<tr>
        <td>${escapeHtml(formatDateHe(approval.date) || approval.date || '')}</td>
        <td>${escapeHtml(approval.authority || '')}</td>
        <td>${escapeHtml(approval.school || '')}</td>
        <td>${activities}</td>
        <td><button type="button" class="ds-btn ds-btn--xs ds-btn--primary" data-approval-print="${index}">צפייה / הדפסה</button></td>
        <td><label class="ds-btn ds-btn--xs ds-btn--secondary">העלאת אישור חתום<input class="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-approval-upload="${index}"></label></td>
        <td>${escapeHtml(statusLabel(upload))}${upload?.file_name ? `<br><small>${escapeHtml(upload.file_name)}</small>` : ''}</td>
      </tr>`;
    }).join('');
    const table = approvals.length
      ? dsTableWrap(`<table class="ds-table ds-table--compact"><thead><tr><th>תאריך</th><th>רשות</th><th>בית ספר</th><th>רשימת פעילויות</th><th>צפייה / הדפסה</th><th>העלאה</th><th>סטטוס העלאה</th></tr></thead><tbody>${body}</tbody></table>`)
      : dsEmptyState('לא נמצאו אישורי ביצוע אישיים להפקה');
    return dsScreenStack(`${dsPageHeader('אישורי ביצוע', 'אישורי ביצוע אישיים לפי הפעילויות שלך')}${dsCard({ title: 'האישורים שלי', badge: String(approvals.length), body: table, padded: false })}`);
  },
  bind({ root, api, state, rerender, clearScreenDataCache }) {
    root.querySelectorAll('[data-approval-print]').forEach((btn) => btn.addEventListener('click', () => {
      const approval = printContext[Number(btn.getAttribute('data-approval-print'))];
      if (approval) printApprovals([approval], approvalFileTitle(approval));
    }));
    root.querySelectorAll('[data-approval-upload]').forEach((input) => input.addEventListener('change', async () => {
      const approval = printContext[Number(input.getAttribute('data-approval-upload'))];
      const file = input.files?.[0];
      if (!approval || !file) return;
      try {
        await api.uploadCompletionApproval({ approval, file, instructorEmpId: currentEmpId(state), instructorName: approval.instructorName || currentInstructorName(state) });
        clearScreenDataCache?.('instructor-completion-approvals');
        rerender?.();
      } catch (error) {
        alert(`העלאת הקובץ נכשלה: ${error?.message || error}`);
      } finally {
        input.value = '';
      }
    }));
  }
};
