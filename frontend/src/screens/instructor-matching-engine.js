import { instructionLanguageLabel, profileSpeaksLanguage, resolveInstructionLanguage } from './shared/instruction-language.js';

const LANGUAGE_LABELS = { he: 'עברית', ar: 'ערבית' };
/** One-way driving-route home→school hard eligibility limit (km). Inclusive at exactly this value. */
export const MAX_HOME_DISTANCE_KM = 40;
/** Required gap between consecutive meetings = raw travel minutes + this buffer. Applied once only. */
export const TRANSITION_BUFFER_MINUTES = 15;

export const DEFAULT_SCHEDULING_PROFILE = Object.freeze({
  gender: null,
  instruction_languages: [],
  friday_allowed: false,
  default_start_time: '08:00',
  default_end_time: '15:00',
  matching_note: null,
});

export function homeDistanceLimitFailureMessage(distanceKm) {
  return `מרחק הנסיעה לבית הספר הוא ${Math.round(Number(distanceKm))} ק״מ ועולה על המגבלה של ${MAX_HOME_DISTANCE_KM} ק״מ`;
}

export function exceedsHomeDistanceLimit(distanceKm) {
  const km = Number(distanceKm);
  return Number.isFinite(km) && km > MAX_HOME_DISTANCE_KM;
}

export function schedulingQualityBand(score, eligible = true) {
  if (!eligible || !Number.isFinite(Number(score))) return null;
  if (Number(score) >= 60) return { qualityBand: 'recommended', qualityLabel: 'מומלץ' };
  if (Number(score) >= 40) return { qualityBand: 'warning', qualityLabel: 'מתאים עם אזהרה' };
  return { qualityBand: 'technical', qualityLabel: 'מתאים טכנית בלבד' };
}

export function normalizeGender(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const lower = raw.toLocaleLowerCase('he-IL');
  if (lower === 'any' || raw === 'ללא' || raw === 'ללא דרישה') return 'any';
  if (lower === 'female' || lower === 'f' || raw === 'נקבה' || raw === 'מדריכה' || raw === 'אישה') return 'female';
  if (lower === 'male' || lower === 'm' || raw === 'זכר' || raw === 'מדריך' || raw === 'גבר') return 'male';
  return null;
}


export function normalizeSchedulingProfile(profile = {}) {
  const gender = normalizeGender(profile?.gender);
  return {
    ...DEFAULT_SCHEDULING_PROFILE,
    ...(profile || {}),
    gender: gender === 'any' ? null : gender,
    instruction_languages: Array.isArray(profile?.instruction_languages) ? profile.instruction_languages : []
  };
}

const minutes = (value) => {
  const [hours, mins] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + mins;
};
const same = (a, b) => String(a || '').trim() === String(b || '').trim();

/**
 * True when two activity rows are confirmed to be at the same school.
 * Requires a non-empty school_id on both rows; school_id is the sole identifier.
 * When either school_id is absent the location cannot be confirmed as the same —
 * returns false (treat as different / unknown location, requiring travel verification).
 */
function sameSchoolLocation(a, b) {
  const idA = normId(a?.school_id);
  const idB = normId(b?.school_id);
  return !!(idA && idB && idA === idB);
}

function normText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function normId(value) {
  return String(value ?? '').trim();
}

function meetingRows(activity) {
  // Exclude cancelled meetings so they do not cause spurious overlap failures.
  const cancelledSet = new Set(
    Array.isArray(activity.cancelled_meeting_dates)
      ? activity.cancelled_meeting_dates.map((d) => String(d).slice(0, 10))
      : []
  );
  const dates = Array.isArray(activity.meetings)
    ? activity.meetings
    : Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
      .filter(Boolean)
      .map((date) => ({ date, start_time: activity.start_time, end_time: activity.end_time }));
  return dates
    .map((value) => typeof value === 'string'
      ? { date: value, start_time: activity.start_time, end_time: activity.end_time }
      : value)
    .filter((value) => value.date && !cancelledSet.has(String(value.date).slice(0, 10)));
}

function overlaps(a, b) {
  return minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);
}

