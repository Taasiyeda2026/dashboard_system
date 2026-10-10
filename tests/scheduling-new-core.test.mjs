import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDynamicCoursePlan, PLANNING_ENGINE_VERSION, validatePlanningPlanCoherence } from '../frontend/src/screens/course-scheduling-planning.js';
import { createRouteClient } from '../frontend/src/screens/course-scheduling-travel.js';
import { schedulingWeekendFailure } from '../frontend/src/screens/shared/scheduling-weekend-policy.js';

const activity = (id, extra = {}) => ({ row_id: id, activity_season: 'school_2027', activity_type: 'קורס', activity_name: 'Fixture', status: 'פתוח', school_id: '1', school: 'School', school_address: 'school1', calendar_sector: 'jewish', authority: 'Authority', instruction_language: 'he', required_instructor_gender: 'any', sessions: 1, start_time: '09:00', end_time: '10:00', date_1: '2026-10-12', ...extra });
function input(activities, extra = {}) {
  const routeRows = ['home1', 'home2', 'school1', 'school2'].flatMap(origin => ['home1', 'home2', 'school1', 'school2'].filter(to => to !== origin).map(to => ({ origin_key: origin, destination_key: to, distance_km: 5, duration_minutes: 10 })));
  return { activities, instructors: ['1', '2'].map(id => ({ emp_id: id, active: 'yes', address: `home${id}`, full_name: `Instructor ${id}` })),
    profiles: Object.fromEntries(['1', '2'].map(id => [id, { gender: 'female', instruction_languages: ['he'], friday_allowed: false }])),
    rules: Object.fromEntries(['1', '2'].map(id => [id, Array.from({ length: 7 }, (_, weekday) => ({ weekday, available: true, start_time: '08:00', end_time: '18:00' }))])),
    exceptions: {}, schoolCalendar: [], catalog: [], today: '2026-10-09', periodKey: 'year', planningProfile: 'fast', skipSoftOptimization: true,
    existingRows: [], committedRows: [], lockedOptions: {}, routeClient: createRouteClient({ preloadedRows: routeRows, invoke: async () => { throw Error('Network forbidden'); } }), ...extra };
}
test('new product entry uses v37 and one 100-point score contract; inputs remain unchanged', async () => {
  const data = input([activity('a')]), before = JSON.stringify({ ...data, routeClient: null });
  const plan = await buildDynamicCoursePlan(data); assert.equal(plan.engineVersion, PLANNING_ENGINE_VERSION); assert.match(plan.engineVersion, /^planning-v37-/);
  assert.equal(plan.finalPlanValidation.valid, true); assert.ok(plan.rows[0].instructorEmpId);
  const score = plan.rows[0]; assert.equal(score.score, Object.values(score.scoreBreakdown).reduce((sum, item) => sum + item.points, 0));
  assert.equal(JSON.stringify({ ...data, routeClient: null }), before);
});
test('Friday needs separate permission even with weekly or date availability', async () => {
  const a = activity('friday', { date_1: '2026-10-16' });
  let data = input([a]); let plan = await buildDynamicCoursePlan(data); assert.ok(!plan.rows[0].instructorEmpId);
  data = input([a], { exceptions: { '1': [{ exception_date: '2026-10-16', available: true, start_time: '08:00', end_time: '18:00' }] } });
  plan = await buildDynamicCoursePlan(data); assert.ok(!plan.rows[0].instructorEmpId);
  data.profiles['1'].friday_allowed = true; plan = await buildDynamicCoursePlan(data); assert.equal(plan.rows[0].instructorEmpId, '1');
});
for (const sector of ['arab', 'druze', 'jewish', 'general', '']) {
  test(`Saturday policy: ${sector || 'missing'} requires explicit availability and permitted society`, async () => {
    const a = activity('saturday', { date_1: '2026-10-17', calendar_sector: sector }), data = input([a]);
    const plan = await buildDynamicCoursePlan(data); assert.equal(!!plan.rows[0].instructorEmpId, ['arab', 'druze'].includes(sector));
    for (const rules of Object.values(data.rules)) rules.find(r => r.weekday === 6).available = false;
    const blocked = await buildDynamicCoursePlan(data); assert.ok(!blocked.rows[0].instructorEmpId);
    assert.equal(schedulingWeekendFailure({ date: '2026-10-17', activity: a, availability: null }), ['arab', 'druze'].includes(sector) ? 'saturday_not_explicitly_available' : 'saturday_sector');
  });
}
test('official protected series remains complete across semesters and blocks new March collisions', async () => {
  const locked = activity('approved', { emp_id: '1', instructor_assignment_locked: true, date_2: '2027-03-15' });
  const data = input([locked, activity('march', { date_1: '2027-03-15' })]); const plan = await buildDynamicCoursePlan(data);
  assert.equal(plan.rows[0].meetings.length, 2); assert.equal(plan.rows[0].meetings[1].date, '2027-03-15'); assert.equal(plan.rows[0].instructorEmpId, '1');
  assert.equal(plan.rows[1].instructorEmpId, '2');
  const tampered = structuredClone(plan.rows); tampered[0].meetings.pop(); assert.equal(validatePlanningPlanCoherence({ ...data, rows: tampered }).valid, false);
});
test('block-first keeps back-to-back courses with one teacher and splits true parallel lanes', async () => {
  const data = input([activity('a'), activity('b', { start_time: '10:00', end_time: '11:00' }), activity('parallel')]);
  const plan = await buildDynamicCoursePlan(data); assert.equal(plan.rows[0].instructorEmpId, plan.rows[1].instructorEmpId);
  assert.notEqual(plan.rows[0].instructorEmpId, plan.rows[2].instructorEmpId); assert.equal(plan.quality.covered, 3);
});
test('a blocked saved fixed proposal is unassigned or legally reassigned without moving source dates', async () => {
  const data = input([activity('a')]), first = await buildDynamicCoursePlan(data), id = first.rows[0].instructorEmpId;
  const changed = { ...data, targetCourseIds: ['a'], allowGlobalRepair: false, existingRows: first.rows, committedRows: first.rows,
    exceptions: { [id]: [{ exception_date: '2026-10-12', available: false }] } };
  const second = await buildDynamicCoursePlan(changed); assert.equal(second.finalPlanValidation.valid, true); assert.notEqual(second.rows[0].instructorEmpId, id);
  assert.equal(second.rows[0].meetings[0].date, '2026-10-12'); assert.equal(first.rows[0].instructorEmpId, id);
});
test('travel above 20km fails even after a long gap and unknown travel is never invented', async () => {
  const a = activity('approved', { emp_id: '1', instructor_assignment_locked: true }), b = activity('b', { school_id: '2', school_address: 'school2', start_time: '13:00', end_time: '14:00' });
  const data = input([a, b], { instructors: [{ emp_id: '1', active: 'yes', address: 'home1' }] });
  data.routeClient = createRouteClient({ preloadedRows: [{ origin_key: 'home1', destination_key: 'school1', distance_km: 5, duration_minutes: 10 }, { origin_key: 'home1', destination_key: 'school2', distance_km: 5, duration_minutes: 10 }, { origin_key: 'school1', destination_key: 'school2', distance_km: 21, duration_minutes: 20 }], invoke: async () => ({ data: { calculated: false }, error: null }) });
  const plan = await buildDynamicCoursePlan(data); assert.ok(!plan.rows[1].instructorEmpId); assert.equal(plan.rows[0].instructorEmpId, '1');
});
test('holidays, gender, language, inactive status and blocked authority are hard gates, not scores', async () => {
  const a = activity('a'); for (const modify of [d => d.instructors.forEach(i => i.active = 'no'), d => Object.values(d.profiles).forEach(p => p.gender = 'male'), d => Object.values(d.profiles).forEach(p => p.instruction_languages = ['ar']), d => Object.values(d.profiles).forEach(p => p.blocked_authorities = ['Authority']), d => d.schoolCalendar.push({ start_date: '2026-10-12', end_date: '2026-10-12', calendar_sector: 'jewish', blocks_scheduling: true })]) {
    const data = input([{ ...a, required_instructor_gender: 'female' }]); modify(data); const plan = await buildDynamicCoursePlan(data); assert.ok(!plan.rows[0].instructorEmpId);
  }
});
test('removed education/course/school restrictions do not reappear as gates', async () => {
  const data = input([activity('a', { education_level: 'high', allowed_instructor_ids: ['999'], blocked_instructor_ids: ['1', '2'] })]);
  for (const p of Object.values(data.profiles)) { p.education_levels = ['primary']; p.blocked_schools = ['School']; p.max_weekly_hours = 0; }
  const plan = await buildDynamicCoursePlan(data); assert.ok(plan.rows[0].instructorEmpId);
});
test('ordinary point scope cannot silently request national repair, and cancellation yields no plan', async () => {
  const data = input([activity('a')]); await assert.rejects(buildDynamicCoursePlan({ ...data, targetCourseIds: ['a'], allowGlobalRepair: true }), { code: 'planning_scope_conflict' });
  const controller = new AbortController(); controller.abort(); await assert.rejects(buildDynamicCoursePlan({ ...data, signal: controller.signal }), { code: 'planning_cancelled' });
});
test('co-teacher and recorded substitutions remain authoritative blockers', async()=>{
 const a=activity('protected',{emp_id:'1',emp_id_2:'2',meeting_instructor_overrides:[{meeting_date:'2026-10-12',emp_id:'2'}]});
 const data=input([a,activity('new')]);const plan=await buildDynamicCoursePlan(data);
 assert.deepEqual(plan.rows[0].additionalInstructorEmpIds,['2']);assert.equal(plan.rows[0].meetings[0].substituteEmpId,'2');
 const forged=structuredClone(plan.rows);forged[0].additionalInstructorEmpIds=[];assert.equal(validatePlanningPlanCoherence({...data,rows:forged}).valid,false);
 forged[0].additionalInstructorEmpIds=['2'];forged[0].meetings[0].substituteEmpId='1';assert.equal(validatePlanningPlanCoherence({...data,rows:forged}).valid,false);
});
test('national optimizer failure returns independently validated base; cancellation never does',async()=>{
 const data=input([activity('a'),activity('b'),activity('c')],{skipSoftOptimization:false,allowGlobalRepair:true});
 const plan=await buildDynamicCoursePlan({...data,onProgress:async p=>{if(p.phase.includes('תיקון ארצי'))throw Object.assign(Error('injected'),{code:'injected_optimizer_failure'});}});
 assert.equal(plan.finalPlanValidation.valid,true);assert.equal(plan.optimization.completed,false);assert.equal(plan.optimization.failure,'injected_optimizer_failure');assert.equal(plan.rows.length,3);
});
test('other-season approved obligations block proposals without becoming planning rows',async()=>{
 const data=input([activity('external',{activity_season:'regular',emp_id:'1'}),activity('new')]);const plan=await buildDynamicCoursePlan(data);
 assert.equal(plan.rows.length,1);assert.equal(plan.rows[0].instructorEmpId,'2');
});
test('fixed forbidden Saturday or holiday is a source conflict, not a recruitment claim',async()=>{
 const data=input([activity('jewishSat',{date_1:'2026-10-17'})]);const plan=await buildDynamicCoursePlan(data);
 assert.equal(plan.rows[0].kind,'missing');assert.equal(plan.rows[0].diagnostics.recruitmentCertified,false);
});
test('date-specific exception fingerprints retain exact affected dates',async()=>{
 const {buildPlanningContextParts,diffPlanningContextParts}=await import('../frontend/src/screens/course-scheduling-planning.js');
 const base={periodKey:'year',exceptions:[{emp_id:'1',exception_date:'2026-10-12',available:true,start_time:'08:00',end_time:'16:00'}]};
 const previous=buildPlanningContextParts(base),next=buildPlanningContextParts({...base,exceptions:[{...base.exceptions[0],available:false}]});
 const diff=diffPlanningContextParts(previous,next);assert.deepEqual(diff.changedExceptionDatesByInstructor,{'1':['2026-10-12']});
});
test('dependency closure follows actual occupancy through protected bridges, not every alternative teacher',async()=>{
 const {expandPlanningAffectedIdsBySchool}=await import('../frontend/src/screens/course-scheduling-planning-store.js');
 const activities=[activity('a'),activity('protected',{emp_id:'2'}),activity('b',{school_id:'2'}),activity('alternative-only',{school_id:'3'})];
 const shared={rows:[{activityId:'a',row:{courseId:'a',instructorEmpId:'1',meetings:[{date:'2026-10-12'}],options:[{instructorEmpId:'99'}]}},{activityId:'protected',row:{courseId:'protected',kind:'live',instructorEmpId:'2',meetings:[{date:'2026-10-12'}]}},{activityId:'b',row:{courseId:'b',instructorEmpId:'2',meetings:[{date:'2026-10-12'}]}},{activityId:'alternative-only',row:{courseId:'alternative-only',instructorEmpId:'99',meetings:[{date:'2026-10-12'}]}}]};
 const closure=expandPlanningAffectedIdsBySchool({affectedIds:['a'],activities,shared,currentCourseIds:activities.map(a=>a.row_id)});assert.ok(closure.includes('b'));assert.ok(!closure.includes('protected'));assert.ok(!closure.includes('alternative-only'));
});
test('undated fixed school hours cannot be shifted or silently stretched',async()=>{
 const data=input([activity('fixed-end',{date_1:null,start_time:null,end_time:'11:00',sessions:1})],{catalog:[{activity_name:'Fixture',meetings_count:1,hours_count:1}]});const plan=await buildDynamicCoursePlan(data);
 assert.equal(plan.rows[0].endTime,'11:00');assert.equal(plan.rows[0].startTime,'10:00');
 const invalid=structuredClone(plan.rows);invalid[0].meetings[0].end_time='12:00';assert.equal(validatePlanningPlanCoherence({...data,rows:invalid}).valid,false);
});
test('new or changed planning lock cannot convert an illegal candidate to a protected exception',async()=>{
 const data=input([activity('a')]),plan=await buildDynamicCoursePlan(data),row=plan.rows[0];
 const forged={...row,instructorEmpId:'999',planningLocked:true,kind:'planning-locked'};
 assert.equal(validatePlanningPlanCoherence({...data,committedRows:plan.rows,rows:[forged],lockedOptions:{a:forged}}).valid,false);
});
test('Saturday date exception explicitly overrides weekly availability in both directions',async()=>{
 const data=input([activity('s',{date_1:'2026-10-17',calendar_sector:'druze'})]);for(const r of Object.values(data.rules))r.find(x=>x.weekday===6).available=false;
 data.exceptions={'1':[{exception_date:'2026-10-17',available:true,start_time:'08:00',end_time:'16:00'}]};assert.equal((await buildDynamicCoursePlan(data)).rows[0].instructorEmpId,'1');
 data.exceptions['1'][0].available=false;assert.ok(!(await buildDynamicCoursePlan(data)).rows[0].instructorEmpId);
});
test('official seconds are preserved and a forged secondary assignment is rejected',async()=>{
 const data=input([activity('p',{emp_id:'1',start_time:'09:00:30',end_time:'10:00:30'}),activity('a',{date_1:'2026-10-13'})]);const plan=await buildDynamicCoursePlan(data);
 assert.equal(plan.rows[0].meetings[0].start_time,'09:00:30');assert.equal(plan.finalPlanValidation.valid,true);
 const forged=structuredClone(plan.rows);forged[1].additionalInstructorEmpIds=['2'];assert.equal(validatePlanningPlanCoherence({...data,rows:forged}).valid,false);
});

