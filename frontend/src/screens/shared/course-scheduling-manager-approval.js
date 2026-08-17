import { supabase } from '../../supabase-client.js';
import { escapeHtml } from './html.js';
import { showToast } from './toast.js';

export const COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE = 'course_assignment_exception';

const text = (value) => String(value ?? '').trim();
const idOf = (row = {}) => text(row.row_id || row.RowID || row.id);

function firstRpcRow(data) {
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

function schedulingApprovalErrorMessage(error) {
  const raw = text(error?.message || error);
  const messages = {
    scheduling_transition_distance_exceeded: 'המרחק בין הפעילויות גדול מ־20 ק״מ',
    scheduling_transition_insufficient: 'אין מספיק זמן מעבר בין הפעילויות',
    scheduling_conflict_detected: 'קיימת חפיפה עם שיבוץ אחר של המדריך',
    scheduling_instructor_unavailable: 'המדריך אינו זמין באחד ממפגשי הקורס',
    instructor_inactive: 'המדריך אינו פעיל',
    scheduling_manager_approval_not_required: 'הטיוטה אינה דורשת אישור מנהל',
    scheduling_draft_missing: 'הטיוטה כבר אינה קיימת',
    scheduling_manual_draft_missing: 'לא נמצאה בחירה ידנית תואמת לטיוטה',
    edit_request_already_reviewed: 'הבקשה כבר טופלה'
  };
  for (const [code, message] of Object.entries(messages)) {
    if (raw.includes(code)) return message;
  }
  return raw || 'הפעולה נכשלה';
}

export async function loadCourseAssignmentManagerApprovalGroups() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('course_assignment_manager_approval_requests');
  if (error) throw new Error(schedulingApprovalErrorMessage(error));
  return (Array.isArray(data) ? data : []).map((row) => ({
    ...row,
    request_type: COURSE_ASSIGNMENT_MANAGER_APPROVAL_REQUEST_TYPE,
    requested_payload: row?.requested_payload && typeof row.requested_payload === 'object'
      ? row.requested_payload
      : {},
    can_approve: true,
    fields: []
  }));
}

export async function reviewCourseAssignmentManagerApproval(requestId, status) {
  if (!supabase) throw new Error('Supabase אינו זמין');
  const { data, error } = await supabase.rpc('review_course_assignment_manager_approval', {
    p_request_id: text(requestId),
    p_status: text(status)
  });
  if (error) throw new Error(schedulingApprovalErrorMessage(error));
  return firstRpcRow(data);
}

function approvalPanelHtml(state = {}) {
  const reason = text(state.reason) || 'חריגה מכללי השיבוץ';
  const status = text(state.request_status);

  if (status === 'approved') {
    return `<div class="course-scheduling-manager-approval is-approved" data-manager-approval-panel>
      <strong>אושר על ידי מנהל</strong>
      <span>ניתן להשלים את השיבוץ.</span>
    </div>`;
  }
  if (status === 'pending') {
    return `<div class="course-scheduling-manager-approval is-pending" data-manager-approval-panel>
      <strong>נשלח למנהל לאישור</strong>
      <span>${escapeHtml(reason)}</span>
    </div>`;
  }
  if (status === 'rejected') {
    return `<div class="course-scheduling-manager-approval is-rejected" data-manager-approval-panel>
      <strong>הבקשה נדחתה על ידי המנהל</strong>
      <span>${escapeHtml(reason)}. ניתן לבטל את הטיוטה ולבחור שיבוץ אחר.</span>
    </div>`;
  }
  if (status === 'conflict') {
    return `<div class="course-scheduling-manager-approval is-rejected" data-manager-approval-panel>
      <strong>בקשת האישור אינה תקפה עוד</strong>
      <span>הטיוטה השתנתה או בוטלה. יש לבדוק את השיבוץ מחדש.</span>
    </div>`;
  }

  return `<div class="course-scheduling-manager-approval is-warning" data-manager-approval-panel>
    <strong>נדרש אישור מנהל</strong>
    <span>${escapeHtml(reason)}</span>
    <button type="button" class="course-scheduling-btn course-scheduling-btn--secondary" data-send-manager-approval>שלח למנהל לאישור</button>
  </div>`;
}

