import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateInstructor, rankInstructors, normalizeSchedulingProfile, schedulingQualityBand } from '../frontend/src/screens/instructor-matching-engine.js';
import { isoWeekKey, projectedWeeklyLoad, averageWeeklyLoad } from '../frontend/src/screens/instructor-scheduling-load.js';

const activity={activity_name:'קורס מדעים',instruction_language:'he',required_instructor_gender:'female',grade:'ח',start_time:'10:00',end_time:'11:30',meetings:[{date:'2026-08-02',start_time:'10:00',end_time:'11:30'}]};
const instructor={emp_id:'10',full_name:'נועה',active:'yes',address:'חיפה'};
const profile={gender:'female',instruction_languages:['he','ar'],friday_allowed:false};
const rules=[{weekday:0,available:true,start_time:'08:00',end_time:'16:00'}];

test('eligible instructor receives explained score while missing distance is informational',()=>{const result=evaluateInstructor({instructor,profile,rules,activity});assert.equal(result.eligible,true);assert.equal(typeof result.score,'number');assert.match(result.explanation,/פנויה בכל המפגשים/);assert.deepEqual(result.warnings,[]);assert.match(result.explanation,/טרם חושב/);});
test('rejects language, gender, exception and overlap with exact reasons',()=>{const result=evaluateInstructor({instructor,profile:{...profile,gender:'male',instruction_languages:['ar']},rules,exceptions:[{exception_date:'2026-08-02',available:false}],activity,existingActivities:[{date:'2026-08-02',start_time:'10:30',end_time:'12:00'}]});assert.equal(result.score,null);assert.match(result.failures.join('|'),/עברית|מדריכה|זמינות|חפיפה/);});
test('Saturday always disqualifies and ranking separates rejected candidates',()=>{const saturday={...activity,meetings:[{date:'2026-08-01',start_time:'10:00',end_time:'11:30'}]};const ranked=rankInstructors({instructors:[instructor],profiles:{10:profile},rules:{10:rules},activity:saturday});assert.equal(ranked.rejected.length,1);assert.match(ranked.rejected[0].failures[0],/שבת/);});
test('instructor without profile does not assume a language requirement',()=>{assert.deepEqual(normalizeSchedulingProfile().instruction_languages,[]);});
test('legacy professional and activity restriction fields do not affect eligibility',()=>{const result=evaluateInstructor({instructor,profile:{...profile,education_levels:[],course_restriction_mode:'block_selected',course_ids:['קורס מדעים'],blocked_authorities:['חיפה'],blocked_schools:['בית ספר'],weekly_target_hours:0,weekly_max_hours:0,preferred_work_days:0,max_fixed_courses:0},rules,activity:{...activity,education_level:'high_school',blocked_instructor_ids:['10'],allowed_instructor_ids:['11']}});assert.equal(result.eligible,true);assert.equal(result.missingProfileData.length,0);});
test('missing weekly availability never implies availability',()=>{const result=evaluateInstructor({instructor,activity:{...activity,start_time:'08:00',end_time:'15:00'},profile});assert.equal(result.eligible,false);assert.equal(result.failures.length,0);assert.match(result.missingProfileData.join(' '),/זמינות/);});
test('פורצות דרך only accepts female instructors',()=>{const special={...activity,activity_name:'פורצות דרך',required_instructor_gender:'female',instruction_language:'he'};assert.equal(evaluateInstructor({instructor,profile,rules,activity:special}).eligible,true);assert.equal(evaluateInstructor({instructor,profile:{...profile,gender:'male'},rules,activity:special}).eligible,false);});
test('unavailable Google distance is explanatory data, not an exception',()=>{const result=evaluateInstructor({instructor,profile,rules,activity,travel:null});assert.equal(result.eligible,true);assert.deepEqual(result.warnings,[]);assert.match(result.explanation,/טרם חושב/);});
test('impossible transition disqualifies candidate',()=>{const existing=[{date:'2026-08-02',start_time:'08:00',end_time:'09:55',school:'א',activity_name:'קודמת'}];const result=evaluateInstructor({instructor,profile,rules,activity,existingActivities:existing,travel:{transitions:{'2026-08-02':{previous:{distance_km:20,duration_minutes:30}}}}});assert.equal(result.eligible,false);assert.match(result.failures.join(' '),/אין זמן מעבר מספיק/);});
test('long home travel reduces travelDistance points without disqualifying',()=>{const far=evaluateInstructor({instructor,profile,rules,activity,travel:{home:{distance_km:55,duration_minutes:90},transitions:{}}});const near=evaluateInstructor({instructor,profile,rules,activity,travel:{home:{distance_km:5,duration_minutes:10},transitions:{}}});assert.equal(far.eligible,true);assert.ok(far.scoreBreakdown.travelDistance.points < near.scoreBreakdown.travelDistance.points);assert.equal(far.failures.length,0);});

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


test('quality bands preserve the existing score while classifying boundaries',()=>{
  assert.deepEqual(schedulingQualityBand(60),{qualityBand:'recommended',qualityLabel:'מומלץ'});
  assert.deepEqual(schedulingQualityBand(59),{qualityBand:'warning',qualityLabel:'מתאים עם אזהרה'});
  assert.deepEqual(schedulingQualityBand(40),{qualityBand:'warning',qualityLabel:'מתאים עם אזהרה'});
  assert.deepEqual(schedulingQualityBand(39),{qualityBand:'technical',qualityLabel:'מתאים טכנית בלבד'});
  assert.equal(schedulingQualityBand(null,false),null);
});
