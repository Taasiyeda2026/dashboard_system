import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareServerPlanningSnapshot} from '../services/scheduling-agent/github-adapter.mjs';
import {assertNoUnlocatedCourseAssignments} from '../services/scheduling-agent/compute-plan.mjs';

const base={
 sourceRevision:'649',workspace:{revision:'12200'},
 activities:[],instructors:[],schoolLocations:[],externalBlockers:[],
 meetingInstructorHistory:[],profiles:[],rules:[],exceptions:[],
 schoolCalendar:[],catalog:[],routes:[],existingRows:[],cancellations:[],planningIntents:[],
 targetCourseIds:[],sourceComplete:true,routesComplete:true,
 schoolCalendarComplete:true,catalogComplete:true
};

test('unrelated non-course school with missing address does not block course engine',()=>{
 const activity={row_id:'workshop',activity_type:'workshop',activity_season:'school_2027',status:'פתוח',school_id:9999};
 const result=prepareServerPlanningSnapshot({...base,activities:[activity]});
 assert.deepEqual(result.snapshot.missingSchoolCourseIds,[]);
});

test('missing canonical school for an active course remains unresolved, never given a fabricated location',()=>{
 const activity={row_id:'course',activity_type:'course',activity_season:'school_2027',status:'פתוח',school_id:null,school:''};
 const result=prepareServerPlanningSnapshot({...base,activities:[activity]});
 assert.deepEqual(result.snapshot.missingSchoolCourseIds,['course']);
 assert.equal(result.snapshot.activities[0].school_address,'');
});

test('core explicitly rejects instructor assignment or proposed options to an unlocated school',()=>{
 assert.doesNotThrow(()=>assertNoUnlocatedCourseAssignments([
  {courseId:'course',kind:'recruitment',instructorEmpId:null,options:[]}
 ],['course']));
 assert.throws(()=>assertNoUnlocatedCourseAssignments([
  {courseId:'course',instructorEmpId:'3'}
 ],['course']),e=>e.code==='unlocated_school_assignment_forbidden');
 assert.throws(()=>assertNoUnlocatedCourseAssignments([
  {courseId:'course',instructorEmpId:'',options:[{instructorEmpId:'2'}]}
 ],['course']),e=>e.code==='unlocated_school_assignment_forbidden');
 assert.doesNotThrow(()=>assertNoUnlocatedCourseAssignments([
  {courseId:'other',instructorEmpId:'3'}
 ],['course']));
});
