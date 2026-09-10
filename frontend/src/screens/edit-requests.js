import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsStatusChip,
  dsEmptyState
} from './shared/layout.js';
import { showToast } from './shared/toast.js';
import {
  COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE,
  loadCourseAssignmentManagerApprovalGroups,
  reviewCourseAssignmentManagerApproval
} from './shared/course-scheduling-manager-approval.js';

/** Fields that are system/debug identifiers — hide from manager-facing cards only. */
const TECHNICAL_DISPLAY_FIELDS = new Set([
  'row_id',
  'RowID',
  'rowid',
  'id',
  'request_id',
  'source_row_id',
  'source_sheet',
  'emp_id',
  'emp_id_2',
  'authority_id',
  'school_id',
  'school_contact_id',
  'activity_name_override'
]);

const LOCAL_FIELD_LABELS = {
  start_time: 'שעת התחלה',
  end_time: 'שעת סיום',
  contact_phone: 'טלפון איש קשר',
  contact_email: 'דוא״ל איש קשר',
  district: 'מחוז',
  activity_season: 'עונה',
  activity_domain: 'תחום',
  item_type: 'סוג פריט',
  participants_count: 'מספר משתתפים',
  operations_private_notes: 'הערות תפעול',
  activity_family: 'משפחת פעילות',
  activity_no: 'מספר פעילות',
  gefen_number: 'מספר גפ״ן',
  exists_in_gefen: 'קיים בגפ״ן',
  funding: 'מימון'
};

function statusLabel(status) {
  if (status === 'pending') return 'ממתין';
  if (status === 'approved') return 'אושר';
  if (status === 'rejected') return 'נדחה';
  if (status === 'conflict') return 'קונפליקט';
  return status || '—';
}

function statusVariant(status) {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  if (status === 'conflict') return 'danger';
  if (status === 'pending') return 'warning';
  return 'neutral';
}

/** תאריך ISO YYYY-MM-DD → DD/MM/YYYY לתצוגה */
function formatDateDisplay(iso) {
  const s = String(iso || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const dt = new Date(t);
    const dd = String(dt.getDate()).padStart(2, '0');
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const yy = dt.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return s;
}

function formatTimeDisplay(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  const match = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!match) return s;
  return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
}

function isTechnicalDisplayField(field) {
  const f = String(field || '').trim();
  if (!f) return true;
  if (TECHNICAL_DISPLAY_FIELDS.has(f)) return true;
  // Foreign-key / system id columns (e.g. authority_id) — not business copy.
  if (/_id$/i.test(f)) return true;
  return false;
}

function hasDisplayValue(raw) {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === 'boolean') return true;
  if (typeof raw === 'number') return Number.isFinite(raw);
  return String(raw).trim() !== '';
}

function fieldLabelHe(field) {
  const f = String(field || '').trim();
  if (!f) return 'שדה';
  if (f === 'status') return 'סטטוס פעילות';
  if (f === 'scheduling_selected_instructor') return 'מדריך שנבחר';
  if (f === 'scheduling_exception_reason') return 'סיבת החריגה';
  const m = /^date_(\d+)$/.exec(f);
  if (m) return `מפגש ${Number(m[1])}`;
  if (LOCAL_FIELD_LABELS[f]) return LOCAL_FIELD_LABELS[f];
  return hebrewColumn(f);
}

function formatFieldValueForDisplay(fieldName, raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  const fn = String(fieldName || '');
  if (fn === 'start_date' || fn === 'end_date' || /^date_\d+$/.test(fn)) {
    return formatDateDisplay(s) || s;
  }
  if (fn === 'start_time' || fn === 'end_time') {
    return formatTimeDisplay(s) || s;
  }
  if (fn === 'activity_type' || fn === 'item_type') {
    const he = hebrewActivityType(s);
    return he && he !== 'לא מסווג' ? he : s;
  }
  if (fn === 'exists_in_gefen' || fn === 'activity_name_override') {
    if (s === 'true' || s === 'yes' || s === '1') return 'כן';
    if (s === 'false' || s === 'no' || s === '0') return 'לא';
  }
  return s;
}

function displayOldNew(fieldName, oldVal, newVal) {
  const o = String(oldVal ?? '').trim();
  const n = String(newVal ?? '').trim();
  const oldDisp = o ? formatFieldValueForDisplay(fieldName, o) : '';
  const newDisp = n ? formatFieldValueForDisplay(fieldName, n) : '';
  return {
    oldHtml: oldDisp ? escapeHtml(oldDisp) : '<span class="ds-muted">לא הוגדר</span>',
    newHtml: newDisp ? escapeHtml(newDisp) : '<span class="ds-muted">נמחק / ריק</span>'
  };
}

