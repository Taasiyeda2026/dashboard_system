import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {savedTravelMatchesDraft} from '../attendance/src/services/travel-request-guard.js';
import {instructorAttendanceError} from '../attendance/src/services/instructor-error.service.js';

const source=readFileSync(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
const start=source.indexOf("root.querySelectorAll('[data-calculate-missing-route]')");
const click=source.slice(start,source.indexOf("root.querySelector('[data-refresh-distance-coverage]')",start));
const selected={origin_key:'home',destination_key:'school',origin_address:'home',destination_address:'school'};
function setup({pending=false,result={calculated:true,distance_km:10,duration_minutes:20}}={}){
 let handler;const calls=[];
 const state={courseSchedulingRouteQueue:[selected]};
 const context={state,text:String,translateSchedulingRouteError:String,
  root:{querySelectorAll:()=>[{dataset:{calculateMissingRoute:'0'},addEventListener:(_event,fn)=>{handler=fn;}}]},
  rerender:()=>{},invokeDistanceRoute:async()=>{calls.push('calculate');return {data:result};},
  reloadManualRouteQueue:async()=>{calls.push('queue');state.courseSchedulingRouteQueue=pending?[selected]:[];},
  reloadDistanceCoverage:async()=>{calls.push('coverage');state.courseSchedulingDistanceStats={existing_count:1};},
 };
 runInNewContext(click,context);
 return {state,calls,run:handler};
}
test('manual route calculation refreshes queue AND coverage after persisted result',async()=>{
 const s=setup();await s.run();assert.deepEqual(s.calls,['calculate','queue','coverage']);
 assert.equal(s.state.courseSchedulingDistanceStats.existing_count,1);
 assert.match(s.state.courseSchedulingManualRouteMessage,/המסלול נשמר/);
 assert.equal(s.state.courseSchedulingManualRouteBusy,false);
});
test('cached zero that remains pending is never presented as a usable repaired route',async()=>{
 const s=setup({pending:true,result:{calculated:true,distance_km:0,duration_minutes:0}});await s.run();
 assert.match(s.state.courseSchedulingManualRouteMessage,/עדיין דורש בדיקת מיקום ואינו מאושר לשימוש/);
 assert.deepEqual(s.calls,['calculate','queue','coverage']);
});
test('missing or invalid route metrics do not show success and always release controls',async()=>{
 for(const result of [{calculated:true,distance_km:null,duration_minutes:20},
  {calculated:true,distance_km:10,duration_minutes:-1},{calculated:false}]){
  const s=setup({result});await s.run();assert.match(s.state.courseSchedulingManualRouteMessage,/נכשל/);
  assert.equal(s.state.courseSchedulingManualRouteBusy,false);assert.deepEqual(s.calls,['calculate']);
 }
});
test('uncertain save confirmation requires the same activity IDs and context, not only identical amounts',()=>{
 const leg={kind:'outbound',from:'home',to:'school',toRecordId:'a',contextFingerprint:'new',minutes:60,kilometers:10};
 const saved={no_travel:false,legs:[{...leg}]};
 assert.equal(savedTravelMatchesDraft(saved,[leg]),true);
 for(const change of [{contextFingerprint:'old'},{toRecordId:'other'}]){
  assert.equal(savedTravelMatchesDraft({...saved,legs:[{...leg,...change}]},[leg]),false);
 }
 assert.match(instructorAttendanceError({message:'attendance_travel_route_changed'}),/פרטי הפעילויות השתנו/);
 assert.match(instructorAttendanceError({message:'attendance_travel_leg_incomplete'}),/לא תקינים/);
});
