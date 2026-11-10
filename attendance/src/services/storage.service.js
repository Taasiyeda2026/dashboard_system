/**
 * storage.service.js
 * File upload/download/delete for attendance record attachments.
 * Storage path convention: {emp_id}/{record_id}/{EMPLOYEE}_{DD.MM.YY}_{NN}.{ext}
 * This matches the Storage RLS policy that checks the first path component.
 */

import { supabase } from '../api/client.js';
import { isAdminPreviewRequested } from '../preview/preview-mode.js';

const BUCKET = 'attendance-attachments';

const MIME_EXTENSION = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
};

function attachmentExtension(file = {}) {
  const fromName = String(file?.name || '').split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'].includes(fromName)) return fromName;
  return MIME_EXTENSION[String(file?.type || '').toLowerCase()] || 'bin';
}

export function attachmentEmployeeStorageLabel(employeeEmail, empId) {
  const localPart = String(employeeEmail || '').split('@')[0] || '';
  const ascii = localPart
    .normalize('NFKD')
    .replace(/[^a-zA-Z._-]/g, '')
    .split(/[._-]+/)
    .filter(Boolean)
    .join('')
    .toUpperCase();
  return ascii || `EMP${String(empId || '').replace(/\D/g, '') || 'UNKNOWN'}`;
}

export function attachmentUploadDateLabel(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  const safeDate = Number.isNaN(value.getTime()) ? new Date() : value;
  return [
    String(safeDate.getDate()).padStart(2, '0'),
    String(safeDate.getMonth() + 1).padStart(2, '0'),
    String(safeDate.getFullYear()).slice(-2)
  ].join('.');
}

export function buildAttachmentStorageFileName(file, {
  employeeEmail = '',
  empId,
  sequence = 1,
  uploadedAt = new Date()
} = {}) {
  const employee = attachmentEmployeeStorageLabel(employeeEmail, empId);
  const date = attachmentUploadDateLabel(uploadedAt);
  const seq = String(Math.max(1, Number(sequence) || 1)).padStart(2, '0');
  return `${employee}_${date}_${seq}.${attachmentExtension(file)}`;
}

async function nextAttachmentSequence(folder, employeeLabel, dateLabel) {
  const prefix = `${employeeLabel}_${dateLabel}_`;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { limit: 100, sortBy: { column: 'name', order: 'asc' } });
  if (error) throw new Error(`שגיאה בבדיקת קבצים קיימים: ${error.message}`);

  let maxSequence = 0;
  for (const item of (data || [])) {
    const name = String(item?.name || '');
    if (!name.startsWith(prefix)) continue;
    const suffix = name.slice(prefix.length).match(/^(\d+)\./);
    if (suffix) maxSequence = Math.max(maxSequence, Number(suffix[1]) || 0);
  }
  return maxSequence + 1;
}

/**
 * Upload a file to Supabase Storage and return the storage path.
 * Storage uses an ASCII-only employee/date/sequence key; the original file name
 * remains in attendance_attachments.file_name for display.
 * @param {File} file
 * @param {number} empId
 * @param {string} recordId  UUID of the attendance_record
 * @param {{employeeEmail?: string}} options
 * @returns {Promise<string>} storage path
 */
export async function uploadAttachment(file, empId, recordId, { employeeEmail = '' } = {}) {
  const folder = `${empId}/${recordId}`;
  const employeeLabel = attachmentEmployeeStorageLabel(employeeEmail, empId);
  const dateLabel = attachmentUploadDateLabel();

  if (isAdminPreviewRequested()) {
    const previewName = buildAttachmentStorageFileName(file, { employeeEmail, empId });
    return `preview/${folder}/${previewName}`;
  }

  const sequence = await nextAttachmentSequence(folder, employeeLabel, dateLabel);
  const storageName = buildAttachmentStorageFileName(file, {
    employeeEmail,
    empId,
    sequence
  });
  const path = `${folder}/${storageName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });

  if (error) throw new Error(`שגיאה בהעלאת קובץ: ${error.message}`);
  return path;
}

/**
 * Get a signed URL valid for 60 minutes.
 */
export async function getSignedUrl(storagePath) {
  if (isAdminPreviewRequested()) {
    return `data:text/plain;charset=utf-8,${encodeURIComponent('קובץ הדגמה — מצב בדיקה, לא נשמר קובץ אמיתי.')}`;
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);

  if (error) throw new Error(`שגיאה ביצירת קישור: ${error.message}`);
  return data.signedUrl;
}

/**
 * Delete a file from Storage (call before deleting the DB row).
 */
export async function deleteAttachment(storagePath) {
  if (isAdminPreviewRequested()) return;

  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([storagePath]);

  if (error) throw new Error(`שגיאה במחיקת קובץ: ${error.message}`);
}
