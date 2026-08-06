/**
 * Stage 3 scoring — 100-point deterministic rubric.
 * Operational gates stay in instructor-matching / date-adjustments; this module only scores.
 */

export const SCORE_WEIGHTS = Object.freeze({
  continuityEfficiency: 35,
  travelDistance: 25,
  actualWorkload: 20,
  originalSchedulePreservation: 15,
  gapsAndNewDays: 5
});

export const SCORE_COMPONENT_LABELS = Object.freeze({
  continuityEfficiency: 'רציפות ויעילות ביום',
  travelDistance: 'מרחק ונסיעות',
  actualWorkload: 'עומס עבודה בפועל',
  originalSchedulePreservation: 'שמירה על המועדים המקוריים',
  gapsAndNewDays: 'צמצום חלונות ופתיחת ימי עבודה'
});

const CONTINUITY_TIERS = Object.freeze({
  sameSchool: 35,
  sameAuthority: 26,
  geographicNearby: 18,
  existingWorkDay: 12,
  noOtherActivity: 0
});

const GEOGRAPHIC_NEARBY_MINUTES = 25;
const TRAVEL_SCORE_CEILING = Object.freeze({ minutes: 90, km: 60 });

const text = (value) => String(value ?? '').trim();
const dayKey = (value) => text(value).slice(0, 10);
const minutesOf = (value) => {
  const [hours, mins] = text(value || '00:00').split(':').map(Number);
  return hours * 60 + mins;
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPoints(value, max) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(clamp(value, 0, max));
}

function sameSchool(first = {}, second = {}) {
  const firstId = text(first.school_id);
  const secondId = text(second.school_id);
  if (firstId && secondId) return firstId === secondId;
  return text(first.school).toLocaleLowerCase('he-IL') === text(second.school).toLocaleLowerCase('he-IL');
}

function sameAuthority(first = {}, second = {}) {
  return text(first.authority).toLocaleLowerCase('he-IL') === text(second.authority).toLocaleLowerCase('he-IL')
    && !!text(first.authority);
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${dayKey(fromDate)}T12:00:00Z`);
  const to = Date.parse(`${dayKey(toDate)}T12:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * Urgency from the first upcoming meeting relative to referenceDate (YYYY-MM-DD).
 */
export function courseUrgency(course = {}, referenceDate = null) {
  const reference = dayKey(referenceDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference)) {
    return {
      nextUpcomingMeetingDate: null,
      urgencyBand: 'none',
      daysUntilNextMeeting: null,
      urgencyRank: 4,
      reason: 'missing_reference_date'
    };
  }

  const meetings = Array.isArray(course.meetings) && course.meetings.length
    ? course.meetings.map((meeting) => (typeof meeting === 'string' ? meeting : meeting?.date)).filter(Boolean)
    : Array.from({ length: 35 }, (_, index) => course[`date_${index + 1}`]).filter(Boolean);

  const upcoming = meetings
    .map((date) => dayKey(date))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= reference)
    .sort();

  if (!upcoming.length) {
    return {
      nextUpcomingMeetingDate: null,
      urgencyBand: 'none',
      daysUntilNextMeeting: null,
      urgencyRank: 4,
      reason: 'no_upcoming_meeting'
    };
  }

  const nextUpcomingMeetingDate = upcoming[0];
  const daysUntilNextMeeting = daysBetween(reference, nextUpcomingMeetingDate);
  let urgencyBand = 'later';
  let urgencyRank = 3;
  if (daysUntilNextMeeting <= 7) {
    urgencyBand = 'within_7';
    urgencyRank = 1;
  } else if (daysUntilNextMeeting <= 14) {
    urgencyBand = 'within_14';
    urgencyRank = 2;
  }

  return {
    nextUpcomingMeetingDate,
    urgencyBand,
    daysUntilNextMeeting,
    urgencyRank,
    reason: ''
  };
}

