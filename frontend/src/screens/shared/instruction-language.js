/**
 * Canonical instruction language for scheduling.
 * Missing / empty / null values default to Hebrew (he).
 * Arabic is enforced only when explicitly set to ar / ערבית.
 */
export function resolveInstructionLanguage(activity) {
  const raw = activity != null && typeof activity === 'object' && !Array.isArray(activity)
    ? activity.instruction_language
    : activity;
  const value = String(raw ?? '').trim();
  if (!value) return 'he';
  const normalized = value.toLocaleLowerCase('he-IL');
  if (normalized === 'ar' || value === 'ערבית') return 'ar';
  if (normalized === 'he' || value === 'עברית') return 'he';
  return 'he';
}

export function instructionLanguageLabel(activity) {
  return resolveInstructionLanguage(activity) === 'ar' ? 'ערבית' : 'עברית';
}

export function profileSpeaksLanguage(profileLanguages, language) {
  const wanted = resolveInstructionLanguage(language);
  return (Array.isArray(profileLanguages) ? profileLanguages : [])
    .some((entry) => resolveInstructionLanguage(entry) === wanted);
}
