const text = (value) => String(value ?? '').slice(0, 10);
const minutes = (value) => { const [h, m] = String(value || '').split(':').map(Number); return h * 60 + m; };
const addDays = (value, days) => { const date = new Date(`${text(value)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const weekday = (value) => new Date(`${text(value)}T12:00:00Z`).getUTCDay();
const overlaps = (a, b) => minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);

export function blockedSchoolDates(rows = []) {
  const dates = new Set();
  for (const row of rows) {
    if (!row?.blocks_scheduling || row?.is_active === false) continue;
    let date = text(row.start_date);
    const end = text(row.end_date || row.start_date);
    let guard = 0;
    while (date && date <= end && guard++ < 400) { dates.add(date); date = addDays(date, 1); }
  }
  return dates;
}

function weeklyAllows(meeting, rules) {
  const rule = rules.find((item) => Number(item.weekday) === weekday(meeting.date));
  return !!rule?.available && minutes(meeting.start_time) >= minutes(rule.start_time) && minutes(meeting.end_time) <= minutes(rule.end_time);
}

export function proposeDateAdjustments({ meetings = [], rules = [], exceptions = [], schoolCalendar = [], existingActivities = [], transitions = {}, halfEnd = '' } = {}) {
  const exceptionMap = new Map(exceptions.map((row) => [text(row.exception_date), row]));
  const blockedDates = blockedSchoolDates(schoolCalendar);
  const ordered = meetings.map((meeting) => ({ ...meeting, date: text(meeting.date) }));
  const firstBlocked = ordered.findIndex((meeting) => {
    const exception = exceptionMap.get(meeting.date);
    return exception?.available === false && weeklyAllows(meeting, rules);
  });
  if (firstBlocked < 0) return null;

  const proposed = [];
  let previousDate = '';
  for (let index = 0; index < ordered.length; index += 1) {
    const original = ordered[index];
    if (index < firstBlocked) { proposed.push({ ...original, original_date: original.date, moved: false }); previousDate = original.date; continue; }
    let candidate = addDays(original.date, 7);
    if (previousDate && candidate <= previousDate) candidate = addDays(previousDate, 7);
    let guard = 0;
    while (guard++ < 5200) {
      const row = { ...original, date: candidate };
      const exception = exceptionMap.get(candidate);
      if (weekday(candidate) !== 6 && !blockedDates.has(candidate) && weeklyAllows(row, rules)
        && !(exception && (!exception.available || minutes(row.start_time) < minutes(exception.start_time) || minutes(row.end_time) > minutes(exception.end_time)))) break;
      candidate = addDays(candidate, 7);
    }
    if (guard >= 5200) return { valid: false, reason: 'adjustment_search_exhausted', meetings: [] };
    proposed.push({ ...original, original_date: original.date, date: candidate, moved: candidate !== original.date });
    previousDate = candidate;
  }

  for (const meeting of proposed) {
    const sameDay = existingActivities.filter((row) => text(row.date) === meeting.date);
    if (sameDay.some((row) => overlaps(meeting, row))) return { valid: false, reason: 'proposed_overlap', meetings: proposed };
    const transition = transitions[meeting.date] || {};
    for (const [direction, neighbor] of [['previous', transition.previous], ['next', transition.next]]) {
      if (!neighbor) continue;
      if (neighbor.duration_minutes == null) return { valid: false, reason: 'transition_unverified', meetings: proposed };
      const gap = direction === 'previous' ? minutes(meeting.start_time) - minutes(neighbor.end_time) : minutes(neighbor.start_time) - minutes(meeting.end_time);
      if (gap < Number(neighbor.duration_minutes) + 15) return { valid: false, reason: 'transition_insufficient', meetings: proposed };
    }
  }
  const newEndDate = proposed.at(-1)?.date || '';
  return {
    valid: true,
    kind: 'proposed_date_adjustment',
    label: 'מתאים בכפוף להתאמת מועדים',
    reason: 'חריג זמינות נקודתי מחייב הזזת מפגשים',
    meetings: proposed,
    movedCount: proposed.filter((row) => row.moved).length,
    newEndDate,
    exceedsHalf: !!halfEnd && newEndDate > halfEnd
  };
}
