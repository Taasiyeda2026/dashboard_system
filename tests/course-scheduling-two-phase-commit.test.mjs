import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PLANNING_RUN_TYPES,resolvePlanningRunPlan
} from '../frontend/src/screens/course-scheduling-run-plan.js';
import {
  planningBaseStageEngineVersion,isPlanningBaseStagePending,
  shouldStageLargePlanningUpgrade,planningEngineUpgradeOptimizationScopes,
  planningEngineUpgradeExecutionScopes
} from '../frontend/src/screens/course-scheduling-planning-store.js';

const screen=await readFile(new URL('../frontend/src/screens/course-scheduling.js',import.meta.url),'utf8');
const planner=await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js',import.meta.url),'utf8');

test('173-course national upgrade saves a separately validated pending base; no soft passes before this commit',()=>{
  const current='planning-v35-test';
  const prior='planning-v31-test';
  const pending=planningBaseStageEngineVersion(current);
  assert.equal(shouldStageLargePlanningUpgrade({
    engineChanged:true,storedEngineVersion:prior,currentEngineVersion:current,
    runType:PLANNING_RUN_TYPES.ENGINE_UPGRADE,baseRecalculationCount:173
  }),true);
  assert.equal(isPlanningBaseStagePending(pending,current),true);
  assert.equal(shouldStageLargePlanningUpgrade({
    engineChanged:true,storedEngineVersion:pending,currentEngineVersion:current,
    runType:PLANNING_RUN_TYPES.ENGINE_UPGRADE,baseRecalculationCount:173
  }),false);
  assert.equal(shouldStageLargePlanningUpgrade({
    engineChanged:true,storedEngineVersion:prior,currentEngineVersion:current,
    runType:PLANNING_RUN_TYPES.INCREMENTAL,baseRecalculationCount:173
  }),false);
  assert.match(screen,/const runEngineVersion = baseStage/);
  assert.match(screen,/skipSoftOptimization: baseStage/);
  assert.match(screen,/engineVersion: runEngineVersion/);
  assert.match(screen,/שלב א׳ נשמר ואומת/);
  assert.match(planner,/if \(!_repairPass && !skipSoftOptimization\)/);
  assert.match(planner,/let finalPlanValidation = await validatePlanningPlanCoherenceCooperatively/);
  assert.ok(planner.indexOf('if (!_repairPass && !skipSoftOptimization)') <
    planner.indexOf('let finalPlanValidation = await validatePlanningPlanCoherenceCooperatively'));
});

test('optimization phase starts from the saved plan, never repeating 173-course base scope',()=>{
  const current='planning-v35-test',pending=planningBaseStageEngineVersion(current);
  const activities=[{row_id:'a',school_id:'s'},{row_id:'b',school_id:'s'},{row_id:'c',school_id:'o'},{row_id:'live',school_id:'s'}];
  const shared={workspace:{revision:11947,engineVersion:pending},rows:[
    {activityId:'a',row:{courseId:'a',kind:'proposal',schoolId:'s',instructorEmpId:'1'}},
    {activityId:'b',row:{courseId:'b',kind:'proposal',schoolId:'s',instructorEmpId:'2'}},
    {activityId:'c',row:{courseId:'c',kind:'recruitment',schoolId:'o'}},
    {activityId:'live',row:{courseId:'live',kind:'live',schoolId:'s',instructorEmpId:'3'}}
  ]};
  const opt=planningEngineUpgradeOptimizationScopes({
    shared,activities,storedEngineVersion:pending,currentEngineVersion:current
  });
  assert.deepEqual(opt.schoolPackingCourseIds.sort(),['a','b']);
  assert.deepEqual(opt.recruitmentRecoveryCourseIds,['c']);
  assert.deepEqual(opt.affectedIds.sort(),['a','b','c']);
  const execution=planningEngineUpgradeExecutionScopes({
    regularAffectedIds:[],engineUpgradeAffectedIds:opt.affectedIds,
    storedEngineVersion:pending,currentEngineVersion:current
  });
  assert.deepEqual(execution.baseRecalculationIds,[]);
  assert.equal(execution.v28OptimizationUpgrade,true);
  const run=resolvePlanningRunPlan({
    shared,currentCourseIds:activities.map(x=>x.row_id),
    regularAffectedIds:[],engineUpgradeAffectedIds:opt.affectedIds,
    upgradeOptimizationScopes:opt,upgradeExecution:execution,
    storedEngineVersion:pending,currentEngineVersion:current
  });
  assert.equal(run.runType,PLANNING_RUN_TYPES.ENGINE_UPGRADE);
  assert.deepEqual(run.baseRecalculationIds,[]);
  assert.deepEqual(run.upgradeOptimizationIds.sort(),['a','b','c']);
  assert.equal(run.persistServerCheckpoints,true);
  assert.match(planner,/upgradeSchoolPackingIds\?\.size \|\| 0/);
});

test('pending optimization with only locked/live records becomes safe marker-only finalization',()=>{
  const current='planning-v35-test',pending=planningBaseStageEngineVersion(current);
  const shared={workspace:{revision:11947,engineVersion:pending},rows:[
    {activityId:'live',row:{courseId:'live',kind:'live'}}
  ]};
  const opt=planningEngineUpgradeOptimizationScopes({
    shared,activities:[{row_id:'live'}],
    storedEngineVersion:pending,currentEngineVersion:current
  });
  assert.deepEqual(opt.affectedIds,[]);
  const execution=planningEngineUpgradeExecutionScopes({
    regularAffectedIds:[],engineUpgradeAffectedIds:[],
    storedEngineVersion:pending,currentEngineVersion:current
  });
  const run=resolvePlanningRunPlan({
    shared,currentCourseIds:['live'],regularAffectedIds:[],
    engineUpgradeAffectedIds:[],upgradeOptimizationScopes:opt,
    upgradeExecution:execution,storedEngineVersion:pending,
    currentEngineVersion:current
  });
  assert.equal(run.runType,PLANNING_RUN_TYPES.NO_OP);
  assert.equal(run.advanceEngineMarker,true);
});
