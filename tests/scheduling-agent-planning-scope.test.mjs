import test from 'node:test';
import assert from 'node:assert/strict';
import {planningRefreshTargets, UNDATED_COURSE_LEAD_DAYS} from '../supabase/functions/scheduling-agent-worker-api/planning-scope.mjs';
import {UNDATED_COURSE_LEAD_DAYS as ENGINE_LEAD_DAYS} from '../frontend/src/screens/course-scheduling-start-policy.js';
test('worker and engine use the same undated-course lead time',()=>{
 assert.equal(UNDATED_COURSE_LEAD_DAYS,ENGINE_LEAD_DAYS);
});
const entry=(id,start='2026-10-29')=>({activity_id:id,needs_recalc:false,row_data:{kind:'proposal',startDate:start}});
test('Israeli midnight refreshes two-week proposals even while UTC is yesterday',()=>{
 const stored=[entry('old'),entry('future','2026-10-30')],activities=[{row_id:'old'},{row_id:'future'}];
 assert.deepEqual(planningRefreshTargets({stored,activities,serverTime:'2026-10-15T20:59:00Z'}),[]);
 assert.deepEqual(planningRefreshTargets({stored,activities,serverTime:'2026-10-15T21:01:00Z'}),['old']);
});
test('winter midnight uses Israel standard time',()=>{
 assert.deepEqual(planningRefreshTargets({stored:[entry('old','2026-11-14')],activities:[{row_id:'old'}],serverTime:'2026-10-31T22:01:00Z'}),['old']);
});
test('protected and officially dated courses are not time-expired targets',()=>{
 const ids=['assigned','second','locked','source','dated','late-date'];
 const stored=ids.map(id=>entry(id));
 stored[2].locked_option={instructorEmpId:'1'};
 const activities=[{row_id:'assigned',emp_id:1},{row_id:'second',emp_id_2:'2'},
  {row_id:'locked'},{row_id:'source',start_date:'2026-10-29'},
  {row_id:'dated',date_1:'2026-10-29'},{row_id:'late-date',date_35:'2026-10-29'}];
 assert.deepEqual(planningRefreshTargets({stored,activities,serverTime:'2026-10-15T21:01:00Z'}),[]);
});
test('explicit dirty rows remain targets and duplicates are collapsed',()=>{
 const row={...entry('changed'),needs_recalc:true,locked_option:{}};
 assert.deepEqual(planningRefreshTargets({stored:[row,row],activities:[],serverTime:'2026-10-15T21:01:00Z'}),['changed']);
});
test('invalid database clock is rejected instead of silently using local UTC',()=>{
 assert.throws(()=>planningRefreshTargets({serverTime:'invalid'}),/server_time_invalid/);
});
