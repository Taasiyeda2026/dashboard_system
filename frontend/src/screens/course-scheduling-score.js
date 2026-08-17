/** Transparent, lexicographic instructor ranking metrics (no points or score out of 100). */

const text = (value) => String(value ?? '').trim();
const dayKey = (value) => text(value).slice(0, 10);
const minutesOf = (value) => {
  const [hours, minutes] = text(value || '00:00').split(':').map(Number);
  return hours * 60 + minutes;
};

export function formatWorkloadHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  return `${(Math.round(number * 100) / 100).toFixed(2).replace(/\.?0+$/, '')} שעות`;
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${dayKey(fromDate)}T12:00:00Z`);
  const to = Date.parse(`${dayKey(toDate)}T12:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

export function courseUrgency(course = {}, referenceDate = null) {
  const reference = dayKey(referenceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference)) return { nextUpcomingMeetingDate: null, urgencyBand: 'none', daysUntilNextMeeting: null, urgencyRank: 4, reason: 'missing_reference_date' };
  const meetings = Array.isArray(course.meetings) && course.meetings.length
    ? course.meetings.map((meeting) => typeof meeting === 'string' ? meeting : meeting?.date).filter(Boolean)
    : Array.from({ length: 35 }, (_, index) => course[`date_${index + 1}`]).filter(Boolean);
  const upcoming = meetings.map(dayKey).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= reference).sort();
  if (!upcoming.length) return { nextUpcomingMeetingDate: null, urgencyBand: 'none', daysUntilNextMeeting: null, urgencyRank: 4, reason: 'no_upcoming_meeting' };
  const daysUntilNextMeeting = daysBetween(reference, upcoming[0]);
  const urgencyRank = daysUntilNextMeeting <= 7 ? 1 : daysUntilNextMeeting <= 14 ? 2 : 3;
  return { nextUpcomingMeetingDate: upcoming[0], urgencyBand: urgencyRank === 1 ? 'within_7' : urgencyRank === 2 ? 'within_14' : 'later', daysUntilNextMeeting, urgencyRank, reason: '' };
}

function sameSchool(first = {}, second = {}) {
  const a = text(first.school_id);
  const b = text(second.school_id);
  return a && b ? a === b : !!text(first.school) && text(first.school).toLocaleLowerCase('he-IL') === text(second.school).toLocaleLowerCase('he-IL');
}

/** Classifies every meeting and totals the actual added route legs across the whole course. */
export function analyzeDayPlacement({ activity = {}, meetings = [], existingActivities = [], travel = null, workDates = new Set() } = {}) {
  const baselineDates = workDates instanceof Set ? workDates : new Set(workDates || []);
  const result = {
    sameSchoolMeetingCount: 0, nearbyMeetingCount: 0, existingWorkDayMeetingCount: 0,
    newWorkDayMeetingCount: 0, continuityMeetingCount: meetings.length,
    totalTravelMinutes: 0, totalTravelDistance: 0, nonTravelWaitingMinutes: 0
  };
  for (const meeting of meetings) {
    const date = dayKey(meeting.date);
    const rows = existingActivities.filter((row) => dayKey(row.date) === date).sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    const previous = [...rows].reverse().find((row) => minutesOf(row.end_time) <= minutesOf(meeting.start_time));
    const next = rows.find((row) => minutesOf(row.start_time) >= minutesOf(meeting.end_time));
    const transition = travel?.transitions?.[date] || {};
    const neighbors = [[previous, transition.previous], [next, transition.next]].filter(([row]) => row);
    if (neighbors.some(([row]) => sameSchool(row, activity))) result.sameSchoolMeetingCount += 1;
    else if (neighbors.some(([, leg]) => Number.isFinite(Number(leg?.duration_minutes)) && Number(leg.duration_minutes) <= 25)) result.nearbyMeetingCount += 1;
    else if (rows.length || baselineDates.has(date)) result.existingWorkDayMeetingCount += 1;
    else result.newWorkDayMeetingCount += 1;

    if (previous) {
      result.totalTravelMinutes += Number(transition.previous?.duration_minutes) || 0;
      result.totalTravelDistance += Number(transition.previous?.distance_km) || 0;
    } else {
      result.totalTravelMinutes += Number(travel?.home?.duration_minutes) || 0;
      result.totalTravelDistance += Number(travel?.home?.distance_km) || 0;
    }
    if (next) {
      result.totalTravelMinutes += Number(transition.next?.duration_minutes) || 0;
      result.totalTravelDistance += Number(transition.next?.distance_km) || 0;
    }
  }
  const count = Math.max(1, meetings.length);
  return {
    ...result,
    relevantTravelMinutes: Math.round(result.totalTravelMinutes / count),
    relevantTravelDistance: Math.round((result.totalTravelDistance / count) * 10) / 10,
    opensNewWorkDay: result.newWorkDayMeetingCount > 0
  };
}

