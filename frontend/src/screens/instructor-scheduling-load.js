export function activityMeetings(activity = {}, options = {}) {
  const periodFilter = typeof options.filter === 'function' ? options.filter : null;
  const cancelled = activity?.cancelled_meeting_dates || activity?._cancelledMeetingDates || options.cancelledDates;
  const cancelledSet = cancelled
    ? (cancelled instanceof Set ? cancelled : new Set([...(cancelled || [])].map((value) => String(value ?? '').trim().slice(0, 10))))
    : null;
  const notCancelled = (meeting) => {
    if (!cancelledSet?.size) return true;
    return !cancelledSet.has(String(meeting?.date ?? '').trim().slice(0, 10));
  };
  if (Array.isArray(activity.meetings)) {
    const rows = activity.meetings
      .map((meeting) => typeof meeting === 'string'
        ? { date: meeting, start_time: activity.start_time, end_time: activity.end_time }
        : meeting)
      .filter((meeting) => meeting?.date)
      .filter(notCancelled);
    return periodFilter ? rows.filter(periodFilter) : rows;
  }

  const rows = Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
    .filter(Boolean)
    .map((date) => ({ date, start_time: activity.start_time, end_time: activity.end_time }))
    .filter(notCancelled);
  return periodFilter ? rows.filter(periodFilter) : rows;
}

/** Calendar source for a course: proposed draft dates when present, else official meetings. */
export function schedulingCalendarMeetings(activity = {}, options = {}) {
  const draftEmp = String(activity?.draft_emp_id ?? '').trim();
  const proposed = Array.isArray(activity?.draft_proposed_meetings) ? activity.draft_proposed_meetings : null;
  if (draftEmp && proposed?.length) {
    return activityMeetings({ ...activity, meetings: proposed }, options);
  }
  return activityMeetings(activity, options);
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
