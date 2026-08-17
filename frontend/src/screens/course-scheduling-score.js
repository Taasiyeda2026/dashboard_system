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
  return !!(a && b && a === b);
}

const legValue = (leg, field) => Number.isFinite(Number(leg?.[field])) ? Number(leg[field]) : 0;
const knownLeg = (leg) => Number.isFinite(Number(leg?.duration_minutes))
  && Number.isFinite(Number(leg?.distance_km));

/** Classifies every meeting and totals the real travel added by inserting the course. */
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

    const inbound = previous ? transition.previous : travel?.home;
    const outbound = next ? transition.next : travel?.homeReturn;
    const baseline = transition.baseline;
    const requiredLegs = [inbound, outbound, ...(previous || next ? [baseline] : [])];
    if (requiredLegs.every(knownLeg)) {
      result.totalTravelMinutes += legValue(inbound, 'duration_minutes')
        + legValue(outbound, 'duration_minutes') - legValue(baseline, 'duration_minutes');
      result.totalTravelDistance += legValue(inbound, 'distance_km')
        + legValue(outbound, 'distance_km') - legValue(baseline, 'distance_km');
    } else {
      result.incrementalTravelKnown = false;
    }
  }
  const count = Math.max(1, meetings.length);
  return {
    ...result,
    incrementalTravelKnown: result.incrementalTravelKnown !== false,
    relevantTravelMinutes: result.incrementalTravelKnown === false ? null : Math.round(result.totalTravelMinutes / count),
    relevantTravelDistance: result.incrementalTravelKnown === false ? null : Math.round((result.totalTravelDistance / count) * 10) / 10,
    opensNewWorkDay: result.newWorkDayMeetingCount > 0
  };
}

export function computeSchedulingScore({ eligible = false, activity = {}, meetings = [], existingActivities = [], travel = null, workDates = new Set(), dateAdjustment = null, currentHalfHours = 0, projectedHalfHours = 0, activeWorkDays = 0, existingWorkDays = null, projectedWorkDays = null, availabilityHours = 0, projectedWeeklyHours = 0, utilizationRatio = null, seniorityYears = null } = {}) {
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
    seniorityYears: seniorityYears == null || seniorityYears === '' || !Number.isFinite(Number(seniorityYears)) ? null : Number(seniorityYears),
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
  const integrated = (candidate) => (Number(candidate.sameSchoolMeetingCount) || 0)
    + (Number(candidate.nearbyMeetingCount) || 0)
    + (Number(candidate.existingWorkDayMeetingCount) || 0);
  const firstIntegrated = integrated(first);
  const secondIntegrated = integrated(second);
  if (firstIntegrated !== secondIntegrated) return secondIntegrated - firstIntegrated;
  const firstNewDays = Number(first.newWorkDayMeetingCount) || 0;
  const secondNewDays = Number(second.newWorkDayMeetingCount) || 0;
  if (firstNewDays !== secondNewDays) return firstNewDays - secondNewDays;
  for (const field of ['sameSchoolMeetingCount', 'nearbyMeetingCount', 'existingWorkDayMeetingCount']) {
    if (Number(first[field]) !== Number(second[field])) return Number(second[field]) - Number(first[field]);
  }
  const firstTravelKnown = first.incrementalTravelKnown === true;
  const secondTravelKnown = second.incrementalTravelKnown === true;
  if (firstTravelKnown !== secondTravelKnown) return firstTravelKnown ? -1 : 1;
  if (firstTravelKnown) {
    for (const field of ['relevantTravelMinutes', 'relevantTravelDistance']) {
      if (first[field] !== second[field]) return Number(first[field]) - Number(second[field]);
    }
  }
  const firstUtilization = Number(first.utilizationRatio);
  const secondUtilization = Number(second.utilizationRatio);
  const safeFirstUtilization = Number.isFinite(firstUtilization) ? firstUtilization : Number.POSITIVE_INFINITY;
  const safeSecondUtilization = Number.isFinite(secondUtilization) ? secondUtilization : Number.POSITIVE_INFINITY;
  if (safeFirstUtilization !== safeSecondUtilization) return safeFirstUtilization - safeSecondUtilization;
  const firstSeniorityKnown = first.seniorityYears != null && Number.isFinite(Number(first.seniorityYears));
  const secondSeniorityKnown = second.seniorityYears != null && Number.isFinite(Number(second.seniorityYears));
  if (firstSeniorityKnown && secondSeniorityKnown && Number(first.seniorityYears) !== Number(second.seniorityYears)) {
    return Number(second.seniorityYears) - Number(first.seniorityYears);
  }
  return compareEmpIds(first.instructor?.emp_id || first.empId, second.instructor?.emp_id || second.empId);
}
