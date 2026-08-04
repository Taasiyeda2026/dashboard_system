import { instructionLanguageLabel, profileSpeaksLanguage, resolveInstructionLanguage } from './shared/instruction-language.js';

const LANGUAGE_LABELS = { he: 'עברית', ar: 'ערבית' };

export const DEFAULT_SCHEDULING_PROFILE = Object.freeze({
  gender: null,
  instruction_languages: [],
  education_levels: [],
  course_restriction_mode: 'all',
  course_ids: [],
  blocked_authorities: [],
  blocked_schools: [],
  friday_allowed: false,
  default_start_time: '08:00',
  default_end_time: '15:00',
  weekly_target_hours: null,
  weekly_max_hours: null,
  preferred_work_days: null,
  max_fixed_courses: null
});

export function normalizeSchedulingProfile(profile = {}) {
  return {
    ...DEFAULT_SCHEDULING_PROFILE,
    ...(profile || {}),
    instruction_languages: Array.isArray(profile?.instruction_languages) ? profile.instruction_languages : [],
    education_levels: Array.isArray(profile?.education_levels) ? profile.education_levels : [],
    course_ids: Array.isArray(profile?.course_ids) ? profile.course_ids : [],
    blocked_authorities: Array.isArray(profile?.blocked_authorities) ? profile.blocked_authorities : [],
    blocked_schools: Array.isArray(profile?.blocked_schools) ? profile.blocked_schools : []
  };
}

export function deriveEducationLevel(grade) {
  const value = String(grade || '').trim().toLowerCase();
  if (/^(א|ב|ג|ד|ה|ו|1|2|3|4|5|6)$/.test(value)) return 'elementary';
  if (/^(ז|ח|ט|7|8|9)$/.test(value)) return 'middle_school';
  if (/^(י|יא|יב|10|11|12)$/.test(value)) return 'high_school';
  return '';
}

