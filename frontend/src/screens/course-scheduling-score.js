/**
 * Stage 3 scoring — single source for weights and component formulas.
 * Threshold gates stay in instructor-matching-engine.js; this module only scores eligible candidates.
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

/** Gradual travel scale: full points at 0, zero at/above these ceilings. */
const TRAVEL_SCORE_CEILING = Object.freeze({
  minutes: 90,
  km: 60
});

/** Continuity tiers within the 35-point budget (highest applicable wins). */
const CONTINUITY_TIERS = Object.freeze({
  sameSchool: 35,
  sameAuthority: 26,
  geographicNearby: 18,
  existingWorkDay: 12,
  isolatedDay: 6,
  newWorkDay: 4
});

/** Nearby means known transition at or under this duration (raw minutes, no safety buffer). */
const GEOGRAPHIC_NEARBY_MINUTES = 25;

const text = (value) => String(value ?? '').trim();
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

function sameSchool(a = {}, b = {}) {
  const firstId = text(a.school_id);
  const secondId = text(b.school_id);
  if (firstId && secondId) return firstId === secondId;
  return text(a.school).toLocaleLowerCase('he-IL') === text(b.school).toLocaleLowerCase('he-IL');
}

function sameAuthority(a = {}, b = {}) {
  return text(a.authority).toLocaleLowerCase('he-IL') === text(b.authority).toLocaleLowerCase('he-IL')
    && !!text(a.authority);
}

function dayKey(value) {
  return text(value).slice(0, 10);
}

