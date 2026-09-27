import { transitionBufferMinutes } from './instructor-matching-engine.js';

/** Soft instructor exceptions at or below this count stay eligible as the permanent instructor. */
export const MAX_RECOVERABLE_EXCEPTION_MEETINGS = 2;

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

function exceptionBlocksMeeting(meeting, exception) {
  if (!exception) return false;
  return exception.available === false
    || !exception.start_time || !exception.end_time
    || minutes(meeting.start_time) < minutes(exception.start_time)
    || minutes(meeting.end_time) > minutes(exception.end_time);
}

function candidateDateAllowed(row, {
  exceptionMap,
  blockedDates,
  rules,
  allowSaturday = false
} = {}) {
  const date = text(row.date);
  if (weekday(date) === 6 && !allowSaturday) return false;
  if (blockedDates.has(date)) return false;
  if (!weeklyAllows(row, rules)) return false;
  const exception = exceptionMap.get(date);
  if (exception && exceptionBlocksMeeting(row, exception)) return false;
  return true;
}

/**
 * Point instructor-availability exceptions on dates that weekly availability would otherwise cover.
 * School-calendar blocks are separate and do not count toward the soft-exception budget.
 */
export function classifyMeetingAvailabilityBlocks({
  meetings = [],
  rules = [],
  exceptions = [],
  schoolCalendar = []
} = {}) {
  const exceptionMap = new Map(exceptions.map((row) => [text(row.exception_date), row]));
  const blockedDates = blockedSchoolDates(schoolCalendar);
  const instructorExceptionMeetings = [];
  const schoolBlockedMeetings = [];
  for (const meeting of meetings) {
    const date = text(meeting.date);
    const row = { ...meeting, date };
    if (blockedDates.has(date)) {
      schoolBlockedMeetings.push(row);
      continue;
    }
    const exception = exceptionMap.get(date);
    if (exception && weeklyAllows(row, rules) && exceptionBlocksMeeting(row, exception)) {
      instructorExceptionMeetings.push(row);
    }
  }
  return {
    instructorExceptionMeetings,
    schoolBlockedMeetings,
    instructorExceptionCount: instructorExceptionMeetings.length,
    recoverable: instructorExceptionMeetings.length <= MAX_RECOVERABLE_EXCEPTION_MEETINGS
  };
}

function findNextWeeklySlot({
  meeting,
  afterDate,
  rules,
  exceptionMap,
  blockedDates,
  schoolCalendar,
  allowSaturday,
  nominalEndTime
}) {
  let candidate = addDays(afterDate, 7);
  let guard = 0;
  while (guard++ < 5200) {
    const candidateEndTime = effectiveEndTime(candidate, nominalEndTime, schoolCalendar);
    const row = { ...meeting, date: candidate, end_time: candidateEndTime };
    if (candidateDateAllowed(row, { exceptionMap, blockedDates, rules, allowSaturday })) {
      return { date: candidate, end_time: candidateEndTime };
    }
    candidate = addDays(candidate, 7);
  }
  return null;
}

function validateProposedMeetings(proposed, { existingActivities = [], transitions = {} } = {}) {
  for (const meeting of proposed) {
    if (meeting.substituteEmpId) continue;
    const sameDay = existingActivities.filter((row) => text(row.date) === meeting.date);
    if (sameDay.some((row) => overlaps(meeting, row))) {
      return { valid: false, reason: 'proposed_overlap', meetings: proposed };
    }
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
      if (gap < Number(neighbor.duration_minutes) + transitionBufferMinutes(neighbor.distance_km)) {
        return { valid: false, reason: 'transition_insufficient', meetings: proposed };
      }
    }
  }
  return null;
}

/**
 * Keep every unblocked meeting on its original date. Only blocked meetings are
 * removed from their slot and appended after the current series end.
 */
