import { supabase } from '../api/client.js';
import { withTravelDeadline } from '../services/travel-request-guard.js';
import { instructorAttendanceError } from '../services/instructor-error.service.js';

// Same login mechanism as the dashboard (frontend/src/api.js loginWithSupabaseAuth):
// translate username/emp_id to an auth email via a SECURITY DEFINER RPC, then a real
// supabase.auth.signInWithPassword. Errors are intentionally generic — do not reveal
// whether a username exists or which of username/password was wrong.
export async function signInWithUsername(username, password) {
  const loginUsername = String(username || '').trim().toLowerCase();
  const submittedPassword = String(password || '').trim();
  if (!loginUsername || !submittedPassword) {
    throw new Error('נא למלא שם משתמש / מספר עובד וקוד כניסה');
  }

  const { data: lookupRows, error: lookupError } = await supabase
    .rpc('lookup_login_user_by_username', { p_username: loginUsername });
  if (lookupError) throw new Error(instructorAttendanceError(lookupError, 'שגיאה בהתחברות, נסו שוב'));

  const lookupList = Array.isArray(lookupRows) ? lookupRows : lookupRows ? [lookupRows] : [];
  const authEmail = String(lookupList[0]?.auth_email || '').trim();
  if (!authEmail) throw new Error('שם משתמש או קוד כניסה שגויים');

  const { data: authData, error: authError } = await withTravelDeadline(() => supabase.auth.signInWithPassword({
    email: authEmail,
    password: submittedPassword
  }), {timeoutMs:25000, action:'התחברות'});
  if (authError || !authData?.user) throw new Error(instructorAttendanceError(authError, 'שם משתמש או קוד כניסה שגויים'));

  return authData.session;
}

export async function signOut() {
  await withTravelDeadline(() => supabase.auth.signOut(), {timeoutMs:25000, action:'התנתקות'});
}

export async function getExistingSession() {
  const { data } = await withTravelDeadline(() => supabase.auth.getSession(), {action:'בדיקת ההתחברות'});
  return data?.session ?? null;
}
