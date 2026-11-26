/**
 * Entry-code policy for dashboard Auth.
 *
 * - Existing Auth passwords remain valid as-is (any length / charset).
 * - New / reset codes must be numeric with 4–6 digits (leading zeros allowed).
 * - Supabase Auth enforces a platform minimum of 6 characters for NEW passwords.
 *   Short numeric codes (4–5 digits) are stored as `c:` + digits so Auth accepts
 *   them, without keeping plaintext in public.users.entry_code.
 * - Login always tries the submitted secret first, then the encoded form for 4–5
 *   digit inputs only.
 */

export const NEW_ENTRY_CODE_MIN_DIGITS = 4;
export const NEW_ENTRY_CODE_MAX_DIGITS = 6;
export const SHORT_ENTRY_CODE_AUTH_PREFIX = 'c:';

export function trimEntryCode(value) {
  return String(value ?? '').trim();
}

export function isNumericEntryCode(value, { min = NEW_ENTRY_CODE_MIN_DIGITS, max = NEW_ENTRY_CODE_MAX_DIGITS } = {}) {
  const code = trimEntryCode(value);
  if (!code) return false;
  return new RegExp(`^\\d{${min},${max}}$`).test(code);
}

export function isValidNewEntryCode(value) {
  return isNumericEntryCode(value);
}

export function describeNewEntryCodeRule() {
  return `קוד הכניסה החדש חייב להכיל ${NEW_ENTRY_CODE_MIN_DIGITS} עד ${NEW_ENTRY_CODE_MAX_DIGITS} ספרות בלבד (מותר להתחיל ב-0).`;
}

/**
 * Map a newly chosen entry code to the Auth password material.
 * Longer / complex existing secrets are never passed through this helper.
 */
export function encodeNewEntryCodeForAuth(value) {
  const code = trimEntryCode(value);
  if (!isValidNewEntryCode(code)) {
    throw new Error('invalid_new_entry_code');
  }
  if (code.length < 6) return `${SHORT_ENTRY_CODE_AUTH_PREFIX}${code}`;
  return code;
}

/**
 * Candidates to try on login for a submitted secret, preserving existing
 * credentials first.
 */
export function authPasswordCandidatesForLogin(submittedSecret) {
  const raw = trimEntryCode(submittedSecret);
  if (!raw) return [];
  const candidates = [raw];
  if (/^\d{4,5}$/.test(raw)) {
    candidates.push(`${SHORT_ENTRY_CODE_AUTH_PREFIX}${raw}`);
  }
  return candidates;
}