export function computeSchedulingScore({ eligible = false, activity = {}, meetings = [], existingActivities = [], travel = null, workDates = new Set(), dateAdjustment = null, currentHalfHours = 0, projectedHalfHours = 0, activeWorkDays = 0, existingWorkDays = null, projectedWorkDays = null, availabilityHours = 0, projectedWeeklyHours = 0, utilizationRatio = null, seniorityYears = 0 } = {}) {
  if (!eligible) return { score: null, totalScore: null, scoreBreakdown: null, recommendationReason: '' };
  const placement = analyzeDayPlacement({ activity, meetings, existingActivities, travel, workDates });
  const capacity = Number(availabilityHours) || 0;
  const resolvedUtilization = utilizationRatio != null ? Number(utilizationRatio) : (capacity > 0 ? Number(projectedWeeklyHours) / capacity : Number.POSITIVE_INFINITY);
  const movedMeetingsCount = Number(dateAdjustment?.movedCount) || 0;
  const integrated = placement.sameSchoolMeetingCount + placement.nearbyMeetingCount + placement.existingWorkDayMeetingCount;
  return {
    score: null,
    totalScore: null,
    scoreBreakdown: null,
    recommendationReason: `${integrated} מתוך ${meetings.length} מפגשים משתלבים ביום עבודה קיים · ${placement.newWorkDayMeetingCount} מפגשים פותחים יום עבודה חדש`,
    currentHalfHours: Number(currentHalfHours) || 0,
    projectedHalfHours: Number(projectedHalfHours) || 0,
    availabilityHours: capacity,
    projectedWeeklyHours: Number(projectedWeeklyHours) || 0,
    utilizationRatio: resolvedUtilization,
    seniorityYears: Number(seniorityYears) || 0,
    activeWorkDays: Number(projectedWorkDays ?? activeWorkDays) || 0,
    existingWorkDays: Number(existingWorkDays) || 0,
    projectedWorkDays: Number(projectedWorkDays ?? activeWorkDays) || 0,
    movedMeetingsCount,
    totalShiftDays: 0,
    halfOverflow: !!dateAdjustment?.exceedsHalf,
    ...placement,
    sameAuthorityMeetingCount: 0,
    continuityAverage: 0
  };
}

function compareEmpIds(first, second) {
  return text(first).localeCompare(text(second), 'en', { numeric: true });
}

/** Business priority: daily concentration, added travel, availability use, then seniority. */
export function compareCandidatesStable(first, second) {
  const fields = [
    ['sameSchoolMeetingCount', -1], ['nearbyMeetingCount', -1],
    ['existingWorkDayMeetingCount', -1], ['newWorkDayMeetingCount', 1],
    ['relevantTravelMinutes', 1], ['relevantTravelDistance', 1],
    ['utilizationRatio', 1], ['seniorityYears', -1]
  ];
  for (const [field, direction] of fields) {
    const a = Number(first[field]);
    const b = Number(second[field]);
    const safeA = Number.isFinite(a) ? a : Number.POSITIVE_INFINITY;
    const safeB = Number.isFinite(b) ? b : Number.POSITIVE_INFINITY;
    if (safeA !== safeB) return (safeA < safeB ? -1 : 1) * direction;
  }
  return compareEmpIds(first.instructor?.emp_id || first.empId, second.instructor?.emp_id || second.empId);
}
