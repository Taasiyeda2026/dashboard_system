import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAttendanceDashboardDataset, compareAttendanceRows } from '../frontend/src/screens/attendance-control.js';

const date='2026-10-12';
const activity=(id,start,end,program='Program')=>({
 row_id:id,emp_id:1,school_id:10,school:'School',activity_type:'course',activity_name:program,
 activity_no:'6089',start_time:start,end_time:end,
 meetings:[{date,meeting_no:1,start_time:start,end_time:end}]
});
const report=(extra={})=>({
 employeeId:'1',recordId:'business-report',date,startTime:'10:00',endTime:'14:00',workHours:4,
 activityType:'קורס',school:'School',program:'Program',activityId:'',kilometers:4,
 originAddress:'home',destinationAddress:'verified school',destinationEntityKey:'school_id:10',
 _source:{schoolId:10},...extra
});
const cache=[
 {origin_address:'verified school',destination_address:'home',origin_entity_key:'school_id:10',distance_km:131.116,location_suspect:true},
 {origin_address:'home',destination_address:'verified school',destination_entity_key:'school_id:10',distance_km:2.845},
 {origin_address:'verified school',destination_address:'home',origin_entity_key:'school_id:10',distance_km:2.758}
];
async function load(reports,courseActivities){
 return loadAttendanceDashboardDataset(reports,{attendanceControlDashboardSources:async()=>({
  activities:[{...activity('class-a','10:00','12:00'),emp_id:2}],
  courseActivities,contacts:[{emp_id:1,full_name:'Guide'}],travelCache:cache
 })},'2026-10');
}
test('Ilana business report over two classes uses the actual directed day route exactly once',async()=>{
 const reports=[report()],before=structuredClone(reports);
 const dashboard=await load(reports,[activity('class-a','10:00','12:00'),activity('class-b','12:00','14:00')]);
 const result=compareAttendanceRows(reports,dashboard);
 assert.equal(result.comparisons[0].unmatched,false);
 assert.equal(result.comparisons[0].dashboard.kilometers,5.6);
 assert.equal(result.dailyKilometers[0].calculated,5.6);
 assert.deepEqual(reports,before);
});
test('dated course projection replaces current-assignment course rows without duplicating classes',async()=>{
 const dashboard=await load([report()],[activity('class-a','10:00','12:00'),activity('class-b','12:00','14:00')]);
 assert.deepEqual(dashboard.filter(x=>!x.__profile).map(x=>x.activityId).sort(),['class-a','class-b']);
 assert.ok(dashboard.every(x=>x.employeeId==='1'));
});
test('separate business reports share a physical workday without duplicating home legs',async()=>{
 const reports=[report(),report({recordId:'later',program:'Other',startTime:'14:00',endTime:'16:00',workHours:2,kilometers:0})];
 const dashboard=await load(reports,[activity('class-a','10:00','12:00'),activity('class-b','12:00','14:00'),activity('class-c','14:00','16:00','Other')]);
 const result=compareAttendanceRows(reports,dashboard);
 assert.deepEqual(result.comparisons.map(x=>x.dashboard.kilometers),[2.85,2.76]);
 assert.equal(result.dailyKilometers[0].calculated,5.61);
});
test('an unresolved physical stop keeps all course bundle components unavailable',async()=>{
 const reports=[report(),report({recordId:'unknown',activityType:'תפעול',program:'Other',startTime:'16:00',destinationAddress:'',destinationEntityKey:'',_source:{}})];
 const dashboard=await load(reports,[activity('class-a','10:00','12:00'),activity('class-b','12:00','14:00')]);
 assert.ok(dashboard.filter(x=>!x.__profile).every(x=>x.kilometers==null));
});
