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

/**
 * Default travel-day selection for the instructor tab.
 * Prefer a ready requested day; otherwise the first ready day that still needs
 * a travel report (or a rejected one). Never lock the initial view on a
 * not-ready assigned day when ready work remains.
 */
export function pickDefaultTravelDay(dayOptions = [], requestedDay = '') {
  const days = Array.isArray(dayOptions) ? dayOptions : [];
  if (!days.length) return null;
  const requested = days.find((day) => day?.date === requestedDay) || null;
  return (requested?.ready ? requested : null)
    || days.find((day) => day?.ready && (day.review_status === 'missing' || !day.review_status))
    || days.find((day) => day?.ready && day.review_status === 'rejected')
    || days.find((day) => day?.ready)
    || requested
    || days[0]
    || null;
}
