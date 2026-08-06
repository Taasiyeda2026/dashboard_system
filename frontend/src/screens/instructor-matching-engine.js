import { instructionLanguageLabel, profileSpeaksLanguage, resolveInstructionLanguage } from './shared/instruction-language.js';
import { computeSchedulingScore, SCORE_WEIGHTS } from './course-scheduling-score.js';

export { SCORE_WEIGHTS };

const LANGUAGE_LABELS = { he: 'עברית', ar: 'ערבית' };
export const DEFAULT_SCHEDULING_PROFILE = Object.freeze({
  gender: null,
  instruction_languages: [],
  friday_allowed: false,
  default_start_time: '08:00',
  default_end_time: '15:00',
  matching_note: null,
});

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

function normText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

function normId(value) {
  return String(value ?? '').trim();
}

function meetingRows(activity) {
  const dates = Array.isArray(activity.meetings)
    ? activity.meetings
    : Array.from({ length: 35 }, (_, index) => activity[`date_${index + 1}`])
      .filter(Boolean)
      .map((date) => ({ date, start_time: activity.start_time, end_time: activity.end_time }));
  return dates
    .map((value) => typeof value === 'string'
      ? { date: value, start_time: activity.start_time, end_time: activity.end_time }
      : value)
    .filter((value) => value.date);
}

function overlaps(a, b) {
  return minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time);
}

