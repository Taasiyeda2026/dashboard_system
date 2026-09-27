import { transitionBufferMinutes } from './instructor-matching-engine.js';

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

export const MAX_LOCAL_INSTRUCTOR_CONSTRAINTS = 2;

function weeklyAllows(meeting, rules) {
  const rule = rules.find((item) => Number(item.weekday) === weekday(meeting.date));
  return !!rule?.available && minutes(meeting.start_time) >= minutes(rule.start_time) && minutes(meeting.end_time) <= minutes(rule.end_time);
}

function exceptionBlocksMeeting(meeting, exception) {
  if (!exception) return false;
  return exception.available === false
    || !exception.start_time
    || !exception.end_time
    || minutes(meeting.start_time) < minutes(exception.start_time)
    || minutes(meeting.end_time) > minutes(exception.end_time);
}

function localMeetingConstraint(meeting, { blockedDates, exceptionMap } = {}) {
  if (blockedDates?.has(meeting.date)) return { kind: 'school_calendar', date: meeting.date };
  const exception = exceptionMap?.get(meeting.date);
  if (exception && weeklyAllows(meeting, []) === false) {
    // The weekly rule is checked separately by the hard availability gate.
    // A date-specific exception remains the only local instructor constraint.
  }
  if (exception && exceptionBlocksMeeting(meeting, exception)) {
    return { kind: 'instructor_exception', date: meeting.date };
  }
  return null;
}

function candidateMeetingAllowed(meeting, { rules, exceptionMap, blockedDates, allowSaturday } = {}) {
  if (weekday(meeting.date) === 6 && !allowSaturday) return false;
  if (blockedDates.has(meeting.date)) return false;
  if (!weeklyAllows(meeting, rules)) return false;
  return !exceptionBlocksMeeting(meeting, exceptionMap.get(meeting.date));
}

export function proposeDateAdjustments({ meetings = [], rules = [], exceptions = [], schoolCalendar = [], existingActivities = [], transitions = {}, halfEnd = '', allowSaturday = false } = {}) {
  const exceptionMap = new Map(exceptions.map((row) => [text(row.exception_date), row]));
  const blockedDates = blockedSchoolDates(schoolCalendar);
  // Apply enforce_end_time caps from the school calendar to every meeting's end_time
  // so that availability, overlap, and travel checks all use the effective shortened time.
  const ordered = meetings.map((meeting, index) => {
    const date = text(meeting.date);
    return {
      ...meeting,
      date,
      meeting_no: Number(meeting?.meeting_no) || index + 1,
      end_time: effectiveEndTime(date, meeting.end_time, schoolCalendar)
    };
  });
  const hasEndTimeCap = ordered.some((m, i) => m.end_time !== String(meetings[i]?.end_time || ''));
  const constraints = ordered
    .map((meeting) => ({ meeting, constraint: localMeetingConstraint(meeting, { blockedDates, exceptionMap }) }))
    .filter((item) => item.constraint);
  const instructorConstraintCount = constraints.filter((item) => item.constraint.kind === 'instructor_exception').length;

  if (!constraints.length && !hasEndTimeCap) return null;

  // More than two date-specific instructor constraints means the instructor is
  // not a suitable fixed instructor for the series. The caller must try a
  // different fixed instructor before considering recruitment.
  if (instructorConstraintCount > MAX_LOCAL_INSTRUCTOR_CONSTRAINTS) {
    return {
      valid: false,
      reason: 'too_many_instructor_exceptions',
      blockedMeetings: constraints.map(({ meeting, constraint }) => ({
        ...meeting,
        original_date: meeting.date,
        constraintKind: constraint.kind
      })),
      meetings: []
    };
  }

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
        const gap = direction === 'previous'
          ? minutes(meeting.start_time) - minutes(neighbor.end_time)
          : minutes(neighbor.start_time) - minutes(meeting.end_time);
        // Route durations are raw travel times. Nearby schools (<=10 km) use a
        // 10-minute buffer; all longer verified routes use 15.
        if (gap < Number(neighbor.duration_minutes) + transitionBufferMinutes(neighbor.distance_km)) {
          return { valid: false, reason: 'transition_insufficient', meetings: proposed };
        }
      }
    }
    return null;
  };

  // When only enforce_end_time caps apply (no date needs moving), return a capped result
  // without triggering any date movement.
  if (!constraints.length) {
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
      blockedMeetings: [],
      movedCount: 0,
      instructorConstraintCount: 0,
      newEndDate,
      exceedsHalf: !!halfEnd && newEndDate > halfEnd
    };
  }

  const blockedKeys = new Set(constraints.map(({ meeting }) => `${meeting.meeting_no}|${meeting.date}`));
  const blockedMeetings = constraints.map(({ meeting, constraint }) => ({
    ...meeting,
    original_date: meeting.date,
    constraintKind: constraint.kind
  }));
  const proposed = ordered
    .filter((meeting) => !blockedKeys.has(`${meeting.meeting_no}|${meeting.date}`))
    .map((meeting) => ({ ...meeting, original_date: meeting.date, moved: false }));

  // A local constraint removes only that meeting from its original week. The
  // remaining series stays untouched; recovery meetings are appended after the
  // original end date, one week at a time.
  let appendAfter = ordered.map((meeting) => meeting.date).filter(Boolean).sort().at(-1) || '';
  for (const blockedMeeting of blockedMeetings) {
    const nominalEndTime = meetings[(Number(blockedMeeting.meeting_no) || 1) - 1]?.end_time || blockedMeeting.end_time;
    let candidate = addDays(appendAfter || blockedMeeting.date, 7);
    let guard = 0;
    let appended = null;
    while (guard++ < 5200) {
      const candidateEndTime = effectiveEndTime(candidate, nominalEndTime, schoolCalendar);
      const row = {
        ...blockedMeeting,
        date: candidate,
        end_time: candidateEndTime,
        original_date: blockedMeeting.original_date,
        moved: true
      };
      if (candidateMeetingAllowed(row, { rules, exceptionMap, blockedDates, allowSaturday })) {
        appended = row;
        break;
      }
      candidate = addDays(candidate, 7);
    }
    if (!appended) return { valid: false, reason: 'adjustment_search_exhausted', meetings: [] };
    proposed.push(appended);
    appendAfter = appended.date;
  }

  proposed.sort((a, b) => a.date.localeCompare(b.date) || minutes(a.start_time) - minutes(b.start_time));
  proposed.forEach((meeting, index) => { meeting.meeting_no = index + 1; });

  const err = validateProposed(proposed);
  if (err) return err;
  const newEndDate = proposed.at(-1)?.date || '';
  return {
    valid: true,
    kind: 'proposed_date_adjustment',
    label: 'מתאים בכפוף להתאמת מועדים',
    reason: instructorConstraintCount
      ? `עד ${MAX_LOCAL_INSTRUCTOR_CONSTRAINTS} חריגי זמינות נקודתיים נשמרים בתוך השיבוץ ומועברים לסוף הסדרה אם אין מחליף`
      : 'מועדים חסומים בלוח בית הספר מועברים לסוף הסדרה',
    meetings: proposed,
    blockedMeetings,
    movedCount: blockedMeetings.length,
    instructorConstraintCount,
    newEndDate,
    exceedsHalf: !!halfEnd && newEndDate > halfEnd
  };
}
