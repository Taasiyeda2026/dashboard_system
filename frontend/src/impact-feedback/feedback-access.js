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

/** Only Israa's specific active account may edit draft Hebrew/Arabic wording. */
export function canEditImpactFeedbackWording(user) {
  return String(user?.user_id || '').trim() === FEEDBACK_ISRAA_USER_ID
    && String(user?.role || '').trim().toLowerCase() === 'business_development_manager'
    && user?.is_active !== false;
}


/**
 * An activity manager may create/share educational-staff feedback only for
 * activities assigned to them. This UI helper mirrors the DB name comparison;
 * SQL remains the authorization boundary.
 */
export function canShareEducationalStaffFeedback(user, group) {
  if (isFeedbackAdmin(user)) return true;
  if (user?.is_active === false || String(user?.role || '').trim().toLowerCase() !== 'activities_manager') return false;
  const ownName = [user?.full_name, user?.name, user?.username]
    .map((value) => String(value || '').trim()).find(Boolean) || '';
  const normalized = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
  return Boolean(normalized(ownName) && normalized(ownName) === normalized(group?.activity_manager));
}
