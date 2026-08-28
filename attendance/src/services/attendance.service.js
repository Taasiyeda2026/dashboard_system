/**
 * attendance.service.js
 * All Supabase operations on attendance_records, attendance_month_approvals,
 * and attendance_record_attachments. emp_id is always a bigint from the
 * resolved instructor identity (never from raw frontend input).
 * RLS is enforced server-side via auth.uid() → users.emp_id.
 */

import { supabase } from '../api/client.js';
import {
  createPreviewAttachment,
  createPreviewRecord,
  deletePreviewAttachment,
  deletePreviewRecord,
  getPreviewApproval,
  getPreviewRecords,
  isAdminPreviewRequested,
  previewActivityTypes,
  submitPreviewMonth,
  updatePreviewRecord,
} from '../preview/preview-mode.js';

const LEGACY_SUMMER_WORKSHOP = 'סדנאות קיץ';
const WORKSHOP_LABEL = 'סדנה';
const LEGACY_ONLINE_LABEL = 'מקוון';
const ZOOM_LABEL = 'זום';

function normalizeAttendanceActivityTypeLabel(value) {
  const raw = String(value || '').trim();
  if (raw === LEGACY_SUMMER_WORKSHOP) return WORKSHOP_LABEL;
  if (raw === LEGACY_ONLINE_LABEL) return ZOOM_LABEL;
  return raw;
}

function normalizeAttendanceRecord(record) {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    activity_type: normalizeAttendanceActivityTypeLabel(record.activity_type),
  };
}

function normalizeActivityTypeList(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(normalizeAttendanceActivityTypeLabel)
    .filter(Boolean))];
}

function normalizeRecordPayload(payload = {}) {
  const activityType = normalizeAttendanceActivityTypeLabel(payload?.activity_type);
  return {
    ...payload,
    activity_type: activityType,
    // Zoom is always remote and therefore never carries travel kilometres.
    ...(activityType === ZOOM_LABEL ? { roundtrip_km: 0 } : {}),
  };
}

const FALLBACK_ACTIVITY_TYPES = ['ביטול זמן','הכשרה','חדר בריחה','זום','סדנה','סיור','קורס','תפעול'];

// ─── Records ────────────────────────────────────────────────────────────────

/**
 * Returns all records for a given instructor-month, newest first.
 * Includes attached file stubs for display.
 */
export async function getMonthRecords(empId, year, month) {
  if (isAdminPreviewRequested()) {
    return getPreviewRecords(year, month).map(normalizeAttendanceRecord);
  }

  const pad = (n) => String(n).padStart(2, '0');
  const startDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  const { data, error } = await supabase
    .from('attendance_records')
    .select(`
      *,
      attendance_record_attachments (id, storage_path, file_name, file_type, file_size)
    `)
    .eq('emp_id', empId)
    .gte('report_date', startDate)
    .lte('report_date', endDate)
    .order('report_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (error) throw new Error(`שגיאה בטעינת רשומות: ${error.message}`);
  return (data || []).map(normalizeAttendanceRecord);
}

/**
 * Aggregate monthly summary from loaded records (no extra DB round-trip).
 */
export function calcMonthSummary(records) {
  return {
    recordsCount: records.length,
    totalHours: records.reduce((s, r) => s + Number(r.total_hours || 0), 0),
    totalKm: records.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0),
    totalExpenses: records.reduce((s, r) => s + Number(r.expenses || 0), 0)
  };
}

/**
 * Create a new attendance record.
 * payload must include all required fields; emp_id is added here from the
 * resolved identity (not from user-visible form input).
 */
