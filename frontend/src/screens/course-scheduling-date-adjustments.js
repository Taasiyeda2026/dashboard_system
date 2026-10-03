import { exceedsTransitionDistanceLimit, transitionBufferMinutes } from './instructor-matching-engine.js';
import { filterSchoolCalendarRowsBySector } from './shared/school-calendar-logic.js';
import { isFullDaySchedulingActivity } from './shared/activity-scheduling-eligibility.js';

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

function validateProposedMeetings(proposed, {
  existingActivities = [],
  transitions = {},
  fullDayBlocking = false
} = {}) {
  for (const meeting of proposed) {
    if (meeting.substituteEmpId) continue;
    const sameDay = existingActivities.filter((row) => text(row.date) === meeting.date);
    const fullDayConflict = sameDay.some((row) =>
      row?.full_day_blocking === true || isFullDaySchedulingActivity(row)
    );
    if ((fullDayBlocking && sameDay.length) || fullDayConflict) {
      return { valid: false, reason: 'proposed_full_day_tour_conflict', meetings: proposed };
    }
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
      if (exceedsTransitionDistanceLimit(neighbor.distance_km)) {
        return { valid: false, reason: 'transition_distance_exceeded', meetings: proposed };
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
  substitutionsByDate = {},
  fullDayBlocking = false
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
    const err = validateProposedMeetings(proposed, { existingActivities, transitions, fullDayBlocking });
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
  findSubstitute = null,
  fullDayBlocking = false
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
    substitutionsByDate,
    fullDayBlocking
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

const fullText = (value) => String(value ?? '').trim();

function asEmpMap(source = {}) {
  if (!source) return {};
  if (Array.isArray(source)) {
    const map = {};
    for (const row of source) {
      const empId = fullText(row?.emp_id);
      if (!empId) continue;
      const bucket = map[empId] || [];
      bucket.push(row);
      map[empId] = bucket;
    }
    return map;
  }
  if (typeof source === 'object') return source;
  return {};
}

function asProfileMap(source = {}) {
  if (!source) return {};
  if (Array.isArray(source)) {
    const map = {};
    for (const row of source) {
      const empId = fullText(row?.emp_id);
      if (!empId) continue;
      map[empId] = row;
    }
    return map;
  }
  if (typeof source === 'object') return source;
  return {};
}

function officialStoredDateCount(activity = {}) {
  let count = 0;
  for (let index = 1; index <= 35; index += 1) {
    if (fullText(activity?.[`date_${index}`]).slice(0, 10)) count += 1;
  }
  return count;
}

/** Expected meeting count from sessions and/or stored date_1..date_n. */
export function expectedPlanningMeetingCount(activity = {}) {
  const sessions = Number(activity?.sessions);
  const sessionCount = Number.isFinite(sessions) && sessions > 0 ? Math.min(35, Math.floor(sessions)) : 0;
  const dateCount = officialStoredDateCount(activity);
  if (sessionCount > 0 && dateCount > 0 && sessionCount !== dateCount) {
    return { expected: sessionCount, dateCount, mismatch: true, reason: 'sessions_vs_dates' };
  }
  if (sessionCount > 0) return { expected: sessionCount, dateCount, mismatch: false, reason: '' };
  if (dateCount > 0) return { expected: dateCount, dateCount, mismatch: false, reason: '' };
  return { expected: 0, dateCount: 0, mismatch: false, reason: '' };
}

function normalizeGenderGate(value) {
  const raw = fullText(value).toLocaleLowerCase('he-IL');
  if (['female', 'f', 'נקבה', 'מדריכה'].includes(raw)) return 'female';
  if (['male', 'm', 'זכר', 'מדריך'].includes(raw)) return 'male';
  return 'any';
}

function normalizeLanguageGate(value) {
  const raw = fullText(value).toLocaleLowerCase('he-IL');
  if (!raw) return '';
  if (raw.includes('ערב') || raw === 'ar' || raw === 'arabic') return 'ar';
  if (raw.includes('עבר') || raw === 'he' || raw === 'hebrew') return 'he';
  return raw;
}

function planningRowProposalOption(entry = {}) {
  if (entry?.lockedOption && typeof entry.lockedOption === 'object') return entry.lockedOption;
  const row = entry?.row && typeof entry.row === 'object' ? entry.row : entry;
  if (!row || typeof row !== 'object') return null;
  const kind = fullText(row.kind || row.status);
  const hasProposalShape = !!fullText(row.instructorEmpId)
    && Array.isArray(row.meetings)
    && row.meetings.length > 0;
  if (!hasProposalShape) return null;
  if (
    row.planningLocked
    || ['proposal', 'fixed-proposal', 'planning-locked', 'draft', 'locked', 'נקבע בתכנון'].includes(kind)
    || /proposal|locked|draft|fixed/i.test(kind)
  ) {
    return {
      instructorEmpId: row.instructorEmpId,
      instructorName: row.instructorName,
      meetings: row.meetings,
      startDate: row.startDate,
      endDate: row.endDate,
      startTime: row.startTime,
      endTime: row.endTime,
      singleMeetingSubstitutions: row.singleMeetingSubstitutions
    };
  }
  return null;
}

/**
 * Lightweight hard-gate audit for one stored planning option against live data.
 * Does not run the full planning engine.
 */
export function auditPlanningOptionHardGates(option = {}, {
  activity = {},
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  assignments = {}
} = {}) {
  const failures = [];
  const mainEmpId = fullText(option?.instructorEmpId);
  const meetings = Array.isArray(option?.meetings) ? option.meetings : [];
  if (!mainEmpId || !meetings.length) {
    return { valid: false, failures: [{ reason: 'missing_option' }] };
  }

  const meetingCountInfo = expectedPlanningMeetingCount(activity);
  if (meetingCountInfo.mismatch) {
    failures.push({ reason: 'meeting_count_mismatch', detail: meetingCountInfo });
  } else if (meetingCountInfo.expected > 0 && meetings.length !== meetingCountInfo.expected) {
    failures.push({
      reason: 'meeting_count_mismatch',
      detail: { expected: meetingCountInfo.expected, planned: meetings.length }
    });
  }

  const instructorById = new Map((instructors || []).map((row) => [fullText(row.emp_id), row]));
  const profileMap = asProfileMap(profiles);
  const ruleMap = asEmpMap(rules);
  const exceptionMap = asEmpMap(exceptions);
  const requiredGender = normalizeGenderGate(activity?.required_instructor_gender);
  const requiredLanguage = normalizeLanguageGate(activity?.instruction_language);
  const profile = profileMap[mainEmpId] || {};
  const mainInstructor = instructorById.get(mainEmpId);

  if (mainInstructor && (String(mainInstructor.active ?? 'yes').toLowerCase() === 'no' || mainInstructor.active === false)) {
    failures.push({ reason: 'inactive', empId: mainEmpId });
  }
  if (requiredGender !== 'any' && normalizeGenderGate(profile?.gender) !== requiredGender) {
    failures.push({ reason: 'gender_mismatch', empId: mainEmpId });
  }
  if (requiredLanguage) {
    const languages = (profile?.instruction_languages || [])
      .map((value) => normalizeLanguageGate(value))
      .filter(Boolean);
    if (!languages.includes(requiredLanguage)) {
      failures.push({ reason: 'language_mismatch', empId: mainEmpId });
    }
  }

  const instructorContexts = {};
  for (const meeting of meetings) {
    const empId = meetingInstructorEmpId(meeting, mainEmpId);
    if (!empId || instructorContexts[empId]) continue;
    instructorContexts[empId] = {
      instructor: instructorById.get(empId) || { emp_id: empId, active: 'yes' },
      rules: ruleMap[empId] || [],
      exceptions: exceptionMap[empId] || [],
      existingActivities: Array.isArray(assignments[empId])
        ? assignments[empId].filter((row) => row && row.date)
        : [],
      profile: profileMap[empId] || null
    };
  }

  // Match the planning engine: only this activity's sector (+ general) can block dates.
  const sectorCalendar = filterSchoolCalendarRowsBySector(
    schoolCalendar,
    activity?.calendar_sector
  );
  const meetingValidation = validatePlanningMeetingsForInstructors({
    meetings,
    mainInstructorEmpId: mainEmpId,
    instructorContexts,
    activity,
    schoolCalendar: sectorCalendar,
    allowSaturday: String(activity?.calendar_sector || '').toLowerCase() === 'arab'
  });
  failures.push(...(meetingValidation.failures || []));

  return {
    valid: failures.length === 0,
    failures
  };
}

/**
 * Audit stored shared-planning rows. Marks conceptual invalidity only; caller
 * decides whether to persist needs_recalc.
 */
export function auditStoredPlanningHardGates({
  shared = {},
  activities = [],
  instructors = [],
  profiles = {},
  rules = {},
  exceptions = {},
  schoolCalendar = [],
  assignments = {}
} = {}) {
  const activityById = new Map((activities || []).map((activity) => [
    fullText(activity?.row_id || activity?.RowID || activity?.id),
    activity
  ]));
  const invalidActivityIds = [];
  const reasonsByActivityId = {};

  for (const entry of shared?.rows || []) {
    const activityId = fullText(entry?.activityId || entry?.row?.courseId);
    if (!activityId) continue;
    const option = planningRowProposalOption(entry);
    if (!option) continue;
    const activity = activityById.get(activityId) || {};
    const result = auditPlanningOptionHardGates(option, {
      activity,
      instructors,
      profiles,
      rules,
      exceptions,
      schoolCalendar,
      assignments
    });
    if (!result.valid) {
      invalidActivityIds.push(activityId);
      reasonsByActivityId[activityId] = result.failures;
    }
  }

  return {
    invalidActivityIds: [...new Set(invalidActivityIds)],
    hardGateInvalidCount: [...new Set(invalidActivityIds)].length,
    reasonsByActivityId
  };
}
