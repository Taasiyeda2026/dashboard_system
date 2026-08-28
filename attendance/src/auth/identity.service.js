import { supabase } from '../api/client.js';
import {
  getAdminPreviewIdentity,
  isAdminPreviewRequested,
} from '../preview/preview-mode.js';

export class AttendanceIdentityError extends Error {}

function firstRow(data) {
  return Array.isArray(data) ? data[0] : data;
}

async function getCurrentAppUser() {
  const { data: userRows, error } = await supabase.rpc('get_current_app_user');
  if (error) throw new AttendanceIdentityError('שגיאה באיתור המשתמש במערכת');
  const userRow = firstRow(userRows);
  if (!userRow) throw new AttendanceIdentityError('לא נמצא משתמש פעיל המקושר לחשבון הזה');
  if (userRow.is_active !== true) throw new AttendanceIdentityError('המשתמש אינו פעיל');
  return userRow;
}

// auth_user_id (from the live session) -> public.users (via the same hardened
// get_current_app_user() RPC the dashboard uses) -> public.contacts_instructors by
// emp_id only. No fallback by name: an unmatched or inactive/non-instructor user is
// blocked here, before the app ever renders instructor data.
export async function resolveInstructorIdentity() {
  const userRow = await getCurrentAppUser();
  if (userRow.role !== 'instructor') throw new AttendanceIdentityError('המשתמש אינו רשום כמדריך');

  const { data: attendanceAllowed, error: permissionError } = await supabase
    .rpc('app_has_permission', { flag: 'access_attendance_reporting' });
  if (permissionError) throw new AttendanceIdentityError('שגיאה בבדיקת הרשאת מערכת הנוכחות');
  if (attendanceAllowed !== true) throw new AttendanceIdentityError('אין הרשאה למערכת דיווח הנוכחות');

  const empId = Number(userRow.emp_id);
  if (!empId) throw new AttendanceIdentityError('לא הוגדר מספר עובד עבור המשתמש');

  const { data: contact, error: contactError } = await supabase
    .from('contacts_instructors')
    .select('emp_id,full_name')
    .eq('emp_id', empId)
    .maybeSingle();
  if (contactError) throw new AttendanceIdentityError('שגיאה באיתור פרטי המדריך');
  if (!contact) throw new AttendanceIdentityError('לא נמצאה התאמה חד־משמעית למדריך במאגר אנשי הקשר');

  return {
    userId: userRow.user_id,
    name: contact.full_name || userRow.full_name || userRow.name || '',
    empId: contact.emp_id
  };
}

// Admin preview is deliberately separate from the instructor identity path.
// It is available only when the explicit adminPreview=1 URL flag is present,
// and it never exposes or impersonates a real employee record.
export async function resolveAdminPreviewIdentity() {
  if (!isAdminPreviewRequested()) {
    throw new AttendanceIdentityError('מצב תצוגת עובד לא הופעל');
  }
  const userRow = await getCurrentAppUser();
  if (String(userRow.role || '').trim() !== 'admin') {
    throw new AttendanceIdentityError('תצוגת עובד זמינה לאדמין בלבד');
  }
  return getAdminPreviewIdentity(userRow);
}
