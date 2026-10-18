/**
 * Feedback permissions: admin (full), Israa (existing wording pilot),
 * activity managers and Eden (results-only), instructors (personal portal).
 * The server independently checks auth.uid() against public.users.
 * Frontend checks only control navigation; they are not an authorization boundary.
 */
export const FEEDBACK_ISRAA_USER_ID = '3030';

export function isFeedbackInstructor(user) {
  return String(user?.role || '').trim().toLowerCase() === 'instructor' && user?.is_active !== false;
}

export function isFeedbackAdmin(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

export function canViewImpactFeedback(user) {
  if (isFeedbackAdmin(user)) return true;
  if (user?.is_active === false) return false;
  const role = String(user?.role || '').trim().toLowerCase();
  const userId = String(user?.user_id || '').trim();
  return (userId === FEEDBACK_ISRAA_USER_ID && role === 'business_development_manager')
    || role === 'activities_manager'
    || (userId === '6000' && role === 'operation_manager');
}

/** Only this pilot account may correct Hebrew/Arabic question wording in drafts. */
export function canEditImpactFeedbackWording(user) {
  return !isFeedbackAdmin(user) && canViewImpactFeedback(user);
}