export function analyzeDayPlacement({
  activity = {},
  meetings = [],
  existingActivities = [],
  travel = null,
  workDates = new Set()
} = {}) {
  let gapBeforeMinutes = 0;
  let gapAfterMinutes = 0;
  let nonTravelWaitingMinutes = 0;
  let relevantTravelMinutes = 0;
  let relevantTravelDistance = 0;
  let sameSchoolMeetingCount = 0;
  let sameAuthorityMeetingCount = 0;
  let nearbyMeetingCount = 0;
  let existingWorkDayMeetingCount = 0;
  let newWorkDayMeetingCount = 0;
  const meetingScores = [];
  const meetingList = meetings.length ? meetings : [];
  const baselineWorkDates = workDates instanceof Set ? workDates : new Set(workDates || []);

  for (const meeting of meetingList) {
    const date = dayKey(meeting.date);
    const dayActivities = existingActivities
      .filter((row) => dayKey(row.date) === date)
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    const previous = [...dayActivities].reverse().find((row) => minutesOf(row.end_time) <= minutesOf(meeting.start_time)) || null;
    const next = dayActivities.find((row) => minutesOf(row.start_time) >= minutesOf(meeting.end_time)) || null;
    const transition = travel?.transitions?.[date] || {};
    const dayAlreadyWorked = dayActivities.length > 0 || baselineWorkDates.has(date);
    let dayTravelMinutes = 0;
    let dayTravelDistance = 0;
    let meetingTier = CONTINUITY_TIERS.noOtherActivity;
    let tierKind = 'none';

    const consider = (neighbor, travelMin) => {
      if (!neighbor) return;
      if (sameSchool(neighbor, activity)) {
        meetingTier = CONTINUITY_TIERS.sameSchool;
        tierKind = 'sameSchool';
      } else if (tierKind !== 'sameSchool' && sameAuthority(neighbor, activity)) {
        meetingTier = CONTINUITY_TIERS.sameAuthority;
        tierKind = 'sameAuthority';
      } else if (
        tierKind !== 'sameSchool'
        && tierKind !== 'sameAuthority'
        && travelMin != null
        && Number(travelMin) <= GEOGRAPHIC_NEARBY_MINUTES
      ) {
        meetingTier = CONTINUITY_TIERS.geographicNearby;
        tierKind = 'nearby';
      } else if (
        tierKind === 'none'
        && dayAlreadyWorked
      ) {
        meetingTier = CONTINUITY_TIERS.existingWorkDay;
        tierKind = 'existingWorkDay';
      }
    };

    if (previous) {
      const gap = minutesOf(meeting.start_time) - minutesOf(previous.end_time);
      gapBeforeMinutes += Math.max(0, gap);
      const travelMin = transition.previous?.duration_minutes;
      const travelKm = transition.previous?.distance_km;
      if (travelMin != null || sameSchool(previous, activity)) {
        dayTravelMinutes += Number(travelMin) || 0;
        dayTravelDistance += Number(travelKm) || 0;
        nonTravelWaitingMinutes += Math.max(0, gap - (Number(travelMin) || 0));
      }
      consider(previous, travelMin);
    } else if (travel?.home && Number.isFinite(Number(travel.home.duration_minutes))) {
      dayTravelMinutes += Number(travel.home.duration_minutes) || 0;
      dayTravelDistance += Number(travel.home.distance_km) || 0;
    }

    if (next) {
      const gap = minutesOf(next.start_time) - minutesOf(meeting.end_time);
      gapAfterMinutes += Math.max(0, gap);
      const travelMin = transition.next?.duration_minutes;
      const travelKm = transition.next?.distance_km;
      if (travelMin != null || sameSchool(activity, next)) {
        dayTravelMinutes += Number(travelMin) || 0;
        dayTravelDistance += Number(travelKm) || 0;
        nonTravelWaitingMinutes += Math.max(0, gap - (Number(travelMin) || 0));
      }
      consider(next, travelMin);
    } else if (
      travel?.homeReturn
      && Number.isFinite(Number(travel.homeReturn.duration_minutes))
      && Number.isFinite(Number(travel.homeReturn.distance_km))
    ) {
      dayTravelMinutes += Number(travel.homeReturn.duration_minutes) || 0;
      dayTravelDistance += Number(travel.homeReturn.distance_km) || 0;
    }

    if (tierKind === 'none' && dayAlreadyWorked) {
      meetingTier = CONTINUITY_TIERS.existingWorkDay;
      tierKind = 'existingWorkDay';
    }

    if (tierKind === 'sameSchool') sameSchoolMeetingCount += 1;
    else if (tierKind === 'sameAuthority') sameAuthorityMeetingCount += 1;
    else if (tierKind === 'nearby') nearbyMeetingCount += 1;
    else if (tierKind === 'existingWorkDay') existingWorkDayMeetingCount += 1;
    else newWorkDayMeetingCount += 1;

    meetingScores.push(meetingTier);
    relevantTravelMinutes += dayTravelMinutes;
    relevantTravelDistance += dayTravelDistance;
  }

  const continuityMeetingCount = meetingScores.length;
  const continuityAverage = continuityMeetingCount
    ? meetingScores.reduce((sum, value) => sum + value, 0) / continuityMeetingCount
    : 0;
  const avgTravelMinutes = continuityMeetingCount ? relevantTravelMinutes / continuityMeetingCount : 0;
  const avgTravelDistance = continuityMeetingCount ? relevantTravelDistance / continuityMeetingCount : 0;
  const averageNonTravelWaitingMinutes = continuityMeetingCount
    ? nonTravelWaitingMinutes / continuityMeetingCount
    : 0;

  return {
    continuityPoints: roundPoints(continuityAverage, SCORE_WEIGHTS.continuityEfficiency),
    continuityAverage: Math.round(continuityAverage * 100) / 100,
    continuityMeetingCount,
    sameSchoolMeetingCount,
    sameAuthorityMeetingCount,
    nearbyMeetingCount,
    existingWorkDayMeetingCount,
    newWorkDayMeetingCount,
    opensNewWorkDay: newWorkDayMeetingCount > 0,
    gapBeforeMinutes: Math.round(gapBeforeMinutes / Math.max(1, continuityMeetingCount)),
    gapAfterMinutes: Math.round(gapAfterMinutes / Math.max(1, continuityMeetingCount)),
    nonTravelWaitingMinutes: Math.round(averageNonTravelWaitingMinutes),
    averageNonTravelWaitingMinutes,
    relevantTravelMinutes: Math.round(avgTravelMinutes),
    relevantTravelDistance: Math.round(avgTravelDistance * 10) / 10,
    hasSameSchoolDay: sameSchoolMeetingCount > 0,
    hasSameAuthorityDay: sameAuthorityMeetingCount > 0
  };
}

