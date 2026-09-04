function activityRowId(activity) {
  return String(activity?.row_id || activity?.id || '').trim();
}

export function plannedActivityDates(activity = {}) {
  const dates = [];
  const add = (value) => {
    const date = String(value?.date || value?.meeting_date || value || '').trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !dates.includes(date)) dates.push(date);
  };
  (activity.meetings || activity.meeting_dates || []).forEach(add);
  for (let index = 1; index <= 35; index += 1) add(activity[`date_${index}`]);
  add(activity.date_1);
  add(activity.start_date);
  return dates.sort();
}

export function attendanceDateWarning(activity, reportDate) {
  if (!activityRowId(activity) || !reportDate) return '';
  const dates = plannedActivityDates(activity);
  if (!dates.length || dates.includes(String(reportDate).slice(0, 10))) return '';
  const formatted = dates.map((date) => date.split('-').reverse().join('.')).join(', ');
  return `⚠️ התאריך שנבחר אינו מופיע במועדי הפעילות בדשבורד.\nמועדי הפעילות הקיימים: ${formatted}.\nניתן להמשיך ולשמור אם הפעילות התקיימה במועד אחר.`;
}
