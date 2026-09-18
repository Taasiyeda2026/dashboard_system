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

/** Neutral baseline when the instructor has no half-year schedule yet (not a bonus, not a penalty). */
export const NEUTRAL_CONTINUITY_POINTS = 18;
export const NEUTRAL_GAPS_POINTS = 5;
export const NEUTRAL_CONTINUITY_NOTE = 'טרם קיים סידור עבודה להשוואת רציפות';

const GEOGRAPHIC_NEARBY_MINUTES = 25;
const SAME_SCHOOL_CONTINUITY_MAX_GAP_MINUTES = 30;
const TRAVEL_SCORE_CEILING = Object.freeze({ minutes: 90, km: 60 });

const text = (value) => String(value ?? '').trim();
const dayKey = (value) => text(value).slice(0, 10);
const minutesOf = (value) => {
  const [hours, mins] = text(value || '00:00').split(':').map(Number);
  return hours * 60 + mins;
};

/**
 * Shared workload-hours display: 3.25 → "3.25 שעות", 3.5 → "3.5 שעות", 3 → "3 שעות".
 */
export function formatWorkloadHours(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  const fixed = (Math.round(num * 100) / 100).toFixed(2);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return `${trimmed} שעות`;
}

export function hasExistingHalfYearSchedule(existingActivities = [], workDates = new Set()) {
  const dates = workDates instanceof Set ? workDates : new Set(workDates || []);
  return (Array.isArray(existingActivities) && existingActivities.length > 0) || dates.size > 0;
}

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
  // Keep scoring aligned with the hard travel gate: a school match is trusted
  // only when both rows carry the same non-empty school_id. Display names are
  // not stable enough to waive travel or award same-school continuity.
  return !!(firstId && secondId && firstId === secondId);
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

    const consider = (neighbor, travelMin, gapMinutes) => {
      if (!neighbor) return;
      const sameSchoolNeighbor = sameSchool(neighbor, activity);
      const efficientSameSchoolSequence = sameSchoolNeighbor
        && Number.isFinite(Number(gapMinutes))
        && Number(gapMinutes) >= 0
        && Number(gapMinutes) <= SAME_SCHOOL_CONTINUITY_MAX_GAP_MINUTES;

      // "Same school" is valuable here only when it creates a real hourly
      // sequence. A several-hour gap at the same school is merely an existing
      // work day, not the operational saving of back-to-back courses.
      if (efficientSameSchoolSequence) {
        meetingTier = CONTINUITY_TIERS.sameSchool;
        tierKind = 'sameSchool';
      } else if (!sameSchoolNeighbor && tierKind !== 'sameSchool' && sameAuthority(neighbor, activity)) {
        meetingTier = CONTINUITY_TIERS.sameAuthority;
        tierKind = 'sameAuthority';
      } else if (
        !sameSchoolNeighbor
        && tierKind !== 'sameSchool'
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
      consider(previous, travelMin, gap);
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
      consider(next, travelMin, gap);
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
  const km = Math.round(Number(relevantTravelDistance) || 0);
  const mins = Math.round(Number(relevantTravelMinutes) || 0);
  return {
    points,
    label: SCORE_COMPONENT_LABELS.travelDistance,
    relevantTravelMinutes,
    relevantTravelDistance,
    duration_minutes: relevantTravelMinutes,
    distance_km: relevantTravelDistance,
    note: `${km} ק״מ וכ-${mins} דקות נסיעה`
  };
}

export function scoreActualWorkload({
  projectedHalfHours = 0,
  peerProjectedHours = [],
  currentHalfHours = 0,
  activeWorkDays = 0,
  plannerProjectedHalfHours = null,
  peerPlannerProjectedHours = [],
  projectedUtilizationRatio = null,
  peerProjectedUtilizationRatios = [],
  currentUtilizationRatio = 0,
  currentCourseCount = 0,
  availabilityHours = 0
} = {}) {
  const max = SCORE_WEIGHTS.actualWorkload;
  const projected = Number(projectedHalfHours);
  const hasPlannerProjected = plannerProjectedHalfHours !== null
    && plannerProjectedHalfHours !== ''
    && Number.isFinite(Number(plannerProjectedHalfHours));
  const effectiveProjectedHours = hasPlannerProjected
    ? Number(plannerProjectedHalfHours)
    : projected;
  const plannerPeers = (peerPlannerProjectedHours || []).map(Number).filter(Number.isFinite);
  const regularPeers = (peerProjectedHours || []).map(Number).filter(Number.isFinite);
  const effectiveHourPeers = plannerPeers.length ? plannerPeers : regularPeers;
  const hasProjectedRatio = projectedUtilizationRatio !== null
    && projectedUtilizationRatio !== ''
    && Number.isFinite(Number(projectedUtilizationRatio))
    && Number(projectedUtilizationRatio) >= 0;
  const projectedRatio = hasProjectedRatio ? Number(projectedUtilizationRatio) : null;
  const utilizationPeers = (peerProjectedUtilizationRatios || [])
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);

  let points = max;
  if (projectedRatio != null && utilizationPeers.length) {
    const minRatio = Math.min(...utilizationPeers);
    const maxRatio = Math.max(...utilizationPeers);
    points = minRatio === maxRatio
      ? max
      : roundPoints(max * ((maxRatio - projectedRatio) / (maxRatio - minRatio)), max);
  } else if (effectiveHourPeers.length && Number.isFinite(effectiveProjectedHours)) {
    const minHours = Math.min(...effectiveHourPeers);
    const maxHours = Math.max(...effectiveHourPeers);
    points = minHours === maxHours
      ? max
      : roundPoints(max * ((maxHours - effectiveProjectedHours) / (maxHours - minHours)), max);
  }

  const projectedRounded = Number.isFinite(projected) ? Math.round(projected * 100) / 100 : 0;
  const currentRatio = Number(currentUtilizationRatio);
  const utilizationPercent = projectedRatio != null
    ? Math.round(projectedRatio * 100)
    : null;

  return {
    points,
    label: SCORE_COMPONENT_LABELS.actualWorkload,
    currentHalfHours: Math.round((Number(currentHalfHours) || 0) * 100) / 100,
    projectedHalfHours: projectedRounded,
    activeWorkDays: Number(activeWorkDays) || 0,
    currentCourseCount: Math.max(0, Number(currentCourseCount) || 0),
    availabilityHours: Math.max(0, Number(availabilityHours) || 0),
    currentUtilizationRatio: Number.isFinite(currentRatio) && currentRatio >= 0 ? currentRatio : 0,
    projectedUtilizationRatio: projectedRatio,
    note: utilizationPercent == null
      ? `${formatWorkloadHours(projectedRounded)} לאחר השיבוץ`
      : `ניצול חזוי ${utilizationPercent}% · ${formatWorkloadHours(projectedRounded)} במחצית`
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
      halfOverflow: false,
      note: 'המועדים נשארים ללא שינוי'
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
    halfOverflow,
    note: movedMeetingsCount
      ? `${movedMeetingsCount} מפגשים הוזזו`
      : 'המועדים נשארים ללא שינוי'
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
  if (continuity?.note === NEUTRAL_CONTINUITY_NOTE) parts.push(NEUTRAL_CONTINUITY_NOTE);
  else if (continuity?.points >= 26) parts.push(continuity.label || 'רציפות יומית גבוהה');
  const travel = scoreBreakdown?.travelDistance;
  if (travel?.points >= 15 && travel.duration_minutes != null) {
    parts.push(`${Math.round(Number(travel.distance_km) || 0)} ק״מ, ${Math.round(Number(travel.duration_minutes) || 0)} דקות נסיעה`);
  }
  const workload = scoreBreakdown?.actualWorkload;
  if (workload && workload.projectedHalfHours != null) {
    parts.push(`עומס חזוי ${formatWorkloadHours(workload.projectedHalfHours)} במחצית`);
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
  plannerProjectedHalfHours = null,
  peerPlannerProjectedHours = [],
  currentUtilizationRatio = 0,
  projectedUtilizationRatio = null,
  peerProjectedUtilizationRatios = [],
  currentCourseCount = 0,
  availabilityHours = 0,
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

  const noExistingSchedule = !hasExistingHalfYearSchedule(existingActivities, workDates);
  const continuityEfficiency = noExistingSchedule
    ? {
      points: NEUTRAL_CONTINUITY_POINTS,
      label: SCORE_COMPONENT_LABELS.continuityEfficiency,
      note: NEUTRAL_CONTINUITY_NOTE,
      sameSchoolMeetingCount: 0,
      sameAuthorityMeetingCount: 0,
      nearbyMeetingCount: 0,
      existingWorkDayMeetingCount: 0,
      continuityMeetingCount: placement.continuityMeetingCount,
      continuityAverage: NEUTRAL_CONTINUITY_POINTS,
      neutralBaseline: true
    }
    : {
      points: placement.continuityPoints,
      label: SCORE_COMPONENT_LABELS.continuityEfficiency,
      note: '',
      sameSchoolMeetingCount: placement.sameSchoolMeetingCount,
      sameAuthorityMeetingCount: placement.sameAuthorityMeetingCount,
      nearbyMeetingCount: placement.nearbyMeetingCount,
      existingWorkDayMeetingCount: placement.existingWorkDayMeetingCount,
      continuityMeetingCount: placement.continuityMeetingCount,
      continuityAverage: placement.continuityAverage,
      neutralBaseline: false
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
    plannerProjectedHalfHours,
    peerPlannerProjectedHours,
    currentUtilizationRatio,
    projectedUtilizationRatio,
    peerProjectedUtilizationRatios,
    currentCourseCount,
    availabilityHours,
    activeWorkDays
  });
  const originalSchedulePreservation = scoreOriginalSchedulePreservation(dateAdjustment);
  const gapsAndNewDays = noExistingSchedule
    ? {
      points: NEUTRAL_GAPS_POINTS,
      label: SCORE_COMPONENT_LABELS.gapsAndNewDays,
      note: NEUTRAL_CONTINUITY_NOTE,
      newWorkDayMeetingCount: placement.newWorkDayMeetingCount,
      continuityMeetingCount: placement.continuityMeetingCount,
      averageNonTravelWaitingMinutes: placement.averageNonTravelWaitingMinutes,
      opensNewWorkDay: placement.opensNewWorkDay,
      neutralBaseline: true
    }
    : {
      ...scoreGapsAndNewDays({
        newWorkDayMeetingCount: placement.newWorkDayMeetingCount,
        continuityMeetingCount: placement.continuityMeetingCount,
        averageNonTravelWaitingMinutes: placement.averageNonTravelWaitingMinutes
      }),
      note: '',
      neutralBaseline: false
    };

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
    currentCourseCount: actualWorkload.currentCourseCount,
    availabilityHours: actualWorkload.availabilityHours,
    currentUtilizationRatio: actualWorkload.currentUtilizationRatio,
    projectedUtilizationRatio: actualWorkload.projectedUtilizationRatio,
    utilizationRatio: actualWorkload.projectedUtilizationRatio,
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

function candidateCoverageBucket(candidate = {}) {
  return (Number(candidate.currentCourseCount) || 0) > 0 ? 1 : 0;
}

function candidateProjectedUtilization(candidate = {}) {
  const value = Number(candidate.projectedUtilizationRatio ?? candidate.utilizationRatio);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function candidateOperationalEfficiency(candidate = {}) {
  const breakdownPoints = Number(candidate.scoreBreakdown?.continuityEfficiency?.points);
  if (Number.isFinite(breakdownPoints)) return breakdownPoints;

  const sameSchoolCount = Math.max(0, Number(candidate.sameSchoolMeetingCount) || 0);
  const sameAuthorityCount = Math.max(0, Number(candidate.sameAuthorityMeetingCount) || 0);
  const nearbyCount = Math.max(0, Number(candidate.nearbyMeetingCount) || 0);
  const existingDayCount = Math.max(0, Number(candidate.existingWorkDayMeetingCount) || 0);
  const newDayCount = Math.max(0, Number(candidate.newWorkDayMeetingCount) || 0);
  const explicitCount = Number(candidate.continuityMeetingCount);
  const meetingCount = Number.isFinite(explicitCount) && explicitCount > 0
    ? explicitCount
    : sameSchoolCount + sameAuthorityCount + nearbyCount + existingDayCount + newDayCount;
  if (!meetingCount) return 0;

  return (
    (sameSchoolCount * CONTINUITY_TIERS.sameSchool)
    + (sameAuthorityCount * CONTINUITY_TIERS.sameAuthority)
    + (nearbyCount * CONTINUITY_TIERS.geographicNearby)
    + (existingDayCount * CONTINUITY_TIERS.existingWorkDay)
  ) / meetingCount;
}

function candidateTravelKnown(candidate = {}) {
  if (typeof candidate.incrementalTravelKnown === 'boolean') return candidate.incrementalTravelKnown;
  return candidate.relevantTravelMinutes !== null
    && candidate.relevantTravelMinutes !== undefined
    && Number.isFinite(Number(candidate.relevantTravelMinutes))
    && candidate.relevantTravelDistance !== null
    && candidate.relevantTravelDistance !== undefined
    && Number.isFinite(Number(candidate.relevantTravelDistance));
}

function compareFiniteAscending(firstValue, secondValue) {
  const first = Number(firstValue);
  const second = Number(secondValue);
  const firstKnown = Number.isFinite(first);
  const secondKnown = Number.isFinite(second);
  if (firstKnown && secondKnown && first !== second) return first - second;
  return 0;
}

export function compareCandidatesStable(first, second) {
  // 1) Operational efficiency comes first. Back-to-back work, especially at
  // the same school, saves travel, kilometres and dead time. Fair distribution
  // must never split an efficient hourly block merely to give work to someone
  // who currently has no courses.
  const firstEfficiency = candidateOperationalEfficiency(first);
  const secondEfficiency = candidateOperationalEfficiency(second);
  if (firstEfficiency !== secondEfficiency) return secondEfficiency - firstEfficiency;

  // 2) With equal daily efficiency, prefer the option that adds less travel.
  // A known route is safer than an unknown one; then compare minutes and km.
  const firstTravelKnown = candidateTravelKnown(first);
  const secondTravelKnown = candidateTravelKnown(second);
  if (firstTravelKnown !== secondTravelKnown) return firstTravelKnown ? -1 : 1;
  if (firstTravelKnown && secondTravelKnown) {
    const minutesComparison = compareFiniteAscending(first.relevantTravelMinutes, second.relevantTravelMinutes);
    if (minutesComparison) return minutesComparison;
    const distanceComparison = compareFiniteAscending(first.relevantTravelDistance, second.relevantTravelDistance);
    if (distanceComparison) return distanceComparison;
  }

  // 3) Only after efficiency and travel are equivalent do we broaden work
  // coverage and balance utilization across eligible instructors.
  const firstCoverage = candidateCoverageBucket(first);
  const secondCoverage = candidateCoverageBucket(second);
  if (firstCoverage !== secondCoverage) return firstCoverage - secondCoverage;

  const firstUtilization = candidateProjectedUtilization(first);
  const secondUtilization = candidateProjectedUtilization(second);
  if (firstUtilization != null && secondUtilization != null && firstUtilization !== secondUtilization) {
    return firstUtilization - secondUtilization;
  }

  // 4) Preserve the rest of the transparent rubric as deterministic
  // tie-breakers once the operational choices are effectively equivalent.
  const firstScore = Number(first.score);
  const secondScore = Number(second.score);
  if (Number.isFinite(firstScore) && Number.isFinite(secondScore) && firstScore !== secondScore) {
    return secondScore - firstScore;
  }

  const firstPreservation = Number(first.scoreBreakdown?.originalSchedulePreservation?.points);
  const secondPreservation = Number(second.scoreBreakdown?.originalSchedulePreservation?.points);
  if (Number.isFinite(firstPreservation) && Number.isFinite(secondPreservation) && firstPreservation !== secondPreservation) {
    return secondPreservation - firstPreservation;
  }

  const projectedComparison = compareFiniteAscending(first.projectedHalfHours, second.projectedHalfHours);
  if (projectedComparison) return projectedComparison;

  const movedComparison = compareFiniteAscending(first.movedMeetingsCount, second.movedMeetingsCount);
  if (movedComparison) return movedComparison;

  const firstSeniority = first.seniorityYears == null ? null : Number(first.seniorityYears);
  const secondSeniority = second.seniorityYears == null ? null : Number(second.seniorityYears);
  if (Number.isFinite(firstSeniority) && Number.isFinite(secondSeniority) && firstSeniority !== secondSeniority) {
    return secondSeniority - firstSeniority;
  }

  return compareEmpIdsStable(
    first.instructor?.emp_id || first.empId,
    second.instructor?.emp_id || second.empId
  );
}

export function assertScoreWeightsTotal() {
  return Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0) === 100;
}
