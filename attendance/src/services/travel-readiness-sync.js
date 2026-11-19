/**
 * Travel-tab readiness must track the latest attendance rows for the month.
 * dayOptions cached from an earlier visit can keep ready:false after the
 * instructor saves attendance on another tab; callers mark the cache stale and
 * reload only when it is safe (no unsaved travel draft / in-flight save).
 */

export function shouldRefreshTravelDays({ force = false, dayOptionsLength = 0, attendanceContextStale = false } = {}) {
  return Boolean(force) || Number(dayOptionsLength) <= 0 || Boolean(attendanceContextStale);
}

export function canReloadTravelAfterAttendanceChange({
  draftDirty = false,
  saving = false,
  loading = false,
  uncertainSave = false,
  panelHidden = true,
} = {}) {
  if (draftDirty || saving || loading || uncertainSave) return false;
  return panelHidden !== true;
}