const minutes = (value) => {
  const [hours, mins] = String(value || '00:00').split(':').map(Number);
  return hours * 60 + mins;
};
const list = (value) => Array.isArray(value) ? value.map(String) : [];
const same = (a, b) => String(a || '').trim() === String(b || '').trim();

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
  weeklyWorkDayCount = null
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
  const gender = activity.required_instructor_gender || 'any';
  const empId = String(instructor.emp_id || '');

  if (String(instructor.active ?? 'yes').toLowerCase() === 'no' || instructor.active === false) failures.push('המדריך אינו פעיל');
  if (!String(instructor.address || '').trim()) missingProfileData.push('כתובת');

  if (!profile.instruction_languages.length) missingProfileData.push('שפות הדרכה');
  else if (!profileSpeaksLanguage(profile.instruction_languages, language)) {
    failures.push(`המדריך אינו דובר ${LANGUAGE_LABELS[language] || instructionLanguageLabel(language)}, שפת ההדרכה של הקורס`);
  }

  if (gender !== 'any' && !profile.gender) missingProfileData.push('מגדר');
  else if (gender !== 'any' && profile.gender !== gender) failures.push(gender === 'female'
    ? 'הקורס דורש מדריכה והמדריך אינו עומד בדרישת המגדר.'
    : 'הקורס דורש מדריך והמדריך אינו עומד בדרישת המגדר.');

  const educationLevel = String(activity.education_level || deriveEducationLevel(activity.grade));
  if (educationLevel && !profile.education_levels.length) missingProfileData.push('שכבות גיל');
  else if (educationLevel && !profile.education_levels.includes(educationLevel)) failures.push('המדריך אינו מתאים לשכבת הגיל');

  const courseId = String(activity.course_id || activity.activity_no || activity.activity_name || '');
  const courses = list(profile.course_ids);
  if (!rawProfile || !Object.prototype.hasOwnProperty.call(rawProfile, 'course_restriction_mode')) missingProfileData.push('התאמה לקורסים');
  if (profile.course_restriction_mode === 'allow_only' && !courses.includes(courseId)) failures.push('המדריך מתאים רק לקורסים אחרים');
  if (profile.course_restriction_mode === 'block_selected' && courses.includes(courseId)) failures.push('הקורס חסום עבור המדריך');
  if (list(profile.blocked_authorities).some((value) => same(value, activity.authority_id || activity.authority))) failures.push('הרשות חסומה עבור המדריך');
  if (list(profile.blocked_schools).some((value) => same(value, activity.school_id || activity.school))) failures.push('בית הספר חסום עבור המדריך');
  if (list(activity.blocked_instructor_ids).includes(empId)) failures.push('המדריך חסום בפעילות זו');
  if (list(activity.allowed_instructor_ids).length && !list(activity.allowed_instructor_ids).includes(empId)) failures.push('המדריך אינו ברשימת המדריכים המותרים');

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
      // A given neighbor relationship counts once: same-school continuity takes priority
      // over same-authority continuity so the two point buckets never double-score it.
      if (same(neighbor.school, activity.school)) {
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

  // 100-point rubric (spec section 15): school continuity <=30, authority continuity
  // <=20, load/fairness <=25, distance/travel <=15, daily continuity <=5, professional
  // experience <=5. Language/gender/blocks are gating conditions above, never points.
  let score = failures.length || missingProfileData.length ? null : 0;
  if (score !== null) {
    if (language) scoreReasons.push(`מתאים לשפה ${LANGUAGE_LABELS[language]}`);
    scoreReasons.push(profile.gender === 'female' ? 'פנויה בכל המפגשים' : 'פנוי בכל המפגשים');

    if (sameSchool) scoreReasons.push(`${sameSchool} חיבורים באותו בית ספר`);
    if (sameAuthority) scoreReasons.push(`${sameAuthority} חיבורים באותה רשות`);
    // A same-day adjacency already earned points above; only add the smaller "same
    // school/authority on another day" bonus when no adjacency was found, so the same
    // relationship is never scored twice.
    const hasOtherDaySchoolMatch = !schoolContinuityPoints && existingActivities.some((other) => same(other.school, activity.school));
    const hasOtherDayAuthorityMatch = !schoolContinuityPoints && !authorityContinuityPoints && existingActivities.some((other) => same(other.authority, activity.authority));
    const schoolPoints = Math.min(30, schoolContinuityPoints + (hasOtherDaySchoolMatch ? 4 : 0));
    const authorityPoints = Math.min(20, authorityContinuityPoints + (hasOtherDayAuthorityMatch ? 3 : 0));

    let distancePoints;
    if (travel?.home?.distance_km != null) {
      scoreReasons.push(`${Math.round(travel.home.distance_km)} ק״מ מהבית, ${Math.round(travel.home.duration_minutes)} דקות נסיעה`);
      distancePoints = Math.max(0, 15 - Math.max(0, travel.home.distance_km - 5) * 0.3);
      if (travel.home.distance_km > 40) warnings.push('מרחק הבית עולה על 40 ק״מ');
    } else {
      distancePoints = 0;
      scoreReasons.push('המרחק טרם חושב');
    }
    if (waitMinutes) {
      distancePoints = Math.max(0, distancePoints - waitMinutes / 60);
      scoreReasons.push(`${waitMinutes} דקות המתנה מצטברות`);
    }
    if (separateTrips) {
      distancePoints = Math.max(0, distancePoints - separateTrips * 2);
      scoreReasons.push(`${separateTrips} נסיעות נפרדות`);
    }
    distancePoints = Math.min(15, distancePoints);

    const dailyContinuityPoints = Math.max(0, Math.min(5, 5 - Math.floor(waitMinutes / 90)));

    let loadPoints = 25;
    const ratioProvided = workloadRatio !== null && workloadRatio !== undefined && workloadRatio !== '';
    const ratio = ratioProvided ? Number(workloadRatio) : Number.NaN;
    if (ratioProvided && Number.isFinite(ratio)) {
      loadPoints = 25 * Math.max(0, 1 - Math.min(1, ratio));
      scoreReasons.push(`עומס שבועי צפוי: ${Math.round(ratio * 100)}% מהזמינות`);
      if (ratio > 1) { loadPoints = 0; warnings.push('העומס השבועי חורג מהיקף הזמינות'); }
      else if (averageWorkloadRatio !== null && averageWorkloadRatio !== undefined && Number.isFinite(Number(averageWorkloadRatio)) && ratio > Number(averageWorkloadRatio) + 0.2) warnings.push('העומס השבועי גבוה משמעותית מהממוצע');
    } else if (weeklyLoad || averageWeeklyLoad) {
      loadPoints = Math.max(0, 25 - weeklyLoad * 3.5);
      scoreReasons.push(`עומס שבועי: ${weeklyLoad} מפגשים`);
      if (weeklyLoad > averageWeeklyLoad + 2) warnings.push('עומס שבועי גבוה מהממוצע');
    }
    if (fixedCourseCount != null && profile.max_fixed_courses != null && Number.isFinite(Number(fixedCourseCount)) && Number.isFinite(Number(profile.max_fixed_courses)) && Number(fixedCourseCount) > Number(profile.max_fixed_courses)) {
      loadPoints = Math.min(loadPoints, 8);
      warnings.push('מספר הקורסים הקבועים חורג מהמקסימום שהוגדר למדריך');
    }
    if (weeklyWorkDayCount != null && profile.preferred_work_days != null && Number.isFinite(Number(weeklyWorkDayCount)) && Number.isFinite(Number(profile.preferred_work_days)) && Number(weeklyWorkDayCount) > Number(profile.preferred_work_days)) {
      loadPoints = Math.max(0, loadPoints - 5);
      warnings.push('מספר ימי העבודה השבועיים חורג מהרצוי למדריך');
    }
    loadPoints = Math.max(0, Math.min(25, loadPoints));

    let experiencePoints = 0;
    const hasPriorCourseExperience = !!String(activity.activity_name || '').trim()
      && existingActivities.some((other) => same(other.activity_name, activity.activity_name));
    if (profile.course_restriction_mode === 'allow_only' && courseId && courses.includes(courseId)) {
      experiencePoints = 5;
      scoreReasons.push('הוכשר/ה ייעודית לתוכנית');
    } else if (hasPriorCourseExperience) {
      experiencePoints = 3;
      scoreReasons.push('ניסיון קודם בתוכנית');
    }

    score = Math.round(schoolPoints) + Math.round(authorityPoints) + Math.round(loadPoints) + Math.round(distancePoints) + dailyContinuityPoints + experiencePoints;
    score = Math.max(0, Math.min(100, score));
  }

  return {
    eligible: !failures.length && !missingProfileData.length,
    score,
    failures: [...new Set(failures)],
    missingProfileData: [...new Set(missingProfileData)],
    warnings: [...new Set(warnings)],
    explanation: [...scoreReasons, ...warnings].join(', '),
    scoreReasons,
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
    recommended: candidates.filter((candidate) => candidate.eligible && !candidate.warnings.length).sort((a, b) => b.score - a.score),
    exceptions: candidates.filter((candidate) => candidate.eligible && candidate.warnings.length).sort((a, b) => b.score - a.score),
    incomplete: candidates.filter((candidate) => candidate.missingProfileData.length),
    rejected: candidates.filter((candidate) => !candidate.eligible && !candidate.missingProfileData.length)
  };
}