export function scoreTravelDistance({
  relevantTravelMinutes = 0,
  relevantTravelDistance = 0,
  hasKnownRoute = false
} = {}) {
  const max = SCORE_WEIGHTS.travelDistance;
  if (!hasKnownRoute) {
    return {
      points: 0,
      label: SCORE_COMPONENT_LABELS.travelDistance,
      relevantTravelMinutes: null,
      relevantTravelDistance: null,
      note: 'אין נתון מרחק אמין לניקוד'
    };
  }
  const minuteFactor = Math.max(0, 1 - (Number(relevantTravelMinutes) / TRAVEL_SCORE_CEILING.minutes));
  const distanceFactor = Math.max(0, 1 - (Number(relevantTravelDistance) / TRAVEL_SCORE_CEILING.km));
  const points = roundPoints(max * Math.min(minuteFactor, distanceFactor), max);
  return {
    points,
    label: SCORE_COMPONENT_LABELS.travelDistance,
    relevantTravelMinutes,
    relevantTravelDistance,
    duration_minutes: relevantTravelMinutes,
    distance_km: relevantTravelDistance,
    note: ''
  };
}

export function scoreActualWorkload({
  projectedHalfHours = 0,
  peerProjectedHours = [],
  currentHalfHours = 0,
  activeWorkDays = 0
} = {}) {
  const max = SCORE_WEIGHTS.actualWorkload;
  const peers = (peerProjectedHours || []).map(Number).filter(Number.isFinite);
  const projected = Number(projectedHalfHours);
  if (!peers.length || !Number.isFinite(projected)) {
    return {
      points: max,
      label: SCORE_COMPONENT_LABELS.actualWorkload,
      currentHalfHours: Number(currentHalfHours) || 0,
      projectedHalfHours: Number.isFinite(projected) ? projected : 0,
      activeWorkDays: Number(activeWorkDays) || 0
    };
  }
  const min = Math.min(...peers);
  const maxPeer = Math.max(...peers);
  const points = min === maxPeer
    ? max
    : roundPoints(max * ((maxPeer - projected) / (maxPeer - min)), max);
  return {
    points,
    label: SCORE_COMPONENT_LABELS.actualWorkload,
    currentHalfHours: Math.round(Number(currentHalfHours) * 100) / 100,
    projectedHalfHours: Math.round(projected * 100) / 100,
    activeWorkDays: Number(activeWorkDays) || 0
  };
}

