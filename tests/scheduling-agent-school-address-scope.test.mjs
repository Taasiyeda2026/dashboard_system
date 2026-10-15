import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareServerPlanningSnapshot} from '../services/scheduling-agent/github-adapter.mjs';
const base={
 sourceRevision:'649',workspace:{revision:'12200'},
 activities:[],instructors:[],schoolLocations:[],externalBlockers:[],
 meetingInstructorHistory:[],profiles:[],rules:[],exceptions:[],
 schoolCalendar:[],catalog:[],routes:[],existingRows:[],cancellations:[],
 targetCourseIds:[],sourceComplete:true,routesComplete:true,
 schoolCalendarComplete:true,catalogComplete:true
};
test('unrelated non-course school with missing address does not block course engine',()=>{
 const activity={row_id:'workshop',activity_type:'סדנה',activity_season:'school_2027',status:'פתוח',school_id:9999};
 assert.doesNotThrow(()=>prepareServerPlanningSnapshot({...base,activities:[activity]}));
});
test('missing canonical school address for a planned course fails closed',()=>{
 const activity={row_id:'course',activity_type:'קורס',activity_season:'school_2027',status:'פתוח',school_id:9999,sessions:10};
 assert.throws(()=>prepareServerPlanningSnapshot({...base,activities:[activity]}),e=>e.code==='school_locations_missing_for_planned_course');
});