function ensureApprovalPanelHost(detailRoot, confirmButton) {
  let host = detailRoot.querySelector('[data-manager-approval-host]');
  if (host) return host;
  host = document.createElement('div');
  host.setAttribute('data-manager-approval-host', '');
  const actions = confirmButton.closest('.course-scheduling-detail-actions');
  if (actions?.parentNode) actions.parentNode.insertBefore(host, actions);
  else confirmButton.parentNode?.insertBefore(host, confirmButton);
  return host;
}

function applyApprovalUi({ host, confirmButton, approvalState, courseId }) {
  if (!approvalState?.approval_required) {
    host?.remove();
    confirmButton.disabled = false;
    confirmButton.removeAttribute('aria-disabled');
    return;
  }

  const status = text(approvalState.request_status);
  const approved = status === 'approved';
  confirmButton.disabled = !approved;
  confirmButton.setAttribute('aria-disabled', approved ? 'false' : 'true');
  host.innerHTML = approvalPanelHtml(approvalState);

  const sendButton = host.querySelector('[data-send-manager-approval]');
  if (!sendButton) return;
  sendButton.addEventListener('click', async () => {
    sendButton.disabled = true;
    try {
      const { data, error } = await supabase.rpc('submit_course_assignment_manager_approval', {
        p_activity_id: courseId
      });
      if (error) throw error;
      const request = firstRpcRow(data);
      applyApprovalUi({
        host,
        confirmButton,
        courseId,
        approvalState: { ...approvalState, request_id: request?.request_id, request_status: request?.status || 'pending' }
      });
      try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch { /* ignore */ }
      showToast('נשלח למנהל לאישור', 'success');
    } catch (error) {
      sendButton.disabled = false;
      showToast(schedulingApprovalErrorMessage(error), 'error');
    }
  });
}

/**
 * Adds the explicit manager-approval step to an existing manual scheduling draft.
 * This function only reads approval state on render. A request is created only after
 * the user explicitly presses "שלח למנהל לאישור".
 */
export async function ensureCourseSchedulingManagerApproval(root, { state } = {}) {
  if (!root?.querySelector || !supabase) return;
  const detailRoot = root.querySelector('[data-course-detail]') || root;
  const confirmButton = detailRoot.querySelector('[data-confirm-draft]');
  const courseId = text(state?.courseSchedulingSelectedId);
  if (!confirmButton || !courseId) return;

  confirmButton.disabled = true;
  confirmButton.setAttribute('aria-disabled', 'true');
  const host = ensureApprovalPanelHost(detailRoot, confirmButton);
  host.innerHTML = '<p class="course-scheduling-muted">בודק אם נדרש אישור מנהל…</p>';

  try {
    const { data, error } = await supabase.rpc('course_assignment_manager_approval_state', {
      p_activity_id: courseId
    });
    if (error) throw error;
    const approvalState = firstRpcRow(data) || {};

    // Ignore a late response after the operator navigated to another course.
    if (text(state?.courseSchedulingSelectedId) !== courseId) return;
    const selectedResultCourse = (state?.courseSchedulingResults || [])
      .map((result) => result?.course)
      .find((course) => idOf(course) === courseId);
    void selectedResultCourse;

    applyApprovalUi({ host, confirmButton, approvalState, courseId });
  } catch (error) {
    confirmButton.disabled = true;
    host.innerHTML = `<div class="course-scheduling-manager-approval is-rejected" data-manager-approval-panel>
      <strong>לא ניתן לבדוק את מצב האישור</strong>
      <span>${escapeHtml(schedulingApprovalErrorMessage(error))}</span>
    </div>`;
  }
}
