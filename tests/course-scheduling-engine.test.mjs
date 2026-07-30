import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCourseSchedule, instructorLoad, schedulingCourses } from '../frontend/src/screens/course-scheduling-engine.js';
import { evaluateInstructor } from '../frontend/src/screens/instructor-matching-engine.js';
import { createRouteClient, calculateCandidateTravel } from '../frontend/src/screens/course-scheduling-travel.js';
import { detailsHtml } from '../frontend/src/screens/course-scheduling.js';

const course = (id, date='2027-09-05') => ({ row_id:id, activity_name:id, activity_type:'קורס', activity_season:'school_2027', status:'פתוח', school:'אלון', school_address:'רחוב 1', authority:'חיפה', instruction_language:'he', education_level:'elementary', start_time:'10:00', end_time:'11:00', meetings:[{date,start_time:'10:00',end_time:'11:00'}] });
const instructors=[{emp_id:'1',full_name:'נועה',active:'yes',address:'חיפה'},{emp_id:'2',full_name:'דנה',active:'yes',address:'חיפה'}];
const profiles={1:{gender:'female',instruction_languages:['he'],education_levels:['elementary'],course_restriction_mode:'allow_only',course_ids:['flex','only']},2:{gender:'female',instruction_languages:['he'],education_levels:['elementary'],course_restriction_mode:'allow_only',course_ids:['flex']}};
const rules={1:[{weekday:0,available:true,start_time:'08:00',end_time:'16:00'}],2:[{weekday:0,available:true,start_time:'08:00',end_time:'16:00'}]};

test('filters only open, unassigned 2027 courses',()=>{assert.deepEqual(schedulingCourses([course('ok'),{...course('assigned'),emp_id:'1'},{...course('workshop'),activity_type:'סדנה'},{...course('closed'),status:'סגור'},{...course('old'),activity_season:'regular'}]).map(x=>x.row_id),['ok']);});
test('global allocation preserves the only instructor for a constrained course',()=>{const results=calculateCourseSchedule({activities:[course('flex'),course('only')],instructors,profiles,rules,exceptions:{}});assert.equal(results.filter(x=>x.recommended).length,2);assert.equal(results.find(x=>x.course.row_id==='only').recommended.instructor.emp_id,'1');assert.equal(results.find(x=>x.course.row_id==='flex').recommended.instructor.emp_id,'2');});
test('checks every meeting and keeps missing weekday availability out of recruitment',()=>{const result=calculateCourseSchedule({activities:[{...course('flex'),meetings:[{date:'2027-09-05',start_time:'10:00',end_time:'11:00'},{date:'2027-09-06',start_time:'10:00',end_time:'11:00'}]}],instructors,profiles,rules,exceptions:{}})[0];assert.equal(result.status,'נדרש טיפול');assert.ok(result.checked.every(x=>x.missingProfileData.some(reason=>/זמינות/.test(reason))));});
test('missing essential data is reported exactly and never proposed',()=>{const result=calculateCourseSchedule({activities:[{...course('missing'),school_address:'',instruction_language:''}],instructors,profiles,rules})[0];assert.equal(result.status,'חסר מידע');assert.deepEqual(result.missing,['כתובת בית הספר','שפת הדרכה']);});
test('workload is calculated relative to declared availability',()=>{const load=instructorLoad([course('load')],profiles[1],rules[1]);assert.equal(load.hours,1);assert.equal(load.meetings,1);assert.equal(load.availabilityHours,8);assert.equal(load.ratio,0.125);});

test('missing profile fields are separate from professional failures and receive no score',()=>{
  for (const [field,partial] of [['מגדר',{instruction_languages:['he'],education_levels:['elementary']}],['שפות הדרכה',{gender:'female',education_levels:['elementary']}],['שכבות גיל',{gender:'female',instruction_languages:['he']}]]) {
    const result=evaluateInstructor({instructor:instructors[0],profile:{...partial,course_restriction_mode:'all'},rules:rules[1],activity:{...course('missing-profile'),required_instructor_gender:'female'}});
    assert.equal(result.eligible,false);assert.equal(result.score,null);assert.ok(result.missingProfileData.includes(field));assert.equal(result.failures.length,0);
  }
});

test('defined availability outside course hours is a failure, while no weekly rules is missing data',()=>{
  const activity={...course('flex'),required_instructor_gender:'female'};
  const missing=evaluateInstructor({instructor:instructors[0],profile:profiles[1],rules:[],activity});
  assert.ok(missing.missingProfileData.includes('זמינות שבועית'));assert.equal(missing.failures.length,0);
  const rejected=evaluateInstructor({instructor:instructors[0],profile:profiles[1],rules:[{weekday:0,available:true,start_time:'12:00',end_time:'14:00'}],activity});
  assert.equal(rejected.missingProfileData.length,0);assert.match(rejected.failures.join(' '),/אינה מכסה/);
});

