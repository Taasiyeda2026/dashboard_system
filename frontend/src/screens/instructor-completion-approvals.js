import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { dsPageHeader, dsCard, dsScreenStack, dsTableWrap, dsEmptyState } from './shared/layout.js';
import {
  approvalFileTitle,
  buildCompletionApprovals,
  openApprovalPrintWindow
} from './shared/activity-completion-approval-print.js';

let approvalsByKey = new Map();
let pendingUploadTargetKey = '';

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
function readPendingUploadTargetKey() {
  try {
    const raw = sessionStorage.getItem('instructor_completion_approval_target');
    const target = raw ? JSON.parse(raw) : null;
    return target ? `${text(target.date)}|${norm(target.authority)}|${norm(target.school)}` : '';
  } catch {
    return '';
  }
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
function truncateFileName(name, max = 20) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  if (raw.length <= max) return raw;
  return `…${raw.slice(-(max - 1))}`;
}
function uploadControlsHtml(approval, upload, safeKey) {
  const st = statusInfo(upload).key;
  const hasFile = !!(upload?.file_path || upload?.file_name);
  if (hasFile && st !== 'rejected') {
    const fileName = truncateFileName(upload?.file_name || 'קובץ מועלה');
    const viewButton = upload?.file_path
      ? `<button type="button" class="ds-btn ds-btn--xs ds-btn--secondary instr-btn-view" data-view-file-path="${escapeHtml(upload.file_path)}" title="צפייה בקובץ" aria-label="צפייה בקובץ">👁 צפייה</button>`
      : '';
    return `<span class="instr-file-row"><span class="instr-file-state instr-file-state--has" title="${escapeHtml(upload?.file_name || '')}">📎 ${escapeHtml(fileName)}</span>${viewButton}</span>`;
  }
  return `<div class="instr-upload-controls" data-upload-controls="${safeKey}">
    <span class="instr-pending-file" data-pending-name="${safeKey}" hidden></span>
    <button type="button" class="ds-btn ds-btn--xs ds-btn--secondary instr-btn-pick" data-pick-key="${safeKey}">בחר</button>
    <input class="instr-file-input-hidden" type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" data-pick-input="${safeKey}">
    <button type="button" class="ds-btn ds-btn--xs ds-btn--primary instr-btn-plus" data-upload-submit="${safeKey}" title="העלאת אישור ביצוע" aria-label="העלאת אישור ביצוע">+</button>
  </div>`;
}
function statusChip(upload) {
  const st = statusInfo(upload);
  return `<span class="instr-status instr-status--${st.key}">${escapeHtml(st.label)}</span>`;
}

function approvalCardHtml(approval, upload, safeKey, acts, reviewNote, targetClass) {
  const actCountLabel = acts.length === 1 ? 'פעילות אחת' : `${acts.length} פעילויות`;
  const uploadCell = uploadControlsHtml(approval, upload, safeKey);
  return `<article class="instr-approval-card${targetClass ? ' instr-approval-target' : ''}"${targetClass ? ' data-approval-target="true"' : ''}>
    <div class="instr-approval-card__status">${statusChip(upload)}</div>
    <dl class="instr-approval-card__fields">
      <div class="instr-approval-card__field"><dt>תאריך</dt><dd>${escapeHtml(formatDateHe(approval.date) || approval.date || '')}</dd></div>
      <div class="instr-approval-card__field"><dt>בית ספר</dt><dd>${escapeHtml(approval.school || '')}</dd></div>
      <div class="instr-approval-card__field"><dt>פעילויות</dt><dd>${escapeHtml(actCountLabel)}</dd></div>
    </dl>
    <div class="instr-approval-card__file"><span class="instr-approval-card__file-label">קובץ:</span>${uploadCell}${reviewNote}</div>
    <div class="instr-approval-card__action"><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary instr-btn-print" data-approval-key="${safeKey}" title="הדפסה">הדפסה</button></div>
  </article>`;
}