export async function createRecord(empId, payload) {
  const normalizedPayload = normalizeRecordPayload(payload);
  if (isAdminPreviewRequested()) return createPreviewRecord(normalizedPayload);

  const row = {
    ...normalizedPayload,
    emp_id: empId,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from('attendance_records')
    .insert([row])
    .select()
    .single();

  if (error) throw new Error(`שגיאה בשמירת רשומה: ${error.message}`);
  return normalizeAttendanceRecord(data);
}

/**
 * Update an existing record. emp_id must match the authenticated instructor
 * (RLS enforces this server-side; we also pass it for the WHERE clause).
 */
export async function updateRecord(recordId, empId, payload) {
  const normalizedPayload = normalizeRecordPayload(payload);
  if (isAdminPreviewRequested()) return updatePreviewRecord(recordId, normalizedPayload);

  const { data, error } = await supabase
    .from('attendance_records')
    .update({ ...normalizedPayload, updated_at: new Date().toISOString() })
    .eq('id', recordId)
    .eq('emp_id', empId)
    .select()
    .single();

  if (error) throw new Error(`שגיאה בעדכון רשומה: ${error.message}`);
  return normalizeAttendanceRecord(data);
}

/**
 * Delete a record and all its attachments (CASCADE handles DB side).
 * Storage files are deleted separately in storage.service.js before calling this.
 */
export async function deleteRecord(recordId, empId) {
  if (isAdminPreviewRequested()) {
    deletePreviewRecord(recordId);
    return;
  }

  const { error } = await supabase
    .from('attendance_records')
    .delete()
    .eq('id', recordId)
    .eq('emp_id', empId);

  if (error) throw new Error(`שגיאה במחיקת רשומה: ${error.message}`);
}

// ─── Month Approvals ─────────────────────────────────────────────────────────

/**
 * Returns the approval row for a month_key ("YYYY-MM"), or null if not yet created (= open).
 */
export async function getMonthApproval(empId, monthKey) {
  if (isAdminPreviewRequested()) return getPreviewApproval(monthKey);

  const [monthApprovalRes, payrollApprovalRes] = await Promise.all([
    supabase
      .from('attendance_month_approvals')
      .select('*')
      .eq('emp_id', empId)
      .eq('month_key', monthKey)
      .maybeSingle(),
    supabase
      .from('payroll_control_approvals')
      .select('id,approved_at,approved_by_name,status')
      .eq('employee_id', String(empId))
      .eq('month_key', monthKey)
      .eq('status', 'approved_for_payroll')
      .maybeSingle()
  ]);

  if (monthApprovalRes.error) throw new Error(`שגיאה בבדיקת סטטוס חודש: ${monthApprovalRes.error.message}`);
  if (payrollApprovalRes.error) throw new Error(`שגיאה בבדיקת אישור שכר: ${payrollApprovalRes.error.message}`);

  if (payrollApprovalRes.data) {
    return {
      ...(monthApprovalRes.data || {}),
      status: 'approved_for_payroll',
      payroll_approved_at: payrollApprovalRes.data.approved_at || null,
      payroll_approved_by_name: payrollApprovalRes.data.approved_by_name || null
    };
  }

  return monthApprovalRes.data;
}

/**
 * Submit a month (instructor confirms the month is complete).
 * Status becomes 'submitted'; manager must lock/approve separately.
 */
export async function submitMonth(empId, monthKey, submittedByName = '') {
  if (isAdminPreviewRequested()) return submitPreviewMonth(monthKey, submittedByName);

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('attendance_month_approvals')
    .upsert(
      {
        emp_id: empId,
        month_key: monthKey,
        status: 'submitted',
        submitted_at: now,
        submitted_by_name: String(submittedByName || '').trim(),
        updated_at: now
      },
      { onConflict: 'emp_id,month_key' }
    )
    .select()
    .single();

  if (error) throw new Error(`שגיאה בהגשת חודש: ${error.message}`);
  return data;
}

// ─── Attachment metadata ──────────────────────────────────────────────────────

/** Save attachment metadata after a successful Storage upload. */
export async function createAttachmentRecord(empId, recordId, { storagePath, fileName, fileType, fileSize }) {
  if (isAdminPreviewRequested()) {
    return createPreviewAttachment(recordId, { storagePath, fileName, fileType, fileSize });
  }

  const { data, error } = await supabase
    .from('attendance_record_attachments')
    .insert([{
      record_id: recordId,
      emp_id: empId,
      storage_path: storagePath,
      file_name: fileName,
      file_type: fileType,
      file_size: fileSize
    }])
    .select()
    .single();

  if (error) throw new Error(`שגיאה בשמירת מסמך: ${error.message}`);
  return data;
}

/** Delete attachment metadata (call after successful Storage delete). */
export async function deleteAttachmentRecord(attachmentId, empId) {
  if (isAdminPreviewRequested()) {
    deletePreviewAttachment(attachmentId);
    return;
  }

  const { error } = await supabase
    .from('attendance_record_attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('emp_id', empId);

  if (error) throw new Error(`שגיאה במחיקת מסמך: ${error.message}`);
}

// ─── Activity types list ──────────────────────────────────────────────────────

/** Fetch distinct activity_type values used in the activities table. */
export async function getActivityTypes() {
  if (isAdminPreviewRequested()) return normalizeActivityTypeList(previewActivityTypes());

  const { data, error } = await supabase.rpc('av2_get_distinct_activity_types');
  if (error) return FALLBACK_ACTIVITY_TYPES;
  const normalized = normalizeActivityTypeList(data);
  return normalized.length ? normalized : FALLBACK_ACTIVITY_TYPES;
}