export function scoreOriginalSchedulePreservation(dateAdjustment = null) {
  const max = SCORE_WEIGHTS.originalSchedulePreservation;
  if (!dateAdjustment || !dateAdjustment.valid) {
    return {
      points: max,
      label: SCORE_COMPONENT_LABELS.originalSchedulePreservation,
      movedMeetingsCount: 0,
      totalShiftDays: 0,
      originalEndDate: null,
      proposedEndDate: null,
      halfOverflow: false
    };
  }
  const meetings = dateAdjustment.meetings || [];
  const movedMeetingsCount = Number(dateAdjustment.movedCount) || meetings.filter((row) => row.moved).length;
  const totalShiftDays = meetings.reduce((sum, meeting) => {
    if (!meeting.moved || !meeting.original_date || !meeting.date) return sum;
    return sum + Math.max(0, daysBetween(meeting.original_date, meeting.date) || 0);
  }, 0);
  const originalEndDate = meetings.map((row) => row.original_date || row.date).filter(Boolean).sort().at(-1) || null;
  const proposedEndDate = dateAdjustment.newEndDate || meetings.map((row) => row.date).filter(Boolean).sort().at(-1) || null;
  const halfOverflow = !!dateAdjustment.exceedsHalf;
  const movePenalty = Math.min(8, movedMeetingsCount * 2);
  const shiftPenalty = Math.min(4, Math.floor(totalShiftDays / 7));
  const overflowPenalty = halfOverflow ? 3 : 0;
  return {
    points: roundPoints(max - movePenalty - shiftPenalty - overflowPenalty, max),
    label: SCORE_COMPONENT_LABELS.originalSchedulePreservation,
    movedMeetingsCount,
    totalShiftDays,
    originalEndDate,
    proposedEndDate,
    halfOverflow
  };
}

export function scoreGapsAndNewDays({
  newWorkDayMeetingCount = 0,
  continuityMeetingCount = 0,
  averageNonTravelWaitingMinutes = 0
} = {}) {
  const max = SCORE_WEIGHTS.gapsAndNewDays;
  const meetingCount = Math.max(1, Number(continuityMeetingCount) || 0);
  const newDayRatio = (Number(newWorkDayMeetingCount) || 0) / meetingCount;
  const waitingPenalty = Math.min(2, (Number(averageNonTravelWaitingMinutes) || 0) / 60);
  const points = roundPoints(max - (max * newDayRatio) - waitingPenalty, max);
  return {
    points,
    label: SCORE_COMPONENT_LABELS.gapsAndNewDays,
    newWorkDayMeetingCount: Number(newWorkDayMeetingCount) || 0,
    continuityMeetingCount: Number(continuityMeetingCount) || 0,
    averageNonTravelWaitingMinutes: Number(averageNonTravelWaitingMinutes) || 0,
    opensNewWorkDay: (Number(newWorkDayMeetingCount) || 0) > 0
  };
}

