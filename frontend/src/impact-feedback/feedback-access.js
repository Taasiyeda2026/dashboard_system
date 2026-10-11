/**
 * Temporary feedback rollout: only administrators and Israa's specific active user.
 * The server independently checks the authenticated auth.uid() against public.users.
 * Frontend checks only control navigation; they are not an authorization boundary.
 */
export const FEEDBACK_ISRAA_USER_ID = '3030';

export function isFeedbackAdmin(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

export function canViewImpactFeedback(user) {
  if (isFeedbackAdmin(user)) return true;
  return String(user?.user_id || '').trim() === FEEDBACK_ISRAA_USER_ID
    && String(user?.role || '').trim() === 'business_development_manager'
    && user?.is_active !== false;
}