function checkResult(passed, label, reason = '') {
  return { passed, label, reason };
}

/** Shared Hebrew wording for affected-meeting counts (1 = singular). */
export function formatAffectedMeetingsPhrase(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 1) return 'משפיע על מפגש אחד';
  return `משפיע על ${n} מפגשים`;
}

function formatDisplayDate(value) {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${match[3]}.${match[2]}.${match[1]}`;
}

/** User-facing persisted-activity reference: name, school, date when available. */
export function formatPersistedActivityReference(activity = {}, meetingDate = '') {
  const name = String(activity?.activity_name || '').trim();
  const school = String(activity?.school || '').trim();
  const date = formatDisplayDate(meetingDate || activity?.date);
  const parts = [];
  if (name) parts.push(name);
  if (school) parts.push(`בבית ספר ${school}`);
  if (date) parts.push(`ביום ${date}`);
  return parts.join(' ');
}

export function defaultAvailabilityForWeekday(weekday, profile = {}) {
  const normalized = normalizeSchedulingProfile(profile);
  return weekday === 6
    ? { available: false, start_time: null, end_time: null }
    : { available: weekday >= 0 && weekday <= 4, start_time: normalized.default_start_time, end_time: normalized.default_end_time };
}

export function adjacentActivities(existingActivities, meeting) {
  const day = existingActivities
    .filter((activity) => String(activity.date || '').slice(0, 10) === meeting.date)
    .sort((a, b) => minutes(a.start_time) - minutes(b.start_time));
  return {
    previous: [...day].reverse().find((activity) => minutes(activity.end_time) <= minutes(meeting.start_time)) || null,
    next: day.find((activity) => minutes(activity.start_time) >= minutes(meeting.end_time)) || null,
    day
  };
}

export function evaluateInstructor({
  instructor,
  profile: rawProfile,
  rules = [],
  exceptions = [],
  activity,
  existingActivities = [],
  travel = null,
  validateTravel = true,
  weeklyLoad = 0,
  averageWeeklyLoad = 0,
  workloadRatio = null,
  averageWorkloadRatio = null,
  fixedCourseCount = null,
  weeklyWorkDayCount = null,
  workloadPoints = null
}) {
  const profile = normalizeSchedulingProfile(rawProfile);
  const failures = [];
  const missingProfileData = [];
  const warnings = [];
  const scoreReasons = [];
  const schedule = [];
  const issues = [];
  const meetings = meetingRows(activity);
  const language = resolveInstructionLanguage(activity);
  const requiredGender = normalizeGender(activity.required_instructor_gender) || 'any';
  const profileGender = normalizeGender(profile.gender);
  const femaleInstructor = profileGender === 'female';

  if (String(instructor.active ?? 'yes').toLowerCase() === 'no' || instructor.active === false) failures.push('המדריך אינו פעיל');
  if (!String(instructor.address || '').trim()) missingProfileData.push('כתובת');

  let languageCheck = checkResult(null, 'שפה', 'לא נבדק');
  if (!profile.instruction_languages.length) {
    missingProfileData.push('לא ניתן לאמת שפת הדרכה');
    languageCheck = checkResult(false, 'לא ניתן לאמת שפת הדרכה', 'חסרה הגדרת שפת הדרכה בפרופיל');
  } else if (!profileSpeaksLanguage(profile.instruction_languages, language)) {
    const reason = 'שפת ההדרכה אינה תואמת';
    failures.push(`${reason}: נדרשת ${LANGUAGE_LABELS[language] || instructionLanguageLabel(language)}`);
    languageCheck = checkResult(false, `${LANGUAGE_LABELS[language] || instructionLanguageLabel(language)} - לא מתאים`, `${reason}: נדרשת ${LANGUAGE_LABELS[language] || instructionLanguageLabel(language)}`);
  } else {
    languageCheck = checkResult(true, `${LANGUAGE_LABELS[language] || instructionLanguageLabel(language)} - מתאים`, '');
  }

  let genderCheck = checkResult(null, 'מגדר', 'לא נבדק');
  if (requiredGender !== 'any' && !profileGender) {
    missingProfileData.push('מגדר');
    genderCheck = checkResult(false, 'חסר מגדר בפרופיל', 'חסר מגדר בפרופיל');
  } else if (requiredGender !== 'any' && profileGender !== requiredGender) {
    const reason = requiredGender === 'female' ? 'הקורס דורש מדריכה' : 'הקורס דורש מדריך';
    failures.push(reason);
    genderCheck = checkResult(false, femaleInstructor ? 'אינה עומדת בדרישה' : 'אינו עומד בדרישה', reason);
  } else if (requiredGender === 'any') {
    genderCheck = checkResult(true, 'ללא דרישת מגדר', '');
  } else {
    genderCheck = checkResult(true, femaleInstructor ? 'עומדת בדרישה' : 'עומד בדרישה', '');
  }

  const ruleMap = new Map(rules.map((rule) => [Number(rule.weekday), rule]));
  const exceptionMap = new Map(exceptions.map((exception) => [String(exception.exception_date).slice(0, 10), exception]));
  if (!rules.length) missingProfileData.push('זמינות שבועית');

  const addIssue = (kind, key, message, date, missing = false) => {
    let issue = issues.find((value) => value.kind === kind && value.key === key);
    if (!issue) {
      issue = { kind, key, message, dates: [], missing };
      issues.push(issue);
    }
    if (date && !issue.dates.includes(date)) issue.dates.push(date);
  };

  let sameSchool = 0;
  let sameAuthority = 0;
  let waitMinutes = 0;
  let separateTrips = 0;
  let schoolContinuityPoints = 0;
  let authorityContinuityPoints = 0;
  let availableMeetings = 0;
  const availabilityIssueKinds = new Set(['missing_availability', 'hours_unavailable', 'day_blocked', 'overlap']);
  const travelIssueKinds = new Set(['unverified_transition', 'insufficient_transition']);

  for (const meeting of meetings) {
    const weekday = new Date(`${meeting.date}T12:00:00`).getDay();
    if (weekday === 6) {
      failures.push(`הפעילות מתקיימת בשבת (${meeting.date})`);
      continue;
    }
    if (weekday === 5 && !profile.friday_allowed) failures.push(`יום שישי אינו מאושר (${meeting.date})`);

    const availability = exceptionMap.get(meeting.date) || ruleMap.get(weekday);
    if (!availability) {
      const day = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${meeting.date}T12:00:00`));
      addIssue('missing_availability', `${weekday}-${meeting.start_time}-${meeting.end_time}`, `לא הוגדרה זמינות לימי ${day} בשעות ${meeting.start_time}–${meeting.end_time}`, meeting.date, true);
      continue;
    }
    if (!availability.available || minutes(meeting.start_time) < minutes(availability.start_time) || minutes(meeting.end_time) > minutes(availability.end_time)) {
      addIssue(
        availability.available ? 'hours_unavailable' : 'day_blocked',
        `${weekday}-${meeting.start_time}-${meeting.end_time}`,
        availability.available ? `הזמינות המוגדרת אינה מכסה את שעות ${meeting.start_time}–${meeting.end_time}` : 'היום הקבוע חסום',
        meeting.date
      );
    } else {
      availableMeetings += 1;
    }

    const { previous, next, day } = adjacentActivities(existingActivities, meeting);
    const conflict = day.find((existing) => overlaps(meeting, existing));
    if (conflict) {
      const conflictRef = formatPersistedActivityReference(conflict, meeting.date);
      const conflictLabel = conflictRef || conflict.activity_name || 'פעילות אחרת';
      addIssue('overlap', String(conflict.activity_name || conflict.school || 'activity'), `חפיפה חוזרת עם ${conflictLabel}`, meeting.date);
    }

    const transition = travel?.transitions?.[meeting.date] || {};
    const inspect = (neighbor, leg, direction) => {
      if (!neighbor) return;
      const gap = direction === 'previous'
        ? minutes(meeting.start_time) - minutes(neighbor.end_time)
        : minutes(neighbor.start_time) - minutes(meeting.end_time);
      const required = leg?.duration_minutes;
      const label = direction === 'previous' ? 'מהפעילות הקודמת' : 'לפעילות הבאה';
      const neighborRef = formatPersistedActivityReference(neighbor, neighbor.date || meeting.date);
      const sameLocation = sameSchoolLocation(neighbor, activity);
      if (required == null && !sameLocation) {
        const message = neighborRef
          ? (direction === 'previous'
            ? `לא ניתן לאמת זמן מעבר לאחר ${neighborRef}`
            : `לא ניתן לאמת זמן מעבר לפני ${neighborRef}`)
          : `לא ניתן לאמת זמן מעבר ${label}`;
        addIssue('unverified_transition', direction, message, meeting.date);
      } else if (required != null && !sameLocation && gap < Number(required) + TRANSITION_BUFFER_MINUTES) {
        // Same-school neighbors do not require the travel buffer; it applies only to real moves.
        const needed = Number(required) + TRANSITION_BUFFER_MINUTES;
        const message = neighborRef
          ? (direction === 'previous'
            ? `אין זמן מעבר מספיק לאחר ${neighborRef}`
            : `אין זמן מעבר מספיק לפני ${neighborRef}`)
          : `אין זמן מעבר מספיק ${label} (${gap} דקות זמינות, ${needed} דקות נדרשות כולל מרווח בטיחות)`;
        addIssue('insufficient_transition', `${direction}-${required}-${gap}`, message, meeting.date);
      }
      // A given neighbor relationship counts once: same-school continuity takes priority
      // over same-authority continuity so the two point buckets never double-score it.
      if (sameSchoolLocation(neighbor, activity)) {
        sameSchool += 1;
        schoolContinuityPoints += gap <= 30 ? 10 : gap <= 90 ? 7 : 4;
      } else if (same(neighbor.authority, activity.authority)) {
        sameAuthority += 1;
        if (required != null && gap - required >= 15) authorityContinuityPoints += 8;
        else if (required != null) authorityContinuityPoints += 5;
        else authorityContinuityPoints += 3;
      }
      waitMinutes += Math.max(0, gap - (required || 0));
      if (gap > 120) separateTrips += 1;
    };
    if (validateTravel) {
      inspect(previous, transition.previous, 'previous');
      inspect(next, transition.next, 'next');
    }

    schedule.push({
      date: meeting.date,
      previous,
      next,
      previous_travel: transition.previous || null,
      next_travel: transition.next || null
    });
  }

  for (const issue of issues) {
    const summary = `${issue.message} - ${formatAffectedMeetingsPhrase(issue.dates.length)}`;
    (issue.missing ? missingProfileData : failures).push(summary);
  }

  const availabilityIssues = issues.filter((issue) => availabilityIssueKinds.has(issue.kind));
  let availabilityCheck;
  if (!rules.length) {
    availabilityCheck = checkResult(null, 'זמינות', 'לא נבדק — חסרה זמינות שבועית');
  } else if (availabilityIssues.length) {
    availabilityCheck = checkResult(false, 'לא זמין במלואו', availabilityIssues[0].message);
  } else if (meetings.length && availableMeetings === meetings.length) {
    availabilityCheck = checkResult(
      true,
      femaleInstructor ? `פנויה בכל ${meetings.length} המפגשים` : `פנוי בכל ${meetings.length} המפגשים`,
      ''
    );
  } else {
    availabilityCheck = checkResult(false, 'לא זמין במלואו', 'לא כל מועדי הקורס מכוסים בזמינות');
  }

  let travelCheck = checkResult(null, 'מרחק', 'לא נבדק');
  const travelIssues = issues.filter((issue) => travelIssueKinds.has(issue.kind));
  const homeKm = travel?.home?.distance_km;
  const homeMinutes = travel?.home?.duration_minutes;
  if (!validateTravel) {
    travelCheck = checkResult(null, 'מרחק', 'לא נבדק');
  } else if (travelIssues.length) {
    travelCheck = checkResult(false, 'מרחק', travelIssues[0].message);
  } else if (homeKm != null && Number.isFinite(Number(homeKm)) && homeMinutes != null && Number.isFinite(Number(homeMinutes))) {
    // Hard gate: one-way home→school driving distance must be ≤ 40 km (evaluated before scoring).
    if (exceedsHomeDistanceLimit(homeKm)) {
      const reason = homeDistanceLimitFailureMessage(homeKm);
      failures.push(reason);
      travelCheck = checkResult(false, 'מרחק', reason);
    } else {
      travelCheck = checkResult(true, `${Math.round(Number(homeKm))} ק״מ, ${Math.round(Number(homeMinutes))} דקות`, '');
    }
  } else if (travel?.unavailableReason === 'missing_instructor_address') {
    if (!missingProfileData.includes('כתובת')) missingProfileData.push('כתובת');
    travelCheck = checkResult(false, 'מרחק', 'חסרה כתובת מדריך');
  } else if (travel?.unavailableReason === 'missing_school_address') {
    missingProfileData.push('כתובת בית הספר');
    travelCheck = checkResult(false, 'מרחק', 'חסרה כתובת בית ספר');
  } else if (travel?.unavailableReason === 'service_unavailable' || travel?.unavailableReason === 'not_calculated') {
    missingProfileData.push('מסלול נסיעה אמין');
    travelCheck = checkResult(false, 'מרחק', 'שירות המרחקים לא היה זמין');
  } else if (travel && Object.prototype.hasOwnProperty.call(travel, 'home') && travel.home == null) {
    missingProfileData.push('מסלול נסיעה אמין');
    travelCheck = checkResult(false, 'מרחק', 'לא נמצא מסלול');
  } else if (validateTravel && travel && (homeKm == null || homeMinutes == null)) {
    missingProfileData.push('מסלול נסיעה אמין');
    travelCheck = checkResult(false, 'מרחק', 'לא נמצא מסלול');
  }

  if ((workloadRatio != null && averageWorkloadRatio != null && Number(workloadRatio) > Number(averageWorkloadRatio) * 1.5)
    || (weeklyLoad != null && averageWeeklyLoad != null && Number(weeklyLoad) > Number(averageWeeklyLoad) * 1.5)) {
    warnings.push('עומס שבועי גבוה ביחס לממוצע');
  }

  const checks = {
    gender: genderCheck,
    language: languageCheck,
    availability: availabilityCheck,
    travel: travelCheck,
    notes: checkResult(true, 'הערות', [activity.scheduling_note, profile.matching_note].filter(Boolean).join(' · '))
  };

  // 100-point rubric: distance/travel 40, continuity 30, load/fairness 20,
  // seniority 10. Availability, language and gender are gating checks only.
  let score = failures.length || missingProfileData.length ? null : 0;
  let scoreBreakdown = null;
  if (score !== null) {
    if (language) scoreReasons.push(`מתאים לשפה ${LANGUAGE_LABELS[language]}`);
    scoreReasons.push(femaleInstructor ? 'פנויה בכל המפגשים' : 'פנוי בכל המפגשים');

    let continuityPoints = 0;
    let continuityLabel = 'אין רציפות בבית הספר או ברשות';
    const hasSchoolContinuity = sameSchool || existingActivities.some((other) => same(other.school, activity.school));
    const hasAuthorityContinuity = !hasSchoolContinuity && (sameAuthority || existingActivities.some((other) => same(other.authority, activity.authority)));
    if (hasSchoolContinuity) {
      continuityPoints = 30;
      continuityLabel = 'רציפות באותו בית ספר';
      scoreReasons.push('רציפות באותו בית ספר במחצית הנבחרת');
    } else if (hasAuthorityContinuity) {
      continuityPoints = 20;
      continuityLabel = 'רציפות באותה רשות';
      scoreReasons.push('רציפות באותה רשות במחצית הנבחרת');
    }

    let distancePoints = 0;
    if (travel?.home?.distance_km != null && Number.isFinite(Number(travel.home.distance_km))) {
      const km = Number(travel.home.distance_km);
      scoreReasons.push(`${Math.round(km)} ק״מ מהבית, ${Math.round(Number(travel.home.duration_minutes) || 0)} דקות נסיעה`);
      distancePoints = Math.max(0, 40 - km);
    } else {
      scoreReasons.push('המרחק טרם חושב');
    }

    const workloadBreakdown = workloadPoints || { points: 20, totalHoursPoints: 12, courseWeeksPoints: 8, label: 'עומס וחלוקה שוויונית' };
    const seniorityYears = Math.max(0, Math.floor(Number(profile.seniority_years ?? profile.years_of_experience ?? instructor.seniority_years ?? 0) || 0));
    const seniorityPoints = Math.min(10, seniorityYears);
    if (seniorityPoints) scoreReasons.push(`${seniorityPoints} נקודות ותק`);

    if (failures.length || missingProfileData.length) {
      score = null;
      scoreBreakdown = null;
    } else {
      const roundedDistance = Math.round(Math.max(0, Math.min(40, distancePoints)));
      const roundedContinuity = Math.round(continuityPoints);
      const roundedWorkload = Math.round(Math.max(0, Math.min(20, Number(workloadBreakdown.points) || 0)));
      const roundedSeniority = Math.round(seniorityPoints);
      score = roundedDistance + roundedContinuity + roundedWorkload + roundedSeniority;
      scoreBreakdown = {
        distance: { points: roundedDistance, label: 'מרחק ונסיעה', distance_km: travel?.home?.distance_km ?? null, duration_minutes: travel?.home?.duration_minutes ?? null },
        continuity: { points: roundedContinuity, label: continuityLabel },
        workload: { points: roundedWorkload, label: 'עומס וחלוקה שוויונית', totalHoursPoints: workloadBreakdown.totalHoursPoints, courseWeeksPoints: workloadBreakdown.courseWeeksPoints, totalHours: workloadBreakdown.totalHours, courseWeeksHours: workloadBreakdown.courseWeeksHours },
        seniority: { points: roundedSeniority, label: 'ותק' },
        gateNote: 'פעילות, כתובת, זמינות, שפה ומגדר כאשר נדרש הם תנאי סף ואינם מוסיפים נקודות.'
      };
    }
  }

  const eligible = !failures.length && !missingProfileData.length;
  return {
    eligible,
    score,
    ...schedulingQualityBand(score, eligible),
    failures: [...new Set(failures)],
    missingProfileData: [...new Set(missingProfileData)],
    warnings: [...new Set(warnings)],
    explanation: [...scoreReasons, ...warnings].join(', '),
    scoreReasons,
    scoreBreakdown,
    checks,
    schedule,
    issues
  };
}

