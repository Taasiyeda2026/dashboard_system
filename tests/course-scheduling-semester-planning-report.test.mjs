import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildPlanningCompletionRows,
  planningCompletionOverviewHtml,
  planningCompletionInstructorDetailsHtml,
  planningFullWorkPlanCoverage,
  planningInstructorCompletionOverview
} from '../frontend/src/screens/course-scheduling-planning.js';
import { courseSchedulingScreen } from '../frontend/src/screens/course-scheduling.js';

function course(row_id, school, fields = {}) {
  return {
    row_id,school, activity_name:'ביומימיקרי',
    authority:'רחובות',activity_season:'school_2027',activity_type:'course',
    status:'פתוח',sessions:2,start_time:'10:00',end_time:'11:30',
    ...fields
  };
}
const activities=[
  course('first-continue','בית ספר א',{
    start_date:'2027-01-25',date_1:'2027-01-25',date_2:'2027-02-08',
    emp_id:'100',instructor_name:'מדריך מחצית א'
  }),
  course('second-live','בית ספר ב',{
    start_date:'2027-02-08',date_1:'2027-02-08',date_2:'2027-02-15',
    emp_id:'200',instructor_name:'מדריך מחצית ב'
  }),
  course('second-missing','בית ספר ג',{
    start_date:'2027-02-08',date_1:'2027-02-08',date_2:'2027-02-15'
  }),
  course('first-undated','בית ספר ד',{start_date:null})
];

test('semester grouping follows first official date, not any February continuation meeting',()=>{
  const first=buildPlanningCompletionRows({activities,periodKey:'first'});
  const second=buildPlanningCompletionRows({activities,periodKey:'second'});
  assert.deepEqual(first.map(row=>row.courseId).sort(),['first-continue','first-undated']);
  assert.deepEqual(second.map(row=>row.courseId).sort(),['second-live','second-missing']);
  assert.equal(planningFullWorkPlanCoverage(first,{periodKey:'first'}).total,2);
  assert.equal(planningFullWorkPlanCoverage(second,{periodKey:'second'}).total,2);
  assert.equal(planningInstructorCompletionOverview(second,{periodKey:'second'})[0].name,'מדריך מחצית ב');
  const firstHtml=planningCompletionOverviewHtml(first,{periodKey:'first',operationalOnly:true});
  const secondHtml=planningCompletionOverviewHtml(second,{periodKey:'second',operationalOnly:true});
  assert.match(firstHtml,/שיבוצים שמורים — מחצית א׳/);
  assert.match(firstHtml,/1 משובצות/);
  assert.match(firstHtml,/1 טרם שובצו/);
  assert.match(secondHtml,/שיבוצים שמורים — מחצית ב׳/);
  assert.match(secondHtml,/1 משובצות/);
  assert.match(secondHtml,/1 טרם שובצו/);
  assert.doesNotMatch(secondHtml,/מדריך מחצית א/);
  assert.match(planningCompletionInstructorDetailsHtml(second,'200',{periodKey:'second'}),/בית ספר ב/);
});

test('operational planning report follows the active semester without counting cross-half continuations twice',()=>{
  const html=courseSchedulingScreen.render({
    activities, instructors:[],scheduling:{},planningCatalog:[],schoolCalendar:[],
    meetingState:{loaded:true,approvedDates:new Map(),cancelledDates:new Map(),error:''}
  },{state:{
    user:{role:'admin'},
    courseSchedulingPeriodKey:'second',
    courseSchedulingPlanningSharedLoaded:true,
    courseSchedulingPlanningCalculatedAt:'18.10.2026',
    courseSchedulingPlanningStale:true,
    courseSchedulingPlanningReportOpen:true,
    courseSchedulingPlanningRows:[{
      courseId:'second-missing',kind:'proposal',instructorEmpId:'999',
      instructorName:'הצעה ישנה',needsRecalc:true,
      meetings:[{date:'2027-02-08',start_time:'10:00',end_time:'11:30'}]
    }]
  }});
  const dom=new JSDOM(html);
  const report=dom.window.document.querySelector('[data-planning-report]');
  assert.ok(report);
  assert.equal(report.dataset.planningReportMode,'operational-only');
  assert.match(report.textContent,/שיבוצים שמורים — מחצית ב׳/);
  assert.match(report.textContent,/2 פעילויות/);
  assert.match(report.textContent,/מדריך מחצית ב/);
  assert.doesNotMatch(report.textContent,/מדריך מחצית א|הצעה ישנה/);
  dom.window.close();
});
