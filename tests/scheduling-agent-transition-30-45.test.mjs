import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  MAX_TRANSITION_DISTANCE_KM,
  exceedsTransitionDistanceLimit,
  schedulingTransitionFailure,
  transitionBufferMinutes
} from '../frontend/src/screens/instructor-matching-engine.js';
import {transitionFailure} from '../frontend/src/screens/scheduling-core/constraints.js';

const migration=readFileSync(new URL('../supabase/migrations/20261015120500_scheduling_transfer_30_45_guard_and_engine_v38.sql',import.meta.url),'utf8');
const team=readFileSync(new URL('../supabase/migrations/20261015113000_scheduling_agent_team_least_privilege.sql',import.meta.url),'utf8');

test('0..30 km transitions are eligible when cached travel and buffer allow',()=>{
  assert.equal(MAX_TRANSITION_DISTANCE_KM,30);
  assert.equal(exceedsTransitionDistanceLimit(30),false);
  assert.equal(exceedsTransitionDistanceLimit(30.001),true);
  assert.equal(schedulingTransitionFailure({gapMinutes:50,route:{distance_km:30,duration_minutes:35}}),null);
  assert.equal(schedulingTransitionFailure({gapMinutes:49,route:{distance_km:30,duration_minutes:35}}),'transition_insufficient');
  assert.equal(transitionBufferMinutes(5),5);
  assert.equal(transitionBufferMinutes(5.01),15);
});

test('planning engine does not automatically approve a 30-45 km candidate',()=>{
  assert.equal(schedulingTransitionFailure({gapMinutes:80,route:{distance_km:30.01,duration_minutes:40}}),'transition_distance_exceeded');
  assert.equal(schedulingTransitionFailure({gapMinutes:80,route:{distance_km:45,duration_minutes:40}}),'transition_distance_exceeded');
  assert.equal(schedulingTransitionFailure({gapMinutes:80,route:{distance_km:45.01,duration_minutes:40}}),'transition_distance_exceeded');
  assert.equal(schedulingTransitionFailure({gapMinutes:80,route:null}),'travel_unverified');
});

test('v38 core planner uses same safe 30 km normal limit',()=>{
  const a={schoolId:'A',address:'A',start:480,end:540};
  const b={schoolId:'B',address:'B',start:620,end:680};
  const lookup=km=>({routeClient:{peek(){return {distance_km:km,duration_minutes:45}}},verifiedRoutes:new Map()});
  assert.equal(transitionFailure(lookup(30),a,b),null);
  assert.equal(transitionFailure(lookup(30.01),a,b),'transition_distance_exceeded');
  assert.equal(transitionFailure(lookup(45.01),a,b),'transition_distance_exceeded');
});

test('server 30/45 decision is enforced in SQL, including manual and approval review',()=>{
  assert.match(migration,/required_km > 30/);
  assert.match(migration,/required_km > 45/);
  assert.match(migration,/scheduling_transition_distance_forbidden/);
  assert.match(migration,/scheduling_manual_assignment_hard_violations/);
  assert.match(migration,/scheduling_course_instructor_violations/);
  assert.match(migration,/scheduling_transition_distance_cap_applies/);
  assert.match(migration,/p_gap_minutes >= 0/);
  assert.match(team,/גדול מ־30 ק״מ/);
});

test('trust-version handshake changes atomically with hard-gate change',()=>{
  assert.match(migration,/planning-v38-20261015-transition-30-45/);
  assert.match(migration,/get_scheduling_planning_engine_capabilities/);
  assert.match(migration,/save_scheduling_planning_snapshot/);
  assert.match(migration,/save_scheduling_planning_incremental_snapshot/);
  assert.match(migration,/scheduling_v37_workspace_validation/);
});