/** Scheduling cards may still show emp_id; edit/create cards pass includeEmpId=false. */
function instructorLine(activity, { includeEmpId = false } = {}) {
  if (!activity) return '';
  const n1 = String(activity.instructor_name || '').trim();
  const n2 = String(activity.instructor_name_2 || '').trim();
  const e1 = String(activity.emp_id || '').trim();
  const e2 = String(activity.emp_id_2 || '').trim();
  const parts = [];
  if (n1) parts.push(includeEmpId && e1 ? `${n1} (${e1})` : n1);
  else if (includeEmpId && e1) parts.push(e1);
  if (n2) parts.push(includeEmpId && e2 ? `${n2} (${e2})` : n2);
  else if (includeEmpId && e2) parts.push(e2);
  return parts.join(' · ');
}

function requestTypeLabel(type) {
  const requestType = String(type || '');
  if (requestType === 'create_activity') return 'בקשה להוספת פעילות';
  if (requestType === COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE) return 'אישור חריגה בשיבוץ';
  return 'בקשת עריכה';
}

function activityTypeDisplay(raw) {
  const activityTypeRaw = String(raw || '').trim();
  if (!activityTypeRaw) return '';
  const he = hebrewActivityType(activityTypeRaw);
  return he && he !== 'לא מסווג' ? he : activityTypeRaw;
}

function metaItem(label, value) {
  const v = String(value || '').trim();
  if (!v) return '';
  return `<p><span class="ds-muted">${escapeHtml(label)}:</span> ${escapeHtml(v)}</p>`;
}

function visibleChangeFields(fields, { isCreateRequest }) {
  const list = Array.isArray(fields) ? fields : [];
  return list.filter((f) => {
    const name = String(f?.field_name || '').trim();
    if (!name || isTechnicalDisplayField(name)) return false;
    if (isCreateRequest) return hasDisplayValue(f?.new_value);
    return true;
  });
}

function requesterFooterHtml(group) {
  const name = String(group.requested_by_name || '').trim();
  const when = formatDateDisplay(group.requested_at) || String(group.requested_at || '').trim();
  const who = name || 'לא צוין';
  return `
    <div class="ds-er-footer" dir="rtl">
      <p class="ds-er-requester-line">
        <span class="ds-muted">נשלח על ידי:</span>
        ${escapeHtml(who)}
      </p>
      ${when ? `<p class="ds-er-request-date"><span class="ds-muted">תאריך הבקשה:</span> ${escapeHtml(when)}</p>` : ''}
    </div>
  `;
}

