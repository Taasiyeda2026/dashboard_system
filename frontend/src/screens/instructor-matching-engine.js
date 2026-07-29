const EDUCATION_LABELS = { elementary: 'יסודי', middle_school: 'חטיבת ביניים', high_school: 'תיכון' };
const LANGUAGE_LABELS = { he: 'עברית', ar: 'ערבית' };

export function deriveEducationLevel(grade) {
  const value = String(grade || '').trim().toLowerCase();
  if (/^(א|ב|ג|ד|ה|ו|1|2|3|4|5|6)$/.test(value)) return 'elementary';
  if (/^(ז|ח|ט|7|8|9)$/.test(value)) return 'middle_school';
  if (/^(י|יא|יב|10|11|12)$/.test(value)) return 'high_school';
  return '';
}

function minutes(value) {
  const [h, m] = String(value || '00:00').split(':').map(Number);
  return h * 60 + m;
}
function meetingRows(activity) {
  const dates = Array.isArray(activity.meetings) ? activity.meetings : Array.from({ length: 35 }, (_, i) => activity[`date_${i + 1}`]).filter(Boolean).map(date => ({ date, start_time: activity.start_time, end_time: activity.end_time }));
  return dates.map(item => typeof item === 'string' ? { date: item, start_time: activity.start_time, end_time: activity.end_time } : item).filter(item => item.date);
}
function overlaps(a, b) { return minutes(a.start_time) < minutes(b.end_time) && minutes(b.start_time) < minutes(a.end_time); }
function list(value) { return Array.isArray(value) ? value.map(String) : []; }
function same(value, candidate) { return String(value || '').trim() === String(candidate || '').trim(); }