function buildRecommendationReason({ scoreBreakdown }) {
  const parts = [];
  const continuity = scoreBreakdown?.continuityEfficiency;
  if (continuity?.points >= 26) parts.push(continuity.label || 'רציפות יומית גבוהה');
  const travel = scoreBreakdown?.travelDistance;
  if (travel?.points >= 15 && travel.duration_minutes != null) {
    parts.push(`${Math.round(Number(travel.distance_km) || 0)} ק״מ, ${Math.round(Number(travel.duration_minutes) || 0)} דקות נסיעה`);
  }
  const workload = scoreBreakdown?.actualWorkload;
  if (workload && workload.projectedHalfHours != null) {
    parts.push(`עומס חזוי ${workload.projectedHalfHours} שעות במחצית`);
  }
  return parts.filter(Boolean).join(' · ') || 'עבר את תנאי הסף';
}

export function computeSchedulingScore({
  eligible = false,
  activity = {},
  meetings = [],
  existingActivities = [],
  travel = null,
  workDates = new Set(),
  dateAdjustment = null,
  currentHalfHours = 0,
  projectedHalfHours = 0,
  peerProjectedHours = [],
  activeWorkDays = 0
} = {}) {
  if (!eligible) {
    return {
      score: null,
      totalScore: null,
      scoreBreakdown: null,
      recommendationReason: '',
      currentHalfHours: null,
      projectedHalfHours: null,
      activeWorkDays: null,
      relevantTravelMinutes: null,
      relevantTravelDistance: null,
      movedMeetingsCount: 0,
      totalShiftDays: 0,
      halfOverflow: false,
      sameSchoolMeetingCount: 0,
      sameAuthorityMeetingCount: 0,
      nearbyMeetingCount: 0,
      existingWorkDayMeetingCount: 0,
      newWorkDayMeetingCount: 0,
      continuityMeetingCount: 0,
      continuityAverage: 0,
      opensNewWorkDay: false,
      nonTravelWaitingMinutes: 0
    };
  }

  const placement = analyzeDayPlacement({
    activity,
    meetings,
    existingActivities,
    travel,
    workDates
  });

  const hasKnownRoute = Number(placement.relevantTravelMinutes) > 0
    || Number(placement.relevantTravelDistance) > 0
    || (travel?.home && Number.isFinite(Number(travel.home.duration_minutes)));

  const continuityEfficiency = {
    points: placement.continuityPoints,
    label: SCORE_COMPONENT_LABELS.continuityEfficiency,
    sameSchoolMeetingCount: placement.sameSchoolMeetingCount,
    sameAuthorityMeetingCount: placement.sameAuthorityMeetingCount,
    nearbyMeetingCount: placement.nearbyMeetingCount,
    existingWorkDayMeetingCount: placement.existingWorkDayMeetingCount,
    continuityMeetingCount: placement.continuityMeetingCount,
    continuityAverage: placement.continuityAverage
  };
  const travelDistance = scoreTravelDistance({
    relevantTravelMinutes: placement.relevantTravelMinutes,
    relevantTravelDistance: placement.relevantTravelDistance,
    hasKnownRoute
  });
  const actualWorkload = scoreActualWorkload({
    currentHalfHours,
    projectedHalfHours,
    peerProjectedHours,
    activeWorkDays
  });
  const originalSchedulePreservation = scoreOriginalSchedulePreservation(dateAdjustment);
  const gapsAndNewDays = scoreGapsAndNewDays({
    newWorkDayMeetingCount: placement.newWorkDayMeetingCount,
    continuityMeetingCount: placement.continuityMeetingCount,
    averageNonTravelWaitingMinutes: placement.averageNonTravelWaitingMinutes
  });

  const totalScore = continuityEfficiency.points
    + travelDistance.points
    + actualWorkload.points
    + originalSchedulePreservation.points
    + gapsAndNewDays.points;

  const scoreBreakdown = {
    continuityEfficiency,
    travelDistance,
    actualWorkload,
    originalSchedulePreservation,
    gapsAndNewDays
  };

  return {
    score: clamp(totalScore, 0, 100),
    totalScore: clamp(totalScore, 0, 100),
    scoreBreakdown,
    recommendationReason: buildRecommendationReason({ scoreBreakdown }),
    currentHalfHours: actualWorkload.currentHalfHours,
    projectedHalfHours: actualWorkload.projectedHalfHours,
    activeWorkDays: actualWorkload.activeWorkDays,
    relevantTravelMinutes: travelDistance.relevantTravelMinutes,
    relevantTravelDistance: travelDistance.relevantTravelDistance,
    movedMeetingsCount: originalSchedulePreservation.movedMeetingsCount,
    totalShiftDays: originalSchedulePreservation.totalShiftDays,
    originalEndDate: originalSchedulePreservation.originalEndDate,
    proposedEndDate: originalSchedulePreservation.proposedEndDate,
    halfOverflow: originalSchedulePreservation.halfOverflow,
    sameSchoolMeetingCount: placement.sameSchoolMeetingCount,
    sameAuthorityMeetingCount: placement.sameAuthorityMeetingCount,
    nearbyMeetingCount: placement.nearbyMeetingCount,
    existingWorkDayMeetingCount: placement.existingWorkDayMeetingCount,
    newWorkDayMeetingCount: placement.newWorkDayMeetingCount,
    continuityMeetingCount: placement.continuityMeetingCount,
    continuityAverage: placement.continuityAverage,
    opensNewWorkDay: gapsAndNewDays.opensNewWorkDay,
    nonTravelWaitingMinutes: placement.nonTravelWaitingMinutes,
    hasSameSchoolDay: placement.hasSameSchoolDay,
    hasSameAuthorityDay: placement.hasSameAuthorityDay
  };
}

