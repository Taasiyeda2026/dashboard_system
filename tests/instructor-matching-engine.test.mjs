import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstructor, rankInstructors, normalizeSchedulingProfile } from '../frontend/src/screens/instructor-matching-engine.js';
import { isoWeekKey, projectedWeeklyLoad, averageWeeklyLoad } from '../frontend/src/screens/instructor-scheduling-load.js';

const activity={activity_name:'קורס מדעים',instruction_language:'he',required_instructor_gender:'female',grade:'ח',start_time:'10:00',end_time:'11:30',meetings:[{date:'2026-08-02',start_time:'10:00',end_time:'11:30'}]};
const instructor={emp_id:'10',full_name:'נועה',active:'yes',address:'חיפה'};
const profile={gender:'female',instruction_languages:['he','ar'],friday_allowed:false};
const rules=[{weekday:0,available:true,start_time:'08:00',end_time:'16:00'}];

test('eligible instructor receives explained score while missing distance is informational',()=>{const result=evaluateInstructor({instructor,profile,rules,activity});assert.equal(result.eligible,true);assert.equal(typeof result.score,'number');assert.match(result.explanation,/פנויה בכל המפגשים/);assert.deepEqual(result.warnings,[]);assert.match(result.explanation,/טרם חושב/);});
test('rejects language, gender, exception and overlap with exact reasons',()=>{const result=evaluateInstructor({instructor,profile:{...profile,gender:'male',instruction_languages:['ar']},rules,exceptions:[{exception_date:'2026-08-02',available:false}],activity,existingActivities:[{date:'2026-08-02',start_time:'10:30',end_time:'12:00'}]});assert.equal(result.score,null);assert.match(result.failures.join('|'),/עברית|מדריכה|זמינות|חפיפה/);});
test('Saturday always disqualifies and ranking separates rejected candidates',()=>{const saturday={...activity,meetings:[{date:'2026-08-01',start_time:'10:00',end_time:'11:30'}]};const ranked=rankInstructors({instructors:[instructor],profiles:{10:profile},rules:{10:rules},activity:saturday});assert.equal(ranked.rejected.length,1);assert.match(ranked.rejected[0].failures[0],/שבת/);});
test('instructor without profile does not assume a language requirement',()=>{assert.deepEqual(normalizeSchedulingProfile().instruction_languages,[]);});
test('professional threshold failures happen before scoring',()=>{const result=evaluateInstructor({instructor,profile:{...profile,education_levels:[],course_restriction_mode:'block_selected',course_ids:['קורס מדעים'],blocked_authorities:['חיפה'],blocked_schools:['בית ספר']},rules,activity:{...activity,education_level:'high_school',blocked_instructor_ids:['10'],allowed_instructor_ids:['11']}});assert.equal(result.eligible,false);assert.equal(result.score,null);assert.match(result.failures.join('|'),/חסום לפעילות|רשות|בית ספר|אינו מורשה/);assert.match(result.missingProfileData.join('|'),/רמת החינוך/);assert.equal(result.checks.courseEligibility.passed,false);assert.equal(result.checks.educationLevel.passed,false);});
test('missing weekly availability never implies availability',()=>{const result=evaluateInstructor({instructor,activity:{...activity,start_time:'08:00',end_time:'15:00'},profile});assert.equal(result.eligible,false);assert.equal(result.failures.length,0);assert.match(result.missingProfileData.join(' '),/זמינות/);});
test('פורצות דרך only accepts female instructors',()=>{const special={...activity,activity_name:'פורצות דרך',required_instructor_gender:'female',instruction_language:'he'};assert.equal(evaluateInstructor({instructor,profile,rules,activity:special}).eligible,true);assert.equal(evaluateInstructor({instructor,profile:{...profile,gender:'male'},rules,activity:special}).eligible,false);});
test('unavailable Google distance is explanatory data, not an exception',()=>{const result=evaluateInstructor({instructor,profile,rules,activity,travel:null});assert.equal(result.eligible,true);assert.deepEqual(result.warnings,[]);assert.match(result.explanation,/טרם חושב/);});
test('impossible transition disqualifies candidate',()=>{const existing=[{date:'2026-08-02',start_time:'08:00',end_time:'09:55',school:'א',activity_name:'קודמת'}];const result=evaluateInstructor({instructor,profile,rules,activity,existingActivities:existing,travel:{transitions:{'2026-08-02':{previous:{distance_km:20,duration_minutes:30}}}}});assert.equal(result.eligible,false);assert.match(result.failures.join(' '),/אין זמן מעבר מספיק/);});

