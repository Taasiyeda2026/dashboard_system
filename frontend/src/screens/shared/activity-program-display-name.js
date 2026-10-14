/**
 * Activity display names only. Never mutate catalog identifiers or saved names.
 * 82835 is a legacy, ambiguous identifier. Live 2026-27 records include
 * elementary grades, a grade 7 class and missing grade data; it must not be
 * misrepresented as a secondary-school (53828) program.
 */
export function displayedActivityProgramName(row = {}, originalName = '') {
  const number = String(row?.activity_no ?? row?.activity_number ?? row?.gefen_number ?? '').trim();
  if (number === '53828') return 'ביומימיקרי (לחטיבה)';
  if (number === '82835') return 'ביומימיקרי (מספר ישן 82835 — לבדיקה)';
  return originalName;
}

/**
 * Labels in activity pickers are visual only; <option value> and data-activity-no
 * always retain the canonical catalog identity and saved course name.
 */
export function displayedActivityChoiceLabel(row = {}, storedLabel = '') {
  const number = String(row?.activity_no ?? row?.gefen_number ?? '').trim();
  if (number === '6089') return 'ביומימיקרי (יסודי) — 6089';
  if (number === '53828') return 'ביומימיקרי (לחטיבה) — 53828';
  if (number === '82835') return 'ביומימיקרי (מספר ישן 82835 — לבדיקה)';
  return storedLabel;
}
