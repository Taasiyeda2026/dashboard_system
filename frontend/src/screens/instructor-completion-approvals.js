import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import {
  approvalFileTitle,
  buildCompletionApprovals,
  openApprovalPrintWindow
} from './shared/activity-completion-approval-print.js';

let approvalsByKey = new Map();

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
  const raw = String(row?.start_date || row?.activity_date || row?.date || '').trim();
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

function approvalStableKey(approval) {
  return [approval?.instructorName, approval?.date, approval?.authority, approval?.school].map((part) => norm(part)).join('|');
}
function uploadsByApproval(uploads = []) {
  const map = new Map();
  (Array.isArray(uploads) ? uploads : []).forEach((upload) => {
    const key = `${text(upload?.activity_date)}|${norm(upload?.authority)}|${norm(upload?.school)}`;
    if (!map.has(key)) map.set(key, upload);
  });
  return map;
}
function statusInfo(upload) {
  const status = text(upload?.status);
  if (status === 'approved') return { key: 'approved', label: 'אושר' };
  if (status === 'rejected') return { key: 'rejected', label: 'נדחה' };
  if (status === 'uploaded' || upload?.file_path) return { key: 'uploaded', label: 'הועלה לבדיקה' };
  return { key: 'missing', label: 'טרם הועלה' };
}
function statusChip(upload) {
  const st = statusInfo(upload);
  return `<span class="instr-status instr-status--${st.key}">${escapeHtml(st.label)}</span>`;
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
    const allAssignedRows = (Array.isArray(data?.rows) ? data.rows : []).filter((row) => assignedToCurrentInstructor(row, ids));
    const rows = allAssignedRows.filter(isSummerCompletionApprovalRow);
    const instructorName = instructorNameForRows(allAssignedRows, ids, currentInstructorName(state));
    const approvals = buildCompletionApprovals(rows, { instructor: instructorName, dateMode: 'range', dateFrom: COMPLETION_APPROVAL_SUMMER_FROM, dateTo: COMPLETION_APPROVAL_SUMMER_TO });
    const uploadMap = uploadsByApproval(data?.uploads || []);

    approvalsByKey = new Map(approvals.map((approval) => [approvalStableKey(approval), approval]));

    const statusCounts = { missing: 0, uploaded: 0, approved: 0, rejected: 0 };
    approvals.forEach((approval) => {
      const st = statusInfo(uploadMap.get(uploadKey(approval))).key;
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });

    const actCountLabel = (n) => n === 1 ? 'פעילות אחת' : `${n} פעילויות`;
    const body = approvals.map((approval) => {
      const upload = uploadMap.get(uploadKey(approval));
      const acts = approval.activities || [];
      const hasFile = !!(upload?.file_path || upload?.file_name);
      const fileName = upload?.file_name ? escapeHtml(String(upload.file_name).slice(-22)) : '';
      const fileState = hasFile
        ? `<span class="instr-file-state instr-file-state--has">📎 ${fileName}</span>`
        : '';
      const safeKey = escapeHtml(approvalStableKey(approval));
      const uploadBtn = `<label class="instr-upload-label" title="בחרו קובץ PDF / JPG / PNG להעלאה"><span class="ds-btn ds-btn--xs ds-btn--primary instr-btn-upload">${hasFile ? 'החלף' : 'העלה'}</span><input class="sr-only" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-upload-key="${safeKey}"></label>`;
      const reviewNote = upload?.review_note ? `<div class="instr-reject-note">${escapeHtml(upload.review_note)}</div>` : '';
      return `<tr>
        <td class="iac-date">${escapeHtml(formatDateHe(approval.date) || approval.date || '')}</td>
        <td class="iac-school">${escapeHtml(approval.school || '')}</td>
        <td class="iac-count">${escapeHtml(actCountLabel(acts.length))}</td>
        <td class="iac-upload">${fileState}${uploadBtn}${reviewNote}</td>
        <td class="iac-status">${statusChip(upload)}</td>
        <td class="iac-action"><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary" data-approval-key="${safeKey}">צפייה / הדפסה</button></td>
      </tr>`;
    }).join('');

    const table = approvals.length
      ? dsTableWrap(`<table class="ds-table ds-table--instr-approvals2"><colgroup><col class="iac-date"><col class="iac-school"><col class="iac-count"><col class="iac-upload"><col class="iac-status"><col class="iac-action"></colgroup><thead><tr><th>תאריך</th><th>בית ספר</th><th>כמות פעילויות</th><th>אישור ביצוע</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${body}</tbody></table>`)
      : dsEmptyState('לא נמצאו אישורי ביצוע אישיים להפקה');

    const summaryCards = `<div class="instr-summary-grid instr-summary-grid--4">
      <article class="instr-summary-card"><strong>${statusCounts.missing}</strong><small>ממתינים להעלאה</small></article>
      <article class="instr-summary-card instr-summary-card--uploaded"><strong>${statusCounts.uploaded}</strong><small>הועלו לבדיקה</small></article>
      <article class="instr-summary-card instr-summary-card--approved"><strong>${statusCounts.approved}</strong><small>אושרו</small></article>
      <article class="instr-summary-card instr-summary-card--rejected"><strong>${statusCounts.rejected}</strong><small>נדחו</small></article>
    </div>`;

    return dsScreenStack(`<section class="instructor-area instructor-area--approvals">
      ${dsPageHeader('אישורי ביצוע', 'העלאת אישורי ביצוע אישיים לפי הפעילויות שלך')}
      ${summaryCards}
      ${dsCard({ title: 'האישורים שלי', badge: String(approvals.length), body: table, padded: false })}
    </section>`);
  },
  bind({ root, api, state, rerender, clearScreenDataCache }) {
    root.querySelectorAll('[data-approval-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        try {
          const key = btn.getAttribute('data-approval-key');
          const approval = approvalsByKey.get(key);
          if (!approval) {
            alert('לא ניתן לפתוח את אישור הביצוע. חסרים נתונים לפעילות זו.');
            return;
          }
          openApprovalPrintWindow([approval], approvalFileTitle(approval));
        } catch (err) {
          alert(`שגיאה בפתיחת אישור הביצוע: ${err?.message || 'שגיאה לא ידועה'}`);
        }
      });
    });

    root.querySelectorAll('[data-upload-key]').forEach((input) => {
      input.addEventListener('change', async () => {
        try {
          const key = input.getAttribute('data-upload-key');
          const approval = approvalsByKey.get(key);
          const file = input.files?.[0];
          if (!approval || !file) return;
          await api.uploadCompletionApproval({
            approval,
            file,
            instructorEmpId: currentEmpId(state),
            instructorName: approval.instructorName || currentInstructorName(state)
          });
          clearScreenDataCache?.('instructor-completion-approvals');
          rerender?.();
        } catch (error) {
          alert(`העלאת הקובץ נכשלה: ${error?.message || error}`);
        } finally {
          input.value = '';
        }
      });
    });
  }
};