export function renderGroup(group, canReview) {
  const activity = group.activity || null;
  const requestType = String(group.request_type || '');
  const isCreateRequest = requestType === 'create_activity';
  const isSchedulingApproval = requestType === COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE;
  const hasActivity = Boolean(activity);
  const titleName = String((isSchedulingApproval ? activity?.activity_name : group.activity_name) || activity?.activity_name || '').trim() || 'פעילות ללא שם';
  const activityType = activityTypeDisplay(
    isCreateRequest ? group?.requested_payload?.activity_type : activity?.activity_type
  );
  const authority = String((isSchedulingApproval ? activity?.authority : group.authority) || activity?.authority || '').trim();
  const school = String((isSchedulingApproval ? activity?.school : group.school) || activity?.school || '').trim();
  const manager = String((isCreateRequest ? group?.requested_payload?.activity_manager : activity?.activity_manager) || '').trim();
  const fallbackDate = isCreateRequest ? group?.requested_payload?.date_1 : activity?.date_1;
  const startD = formatDateDisplay(String((isCreateRequest ? group?.requested_payload?.start_date : activity?.start_date) || fallbackDate || '').trim());
  const endD = formatDateDisplay(String((isCreateRequest ? group?.requested_payload?.end_date : activity?.end_date) || '').trim());
  const startEnd = startD && endD && startD !== endD ? `${startD} — ${endD}` : (startD || endD || '');
  const startTime = formatTimeDisplay(isCreateRequest ? group?.requested_payload?.start_time : activity?.start_time);
  const endTime = formatTimeDisplay(isCreateRequest ? group?.requested_payload?.end_time : activity?.end_time);
  const activityTimes = [startTime, endTime].filter(Boolean).join('–');

  const canApprove = isSchedulingApproval
    ? group.status === 'pending' && group.can_approve === true
    : canReview && group.status === 'pending' && group.can_approve !== false;
  const actionsHtml = canApprove ? `
    <div class="ds-er-actions">
      <button type="button" class="ds-btn ds-btn--success ds-btn--sm" data-action="approve" data-request-id="${escapeHtml(group.request_id)}">אישור</button>
      <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-action="reject" data-request-id="${escapeHtml(group.request_id)}">דחייה</button>
    </div>
  ` : '';

  const reviewerNoteHtml = group.review_note ? `
    <p class="ds-er-reviewer-note"><span class="ds-muted">הערת סוקר:</span> ${escapeHtml(group.review_note)}</p>
  ` : '';

  if (isSchedulingApproval) {
    const requestedInstructor = instructorLine(activity, { includeEmpId: true }) || '—';
    const exceptionReason = String(
      (group.fields || []).find((field) => field?.field_name === 'scheduling_exception_reason')?.new_value
      || group?.requested_payload?.exception_reason
      || 'חריגה מכללי השיבוץ'
    ).trim();
    const schedulingSummary = [activityType, school, authority].filter(Boolean).join(' · ') || '—';
    const timeHtml = activityTimes
      ? ` · <span dir="ltr">${escapeHtml(activityTimes)}</span>`
      : '';

    return `
    <article class="ds-er-group" data-status="${escapeHtml(group.status || '')}" data-request-id="${escapeHtml(group.request_id)}" data-request-type="${escapeHtml(requestType)}">
      <header class="ds-er-card-head">
        <h3 class="ds-er-card-title">${escapeHtml(requestTypeLabel(requestType))}: ${escapeHtml(titleName)}</h3>
        <div>${dsStatusChip(statusLabel(group.status), statusVariant(group.status))}</div>
      </header>
      <div class="ds-er-meta-grid" dir="rtl">
        <p><span class="ds-muted">פעילות:</span> <strong>${escapeHtml(schedulingSummary)}</strong></p>
        <p><span class="ds-muted">מועד:</span> <strong>${escapeHtml(startEnd || '—')}</strong>${timeHtml}</p>
        <p><span class="ds-muted">מדריך מבוקש:</span> <strong>${escapeHtml(requestedInstructor)}</strong></p>
      </div>
      <div class="ds-er-warn ds-er-exception-warning" role="note">
        <strong>סיבת החריגה:</strong> ${escapeHtml(exceptionReason)}
      </div>
      <p class="ds-er-requester-line" dir="rtl">
        <span class="ds-muted">נשלח על ידי:</span>
        ${escapeHtml(group.requested_by_name || group.requested_by_user_id || '—')}
        <span class="ds-muted"> · </span>
        ${escapeHtml(formatDateDisplay(group.requested_at) || String(group.requested_at || '—'))}
      </p>
      ${reviewerNoteHtml}
      ${actionsHtml}
    </article>
  `;
  }

  const warnIncomplete = (!hasActivity && !isCreateRequest)
    ? `<div class="ds-er-warn" role="alert">לא נמצאו פרטי פעילות מלאים לבדיקה — לא ניתן לאשר עד שנטענת הפעילות מהמערכת.</div>`
    : '';

  const instructorNames = instructorLine(
    isCreateRequest ? (group.requested_payload || {}) : activity,
    { includeEmpId: false }
  );

  const metaHtml = [
    metaItem('רשות', authority),
    metaItem('בית ספר', school),
    metaItem('סוג פעילות', activityType),
    metaItem('מדריך', instructorNames),
    metaItem('מנהל פעילות', manager),
    metaItem('תאריך', startEnd),
    metaItem('שעות', activityTimes)
  ].filter(Boolean).join('');

  const changeFields = visibleChangeFields(group.fields, { isCreateRequest });
  const fieldsRows = changeFields.map((f) => {
    const { oldHtml, newHtml } = displayOldNew(f.field_name, f.old_value, f.new_value);
    if (isCreateRequest) {
      return `
    <tr>
      <td class="ds-er-field-name">${escapeHtml(fieldLabelHe(f.field_name))}</td>
      <td class="ds-er-new">${newHtml}</td>
    </tr>`;
    }
    return `
    <tr>
      <td class="ds-er-field-name">${escapeHtml(fieldLabelHe(f.field_name))}</td>
      <td class="ds-er-old">${oldHtml}</td>
      <td class="ds-er-arrow">→</td>
      <td class="ds-er-new">${newHtml}</td>
    </tr>`;
  }).join('');

  const sectionTitle = isCreateRequest ? 'פרטי הפעילות המבוקשת' : 'מה מבוקש לשנות?';
  const tableHead = isCreateRequest
    ? '<tr><th>שדה</th><th>ערך</th></tr>'
    : '<tr><th>שדה</th><th>ערך נוכחי</th><th></th><th>ערך מבוקש</th></tr>';
  const fieldsTableHtml = changeFields.length ? `
      <h4 class="ds-er-section-title">${sectionTitle}</h4>
      <div class="ds-table-wrap ds-er-fields-wrap">
        <table class="ds-table ds-er-fields-table${isCreateRequest ? ' ds-er-fields-table--create' : ''}">
          <thead>${tableHead}</thead>
          <tbody>${fieldsRows}</tbody>
        </table>
      </div>
  ` : `
      <h4 class="ds-er-section-title">${sectionTitle}</h4>
      <p class="ds-er-empty-changes ds-muted">אין פרטים להצגה</p>
  `;

  return `
    <article class="ds-er-group" data-status="${escapeHtml(group.status || '')}" data-request-id="${escapeHtml(group.request_id)}" data-request-type="${escapeHtml(requestType)}">
      <header class="ds-er-card-head">
        <div class="ds-er-card-heading">
          <p class="ds-er-card-kicker">${escapeHtml(requestTypeLabel(requestType))}</p>
          <h3 class="ds-er-card-title">${escapeHtml(titleName)}</h3>
        </div>
        <div>${dsStatusChip(statusLabel(group.status), statusVariant(group.status))}</div>
      </header>
      ${metaHtml ? `<div class="ds-er-meta-grid" dir="rtl">${metaHtml}</div>` : ''}
      ${warnIncomplete}
      ${fieldsTableHtml}
      ${reviewerNoteHtml}
      ${requesterFooterHtml(group)}
      ${actionsHtml}
    </article>
  `;
}

