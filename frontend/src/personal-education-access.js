import { hasPermission } from './permission-policy.js';

export const PERSONAL_EDUCATION_ROUTE = 'education-activities';
// Account-specific presentation preference. No raw account identifiers or credentials
// are published. This is NOT an authorization mechanism: the existing activity
// permission and Supabase access policies still determine every data read.
const PERSONAL_IDENTITY_FINGERPRINT = '7263a6a2f58d4f5a';

export function educationIdentityFingerprint(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return '';
  let hash = 0xcbf29ce484222325n;
  for (const c of id) hash = BigInt.asUintN(64, (hash ^ BigInt(c.charCodeAt(0))) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

export function isPersonalEducationViewer(user = {}) {
  return user?.is_active !== false && user?.profile_is_active !== false
    && user?.role === 'domain_manager'
    && educationIdentityFingerprint(user.auth_user_id) === PERSONAL_IDENTITY_FINGERPRINT
    && hasPermission(user, 'view_activities');
}

export function withPersonalEducationRoute(routes = [], user = {}) {
  const current = Array.isArray(routes) ? routes : [];
  const eligible = current.includes('activities') && isPersonalEducationViewer(user);
  if (!eligible && !current.includes(PERSONAL_EDUCATION_ROUTE)) return current;
  const regular = current.filter(route => route !== PERSONAL_EDUCATION_ROUTE);
  return eligible ? [PERSONAL_EDUCATION_ROUTE, ...regular] : regular;
}