export const instructorCompletionApprovalsScreen = {
  load: async ({ api }) => {
    const [myData, uploads] = await Promise.all([
      api.myData({ includeClosedForApprovals: true }),
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
    pendingUploadTargetKey = readPendingUploadTargetKey();

    approvalsByKey = new Map(approvals.map((approval) => [approvalStableKey(approval), approval]));

    const statusCounts = { missing: 0, uploaded: 0, approved: 0, rejected: 0 };
    approvals.forEach((approval) => {
      const st = statusInfo(uploadMap.get(uploadKey(approval))).key;
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    });

    const actCountLabel = (n) => n === 1 ? 'פעילות אחת' : `${n} פעילויות`;
    const mappedApprovals = approvals.map((approval) => {
      const upload = uploadMap.get(uploadKey(approval));
      const acts = approval.activities || [];
      const safeKey = escapeHtml(approvalStableKey(approval));
      const uploadCell = uploadControlsHtml(approval, upload, safeKey);
      const reviewNote = upload?.review_note ? `<div class="instr-reject-note">${escapeHtml(upload.review_note)}</div>` : '';
      const isTarget = pendingUploadTargetKey && uploadKey(approval) === pendingUploadTargetKey;
      const targetClass = isTarget ? ' instr-approval-target' : '';
      const targetAttr = isTarget ? ' class="instr-approval-target" data-approval-target="true"' : '';
      return {
        table: `<tr${targetAttr}>
        <td class="iac-date">${escapeHtml(formatDateHe(approval.date) || approval.date || '')}</td>
        <td class="iac-school">${escapeHtml(approval.school || '')}</td>
        <td class="iac-count">${escapeHtml(actCountLabel(acts.length))}</td>
        <td class="iac-upload">${uploadCell}${reviewNote}</td>
        <td class="iac-status">${statusChip(upload)}</td>
        <td class="iac-action"><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary instr-btn-print" data-approval-key="${safeKey}" title="הדפסה">הדפסה</button></td>
      </tr>`,
        card: approvalCardHtml(approval, upload, safeKey, acts, reviewNote, isTarget)
      };
    });

    const tableBody = mappedApprovals.map((row) => row.table).join('');
    const cardBody = mappedApprovals.map((row) => row.card).join('');

    const listBlock = approvals.length
      ? `<div class="instr-approvals-dual"><div class="instr-approvals-desktop execution-approvals-table-wrapper approvals-table-wrapper">${dsTableWrap(`<table class="ds-table ds-table--instr-approvals2"><colgroup><col class="iac-date"><col class="iac-school"><col class="iac-count"><col class="iac-upload"><col class="iac-status"><col class="iac-action"></colgroup><thead><tr><th>תאריך</th><th>בית ספר</th><th>כמות פעילויות</th><th>אישור ביצוע</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${tableBody}</tbody></table>`)}</div><div class="instr-approvals-mobile instr-approval-cards execution-approvals-mobile-cards approvals-mobile-cards">${cardBody}</div></div>`
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
      ${dsCard({ title: 'האישורים שלי', badge: String(approvals.length), body: listBlock, padded: false })}
    </section>`);
  },
  bind({ root, api, state, rerender, clearScreenDataCache }) {
    const pendingFiles = new Map();
    const targetRow = root.querySelector('[data-approval-target="true"]');
    if (targetRow) {
      targetRow.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      targetRow.querySelector('[data-pick-key]')?.focus?.();
      try { sessionStorage.removeItem('instructor_completion_approval_target'); } catch { /* ignore */ }
    }
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

    root.querySelectorAll('[data-view-file-path]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filePath = btn.getAttribute('data-view-file-path');
        if (!filePath) return;
        try {
          const result = await api.completionApprovalSignedUrl({ filePath });
          const signedUrl = result?.signedUrl || '';
          if (!signedUrl) throw new Error('missing_signed_url');
          window.open(signedUrl, '_blank', 'noopener');
        } catch (error) {
          const message = String(error?.message || error || '').trim();
          const displayMessage = /object not found/i.test(message)
            ? 'הקובץ לא נמצא באחסון. יש לבדוק את נתיב הקובץ מול הרשומה.'
            : (message || 'שגיאה לא ידועה');
          alert(`פתיחת הקובץ נכשלה: ${displayMessage}`);
        }
      });
    });

    root.querySelectorAll('[data-pick-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-pick-key');
        root.querySelector(`[data-pick-input="${key}"]`)?.click();
      });
    });

    root.querySelectorAll('[data-pick-input]').forEach((input) => {
      input.addEventListener('change', () => {
        const key = input.getAttribute('data-pick-input');
        const file = input.files?.[0];
        if (!key || !file) return;
        pendingFiles.set(key, file);
        const nameEl = root.querySelector(`[data-pending-name="${key}"]`);
        if (nameEl) {
          const short = truncateFileName(file.name);
          nameEl.textContent = short;
          nameEl.title = file.name;
          nameEl.hidden = false;
        }
      });
    });

    root.querySelectorAll('[data-upload-submit]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const key = btn.getAttribute('data-upload-submit');
        const approval = approvalsByKey.get(key);
        const file = pendingFiles.get(key);
        if (!file) {
          alert('יש לבחור קובץ לפני העלאה');
          return;
        }
        if (!approval) return;
        try {
          await api.uploadCompletionApproval({
            approval,
            file,
            instructorEmpId: currentEmpId(state),
            instructorName: approval.instructorName || currentInstructorName(state)
          });
          pendingFiles.delete(key);
          clearScreenDataCache?.('instructor-completion-approvals');
          rerender?.();
        } catch (error) {
          alert(`העלאת הקובץ נכשלה: ${error?.message || error}`);
        }
      });
    });
  }
};