function compareEmpIdsStable(firstId, secondId) {
  const first = text(firstId);
  const second = text(secondId);
  const firstNumber = Number(first);
  const secondNumber = Number(second);
  const bothNumeric = first !== ''
    && second !== ''
    && Number.isFinite(firstNumber)
    && Number.isFinite(secondNumber)
    && String(firstNumber) === first
    && String(secondNumber) === second;
  if (bothNumeric) {
    if (firstNumber < secondNumber) return -1;
    if (firstNumber > secondNumber) return 1;
    return 0;
  }
  return first.localeCompare(second, 'en');
}

export function compareCandidatesStable(first, second) {
  const a = [
    -(Number(first.score) || 0),
    -(Number(first.scoreBreakdown?.continuityEfficiency?.points) || 0),
    -(Number(first.scoreBreakdown?.travelDistance?.points) || 0),
    Number(first.projectedHalfHours) || 0,
    Number(first.movedMeetingsCount) || 0
  ];
  const b = [
    -(Number(second.score) || 0),
    -(Number(second.scoreBreakdown?.continuityEfficiency?.points) || 0),
    -(Number(second.scoreBreakdown?.travelDistance?.points) || 0),
    Number(second.projectedHalfHours) || 0,
    Number(second.movedMeetingsCount) || 0
  ];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return compareEmpIdsStable(
    first.instructor?.emp_id || first.empId,
    second.instructor?.emp_id || second.empId
  );
}

export function assertScoreWeightsTotal() {
  return Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0) === 100;
}
