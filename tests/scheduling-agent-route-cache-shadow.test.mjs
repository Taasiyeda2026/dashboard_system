import test from 'node:test';
import assert from 'node:assert/strict';
import {planningRouteEndpoints} from '../supabase/functions/scheduling-agent-worker-api/planning-scope.mjs';

test('route scope keeps canonical addresses for planned activities, external blockers and all instructors',()=>{
 const scope=planningRouteEndpoints({
  activities:[{school_id:1},{school_id:1},{school_id:2,school_address:'unverified address'}],
  externalBlockers:[{school_address:'External School'}],
  instructors:[{address:'  A  Street ',active:true},{address:'Another home',active:false}],
  schoolLocations:[{school_id:1,address:'Main School'},{school_id:3,address:'Unrelated School'}]
 });
 assert.deepEqual(scope,{
  p_schools:['main school','external school'],
  p_homes:['a street','another home']
 });
});
