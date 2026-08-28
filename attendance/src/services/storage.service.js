/**
 * storage.service.js
 * File upload/download/delete for attendance record attachments.
 * Storage path convention: {emp_id}/{record_id}/{uuid}_{filename}
 * This matches the Storage RLS policy that checks the first path component.
 */

import { supabase } from '../api/client.js';
import { isAdminPreviewRequested } from '../preview/preview-mode.js';

const BUCKET = 'attendance-attachments';

/**
 * Upload a file to Supabase Storage and return the storage path.
 * @param {File} file
 * @param {number} empId
 * @param {string} recordId  UUID of the attendance_record
 * @returns {Promise<string>} storage path
 */
export async function uploadAttachment(file, empId, recordId) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u0590-\u05FF]/g, '_');
  const uid = crypto.randomUUID().slice(0, 8);
  const path = `${empId}/${recordId}/${uid}_${safeName}`;

  if (isAdminPreviewRequested()) return `preview/${path}`;

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