test('cold real route responses populate home and inter-school constraints without guessed travel',async()=>{
 const data=input([activity('p',{emp_id:'1',start_time:'08:00',end_time:'09:00'}),activity('a',{school_id:'other',school_address:'other',start_time:'10:00',end_time:'11:00'})]);let requests=[];
 data.instructors=data.instructors.slice(0,1);
 data.routeClient={request:async(from,to)=>{requests.push([from,to]);return{calculated:true,distance_km:5,duration_minutes:10}}};
 const plan=await buildDynamicCoursePlan(data);assert.equal(plan.finalPlanValidation.valid,true);assert.ok(plan.rows.find(r=>r.courseId==='a').instructorEmpId);assert.ok(requests.some(([from,to])=>from==='school1'&&to==='other'));
 data.routeClient={request:async()=>({calculated:false})};const rejected=await buildDynamicCoursePlan(data);assert.ok(!rejected.rows.find(r=>r.courseId==='a').instructorEmpId);
});
test('official date without school hours stays unresolved and never becomes recruitment',async()=>{
 const data=input([activity('a',{start_time:null,end_time:null})]);const plan=await buildDynamicCoursePlan(data);assert.equal(plan.rows[0].kind,'missing');assert.equal(plan.rows[0].diagnostics.recruitmentCertified,false);assert.equal(plan.rows[0].meetings[0].date,data.activities[0].date_1);
});

test('missing activity data is not certified as recruitment even when no instructor exists',async()=>{const data=input([activity('a',{school_id:null})]);data.instructors=[];const plan=await buildDynamicCoursePlan(data);assert.equal(plan.rows[0].kind,'missing');assert.equal(plan.rows[0].diagnostics.recruitmentCertified,false);});
