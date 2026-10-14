/**
 * Visual-only activity name disambiguation.
 *
 * 53828 is middle-school Biomimicry, while 6089 is elementary.
 * The retired number 82835 had been used for both age bands; never infer middle school from it.
 * Never rewrite the activity record or its catalog identity.
 */
export function displayedActivityProgramName(row = {}, originalName = '') {
  const number = String(row?.activity_no ?? row?.activity_number ?? row?.gefen_number ?? '').trim();
  if (number === '53828') return 'ביומימיקרי (לחטיבה)';
  return originalName;
}
