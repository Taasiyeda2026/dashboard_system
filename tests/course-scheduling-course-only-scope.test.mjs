import test from 'node:test';
import assert from 'node:assert/strict';
import { isCourseSchedulingTargetActivity, isFullDaySchedulingActivity } from '../frontend/src/screens/shared/activity-scheduling-eligibility.js';
import { isPlanningActivity, planningWorkspaceCourses } from '../frontend/src/screens/course-scheduling-planning.js';
import { planningActivities } from '../frontend/src/screens/scheduling-core/planner.js';
import { schedulingCourses } from '../frontend/src/screens/course-scheduling-engine-core.js';
const base={activity_season:'school_2027',status:'פתוח',activity_name:'ביומימיקרי',activity_type:'course',school_id:123,school_address:'תל אביב',instruction_language:'he',start_date:'2026-10-19',start_time:'09:00',end_time:'10:30',date_1:'2026-10-19',district:'מרכז'};
const a=(row_id,activity_type,fields={})=>({...base,row_id,activity_type,...fields});
test('only genuine courses can become scheduling targets',()=>{
  assert.equal(isCourseSchedulingTargetActivity(a('c1','course')),true);
  assert.equal(isCourseSchedulingTargetActivity(a('c2','program')),true);
  assert.equal(isCourseSchedulingTargetActivity(a('c3','קורס')),true);
  assert.equal(isCourseSchedulingTargetActivity(a('t1','tour')),false);
  assert.equal(isCourseSchedulingTargetActivity(a('w1','workshop')),false);
  assert.equal(isCourseSchedulingTargetActivity(a('x','course',{activity_no:'13990'})),false);
  assert.equal(isCourseSchedulingTargetActivity(a('y','course',{activity_name:'התנסות בתעשייה'})),false);
});
test('national, direct planner and point engine exclude workshops and tours',()=>{
  const rows=[a('c1','course'),a('c2','program'),a('t1','tour'),a('w1','workshop'),a('x','course',{activity_no:'13990'})];
  assert.deepEqual(planningWorkspaceCourses(rows).map(x=>x.row_id),['c1','c2']);
  assert.deepEqual(planningActivities({activities:rows,periodKey:'year'}).map(x=>x.row_id),['c1','c2']);
  assert.equal(isPlanningActivity(rows[2]),false);
  assert.deepEqual(schedulingCourses(rows,{periodKey:'year'}).map(x=>x.row_id),['c1','c2']);
});
test('assigned tour keeps the full-day hard blocker',()=>{
  const tour=a('live-tour','tour',{emp_id:'1550'});
  assert.equal(isCourseSchedulingTargetActivity(tour),false);
  assert.equal(isFullDaySchedulingActivity(tour),true);
});
