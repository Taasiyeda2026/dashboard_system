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
import { isGeneratedTravelCancellation, sourceAttendanceRecords } from './travel-compensation.js';
export { isGeneratedTravelCancellation, sourceAttendanceRecords } from './travel-compensation.js';

const LEGACY_SUMMER_WORKSHOP = 'סדנאות קיץ';
const WORKSHOP_LABEL = 'סדנה';
const LEGACY_ONLINE_LABEL = 'מקוון';
const ZOOM_LABEL = 'זום';
const EDIT_RECORD_KEY = 'av2_edit_record_id';

const ATTENDANCE_READ_CACHE_TTL_MS = 60_000;
const CACHE_MISS = Symbol('attendance-cache-miss');
const monthRecordsCache = new Map();
const monthApprovalCache = new Map();
const dashboardValidationCache = new Map();
let operationOptionsCache = null;

function cacheKey(empId, suffix) {
  return `${String(empId)}|${String(suffix)}`;
}

function cachedValue(map, key) {
  const entry = map.get(key);
  if (!entry) return CACHE_MISS;
  if (Date.now() - entry.at > ATTENDANCE_READ_CACHE_TTL_MS) {
    map.delete(key);
    return CACHE_MISS;
  }
  return entry.value;
}

function storeCachedValue(map, key, value) {
  map.set(key, { at: Date.now(), value });
  return value;
}

export function invalidateAttendanceCache(empId = null) {
  const prefix = empId == null ? '' : `${String(empId)}|`;
  for (const map of [monthRecordsCache, monthApprovalCache, dashboardValidationCache]) {
    for (const key of map.keys()) {
      if (!prefix || key.startsWith(prefix)) map.delete(key);
    }
  }
}

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
  const hasPublicTransport = Object.prototype.hasOwnProperty.call(payload, 'public_transport');
  const usesPublicTransport = activityType !== ZOOM_LABEL && payload?.public_transport === true;
  return {
    ...payload,
    activity_type: activityType,
    ...(hasPublicTransport || activityType === ZOOM_LABEL ? {
      public_transport: usesPublicTransport,
      public_transport_cost: usesPublicTransport ? Number(payload?.public_transport_cost || 0) : 0,
    } : {}),
    // Zoom and public-transport reports never carry reimbursable travel kilometres.
    ...((activityType === ZOOM_LABEL || usesPublicTransport) ? { roundtrip_km: 0 } : {}),
  };
}

function activeEditRecordId() {
  try {
    const form = document.querySelector('.av2-report__form[data-av2-edit-record-id]');
    return String(form?.dataset?.av2EditRecordId || '').trim();
  } catch {
    return '';
  }
}

function clearActiveEditRecord() {
  try {
    sessionStorage.removeItem(EDIT_RECORD_KEY);
    const form = document.querySelector('.av2-report__form[data-av2-edit-record-id]');
    if (form) delete form.dataset.av2EditRecordId;
  } catch {}
}

export const ATTENDANCE_ACTIVITY_TYPES = ['קורס','סדנה','סיור','זום','חדר בריחה','הכשרה','ביטול זמן','תפעול'];
const FALLBACK_ACTIVITY_TYPES = ATTENDANCE_ACTIVITY_TYPES;

export function generatedCancellationFor(records = [], sourceId = '') {
  return records.find((record) => isGeneratedTravelCancellation(record) && record.source_attendance_record_id === sourceId) || null;
}

// ─── Records ────────────────────────────────────────────────────────────────

/**
 * Returns all records for a given instructor-month, newest first.
 * Includes attached file stubs for display.
 */
