// Completed activities remain accessible for consent-document administration,
// but are not promoted in the active/planned activities table.
const COMPLETE_STATUSES = new Set(['סגור', 'הסתיים', 'הושלם', 'בוצע', 'completed', 'finished']);

export function photoConsentIsraelToday(now = new Date()) {
  // Compare database DATE values with the civil date of the activity locale,
  // not UTC or the browser's timezone.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const value = (type) => parts.find((p) => p.type === type)?.value || '';
  return [value('year'), value('month'), value('day')].join('-');
}

export function photoConsentActivityCompleted(activity, today) {
  const endDate = String(activity?.end_date || '').trim().slice(0, 10);
  // The calendar end date determines if an activity finished; "closed" status
  // alone must not move an activity with a future end date to the archive.
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return endDate < today;
  const status = String(activity?.status || '').trim().toLocaleLowerCase('he');
  return COMPLETE_STATUSES.has(status);
}

export function splitPhotoConsentActivities(activities = [], today = photoConsentIsraelToday()) {
  const current = [];
  const completed = [];
  for (const activity of activities) {
    (photoConsentActivityCompleted(activity, today) ? completed : current).push(activity);
  }
  // Active list is ordered by earliest start; completed are latest first.
  current.sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')));
  completed.sort((a, b) => String(b.end_date || b.start_date || '').localeCompare(String(a.end_date || a.start_date || '')));
  return { current, completed };
}
