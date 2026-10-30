import test from 'node:test';
import assert from 'node:assert/strict';
import {previewThreeCoursesReadOnly,CANARY_COURSE_IDS} from '../services/scheduling-agent/readonly-canary.mjs';

test('canary passes only 3 IDs to the existing engine and never persists',async()=>{
 const activities=CANARY_COURSE_IDS.map(row_id=>({row_id}));
 let called=0;
 const result=await previewThreeCoursesReadOnly({
  input:{snapshot:{activities},sourceRevision:'5',workspaceRevision:'6',routeClient:{peek(){},request(){}}},
  computePlan:async args=>{
    called++;
    assert.equal(args.mode,'incremental');
    assert.deepEqual(args.targetCourseIds,CANARY_COURSE_IDS);
    return {diagnostics:{finalPlanValid:true},rows:[
      ...CANARY_COURSE_IDS.map(courseId=>({courseId,kind:'draft'})),
      {courseId:'not-a-target',kind:'live'}
    ]};
  }
 });
 assert.equal(called,1);
 assert.equal(result.saved,false);
 assert.equal(result.targets.length,3);
 assert.equal(result.status,'preview_only');
});
test('canary refuses partial input rather than silently expanding scope',async()=>{
 await assert.rejects(previewThreeCoursesReadOnly({
 input:{snapshot:{activities:[]},sourceRevision:'1',workspaceRevision:'1',routeClient:{}},
 computePlan:async()=>{throw Error('must not execute');}
 }),/canary_course_missing/);
});
