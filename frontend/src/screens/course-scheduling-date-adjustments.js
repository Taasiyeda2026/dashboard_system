import { MAX_TRANSITION_DISTANCE_KM, TRANSITION_BUFFER_MINUTES } from './instructor-matching-engine.js';

const text = (value) => String(value ?? '').slice(0, 10);
const minutes = (value) => { const [h, m] = String(value || '').split(':').map(Number); return h * 60 + m; };
const addDays = (value, days) => { const date = new Date(`${text(value)}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const weekday = (value) => new Date(`${text(value)}T12:00:00Z`).getUTCDay();
const overlaps = (a, b) => minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);

/**
 * Returns the effective end_time for a meeting on `date`, capped by the earliest
 * enforce_end_time school-calendar event covering that date (shortened school day).
 * Returns `originalEndTime` unchanged when no cap applies.
 */
export function effectiveEndTime(date, originalEndTime, schoolCalendar) {
  let cap = null;
  let capMinutes = null;
  for (const row of schoolCalendar) {
    if (!row.enforce_end_time || !row.school_day_end_time || row.is_active === false) continue;
    const start = String(row.start_date || '').slice(0, 10);
    const end = String(row.end_date || row.start_date || '').slice(0, 10);
    if (!start || date < start || date > end) continue;
    const rowCapMinutes = minutes(row.school_day_end_time);
    if (!Number.isFinite(rowCapMinutes)) continue;
    if (cap === null || rowCapMinutes < capMinutes) {
      cap = row.school_day_end_time;
      capMinutes = rowCapMinutes;
    }
  }
  const originalMinutes = minutes(originalEndTime);
  return (cap && Number.isFinite(originalMinutes) && capMinutes < originalMinutes) ? cap : originalEndTime;
}

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
  // Apply enforce_end_time caps from the school calendar to every meeting's end_time
  // so that availability, overlap, and travel checks all use the effective shortened time.
  const ordered = meetings.map((meeting) => {
    const date = text(meeting.date);
    return { ...meeting, date, end_time: effectiveEndTime(date, meeting.end_time, schoolCalendar) };
  });
  const hasEndTimeCap = ordered.some((m, i) => m.end_time !== String(meetings[i]?.end_time || ''));
  const firstBlocked = ordered.findIndex((meeting) => {
    if (blockedDates.has(meeting.date)) return true;
    const exception = exceptionMap.get(meeting.date);
    if (!exception || !weeklyAllows(meeting, rules)) return false;
    return exception.available === false
      || !exception.start_time || !exception.end_time
      || minutes(meeting.start_time) < minutes(exception.start_time)
      || minutes(meeting.end_time) > minutes(exception.end_time);
  });
  if (firstBlocked < 0 && !hasEndTimeCap) return null;

  // Shared validation: check proposed meetings against existing activities and transitions.
  const validateProposed = (proposed) => {
    for (const meeting of proposed) {
      const sameDay = existingActivities.filter((row) => text(row.date) === meeting.date);
      if (sameDay.some((row) => overlaps(meeting, row))) return { valid: false, reason: 'proposed_overlap', meetings: proposed };
      const transition = transitions[meeting.date] || {};
      for (const [direction, neighbor] of [['previous', transition.previous], ['next', transition.next]]) {
        if (!neighbor) continue;
        if (neighbor.duration_minutes == null || neighbor.distance_km == null
          || !Number.isFinite(Number(neighbor.duration_minutes)) || !Number.isFinite(Number(neighbor.distance_km))) {
          return { valid: false, reason: 'transition_unverified', meetings: proposed };
        }
        if (Number(neighbor.distance_km) > MAX_TRANSITION_DISTANCE_KM) {
          return { valid: false, reason: 'transition_distance_exceeded', meetings: proposed };
        }
        const gap = direction === 'previous' ? minutes(meeting.start_time) - minutes(neighbor.end_time) : minutes(neighbor.start_time) - minutes(meeting.end_time);
        // Route durations are raw travel times. TRANSITION_BUFFER_MINUTES is the sole safety-buffer source.
        if (gap < Number(neighbor.duration_minutes) + TRANSITION_BUFFER_MINUTES) return { valid: false, reason: 'transition_insufficient', meetings: proposed };
      }
    }
    return null;
  };

  // When only enforce_end_time caps apply (no date needs moving), return a capped result
  // without triggering the date-shift loop.
  if (firstBlocked < 0) {
    const proposed = ordered.map((m) => ({ ...m, original_date: m.date, moved: false }));
    const err = validateProposed(proposed);
    if (err) return err;
    const newEndDate = proposed.at(-1)?.date || '';
    return {
      valid: true,
      kind: 'enforce_end_time',
      label: 'מתאים בכפוף לשעת סיום יום הלימודים',
      reason: 'שעת הסיום מוגבלת לפי לוח השנה הבית-ספרי',
      meetings: proposed,
      movedCount: 0,
      newEndDate,
      exceedsHalf: !!halfEnd && newEndDate > halfEnd
    };
  }

  const proposed = [];
  let previousDate = '';
  for (let index = 0; index < ordered.length; index += 1) {
    const original = ordered[index];
    const nominalEndTime = meetings[index]?.end_time || original.end_time;
    if (index < firstBlocked) { proposed.push({ ...original, original_date: original.date, moved: false }); previousDate = original.date; continue; }
    let candidate = addDays(original.date, 7);
    if (previousDate && candidate <= previousDate) candidate = addDays(previousDate, 7);
    let guard = 0;
    while (guard++ < 5200) {
      // Apply a cap for the candidate date from the original uncapped meeting end.
      const candidateEndTime = effectiveEndTime(candidate, nominalEndTime, schoolCalendar);
      const row = { ...original, date: candidate, end_time: candidateEndTime };
      const exception = exceptionMap.get(candidate);
      if (weekday(candidate) !== 6 && !blockedDates.has(candidate) && weeklyAllows(row, rules)
        && !(exception && (!exception.available || minutes(row.start_time) < minutes(exception.start_time) || minutes(row.end_time) > minutes(exception.end_time)))) break;
      candidate = addDays(candidate, 7);
    }
    if (guard >= 5200) return { valid: false, reason: 'adjustment_search_exhausted', meetings: [] };
    const candidateEndTime = effectiveEndTime(candidate, nominalEndTime, schoolCalendar);
    proposed.push({ ...original, original_date: original.date, date: candidate, end_time: candidateEndTime, moved: candidate !== original.date });
    previousDate = candidate;
  }

  const err = validateProposed(proposed);
  if (err) return err;
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
