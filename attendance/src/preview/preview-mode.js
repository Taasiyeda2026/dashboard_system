const PREVIEW_PARAM = 'adminPreview';
export const PREVIEW_EMP_ID = 9900001;

export const PREVIEW_APPROVAL_STATUSES = [
  'open',
  'submitted',
  'locked',
  'reopened',
  'approved_for_payroll',
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function currentMonthDate(dayOffset) {
  const now = new Date();
  const day = Math.max(1, now.getDate() - dayOffset);
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), day, 12, 0, 0));
}

function monthKeyFromDate(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

export function isAdminPreviewRequested() {
  try {
    return new URLSearchParams(window.location.search).get(PREVIEW_PARAM) === '1';
  } catch {
    return false;
  }
}

export function getAdminPreviewIdentity(userRow = {}) {
  return {
    userId: userRow.user_id || null,
    name: 'עובד/ת לדוגמה',
    empId: PREVIEW_EMP_ID,
    preview: true,
    adminName: String(userRow.full_name || userRow.name || userRow.username || '').trim(),
  };
}

const PREVIEW_AUTHORITIES = [
  {
    authority_id: 501,
    authority_name: 'תל אביב-יפו',
    schools: [
      { id: 1001, name: 'בית ספר לדוגמה א׳', semel_mosad: '900001' },
      { id: 1002, name: 'בית ספר לדוגמה ב׳', semel_mosad: '900002' },
    ],
  },
  {
    authority_id: 502,
    authority_name: 'רמת גן',
    schools: [
      { id: 1003, name: 'בית ספר לדוגמה ג׳', semel_mosad: '900003' },
    ],
  },
];

const PREVIEW_ACTIVITIES = [
  {
    id: 7001,
    row_id: 'preview-course-1',
    activity_type: 'course',
    activity_name: 'טכנולוגיות החלל — פעילות לדוגמה',
    activity_no: 'PREVIEW-COURSE',
    activity_season: 'school_2027',
    program_name: 'טכנולוגיות החלל',
    authority_id: 501,
    authority_name: 'תל אביב-יפו',
    school_link_status: 'single_school',
    single_school_id: 1001,
    single_school_name: 'בית ספר לדוגמה א׳',
    single_semel_mosad: '900001',
    meeting_no: 3,
  },
  {
    id: 7002,
    row_id: 'preview-workshop-1',
    activity_type: 'workshop',
    activity_name: 'סדנת חדשנות — פעילות לדוגמה',
    activity_no: 'PREVIEW-WORKSHOP',
    activity_season: 'school_2027',
    program_name: 'סדנת חדשנות',
    authority_id: 501,
    authority_name: 'תל אביב-יפו',
    school_link_status: 'multiple_schools',
    linked_schools_json: [
      { id: 1001, name: 'בית ספר לדוגמה א׳', semel_mosad: '900001' },
      { id: 1002, name: 'בית ספר לדוגמה ב׳', semel_mosad: '900002' },
    ],
    meeting_no: 1,
  },
  {
    id: 7003,
    row_id: 'preview-tour-1',
    activity_type: 'tour',
    activity_name: 'סיור בתעשייה — פעילות לדוגמה',
    activity_no: 'PREVIEW-TOUR',
    activity_season: 'school_2027',
    program_name: 'התנסות בתעשייה',
    authority_id: 502,
    authority_name: 'רמת גן',
    school_link_status: 'single_school',
    single_school_id: 1003,
    single_school_name: 'בית ספר לדוגמה ג׳',
    single_semel_mosad: '900003',
    meeting_no: 2,
  },
];

const initialRecords = [
  {
    id: 'preview-record-1',
    emp_id: PREVIEW_EMP_ID,
    report_date: currentMonthDate(3),
    start_time: '09:00:00',
    end_time: '10:30:00',
    total_hours: 1.5,
    activity_type: 'קורס',
    activity_id: 7001,
    activity_row_id: 'preview-course-1',
    activity_no: 'PREVIEW-COURSE',
    activity_season: 'school_2027',
    activity_name_snapshot: 'טכנולוגיות החלל — פעילות לדוגמה',
    meeting_no: 3,
    authority_id: 501,
    authority_name_snapshot: 'תל אביב-יפו',
    school_id: 1001,
    school_name_snapshot: 'בית ספר לדוגמה א׳',
    semel_mosad: '900001',
    program_name: 'טכנולוגיות החלל',
    program_name_snapshot: 'טכנולוגיות החלל',
    roundtrip_km: 18,
    expenses: 0,
    expense_details: null,
    notes: 'רשומת הדגמה בלבד',
    attendance_record_attachments: [],
  },
  {
    id: 'preview-record-2',
    emp_id: PREVIEW_EMP_ID,
    report_date: currentMonthDate(7),
    start_time: '11:00:00',
    end_time: '12:30:00',
    total_hours: 1.5,
    activity_type: 'סדנה',
    activity_id: 7002,
    activity_row_id: 'preview-workshop-1',
    activity_no: 'PREVIEW-WORKSHOP',
    activity_season: 'school_2027',
    activity_name_snapshot: 'סדנת חדשנות — פעילות לדוגמה',
    meeting_no: 1,
    authority_id: 501,
    authority_name_snapshot: 'תל אביב-יפו',
    school_id: 1002,
    school_name_snapshot: 'בית ספר לדוגמה ב׳',
    semel_mosad: '900002',
    program_name: 'סדנת חדשנות',
    program_name_snapshot: 'סדנת חדשנות',
    roundtrip_km: 24,
    expenses: 35,
    expense_details: 'חניה — נתוני הדגמה',
    notes: null,
    attendance_record_attachments: [],
  },
];

const state = {
  records: clone(initialRecords),
  approvals: new Map(),
  attachmentSeq: 1,
  recordSeq: 3,
};

export function getPreviewActivities() {
  return clone(PREVIEW_ACTIVITIES);
}

export function getPreviewAuthorities() {
  return clone(PREVIEW_AUTHORITIES);
}

export function getPreviewRecords(year, month) {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  return clone(state.records.filter((row) => monthKeyFromDate(row.report_date) === key));
}

export function createPreviewRecord(payload = {}) {
  const record = {
    ...clone(payload),
    id: `preview-record-${state.recordSeq++}`,
    emp_id: PREVIEW_EMP_ID,
    updated_at: new Date().toISOString(),
    attendance_record_attachments: [],
  };
  state.records.push(record);
  return clone(record);
}

export function updatePreviewRecord(recordId, payload = {}) {
  const index = state.records.findIndex((row) => String(row.id) === String(recordId));
  if (index < 0) throw new Error('רשומת ההדגמה לא נמצאה');
  state.records[index] = {
    ...state.records[index],
    ...clone(payload),
    updated_at: new Date().toISOString(),
  };
  return clone(state.records[index]);
}

export function deletePreviewRecord(recordId) {
  state.records = state.records.filter((row) => String(row.id) !== String(recordId));
}

export function getPreviewApproval(monthKey) {
  return clone(state.approvals.get(String(monthKey)) || null);
}

export function getPreviewApprovalStatus(monthKey) {
  return state.approvals.get(String(monthKey))?.status || 'open';
}

export function setPreviewApprovalStatus(monthKey, status, {
  employeeName = 'עובד/ת לדוגמה',
  adminName = 'אדמין לדוגמה',
} = {}) {
  const key = String(monthKey || '').trim();
  const nextStatus = String(status || 'open').trim();
  if (!key) throw new Error('חודש בדיקה לא תקין');
  if (!PREVIEW_APPROVAL_STATUSES.includes(nextStatus)) {
    throw new Error('סטטוס בדיקה לא נתמך');
  }

  if (nextStatus === 'open') {
    state.approvals.delete(key);
    return null;
  }

  const now = new Date().toISOString();
  const existing = state.approvals.get(key) || {};
  const submittedByName = String(employeeName || 'עובד/ת לדוגמה').trim();
  const managerName = 'מנהל/ת לדוגמה';
  const finalAdminName = String(adminName || 'אדמין לדוגמה').trim();
  const row = {
    ...existing,
    emp_id: PREVIEW_EMP_ID,
    month_key: key,
    status: nextStatus,
    updated_at: now,
  };

  if (nextStatus === 'submitted') {
    Object.assign(row, {
      submitted_at: now,
      submitted_by_name: submittedByName,
      manager_approved_at: null,
      manager_approved_by_name: null,
      manager_pdf_sharepoint_url: null,
      manager_pdf_file_name: null,
      payroll_approved_at: null,
      payroll_approved_by_name: null,
    });
  } else if (nextStatus === 'locked') {
    Object.assign(row, {
      submitted_at: existing.submitted_at || now,
      submitted_by_name: existing.submitted_by_name || submittedByName,
      manager_approved_at: now,
      manager_approved_by_name: managerName,
      manager_pdf_sharepoint_url: 'preview://manager-approved-attendance.pdf',
      manager_pdf_file_name: `attendance-${key}-preview.pdf`,
      payroll_approved_at: null,
      payroll_approved_by_name: null,
    });
  } else if (nextStatus === 'reopened') {
    Object.assign(row, {
      submitted_at: existing.submitted_at || now,
      submitted_by_name: existing.submitted_by_name || submittedByName,
      reopened_at: now,
      reopen_reason: 'הוחזר לתיקון — מצב בדיקה',
      manager_approved_at: null,
      manager_approved_by_name: null,
      manager_pdf_sharepoint_url: null,
      manager_pdf_file_name: null,
      payroll_approved_at: null,
      payroll_approved_by_name: null,
    });
  } else if (nextStatus === 'approved_for_payroll') {
    Object.assign(row, {
      submitted_at: existing.submitted_at || now,
      submitted_by_name: existing.submitted_by_name || submittedByName,
      manager_approved_at: existing.manager_approved_at || now,
      manager_approved_by_name: existing.manager_approved_by_name || managerName,
      manager_pdf_sharepoint_url: existing.manager_pdf_sharepoint_url || 'preview://manager-approved-attendance.pdf',
      manager_pdf_file_name: existing.manager_pdf_file_name || `attendance-${key}-preview.pdf`,
      payroll_approved_at: now,
      payroll_approved_by_name: finalAdminName,
    });
  }

  state.approvals.set(key, row);
  return clone(row);
}

export function submitPreviewMonth(monthKey, submittedByName = '') {
  const now = new Date().toISOString();
  const row = {
    emp_id: PREVIEW_EMP_ID,
    month_key: String(monthKey),
    status: 'submitted',
    submitted_at: now,
    submitted_by_name: String(submittedByName || '').trim(),
    updated_at: now,
  };
  state.approvals.set(String(monthKey), row);
  return clone(row);
}

export function createPreviewAttachment(recordId, { storagePath, fileName, fileType, fileSize } = {}) {
  const record = state.records.find((row) => String(row.id) === String(recordId));
  if (!record) throw new Error('רשומת ההדגמה לא נמצאה');
  const attachment = {
    id: `preview-attachment-${state.attachmentSeq++}`,
    record_id: record.id,
    emp_id: PREVIEW_EMP_ID,
    storage_path: storagePath || '',
    file_name: fileName || 'קובץ הדגמה',
    file_type: fileType || '',
    file_size: Number(fileSize || 0),
  };
  record.attendance_record_attachments = Array.isArray(record.attendance_record_attachments)
    ? record.attendance_record_attachments
    : [];
  record.attendance_record_attachments.push(attachment);
  return clone(attachment);
}

export function deletePreviewAttachment(attachmentId) {
  for (const record of state.records) {
    record.attendance_record_attachments = (record.attendance_record_attachments || [])
      .filter((item) => String(item.id) !== String(attachmentId));
  }
}

export function previewActivityTypes() {
  return ['ביטול זמן','הכשרה','חדר בריחה','מקוון','סדנה','סיור','קורס','תפעול'];
}