test('projected weekly load only counts weeks used by the activity',()=>{
  const target={start_time:'10:00',end_time:'11:30',meetings:[{date:'2026-08-03'},{date:'2026-08-04'}]};
  const existing=[{date:'2026-08-03'},{date:'2026-08-05'},{date:'2026-08-17'}];
  assert.equal(isoWeekKey('2026-08-03'),isoWeekKey('2026-08-05'));
  assert.notEqual(isoWeekKey('2026-08-03'),isoWeekKey('2026-08-17'));
  assert.equal(projectedWeeklyLoad(existing,target),4);
});

test('average weekly load is passed through ranking and creates a visible load exception',()=>{
  const ranked=rankInstructors({instructors:[instructor],profiles:{10:profile},rules:{10:rules},weeklyLoads:{10:5},averageWeeklyLoad:1,activity});
  assert.equal(averageWeeklyLoad({10:5,11:1}),3);
  assert.equal(ranked.exceptions.length,1);
  assert.match(ranked.exceptions[0].warnings.join(' '),/עומס שבועי גבוה/);
});


test('activity blocked instructor list disqualifies and wins over allowed list',()=>{
  const result=evaluateInstructor({instructor,profile,rules,activity:{...activity,blocked_instructor_ids:[10],allowed_instructor_ids:['10']}});
  assert.equal(result.eligible,false);
  assert.match(result.failures.join(' '),/חסום לפעילות/);
});

test('non-empty allowed instructor list allows only listed instructors',()=>{
  const result=evaluateInstructor({instructor,profile,rules,activity:{...activity,allowed_instructor_ids:['11']}});
  assert.equal(result.eligible,false);
  assert.match(result.failures.join(' '),/מוגבלת לרשימת מדריכים אחרת/);
});

test('course restriction modes gate course authorization',()=>{
  assert.equal(evaluateInstructor({instructor,profile:{...profile,course_restriction_mode:'allow_only',course_ids:['course-1']},rules,activity:{...activity,catalog_slug:'course-1'}}).eligible,true);
  assert.equal(evaluateInstructor({instructor,profile:{...profile,course_restriction_mode:'allow_only',course_ids:['other']},rules,activity:{...activity,catalog_slug:'course-1'}}).eligible,false);
  assert.equal(evaluateInstructor({instructor,profile:{...profile,course_restriction_mode:'block_selected',course_ids:['course-1']},rules,activity:{...activity,catalog_slug:'course-1'}}).eligible,false);
  assert.equal(evaluateInstructor({instructor,profile:{...profile,course_restriction_mode:'all',course_ids:['course-1']},rules,activity:{...activity,catalog_slug:'course-1'}}).eligible,true);
});

test('education, authority and school professional gates disqualify clearly',()=>{
  const result=evaluateInstructor({instructor,profile:{...profile,education_levels:['elementary'],blocked_authorities:['חיפה'],blocked_schools:['בית ספר']},rules,activity:{...activity,education_level:'high_school',authority:' חיפה ',school:'בית  ספר'}});
  assert.equal(result.eligible,false);
  assert.match(result.failures.join('|'),/רמת החינוך|רשות|בית ספר/);
});

test('required missing professional data is incomplete, not recommended',()=>{
  const result=evaluateInstructor({instructor,profile:{...profile,course_restriction_mode:'allow_only',course_ids:[],education_levels:[]},rules,activity:{...activity,catalog_slug:'course-1',education_level:'elementary'}});
  assert.equal(result.eligible,false);
  assert.equal(result.score,null);
  assert.match(result.missingProfileData.join('|'),/הכשרות הקורס|רמת החינוך/);
});
