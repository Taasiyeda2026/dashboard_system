import { api } from './api.js';
import { state } from './state.js';
import { supabase } from './supabase-client.js';

/*
 * Completion-approval list performance guard.
 *
 * The list only needs upload metadata. A signed Storage URL is created later,
 * when the user explicitly opens a file. Avoiding one signing request per row
 * removes a large burst of parallel Storage calls on every screen load.
 *
 * Honors optional limit/offset/fromDate/toDate from the API call site so ops
 * can scope summer windows without truncating unexpectedly.
 */
(function installCompletionApprovalPerformanceRuntime() {
  'use strict';

  if (globalThis.__dsCompletionApprovalPerformanceRuntimeInstalled) return;
  globalThis.__dsCompletionApprovalPerformanceRuntimeInstalled = true;
  if (!supabase || typeof api.completionApprovalUploads !== 'function') return;

  const ACTIVE_INSTRUCTOR_EMP_IDS = new Set([
    '1525', '1506', '1527', '1502', '1507',
    '1509', '1515', '1500', '1503', '1511'
  ]);
  const UPLOAD_METADATA_COLUMNS = 'id,activity_row_id,activity_date,instructor_emp_id,instructor_name,authority,school,file_path,file_name,mime_type,file_size,uploaded_by_user_id,uploaded_at,status,reviewed_by,reviewed_at,review_note';

  function currentUserIdentityValues() {
    const user = state?.user || {};
    return [user.emp_id, user.employee_id, user.user_id]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  function isActiveInstructorPilotUser() {
    return currentUserIdentityValues().some((id) => ACTIVE_INSTRUCTOR_EMP_IDS.has(id));
  }

  api.completionApprovalUploads = async function optimizedCompletionApprovalUploads({
    limit = null,
    offset = 0,
    fromDate = '',
    toDate = ''
  } = {}) {
    const role = String(state?.user?.role || '').trim();
    let query = supabase
      .from('activity_completion_approval_uploads')
      .select(UPLOAD_METADATA_COLUMNS)
      .order('activity_date', { ascending: false, nullsFirst: false })
      .order('uploaded_at', { ascending: false });

    if (fromDate) query = query.gte('activity_date', fromDate);
    if (toDate) query = query.lte('activity_date', toDate);
    if (limit != null) {
      const pageSize = Math.max(1, Number(limit) || 50);
      const pageOffset = Math.max(0, Number(offset) || 0);
      query = query.range(pageOffset, pageOffset + pageSize - 1);
    }

    if (role === 'instructor') {
      if (!isActiveInstructorPilotUser()) return { rows: [], _source: 'supabase' };
      const identityValues = currentUserIdentityValues();
      if (!identityValues.length) return { rows: [], _source: 'supabase' };
      query = query.in('instructor_emp_id', identityValues);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message || 'completion_approval_uploads_read_failed');

    return {
      rows: Array.isArray(data) ? data : [],
      _source: 'supabase'
    };
  };
})();