function checkResult(passed, label, reason = '') {
  return { passed, label, reason };
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
  workloadPoints = null,
  dateAdjustment = null,
  currentHalfHours = null,
  projectedHalfHours = null,
  peerProjectedHours = null,
  activeWorkDays = null,
  workDates = null
}) {
  void workloadPoints;
  void fixedCourseCount;
  void weeklyWorkDayCount;
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
  if (requiredGender === 'any') {
    genderCheck = checkResult(true, 'ללא דרישת מגדר', '');
  } else if (!profileGender) {
    missingProfileData.push('לא ניתן לאמת התאמה לדרישת המגדר');
    genderCheck = checkResult(false, 'לא ניתן לאמת התאמה לדרישת המגדר', 'חסר מגדר בפרופיל');
  } else if (profileGender !== requiredGender) {
    const reason = requiredGender === 'female' ? 'הקורס דורש מדריכה' : 'הקורס דורש מדריך';
    failures.push(reason);
    genderCheck = checkResult(false, femaleInstructor ? 'אינה עומדת בדרישה' : 'אינו עומד בדרישה', reason);
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
    if (conflict) addIssue('overlap', String(conflict.activity_name || conflict.school || 'activity'), `חפיפה חוזרת עם ${conflict.activity_name || 'פעילות אחרת'}`, meeting.date);

    const transition = travel?.transitions?.[meeting.date] || {};
    const inspect = (neighbor, leg, direction) => {
      if (!neighbor) return;
      const gap = direction === 'previous'
        ? minutes(meeting.start_time) - minutes(neighbor.end_time)
        : minutes(neighbor.start_time) - minutes(meeting.end_time);
      const required = leg?.duration_minutes;
      const label = direction === 'previous' ? 'מהפעילות הקודמת' : 'לפעילות הבאה';
      if (required == null && !same(neighbor.school, activity.school)) addIssue('unverified_transition', direction, `לא ניתן לאמת זמן מעבר ${label}`, meeting.date);
      else if (required != null && gap < required) addIssue('insufficient_transition', `${direction}-${required}-${gap}`, `אין זמן מעבר מספיק ${label} (${gap} דקות זמינות, ${required} דקות נסיעה)`, meeting.date);
    };
    if (validateTravel) {
      inspect(previous, transition.previous, 'previous');
      inspect(next, transition.next, 'next');
    }

    const ordered = [...day, meeting].sort((a, b) => minutes(a.start_time) - minutes(b.start_time));
    let continuous = 1;
    let max = 1;
    for (let index = 1; index < ordered.length; index += 1) {
      continuous = minutes(ordered[index].start_time) - minutes(ordered[index - 1].end_time) <= 30 ? continuous + 1 : 1;
      max = Math.max(max, continuous);
    }
    const duration = minutes(meeting.end_time) - minutes(meeting.start_time);
    if ((duration >= 80 && max > 3) || (duration < 80 && max > 5)) failures.push(`הרצף היומי חורג מהמותר בתאריך ${meeting.date}`);

    schedule.push({
      date: meeting.date,
      previous,
      next,
      previous_travel: transition.previous || null,
      next_travel: transition.next || null
    });
  }

  for (const issue of issues) {
    const summary = `${issue.message} — משפיע על ${issue.dates.length} מפגשים.`;
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
    travelCheck = checkResult(true, `${Math.round(Number(homeKm))} ק״מ, ${Math.round(Number(homeMinutes))} דקות`, '');
  } else if (travel?.unavailableReason === 'missing_instructor_address') {
    travelCheck = checkResult(null, 'מרחק', 'חסרה כתובת מדריך');
  } else if (travel?.unavailableReason === 'missing_school_address') {
    travelCheck = checkResult(null, 'מרחק', 'חסרה כתובת בית ספר');
  } else if (travel?.unavailableReason === 'service_unavailable') {
    travelCheck = checkResult(null, 'מרחק', 'שירות המרחקים לא היה זמין');
  } else if (travel && Object.prototype.hasOwnProperty.call(travel, 'home') && travel.home == null) {
    travelCheck = checkResult(null, 'מרחק', 'לא נמצא מסלול');
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

  const eligible = !failures.length && !missingProfileData.length;
  if (language && eligible) scoreReasons.push(`מתאים לשפה ${LANGUAGE_LABELS[language]}`);
  if (eligible) scoreReasons.push(femaleInstructor ? 'פנויה בכל המפגשים' : 'פנוי בכל המפגשים');

  const inferredCurrentHours = currentHalfHours != null
    ? Number(currentHalfHours)
    : existingActivities.reduce((sum, row) => {
      const start = minutes(row.start_time);
      const end = minutes(row.end_time);
      return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0);
    }, 0);
  const meetingHours = meetings.reduce((sum, meeting) => {
    const start = minutes(meeting.start_time || activity.start_time);
    const end = minutes(meeting.end_time || activity.end_time);
    return sum + (Number.isFinite(start) && Number.isFinite(end) && end > start ? (end - start) / 60 : 0);
  }, 0);
  const inferredProjected = projectedHalfHours != null ? Number(projectedHalfHours) : inferredCurrentHours + meetingHours;
  const inferredWorkDays = activeWorkDays != null
    ? Number(activeWorkDays)
    : new Set([
      ...existingActivities.map((row) => String(row.date || '').slice(0, 10)),
      ...meetings.map((meeting) => String(meeting.date || '').slice(0, 10))
    ].filter(Boolean)).size;

  const scored = computeSchedulingScore({
    eligible,
    activity,
    meetings,
    existingActivities,
    travel,
    workDates: workDates || new Set(existingActivities.map((row) => String(row.date || '').slice(0, 10)).filter(Boolean)),
    dateAdjustment,
    currentHalfHours: inferredCurrentHours,
    projectedHalfHours: inferredProjected,
    peerProjectedHours: peerProjectedHours || [inferredProjected],
    activeWorkDays: inferredWorkDays,
    scoreReasons
  });

  if (scored.recommendationReason) scoreReasons.push(scored.recommendationReason);

  return {
    eligible,
    score: scored.score,
    ...schedulingQualityBand(scored.score, eligible),
    failures: [...new Set(failures)],
    missingProfileData: [...new Set(missingProfileData)],
    warnings: [...new Set(warnings)],
    explanation: [...new Set([...scoreReasons, ...warnings])].join(', '),
    recommendationReason: scored.recommendationReason || '',
    scoreReasons,
    scoreBreakdown: scored.scoreBreakdown,
    checks,
    schedule,
    issues,
    currentHalfHours: scored.currentHalfHours,
    projectedHalfHours: scored.projectedHalfHours,
    activeWorkDays: scored.activeWorkDays,
    relevantTravelMinutes: scored.relevantTravelMinutes,
    relevantTravelDistance: scored.relevantTravelDistance,
    dailyTravelMinutes: scored.dailyTravelMinutes,
    movedMeetingsCount: scored.movedMeetingsCount,
    totalShiftDays: scored.totalShiftDays,
    originalEndDate: scored.originalEndDate,
    proposedEndDate: scored.proposedEndDate,
    halfOverflow: scored.halfOverflow,
    opensNewWorkDay: scored.opensNewWorkDay,
    gapBeforeMinutes: scored.gapBeforeMinutes,
    gapAfterMinutes: scored.gapAfterMinutes,
    nonTravelWaitingMinutes: scored.nonTravelWaitingMinutes,
    hasSameSchoolDay: scored.hasSameSchoolDay,
    hasSameAuthorityDay: scored.hasSameAuthorityDay
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