export function proposeDateAdjustments({
  meetings = [],
  rules = [],
  exceptions = [],
  schoolCalendar = [],
  existingActivities = [],
  transitions = {},
  halfEnd = '',
  allowSaturday = false,
  skipDates = [],
  substitutionsByDate = {}
} = {}) {
  const exceptionMap = new Map(exceptions.map((row) => [text(row.exception_date), row]));
  const blockedDates = blockedSchoolDates(schoolCalendar);
  const skip = new Set((skipDates || []).map((date) => text(date)).filter(Boolean));
  const ordered = meetings.map((meeting) => {
    const date = text(meeting.date);
    return { ...meeting, date, end_time: effectiveEndTime(date, meeting.end_time, schoolCalendar) };
  });
  const hasEndTimeCap = ordered.some((m, i) => m.end_time !== String(meetings[i]?.end_time || ''));

  const blockedIndexes = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const meeting = ordered[index];
    if (skip.has(meeting.date) || substitutionsByDate[meeting.date]) continue;
    if (blockedDates.has(meeting.date)) {
      blockedIndexes.push(index);
      continue;
    }
    const exception = exceptionMap.get(meeting.date);
    if (exception && weeklyAllows(meeting, rules) && exceptionBlocksMeeting(meeting, exception)) {
      blockedIndexes.push(index);
    }
  }

  if (!blockedIndexes.length && !hasEndTimeCap) {
    const hasSubstitutions = Object.keys(substitutionsByDate || {}).length > 0;
    if (!hasSubstitutions) return null;
  }

  if (!blockedIndexes.length) {
    const proposed = ordered.map((m) => {
      const sub = substitutionsByDate[m.date];
      return {
        ...m,
        original_date: m.original_date || m.date,
        moved: false,
        ...(sub ? {
          substituteEmpId: text(sub.empId || sub.substituteEmpId),
          substituteName: String(sub.name || sub.substituteName || ''),
          constraintKind: sub.constraintKind || 'instructor_exception'
        } : {})
      };
    });
    const err = validateProposedMeetings(proposed, { existingActivities, transitions });
    if (err) return err;
    const newEndDate = proposed.at(-1)?.date || '';
    return {
      valid: true,
      kind: Object.keys(substitutionsByDate || {}).length ? 'single_meeting_substitution' : 'enforce_end_time',
      label: Object.keys(substitutionsByDate || {}).length
        ? 'מתאים בכפוף למחליף חד־פעמי'
        : 'מתאים בכפוף לשעת סיום יום הלימודים',
      reason: Object.keys(substitutionsByDate || {}).length
        ? 'חריג זמינות נקודתי מכוסה במדריך מחליף חד־פעמי'
        : 'שעת הסיום מוגבלת לפי לוח השנה הבית-ספרי',
      meetings: proposed,
      movedCount: 0,
      newEndDate,
      exceedsHalf: !!halfEnd && newEndDate > halfEnd,
      singleMeetingSubstitutions: Object.entries(substitutionsByDate).map(([date, sub]) => ({
        meetingDate: date,
        substituteEmpId: text(sub.empId || sub.substituteEmpId),
        substituteName: String(sub.name || sub.substituteName || ''),
        constraintKind: sub.constraintKind || 'instructor_exception'
      }))
    };
  }

  const kept = [];
  const toAppend = [];
  for (let index = 0; index < ordered.length; index += 1) {
    const original = ordered[index];
    const nominalEndTime = meetings[index]?.end_time || original.end_time;
    const sub = substitutionsByDate[original.date];
    if (sub) {
      kept.push({
        ...original,
        original_date: original.original_date || original.date,
        moved: false,
        substituteEmpId: text(sub.empId || sub.substituteEmpId),
        substituteName: String(sub.name || sub.substituteName || ''),
        constraintKind: sub.constraintKind || 'instructor_exception'
      });
      continue;
    }
    if (blockedIndexes.includes(index)) {
      toAppend.push({
        meeting: original,
        nominalEndTime,
        constraintKind: blockedDates.has(original.date) ? 'school_calendar' : 'instructor_exception'
      });
      continue;
    }
    kept.push({ ...original, original_date: original.original_date || original.date, moved: false });
  }

  let seriesEnd = kept.reduce((latest, row) => (!latest || row.date > latest ? row.date : latest), '');
  const appended = [];
  for (const item of toAppend) {
    const anchor = seriesEnd || item.meeting.date;
    const slot = findNextWeeklySlot({
      meeting: item.meeting,
      afterDate: anchor,
      rules,
      exceptionMap,
      blockedDates,
      schoolCalendar,
      allowSaturday,
      nominalEndTime: item.nominalEndTime
    });
    if (!slot) return { valid: false, reason: 'adjustment_search_exhausted', meetings: [] };
    const row = {
      ...item.meeting,
      original_date: item.meeting.date,
      date: slot.date,
      end_time: slot.end_time,
      moved: true,
      constraintKind: item.constraintKind
    };
    appended.push(row);
    seriesEnd = slot.date;
  }

  const proposed = [...kept, ...appended];
  const err = validateProposedMeetings(proposed, { existingActivities, transitions });
  if (err) return err;
  const newEndDate = proposed.at(-1)?.date || '';
  const substitutions = Object.entries(substitutionsByDate).map(([date, sub]) => ({
    meetingDate: date,
    substituteEmpId: text(sub.empId || sub.substituteEmpId),
    substituteName: String(sub.name || sub.substituteName || ''),
    constraintKind: sub.constraintKind || 'instructor_exception'
  }));
  return {
    valid: true,
    kind: substitutions.length ? 'recovery_with_substitution_and_append' : 'proposed_date_adjustment',
    label: substitutions.length
      ? 'מתאים בכפוף למחליף חד־פעמי ו/או התאמת מועדים'
      : 'מתאים בכפוף להתאמת מועדים',
    reason: substitutions.length
      ? 'חריג זמינות נקודתי מכוסה במחליף או בהוספת מפגש בסוף הסדרה'
      : 'חריג זמינות נקודתי מחייב הזזת מפגשים חסומים בלבד לסוף הסדרה',
    meetings: proposed,
    movedCount: proposed.filter((row) => row.moved).length,
    newEndDate,
    exceedsHalf: !!halfEnd && newEndDate > halfEnd,
    singleMeetingSubstitutions: substitutions
  };
}