export async function getMonthRecords(empId, year, month, { force = false } = {}) {
  if (isAdminPreviewRequested()) {
    return getPreviewRecords(year, month).map(normalizeAttendanceRecord);
  }

  const key = cacheKey(empId, `${year}-${String(month).padStart(2, '0')}`);
  if (!force) {
    const cached = cachedValue(monthRecordsCache, key);
    if (cached !== CACHE_MISS) return cached;
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
  const rows = (data || []).map(normalizeAttendanceRecord);
  const sourceIds = sourceAttendanceRecords(rows).map((row) => row.id);
  if (!sourceIds.length) return storeCachedValue(monthRecordsCache, key, rows);

  // Route reconciliation is intentionally not run during screen reads.
  // It runs after save and via explicit retry/approval flows, so navigation stays fast.
  const { data: compensation, error: compensationError } = await supabase.from('attendance_travel_compensations')
    .select('*').in('source_attendance_record_id', sourceIds);
  if (compensationError && !/attendance_travel_compensations/i.test(compensationError.message || '')) {
    throw new Error(`שגיאה בטעינת חישובי נסיעה: ${compensationError.message}`);
  }
  const bySource = new Map((compensation || []).map((item) => [item.source_attendance_record_id, item]));
  const result = rows.map((row) => bySource.has(row.id) ? { ...row, travel_compensation: bySource.get(row.id) } : row);
  return storeCachedValue(monthRecordsCache, key, result);
}

export async function getMonthDashboardValidation(empId, year, month, { force = false } = {}) {
  if (isAdminPreviewRequested()) return [];
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;
  const key = cacheKey(empId, monthKey);
  if (!force) {
    const cached = cachedValue(dashboardValidationCache, key);
    if (cached !== CACHE_MISS) return cached;
  }

  const { data, error } = await supabase.rpc('av2_validate_attendance_month_dashboard', {
    p_emp_id: Number(empId),
    p_month_key: monthKey,
  });
  if (error) {
    console.warn('[attendance] dashboard validation unavailable', error);
    return [];
  }
  return storeCachedValue(dashboardValidationCache, key, Array.isArray(data) ? data : []);
}

/**
 * Aggregate monthly summary from loaded records (no extra DB round-trip).
 */
export function calcMonthSummary(records) {
  return {
    recordsCount: new Set(records.map((record) => record.report_date).filter(Boolean)).size,
    totalHours: records.reduce((s, r) => s + Number(r.total_hours || 0), 0),
    totalKm: records.reduce((s, r) => s + Number(r.roundtrip_km || 0), 0),
    totalExpenses: records.reduce((s, r) => s + Number(r.expenses || 0), 0)
  };
}

/**
 * Create a new attendance record. When the full report form is explicitly in
 * edit mode, the same payload updates the existing record instead of inserting
 * a second row. This keeps new/edit forms functionally identical.
 */
export async function createRecord(empId, payload) {
  const normalizedPayload = normalizeRecordPayload(payload);
  const editRecordId = activeEditRecordId();

  if (editRecordId) {
    const updated = await updateRecord(editRecordId, empId, normalizedPayload);
    clearActiveEditRecord();
    return updated;
  }

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
  invalidateAttendanceCache(empId);
  return normalizeAttendanceRecord(data);
}

export async function reconcileTravelCompensation(sourceRecordId) {
  if (isAdminPreviewRequested()) return null;
  const { data: prepared, error: prepareError } = await supabase.rpc('av2_mark_attendance_travel_pending', {
    p_source_id: sourceRecordId
  });
  if (prepareError) return { eligible: true, status: 'unavailable', failure_code: 'context_prepare_failed' };
  if (prepared?.eligible === false) return { eligible: false, status: 'not_applicable' };
  const { data, error } = await supabase.functions.invoke('attendance-travel-compensation', {
    body: { source_attendance_record_id: sourceRecordId }
  });
  if (error) return { eligible: true, status: 'unavailable', failure_code: data?.failure_code || 'route_service_unavailable' };
  return data;
}

export async function getBaseTrainingRoutePreview() {
  if (isAdminPreviewRequested()) return null;
  const { data, error } = await supabase.functions.invoke('attendance-base-training-routes', {
    body: { mode: 'preview' }
  });
  if (error) {
    return {
      ok: false,
      status: 'unavailable',
      reason: data?.reason || data?.error || 'route_service_unavailable'
    };
  }
  return data;
}

export async function overrideTravelCompensation(sourceRecordId, finalMinutes) {
  const { data, error } = await supabase.rpc('av2_override_attendance_time_cancellation', {
    p_source_id: sourceRecordId,
    p_final_minutes: Math.max(0, Math.round(Number(finalMinutes) || 0))
  });
  if (error) throw new Error(error.message || 'עדכון ביטול הזמן נכשל');
  monthRecordsCache.clear();
  return data;
}

export async function getOperationOptions() {
  if (isAdminPreviewRequested()) return [
    { id: 'preview-toast', label: 'הרמת כוסית', active: true, sort_order: 10, is_other: false },
    { id: 'preview-other', label: 'אחר', active: true, sort_order: 999999, is_other: true }
  ];
  if (operationOptionsCache && Date.now() - operationOptionsCache.at <= 5 * 60_000) {
    return operationOptionsCache.value;
  }
  const { data, error } = await supabase.from('attendance_operation_options').select('id,label,active,sort_order,is_other')
    .eq('active', true).order('is_other').order('sort_order').order('label');
  if (error) throw new Error(`שגיאה בטעינת סוגי תפעול: ${error.message}`);
  const value = data || [];
  operationOptionsCache = { at: Date.now(), value };
  return value;
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
  invalidateAttendanceCache(empId);
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
  invalidateAttendanceCache(empId);
}

// ─── Month Approvals ─────────────────────────────────────────────────────────

/**
 * Returns the approval row for a month_key ("YYYY-MM"), or null if not yet created (= open).
 */
export async function getMonthApproval(empId, monthKey, { force = false } = {}) {
  if (isAdminPreviewRequested()) return getPreviewApproval(monthKey);

  const key = cacheKey(empId, monthKey);
  if (!force) {
    const cached = cachedValue(monthApprovalCache, key);
    if (cached !== CACHE_MISS) return cached;
  }

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

  let result = monthApprovalRes.data;
  if (payrollApprovalRes.data) {
    result = {
      ...(monthApprovalRes.data || {}),
      status: 'approved_for_payroll',
      payroll_approved_at: payrollApprovalRes.data.approved_at || null,
      payroll_approved_by_name: payrollApprovalRes.data.approved_by_name || null
    };
  }
  storeCachedValue(monthApprovalCache, key, result);
  return result;
}

/**
 * Submit a month (instructor confirms the month is complete).
 * Status becomes 'submitted'; manager must lock/approve separately.
 */
export async function submitMonth(empId, monthKey, submittedByName = '') {
  if (isAdminPreviewRequested()) return submitPreviewMonth(monthKey, submittedByName);

  const { data, error } = await supabase.rpc('av2_submit_attendance_month', {
    p_month_key: monthKey,
    p_submitted_by_name: String(submittedByName || '').trim()
  });

  if (error) throw new Error(`שגיאה בהגשת חודש: ${error.message}`);
  invalidateAttendanceCache(empId);
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

/** Report-facing types are fixed business choices, not raw activities.activity_type values. */
export async function getActivityTypes() {
  if (isAdminPreviewRequested()) {
    const preview = normalizeActivityTypeList(previewActivityTypes());
    return preview.length ? preview : [...FALLBACK_ACTIVITY_TYPES];
  }
  return [...FALLBACK_ACTIVITY_TYPES];
}