export function rankInstructors(input) {
  const candidates = input.instructors.map((instructor) => ({
    instructor,
    ...evaluateInstructor({
      ...input,
      instructor,
      profile: input.profiles?.[String(instructor.emp_id)],
      rules: input.rules?.[String(instructor.emp_id)] || [],
      exceptions: input.exceptions?.[String(instructor.emp_id)] || [],
      existingActivities: input.assignments?.[String(instructor.emp_id)] || [],
      travel: input.travel?.[String(instructor.emp_id)] || null,
      weeklyLoad: input.weeklyLoads?.[String(instructor.emp_id)] || 0,
      averageWeeklyLoad: Number(input.averageWeeklyLoad) || 0,
      workloadRatio: input.workloadRatios?.[String(instructor.emp_id)] ?? null,
      averageWorkloadRatio: input.averageWorkloadRatio ?? null,
      fixedCourseCount: input.fixedCourseCounts?.[String(instructor.emp_id)] ?? null,
      weeklyWorkDayCount: input.weeklyWorkDayCounts?.[String(instructor.emp_id)] ?? null
    })
  }));
  return {
    recommended: candidates.filter((candidate) => candidate.qualityBand === 'recommended' && !candidate.warnings.length).sort((a, b) => b.score - a.score),
    exceptions: candidates.filter((candidate) => candidate.eligible && (candidate.qualityBand !== 'recommended' || candidate.warnings.length)).sort((a, b) => b.score - a.score),
    incomplete: candidates.filter((candidate) => !candidate.failures.length && candidate.missingProfileData.length),
    rejected: candidates.filter((candidate) => candidate.failures.length)
  };
}