/**
 * Resolve 1–2 instructor exception meetings: prefer a one-off substitute on the
 * original date; otherwise append only that meeting to the end of the series.
 */
export function buildExceptionRecoveryPlan({
  meetings = [],
  rules = [],
  exceptions = [],
  schoolCalendar = [],
  existingActivities = [],
  transitions = {},
  halfEnd = '',
  allowSaturday = false,
  findSubstitute = null
} = {}) {
  const classification = classifyMeetingAvailabilityBlocks({
    meetings,
    rules,
    exceptions,
    schoolCalendar
  });
  if (classification.instructorExceptionCount > MAX_RECOVERABLE_EXCEPTION_MEETINGS) {
    return {
      valid: false,
      reason: 'too_many_availability_exceptions',
      eligibleAsPermanent: false,
      instructorExceptionCount: classification.instructorExceptionCount,
      meetings: [],
      singleMeetingSubstitutions: []
    };
  }

  const substitutionsByDate = {};
  const resolvedBySubstitute = [];
  for (const meeting of classification.instructorExceptionMeetings) {
    const substitute = typeof findSubstitute === 'function' ? findSubstitute(meeting) : null;
    if (substitute?.empId || substitute?.substituteEmpId) {
      const empId = text(substitute.empId || substitute.substituteEmpId);
      substitutionsByDate[text(meeting.date)] = {
        empId,
        name: String(substitute.name || substitute.substituteName || ''),
        constraintKind: 'instructor_exception'
      };
      resolvedBySubstitute.push(text(meeting.date));
    }
  }

  const adjustment = proposeDateAdjustments({
    meetings,
    rules,
    exceptions,
    schoolCalendar,
    existingActivities,
    transitions,
    halfEnd,
    allowSaturday,
    substitutionsByDate
  });

  if (!adjustment) {
    return {
      valid: true,
      eligibleAsPermanent: true,
      instructorExceptionCount: classification.instructorExceptionCount,
      meetings: meetings.map((meeting) => ({
        ...meeting,
        date: text(meeting.date),
        original_date: text(meeting.date),
        moved: false
      })),
      movedCount: 0,
      singleMeetingSubstitutions: [],
      kind: 'none'
    };
  }

  return {
    ...adjustment,
    eligibleAsPermanent: !!adjustment.valid,
    instructorExceptionCount: classification.instructorExceptionCount,
    resolvedBySubstitute
  };
}