function parseIsoDate(value) {
  const raw = dayKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = new Date(`${raw}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to) {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end) return null;
  return Math.round((end - start) / 86400000);
}

/**
 * Urgency from the first future meeting among meetings / date_1..date_35.
 * `referenceDate` must be injected (never rely on uncontrolled system time in tests).
 */
export function courseUrgency(course = {}, referenceDate) {
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

function hasReliableHomeRoute(travel = null) {
  const home = travel?.home;
  return !!(home
    && Number.isFinite(Number(home.duration_minutes))
    && Number.isFinite(Number(home.distance_km)));
}

/**
 * Safe eligible = passed gates and (in final mode) has reliable routes where required.
 * Preliminary candidates may remain eligible without home routes so travel can be built.
 */
export function isSafeEligibleCandidate(candidate = {}, { preliminary = false } = {}) {
  if (!candidate?.eligible) return false;
  const failures = candidate.failures || [];
  if (failures.some((failure) => /לא ניתן לאמת זמן מעבר|לא ניתן לאמת מסלול|transition_unverified|מסלול לא/.test(String(failure)))) {
    return false;
  }
  // Preliminary candidates (flag on the candidate or caller option) may lack home routes.
  if (preliminary || candidate.preliminary) return true;
  // Final calculation: unknown/missing home route is never a safe recommendation.
  if (candidate.requiresHomeRoute && !hasReliableHomeRoute(candidate.travel)) return false;
  if (candidate.travel?.unavailableReason === 'no_route' && candidate.requiresHomeRoute) return false;
  return true;
}

function gapQualityFactor(gapMinutes, travelMinutes = 0) {
  const waiting = Math.max(0, Number(gapMinutes) - Number(travelMinutes || 0));
  if (waiting <= 15) return 1;
  if (waiting <= 45) return 0.85;
  if (waiting <= 90) return 0.65;
  if (waiting <= 150) return 0.4;
  return 0.2;
}

/**
 * Analyze day placement for continuity, travel, and gap metrics.
 * Travel safety buffer (+15) is never added here — operational gates own that.
 */
export function analyzeDayPlacement({
  activity = {},
  meetings = [],
  existingActivities = [],
  travel = null,
  workDates = new Set()
} = {}) {
  let bestContinuity = CONTINUITY_TIERS.newWorkDay;
  let continuityLabel = 'פתיחת יום עבודה חדש';
  let opensNewWorkDay = false;
  let gapBeforeMinutes = 0;
  let gapAfterMinutes = 0;
  let nonTravelWaitingMinutes = 0;
  let relevantTravelMinutes = 0;
  let relevantTravelDistance = 0;
  let dailyTravelMinutes = 0;
  let dailyTravelDistance = 0;
  let unknownRoute = false;
  let hasSameSchoolDay = false;
  let hasSameAuthorityDay = false;
  let fillsExistingGap = false;
  let scoredDays = 0;
  const meetingList = meetings.length ? meetings : [];
  // Baseline work days only — never include the candidate course's own projected dates.
  const baselineWorkDates = workDates instanceof Set ? workDates : new Set(workDates || []);

  if (!meetingList.length) {
    return {
      continuityPoints: 0,
      continuityLabel,
      opensNewWorkDay: true,
      gapBeforeMinutes: 0,
      gapAfterMinutes: 0,
      nonTravelWaitingMinutes: 0,
      relevantTravelMinutes: 0,
      relevantTravelDistance: 0,
      dailyTravelMinutes: 0,
      dailyTravelDistance: 0,
      unknownRoute: false,
      hasSameSchoolDay: false,
      hasSameAuthorityDay: false,
      fillsExistingGap: false
    };
  }

  for (const meeting of meetingList) {
    const date = dayKey(meeting.date);
    const dayActivities = existingActivities
      .filter((row) => dayKey(row.date) === date)
      .sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    const previous = [...dayActivities].reverse().find((row) => minutesOf(row.end_time) <= minutesOf(meeting.start_time)) || null;
    const next = dayActivities.find((row) => minutesOf(row.start_time) >= minutesOf(meeting.end_time)) || null;
    const transition = travel?.transitions?.[date] || {};
    const dayAlreadyWorked = dayActivities.length > 0 || baselineWorkDates.has(date);
    if (!dayAlreadyWorked) opensNewWorkDay = true;
    scoredDays += 1;
    let dayTravelMinutes = 0;
    let dayTravelDistance = 0;

    const prevLeg = previous ? transition.previous : null;
    const nextLeg = next ? transition.next : null;
    const homeLeg = travel?.home || null;
    const homeReturnLeg = travel?.homeReturn || null;

    const considerNeighbor = (neighbor, gap, travelMin, direction) => {
      if (!neighbor) return;
      if (sameSchool(neighbor, activity)) {
        hasSameSchoolDay = true;
        const points = CONTINUITY_TIERS.sameSchool * gapQualityFactor(gap, travelMin || 0);
        if (points >= bestContinuity) {
          bestContinuity = points;
          continuityLabel = 'רציפות באותו בית ספר באותו יום';
        }
      } else if (sameAuthority(neighbor, activity)) {
        hasSameAuthorityDay = true;
        const points = CONTINUITY_TIERS.sameAuthority * gapQualityFactor(gap, travelMin || 0);
        if (points >= bestContinuity) {
          bestContinuity = points;
          continuityLabel = 'רציפות באותה רשות באותו יום';
        }
      } else if (travelMin != null && travelMin <= GEOGRAPHIC_NEARBY_MINUTES) {
        const points = CONTINUITY_TIERS.geographicNearby * gapQualityFactor(gap, travelMin);
        if (points >= bestContinuity) {
          bestContinuity = points;
          continuityLabel = 'קרבה גאוגרפית באותו יום';
        }
      } else if (dayAlreadyWorked) {
        const points = CONTINUITY_TIERS.existingWorkDay * gapQualityFactor(gap, travelMin || 0);
        if (points >= bestContinuity) {
          bestContinuity = points;
          continuityLabel = direction === 'previous'
            ? 'התאמה אחרי פעילות קיימת'
            : 'התאמה לפני פעילות קיימת';
        }
      }
    };

    if (previous) {
      const gap = minutesOf(meeting.start_time) - minutesOf(previous.end_time);
      gapBeforeMinutes += Math.max(0, gap);
      const travelMin = prevLeg?.duration_minutes;
      const travelKm = prevLeg?.distance_km;
      if (travelMin == null && !sameSchool(previous, activity)) unknownRoute = true;
      else {
        dayTravelMinutes += Number(travelMin) || 0;
        dayTravelDistance += Number(travelKm) || 0;
        nonTravelWaitingMinutes += Math.max(0, gap - (Number(travelMin) || 0));
      }
      considerNeighbor(previous, gap, travelMin, 'previous');
    } else if (homeLeg && Number.isFinite(Number(homeLeg.duration_minutes)) && Number.isFinite(Number(homeLeg.distance_km))) {
      // Arrival path: home only when this is the first activity of the day.
      dayTravelMinutes += Number(homeLeg.duration_minutes) || 0;
      dayTravelDistance += Number(homeLeg.distance_km) || 0;
    } else if (!previous) {
      unknownRoute = true;
    }

    if (next) {
      const gap = minutesOf(next.start_time) - minutesOf(meeting.end_time);
      gapAfterMinutes += Math.max(0, gap);
      const travelMin = nextLeg?.duration_minutes;
      const travelKm = nextLeg?.distance_km;
      if (travelMin == null && !sameSchool(activity, next)) unknownRoute = true;
      else {
        dayTravelMinutes += Number(travelMin) || 0;
        dayTravelDistance += Number(travelKm) || 0;
        nonTravelWaitingMinutes += Math.max(0, gap - (Number(travelMin) || 0));
      }
      considerNeighbor(next, gap, travelMin, 'next');
    } else if (
      homeReturnLeg
      && Number.isFinite(Number(homeReturnLeg.duration_minutes))
      && Number.isFinite(Number(homeReturnLeg.distance_km))
    ) {
      // Last activity of the day: add reliable home-return when present (never invent a reverse of home).
      dayTravelMinutes += Number(homeReturnLeg.duration_minutes) || 0;
      dayTravelDistance += Number(homeReturnLeg.distance_km) || 0;
    }

    relevantTravelMinutes += dayTravelMinutes;
    relevantTravelDistance += dayTravelDistance;
    dailyTravelMinutes = Math.max(dailyTravelMinutes, dayTravelMinutes);
    dailyTravelDistance = Math.max(dailyTravelDistance, dayTravelDistance);

    if (previous && next) fillsExistingGap = true;

    if (!previous && !next) {
      if (dayAlreadyWorked) {
        if (bestContinuity < CONTINUITY_TIERS.isolatedDay) {
          bestContinuity = CONTINUITY_TIERS.isolatedDay;
          continuityLabel = 'פעילות בודדת ביום עבודה קיים';
        }
      } else if (bestContinuity <= CONTINUITY_TIERS.newWorkDay) {
        bestContinuity = CONTINUITY_TIERS.newWorkDay;
        continuityLabel = 'פתיחת יום עבודה חדש';
      }
    }
  }

  // Same-school / same-authority elsewhere in the half still help slightly below same-day tiers.
  if (!hasSameSchoolDay && existingActivities.some((row) => sameSchool(row, activity))) {
    if (bestContinuity < CONTINUITY_TIERS.existingWorkDay) {
      bestContinuity = Math.max(bestContinuity, CONTINUITY_TIERS.existingWorkDay);
      continuityLabel = 'רציפות באותו בית ספר במחצית';
    }
  } else if (!hasSameSchoolDay && !hasSameAuthorityDay && existingActivities.some((row) => sameAuthority(row, activity))) {
    if (bestContinuity < 10) {
      bestContinuity = Math.max(bestContinuity, 10);
      continuityLabel = 'רציפות באותה רשות במחצית';
    }
  }

  // Score travel from the typical day (average across meeting days), not the sum of every meeting.
  const avgTravelMinutes = scoredDays ? relevantTravelMinutes / scoredDays : 0;
  const avgTravelDistance = scoredDays ? relevantTravelDistance / scoredDays : 0;

  return {
    continuityPoints: roundPoints(bestContinuity, SCORE_WEIGHTS.continuityEfficiency),
    continuityLabel,
    opensNewWorkDay,
    gapBeforeMinutes: Math.round(gapBeforeMinutes / Math.max(1, scoredDays)),
    gapAfterMinutes: Math.round(gapAfterMinutes / Math.max(1, scoredDays)),
    nonTravelWaitingMinutes: Math.round(nonTravelWaitingMinutes / Math.max(1, scoredDays)),
    relevantTravelMinutes: Math.round(avgTravelMinutes),
    relevantTravelDistance: Math.round(avgTravelDistance * 10) / 10,
    dailyTravelMinutes: Math.round(dailyTravelMinutes || avgTravelMinutes),
    dailyTravelDistance: Math.round((dailyTravelDistance || avgTravelDistance) * 10) / 10,
    unknownRoute,
    hasSameSchoolDay,
    hasSameAuthorityDay,
    fillsExistingGap
  };
}

export function scoreTravelDistance({
  relevantTravelMinutes = 0,
  relevantTravelDistance = 0,
  unknownRoute = false,
  hasKnownRoute = false
} = {}) {
  const max = SCORE_WEIGHTS.travelDistance;
  if (unknownRoute && !hasKnownRoute) {
    return {
      points: 0,
      label: SCORE_COMPONENT_LABELS.travelDistance,
      relevantTravelMinutes,
      relevantTravelDistance,
      dailyTravelMinutes: relevantTravelMinutes,
      note: 'מסלול לא ידוע — ללא ניקוד נסיעה רגיל'
    };
  }
  if (!hasKnownRoute && relevantTravelMinutes === 0 && relevantTravelDistance === 0) {
    return {
      points: 0,
      label: SCORE_COMPONENT_LABELS.travelDistance,
      relevantTravelMinutes: null,
      relevantTravelDistance: null,
      dailyTravelMinutes: null,
      note: 'המרחק טרם חושב'
    };
  }
  const minuteFactor = 1 - clamp(Number(relevantTravelMinutes) / TRAVEL_SCORE_CEILING.minutes, 0, 1);
  const kmFactor = 1 - clamp(Number(relevantTravelDistance) / TRAVEL_SCORE_CEILING.km, 0, 1);
  const points = roundPoints(max * Math.min(minuteFactor, kmFactor), max);
  return {
    points,
    label: SCORE_COMPONENT_LABELS.travelDistance,
    relevantTravelMinutes,
    relevantTravelDistance,
    dailyTravelMinutes: relevantTravelMinutes,
    distance_km: relevantTravelDistance,
    duration_minutes: relevantTravelMinutes,
    note: ''
  };
}

export function scoreActualWorkload({
  currentHalfHours = 0,
  projectedHalfHours = 0,
  peerProjectedHours = [],
  activeWorkDays = 0
} = {}) {
  const max = SCORE_WEIGHTS.actualWorkload;
  const projected = Number(projectedHalfHours);
  const peers = (peerProjectedHours || []).map(Number).filter(Number.isFinite);
  const values = peers.length ? peers : [projected];
  const min = Math.min(...values);
  const maxHours = Math.max(...values);
  let points = max;
  if (Number.isFinite(projected) && maxHours > min) {
    points = max * ((maxHours - projected) / (maxHours - min));
  } else if (!Number.isFinite(projected)) {
    points = 0;
  }
  return {
    points: roundPoints(points, max),
    label: SCORE_COMPONENT_LABELS.actualWorkload,
    currentHalfHours: Math.round(Number(currentHalfHours) * 100) / 100,
    projectedHalfHours: Math.round(Number(projectedHalfHours) * 100) / 100,
    activeWorkDays: Number(activeWorkDays) || 0
  };
}

export function scoreOriginalSchedulePreservation(dateAdjustment = null) {
  const max = SCORE_WEIGHTS.originalSchedulePreservation;
  if (!dateAdjustment?.valid) {
    return {
      points: max,
      label: SCORE_COMPONENT_LABELS.originalSchedulePreservation,
      movedMeetingsCount: 0,
      totalShiftDays: 0,
      originalEndDate: null,
      proposedEndDate: null,
      halfOverflow: false,
      originalSchedulePreservationScore: max
    };
  }

  const meetings = dateAdjustment.meetings || [];
  const moved = meetings.filter((row) => row.moved || (row.original_date && row.original_date !== row.date));
  const movedMeetingsCount = Number(dateAdjustment.movedCount) || moved.length;
  const totalShiftDays = moved.reduce((sum, row) => {
    const shift = daysBetween(row.original_date || row.date, row.date);
    return sum + Math.max(0, shift || 0);
  }, 0);
  const originalEndDate = meetings.reduce((latest, row) => {
    const original = dayKey(row.original_date || row.date);
    return !latest || original > latest ? original : latest;
  }, '');
  const proposedEndDate = dayKey(dateAdjustment.newEndDate || meetings.at(-1)?.date || '');
  const endShiftDays = Math.max(0, daysBetween(originalEndDate, proposedEndDate) || 0);
  const halfOverflow = !!dateAdjustment.exceedsHalf;

  // Gradual penalties within the 15-point budget; never negative.
  let points = max;
  points -= Math.min(8, movedMeetingsCount * 2.5);
  points -= Math.min(4, totalShiftDays / 7);
  points -= Math.min(2, endShiftDays / 14);
  if (halfOverflow) points -= 3;

  const rounded = roundPoints(points, max);
  return {
    points: rounded,
    label: SCORE_COMPONENT_LABELS.originalSchedulePreservation,
    movedMeetingsCount,
    totalShiftDays,
    originalEndDate: originalEndDate || null,
    proposedEndDate: proposedEndDate || null,
    halfOverflow,
    originalSchedulePreservationScore: rounded
  };
}

export function scoreGapsAndNewDays({
  opensNewWorkDay = false,
  gapBeforeMinutes = 0,
  gapAfterMinutes = 0,
  nonTravelWaitingMinutes = 0,
  fillsExistingGap = false
} = {}) {
  const max = SCORE_WEIGHTS.gapsAndNewDays;
  let points = max;
  if (opensNewWorkDay) points -= 2;
  if (!fillsExistingGap) {
    const waiting = Number(nonTravelWaitingMinutes) || (Number(gapBeforeMinutes) + Number(gapAfterMinutes));
    if (waiting > 120) points -= 2;
    else if (waiting > 60) points -= 1;
  }
  if (!opensNewWorkDay && fillsExistingGap) points = max;
  if (!opensNewWorkDay && !fillsExistingGap && (gapBeforeMinutes + gapAfterMinutes) === 0) points = Math.max(points, 3);

  const rounded = roundPoints(points, max);
  return {
    points: rounded,
    label: SCORE_COMPONENT_LABELS.gapsAndNewDays,
    opensNewWorkDay: !!opensNewWorkDay,
    gapBeforeMinutes: Math.round(Number(gapBeforeMinutes) || 0),
    gapAfterMinutes: Math.round(Number(gapAfterMinutes) || 0),
    nonTravelWaitingMinutes: Math.round(Number(nonTravelWaitingMinutes) || 0),
    gapsAndNewDaysScore: rounded
  };
}

export function buildRecommendationReason({
  scoreBreakdown,
  placement = {},
  dateAdjustment = null,
  qualityBand = ''
} = {}) {
  const parts = [];
  if (placement.hasSameSchoolDay || scoreBreakdown?.continuityEfficiency?.points >= 30) {
    parts.push('רציפות באותו בית ספר');
  } else if (placement.hasSameAuthorityDay || scoreBreakdown?.continuityEfficiency?.points >= 20) {
    parts.push('רציפות באותה רשות');
  } else if (scoreBreakdown?.continuityEfficiency?.label) {
    parts.push(scoreBreakdown.continuityEfficiency.label);
  }

  const travel = scoreBreakdown?.travelDistance;
  if (travel && travel.duration_minutes != null && Number.isFinite(Number(travel.duration_minutes))) {
    parts.push(`${Math.round(Number(travel.distance_km) || 0)} ק״מ, ${Math.round(Number(travel.duration_minutes) || 0)} דקות נסיעה רלוונטית`);
  } else if (travel?.note) {
    parts.push(travel.note);
  }

  const workload = scoreBreakdown?.actualWorkload;
  if (workload && workload.projectedHalfHours != null) {
    parts.push(`עומס חזוי ${workload.projectedHalfHours} שעות במחצית`);
  }

  if (dateAdjustment?.valid) {
    parts.push(`התאמת מועדים: ${dateAdjustment.movedCount || 0} מפגשים`);
  } else if (scoreBreakdown?.originalSchedulePreservation?.points === SCORE_WEIGHTS.originalSchedulePreservation) {
    parts.push('שמירה על המועדים המקוריים');
  }

  if (qualityBand === 'technical') parts.push('התאמה טכנית בלבד');
  if (qualityBand === 'warning') parts.push('מתאים עם אזהרה');

  return parts.filter(Boolean).join(' · ') || 'עבר את תנאי הסף';
}

/**
 * Full stage-3 score for an eligible candidate.
 * Returns null score when not eligible.
 */
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
  activeWorkDays = 0,
  scoreReasons = []
} = {}) {
  if (!eligible) {
    return {
      score: null,
      scoreBreakdown: null,
      placement: null,
      recommendationReason: '',
      ...emptyMetricFields()
    };
  }

  const placement = analyzeDayPlacement({
    activity,
    meetings,
    existingActivities,
    travel,
    workDates
  });

  const hasKnownRoute = (placement.relevantTravelMinutes > 0 || placement.relevantTravelDistance > 0)
    || (travel?.home && Number.isFinite(Number(travel.home.duration_minutes)))
    || Object.values(travel?.transitions || {}).some((row) =>
      (row?.previous && row.previous.duration_minutes != null)
      || (row?.next && row.next.duration_minutes != null));

  const continuityEfficiency = {
    points: placement.continuityPoints,
    label: placement.continuityLabel || SCORE_COMPONENT_LABELS.continuityEfficiency,
    hasSameSchoolDay: placement.hasSameSchoolDay,
    hasSameAuthorityDay: placement.hasSameAuthorityDay
  };
  const travelDistance = scoreTravelDistance({
    relevantTravelMinutes: placement.relevantTravelMinutes,
    relevantTravelDistance: placement.relevantTravelDistance,
    unknownRoute: placement.unknownRoute,
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
    opensNewWorkDay: placement.opensNewWorkDay,
    gapBeforeMinutes: placement.gapBeforeMinutes,
    gapAfterMinutes: placement.gapAfterMinutes,
    nonTravelWaitingMinutes: placement.nonTravelWaitingMinutes,
    fillsExistingGap: placement.fillsExistingGap
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
    gapsAndNewDays,
    gateNote: 'פעילות, כתובת, זמינות, שפה ומגדר כאשר נדרש הם תנאי סף ואינם מוסיפים נקודות.'
  };

  const recommendationReason = buildRecommendationReason({
    scoreBreakdown,
    placement,
    dateAdjustment,
    scoreReasons
  });

  return {
    score: clamp(totalScore, 0, 100),
    scoreBreakdown,
    placement,
    recommendationReason,
    currentHalfHours: actualWorkload.currentHalfHours,
    projectedHalfHours: actualWorkload.projectedHalfHours,
    activeWorkDays: actualWorkload.activeWorkDays,
    relevantTravelMinutes: travelDistance.relevantTravelMinutes,
    relevantTravelDistance: travelDistance.relevantTravelDistance,
    dailyTravelMinutes: travelDistance.dailyTravelMinutes ?? placement.dailyTravelMinutes,
    movedMeetingsCount: originalSchedulePreservation.movedMeetingsCount,
    totalShiftDays: originalSchedulePreservation.totalShiftDays,
    originalEndDate: originalSchedulePreservation.originalEndDate,
    proposedEndDate: originalSchedulePreservation.proposedEndDate,
    halfOverflow: originalSchedulePreservation.halfOverflow,
    opensNewWorkDay: gapsAndNewDays.opensNewWorkDay,
    gapBeforeMinutes: gapsAndNewDays.gapBeforeMinutes,
    gapAfterMinutes: gapsAndNewDays.gapAfterMinutes,
    nonTravelWaitingMinutes: gapsAndNewDays.nonTravelWaitingMinutes,
    hasSameSchoolDay: placement.hasSameSchoolDay,
    hasSameAuthorityDay: placement.hasSameAuthorityDay
  };
}

function emptyMetricFields() {
  return {
    currentHalfHours: null,
    projectedHalfHours: null,
    activeWorkDays: null,
    relevantTravelMinutes: null,
    relevantTravelDistance: null,
    dailyTravelMinutes: null,
    movedMeetingsCount: 0,
    totalShiftDays: 0,
    originalEndDate: null,
    proposedEndDate: null,
    halfOverflow: false,
    opensNewWorkDay: false,
    gapBeforeMinutes: 0,
    gapAfterMinutes: 0,
    nonTravelWaitingMinutes: 0,
    hasSameSchoolDay: false,
    hasSameAuthorityDay: false
  };
}

function compareNumberArrays(left = [], right = []) {
  const len = Math.max(left.length, right.length);
  for (let index = 0; index < len; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/** Lexicographic comparison: negative if a is better than b. */
export function compareOptimizationStates(a, b) {
  const assigned = (Number(b.assignedCount) || 0) - (Number(a.assignedCount) || 0);
  if (assigned) return assigned < 0 ? -1 : 1;

  const urgency7 = (Number(a.urgency7Missed) || 0) - (Number(b.urgency7Missed) || 0);
  if (urgency7) return urgency7 < 0 ? -1 : 1;
  const urgency14 = (Number(a.urgency14Missed) || 0) - (Number(b.urgency14Missed) || 0);
  if (urgency14) return urgency14 < 0 ? -1 : 1;

  // Gradual scarcity: unassigned courses with fewer eligible candidates are worse.
  // scarcityMissedByCount[k] = how many unassigned courses have exactly k eligible candidates.
  const scarcity = compareNumberArrays(a.scarcityMissedByCount || [], b.scarcityMissedByCount || []);
  if (scarcity) return scarcity;

  const tuple = (state) => [
    -(Number(state.sameSchoolCount) || 0),
    -(Number(state.sameAuthorityCount) || 0),
    Number(state.totalTravelMinutes) || 0,
    Number(state.totalNonTravelWaiting) || 0,
    Number(state.newWorkDaysOpened) || 0,
    Number(state.workloadVariance) || 0,
    Number(state.totalShiftDays) || 0,
    -(Number(state.totalScore) || 0),
    Number(state.tieProjectedHours) || 0,
    Number(state.tieTravel) || 0,
    Number(state.tieNewDays) || 0,
    Number(state.tieMovedMeetings) || 0,
    text(state.tieEmpId)
  ];
  const left = tuple(a);
  const right = tuple(b);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

export function compareCandidatesStable(first, second) {
  const a = [
    Number(first.projectedHalfHours) || 0,
    Number(first.dailyTravelMinutes) || 0,
    first.opensNewWorkDay ? 1 : 0,
    Number(first.movedMeetingsCount) || 0,
    text(first.instructor?.emp_id || first.empId)
  ];
  const b = [
    Number(second.projectedHalfHours) || 0,
    Number(second.dailyTravelMinutes) || 0,
    second.opensNewWorkDay ? 1 : 0,
    Number(second.movedMeetingsCount) || 0,
    text(second.instructor?.emp_id || second.empId)
  ];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function assertScoreWeightsTotal() {
  const total = Object.values(SCORE_WEIGHTS).reduce((sum, value) => sum + value, 0);
  return total === 100;
}
