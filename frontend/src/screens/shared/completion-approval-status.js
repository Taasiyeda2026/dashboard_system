function text(value) { return String(value ?? '').trim(); }
function norm(value) { return text(value).replace(/[״"]/g, '').replace(/[׳']/g, '').replace(/\s+/g, ' ').toLowerCase(); }

// "Storage exists" is only meaningful relative to file_path, since that's the
// path completionApprovalUploads() actually resolves against Supabase Storage.
export function completionApprovalUploadStorageExists(upload) {
  if (!upload?.file_path) return false;
  if (upload.storage_exists === false) return false;
  if (norm(upload?.storage_status) === 'missing') return false;
  return true;
}

// Single source of truth for the status shown across instructor-calendar,
// my-data, instructor-completion-approvals and operations-management: a
// storage-missing file must never read as "approved" just because the DB
// row's status column still says so.
export function completionApprovalStatusInfo(upload) {
  if (!upload) return { key: 'missing', label: 'טרם הועלה' };
  const hasFileRef = !!(upload?.file_path || upload?.file_name);
  const storageOk = completionApprovalUploadStorageExists(upload);
  if (hasFileRef && !storageOk) return { key: 'missing', label: 'הקובץ חסר באחסון' };
  const status = norm(upload?.status);
  if (status === 'rejected' || status === norm('נדחה')) return { key: 'rejected', label: 'נדחה — נדרש תיקון' };
  if ((status === 'approved' || status === norm('אושר')) && storageOk) return { key: 'approved', label: 'אושר' };
  if (status === 'uploaded' || status === norm('הועלה') || storageOk) return { key: 'uploaded', label: 'הועלה לבדיקה' };
  return { key: 'missing', label: 'טרם הועלה' };
}

// Prefers activity_row_id (supports comma-separated ids) plus instructor_emp_id
// when available, and only falls back to date+authority+school matching for
// legacy uploads that never recorded an activity_row_id at all — matching an
// upload that DOES carry row ids but none of them match must never fall
// through, or two activities on the same day/school get mixed up.
export function findMatchingCompletionApprovalUpload(uploads, { rowIds = [], instructorEmpId = '', instructorName = '', date = '', authority = '', school = '' } = {}) {
  const list = Array.isArray(uploads) ? uploads : [];
  const idSet = new Set((Array.isArray(rowIds) ? rowIds : [rowIds]).map(text).filter(Boolean));
  // instructorEmpId may be a single id or a list of candidate identity values for the
  // current instructor (emp_id/employee_id/user_id) — a match against any of them counts.
  const empIdSet = new Set((Array.isArray(instructorEmpId) ? instructorEmpId : [instructorEmpId]).map(text).filter(Boolean));
  const normInstructorName = norm(instructorName);
  const uploadRowIdList = (upload) => text(upload?.activity_row_id).split(',').map((value) => value.trim()).filter(Boolean);
  const empIdMatches = (upload) => {
    const uploadEmpId = text(upload?.instructor_emp_id);
    return !empIdSet.size || (!!uploadEmpId && empIdSet.has(uploadEmpId));
  };

  if (idSet.size) {
    const byId = list.find((upload) => {
      const ids = uploadRowIdList(upload);
      if (!ids.length || !ids.some((id) => idSet.has(id))) return false;
      return empIdMatches(upload);
    });
    if (byId) return byId;
  }

  const isoDateVal = text(date).slice(0, 10);
  if (!isoDateVal) return null;
  const normAuthority = norm(authority);
  const normSchool = norm(school);
  return list.find((upload) => {
    if (uploadRowIdList(upload).length) return false;
    if (text(upload?.activity_date).slice(0, 10) !== isoDateVal) return false;
    const uSchool = norm(upload?.school);
    if (normSchool && uSchool && uSchool !== normSchool) return false;
    const uAuthority = norm(upload?.authority);
    if (normAuthority && uAuthority && uAuthority !== normAuthority) return false;
    if (!empIdMatches(upload)) return false;
    const uploadInstructorName = norm(upload?.instructor_name);
    if (normInstructorName && uploadInstructorName && uploadInstructorName !== normInstructorName) return false;
    return true;
  }) || null;
}
