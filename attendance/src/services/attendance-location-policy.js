/**
 * Physical-location requirements for instructor attendance.
 * Zoom is a report location, not a reason to require an authority/school/address.
 * The legacy 'זום' report type is still supported for existing records.
 */
export function isZoomLocationReport({
  activityType = '',
  trainingMode = '',
  operationMeetingMode = '',
  operationName = '',
  scheduledOnline = false,
} = {}) {
  const type = String(activityType || '').trim();
  if (type === 'זום' || type === 'מקוון') return true;
  if (type === 'הכשרה') return trainingMode === 'online' || scheduledOnline === true;
  if (type === 'תפעול') {
    if (operationMeetingMode === 'online') return true;
    // Legacy "other" operations that explicitly identify an online meeting.
    // Do not infer Zoom from arbitrary notes, e.g. "הכנת ציוד לזום".
    return /^(?:(?:ישיבת|פגישת|מפגש|שיחת)\s+)?(?:זום|zoom|מקוון|online)$/iu.test(String(operationName || '').trim());
  }
  return false;
}
