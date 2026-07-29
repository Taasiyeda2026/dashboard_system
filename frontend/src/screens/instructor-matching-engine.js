const EDUCATION_LABELS = { elementary: 'יסודי', middle_school: 'חטיבת ביניים', high_school: 'תיכון' };
const LANGUAGE_LABELS = { he: 'עברית', ar: 'ערבית' };
export const DEFAULT_SCHEDULING_PROFILE = Object.freeze({
  gender: null, instruction_languages: ['he'], education_levels: ['elementary', 'middle_school', 'high_school'],
  course_restriction_mode: 'all', course_ids: [], blocked_authorities: [], blocked_schools: [], friday_allowed: false,
  default_start_time: '08:00', default_end_time: '15:00'
});
export function normalizeSchedulingProfile(profile = {}) {
  return { ...DEFAULT_SCHEDULING_PROFILE, ...(profile || {}), instruction_languages: Array.isArray(profile?.instruction_languages) ? profile.instruction_languages : DEFAULT_SCHEDULING_PROFILE.instruction_languages, education_levels: Array.isArray(profile?.education_levels) ? profile.education_levels : DEFAULT_SCHEDULING_PROFILE.education_levels, course_ids: Array.isArray(profile?.course_ids) ? profile.course_ids : [], blocked_authorities: Array.isArray(profile?.blocked_authorities) ? profile.blocked_authorities : [], blocked_schools: Array.isArray(profile?.blocked_schools) ? profile.blocked_schools : [] };
}
export function deriveEducationLevel(grade) {
  const value = String(grade || '').trim().toLowerCase();
  if (/^(א|ב|ג|ד|ה|ו|1|2|3|4|5|6)$/.test(value)) return 'elementary';
  if (/^(ז|ח|ט|7|8|9)$/.test(value)) return 'middle_school';
  if (/^(י|יא|יב|10|11|12)$/.test(value)) return 'high_school';
  return '';
}
const minutes = value => { const [h,m]=String(value || '00:00').split(':').map(Number); return h*60+m; };
const list = value => Array.isArray(value) ? value.map(String) : [];
const same = (a,b) => String(a || '').trim() === String(b || '').trim();
function meetingRows(activity) { const dates=Array.isArray(activity.meetings) ? activity.meetings : Array.from({length:35},(_,i)=>activity[`date_${i+1}`]).filter(Boolean).map(date=>({date,start_time:activity.start_time,end_time:activity.end_time})); return dates.map(x=>typeof x==='string'?{date:x,start_time:activity.start_time,end_time:activity.end_time}:x).filter(x=>x.date); }
function overlaps(a,b) { return minutes(a.start_time)<minutes(b.end_time) && minutes(b.start_time)<minutes(a.end_time); }
export function defaultAvailabilityForWeekday(weekday, profile = {}) { const p=normalizeSchedulingProfile(profile); return weekday===6 ? {available:false,start_time:null,end_time:null} : {available:weekday>=0&&weekday<=4,start_time:p.default_start_time,end_time:p.default_end_time}; }
export function adjacentActivities(existingActivities, meeting) {
  const day=existingActivities.filter(a=>String(a.date || '').slice(0,10)===meeting.date).sort((a,b)=>minutes(a.start_time)-minutes(b.start_time));
  return { previous:[...day].reverse().find(a=>minutes(a.end_time)<=minutes(meeting.start_time)) || null, next:day.find(a=>minutes(a.start_time)>=minutes(meeting.end_time)) || null, day };
}
export function evaluateInstructor({ instructor, profile: rawProfile, rules=[], exceptions=[], activity, existingActivities=[], travel=null, weeklyLoad=0, averageWeeklyLoad=0 }) {
  const profile=normalizeSchedulingProfile(rawProfile), failures=[], warnings=[], scoreReasons=[], schedule=[];
  const meetings=meetingRows(activity), language=activity.instruction_language || 'he', gender=activity.required_instructor_gender || 'any', education=activity.education_level || deriveEducationLevel(activity.grade), empId=String(instructor.emp_id || '');
  if (String(instructor.active ?? 'yes').toLowerCase()==='no' || instructor.active===false) failures.push('המדריך אינו פעיל');
  if (!String(instructor.address || '').trim()) failures.push('חסרה כתובת מדריך');
  if (!profile.instruction_languages.includes(language)) failures.push(`אינו מדריך ב${LANGUAGE_LABELS[language] || language}`);
  if (gender!=='any' && profile.gender!==gender) failures.push(gender==='female'?'הפעילות מחייבת מדריכה':'הפעילות מחייבת מדריך');
  if (education && !profile.education_levels.includes(education)) failures.push(`אינו מתאים לשכבת ${EDUCATION_LABELS[education]}`);
  const courseId=String(activity.course_id || activity.activity_no || activity.activity_name || ''), courses=list(profile.course_ids);
  if (profile.course_restriction_mode==='allow_only'&&!courses.includes(courseId)) failures.push('המדריך מתאים רק לקורסים אחרים');
  if (profile.course_restriction_mode==='block_selected'&&courses.includes(courseId)) failures.push('הקורס חסום עבור המדריך');
  if (list(profile.blocked_authorities).some(v=>same(v,activity.authority_id || activity.authority))) failures.push('הרשות חסומה עבור המדריך');
  if (list(profile.blocked_schools).some(v=>same(v,activity.school_id || activity.school))) failures.push('בית הספר חסום עבור המדריך');
  if (list(activity.blocked_instructor_ids).includes(empId)) failures.push('המדריך חסום בפעילות זו');
  if (list(activity.allowed_instructor_ids).length&&!list(activity.allowed_instructor_ids).includes(empId)) failures.push('המדריך אינו ברשימת המדריכים המותרים');
  const ruleMap=new Map(rules.map(r=>[Number(r.weekday),r])), exceptionMap=new Map(exceptions.map(e=>[String(e.exception_date).slice(0,10),e]));
  let sameSchool=0,sameAuthority=0,waitMinutes=0,separateTrips=0;
  for(const meeting of meetings) {
    const weekday=new Date(`${meeting.date}T12:00:00`).getDay();
    if(weekday===6){failures.push(`הפעילות מתקיימת בשבת (${meeting.date})`);continue;}
    if(weekday===5&&!profile.friday_allowed) failures.push(`יום שישי אינו מאושר (${meeting.date})`);
    const availability=exceptionMap.get(meeting.date) || ruleMap.get(weekday) || defaultAvailabilityForWeekday(weekday,profile);
    if(!availability.available || minutes(meeting.start_time)<minutes(availability.start_time) || minutes(meeting.end_time)>minutes(availability.end_time)) failures.push(`אין זמינות מלאה בתאריך ${meeting.date}`);
    const {previous,next,day}=adjacentActivities(existingActivities,meeting); if(day.some(a=>overlaps(meeting,a))) failures.push(`חפיפה עם פעילות אחרת בתאריך ${meeting.date}`);
    const transition=travel?.transitions?.[meeting.date] || {};
    const inspect=(neighbor,leg,direction)=>{if(!neighbor)return;const gap=direction==='previous'?minutes(meeting.start_time)-minutes(neighbor.end_time):minutes(neighbor.start_time)-minutes(meeting.end_time);const required=leg?.duration_minutes;if(required!=null&&gap<required) failures.push(`אין זמן מעבר מספיק ${direction==='previous'?'מהפעילות הקודמת':'לפעילות הבאה'} בתאריך ${meeting.date} (${gap} דקות זמינות, ${required} דקות נסיעה)`);if(same(neighbor.school,activity.school))sameSchool++;if(same(neighbor.authority,activity.authority))sameAuthority++;waitMinutes+=Math.max(0,gap-(required || 0));if(gap>120)separateTrips++;};
    inspect(previous,transition.previous,'previous');inspect(next,transition.next,'next');
    const ordered=[...day,meeting].sort((a,b)=>minutes(a.start_time)-minutes(b.start_time));let continuous=1,max=1;for(let i=1;i<ordered.length;i++){continuous=minutes(ordered[i].start_time)-minutes(ordered[i-1].end_time)<=30?continuous+1:1;max=Math.max(max,continuous);}const duration=minutes(meeting.end_time)-minutes(meeting.start_time);if((duration>=80&&max>3)||(duration<80&&max>5))failures.push(`הרצף היומי חורג מהמותר בתאריך ${meeting.date}`);
    schedule.push({date:meeting.date,previous,next,previous_travel:transition.previous || null,next_travel:transition.next || null});
  }
  let score=failures.length?null:100;
  if(score!==null){scoreReasons.push(`מתאים לשפה ${LANGUAGE_LABELS[language]}`);if(education)scoreReasons.push(`מתאים לשכבת ${EDUCATION_LABELS[education]}`);scoreReasons.push(profile.gender==='female'?'פנויה בכל המפגשים':'פנוי בכל המפגשים');if(travel?.home?.distance_km!=null){scoreReasons.push(`${Math.round(travel.home.distance_km)} ק״מ מהבית, ${Math.round(travel.home.duration_minutes)} דקות נסיעה`);score-=Math.min(30,Math.max(0,travel.home.distance_km-10)*.6);if(travel.home.distance_km>40)warnings.push('מרחק הבית עולה על 40 ק״מ');}else scoreReasons.push('המרחק טרם חושב');if(sameSchool){score+=Math.min(12,sameSchool*4);scoreReasons.push(`${sameSchool} חיבורים באותו בית ספר`);}if(sameAuthority){score+=Math.min(8,sameAuthority*2);scoreReasons.push(`${sameAuthority} חיבורים באותה רשות`);}if(waitMinutes){score-=Math.min(10,Math.floor(waitMinutes/120));scoreReasons.push(`${waitMinutes} דקות המתנה מצטברות`);}if(separateTrips){score-=Math.min(10,separateTrips*2);scoreReasons.push(`${separateTrips} נסיעות נפרדות`);}score-=Math.min(18,weeklyLoad*2);scoreReasons.push(`עומס שבועי: ${weeklyLoad} מפגשים`);if(weeklyLoad>averageWeeklyLoad+2)warnings.push('עומס שבועי גבוה מהממוצע');score=Math.max(0,Math.min(120,Math.round(score)));}
  return {eligible:!failures.length,score,failures:[...new Set(failures)],warnings:[...new Set(warnings)],explanation:[...scoreReasons,...warnings].join(', '),scoreReasons,schedule};
}
export function rankInstructors(input) {
  const candidates=input.instructors.map(instructor=>({
    instructor,
    ...evaluateInstructor({
      ...input,
      instructor,
      profile:input.profiles?.[String(instructor.emp_id)],
      rules:input.rules?.[String(instructor.emp_id)] || [],
      exceptions:input.exceptions?.[String(instructor.emp_id)] || [],
      existingActivities:input.assignments?.[String(instructor.emp_id)] || [],
      travel:input.travel?.[String(instructor.emp_id)] || null,
      weeklyLoad:input.weeklyLoads?.[String(instructor.emp_id)] || 0,
      averageWeeklyLoad:Number(input.averageWeeklyLoad) || 0
    })
  }));
  return {
    recommended:candidates.filter(c=>c.eligible&&!c.warnings.length).sort((a,b)=>b.score-a.score),
    exceptions:candidates.filter(c=>c.eligible&&c.warnings.length).sort((a,b)=>b.score-a.score),
    rejected:candidates.filter(c=>!c.eligible)
  };
}
