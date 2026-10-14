/**
 * Visual-only activity name disambiguation.
 *
 * Gefen 53828 and its historical activity ID 82835 both belong to
 * middle-school Biomimicry. Elementary 6089 must retain its original label.
 * Never rewrite the activity record or its catalog identity.
 */
export function displayedActivityProgramName(row = {}, originalName = '') {
  const number = String(row?.activity_no ?? row?.activity_number ?? row?.gefen_number ?? '').trim();
  if (number === '53828' || number === '82835') return 'ביומימיקרי (לחטיבה)';
  return originalName;
}