export function meetingInstructorEmpId(meeting = {}, mainInstructorEmpId = '') {
  return text(meeting?.substituteEmpId) || text(mainInstructorEmpId);
}

/**
 * Final gate used before locking/saving a planning option: every meeting must
 * be valid for the instructor who actually teaches it that day.
 */
export function validatePlanningMeetingsForInstructors({
  meetings = [],
  mainInstructorEmpId = '',
  instructorContexts = {},
  activity = {},
  schoolCalendar = [],
  allowSaturday = false
} = {}) {
  const blockedDates = blockedSchoolDates(schoolCalendar);
  const failures = [];
  for (const meeting of meetings) {
    const date = text(meeting?.date);
    const empId = meetingInstructorEmpId(meeting, mainInstructorEmpId);
    if (!empId) {
      failures.push({ date, reason: 'missing_instructor' });
      continue;
    }
    if (blockedDates.has(date)) {
      failures.push({ date, empId, reason: 'school_calendar_blocked' });
      continue;
    }
    if (weekday(date) === 6 && !allowSaturday) {
      failures.push({ date, empId, reason: 'saturday_blocked' });
      continue;
    }
    const context = instructorContexts[empId] || {};
    if (String(context.instructor?.active ?? 'yes').toLowerCase() === 'no' || context.instructor?.active === false) {
      failures.push({ date, empId, reason: 'inactive' });
      continue;
    }
    const row = {
      date,
      start_time: String(meeting.start_time || activity.start_time || '').slice(0, 5),
      end_time: String(meeting.end_time || activity.end_time || '').slice(0, 5)
    };
    const rules = context.rules || [];
    const exceptions = context.exceptions || [];
    const exceptionMap = new Map(exceptions.map((item) => [text(item.exception_date), item]));
    const exception = exceptionMap.get(date);
    if (exception) {
      if (exceptionBlocksMeeting(row, exception)) {
        failures.push({ date, empId, reason: 'availability_exception' });
        continue;
      }
    } else if (!weeklyAllows(row, rules)) {
      failures.push({ date, empId, reason: 'weekly_unavailable' });
      continue;
    }
    const existing = context.existingActivities || [];
    if (existing.some((other) => text(other.date) === date && overlaps(row, other))) {
      failures.push({ date, empId, reason: 'overlap' });
    }
  }
  return {
    valid: failures.length === 0,
    failures
  };
}

export function liveAvailabilityConflicts({
  meetings = [],
  rules = [],
  exceptions = [],
  schoolCalendar = []
} = {}) {
  const exceptionMap = new Map(exceptions.map((row) => [text(row.exception_date), row]));
  const blockedDates = blockedSchoolDates(schoolCalendar);
  const dates = [];
  for (const meeting of meetings) {
    const date = text(meeting.date);
    const row = {
      date,
      start_time: String(meeting.start_time || '').slice(0, 5),
      end_time: String(meeting.end_time || '').slice(0, 5)
    };
    if (blockedDates.has(date)) continue;
    const exception = exceptionMap.get(date);
    if (exception) {
      if (exceptionBlocksMeeting(row, exception)) dates.push(date);
      continue;
    }
    if (!weeklyAllows(row, rules)) dates.push(date);
  }
  return {
    liveAvailabilityConflictCount: dates.length,
    liveAvailabilityConflictDates: [...new Set(dates)].sort()
  };
}