export function evaluateInstructor({ instructor, profile = {}, rules = [], exceptions = [], activity, existingActivities = [], travel = null, weeklyLoad = 0, averageWeeklyLoad = 0 }) {
  const failures = [], warnings = [], positives = [];
  const meetings = meetingRows(activity);
  const language = activity.instruction_language || 'he';
  const gender = activity.required_instructor_gender || 'any';
  const education = activity.education_level || deriveEducationLevel(activity.grade);
  const empId = String(instructor.emp_id || '');
  if (String(instructor.active ?? 'yes').toLowerCase() === 'no' || instructor.active === false) failures.push('המדריך אינו פעיל');
  if (!String(instructor.address || '').trim()) failures.push('חסרה כתובת מדריך');
  if (!list(profile.instruction_languages).includes(language)) failures.push(`אינו מדריך ב${LANGUAGE_LABELS[language] || language}`);
  if (gender !== 'any' && profile.gender !== gender) failures.push(gender === 'female' ? 'הפעילות מחייבת מדריכה' : 'הפעילות מחייבת מדריך');
  if (education && !list(profile.education_levels).includes(education)) failures.push(`אינו מתאים לשכבת ${EDUCATION_LABELS[education]}`);
  const courseId = String(activity.course_id || activity.activity_no || activity.activity_name || '');
  const courses = list(profile.course_ids);
  if (profile.course_restriction_mode === 'allow_only' && !courses.includes(courseId)) failures.push('המדריך מתאים רק לקורסים אחרים');
  if (profile.course_restriction_mode === 'block_selected' && courses.includes(courseId)) failures.push('הקורס חסום עבור המדריך');
  if (list(profile.blocked_authorities).some(v => same(v, activity.authority_id || activity.authority))) failures.push('הרשות חסומה עבור המדריך');
  if (list(profile.blocked_schools).some(v => same(v, activity.school_id || activity.school))) failures.push('בית הספר חסום עבור המדריך');
  if (list(activity.blocked_instructor_ids).includes(empId)) failures.push('המדריך חסום בפעילות זו');
  const allowed = list(activity.allowed_instructor_ids);
  if (allowed.length && !allowed.includes(empId)) failures.push('המדריך אינו ברשימת המדריכים המותרים');
  const ruleMap = new Map(rules.map(r => [Number(r.weekday), r]));
  const exceptionMap = new Map(exceptions.map(e => [String(e.exception_date).slice(0, 10), e]));
  for (const meeting of meetings) {
    const weekday = new Date(`${meeting.date}T12:00:00`).getDay();
    if (weekday === 6) { failures.push(`הפעילות מתקיימת בשבת (${meeting.date})`); continue; }
    if (weekday === 5 && !profile.friday_allowed) failures.push(`יום שישי אינו מאושר (${meeting.date})`);
    const availability = exceptionMap.get(meeting.date) || ruleMap.get(weekday);
    if (!availability?.available || (availability.start_time && minutes(meeting.start_time) < minutes(availability.start_time)) || (availability.end_time && minutes(meeting.end_time) > minutes(availability.end_time))) failures.push(`אין זמינות מלאה בתאריך ${meeting.date}`);
    const dayActivities = existingActivities.filter(a => String(a.date || '').slice(0, 10) === meeting.date);
    if (dayActivities.some(a => overlaps(meeting, a))) failures.push(`חפיפה עם פעילות אחרת בתאריך ${meeting.date}`);
    const ordered = [...dayActivities, meeting].sort((a,b) => minutes(a.start_time)-minutes(b.start_time));
    let continuous = 1, maxContinuous = 1;
    for (let i=1;i<ordered.length;i++) { continuous = minutes(ordered[i].start_time)-minutes(ordered[i-1].end_time) <= 30 ? continuous+1 : 1; maxContinuous=Math.max(maxContinuous,continuous); }
    const duration = minutes(meeting.end_time)-minutes(meeting.start_time);
    if ((duration >= 80 && maxContinuous > 3) || (duration < 80 && maxContinuous > 5)) failures.push(`הרצף היומי חורג מהמותר בתאריך ${meeting.date}`);
  }
  if (!failures.length) {
    positives.push(`מתאים לשפה ${LANGUAGE_LABELS[language] || language}`);
    if (education) positives.push(`מתאים לשכבת ${EDUCATION_LABELS[education]}`);
    positives.push(profile.gender === 'female' ? 'פנויה בכל המפגשים' : 'פנוי בכל המפגשים');
  }
  let score = failures.length ? null : 100;
  if (score !== null && travel?.distance_km != null) {
    positives.push(`${Math.round(travel.distance_km)} ק״מ מהבית, ${Math.round(travel.duration_minutes)} דקות נסיעה`);
    score -= Math.min(30, Math.max(0, travel.distance_km - 10) * 0.6);
    if (travel.distance_km > 40) warnings.push('מרחק הבית עולה על 40 ק״מ');
  } else if (score !== null) warnings.push('המרחק טרם חושב');
  if (score !== null) {
    score -= Math.min(18, weeklyLoad * 2);
    if (weeklyLoad > averageWeeklyLoad + 2) warnings.push('עומס שבועי גבוה מהממוצע');
    score = Math.max(0, Math.round(score));
  }
  return { eligible: !failures.length, score, failures: [...new Set(failures)], warnings: [...new Set(warnings)], explanation: [...positives, ...warnings].join(', ') };
}

export function rankInstructors(input) {
  const candidates = input.instructors.map(instructor => ({ instructor, ...evaluateInstructor({ ...input, instructor, profile: input.profiles?.[String(instructor.emp_id)] || {}, rules: input.rules?.[String(instructor.emp_id)] || [], exceptions: input.exceptions?.[String(instructor.emp_id)] || [], existingActivities: input.assignments?.[String(instructor.emp_id)] || [], travel: input.travel?.[String(instructor.emp_id)] || null, weeklyLoad: input.weeklyLoads?.[String(instructor.emp_id)] || 0, averageWeeklyLoad: input.averageWeeklyLoad || 0 }) }));
  return { recommended: candidates.filter(c => c.eligible && !c.warnings.length).sort((a,b)=>b.score-a.score), exceptions: candidates.filter(c => c.eligible && c.warnings.length).sort((a,b)=>b.score-a.score), rejected: candidates.filter(c => !c.eligible) };
}