test('eight missing Monday availability dates are grouped once and expanded only in details',()=>{
  const meetings=Array.from({length:8},(_,i)=>{const date=new Date('2027-09-06T12:00:00Z');date.setUTCDate(date.getUTCDate()+i*7);return {date:date.toISOString().slice(0,10),start_time:'10:00',end_time:'11:30'};});
  const activity={...course('flex'),required_instructor_gender:'female',meetings,start_time:'10:00',end_time:'11:30'};
  const candidate=evaluateInstructor({instructor:instructors[0],profile:profiles[1],rules:[],activity});
  assert.equal(candidate.issues.filter(x=>x.kind==='missing_availability').length,1);assert.equal(candidate.issues[0].dates.length,8);assert.match(candidate.missingProfileData.join(' '),/משפיע על 8 מפגשים/);
  const result={course:activity,status:'נדרש טיפול',recommended:null,incompleteProfiles:[{...candidate,instructor:instructors[0]}],treatmentReason:'לא ניתן להשלים את בדיקת השיבוץ משום שחסרים נתונים בפרופילי מדריכים.'};
  const html=detailsHtml(result);assert.equal((html.match(/לא הוגדרה זמינות/g)||[]).length,1);for(const meeting of meetings)assert.match(html,new RegExp(meeting.date));
});

test('course status distinguishes incomplete-only candidates from fully rejected candidates',()=>{
  const incomplete=calculateCourseSchedule({activities:[course('incomplete')],instructors,profiles:{},rules:{},exceptions:{}})[0];assert.equal(incomplete.status,'נדרש טיפול');
  const rejectedProfiles={1:{...profiles[1],instruction_languages:['ar']},2:{...profiles[2],instruction_languages:['ar']}};
  const rejected=calculateCourseSchedule({activities:[course('rejected')],instructors,profiles:rejectedProfiles,rules,exceptions:{}})[0];assert.equal(rejected.status,'נדרש גיוס');
});

test('route requests are deduplicated, capped at four, and only threshold candidates are routed',async()=>{
  let active=0,max=0,calls=0;const client=createRouteClient({concurrency:4,invoke:async()=>{calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,2));active--;return {data:{calculated:true,distance_km:2,duration_minutes:5}};}});
  await Promise.all(Array.from({length:10},(_,i)=>client.request(i<2?'same':`o${i}`,'dest')));assert.ok(max<=4);assert.equal(calls,9);
  const preliminary=[{course:course('route'),candidate:{instructor:instructors[0]}}];const routed=await calculateCandidateTravel(preliminary,[],client);assert.ok(routed.travel.route['1'].home);assert.equal(routed.travel.route['2'],undefined);
});

test('unverified transition between schools fails safely',()=>{
  const result=evaluateInstructor({instructor:instructors[0],profile:profiles[1],rules:rules[1],activity:course('transition'),existingActivities:[{date:'2027-09-05',start_time:'08:00',end_time:'09:00',school:'אחר'}],travel:{home:null,transitions:{'2027-09-05':{previous:null}}}});
  assert.equal(result.eligible,false);assert.match(result.failures.join(' '),/לא ניתן לאמת זמן מעבר/);
});

test('acceptance: Hila Rosen 1500 remains incomplete, keeps her address, and groups eight Mondays',()=>{
  const dates=Array.from({length:8},(_,i)=>{const date=new Date('2027-09-06T12:00:00Z');date.setUTCDate(date.getUTCDate()+i*7);return {date:date.toISOString().slice(0,10),start_time:'10:00',end_time:'11:30'};});
  const hila={emp_id:'1500',full_name:'הילה רוזן',active:'yes',address:'צה״ל 68, גן יבנה'};
  const activity={...course('hila'),required_instructor_gender:'female',meetings:dates,start_time:'10:00',end_time:'11:30'};
  const result=calculateCourseSchedule({activities:[activity],instructors:[hila],profiles:{},rules:{},exceptions:{}})[0];
  assert.equal(result.status,'נדרש טיפול');assert.equal(result.recommended,null);assert.equal(result.incompleteProfiles[0].score,null);assert.equal(result.incompleteProfiles[0].failures.length,0);assert.ok(!result.incompleteProfiles[0].missingProfileData.includes('כתובת'));
  const html=detailsHtml(result);assert.match(html,/הילה רוזן \| 1500/);assert.match(html,/צה״ל 68, גן יבנה/);assert.doesNotMatch(html,/חסר להשלמה:<\/b> כתובת/);assert.equal((html.match(/לא הוגדרה זמינות/g)||[]).length,1);assert.match(html,/משפיע על 8 מפגשים/);
});
