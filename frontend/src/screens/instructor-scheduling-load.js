export function activityMeetings(activity = {}, options = {}) {
  const periodFilter = typeof options.filter === 'function' ? options.filter : null;
  if (Array.isArray(activity.meetings)) {
    const rows = activity.meetings
      .map((meeting) => typeof meeting === 'string'
        ? { date: meeting, start_time: activity.start_time, end_time: activity.end_time }
        : meeting)
      .filter((meeting) => meeting?.date);
    return periodFilter ? rows.filter(periodFilter) : rows;
  }

  const rows = Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
    .filter(Boolean)
    .map((date) => ({ date, start_time: activity.start_time, end_time: activity.end_time }));
  return periodFilter ? rows.filter(periodFilter) : rows;
}

export function isoWeekKey(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return '';
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function projectedWeeklyLoad(existingMeetings = [], activity = {}) {
  const targetMeetings = activityMeetings(activity);
  const targetWeeks = new Set(targetMeetings.map((meeting) => isoWeekKey(meeting.date)).filter(Boolean));
  if (!targetWeeks.size) return 0;

  const counts = new Map([...targetWeeks].map((week) => [week, 0]));
  existingMeetings.forEach((meeting) => {
    const week = isoWeekKey(meeting?.date);
    if (counts.has(week)) counts.set(week, counts.get(week) + 1);
  });
  targetMeetings.forEach((meeting) => {
    const week = isoWeekKey(meeting?.date);
    if (counts.has(week)) counts.set(week, counts.get(week) + 1);
  });

  return Math.max(0, ...counts.values());
}

export function averageWeeklyLoad(loads = {}) {
  const values = Object.values(loads).map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