const CLOSED_STATUSES = new Set(['approved', 'rejected']);

function isOpen(group) {
  return !CLOSED_STATUSES.has(String(group?.status || '').trim());
}

export const editRequestsScreen = {
  async load({ api }) {
    const base = await api.editRequests();
    const baseGroups = (Array.isArray(base?.groups) ? base.groups : []).filter(
      (group) => String(group?.request_type || '') !== COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE
    );
    const schedulingGroups = await loadCourseAssignmentManagerApprovalGroups();
    return {
      ...base,
      groups: [...baseGroups, ...schedulingGroups]
    };
  },
  render(data) {
    const groups = Array.isArray(data?.groups) ? data.groups : [];
    const validGroups = groups.filter((group) => (
      String(group?.request_type || '') === 'create_activity'
      || String(group?.request_type || '') === COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE
      || (Array.isArray(group?.fields) && group.fields.length > 0)
    ));
    const canReview = !!data?.canReview;

    const openGroups = validGroups.filter(isOpen);

    const groupsHtml = openGroups.length === 0
      ? dsEmptyState('אין בקשות פתוחות כרגע')
      : openGroups.map((g) => renderGroup(g, canReview)).join('');

    const subtitle = canReview ? 'בקשות פעילות הממתינות לאישורך' : 'בקשות פעילות שהגשת';

    return dsScreenStack(`
      ${dsPageHeader('בקשות פעילות', subtitle)}
      ${dsCard({
        title: `בקשות פתוחות (${openGroups.length})`,
        padded: false,
        body: `<div class="ds-er-list" data-er-list>${groupsHtml}</div>`
      })}
    `);
  },
  bind({ root, api, rerender, clearScreenDataCache }) {
    if (!root) return;

    root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const action = btn.dataset.action;
        const requestId = btn.dataset.requestId;
        if (!requestId || !action) return;

        const status = action === 'approve' ? 'approved' : 'rejected';
        const groupEl = btn.closest('.ds-er-group');
        const requestType = groupEl?.dataset.requestType || '';
        const isSchedulingApproval = requestType === COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE;
        btn.disabled = true;

        try {
          const reviewed = isSchedulingApproval
            ? await reviewCourseAssignmentManagerApproval(requestId, status)
            : await api.reviewEditRequest(requestId, status);

          if (reviewed?.status === 'conflict') {
            groupEl?.remove();
            clearScreenDataCache?.();
            showToast('הטיוטה השתנתה או בוטלה ולכן הבקשה אינה תקפה עוד', 'error');
            rerender?.();
            return;
          }

          groupEl?.remove();
          clearScreenDataCache?.();
          try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch (_) { /* ignore */ }
          if (isSchedulingApproval) {
            showToast(status === 'approved' ? 'הבקשה אושרה. ניתן להשלים את השיבוץ.' : 'הבקשה נדחתה', 'success');
          } else {
            showToast(status === 'approved' ? 'הבקשה אושרה והשינוי נשמר בפעילויות' : 'הבקשה נדחתה', 'success');
          }
          rerender?.();
        } catch (err) {
          btn.disabled = false;
          showToast(err.message || 'שגיאה בעיבוד הבקשה', 'error');
        }
      });
    });
  }
};
