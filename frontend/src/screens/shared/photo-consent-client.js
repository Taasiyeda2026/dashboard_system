import { supabase } from '../../supabase-client.js';

export const PHOTO_CONSENT_MAX_BYTES = 6 * 1024 * 1024;
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const SUFFIXES = /\.(pdf|jpe?g|png)$/i;

export function validatePhotoConsentFile(file) {
  if (!file || !file.size || file.size > PHOTO_CONSENT_MAX_BYTES ||
      (!TYPES.has(file.type) && !SUFFIXES.test(String(file.name || '')))) {
    throw new Error('ניתן להעלות קובצי PDF, JPG או PNG עד 6MB לקובץ.');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('לא ניתן לקרוא את הקובץ.'));
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.readAsDataURL(file);
  });
}

export async function photoConsentInvoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('photo-consent-sharepoint', {
    body: { action, ...payload }
  });
  if (error || data?.error) throw new Error(data?.message || error?.message || 'פעולת SharePoint נכשלה.');
  return data;
}

// Read persisted metadata, not a local upload flag: the camera must also be green
// after page reload and must reset when all linked files were deleted.
export async function photoConsentActivityHasFiles(activityId) {
  const id = Number(activityId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  const { data, error } = await supabase.from('activity_photo_consent_files')
    .select('id')
    .eq('activity_id', id)
    .limit(1);
  if (error) throw new Error(error.message || 'לא ניתן לבדוק אישורי צילום.');
  return Array.isArray(data) && data.length > 0;
}

export async function uploadPhotoConsentFiles(activityId, files, onProgress = null) {
  if (!Number.isSafeInteger(Number(activityId)) || Number(activityId) <= 0) {
    throw new Error('מזהה הפעילות אינו תקין.');
  }
  const selection = Array.from(files || []);
  if (!selection.length) return [];
  selection.forEach(validatePhotoConsentFile); // Fail before uploading any file on a bad batch.
  const saved = [];
  for (const [index, file] of selection.entries()) {
    onProgress?.({ index: index + 1, total: selection.length, name: file.name });
    const base64 = await fileToBase64(file);
    const result = await photoConsentInvoke('upload', {
      activity_id: Number(activityId), file_name: file.name, base64
    });
    saved.push(result.file);
  }
  return saved;
}
