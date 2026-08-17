import { supabase } from '../api/client.js';

export class AttendanceIdentityError extends Error {}

// auth_user_id (from the live session) -> public.users (via the same hardened
// get_current_app_user() RPC the dashboard uses) -> public.contacts_instructors by
// emp_id only. No fallback by name: an unmatched or inactive/non-instructor user is
// blocked here, before the app ever renders instructor data.
export async function resolveInstructorIdentity() {
  const { data: userRows, error: userError } = await supabase.rpc('get_current_app_user');
  if (userError) throw new AttendanceIdentityError('שגיאה באיתור המשתמש במערכת');

  const userRow = Array.isArray(userRows) ? userRows[0] : userRows;
  if (!userRow) throw new AttendanceIdentityError('לא נמצא משתמש פעיל המקושר לחשבון הזה');
  if (userRow.is_active !== true) throw new AttendanceIdentityError('המשתמש אינו פעיל');
  if (userRow.role !== 'instructor') throw new AttendanceIdentityError('המשתמש אינו רשום כמדריך');

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
